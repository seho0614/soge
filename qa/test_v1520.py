"""v10.520 (D277 · docs/658) 광고 소재 비교 시험 — 대표 11/20 ㊼ ④
  ① (코드) D277 prx_ab_tests(가드 · 한 소재 한 시험) · fn_prx_ab_hidden · fn_prx_ab_pick · ads.service 끼움(serve 두 곳 · 인피드) · 표기 「광고」 그대로 · ad_slots 안 고침 · 설정 prx.ab_min_impr · 메뉴 · 화면 PRX-040 · 문서 658
  ② (API · DB) 시험 슬롯 · 같은 광고주 소재 2 → 다른 슬롯 짝 422 · B 멈춤이면 시작 409 · 시작 → /ads/serve 가 A · B 번갈아(표기 광고) · 노출 · 클릭 기록 → 결과 숫자 · 표본 부족 · 끝내면 결과 고정(DB 가 고치기 막음) · 정리
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


def iso(dt):
    return dt.strftime('%Y-%m-%dT%H:%M:%S+00:00')


NOW = datetime.datetime.utcnow()
STAMP = int(time.time()) % 1000000
M77 = migr('D277_')
MN, AP, SCH, WK = rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')
PC = rd('src/modules/prx/prx.controller.ts')
AB, ADS = rd('src/modules/prx/abtest.ts'), rd('src/modules/ads/ads.service.ts')
ok('① 코드 — 시험 표 · 가드(PRX_AB_BUSY) · 숨김 · 번갈아 함수 · ads.service 에 숨김 3곳 · 번갈아 3곳 · label 광고 그대로 · ad_slots 를 고치지 않음 · 결과 숫자만 · 메뉴 prx-adab · 화면 PRX-040 · 문서 658 · 판 v10.520',
   'CREATE TABLE IF NOT EXISTS public.prx_ab_tests' in M77 and "'PRX_AB_BUSY: " in M77 and 'FUNCTION public.fn_prx_ab_hidden' in M77 and 'FUNCTION public.fn_prx_ab_pick' in M77
   and not re.search(r'(ALTER|UPDATE)\s+(TABLE\s+)?(public\.)?ad_slots', M77) and ADS.count('fn_prx_ab_hidden(') == 3 and ADS.count('abSwapServing(this.db') == 2 and 'abSwapInfeed(this.db, rows)' in ADS
   and ADS.count("label: '광고'") >= 3 and 'export function judge' in AB and "('prx.ab_min_impr', '1000'" in M77
   and "['prx-adab', '광고 소재 비교']" in MN and '"SB-ADM-PRX-040"' in SJ and '번갈아' in doc('658_') and VT >= (10, 520), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    sl, sl2, code, name = f'T1520{STAMP}', f'T1520{STAMP}X', f'T1520{STAMP}', f'시험광고1520-{STAMP}'
    tid = ''
    try:
        psql(f"INSERT INTO ad_slots (code, name, placement, is_active) VALUES ('{sl}', '시험 1520', '시험', true), ('{sl2}', '시험 1520 X', '시험', true)")
        psql(f"INSERT INTO ad_placements (slot_code, creative_code, advertiser, title, body, status) VALUES "
             f"('{sl}', '{code}-A', '{name}', '시험 A', '문구 A', 'ACTIVE'), ('{sl}', '{code}-B', '{name}', '시험 B', '문구 B', 'PAUSED'), ('{sl2}', '{code}-X', '{name}', '시험 X', '문구 X', 'ACTIVE')")
        ida = psql(f"SELECT id FROM ad_placements WHERE creative_code = '{code}-A'"); idb = psql(f"SELECT id FROM ad_placements WHERE creative_code = '{code}-B'")
        per = {'startsAt': iso(NOW - datetime.timedelta(minutes=5)), 'endsAt': iso(NOW + datetime.timedelta(days=1))}
        badp = call('POST', '/admin/prx/ab-tests', {'title': '시험 1520 짝', 'codeA': f'{code}-A', 'codeB': f'{code}-X', **per}, TS)
        same = call('POST', '/admin/prx/ab-tests', {'title': '시험 1520 같음', 'codeA': f'{code}-A', 'codeB': f'{code}-A', **per}, TS)
        c = call('POST', '/admin/prx/ab-tests', {'title': f'시험 1520 {STAMP}', 'codeA': f'{code}-A', 'codeB': f'{code}-B', **per}, TS)
        tid = str(c.get('id') or '')
        s0 = call('POST', f'/admin/prx/ab-tests/{tid}/start', None, TS)
        psql(f"UPDATE ad_placements SET status = 'ACTIVE' WHERE id = '{idb}'")
        s1 = call('POST', f'/admin/prx/ab-tests/{tid}/start', None, TS)
        seq, labels = [], []
        for _ in range(4):
            r = call('GET', f'/ads/serve?slot={sl}')
            seq.append(r.get('code')); labels.append(r.get('label'))
            if r.get('id'):
                call('POST', f"/ads/{r['id']}/impression?slot={sl}")
                if r.get('code') == f'{code}-B': call('POST', f"/ads/{r['id']}/click?slot={sl}")
        alt = seq in ([f'{code}-A', f'{code}-B'] * 2, [f'{code}-B', f'{code}-A'] * 2)
        hid = psql(f"SELECT fn_prx_ab_hidden('{idb}')::text || '|' || fn_prx_ab_hidden('{ida}')::text")
        live = call('GET', f'/admin/prx/ab-tests/{tid}', None, TS)
        lr = live.get('result') or {}
        ok('② 진행 — 다른 슬롯 짝 422 · 같은 소재 422 · B 멈춤이면 시작 409 PRX_AB_NOT_ACTIVE · 시작 · /ads/serve 4번이 A · B 번갈아 · 표기 늘 광고 · B 는 뽑기에서 숨김 · 지금까지 A 노출 2 · B 노출 2 클릭 2 · 표본 부족',
           badp.get('_err') == 422 and badp.get('code') == 'PRX_AB_PAIR' and same.get('_err') == 422 and bool(tid) and s0.get('_err') == 409 and s0.get('code') == 'PRX_AB_NOT_ACTIVE'
           and s1.get('ok') is True and alt and labels == ['광고'] * 4 and hid == 'true|false'
           and (lr.get('a') or {}).get('impressions') == 2 and (lr.get('b') or {}).get('impressions') == 2 and (lr.get('b') or {}).get('clicks') == 2 and lr.get('verdict') == 'LOW_SAMPLE',
           f'{badp.get("code")} {s0} {s1} {seq} {labels} {hid} {lr}')
        e = call('POST', f'/admin/prx/ab-tests/{tid}/end', None, TS)
        fixed = psql(f"SELECT state || '|' || (result->'b'->>'clicks') FROM prx_ab_tests WHERE id = {int(tid or 0)}")
        g = psql(f"UPDATE prx_ab_tests SET result = '{{}}'::jsonb WHERE id = {int(tid or 0)}")
        hid2 = psql(f"SELECT fn_prx_ab_hidden('{idb}')::text")
        e2 = call('POST', f'/admin/prx/ab-tests/{tid}/end', None, TS)
        ok('② 끝 — 결과 고정(ENDED · B 클릭 2) · DB 가 결과 고치기 막음 · 끝난 뒤 B 다시 뽑기에 들어감 · 다시 끝내기 409',
           e.get('ok') is True and fixed == 'ENDED|2' and '!' in g and hid2 == 'false' and e2.get('_err') == 409, f'{e} {fixed} {g[-50:]} {hid2} {e2}')
    finally:
        psql(f"SET session_replication_role = replica; DELETE FROM prx_ab_tests WHERE creative_a IN (SELECT id FROM ad_placements WHERE creative_code LIKE '{code}-%'); "
             f"DELETE FROM ad_events WHERE creative_id IN (SELECT id FROM ad_placements WHERE creative_code LIKE '{code}-%'); "
             f"DELETE FROM ad_placements WHERE creative_code LIKE '{code}-%'; DELETE FROM ad_slots WHERE code IN ('{sl}', '{sl2}');")
    ok('정리 — 시험 슬롯 · 소재 · 기록 · 시험 남지 않음', psql(f"SELECT count(*) FROM ad_placements WHERE creative_code LIKE '{code}-%'") == '0' and psql(f"SELECT count(*) FROM ad_slots WHERE code LIKE '{sl}%'") == '0')
    if ADMIN_WEB:
        r = admin_page('/#/prx-adab', lambda pg, seen: seen.update(n=pg.locator('[data-prx-abtests]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 광고 › 광고 소재 비교(화면 오류 없음)', seen.get('n') == 1 and not perr, f'{seen} {perr[:2]}')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
