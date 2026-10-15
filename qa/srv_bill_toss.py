"""가짜 결제사(토스 모양) — 정기결제 · 환불 · 중복 요청 시험용. 장애를 넣을 수 있습니다.

  python3 srv_bill_toss.py [포트=3139]

결제사 API (토스페이먼츠와 같은 경로 · 응답 모양)
  POST /v1/payments/confirm                  { paymentKey, orderId, amount }
  POST /v1/billing/{billingKey}              { customerKey, orderId, amount, orderName }     (Idempotency-Key 를 받으면 같은 키는 한 번만 처리)
  GET  /v1/payments/{paymentKey}
  GET  /v1/payments/orders/{orderId}
  POST /v1/payments/{paymentKey}/cancel      { cancelReason, cancelAmount? }                 (Idempotency-Key)

시험 조종 (결제사에는 없는 것)
  POST /__ctl  { "plan": { "<열쇠>": ["decline", "approve", …] } }   열쇠 = billingKey · paymentKey(confirm) · "cancel:<paymentKey>"
                                                                     · "lookup:<paymentKey|orderId>" · "lookup~<주문번호 앞부분>"(조회)
               { "reset": true }
  GET  /__ctl                                                        지금까지의 기록(요청 · 처리한 결제 · 취소)

  행동(한 번 부를 때마다 앞에서 하나씩 꺼냄 · 다 쓰면 approve/ok)
    approve · ok        정상 처리
    decline             400 REJECT_CARD_COMPANY (처리 안 함 — 확정 거절)
    decline_expired     400 INVALID_CARD_EXPIRATION 「카드 정보를 다시 확인해주세요. (유효기간)」 (처리 안 함 — 카드를 바꿔야 함)
    unauth              401 UNAUTHORIZED_KEY (처리 안 함 — 우리 쪽 열쇠 설정 오류. 회원의 결제 실패가 아님)
    http500             500 (처리 안 함)
    drop_before         처리하지 않고 연결을 끊음         — 요청이 결제사에 닿지 못한 경우
    drop_after          **처리하고** 연결을 끊음          — 승인(취소)은 됐는데 응답이 유실된 경우
    hold:N              **처리하고** N초 뒤에 응답        — 승인 직후 서버가 죽는 경우 · 응답 지연
    mismatch            승인하되 금액을 100원 적게         (금액 불일치)
"""
import base64, json, socket, sys, threading, time, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 3139
SECRET = 'test_sk_bill'
LOCK = threading.Lock()


def fresh():
    return {'pay': {}, 'log': [], 'plan': {}, 'idem': {}, 'events': []}


S = fresh()


def nxt(key, default):
    with LOCK:
        q = S['plan'].get(key)
        return q.pop(0) if q else default


class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *a): pass

    def _send(self, st, body):
        raw = json.dumps(body, ensure_ascii=False).encode()
        try:
            self.send_response(st); self.send_header('content-type', 'application/json'); self.send_header('content-length', str(len(raw)))
            self.send_header('connection', 'close'); self.end_headers(); self.wfile.write(raw)
        except Exception:
            pass
        self.close_connection = True

    def _drop(self):
        try: self.connection.shutdown(socket.SHUT_RDWR)
        except Exception: pass
        try: self.connection.close()
        except Exception: pass
        self.close_connection = True

    def _auth_ok(self):
        return self.headers.get('Authorization') == 'Basic ' + base64.b64encode(f'{SECRET}:'.encode()).decode()

    def _payment(self, p):
        return {'paymentKey': p['key'], 'orderId': p['orderId'], 'status': p['status'], 'totalAmount': p['amount'],
                'balanceAmount': p['amount'] - p.get('canceled', 0), 'method': '카드', 'approvedAt': p['at'],
                'lastTransactionKey': 'tx_' + p['key'][-6:], 'cancels': p.get('cancels', [])}

    def _ev(self, kind, **kw):
        with LOCK: S['events'].append({'kind': kind, 't': time.time(), **kw})

    # ── 조회 ───────────────────────────────────────────────────────────
    def do_GET(self):
        if self.path.startswith('/__ctl'):
            with LOCK: out = json.loads(json.dumps({k: S[k] for k in ('pay', 'log', 'plan', 'events')}))
            return self._send(200, out)
        with LOCK: S['log'].append({'m': 'GET', 'path': self.path})
        if not self._auth_ok(): return self._send(401, {'code': 'UNAUTHORIZED_KEY', 'message': '인증되지 않은 시크릿 키'})
        parts = self.path.split('/')
        act = nxt('lookup:' + parts[-1], None)
        if act is None:                                               # 'lookup~<앞부분>' — 그 글자로 시작하는 조회 전부
            with LOCK: pre = next((k for k, v in S['plan'].items() if k.startswith('lookup~') and v and parts[-1].startswith(k[7:])), None)
            act = nxt(pre, 'ok') if pre else 'ok'
        if act == 'http500': return self._send(500, {'code': 'FAILED_INTERNAL_SYSTEM_PROCESSING', 'message': '내부 오류'})
        if act == 'drop_before': return self._drop()
        with LOCK:
            if self.path.startswith('/v1/payments/orders/'):
                p = next((x for x in S['pay'].values() if x['orderId'] == parts[-1]), None)
            else:
                p = S['pay'].get(parts[-1])
            out = self._payment(p) if p else None
        if not out: return self._send(404, {'code': 'NOT_FOUND_PAYMENT', 'message': '존재하지 않는 결제 정보 입니다.'})
        self._send(200, out)

    # ── 승인 · 청구 · 취소 ──────────────────────────────────────────────
    def do_POST(self):
        n = int(self.headers.get('content-length') or 0)
        body = json.loads(self.rfile.read(n) or b'{}')
        if self.path == '/__ctl':
            global S
            with LOCK:
                if body.get('reset'): S = fresh()
                for k, v in (body.get('plan') or {}).items(): S['plan'][k] = list(v)
            return self._send(200, {'ok': True})
        idem = self.headers.get('Idempotency-Key')
        with LOCK: S['log'].append({'m': 'POST', 'path': self.path, 'body': body, 'idem': idem, 't': time.time()})
        if not self._auth_ok(): return self._send(401, {'code': 'UNAUTHORIZED_KEY', 'message': '인증되지 않은 시크릿 키'})

        if self.path == '/v1/payments/confirm': return self._approve(body['paymentKey'], body['paymentKey'], body, idem, 'confirm')
        if self.path.startswith('/v1/billing/'):
            bk = self.path.split('/')[-1]
            return self._approve(bk, None, body, idem, 'billing')
        if self.path.endswith('/cancel'): return self._cancel(self.path.split('/')[-2], body, idem)
        self._send(404, {'code': 'NOT_FOUND', 'message': self.path})

    def _approve(self, plan_key, payment_key, body, idem, kind):
        if idem:
            with LOCK: seen = S['idem'].get(idem)
            if seen: return self._send(seen[0], seen[1])            # 같은 멱등 키 — 다시 처리하지 않고 같은 답
        act = nxt(plan_key, 'approve')
        if act == 'decline': return self._send(403, {'code': 'REJECT_CARD_COMPANY', 'message': '결제 승인이 거절되었습니다. 한도 초과'})
        if act == 'decline_expired': return self._send(400, {'code': 'INVALID_CARD_EXPIRATION', 'message': '카드 정보를 다시 확인해주세요. (유효기간)'})      # 토스 문서의 문구 그대로
        if act == 'unauth': return self._send(401, {'code': 'UNAUTHORIZED_KEY', 'message': '인증되지 않은 시크릿 키 혹은 클라이언트 키 입니다.'})
        if act == 'http500': return self._send(500, {'code': 'FAILED_INTERNAL_SYSTEM_PROCESSING', 'message': '내부 오류'})
        if act == 'drop_before':
            self._ev(kind + ':dropped_before', orderId=body.get('orderId')); return self._drop()
        with LOCK:
            if payment_key and payment_key in S['pay']:
                res = (400, {'code': 'ALREADY_PROCESSED_PAYMENT', 'message': '이미 처리된 결제 입니다.'})
            elif any(x['orderId'] == body['orderId'] for x in S['pay'].values()):
                res = (400, {'code': 'DUPLICATED_ORDER_ID', 'message': '이미 승인 및 취소가 진행된 중복된 주문번호 입니다.'})
            else:
                key = payment_key or ('pk_' + uuid.uuid4().hex[:20])
                amt = int(body['amount']) - (100 if act == 'mismatch' else 0)
                p = {'key': key, 'orderId': body['orderId'], 'amount': amt, 'status': 'DONE', 'kind': kind, 'planKey': plan_key,
                     'at': time.strftime('%Y-%m-%dT%H:%M:%S+09:00')}
                S['pay'][key] = p
                res = (200, self._payment(p))
            if idem: S['idem'][idem] = res
        if res[0] == 200: self._ev(kind + ':approved', orderId=body['orderId'], paymentKey=res[1]['paymentKey'])
        if act == 'drop_after': return self._drop()
        if act.startswith('hold:'): time.sleep(float(act.split(':')[1]))
        self._send(*res)

    def _cancel(self, key, body, idem):
        if idem:
            with LOCK: seen = S['idem'].get(idem)
            if seen: return self._send(seen[0], seen[1])
        act = nxt('cancel:' + key, 'ok')
        if act == 'decline': return self._send(403, {'code': 'NOT_CANCELABLE_PAYMENT', 'message': '취소 할 수 없는 결제 입니다.'})
        if act == 'http500': return self._send(500, {'code': 'FAILED_INTERNAL_SYSTEM_PROCESSING', 'message': '내부 오류'})
        if act == 'drop_before':
            self._ev('cancel:dropped_before', paymentKey=key); return self._drop()
        with LOCK:
            p = S['pay'].get(key)
            if not p: res = (404, {'code': 'NOT_FOUND_PAYMENT', 'message': '존재하지 않는 결제 정보 입니다.'})
            elif p['status'] == 'CANCELED': res = (400, {'code': 'ALREADY_CANCELED_PAYMENT', 'message': '이미 취소된 결제 입니다.'})
            else:
                ca = int(body.get('cancelAmount', p['amount'] - p.get('canceled', 0)))
                p['canceled'] = p.get('canceled', 0) + ca
                p['status'] = 'CANCELED' if p['canceled'] >= p['amount'] else 'PARTIAL_CANCELED'
                p.setdefault('cancels', []).append({'cancelAmount': ca, 'cancelReason': body.get('cancelReason'),
                                                    'canceledAt': time.strftime('%Y-%m-%dT%H:%M:%S+09:00'),
                                                    'transactionKey': 'ctx_' + uuid.uuid4().hex[:8], 'cancelStatus': 'DONE'})
                res = (200, self._payment(p))
            if idem: S['idem'][idem] = res
        if res[0] == 200: self._ev('cancel:done', paymentKey=key)
        if act == 'drop_after': return self._drop()
        if act.startswith('hold:'): time.sleep(float(act.split(':')[1]))
        self._send(*res)


if __name__ == '__main__':
    srv = ThreadingHTTPServer(('127.0.0.1', PORT), H)
    srv.daemon_threads = True
    print(f'fake toss on {PORT}', flush=True)
    srv.serve_forever()
