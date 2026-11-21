"""v10.594 (docs/736) ⑩ 운영 화면 「?」 도움말 — 사용자 설명서 표 help_docs(D180) 재사용 · ADMIN_GUIDE 1판
  ① (코드) HelpService.sections · ADMIN_GUIDE(없을 때만 · [탭 키]) · 찾는 순서 · App 제목 줄 HelpTip(h1 밖) · 메뉴 · 화면 · 권한 시드 · 문서 736 · 판
  ② (API · DB) [탭 키] · 탭 이름 · 없음 · 잘못된 키 422 · 잇기 LINK · 없는 절 422 · 지우기 · 404 · 검수자 읽기 · ADMIN 잇기 403 · 같은 본문 판 그대로 · 400 · 422 · USER_MANUAL 그대로
  ③ (ADMIN_WEB) 운영 대시보드 「?」 → 절 제목
  (두 번 돌아도 통과 — 새 판을 만들지 않음(같은 본문) · 잇기 zz-1594 · 시험 계정은 지움)
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


"""시험 몸통 — 15차 보안 · 기반 공통 도우미"""
def migs_all():
    d = os.path.join(K, 'prisma', 'migrations')
    if not os.path.isdir(d):
        return ''
    return '\n'.join(open(os.path.join(d, x, 'migration.sql'), encoding='utf-8').read() for x in sorted(os.listdir(d)) if os.path.exists(os.path.join(d, x, 'migration.sql')))


MIG = migs_all()
SJ = rd('spec/screens.json')
STAMP = int(time.time()) % 1000000


def sec2_set(tok, body, tag):
    """설정은 API 로(서버 30초 메모리를 그 자리에서 지움)"""
    return call('PUT', '/admin/sec2/settings', {**body, 'reason': f'시험 {tag}'}, tok)


def mk_member(tag):
    em, aid = mk_staff(tag, None)
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag}', true); INSERT INTO account_roles (account_id, role) VALUES ('{aid}', 'MEMBER') ON CONFLICT DO NOTHING; COMMIT;")
    return em, aid


def rm_accounts(like):
    """시험 계정과 딸린 보안 줄을 지움(replica — 쌓기만 표 · 외래 키 트리거를 건너뜀)"""
    ids = f"(SELECT id FROM accounts WHERE email LIKE '{like}')"
    return psql("SET session_replication_role = replica; "
                f"DELETE FROM sec2_login_alerts WHERE account_id IN {ids}; DELETE FROM sec2_mfa_tickets WHERE account_id IN {ids}; "
                f"DELETE FROM sec2_staff_anomalies WHERE account_id IN {ids}; DELETE FROM account_mfa WHERE account_id IN {ids}; "
                f"DELETE FROM login_sessions WHERE account_id IN {ids}; DELETE FROM login_history WHERE account_id IN {ids}; "
                f"DELETE FROM notifications WHERE account_id IN {ids}; DELETE FROM term_agreements WHERE account_id IN {ids}; "
                f"DELETE FROM account_roles WHERE account_id IN {ids}; DELETE FROM accounts WHERE email LIKE '{like}';")


TH, HT, AP, AM, SH = rd('src/modules/sec2/tab-help.ts'), rd('web/src/components/HelpTip.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('web/src/app/admin/ScxHelp.tsx')
ok('① 코드 — 사용자 설명서 표 help_docs 재사용(HelpService.sections · v_help_doc_current) · ADMIN_GUIDE 1판(없을 때만 · [탭 키]) · 찾는 순서 LINK → KEY → LABEL → MANUAL · 문서 736 · 판 v10.594',
   'HelpService.sections' in TH and 'v_help_doc_current' in TH and "SELECT 'ADMIN_GUIDE', 1, '운영 화면 도움말'" in MIG
   and "WHERE NOT EXISTS (SELECT 1 FROM public.help_docs WHERE code = 'ADMIN_GUIDE')" in MIG and '### 운영 알림 [ops-alerts]' in MIG
   and all(v in TH for v in ("'LINK'", "'KEY'", "'LABEL'", "'MANUAL'")) and 'ADMIN_GUIDE' in doc('736_') and VT >= (10, 594), VER)
ok('① 화면 — 모든 탭 제목 줄 HelpTip(h1 밖 · 누를 때만 부름) · 관 관리 › 화면 도움말(scx-help) · 화면 목록 SB-ADM-SCX-020 · 권한 시드(도움말 읽기는 여러 업무)',
   '<HelpTip tab={tab} label={page.title} />\n            <h1>{page.title}</h1>' in AP and 'data-help-tip' in HT and '/admin/help/tab?key=' in HT and "['scx-help', '화면 도움말']" in AM and "'manual', ['scx-help']" in AM and '<ScxHelp />' in AP and 'data-scx-help' in SH
   and '"SB-ADM-SCX-020"' in SJ and "('GET', '/admin/help/tab', 'home', 'VIEW')" in MIG and "('GET', '/admin/help/tab', 'my-hr', 'VIEW')" in MIG, '')

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    LIKE = 't1594%@x.com'
    rm_accounts(LIKE)
    psql("DELETE FROM sec2_tab_help WHERE tab_key = 'zz-1594'")
    q = urllib.parse.quote
    try:
        um0 = psql("SELECT max(version) FROM help_docs WHERE code = 'USER_MANUAL'")
        h1 = call('GET', f"/admin/help/tab?key=ops-alerts&label={q('운영 알림')}", None, TS)
        h2 = call('GET', f"/admin/help/tab?key=zz-1594&label={q('회원 목록')}", None, TS)
        h3 = call('GET', f"/admin/help/tab?key=zz-1594&label={q('없는탭이름1594')}", None, TS)
        h4 = call('GET', f"/admin/help/tab?key={q('A B')}", None, TS)
        ok('② 찾기 — [탭 키](ops-alerts · KEY · 제목에서 [키] 뗌) · 탭 이름(LABEL) · 없으면 found false · 잘못된 키 422 · SUPER 는 이을 절 목록',
           h1.get('found') is True and h1.get('via') == 'KEY' and (h1.get('section') or {}).get('heading') == '운영 알림' and h1.get('docCode') == 'ADMIN_GUIDE'
           and h2.get('via') == 'LABEL' and h3.get('found') is False and h4.get('code') == 'SEC2_TAB_KEY' and len(h1.get('choices') or []) >= 10,
           f"{h1.get('via')} {(h1.get('section') or {}).get('heading')} {h2.get('via')} {h3.get('found')} {h4.get('code')}")
        k1 = call('PUT', '/admin/help/tab-links/zz-1594', {'docCode': 'ADMIN_GUIDE', 'heading': '운영 알림 [ops-alerts]'}, TS)
        h5 = call('GET', f"/admin/help/tab?key=zz-1594&label={q('없는탭이름1594')}", None, TS)
        k2 = call('PUT', '/admin/help/tab-links/zz-1594', {'docCode': 'ADMIN_GUIDE', 'heading': '없는 절 1594'}, TS)
        ls = call('GET', '/admin/help/tab-links', None, TS)
        k3 = call('POST', '/admin/help/tab-links/zz-1594/remove', {}, TS)
        k4 = call('POST', '/admin/help/tab-links/zz-1594/remove', {}, TS)
        ok('② 잇기(SUPER) — 이음 → via LINK · 없는 절 422 SEC2_NO_SECTION · 목록 · 지우기 · 두 번 404',
           k1.get('ok') is True and h5.get('via') == 'LINK' and k2.get('code') == 'SEC2_NO_SECTION' and any(x.get('tabKey') == 'zz-1594' for x in ls.get('items') or [])
           and k3.get('ok') is True and k4.get('_err') == 404, f"{k1} {h5.get('via')} {k2.get('code')} {k3} {k4.get('_err')}")
        re_, rid = mk_staff(f'1594r{STAMP % 97}', 'REVIEWER'); consent_ok.agree(re_, PW); TR = login(re_)
        ae, aid = mk_staff(f'1594a{STAMP % 97}', 'ADMIN'); consent_ok.agree(ae, PW); TA = login(ae)
        hr = call('GET', f"/admin/help/tab?key=home&label={q('운영 대시보드')}", None, TR)
        ka = call('PUT', '/admin/help/tab-links/zz-1594', {'docCode': 'ADMIN_GUIDE', 'heading': '운영 알림 [ops-alerts]'}, TA)
        ga = call('GET', '/admin/help/guide', None, TA)
        ok('② 역할 — 검수자도 「?」 읽음(이을 절 목록 없음) · ADMIN 잇기 403 · ADMIN 도움말 읽기 200(canEdit false)',
           hr.get('found') is True and hr.get('choices') == [] and ka.get('_err') == 403 and isinstance(ga.get('current'), dict) and ga.get('canEdit') is False,
           f"{hr.get('found')} {hr.get('choices')} {ka.get('_err')} {ga.get('canEdit')}")
        g = call('GET', '/admin/help/guide', None, TS)
        body = (g.get('current') or {}).get('body') or ''
        v0 = (g.get('current') or {}).get('version')
        sv = call('POST', '/admin/help/guide', {'body': body, 'note': '시험1594 같은 본문'}, TS)
        s1 = call('POST', '/admin/help/guide', {'body': '짧음'}, TS)
        s2 = call('POST', '/admin/help/guide', {'body': '절 제목 없는 글입니다. ' * 10}, TS)
        s3 = call('POST', '/admin/help/guide', {'body': body}, TA)
        ok('② 저장 — 같은 본문이면 판을 만들지 않음 · 짧음 400 · 절 없음 422 HELP_NO_SECTION · ADMIN 403 · 회원 설명서(USER_MANUAL) 판 그대로',
           sv.get('ok') is True and sv.get('version') == v0 and s1.get('_err') == 400 and s2.get('code') == 'HELP_NO_SECTION' and s3.get('_err') == 403
           and psql("SELECT max(version) FROM help_docs WHERE code = 'USER_MANUAL'") == um0, f"{sv} {s1.get('_err')} {s2.get('code')} {s3.get('_err')}")
        if ADMIN_WEB:
            def chk(pg, seen):
                pg.click('[data-help-tip]'); pg.wait_for_timeout(2500)
                seen['h'] = pg.locator('[data-help-heading]').first.inner_text() if pg.locator('[data-help-heading]').count() else ''
            u = admin_page('/#/home', chk)
            if u is not None:
                seen, perr = u
                ok('③ 화면 — 운영 대시보드 제목 옆 「?」 → 절 「운영 대시보드」', seen.get('h') == '운영 대시보드' and not perr, f"{seen} {perr[:2]}")
    finally:
        psql("DELETE FROM sec2_tab_help WHERE tab_key = 'zz-1594'")
        rm_accounts(LIKE)
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
