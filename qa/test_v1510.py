"""v10.510 (D275 · docs/648) 이상 거래 점수 — 대표 11/20 「㊺ ②」
  ① (코드) 규칙 표(점수 · 기준값 SUPER) · 규칙 SQL 9 · 점수 · 까닭 · 기준 넘으면 검수 대기 · 위험감지 경보 RSK-OPX · 운영 알림 OPX_RISK_HIGH · 매물 · 신고 트리거 · 정기 작업 2 · 회원 API 없음 · 화면 OPX-020 · 문서 648
  ② (API · DB) 회원 403 · 같은 연락처 두 계정 → 점수(새 계정 + 같은 연락처) · 기준 낮추면 검수 대기 · 경보 · 알림 · 다시 셈해도 검수 대기 하나 · 끝내기 · 다시 끝내기 409 · 사유 없음 400 · 규칙 점수 101 400 · 운영 역할 계정은 세지 않음
  ③ (화면) 위험감지 › 이상 거래 점수
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


M75 = migr('D275_')
stamp = int(time.time()) % 1000000
RK, OC, MN, AP, UI, JB = (rd('src/modules/opx/risk.ts'), rd('src/modules/opx/opx.controller.ts'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'),
                          rd('web/src/app/admin/Opx.tsx'), rd('src/worker/scheduler.service.ts'))
ok('① 코드 — D275 opx_risk_rules 9(지우기 · 코드 바꾸기 막음) · opx_risk_scores · opx_risk_dirty 트리거(매물 · 신고) · opx_risk_cases(열린 것 하나 · 한 번만 끝냄) · RSK-OPX · 설정 opx.risk_score on · threshold 60 · RULE_SQL 9 · OPX_RISK_HIGH · 운영 역할 뺌 · 정기 작업 opx_risk_events · opx_risk_daily · 메뉴 · 화면 OPX-020 · 문서 648 · 판 v10.510',
   'CREATE TABLE IF NOT EXISTS public.opx_risk_rules' in M75 and M75.count("', '") > 0 and 'trg_opx_risk_rules_guard' in M75 and 'trg_opx_risk_mark_listing' in M75 and 'trg_opx_risk_mark_report' in M75
   and 'ux_opx_risk_cases_open' in M75 and "('RSK-OPX'" in M75 and "('opx.risk_score', 'on'" in M75 and "('opx.risk_threshold', '60'" in M75
   and all(f"{c}:" in RK for c in ('NEW_ACCOUNT', 'LISTING_BURST', 'SAME_PHONE', 'REPORTED', 'REPORT_UPHELD', 'BLOCK_NEAR', 'REVIEW_REJECTED', 'WAS_SUSPENDED', 'NO_IDENTITY'))
   and "'OPX_RISK_HIGH'" in RK and "'RSK-OPX'" in RK and 'r.role = ANY($2::text[])' in RK and "case 'opx_risk_events'" in JB and "case 'opx_risk_daily'" in JB
   and "@Put('risk/rules/:id')" in OC and "['opx-risk', '이상 거래 점수']" in MN and "<OpxRisk isSuper=" in AP and 'export function OpxRisk' in UI
   and '"SB-ADM-OPX-020"' in SJ and '회원에게' in doc('648_') and VT >= (10, 510), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    th0 = getset('opx.risk_threshold')
    a1 = a2 = s1 = ''
    cases = []
    phone = f"010-7{stamp % 1000:03d}-{(stamp // 1000) % 10000:04d}"
    try:
        e1, a1 = mk_staff(f'1510a{stamp % 97}', role=None)
        e2, a2 = mk_staff(f'1510b{stamp % 89}', role=None)
        e3, s1 = mk_staff(f'1510s{stamp % 83}', 'ADMIN')
        psql(f"UPDATE accounts SET phone = '{phone}' WHERE id IN ('{a1}', '{a2}', '{s1}')")
        mb = call('GET', '/admin/opx/risk/scores', None, TB)
        rc = call('POST', f'/admin/opx/risk/recompute/{a1}', {}, TS)
        codes = sorted(r.get('code') for r in rc.get('reasons') or [])
        rs = call('POST', f'/admin/opx/risk/recompute/{s1}', {}, TS)
        setting('opx.risk_threshold', str(min(int(rc.get('score') or 1), 100) or 1), '1510')
        rc2 = call('POST', f'/admin/opx/risk/recompute/{a1}', {}, TS)
        rc3 = call('POST', f'/admin/opx/risk/recompute/{a1}', {}, TS)
        open_n = psql(f"SELECT count(*) FROM opx_risk_cases WHERE account_id = '{a1}' AND state = 'OPEN'")
        cs = call('GET', '/admin/opx/risk/cases?state=OPEN', None, TS)
        c = next((x for x in cs.get('items') or [] if x.get('accountId') == a1), {})
        cid = str(c.get('id') or ''); cases = [cid] if cid else []
        alert = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'OPX_RISK_HIGH' AND detail->>'caseId' = '{cid or 0}'")
        ralert = psql(f"SELECT count(*) FROM risk_alerts WHERE rule_code = 'RSK-OPX' AND detail LIKE '%#{cid or 0}'")
        bad = call('POST', f'/admin/opx/risk/cases/{cid or 0}/decide', {'result': 'CLEARED'}, TS)
        dc = call('POST', f'/admin/opx/risk/cases/{cid or 0}/decide', {'result': 'CLEARED', 'note': '시험 1510 같은 가족'}, TS)
        dc2 = call('POST', f'/admin/opx/risk/cases/{cid or 0}/decide', {'result': 'ACTIONED', 'note': '시험 1510 다시'}, TS)
        r101 = call('PUT', '/admin/opx/risk/rules/NEW_ACCOUNT', {'points': 101}, TS)
        rnone = call('PUT', '/admin/opx/risk/rules/NOPE_RULE', {'points': 1}, TS)
        rules = call('GET', '/admin/opx/risk/rules', None, TS)
        dbdel = psql("DELETE FROM opx_risk_rules WHERE code = 'NEW_ACCOUNT'")
        trg = psql("SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_opx_risk_mark_listing', 'trg_opx_risk_mark_report')")
        ok('② 이상 거래 점수 — 회원 403 · 새 계정 + 같은 연락처 점수 · 운영 역할 안 셈 · 기준 넘으면 검수 대기 하나(두 번 셈해도) · 경보 · 운영 알림 · 사유 없음 400 · 끝내기 · 다시 409 · 점수 101 400 · 없는 규칙 404 · 규칙 9 · DB 지우기 막음 · 트리거 2',
           mb.get('_err') == 403 and 'NEW_ACCOUNT' in codes and 'SAME_PHONE' in codes and int(rc.get('score') or 0) >= 35 and rs.get('scored') == 0
           and rc2.get('opened') == 1 and rc3.get('opened') == 0 and open_n == '1' and cid and alert == '1' and ralert == '1'
           and bad.get('_err') == 400 and dc.get('state') == 'CLEARED' and dc2.get('_err') == 409 and r101.get('_err') == 400 and rnone.get('_err') == 404
           and len(rules.get('rules') or []) == 9 and 'OPX_RISK_RULE' in dbdel and trg == '2',
           f"{mb.get('_err')} {codes} {rc.get('score')} {rs.get('scored')} · {rc2.get('opened')} {rc3.get('opened')} {open_n} {cid} {alert} {ralert} · {bad.get('_err')} {dc.get('state')} {dc2.get('_err')} {r101.get('_err')} {rnone.get('_err')} {len(rules.get('rules') or [])} {dbdel[-30:]} {trg}")
    finally:
        setting('opx.risk_threshold', th0 or '60', '1510 되돌림')
        for x in cases:
            if x.isdigit():
                psql(f"SET session_replication_role = replica; DELETE FROM risk_alerts WHERE rule_code = 'RSK-OPX' AND detail LIKE '%#{x}'; DELETE FROM ops_alerts WHERE alert_code = 'OPX_RISK_HIGH' AND detail->>'caseId' = '{x}'; DELETE FROM opx_risk_cases WHERE id = {x};")
        for a in (a1, a2, s1):
            if a:
                psql(f"SET session_replication_role = replica; DELETE FROM opx_risk_cases WHERE account_id = '{a}'; DELETE FROM opx_risk_scores WHERE account_id = '{a}'; DELETE FROM opx_risk_dirty WHERE account_id = '{a}'; UPDATE accounts SET phone = NULL WHERE id = '{a}';")
        if s1:
            rm_role(s1, '1510')
    if ADMIN_WEB:
        r = admin_page('/#/opx-risk', lambda pg, seen: seen.update(n=pg.locator('[data-opx-risk]').count(), views=pg.locator('[data-opx-risk-view]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 위험감지 › 이상 거래 점수(검수 대기 · 계정별 점수 · 규칙 단추 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('views') == 3 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
