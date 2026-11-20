"""v10.518 (D277 · docs/656) 기간 한정 추천 이벤트 — 대표 11/20 ㊼ ② · 「관리자가 이벤트 시행 전 확인 후 등록」
  ① (코드) D277 prx_ref_events(시행 전 확인 칸 · CHECK · 가드 트리거 · 하나만 진행) · 쌓기만 보상 기록 · fn_referral_reward(D190 그대로 + 이벤트 점수 · 1단계) · 스위치 prx.ref_event off · 메뉴 · 화면 PRX-020 · 문서 656
  ② (API · DB) 확인 칸 없이 시작 409 · DB 직접 ACTIVE 도 막힘 · ADMIN 은 시작 403 · 하나만 예면 409 · 둘 다 예 + 스위치 on 이면 시작 ·
     직접 추천 본인인증 → 이벤트 점수 · 예산 다 쓰면 일찍 끝(BUDGET) · 그 뒤 평소 점수 · 시작한 이벤트 고치기 409 · 보상 기록 못 고침 · 되돌림
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


def iso(dt):
    return dt.strftime('%Y-%m-%dT%H:%M:%S+00:00')


NOW = datetime.datetime.utcnow()
STAMP = int(time.time()) % 1000000
M77 = migr('D277_')
MN, AP, SCH, WK = rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')
PC = rd('src/modules/prx/prx.controller.ts')
RE = rd('src/modules/prx/refevent.ts')
fn = M77[M77.find('CREATE OR REPLACE FUNCTION public.fn_referral_reward'):]
fn = fn[:fn.find('END $$;')]
ok('① 코드 — 이벤트 표 · 시행 전 확인 CHECK · 가드(PRX_EVENT_CHECK) · 하나만 진행 · 보상 기록 쌓기만 · fn_referral_reward 직접 추천만(invitee → inviter) · 이벤트 점수 · BUDGET · 스위치 off · 안내 문구 틀 · 시작 SUPER · 메뉴 · 화면 PRX-020 · 문서 656 · 판 v10.518',
   'CREATE TABLE IF NOT EXISTS public.prx_ref_events' in M77 and 'ck_prx_ref_events_checked' in M77 and "'PRX_EVENT_CHECK: " in M77
   and 'ux_prx_ref_events_one_active' in M77 and 'trg_prx_ref_event_uses_ro' in M77 and "('prx.ref_event', 'off'" in M77
   and "WHERE invitee_id = p_invitee AND rewarded_at IS NULL FOR UPDATE" in fn and "v_ref.inviter_id, 'REFERRAL_DIRECT', v_points, true" in fn and "end_reason = 'BUDGET'" in fn
   and not re.search(r'inviter_id\s*=\s*v_ref\.inviter_id|WITH RECURSIVE', fn)
   and 'REF_EVENT_NOTICE_DEFAULT' in RE and '1단계만' in RE and "@Post('ref-events/:id/start')\n  @Roles('SUPER')" in PC
   and "['prx-refevent', '추천 이벤트']" in MN and '"SB-ADM-PRX-020"' in SJ and '시행 전 확인' in doc('656_') and VT >= (10, 518), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    rule0 = psql("SELECT is_active::text || '|' || points || '|' || coalesce(monthly_cap::text, '') FROM point_rules WHERE code = 'REFERRAL_DIRECT'")
    sw0 = getset('prx.ref_event')
    busy = psql("SELECT count(*) FROM prx_ref_events WHERE state = 'ACTIVE'")
    if busy != '0':
        print(f'  (진행 중인 추천 이벤트가 있음({busy}) — ② 건너뜀)')
    else:
        es, asf = mk_staff('1518s', 'ADMIN')
        accs = [mk_staff(f'1518{c}', None) for c in 'iabc']
        mine = [asf] + [a for _, a in accs]
        inviter = accs[0][1]
        eid = ''
        try:
            TA = login(es)
            psql("UPDATE point_rules SET is_active = true, points = 1000, monthly_cap = NULL WHERE code = 'REFERRAL_DIRECT'")
            setting('prx.ref_event', 'off', '1518')
            ev = {'title': f'시험1518-{STAMP}', 'startsAt': iso(NOW - datetime.timedelta(minutes=5)), 'endsAt': iso(NOW + datetime.timedelta(days=1)), 'points': 3000, 'budget': 6000}
            c = call('POST', '/admin/prx/ref-events', ev, TA)
            eid = str(c.get('id') or '')
            s0 = call('POST', f'/admin/prx/ref-events/{eid}/start', None, TS)
            dbx = psql(f"UPDATE prx_ref_events SET state = 'ACTIVE', started_at = now() WHERE id = {int(eid or 0)}")
            sa = call('POST', f'/admin/prx/ref-events/{eid}/start', None, TA)
            today = (NOW + datetime.timedelta(hours=9)).strftime('%Y-%m-%d')
            ck1 = call('PUT', f'/admin/prx/ref-events/{eid}/check', {'terms': True, 'notice': False, 'by': '법무 자문', 'on': today}, TA)
            s1 = call('POST', f'/admin/prx/ref-events/{eid}/start', None, TS)
            ck2 = call('PUT', f'/admin/prx/ref-events/{eid}/check', {'terms': True, 'notice': True, 'by': '법무 자문', 'on': today, 'memo': '시험'}, TA)
            s2 = call('POST', f'/admin/prx/ref-events/{eid}/start', None, TS)
            swa = call('PUT', '/admin/prx/ref-events/switch', {'on': True, 'reason': '시험 1518'}, TA)
            sw = call('PUT', '/admin/prx/ref-events/switch', {'on': True, 'reason': '시험 1518'}, TS)
            s3 = call('POST', f'/admin/prx/ref-events/{eid}/start', None, TS)
            ok('② 시행 전 확인 — 확인 없이 시작 409 PRX_EVENT_CHECK · DB 직접 ACTIVE 막힘 · 운영 관리자(ADMIN) 시작 403 · 하나만 예 409 · 둘 다 예 + 스위치 꺼짐 409 PRX_EVENT_SWITCH · 스위치 ADMIN 403 · SUPER 켜고 시작 됨',
               bool(eid) and s0.get('_err') == 409 and s0.get('code') == 'PRX_EVENT_CHECK' and '!' in dbx and 'PRX_EVENT_CHECK' in dbx and sa.get('_err') == 403
               and ck1.get('ready') is False and s1.get('code') == 'PRX_EVENT_CHECK' and ck2.get('ready') is True and s2.get('code') == 'PRX_EVENT_SWITCH'
               and swa.get('_err') == 403 and sw.get('switchOn') is True and s3.get('ok') is True,
               f"{c} {s0} {dbx[-80:]} {sa.get('_err')} {s1} {s2} {s3}")
            def verify(acc):
                psql(f"UPDATE accounts SET identity_verified_at = NULL WHERE id = '{acc}'")
                psql(f"INSERT INTO introducer_referrals (inviter_id, invitee_id) VALUES ('{inviter}', '{acc}') ON CONFLICT DO NOTHING")
                psql(f"UPDATE accounts SET identity_verified_at = now() WHERE id = '{acc}'")
                return psql(f"SELECT coalesce(max(points), 0) FROM point_ledger WHERE rule_code = 'REFERRAL_DIRECT' AND account_id = '{inviter}' AND memo = 'invitee {acc}'")
            p1, p2 = verify(accs[1][1]), verify(accs[2][1])
            st = psql(f"SELECT state || '|' || coalesce(end_reason, '') || '|' || used FROM prx_ref_events WHERE id = {int(eid)}")
            p3 = verify(accs[3][1])
            uses = psql(f"SELECT count(*) FROM prx_ref_event_uses WHERE event_id = {int(eid)}")
            ed = call('PUT', f'/admin/prx/ref-events/{eid}', ev, TS)
            ro = psql(f"UPDATE prx_ref_event_uses SET points = 1 WHERE event_id = {int(eid)}")
            two = psql(f"SELECT count(*) FROM point_ledger l WHERE l.rule_code = 'REFERRAL_DIRECT' AND l.account_id <> '{inviter}' AND l.memo IN ('invitee {accs[1][1]}', 'invitee {accs[2][1]}', 'invitee {accs[3][1]}')")
            ok('② 보상 — 직접 추천 본인인증 → 이벤트 3,000점 두 번 · 예산 6,000 다 써 일찍 끝(ENDED · BUDGET) · 그 뒤 평소 1,000점 · 보상 기록 2줄 · 추천한 사람 말고는 아무도 안 받음(1단계) · 끝난 이벤트 고치기 409 · 기록 못 고침',
               p1 == '3000' and p2 == '3000' and st == 'ENDED|BUDGET|6000' and p3 == '1000' and uses == '2' and two == '0'
               and ed.get('_err') == 409 and '!' in ro, f'{p1} {p2} {st} {p3} {uses} {two} {ed} {ro[-60:]}')
        finally:
            acc = ','.join(f"'{x}'" for x in mine if x)
            psql(f"SET session_replication_role = replica; DELETE FROM prx_ref_event_uses WHERE event_id = {int(eid or 0)}; DELETE FROM prx_ref_events WHERE id = {int(eid or 0)}; "
                 f"DELETE FROM point_ledger WHERE account_id IN ({acc}) AND rule_code = 'REFERRAL_DIRECT'; DELETE FROM introducer_referrals WHERE invitee_id IN ({acc}) OR inviter_id IN ({acc}); "
                 f"DELETE FROM ops_alerts WHERE alert_code = 'PRX_REF_EVENT_END' AND detail->>'event' = '{eid or 0}';")
            on, pts, cap = (rule0.split('|') + ['', '', ''])[:3]
            psql(f"UPDATE point_rules SET is_active = {on or 'false'}, points = {pts or 1000}, monthly_cap = {cap or 'NULL'} WHERE code = 'REFERRAL_DIRECT'")
            setting('prx.ref_event', sw0 or 'off', '1518 되돌림')
            rm_role(asf, '1518')
        ok('되돌림 — 보상 규칙 · 스위치 원래대로 · 시험 이벤트 남지 않음',
           psql("SELECT is_active::text || '|' || points || '|' || coalesce(monthly_cap::text, '') FROM point_rules WHERE code = 'REFERRAL_DIRECT'") == rule0
           and getset('prx.ref_event') == (sw0 or 'off') and psql(f"SELECT count(*) FROM prx_ref_events WHERE title LIKE '시험1518-{STAMP}%'") == '0', rule0)
    if ADMIN_WEB:
        r = admin_page('/#/prx-refevent', lambda pg, seen: seen.update(n=pg.locator('[data-prx-refevents]').count(), sw=pg.locator('[data-prx-switch]').get_attribute('data-prx-switch') if pg.locator('[data-prx-switch]').count() else None))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 제휴 › 추천 이벤트(스위치 표시 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('sw') in ('on', 'off') and not perr, f'{seen} {perr[:2]}')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
