"""v10.612 (docs/754) ㉘ 상담원별 답변 품질 — 회원 › 답변 품질(bzx-cs-quality)
  ① (코드) v10.337 처리 지표와 같은 근거 · 상담원별 · 표본 점검 · 살펴볼 상담원 표시만 · 화면 · SQL · 문서 754 · 판
  ② (API · DB) 시험 운영자 처음 답 1 · 해결 안 됨 · 다시 열림 100% · 가린 메일 · 표본 · 자기 답 409 · 점수 6 400 · 점검 · 다시 409 · 표본에서 빠짐 · 점수 3 · DB 고치기 막음 · 검수 403
  ③ (화면) 답변 품질 탭 · 상담원 줄 · 표본 점검 상자
  (두 번 돌아도 통과 — 「시험1612-」 문의 · 점검은 replica 로 지움 · 감사 기록은 쌓기만이라 남음(문의가 없으면 셈에서 빠짐))
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



def migr_has(text):
    """18차 SQL 은 메인이 마이그레이션 번호를 붙임(D292 ~) — 번호 없이 모든 마이그레이션에서 글자를 찾음"""
    d = os.path.join(K, 'prisma', 'migrations')
    if not os.path.isdir(d):
        return False
    for x in sorted(os.listdir(d)):
        p = os.path.join(d, x, 'migration.sql')
        if os.path.exists(p) and text in open(p, encoding='utf-8').read():
            return True
    return False


def job(name, tok):
    return call('POST', '/admin/jobs', {'job': name}, tok)


STAMP = int(time.time()) % 1000000
KST = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
TODAY = KST.strftime('%Y-%m-%d')
def day(n):
    return (KST + datetime.timedelta(days=n)).strftime('%Y-%m-%d')


"""시험 몸통"""
AQ, CT = rd('src/modules/bzx/answer-quality.ts'), rd('src/modules/bzx/bzx.controller.ts')
UI, AP, MN = rd('web/src/app/admin/Bzx.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
ok('① 코드 — v10.337 처리 지표와 같은 근거(감사 INQUIRY_ANSWER 처음 답 · 기한 · 만족도 · 다시 열림) · 상담원별 · 표본 점검(자기 답 409) · 살펴볼 상담원 표시만',
   all(f in AQ for f in ("l.action = 'INQUIRY_ANSWER'", 'DISTINCT ON (l.target_id)', "feedback = 'RESOLVED'", 'reopen_count > 0', "'BZX_CSQ_SELF'", "'BZX_CSQ_DONE'", '해결률 낮음', 'maskMail('))
   and "@Get('cs-quality')" in CT and "@Post('cs-quality/reviews')" in CT, f"{len(AQ)}")
ok('① 화면 · SQL · 문서 — 회원 › 답변 품질(bzx-cs-quality · SB-ADM-BZX-030) · 표본 점검 표 · 문서 754 · 판',
   'export function BzxCsQuality' in UI and "['bzx-cs-quality', '답변 품질']" in MN and "screen: 'SB-ADM-BZX-030'" in MN and "'bzx-cs-quality': ['ADMIN', 'SUPER']" in AP
   and '"SB-ADM-BZX-030"' in SJ and migr_has('CREATE TABLE IF NOT EXISTS public.bzx_answer_reviews') and migr_has("('bzx-cs-quality', '답변 품질', 'admusr'")
   and '표본' in doc('754_') and VT >= (10, 612), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    ae, aid = mk_staff(f'1612a{STAMP % 97}', 'ADMIN'); consent_ok.agree(ae, PW); TA = login(ae)
    re_, rid = mk_staff(f'1612r{STAMP % 97}', 'REVIEWER'); consent_ok.agree(re_, PW); TR = login(re_)
    def clean():
        psql("SET session_replication_role = replica; "
             "DELETE FROM bzx_answer_reviews WHERE inquiry_id IN (SELECT id FROM inquiries WHERE title LIKE '시험1612-%'); "
             "DELETE FROM notifications WHERE event_code = 'INQUIRY_ANSWERED' AND body LIKE '%시험1612-%'; "
             "DELETE FROM inquiries WHERE title LIKE '시험1612-%';")
    clean()
    try:
        cat = psql("SELECT code FROM code_labels WHERE domain = 'inquiry.category' AND is_active ORDER BY sort_order LIMIT 1")
        q = call('POST', '/inquiries', {'category': cat, 'title': f'시험1612-{STAMP}', 'body': '시험 1612 답변 품질 문의입니다.'}, TB)
        iid = str(q.get('id') or '')
        an = call('POST', f'/admin/inquiries/{iid}/answer', {'answer': '시험 1612 답변입니다.'}, TA)
        fb = call('POST', f'/me/inquiries/{iid}/feedback', {'resolved': False}, TB)
        time.sleep(1.2)
        cq = call('GET', '/admin/bzx/cs-quality?days=7', None, TS)
        me_ = next((x for x in cq.get('agents') or [] if x.get('agent') == aid), {})
        ok('② 상담원 지표 — 시험 운영자가 처음 답 1 · 아직 해결 안 됨 1 · 다시 열림 100% · 가린 메일 · 기간 7일',
           len(iid) == 36 and an.get('ok') is not False and fb.get('feedback') == 'UNRESOLVED' and cq.get('days') == 7
           and me_.get('answered') == 1 and me_.get('unresolved') == 1 and me_.get('reopenRate') == 100 and '***@' in (me_.get('email') or '') and ae not in json.dumps(cq, ensure_ascii=False),
           f"{iid} {an.get('_err')} {fb.get('feedback')} {me_}")
        sm = call('GET', f'/admin/bzx/cs-quality/samples?agent={aid}', None, TS)
        self_ = call('POST', '/admin/bzx/cs-quality/reviews', {'inquiryId': iid, 'accuracy': 5, 'kindness': 5, 'completeness': 5}, TA)
        bad = call('POST', '/admin/bzx/cs-quality/reviews', {'inquiryId': iid, 'accuracy': 6, 'kindness': 5, 'completeness': 5}, TS)
        rv = call('POST', '/admin/bzx/cs-quality/reviews', {'inquiryId': iid, 'accuracy': 2, 'kindness': 3, 'completeness': 4, 'note': '시험 1612'}, TS)
        again = call('POST', '/admin/bzx/cs-quality/reviews', {'inquiryId': iid, 'accuracy': 2, 'kindness': 3, 'completeness': 4}, TS)
        sm2 = call('GET', f'/admin/bzx/cs-quality/samples?agent={aid}', None, TS)
        cq2 = call('GET', '/admin/bzx/cs-quality?days=7', None, TS)
        me2 = next((x for x in cq2.get('agents') or [] if x.get('agent') == aid), {})
        ok('② 표본 점검 — 표본에 그 문의 · 자기 답 409 BZX_CSQ_SELF · 점수 6 은 400 · 점검 남김 · 다시 409 BZX_CSQ_DONE · 점검한 문의는 표본에서 빠짐 · 점검 1건 3점',
           any(x.get('id') == iid for x in sm.get('items') or []) and self_.get('_err') == 409 and self_.get('code') == 'BZX_CSQ_SELF' and bad.get('_err') == 400
           and rv.get('ok') is True and again.get('_err') == 409 and again.get('code') == 'BZX_CSQ_DONE' and not any(x.get('id') == iid for x in sm2.get('items') or [])
           and me2.get('reviews') == 1 and me2.get('score') == 3,
           f"{len(sm.get('items') or [])} {self_.get('code')} {bad.get('_err')} {rv} {again.get('code')} {me2.get('reviews')} {me2.get('score')}")
        g = psql(f"UPDATE bzx_answer_reviews SET accuracy = 5 WHERE inquiry_id = '{iid}'")
        rr = call('GET', '/admin/bzx/cs-quality', None, TR)
        ok('② DB 가 점검 고치기를 막음 · 검수(REVIEWER) 403', 'BZX_CSQ' in g and rr.get('_err') == 403, f"{g[-50:]} {rr.get('_err')}")
        if ADMIN_WEB:
            def chk(pg, seen):
                pg.wait_for_selector('[data-bzx-csq]', timeout=30000); pg.wait_for_timeout(800)
                seen['agent'] = pg.locator(f'[data-bzx-csq-agent="{aid}"]').count()
                seen['samples'] = pg.locator('[data-bzx-csq-samples]').count()
            res3 = admin_page('/#/bzx-cs-quality', chk)
            if res3 is None:
                print('  (playwright 없음 — ③ 건너뜀)')
            else:
                seen, perr = res3
                ok('③ 화면 — 회원 › 답변 품질 · 상담원 줄 · 표본 점검 상자 · 화면 오류 없음', seen.get('agent') == 1 and seen.get('samples') == 1 and not perr, f"{seen} {perr[:2]}")
    finally:
        clean()
        rm_role(aid, '1612a'); rm_role(rid, '1612r')
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
