"""v10.452 (D260 · docs/589) 결산 외화 받을 돈 환산 평가
  ① (코드) acct_fx_revals · 가드 · 계정 FX_REVAL_GAIN · FX_REVAL_LOSS · 미리보기 · 넣기(SUPER · 감사) · 화면 AcctFxReval · 화면 ID SB-ADM-LDG-030 · 문서 589
  ② (API · DB) 시험 수출(USD 100 · 선적 환율 1300) → 매출 전표 → 미리보기(환율 1400 · 차이 +10,000) · 환율 빠짐 422 · 앞달 422 · 지급 담당 넣기 403
              · 넣기 — 평가 전표(말일) + 되돌림(다음 달 첫날 · 차대 반대) · 두 번 409 · 기록 고치기 DB 막음
  ③ (화면) 회계 › 장부 › 외화 환산
  이번 달 시험 기록 · 전표 · 시험 수출은 끝에 지움(replica) — 시험 전에 이번 달 기록이 이미 있으면 넣기는 409 만 확인.
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


def raw(m_, url, data, ct, t=None):
    hd = {'content-type': ct}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    try:
        return urllib.request.urlopen(urllib.request.Request(url, data=data, headers=hd, method=m_), timeout=60).status
    except urllib.error.HTTPError as e:
        return e.code


M60 = migr('D260_')
BK, BC = rd('src/modules/acct/books.ts'), rd('src/modules/acct/acct-books.controller.ts')
UI, AP, MN, AM, AT, MA = rd('web/src/app/admin/AcctBooks.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/app.module.ts'), rd('web/src/app/admin/Acct.tsx'), rd('src/modules/acct/manual.ts')
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today = kst.strftime('%Y-%m-%d'); ym = today[:7]; m1 = ym + '-01'
stamp = int(time.time()) % 1000000
ok('① 코드 — 환산 평가 표 · 가드(말일 · 쌓기만) · 계정 2 · 함수 · API 3(넣기 SUPER · 감사 ACCT_FXREVAL) · 화면 · 메뉴 · 탭 · 화면 ID · 권한 업무 · 문서 589 · 판 v10.452',
   'CREATE TABLE IF NOT EXISTS public.acct_fx_revals' in M60 and 'fn_acct_fx_reval_guard' in M60 and "('FX_REVAL_GAIN'," in M60 and "('FX_REVAL_LOSS'," in M60
   and 'export async function fxRevalPost' in BK and "@Get('fx-reval/preview')" in BC and "@Audit('ACCT_FXREVAL', 'SETTING')" in BC
   and 'export function AcctFxReval' in UI and "['acct-fxreval', '외화 환산']" in MN and "{tab === 'acct-fxreval' && <AcctFxReval />}" in AP
   and '"SB-ADM-LDG-030"' in SJ and "('acct-fxreval'," in M60 and '환산' in doc('589_') and VT >= (10, 452), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    pe, pid = mk_staff('1452', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    had = psql(f"SELECT count(*) FROM acct_fx_revals WHERE ym = '{ym}'") != '0'
    eid = None
    nym = (datetime.date(int(ym[:4]), int(ym[5:]), 28) + datetime.timedelta(days=5)).strftime('%Y-%m')
    try:
        ex = call('POST', '/admin/acct/exports', {'title': f'시험1452 환산 {stamp}', 'currency': 'USD', 'orderedOn': today, 'lines': [{'item': '시험 품목 1452', 'qty': 1, 'foreignAmount': 100}]}, TS)
        eid = ex.get('id')
        sh = call('POST', f'/admin/acct/exports/{eid}/advance', {'to': 'SHIPPED', 'date': today, 'fxRate': 1300}, TS)
        call('POST', '/admin/acct/journal/run', None, TS)
        sale = psql(f"SELECT count(*) FROM acct_entries WHERE source = 'EXPORT_SALE' AND source_key = '{eid}'")
        v = call('GET', f'/admin/acct/fx-reval?ym={ym}', None, TP)
        cur = sorted(set((v.get('currencies') or []) + ['USD']))
        rates = ','.join(f'{c}:1400' for c in cur)
        pv = call('GET', f'/admin/acct/fx-reval/preview?ym={ym}&rates={rates}', None, TP)
        mine = next((x for x in pv.get('items') or [] if x.get('exportId') == eid), {})
        miss = call('GET', f'/admin/acct/fx-reval/preview?ym={ym}&rates=', None, TP)
        fut = call('GET', f'/admin/acct/fx-reval/preview?ym={nym}&rates=USD:1400', None, TP)
        byp = call('POST', '/admin/acct/fx-reval', {'ym': ym, 'rates': {c: 1400 for c in cur}}, TP)
        po = call('POST', '/admin/acct/fx-reval', {'ym': ym, 'rates': {c: 1400 for c in cur}}, TS)
        again = call('POST', '/admin/acct/fx-reval', {'ym': ym, 'rates': {c: 1400 for c in cur}}, TS)
        last = (datetime.date(int(nym[:4]), int(nym[5:]), 1) - datetime.timedelta(days=1)).strftime('%Y-%m-%d')
        e1 = psql(f"SELECT entry_date::text || '|' || source || '|' || (SELECT sum(debit) FROM acct_lines WHERE entry_id = e.id) || '|' || (SELECT sum(credit) FROM acct_lines WHERE entry_id = e.id) FROM acct_entries e WHERE id = {int(po.get('entryId') or 0)}")
        e2 = psql(f"SELECT entry_date::text || '|' || source FROM acct_entries WHERE id = {int(po.get('reverseEntryId') or 0)}")
        flip = psql(f"SELECT count(*) FROM acct_lines a JOIN acct_lines b ON b.role = a.role AND b.debit = a.credit AND b.credit = a.debit WHERE a.entry_id = {int(po.get('entryId') or 0)} AND b.entry_id = {int(po.get('reverseEntryId') or 0)}")
        nl = psql(f"SELECT count(*) FROM acct_lines WHERE entry_id = {int(po.get('entryId') or 0)}")
        up = psql(f"UPDATE acct_fx_revals SET note = '시험 1452' WHERE ym = '{ym}'")
        posted = (po.get('ok') is True and po.get('gain', 0) >= 10000 and e1.startswith(f'{last}|FX_REVAL|') and e1.split('|')[2] == e1.split('|')[3]
                  and e2 == f'{nym}-01|FX_REVAL_REV' and flip == nl and nl != '0' and again.get('code') == 'ACCT_FXREVAL_DONE') if not had else po.get('code') == 'ACCT_FXREVAL_DONE'
        ok('② 환산 평가 — 매출 전표 · 미리보기(내 건 +10,000) · 환율 빠짐 표시 · 앞달 422 · 지급 담당 403 · 넣기(말일 차대 같음 · 되돌림 다음 달 첫날 · 차대 반대) · 두 번 409 · 고치기 DB 막음',
           ex.get('ok') is True and sh.get('saleKrw') == 130000 and sale == '1' and mine.get('diff') == 10000 and mine.get('evalKrw') == 140000
           and 'USD' in (miss.get('missing') or []) and fut.get('_err') == 422 and byp.get('_err') == 403 and posted and 'ACCT_FXREVAL' in up,
           f"{ex.get('ok')} {sh.get('saleKrw')} {sale} · {mine.get('diff')} {mine.get('evalKrw')} · {miss.get('missing')} · {fut.get('_err')} · {byp.get('_err')} · had={had} {po.get('ok') or po.get('code')} {po.get('gain')} {e1} {e2} {flip}/{nl} {again.get('code')} · {up[-30:]}")
    finally:
        if not had:
            psql(f"SET session_replication_role = replica; "
                 f"CREATE TEMP TABLE t1452 AS SELECT entry_id AS id FROM acct_fx_revals WHERE ym = '{ym}' AND entry_id IS NOT NULL UNION SELECT reverse_entry_id FROM acct_fx_revals WHERE ym = '{ym}' AND reverse_entry_id IS NOT NULL; "
                 f"DELETE FROM acct_fx_revals WHERE ym = '{ym}'; DELETE FROM acct_lines WHERE entry_id IN (SELECT id FROM t1452); DELETE FROM acct_entries WHERE id IN (SELECT id FROM t1452)")
        if eid:
            psql(f"SET session_replication_role = replica; "
                 f"CREATE TEMP TABLE e1452 AS SELECT id FROM acct_entries WHERE source IN ('EXPORT_SALE', 'EXPORT_PAID') AND source_key = '{eid}'; "
                 f"DELETE FROM acct_lines WHERE entry_id IN (SELECT id FROM e1452); DELETE FROM acct_entries WHERE id IN (SELECT id FROM e1452); "
                 f"DELETE FROM acct_export_lines WHERE export_id = {int(eid)}; DELETE FROM acct_exports WHERE id = {int(eid)}")
        rm_role(pid, '1452')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-acct-fxreval]', timeout=30000)
            seen['ok'] = pg.get_attribute('[data-acct-fxreval]', 'data-acct-fxreval') is not None
        res = admin_page('/#/acct-fxreval', chk)
        if res is None: print('  (playwright 없음 — ③ 건너뜀)')
        else:
            seen, perr = res
            ok('③ 화면 — 회계 › 장부 › 외화 환산 · 화면 오류 없음', seen.get('ok') is True and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
