"""v10.359 (docs/493) 개인정보 열람 사유
  ① (코드) 사유 고르기 · 머리글 · 기록 · 회원 상세 · 월 점검 · 보안 보고 · 문서 493 · 판 v10.359
  ② (API) 사유 넷 → 접속기록 · 월 점검 사유별
  ③ (화면) 사유 묻기 · 고르면 열림 · 4시간 유지
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB = os.environ.get('ADMIN_WEB')
SITE = os.environ.get('SITE')
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

def ui(fn):
    """playwright 가 있으면 브라우저 하나로 fn(b, seen, perr) · 없으면 None"""
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return None
    seen, perr = {}, []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            fn(b, seen, perr)
            b.close()
    except Exception as ex:
        perr.append(str(ex)[:160])
    return seen, perr


def site_login(b, perr, email):
    ps = b.new_page(viewport={'width': 1280, 'height': 900}); ps.on('pageerror', lambda e: perr.append(str(e)[:120]))
    ps.goto(SITE + '/login', wait_until='networkidle', timeout=120000)
    ps.fill('input[name=email]', email); ps.fill('input[name=password]', PW); ps.click('form.auth button'); ps.wait_for_timeout(2500)
    return ps

M26 = rd('prisma/migrations/D226_faq_feedback_inquiry_templates/migration.sql')
FB, TC = rd('src/modules/help/faq-feedback.controller.ts'), rd('src/modules/support/inquiry-template.controller.ts')
FS, AM = rd('src/modules/help/faq-admin.service.ts'), rd('src/app.module.ts')
HUB, FA, DESK = rd('site/src/components/support/CsHub.tsx'), rd('web/src/app/admin/FaqAdmin.tsx'), rd('web/src/app/admin/InquiryDesk.tsx')
SJ = rd('spec/screens.json')

import base64
def jwt_life(tok):
    try:
        p = tok.split(".")[1]; p += "=" * (-len(p) % 4)
        j = json.loads(base64.urlsafe_b64decode(p)); return int(j["exp"]) - int(j["iat"])
    except Exception:
        return None
def login_full(e, pw=PW):
    return call("POST", "/auth/login", {"email": e, "password": pw})
def mk_staff(tag, role="ADMIN"):
    stamp = int(time.time()) % 100000
    em = f"t{tag}s{stamp}@x.com"
    h = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{em}', '시험{tag}', '{h}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{em}'")
    if role:
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag}', true); INSERT INTO account_roles (account_id, role) VALUES ('{aid}', '{role}') ON CONFLICT DO NOTHING; COMMIT;")
    return em, aid
def rm_role(aid, tag):
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag} 지움', true); DELETE FROM account_roles WHERE account_id = '{aid}' AND role <> 'MEMBER'; COMMIT;")


PI, PG, API_TS, AC = rd('src/core/pii-audit.interceptor.ts'), rd('web/src/components/PiiReasonGate.tsx'), rd('web/src/lib/api.ts'), rd('src/modules/admin/admin.controller.ts')
PR, SR, APP, MB = rd('src/modules/admin/pii-review.service.ts'), rd('src/modules/admin/security-report.ts'), rd('web/src/App.tsx'), rd('web/src/app/admin/Members.tsx')
ok('① 코드 — 사유 고르기(6 · 4시간) · 머리글 X-PII-Reason · 접속기록 「· 사유」 · 없으면 미입력 · 회원 상세 기록 · 사업자 인증 · 거래 · 회원 상세 화면 · 월 점검 사유별 · 보안 보고 미입력 · 문서 493 · 판 v10.359',
   "headers.set('X-PII-Reason', pii)" in API_TS and "`${meta.reason} · 사유 ${why}`" in PI and "return '미입력';" in PI and "@PiiAccess('ACCOUNT', '회원 상세')" in AC
   and "<PiiReasonGate what=\"사업자 인증\">" in APP and "<PiiReasonGate what=\"거래\">" in APP and '<PiiReasonGate what="회원 상세">' in MB and 'const HOURS = 4' in PG
   and "split_part(l.reason, ' · 사유 ', 2)" in PR and 'piiNoReason' in SR and '사유' in doc('493_') and VT >= (10, 359), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    em, tgt = mk_staff('1359', role=None)
    def get(h):
        hd = {'Authorization': 'Bearer ' + TS, **({'X-PII-Reason': h} if h else {})}
        r = urllib.request.Request(API + f'/admin/accounts/{tgt}', headers=hd)
        try: return urllib.request.urlopen(r, timeout=60).status
        except urllib.error.HTTPError as e: return e.code
    t0 = psql("SELECT now()")
    st = [get('DISPUTE'), get('OTHER:' + urllib.parse.quote('시험 1359 확인')), get('BOGUS'), get(None)]
    time.sleep(1.5)
    rs = psql(f"SELECT string_agg(reason, '|' ORDER BY occurred_at) FROM audit.pii_access_logs WHERE target_account_id = '{tgt}' AND occurred_at >= '{t0}'")
    mon = datetime.date.today().strftime('%Y-%m')
    pr = call('GET', f'/admin/pii-review/{mon}', None, TS)
    rr = {x.get('r'): x.get('n') for x in (pr.get('reasons') or [])}
    ok('② API — 회원 상세를 사유 넷으로(분쟁 · 기타 글 · 이상한 값 · 없음) → 접속기록 「회원 상세 · 사유 분쟁 처리 · 기타: … · 미입력 · 미입력」 · 월 점검 사유별',
       st == [200, 200, 200, 200] and rs == '회원 상세 · 사유 분쟁 처리|회원 상세 · 사유 기타: 시험 1359 확인|회원 상세 · 사유 미입력|회원 상세 · 사유 미입력'
       and int(rr.get('분쟁 처리') or 0) >= 1 and int(rr.get('미입력') or 0) >= 2, f'{st} · {rs} · {rr}')
    if ADMIN_WEB:
        def run(b, seen, perr):
            pg = b.new_page(viewport={'width': 1440, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
            pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
            pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
            pg.goto(ADMIN_WEB + '/#/users', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2000)
            seen['gate'] = pg.locator('[data-pii-gate]').count()
            if seen['gate']:
                pg.locator('[data-pii-reason="REVIEW"]').check(); pg.locator('[data-pii-reason-ok]').click(); pg.wait_for_timeout(2500)
            seen['after'] = pg.locator('[data-pii-gate]').count()
            pg.goto(ADMIN_WEB + '/#/deals', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2000)
            seen['deals'] = pg.locator('[data-pii-gate]').count()
        r = ui(run)
        if r is None:
            print('  (playwright 없음 — ③ 건너뜀)')
        else:
            seen, perr = r
            n_rev = psql(f"SELECT count(*) FROM audit.pii_access_logs WHERE reason = '사업자 승인 심사 · 사유 심사 · 인증' AND occurred_at >= '{t0}'")
            ok('③ 화면 — 회원 › 사업자 인증 열기 전 사유 묻기 → 「심사 · 인증」 고르면 화면 · 접속기록에 그 사유 · 4시간 안에는 거래 화면도 안 물음 · 화면 오류 없음',
               seen.get('gate') == 1 and seen.get('after') == 0 and seen.get('deals') == 0 and int(n_rev or 0) >= 1 and not perr, f'{seen} · {n_rev} · {perr[:2]}')
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
