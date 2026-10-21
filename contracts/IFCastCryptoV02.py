# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""IFCAST Crypto v0.2 — test-credit binary markets with bounded hourly-price evidence.

Experimental Studionet contract. No deposits, no redemption, no real assets.
Price source is pinned to Binance Spot USDT hourly klines; this is not USD.
The deployment is a DIFFERENT contract from IFCAST v0.1 and does not migrate state.
"""
import hashlib
import json
from datetime import datetime, timezone
from genlayer import *

CREDIT_GRANT = 1000
MAX_STAKE = 1000
PRICE_SCALE = 100_000_000  # quote-token (USDT) price has at most 8 decimal places
MAX_PRICE = 10_000_000 * PRICE_SCALE
TOKENS = ('BTC', 'ETH', 'SOL', 'BNB', 'DOGE', 'AVAX', 'LINK', 'XRP')
DURATIONS = (1, 4, 24, 168)
MAX_MARKETS_PER_PAGE = 30
MIN_LEAD_SECONDS = 900
MAX_START_DELAY = 7 * 86400
CANDLE_SECONDS = 3600
RESOLUTION_LAG_SECONDS = 300
COOLDOWN_SECONDS = 600


def _now() -> int:
    # GenVM makes datetime.now refer to the transaction's deterministic timestamp.
    return int(datetime.now(timezone.utc).timestamp())


def _price_units(value: str) -> int:
    """Exact fixed-point conversion; floats are never used in contract settlement."""
    if not isinstance(value, str) or not value or value.startswith(('+', '-')):
        raise ValueError('Invalid price')
    parts = value.split('.')
    if len(parts) > 2 or not parts[0].isdigit() or (len(parts) == 2 and (not parts[1].isdigit() or len(parts[1]) > 8)):
        raise ValueError('Invalid price')
    units = int(parts[0]) * PRICE_SCALE
    if len(parts) == 2:
        units += int(parts[1].ljust(8, '0'))
    if units <= 0 or units > MAX_PRICE:
        raise ValueError('Price outside supported range')
    return units


def _candles(payload: object, start_at: int, hours: int) -> list:
    """Fail closed unless every required *completed* hourly bar is present.

    Each normalized bar is [start_ms, open_e8, high_e8, low_e8, close_e8].
    Returned bars include both endpoints of the specified time window exactly.
    A missing hourly candle cannot be interpreted as proof of NO.
    """
    if not isinstance(payload, list) or len(payload) != hours:
        raise ValueError('Missing or extra hourly candles')
    result = []
    for i, row in enumerate(payload):
        if not isinstance(row, list) or len(row) < 7:
            raise ValueError('Invalid candle structure')
        opened = (start_at + i * CANDLE_SECONDS) * 1000
        if type(row[0]) is not int or row[0] != opened:
            raise ValueError('Non-contiguous candle timestamps')
        if type(row[6]) is not int or row[6] != opened + CANDLE_SECONDS * 1000 - 1:
            raise ValueError('Incomplete candle close timestamp')
        op, high, low, close = [_price_units(v) for v in row[1:5]]
        if high < max(op, close) or low > min(op, close) or low > high:
            raise ValueError('Incoherent OHLC values')
        result.append([opened, op, high, low, close])
    return result


def _kline_url(token: str, start_at: int, hours: int) -> str:
    # The resolver NEVER accepts URLs from a market creator or caller.
    if token not in TOKENS or hours not in DURATIONS or start_at % CANDLE_SECONDS:
        raise ValueError('Invalid source configuration')
    first = start_at * 1000
    last = (start_at + hours * CANDLE_SECONDS) * 1000 - 1
    return f'https://api.binance.com/api/v3/klines?symbol={token}USDT&interval=1h&startTime={first}&endTime={last}&limit=1000'


def _evaluate(market: dict, series_a: list, series_b: list) -> str:
    if market['kind'] == 'TOUCH_ABOVE':
        return 'YES' if any(c[2] >= market['target_e8'] for c in series_a) else 'NO'
    if market['kind'] == 'TOUCH_BELOW':
        return 'YES' if any(c[3] <= market['target_e8'] for c in series_a) else 'NO'
    if market['kind'] == 'OUTPERFORM':
        # Relative return: ((A_end-A_start)/A_start) > ((B_end-B_start)/B_start).
        # Cross-multiplication uses only positive integers, no floating precision.
        a_start, a_end = series_a[0][1], series_a[-1][4]
        b_start, b_end = series_b[0][1], series_b[-1][4]
        lhs = (a_end - a_start) * b_start
        rhs = (b_end - b_start) * a_start
        if lhs == rhs:
            return 'VOID'  # a tie returns stakes to all participants
        return 'YES' if lhs > rhs else 'NO'
    raise ValueError('Unsupported market kind')


class IFCastCryptoV02(gl.Contract):
    market_count: u256
    markets: TreeMap[str, str]
    positions: TreeMap[str, str]
    balances: TreeMap[str, u256]
    has_grant: TreeMap[str, bool]

    def __init__(self):
        self.market_count = u256(0)

    @gl.public.write
    def claim_demo_credits(self) -> int:
        caller = gl.message.sender_address.as_hex.lower()
        if self.has_grant.get(caller, False):
            raise gl.vm.UserError('Demo credits already claimed')
        self.has_grant[caller] = True
        self.balances[caller] = u256(CREDIT_GRANT)
        return CREDIT_GRANT

    @gl.public.write
    def create_market(self, kind: str, token_a: str, token_b: str,
                      target_e8: int, start_at: int, duration_hours: int) -> int:
        now = _now()
        if kind not in ('TOUCH_ABOVE', 'TOUCH_BELOW', 'OUTPERFORM'):
            raise gl.vm.UserError('Unsupported market type')
        if token_a not in TOKENS or duration_hours not in DURATIONS:
            raise gl.vm.UserError('Unsupported asset or duration')
        if kind == 'OUTPERFORM':
            if token_b not in TOKENS or token_b == token_a or type(target_e8) is not int or target_e8 != 0:
                raise gl.vm.UserError('Invalid battle configuration')
        else:
            if token_b != '' or type(target_e8) is not int or not 0 < target_e8 <= MAX_PRICE:
                raise gl.vm.UserError('Invalid price target')
        if (type(start_at) is not int or start_at % CANDLE_SECONDS != 0
                or start_at < now + MIN_LEAD_SECONDS or start_at > now + MAX_START_DELAY):
            raise gl.vm.UserError('Start must be a future UTC hour with at least 15 minutes lead')
        market_id = int(self.market_count) + 1
        end_at = start_at + duration_hours * CANDLE_SECONDS
        record = {
            'id': market_id, 'creator': gl.message.sender_address.as_hex.lower(),
            'kind': kind, 'token_a': token_a, 'token_b': token_b,
            'target_e8': target_e8, 'start_at': start_at, 'end_at': end_at,
            'duration_hours': duration_hours, 'close_at': start_at,
            'resolve_after': end_at + RESOLUTION_LAG_SECONDS,
            'source': 'BINANCE_SPOT_USDT_1H_V1',
            'status': 'OPEN', 'outcome': '', 'reason': '', 'evidence_digest': '',
            'yes_pool': 0, 'no_pool': 0, 'attempts': 0, 'last_attempt_at': 0,
        }
        self.markets[str(market_id)] = json.dumps(record, sort_keys=True)
        self.market_count = u256(market_id)
        return market_id

    @gl.public.write
    def place_position(self, market_id: int, side: str, amount: int) -> None:
        market = self._market(market_id)
        if market['status'] != 'OPEN' or _now() >= market['close_at']:
            raise gl.vm.UserError('Market is not accepting predictions')
        if side not in ('YES', 'NO') or type(amount) is not int or not 1 <= amount <= MAX_STAKE:
            raise gl.vm.UserError('Invalid position')
        caller = gl.message.sender_address.as_hex.lower()
        bal = int(self.balances.get(caller, u256(0)))
        if bal < amount:
            raise gl.vm.UserError('Insufficient credits')
        key = f'{market_id}:{caller}'
        position = json.loads(self.positions.get(key, '{}'))
        if position and position['side'] != side:
            raise gl.vm.UserError('Cannot hold both sides')
        position = {'side': side, 'amount': position.get('amount', 0) + amount, 'claimed': False}
        self.positions[key] = json.dumps(position, sort_keys=True)
        market['yes_pool' if side == 'YES' else 'no_pool'] += amount
        self.balances[caller] = u256(bal - amount)
        self._save(market)

    def _read_candles(self, token: str, market: dict) -> list:
        url = _kline_url(token, market['start_at'], market['duration_hours'])
        response = gl.nondet.web.get(url)
        body = response.body
        if isinstance(body, bytes):
            body = body.decode('utf-8')
        # Keep all rows; never truncate a returned interval and call it complete.
        if not isinstance(body, str) or len(body) > 500_000:
            raise ValueError('Bad or oversized price response')
        return _candles(json.loads(body), market['start_at'], market['duration_hours'])

    def _assess(self, market: dict) -> dict:
        try:
            a = self._read_candles(market['token_a'], market)
            b = self._read_candles(market['token_b'], market) if market['kind'] == 'OUTPERFORM' else []
            normalized = json.dumps([a, b], separators=(',', ':'))
            digest = hashlib.sha256(normalized.encode('utf-8')).hexdigest()
            outcome = _evaluate(market, a, b)
            return {'outcome': outcome, 'digest': digest,
                    'reason': f'{market["source"]}: {len(a)} complete candles per asset; SHA256 {digest[:16]}.'}
        except (ValueError, KeyError, TypeError, UnicodeError, AttributeError):
            return {'outcome': 'UNKNOWN', 'digest': '',
                    'reason': 'Price feed unavailable or incomplete. No negative inference.'}

    @gl.public.write
    def resolve_market(self, market_id: int) -> str:
        market = self._market(market_id)
        now = _now()
        if market['status'] != 'OPEN':
            raise gl.vm.UserError('Market already settled')
        if now < market['resolve_after']:
            raise gl.vm.UserError('Resolution window has not opened')
        if market['attempts'] and now < market['last_attempt_at'] + COOLDOWN_SECONDS:
            raise gl.vm.UserError('Wait before retry')
        policy = dict(market)

        def leader():
            return self._assess(policy)

        def validator(proposed) -> bool:
            if not isinstance(proposed, gl.vm.Return):
                return False
            try:
                independent = self._assess(policy)
                p = proposed.calldata
                return (isinstance(p, dict) and p.get('outcome') in ('YES', 'NO', 'VOID', 'UNKNOWN')
                        and p.get('outcome') == independent['outcome']
                        and p.get('digest') == independent['digest'])
            except Exception:
                return False

        decision = gl.vm.run_nondet_unsafe(leader, validator)
        if (not isinstance(decision, dict) or decision.get('outcome') not in ('YES', 'NO', 'VOID', 'UNKNOWN')
                or not isinstance(decision.get('digest'), str)
                or not isinstance(decision.get('reason'), str)):
            raise gl.vm.UserError('Invalid oracle decision')
        market['attempts'] += 1
        market['last_attempt_at'] = now
        market['reason'] = decision['reason']
        market['evidence_digest'] = decision['digest']
        outcome = decision['outcome']
        if outcome == 'UNKNOWN':
            # Unknown data cannot be treated as a losing position.
            self._save(market)
            return 'OPEN'
        market['outcome'] = outcome
        winning_pool = market['yes_pool' if outcome == 'YES' else 'no_pool'] if outcome != 'VOID' else 0
        if outcome == 'VOID' or winning_pool == 0:
            market['status'] = 'VOID'
            if winning_pool == 0 and outcome != 'VOID':
                market['reason'] += ' No winners; refund instead.'
        else:
            market['status'] = 'RESOLVED'
        self._save(market)
        return market['status']

    @gl.public.write
    def claim(self, market_id: int) -> int:
        market = self._market(market_id)
        if market['status'] not in ('RESOLVED', 'VOID'):
            raise gl.vm.UserError('Market not settled')
        caller = gl.message.sender_address.as_hex.lower()
        key = f'{market_id}:{caller}'
        pos = json.loads(self.positions.get(key, '{}'))
        if not pos or pos.get('claimed'):
            raise gl.vm.UserError('No unclaimed position')
        payout = 0
        if market['status'] == 'VOID':
            payout = pos['amount']
        elif pos['side'] == market['outcome']:
            win = market['yes_pool' if pos['side'] == 'YES' else 'no_pool']
            lose = market['no_pool' if pos['side'] == 'YES' else 'yes_pool']
            payout = pos['amount'] + pos['amount'] * lose // win
        pos['claimed'] = True
        self.positions[key] = json.dumps(pos, sort_keys=True)
        self.balances[caller] = u256(int(self.balances.get(caller, u256(0))) + payout)
        return payout

    def _market(self, market_id: int) -> dict:
        raw = self.markets.get(str(market_id), '')
        if not raw:
            raise gl.vm.UserError('Unknown market')
        return json.loads(raw)

    def _save(self, market: dict) -> None:
        self.markets[str(market['id'])] = json.dumps(market, sort_keys=True)

    @gl.public.view
    def get_market(self, market_id: int) -> dict:
        return self._market(market_id)

    @gl.public.view
    def get_markets(self, offset: int = 0, limit: int = 12) -> list:
        if type(offset) is not int or type(limit) is not int or offset < 0 or limit < 1 or limit > MAX_MARKETS_PER_PAGE:
            raise gl.vm.UserError('Invalid page')
        count = int(self.market_count)
        return [self._market(i) for i in range(offset + 1, min(count, offset + limit) + 1)]

    @gl.public.view
    def get_market_count(self) -> int:
        return int(self.market_count)

    @gl.public.view
    def get_balance(self, wallet: str) -> int:
        return int(self.balances.get(wallet.lower(), u256(0)))

    @gl.public.view
    def has_claimed_grant(self, wallet: str) -> bool:
        return bool(self.has_grant.get(wallet.lower(), False))

    @gl.public.view
    def get_position(self, market_id: int, wallet: str) -> dict:
        return json.loads(self.positions.get(f'{market_id}:{wallet.lower()}', '{}'))
