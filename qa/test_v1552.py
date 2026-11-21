"""v10.552 (docs/690) 지역별 시세 통계 — 대표 11/21 「(56) ④ 지역별 시세 통계」
  ① (코드) D286 lpx_price_stats(달 × 관 × 업종(상위 · ALL) × 시 · 도 × 시 · 구 · 5개 미만 칸 값 없음 CHECK) · fn_lpx_stats_refresh(GROUPING SETS · 가운데값) · fn_lpx_category_root · lpx.stats off · 최소 수 5 이상 · 매일 04:50 lpx_stats_daily · 공개 API 집계만(site 구역) · 공개 화면 /price-stats · 매물 상세 한 줄 · 메뉴 lpx-stats · 화면 LPX-040 · HOM-LPX-010 · 문서 690
  ② (API · DB) 꺼짐 enabled false · 지금 셈 · 5개 미만 칸에 값 넣기 막힘(CHECK) · 값 있는 작은 칸 0 · 켜고 공개 응답(칸은 ym · n · median · p25 · p75 뿐 · n 은 최소 수 넘음) · 잘못된 관 422 · 잘못된 업종 422 · 운영 화면 · 잘못된 달 422 · 권한 주소
  ③ (화면) 검수 › 지역별 시세 통계 · 공개 지역별 시세(SITE 있을 때)
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


M86 = migr('D286_')
CT, CM = rd('src/modules/lpx/lpx.controller.ts'), rd('src/modules/lpx/common.ts')
UI, MN, AP = rd('web/src/app/admin/ListingPrice.tsx'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx')
KOJ = rd('site/src/i18n/messages/ko/lpx.json')
ENJ = rd('site/src/i18n/messages/en/lpx.json')
DT = rd('site/src/app/[gwan]/[id]/page.tsx')
IX = rd('site/src/i18n/messages/index.ts')


def pub_listing():
    """게시 중 · 거래 금액 있는 시험 매물(…@x.com 주인) — 'id|주인 메일|관|거래 금액|주인 id' 또는 ''"""
    r = psql("SELECT l.id || '|' || a.email || '|' || l.gwan_code || '|' || coalesce(l.deal_amount::text, '') || '|' || a.id FROM listings l JOIN accounts a ON a.id = l.owner_account_id "
             "WHERE l.status = 'PUBLISHED' AND a.email LIKE '%@x.com' AND a.status = 'ACTIVE' AND l.deal_amount >= 10000 ORDER BY l.published_at DESC NULLS LAST LIMIT 1")
    return r if r.count('|') == 4 and '!' not in r else ''

SS, PG, LO = rd('src/modules/lpx/stats.ts'), rd('site/src/app/price-stats/page.tsx'), rd('site/src/components/lpx/LpxOffer.tsx')

ok('① 코드 — D286 lpx_price_stats(5개 미만 값 없음 CHECK) · fn_lpx_stats_refresh(GROUPING SETS · percentile_cont) · fn_lpx_category_root · lpx.stats off · 최소 수 무늬 5 이상 · lpx_stats_daily 04:50 · 공개 API(site 구역 · 집계만) · 공개 화면 · 매물 상세 한 줄 · 메뉴 lpx-stats · 화면 LPX-040 · HOM-LPX-010 · 문서 690 · 판 v10.552',
   'CREATE TABLE IF NOT EXISTS public.lpx_price_stats' in M86 and 'ck_lpx_stats_small CHECK (n >= 5 OR' in M86 and 'FUNCTION public.fn_lpx_stats_refresh(p_ym text)' in M86
   and 'GROUP BY GROUPING SETS' in M86 and 'percentile_cont(0.5)' in M86 and 'FUNCTION public.fn_lpx_category_root(p_id uuid)' in M86
   and "('lpx.stats', 'off'" in M86 and "('lpx.stats_min', '5'" in M86 and "'^([5-9]|[1-4][0-9]|50)$'" in M86 and "('lpx_stats_daily', 1440, 4, 50," in M86
   and 'export async function publicStats' in SS and 'export async function statsDailyJob' in SS and "@Get('site/lpx/price-stats')" in CT and "'site'" in rd('scripts/check-acl.js')
   and 'data-screen="SB-HOM-LPX-010"' in PG and '/site/lpx/price-stats' in PG and "getTranslations('lpx.stats')" in LO
   and 'export function LpxStats' in UI and "['lpx-stats', '지역별 시세 통계']" in MN and "{tab === 'lpx-stats' && <LpxStats />}" in AP
   and '"SB-ADM-LPX-040"' in SJ and '"SB-HOM-LPX-010"' in SJ and '"GET /site/lpx/price-stats"' in SJ and '"hidden"' in KOJ and '"hidden"' in ENJ and '실제 거래가 아님' in doc('690_') and VT >= (10, 552), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    olds = {k: getset(k) for k in ('lpx.stats', 'lpx.stats_min')}
    t0 = psql("SELECT now()::text")
    try:
        setting('lpx.stats', 'off', '1552'); setting('lpx.stats_min', '5', '1552')
        off = call('GET', '/site/lpx/price-stats?gwan=MNY')
        run = call('POST', '/admin/lpx/stats/run', {}, TS)
        small = psql("INSERT INTO lpx_price_stats (ym, gwan_code, category_key, n, median_amount) VALUES ('1999-01', 'MNY', 'ALL', 3, 1000)")
        leak = psql("SELECT count(*) FROM lpx_price_stats WHERE n < 5 AND (median_amount IS NOT NULL OR p25_amount IS NOT NULL OR p75_amount IS NOT NULL)")
        setting('lpx.stats', 'on', '1552')
        pub = call('GET', '/site/lpx/price-stats?gwan=MNY')
        badg = call('GET', '/site/lpx/price-stats?gwan=mn1')
        badc = call('GET', '/site/lpx/price-stats?gwan=MNY&category=xyz')
        adm = call('GET', '/admin/lpx/stats', None, TS)
        badym = call('GET', '/admin/lpx/stats?ym=2026-13', None, TS)
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE pattern <> '/admin/help/tab' AND task_key = 'lpx-stats'")
        keys = set()
        for m in (pub.get('months') or []):
            keys |= set(m.keys())
        nmin = min([m.get('n', 99) for m in (pub.get('months') or [])] + [c.get('n', 99) for c in (pub.get('children') or [])] + [99])
        ok('② 시세 통계 — 꺼짐 enabled false · 지금 셈(이번 달 · 지난달 이상) · 5개 미만 칸에 값 넣기 막힘 · 값 있는 작은 칸 0 · 켜고 공개(칸은 ym · n · median · p25 · p75 뿐 · n 5 이상) · 잘못된 관 · 업종 422 · 운영 · 잘못된 달 422 · 권한 주소 3',
               off.get('enabled') is False and (run.get('months') or 0) >= 2 and '!' in small and 'ck_lpx_stats_small' in small and leak == '0'
               and pub.get('enabled') is True and keys <= {'ym', 'n', 'median', 'p25', 'p75'} and nmin >= 5 and 'options' in pub
               and badg.get('_err') == 422 and badg.get('code') == 'LPX_STATS_GWAN' and badc.get('_err') == 422 and badc.get('code') == 'LPX_STATS_CATEGORY'
               and 'months' in adm and badym.get('_err') == 422 and rmap == '3',
               f"{off.get('enabled')} · {run} · {small[-40:]} {leak} · {pub.get('enabled')} {sorted(keys)} {nmin} · {badg.get('code')} {badc.get('code')} · {badym.get('code')} · {rmap}")
        if ADMIN_WEB:
            r = admin_page('/#/lpx-stats', lambda pg, seen: seen.update(n=pg.locator('[data-lpx-stats]').count(), s=pg.locator('[data-lpx-stats-switch]').count()))
            if r is not None:
                seen, perr = r
                ok('③ 화면 — 검수 › 지역별 시세 통계(스위치 · 표 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('s') == 1 and not perr, f"{seen} {perr[:2]}")
        if SITE:
            def run_site(b, seen, perr):
                ps = b.new_page(viewport={'width': 1280, 'height': 900}); ps.on('pageerror', lambda e: perr.append(str(e)[:120]))
                ps.goto(SITE + '/price-stats?gwan=MNY', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1000)
                seen['pg'] = ps.locator('[data-screen="SB-HOM-LPX-010"]').count()
            r2 = ui(run_site)
            if r2 is not None:
                seen2, perr2 = r2
                ok('③ 화면 — 공개 지역별 시세(로그인 없이 · 화면 오류 없음)', seen2.get('pg') == 1 and not perr2, f"{seen2} {perr2[:2]}")
    finally:
        psql(f"DELETE FROM lpx_price_stats WHERE computed_at >= '{t0}'")
        for k, v in olds.items():
            setting(k, v or {'lpx.stats': 'off', 'lpx.stats_min': '5'}[k], '1552 되돌림')
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
