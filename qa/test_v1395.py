"""v10.395 (D245 · docs/532) 직판 재고 수불부 — 이동평균 · 매출원가 전표
  ① (코드) 표 · 트리거 · 정기 작업 acct_stock · 전표 4가지 · API 4 · 화면 · 문서 532
  ② (API) 입고 두 번 → 이동평균 · 회원 403 · PAYOUT 은 조정 못 함 · 실사 줄임(평균 원가) · 0 아래 422 · 사유 422
  ③ (트리거 · 정기 작업) 모자란 출고는 원가 0(남은 금액만) · 쌓기만(고치기 막힘) · 입점 상품 막힘 · STOCK_NEGATIVE 알림
  ④ (전표) 입고 「상품 / 미지급금」 · 매입 번호 있으면 입고 전표 없음 · 실사 · 매출원가 전표
  ⑤ (화면) 회계 › 재고
  시험이 넣은 수불 · 전표는 끝에 지움(replica) — 두 번 돌아도 통과
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



import glob
MD = next(iter(sorted(glob.glob(os.path.join(K, 'prisma/migrations/D245_*/migration.sql')))), '')
M45 = open(MD, encoding='utf-8').read() if MD else ''
ST, JN, AC, UI, MN = rd('src/modules/acct/stock.ts'), rd('src/modules/acct/sources.ts'), rd('src/modules/acct/acct.controller.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/lib/adminMenu.ts')
SC, WK = rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')
ok('① 코드 — 수불부 표 · 이동평균 트리거 · 정기 작업 acct_stock · 전표 4가지(STOCK_SOURCES) · API 4 · 화면 AcctStock · 메뉴 acct-stock · 문서 532 · 판 v10.395',
   'acct_stock_moves' in M45 and 'fn_acct_stock_move' in M45 and "('acct_stock', 60," in M45
   and 'export const STOCK_SOURCES' in ST and all(f"name: '{x}'" in ST for x in ('STOCK_IN', 'COGS', 'COGS_RETURN', 'STOCK_ADJUST')) and 'export async function stockJob' in ST
   and 'STOCK_SOURCES' in JN and "case 'acct_stock':" in SC and "'acct_stock'," in WK
   and "@Get('stock')" in AC and "@Get('stock/:code/moves')" in AC and "@Post('stock/in')" in AC and "@Post('stock/adjust')" in AC
   and 'export function AcctStock' in UI and "'acct-stock'" in MN and '/admin/acct/stock' in SJ and '이동평균' in doc('532_') and VT >= (10, 395), f"{VER} · {os.path.basename(os.path.dirname(MD)) if MD else 'D245 없음'}")


def last(opt):
    r = psql(f"SELECT coalesce((SELECT qty_after || '|' || amount_after FROM acct_stock_moves WHERE option_id = '{opt}' ORDER BY id DESC LIMIT 1), '0|0')")
    q, a = (r.split('|') + ['0'])[:2]
    return int(q), int(a)


if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1395', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    opt = psql("SELECT o.id FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id JOIN hlt_sellers s ON s.id = p.seller_id AND s.type = 'DIRECT' WHERE o.is_active ORDER BY o.created_at, o.id LIMIT 1")
    code = psql(f"SELECT p.code FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id WHERE o.id = '{opt}'") if opt else ''
    tenant_opt = psql("SELECT o.id FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id JOIN hlt_sellers s ON s.id = p.seller_id AND s.type <> 'DIRECT' ORDER BY o.created_at LIMIT 1")
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    today, ym = kst.strftime('%Y-%m-%d'), kst.strftime('%Y-%m')
    keep_start = getset('acct.start_on')
    t0 = psql("SELECT now()")
    mine = []
    try:
        if keep_start and keep_start > today:
            setting('acct.start_on', f'{ym}-01', '1395')
        # 시험 전 정기 작업 — 지난 결제 출고를 먼저 처리(시험 줄이 그 옵션 맨 끝이 되게)
        call('POST', '/admin/jobs', {'job': 'acct_stock'}, TS)
        pq, pa = last(opt)
        r1 = call('POST', '/admin/acct/stock/in', {'optionId': opt, 'qty': 10, 'unitCost': 1000, 'note': '시험 1395 입고 1'}, TP)
        r2 = call('POST', '/admin/acct/stock/in', {'optionId': opt, 'qty': 5, 'unitCost': 1600, 'purchaseId': '987654321', 'note': '시험 1395 입고 2'}, TP)
        mine += [x.get('id') for x in (r1, r2) if x.get('id')]
        exp_avg = round((pa + 18000) / (pq + 15), 2)
        rb = call('POST', '/admin/acct/stock/in', {'optionId': opt, 'qty': 1, 'unitCost': 1}, TB)
        rpa = call('POST', '/admin/acct/stock/adjust', {'optionId': opt, 'qty': -1, 'reason': '시험 1395 PAYOUT'}, TP)
        q1, a1 = last(opt)
        r3 = call('POST', '/admin/acct/stock/adjust', {'optionId': opt, 'qty': -3, 'reason': '시험 1395 실사'}, TS)
        if r3.get('id'): mine.append(r3['id'])
        from decimal import Decimal, ROUND_HALF_UP
        exp_cost = a1 if 3 >= q1 else int((Decimal(a1) * 3 / Decimal(q1)).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
        q2, a2 = last(opt)
        r4 = call('POST', '/admin/acct/stock/adjust', {'optionId': opt, 'qty': -(q2 + 1), 'reason': '시험 1395 넘침'}, TS)
        r5 = call('POST', '/admin/acct/stock/adjust', {'optionId': opt, 'qty': -1, 'reason': 'x'}, TS)
        lst = call('GET', '/admin/acct/stock', None, TP)
        row = next((x for x in lst.get('items') or [] if x.get('optionId') == opt), {})
        mv = call('GET', f'/admin/acct/stock/{code}/moves?ym={ym}', None, TP)
        ok('② API — 입고 두 번 이동평균 · 회원 403 · PAYOUT 조정 403 · 실사 줄임은 평균 원가 · 0 아래 422 ACCT_STOCK · 짧은 사유 422 · 목록 · 수불',
           bool(opt) and int(r1.get('qtyAfter', -1)) == pq + 10 and int(r1.get('amountAfter', -1)) == pa + 10000
           and abs(float(r2.get('avgAfter') or 0) - exp_avg) < 0.011 and rb.get('_err') == 403 and rpa.get('_err') == 403
           and int(r3.get('qtyAfter', -1)) == q1 - 3 and int(r3.get('amount', 1)) == -exp_cost
           and r4.get('_err') == 422 and r4.get('code') == 'ACCT_STOCK' and r5.get('_err') == 422 and r5.get('code') == 'ACCT_REASON'
           and int(row.get('qty', -1)) == q2 and len(mv.get('moves') or []) >= 3,
           f"opt {opt} 앞 {pq}/{pa} · r1 {r1.get('qtyAfter')}/{r1.get('amountAfter')} · 평균 {r2.get('avgAfter')}≈{exp_avg} · {rb.get('_err')} {rpa.get('_err')} · 실사 {r3.get('qtyAfter')} {r3.get('amount')}=-{exp_cost} · {r4.get('code')} {r5.get('code')} · 목록 {row.get('qty')}={q2} · 수불 {len(mv.get('moves') or [])}")

        # ③ 모자란 출고 · 쌓기만 · 입점 막힘 · 알림
        q3, a3 = last(opt)
        sk = f"T1395:{int(time.time())}"
        zid = psql(f"INSERT INTO acct_stock_moves (option_id, moved_on, kind, qty, source_key) VALUES ('{opt}', '{today}', 'OUT_SALE', {-(q3 + 2)}, '{sk}') RETURNING id")
        if zid.isdigit(): mine.append(zid)
        z = psql(f"SELECT zero_cost || '|' || qty_after || '|' || amount FROM acct_stock_moves WHERE source_key = '{sk}'")
        up = psql(f"UPDATE acct_stock_moves SET note = 'x' WHERE source_key = '{sk}'")
        ten = psql(f"INSERT INTO acct_stock_moves (option_id, moved_on, kind, qty, unit_cost, source_key) VALUES ('{tenant_opt}', '{today}', 'IN', 1, 100, 'T1395T:{int(time.time())}')") if tenant_opt else '!ACCT_STOCK (입점 옵션 없음)'
        j = call('POST', '/admin/jobs', {'job': 'acct_stock'}, TS)
        neg = psql("SELECT count(*) FROM ops_alerts WHERE alert_code = 'STOCK_NEGATIVE' AND resolved_at IS NULL")
        ok('③ 트리거 · 정기 작업 — 모자란 출고 원가 0(남은 금액만 · 남은 0개) · 고치기 막힘 · 입점 상품 막힘 · STOCK_NEGATIVE 알림',
           z == f"true|0|{-a3}" and 'ACCT_STOCK' in up and 'ACCT_STOCK' in ten and not j.get('_err') and int(neg or 0) >= 1,
           f"{z} (기대 true|0|{-a3}) · {up[-60:]} · {ten[-60:]} · {j.get('_err') or ''} · 알림 {neg}")

        # ④ 전표
        jr = call('POST', '/admin/jobs', {'job': 'acct_journal'}, TS)
        def ent(src, key):
            return psql(f"SELECT coalesce(string_agg(l.role || ':' || l.debit || ':' || l.credit, ',' ORDER BY l.role), '') FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id WHERE e.source = '{src}' AND e.source_key = '{key}'")
        e1 = ent('STOCK_IN', r1.get('id')); e2 = ent('STOCK_IN', r2.get('id')); e3 = ent('STOCK_ADJUST', r3.get('id')); e4 = ent('COGS', zid)
        ok('④ 전표 — 입고 「상품 / 미지급금」 · 매입 번호 있는 입고는 전표 없음 · 실사 줄임 「매출원가 / 상품」 · 모자란 출고도 남은 금액만큼 매출원가',
           e1 == 'AP:0:10000,INVENTORY:10000:0' and e2 == '' and e3 == f'COGS:{exp_cost}:0,INVENTORY:0:{exp_cost}'
           and (e4 == f'COGS:{a3}:0,INVENTORY:0:{a3}' if a3 > 0 else e4 == '') and not jr.get('_err'),
           f"입고 {e1} · 매입 {e2!r} · 실사 {e3} · 원가 {e4} ({a3})")
    finally:
        ids = ','.join(str(int(x)) for x in mine if str(x).isdigit())
        if ids:
            psql(f"SET session_replication_role = replica; DELETE FROM acct_lines WHERE entry_id IN (SELECT id FROM acct_entries WHERE source IN ('STOCK_IN', 'STOCK_ADJUST', 'COGS', 'COGS_RETURN') AND source_key IN ({','.join(repr(str(int(x))) for x in mine if str(x).isdigit())})); "
                 f"DELETE FROM acct_entries WHERE source IN ('STOCK_IN', 'STOCK_ADJUST', 'COGS', 'COGS_RETURN') AND source_key IN ({','.join(repr(str(int(x))) for x in mine if str(x).isdigit())}); "
                 f"DELETE FROM acct_stock_moves WHERE id IN ({ids})")
        psql(f"UPDATE ops_alerts SET resolved_at = now(), resolve_note = '시험 1395' WHERE alert_code = 'STOCK_NEGATIVE' AND resolved_at IS NULL AND raised_at >= '{t0}'::timestamptz")
        if keep_start: setting('acct.start_on', keep_start, '1395 되돌림')
        rm_role(pid, '1395')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-acct-stock]', timeout=30000)
            seen['box'] = pg.locator('[data-acct-stock]').count()
            seen['in'] = pg.locator('[data-acct-stock-in]').count()
            seen['rows'] = pg.locator('[data-acct-stock-row]').count()
        res = admin_page('/#/acct-stock', chk)
        if res is None: print('  (playwright 없음 — ⑤ 건너뜀)')
        else:
            seen, perr = res
            ok('⑤ 화면 — 회계 › 재고 · 입고 줄 · 옵션 줄 · 화면 오류 없음',
               seen.get('box') == 1 and seen.get('in') == 1 and seen.get('rows', 0) >= 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ~ ⑤ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
