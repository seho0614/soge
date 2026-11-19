"""v10.392 (D245 · docs/529) 매입 관리
  ① (코드) D245 매입 표 · 가드 · 증빙 파일 용도 · 전표 PURCHASE · API 4 · 화면 · 메뉴 · 문서 529
  ② (API · DB) 매입 넣기 — 세금계산서(공제) · 간이영수증(불공제 · 부가세 막음) · 기업업무추진비(언제나 불공제) · 입력 검사 422 · 같은 건 409 · force · 회원 403 · 금액 고치기 · 지우기 DB 가 막음
  ③ (API) 증빙 파일(ACCT_EVIDENCE) 올려 붙이기 · 붙은 파일 지우기 막음 · 전표(차변 비용 · 부가세대급금 / 대변 미지급금) · 취소(사유) · 반대 전표 · 분기 매입 부가세
  ④ (화면) 회계 › 매입
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


M45 = migr('D245_')
AC, UI, AP, MN = rd('src/modules/acct/acct.controller.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
PU, JN, FD = rd('src/modules/acct/purchase.ts'), rd('src/modules/acct/sources.ts'), rd('src/modules/file/file.dto.ts')
ok('① 코드 — D245 매입 표 · 가드 · 증빙 파일 용도 · 전표 PURCHASE · API 4 · 감사 · 화면 · 메뉴 · 명세 · 문서 529 · 판 v10.392',
   'CREATE TABLE IF NOT EXISTS public.acct_purchases' in M45 and 'fn_acct_purchase_guard' in M45 and "'ACCT_EVIDENCE'" in M45 and 'fn_files_acct_guard' in M45
   and 'export const PURCHASE_SOURCES' in PU and 'export async function purchaseVat' in PU and 'PURCHASE_SOURCES' in JN and "'ACCT_EVIDENCE'" in FD
   and "@Get('purchases')" in AC and "@Post('purchases')" in AC and "@Post('purchases/:id/cancel')" in AC and "@Get('tax/vat-purchase')" in AC
   and "@Audit('ACCT_PURCHASE_ADD', 'SETTING')" in AC and "@Audit('ACCT_PURCHASE_CANCEL', 'SETTING')" in AC
   and 'export function AcctPurchases' in UI and "{tab === 'acct-purchase' && <AcctPurchases />}" in AP and "['acct-purchase', '매입']" in MN
   and 'GET /admin/acct/purchases' in SJ and '매입' in doc('529_') and VT >= (10, 392), VER)


# ⑤ (v10.392 메인 · 대표 「자동전표양식 및 규칙 만들어서 적용」) 규칙 고치기 · 계정 더하기 · 확인표 · 세무사랑 양식
RU, FM, AC5, UI5, SR = rd('src/modules/acct/rules.ts'), rd('src/modules/acct/formats.ts'), rd('src/modules/acct/acct.controller.ts'), rd('web/src/app/admin/Acct.tsx'), rd('src/modules/acct/sources.ts')
ok('⑤ 코드 — D245 규칙 표 3 · 같은 종류 가드 · 증빙 CARD · SIMPLE · 계정 16 더함 · 세무사랑 양식(월 · 일 · 구분 3/4) · rules.ts · API 3 · 감사 · 화면 · 문서 529',
   'CREATE TABLE IF NOT EXISTS public.acct_rule_maps' in M45 and 'acct_rule_changes' in M45 and 'ACCT_RULE_KIND' in M45 and "'CARD', 'SIMPLE'" in M45
   and "('VAT_IN'," in M45 and "('CARD_AP'," in M45 and "'세무사랑 일반전표'" in M45 and '"field":"month"' in M45
   and "month: '월'" in FM and "case 'day':" in FM and 'export async function setRule' in RU and 'export async function ruleSheet' in RU and 'export const ALL_SOURCES' in SR
   and "@Audit('ACCT_RULE_SET', 'SETTING')" in AC5 and "@Audit('ACCT_ACCOUNT_ADD', 'SETTING')" in AC5 and "@Get('rules/sheet')" in AC5
   and 'data-acct-rule-open=' in UI5 and 'data-acct-rule-sheet=' in UI5 and 'data-acct-account-add=' in UI5 and '세무사랑' in doc('529_'))

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1392', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    ym, d0 = kst.strftime('%Y-%m'), kst.strftime('%Y-%m-%d')
    tomorrow = (kst + datetime.timedelta(days=1)).strftime('%Y-%m-%d')
    qtr = f"{kst.year}-{(kst.month - 1) // 3 + 1}"
    stamp = int(time.time()) % 1000000
    biz = '9' + str(stamp).zfill(9)                       # 돌릴 때마다 다른 공급자
    sup = 70000 + stamp % 9000; vat = sup // 10
    base = {'kind': 'TAX_INVOICE', 'issuedOn': d0, 'supplierName': f'(주)시험매입1392-{stamp}', 'supplierBizNo': biz, 'item': f'시험 사무용품 {stamp}',
            'supply': sup, 'vat': vat, 'accountRole': 'EXP_SUPPLIES', 'payRole': 'AP'}
    try:
        p1 = call('POST', '/admin/acct/purchases', base, TP)
        dup = call('POST', '/admin/acct/purchases', base, TP)
        p1f = call('POST', '/admin/acct/purchases', dict(base, force=True, memo='같은 날 두 번째'), TP)
        sv = call('POST', '/admin/acct/purchases', dict(base, kind='SIMPLE', supplierBizNo='', vat=500), TP)
        s1 = call('POST', '/admin/acct/purchases', dict(base, kind='SIMPLE', supplierBizNo='', supply=sup + 11, vat=0), TP)
        en = call('POST', '/admin/acct/purchases', dict(base, kind='CARD', payRole='CARD_AP', accountRole='EXP_ENTERTAIN', supply=sup + 22, vat=vat + 2, deductible=True), TP)
        nb = call('POST', '/admin/acct/purchases', dict(base, supplierBizNo=''), TP)
        fu = call('POST', '/admin/acct/purchases', dict(base, issuedOn=tomorrow), TP)
        ca = call('POST', '/admin/acct/purchases', dict(base, accountRole='CASH'), TP)
        cp = call('POST', '/admin/acct/purchases', dict(base, kind='CARD', payRole='AP'), TP)
        bf = call('POST', '/admin/acct/purchases', dict(base, attachments=['00000000-0000-0000-0000-000000000000'], force=True), TP)
        mem = call('POST', '/admin/acct/purchases', base, TB)
        e1 = psql(f"UPDATE acct_purchases SET supply = supply + 1, total = total + 1 WHERE id = {p1.get('id') or 0}")
        e2 = psql(f"DELETE FROM acct_purchases WHERE id = {p1.get('id') or 0}")
        st = psql(f"SELECT deductible::text || '|' || total FROM acct_purchases WHERE id = {s1.get('id') or 0}")
        ok('② 넣기 — 세금계산서 공제 · 같은 건 409 · force 넣음 · 간이영수증 부가세 422 · 간이영수증 불공제 · 기업업무추진비 공제 골라도 불공제 · 사업자번호 없음 · 앞날 · 돈 계정 · 카드+미지급금 422 · 없는 파일 422 · 회원 403 · 고치기 · 지우기 DB 가 막음',
           p1.get('ok') is True and p1.get('deductible') is True and dup.get('code') == 'PURCHASE_DUP' and p1f.get('ok') is True and sv.get('code') == 'PURCHASE_SIMPLE_VAT'
           and s1.get('deductible') is False and st == f"false|{sup + 11}" and en.get('deductible') is False and nb.get('code') == 'PURCHASE_BIZNO' and fu.get('code') == 'PURCHASE_DATE'
           and ca.get('code') == 'PURCHASE_ACCOUNT' and cp.get('code') == 'PURCHASE_PAY' and bf.get('code') == 'PURCHASE_FILES' and mem.get('_err') == 403
           and 'ACCT_PURCHASE' in e1 and 'ACCT_PURCHASE' in e2,
           f"{p1} · {dup.get('code')} · {p1f.get('ok')} · {sv.get('code')} · {s1.get('deductible')} {st} · {en.get('deductible')} · {nb.get('code')} {fu.get('code')} {ca.get('code')} {cp.get('code')} {bf.get('code')} · {mem.get('_err')} · {e1[-40:]} · {e2[-40:]}")

        # ③ 증빙 파일 — PAYOUT 이 ACCT_EVIDENCE 를 올려 붙임
        png = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) + b'\x00\x00\x00\rIHDR' + os.urandom(600)
        t = call('POST', '/files', {'purpose': 'ACCT_EVIDENCE', 'name': f'영수증1392-{stamp}.png', 'contentType': 'image/png', 'size': len(png)}, TP)
        origin = API.rsplit('/api/v1', 1)[0]
        url = t.get('uploadUrl') or ''
        put = raw(t.get('method') or 'PUT', (origin + url) if url.startswith('/') else url, png, (t.get('headers') or {}).get('Content-Type', 'image/png')) if url else 0
        cpl = call('POST', f"/files/{t.get('fileId')}/complete", None, TP)
        pf = call('POST', '/admin/acct/purchases', dict(base, item=f'증빙 있음 {stamp}', supply=sup + 33, vat=vat + 3, attachments=[t.get('fileId')]), TP)
        fdel = psql(f"UPDATE files SET status = 'DELETED' WHERE id = '{t.get('fileId')}'")
        call('POST', '/admin/acct/journal/run', None, TS)
        l1 = lines_of('PURCHASE', p1.get('id'))
        ls = lines_of('PURCHASE', s1.get('id'))
        le = lines_of('PURCHASE', en.get('id'))
        ev = psql(f"SELECT evidence FROM acct_entries WHERE source = 'PURCHASE' AND source_key IN ('{p1.get('id')}', '{s1.get('id')}', '{en.get('id')}') ORDER BY source_key::bigint")
        c0 = call('POST', f"/admin/acct/purchases/{p1f.get('id')}/cancel", {'reason': 'x'}, TP)
        c1 = call('POST', f"/admin/acct/purchases/{p1f.get('id')}/cancel", {'reason': '시험 1392 두 번 넣음'}, TP)
        c2 = call('POST', f"/admin/acct/purchases/{p1f.get('id')}/cancel", {'reason': '시험 1392 다시'}, TP)
        call('POST', '/admin/acct/journal/run', None, TS)
        lc = lines_of('PURCHASE_CANCEL', p1f.get('id'))
        lst = call('GET', f'/admin/acct/purchases?ym={ym}', None, TP)
        mine = [x for x in lst.get('items') or [] if x.get('supplierBizNo') == biz]
        withf = next((x for x in mine if x.get('id') == pf.get('id')), {})
        vp = call('GET', f'/admin/acct/tax/vat-purchase?q={qtr}', None, TP)
        vs = next((x for x in vp.get('bySupplier') or [] if x.get('bizNo') == biz), {})
        bad = call('GET', '/admin/acct/tax/vat-purchase?q=2026-9', None, TP)
        want1 = sorted([f'AP:0:{sup + vat}', f'EXP_SUPPLIES:{sup}:0', f'VAT_IN:{vat}:0'])
        wantc = sorted([f'AP:{sup + vat}:0', f'EXP_SUPPLIES:0:{sup}', f'VAT_IN:0:{vat}'])
        ok('③ 증빙 파일 올려 붙임 · 붙은 파일 지우기 막음 · 전표(공제 · 간이 · 기업업무추진비 불공제) · 증빙 표시 · 취소 사유 422 · 취소 · 두 번 409 · 반대 전표 · 목록 · 분기 매입 부가세(공급자별) · 잘못된 분기 ok:false',
           put in (200, 204) and cpl.get('status') == 'READY' and pf.get('ok') is True and 'FILE' in fdel and len(withf.get('files') or []) == 1
           and l1 == want1 and ls == sorted([f'AP:0:{sup + 11}', f'EXP_SUPPLIES:{sup + 11}:0']) and le == sorted([f'CARD_AP:0:{sup + vat + 24}', f'EXP_ENTERTAIN:{sup + vat + 24}:0'])
           and ev.split('\n') == ['TAX_INVOICE', 'SIMPLE', 'CARD'] and c0.get('code') == 'PURCHASE_REASON' and c1.get('ok') is True and c2.get('code') == 'PURCHASE_STATE' and lc == wantc
           and len(mine) >= 4 and any(x.get('state') == 'CANCELED' for x in mine) and vs.get('count') == 2 and vs.get('vat') == vat * 2 + 3
           and (vp.get('total') or {}).get('deductVat', 0) >= vat * 2 + 3 and bad.get('ok') is False,
           f"파일 {put} {cpl.get('status')} {pf.get('ok')} {fdel[-30:]} {len(withf.get('files') or [])} · {l1} · {ls} · {le} · {ev!r} · {c0.get('code')} {c1.get('ok')} {c2.get('code')} · {lc} · {len(mine)} · {vs} · {bad.get('ok')}")

        # ⑤ 규칙 고치기 · 계정 더하기 · 확인표 · 세무사랑 양식
        g0 = call('GET', '/admin/acct/accounts', None, TS)
        accs = {a['role']: a for a in g0.get('accounts') or []}
        add = call('POST', '/admin/acct/accounts', {'role': 'U_T1392', 'name': '시험 1392 매출', 'kind': 'REVENUE', 'extCode': '4049', 'extName': '시험매출', 'reason': '시험 1392'}, TS)
        badrole = call('POST', '/admin/acct/accounts', {'role': 'T1392', 'name': 'x', 'kind': 'REVENUE', 'reason': '시험 1392'}, TS)
        try:
            ch = call('PATCH', '/admin/acct/rules/SUB_PAID', {'maps': [{'from': 'REV_SUB', 'to': 'U_T1392'}], 'evidence': 'CARD', 'reason': '시험 1392 규칙'}, TS)
            kind = call('PATCH', '/admin/acct/rules/SUB_PAID', {'maps': [{'from': 'REV_SUB', 'to': 'CASH'}], 'reason': '시험 1392 종류'}, TS)
            slot = call('PATCH', '/admin/acct/rules/SUB_PAID', {'maps': [{'from': 'COGS', 'to': 'COGS'}], 'reason': '시험 1392 자리'}, TS)
            byp = call('PATCH', '/admin/acct/rules/SUB_PAID', {'maps': [{'from': 'REV_SUB', 'to': 'REV_SUB'}], 'reason': '시험 1392 지급'}, TP)
            nos = call('PATCH', '/admin/acct/rules/NO_SUCH', {'evidence': 'CARD', 'reason': '시험 1392 없음'}, TS)
            g1 = call('GET', '/admin/acct/accounts', None, TP)
            r1 = next((r for r in g1.get('rules') or [] if r.get('source') == 'SUB_PAID'), {})
            sh = call('GET', '/admin/acct/rules/sheet?csv=1', None, TP)
            head = (sh.get('csv') or '').lstrip('\ufeff').split('\r\n')[0]
        finally:
            back = call('PATCH', '/admin/acct/rules/SUB_PAID', {'maps': [{'from': 'REV_SUB', 'to': 'REV_SUB'}], 'evidence': 'CARD_PG', 'reason': '시험 1392 되돌림'}, TS)
        g2 = call('GET', '/admin/acct/accounts', None, TS)
        r2 = next((r for r in g2.get('rules') or [] if r.get('source') == 'SUB_PAID'), {})
        logn = psql("SELECT count(*) FROM acct_rule_changes WHERE reason LIKE '시험 1392%'")
        ok('⑤ 규칙 — 계정 16 더함 · 추천 수당 코드 초안 · U_ 계정 더하기(두 번째는 이미 있음) · 역할 틀림 400/422 · 계정 자리 바꿈 · 증빙 바꿈 · 다른 종류 422 · 없는 자리 422 · 지급 담당 403 · 없는 흐름 404 · 확인표 CSV(바꿈 표시) · 되돌림 · 바꾼 기록 쌓임',
           all(k in accs for k in ('VAT_IN', 'AP', 'CARD_AP', 'INVENTORY', 'COGS', 'EXP_FEE')) and bool(accs.get('EXP_PROMO', {}).get('extCode'))
           and (add.get('ok') is True or add.get('code') == 'ACCT_ACCOUNT_DUP') and badrole.get('_err') in (400, 422)
           and ch.get('ok') is True and kind.get('code') == 'ACCT_RULE_KIND' and slot.get('code') == 'ACCT_RULE' and byp.get('_err') == 403 and nos.get('_err') == 404
           and r1.get('changed') is True and r1.get('evidence') == 'CARD' and any(l.get('role') == 'U_T1392' for l in r1.get('lines') or [])
           and head.startswith('돈 흐름,근거 코드,증빙') and '바꿈' in (sh.get('csv') or '') and int(sh.get('count') or 0) >= 13
           and back.get('ok') is True and r2.get('changed') is False and r2.get('evidence') == 'CARD_PG' and int(logn or 0) >= 4,
           f"{len(accs)} {accs.get('EXP_PROMO', {}).get('extCode')} · {add.get('ok') or add.get('code')} {badrole.get('_err')} · {ch.get('ok')} {kind.get('code')} {slot.get('code')} {byp.get('_err')} {nos.get('_err')} · {r1.get('changed')} {r1.get('evidence')} · {head[:20]} {sh.get('count')} · {back.get('ok')} {r2.get('changed')} · {logn}")
        fm = call('GET', '/admin/acct/formats', None, TP)
        sj = next((x for x in fm.get('items') or [] if x.get('name') == '세무사랑 일반전표'), {})
        pv = call('POST', '/admin/acct/formats/preview', {'name': '미리', 'columns': sj.get('columns') or [], 'dateStyle': sj.get('dateStyle') or 'YYYY-MM-DD', 'dcStyle': 'SPLIT', 'dcDebit': '3', 'dcCredit': '4'}, TP)
        row0 = (pv.get('rows') or [[]])[0]
        ok('⑤ 세무사랑 양식 — 있음 · 칸 월 · 일 · 구분 · 계정코드 · 계정과목 … · 미리보기 월 두 자리 · 구분 3/4',
           bool(sj) and ','.join(c.get('title') for c in sj.get('columns') or []).startswith('월,일,구분,계정코드,계정과목') and sj.get('dcDebit') == '3'
           and len(str(row0[0] if row0 else '')) == 2 and (row0[2] if len(row0) > 2 else '') in ('3', '4'),
           f"{bool(sj)} {[c.get('title') for c in sj.get('columns') or []][:5]} · {pv.get('head')} {row0[:4]}")
    finally:
        rm_role(pid, '1392')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-acct-purchase]', timeout=30000)
            seen['sec'] = pg.locator('[data-acct-purchase]').count()
            seen['rows'] = pg.locator('[data-acct-purchase-row]').count()
            seen['form'] = pg.locator('[data-acct-purchase-form]').count()
            seen['file'] = pg.locator('[data-acct-purchase-file]').count()
        res = admin_page('/#/acct-purchase', chk)
        if res is None: print('  (playwright 없음 — ④ 건너뜀)')
        else:
            seen, perr = res
            ok('④ 화면 — 회계 › 매입 · 넣기 칸 · 증빙 파일 단추 · 목록 줄 · 화면 오류 없음',
               seen.get('sec') == 1 and seen.get('form') == 1 and seen.get('file') == 1 and seen.get('rows', 0) >= 1 and not perr, f"{seen} {perr[:2]}")

else:
    print('  (API · DB 없음 — ② ③ ④ ⑤ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
