"""v10.550 (docs/688) 매물 사진 워터마크 — 대표 11/21 「(56) ② 매물 사진 워터마크」
  ① (코드) 새 npm 없음 · 그림 도구 없음 · 원본 사진 주소(GET /listings/{id}/photos/{n}) 고치지 않음 · 서버는 표시 정보만(글자 SogaeBank/소개뱅크 고정 · 자리 · 진하기) · lpx.watermark off · 사용자 웹 LpxPhotoMark(사진 칸 감쌈 · CSS 겹침 · 누르기 막지 않음 · 토큰만) · 메뉴 lpx-photo · 화면 LPX-020 · 문서 688
  ② (API · DB) 꺼짐 on false · SUPER 설정(자리 TL · 진하기 40 · 사유) · 켜고 공개 덧붙임 정보에 표시 · 잘못된 자리 400 · 사유 없음 400 · 운영 미리보기 6자리 · 권한 주소
  ③ (화면) 검수 › 매물 사진 워터마크(미리보기)
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

WM, PM, CSS = rd('src/modules/lpx/watermark.ts'), rd('site/src/components/lpx/LpxPhotoMark.tsx'), rd('site/src/styles/lpx.css')
LX, PKG = rd('src/modules/listing/listing-ext.controller.ts'), rd('package.json')

ok('① 코드 — 원본 그대로(사진 주소 · 새 npm 없음) · 표시 정보만 · 글자 고정 · lpx.watermark off · 자리 · 진하기 무늬 · 사진 칸 감쌈 · CSS 겹침(누르기 막지 않음) · 메뉴 lpx-photo · 화면 LPX-020 · 문서 688 · 판 v10.550',
   "LPX_MARK_TEXT = 'SogaeBank/소개뱅크'" in CM and "('lpx.watermark', 'off'" in M86 and "('lpx.watermark_pos', 'BR'" in M86 and "'^(BR|BL|TR|TL|C|TILE)$'" in M86
   and "('lpx.watermark_opacity', '35'" in M86 and 'export async function listingExtras' in WM and 'export async function markInfo' in WM
   and 'lpx' not in LX and '"sharp"' not in PKG and '"jimp"' not in PKG and '"canvas"' not in PKG
   and '<LpxPhotoMark listingId={item.id}' in DT and '</LpxPhotoMark>' in DT and 'aria-hidden="true"' in PM and '.lpx-wm-wrap' in CSS and 'pointer-events: none' in CSS
   and "@Get('site/lpx/listings/:id')" in CT and 'export function LpxPhoto' in UI and "['lpx-photo', '매물 사진 워터마크']" in MN and "{tab === 'lpx-photo' && <LpxPhoto />}" in AP
   and '"SB-ADM-LPX-020"' in SJ and '"GET /site/lpx/listings/{id}"' in SJ and '원본' in doc('688_') and VT >= (10, 550), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    lid = psql("SELECT id FROM listings WHERE status = 'PUBLISHED' ORDER BY published_at DESC NULLS LAST LIMIT 1")
    olds = {k: getset(k) for k in ('lpx.watermark', 'lpx.watermark_pos', 'lpx.watermark_opacity')}
    try:
        setting('lpx.watermark', 'off', '1550')
        off = call('GET', f'/site/lpx/listings/{lid}')
        put = call('PUT', '/admin/lpx/settings', {'markOn': True, 'markPos': 'TL', 'markOpacity': 40, 'reason': '시험 1550 워터마크'}, TS)
        on = call('GET', f'/site/lpx/listings/{lid}')
        badp = call('PUT', '/admin/lpx/settings', {'markPos': 'XX', 'reason': '시험 1550'}, TS)
        nor = call('PUT', '/admin/lpx/settings', {'markOn': False}, TS)
        bad_id = call('GET', '/site/lpx/listings/not-a-uuid')
        adm = call('GET', '/admin/lpx/watermark', None, TS)
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE pattern <> '/admin/help/tab' AND task_key = 'lpx-photo'")
        w0, w1 = off.get('watermark') or {}, on.get('watermark') or {}
        ok('② 워터마크 — 꺼짐 on false · SUPER 설정(사유) · 켜고 TL · 40 · 글자 SogaeBank/소개뱅크 · 잘못된 자리 400 · 사유 없음 400 · 잘못된 번호도 표시 정보만 · 운영 6자리 · 권한 주소 2',
               w0.get('on') is False and put.get('ok') is True and w1.get('on') is True and w1.get('pos') == 'TL' and w1.get('opacity') == 40 and w1.get('text') == 'SogaeBank/소개뱅크'
               and badp.get('_err') == 400 and nor.get('_err') == 400 and (bad_id.get('watermark') or {}).get('on') is True and bad_id.get('away') is None
               and len(adm.get('positions') or []) == 6 and rmap == '2',
               f"{w0} · {put.get('ok')} {w1} · {badp.get('_err')} {nor.get('_err')} · {bad_id} · {adm.get('positions')} · {rmap}")
        if ADMIN_WEB:
            r = admin_page('/#/lpx-photo', lambda pg, seen: seen.update(n=pg.locator('[data-lpx-photo]').count(), p=pg.locator('[data-lpx-mark-preview]').count()))
            if r is not None:
                seen, perr = r
                ok('③ 화면 — 검수 › 매물 사진 워터마크(미리보기 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('p') == 1 and not perr, f"{seen} {perr[:2]}")
    finally:
        for k, v in olds.items():
            setting(k, v or {'lpx.watermark': 'off', 'lpx.watermark_pos': 'BR', 'lpx.watermark_opacity': '35'}[k], '1550 되돌림')
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
