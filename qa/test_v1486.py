"""v10.486 (D269 · docs/624) 회사 인허가 · 신고 갱신 — 종류(일반 원칙 값 · SUPER 고침 · 법무 확인) · 다음 갱신일 · 갱신 기록 · 60 · 30 · 7일 전 알림
  ① (코드) D269 종류 · 인허가 · 갱신 표 · 가드 · 파일 지우기 막음 · 설정 · 정기 작업 lgl_due · API · 화면 · 메뉴(사무) · 화면 ID · 문서 624
  ② (API · DB) 넣기(주기로 다음 갱신일) · 담당 · 회원 403 · 붙은 서류 지우기 막음 · 정기 작업 7일(급함) · 두 번 한 번 · 갱신일 바꾸면 30일 차례 · 갱신 기록 · 끝냄 · 종류(SUPER) · 다가오는 기한
  ③ (화면) 사무 › 인허가
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


PDF = b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'
FILES = []


def upload(tok, name, purpose='LGL_DOC'):
    """POST /files → 올리기 → complete(시험 PDF) · 파일 번호는 FILES 에 모아 끝에 지움(replica · DELETED)"""
    t = call('POST', '/files', {'purpose': purpose, 'name': name, 'contentType': 'application/pdf', 'size': len(PDF)}, tok)
    origin = API.rsplit('/api/v1', 1)[0]
    url = t.get('uploadUrl') or ''
    if url: raw(t.get('method') or 'PUT', (origin + url) if url.startswith('/') else url, PDF, (t.get('headers') or {}).get('Content-Type', 'application/pdf'))
    call('POST', f"/files/{t.get('fileId')}/complete", None, tok)
    if t.get('fileId'):
        FILES.append(t.get('fileId'))
    return t.get('fileId')


def files_cleanup():
    for f in FILES:
        psql(f"SET session_replication_role = replica; UPDATE files SET status = 'DELETED', deleted_at = now() WHERE id = '{f}' AND status <> 'DELETED';")


def staff(tag, role):
    em, aid = mk_staff(tag, role)
    __import__('consent_ok').agree(em, PW)
    return em, aid, login(em)


def ids_sql(xs):
    return ','.join(str(int(x)) for x in xs if str(x or '').isdigit()) or '0'


M69 = migr('D269_')
LC = rd('src/modules/legal/legal.controller.ts')
LCM, LLI, LRV, LCS, LIN, LDU = rd('src/modules/legal/lgl-common.ts'), rd('src/modules/legal/lgl-licenses.ts'), rd('src/modules/legal/lgl-reviews.ts'), rd('src/modules/legal/lgl-cases.ts'), rd('src/modules/legal/lgl-insurance.ts'), rd('src/modules/legal/lgl-due.ts')
UI, AP, MN, AM, SC, WK = rd('web/src/app/admin/Legal.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/app.module.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')
stamp = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today = kst.strftime('%Y-%m-%d')
def day(n):
    return (kst + datetime.timedelta(days=n)).strftime('%Y-%m-%d')
T0 = psql("SELECT now()")

KC = f"TST1486_{stamp}"
LICS = []


def cleanup():
    ids = ids_sql(LICS)
    psql("SET session_replication_role = replica; "
         f"DELETE FROM lgl_license_renewals WHERE license_id IN ({ids}); "
         f"DELETE FROM lgl_licenses WHERE id IN ({ids}); "
         f"DELETE FROM lgl_license_kinds WHERE code = '{KC}'; "
         f"DELETE FROM ops_alerts WHERE alert_code = 'LGL_LICENSE_DUE' AND detail->>'licenseId' IN (SELECT x::text FROM unnest(ARRAY[{ids}]::bigint[]) x);")
    files_cleanup()


ok('① 코드 — D269 인허가 종류(통신판매업 · 건강기능식품) · 인허가 · 갱신 표 · 가드 · 서류 지우기 막음 · 설정 lgl.license_alert_days · 정기 작업 lgl_due · API · 화면 LglLicenses · 메뉴 사무 · 화면 ID · 문서 624 · 판 v10.486',
   'CREATE TABLE IF NOT EXISTS public.lgl_license_kinds' in M69 and 'CREATE TABLE IF NOT EXISTS public.lgl_licenses' in M69 and 'CREATE TABLE IF NOT EXISTS public.lgl_license_renewals' in M69
   and "('MAIL_ORDER', '통신판매업 신고'" in M69 and "('HFOOD_SALES'" in M69 and 'trg_lgl_licenses_guard' in M69 and 'trg_lgl_files_guard' in M69 and "'lgl.license_alert_days'" in M69
   and "'CORP_DOC','HR_DOC','LGL_DOC']" in M69 and "IF f.purpose = 'LGL_DOC' AND NOT (p_roles && ARRAY['ADMIN','SUPER'])" in M69 and "f.purpose = 'LGL_DOC'\n     AND EXISTS (SELECT 1 FROM public.lgl_insurance_policies x" in M69
   and "VALUES ('lgl_due', 1440, 9, 50" in M69 and "('lgl-licenses', '회사 인허가', 'admoff'" in M69
   and "@Controller('api/v1/admin/legal')" in LC and "@Get('licenses')" in LC and "@Post('licenses/:id/renew')" in LC and "@Put('license-kinds/:code')" in LC
   and 'export async function legalDueJob' in LDU and 'LGL_LICENSE_DUE' in LDU and 'LegalController' in AM and "case 'lgl_due'" in SC and "'lgl_due'" in WK
   and 'export function LglLicenses' in UI and "['lgl-licenses', '인허가']" in MN and "g.tabs.splice(" in MN and '<LglLicenses />' in AP
   and '"SB-ADM-LGL-010"' in SJ and '인허가' in doc('624_') and VT >= (10, 486), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    ae, aid, TA = staff('1486a', 'ADMIN')
    pe, pid, TP = staff('1486p', 'PAYOUT')
    try:
        b0 = call('GET', '/admin/legal/licenses', None, TS)
        kcodes = [k.get('code') for k in b0.get('kinds', [])]
        p403, b403 = call('GET', '/admin/legal/licenses', None, TP), call('GET', '/admin/legal/licenses', None, TB)
        f1 = upload(TA, 'lic1486.pdf')
        l1 = call('POST', '/admin/legal/licenses', {'kind': 'MAIL_ORDER', 'title': f'시험 1486 통신판매 {stamp}', 'licenseRef': f'T-{stamp}', 'registeredOn': day(-400)}, TA)
        if l1.get('id'): LICS.append(l1.get('id'))
        bad = call('POST', '/admin/legal/licenses', {'kind': 'NOPE_X', 'title': '시험'}, TA)
        l2 = call('POST', '/admin/legal/licenses', {'kind': 'MAIL_ORDER', 'title': f'시험 1486 갱신 {stamp}', 'nextDueOn': day(5), 'fileIds': [f1], 'ownerId': aid}, TA)
        if l2.get('id'): LICS.append(l2.get('id'))
        L2 = l2.get('id') or '0'
        fdel = psql(f"UPDATE files SET status = 'DELETED' WHERE id = '{f1}'")
        jb = call('POST', '/admin/jobs', {'job': 'lgl_due'}, TS)
        a7 = psql(f"SELECT severity FROM ops_alerts WHERE alert_code = 'LGL_LICENSE_DUE' AND resolved_at IS NULL AND detail->>'key' = 'LIC:{L2}:{day(5)}:7'")
        call('POST', '/admin/jobs', {'job': 'lgl_due'}, TS)
        a7n = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'LGL_LICENSE_DUE' AND detail->>'licenseId' = '{L2}'")
        ok('② 인허가 — 종류 6 이상 · 지급 담당 · 회원 403 · 넣기(신고일 + 주기로 다음 갱신일 오늘 뒤) · 없는 종류 422 · 서류 붙임 · 붙은 서류 지우기 막음 · 정기 작업 7일 차례 급함 · 두 번 돌려도 한 번',
           all(c in kcodes for c in ('MAIL_ORDER', 'HFOOD_SALES', 'TELECOM_VAS', 'LOCATION_BIZ', 'BIZ_REG', 'ETC')) and p403.get('_err') == 403 and b403.get('_err') == 403
           and l1.get('ok') is True and (l1.get('nextDueOn') or '') >= today and bad.get('code') == 'LGL_LICENSE_KIND' and l2.get('ok') is True
           and 'FILE:' in fdel and jb.get('job') == 'lgl_due' and a7 == 'CRITICAL' and a7n == '1',
           f"{kcodes} {p403.get('_err')} {b403.get('_err')} {l1.get('nextDueOn') or l1.get('code')} {bad.get('code')} {l2.get('ok') or l2.get('code')} {fdel[-40:]} {jb.get('job') or jb} {a7} {a7n}")

        up = call('PUT', f'/admin/legal/licenses/{L2}', {'nextDueOn': day(25), 'memo': '시험 1486 고침'}, TA)
        call('POST', '/admin/jobs', {'job': 'lgl_due'}, TS)
        old7 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'LGL_LICENSE_DUE' AND resolved_at IS NULL AND detail->>'key' = 'LIC:{L2}:{day(5)}:7'")
        a30 = psql(f"SELECT severity FROM ops_alerts WHERE alert_code = 'LGL_LICENSE_DUE' AND resolved_at IS NULL AND detail->>'key' = 'LIC:{L2}:{day(25)}:30'")
        due = call('GET', '/admin/legal/due?days=60', None, TA)
        in_due = any(x.get('key') == f'LGL:LIC:{L2}' for x in due.get('items', []))
        fut = call('POST', f'/admin/legal/licenses/{L2}/renew', {'doneOn': day(3)}, TA)
        rn = call('POST', f'/admin/legal/licenses/{L2}/renew', {'doneOn': today, 'note': '시험 1486 납부'}, TA)
        nd = psql(f"SELECT next_due_on FROM lgl_licenses WHERE id = {int(L2)}")
        open_after = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'LGL_LICENSE_DUE' AND resolved_at IS NULL AND detail->>'licenseId' = '{L2}'")
        rcnt = psql(f"SELECT count(*) FROM lgl_license_renewals WHERE license_id = {int(L2)}")
        gr = psql(f"UPDATE lgl_license_renewals SET note = 'x' WHERE license_id = {int(L2)}")
        gd = psql(f"DELETE FROM lgl_licenses WHERE id = {int(L2)}")
        gk = psql(f"UPDATE lgl_licenses SET kind_code = 'ETC' WHERE id = {int(L2)}")
        one = call('GET', f'/admin/legal/licenses/{L2}', None, TA)
        exp_nd = (datetime.date.fromisoformat(day(25)).replace(year=datetime.date.fromisoformat(day(25)).year + 1)).isoformat() if day(25)[5:] != '02-29' else ''
        ok('② 갱신 — 다음 갱신일 바꾸면 7일 알림 풀리고 30일 차례(경고) · 다가오는 기한에 보임 · 앞날 처리 422 · 갱신 기록(지난 갱신일 + 12달) · 알림 풀림 · 기록 1 · DB 고치기 · 지우기 · 종류 바꾸기 막음 · 상세',
           up.get('ok') is True and old7 == '0' and a30 == 'WARN' and in_due and fut.get('code') == 'LGL_DATE' and rn.get('ok') is True and (not exp_nd or nd == exp_nd)
           and open_after == '0' and rcnt == '1' and 'LGL_RENEWAL' in gr and 'LGL_LICENSE' in gd and 'LGL_LICENSE' in gk and len(one.get('renewals', [])) == 1,
           f"{up.get('ok')} {old7} {a30} {in_due} {fut.get('code')} {rn.get('ok') or rn.get('code')} {nd}/{exp_nd} {open_after} {rcnt} {gr[-30:]} {gd[-30:]} {gk[-30:]} {len(one.get('renewals', []))}")

        L1 = l1.get('id') or '0'
        c400 = call('POST', f'/admin/legal/licenses/{L1}/close', {'reason': 'x'}, TA)
        c1 = call('POST', f'/admin/legal/licenses/{L1}/close', {'reason': '시험 1486 끝냄'}, TA)
        c2 = call('POST', f'/admin/legal/licenses/{L1}/close', {'reason': '시험 1486 끝냄'}, TA)
        cu = call('PUT', f'/admin/legal/licenses/{L1}', {'memo': 'x'}, TA)
        cr = call('POST', f'/admin/legal/licenses/{L1}/renew', {'doneOn': today}, TA)
        ka = call('PUT', f'/admin/legal/license-kinds/{KC}', {'name': '시험 1486 종류', 'cycleMonths': 24}, TA)
        ks = call('PUT', f'/admin/legal/license-kinds/{KC}', {'name': '시험 1486 종류', 'cycleMonths': 24, 'basis': '시험'}, TS)
        ks2 = call('PUT', f'/admin/legal/license-kinds/{KC}', {'cycleMonths': None, 'active': False}, TS)
        kc = psql(f"SELECT coalesce(cycle_months::text, 'null') || '|' || active FROM lgl_license_kinds WHERE code = '{KC}'")
        kdel = psql(f"DELETE FROM lgl_license_kinds WHERE code = '{KC}'")
        off = call('POST', '/admin/legal/licenses', {'kind': KC, 'title': '시험'}, TA)
        ok('② 끝냄 · 종류 — 짧은 사유 400 · 끝냄 · 두 번 409 · 끝낸 것 고치기 · 갱신 409 · 종류 고치기 관리자 403 · SUPER 더하기 · 주기 없음 · 쓰지 않음 · 지우기 막음 · 쓰지 않는 종류로 넣기 422',
           c400.get('_err') == 400 and c1.get('ok') is True and c2.get('code') == 'LGL_LICENSE_STATE' and cu.get('code') == 'LGL_LICENSE_STATE' and cr.get('code') == 'LGL_LICENSE_STATE'
           and ka.get('_err') == 403 and ks.get('created') is True and ks2.get('ok') is True and kc == 'null|false' and 'LGL_LICENSE_KIND' in kdel and off.get('code') == 'LGL_LICENSE_KIND',
           f"{c400.get('_err')} {c1.get('ok')} {c2.get('code')} {cu.get('code')} {cr.get('code')} {ka.get('_err')} {ks.get('created') or ks.get('code')} {ks2.get('ok')} {kc} {kdel[-30:]} {off.get('code')}")
        fo_own, fo_sup, fo_pay = call('GET', f'/files/{f1}', None, TA), call('GET', f'/files/{f1}', None, TS), call('GET', f'/files/{f1}', None, TP)
        fpur = psql(f"SELECT purpose FROM files WHERE id = '{f1}'")
        ok('② 법무 서류 LGL_DOC 열람 — 인허가 서류는 올린 사람 · SUPER 엶 · 지급 담당 404',
           fpur == 'LGL_DOC' and bool(fo_own.get('url')) and bool(fo_sup.get('url')) and fo_pay.get('_err') == 404, f"{fpur} {bool(fo_own.get('url'))} {bool(fo_sup.get('url'))} {fo_pay.get('_err')}")
    finally:
        cleanup(); rm_role(aid, '1486'); rm_role(pid, '1486')

    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-lgl-licenses]', timeout=30000)
            pg.wait_for_timeout(1500)
            seen['form'] = pg.locator('[data-lgl-license-form]').count()
            seen['list'] = pg.locator('[data-lgl-license-list]').count()
            seen['kinds'] = pg.locator('[data-lgl-kinds]').count()
            seen['tree'] = pg.locator('.ad-tree button[data-tab="lgl-licenses"]').count()
        res = admin_page('/#/lgl-licenses', chk)
        if res is None: print('  (playwright 없음 — 화면 건너뜀)')
        else:
            seen, perr = res
            ok('③ 화면 — 사무 › 인허가 넣기 상자 · 목록 · 종류 펼침 · 왼쪽 트리 단추 · 화면 오류 없음', seen.get('form') == 1 and seen.get('list') == 1 and seen.get('kinds') == 1 and seen.get('tree', 0) >= 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
