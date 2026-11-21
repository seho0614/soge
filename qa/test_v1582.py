"""v10.582 (docs/724) 사내 자료실 · 공지 — 운영자만 · 권한그룹별 공개 범위 · 꼭 읽기 · 읽음 확인 · 사내 문서함 파일 방식 재사용
  ① (코드) SQL hra_lib_posts · reads · revisions · 지킴 · 공개 범위 함수 · 새 파일 용도 없음 · API 9 · 화면 · 메뉴 · 화면 목록 · 문서 724 · 판
  ② (DB · API) 쓰기(ADMIN) · 공개 범위(지급 담당 · 검수 담당) · 404 · 읽음 · 읽음 현황 · 고치기(고친 기록) · 보관 끝 · DB 지킴
  ③ (화면) 사무 › 사내 자료실 · 공지
  (두 번 돌아도 통과 — 「시험1582-」 글 · 읽음 · 고친 기록은 replica 로 지움)
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


def setting(key, value, tag):
    """설정 바꾸기(시험만 · 설정 무늬 검사는 그대로)"""
    v = 'NULL' if value is None else "'" + str(value).replace("'", "''") + "'"
    return psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 {tag}', true); UPDATE site_settings SET value = {v} WHERE key = '{key}'; COMMIT;")


def getset(key):
    return psql(f"SELECT coalesce(value, '') FROM site_settings WHERE key = '{key}'")


def migr(prefix):
    d = os.path.join(K, 'prisma', 'migrations')
    n = next((x for x in sorted(os.listdir(d)) if x.startswith(prefix)), None) if os.path.isdir(d) else None
    return open(os.path.join(d, n, 'migration.sql'), encoding='utf-8').read() if n else ''


def mig_has(word):
    """13차 SQL 은 메인이 D292 ~ 에 붙임(번호 모름) — 글자가 든 마이그레이션 하나를 찾아 돌려줌"""
    d = os.path.join(K, 'prisma', 'migrations')
    for n in (sorted(os.listdir(d)) if os.path.isdir(d) else []):
        p = os.path.join(d, n, 'migration.sql')
        if os.path.exists(p):
            t = open(p, encoding='utf-8').read()
            if word in t:
                return t
    return ''


def biz_days(n, year):
    """오늘 뒤 그 해 안 영업일 n개(없으면 짧은 목록)"""
    r = psql(f"SELECT string_agg(d::date::text, ',' ORDER BY d) FROM (SELECT d FROM generate_series((now() AT TIME ZONE 'Asia/Seoul')::date + 1, '{year}-12-31'::date, interval '1 day') d WHERE fn_is_business_day(d::date) ORDER BY d LIMIT {n}) x")
    return [x for x in (r or '').split(',') if re.match(r'^\d{4}-\d{2}-\d{2}$', x)]

"""시험 몸통"""
M = mig_has('CREATE TABLE IF NOT EXISTS public.hra_lib_posts')
LB = rd('src/modules/acct/hra-library.ts')
HC = rd('src/modules/acct/hra.controller.ts')
UI = rd('web/src/app/admin/Hra.tsx')
MN = rd('web/src/lib/adminMenu.ts')
AP = rd('web/src/App.tsx')
ok('① 코드 — SQL 글 · 읽음(쌓기만) · 고친 기록 · 지킴 트리거 · 붙은 파일 지킴 · 공개 범위 함수 · 새 파일 용도 없음 · 설정 처음 off · 권한 시드 · API 9 · 화면 · 메뉴(사내 문서함 뒤) · 화면 목록 HRA-020 · 문서 724 · 판 v10.582',
   'CREATE TABLE IF NOT EXISTS public.hra_lib_reads' in M and 'trg_hra_lib_reads_ro' in M and 'trg_hra_lib_post_guard' in M and 'trg_hra_lib_file_keep' in M
   and 'fn_hra_lib_can_read' in M and 'ck_files_purpose' not in re.sub(r'/\*.*?\*/', '', M, flags=re.S) and "('hra.lib_unread_alert', 'off'" in M
   and "('hra-library', '사내 자료실 · 공지', 'admoff'" in M and 'fn_hra_lib_can_read(p.id' in LB and "storageFromEnv().downloadTarget" in LB
   and "@Get('hra/library')" in HC and "@Get('hra/library/manage')" in HC and "@Get('hra/library/:id')" in HC and "@Post('hra/library/:id/read')" in HC
   and "@Get('hra/library/:id/file')" in HC and "@Post('hra/library')" in HC and "@Put('hra/library/:id')" in HC and "@Post('hra/library/:id/archive')" in HC
   and "@Get('hra/library/:id/reads')" in HC and HC.index("@Get('hra/library/manage')") < HC.index("@Get('hra/library/:id')")
   and 'export function HraLibrary' in UI and "['hra-library', '사내 자료실 · 공지']" in MN and "'corp-docs', ['hra-library']" in MN
   and "'hra-library': ['SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF']" in AP and '"SB-ADM-HRA-020"' in SJ
   and '공개 범위' in doc('724_') and VT >= (10, 582), VER)

STAMP = int(time.time()) % 1000000
TAG = f'시험1582-{STAMP}'
CLEAN = ("SET session_replication_role = replica; "
         "DELETE FROM hra_lib_reads WHERE post_id IN (SELECT id FROM hra_lib_posts WHERE title LIKE '시험1582-%'); "
         "DELETE FROM hra_lib_revisions WHERE post_id IN (SELECT id FROM hra_lib_posts WHERE title LIKE '시험1582-%'); "
         "DELETE FROM ops_alerts WHERE alert_code = 'HRA_LIB_UNREAD' AND detail->>'postId' IN (SELECT id::text FROM hra_lib_posts WHERE title LIKE '시험1582-%'); "
         "DELETE FROM hra_lib_posts WHERE title LIKE '시험1582-%';")
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    psql(CLEAN)
    ae, aid = mk_staff(f'1582a{STAMP % 97}', 'ADMIN'); consent_ok.agree(ae, PW); TA = login(ae)
    pe, pid = mk_staff(f'1582p{STAMP % 97}', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    re_, rid = mk_staff(f'1582r{STAMP % 97}', 'REVIEWER'); consent_ok.agree(re_, PW); TR = login(re_)
    try:
        c1 = call('POST', '/admin/hra/library', {'kind': 'NOTICE', 'title': f'{TAG} 지급 담당 공지', 'body': '12월 지급일은 24일입니다.', 'audience': ['R_PAYOUT'], 'mustRead': True, 'readDue': '2030-12-31'}, TA)
        c2 = call('POST', '/admin/hra/library', {'kind': 'NOTICE', 'title': f'{TAG} 모두 공지', 'body': '연말 근무 안내입니다.'}, TA)
        b1 = call('POST', '/admin/hra/library', {'kind': 'NOTICE', 'title': f'{TAG} 없는 그룹', 'body': '본문입니다.', 'audience': ['R_NOPE_X']}, TA)
        b2 = call('POST', '/admin/hra/library', {'kind': 'FILE', 'title': f'{TAG} 파일 없음'}, TA)
        b3 = call('POST', '/admin/hra/library', {'kind': 'NOTICE', 'title': f'{TAG} 지급 담당 씀', 'body': '본문입니다.'}, TP)
        ok('② 쓰기 — ADMIN 공지 2(권한그룹 · 모두) · 없는 권한그룹 422 · 파일 없는 자료 422 · 지급 담당 쓰기 403',
           c1.get('ok') is True and c2.get('ok') is True and b1.get('code') == 'HRA_LIB_AUDIENCE' and b2.get('code') == 'HRA_LIB_FILE' and b3.get('_err') == 403,
           f"{c1.get('ok') or c1} {c2.get('ok') or c2} {b1.get('code')} {b2.get('code')} {b3.get('_err')}")
        P1, P2 = c1.get('id'), c2.get('id')
        lp = call('GET', '/admin/hra/library', None, TP)
        lr = call('GET', '/admin/hra/library', None, TR)
        ids = lambda v: [x.get('id') for x in v.get('items') or []]
        gr = call('GET', f'/admin/hra/library/{P1}', None, TR)
        gp = call('GET', f'/admin/hra/library/{P1}', None, TP)
        fp = call('GET', f'/admin/hra/library/{P1}/file', None, TP)
        ok('② 공개 범위 — 지급 담당은 둘 다 보고 꼭 읽기 1 남음 · 검수 담당은 모두 공지만 · 검수 담당이 그룹 공지를 열면 404 · 지급 담당 본문 · 파일 없는 공지 파일 404',
           P1 in ids(lp) and P2 in ids(lp) and int(lp.get('mustReadLeft') or 0) >= 1 and P1 not in ids(lr) and P2 in ids(lr) and gr.get('_err') == 404
           and gp.get('body') == '12월 지급일은 24일입니다.' and gp.get('readAt') is None and fp.get('_err') == 404,
           f"{P1} {P2} {ids(lp)[:4]} {lp.get('mustReadLeft')} {ids(lr)[:4]} {gr.get('_err')} {gp.get('body')} {fp.get('_err')}")
        r1 = call('POST', f'/admin/hra/library/{P1}/read', None, TP)
        r2 = call('POST', f'/admin/hra/library/{P1}/read', None, TP)
        rr = call('POST', f'/admin/hra/library/{P1}/read', None, TR)
        dr = psql(f"DELETE FROM hra_lib_reads WHERE post_id = {P1}")
        rd_ = call('GET', f'/admin/hra/library/{P1}/reads', None, TA)
        me_ = next((x for x in rd_.get('rows') or [] if x.get('accountId') == pid), {})
        mg = call('GET', '/admin/hra/library/manage', None, TA)
        m1 = next((x for x in mg.get('items') or [] if x.get('id') == P1), {})
        ok('② 읽음 — 읽었습니다 · 두 번째 already · 대상 아니면 404 · 읽음 기록 지우기 막음 · 읽음 현황(가린 메일 · 읽은 시각) · 관리 목록 읽음 ≥ 1 / 대상 ≥ 1',
           r1.get('already') is False and r2.get('already') is True and rr.get('_err') == 404 and '!' in dr
           and bool(me_.get('readAt')) and '***@' in (me_.get('email') or '') and pe not in json.dumps(rd_, ensure_ascii=False)
           and int(m1.get('read') or 0) >= 1 and int(m1.get('target') or 0) >= int(m1.get('read') or 0),
           f"{r1.get('already')} {r2.get('already')} {rr.get('_err')} {dr[-50:]} {me_} {m1.get('read')}/{m1.get('target')}")
        e1 = call('PUT', f'/admin/hra/library/{P2}', {'title': f'{TAG} 모두 공지(고침)'}, TA)
        rv = psql(f"SELECT count(*) || '|' || max(before->>'title') FROM hra_lib_revisions WHERE post_id = {P2}")
        body2 = psql(f"SELECT body FROM hra_lib_posts WHERE id = {P2}")
        x1 = call('POST', f'/admin/hra/library/{P2}/archive', {'reason': '시험 보관 끝'}, TA)
        x2 = call('POST', f'/admin/hra/library/{P2}/archive', {'reason': '시험 보관 끝'}, TA)
        e2 = call('PUT', f'/admin/hra/library/{P2}', {'title': f'{TAG} 보관 뒤 고침'}, TA)
        lr2 = call('GET', '/admin/hra/library', None, TR)
        dp = psql(f"DELETE FROM hra_lib_posts WHERE id = {P2}")
        ok('② 고치기 · 보관 끝 — 고친 기록 1(고치기 전 제목) · 보낸 칸만(본문 그대로) · 보관 끝 · 다시 409 · 보관 뒤 고치기 409 · 목록에서 빠짐 · 글 지우기 막음',
           e1.get('ok') is True and rv == f'1|{TAG} 모두 공지' and body2 == '연말 근무 안내입니다.' and x1.get('ok') is True and x2.get('_err') == 409
           and e2.get('_err') == 409 and P2 not in ids(lr2) and 'HRA_LIB' in dp,
           f"{e1.get('ok') or e1} {rv} {body2} {x1.get('ok')} {x2.get('_err')} {e2.get('_err')} {dp[-50:]}")
        if ADMIN_WEB:
            def chk(pg, seen):
                pg.wait_for_selector('[data-hra-library]', timeout=30000); pg.wait_for_timeout(1500)
                seen['row'] = pg.locator(f'[data-hra-lib-manage-row="{P1}"]').count()
                seen['form'] = pg.locator('[data-hra-lib-form]').count()
            res = admin_page('/#/hra-library', chk)
            if res is None:
                print('  (playwright 없음 — ③ 건너뜀)')
            else:
                seen, perr = res
                ok('③ 화면 — 사내 자료실 관리 표에 시험 공지 · 글 올리기 칸 · 화면 오류 없음', seen.get('row') == 1 and seen.get('form') == 1 and not perr, f"{seen} {perr[:2]}")
        else:
            print('  (ADMIN_WEB 없음 — ③ 건너뜀)')
    finally:
        psql(CLEAN)
        for a_, t_ in ((aid, '1582a'), (pid, '1582p'), (rid, '1582r')):
            rm_role(a_, t_)
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
