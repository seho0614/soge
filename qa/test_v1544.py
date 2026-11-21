"""v10.544 (docs/682) 파트너 자료 내려받기 — 대표 11/20 「(54) ③ 파트너 자료 내려받기」
  ① (코드) D284 ptn_export_logs(쌓기만) · export_requests 대상 PTN_LEADS · @ExportGate('PTN_LEADS') · 연락처 칸 없음 · 요약 가림 · 대표 · 정산 권한 · ptn.export_enabled off · 메뉴 vsx-ptn-export · 화면 VSX-030 · PTC-VSX-010 · 문서 682
  ② (API · DB) 꺼짐 409 · 파트너 아님 409 · 켜고 상태 · 승인 번호 없이 422 · 요청 → SUPER 승인 → 받기(머리 · 연락처 없음 · 기록) · 같은 번호 다시 422 · 성과 CSV 12달 · 기록 지우기 막음 · 권한 주소
  ③ (화면) 파트너사 › 파트너 자료 내려받기 · 파트너센터 › 자료 내려받기(SITE 있을 때)
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


M84 = migr('D284_')
CT, ST = rd('src/modules/vsx/vsx.controller.ts'), rd('src/modules/vsx/vsx-settings.ts')
UI, MN, AP = rd('web/src/app/admin/Vsx.tsx'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx')
KOJ = rd('site/src/i18n/messages/ko/vsx.json')
ENJ = rd('site/src/i18n/messages/en/vsx.json')

PE = rd('src/modules/vsx/ptn-export.ts')
EA = rd('src/modules/admin/export-approval.ts')
PX, PV = rd('site/src/app/partner/export/page.tsx'), rd('site/src/components/vsx/PtnExportView.tsx')
STP = rd('site/src/app/partner/stats/page.tsx')

ok('① 코드 — D284 ptn_export_logs(fn_block_write) · 대상 PTN_LEADS(DB · 서버 · ITS_SURVEY 앞) · @ExportGate · contact_enc 안 읽음 · 요약 가림 · canMoney · 운영 알림 PTN_EXPORT_REQUEST · 메뉴 vsx-ptn-export(PARTNER_MAL) · 화면 VSX-030 · PTC-VSX-010 · 실적 화면 단추 · 문서 682 · 판 v10.544',
   'CREATE TABLE IF NOT EXISTS public.ptn_export_logs' in M84 and 'trg_ptn_export_logs_ro' in M84 and "'PTN_LEADS'" in M84 and "('ptn.export_enabled', 'off'" in M84
   and "'PTN_LEADS', 'ITS_SURVEY'] as const" in EA and "@ExportGate('PTN_LEADS')" in CT and 'contact_enc' not in (PE.split('*/', 1) + [''])[1] and 'export function maskSummary' in PE
   and 'p.isOwner || p.canMoney' in PE and 'PTN_EXPORT_REQUEST' in PE and "'vsx-ptn-export': ['ADMIN', 'SUPER', 'PARTNER_MAL']" in AP and 'export function VsxPtnExport' in UI
   and 'data-screen="SB-PTC-VSX-010"' in PX and '/api/v1/partner/export/leads?ticket=' in PV and 'href="/partner/export"' in STP
   and '"SB-ADM-VSX-030"' in SJ and '"SB-PTC-VSX-010"' in SJ and '연락처' in doc('682_') and VT >= (10, 544), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    old_on = getset('ptn.export_enabled')
    em, aid = mk_staff('1544', role=None); consent_ok.agree(em, PW); TM = login(em)
    pem = psql("SELECT a.email FROM partners p JOIN businesses b ON b.id = p.business_id JOIN accounts a ON a.id = b.account_id "
               "WHERE p.status = 'ACTIVE' AND a.status = 'ACTIVE' AND a.email LIKE '%@x.com' AND a.email <> 'admin@x.com' ORDER BY p.approved_at NULLS LAST LIMIT 1")
    t0 = psql("SELECT now()")
    try:
        setting('ptn.export_enabled', 'off', '1544')
        np_ = call('GET', '/partner/export', None, TM)
        if not pem or '!' in pem:
            ok('② 파트너 아님 409(시험 파트너 계정이 없어 나머지는 건너뜀)', np_.get('code') == 'NOT_PARTNER', str(np_.get('code')))
        else:
            consent_ok.agree(pem, PW); TP = login(pem)
            offr = call('POST', '/partner/export/request', {'reason': '시험 1544'}, TP)
            setting('ptn.export_enabled', 'on', '1544')
            st = call('GET', '/partner/export', None, TP)
            noticket = call('GET', '/partner/export/leads', None, TP)
            rq = call('POST', '/partner/export/request', {'reason': '시험 1544 리드 정리'}, TP)
            rid = rq.get('id')
            dec = call('POST', f'/admin/export-requests/{rid}/decide', {'approve': True}, TS) if rq.get('state') == 'PENDING' else {'state': rq.get('state')}
            got = call('GET', f'/partner/export/leads?ticket={rid}', None, TP) if dec.get('state') == 'APPROVED' else {}
            head = (got.get('csv') or '').lstrip('﻿').split('\r\n')[0]
            logs = psql(f"SELECT count(*) FROM ptn_export_logs WHERE kind = 'LEADS' AND ticket_id = {int(rid or 0)}")
            again = call('GET', f'/partner/export/leads?ticket={rid}', None, TP) if dec.get('state') == 'APPROVED' else {'_err': 422}
            pf = call('GET', '/partner/export/perf', None, TP)
            dele = psql(f"DELETE FROM ptn_export_logs WHERE ticket_id = {int(rid or 0)}")
            av = call('GET', '/admin/vsx/ptn-exports', None, TS)
            rmap = psql("SELECT count(*) FROM perm_route_map WHERE pattern <> '/admin/help/tab' AND task_key = 'vsx-ptn-export'")
            can = st.get('canExport')
            ok('② 내려받기 — 파트너 아님 409 · 꺼짐 409 · 상태 · 승인 번호 없이 422 · 요청 PENDING · SUPER 승인 · 리드 CSV(머리 배정 번호 · 전화 · 연락처 칸 없음 · 기록 1) · 같은 번호 422 · 성과 12달 · 지우기 막음 · 운영 기록 · 권한 주소 1(정산 권한이 없는 계정이면 403 확인만)',
               np_.get('code') == 'NOT_PARTNER' and offr.get('code') == 'PTN_EXPORT_OFF' and st.get('enabled') is True
               and ((noticket.get('_err') == 422 and noticket.get('code') == 'EXPORT_NEED_APPROVAL' and rq.get('state') in ('PENDING', 'APPROVED') and dec.get('state') == 'APPROVED'
                     and head.startswith('배정 번호') and '연락처' not in head and '전화' not in head and logs == '1' and again.get('_err') == 422 and pf.get('rows') == 12 and '!' in dele)
                    if can else rq.get('code') == 'PTN_EXPORT_ROLE')
               and isinstance(av.get('logs'), list) and rmap == '1',
               f"{np_.get('code')} {offr.get('code')} · {st.get('enabled')} {can} · {noticket.get('code')} · {rq.get('state')} {dec.get('state')} · {head[:40]} · {logs} · {again.get('_err')} · {pf.get('rows')} · {dele[-30:]} · {rmap}")
        if ADMIN_WEB:
            r = admin_page('/#/vsx-ptn-export', lambda pg, seen: seen.update(n=pg.locator('[data-vsx-ptn-export]').count()))
            if r is not None:
                seen, perr = r
                ok('③ 화면 — 파트너사 › 파트너 자료 내려받기(화면 오류 없음)', seen.get('n') == 1 and not perr, f"{seen} {perr[:2]}")
    finally:
        psql(f"BEGIN; SET LOCAL session_replication_role = replica; DELETE FROM ptn_export_logs WHERE at >= '{t0}'; "
             f"DELETE FROM export_requests WHERE target = 'PTN_LEADS' AND requested_at >= '{t0}'; DELETE FROM ops_alerts WHERE alert_code = 'PTN_EXPORT_REQUEST' AND raised_at >= '{t0}'; COMMIT;")
        setting('ptn.export_enabled', old_on or 'off', '1544 되돌림')
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
