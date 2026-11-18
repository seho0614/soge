"""v10.349 (docs/483) Nginx 적용 알림
  ① (코드) NGINX_APPLY_FAILED · NGINX_WATCH_STUCK · NGINX_NOT_APPLIED · 한 번만 · 풂 · 운영 알림 이름 · 문서 483 · 판 v10.349
  ② (정기 작업) NOT_APPLIED 한 건 · 다시 돌려도 한 건 · 반영했음 뒤 풂
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

M26 = rd('prisma/migrations/D226_faq_feedback_inquiry_templates/migration.sql')
FB, TC = rd('src/modules/help/faq-feedback.controller.ts'), rd('src/modules/support/inquiry-template.controller.ts')
FS, AM = rd('src/modules/help/faq-admin.service.ts'), rd('src/app.module.ts')
HUB, FA, DESK = rd('site/src/components/support/CsHub.tsx'), rd('web/src/app/admin/FaqAdmin.tsx'), rd('web/src/app/admin/InquiryDesk.tsx')
SJ = rd('spec/screens.json')

SC, NS, OA = rd('src/worker/scheduler.service.ts'), rd('src/modules/identity/nginx-allow-script.ts'), rd('web/src/app/admin/OpsAlerts.tsx')
ok('① 코드 — 정기 작업 sla_alert 가 Nginx 알림 셋(실패 · 결과 없음 10분 · 반영 안 함 24시간) · 같은 종류 한 번만 · 고치면 풂 · 공용 상태 읽기 · 운영 알림 이름 · 문서 483 · 판 v10.349',
   'const ng = await this.nginxAlerts()' in SC and "'NGINX_APPLY_FAILED', 'CRITICAL'" in SC and "'NGINX_WATCH_STUCK', 'CRITICAL'" in SC and "'NGINX_NOT_APPLIED', 'WARN'" in SC
   and 'WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = $1 AND resolved_at IS NULL)' in SC and 'UPDATE ops_alerts SET resolved_at = now(), resolve_note = $2' in SC
   and 'export async function nginxListState' in NS and 'NGINX_NOT_APPLIED:' in OA and 'NGINX_WATCH_STUCK:' in OA and 'NOT_APPLIED' in doc('483_') and VT >= (10, 349), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    IP = f'198.51.100.{210 + int(time.time()) % 40}'   # 판마다 다른 IP — 감사 기록은 고치지 않음(v10.356 사슬)
    opn = lambda: psql("SELECT count(*) FROM ops_alerts WHERE alert_code = 'NGINX_NOT_APPLIED' AND resolved_at IS NULL")
    def clean():
        psql("DELETE FROM staff_ip_allow WHERE memo LIKE '시험 1349%'")
        psql("UPDATE ops_alerts SET resolved_at = now(), resolve_note = '시험 1349 지움' WHERE alert_code = 'NGINX_NOT_APPLIED' AND resolved_at IS NULL")
    clean()
    try:
        old = psql("UPDATE staff_ip_allow SET created_at = created_at - interval '2 days' WHERE created_at > now() - interval '25 hours'")
        ins = psql(f"INSERT INTO staff_ip_allow (ip, memo, created_at) VALUES ('{IP}', '시험 1349 옛 IP', now() - interval '25 hours')")
        g0 = call('GET', '/admin/staff-access/nginx-script', None, TS)
        lc = g0.get('lastChangedAt')
        cond = g0.get('appliedSame') is False and bool(lc) and (datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(lc.replace('Z', '+00:00'))).total_seconds() > 24 * 3600
        exp = '1' if cond else '0'   # 다른 시험이 24시간 안에 허용 IP 를 뺐으면(감사 기록) 「고친 지 24시간」이 아니라 알림 없음이 맞음
        j1 = call('POST', '/admin/jobs', {'job': 'sla_alert'}, TS)
        n1 = opn()
        j2 = call('POST', '/admin/jobs', {'job': 'sla_alert'}, TS)
        n2 = opn()
        ap = psql(f"""INSERT INTO audit.audit_logs (action, target_type, after_data) VALUES ('STAFF_IP_NGINX_APPLIED', 'SETTING', '{{"hash": "{g0.get('hash')}", "t1349": "y"}}'::jsonb)""")
        j3 = call('POST', '/admin/jobs', {'job': 'sla_alert'}, TS)
        n3 = opn()
        ok('② 정기 작업 — 고친 지 24시간 넘고 반영 안 함이면 NOT_APPLIED 한 건(아니면 0) · 다시 돌려도 같음 · 반영했음 기록 뒤 풂',
           '!' not in old and '!' not in ins and g0.get('appliedSame') is False and j1.get('_err') is None and n1 == exp and n2 == exp and '!' not in ap and n3 == '0'
           and (not cond or 'NOT_APPLIED' in json.dumps(j1.get('detail') or {}, ensure_ascii=False)),
           f"기대 {exp} · {g0.get('appliedSame')} {g0.get('lastChangedAt')} · {n1} {n2} {n3} · {json.dumps(j1.get('detail'), ensure_ascii=False)[:160]} · {ap[-60:]}")
    finally:
        clean()
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
