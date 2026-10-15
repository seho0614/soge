"""정기결제 · 구독 환불 · 중복 요청 · 해지 — 「결제사의 실제 결과와 DB 가 같고, 다시 시도해도 한 번만 반영」 (v10.18 · D022)

실제 PostgreSQL(개발 DB) + 운영 방식 API(dist/main.js) 2대 + 가짜 결제사(srv_bill_toss.py — 실제 HTTP · 장애 주입)로 봅니다.
이 스크립트가 API 2대(3131 · 3132)와 가짜 결제사(3139)를 직접 띄우고 끕니다(승인 직후 서버를 죽이는 시험이 있어서).

  python3 srv_billing.py            전부
  python3 srv_billing.py 1 3        1 · 3 절만 (1 정기결제 · 2 환불 · 3 중복 요청 · 4 해지 · 5 스텁 방식 · 6 다시 결제 · 7 운영 알림)

결과: srv_billing.json
"""
import base64, json, os, signal, subprocess, sys, threading, time, uuid, urllib.request

_kit = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sgb')      # 킷 안에서 돌리면 옆의 sgb/
KIT = os.environ.get('KIT') or (_kit if os.path.isdir(os.path.join(_kit, 'src')) else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
DB = os.environ.get('DATABASE_URL', 'postgresql://sgb:sgb@localhost:5432/sgb')
P1, P2, PT = int(os.environ.get('P1', 3131)), int(os.environ.get('P2', 3132)), int(os.environ.get('PT', 3139))
A1, A2, TOSS = f'http://localhost:{P1}/api/v1', f'http://localhost:{P2}/api/v1', f'http://localhost:{PT}'
STUB = os.environ.get('API', 'http://localhost:3000/api/v1')          # 열쇠 없는(스텁) 방식 — 평소의 개발 API
PRICE = 49000
SEL = set(sys.argv[1:]) or {'1', '2', '3', '4', '5', '6', '7'}
HERE = os.path.dirname(os.path.abspath(__file__))
R = []


def q(s, whole=False):
    r = subprocess.run(['psql', DB, '-v', 'ON_ERROR_STOP=1', '-tAc', s], capture_output=True, text=True)
    if r.returncode: raise RuntimeError(r.stderr.strip()[:300] + ' :: ' + s[:120])
    return r.stdout.strip() if whole else r.stdout.strip().split('\n')[0]


def qj(s):
    v = q(f'select coalesce(json_agg(t), \'[]\'::json) from ({s}) t', whole=True)     # json_agg 는 줄을 나눠 냅니다
    return json.loads(v or '[]')


def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:400]})
    print('ok  ' if ok else 'FAIL', step, '' if ok else str(detail)[:300], file=sys.stderr)


def call(m, p, tok=None, body=None, base=A1, idem=None, timeout=60):
    h = {'content-type': 'application/json', 'Idempotency-Key': idem or uuid.uuid4().hex}
    if tok: h['authorization'] = 'Bearer ' + tok
    data = json.dumps(body).encode() if body is not None else (b'{}' if m in ('POST', 'PATCH') else None)
    req = urllib.request.Request(base + p, method=m, data=data, headers=h)
    try:
        r = urllib.request.urlopen(req, timeout=timeout); st = r.status; raw = r.read()
    except urllib.error.HTTPError as e:
        st = e.code; raw = e.read()
    except Exception as e:
        return 0, {'error': str(e)[:120]}
    try: js = json.loads(raw) if raw else None
    except Exception: js = None
    return st, js


# ── 가짜 결제사 · API 띄우기/끄기 ─────────────────────────────────────────
PROCS = {}
ENV = dict(os.environ, DATABASE_URL=DB, JWT_SECRET='docker-test-secret-0123456789abcdef', JOB_TOKEN='docker-test-job-token-0123456789abcdef',
           ENC_KEY='docker-dev-enc-key-0123456789abcdef', NODE_ENV='development', TOSS_SECRET_KEY='test_sk_bill', TOSS_API_BASE=TOSS)


def up(url, n=60):
    for _ in range(n * 2):
        try:
            urllib.request.urlopen(url, timeout=2); return True
        except urllib.error.HTTPError: return True
        except Exception: time.sleep(0.5)
    return False


def start_api(port):
    log = open(f'/tmp/bill_api_{port}.log', 'ab')
    PROCS[port] = subprocess.Popen(['node', 'dist/main.js'], cwd=KIT, env=dict(ENV, PORT=str(port)), stdout=log, stderr=log, start_new_session=True)
    assert up(f'http://localhost:{port}/api/v1/health'), f'API {port} 가 뜨지 않았습니다 — /tmp/bill_api_{port}.log'


def kill_api(port):
    p = PROCS.pop(port, None)
    if p:
        try: os.killpg(p.pid, signal.SIGKILL)
        except ProcessLookupError: pass
        p.wait()


def start_all():
    PROCS['toss'] = subprocess.Popen([sys.executable, os.path.join(HERE, 'srv_bill_toss.py'), str(PT)],
                                     stdout=open('/tmp/bill_toss.log', 'ab'), stderr=subprocess.STDOUT, start_new_session=True)
    assert up(TOSS + '/__ctl'), '가짜 결제사가 뜨지 않았습니다'
    start_api(P1); start_api(P2)


def stop_all():
    for k in list(PROCS):
        p = PROCS.pop(k)
        try: os.killpg(p.pid, signal.SIGKILL)
        except ProcessLookupError: pass


def ctl(**body):
    req = urllib.request.Request(TOSS + '/__ctl', method='POST', data=json.dumps(body).encode(), headers={'content-type': 'application/json'})
    return json.load(urllib.request.urlopen(req, timeout=5))


def toss(): return json.load(urllib.request.urlopen(TOSS + '/__ctl', timeout=5))


def ev(kind, **kw): return [e for e in toss()['events'] if e['kind'] == kind and all(e.get(k) == v for k, v in kw.items())]


def reqs(path_part, method='POST'): return [x for x in toss()['log'] if x['m'] == method and path_part in x['path']]


def wait_ev(kind, n=1, sec=20, **kw):
    for _ in range(int(sec * 10)):
        if len(ev(kind, **kw)) >= n: return True
        time.sleep(0.1)
    return False


# ── 시험 자료 ─────────────────────────────────────────────────────────────
def login(e, pw='sgb-dev-1234', base=A1):
    st, j = call('POST', '/auth/login', body={'email': e, 'password': pw}, base=base)
    assert st < 300, (st, j)
    return j['accessToken']


def new_biz(prefix, base=A1):
    """사업자 회원 하나 — 가입(API) → 사업자 역할(SQL) → 다시 로그인"""
    e = f'{prefix}_{uuid.uuid4().hex[:8]}@t.local'
    st, j = call('POST', '/auth/signup', body={'email': e, 'password': 'sgb-test-1234', 'name': '청구시험'}, base=base)
    assert st < 300, (st, j)
    aid = q(f"select id from accounts where email='{e}'")
    q(f"insert into account_roles(account_id, role) values ('{aid}','BIZ_OWNER') on conflict do nothing")
    return e, login(e, 'sgb-test-1234', base), aid


def subscribe(tok, pkey=None, idem=None, base=A1, plan='STANDARD', order=None):
    pkey = pkey or ('tpk_' + uuid.uuid4().hex[:18]); order = order or ('ord_' + uuid.uuid4().hex[:18])
    st, j = call('POST', '/subscriptions', tok, {'planCode': plan, 'paymentKey': pkey, 'orderId': order}, base=base, idem=idem)
    return st, j, pkey, order


def paid_sub(prefix, base=A1):
    """오늘 결제한 유료 구독 하나(첫 결제는 결제창 승인 — 가짜 결제사가 승인)"""
    e, tok, aid = new_biz(prefix, base)
    st, j, pkey, order = subscribe(tok, base=base)
    assert st < 300, (st, j)
    return {'email': e, 'tok': tok, 'aid': aid, 'sub': j['subscriptionId'], 'pkey': pkey, 'order': order}


def make_due(u, bk=None, force=False):
    """기간이 방금 끝난 구독으로 — 정기결제 대상. 결제 수단(빌링키)도 답니다.
    force: 환불 처리 중인 구독은 DB 가 기간 변경을 막습니다 — 그 규칙을 (시험에서만) 잠시 끄고 옮깁니다"""
    u['bk'] = bk or ('bk_' + uuid.uuid4().hex[:16])
    if force: q("alter table subscriptions disable trigger user")
    try:
        q(f"""update subscriptions set current_period_start = now() - interval '30 days 1 minute', current_period_end = now() - interval '1 minute'
               where id = '{u['sub']}'""")
    finally:
        if force: q("alter table subscriptions enable trigger user")
    q(f"insert into billing_keys(account_id, billing_key, card_company, card_last4) values ('{u['aid']}','{u['bk']}','시험카드','1234')")
    u['due'] = q(f"select current_period_end from subscriptions where id='{u['sub']}'")
    return u


def invs(u, due_only=True):
    w = f" and period_start = '{u['due']}'" if due_only and u.get('due') else ''
    return qj(f"select * from subscription_invoices where subscription_id = '{u['sub']}'{w} order by issued_at")


def sub(u): return qj(f"select * from subscriptions where id = '{u['sub']}'")[0]


def same_end(u):
    """구독의 기간 끝이 청구 전 그대로인가(연장되지 않았는가)"""
    return q(f"select (current_period_end = '{u['due']}')::int from subscriptions where id='{u['sub']}'") == '1'


def lk(u): return 'lookup~sub_' + u['sub']          # 이 구독의 정기결제 주문 조회(가짜 결제사 조종 열쇠)


def notes(u, tpl): return int(q(f"select count(*) from notifications where account_id='{u['aid']}' and template_code='{tpl}'"))


def refunds(u): return qj(f"select * from subscription_refunds where subscription_id = '{u['sub']}' order by requested_at")


def charges(u): return ev('billing:approved') and [e for e in ev('billing:approved') if e['orderId'].startswith(f"sub_{u['sub']}")] or []


def bill_reqs(u): return [x for x in reqs('/v1/billing/' + u['bk'])]


ADM = {}


def run_batch(base=A1):
    if base not in ADM: ADM[base] = login('admin@x.com', base=base)
    return call('POST', '/admin/billing/charge-due', ADM[base], base=base, timeout=90)


def cleanup(users):
    """시험 구독이 다른 시험의 청구 대상으로 남지 않게 닫습니다"""
    ids = ','.join(f"'{u['sub']}'" for u in users if u.get('sub'))
    if ids: q(f"update subscriptions set cancel_at = coalesce(cancel_at, now()) where id in ({ids}) and status in ('ACTIVE','PAST_DUE')")


USERS = []


# ══ 1. 정기결제 — 재시도 성공 · 응답 유실 · 승인 직후 서버 종료 ════════════════
def sec1():
    # 1-A 첫 청구 실패 → 재시도 성공: 청구서 1건 · PAID · 기간 한 번만 연장
    u = make_due(paid_sub('bl1a')); USERS.append(u)
    old_end = u['due']
    ctl(plan={u['bk']: ['decline', 'approve']})
    st, r1 = run_batch()
    i1 = invs(u)
    rec('1-1 첫 청구 거절 → 청구서 1건 FAILED · 구독 PAST_DUE', st < 300 and len(i1) == 1 and i1[0]['status'] == 'FAILED' and sub(u)['status'] == 'PAST_DUE', (st, [x['status'] for x in i1], sub(u)['status']))
    st, r2 = run_batch()
    i2 = invs(u); s2 = sub(u)
    rec('1-2 재시도 승인 → 같은 기간 청구서는 여전히 1건 · PAID (새 줄을 만들지 않음)', st < 300 and len(i2) == 1 and i2[0]['status'] == 'PAID' and i2[0]['id'] == i1[0]['id'],
        (st, [(x['status'], x['attempt']) for x in i2], str(r2)[:160]))
    ext = q(f"select (current_period_start = '{old_end}' and current_period_end = '{old_end}'::timestamptz + interval '30 days')::int from subscriptions where id='{u['sub']}'")
    rec('1-3 구독 기간이 정확히 한 번 연장 · ACTIVE 로 회복', ext == '1' and s2['status'] == 'ACTIVE', (s2['current_period_start'], s2['current_period_end'], s2['status']))
    ch = charges(u)
    rec('1-4 결제사가 준 paymentKey 와 우리 주문번호를 따로 저장', len(ch) == 1 and i2[0].get('payment_key') == ch[0]['paymentKey'] and i2[0].get('order_id') == ch[0]['orderId'],
        (i2[0].get('payment_key'), i2[0].get('order_id'), ch[:1]))
    br = bill_reqs(u)
    rec('1-5 시도마다 주문번호가 다름(거절된 주문번호를 다시 쓰지 않음) · 결제사 멱등 키를 보냄', len(br) == 2 and br[0]['body']['orderId'] != br[1]['body']['orderId'] and all(x.get('idem') for x in br),
        [(x['body']['orderId'], x.get('idem')) for x in br])
    rec('1-6 시도 횟수 2', i2[0]['attempt'] == 2, i2[0]['attempt'])
    n0 = len(bill_reqs(u)); st, r3 = run_batch()
    rec('1-7 이미 PAID — 배치를 다시 돌려도 청구 요청 0 · 기간 그대로', len(bill_reqs(u)) == n0 and sub(u)['current_period_end'] == s2['current_period_end'], (len(bill_reqs(u)), n0))

    # 1-B 승인됐는데 응답 유실 → 불명확(PENDING)으로 두고 새 결제를 보내지 않음 → 주문번호로 조회해 복구
    u = make_due(paid_sub('bl1b')); USERS.append(u)
    ctl(plan={u['bk']: ['drop_after'], lk(u): ['http500']})
    st, r = run_batch(); i = invs(u)
    rec('1-8 승인 뒤 응답 유실 · 조회도 실패 → 청구서 PENDING(실패로 적지 않음) · 구독 기간 그대로', len(i) == 1 and i[0]['status'] == 'PENDING' and same_end(u),
        ([x['status'] for x in i], sub(u)['status']))
    q(f"update subscription_invoices set claimed_at = now() - interval '10 minutes' where id = '{i[0]['id']}'")
    st, r = run_batch(); i = invs(u)
    rec('1-9 다음 배치: 새 청구 요청 0 · 주문번호 조회로 PAID 복구 · 기간 한 번 연장',
        len(bill_reqs(u)) == 1 and len(charges(u)) == 1 and i[0]['status'] == 'PAID' and i[0].get('payment_key') == charges(u)[0]['paymentKey']
        and q(f"select (current_period_start = '{u['due']}')::int from subscriptions where id='{u['sub']}'") == '1',
        (len(bill_reqs(u)), [x['status'] for x in i], len(reqs('/v1/payments/orders/', 'GET'))))

    u = make_due(paid_sub('bl1b2')); USERS.append(u)
    ctl(plan={u['bk']: ['drop_after']})
    run_batch(); i = invs(u)
    rec('1-9b 승인 뒤 응답 유실 · 조회는 됨 → 곧바로 주문번호로 조회해 PAID(다음 배치를 기다리지 않음) · 청구 요청 1건 · 기간 한 번 연장',
        len(i) == 1 and i[0]['status'] == 'PAID' and len(bill_reqs(u)) == 1 and len(charges(u)) == 1 and i[0].get('payment_key') == charges(u)[0]['paymentKey']
        and q(f"select (current_period_start = '{u['due']}')::int from subscriptions where id='{u['sub']}'") == '1', ([x['status'] for x in i], len(bill_reqs(u))))

    # 1-C 요청이 결제사에 닿지 못함 → PENDING → 충분히 지난 뒤 조회해도 없으면 실패로 닫고 새 주문번호로 다시
    u = make_due(paid_sub('bl1c')); USERS.append(u)
    ctl(plan={u['bk']: ['drop_before', 'approve']})
    run_batch(); i = invs(u)
    rec('1-10 연결 끊김(결제사 미도달) → 청구서 PENDING', len(i) == 1 and i[0]['status'] == 'PENDING', [x['status'] for x in i])
    run_batch(); i = invs(u)
    rec('1-11 방금 건은 섣불리 다시 청구하지 않음(요청 1건 그대로)', len(bill_reqs(u)) == 1 and i[0]['status'] == 'PENDING', (len(bill_reqs(u)), i[0]['status']))
    q(f"update subscription_invoices set claimed_at = now() - interval '2 hours' where id = '{i[0]['id']}'")
    run_batch(); i = invs(u)
    if i[0]['status'] == 'FAILED': run_batch(); i = invs(u)       # 닫은 다음 배치에서 다시 청구
    br = bill_reqs(u)
    rec('1-12 결제사에 그 주문이 없음을 확인 → 실패로 닫고 **새 주문번호**로 청구 → PAID · 승인 1건',
        i[0]['status'] == 'PAID' and len(charges(u)) == 1 and len(br) == 2 and br[0]['body']['orderId'] != br[1]['body']['orderId'], ([x['status'] for x in i], len(br)))

    # 1-D 승인 직후 서버 종료 — 결제사는 승인했고 우리 서버는 그 답을 받기 전에 죽음
    u = make_due(paid_sub('bl1d')); USERS.append(u)
    ctl(plan={u['bk']: ['hold:8']})
    t = threading.Thread(target=run_batch, daemon=True); t.start()
    for _ in range(200):                                      # 결제사가 승인한 순간(응답은 8초 뒤)
        if charges(u): break
        time.sleep(0.1)
    kill_api(P1)
    i = invs(u)
    rec('1-13 (승인 직후 서버 종료) 결제사 승인 1건 · 우리 DB 는 PENDING · 기간 그대로', len(charges(u)) == 1 and len(i) == 1 and i[0]['status'] == 'PENDING' and same_end(u),
        (len(charges(u)), [x['status'] for x in i]))
    start_api(P1); ADM.pop(A1, None)
    q(f"update subscription_invoices set claimed_at = now() - interval '10 minutes' where id = '{i[0]['id']}'")
    run_batch(); i = invs(u)
    rec('1-14 서버를 다시 띄운 뒤 배치: 새 청구 0 · 조회로 PAID · 기간 한 번 연장',
        len(bill_reqs(u)) == 1 and i[0]['status'] == 'PAID' and q(f"select (current_period_start = '{u['due']}')::int from subscriptions where id='{u['sub']}'") == '1',
        (len(bill_reqs(u)), [x['status'] for x in i]))

    # 1-E 응답 지연(결제사는 승인 · 우리 쪽 10초 제한 초과)
    u = make_due(paid_sub('bl1e')); USERS.append(u)
    ctl(plan={u['bk']: ['hold:12'], lk(u): ['http500']})
    run_batch(); i = invs(u)
    rec('1-15 응답 지연(10초 제한 초과) · 조회 실패 → PENDING(실패 아님)', len(i) == 1 and i[0]['status'] == 'PENDING', [x['status'] for x in i])
    time.sleep(3)                                             # 결제사가 지연 응답을 끝낼 때까지
    q(f"update subscription_invoices set claimed_at = now() - interval '10 minutes' where id = '{i[0]['id']}'")
    run_batch(); i = invs(u)
    rec('1-16 → 조회로 PAID · 청구 요청 1건뿐', i[0]['status'] == 'PAID' and len(bill_reqs(u)) == 1, (i[0]['status'], len(bill_reqs(u))))

    # 1-F 조회가 안 될 때(결제사 장애)는 아무것도 확정하지 않음
    u = make_due(paid_sub('bl1f')); USERS.append(u)
    ctl(plan={u['bk']: ['drop_after'], lk(u): ['http500', 'http500']})
    run_batch(); i = invs(u)
    q(f"update subscription_invoices set claimed_at = now() - interval '2 hours' where id = '{i[0]['id']}'")
    run_batch(); i = invs(u)
    rec('1-17 결제 조회 실패(500) → PENDING 유지 · 새 청구 0', i[0]['status'] == 'PENDING' and len(bill_reqs(u)) == 1, (i[0]['status'], len(bill_reqs(u))))
    run_batch(); i = invs(u)
    rec('1-18 조회가 되면 PAID', i[0]['status'] == 'PAID' and len(bill_reqs(u)) == 1, i[0]['status'])

    # 1-G 두 서버가 동시에 배치를 돌려도 구독마다 한 번만 청구
    us = [make_due(paid_sub('bl1g')) for _ in range(6)]; USERS.extend(us)
    for x in us: ctl(plan={x['bk']: ['hold:0.4']})
    ts = [threading.Thread(target=run_batch, args=(b,), daemon=True) for b in (A1, A2, A1, A2)]
    [t.start() for t in ts]; [t.join(120) for t in ts]
    bad = [(x['sub'][:8], len(bill_reqs(x)), len(charges(x)), [y['status'] for y in invs(x)]) for x in us
           if not (len(bill_reqs(x)) == 1 and len(charges(x)) == 1 and [y['status'] for y in invs(x)] == ['PAID'])]
    rec('1-19 서버 2대가 배치를 동시에 4번 → 구독 6건 모두 청구 요청 1 · 승인 1 · 청구서 1건 PAID', not bad, bad)

    # 1-H 금액이 다르게 승인됨 → PAID 로 적지 않고 다시 청구하지도 않음(사람이 봐야 함)
    u = make_due(paid_sub('bl1h')); USERS.append(u)
    ctl(plan={u['bk']: ['mismatch']})
    run_batch(); i = invs(u)
    q(f"update subscription_invoices set claimed_at = now() - interval '2 hours' where id = '{i[0]['id']}'")
    run_batch(); run_batch(); i = invs(u)
    rec('1-20 금액 불일치 승인 → PAID 아님 · 추가 청구 0 · 확인 필요로 남음', i[0]['status'] == 'PENDING' and len(bill_reqs(u)) == 1 and 'MISMATCH' in (i[0].get('pg_status') or ''),
        (i[0]['status'], i[0].get('pg_status'), len(bill_reqs(u))))

    # 1-I 카드 만료(재시도해도 같은 답) — 하루 1회로 줄어드는 기존 규칙이 유지되는지
    u = make_due(paid_sub('bl1i')); USERS.append(u)
    ctl(plan={u['bk']: ['decline_expired', 'approve']})
    run_batch(); run_batch(); i = invs(u)
    rec('1-21 만료 카드(결제사 코드 INVALID_CARD_EXPIRATION · 문구에 「만료」가 없음) → FAILED · 같은 날 다시 청구하지 않음', i[0]['status'] == 'FAILED' and len(bill_reqs(u)) == 1, (i[0]['status'], len(bill_reqs(u))))
    rec('1-21b 「카드 교체 필요」 안내가 나감(코드로 판단)', notes(u, 'SUBSCRIPTION_CARD_UNUSABLE_INAPP') == 1, notes(u, 'SUBSCRIPTION_CARD_UNUSABLE_INAPP'))

    # 1-J 우리 쪽 연동 설정 오류(결제사가 열쇠를 거절) — 회원의 결제 실패가 아닙니다: 회원을 「결제 실패」로 만들지 않고, 배치를 멈추고, 운영에 알립니다
    us = [make_due(paid_sub('bl1j')) for _ in range(3)]; USERS.extend(us)
    for x in us: ctl(plan={x['bk']: ['unauth']})
    st, r = run_batch()
    sent = sum(len(bill_reqs(x)) for x in us)
    rec('1-22 결제사가 우리 열쇠를 거절(401) → 첫 건에서 배치를 멈춤(나머지는 보내지 않음) · 결과에 오류로 표시', sent == 1 and st < 300 and (r or {}).get('errors', 0) >= 1, (sent, str(r)[:200]))
    rec('1-23 회원은 「결제 실패」가 되지 않음 — 구독 3건 모두 ACTIVE · 결제 실패 알림 0', all(sub(x)['status'] == 'ACTIVE' for x in us) and sum(notes(x, 'SUBSCRIPTION_PAYMENT_FAILED_INAPP') + notes(x, 'SUBSCRIPTION_CARD_UNUSABLE_INAPP') for x in us) == 0,
        ([sub(x)['status'] for x in us], [notes(x, 'SUBSCRIPTION_PAYMENT_FAILED_INAPP') for x in us]))
    for x in us: ctl(plan={x['bk']: []})
    run_batch()
    bad = [(x['sub'][:8], [y['status'] for y in invs(x)], len(charges(x))) for x in us if not ([y['status'] for y in invs(x)] == ['PAID'] and len(charges(x)) == 1)]
    rec('1-24 설정을 고친 뒤 배치 → 3건 모두 PAID · 승인 1건씩', not bad, bad)


# ══ 2. 구독 환불 — 결제사 취소를 확인한 뒤에만 완료 ═══════════════════════════
def refund(u, base=A1, reason='단순 변심'):
    return call('POST', '/me/subscription/refund', u['tok'], {'reason': reason}, base=base)


def sec2():
    # 2-A 정상
    u = paid_sub('bl2a'); USERS.append(u)
    st, j = refund(u); s = sub(u); i = invs(u, False); rf = refunds(u)
    cx = reqs(f"/v1/payments/{u['pkey']}/cancel")
    rec('2-1 환불 → 결제사 취소 1건(저장된 실제 paymentKey · 환불 요청 고유 멱등 키 · 사유)',
        len(cx) == 1 and len(rf) == 1 and cx[0].get('idem') == f"sub-refund-{rf[0]['id']}" and cx[0]['body'].get('cancelReason'), (st, j, cx[:1]))
    rec('2-2 응답: 환불 완료', st < 300 and j.get('state') == 'SUCCEEDED' and j.get('label') == '환불 완료' and j.get('refundedAt'), (st, j))
    rec('2-3 DB: 청구서 REFUNDED · 구독 CANCELLED · refunded_at · 환불 요청 SUCCEEDED(금액 = 청구액)',
        i[0]['status'] == 'REFUNDED' and s['status'] == 'CANCELLED' and s['refunded_at'] and rf[0]['state'] == 'SUCCEEDED' and int(rf[0]['amount']) == PRICE and int(rf[0]['canceled_amount'] or 0) == PRICE,
        (i[0]['status'], s['status'], rf[0]['state'], rf[0].get('canceled_amount')))
    rec('2-4 접수 시점의 자격 · 사용량이 저장됨', (rf[0].get('eligibility') or {}).get('used') == 0 and (rf[0].get('eligibility') or {}).get('paidOn'), rf[0].get('eligibility'))
    rec('2-4b 환불 완료 알림이 회원에게 남음(1건)', notes(u, 'SUBSCRIPTION_REFUND_DONE_INAPP') == 1, notes(u, 'SUBSCRIPTION_REFUND_DONE_INAPP'))
    rs = [refund(u) for _ in range(2)]
    th = []; out = []
    for b in (A1, A2, A1, A2, A1): th.append(threading.Thread(target=lambda b=b: out.append(refund(u, b)), daemon=True))
    [t.start() for t in th]; [t.join(60) for t in th]
    rec('2-5 같은 환불을 7번 더(동시 5번 포함) → 결제사 취소는 1건 그대로 · 응답은 모두 「환불 완료」',
        len(ev('cancel:done', paymentKey=u['pkey'])) == 1 and len(refunds(u)) == 1 and all(x[0] < 300 and x[1].get('state') == 'SUCCEEDED' for x in rs + out),
        (len(ev('cancel:done', paymentKey=u['pkey'])), [(x[0], (x[1] or {}).get('state') or (x[1] or {}).get('code')) for x in rs + out]))
    rec('2-5b 여러 번 눌러도 환불 완료 알림은 1건', notes(u, 'SUBSCRIPTION_REFUND_DONE_INAPP') == 1, notes(u, 'SUBSCRIPTION_REFUND_DONE_INAPP'))
    st, d = call('GET', '/me/subscription/detail', u['tok'])
    rec('2-6 내 구독 조회에 환불 상태가 나옴(환불 완료)', st == 200 and (d.get('refund') or {}).get('label') == '환불 완료', d)

    # 2-B 결제사가 취소를 거절(확정)
    u = paid_sub('bl2b'); USERS.append(u)
    ctl(plan={'cancel:' + u['pkey']: ['decline']})
    st, j = refund(u); s = sub(u); i = invs(u, False); rf = refunds(u)
    rec('2-7 취소 거절 → 422 REFUND_FAILED · 「환불 실패」 · 환불 완료로 적지 않음(청구서 PAID · 구독 ACTIVE · refunded_at 없음) · 실패 사유 기록',
        st == 422 and j.get('code') == 'REFUND_FAILED' and i[0]['status'] == 'PAID' and s['status'] == 'ACTIVE' and not s['refunded_at'] and rf[-1]['state'] == 'FAILED' and rf[-1].get('failure_reason'),
        (st, j, i[0]['status'], s['status'], rf[-1]['state'] if rf else None))
    rec('2-7b 환불 실패 알림이 회원에게 남음(1건)', notes(u, 'SUBSCRIPTION_REFUND_FAILED_INAPP') == 1, notes(u, 'SUBSCRIPTION_REFUND_FAILED_INAPP'))
    st, d = call('GET', '/me/subscription/detail', u['tok'])
    rec('2-8 내 구독 조회: 「환불 실패」', (d.get('refund') or {}).get('label') == '환불 실패', d.get('refund'))
    st, j = refund(u); rf = refunds(u)
    rec('2-9 실패 뒤 다시 신청 → 새 환불 요청(새 멱등 키)으로 진행 → 환불 완료', st < 300 and j.get('state') == 'SUCCEEDED' and len(rf) == 2 and rf[0]['state'] == 'FAILED' and rf[1]['state'] == 'SUCCEEDED', (st, j, [x['state'] for x in rf]))

    # 2-B2 (v10.27 · G-114 가상 확인 T-8) 결제사에서 이미 취소된 결제 → ALREADY_CANCELED_PAYMENT → 조회로 「환불 완료」 · 결제사 취소 1건뿐
    u = paid_sub('bl2b2'); USERS.append(u)
    _rq = urllib.request.Request(TOSS + f"/v1/payments/{u['pkey']}/cancel", data=json.dumps({'cancelReason': '결제사 관리자 화면에서 먼저 취소'}).encode(), method='POST',
                                 headers={'Content-Type': 'application/json', 'Authorization': 'Basic ' + base64.b64encode(b'test_sk_bill:').decode()})
    urllib.request.urlopen(_rq, timeout=10).read()
    st, j = refund(u); s = sub(u); i = invs(u, False); rf = refunds(u)
    rec('2-26 결제사에서 이미 취소된 결제를 환불 신청 → 결제사 응답 ALREADY_CANCELED_PAYMENT → 조회로 확인해 「환불 완료」 · 청구서 REFUNDED · 결제사 취소 1건뿐(G-114 T-8)',
        st < 300 and j.get('state') == 'SUCCEEDED' and i[0]['status'] == 'REFUNDED' and s['status'] == 'CANCELLED' and len(ev('cancel:done', paymentKey=u['pkey'])) == 1,
        (st, j, i[0]['status'], s['status'], len(ev('cancel:done', paymentKey=u['pkey']))))

    # 2-C 취소는 됐는데 응답 유실
    u = paid_sub('bl2c'); USERS.append(u)
    ctl(plan={'cancel:' + u['pkey']: ['drop_after'], 'lookup:' + u['pkey']: ['http500']})
    st, j = refund(u); s = sub(u); i = invs(u, False); rf = refunds(u)
    rec('2-10 취소 응답 유실 · 조회도 실패 → 202 「환불 결과 확인 중」 · 완료로 적지 않음', st == 202 and j.get('state') == 'UNKNOWN' and j.get('label') == '환불 결과 확인 중' and i[0]['status'] == 'PAID' and not s['refunded_at'] and rf[0]['state'] == 'UNKNOWN',
        (st, j, i[0]['status'], rf[0]['state'] if rf else None))
    blocked = subprocess.run(['psql', DB, '-v', 'ON_ERROR_STOP=1', '-tAc', f"update subscriptions set request_views_used = request_views_used + 1 where id='{u['sub']}'"], capture_output=True, text=True)
    rec('2-11 환불 처리 중에는 그 구독의 유료 이용(열람 수 증가)이 DB 에서 막힘', blocked.returncode != 0 and 'REFUND' in blocked.stderr, blocked.stderr.strip()[:160])
    st, d = call('GET', '/me/subscription/detail', u['tok'])
    rec('2-12 내 구독 조회: 「환불 결과 확인 중」', (d.get('refund') or {}).get('label') == '환불 결과 확인 중', d.get('refund'))
    st, j = refund(u); s = sub(u); i = invs(u, False); rf = refunds(u)
    rec('2-13 다시 요청 → 결제사 조회로 취소 확인 → 환불 완료 · 결제사 취소는 1건뿐(다시 취소하지 않음)',
        st < 300 and j.get('state') == 'SUCCEEDED' and len(ev('cancel:done', paymentKey=u['pkey'])) == 1 and i[0]['status'] == 'REFUNDED' and s['status'] == 'CANCELLED' and len(rf) == 1,
        (st, j, len(ev('cancel:done', paymentKey=u['pkey'])), i[0]['status']))

    u = paid_sub('bl2c2'); USERS.append(u)
    ctl(plan={'cancel:' + u['pkey']: ['drop_after']})
    st, j = refund(u); s = sub(u); i = invs(u, False)
    rec('2-13b 취소 응답 유실 · 조회는 됨 → 곧바로 조회해 취소를 확인하고 환불 완료 · 결제사 취소 1건',
        st < 300 and j.get('state') == 'SUCCEEDED' and len(ev('cancel:done', paymentKey=u['pkey'])) == 1 and i[0]['status'] == 'REFUNDED' and s['status'] == 'CANCELLED', (st, j, i[0]['status']))

    # 2-D 취소 요청이 결제사에 닿지 못함 → 배치가 조회(취소 안 됨) → 같은 멱등 키로 다시 취소
    u = paid_sub('bl2d'); USERS.append(u)
    ctl(plan={'cancel:' + u['pkey']: ['drop_before']})
    st, j = refund(u)
    rec('2-14 연결 끊김 → 202 「환불 결과 확인 중」', st == 202 and j.get('state') == 'UNKNOWN', (st, j))
    run_batch(); s = sub(u); i = invs(u, False); rf = refunds(u); cx = reqs(f"/v1/payments/{u['pkey']}/cancel")
    rec('2-15 배치가 대조: 결제사에 취소가 없으면 같은 멱등 키로 다시 취소 → 환불 완료(취소 처리 1건)',
        rf[0]['state'] == 'SUCCEEDED' and i[0]['status'] == 'REFUNDED' and s['status'] == 'CANCELLED' and len(ev('cancel:done', paymentKey=u['pkey'])) == 1 and len({x.get('idem') for x in cx}) == 1,
        (rf[0]['state'], i[0]['status'], len(cx)))

    rec('2-15b 배치가 끝낸 환불도 회원에게 알림이 남음(환불 완료 1건) — 「확인 중」으로 답을 받은 회원이 결과를 알 수 있게',
        notes(u, 'SUBSCRIPTION_REFUND_DONE_INAPP') == 1, notes(u, 'SUBSCRIPTION_REFUND_DONE_INAPP'))

    # 2-E 환불 완료 직전 DB 장애 — 결제사는 취소했는데 우리 쪽 완료 기록이 실패
    u = paid_sub('bl2e'); USERS.append(u)
    q("""create or replace function zz_test_refund_fail() returns trigger language plpgsql as $$
         begin if new.state = 'SUCCEEDED' and old.state <> 'SUCCEEDED' then raise exception 'TEST: 환불 완료 기록 실패(시험용 DB 장애)'; end if; return new; end $$""")
    q("drop trigger if exists zz_test_refund_fail on subscription_refunds")
    q("create trigger zz_test_refund_fail before update on subscription_refunds for each row execute function zz_test_refund_fail()")
    try:
        st, j = refund(u); s = sub(u); i = invs(u, False); rf = refunds(u)
        rec('2-16 (환불 완료 직전 DB 장애) 결제사 취소 1건 · 응답은 「환불 완료」가 아님 · DB 도 완료 아님',
            len(ev('cancel:done', paymentKey=u['pkey'])) == 1 and not (st < 300 and (j or {}).get('state') == 'SUCCEEDED') and i[0]['status'] == 'PAID' and rf[0]['state'] != 'SUCCEEDED' and not s['refunded_at'],
            (st, j, i[0]['status'], rf[0]['state'] if rf else None))
    finally:
        q("drop trigger if exists zz_test_refund_fail on subscription_refunds"); q("drop function if exists zz_test_refund_fail()")
    st, j = refund(u); s = sub(u); i = invs(u, False); rf = refunds(u)
    rec('2-17 장애가 풀린 뒤 다시 요청 → 결제사 조회로 복구 · 환불 완료 · 결제사 취소는 1건뿐',
        st < 300 and j.get('state') == 'SUCCEEDED' and len(ev('cancel:done', paymentKey=u['pkey'])) == 1 and i[0]['status'] == 'REFUNDED' and s['status'] == 'CANCELLED' and rf[0]['state'] == 'SUCCEEDED',
        (st, j, len(ev('cancel:done', paymentKey=u['pkey'])), i[0]['status'], s['status']))

    # 2-F 자격 — 기존 정책 그대로(결제 당일 · 미이용)
    u = paid_sub('bl2f'); USERS.append(u)
    q(f"update subscriptions set request_views_used = 1 where id='{u['sub']}'")
    st, j = refund(u)
    rec('2-18 이미 이용(열람 1건) → 422 REFUND_NOT_ELIGIBLE · 결제사 호출 0 · 환불 요청 없음', st == 422 and j.get('code') == 'REFUND_NOT_ELIGIBLE' and not reqs(f"/v1/payments/{u['pkey']}/cancel") and not refunds(u), (st, j))
    u = paid_sub('bl2g'); USERS.append(u)
    q("alter table subscription_invoices disable trigger user"); q("alter table subscriptions disable trigger user")
    try:
        q(f"update subscriptions set current_period_start = current_period_start - interval '2 days', current_period_end = current_period_end - interval '2 days' where id='{u['sub']}'")
        q(f"update subscription_invoices set period_start = period_start - interval '2 days', period_end = period_end - interval '2 days', paid_at = paid_at - interval '2 days' where subscription_id='{u['sub']}'")
    finally:
        q("alter table subscription_invoices enable trigger user"); q("alter table subscriptions enable trigger user")
    st, j = refund(u)
    rec('2-19 결제 당일이 아님 → 422 REFUND_NOT_ELIGIBLE · 결제사 호출 0', st == 422 and j.get('code') == 'REFUND_NOT_ELIGIBLE' and not reqs(f"/v1/payments/{u['pkey']}/cancel"), (st, j))
    direct = subprocess.run(['psql', DB, '-v', 'ON_ERROR_STOP=1', '-tAc',
                             f"insert into subscription_refunds(subscription_id, invoice_id, account_id, amount, reason) select s.id, i.id, s.account_id, i.amount, '직접 넣기' from subscriptions s join subscription_invoices i on i.subscription_id = s.id where s.id='{u['sub']}'"],
                            capture_output=True, text=True)
    rec('2-20 자격은 DB 가 집행 — 환불 요청을 SQL 로 직접 넣어도 막힘', direct.returncode != 0 and 'REFUND' in direct.stderr, direct.stderr.strip()[:160])

    # 2-G 접수 자격과 완료 시각의 분리 — 당일에 접수된 환불이 자정을 넘어 완료돼도 저장됨
    u = paid_sub('bl2h'); USERS.append(u)
    ctl(plan={'cancel:' + u['pkey']: ['drop_after'], 'lookup:' + u['pkey']: ['http500']})
    st, j = refund(u)
    for t in ('subscription_invoices', 'subscriptions', 'subscription_refunds'): q(f"alter table {t} disable trigger user")
    try:   # 「어제 결제 · 어제 접수」로 옮김 = 오늘은 자정이 지난 뒤
        q(f"update subscriptions set current_period_start = current_period_start - interval '1 day', current_period_end = current_period_end - interval '1 day' where id='{u['sub']}'")
        q(f"update subscription_invoices set period_start = period_start - interval '1 day', period_end = period_end - interval '1 day', paid_at = paid_at - interval '1 day' where subscription_id='{u['sub']}'")
        q(f"update subscription_refunds set requested_at = requested_at - interval '1 day' where subscription_id='{u['sub']}'")
    finally:
        for t in ('subscription_invoices', 'subscriptions', 'subscription_refunds'): q(f"alter table {t} enable trigger user")
    st2, j2 = refund(u); s = sub(u); rf = refunds(u)
    rec('2-21 당일 접수 → 자정 넘어 완료: 저장됨(환불 완료 · 구독 CANCELLED)', st == 202 and st2 < 300 and j2.get('state') == 'SUCCEEDED' and s['status'] == 'CANCELLED' and rf[0]['state'] == 'SUCCEEDED', (st, st2, j2, s['status']))

    # 2-H 정기결제로 낸 기간의 환불 — 배치가 저장한 실제 paymentKey 로 취소
    u = make_due(paid_sub('bl2i')); USERS.append(u)
    run_batch(); ch = charges(u)
    st, j = refund(u); i = invs(u)
    rec('2-22 정기결제로 낸 기간의 환불 → 배치가 저장한 paymentKey 로 취소 · 그 청구서가 REFUNDED',
        st < 300 and j.get('state') == 'SUCCEEDED' and len(ch) == 1 and len(ev('cancel:done', paymentKey=ch[0]['paymentKey'])) == 1 and i[0]['status'] == 'REFUNDED', (st, j, ch[:1], [x['status'] for x in i]))
    n0 = len(bill_reqs(u)); run_batch()
    rec('2-23 환불된 구독은 다시 청구하지 않음', len(bill_reqs(u)) == n0 and sub(u)['status'] == 'CANCELLED', (len(bill_reqs(u)), n0))

    # 2-I 환불 처리 중인 구독은 갱신(청구)하지 않음
    u = paid_sub('bl2j'); USERS.append(u)
    ctl(plan={'cancel:' + u['pkey']: ['drop_before', 'drop_before', 'drop_before', 'drop_before']})
    refund(u)
    keep = q(f"select current_period_start || '|' || current_period_end from subscriptions where id='{u['sub']}'").split('|')
    blocked = subprocess.run(['psql', DB, '-v', 'ON_ERROR_STOP=1', '-tAc', f"update subscriptions set current_period_end = current_period_end + interval '30 days' where id='{u['sub']}'"], capture_output=True, text=True)
    rec('2-24a 환불 처리 중에는 그 구독의 기간 연장(갱신)이 DB 에서 막힘', blocked.returncode != 0 and 'REFUND' in blocked.stderr, blocked.stderr.strip()[:160])
    make_due(u, force=True)
    run_batch()
    rec('2-24 환불 결과 확인 중인 구독은 기간이 끝나도 청구하지 않음', len(bill_reqs(u)) == 0 and refunds(u)[0]['state'] in ('UNKNOWN', 'PROCESSING', 'REQUESTED'), (len(bill_reqs(u)), refunds(u)[0]['state']))
    ctl(plan={'cancel:' + u['pkey']: []})
    q("alter table subscriptions disable trigger user")
    try: q(f"update subscriptions set current_period_start = '{keep[0]}', current_period_end = '{keep[1]}' where id='{u['sub']}'")
    finally: q("alter table subscriptions enable trigger user")
    run_batch(); s = sub(u)
    rec('2-25 결제사와 다시 통하면 배치가 환불을 끝냄(환불 완료 · 구독 CANCELLED · 취소 1건)', refunds(u)[0]['state'] == 'SUCCEEDED' and s['status'] == 'CANCELLED' and len(ev('cancel:done', paymentKey=u['pkey'])) == 1,
        (refunds(u)[0]['state'], s['status']))


# ══ 3. 같은 요청은 한 번만 — 작업 전에 선점 ═══════════════════════════════════
def sec3():
    def sub_count(aid): return int(q(f"select count(*) from subscriptions where account_id='{aid}'"))
    def inv_count(aid): return int(q(f"select count(*) from subscription_invoices i join subscriptions s on s.id=i.subscription_id where s.account_id='{aid}'"))

    # 3-A 같은 키 · 같은 내용 동시 10건
    e, tok, aid = new_biz('bl3a'); pk = 'tpk_' + uuid.uuid4().hex[:18]; od = 'ord_' + uuid.uuid4().hex[:18]; key = uuid.uuid4().hex
    ctl(plan={pk: ['hold:1.5']})
    out = []
    ts = [threading.Thread(target=lambda b=b: out.append(subscribe(tok, pk, key, b, order=od)[:2]), daemon=True) for b in [A1, A2] * 5]
    [t.start() for t in ts]; [t.join(60) for t in ts]
    codes = sorted((st, (j or {}).get('code')) for st, j in out)
    okn = [x for x in out if x[0] < 300]
    rec('3-1 같은 키 · 같은 내용 동시 10건(서버 2대) → 결제 승인 요청 1건 · 구독 1건 · 청구서 1건',
        len(reqs('/v1/payments/confirm')) and len([x for x in reqs('/v1/payments/confirm') if x['body']['paymentKey'] == pk]) == 1 and sub_count(aid) == 1 and inv_count(aid) == 1, (codes, sub_count(aid), inv_count(aid)))
    rec('3-2 나머지는 409 REQUEST_IN_PROGRESS 또는 저장된 성공 응답(다른 오류 없음)', len(okn) >= 1 and all(st < 300 or (st == 409 and j.get('code') == 'REQUEST_IN_PROGRESS') for st, j in out), codes)
    first = okn[0]
    st, j, _, _ = subscribe(tok, pk, key, order=od)
    rec('3-3 끝난 뒤 같은 키로 다시 → 저장된 HTTP 상태 · 응답 그대로 · 승인 요청 늘지 않음',
        st == first[0] and j == first[1] and len([x for x in reqs('/v1/payments/confirm') if x['body']['paymentKey'] == pk]) == 1, (st, first[0], j == first[1]))
    st, j, _, _ = subscribe(tok, pk, key, order=od, plan='PRO')
    rec('3-4 같은 키 · 다른 내용 → 409 IDEMPOTENCY_KEY_REUSED', st == 409 and j.get('code') == 'IDEMPOTENCY_KEY_REUSED', (st, j))
    row = qj(f"select * from idempotency_records where raw_key = '{key}'")
    rec('3-5 기록: 사용자 · 작업 경로 · 요청 키 · 본문 해시 · 상태 SUCCEEDED · HTTP 상태 · 시작/완료 시각',
        len(row) == 1 and row[0].get('account_id') == aid and 'subscriptions' in (row[0].get('route') or '') and row[0].get('request_hash') and row[0].get('state') == 'SUCCEEDED'
        and row[0].get('http_status') == first[0] and row[0].get('started_at') and row[0].get('completed_at'), row[:1])
    e2, tok2, aid2 = new_biz('bl3b')
    st, j, _, _ = subscribe(tok2, None, key)
    rec('3-6 다른 사용자가 같은 키 → 서로 무관(각자 실행)', st < 300 and sub_count(aid2) == 1, (st, j))

    # 3-B 서버를 다시 띄워도
    kill_api(P1); start_api(P1); ADM.pop(A1, None)
    st, j, _, _ = subscribe(tok, pk, key, order=od)
    rec('3-7 서버 재시작 뒤 같은 키 → 저장된 응답 · 다시 실행하지 않음', st == first[0] and j == first[1] and sub_count(aid) == 1 and inv_count(aid) == 1
        and len([x for x in reqs('/v1/payments/confirm') if x['body']['paymentKey'] == pk]) == 1, (st, sub_count(aid)))

    # 3-C 진행 중
    e, tok, aid = new_biz('bl3c'); pk = 'tpk_' + uuid.uuid4().hex[:18]; od = 'ord_' + uuid.uuid4().hex[:18]; key = uuid.uuid4().hex
    ctl(plan={pk: ['hold:3']})
    box = []
    t = threading.Thread(target=lambda: box.append(subscribe(tok, pk, key, order=od)[:2]), daemon=True); t.start()
    wait_ev('confirm:approved', paymentKey=pk)
    st, j, _, _ = subscribe(tok, pk, key, A2, order=od)
    rec('3-8 처리 중인 요청과 같은 키 → 곧바로 409 REQUEST_IN_PROGRESS', st == 409 and j.get('code') == 'REQUEST_IN_PROGRESS', (st, j))
    t.join(30)
    rec('3-9 먼저 온 요청은 정상 완료', box and box[0][0] < 300 and sub_count(aid) == 1, box)

    # 3-D 확정 실패(외부 결제 없음)는 같은 키로 다시 할 수 있음
    e, tok, aid = new_biz('bl3d'); pk = 'tpk_' + uuid.uuid4().hex[:18]; od = 'ord_' + uuid.uuid4().hex[:18]; key = uuid.uuid4().hex
    ctl(plan={pk: ['decline']})
    st, j, _, _ = subscribe(tok, pk, key, order=od)
    row = qj(f"select state from idempotency_records where raw_key = '{key}'")
    rec('3-10 결제 거절(확정) → 422 PAYMENT_FAILED · 기록 FAILED · 키를 지우지 않음', st == 422 and j.get('code') == 'PAYMENT_FAILED' and row and row[0]['state'] == 'FAILED', (st, j, row))
    st, j, _, _ = subscribe(tok, pk, key, order=od)
    rec('3-11 같은 키로 다시(이번에는 승인) → 실행됨 · 구독 1건', st < 300 and sub_count(aid) == 1, (st, j))

    # 3-E 승인은 됐는데 DB 저장 실패 → 결과 불명확 → 같은 키로 다시 오면 결제 결과를 대조해 복구
    e, tok, aid = new_biz('bl3e'); pk = 'tpk_' + uuid.uuid4().hex[:18]; od = 'ord_' + uuid.uuid4().hex[:18]; key = uuid.uuid4().hex
    q("""create or replace function zz_test_inv_fail() returns trigger language plpgsql as $$
         begin raise exception 'TEST: 청구서 저장 실패(시험용 DB 장애)'; end $$""")
    q("drop trigger if exists zz_test_inv_fail on subscription_invoices")
    q("create trigger zz_test_inv_fail before insert on subscription_invoices for each row execute function zz_test_inv_fail()")
    try:
        st, j, _, _ = subscribe(tok, pk, key, order=od)
    finally:
        q("drop trigger if exists zz_test_inv_fail on subscription_invoices"); q("drop function if exists zz_test_inv_fail()")
    row = qj(f"select state from idempotency_records where raw_key = '{key}'")
    rec('3-12 (승인 뒤 DB 저장 실패) 결제사 승인 1건 · 응답 실패 · 구독 0건 · 기록은 UNKNOWN(삭제하지 않음)',
        len(ev('confirm:approved', paymentKey=pk)) == 1 and st >= 400 and sub_count(aid) == 0 and row and row[0]['state'] == 'UNKNOWN', (st, j, row))
    st, j, _, _ = subscribe(tok, pk, key, order=od)
    rec('3-13 같은 키로 다시 → 결제 결과를 대조(이미 승인 · 금액 · 주문번호 일치)해 구독을 열어 줌 — 승인은 1건뿐',
        st < 300 and sub_count(aid) == 1 and inv_count(aid) == 1 and len(ev('confirm:approved', paymentKey=pk)) == 1
        and q(f"select payment_key from subscription_invoices i join subscriptions s on s.id=i.subscription_id where s.account_id='{aid}'") == pk, (st, j))

    # 3-F 요청 처리 중 서버 종료 → 오래된 「처리 중」 기록을 시간만 보고 다시 실행하지 않고 결제 결과부터 확인
    e, tok, aid = new_biz('bl3f'); pk = 'tpk_' + uuid.uuid4().hex[:18]; od = 'ord_' + uuid.uuid4().hex[:18]; key = uuid.uuid4().hex
    ctl(plan={pk: ['hold:8']})
    t = threading.Thread(target=lambda: subscribe(tok, pk, key, order=od), daemon=True); t.start()
    wait_ev('confirm:approved', paymentKey=pk)
    kill_api(P1)
    row = qj(f"select state from idempotency_records where raw_key = '{key}'")
    rec('3-14 (승인 직후 서버 종료) 기록 PROCESSING · 구독 0건 · 결제사 승인 1건', row and row[0]['state'] == 'PROCESSING' and sub_count(aid) == 0 and len(ev('confirm:approved', paymentKey=pk)) == 1, (row, sub_count(aid)))
    start_api(P1); ADM.pop(A1, None)
    tok = login(e, 'sgb-test-1234')
    st, j, _, _ = subscribe(tok, pk, key, order=od)
    rec('3-15 서버를 다시 띄운 뒤 같은 키 → 결제 결과 대조 후 구독 1건 · 승인은 1건뿐(중복 결제 없음)',
        st < 300 and sub_count(aid) == 1 and inv_count(aid) == 1 and len(ev('confirm:approved', paymentKey=pk)) == 1, (st, j))

    # 3-G 이미 쓴 결제를 다른 요청에 다시 쓰지 못함(대조 복구를 악용해 결제 1건으로 두 번 여는 것)
    e2, tok2, aid2 = new_biz('bl3g')
    st, j, _, _ = subscribe(tok2, pk, None, order=od)
    rec('3-16 남이 이미 쓴 paymentKey 로 구독 시도 → 거절 · 구독 0건', st >= 400 and sub_count(aid2) == 0, (st, j))

    # 3-H 소개코드 발급도 같은 장치
    #   v10.19 — 시험마다 새 회원으로 합니다. 전에는 준비 자료의 한 계정(intro@x.com)을 써서, 같은 달에 이 시험을 여러 번 돌리면
    #   그 계정의 무료분(월 포함 건수)이 떨어져 발급 대신 422 EXTRA_PAYMENT_REQUIRED 가 나왔습니다(서버는 정상 — 시험의 전제가 깨진 것 · G-117).
    e_i = f'bl3h_{uuid.uuid4().hex[:8]}@t.local'
    st, j = call('POST', '/auth/signup', body={'email': e_i, 'password': 'sgb-test-1234', 'name': '코드시험'}); assert st < 300, (st, j)
    tok_i = login(e_i, 'sgb-test-1234'); aid_i = q(f"select id from accounts where email='{e_i}'")
    st, j = call('POST', '/verifications/identity', tok_i, {'provider': 'PASS'}); assert st < 300, (st, j)      # 본인인증(개발 스텁) — 무료분은 본인인증 뒤에만
    lid = q(f"select l.id from listings l where l.status='PUBLISHED' and l.owner_account_id <> '{aid_i}' limit 1")
    if lid:
        key = uuid.uuid4().hex; n0 = int(q(f"select count(*) from referral_codes where owner_account_id = '{aid_i}'"))
        out = []
        # v10.31 (D060) — BASIC 무료 소개코드 0건 → 발급은 30,000원 결제(스텁) 뒤. 같은 결제 · 같은 멱등 키로 동시 8건
        pay = {'paymentKey': 'stub_' + uuid.uuid4().hex, 'orderId': 'rcx-' + uuid.uuid4().hex[:12], 'amount': 30000}
        ts = [threading.Thread(target=lambda b=b: out.append(call('POST', '/referral-codes', tok_i, {'listingId': lid, 'count': 1, **pay}, base=b, idem=key)), daemon=True) for b in [A1, A2] * 4]
        [t.start() for t in ts]; [t.join(60) for t in ts]
        n1 = int(q(f"select count(*) from referral_codes where owner_account_id = '{aid_i}'"))
        rec('3-17 소개코드 발급 — 같은 키 동시 8건 → 코드 1건만', n1 - n0 == 1 and all(st < 300 or (st == 409 and (j or {}).get('code') == 'REQUEST_IN_PROGRESS') for st, j in out),
            (n1 - n0, sorted((st, (j or {}).get('code') if isinstance(j, dict) else None) for st, j in out)))
    else:
        R.append({'step': '3-17 소개코드 발급 — 같은 키 동시 8건', 'ok': True, 'skip': True, 'detail': '쓸 매물이 없어 건너뜀'})

    # 3-I 고치기 전에 쌓인 기록(옛 형식)도 그대로 돌려줌
    e, tok, aid = new_biz('bl3h'); key = uuid.uuid4().hex
    q(f"""insert into idempotency_records(key, response) values ('{aid}:{key}', '{{"legacy": true}}'::jsonb)""")
    st, j, _, _ = subscribe(tok, None, key)
    rec('3-18 옛 형식 기록(사용자:키)이 있으면 그 응답을 돌려주고 다시 실행하지 않음', st < 300 and j == {'legacy': True} and sub_count(aid) == 0, (st, j))


# ══ 4. 해지 — 결제 실패 상태에서도 · 청구와의 순서 ═════════════════════════════
def cancel(u, base=A1): return call('POST', '/me/subscription/cancel', u['tok'], {'reason': '시험'}, base=base)


def sec4():
    u = make_due(paid_sub('bl4a')); USERS.append(u)
    ctl(plan={u['bk']: ['decline']})
    run_batch()
    st, j = cancel(u); s = sub(u)
    rec('4-1 결제 실패(PAST_DUE) 회원도 자동 갱신 해지 가능', s['status'] == 'PAST_DUE' and st < 300 and j.get('cancelled') and s['cancel_at'], (st, j, s['status']))
    n0 = len(bill_reqs(u)); run_batch(); run_batch()
    rec('4-2 해지 뒤 배치를 돌려도 새 청구 0', len(bill_reqs(u)) == n0, (len(bill_reqs(u)), n0))
    st, j2 = cancel(u)
    rec('4-3 이미 해지한 구독 → 오류가 아니라 기존 해지 결과를 돌려줌', st < 300 and j2.get('alreadyCancelled') is True and j2.get('id') == j.get('id'), (st, j2))
    st, d = call('GET', '/me/subscription/detail', u['tok'])
    rec('4-4 내 구독 조회: 해지됨 · 더 청구하지 않음 안내', st == 200 and d.get('autoRenew') is False and d.get('nextChargeAt') is None and '청구' in (d.get('notice') or ''), d)

    # 4-B 배치가 대상을 읽은 뒤 · 청구를 잡기 전에 해지가 확정되는 순서 — 구독 줄 잠금으로 순서를 만듭니다
    u = make_due(paid_sub('bl4b')); USERS.append(u)
    lock = subprocess.Popen(['psql', DB, '-v', 'ON_ERROR_STOP=1', '-q'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    lock.stdin.write(f"begin; select 1 from subscriptions where id='{u['sub']}' for update;\n"); lock.stdin.flush(); time.sleep(0.7)
    box = []
    t = threading.Thread(target=lambda: box.append(run_batch()), daemon=True); t.start()
    time.sleep(2.0)                                           # 배치가 대상을 읽고 이 구독의 잠금에서 기다리는 중
    lock.stdin.write(f"update subscriptions set cancel_at = now() where id='{u['sub']}'; commit;\n"); lock.stdin.flush(); lock.stdin.close(); lock.wait(20)
    t.join(60)
    rec('4-5 해지가 먼저 확정되면(배치가 대상을 읽은 뒤라도) 청구를 보내지 않음', len(bill_reqs(u)) == 0 and not [x for x in invs(u) if x['status'] in ('PENDING', 'PAID')], (len(bill_reqs(u)), [x['status'] for x in invs(u)], str(box)[:120]))

    # 4-C 청구가 먼저 잡힌 뒤(결제사 처리 중) 해지
    u = make_due(paid_sub('bl4c')); USERS.append(u)
    ctl(plan={u['bk']: ['hold:3']})
    t = threading.Thread(target=run_batch, daemon=True); t.start()
    for _ in range(100):
        if charges(u): break
        time.sleep(0.1)
    st, j = cancel(u)
    rec('4-6 청구가 이미 결제사 처리 중일 때 해지 → 해지는 되고, 진행 중인 청구가 있음을 응답에 밝힘', st < 300 and j.get('cancelled') and j.get('chargeInFlight') is True and '진행' in (j.get('note') or ''), (st, j))
    t.join(60); i = invs(u); s = sub(u)
    rec('4-7 그 청구는 한 번 반영(PAID · 기간 1회 연장) · 이후 자동 청구는 없음', i[0]['status'] == 'PAID' and len(bill_reqs(u)) == 1 and s['cancel_at'], (i[0]['status'], len(bill_reqs(u))))
    q(f"update subscriptions set current_period_start = current_period_start - interval '31 days', current_period_end = now() - interval '1 minute' where id='{u['sub']}'")
    run_batch()
    rec('4-8 다음 기간이 와도 청구하지 않음', len(bill_reqs(u)) == 1, len(bill_reqs(u)))

    # 4-D 해지와 배치가 뒤섞여도 「해지가 확정된 뒤에 시작된 청구」는 없음
    us = [make_due(paid_sub('bl4d')) for _ in range(8)]; USERS.extend(us)
    for x in us: ctl(plan={x['bk']: ['hold:0.3']})
    ts = [threading.Thread(target=run_batch, args=(b,), daemon=True) for b in (A1, A2)] + [threading.Thread(target=cancel, args=(x, b), daemon=True) for x, b in zip(us, [A2, A1] * 4)]
    [t.start() for t in ts]; [t.join(120) for t in ts]
    bad = []
    for x in us:
        s = sub(x); i = invs(x); n = len(bill_reqs(x))
        late = q(f"select count(*) from subscription_invoices i join subscriptions s on s.id = i.subscription_id where s.id='{x['sub']}' and i.period_start = '{x['due']}' and i.claimed_at > s.cancel_at")
        if not (s['cancel_at'] and n <= 1 and late == '0' and (n == 0 or [y['status'] for y in i] == ['PAID'])): bad.append((x['sub'][:8], n, late, [y['status'] for y in i]))
    rec('4-9 해지 8건과 배치 2대를 동시에 → 구독마다 청구 0 또는 1 · 해지 확정 뒤에 잡힌 청구 0', not bad, bad)

    # 4-E 해지한 PAST_DUE 는 유예가 지나면 만료
    u = make_due(paid_sub('bl4e')); USERS.append(u)
    ctl(plan={u['bk']: ['decline']})
    run_batch(); cancel(u)
    q("alter table billing_attempts disable trigger user")          # 시도 기록은 고칠 수 없는 표 — 「유예가 지났다」를 만들려고 시험에서만 끕니다
    try: q(f"update billing_attempts set attempted_at = attempted_at - interval '30 days' where subscription_id='{u['sub']}'")
    finally: q("alter table billing_attempts enable trigger user")
    run_batch()
    rec('4-10 해지한 결제 실패 구독은 유예 기간이 지나면 EXPIRED(청구 없이)', sub(u)['status'] == 'EXPIRED' and len(bill_reqs(u)) == 1, (sub(u)['status'], len(bill_reqs(u))))

    # 4-F 해지할 구독이 없으면
    e, tok, aid = new_biz('bl4f')
    st, j = call('POST', '/me/subscription/cancel', tok, {'reason': 'x'})
    rec('4-11 구독이 없으면 409 NOT_CANCELLABLE', st == 409 and j.get('code') == 'NOT_CANCELLABLE', (st, j))


# ══ 5. 열쇠 없는(스텁) 방식 — 평소 개발 환경에서도 같은 흐름 ═════════════════════
def sec5():
    try:
        e, tok, aid = new_biz('bl5a', STUB)
    except Exception as ex:
        R.append({'step': '5 스텁 방식', 'ok': True, 'skip': True, 'detail': f'개발 API({STUB})가 없어 건너뜀 — {ex}'}); return
    st, j, pk, od = subscribe(tok, base=STUB)
    u = {'tok': tok, 'aid': aid, 'sub': (j or {}).get('subscriptionId'), 'pkey': pk}
    USERS.append(u)
    st2, r = call('POST', '/me/subscription/refund', tok, {'reason': '스텁 환불'}, base=STUB)
    s = sub(u) if u['sub'] else {}
    rec('5-1 스텁 방식: 구독 → 환불 완료 · 구독 CANCELLED · 「실제 환불 아님」 표시', st < 300 and st2 < 300 and r.get('state') == 'SUCCEEDED' and s.get('status') == 'CANCELLED' and r.get('stub') is True, (st, st2, r))
    e, tok, aid = new_biz('bl5b', STUB)
    st, j, pk, od = subscribe(tok, base=STUB)
    u = {'tok': tok, 'aid': aid, 'sub': j['subscriptionId']}; USERS.append(u)
    make_due(u)
    adm = login('admin@x.com', base=STUB)
    st, r = call('POST', '/admin/billing/charge-due', adm, base=STUB); i = invs(u)
    rec('5-2 스텁 방식: 정기결제 → 청구서 1건 PAID · 주문번호 · 스텁 결제 키 저장', st < 300 and len(i) == 1 and i[0]['status'] == 'PAID' and i[0].get('order_id') and i[0].get('payment_key'), (st, i[:1]))
    st, r = call('POST', '/me/subscription/cancel', tok, {'reason': 'x'}, base=STUB)
    rec('5-3 스텁 방식: 해지', st < 300 and r.get('cancelled'), (st, r))

    # 열쇠 없는(스텁) 방식은 실제 결제사에서 일어난 일을 모릅니다 — 실제 결제로 생긴 「확인 중」 청구 · 환불을 닫으면 안 됩니다
    # (운영 서버가 실수로 열쇠 없이 떴을 때: 스텁은 모든 주문을 「없음」, 모든 취소를 「성공」이라고 답합니다)
    u = make_due(paid_sub('bl5c')); USERS.append(u)
    ctl(plan={u['bk']: ['mismatch']})
    run_batch(); i = invs(u)
    q(f"update subscription_invoices set claimed_at = now() - interval '2 hours' where id = '{i[0]['id']}'")
    st, r = call('POST', '/admin/billing/charge-due', adm, base=STUB); i = invs(u)
    rec('5-4 실제 결제사로 생긴 확인 중 청구(금액 불일치)를 스텁 방식 배치가 닫지 않음 — PENDING · 확인 필요 그대로', st < 300 and i[0]['status'] == 'PENDING' and 'MISMATCH' in (i[0].get('pg_status') or ''),
        (st, i[0]['status'], i[0].get('pg_status')))
    u = paid_sub('bl5d'); USERS.append(u)
    tok_s = login(u['email'], 'sgb-test-1234', STUB)
    st, r = call('POST', '/me/subscription/refund', tok_s, {'reason': '스텁 방식으로 온 환불'}, base=STUB)
    s = sub(u); i = invs(u, False)
    rec('5-5 실제 결제사로 결제한 구독의 환불을 스텁 방식 서버가 받으면 「환불 완료」라고 하지 않음(202 확인 중) · 청구서 PAID · 구독 그대로',
        st == 202 and (r or {}).get('state') != 'SUCCEEDED' and i[0]['status'] == 'PAID' and s['status'] == 'ACTIVE' and not s['refunded_at'] and len(ev('cancel:done', paymentKey=u['pkey'])) == 0, (st, r, i[0]['status']))
    st, r = refund(u); s = sub(u)
    rec('5-6 결제사와 연결된 서버가 이어받으면 실제로 취소하고 환불 완료 · 결제사 취소 1건', st < 300 and (r or {}).get('state') == 'SUCCEEDED' and s['status'] == 'CANCELLED' and len(ev('cancel:done', paymentKey=u['pkey'])) == 1, (st, r))
    # 스텁 방식에서 잡다가 끊긴 청구(스텁 표시)는 스텁 방식이 스스로 닫고 다시 청구
    e, tok, aid = new_biz('bl5e', STUB)
    st, j, pk, od = subscribe(tok, base=STUB)
    u = {'tok': tok, 'aid': aid, 'sub': j['subscriptionId']}; USERS.append(u)
    make_due(u)
    q(f"""insert into subscription_invoices(subscription_id, period_start, period_end, amount, status, billing_key_id, order_id, is_stub, claimed_at)
          select s.id, s.current_period_end, s.current_period_end + interval '30 days', {PRICE}, 'PENDING', (select id from billing_keys where account_id = s.account_id and status='ACTIVE'),
                 'sub_' || s.id || '_stubcrash_a1', true, now() from subscriptions s where s.id = '{u['sub']}'""")
    q(f"update subscription_invoices set claimed_at = now() - interval '2 hours' where subscription_id = '{u['sub']}' and status = 'PENDING'")
    call('POST', '/admin/billing/charge-due', adm, base=STUB); call('POST', '/admin/billing/charge-due', adm, base=STUB); i = invs(u)
    rec('5-7 스텁 방식에서 끊긴 청구(스텁 표시)는 스텁 방식 배치가 닫고 다시 청구 → PAID(개발 환경이 막히지 않음)', len(i) == 1 and i[0]['status'] == 'PAID' and i[0].get('is_stub') is True, [(x['status'], x.get('is_stub'), x.get('pg_status')) for x in i])


# ══ 6. 결제는 됐는데 구독이 안 열리는 길 — 다시 결제 · 요금제 변경 ═══════════════════
def sec6():
    u = paid_sub('bl6a'); USERS.append(u)
    st, j = cancel(u)
    st, j, pk2, od2 = subscribe(u['tok'])
    s = sub(u)
    n = q(f"select count(*) from subscription_invoices where subscription_id='{u['sub']}' and payment_key='{pk2}' and status='PAID'")
    rec('6-1 해지 예약한 회원이 다시 결제 → 구독이 이어지고 자동 갱신으로 돌아옴(cancel_at 없음) · 그 결제가 청구서로 남음',
        st < 300 and s['status'] == 'ACTIVE' and not s['cancel_at'] and n == '1' and len(ev('confirm:approved', paymentKey=pk2)) == 1, (st, j, s['cancel_at'], n))
    u = make_due(paid_sub('bl6b')); USERS.append(u)
    ctl(plan={u['bk']: ['decline']})
    run_batch()
    st, j, pk3, od3 = subscribe(u['tok'])
    s = sub(u); i = invs(u, False)
    rec('6-2 결제 실패(PAST_DUE) 회원이 직접 결제 → ACTIVE · 새 기간 · 그 결제가 청구서로 남음 · 밀린 청구는 다시 나가지 않음',
        st < 300 and s['status'] == 'ACTIVE' and any(x.get('payment_key') == pk3 and x['status'] == 'PAID' for x in i), (st, j, s['status'], [(x['status'], x.get('payment_key')) for x in i]))
    n0 = len(bill_reqs(u)); run_batch()
    rec('6-3 그 뒤 배치는 청구하지 않음(기간이 새로 시작됨)', len(bill_reqs(u)) == n0, (len(bill_reqs(u)), n0))

    # 정기결제 결과를 확인하는 중(PENDING)에 직접 결제 — 두 번 내게 되므로 결제를 받기 전에 막습니다
    u = make_due(paid_sub('bl6c')); USERS.append(u)
    ctl(plan={u['bk']: ['drop_after'], lk(u): ['http500']})
    run_batch()
    st, j, pk4, od4 = subscribe(u['tok'])
    rec('6-4 정기결제 결과 확인 중(PENDING)에 직접 결제 → 409 CHARGE_IN_PROGRESS · 결제 승인 요청 0(돈이 나가지 않음)',
        st == 409 and (j or {}).get('code') == 'CHARGE_IN_PROGRESS' and not [x for x in reqs('/v1/payments/confirm') if x['body']['paymentKey'] == pk4], (st, j))
    i = invs(u); q(f"update subscription_invoices set claimed_at = now() - interval '10 minutes' where id = '{i[0]['id']}'")
    run_batch()
    rec('6-5 확인이 끝나면(PAID) 구독이 이어짐 — 청구 1건', invs(u)[0]['status'] == 'PAID' and len(bill_reqs(u)) == 1 and sub(u)['status'] == 'ACTIVE', (invs(u)[0]['status'], len(bill_reqs(u))))


# ══ 7. 배치(스케줄러 경로) — 실패 · 확인 필요가 운영 알림으로 남는가 ══════════════════
def sec7():
    adm = login('admin@x.com')
    def job(): return call('POST', '/admin/jobs', adm, {'job': 'subscription_billing'}, timeout=90)
    def alerts(code): return int(q(f"select count(*) from ops_alerts where alert_code = '{code}' and raised_at > now() - interval '5 minutes'"))
    u = make_due(paid_sub('bl7a')); USERS.append(u)
    ctl(plan={u['bk']: ['decline']})
    a0 = alerts('SUBSCRIPTION_BILLING_FAILED'); st, j = job()
    rec('7-1 정기결제 작업: 청구 실패가 있어도 작업은 정상 종료 · 운영 알림(SUBSCRIPTION_BILLING_FAILED)이 남음',
        st < 300 and alerts('SUBSCRIPTION_BILLING_FAILED') == a0 + 1 and invs(u)[0]['status'] == 'FAILED', (st, str(j)[:200], alerts('SUBSCRIPTION_BILLING_FAILED'), a0))
    u = make_due(paid_sub('bl7b')); USERS.append(u)
    ctl(plan={u['bk']: ['decline_expired']})
    a0 = alerts('SUBSCRIPTION_CARD_UNUSABLE'); st, j = job()
    rec('7-2 카드 교체가 필요한 실패 → 알림(SUBSCRIPTION_CARD_UNUSABLE)', st < 300 and alerts('SUBSCRIPTION_CARD_UNUSABLE') == a0 + 1, (st, str(j)[:200]))
    u = make_due(paid_sub('bl7c')); USERS.append(u)
    ctl(plan={u['bk']: ['mismatch']})
    a0 = alerts('SUBSCRIPTION_BILLING_REVIEW'); st, j = job()
    rec('7-3 사람이 봐야 하는 청구(금액 불일치)가 있으면 알림(SUBSCRIPTION_BILLING_REVIEW)', st < 300 and alerts('SUBSCRIPTION_BILLING_REVIEW') == a0 + 1, (st, str(j)[:200]))
    st, rv = call('GET', '/admin/billing/review', adm)
    rec('7-4 운영 조회(확인이 필요한 청구 · 환불 · 요청)에 그 청구가 보임',
        st == 200 and any(x.get('subscriptionId') == u['sub'] and 'MISMATCH' in (x.get('pgStatus') or '') for x in (rv or {}).get('pendingInvoices', [])), (st, str(rv)[:200]))


if __name__ == '__main__':
    pre = int(q("select count(*) from v_billing_due"))
    if pre:
        print(f'개발 DB 에 이미 청구 대상 구독이 {pre}건 있습니다 — 이 시험의 배치가 그것까지 청구합니다. 먼저 정리하십시오(v_billing_due).', file=sys.stderr); sys.exit(2)
    start_all()
    try:
        for k, f in (('1', sec1), ('2', sec2), ('3', sec3), ('4', sec4), ('5', sec5), ('6', sec6), ('7', sec7)):
            if k in SEL:
                try: f()
                except Exception as ex:
                    import traceback; traceback.print_exc()
                    rec(f'{k}절 실행 중 오류', False, repr(ex)[:300])
                finally:
                    try: cleanup(USERS)
                    except Exception as ex: print('cleanup', ex, file=sys.stderr)
    finally:
        stop_all()
    ok = sum(1 for r in R if r['ok']); skip = sum(1 for r in R if r.get('skip'))
    json.dump({'items': R, 'pass': ok, 'fail': len(R) - ok}, open(os.path.join(HERE, 'srv_billing.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'통과 {ok} / {len(R)}' + (f' · 건너뜀 {skip}' if skip else ''))
