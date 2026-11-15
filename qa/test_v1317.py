"""v10.317 (D220 · docs/442) — 「간주 끌 수 있음」 운영 알림 시험
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1317.py

  ① (코드) D220 급한 알림 함수 6개에 ASSUME_READY · launch_watch 의 assumeReadyAlert(간주 모드 끄는 순서 그대로 · 7일) · 게시판 목록 · 화면 이름 · 문서 442 · 판 v10.317
  ② (DB) D220 적용 · 함수 6개 본문에 ASSUME_READY
  ③ (작업) 중개사 연동을 잠시 「시험 중」으로 → launch_watch → ASSUME_READY(중개사) 한 줄(7일 안에 이미 있으면 새로 안 냄) · 곧바로 다시 → 새 줄 없음 · 연동 상태 되돌림
  ④ (화면) 위험감지 › 운영 알림 — 「간주 끌 수 있음」 이름
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB = os.environ.get('ADMIN_WEB')
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


def admin_account(tag, stamp):
    """ADMIN(최고 관리자 아님) 시험 계정 — 남겨 두어도 두 번째 실행에 지장 없음"""
    import consent_ok
    em = f't{tag}adm{stamp}@x.com'
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{em}', '시험{tag}', '{pw}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{em}'")
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag}', true); INSERT INTO account_roles (account_id, role) VALUES ('{aid}', 'ADMIN') ON CONFLICT DO NOTHING; COMMIT;")
    consent_ok.agree(em, PW)
    return em, aid


def login(e):
    return call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')


M20, SC, OA, D442 = rd('prisma/migrations/D220_assume_ready_alert/migration.sql'), rd('src/worker/scheduler.service.ts'), rd('web/src/app/admin/OpsAlerts.tsx'), doc('442_')
FNS = ['fn_ops_alert_mail_pending', 'fn_ops_alert_mail_backlog', 'fn_ops_alert_push_pending', 'fn_ops_alert_push_backlog', 'fn_ops_alert_slack_pending', 'fn_ops_alert_slack_backlog']
mig = sorted(x for x in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.exists(os.path.join(K, 'prisma/migrations', x, 'migration.sql'))) if os.path.isdir(os.path.join(K, 'prisma/migrations')) else []
ok('① DB — D220 함수 6개 CREATE OR REPLACE · 목록에 ASSUME_READY · 지우는 문장 없음 · 마이그레이션 258',
   all(f'CREATE OR REPLACE FUNCTION public.{f}()' in M20 for f in FNS) and M20.count("'STAFF_IP_DAY_LIMIT', 'ASSUME_READY'))") == 6
   and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE|DROP COLUMN)\b', M20) and len(mig) >= 258 and 'D220_assume_ready_alert' in mig, f'{len(mig)}')
ok('① 서버 · 화면 — launch_watch 가 assumeReadyAlert(켜짐 · 조건 갖춤 · 7일 안 같은 키 없음 · items 한 줄) · 게시판 목록 · 운영 알림 이름 · 문서 442 · 판 v10.317',
   'const ar = await this.assumeReadyAlert();' in SC and 'ar.rows.filter((x) => !x.off && x.ready)' in SC and "raised_at > now() - interval '7 days'" in SC
   and "await this.alert('ASSUME_READY', 'INFO'," in SC and "'ASSUME_READY'))   /* v10.317 (D220) */" in SC and 'assumeReady: ar,' in SC
   and "ASSUME_READY: '간주 끌 수 있음'," in OA and 'ASSUME_READY' in D442 and VT >= (10, 317), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    fn = psql("SELECT count(*) FROM pg_proc WHERE proname IN (" + ', '.join(f"'{f}'" for f in FNS) + ") AND prosrc LIKE '%ASSUME_READY%'")
    sm = psql("SELECT count(*) FROM schema_migrations WHERE name = 'D220_assume_ready_alert'")
    ok('② DB — D220 적용 · 함수 6개 본문에 ASSUME_READY', fn == '6' and sm == '1', f'함수 {fn} · 적용 {sm}')
    b0 = psql("SELECT status FROM integrations WHERE code = 'BROKER'")
    v0 = psql("SELECT coalesce((SELECT value FROM site_settings WHERE key = 'assume.broker'), 'on')")
    SEEN = "SELECT count(*) FROM ops_alerts WHERE alert_code = 'ASSUME_READY' AND raised_at > now() - interval '7 days' AND detail -> 'items' @> '[{\"key\": \"assume.broker\"}]'"
    try:
        n0 = int(psql(SEEN) or 0)
        if b0 not in ('TESTING', 'LIVE'):
            psql("UPDATE integrations SET status = 'TESTING' WHERE code = 'BROKER'")
        ar = call('GET', '/admin/assume-readiness', None, TS)
        brk = next((x for x in ar.get('rows') or [] if x.get('key') == 'assume.broker'), {})
        j1 = (call('POST', '/admin/jobs', {'job': 'launch_watch'}, TS).get('detail') or {})
        n1 = int(psql(SEEN) or 0)
        time.sleep(1.2)
        j2 = (call('POST', '/admin/jobs', {'job': 'launch_watch'}, TS).get('detail') or {})
        n2 = int(psql(SEEN) or 0)
        tt = psql("SELECT title FROM ops_alerts WHERE alert_code = 'ASSUME_READY' AND detail -> 'items' @> '[{\"key\": \"assume.broker\"}]' ORDER BY id DESC LIMIT 1")
        ok('③ 작업 — 중개사 연동 「시험 중」 → 간주 모드 끄는 순서 중개사 「끌 수 있음」 → launch_watch 가 ASSUME_READY(중개사 · 7일 안에 이미 있으면 새로 안 냄) · 곧바로 다시 돌려도 새 줄 없음 · 제목에 화면 위치',
           v0 == 'on' and brk.get('ready') is True and brk.get('off') is False and n1 == max(n0, 1) and n2 == n1
           and (('assume.broker' in (j1.get('assumeReady') or [])) == (n0 == 0)) and 'assume.broker' not in (j2.get('assumeReady') or [])
           and '간주를 끌 수 있습니다' in tt and '간주 모드 끄는 순서' in tt,
           f"b0 {b0} v0 {v0} · ready {brk.get('ready')} · n {n0}→{n1}→{n2} · j1 {j1.get('assumeReady')} j2 {j2.get('assumeReady')} · {tt[:80]}")
    finally:
        if b0 and b0 not in ('TESTING', 'LIVE'):
            psql(f"UPDATE integrations SET status = '{b0}' WHERE code = 'BROKER'")
    b1 = psql("SELECT status FROM integrations WHERE code = 'BROKER'")
    ok('③ 되돌림 — 중개사 연동 상태가 시험 전 값', b1 == b0, f'{b0} → {b1}')
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if ADMIN_WEB and sync_playwright:
        seen = {}
        try:
            with sync_playwright() as p:
                b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 1000})
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                pg.goto(ADMIN_WEB + '/#/ops-alerts', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                seen['label'] = pg.get_by_text('간주 끌 수 있음').count()
                b.close()
        except Exception as e:
            seen['err'] = str(e)[:200]
        ok('④ 화면 — 위험감지 › 운영 알림에 「간주 끌 수 있음」', seen.get('label', 0) >= 1, f'{seen}')
    else:
        print('  (운영 화면 · playwright 없음 — ④ 건너뜀)')
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
