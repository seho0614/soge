"""v10.601 (docs/743) 16차 회원 · 성장 ⑰ 매물 충실도 점수 · 등록 도우미 — 본인 매물 안내만 · 노출 순위 · 소개비에 쓰지 않음(grw.fill_helper 처음 on · 표시만)
  ① (코드) 항목 아홉 · 무게 합 100 · 순수 함수 · 목록 · 검색 · 노출 코드에 grw 없음 · listings 칸 안 더함 · 설정 · 화면 · 사전 · 문서 743
  ② (API · DB) 시험 판매자(seller@x.com) 내 매물 점수 = DB 칸으로 셈한 값 · 남의 매물 404 · 틀린 번호 404 · 끄기 · 운영 나눔 · 회원 403
  ③ (화면) 매물 등록 도우미
  (두 번 돌아도 통과 — 매물을 고치지 않음(읽기만) · 설정은 되돌림)
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


def mk_member(tag):
    """시험 회원(본인인증 · MEMBER) — 이메일에 시각을 넣어 두 번 돌아도 새 사람"""
    em, aid = mk_staff(tag, 'MEMBER')
    import consent_ok
    consent_ok.agree(em, PW)
    return em, aid, login(em)


def mig_with(word):
    """grw_ SQL 이 들어간 마이그레이션(번호는 메인이 정함 — 글자로 찾음 · 여러 개면 이어 붙임)"""
    d = os.path.join(K, 'prisma', 'migrations')
    out = []
    for x in (sorted(os.listdir(d)) if os.path.isdir(d) else []):
        p = os.path.join(d, x, 'migration.sql')
        if os.path.isfile(p):
            t = open(p, encoding='utf-8').read()
            if word in t:
                out.append(t)
    return '\n'.join(out)


"""시험 몸통"""
GRW = {k: rd(f'src/modules/grw/{k}.ts') for k in ('common', 'funnel', 'first-steps', 'digest', 'tier', 'fill', 'grw.controller')}
MN, AP, AM = rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('src/app.module.ts')
GW = rd('web/src/app/admin/Grw.tsx')
KO = json.loads(rd('site/src/i18n/messages/ko/grw.json') or '{}')
EN = json.loads(rd('site/src/i18n/messages/en/grw.json') or '{}')
STAMP = int(time.time()) % 1000000


def keys(d, p=''):
    out = set()
    for k, v in (d or {}).items():
        out |= keys(v, p + k + '.') if isinstance(v, dict) else {p + k}
    return out

FL = GRW['fill']
W = [int(x) for x in re.findall(r"\{ code: '[A-Z0-9]+', w: (\d+) \}", FL)]
NOGRW = [rd(p) for p in ('src/modules/listing/listing.repository.ts', 'src/modules/search/search.service.ts', 'src/engines/exposure/exposure.engine.ts')]
M = mig_with('grw.fill_helper')
LF = rd('site/src/app/my/listing-fill/page.tsx')
ED = rd('site/src/app/listings/[id]/edit/page.tsx')
ok('① 코드 — 항목 아홉 · 무게 합 100 · 점수는 순수 함수(DB 에 적지 않음) · 목록 · 검색 · 노출 코드에 grw 없음 · listings 칸 안 더함 · grw.fill_helper on · 도우미 화면 · 고치기 상자 · 사전 · 화면 MYP-GRW-030 · 040 · 문서 743 「쓰지 않」 · 판 v10.601',
   len(W) == 9 and sum(W) == 100 and 'export function fillScore' in FL and 'UPDATE listings' not in FL and 'INSERT INTO' not in FL
   and all(t and 'grw' not in t.lower() for t in NOGRW) and not re.search(r'ALTER TABLE (public\.)?listings', M)
   and "('grw.fill_helper', 'on', 'ADMIN'" in M and 'SB-MYP-GRW-030' in LF and '<GrwFillBox id={id} />' in ED
   and all(f'fill.tip.{c}' in keys(KO) for c in ('TITLE', 'SUMMARY', 'BODY', 'PHOTO1', 'PHOTO3', 'REGION', 'AMOUNT', 'FEE', 'HOURS')) and keys(KO) == keys(EN)
   and 'SB-MYP-GRW-040' in SJ and '쓰지 않' in doc('743_') and VT >= (10, 601), f'{VER} {W}')


def expect(lid):
    """DB 칸으로 같은 셈(서버 fill.ts 와 같은 규칙) — 점수만"""
    r = psql(f"""SELECT char_length(btrim(coalesce(title, ''))) || '|' || char_length(btrim(coalesce(summary, ''))) || '|' || char_length(btrim(coalesce(body, ''))) || '|' ||
                        (SELECT count(*) FROM listing_media m WHERE m.listing_id = l.id AND m.media_type = 'IMAGE') || '|' ||
                        (EXISTS (SELECT 1 FROM listing_regions r WHERE r.listing_id = l.id) OR coalesce(btrim(l.region_detail), '') <> '')::text || '|' ||
                        (deal_amount IS NOT NULL)::text || '|' || (desired_fee IS NOT NULL AND coalesce(fee_bearer, '') <> '')::text || '|' || char_length(btrim(coalesce(contact_hours, '')))
                   FROM listings l WHERE id = '{lid}'""").split('|')
    t, s, b, ph, rg, am, fe, hr = r
    t, s, b, ph, hr = int(t), int(s), int(b), int(ph), int(hr)
    return ((10 if 10 <= t <= 60 else 0) + (10 if s >= 2 else 0) + (20 if b >= 200 else 10 if b >= 80 else 0) + (15 if ph >= 1 else 0) + (10 if ph >= 3 else 0)
            + (10 if rg == 'true' else 0) + (10 if am == 'true' else 0) + (10 if fe == 'true' else 0) + (5 if hr >= 2 else 0))


if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    consent_ok.agree('seller@x.com', PW)
    TS = login('admin@x.com')
    TSel = login('seller@x.com')
    em, aid, TM = mk_member('1601')
    old = getset('grw.fill_helper')
    try:
        setting('grw.fill_helper', 'on', '1601')
        mine = call('GET', '/me/grw/listings', None, TSel)
        it = (mine.get('items') or [{}])[0]
        one = call('GET', f"/me/grw/listings/{it.get('id')}/fill", None, TSel) if it.get('id') else {}
        other = call('GET', f"/me/grw/listings/{it.get('id')}/fill", None, TM) if it.get('id') else {'_err': 404}
        badid = call('GET', '/me/grw/listings/abc/fill', None, TSel)
        exp = expect(it['id']) if it.get('id') else -1
        ok('② 회원 — 내 매물 점수(0 ~ 100 · 등급 · 고칠 칸) · 하나 보기 = 목록 점수 = DB 칸으로 셈한 값 · 남의 매물 404 · 틀린 번호 404 · 안내 문구(쓰지 않음)',
           mine.get('on') is True and isinstance(mine.get('items'), list) and it.get('id') and 0 <= it.get('score', -1) <= 100 and it.get('grade') in ('A', 'B', 'C', 'D')
           and one.get('score') == it.get('score') == exp and isinstance(one.get('todo'), list) and other.get('_err') == 404 and badid.get('_err') == 404
           and '쓰지 않습니다' in (mine.get('note') or ''), f"{it.get('score')} {one.get('score')} {exp} {other.get('_err')} {badid.get('_err')}")
        setting('grw.fill_helper', 'off', '1601')
        offl = call('GET', '/me/grw/listings', None, TSel)
        setting('grw.fill_helper', 'on', '1601')
        st = call('GET', '/admin/grw/fill', None, TS)
        sm = call('GET', '/admin/grw/fill', None, TM)
        ok('② 끄기 · 운영 — 끄면 on=false · 목록 비움 · 운영 나눔(넷 · 빠진 칸 아홉 · 합 = 매물 수) · 회원 403',
           offl.get('on') is False and offl.get('items') == [] and len(st.get('bins') or []) == 4 and len(st.get('missing') or []) == 9
           and sum(b.get('n', 0) for b in st.get('bins') or []) == st.get('listings') and sm.get('_err') == 403,
           f"{offl.get('on')} {st.get('listings')} {st.get('bins')} {sm.get('_err')}")
    finally:
        setting('grw.fill_helper', old or 'on', '1601')

    if SITE:
        def run(b, seen, perr):
            ps = site_login(b, perr, 'seller@x.com')
            ps.goto(SITE + '/my/listing-fill', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1500)
            seen['page'] = ps.locator('[data-screen="SB-MYP-GRW-030"]').count()
            seen['rows'] = ps.locator('[data-grw-fill-row]').count()
        r = ui(run)
        if r:
            seen, perr = r
            ok('③ 사용자 웹 — 매물 등록 도우미 화면 · 내 매물 줄', seen.get('page') == 1 and seen.get('rows', 0) >= 1 and not perr, f'{seen} {perr[:2]}')
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
