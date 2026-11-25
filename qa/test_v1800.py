"""v10.800 (docs/916 · D333) ERP 연결 ② — 운영 알림 · 회원 알림 쓰기 길 · 로그인 넘겨주기 코드
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb python3 test_v1800.py
  ① (코드) 알림 종류 앞마디 · ONCE · RESOLVE · 링크 제한 · 코드 해시만 · 같은 기기 줄 · 2단계 시각 · 운영자만 · 명세 · 문서 916
  ② (API) 넘겨주기 → redeem → 새 증표로 introspect active · 다시 쓰면 404 · 지난 코드 409 · 서비스 토큰 없이 403 · 알림 RAISE · ONCE 0 · RESOLVE · 남의 앞마디 400 · 회원 알림 줄 · 나쁜 링크 422
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb' if os.path.isdir(KIT + '/sgb') else KIT
API = os.environ.get('API')
DB = os.environ.get('DB')
ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


def doc(prefix):
    d = os.path.join(K, 'docs')
    return next((open(os.path.join(d, x), encoding='utf-8').read() for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith(prefix)), '')


VER = rd('VERSION').strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=180).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()




def login(e):
    return call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')


def call_h(m_, p, hd, b=None):
    h = {'content-type': 'application/json', **hd}
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ == 'POST' else None), headers=h, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=60).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code')}


MIG = rd('prisma/migrations/D333_erp_link/migration.sql')
I, C = rd('src/modules/erp-link/erp-internal.ts'), rd('src/modules/erp-link/erp-link.controller.ts')
ok('① 알림 — 앞마디 목록 · ONCE(풀리지 않은 같은 알림) · RESOLVE · clock_timestamp · 회원 알림 ERP_ · 링크 / 또는 ERP 주소',
   'ACCT|HR|HRA|HRX|OFC|QLT|LGL|ITS|PRR|SAL|ERP|TRD' in I and 'AND NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = $1 AND resolved_at IS NULL)' in I
   and "mode === 'RESOLVE'" in I and 'clock_timestamp()' in I and '/^ERP_[A-Z0-9_]{2,40}$/' in I and 'https:\\/\\/erp\\.sogaebank\\.com\\/' in I, '')
ok('① 넘겨주기 — 60초 · 해시만 · used_at 한 번 · 같은 sid · mfa_at · issue(계정, 2단계 시각, sid) · 운영 역할만 · mfa_at 칸 · 문서 916',
   'HANDOFF_SEC = 60' in I and 'sha(code)' in I and 'WHERE code_hash = $1 AND used_at IS NULL' in I and 'this.svc.auth.issue(r.accountId, r.mfaAt, r.sid)' in C
   and "@Roles('REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT')" in C and 'mfa_at       bigint' in MIG
   and '짧은 교환 코드' in doc('916_') and VT >= (10, 800), VER)


def call_h(m_, p, hd, b=None):
    h = {'content-type': 'application/json', **hd}
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ == 'POST' else None), headers=h, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=60).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code')}


if API and DB:
    import consent_ok, hashlib
    consent_ok.agree('admin@x.com', PW)
    T = login('admin@x.com')
    tok = call('POST', '/admin/erp/service-token', {}, T).get('token') or ''
    H = {'X-Erp-Service-Token': tok}
    ho = call('POST', '/admin/erp/handoff', {}, T)
    code = ho.get('code') or ''
    nos = call_h('POST', '/internal/erp/handoff/redeem', {}, {'code': code})
    rd1 = call_h('POST', '/internal/erp/handoff/redeem', H, {'code': code})
    rd2 = call_h('POST', '/internal/erp/handoff/redeem', H, {'code': code})
    intro = call_h('GET', '/auth/introspect', {**H, 'Authorization': 'Bearer ' + (rd1.get('accessToken') or '')})
    old = 'oldcode' + str(int(time.time() * 1000)) + 'x' * 20
    psql(f"INSERT INTO erp_handoff_codes (code_hash, account_id, created_at, expires_at) SELECT '{hashlib.sha256(old.encode()).hexdigest()}', id, now() - interval '3 minutes', now() - interval '2 minutes' FROM accounts WHERE email = 'admin@x.com'")
    rd3 = call_h('POST', '/internal/erp/handoff/redeem', H, {'code': old})
    stored = psql(f"SELECT count(*) FROM erp_handoff_codes WHERE code_hash = '{hashlib.sha256(code.encode()).hexdigest()}' AND used_at IS NOT NULL")
    ok('② 넘겨주기 — 코드 60초 · 서비스 토큰 없이 403 · redeem → 새 증표 introspect active · 다시 404 · 지난 코드 409 ERP_HANDOFF_EXPIRED · DB 는 해시 · 쓴 표시',
       len(code) >= 40 and ho.get('expiresIn') == 60 and nos.get('_err') == 403 and bool(rd1.get('accessToken')) and intro.get('active') is True
       and rd2.get('_err') == 404 and rd3.get('_err') == 409 and rd3.get('code') == 'ERP_HANDOFF_EXPIRED' and stored == '1',
       f"{nos.get('_err')} · {bool(rd1.get('accessToken'))} · {intro.get('active')} · {rd2.get('_err')} · {rd3}")
    sid = str(int(time.time() * 1000))[-8:]
    ac = f'ACCT_T1800_{sid}'
    a1 = call_h('POST', '/internal/erp/alerts', H, {'code': ac, 'mode': 'ONCE', 'severity': 'INFO', 'title': '시험 1800', 'detail': {'n': 1}})
    a2 = call_h('POST', '/internal/erp/alerts', H, {'code': ac, 'mode': 'ONCE', 'title': '시험 1800 두 번째'})
    a3 = call_h('POST', '/internal/erp/alerts', H, {'code': ac, 'mode': 'RESOLVE', 'note': '시험 끝'})
    a4 = call_h('POST', '/internal/erp/alerts', H, {'code': 'MAIL_PRIVACY_NEW', 'title': '흉내'})
    ok('② 알림 — ONCE 1 · 두 번째 0 · RESOLVE 1 · 소개뱅크 알림 종류 흉내 400',
       a1.get('raised') == 1 and a2.get('raised') == 0 and a3.get('resolved') == 1 and a4.get('_err') == 400, f'{a1} · {a2} · {a3} · {a4.get("_err")}')
    buyer = psql("SELECT id FROM accounts WHERE email = 'buyer@x.com'")
    n1 = call_h('POST', '/internal/erp/notify', H, {'accountId': buyer, 'kind': 'ERP_T1800', 'title': '시험 1800', 'body': '급여 명세 시험', 'link': '/my'})
    n2 = call_h('POST', '/internal/erp/notify', H, {'accountId': buyer, 'kind': 'ERP_T1800', 'title': 'x', 'body': 'x', 'link': 'https://evil.example/'})
    cnt = psql(f"SELECT count(*) FROM notifications WHERE id = {int(n1.get('id') or 0)} AND event_code = 'ERP_T1800'")
    ok('② 회원 알림 — 줄 생김 · 바깥 링크 422', bool(n1.get('id')) and cnt == '1' and n2.get('_err') == 422, f'{n1} · {n2.get("_err")}')
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
