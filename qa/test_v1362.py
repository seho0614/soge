"""v10.362 (D237 · docs/496) 가입 차단 목록
  ① (코드) D237 · 가입 · 본인인증 확인 · API · 화면 · 알림 · 영어 · 문서 496 · 판 v10.362
  ② (API) 도메인 차단 · 셈 · 409 · 422 · 403 · 풀기
  ③ (사람) 본인인증 고유값
  ④ (화면) 위험감지 상자
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


def admin_page(path, fn):
    def run(b, seen, perr):
        pg = b.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: perr.append(str(e)[:120]))
        pg.goto(ADMIN_WEB + "/", wait_until="networkidle", timeout=120000)
        pg.fill("input[name=email]", "admin@x.com"); pg.fill("input[name=password]", PW); pg.click("button[type=submit]"); pg.wait_for_timeout(3000)
        pg.goto(ADMIN_WEB + path, wait_until="networkidle", timeout=120000); pg.wait_for_timeout(3000)
        fn(pg, seen)
    return ui(run)


M37, MC, SB, AS, IV = (rd('prisma/migrations/D237_member_notes_signup_blocks/migration.sql'), rd('src/modules/admin/member-ops.controller.ts'), rd('src/modules/identity/signup-block.ts'),
                      rd('src/modules/identity/auth.service.ts'), rd('src/modules/identity/identity-verify.service.ts'))
BX, RA, SC, STX = rd('web/src/app/admin/MemberOpsBoxes.tsx'), rd('web/src/app/admin/RiskAlerts.tsx'), rd('src/worker/scheduler.service.ts'), rd('src/common/i18n/server-text.en.ts')
ok('① 코드 — D237 signup_blocks(지우기 막음 · 풀기 한 번) · 막힌 수 · 가입(도메인 · IP) · 본인인증(사람) 확인 · 이유 안 알림 · API(SUPER 더하기 · 풀기 · 감사) · 화면 · 알림 · 영어 · 문서 496 · 판 v10.362',
   'CREATE TABLE IF NOT EXISTS public.signup_blocks' in M37 and 'trg_signup_blocks_guard' in M37 and 'CREATE TABLE IF NOT EXISTS public.signup_block_hits' in M37
   and 'await assertSignupAllowed(this.db, input.email, clientIpRaw())' in AS and 'await assertPersonAllowed(this.db, h.h)' in IV and "'SIGNUP_BLOCKED'" in SB
   and "@Audit('SIGNUP_BLOCK_ADD', 'SETTING')" in MC and "@Audit('SIGNUP_BLOCK_REMOVE', 'SETTING')" in MC and '<SignupBlocksBox />' in RA and 'data-member-block' in BX
   and "'SIGNUP_BLOCK_SPIKE', 'WARN'" in SC and '지금은 가입할 수 없습니다. 고객센터로 문의해 주십시오.' in STX and '가입 차단은 풀기(한 번)만 할 수 있습니다.' in STX
   and '사람' in doc('496_') and VT >= (10, 362), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    em, adm = mk_staff('1362')
    consent_ok.agree(em, PW); TA = login(em)
    stamp = int(time.time()) % 100000
    DOM = f't1362x{stamp}.example'
    PWS = 'Signup-Test-1362!'
    try:
        h0 = int(psql("SELECT coalesce(sum(n), 0) FROM signup_block_hits WHERE day = (now() AT TIME ZONE 'Asia/Seoul')::date AND kind = 'EMAIL_DOMAIN'") or 0)
        b1 = call('POST', '/admin/signup-blocks', {'kind': 'EMAIL_DOMAIN', 'value': DOM, 'reason': '시험 1362 스팸 도메인', 'expiresDays': 7}, TS)
        s1 = call('POST', '/auth/signup', {'email': f'a{stamp}@{DOM}', 'password': PWS, 'name': '시험가입'})
        s2 = call('POST', '/auth/signup', {'email': f'b{stamp}@mail.{DOM}', 'password': PWS, 'name': '시험가입'})
        s3 = call('POST', '/auth/signup', {'email': f'c{stamp}@ok{stamp}.example', 'password': PWS, 'name': '시험가입'})
        h1 = int(psql("SELECT coalesce(sum(n), 0) FROM signup_block_hits WHERE day = (now() AT TIME ZONE 'Asia/Seoul')::date AND kind = 'EMAIL_DOMAIN'") or 0)
        dup = call('POST', '/admin/signup-blocks', {'kind': 'EMAIL_DOMAIN', 'value': DOM, 'reason': '시험 1362 다시'}, TS)
        bad = call('POST', '/admin/signup-blocks', {'kind': 'IP_CIDR', 'value': 'not-ip', 'reason': '시험 1362'}, TS)
        fa = call('POST', '/admin/signup-blocks', {'kind': 'EMAIL_DOMAIN', 'value': f'z{DOM}', 'reason': '시험 1362'}, TA)
        bid = b1.get('id')
        de = psql(f"DELETE FROM signup_blocks WHERE id = {bid or 0}")
        r1 = call('POST', f'/admin/signup-blocks/{bid}/remove', {'reason': '시험 1362 풂'}, TS)
        s4 = call('POST', '/auth/signup', {'email': f'd{stamp}@{DOM}', 'password': PWS, 'name': '시험가입'})
        r2 = call('POST', f'/admin/signup-blocks/{bid}/remove', {'reason': '시험 1362 또 풂'}, TS)
        ok('② API — 도메인 차단 → 그 도메인 · 하위 도메인 가입 422 SIGNUP_BLOCKED(이유 안 알림) · 다른 도메인 됨 · 막힌 수 +2 · 이미 409 · 잘못된 IP 422 · ADMIN 더하기 403 · 지우기 막힘 · 풀기 → 가입 됨 · 다시 풀기 404',
           b1.get('ok') is True and s1.get('code') == 'SIGNUP_BLOCKED' and s2.get('code') == 'SIGNUP_BLOCKED' and '도메인' not in (s1.get('message') or '') and s3.get('accessToken')
           and h1 - h0 == 2 and dup.get('_err') == 409 and bad.get('code') == 'SIGNUP_BLOCK_VALUE' and fa.get('_err') == 403 and '!' in de
           and r1.get('ok') is True and s4.get('accessToken') and r2.get('_err') == 404,
           f"{s1.get('code')} {s2.get('code')} {bool(s3.get('accessToken'))} · 셈 {h1 - h0} · {dup.get('_err')} {bad.get('code')} {fa.get('_err')} · {r1.get('ok')} {bool(s4.get('accessToken'))} {r2.get('_err')}")
        em2, mem = mk_staff('1362p', role=None)
        p0 = call('POST', '/admin/signup-blocks', {'kind': 'PERSON', 'accountId': mem, 'reason': '시험 1362 사람'}, TS)
        ci = f'{stamp:064d}'
        psql(f"INSERT INTO identity_verifications (account_id, provider, result, ci_hash, completed_at) VALUES ('{mem}', 'PASS', 'SUCCESS', '{ci}', now())")
        p1 = call('POST', '/admin/signup-blocks', {'kind': 'PERSON', 'accountId': mem, 'reason': '시험 1362 사람'}, TS)
        lst = call('GET', '/admin/signup-blocks', None, TS)
        prow = next((x for x in (lst.get('active') or []) if x.get('id') == p1.get('id')), {})
        val = psql(f"SELECT value FROM signup_blocks WHERE id = {p1.get('id') or 0}")
        ok('③ 사람 — 본인인증 안 한 회원 422 SIGNUP_BLOCK_NO_CI · 본인인증 기록 뒤 사람 차단 · 값은 고유값 해시 · 목록에는 가린 이메일 · 값 가림',
           p0.get('code') == 'SIGNUP_BLOCK_NO_CI' and p1.get('ok') is True and val == ci and prow.get('value') == '(본인인증 고유값)' and '@' in (prow.get('label') or ''),
           f"{p0.get('code')} {p1.get('ok')} · {prow}")
        if p1.get('id'):
            call('POST', f"/admin/signup-blocks/{p1.get('id')}/remove", {'reason': '시험 1362 풂'}, TS)
        if ADMIN_WEB:
            def chk(pg, seen):
                seen['box'] = pg.locator('[data-signup-blocks]').count(); seen['add'] = pg.locator('[data-signup-block-add]').count()
            r = admin_page('/#/risk', chk)
            if r is None:
                print('  (playwright 없음 — ④ 건너뜀)')
            else:
                seen, perr = r
                ok('④ 화면 — 위험감지 › 「가입 차단 목록」 · 더하기(SUPER) · 화면 오류 없음', seen.get('box') == 1 and seen.get('add') == 1 and not perr, f'{seen} · {perr[:2]}')
        else:
            print('  (ADMIN_WEB 없음 — ④ 건너뜀)')
    finally:
        psql(f"SET session_replication_role = replica; UPDATE signup_blocks SET removed_at = now(), removed_reason = '시험 1362 지움' WHERE reason LIKE '시험 1362%' AND removed_at IS NULL")
        rm_role(adm, '1362')
else:
    print('  (API · DB 없음 — ② ~ ④ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
