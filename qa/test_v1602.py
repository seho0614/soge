"""v10.602 (docs/744) ⑱ 매물 CSV 일괄 등록 — 미리보기 → 확정 → 검수 큐
  ① (코드) lsq 모듈 · 확정은 기존 매물 등록 함수(ListingService.submit) · 본인인증 문 · 받지 않는 칸 · 연락처 가림 · SQL 두 표 · 설정 · 권한 시드 · 화면 · 문서 744 · 판
  ② (API · DB) 꺼짐 409 · 이름 칸 422 · 미리보기(등록 가능 1 · 고칠 것 1) · 확정(등록 또는 사유) · 두 번 확정 409 · 운영 한눈에 · 화면
  (두 번 돌아도 통과 — 시험 회원 · 묶음 · 만든 매물은 끝에 replica 로 지움 · 설정은 되돌림)
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


"""lsq 공통(17차) — 마이그레이션은 번호를 모르므로 글자로 찾음 · 설정 되돌리기 · 머리글 정해 부르기"""
def mig_lsq():
    d = os.path.join(K, 'prisma', 'migrations')
    for n in (sorted(os.listdir(d)) if os.path.isdir(d) else []):
        p = os.path.join(d, n, 'migration.sql')
        if os.path.exists(p):
            s = open(p, encoding='utf-8').read()
            if 'CREATE TABLE IF NOT EXISTS public.lsq_bulk_jobs' in s:
                return s
    return ''


def src(rel):
    return rd('src/modules/lsq/' + rel)


def call_h(m_, p, b=None, t=None, extra=None):
    hd = {'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (test lsq)'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    hd.update(extra or {})
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=180).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


class Keep:
    """설정 값 기억 → 끝에 되돌림"""
    def __init__(self, keys, tag):
        self.keys, self.tag = keys, tag
        self.old = {k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'") for k in keys}

    def back(self):
        for k, v in self.old.items():
            setting(k, v if v != '' else None, self.tag + ' 되돌림')


ML = mig_lsq()
SJD = json.loads(SJ) if SJ.strip().startswith('{') else {'screens': []}
SCREEN_IDS = {s.get('id') for s in SJD.get('screens', [])}
STAMP = int(time.time()) % 1000000
LETTERS = ''.join('가나다라마바사아자차'[int(c)] for c in str(STAMP))   # 숫자 없는 꼬리표(검색 낱말 규칙 — 숫자 3자리 이상은 버림)

"""시험 몸통"""
B = src('bulk.ts'); CT = src('lsq.controller.ts')
ok('① 코드 — 확정은 listings.submit(검수 큐) · 받지 않는 칸 LSQ_BULK_COLUMNS · 연락처 가림 · 두 번 눌러도 한 번(PREVIEW → DONE 잠금) · 본인인증 문 · 표 lsq_bulk_jobs · lsq_bulk_rows · 설정 lsq.bulk off · 권한 lsq-bulk · 화면 · 문서 744 · 판 v10.602',
   'await listings.submit(' in B and 'LSQ_BULK_COLUMNS' in B and 'lsqMask(' in B and "SET state = 'DONE', confirmed_at = now() WHERE id = $1::bigint AND state = 'PREVIEW'" in B
   and "@RequireGate('IDENTITY_VERIFIED')" in CT and 'lsq_bulk_rows' in ML and "('lsq.bulk', 'off'" in ML and "('GET', '/admin/lsq/bulk', 'lsq-bulk', 'VIEW')" in ML
   and 'SB-MYP-LSQ-010' in SCREEN_IDS and 'SB-ADM-LSQ-010' in SCREEN_IDS and rd('site/src/app/my/listings/bulk/page.tsx') and 'v10.602' in doc('744_') and VT >= (10, 602), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    keep = Keep(['lsq.bulk', 'lsq.bulk_max_rows'], '시험1602')
    em, aid = mk_staff('1602', 'MEMBER')
    consent_ok.agree(em, PW)
    TM = login(em)
    made = []
    def clean():
        ids = psql(f"SELECT string_agg(quote_literal(listing_id::text), ',') FROM lsq_bulk_rows r JOIN lsq_bulk_jobs j ON j.id = r.job_id WHERE j.account_id = '{aid}' AND r.listing_id IS NOT NULL")
        ids = ids if ids and not ids.startswith('!') else ''
        if ids:
            tabs = psql("SELECT string_agg(c.table_name, ',') FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name WHERE c.table_schema = 'public' AND c.column_name = 'listing_id' AND t.table_type = 'BASE TABLE'").split(',')
            sql = "SET session_replication_role = replica; "
            sql += f"DELETE FROM review_events WHERE review_item_id IN (SELECT id FROM review_items WHERE target_id::text IN ({ids})); DELETE FROM review_items WHERE target_id::text IN ({ids}); "
            for tb in [x for x in tabs if x and x != 'lsq_bulk_rows']:
                sql += f"DELETE FROM {tb} WHERE listing_id::text IN ({ids}); "
            sql += f"DELETE FROM listings WHERE id::text IN ({ids});"
            psql(sql)
        psql(f"SET session_replication_role = replica; DELETE FROM lsq_bulk_jobs WHERE account_id = '{aid}';")
    try:
        cat = psql("SELECT name FROM categories WHERE gwan_code = 'MNY' AND status = 'APPROVED' AND restricted_code IS NULL AND name !~ '[\",]' ORDER BY name LIMIT 1")
        rg = psql("SELECT sido FROM regions WHERE is_active AND sigungu IS NULL ORDER BY sort_order LIMIT 1")
        csv = ('gwan,category,title,summary,body,deal_amount,desired_fee,region\n'
               f'MNY,{cat},시험1602 일괄 등록 매물입니다,한줄 소개,"문의는 010-1234-5678 로 주세요 — 30자 넘는 본문을 적어 자동검수 기준을 맞춥니다 시험",50000000,1000000,{rg}\n'
               f'XXX,{cat},시험1602 잘못된 관,,,abc,,\n')
        setting('lsq.bulk', 'off', '시험1602')
        off = call('POST', '/lsq/me/bulk/preview', {'csv': csv}, TM)
        setting('lsq.bulk', 'on', '시험1602')
        cols = call('POST', '/lsq/me/bulk/preview', {'csv': 'gwan,category,title,phone\nMNY,a,b,010'}, TM)
        pv = call('POST', '/lsq/me/bulk/preview', {'csv': csv, 'fileName': 'test1602.csv'}, TM)
        ok('② 미리보기 — 꺼짐 409 LSQ_BULK_OFF · 전화 칸 422 LSQ_BULK_COLUMNS · 등록 가능 1 · 고칠 것 1(관 · 금액) · 본문 전화번호 가림',
           off.get('_err') == 409 and off.get('code') == 'LSQ_BULK_OFF' and cols.get('_err') == 422 and cols.get('code') == 'LSQ_BULK_COLUMNS'
           and pv.get('valid') == 1 and pv.get('invalid') == 1 and '010-1234-5678' not in json.dumps(pv, ensure_ascii=False)
           and len((pv.get('items') or [{}, {}])[1].get('problems') or []) >= 2, f"{off.get('code')} {cols.get('code')} {pv.get('valid')} {pv.get('invalid')} {str(pv)[:160]}")
        cf = call('POST', f"/lsq/me/bulk/{pv.get('jobId')}/confirm", None, TM) if pv.get('jobId') else {}
        again = call('POST', f"/lsq/me/bulk/{pv.get('jobId')}/confirm", None, TM) if pv.get('jobId') else {}
        lid = next((r.get('listingId') for r in (cf.get('results') or []) if r.get('listingId')), None)
        st = psql(f"SELECT l.status || '|' || (SELECT count(*) FROM review_items WHERE target_id::text = '{lid}') FROM listings l WHERE l.id = '{lid}'") if lid else ''
        ok('② 확정 — 한 줄 처리(등록이면 검수 큐 · 아니면 실패 사유) · 두 번째 확정 409 LSQ_BULK_STATE',
           (cf.get('made', 0) + cf.get('failed', 0)) == 1 and (not lid or (st.split('|')[0] in ('IN_REVIEW', 'PUBLISHED') and st.split('|')[1] != '0'))
           and again.get('_err') == 409 and again.get('code') == 'LSQ_BULK_STATE', f"{str(cf)[:200]} {st} {again.get('code')}")
        mine = call('GET', '/lsq/me/bulk', None, TM)
        one = call('GET', f"/lsq/me/bulk/{pv.get('jobId')}", None, TM) if pv.get('jobId') else {}
        adm = call('GET', '/admin/lsq/bulk', None, TS)
        other = call('GET', f"/lsq/me/bulk/{pv.get('jobId')}", None, login('buyer@x.com')) if pv.get('jobId') else {}
        ok('② 나의공간 · 운영 — 내 묶음 · 줄 결과 · 양식 · 남의 묶음 404 · 운영 한눈에(가린 이름)',
           mine.get('on') is True and 'gwan,category,title' in (mine.get('template') or '') and len(one.get('items') or []) == 2
           and other.get('_err') == 404 and isinstance(adm.get('recent'), list) and 'summary30' in adm, f"{mine.get('on')} {len(one.get('items') or [])} {other.get('_err')} {str(adm)[:80]}")
        if ADMIN_WEB:
            r = admin_page('/#/lsq-bulk', lambda pg, seen: seen.update(n=pg.locator('[data-lsq-bulk]').count(), s=pg.locator('[data-lsq-settings="bulk"]').count()))
            if r is not None:
                seen, perr = r
                ok('③ 화면 — 검수 › 매물 일괄 등록(설정 · 표 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('s') == 1 and not perr, f"{seen} {perr[:2]}")
    finally:
        clean()
        keep.back()
        rm_role(aid, '1602')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
