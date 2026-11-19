"""v10.388 (D244 · docs/525) 은행 거래 내역 맞추기
  ① (코드) D244 통장 표 · 가드 · API · 화면 · 문서
  ② (API · DB) CSV 올리기 — 머리줄 찾기 · 같은 파일 다시 올리면 「이미 있음」 · 못 읽은 줄 · 내용 고치기 · 지우기 DB 가 막음
  ③ (API) 맞춤 — 후보(금액 · 날짜 · 이름) · 다른 금액 전표 422 · 맞춤 · 같은 전표 409 · 맞출 것 없음 사유 · 풀기 · 자동 맞춤
  ④ (화면) 회계 › 은행 맞추기
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


M44 = rd('prisma/migrations/D244_acct_bank_format_deadline_etax/migration.sql')
AC, RP, UI, AP, MN = rd('src/modules/acct/acct.controller.ts'), rd('src/modules/acct/acct-reports.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
BK = rd('src/modules/acct/bank.ts')
ok('① 코드 — D244 통장 표 · 같은 줄 한 번 · 맞춤 가드 · 설정 · API 4 · 감사 · 화면 · 메뉴 · 명세 · 문서 525 · 판 v10.388',
   'CREATE TABLE IF NOT EXISTS public.acct_bank_txns' in M44 and 'row_hash      text NOT NULL UNIQUE' in M44 and 'ACCT_BANK_MISMATCH' in M44 and "'acct.bank_match_days'" in M44
   and "@Post('bank/upload')" in AC and "@Get('bank')" in AC and "@Post('bank/:id/match')" in AC and "@Post('bank/auto-match')" in AC and "@Audit('ACCT_BANK_MATCH', 'SETTING')" in AC
   and 'export function readBankCsv' in BK and 'export function AcctBank' in UI and "{tab === 'acct-bank' && <AcctBank />}" in AP and "['acct-bank', '은행 맞추기']" in MN
   and '"SB-ADM-ACC-060"' in SJ and '은행' in doc('525_') and VT >= (10, 388), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1388', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    ym, d0 = kst.strftime('%Y-%m'), kst.strftime('%Y-%m-%d')
    stamp = int(time.time()) % 1000000
    amt = 40000 + stamp % 9000            # 다른 시험 · 두 번째 돌림과 겹치지 않는 금액
    name = f'시험광고1388{stamp}'
    try:
        adv = call('POST', '/admin/advertisers', {'code': f'ADV-1388-{stamp}', 'name': f'(주){name}'}, TS)
        inv = call('POST', '/admin/ad-invoices', {'advertiserId': adv.get('id'), 'periodFrom': d0, 'periodTo': d0, 'amount': amt, 'vat': 0, 'dueDate': d0, 'memo': '시험 1388'}, TS)
        pay = call('POST', f"/admin/ad-invoices/{inv.get('id')}/payments", {'amount': amt, 'method': 'TRANSFER', 'payerName': name}, TS)
        call('POST', '/admin/acct/journal/run', None, TS)
        eid = psql(f"SELECT e.id FROM acct_entries e JOIN ad_payments p ON p.id::text = e.source_key WHERE e.source = 'AD_PAYMENT' AND p.invoice_id = '{inv.get('id')}'")
        other = psql(f"SELECT e.id FROM acct_entries e WHERE e.source = 'AD_INVOICE' AND e.source_key = '{inv.get('id')}'")
        intr = 1 + stamp % 97
        csv = ('은행 거래내역 조회\n조회기간,2026-11-01 ~ 2026-11-30\n'
               '거래일시,적요,기재내용,찾으신금액,맡기신금액,거래후잔액,메모\n'
               f'"{d0} 10:11:12",타행이체,{name},0,"{amt:,}","{1000000 + amt:,}",시험1388-{stamp}\n'
               f'{d0.replace("-", ".")},이자,예금이자,0,{intr},{1000000 + amt + intr},시험1388-{stamp}\n'
               f'날짜아님,이상한줄,,0,abc,,\n')
        up = call('POST', '/admin/acct/bank/upload', {'csv': csv, 'filename': f't1388-{stamp}.csv', 'bank': '시험은행'}, TP)
        up2 = call('POST', '/admin/acct/bank/upload', {'csv': csv, 'filename': f't1388-{stamp}.csv'}, TP)
        bad = call('POST', '/admin/acct/bank/upload', {'csv': '아무 글\n1,2,3\n'}, TP)
        mem = call('POST', '/admin/acct/bank/upload', {'csv': csv}, TB)
        tid = psql(f"SELECT id FROM acct_bank_txns WHERE memo = '시험1388-{stamp}' AND deposit = {amt}")
        iid = psql(f"SELECT id FROM acct_bank_txns WHERE memo = '시험1388-{stamp}' AND deposit = {intr}")
        e1 = psql(f"UPDATE acct_bank_txns SET deposit = 1 WHERE id = {tid or 0}")
        e2 = psql(f"DELETE FROM acct_bank_txns WHERE id = {tid or 0}")
        ok('② CSV — 머리줄(3번째 줄) 찾기 · 새로 2 · 못 읽음 1 · 같은 파일 다시 올리면 새로 0 · 이미 있음 2 · 머리줄 없으면 422 · 회원 403 · 내용 고치기 · 지우기 DB 가 막음',
           up.get('added') == 2 and up.get('bad') == 1 and up2.get('added') == 0 and up2.get('dup') == 2 and bad.get('code') == 'BANK_CSV_HEAD' and mem.get('_err') == 403
           and bool(tid) and bool(iid) and 'ACCT_BANK' in e1 and 'ACCT_BANK' in e2 and bool(eid),
           f"{ {k: up.get(k) for k in ('added', 'dup', 'bad')} } · 다시 {up2.get('added')}/{up2.get('dup')} · {bad.get('code')} · {mem.get('_err')} · {tid} {iid} · {e1[-40:]} · {e2[-40:]} · 전표 {eid} {pay.get('_err') or ''}")

        bm = call('GET', f'/admin/acct/bank?ym={ym}', None, TP)
        row = next((x for x in bm.get('items') or [] if x.get('id') == tid), {})
        cand = row.get('candidates') or []
        wrong = call('POST', f'/admin/acct/bank/{tid}/match', {'entryId': other}, TP)
        m1 = call('POST', f'/admin/acct/bank/{tid}/match', {'entryId': eid}, TP)
        m2 = call('POST', f'/admin/acct/bank/{iid}/match', {'entryId': eid}, TP)
        ig0 = call('POST', f'/admin/acct/bank/{iid}/match', {'ignore': True, 'note': ''}, TP)
        ig1 = call('POST', f'/admin/acct/bank/{iid}/match', {'ignore': True, 'note': '예금 이자'}, TP)
        cl0 = call('POST', f'/admin/acct/bank/{tid}/match', {'clear': True}, TP)
        cl1 = call('POST', f'/admin/acct/bank/{tid}/match', {'clear': True, 'note': '시험 다시 맞춤'}, TP)
        au = call('POST', '/admin/acct/bank/auto-match', {'ym': ym}, TP)
        st = psql(f"SELECT coalesce(match_kind, '') || '|' || coalesce(entry_id::text, '') FROM acct_bank_txns WHERE id = {tid}")
        st2 = psql(f"SELECT coalesce(match_kind, '') || '|' || coalesce(match_note, '') FROM acct_bank_txns WHERE id = {iid}")
        ok('③ 맞춤 — 후보에 그 전표(이름 ✓) · 다른 금액 전표 422 · 맞춤 · 같은 전표 두 번 409 · 맞출 것 없음 사유 없으면 422 · 사유 있으면 됨 · 풀기 사유 없으면 422 · 풀기 · 자동 맞춤이 다시 맞춤',
           any(c.get('entryId') == eid and c.get('nameOk') for c in cand) and wrong.get('code') == 'ACCT_BANK_MISMATCH' and m1.get('matchKind') == 'ENTRY'
           and m2.get('code') == 'BANK_ENTRY_USED' and ig0.get('code') == 'BANK_REASON' and ig1.get('matchKind') == 'IGNORE' and cl0.get('code') == 'BANK_REASON'
           and cl1.get('ok') is True and (au.get('matched') or 0) >= 1 and st == f'ENTRY|{eid}' and st2 == 'IGNORE|예금 이자' and (bm.get('lastBalance') or {}).get('balance') is not None,
           f"후보 {[(c.get('entryId'), c.get('nameOk')) for c in cand]} · {wrong.get('code')} · {m1.get('matchKind')} · {m2.get('code')} · {ig0.get('code')} {ig1.get('matchKind')} · {cl0.get('code')} {cl1.get('ok')} · 자동 {au.get('matched')} · {st} · {st2}")
    finally:
        rm_role(pid, '1388')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-acct-bank]', timeout=30000)
            seen['bank'] = pg.locator('[data-acct-bank]').count()
            seen['rows'] = pg.locator('[data-acct-bank-row]').count()
            seen['file'] = pg.locator('[data-acct-bank-file]').count()
        res = admin_page('/#/acct-bank', chk)
        if res is None: print('  (playwright 없음 — ④ 건너뜀)')
        else:
            seen, perr = res
            ok('④ 화면 — 회계 › 은행 맞추기 · 통장 줄 표 · 올리기 단추 · 화면 오류 없음',
               seen.get('bank') == 1 and seen.get('rows', 0) >= 1 and seen.get('file') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ③ ④ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
