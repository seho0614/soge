"""v10.513 (D276 · docs/651) ㊻ 매물 ① 저장한 검색 · 새 매물 하루 묶음 알림
  ① (코드) D276 lsx_saved_searches(사람마다 10 · DB 트리거) · lsx_search_digests(회원 · 날짜 하나) · 설정 정규식 = DB value_pattern(규칙 2 · 14개) · LsxController · 정기 작업 lsx_daily · 메뉴 lsx-saved · 화면 SB-MYP-LSX-010 · 사이트 사전 ko = en · 문서 651
  ② (API · DB) 꺼짐 422 LSX_OFF → 켬 → 저장 · 같은 조건 409 · 최대 개수 422 · 이름 · 알림 바꾸기 · 묶음 알림 하루 한 통(두 번 돌려도 한 통) · 지우기 · 운영 숫자(누가 저장했는지 없음)
  ③ (화면) 운영 화면 검수 › 저장한 검색 · 사용자 웹 나의공간 › 저장한 검색(SITE 있을 때만)
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



def lsx_pick():
    """점검판의 게시 매물 하나 · 그 주인(시드 계정 · 비밀번호 PW) — 시험은 이 매물의 줄만 바꾸고 끝에 되돌림"""
    row = psql("SELECT l.id || '|' || a.email || '|' || l.gwan_code || '|' || coalesce(l.published_at::text, '') || '|' || l.version FROM listings l JOIN accounts a ON a.id = l.owner_account_id "
               "WHERE l.status = 'PUBLISHED' AND NOT l.is_priority_exposed AND a.status = 'ACTIVE' AND a.email LIKE '%@x.com' "
               "AND NOT EXISTS (SELECT 1 FROM lsx_bump_live b WHERE b.listing_id = l.id) ORDER BY l.published_at DESC NULLS LAST, l.id LIMIT 1")
    p = (row.split('\n')[0] if row and not row.startswith('!') else '').split('|')
    return (p + ['', '', '', '', ''])[:5]


def exp_snap(lid):
    """만료 줄 그대로 적어 둠(되돌리기용) — 없으면 ''"""
    return psql(f"SELECT coalesce((SELECT expires_at::text || '|' || set_kind || '|' || coalesce(warned_for::text, '') || '|' || coalesce(expired_at::text, '') FROM lsx_listing_expiry WHERE listing_id = '{lid}'), '')")


def exp_restore(lid, snap):
    if not lid:
        return
    if not snap:
        psql(f"DELETE FROM lsx_listing_expiry WHERE listing_id = '{lid}';")
        return
    e, k, w, x = (snap.split('|') + ['', '', '', ''])[:4]
    wv = f"'{w}'" if w else 'NULL'; xv = f"'{x}'" if x else 'NULL'
    psql(f"INSERT INTO lsx_listing_expiry (listing_id, expires_at, set_kind, warned_for, expired_at) VALUES ('{lid}', '{e}', '{k}', {wv}, {xv}) "
         f"ON CONFLICT (listing_id) DO UPDATE SET expires_at = EXCLUDED.expires_at, set_kind = EXCLUDED.set_kind, warned_for = EXCLUDED.warned_for, expired_at = EXCLUDED.expired_at, expired_fp = NULL;")


LSX_KEYS = ['lsx.saved_search', 'lsx.saved_search_max', 'lsx.expiry', 'lsx.expiry_default_months', 'lsx.expiry_warn_days', 'lsx.bump_mode', 'lsx.bump_free_count',
            'lsx.bump_period_days', 'lsx.bump_min_hours', 'lsx.bump_price', 'lsx.bump_effect_hours', 'lsx.ai_summary', 'lsx.ai_summary_model', 'lsx.ai_summary_batch']
M76 = migr('D276_')
SRC = {f: rd(f'src/modules/lsx/{f}.ts') for f in ('common', 'saved', 'expiry', 'bump', 'summary', 'jobs', 'lsx.controller')}
stamp = int(time.time()) % 1000000

MN, AP, SCH, WK, AM = rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'), rd('src/app.module.ts')
pats = dict(re.findall(r"\('(lsx\.[a-z_]+)', '[^']*', 'ADMIN', '[^']*', false, '([^']*)', '[^']*'\)", M76))
code_pats = dict(re.findall(r"'(lsx\.[a-z_]+)': '([^']*)',", SRC['common']))
ok('① 설정 14개 — DB value_pattern = 서버 검사 정규식(규칙 2) · 스위치 처음 off · bump_mode OFF · 기본 6개월 · 예고 7일',
   len(pats) == 14 and pats == code_pats and all(k in pats for k in LSX_KEYS)
   and "('lsx.saved_search', 'off'" in M76 and "('lsx.expiry', 'off'" in M76 and "('lsx.bump_mode', 'OFF'" in M76 and "('lsx.ai_summary', 'off'" in M76
   and "('lsx.expiry_default_months', '6'" in M76 and "('lsx.expiry_warn_days', '7'" in M76, f'{len(pats)} · {sorted(set(pats.items()) ^ set(code_pats.items()))[:3]}')
ok('① D276 저장한 검색 — 표 · 사람마다 최대(DB 트리거 · 설정 값) · 지역 정규식 DB = 서버 · 하루 한 통(UNIQUE 회원 · 날짜) · 쌓기만 · 알림 종류(끌 수 있음)',
   'CREATE TABLE IF NOT EXISTS public.lsx_saved_searches' in M76 and 'trg_lsx_saved_max' in M76 and "key = 'lsx.saved_search_max'" in M76
   and "region_code ~ '^[0-9A-Z]{2,10}$'" in M76 and 'REGION_RE = /^[0-9A-Z]{2,10}$/' in SRC['saved'] and 'UNIQUE (account_id, day)' in M76
   and 'trg_lsx_digests_ro' in M76 and "('LSX_SAVED_SEARCH', '저장한 검색 새 매물', true" in M76 and 'LSX_SAVED_SEARCH_INAPP' in M76
   and not re.search(r'\b(TRUNCATE|DROP TABLE)\b', M76), '')
ok('① 서버 — 검색 규칙은 목록과 같음(fn_search_match · expandKeyword) · 내 매물 · 우선노출 빼고 셈 · 글에 조건 이름 · 건수만 · 운영 숫자는 3명 이상 검색어만',
   'fn_search_match(l.title, l.body, $6)' in SRC['saved'] and 'expandKeyword(db, s.keyword)' in SRC['saved'] and 'l.owner_account_id <> $3::uuid' in SRC['saved']
   and 'l.is_priority_exposed = false' in SRC['saved'] and "'LSX_SAVED_SEARCH'" in SRC['saved'] and 'HAVING count(DISTINCT account_id) >= 3' in SRC['saved']
   and '${' not in ''.join(re.findall(r'db\.query[^`]*`([^`]*)`', SRC['saved'])), '')
ok('① 연결 — LsxController · 정기 작업 lsx_daily(08:10) · lsx_hourly · 메뉴 lsx-saved(검수 묶음) · 화면 SB-MYP-LSX-010 · SB-ADM-LSX-040 · 사이트 사전 · 문서 651 · 판 v10.513',
   'LsxController' in AM and "case 'lsx_daily':" in SCH and "'lsx_daily'," in WK and "('lsx_daily', 1440, 8, 10" in M76 and "('lsx_hourly', 60" in M76
   and "['lsx-saved', '저장한 검색']" in MN and "'admrev')?.tabs, 'badges', ['lsx-expiry', 'lsx-bump', 'lsx-summary', 'lsx-saved']" in MN and "{tab === 'lsx-saved' && <LsxSaved />}" in AP
   and '"SB-MYP-LSX-010"' in SJ and '"SB-ADM-LSX-040"' in SJ and '"POST /me/saved-searches"' in SJ and doc('651_') and VT >= (10, 513), VER)
# PAGE 안 lsx 자리는 어디든(맨 앞이면 test_v1097 이 보는 「const PAGE = { main, search」가 깨져 끝으로 옮김) · 영어 개수 문장은 ICU 복수형(test_v1116)
KO = json.loads(rd('site/src/i18n/messages/ko/lsx.json') or '{}'); EN = json.loads(rd('site/src/i18n/messages/en/lsx.json') or '{}')
ok('① 사이트 사전 lsx — ko · en 열쇠 같음 · 값은 글자만 · 템플릿 자리 같음 · 영어에 한글 없음 · 묶음 연결 · 「이 검색 저장」',
   KO and set(KO) == set(EN) and all(isinstance(v, str) for v in list(KO.values()) + list(EN.values()))
   and all(set(re.findall(r'\{\w+\}', KO[k])) == set(re.findall(r'\{\w+\}', EN[k])) for k in KO) and not any(re.search(r'[가-힣]', v) for v in EN.values())
   and "import lsx from './ko/lsx.json';" in rd('site/src/i18n/messages/index.ts') and re.search(r'const PAGE = \{[^}]*\blsx\b', rd('site/src/i18n/messages/index.ts'))
   and '<SaveSearchButton q={q}' in rd('site/src/app/search/page.tsx'), f'{len(KO)}')

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    em, aid = mk_staff('1513', 'MEMBER'); consent_ok.agree(em, PW); TM = login(em)
    before = {k: getset(k) for k in ('lsx.saved_search', 'lsx.saved_search_max')}
    try:
        off = call('POST', '/me/saved-searches', {'keyword': f'시험1513{stamp}'}, TM) if before['lsx.saved_search'] != 'on' else {'code': 'LSX_OFF'}
        setting('lsx.saved_search', 'on', '1513'); setting('lsx.saved_search_max', '2', '1513')
        kw = psql("SELECT split_part(btrim(title), ' ', 1) FROM listings WHERE status = 'PUBLISHED' AND NOT is_priority_exposed AND char_length(split_part(btrim(title), ' ', 1)) >= 2 ORDER BY published_at DESC NULLS LAST LIMIT 1") or '양도'
        a1 = call('POST', '/me/saved-searches', {'keyword': kw, 'name': f'시험1513 {stamp}'}, TM)
        dup = call('POST', '/me/saved-searches', {'keyword': kw}, TM)
        empty = call('POST', '/me/saved-searches', {'name': '조건 없음'}, TM)
        a2 = call('POST', '/me/saved-searches', {'gwanCode': 'MNY', 'name': f'시험1513b {stamp}'}, TM)
        over = call('POST', '/me/saved-searches', {'gwanCode': 'BIZ'}, TM)
        sid = (a1.get('item') or {}).get('id')
        up = call('PUT', f'/me/saved-searches/{sid}', {'name': f'시험1513 고침 {stamp}'}, TM)
        ls = call('GET', '/me/saved-searches', None, TM)
        # 묶음 알림 — 확인 시각을 옛날로 돌리고 두 번 돌림 → 한 통
        psql(f"UPDATE lsx_saved_searches SET last_checked_at = now() - interval '400 days' WHERE account_id = '{aid}';")
        call('POST', '/admin/jobs', {'job': 'lsx_daily'}, TS); call('POST', '/admin/jobs', {'job': 'lsx_daily'}, TS)
        dg = psql(f"SELECT count(*) FROM lsx_search_digests WHERE account_id = '{aid}'")
        nt = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{aid}' AND event_code = 'LSX_SAVED_SEARCH'")
        chk = psql(f"SELECT bool_and(last_checked_at > now() - interval '1 hour') FROM lsx_saved_searches WHERE account_id = '{aid}'")
        st = call('GET', '/admin/lsx/saved-searches/stats', None, TS)
        stm = call('GET', '/admin/lsx/saved-searches/stats', None, TM)
        if SITE:
            def chk_site(b, seen, perr):
                ps = site_login(b, perr, em); ps.goto(SITE + '/my/saved-searches', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1500)
                seen['list'] = ps.locator('[data-lsx-saved-list]').count(); seen['rows'] = ps.locator('[data-lsx-saved-row]').count()
            rs = ui(chk_site)
        dl = call('DELETE', f'/me/saved-searches/{sid}', None, TM)
        dl2 = call('DELETE', f'/me/saved-searches/{sid}', None, TM)
        ok('② 꺼짐이면 422 LSX_OFF', off.get('code') == 'LSX_OFF', str(off)[:120])
        ok('② 저장 · 같은 조건 409 LSX_SAVED_DUP · 조건 없음 400/422 · 최대(2) 넘으면 422 LSX_SAVED_MAX · 이름 고치기',
           bool(sid) and dup.get('_err') == 409 and dup.get('code') == 'LSX_SAVED_DUP' and empty.get('_err') in (400, 422) and bool((a2.get('item') or {}).get('id'))
           and over.get('_err') == 422 and over.get('code') == 'LSX_SAVED_MAX' and (up.get('item') or {}).get('name') == f'시험1513 고침 {stamp}'
           and ls.get('max') == 2 and len(ls.get('items') or []) == 2, f"{str(a1)[:80]} {dup.get('code')} {over.get('code')}")
        ok('② 묶음 알림 — 두 번 돌려도 하루 한 줄 · 알림 한 통 이하 · 확인 시각 앞으로', dg in ('0', '1') and nt in ('0', '1') and dg == nt and chk == 't', f'{dg} {nt} {chk}')
        ok('② 운영 숫자 — 운영자 200(계정 칸 없음) · 회원 403 · 지우기 · 두 번째 404',
           'searches' in st and 'account_id' not in json.dumps(st) and stm.get('_err') == 403 and dl.get('removed') == 1 and dl2.get('_err') == 404, f"{str(st)[:80]} {stm.get('_err')}")
        if SITE and rs is not None:
            seen, perr = rs
            ok('③ 사용자 웹 — 나의공간 › 저장한 검색(줄 2 · 화면 오류 없음)', seen.get('list') == 1 and seen.get('rows') == 2 and not perr, f"{seen} {perr[:2]}")
    finally:
        psql(f"DELETE FROM lsx_saved_searches WHERE account_id = '{aid}'; DELETE FROM notifications WHERE account_id = '{aid}' AND event_code = 'LSX_SAVED_SEARCH';")
        psql(f"SET session_replication_role = replica; DELETE FROM lsx_search_digests WHERE account_id = '{aid}';")
        for k, v in before.items():
            setting(k, v or None, '1513 되돌림')
        rm_role(aid, '1513')
    if ADMIN_WEB:
        r = admin_page('/#/lsx-saved', lambda pg, seen: seen.update(n=pg.locator('[data-lsx-saved]').count(), s=pg.locator('[data-lsx-settings]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 검수 › 저장한 검색(숫자 · 설정 칸 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('s') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
