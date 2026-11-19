"""v10.454 (D261 · docs/591) 대량 이체 — 금융결제원 오픈뱅킹 어댑터 · 두 사람 승인 · 처음 꺼짐 · 간주
  ① (코드) D261 묶음 · 줄 · 승인 · 가드 · CHECKING · HOLD · PENDING · 거래고유번호 · 설정 · 외부 연동 FIRMBANK(금융결제원 · 키 둘 · .env) · KftcTransfer · 결과 조회 · 전표 · 화면 · 문서 591
  ② (API · DB) 만들기 · 줄(암호문 · 끝 4자리) · 꺼짐 422 · 만든 사람 승인 422 · 두 명 → APPROVED · DB 막음 · LIVE 키 없음 422 ·
     간주 보내기 → 이름 다름 HOLD(안 보냄) · 처리 중 PENDING → CHECKING · 다시 보내기 409 · 거래고유번호 그대로 · 결과 조회 → PARTIAL · 간주 전표 0 · 취소
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


M61 = migr('D261_')
TR, FC, UI, AP, MN, SR, RG, SS, EV = (rd('src/modules/acct/transfer.ts'), rd('src/modules/acct/fin.controller.ts'), rd('web/src/app/admin/Fin.tsx'), rd('web/src/App.tsx'),
                                      rd('web/src/lib/adminMenu.ts'), rd('src/modules/acct/sources.ts'), rd('src/common/integration/registry.ts'),
                                      rd('src/common/integration/secret.service.ts'), rd('deploy/aws/env.production.example'))
stamp = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today, yday = kst.strftime('%Y-%m-%d'), (kst - datetime.timedelta(days=1)).strftime('%Y-%m-%d')

ok('① 코드 — D261 묶음 · 줄(계좌 암호문 · 끝 4자리 · 거래고유번호 UNIQUE) · 승인(만든 사람 막음) · 가드 3 · CHECKING · HOLD · PENDING · 설정 acct.transfer off · ASSUME · 외부 연동 FIRMBANK(금융결제원 · 키 둘 · .env) · 어댑터 간주 · KFTC(토큰 · 수취조회 · 입금이체 · 결과조회) · 전표 TRANSFER_PAID · 화면 FIN-020 · 문서 591 · 판 v10.454',
   'CREATE TABLE IF NOT EXISTS public.acct_transfer_items' in M61 and 'acct_no_enc  bytea NOT NULL' in M61 and 'trg_acct_transfer_batch_guard' in M61 and 'trg_acct_transfer_item_guard' in M61
   and 'trg_acct_transfer_approval_guard' in M61 and "('acct.transfer', 'off'" in M61 and "('acct.transfer_mode', 'ASSUME'" in M61 and "VALUES ('FIRMBANK'" in M61 and "('FIRMBANK','FIRMBANK_CLIENT_ID'), ('FIRMBANK','FIRMBANK_CLIENT_SECRET')" in M61
   and "'CHECKING'" in M61 and "'HOLD', 'PENDING'" in M61 and 'bank_tran_id text UNIQUE' in M61 and 'fn_acct_transfer_tran_id' in M61
   and 'export class AssumeTransfer' in TR and 'export class KftcTransfer' in TR and "'/v2.0/inquiry/receive'" in TR and "'/v2.0/transfer/deposit/acnt_num'" in TR
   and "'/v2.0/transfer/result'" in TR and "scope: 'oob'" in TR and 'export async function checkTransfer' in TR and "@Post('fin/transfers/:id/check')" in FC and "name: 'TRANSFER_PAID'" in TR and 'ALL_SOURCES.push(...TRANSFER_SOURCES)' in SR
   and "code: 'FIRMBANK'" in RG and "name: 'FIRMBANK_CLIENT_SECRET'" in SS and "name: 'FIRMBANK_CLIENT_ID'" in SS and 'FIRMBANK_CLIENT_SECRET=' in EV and 'FIRMBANK_ORG_CODE=' in EV and "@Post('fin/transfers/:id/send')" in FC
   and 'export function FinTransfers' in UI and "['fin-transfer', '대량 이체']" in MN and "{tab === 'fin-transfer' && <FinTransfers />}" in AP and '"SB-ADM-FIN-020"' in SJ
   and '두 사람' in doc('591_') and '금융결제원' in doc('591_') and VT >= (10, 454), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    p1e, p1 = mk_staff('1454a', 'PAYOUT'); consent_ok.agree(p1e, PW); T1 = login(p1e)
    p2e, p2 = mk_staff('1454b', 'PAYOUT'); consent_ok.agree(p2e, PW); T2 = login(p2e)
    s0 = {k: getset(k) for k in ('acct.transfer', 'acct.transfer_mode')}
    bid = bid2 = ''
    try:
        setting('acct.transfer', 'off', '1454'); setting('acct.transfer_mode', 'ASSUME', '1454')
        c = call('POST', '/admin/fin/transfers', {'title': f'시험 이체 1454-{stamp}', 'payOn': today}, T1); bid = str(c.get('id') or '')
        mb = call('POST', '/admin/fin/transfers', {'title': '회원 1454'}, TB)
        past = call('POST', '/admin/fin/transfers', {'title': '시험 1454 지난날', 'payOn': yday}, T1)
        items = [{'payee': '시험 받는분 1454', 'bankCode': '004', 'accountNo': '123-456-789012', 'amount': 10000, 'memo': '시험1454'},
                 {'payee': '(간주 실패) 시험 1454', 'bankCode': '088', 'accountNo': '110123456789', 'amount': 5000},
                 {'payee': '(간주 이름다름) 시험 1454', 'bankCode': '020', 'accountNo': '1002-333-444555', 'amount': 3000},
                 {'payee': '(간주 처리중) 시험 1454', 'bankCode': '081', 'accountNo': '220-777-888999', 'amount': 2000}]
        add = call('POST', f'/admin/fin/transfers/{bid}/items', {'items': items}, T1)
        badb = call('POST', f'/admin/fin/transfers/{bid}/items', {'items': [{**items[0], 'bankCode': '04'}]}, T1)
        enc = psql(f"SELECT string_agg(acct_last4 || ':' || (position(convert_to('123456789012', 'UTF8') in acct_no_enc) = 0)::text, ',' ORDER BY id) FROM acct_transfer_items WHERE batch_id = {int(bid or 0)}")
        off = call('POST', f'/admin/fin/transfers/{bid}/send', None, TS)
        setting('acct.transfer', 'on', '1454')
        early = call('POST', f'/admin/fin/transfers/{bid}/send', None, TS)
        self_ = call('POST', f'/admin/fin/transfers/{bid}/approve', {}, T1)
        a1 = call('POST', f'/admin/fin/transfers/{bid}/approve', {'note': '시험 1454'}, T2)
        a1b = call('POST', f'/admin/fin/transfers/{bid}/approve', {}, T2)
        a2 = call('POST', f'/admin/fin/transfers/{bid}/approve', {}, TS)
        after = call('POST', f'/admin/fin/transfers/{bid}/items', {'items': items[:1]}, T1)
        dbb = psql(f"UPDATE acct_transfer_items SET amount = amount + 1 WHERE batch_id = {int(bid or 0)}")
        setting('acct.transfer_mode', 'LIVE', '1454')
        live = call('POST', f'/admin/fin/transfers/{bid}/send', None, T1)
        setting('acct.transfer_mode', 'ASSUME', '1454')
        snd = call('POST', f'/admin/fin/transfers/{bid}/send', None, T1)
        again = call('POST', f'/admin/fin/transfers/{bid}/send', None, T1)
        tr0 = psql(f"SELECT string_agg(coalesce(result, '-') || ':' || coalesce(bank_tran_id, '-'), ',' ORDER BY id) FROM acct_transfer_items WHERE batch_id = {int(bid or 0)}")
        trx = psql(f"UPDATE acct_transfer_items SET bank_tran_id = 'SGBASSUME0U999999999' WHERE batch_id = {int(bid or 0)} AND bank_tran_id IS NOT NULL")
        setting('acct.transfer', 'off', '1454')
        chk = call('POST', f'/admin/fin/transfers/{bid}/check', None, T2)
        tr1 = psql(f"SELECT string_agg(coalesce(result, '-') || ':' || coalesce(bank_tran_id, '-'), ',' ORDER BY id) FROM acct_transfer_items WHERE batch_id = {int(bid or 0)}")
        chk2 = call('POST', f'/admin/fin/transfers/{bid}/check', None, T2)
        setting('acct.transfer', 'on', '1454')
        tids = [x.split(':')[1] for x in tr0.split(',') if ':' in x]
        tid_ok = (len(tids) == 4 and tids[2] == '-' and all(re.match(r'^SGBASSUME0U\d{9}$', x) for x in tids[:2] + tids[3:]) and len(set(tids)) == 4
                  and [x.split(':')[1] for x in tr1.split(',') if ':' in x] == tids)
        call('POST', '/admin/acct/journal/run', None, TS)
        ent = psql(f"SELECT count(*) FROM acct_entries WHERE source = 'TRANSFER_PAID' AND source_key IN (SELECT id::text FROM acct_transfer_items WHERE batch_id = {int(bid or 0)})")
        det = call('GET', f'/admin/fin/transfers/{bid}', None, T2)
        res = sorted(str(x.get('result')) for x in det.get('lines') or [])
        accs = sorted(str(x.get('account')) for x in det.get('lines') or [])
        cx = call('POST', f'/admin/fin/transfers/{bid}/cancel', {'reason': '시험 1454 보낸 뒤'}, T1)
        c2 = call('POST', '/admin/fin/transfers', {'title': f'시험 이체 1454 취소-{stamp}'}, T2); bid2 = str(c2.get('id') or '')
        cx0 = call('POST', f'/admin/fin/transfers/{bid2}/cancel', {'reason': 'x'}, T2)
        cx2 = call('POST', f'/admin/fin/transfers/{bid2}/cancel', {'reason': '시험 1454 취소'}, T2)
        acc = psql(f"SELECT count(*) FROM perm_route_map WHERE pattern LIKE '/admin/fin/transfers%'")
        ok('② 이체 — 만들기 · 회원 403 · 지난 지급일 422 · 줄 4(합 20,000) · 은행 코드 400 · 계좌 암호문(끝 4자리만) · 꺼짐 422 · 승인 전 409 · 만든 사람 승인 422 · 두 번 409 · 두 명 → APPROVED · 뒤 줄 넣기 409 · DB 막음 · LIVE 키 없음 422 · 간주 보내기 CHECKING(간주 1 · 실패 1 · 이름 다름 HOLD 1 · 처리 중 PENDING 1) · 다시 보내기 409 · 거래고유번호(HOLD 는 없음 · 겹침 없음 · DB 가 바꾸기 막음) · 결과 조회(보내기 꺼져도) → PARTIAL · 번호 그대로(다시 안 보냄) · 두 번째 조회 409 · 간주는 전표 0 · 보낸 뒤 취소 409 · 취소 사유 400 · 취소 · 권한 주소 9',
           c.get('ok') is True and mb.get('_err') == 403 and past.get('code') == 'TRANSFER_DATE' and add.get('total') == 20000 and add.get('itemCount') == 4 and badb.get('_err') == 400
           and enc == '9012:true,6789:true,4555:true,8999:true' and off.get('code') == 'TRANSFER_OFF' and early.get('_err') == 409 and self_.get('code') == 'TRANSFER_SELF'
           and a1.get('state') == 'DRAFT' and a1.get('approvals') == 1 and a1b.get('_err') == 409 and a2.get('state') == 'APPROVED' and after.get('_err') == 409 and 'ACCT_TRANSFER_STATE' in dbb
           and live.get('code') == 'TRANSFER_NOT_READY' and snd.get('state') == 'CHECKING' and snd.get('assumed') == 1 and snd.get('failed') == 1 and snd.get('held') == 1 and snd.get('pending') == 1
           and again.get('_err') == 409 and tid_ok and 'ACCT_TRANSFER' in trx and chk.get('state') == 'PARTIAL' and chk.get('checked') == 1 and chk2.get('_err') == 409 and ent == '0'
           and res == ['ASSUMED', 'ASSUMED', 'FAIL', 'HOLD'] and accs == ['****4555', '****6789', '****8999', '****9012'] and cx.get('_err') == 409 and cx0.get('_err') == 400 and cx2.get('ok') is True and acc == '9',
           f"{c.get('ok')} {mb.get('_err')} {past.get('code')} {add.get('total')} {badb.get('_err')} {enc} · {off.get('code')} {early.get('_err')} {self_.get('code')} · {a1.get('approvals')} {a1b.get('_err')} {a2.get('state')} {after.get('_err')} {dbb[-30:]} · {live.get('code')} {snd.get('state')} {snd.get('assumed')} {snd.get('failed')} {snd.get('held')} {snd.get('pending')} {again.get('_err')} · {tr0} {trx[-30:]} {chk.get('state') or chk.get('code')} {chk.get('checked')} {chk2.get('_err')} {tr1} · {ent} {res} {accs} · {cx.get('_err')} {cx0.get('_err')} {cx2.get('ok')} {acc}")
    finally:
        ids = ','.join(x for x in (bid, bid2) if x.isdigit())
        if ids:
            psql(f"SET session_replication_role = replica; DELETE FROM acct_transfer_approvals WHERE batch_id IN ({ids}); DELETE FROM acct_transfer_items WHERE batch_id IN ({ids}); "
                 f"DELETE FROM acct_transfer_batches WHERE id IN ({ids});")
        for k, x in s0.items():
            setting(k, x or None, '1454 되돌림')
        rm_role(p1, '1454a'); rm_role(p2, '1454b')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
