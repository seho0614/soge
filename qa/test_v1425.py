"""v10.425 (D253 · docs/562) 사내 문서함
  ① (코드) corp_docs · corp_doc_versions(쌓기만) · 파일 용도 CORP_DOC · 지우기 막음 · 열람(PAYOUT · REVIEWER 막음) · 정기 작업 corp_doc_due · API 5 · 화면 · 문서 562
  ② (API · DB) 파일 올려 넣기 · 새 판(2판) · 만료 다가옴 알림 · 새 판이면 풀림 · 보관 끝(SUPER · 사유) · 지우기 막음 · REVIEWER 403 · 붙은 파일 지우기 막음
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


M50 = migr('D250_')
RC, RD, RP, WL, RS = rd('src/modules/admin/report.controller.ts'), rd('src/modules/admin/report-day.ts'), rd('src/modules/admin/report-period.ts'), rd('src/modules/admin/worklog.ts'), rd('src/modules/admin/report-send.ts')
UI, AP, MN, SC, WK, AM = rd('web/src/app/admin/Report.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'), rd('src/app.module.ts')

ok('① 코드 — D250 report_sends · report.send off · send_kinds · sendSnapshot(텔레그램 · 슬랙 · 메일) · sendAfterJob · API · 감사 · 화면 · 문서 552 · 판 v10.415',
   'CREATE TABLE IF NOT EXISTS public.report_sends' in M50 and "('report.send', 'off'" in M50 and "'report.send_kinds'" in M50
   and 'export async function sendSnapshot' in RS and 'export async function sendAfterJob' in RS and 'telegram.send' in RS and 'slack.send' in RS and 'mail.send' in RS
   and "@Audit('REPORT_SEND', 'SETTING')" in RC and "@Audit('REPORT_SETTING', 'SETTING')" in RC and 'data-rpt-settings=' in UI and 'data-rpt-send=' in UI
   and '보내기' in doc('552_') and VT >= (10, 415), VER)

M53 = migr('D253_')

CD, OC, UI, MN, FD = rd('src/modules/admin/corpdocs.ts'), rd('src/modules/acct/office.controller.ts'), rd('web/src/app/admin/Office.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/modules/file/file.dto.ts')
ok('① 코드 — D253 문서 · 판 표 · 가드 · CORP_DOC 용도 · 지우기 막음 · 열람 · corp_doc_due · API 5 · 화면 · 메뉴 · 문서 562 · 판 v10.425',
   'CREATE TABLE IF NOT EXISTS public.corp_docs' in M53 and 'CREATE TABLE IF NOT EXISTS public.corp_doc_versions' in M53 and "'CORP_DOC'" in M53 and 'corp_doc_due' in M53
   and '사내 문서에 붙은 파일은 지울 수 없습니다' in M53 and "'CORP_DOC'" in FD and 'export async function corpDocDueJob' in CD and "@Post('corp-docs/:id/archive')" in OC
   and 'export function CorpDocs' in UI and "['corp-docs', '사내 문서함']" in MN and '"SB-ADM-DOC-010"' in SJ and '만료' in doc('562_') and VT >= (10, 425), VER)

PDF = b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'
def upload(tok, name):
    t = call('POST', '/files', {'purpose': 'CORP_DOC', 'name': name, 'contentType': 'application/pdf', 'size': len(PDF)}, tok)
    origin = API.rsplit('/api/v1', 1)[0]
    url = t.get('uploadUrl') or ''
    if url: raw(t.get('method') or 'PUT', (origin + url) if url.startswith('/') else url, PDF, (t.get('headers') or {}).get('Content-Type', 'application/pdf'))
    call('POST', f"/files/{t.get('fileId')}/complete", None, tok)
    return t.get('fileId')

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    re_, rid_ = mk_staff('1425r', 'REVIEWER'); consent_ok.agree(re_, PW); TR = login(re_)
    stamp = int(time.time()) % 1000000
    d0 = (datetime.datetime.utcnow() + datetime.timedelta(hours=9)).date()
    fids, did = [], None
    try:
        f1 = upload(TS, f'등기부1425-{stamp}.pdf'); fids.append(f1)
        a = call('POST', '/admin/corp-docs', {'category': 'REGISTRY', 'title': f'시험 등기부 1425-{stamp}', 'fileId': f1, 'issuedOn': str(d0), 'expiresOn': str(d0 + datetime.timedelta(days=10))}, TS)
        did = a.get('id')
        call('POST', '/admin/jobs', {'job': 'corp_doc_due'}, TS)
        al1 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'CORP_DOC_DUE' AND detail->>'docId' = '{did}' AND resolved_at IS NULL")
        f2 = upload(TS, f'등기부1425b-{stamp}.pdf'); fids.append(f2)
        v2 = call('POST', f'/admin/corp-docs/{did}/versions', {'fileId': f2, 'issuedOn': str(d0), 'expiresOn': str(d0 + datetime.timedelta(days=400))}, TS)
        al2 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'CORP_DOC_DUE' AND detail->>'docId' = '{did}' AND resolved_at IS NULL")
        vs = call('GET', f'/admin/corp-docs/{did}', None, TS)
        byr = call('GET', '/admin/corp-docs', None, TR)
        dele = psql(f"DELETE FROM corp_doc_versions WHERE doc_id = {int(did or 0)}")
        fdel = psql(f"UPDATE files SET status = 'DELETED' WHERE id = '{f1}'")
        noreason = call('POST', f'/admin/corp-docs/{did}/archive', {'reason': 'x'}, TS)
        arc = call('POST', f'/admin/corp-docs/{did}/archive', {'reason': '시험 1425 끝'}, TS)
        v3 = call('POST', f'/admin/corp-docs/{did}/versions', {'fileId': f2}, TS)
        ok('② 문서함 — 넣기 · 만료 10일 알림 · 새 판(2판)이면 알림 풀림 · 판 2 · REVIEWER 403 · 판 지우기 막음 · 붙은 파일 지우기 막음 · 사유 짧음 422 · 보관 끝 · 보관 끝 새 판 막음',
           bool(did) and al1 == '1' and v2.get('versionNo') == 2 and al2 == '0' and len(vs.get('versions') or []) == 2 and byr.get('_err') == 403
           and '!' in dele and 'FILE' in fdel and noreason.get('code') == 'ACCT_REASON' and arc.get('ok') is True and (v3.get('_err') in (409, 422) or (v3.get('code') or '').startswith('CORP_DOC')),
           f"{did} · {al1} {v2.get('versionNo')} {al2} · {len(vs.get('versions') or [])} · {byr.get('_err')} · {dele[-30:]} · {fdel[-30:]} · {noreason.get('code')} {arc.get('ok')} · {v3.get('code') or v3.get('_err')}")
    finally:
        if did: psql(f"SET session_replication_role = replica; DELETE FROM ops_alerts WHERE alert_code = 'CORP_DOC_DUE' AND detail->>'docId' = '{did}'; DELETE FROM corp_doc_versions WHERE doc_id = {int(did)}; DELETE FROM corp_docs WHERE id = {int(did)};")
        for f in fids:
            if f: psql(f"SET session_replication_role = replica; UPDATE files SET status = 'DELETED', deleted_at = now() WHERE id = '{f}' AND status <> 'DELETED';")
        rm_role(rid_, '1425r')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
