"""Deterministic simulation tests for crypto v0.2. NOT GenVM integration tests."""
import importlib.util
import json
import sys
import types
from pathlib import Path
import pytest


class Map(dict):
    @classmethod
    def __class_getitem__(cls, _):
        return cls


class Address:
    def __init__(self, value):
        self.as_hex = value


class Return:
    def __init__(self, data):
        self.calldata = data


class VM:
    UserError = ValueError
    Return = Return

    @staticmethod
    def run_nondet_unsafe(leader, validator):
        p = leader()
        if not validator(Return(p)):
            raise ValueError('Independent validator disagreement')
        return p


gl = types.SimpleNamespace(
    Contract=object,
    public=types.SimpleNamespace(write=lambda f: f, view=lambda f: f),
    message=types.SimpleNamespace(sender_address=Address('0x'+'1'*40)),
    vm=VM,
    nondet=types.SimpleNamespace(web=types.SimpleNamespace(get=None)),
)
genlayer = types.ModuleType('genlayer')
genlayer.gl = gl
genlayer.TreeMap = Map
genlayer.u256 = int
sys.modules['genlayer'] = genlayer
spec = importlib.util.spec_from_file_location('ifcast_crypto_v02', Path(__file__).resolve().parents[1] / 'contracts' / 'IFCastCryptoV02.py')
cmod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cmod)
NOW = 1800000000
START = (NOW // 3600 + 2) * 3600
W_A = '0x' + '1'*40
W_B = '0x' + '2'*40


def travel(monkeypatch, stamp):
    monkeypatch.setattr(cmod, '_now', lambda: stamp)


def candle(start, idx, op, high, low, close):
    opened = (start + idx*3600)*1000
    return [opened, op, high, low, close, '0', opened+3_600_000-1, '0']


def candles(start=START, n=24, op='2000.00000000', high='2300.00000000', low='1900.00000000', close='2200.00000000'):
    return [candle(start, i, op, high, low, close) for i in range(n)]


@pytest.fixture
def contract(monkeypatch):
    travel(monkeypatch, NOW)
    gl.message.sender_address = Address(W_A)
    c = cmod.IFCastCryptoV02()
    c.markets, c.positions, c.balances, c.has_grant = Map(), Map(), Map(), Map()
    c.claim_demo_credits()
    assert c.get_balance(W_A) == 1000
    return c


def new_target(contract, threshold=2500, kind='TOUCH_ABOVE', hours=24):
    return contract.create_market(kind, 'ETH', '', threshold*cmod.PRICE_SCALE, START, hours)


def advance(monkeypatch, hours=24):
    travel(monkeypatch, START + hours*3600 + 301)


def fake_http(monkeypatch, eth, sol=None):
    def get(url):
        if 'symbol=ETHUSDT' in url:
            return types.SimpleNamespace(body=json.dumps(eth).encode())
        if 'symbol=SOLUSDT' in url:
            return types.SimpleNamespace(body=json.dumps(sol).encode())
        raise ValueError('Unknown symbol')
    gl.nondet.web.get = get


def test_price_units_exact_and_rejections():
    assert cmod._price_units('2500.00000001') == 250000000001
    assert cmod._price_units('0.00000001') == 1
    for x in ['-1','0','NaN','1e2','1.000000000','+1','.2','0x10',' 1']:
        with pytest.raises(ValueError): cmod._price_units(x)


def test_url_is_locked_to_binance_and_hour_bounds():
    url = cmod._kline_url('ETH', START, 24)
    assert url.startswith('https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=1h')
    assert f'startTime={START*1000}' in url
    assert f'endTime={(START+24*3600)*1000-1}' in url
    for asset in ('../../x','ETH?evil=true','USDT','BTCUSDT'):
        with pytest.raises(ValueError): cmod._kline_url(asset, START, 24)


def test_price_market_parameters(contract):
    assert new_target(contract)==1
    m=contract.get_market(1)
    assert m['close_at']==START and m['end_at']==START+24*3600
    assert m['resolve_after']==m['end_at']+300
    assert m['source']=='BINANCE_SPOT_USDT_1H_V1'
    for start in (NOW, NOW+1, NOW+8*86400, START+1):
        with pytest.raises(ValueError,match='future UTC hour'):
            contract.create_market('TOUCH_ABOVE','ETH','',100*cmod.PRICE_SCALE,start,24)
    with pytest.raises(ValueError,match='price target'):
        contract.create_market('TOUCH_ABOVE','ETH','BTC',100*cmod.PRICE_SCALE,START,24)
    with pytest.raises(ValueError,match='price target'):
        contract.create_market('TOUCH_BELOW','ETH','',0,START,24)
    with pytest.raises(ValueError,match='battle'):
        contract.create_market('OUTPERFORM','ETH','ETH',0,START,24)
    with pytest.raises(ValueError,match='battle'):
        contract.create_market('OUTPERFORM','ETH','SOL',10,START,24)
    with pytest.raises(ValueError,match='asset'):
        contract.create_market('TOUCH_ABOVE','PEPE','',100*cmod.PRICE_SCALE,START,24)
    with pytest.raises(ValueError,match='duration'):
        contract.create_market('TOUCH_ABOVE','ETH','',100*cmod.PRICE_SCALE,START,25)
    assert contract.get_market_count()==1


def test_missing_hour_cannot_be_no():
    full=candles()
    for missing in (full[:23], full[1:], full[:5]+full[6:], full+[full[0]]):
        with pytest.raises(ValueError): cmod._candles(missing,START,24)
    corrupted=candles()
    corrupted[7][6]-=1000
    with pytest.raises(ValueError,match='Incomplete'): cmod._candles(corrupted,START,24)
    corrupted=candles()
    corrupted[7][0]+=1
    with pytest.raises(ValueError,match='Non-contiguous'): cmod._candles(corrupted,START,24)
    corrupted=candles()
    corrupted[5][2]='1500.0'
    with pytest.raises(ValueError,match='Incoherent'): cmod._candles(corrupted,START,24)


def test_touch_on_exact_threshold_is_yes(contract,monkeypatch):
    new_target(contract,threshold=2500)
    rows=candles(high='2499.00000000')
    rows[9][2]='2500.00000000'
    fake_http(monkeypatch,rows)
    advance(monkeypatch)
    assert contract._assess(contract.get_market(1))['outcome']=='YES'


def test_touch_below_checks_low_not_closing(contract,monkeypatch):
    new_target(contract,threshold=1800,kind='TOUCH_BELOW')
    rows=candles()
    rows[7][3]='1800.00000000'
    fake_http(monkeypatch,rows)
    advance(monkeypatch)
    assert contract._assess(contract.get_market(1))['outcome']=='YES'


def test_full_candles_enable_definite_no(contract,monkeypatch):
    new_target(contract)
    fake_http(monkeypatch,candles(high='2499.99999999'))
    advance(monkeypatch)
    assert contract._assess(contract.get_market(1))['outcome']=='NO'


def test_invalid_or_incomplete_source_stays_open(contract,monkeypatch):
    new_target(contract)
    contract.place_position(1,'YES',100)
    fake_http(monkeypatch,candles()[:22])
    advance(monkeypatch)
    assert contract.resolve_market(1)=='OPEN'
    assert contract.get_market(1)['outcome']==''
    assert contract.get_market(1)['attempts']==1
    with pytest.raises(ValueError,match='Market not settled'): contract.claim(1)
    with pytest.raises(ValueError,match='Wait before retry'): contract.resolve_market(1)


def test_faucet_and_stake_protection(contract,monkeypatch):
    new_target(contract)
    with pytest.raises(ValueError,match='already claimed'): contract.claim_demo_credits()
    contract.place_position(1,'YES',100)
    assert contract.get_balance(W_A)==900
    with pytest.raises(ValueError,match='both sides'): contract.place_position(1,'NO',100)
    with pytest.raises(ValueError,match='Insufficient'): contract.place_position(1,'YES',901)
    with pytest.raises(ValueError,match='Invalid position'): contract.place_position(1,'YES',True)
    travel(monkeypatch,START)
    with pytest.raises(ValueError,match='not accepting'): contract.place_position(1,'YES',1)
    with pytest.raises(ValueError,match='not opened'): contract.resolve_market(1)


def test_battle_relative_not_absolute_and_tie():
    record={'kind':'OUTPERFORM','token_a':'ETH','token_b':'SOL','target_e8':0}
    a=cmod._candles(candles(n=24,op='3000.0',high='3300.0',low='2900.0',close='3150.0'),START,24)
    b=cmod._candles(candles(n=24,op='150.0',high='200.0',low='145.0',close='165.0'),START,24)
    assert cmod._evaluate(record,a,b)=='NO'  # +5% vs +10%
    b2=cmod._candles(candles(n=24,op='150.0',high='180.0',low='145.0',close='157.5'),START,24)
    assert cmod._evaluate(record,a,b2)=='VOID'  # +5% vs +5%
    b3=cmod._candles(candles(n=24,op='150.0',high='180.0',low='145.0',close='150.0'),START,24)
    assert cmod._evaluate(record,a,b3)=='YES'


def test_consensus_validator_checks_digest(contract,monkeypatch):
    new_target(contract)
    contract.place_position(1,'YES',100)
    advance(monkeypatch)
    choices=iter([
        {'outcome':'YES','digest':'a'*64,'reason':'valid'},
        {'outcome':'YES','digest':'b'*64,'reason':'different evidence'}
    ])
    contract._assess=lambda _:next(choices)
    with pytest.raises(ValueError,match='validator disagreement'):contract.resolve_market(1)
    assert contract.get_market(1)['attempts']==0


def test_yes_settlement_payout_and_double_claim(contract,monkeypatch):
    new_target(contract)
    contract.place_position(1,'YES',100)
    gl.message.sender_address=Address(W_B)
    contract.claim_demo_credits()
    contract.place_position(1,'NO',200)
    rows=candles(high='2600.00')
    fake_http(monkeypatch,rows)
    advance(monkeypatch)
    assert contract.resolve_market(1)=='RESOLVED'
    assert contract.get_market(1)['outcome']=='YES'
    assert contract.get_market(1)['evidence_digest']
    gl.message.sender_address=Address(W_A)
    assert contract.claim(1)==300
    assert contract.get_balance(W_A)==1200
    with pytest.raises(ValueError,match='No unclaimed'):contract.claim(1)
    gl.message.sender_address=Address(W_B)
    assert contract.claim(1)==0
    assert contract.get_balance(W_B)==800


def test_zero_winners_refund_and_tie_refund(contract,monkeypatch):
    new_target(contract)
    contract.place_position(1,'NO',300)
    fake_http(monkeypatch,candles(high='2600.0'))
    advance(monkeypatch)
    assert contract.resolve_market(1)=='VOID'
    assert contract.get_market(1)['outcome']=='YES'  # outcome observed, refund policy
    assert contract.claim(1)==300
    travel(monkeypatch,NOW)
    contract.create_market('OUTPERFORM','ETH','SOL',0,START,24)
    contract.place_position(2,'YES',100)
    eth=candles(op='1000.0',high='1200.0',low='900.0',close='1100.0')
    sol=candles(op='100.0',high='130.0',low='90.0',close='110.0')
    fake_http(monkeypatch,eth,sol)
    advance(monkeypatch)
    assert contract.resolve_market(2)=='VOID'
    assert contract.get_market(2)['outcome']=='VOID'
    assert contract.claim(2)==100


def test_paged_reads_and_market_isolation(contract):
    for _ in range(4): new_target(contract)
    assert [m['id'] for m in contract.get_markets(2,2)]==[3,4]
    with pytest.raises(ValueError,match='Invalid page'):contract.get_markets(0,31)
    with pytest.raises(ValueError,match='Unknown market'):contract.get_market(900)
