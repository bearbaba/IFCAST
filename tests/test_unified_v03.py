"""v0.3 deterministic shim tests; NOT proof of live GenVM, publisher truth or LLM correctness."""
import importlib.util
import json
import sys
import types
from pathlib import Path
import pytest


class Map(dict):
    @classmethod
    def __class_getitem__(cls, _): return cls


class Address:
    def __init__(self, s): self.as_hex = s


class Return:
    def __init__(self, v): self.calldata = v


class VM:
    UserError = ValueError
    Return = Return
    @staticmethod
    def run_nondet_unsafe(leader, validator):
        decision = leader()
        if not validator(Return(decision)):
            raise ValueError('Independent validator disagreement')
        return decision


gl = types.SimpleNamespace(
    Contract=object,
    public=types.SimpleNamespace(write=lambda f: f, view=lambda f: f),
    message=types.SimpleNamespace(sender_address=Address('0x'+'a'*40)),
    vm=VM,
    nondet=types.SimpleNamespace(web=types.SimpleNamespace(get=None), exec_prompt=None),
)
shim = types.ModuleType('genlayer')
shim.gl, shim.TreeMap, shim.u256 = gl, Map, int
sys.modules['genlayer'] = shim
spec = importlib.util.spec_from_file_location('ifcast_unified_v03', Path(__file__).resolve().parents[1]/'contracts'/'IFCastUnifiedV03.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
NOW = 1800000000
CLOSE = NOW + 3600
DEADLINE = NOW + 86400
A, B = '0x'+'a'*40, '0x'+'b'*40
COINBASE = 'https://www.coinbase.com/blog/coinbase-will-list-sample-asset'
SEC = 'https://www.sec.gov/newsroom/press-releases/2027-012'


@pytest.fixture
def market(monkeypatch):
    monkeypatch.setattr(mod, '_now', lambda: NOW)
    gl.message.sender_address = Address(A)
    instance = mod.IFCastUnifiedV03()
    instance.markets, instance.positions = Map(), Map()
    instance.balances, instance.has_grant = Map(), Map()
    instance.claim_demo_credits()
    return instance


def travel(monkeypatch, now): monkeypatch.setattr(mod, '_now', lambda: now)


def create(market, kind='COINBASE_SPOT_LISTING'):
    return market.create_event_market(kind, 'Sample Asset SAMPLE', CLOSE, DEADLINE)


def evidence(market, monkeypatch, link=COINBASE):
    travel(monkeypatch, CLOSE+1)
    return market.submit_event_evidence(1, link)


def publisher(monkeypatch, answer, text='Coinbase listing announcement', url=COINBASE):
    calls=[]
    def get(u):
        calls.append(u)
        assert u == url
        return types.SimpleNamespace(body=text.encode())
    def prompt(p, response_format):
        calls.append('model')
        assert '<untrusted_official_document>' in p
        assert response_format == 'json'
        return answer
    gl.nondet.web.get = get
    gl.nondet.exec_prompt = prompt
    return calls


def judgement(outcome='YES', url=COINBASE, stamp='2027-01-15T12:00:00Z'):
    # Synthetic timestamp must fall in fake epoch window; use actual NOW-derived UTC.
    from datetime import datetime, timezone
    stamp=datetime.fromtimestamp(CLOSE+200,timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    return {'outcome':outcome,'evidence_url':url,'event_date':stamp,
            'reason':'An explicit official and timestamped decision about the exact asset.'}


def test_strict_evidence_sources():
    assert mod._event_source_approved('COINBASE_SPOT_LISTING', COINBASE)
    assert mod._event_source_approved('SEC_SPOT_ETF_DECISION', SEC)
    bad = [
        'http://www.coinbase.com/blog/listing',
        'https://coinbase.com/blog/listing',
        'https://www.coinbase.com.evil.com/blog/listing',
        'https://user@www.coinbase.com/blog/listing',
        'https://www.coinbase.com:443/blog/listing',
        'https://www.coinbase.com/blog/a?next=https://evil.com',
        'https://www.coinbase.com/blog/../security/notice',
        'https://www.coinbase.com/blog/%2e%2e/listing',
        'https://www.coinbase.com/blog/listing#frag',
        'https://www.coinbase.com/blog/',
        SEC.replace('www.sec.gov','sec.gov'),
        'https://www.sec.gov/rules/sro/nysearca/2027/34-123456.pdf',
    ]
    assert all(not mod._event_source_approved('COINBASE_SPOT_LISTING',x) for x in bad)


def test_event_template_and_deadline_guards(market):
    assert create(market)==1
    m=market.get_market(1)
    assert m['kind']=='COINBASE_SPOT_LISTING' and m['source']=='OFFICIAL_SOURCE_SUBMISSION_V1'
    assert m['close_at']==CLOSE and m['resolve_after']==DEADLINE+300
    with pytest.raises(ValueError,match='Unknown AI event'): market.create_event_market('FREE_FORM','x'*12,CLOSE,DEADLINE)
    with pytest.raises(ValueError,match='subject'): market.create_event_market('COINBASE_SPOT_LISTING','ETH<script>',CLOSE,DEADLINE)
    with pytest.raises(ValueError,match='deadlines'): market.create_event_market('COINBASE_SPOT_LISTING','Sample SAMPLE',NOW,DEADLINE)
    with pytest.raises(ValueError,match='deadlines'): market.create_event_market('COINBASE_SPOT_LISTING','Sample SAMPLE',CLOSE,CLOSE+10)
    with pytest.raises(ValueError,match='deadlines'): market.create_event_market('COINBASE_SPOT_LISTING','Sample SAMPLE',CLOSE,NOW+61*86400)


def test_only_official_evidence_after_close(market, monkeypatch):
    create(market)
    with pytest.raises(ValueError,match='starts when betting closes'):market.submit_event_evidence(1,COINBASE)
    travel(monkeypatch,CLOSE)
    with pytest.raises(ValueError,match='allowlisted'):market.submit_event_evidence(1,'https://fake.com/listing')
    assert market.submit_event_evidence(1,COINBASE)==1
    with pytest.raises(ValueError,match='Duplicate'):market.submit_event_evidence(1,COINBASE)
    for suffix in ('a','b','c'):
        assert market.submit_event_evidence(1,COINBASE+suffix) in (2,3,4)
    with pytest.raises(ValueError,match='excess'):market.submit_event_evidence(1,COINBASE+'d')
    travel(monkeypatch,DEADLINE+300+14*86400)
    with pytest.raises(ValueError,match='grace period closed'):market.submit_event_evidence(1,COINBASE+'d')


def test_sec_template_uses_sec_only(market,monkeypatch):
    create(market,'SEC_SPOT_ETF_DECISION')
    travel(monkeypatch,CLOSE+1)
    with pytest.raises(ValueError,match='allowlisted'):market.submit_event_evidence(1,COINBASE)
    assert market.submit_event_evidence(1,SEC)==1


def test_no_price_market_oracle_regression(market,monkeypatch):
    start = ((NOW//3600)+2)*3600
    assert market.create_market('TOUCH_ABOVE','ETH','',2500*mod.PRICE_SCALE,start,1)==1
    assert market.get_market(1)['source']=='BINANCE_SPOT_USDT_1H_V1'
    assert market.get_market(1)['kind']=='TOUCH_ABOVE'
    with pytest.raises(ValueError,match='not opened'):market.resolve_market(1)


def test_missing_evidence_is_not_no(market,monkeypatch):
    create(market)
    travel(monkeypatch,DEADLINE+300)
    assert market.resolve_market(1)=='OPEN'
    m=market.get_market(1)
    assert m['attempts']==1 and m['outcome']=='' and 'No official' in m['reason']
    with pytest.raises(ValueError,match='Wait before retry'): market.resolve_market(1)


def test_ai_positive_settlement_and_one_time_claim(market,monkeypatch):
    create(market)
    market.place_position(1,'YES',100)
    gl.message.sender_address=Address(B)
    market.claim_demo_credits()
    market.place_position(1,'NO',200)
    evidence(market,monkeypatch)
    calls=publisher(monkeypatch,judgement())
    travel(monkeypatch,DEADLINE+301)
    assert market.resolve_market(1)=='RESOLVED'
    assert calls.count('model')==2 and calls.count(COINBASE)==2
    m=market.get_market(1)
    assert m['verified_url']==COINBASE and m['outcome']=='YES' and len(m['evidence_digest'])==64
    gl.message.sender_address=Address(A)
    assert market.claim(1)==300 and market.get_balance(A)==1200
    with pytest.raises(ValueError,match='No unclaimed'):market.claim(1)
    gl.message.sender_address=Address(B)
    assert market.claim(1)==0 and market.get_balance(B)==800


def test_explicit_negative_decision_can_settle_no(market,monkeypatch):
    create(market,'SEC_SPOT_ETF_DECISION')
    market.place_position(1,'NO',100)
    evidence(market,monkeypatch,SEC)
    publisher(monkeypatch,judgement('NO',SEC),text='SEC DISAPPROVES ETF filing',url=SEC)
    travel(monkeypatch,DEADLINE+301)
    assert market.resolve_market(1)=='RESOLVED'
    assert market.get_market(1)['outcome']=='NO'


def test_unproven_outcome_never_awards_no(market,monkeypatch):
    create(market)
    market.place_position(1,'NO',100)
    evidence(market,monkeypatch)
    publisher(monkeypatch,{'outcome':'UNKNOWN','evidence_url':'','event_date':'',
                            'reason':'A Coinbase roadmap mention is not a listing announcement.'})
    travel(monkeypatch,DEADLINE+301)
    assert market.resolve_market(1)=='OPEN'
    assert market.get_market(1)['reviewed_evidence_count']==1
    assert market.get_market(1)['outcome']==''
    with pytest.raises(ValueError,match='not settled'):market.claim(1)


def test_validator_must_recheck_ai_outcome(market,monkeypatch):
    create(market)
    evidence(market,monkeypatch)
    choices=iter([judgement('YES'), judgement('NO')])
    def fake_response(p,response_format):return next(choices)
    publisher(monkeypatch,judgement())
    gl.nondet.exec_prompt=fake_response
    travel(monkeypatch,DEADLINE+301)
    with pytest.raises(ValueError,match='validator disagreement'):market.resolve_market(1)
    assert market.get_market(1)['attempts']==0


def test_forged_model_citation_is_rejected(market,monkeypatch):
    create(market)
    evidence(market,monkeypatch)
    fake=judgement()
    fake['evidence_url']='https://www.coinbase.com/blog/other-article'
    publisher(monkeypatch,fake)
    travel(monkeypatch,DEADLINE+301)
    with pytest.raises(ValueError,match='Malformed'):market.resolve_market(1)


def test_out_of_window_model_date_rejected(market,monkeypatch):
    create(market)
    evidence(market,monkeypatch)
    fake=judgement()
    fake['event_date']='2021-01-02T00:00:00Z'
    publisher(monkeypatch,fake)
    travel(monkeypatch,DEADLINE+301)
    with pytest.raises(ValueError,match='out-of-window'):market.resolve_market(1)


def test_absence_refund_after_grace_but_never_before(market,monkeypatch):
    create(market)
    market.place_position(1,'YES',123)
    travel(monkeypatch,DEADLINE+300+14*86400-1)
    with pytest.raises(ValueError,match='grace period'):market.void_expired_event(1)
    travel(monkeypatch,DEADLINE+300+14*86400)
    assert market.void_expired_event(1)=='VOID'
    assert market.claim(1)==123
    with pytest.raises(ValueError,match='Not an open'):market.void_expired_event(1)


def test_evidence_requires_consensus_before_grace_refund(market,monkeypatch):
    create(market)
    market.place_position(1,'YES',50)
    evidence(market,monkeypatch)
    travel(monkeypatch,DEADLINE+300+14*86400)
    with pytest.raises(ValueError,match='requires consensus review'): market.void_expired_event(1)
    publisher(monkeypatch,{'outcome':'UNKNOWN','evidence_url':'','event_date':'',
                           'reason':'No dated official decision about this asset can be established.'})
    assert market.resolve_market(1)=='OPEN'
    assert market.get_market(1)['reviewed_evidence_count']==1
    assert market.void_expired_event(1)=='VOID'
    assert market.claim(1)==50


def test_price_contract_api_preserved(market):
    required=('claim_demo_credits','create_market','place_position','resolve_market',
              'claim','get_market_count','get_market','get_markets','get_balance',
              'has_claimed_grant','get_position')
    assert all(callable(getattr(market,fn,None)) for fn in required)
