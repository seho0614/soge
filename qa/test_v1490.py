"""v10.490 (D270 · docs/628) 외부 연동 키 만료 · 교체 알림
  ① (코드) D270 its_key_life · its_key_events(쌓기만) · trg_its_key_rotated(NEW 의 코드 · 이름 · 넣은 사람만) · 보기 없음 · 정기 작업 its_key_expiry 08:40 · 키 값을 읽는 코드 없음 · 화면 IntegKeyLife · 화면 목록 ITS-010 · 문서 628
  ② (API · DB) SUPER 만 · 목록에 끝 4자리 없음 · 만료일 저장 → 「곧 기한」 · 알림 ITS_KEY_EXPIRY 7일 칸 · 지나면 CRITICAL · 형식 422 · 없는 키 404 · 키를 넣으면 트리거가 「교체함」(되돌림) · 「바꿨음」 · v_secret_leak 0
  ③ (화면) 외부 연동 › 연동 키 아래 키 만료 · 교체 표 · 끝 4자리 없음 · 화면 오류 없음
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


def staff(tag, role):
    """운영 계정 하나 + 약관 동의 + 증표(시험 끝에 역할 지움)"""
    import consent_ok
    em, aid = mk_staff(tag, role)
    consent_ok.agree(em, PW)
    return em, aid, login(em)


M70 = migr('D270_')
KY, AS, SG, SV, DY, IC = (rd('src/modules/admin/its-keys.ts'), rd('src/modules/admin/its-assets.ts'), rd('src/modules/admin/its-suggest.ts'),
                          rd('src/modules/admin/its-survey.ts'), rd('src/modules/admin/its-daily.ts'), rd('src/modules/admin/its.controller.ts'))
UI, AP, MN, AM, SC, WK = (rd('web/src/app/admin/Its.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/app.module.ts'),
                          rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'))
stamp = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today = kst.strftime('%Y-%m-%d')
day = lambda n: (kst + datetime.timedelta(days=n)).strftime('%Y-%m-%d')

ok('① 코드 — D270 its_key_life · its_key_events 쌓기만 · trg_its_key_rotated(값 칸 안 읽음) · 보기 없음 · its_key_expiry 08:40 · ItsController 키 3 · IntegKeyLife · IntegrationKeys 연결 · 화면 목록 ITS-010 · 문서 628 · 판 v10.490',
   'CREATE TABLE IF NOT EXISTS public.its_key_life' in M70 and 'trg_its_key_events_ro' in M70 and 'AFTER INSERT OR UPDATE OF value_enc ON public.integration_secrets' in M70
   and 'NEW.value_enc' not in M70 and 'NEW.last4' not in M70 and 'CREATE OR REPLACE VIEW' not in M70 and "('its_key_expiry', 1440, 8, 40" in M70
   and 'FROM integration_secrets' not in KY + IC and 'value_enc' not in KY + IC and 'fn_integ_secret_get' not in KY + IC and 'masked' not in KY
   and 'export async function itsKeyExpiryJob' in KY and "case 'its_key_expiry':" in SC and "'its_key_expiry'," in WK and "@Get('integration-keys/life')" in IC
   and 'export function IntegKeyLife' in UI and '<IntegKeyLife />' in rd('web/src/app/admin/IntegrationKeys.tsx') and 'ItsController' in AM
   and '"SB-ADM-ITS-010"' in SJ and '만료' in doc('628_') and VT >= (10, 490), VER)

CODE, NAME = 'SAFENUM', 'SAFENUM_WEBHOOK_SECRET'
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    ae, aid, TA = staff('1490a', 'ADMIN')
    t0 = psql("SELECT now()")
    s0, d0 = getset('its.key_alert'), getset('its.key_alert_days')
    had = psql(f"SELECT count(*) FROM its_key_life WHERE integration_code = '{CODE}' AND key_name = '{NAME}'")
    snap = psql(f"SELECT coalesce(expires_on::text, '') || '|' || coalesce(rotate_days::text, '') || '|' || coalesce(rotated_at::text, '') || '|' || coalesce(rotate_source, '') || '|' || coalesce(owner_note, '') "
                f"FROM its_key_life WHERE integration_code = '{CODE}' AND key_name = '{NAME}'")
    try:
        setting('its.key_alert', 'on', '1490'); setting('its.key_alert_days', '30,7', '1490')
        lst = call('GET', '/admin/integration-keys/life', None, TS)
        txt = json.dumps(lst, ensure_ascii=False)
        row = next((r for r in lst.get('rows') or [] if r.get('code') == 'PG' and r.get('name') == 'TOSS_SECRET_KEY'), {})
        f403 = call('GET', '/admin/integration-keys/life', None, TA)
        ok('② 목록 — SUPER 만(ADMIN 403) · 키마다 줄 · 끝 4자리 · 값 칸 없음',
           f403.get('_err') == 403 and row.get('label') and 'masked' not in txt and '••' not in txt and all('value' not in k for r in lst.get('rows') or [] for k in r),
           f"{f403.get('_err')} {row.get('label')} {len(lst.get('rows') or [])}")
        p1 = call('PUT', f'/admin/integration-keys/life/{CODE}/{NAME}', {'expiresOn': day(5), 'ownerNote': '시험1490 담당'}, TS)
        r1 = next((r for r in call('GET', '/admin/integration-keys/life', None, TS).get('rows') or [] if r.get('code') == CODE and r.get('name') == NAME), {})
        jb = call('POST', '/admin/jobs', {'job': 'its_key_expiry'}, TS)
        a1 = psql(f"SELECT severity || '|' || (detail->>'stage') || '|' || title FROM ops_alerts WHERE alert_code = 'ITS_KEY_EXPIRY' AND detail->>'key' = '{CODE}|{NAME}|{day(5)}|7' AND resolved_at IS NULL")
        bad = call('PUT', f'/admin/integration-keys/life/{CODE}/{NAME}', {'expiresOn': '2026-02-30'}, TS)
        b400 = call('PUT', f'/admin/integration-keys/life/{CODE}/{NAME}', {'rotateDays': 3}, TS)
        n404 = call('PUT', '/admin/integration-keys/life/PG/NO_SUCH_KEY', {'expiresOn': day(5)}, TS)
        ok('② 만료일 — 저장 · 「곧 기한」 5일 · 정기 작업 its_key_expiry · ITS_KEY_EXPIRY 7일 칸(WARN · 키 이름만) · 없는 날 422 · 주기 3 은 400 · 없는 키 404',
           p1.get('ok') is True and r1.get('level') == 'SOON' and r1.get('left') == 5 and r1.get('ownerNote') == '시험1490 담당' and jb.get('_err') is None
           and a1.startswith('WARN|7|') and NAME in a1 and bad.get('code') == 'ITS_KEY_DATE' and b400.get('_err') == 400 and n404.get('_err') == 404,
           f"{p1.get('ok')} {r1.get('level')} {r1.get('left')} {jb.get('_err')} {a1[:60]} {bad.get('code')} {b400.get('_err')} {n404.get('_err')}")
        p2 = call('PUT', f'/admin/integration-keys/life/{CODE}/{NAME}', {'expiresOn': day(-1)}, TS)
        a2 = psql(f"SELECT severity FROM ops_alerts WHERE alert_code = 'ITS_KEY_EXPIRY' AND detail->>'key' = '{CODE}|{NAME}|{day(-1)}|OVER' AND resolved_at IS NULL")
        a1r = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'ITS_KEY_EXPIRY' AND detail->>'key' = '{CODE}|{NAME}|{day(5)}|7' AND resolved_at IS NULL")
        ok('② 지남 — 만료일을 어제로 → 옛 알림 풀림 · OVER(CRITICAL)', p2.get('ok') is True and a2 == 'CRITICAL' and a1r == '0', f'{a2} {a1r}')
        tr = psql(f"BEGIN; SET LOCAL app.enc_key = 'inv-check-enc-key-0123456789abcdef'; SELECT 1 FROM fn_integ_secret_set('{CODE}', '{NAME}', 'test1490SecretValue0123456789', NULL); "
                  f"SELECT rotate_source || '|' || (expires_on IS NULL) || '|' || (SELECT count(*) FROM its_key_events WHERE integration_code = '{CODE}' AND key_name = '{NAME}' AND kind = 'ROTATED' AND at >= '{t0}'::timestamptz) "
                  f"FROM its_key_life WHERE integration_code = '{CODE}' AND key_name = '{NAME}'; ROLLBACK;")
        cols = psql("SELECT count(*) FROM information_schema.columns WHERE table_name IN ('its_key_life', 'its_key_events') AND (column_name LIKE '%value%' OR column_name LIKE '%last4%' OR column_name LIKE '%enc%' OR column_name LIKE '%secret%')")
        leak = psql("SELECT count(*) FROM v_secret_leak")
        ok('② 트리거 — 키를 넣으면 its_key_life 「ADMIN_KEY」 · 만료일 비움 · ROTATED 기록(되돌림) · 새 표에 값 칸 없음 · v_secret_leak 0',
           tr.split('\n')[-1] == 'ADMIN_KEY|true|1' and cols == '0' and leak == '0', f"{tr.split(chr(10))[-1]} {cols} {leak}")
        rt = call('POST', f'/admin/integration-keys/life/{CODE}/{NAME}/rotated', {'note': '시험1490 .env 교체', 'expiresOn': day(400)}, TS)
        st = psql(f"SELECT rotate_source || '|' || expires_on::text FROM its_key_life WHERE integration_code = '{CODE}' AND key_name = '{NAME}'")
        call('POST', '/admin/jobs', {'job': 'its_key_expiry'}, TS)
        a3 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'ITS_KEY_EXPIRY' AND detail->>'code' = '{CODE}' AND detail->>'name' = '{NAME}' AND resolved_at IS NULL")
        ev = psql(f"UPDATE its_key_events SET kind = 'LIFE_SET' WHERE integration_code = '{CODE}' AND key_name = '{NAME}'")
        ok('② 「바꿨음」 — MANUAL · 새 만료일 · 400일 뒤라 알림 풀림 · 기록은 고칠 수 없음',
           rt.get('ok') is True and st == f'MANUAL|{day(400)}' and a3 == '0' and '!' in ev, f"{rt.get('ok')} {st} {a3} {ev[-40:]}")
    finally:
        if had == '0':
            psql(f"DELETE FROM its_key_life WHERE integration_code = '{CODE}' AND key_name = '{NAME}'")
        else:
            e, r, ra, rs, on = (snap.split('|') + [''] * 5)[:5]
            psql(f"UPDATE its_key_life SET expires_on = NULLIF('{e}', '')::date, rotate_days = NULLIF('{r}', '')::int, rotated_at = NULLIF('{ra}', '')::timestamptz, "
                 f"rotate_source = NULLIF('{rs}', ''), owner_note = NULLIF('{on.replace(chr(39), chr(39) * 2)}', '') WHERE integration_code = '{CODE}' AND key_name = '{NAME}'")
        psql(f"SET session_replication_role = replica; DELETE FROM its_key_events WHERE integration_code = '{CODE}' AND key_name = '{NAME}' AND at >= '{t0}'::timestamptz; "
             f"DELETE FROM ops_alerts WHERE alert_code = 'ITS_KEY_EXPIRY' AND detail->>'code' = '{CODE}' AND detail->>'name' = '{NAME}' AND raised_at >= '{t0}'::timestamptz;")
        setting('its.key_alert', s0 or None, '1490 되돌림'); setting('its.key_alert_days', d0 or None, '1490 되돌림')
        rm_role(aid, '1490')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

if ADMIN_WEB:
    def chk(pg, seen):
        seen['rows'] = pg.locator('[data-key-life-row]').count()
        seen['dots'] = '••' in (pg.locator('[data-key-life]').inner_text() if pg.locator('[data-key-life]').count() else '••')
    r = admin_page('/#/integrations', chk)
    if r:
        seen, perr = r
        ok('③ 화면 — 외부 연동 › 연동 키 아래 키 만료 · 교체 표 · 끝 4자리 없음 · 화면 오류 없음', seen.get('rows', 0) > 0 and seen.get('dots') is False and not perr, f'{seen} {perr[:2]}')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
