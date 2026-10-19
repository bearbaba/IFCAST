"""Fast deterministic logic regression tests using a deliberately minimal GenLayer shim.

These tests do NOT substitute for GenVM linter or Studio consensus integration.
"""
import importlib.util
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


class Result:
    def __init__(self, calldata):
        self.calldata = calldata


class VM:
    UserError = ValueError
    Return = Result

    @staticmethod
    def run_nondet_unsafe(leader, validator):
        proposal = leader()
        if not validator(Result(proposal)):
            raise ValueError('Independent validator disagreement')
        return proposal


gl = types.SimpleNamespace(
    Contract=object,
    public=types.SimpleNamespace(write=lambda f: f, view=lambda f: f),
    message=types.SimpleNamespace(sender_address=Address('0x'+'1'*40)),
    vm=VM,
)
mock_module = types.ModuleType('genlayer')
mock_module.gl = gl
mock_module.TreeMap = Map
mock_module.u256 = int
sys.modules['genlayer'] = mock_module
spec = importlib.util.spec_from_file_location('ifcast_contract',Path(__file__).resolve().parents[1] / 'contracts' / 'IFCast.py')
contract_module = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(contract_module)

NOW = 1800000000
PR = 'https://api.github.com/repos/example/protocol/pulls/42'
REL = 'https://api.github.com/repos/example/protocol/releases/latest'


@pytest.fixture
def market(monkeypatch):
    monkeypatch.setattr(contract_module,'_now',lambda: NOW)
    c = contract_module.IFCast()
    c.markets = Map()
    c.positions = Map()
    c.balances = Map()
    c.has_grant = Map()
    gl.message.sender_address = Address('0x'+'1'*40)
    c.claim_demo_credits()
    assert c.create_market('Will the upgrade ship after PR merge?',
           'PR #42 must be merged before the close date.',
           'A release must include the upgrade within 72 hours of the PR.',
           PR,REL,NOW+3600,NOW+7200)==1
    return c


def travel(monkeypatch,seconds):
    monkeypatch.setattr(contract_module,'_now',lambda: NOW+seconds)


def decision(condition='TRUE',target='TRUE',reason='Verified by independently fetched GitHub API records.'):
    return {'condition':condition,'target':target,'reason':reason}


def test_faucet_only_once(market):
    assert market.get_balance('0x'+'1'*40)==1000
    with pytest.raises(ValueError,match='already claimed'): market.claim_demo_credits()


def test_market_has_immutable_policy(market):
    m=market.get_market(1)
    assert m['condition_url']==PR and m['target_url']==REL
    assert m['close_at']==NOW+3600 and m['resolve_after']==NOW+7200
    assert market.get_market_count()==1
    assert len(market.get_markets(0,12))==1


@pytest.mark.parametrize('bad_url',[ 
    'http://api.github.com/repos/example/protocol/pulls/42',
    'https://api.github.com.evil.com/repos/example/protocol/pulls/42',
    'https://api.github.com@evil.com/repos/example/protocol/pulls/42',
    'https://api.github.com:443/repos/example/protocol/pulls/42',
    'https://api.github.com/repos/example/protocol/pulls/42?x=1',
    'https://api.github.com/repos/example/protocol/pulls/../42',
    'https://api.github.com/repos/example/protocol/issues/42',
])
def test_source_policy_rejects_injection(market,bad_url):
    with pytest.raises(ValueError,match='pinned GitHub'):
        market.create_market('Will the upgrade ship after PR merge?',
            'PR #42 must merge before close.','Release contains upgrade within 72 hours.',
            bad_url,REL,NOW+3600,NOW+7200)


def test_cross_repository_source_rejected(market):
    with pytest.raises(ValueError,match='same repository'):
        market.create_market('Will the upgrade ship after PR merge?',
            'PR #42 must merge before close.','Release contains upgrade within 72 hours.',
            PR,'https://api.github.com/repos/other/project/releases/latest',NOW+3600,NOW+7200)


def test_deadlines_rejected(market):
    with pytest.raises(ValueError,match='Close time'): market.create_market('Will the upgrade ship after PR merge?','PR merged before close.','Release within 72 hours.',PR,REL,NOW,NOW+7200)
    with pytest.raises(ValueError,match='Resolution time'): market.create_market('Will the upgrade ship after PR merge?','PR merged before close.','Release within 72 hours.',PR,REL,NOW+3600,NOW+3599)


def test_stake_debits_balance_and_side_locked(market):
    market.place_position(1,'YES',250)
    assert market.get_balance('0x'+'1'*40)==750
    assert market.get_position(1,'0x'+'1'*40)['amount']==250
    with pytest.raises(ValueError,match='both sides'): market.place_position(1,'NO',1)
    market.place_position(1,'YES',50)
    assert market.get_market(1)['yes_pool']==300
    with pytest.raises(ValueError,match='Insufficient'): market.place_position(1,'YES',701)


def test_stake_closed_rejected(market,monkeypatch):
    travel(monkeypatch,3600)
    with pytest.raises(ValueError,match='not accepting'): market.place_position(1,'YES',10)


def test_no_resolution_before_gate(market):
    with pytest.raises(ValueError,match='not opened'): market.resolve_market(1)


def test_independent_validator_detects_disagreement(market,monkeypatch):
    travel(monkeypatch,8000)
    choices=iter([decision('TRUE','TRUE'),decision('TRUE','FALSE')])
    market._assess=lambda _: next(choices)
    with pytest.raises(ValueError,match='validator disagreement'): market.resolve_market(1)
    assert market.get_market(1)['status']=='OPEN'


def test_yes_settlement_and_single_claim(market,monkeypatch):
    market.place_position(1,'YES',200)
    gl.message.sender_address=Address('0x'+'2'*40)
    market.claim_demo_credits()
    market.place_position(1,'NO',300)
    travel(monkeypatch,8000)
    market._assess=lambda _:decision()
    assert market.resolve_market(1)=='RESOLVED'
    gl.message.sender_address=Address('0x'+'1'*40)
    assert market.claim(1)==500
    assert market.get_balance('0x'+'1'*40)==1300
    with pytest.raises(ValueError,match='No unclaimed'): market.claim(1)
    gl.message.sender_address=Address('0x'+'2'*40)
    assert market.claim(1)==0
    assert market.get_balance('0x'+'2'*40)==700


def test_void_refunds_both_sides(market,monkeypatch):
    market.place_position(1,'YES',150)
    gl.message.sender_address=Address('0x'+'2'*40)
    market.claim_demo_credits()
    market.place_position(1,'NO',100)
    travel(monkeypatch,8000)
    market._assess=lambda _:decision('FALSE','UNKNOWN')
    assert market.resolve_market(1)=='VOID'
    assert market.claim(1)==100
    gl.message.sender_address=Address('0x'+'1'*40)
    assert market.claim(1)==150


def test_unresolved_evidence_never_becomes_no(market,monkeypatch):
    market.place_position(1,'NO',10)
    travel(monkeypatch,8000)
    market._assess=lambda _:decision('TRUE','UNKNOWN')
    assert market.resolve_market(1)=='OPEN'
    with pytest.raises(ValueError,match='not settled'): market.claim(1)
    with pytest.raises(ValueError,match='Wait before retrying'): market.resolve_market(1)
    travel(monkeypatch,9000)
    market._assess=lambda _:decision('TRUE','FALSE')
    assert market.resolve_market(1)=='RESOLVED'
    assert market.get_market(1)['outcome']=='NO'


def test_no_winners_refunds_rather_than_trapping_credits(market,monkeypatch):
    market.place_position(1,'NO',100)
    travel(monkeypatch,8000)
    market._assess=lambda _:decision('TRUE','TRUE')
    assert market.resolve_market(1)=='VOID'
    assert market.get_market(1)['outcome']=='YES'
    assert market.claim(1)==100


def test_re_resolve_after_settlement_rejected(market,monkeypatch):
    market.place_position(1,'YES',10)
    travel(monkeypatch,8000)
    market._assess=lambda _:decision()
    assert market.resolve_market(1)=='RESOLVED'
    with pytest.raises(ValueError,match='already settled'): market.resolve_market(1)


def test_invalid_verdict_rejected(market,monkeypatch):
    travel(monkeypatch,8000)
    market._assess=lambda _: {'condition':'TRUE','target':'NO','reason':'Unsupported outcome decision'}
    with pytest.raises(ValueError,match='validator disagreement'): market.resolve_market(1)


def test_invalid_pagination_and_missing_market(market):
    with pytest.raises(ValueError,match='pagination'): market.get_markets(0,31)
    with pytest.raises(ValueError,match='Unknown'): market.get_market(999)
