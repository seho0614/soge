"""v10.557 (docs/695) 장애 대응 절차 화면 — 대표 11/21 「(58) ② 장애 대응 절차」
  ① (코드) 운영 API OpzIncidentController · 운영 알림 OPZ_INCIDENT_OPEN(기존 당번 · 텔레그램 길) · D272 장애 공지 재사용 · 표 5 · 런북 시드 6 · 쌓기만 트리거 · 스위치 둘 off · 정기 작업 opz_daily · 메뉴 · 화면 OPZ-020 · 문서 695
  ② (API · DB) 꺼짐 OPZ_IR_OFF · SEV3 열기(대표 11/21 — SEV1 ~ 3 모두 CRITICAL · 점검판 봇 토큰이 없을 때(NO_TOKEN)만 엶 · 바로 호출 꺼짐 — 텔레그램이 실제로 나가지 않게) · 단계 복사 · 체크 · 기록 · 호출 꺼짐 · 운영 알림에서 한 번만 · 누그러뜨림 → 끝(알림 풀림 · 끝 알림) · 되돌아보기 · 확정 · DB 지킴 · 런북 만들기 · 저장(판 +1)
  ③ (화면) 위험감지 › 장애 대응
  (두 번 돌아도 통과 — 「시험 1557」 장애 · 그 알림 · T1557 런북은 시작 · 끝에 replica 로 지움 · 설정은 처음 값으로)
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


M88 = migr('D288_')
CT, INC, JB = rd('src/modules/opz/opz.controller.ts'), rd('src/modules/opz/incident.ts'), rd('src/modules/opz/jobs.ts')
UI, MN, AP, OA = rd('web/src/app/admin/Opz.tsx'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('web/src/app/admin/OpsAlerts.tsx')
WK, SC = rd('src/worker/worker.controller.ts'), rd('src/worker/scheduler.service.ts')

ok('① 코드 — 장애 대응 API(OpzIncidentController) · 운영 알림 OPZ_INCIDENT_OPEN(SEV1 ~ 3 모두 CRITICAL · 기존 당번 · 텔레그램 길) · 바로 호출 뒤 oncall_pushed_at · D272 createIncident · addNote 재사용 · 표 5 · 런북 시드 6(SECURITY 72시간 통지 · 신고) · 진행 기록 쌓기만 트리거 · 스위치 둘 off · 정기 작업 opz_daily · 메뉴 opz-incident(가동 · 장애 공지 뒤) · 화면 OPZ-020 · 문서 695 · 판 v10.557',
   'export class OpzIncidentController' in CT and "@Post('incidents/:id/steps/:stepId')" in CT and "'OPZ_INCIDENT_OPEN'" in INC and "SEV3: 'CRITICAL'" in INC and 'oncall_pushed_at = now()' in INC
   and "from '../uptime/uptime'" in INC and 'createIncident(db, {' in INC and 'addNote(db, i.uptIncidentId' in INC and 'TelegramService' in INC and 'staff_oncall' in INC
   and 'CREATE TABLE IF NOT EXISTS public.opz_runbooks' in M88 and 'CREATE TABLE IF NOT EXISTS public.opz_incident_logs' in M88 and 'CREATE TABLE IF NOT EXISTS public.opz_incident_reviews' in M88
   and "('SITE_DOWN', '사이트 접속 안 됨'" in M88 and "('SECURITY', '보안 사고 의심'" in M88 and '72시간 안에 정보주체에게 통지' in M88 and '개인정보보호위원회에 신고' in M88 and 'trg_opz_incident_log_guard' in M88 and 'trg_opz_review_guard' in M88
   and "('opz.ir_enabled', 'off'" in M88 and "('opz.ir_page_now', 'off'" in M88 and "('opz_daily', 1440, 9, 10" in M88 and "'OPZ_REVIEW_DUE'" in JB
   and "'opz_daily'," in WK and "case 'opz_daily'" in SC and "OPZ_INCIDENT_OPEN: '장애 대응 열림'" in OA
   and "['opz-incident', '장애 대응']" in MN and "'upt-status', ['opz-incident']" in MN and "{tab === 'opz-incident' && <OpzIncident />}" in AP and 'export function OpzIncident' in UI
   and '"SB-ADM-OPZ-020"' in SJ and '"POST /admin/opz/incidents/{id}/steps/{stepId}"' in SJ and '런북' in doc('695_') and VT >= (10, 557), VER)

STAMP = int(time.time()) % 100000
RBC = f'T1557{STAMP}'
CLEAN = ("BEGIN; SET LOCAL session_replication_role = replica; "
         "CREATE TEMP TABLE t1557 AS SELECT id FROM opz_incidents WHERE title LIKE '시험 1557%'; "
         "DELETE FROM ops_alerts WHERE alert_code IN ('OPZ_INCIDENT_OPEN', 'OPZ_INCIDENT_CLOSED', 'OPZ_INCIDENT_STALE', 'OPZ_REVIEW_DUE') AND detail->>'incident' IN (SELECT id::text FROM t1557); "
         "DELETE FROM opz_incident_logs WHERE incident_id IN (SELECT id FROM t1557); DELETE FROM opz_incident_steps WHERE incident_id IN (SELECT id FROM t1557); "
         "DELETE FROM opz_incident_reviews WHERE incident_id IN (SELECT id FROM t1557); DELETE FROM opz_incidents WHERE id IN (SELECT id FROM t1557); "
         "DELETE FROM opz_runbook_steps WHERE runbook_id IN (SELECT id FROM opz_runbooks WHERE code LIKE 'T1557%'); DELETE FROM opz_runbooks WHERE code LIKE 'T1557%'; COMMIT;")

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    old_on, old_page = getset('opz.ir_enabled'), getset('opz.ir_page_now')
    psql(CLEAN)
    try:
        setting('opz.ir_enabled', 'off', '1557')
        setting('opz.ir_page_now', 'off', '1557')
        b0 = call('GET', '/admin/opz/incidents', None, TS)
        rbs = {r.get('code'): r for r in (b0.get('runbooks') or [])}
        rb = str((rbs.get('SITE_DOWN') or {}).get('id') or '')
        off = call('POST', '/admin/opz/incidents', {'runbookId': rb or '1'}, TS)
        ok('② 꺼짐 — opz.ir_enabled off 면 장애 열기 422 OPZ_IR_OFF · 런북 시드 6(SITE_DOWN · SECURITY) · 오늘 당번 · 텔레그램 상태 칸',
           len(rbs) >= 6 and 'SECURITY' in rbs and off.get('_err') == 422 and off.get('code') == 'OPZ_IR_OFF' and 'oncall' in b0 and 'telegram' in b0,
           f"{len(rbs)} · {off.get('code')} · {b0.get('telegram')}")
        # 대표 11/21 — SEV1 ~ 3 모두 긴급(CRITICAL) 알림 = 텔레그램 길. 점검판에서 실제로 텔레그램이 나가지 않게 봇 토큰이 없을 때(NO_TOKEN)만 엶
        # (launch_watch 의 대화방 · 당번 보내기는 토큰이 없으면 보내지 않음 · 바로 호출 opz.ir_page_now 는 위에서 끈 채)
        NO_TG = (b0.get('telegram') or {}).get('reason') == 'NO_TOKEN'
        if not NO_TG:
            print('  (텔레그램 봇 토큰이 있는 판 — 긴급 알림이 실제로 나갈 수 있어 장애 열기 이하 건너뜀)')
        else:
            setting('opz.ir_enabled', 'on', '1557')
            op = call('POST', '/admin/opz/incidents', {'runbookId': rb, 'title': f'시험 1557 장애 {STAMP}', 'sev': 'SEV3', 'note': '시험 1557 열기'}, TS)
            iid, aid = str(op.get('id') or ''), str(op.get('alertId') or '')
            arow = psql(f"SELECT alert_code || '|' || severity || '|' || (detail->>'incident') FROM ops_alerts WHERE id = {aid or 0}")
            d0 = call('GET', f'/admin/opz/incidents/{iid}', None, TS)
            steps = d0.get('steps') or []
            ok('② 열기 — 런북 시드 6(SITE_DOWN · SECURITY) · 꺼짐 422 OPZ_IR_OFF · 켜고 SEV3 열기 · 바로 호출 꺼짐이면 OFF · 운영 알림 OPZ_INCIDENT_OPEN(CRITICAL — SEV3 도 · 대표 11/21) · 단계 6 복사 · 진행 기록 OPEN · 오늘 당번 칸 · 텔레그램 상태 칸',
               len(rbs) >= 6 and 'SECURITY' in rbs and off.get('_err') == 422 and off.get('code') == 'OPZ_IR_OFF'
               and op.get('ok') is True and iid.isdigit() and (op.get('page') or {}).get('result') == 'OFF' and arow == f'OPZ_INCIDENT_OPEN|CRITICAL|{iid}'
               and len(steps) == 6 and any(l.get('kind') == 'OPEN' for l in (d0.get('logs') or [])) and 'oncall' in b0 and 'telegram' in b0,
               f"{len(rbs)} · {off.get('code')} · {op.get('note')} · {(op.get('page') or {}).get('result')} · {arow} · {len(steps)}")

            s1 = str(steps[0].get('id')) if steps else '0'
            c1 = call('POST', f'/admin/opz/incidents/{iid}/steps/{s1}', {'done': True}, TS)
            c2 = call('POST', f'/admin/opz/incidents/{iid}/steps/{s1}', {'done': True}, TS)
            nt = call('POST', f'/admin/opz/incidents/{iid}/notes', {'body': '시험 1557 메모'}, TS)
            pg_ = call('POST', f'/admin/opz/incidents/{iid}/page', {}, TS)
            bad = call('POST', f'/admin/opz/incidents/{iid}/state', {'state': 'OPEN'}, TS)
            rv0 = call('PUT', f'/admin/opz/incidents/{iid}/review', {'summary': '시험 1557 되돌아보기'}, TS)
            lu = call('PUT', f'/admin/opz/incidents/{iid}/upt', {'uptIncidentId': '999999999999'}, TS)
            dup1 = call('POST', '/admin/opz/incidents', {'runbookId': rb, 'title': f'시험 1557 알림 {STAMP}', 'sev': 'SEV3', 'sourceAlertId': aid}, TS)
            dup2 = call('POST', '/admin/opz/incidents', {'runbookId': rb, 'title': f'시험 1557 알림2 {STAMP}', 'sev': 'SEV3', 'sourceAlertId': aid}, TS)
            ok('② 진행 — 단계 체크 · 같은 체크 409 OPZ_STEP_SAME · 진행 기록 · 바로 호출 꺼짐 422 OPZ_PAGE_OFF · 틀린 상태 400 · 끝나기 전 되돌아보기 409 · 없는 공지 422 OPZ_UPT · 운영 알림에서 열기 한 번만(두 번째 409 OPZ_ALREADY_OPEN)',
               c1.get('ok') is True and c2.get('_err') == 409 and c2.get('code') == 'OPZ_STEP_SAME' and nt.get('ok') is True
               and pg_.get('_err') == 422 and pg_.get('code') == 'OPZ_PAGE_OFF' and bad.get('_err') == 400 and rv0.get('_err') == 409 and rv0.get('code') == 'OPZ_REVIEW_STATE'
               and lu.get('code') == 'OPZ_UPT' and dup1.get('ok') is True and dup2.get('_err') == 409 and dup2.get('code') == 'OPZ_ALREADY_OPEN',
               f"{c1.get('note')} {c2.get('code')} · {pg_.get('code')} · {bad.get('_err')} · {rv0.get('code')} · {lu.get('code')} · {dup1.get('ok')} {dup2.get('code')}")

            m1 = call('POST', f'/admin/opz/incidents/{iid}/state', {'state': 'MITIGATED', 'body': '시험 1557 누그러뜨림'}, TS)
            m2 = call('POST', f'/admin/opz/incidents/{iid}/state', {'state': 'MITIGATED'}, TS)
            res = psql(f"SELECT (resolved_at IS NOT NULL)::text FROM ops_alerts WHERE id = {aid or 0}")
            x1 = call('POST', f'/admin/opz/incidents/{iid}/state', {'state': 'CLOSED', 'resolveNotice': True}, TS)
            cl = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'OPZ_INCIDENT_CLOSED' AND detail->>'incident' = '{iid}'")
            n2 = call('POST', f'/admin/opz/incidents/{iid}/notes', {'body': '시험 1557 끝난 뒤'}, TS)
            c3 = call('POST', f'/admin/opz/incidents/{iid}/steps/{s1}', {'done': False}, TS)
            rv1 = call('PUT', f'/admin/opz/incidents/{iid}/review', {'summary': '시험 1557 되돌아보기', 'cause': '시험'}, TS)
            fz0 = call('POST', f'/admin/opz/incidents/{iid}/review/finalize', {'confirm': '아니'}, TS)
            fz1 = call('POST', f'/admin/opz/incidents/{iid}/review/finalize', {'confirm': '확정'}, TS)
            rv2 = call('PUT', f'/admin/opz/incidents/{iid}/review', {'cause': '다시'}, TS)
            ok('② 끝 · 되돌아보기 — 누그러뜨림 · 같은 상태 409 · 그 운영 알림 풀림 · 끝 · OPZ_INCIDENT_CLOSED 한 줄 · 끝난 뒤 기록 · 체크 409 · 되돌아보기 저장 · 확인 글자 틀림 422 · 확정 · 확정 뒤 고치기 409 OPZ_REVIEW_FINAL',
               m1.get('ok') is True and m2.get('_err') == 409 and res == 'true' and x1.get('ok') is True and cl == '1'
               and n2.get('_err') == 409 and c3.get('_err') == 409 and rv1.get('ok') is True and fz0.get('code') == 'OPZ_REVIEW_CONFIRM' and fz1.get('ok') is True
               and rv2.get('_err') == 409 and rv2.get('code') == 'OPZ_REVIEW_FINAL',
               f"{m1.get('ok')} {m2.get('code')} · {res} · {x1.get('note')} · {cl} · {n2.get('code')} {c3.get('code')} · {fz0.get('code')} {fz1.get('ok')} {rv2.get('code')}")

            g1 = psql(f"UPDATE opz_incident_logs SET body = 'x' WHERE incident_id = {iid or 0}")
            g2 = psql(f"DELETE FROM opz_incidents WHERE id = {iid or 0}")
            g3 = psql(f"UPDATE opz_incident_reviews SET cause = 'x' WHERE incident_id = {iid or 0}")
            g4 = psql(f"DELETE FROM opz_runbooks WHERE id = {rb or 0}")
            rd0 = call('GET', f'/admin/opz/runbooks/{rb}', None, TS)
            rn = call('PUT', f'/admin/opz/runbooks/{rb}', {}, TS)
            cr = call('POST', '/admin/opz/runbooks', {'code': RBC, 'title': '시험 1557 런북', 'kind': 'OTHER', 'steps': [{'title': '첫 단계'}, {'title': '둘째 단계', 'detail': '설명'}]}, TS)
            cr2 = call('POST', '/admin/opz/runbooks', {'code': RBC, 'title': '시험 1557 런북', 'kind': 'OTHER', 'steps': [{'title': '첫 단계'}]}, TS)
            sv = call('PUT', f"/admin/opz/runbooks/{cr.get('id')}", {'steps': [{'title': '하나뿐인 단계'}], 'isActive': False}, TS)
            rd1 = call('GET', f"/admin/opz/runbooks/{cr.get('id')}", None, TS)
            st0 = call('PUT', '/admin/opz/incident-settings', {'irReviewDays': 15, 'reason': '시험 1557'}, TS)
            ok('② DB 지킴 · 런북 — 진행 기록 고치기(OPZ_LOG) · 장애 지우기(OPZ_INCIDENT) · 확정한 되돌아보기(OPZ_REVIEW) · 런북 지우기(OPZ_RUNBOOK) 막음 · 런북 단계 6 · 바꿀 것 없음 422 · 새 런북 · 같은 코드 409 · 단계 통째로 바꿈 · 판 +1 · 끔 · 설정 범위 400',
               '!' in g1 and 'OPZ_LOG' in g1 and '!' in g2 and 'OPZ_INCIDENT' in g2 and '!' in g3 and 'OPZ_REVIEW' in g3 and '!' in g4 and 'OPZ_RUNBOOK' in g4
               and len(rd0.get('steps') or []) == 6 and rn.get('code') == 'OPZ_NOTHING' and cr.get('ok') is True and cr2.get('_err') == 409 and cr2.get('code') == 'OPZ_CODE_TAKEN'
               and sv.get('ok') is True and sv.get('version') == 2 and len(rd1.get('steps') or []) == 1 and (rd1.get('runbook') or {}).get('isActive') is False and st0.get('_err') == 400,
               f"{g1[-50:]!r} · {len(rd0.get('steps') or [])} · {rn.get('code')} · {cr.get('ok')} {cr2.get('code')} · {sv.get('version')} {len(rd1.get('steps') or [])} · {st0.get('_err')}")
        if ADMIN_WEB:
            r = admin_page('/#/opz-incident', lambda pg, seen: seen.update(n=pg.locator('[data-opz-ir]').count(), rb=pg.locator('[data-opz-rb-list]').count(), ob=pg.locator('[data-opz-ir-openbox]').count()))
            if r is not None:
                seen, perr = r
                ok('③ 화면 — 위험감지 › 장애 대응(설정 · 런북 목록 · 열기 칸 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('rb') == 1 and seen.get('ob') == 1 and not perr, f"{seen} {perr[:2]}")
    finally:
        setting('opz.ir_enabled', old_on or 'off', '1557 되돌림')
        setting('opz.ir_page_now', old_page or 'off', '1557 되돌림')
        psql(CLEAN)
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
