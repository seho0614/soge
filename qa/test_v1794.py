"""v10.794 (docs/909) 오픈 직전 정리 — open-prep.sh check 넓히기(읽기만)
  KIT=<kit> DB=postgresql://sgb:sgb@localhost:15432/sgb python3 test_v1794.py
  ① (코드) check 에 소개몰 주문 · 시험 계정 판매자 · 스텁 기록 4 · STUB-SUB · 간주 승인 중개사 · 간주 모드 경고 · 스위치 2 · apply 그대로 · 문법 · 문서 909
  ② (DB) 점검판 DB 에 check 를 실제로 돌림(임시 앱 폴더 · apply 안 함) — 새 줄이 「?」 없이 숫자 · 간주 모드 줄 · 결과 파일
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


OP = rd('deploy/aws/open-prep.sh')
syn = subprocess.run(['bash', '-n', os.path.join(K, 'deploy/aws/open-prep.sh')], capture_output=True, text=True)
ok('① check 줄 — 소개몰 주문 · 시험 계정 판매자 · 스텁 4종 · STUB-SUB · 간주 승인 중개사 · 간주 모드 경고 · consult.mail_otp · mall.order_open · 문법',
   all(x in OP for x in ('FROM hlt_orders WHERE account_id IN $T', 'FROM hlt_sellers WHERE account_id IN $T', 'subscription_invoices WHERE is_stub', 'hlt_payments WHERE stub',
       'lead_cash_charges WHERE stub', 'hlt_payout_requests WHERE stub', "submerchant_id LIKE 'STUB-SUB-%'", 'v_broker_verified_assumed', "'assume.payment', 'assume.broker', 'assume.bank', 'assume.etax'",
       "key = 'consult.mail_otp'", "key = 'mall.order_open'")) and syn.returncode == 0, syn.stderr[:100])
ok('① apply 그대로(지우는 것 없음 · 새 줄은 check 만) · 문서 909 · 판', 'DELETE' not in OP.split('BEGIN;')[1] and OP.count('UPDATE ') == 6 and '있는 기능' in doc('909_') and VT >= (10, 794), VER)

DB_OK = bool(DB) and psql('SELECT 1') == '1'   # 닿지 않는 주소(미리 검사 ④)면 ② 건너뜀
if not DB_OK and DB:
    print('  (DB 닿지 않음 — ② 건너뜀)')
if DB_OK:
    import tempfile
    tmp = tempfile.mkdtemp(prefix='t1794-')
    os.makedirs(os.path.join(tmp, 'app')); os.makedirs(os.path.join(tmp, 'data'))
    open(os.path.join(tmp, 'app', '.env'), 'w').write('DATABASE_URL=' + DB + '\n')
    open(os.path.join(tmp, 'app', 'VERSION'), 'w').write(VER + '\n')
    env = dict(os.environ, APP_LINK=os.path.join(tmp, 'app'), DATA_DIR=os.path.join(tmp, 'data'))
    r = subprocess.run(['bash', os.path.join(K, 'deploy/aws/open-prep.sh'), 'check'], capture_output=True, text=True, env=env, timeout=300, stdin=subprocess.DEVNULL)
    out = r.stdout
    new_lines = [l for l in out.splitlines() if '소개몰 주문' in l or '시험(스텁) 기록' in l or 'STUB-SUB' in l]
    logs = os.listdir(os.path.join(tmp, 'data', 'logs')) if os.path.isdir(os.path.join(tmp, 'data', 'logs')) else []
    ok('② 점검판 DB 에 check — 새 줄 3 · 「?」 없음 · 간주 모드 줄 · consult.mail_otp=off · 결과 파일 · 읽기만 끝',
       r.returncode == 0 and len(new_lines) == 3 and not any("?" in l.replace('(?', '') for l in new_lines) and ('간주 모드' in out) and 'consult.mail_otp=off' in out
       and any(x.startswith('open-prep_') for x in logs) and '읽기만 했습니다' in out, f"rc={r.returncode} · {new_lines} · {r.stderr[-160:]}")
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
