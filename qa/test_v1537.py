"""v10.537 (D282 · docs/675) 휴대폰 재고 실사 — 대표 11/20 「(52) ③」
  ① (코드) 로트 실사 회차 · 줄 · 한 번에 하나 · 지킴 트리거 · 로트 QR · 번호 · 바코드 정규식 = DB · 조정 D271(SUPER) · BarcodeDetector · 손 입력 · 새 npm 없음 · 메뉴 · 화면 목록 · 문서 675
  ② (API · DB) 시험 로트 하나(replica 로 넣고 끝에 지움)로 — 열기 · 409 · QR · LOT- · 로트 번호 · 404 · 차이 · 고치기 · 닫기 · 닫은 뒤 409 · DB 지킴 · 조정 SUPER 만 · 차이 0 은 422(원가 장부 줄 안 생김)
     열린 회차가 이미 있거나 직판 옵션이 없으면 건너뜀 · 공유 데이터 남기지 않음(회차 · 줄 · 로트 · 시험 계정 지움)
  ③ (화면) 휴대폰 폭 390 — 소개몰 › 휴대폰 실사(로트 / 자산)
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


# ① 코드(API 없이도)
SQL = rd('prisma/migrations/D282_bi_export_dashboard_widgets_mobile_scan/migration.sql')
LC, CT, AM = rd('src/modules/dtx/lot-count.ts'), rd('src/modules/dtx/dtx.controller.ts'), rd('src/app.module.ts')
MS, MN, APP = rd('web/src/app/admin/MobileScan.tsx'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx')
PJ = rd('web/package.json')
ok('① D282 — 로트 실사 회차 · 줄(열 때 · 센 수 · 처음 센 때 장부 · 늦게 더함 · 조정 한 번) · 한 번에 하나만 열림 · 지킴 트리거 2',
   all(x in SQL for x in ('CREATE TABLE IF NOT EXISTS public.qlt_lot_counts', 'CREATE TABLE IF NOT EXISTS public.qlt_lot_count_lines', 'uq_qlt_cnt_one_open',
       'ck_qlt_cnt_line_pair', 'trg_qlt_cnt_guard', 'trg_qlt_cnt_line_guard', "('mob-scan', '휴대폰 실사', 'admhlt'")), '')
ok('① 서버 — 로트 QR · 로트 번호 · 상품 바코드 차례 · 로트 번호 · 바코드 정규식 = DB CHECK · 조정은 D271 adjustLot(SUPER) · SQL 에 글자 끼우기 없음',
   "LOT_CODE_RE = /^(?:SGB-)?LOT-?0*(\\d{1,18})$/i" in LC and "LOT_NO_RE = /^[0-9A-Za-z][0-9A-Za-z._/-]{0,39}$/" in LC and "BARCODE_RE = /^[0-9A-Z-]{4,32}$/" in LC
   and "import { adjustLot } from '../qlt/lots';" in LC and "@Post('qlt/lot-counts/:id/lines/:lotId/adjust')\n  @Roles('SUPER')" in CT and 'LotCountController,' in AM
   and not re.search(r'`[^`]*\b(SELECT|UPDATE|INSERT|DELETE)\b[^`]*\$\{', LC), '')
ok('① 화면 — BarcodeDetector 있으면 카메라(뒤 카메라 · 계속 읽기 · 같은 글자 2.5초) · 없으면 손 입력 · 자산 실사는 ㉟ API · 새 npm 없음 · 메뉴 소개몰 › 휴대폰 실사',
   "'BarcodeDetector' in window" in MS and "facingMode: 'environment'" in MS and 'getSupportedFormats' in MS and '2500' in MS and 'data-scan-nocam' in MS and 'data-scan-input' in MS
   and '/admin/hrx/stocktakes/${id}/scan' in MS and not re.search(r"from '(?!react'|\.)", MS) and not any(x in PJ for x in ('zxing', 'quagga', 'html5-qrcode', 'jsqr'))
   and "['mob-scan', '휴대폰 실사']" in MN and "'qlt-lots', ['mob-scan']" in MN and "{tab === 'mob-scan' && <MobileScan />}" in APP, '')
scr = {x['id']: x for x in json.loads(SJ or '{"screens":[]}')['screens']}
ok('① 화면 SB-ADM-DTX-030 — API 7', len(scr.get('SB-ADM-DTX-030', {}).get('apis', [])) == 7, '')
D675 = doc('675_')
ok('① 문서 675 — BarcodeDetector · 손 입력 · https · 차이 조정', all(x in D675 for x in ('BarcodeDetector', '손 입력', 'https', '차이 조정')), '')
ok('① 판 v10.537 이상', VT >= (10, 537), VER)

if API and DB:
    TAG = 'v1537-' + str(int(time.time()))
    stamp = int(time.time()) % 1000000
    made, lot_id, cnt_id = [], None, None
    opened = psql("SELECT count(*) FROM qlt_lot_counts WHERE state = 'OPEN'")
    opt = psql("SELECT o.id || '|' || p.id FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id JOIN hlt_sellers s ON s.id = p.seller_id WHERE s.type = 'DIRECT' ORDER BY o.id LIMIT 1")
    if opened != '0':
        print('  (열린 로트 실사가 이미 있음 — ② 건너뜀)')
    elif '|' not in (opt or ''):
        print('  (직판 상품 옵션 없음 — ② 건너뜀)')
    else:
        oid, pid = opt.split('|')
        try:
            import consent_ok
            TS, TB = login('admin@x.com'), login('buyer@x.com')
            is_super = psql("SELECT count(*) FROM account_roles r JOIN accounts a ON a.id = r.account_id WHERE a.email = 'admin@x.com' AND r.role = 'SUPER'") != '0'
            em, aid = mk_staff('lc', 'ADMIN')
            made.append(em)
            try:
                consent_ok.agree(em, PW)
            except Exception:
                pass
            TA = login(em)
            lot_no = f'T1537-{stamp}'
            lot_id = psql(f"SET session_replication_role = replica; INSERT INTO qlt_lots (option_id, product_id, lot_no, expires_on, in_kind, in_qty, state) VALUES ('{oid}', '{pid}', '{lot_no}', current_date + 90, 'OPEN', 5, 'OK') RETURNING id").splitlines()[-1]
            psql(f"SET session_replication_role = replica; INSERT INTO qlt_lot_moves (lot_id, kind, qty, qty_after, note) VALUES ({int(lot_id)}, 'OPEN', 5, 5, '시험 {TAG}')")
            mb = call('POST', '/admin/qlt/lot-counts', {'title': '시험 ' + TAG}, TB)
            op = call('POST', '/admin/qlt/lot-counts', {'title': '시험 ' + TAG}, TS)
            cnt_id = op.get('id')
            op2 = call('POST', '/admin/qlt/lot-counts', {'title': '시험 두 번째'}, TS)
            dt = call('GET', f'/admin/qlt/lot-counts/{cnt_id}', None, TS)
            mine = next((x for x in dt.get('lines') or [] if x.get('lotId') == str(lot_id)), {})
            ok('② 열기 — 회원 403 · 열림 · 두 번째 409 QLT_CNT_OPEN · 시험 로트 줄(열 때 5 · 세지 않음 · QR 코드 SGB-LOT-…)',
               mb.get('_err') == 403 and op.get('ok') is True and op2.get('code') == 'QLT_CNT_OPEN' and mine.get('expected') == 5 and mine.get('counted') is None
               and mine.get('code') == 'SGB-LOT-' + str(lot_id).zfill(6), f"{mb.get('_err')} {op.get('note')} {op2.get('code')} {mine}")
            s1 = call('POST', f'/admin/qlt/lot-counts/{cnt_id}/scan', {'code': 'SGB-LOT-' + str(lot_id).zfill(6)}, TA)
            s2 = call('POST', f'/admin/qlt/lot-counts/{cnt_id}/scan', {'code': 'lot-' + str(lot_id)}, TA)
            s3 = call('POST', f'/admin/qlt/lot-counts/{cnt_id}/scan', {'code': lot_no, 'counted': 4}, TA)
            s4 = call('POST', f'/admin/qlt/lot-counts/{cnt_id}/scan', {'code': 'ZZ-NOPE-' + str(stamp)}, TA)
            s5 = call('POST', f'/admin/qlt/lot-counts/{cnt_id}/scan', {'code': lot_no, 'add': 0}, TA)
            dt2 = call('GET', f'/admin/qlt/lot-counts/{cnt_id}', None, TA)
            mine2 = next((x for x in dt2.get('lines') or [] if x.get('lotId') == str(lot_id)), {})
            ok('② 읽기 — QR +1 · LOT-번호 +1(2) · 로트 번호로 4 · 못 찾음 404 · 더하는 수 0 은 400 · 차이 −1(처음 센 때 장부 5)',
               s1.get('counted') == 1 and s1.get('via') == 'QR' and s2.get('counted') == 2 and s3.get('counted') == 4 and s3.get('via') == 'LOT_NO'
               and s4.get('_err') == 404 and s5.get('_err') == 400 and mine2.get('bookQty') == 5 and mine2.get('diff') == -1,
               f"{s1.get('counted')} {s2.get('counted')} {s3.get('counted')} {s3.get('via')} {s4.get('_err')} {s5.get('_err')} {mine2.get('bookQty')} {mine2.get('diff')}")
            pu = call('PUT', f'/admin/qlt/lot-counts/{cnt_id}/lines/{lot_id}', {'counted': 5, 'note': '시험'}, TA)
            pn = call('PUT', f'/admin/qlt/lot-counts/{cnt_id}/lines/{lot_id}', {}, TA)
            pending = psql(f"SELECT count(*) FROM qlt_lot_count_lines WHERE count_id = {int(cnt_id)} AND counted IS NULL")
            c1 = call('POST', f'/admin/qlt/lot-counts/{cnt_id}/close', {}, TA)
            c2 = call('POST', f'/admin/qlt/lot-counts/{cnt_id}/close', {'skipUncounted': True}, TA)
            c3 = call('POST', f'/admin/qlt/lot-counts/{cnt_id}/close', {'skipUncounted': True}, TA)
            ok('② 고치기 · 닫기 — 5 로(차이 0) · 빈 요청 422 · 세지 않은 줄 남으면 422(없으면 바로 닫힘) · 그대로 닫기 · 다시 닫기 409',
               pu.get('counted') == 5 and pn.get('code') == 'QLT_CNT_NOTHING' and (c1.get('code') == 'QLT_CNT_PENDING' if pending != '0' else c1.get('ok') is True)
               and (c2.get('ok') is True if pending != '0' else c2.get('_err') == 409) and c3.get('_err') == 409,
               f"{pu.get('counted')} {pn.get('code')} pending={pending} {c1.get('code') or c1.get('ok')} {c2.get('ok') or c2.get('_err')} {c3.get('_err')}")
            af = call('PUT', f'/admin/qlt/lot-counts/{cnt_id}/lines/{lot_id}', {'counted': 3}, TA)
            dbg = psql(f"UPDATE qlt_lot_count_lines SET counted = 3 WHERE count_id = {int(cnt_id)} AND lot_id = {int(lot_id)}")
            dbd = psql(f"DELETE FROM qlt_lot_counts WHERE id = {int(cnt_id)}")
            ad_a = call('POST', f'/admin/qlt/lot-counts/{cnt_id}/lines/{lot_id}/adjust', {'reason': '시험 조정'}, TA)
            ad_s = call('POST', f'/admin/qlt/lot-counts/{cnt_id}/lines/{lot_id}/adjust', {'reason': '시험 조정'}, TS)
            ok('② 닫은 뒤 — 고치기 409 · DB 가 센 수 고치기 · 회차 지우기 막음 · 조정은 SUPER 만(ADMIN 403) · 차이 0 은 422 QLT_CNT_NODIFF(원가 장부 줄 안 생김)',
               af.get('_err') == 409 and 'QLT_CNT' in dbg and 'QLT_CNT' in dbd and ad_a.get('_err') == 403
               and (ad_s.get('code') == 'QLT_CNT_NODIFF' if is_super else ad_s.get('_err') == 403), f"{af.get('_err')} {dbg[-40:]} {dbd[-40:]} {ad_a.get('_err')} {ad_s.get('code') or ad_s.get('_err')}")
            rmap = psql("SELECT count(*) FROM perm_route_map WHERE task_key = 'mob-scan'")
            ok('② 권한 주소 7', rmap == '7', rmap)
        finally:
            if cnt_id and re.match(r'^\d+$', str(cnt_id)):
                psql(f"SET session_replication_role = replica; DELETE FROM qlt_lot_count_lines WHERE count_id = {int(cnt_id)}; DELETE FROM qlt_lot_counts WHERE id = {int(cnt_id)};")
            if lot_id and re.match(r'^\d+$', str(lot_id)):
                psql(f"SET session_replication_role = replica; DELETE FROM qlt_lot_count_lines WHERE lot_id = {int(lot_id)}; DELETE FROM qlt_lot_moves WHERE lot_id = {int(lot_id)}; DELETE FROM qlt_lots WHERE id = {int(lot_id)};")
            for e in made:
                psql(f"SET session_replication_role = replica; DELETE FROM account_roles WHERE account_id IN (SELECT id FROM accounts WHERE email = '{e}'); DELETE FROM accounts WHERE email = '{e}';")
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(800)
            pg.wait_for_selector('[data-mobile-scan]', timeout=30000)
            seen['mode'] = pg.get_attribute('[data-mobile-scan]', 'data-mobile-scan')
            seen['btns'] = pg.locator('[data-scan-mode]').count()
            bb = pg.locator('[data-mobile-scan]').bounding_box() or {}
            seen['w'] = int(bb.get('width') or 0)
            pg.click('[data-scan-mode="ASSET"]'); pg.wait_for_timeout(800)
            seen['mode2'] = pg.get_attribute('[data-mobile-scan]', 'data-mobile-scan')
        r = admin_page('/#/mob-scan', chk)
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 휴대폰 폭 390 · 로트 / 자산 단추 2 · 폭 안에 들어감 · 자산으로 바꿈 · 화면 오류 없음',
               seen.get('mode') == 'LOT' and seen.get('btns') == 2 and 0 < seen.get('w', 0) <= 390 and seen.get('mode2') == 'ASSET' and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
