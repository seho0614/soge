"""v10.599 (docs/741) 16차 회원 · 성장 ⑮ 알림 하루 요약 받기 — 회원 설정 · 매일 08:00 한 통 · 메일 준비 전에는 사이트 알림만(grw.digest 처음 off)
  ① (코드) 표 둘 · 알림 종류 · 글 · 메일 묶기 트리거 · 설정 · 정기 작업 · 나의공간 상자 · 화면 · 문서 741
  ② (API · DB) 꺼짐 422 · 켬 · 정기 작업 → 켠 회원만 한 통 · 다시 돌려도 한 통 · 메일 묶기(끌 수 있는 것만) · 끄기 · 운영 숫자 · 회원 403
  ③ (화면) 나의공간 › 알림 상자
  (두 번 돌아도 통과 — 시험 회원은 매번 새 사람 · 시험 알림 · 메일 줄 · 요약 기록은 replica 로 지움 · 설정은 되돌림)
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


def mk_member(tag):
    """시험 회원(본인인증 · MEMBER) — 이메일에 시각을 넣어 두 번 돌아도 새 사람"""
    em, aid = mk_staff(tag, 'MEMBER')
    import consent_ok
    consent_ok.agree(em, PW)
    return em, aid, login(em)


def mig_with(word):
    """grw_ SQL 이 들어간 마이그레이션(번호는 메인이 정함 — 글자로 찾음 · 여러 개면 이어 붙임)"""
    d = os.path.join(K, 'prisma', 'migrations')
    out = []
    for x in (sorted(os.listdir(d)) if os.path.isdir(d) else []):
        p = os.path.join(d, x, 'migration.sql')
        if os.path.isfile(p):
            t = open(p, encoding='utf-8').read()
            if word in t:
                out.append(t)
    return '\n'.join(out)


"""시험 몸통"""
GRW = {k: rd(f'src/modules/grw/{k}.ts') for k in ('common', 'funnel', 'first-steps', 'digest', 'tier', 'fill', 'grw.controller')}
MN, AP, AM = rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('src/app.module.ts')
GW = rd('web/src/app/admin/Grw.tsx')
KO = json.loads(rd('site/src/i18n/messages/ko/grw.json') or '{}')
EN = json.loads(rd('site/src/i18n/messages/en/grw.json') or '{}')
STAMP = int(time.time()) % 1000000


def keys(d, p=''):
    out = set()
    for k, v in (d or {}).items():
        out |= keys(v, p + k + '.') if isinstance(v, dict) else {p + k}
    return out

M = mig_with('grw_digest_prefs')
WC, SC = rd('src/worker/worker.controller.ts'), rd('src/worker/scheduler.service.ts')
NT = rd('site/src/app/my/notifications/page.tsx')
ok('① 코드 — grw_digest_prefs · grw_digest_sends(회원 · 날 고유) · 알림 GRW_DIGEST(끌 수 있음 · 글) · 메일 묶기 트리거(끌 수 있는 알림만 · DIGEST) · grw.digest off · 정기 작업 grw_daily 08:00 · 나의공간 › 알림 상자 · 화면 MYP-GRW-020 · 문서 741 · 판 v10.599',
   'CREATE TABLE IF NOT EXISTS public.grw_digest_prefs' in M and 'CONSTRAINT uq_grw_digest_sends UNIQUE (account_id, sent_on)' in M
   and "('GRW_DIGEST', '알림 하루 요약', true, false" in M and "'GRW_DIGEST_INAPP', 'INAPP'" in M
   and 'trg_grw_digest_mail_hold BEFORE INSERT ON public.notification_deliveries' in M and 'p.optout_allowed IS TRUE' in M and "'DIGEST: 하루 요약으로 묶어 보냄'" in M
   and "('grw.digest', 'off', 'ADMIN'" in M and "('grw_daily', 1440, 8, 0" in M and "'grw_daily'," in WC and "case 'grw_daily'" in SC
   and 'export async function grwDailyJob' in GRW['digest'] and '<GrwDigestBox />' in NT and 'SB-MYP-GRW-020' in SJ and '메일 준비 전' in doc('741_') and VT >= (10, 599), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    em, aid, TM = mk_member('1599')
    em2, aid2, TM2 = mk_member('1599b')
    old = getset('grw.digest')
    try:
        setting('grw.digest', 'off', '1599')
        off = call('PUT', '/me/grw/digest', {'enabled': True}, TM)
        g0 = call('GET', '/me/grw/digest', None, TM)
        setting('grw.digest', 'on', '1599')
        on = call('PUT', '/me/grw/digest', {'enabled': True}, TM)
        g1 = call('GET', '/me/grw/digest', None, TM)
        # 알림 두 건(끌 수 있는 종류) · 회원 2 는 요약을 켜지 않음
        for acc in (aid, aid2):
            psql(f"INSERT INTO notifications (account_id, event_code, title, body) VALUES ('{acc}', 'MBX_PRICE_DIGEST', '시험1599 가격 하나', '본문'), ('{acc}', 'MBX_DM_NEW', '시험1599 대화', '본문')")
        j1 = call('POST', '/admin/jobs', {'job': 'grw_daily'}, TS)
        d1 = psql(f"SELECT count(*) || '|' || coalesce(max(link_url), '') || '|' || coalesce(max(title), '') FROM notifications WHERE account_id = '{aid}' AND event_code = 'GRW_DIGEST'")
        d2 = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{aid2}' AND event_code = 'GRW_DIGEST'")
        call('POST', '/admin/jobs', {'job': 'grw_daily'}, TS)
        d1b = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{aid}' AND event_code = 'GRW_DIGEST'")
        ok('② 요약 — 스위치 꺼짐 켜기 422 · 켬 · 정기 작업 → 켠 회원만 요약 한 통(제목 2건 · 주소 /my/notifications) · 켜지 않은 회원 0 · 다시 돌려도 한 통',
           off.get('code') == 'GRW_DIGEST_OFF' and g0.get('available') is False and on.get('enabled') is True and g1.get('enabled') is True
           and isinstance(j1, dict) and not j1.get('_err') and d1.startswith('1|/my/notifications|') and int((re.search(r'알림 (\d+)건', d1) or [0, '0'])[1]) >= 2 and d2 == '0' and d1b == '1',
           f'{off.get("code")} {on} {j1} {d1} {d2} {d1b}')
        # 메일 묶기 — 끌 수 있는 알림 메일은 DIGEST 로 닫힘 · 요약 · 끌 수 없는 알림 메일은 그대로 QUEUED
        nid = psql(f"SELECT id FROM notifications WHERE account_id = '{aid}' AND event_code = 'MBX_DM_NEW' ORDER BY id DESC LIMIT 1")
        gid = psql(f"SELECT id FROM notifications WHERE account_id = '{aid}' AND event_code = 'GRW_DIGEST' ORDER BY id DESC LIMIT 1")
        hard = psql("SELECT event_code FROM notification_event_policies WHERE optout_allowed = false ORDER BY event_code LIMIT 1")
        psql(f"INSERT INTO notifications (account_id, event_code, title, body) VALUES ('{aid}', '{hard}', '시험1599 끌 수 없음', '본문')")
        hid = psql(f"SELECT id FROM notifications WHERE account_id = '{aid}' AND title = '시험1599 끌 수 없음' ORDER BY id DESC LIMIT 1")
        psql(f"INSERT INTO notification_deliveries (notification_id, channel, status, idempotency_key) VALUES ({nid}, 'EMAIL', 'QUEUED', 't1599:{nid}'), ({gid}, 'EMAIL', 'QUEUED', 't1599:{gid}'), ({hid}, 'EMAIL', 'QUEUED', 't1599:{hid}')")
        st = psql(f"SELECT string_agg(notification_id || ':' || status || ':' || coalesce(split_part(failed_reason, ':', 1), ''), ',' ORDER BY notification_id) FROM notification_deliveries WHERE idempotency_key LIKE 't1599:%' AND notification_id IN ({nid}, {gid}, {hid})")
        want = ','.join(sorted([f'{nid}:FAILED:DIGEST', f'{gid}:QUEUED:', f'{hid}:QUEUED:'], key=lambda x: int(x.split(':')[0])))
        ok('② 메일 묶기 — 끌 수 있는 알림 메일 DIGEST 로 닫힘 · 요약 · 끌 수 없는 알림 메일은 그대로',
           st == want, f'{st} / {want}')
        offme = call('PUT', '/me/grw/digest', {'enabled': False}, TM)
        sa = call('GET', '/admin/grw/digest', None, TS)
        sm = call('GET', '/admin/grw/digest', None, TM)
        ok('② 끄기 · 운영 숫자 — 회원 끄기는 늘 됨 · 켠 회원 수 · 최근 7일 요약 ≥ 1 · 묶어 닫은 메일 ≥ 1 · 회원 403',
           offme.get('enabled') is False and isinstance(sa.get('members'), int) and sa.get('sends7', 0) >= 1 and sa.get('held7', 0) >= 1 and sm.get('_err') == 403,
           f"{offme} {sa.get('members')} {sa.get('sends7')} {sa.get('held7')} {sm.get('_err')}")
    finally:
        setting('grw.digest', old or 'off', '1599')
        psql(f"SET session_replication_role = replica; DELETE FROM notification_deliveries WHERE idempotency_key LIKE 't1599:%'; "
             f"DELETE FROM notifications WHERE account_id IN ('{aid}', '{aid2}'); DELETE FROM grw_digest_sends WHERE account_id IN ('{aid}', '{aid2}'); "
             f"DELETE FROM grw_digest_prefs WHERE account_id IN ('{aid}', '{aid2}');")

    if SITE:
        old2 = getset('grw.digest')
        setting('grw.digest', 'on', '1599s')
        em3, aid3, _ = mk_member('1599s')
        def run(b, seen, perr):
            ps = site_login(b, perr, em3)
            ps.goto(SITE + '/my/notifications', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1500)
            seen['box'] = ps.locator('[data-screen="SB-MYP-GRW-020"]').count()
            seen['state'] = ps.locator('[data-grw-digest]').first.get_attribute('data-grw-digest') if seen['box'] else ''
        try:
            r = ui(run)
        finally:
            setting('grw.digest', old2 or 'off', '1599s')
        if r:
            seen, perr = r
            ok('③ 사용자 웹 — 나의공간 › 알림 「하루 요약 받기」 상자(꺼짐)', seen.get('box') == 1 and seen.get('state') == 'off' and not perr, f'{seen} {perr[:2]}')
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
