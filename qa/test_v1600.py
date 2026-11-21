"""v10.600 (docs/742) 16차 회원 · 성장 ⑯ 여러 단계 추천 보상 — 처음 off · 법무 확인 필요(방문판매법 다단계판매 해당 여부 · 11/9 확인은 1단계 기준)
  ① (코드) REFERRAL_TIER 꺼짐 · 고유 · 현금화 안 됨 가드 · 직접 보상 뒤 따라 붙음 · D189 칸 · fn_referral_reward 안 고침 · 설정 off · 법무 조건 · 문서 742
  ② (API · DB) A ← B ← C ← D ← E · 꺼진 채 직접만 · 법무 없이 422 · 켠 채 2 · 3단계 · A 없음 · 다시 인증 그대로 · 직접 넣기 · 현금화 막힘 · 기록 못 고침 · 법무 끄면 보상 꺼짐
  ③ (화면) 운영 여러 단계 추천 보상 칸
  (두 번 돌아도 통과 — 시험 계정은 매번 새 이메일 · 관계 · 포인트 · 보상 기록은 replica 로 지움 · 보상 규칙 · 설정 되돌림)
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

M = mig_with('grw_tier_rewards')
MS = re.sub(r'/\*.*?\*/', '', M, flags=re.S)
D742 = doc('742_')
ok('① 코드 — 보상 규칙 REFERRAL_TIER 꺼짐 · 고유(가입한 사람 · 단계) · 현금화 안 됨 가드 · 직접 보상 뒤 따라 붙음(설정 둘 다 on) · D189 칸 안 더함 · fn_referral_reward 다시 안 씀 · 설정 처음 off · 서버 법무 조건 · 화면 GRW-050 · 문서 742 「법무 확인 필요」 · 「다단계」 · 판 v10.600',
   "VALUES ('REFERRAL_TIER'," in M and "300, false, NULL, false, 10)" in M and 'CONSTRAINT uq_grw_tier_rewards UNIQUE (invitee_id, level)' in M
   and 'trg_grw_tier_guard BEFORE INSERT ON public.point_ledger' in M and 'OR NEW.redeemable THEN' in M
   and "AFTER INSERT ON public.point_ledger\n  FOR EACH ROW WHEN (NEW.rule_code = 'REFERRAL_DIRECT')" in M
   and "key = 'grw.tier_reward'), 'off') <> 'on'" in M and "key = 'grw.tier_legal_ok'), 'off') <> 'on'" in M
   and not re.search(r'ALTER TABLE public\.introducer_referrals', MS) and 'FUNCTION public.fn_referral_reward(' not in MS
   and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE)\b', MS)
   and "('grw.tier_reward', 'off', 'ADMIN'" in M and "('grw.tier_legal_ok', 'off', 'ADMIN'" in M and "('grw.tier_points', '300', 'ADMIN'" in M
   and "'GRW_TIER_LEGAL'" in GRW['common'] and 'TIER_LEGAL_NOTE' in GRW['tier'] and 'SB-ADM-GRW-050' in GW
   and '법무 확인 필요' in D742 and '다단계' in D742 and '1단계' in D742 and VT >= (10, 600), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    tag = f't1600x{STAMP}'
    h = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    ids = {}
    for k in 'ABCDE':
        psql(f"INSERT INTO accounts (email, name, password_hash) VALUES ('{tag}{k.lower()}@x.com', '시험{k}', '{h}') ON CONFLICT DO NOTHING")
        ids[k] = psql(f"SELECT id FROM accounts WHERE email = '{tag}{k.lower()}@x.com'")
    acc = ', '.join(f"'{v}'" for v in ids.values())
    CLEAN = (f"SET session_replication_role = replica; DELETE FROM grw_tier_rewards WHERE invitee_id IN ({acc}) OR beneficiary_id IN ({acc}); "
             f"DELETE FROM point_ledger WHERE account_id IN ({acc}); DELETE FROM introducer_referrals WHERE invitee_id IN ({acc}) OR inviter_id IN ({acc}); "
             f"DELETE FROM recommend_changes WHERE invitee_id IN ({acc});")   # 시험 계정은 다른 시험처럼 남김(매번 새 이메일)
    rule0 = psql("SELECT is_active::text || '|' || points || '|' || coalesce(monthly_cap::text, '') FROM point_rules WHERE code = 'REFERRAL_DIRECT'")
    trule0 = psql("SELECT is_active::text || '|' || coalesce(monthly_cap::text, '') FROM point_rules WHERE code = 'REFERRAL_TIER'")
    old = {k: getset(k) for k in ('grw.tier_reward', 'grw.tier_legal_ok', 'grw.tier_points', 'prx.ref_event')}
    try:
        # A ← B ← C ← D ← E (A 가 B 를 추천 …)
        for up, down in (('A', 'B'), ('B', 'C'), ('C', 'D'), ('D', 'E')):
            psql(f"INSERT INTO introducer_referrals (inviter_id, invitee_id) VALUES ('{ids[up]}', '{ids[down]}')")
        setting('prx.ref_event', 'off', '1600')
        psql("UPDATE point_rules SET is_active = true, points = 1000, monthly_cap = NULL WHERE code = 'REFERRAL_DIRECT'")
        setting('grw.tier_reward', 'off', '1600'); setting('grw.tier_legal_ok', 'off', '1600'); setting('grw.tier_points', '300,100', '1600')
        psql(f"UPDATE accounts SET identity_verified_at = now() WHERE id = '{ids['D']}'")   # 꺼진 채 — C 만 직접 보상
        off_rows = psql(f"SELECT string_agg(rule_code || ':' || points, ',' ORDER BY id) FROM point_ledger WHERE account_id IN ({acc}) AND rule_code LIKE 'REFERRAL%'")
        nolegal = call('PUT', '/admin/grw/settings', {'tierReward': True, 'reason': '시험 1600 법무 없이'}, TS)
        on = call('PUT', '/admin/grw/settings', {'tierLegalOk': True, 'tierReward': True, 'tierPoints': '300,100', 'reason': '시험 1600 — 법무 확인 끝(시험)'}, TS)
        psql(f"UPDATE accounts SET identity_verified_at = now() WHERE id = '{ids['E']}'")   # 켠 채 — D 직접 · C 2단계 300 · B 3단계 100 · A 없음
        rows = {k: psql(f"SELECT coalesce(string_agg(rule_code || ':' || points || ':' || redeemable::text, ',' ORDER BY id), '') FROM point_ledger WHERE account_id = '{ids[k]}' AND rule_code LIKE 'REFERRAL%'") for k in 'ABCD'}
        tr = psql(f"SELECT string_agg(level || ':' || points, ',' ORDER BY level) FROM grw_tier_rewards WHERE invitee_id = '{ids['E']}'")
        psql(f"UPDATE accounts SET identity_verified_at = NULL WHERE id = '{ids['E']}'; UPDATE accounts SET identity_verified_at = now() WHERE id = '{ids['E']}'")
        tr2 = psql(f"SELECT count(*) FROM grw_tier_rewards WHERE invitee_id = '{ids['E']}'")
        direct = psql(f"INSERT INTO point_ledger (account_id, rule_code, points) VALUES ('{ids['A']}', 'REFERRAL_TIER', 5)")
        cash = psql(f"BEGIN; SELECT set_config('sgb.grw_tier', 'x|{ids['A']}', true); INSERT INTO point_ledger (account_id, rule_code, points, redeemable) VALUES ('{ids['A']}', 'REFERRAL_TIER', 5, true); ROLLBACK;")
        ro = psql(f"UPDATE grw_tier_rewards SET points = 1 WHERE invitee_id = '{ids['E']}'")
        tv = call('GET', '/admin/grw/tier', None, TS)
        ok('② 꺼진 채 — D 인증 → C 직접 보상만 · 여러 단계 줄 없음 · 법무 표시 없이 켜기 422 GRW_TIER_LEGAL',
           off_rows == 'REFERRAL_DIRECT:1000' and nolegal.get('_err') == 422 and nolegal.get('code') == 'GRW_TIER_LEGAL', f'{off_rows} {nolegal}')
        ok('② 켠 채 — E 인증 → D 직접 · C 2단계 300 · B 3단계 100(현금화 안 됨) · A 없음 · 다시 인증해도 그대로 · 직접 넣기 · 현금화 줄 막힘 · 기록 못 고침 · 운영 보기',
           on.get('ok') is True and on.get('settings', {}).get('tierReward') is True
           and rows['D'] == 'REFERRAL_DIRECT:1000:true' and rows['C'] == 'REFERRAL_DIRECT:1000:true,REFERRAL_TIER:300:false'
           and rows['B'] == 'REFERRAL_TIER:100:false' and rows['A'] == '' and tr == '2:300,3:100' and tr2 == '2'
           and direct.startswith('!') and 'GRW_TIER' in direct and '\n!' in '\n' + cash and 'GRW_TIER' in cash and ro.startswith('!')
           and tv.get('totals', {}).get('rewards', 0) >= 2 and '법무 확인' in (tv.get('legal') or ''),
           f"{rows} {tr} {tr2} {direct[-50:]} {cash[-40:]} {ro[-40:]}")
        legal_off = call('PUT', '/admin/grw/settings', {'tierLegalOk': False, 'reason': '시험 1600 법무 끔'}, TS)
        ok('② 법무 확인을 끄면 보상도 꺼짐', legal_off.get('settings', {}).get('tierReward') is False and legal_off.get('settings', {}).get('tierLegalOk') is False, str(legal_off.get('settings')))
    finally:
        psql(f"UPDATE point_rules SET is_active = {rule0.split('|')[0] or 'false'}, points = {rule0.split('|')[1] or 1000}, monthly_cap = {rule0.split('|')[2] or 'NULL'} WHERE code = 'REFERRAL_DIRECT'")
        psql(f"UPDATE point_rules SET is_active = {trule0.split('|')[0] or 'false'}, monthly_cap = {trule0.split('|')[1] or 'NULL'} WHERE code = 'REFERRAL_TIER'")
        setting('grw.tier_reward', old['grw.tier_reward'] or 'off', '1600')
        setting('grw.tier_legal_ok', old['grw.tier_legal_ok'] or 'off', '1600')
        setting('grw.tier_points', old['grw.tier_points'] or '300', '1600')
        setting('prx.ref_event', old['prx.ref_event'] or 'off', '1600')
        psql(CLEAN)
    ok('되돌림 — 보상 규칙 · 설정 처음 값 · 시험 관계 · 포인트 · 보상 기록 지움',
       psql("SELECT is_active::text || '|' || points || '|' || coalesce(monthly_cap::text, '') FROM point_rules WHERE code = 'REFERRAL_DIRECT'") == rule0
       and getset('grw.tier_reward') == (old['grw.tier_reward'] or 'off') and psql(f"SELECT count(*) FROM grw_tier_rewards WHERE invitee_id IN ({acc}) OR beneficiary_id IN ({acc})") == '0', rule0)

    if ADMIN_WEB:
        def look(pg, seen):
            pg.click('[data-grw-part="tier"]'); pg.wait_for_timeout(2000)
            seen['legal'] = pg.locator('[data-grw-tier-legal]').count()
            seen['state'] = pg.locator('[data-grw-tier]').first.get_attribute('data-grw-tier') if pg.locator('[data-grw-tier]').count() else ''
        r = admin_page('/#/grw-ops', look)
        if r:
            seen, perr = r
            ok('③ 운영 화면 — 여러 단계 추천 보상 칸 · 법무 확인 안내 줄 · 꺼짐', seen.get('legal') == 1 and seen.get('state') == 'off' and not perr, f'{seen} {perr[:2]}')
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
