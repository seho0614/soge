"""v10.361 (D237 · docs/495) 회원 운영 메모
  ① (코드) D237 · API · 감사 · 화면 · 내려받기 없음 · 문서 495 · 판 v10.361 · 마이그레이션 275
  ② (API · DB) 메모 · 422 · 404 · 고치기 막힘 · 403
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


M37, MC = rd('prisma/migrations/D237_member_notes_signup_blocks/migration.sql'), rd('src/modules/admin/member-ops.controller.ts')
MB, ID, BX, PV = rd('web/src/app/admin/Members.tsx'), rd('web/src/app/admin/InquiryDesk.tsx'), rd('web/src/app/admin/MemberOpsBoxes.tsx'), rd('src/modules/identity/privacy.service.ts')
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(x for x in (os.listdir(MD) if os.path.isdir(MD) else []) if x[:1] in 'ABCD')
ok('① 코드 — D237 member_notes(쌓기만) · API(ADMIN · SUPER · 감사 MEMBER_NOTE_ADD) · 회원 상세 · 문의 · 내 정보 내려받기는 읽지 않음 · 지우는 문장 없음 · 문서 495 · 판 v10.361 · 마이그레이션 275',
   'CREATE TABLE IF NOT EXISTS public.member_notes' in M37 and 'trg_member_notes_ro' in M37 and not re.search(r'\b(DROP|DELETE FROM|TRUNCATE)\b', M37)
   and "@Audit('MEMBER_NOTE_ADD', 'ACCOUNT')" in MC and '<MemberNotesBox accountId={id} />' in MB and '<MemberNotesBox accountId={d.accountId} compact />' in ID
   and 'member_notes' not in PV and 'data-member-note-add' in BX and '운영 메모' in doc('495_') and VT >= (10, 361) and len(mig) >= 275 and 'D237_member_notes_signup_blocks' in mig, f'{VER} · 마이그레이션 {len(mig)}')
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    em, tgt = mk_staff('1361', role=None)
    n1 = call('POST', f'/admin/accounts/{tgt}/notes', {'body': '시험 1361 첫 메모 — 전화 문의'}, TS)
    time.sleep(0.2)
    n2 = call('POST', f'/admin/accounts/{tgt}/notes', {'body': '시험 1361 중요 메모', 'important': True}, TS)
    g = call('GET', f'/admin/accounts/{tgt}/notes', None, TS)
    short = call('POST', f'/admin/accounts/{tgt}/notes', {'body': 'a'}, TS)
    nf = call('POST', '/admin/accounts/00000000-0000-4000-8000-000000000000/notes', {'body': '없는 회원 메모'}, TS)
    fb = call('GET', f'/admin/accounts/{tgt}/notes', None, TB)
    up = psql(f"UPDATE member_notes SET body = '바꿈' WHERE account_id = '{tgt}'")
    aud = psql("SELECT count(*) FROM audit.audit_logs WHERE action = 'MEMBER_NOTE_ADD' AND occurred_at > now() - interval '10 minutes'")
    rows = g.get('rows') or []
    ok('② API · DB — 메모 둘(하나 중요) · 최근 순 · 중요 수 1 · 쓴 사람 가림 · 감사 · 1자 422 · 없는 회원 404 · 고치기 막힘 · 회원 403',
       n1.get('ok') is True and n2.get('ok') is True and g.get('total') == 2 and g.get('important') == 1 and rows[0].get('important') is True
       and '@' in (rows[0].get('by') or '') and int(aud or 0) >= 2 and short.get('code') == 'MEMBER_NOTE_BODY' and nf.get('_err') == 404
       and fb.get('_err') == 403 and '!' in up, f"{g.get('total')} {g.get('important')} · {short.get('code')} {nf.get('_err')} {fb.get('_err')} · {up[-40:]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
