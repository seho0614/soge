"""v10.409 (D249 · docs/546) 계약 대장 · 만기 알림
  ① (코드) D249 계약 표 · 바꾼 기록 · 가드 · 정기 작업 acct_contracts · API 4 · 화면 · 문서 546
  ② (API · DB) 넣기 · 달 금액 → 자금 흐름 예정(MONTHLY) · 입력 검사 · 회원 403
  ③ (정기 작업) 만기 N일 전 알림 하나 · 연장 → 풀림 · 예정 다시
  ④ (API · DB) 끝내기 · 예정 취소 · 금액 고치기 · 지우기 막음 · 바뀐 기록
  ⑤ (화면) 회계 › 계약
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


def lines_of(source, key):
    """전표 줄 → 'ROLE:차변:대변' 정렬 목록"""
    out = psql(f"SELECT l.role || ':' || l.debit || ':' || l.credit FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id WHERE e.source = '{source}' AND e.source_key = '{key}' ORDER BY 1")
    return sorted(x for x in out.split('\n') if x and not x.startswith('!'))


M49 = migr('D249_')
AC, UI, AP, MN = rd('src/modules/acct/acct.controller.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
CT, SC, WK = rd('src/modules/acct/contracts.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')
ok('① 코드 — D249 계약 표 · 바꾼 기록(쌓기만) · 가드 · 정기 작업 acct_contracts(09:25) · 알림 ACCT_CONTRACT_DUE · 자금 흐름 예정 · API 4 · 감사 · 화면 · 메뉴 · 문서 546 · 판 v10.409',
   'CREATE TABLE IF NOT EXISTS public.acct_contracts' in M49 and 'acct_contract_changes' in M49 and 'fn_acct_contract_guard' in M49 and "('acct_contracts', 1440, 9, 25," in M49
   and 'export async function acctContractsJob' in CT and "'ACCT_CONTRACT_DUE'" in CT and 'acct_cash_plans' in CT
   and "case 'acct_contracts':" in SC and "'acct_contracts'" in WK
   and "@Get('contracts')" in AC and "@Post('contracts')" in AC and "@Post('contracts/:id/renew')" in AC and "@Post('contracts/:id/end')" in AC
   and "@Audit('ACCT_CONTRACT_ADD', 'SETTING')" in AC and 'export function AcctContracts' in UI and "{tab === 'acct-contracts' && <AcctContracts />}" in AP
   and "['acct-contracts', '계약']" in MN and 'GET /admin/acct/contracts' in SJ and '계약' in doc('546_') and VT >= (10, 409), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1409', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    d0 = kst.strftime('%Y-%m-%d')
    dd = lambda n: (kst + datetime.timedelta(days=n)).strftime('%Y-%m-%d')
    stamp = int(time.time()) % 1000000
    title = f'시험 임대 1409-{stamp}'
    pd = (kst + datetime.timedelta(days=2)).day
    pd = pd if pd <= 28 else 1                              # 다음 낼 날이 만기(10일 뒤) 안에 오게
    body = {'title': title, 'kind': 'RENT', 'startOn': dd(-200), 'endOn': dd(10), 'noticeDays': 30, 'monthlyAmount': 1100000 + stamp % 1000, 'payDay': pd, 'autoRenew': True}
    cid = None
    try:
        c1 = call('POST', '/admin/acct/contracts', body, TP); cid = c1.get('id')
        nopay = call('POST', '/admin/acct/contracts', dict(body, title=title + '낼날', payDay=None), TP)
        back = call('POST', '/admin/acct/contracts', dict(body, title=title + '앞', endOn=dd(-300)), TP)
        mem = call('POST', '/admin/acct/contracts', body, TB)
        plan = psql(f"SELECT p.repeat || '|' || p.direction || '|' || p.amount || '|' || coalesce(p.until_on::text, '') || '|' || p.state FROM acct_contracts c JOIN acct_cash_plans p ON p.id = c.cash_plan_id WHERE c.id = {cid or 0}")
        ok('② 계약 넣기 — 달 금액이면 자금 흐름 예정(매달 · 나갈 돈 · 만기까지) · 낼 날 없음 422 · 만기가 시작보다 앞 422 · 회원 403',
           c1.get('ok') is True and plan == f"MONTHLY|OUT|{body['monthlyAmount']}|{dd(10)}|ACTIVE" and nopay.get('code') == 'CONTRACT_PAYDAY' and back.get('code') == 'CONTRACT_DATE' and mem.get('_err') == 403,
           f"{c1} · {plan} · {nopay.get('code')} · {back.get('code')} · {mem.get('_err')}")
        j1 = call('POST', '/admin/jobs', {'job': 'acct_contracts'}, TS)
        j2 = call('POST', '/admin/jobs', {'job': 'acct_contracts'}, TS)
        na = psql(f"SELECT count(*) || '|' || coalesce(max(severity), '') FROM ops_alerts WHERE alert_code = 'ACCT_CONTRACT_DUE' AND detail->>'contractId' = '{cid}' AND resolved_at IS NULL")
        lst = call('GET', '/admin/acct/contracts?state=ACTIVE', None, TP)
        me = next((x for x in lst.get('items') or [] if x.get('id') == cid), {})
        rn = call('POST', f'/admin/acct/contracts/{cid}/renew', {'endOn': dd(400), 'reason': '시험 1409 연장'}, TP)
        rnb = call('POST', f'/admin/acct/contracts/{cid}/renew', {'endOn': dd(5), 'reason': '시험 1409 앞으로'}, TP)
        open_after = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'ACCT_CONTRACT_DUE' AND detail->>'contractId' = '{cid}' AND resolved_at IS NULL")
        plans = psql(f"SELECT string_agg(p.state || ':' || coalesce(p.until_on::text, ''), ',' ORDER BY p.id) FROM acct_cash_plans p WHERE p.memo = '계약 {title}'")
        call('POST', '/admin/jobs', {'job': 'acct_contracts'}, TS)
        again = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'ACCT_CONTRACT_DUE' AND detail->>'contractId' = '{cid}' AND resolved_at IS NULL")
        ok('③ 만기 알림 — 10일 남음 → 알림 하나(두 번 돌려도) · 목록 알림 대상 · 연장 → 알림 풀림 · 옛 예정 취소 · 새 예정(새 만기) · 앞당기기 422 · 다시 돌려도 30일 밖이라 알림 없음',
           na.startswith('1|') and me.get('due') is True and me.get('daysLeft') == 10 and rn.get('ok') is True and rnb.get('code') == 'CONTRACT_DATE'
           and open_after == '0' and plans == f"CANCELED:{dd(10)},ACTIVE:{dd(400)}" and again == '0' and not j1.get('_err') and not j2.get('_err'),
           f"{na} · {me.get('due')} {me.get('daysLeft')} · {rn.get('ok')} {rnb.get('code')} · {open_after} · {plans} · {again}")
        up = psql(f"UPDATE acct_contracts SET monthly_amount = 1 WHERE id = {cid or 0}")
        en = call('POST', f'/admin/acct/contracts/{cid}/end', {'reason': '시험 1409 끝'}, TP)
        en2 = call('POST', f'/admin/acct/contracts/{cid}/end', {'reason': '시험 1409 두 번'}, TP)
        pst = psql(f"SELECT p.state FROM acct_contracts c JOIN acct_cash_plans p ON p.id = c.cash_plan_id WHERE c.id = {cid or 0}")
        dl = psql(f"DELETE FROM acct_contracts WHERE id = {cid or 0}")
        hist = psql(f"SELECT string_agg(action, ',' ORDER BY id) FROM acct_contract_changes WHERE contract_id = {cid or 0}")
        ok('④ 끝내기 — 달 금액 고치기 DB 가 막음 · 끝내면 예정 취소 · 두 번 409 · 지우기 막음 · 바뀐 기록 CREATE · RENEW · END',
           'ACCT_CONTRACT' in up and en.get('ok') is True and en2.get('code') == 'CONTRACT_STATE' and pst == 'CANCELED' and 'ACCT_CONTRACT' in dl and hist == 'CREATE,RENEW,END',
           f"{up[-40:]} · {en.get('ok')} {en2.get('code')} · {pst} · {dl[-30:]} · {hist}")
        cid = None
    finally:
        if cid:   # 중간에 멈추면 끝내 둠(예정 · 알림 남지 않게)
            call('POST', f'/admin/acct/contracts/{cid}/end', {'reason': '시험 1409 정리'}, TS)
        rm_role(pid, '1409')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-acct-contracts]', timeout=30000)
            seen['sec'] = pg.locator('[data-acct-contracts]').count()
            pg.click('[data-acct-contract-new]'); pg.wait_for_timeout(500)
            seen['form'] = pg.locator('[data-acct-contract-form]').count()
            seen['file'] = pg.locator('[data-acct-contract-file]').count()
        res = admin_page('/#/acct-contracts', chk)
        if res is None: print('  (playwright 없음 — ⑤ 건너뜀)')
        else:
            seen, perr = res
            ok('⑤ 화면 — 회계 › 계약 · 넣기 칸 · 계약서 파일 단추 · 화면 오류 없음', seen.get('sec') == 1 and seen.get('form') == 1 and seen.get('file') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ③ ④ ⑤ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
