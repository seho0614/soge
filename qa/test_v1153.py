"""v10.153 시험 — 오픈 날 사고 막는 서버 잠금 2개(D146 · docs/233 · 리허설 docs/228 발견 5 · 2)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1153.py

  ① 코드 — D146(설정 2개 처음 on · 형식 · 시험 기록 종류 PASS · NICE_TOKEN · 지우는 문장 없음 · 184) · 서버 잠금 · NICE 키 확인 API(SUPER · 감사) ·
     운영 화면(본인인증 · 관리자 스위치) · postcheck [10] · docs/233 · 판
  ② (API · 본인인증) 키 없이 NICE 키 확인 → 실패 기록(NOT_CONFIGURED · 밖으로 안 나감) · 가짜 키 3개 넣고 NICE → 422 IDENTITY_CHECK_FIRST ·
     8일 전 성공 · 스텁 성공은 근거 아님 · 7일 안 성공 → NICE 됨 · STUB 되돌리기는 언제나 · ADMIN 은 잠금 · 키 확인 403 · SUPER 가 잠금 끄면 키만 보고 됨 · 되돌림
  ③ (API · 세금계산서) 연동 TESTING 이어도 ETAX_URL · ETAX_KEY 없으면 간주 끄기 422 ETAX_CONFIG_FIRST · ADMIN 은 잠금 403 · SUPER 가 끄면 됨 · 되돌림
  ④ (운영 화면) 본인인증 「NICE 키 확인」 · 「NICE 바꾸기 전 키 확인」 줄 · 관리자 스위치 「간주 끄기 전 설정 확인」 줄
"""
import json, os, re, subprocess, urllib.error, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
D = rd('prisma/migrations/D146_switch_locks/migration.sql')
mig = sorted(x for x in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', x)))
ok('① D146 — 설정 identity.require_check · etax.require_config 처음 on · on/off 형식 · 시험 기록 PASS · NICE_TOKEN · 지우는 문장 없음 · 184 이상',
   "('identity.require_check', 'on'" in D and "('etax.require_config', 'on'" in D and D.count("'^(on|off)$'") == 2 and 'ON CONFLICT (key) DO NOTHING' in D
   and "integration_code IN ('PG', 'BANK', 'PASS')" in D and "'NICE_TOKEN'" in D
   and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE|UPDATE )\b', D) and len(mig) >= 184 and 'D146_switch_locks' in mig, f'{len(mig)} · {mig[-1]}')
AS = rd('src/modules/admin/admin.service.ts')
ok('① 서버 — NICE 바꿀 때 7일 안 키 확인(값 없으면 on) · 간주 끌 때 ETAX_URL · ETAX_KEY · 잠금 설정은 SUPER',
   "new PolicyViolation('IDENTITY_CHECK_FIRST'" in AS and "settingVal('identity.require_check', 'on')" in AS and 'IdentityVerifyService.lastCheckOk(this.db)' in AS
   and "new PolicyViolation('ETAX_CONFIG_FIRST'" in AS and "['ETAX_URL', 'ETAX_KEY']" in AS and "settingVal('etax.require_config', 'on')" in AS
   and "key === 'etax.require_config'" in AS.split('static isIntegSetting')[1].split('\n')[0], '')
IV = rd('src/modules/identity/identity-verify.service.ts'); IC = rd('src/modules/identity/identity-verify.controller.ts')
ok('① NICE 키 확인 — 토큰만(표준창 없음) · 보관 토큰 버림 · 기록 PASS · NICE_TOKEN · 7일 · 스텁 아님 · SUPER · 감사 INTEG_TEST_NICE',
   'async niceCheck()' in IV and 'resetNiceToken();' in IV and 'niceCryptoToken(newReqNo(), reqDtim())' in IV
   and "VALUES ('PASS', 'NICE_TOKEN'" in IV and "AND ok AND NOT stub AND created_at > now() - interval '7 days'" in IV
   and "@Post('admin/identity/nice-check')" in IC and "@Audit('INTEG_TEST_NICE', 'INTEGRATION')" in IC
   and IC.split("@Post('admin/identity/nice-check')")[1].split('niceCheck()')[0].count("@Roles('SUPER')") == 1, '')
IP = rd('web/src/app/admin/IdentityPanel.tsx'); SW = rd('web/src/app/admin/Switches.tsx')
ok('① 운영 화면 — 본인인증 키 확인 단추 · 잠금 줄 · 끌 때 확인 창 · 키 확인 없으면 NICE 단추 잠김 · 관리자 스위치 잠금 줄',
   "'/admin/identity/nice-check'" in IP and 'data-identity-nice-check' in IP and 'data-identity-require-check' in IP and 'window.confirm(' in IP.split('data-identity-require-check')[1]
   and "(st.keysMissing.length > 0 || needCheck)" in IP and 'data-etax-require-config' in SW and 'data-etax-require-flip' in SW and 'window.confirm(' in SW.split('data-etax-require-config')[1], '')
SP = json.loads(rd('spec/screens.json') or '{}')
ok('① 화면 명세에 새 API(POST /admin/identity/nice-check)', 'POST /admin/identity/nice-check' in json.dumps(SP, ensure_ascii=False), '')
PC = rd('deploy/aws/postcheck.sh')
ok('① postcheck [10] — 잠금 2개 on 확인(읽기만 · v10.154 부터 메일 잠금과 함께 3개)', "WHERE key IN ('identity.require_check', 'etax.require_config'" in PC and ('잠금 2개 on' in PC or '잠금 3개 on' in PC or '잠금 4개 on' in PC), '')
D233 = next((rd('docs/' + f) for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('233_')), '')
ok('① docs/233 — 발견 5 · 2 · 처음 on · SUPER · 오류 코드 · 되돌리는 쪽 언제나', all(x in D233 for x in ('IDENTITY_CHECK_FIRST', 'ETAX_CONFIG_FIRST', 'identity.require_check', 'etax.require_config', '발견 5', '발견 2', '되돌리는 쪽')), '')
ok('① 판 v10.153 이상', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 153), rd('VERSION').strip())


# ── ② ③ API ──────────────────────────────────────────────────────────
def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m)
    try:
        return json.load(urllib.request.urlopen(r, timeout=60))
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b'{}')
        except Exception:
            body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip()


KEYS = ('identity.provider', 'identity.require_check', 'assume.etax', 'etax.require_config')
NICE = ('NICE_CLIENT_ID', 'NICE_CLIENT_SECRET', 'NICE_PRODUCT_ID')
SELLER = 'seller@x.com'
TAG = 'v1153-test'
if API and DB:
    was = {k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'") for k in KEYS}
    etax0 = psql("SELECT status FROM integrations WHERE code = 'ETAX'")
    keys0 = psql("SELECT count(*) FROM integration_secrets WHERE integration_code = 'PASS'")
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW})['accessToken']
    psql(f"INSERT INTO account_roles(account_id, role) SELECT id, 'ADMIN' FROM accounts WHERE email = '{SELLER}' ON CONFLICT DO NOTHING;")
    TA = call('POST', '/auth/login', {'email': SELLER, 'password': PW})['accessToken']
    sv = lambda k, v, t=T_: call('PATCH', '/admin/site-settings', {'key': k, 'value': v}, t)
    get = lambda k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'")
    fake = lambda age, stub=False: psql(f"INSERT INTO integration_tests (integration_code, kind, ok, stub, detail, created_at) VALUES ('PASS', 'NICE_TOKEN', true, {str(stub).lower()}, '{TAG}', now() - interval '{age}') RETURNING 1")
    try:
        # ── ② 본인인증 ──
        ok('② 전제 — 점검판 NICE 키 없음 · STUB · 잠금 2개 on(처음 값)', keys0 == '0' and was['identity.provider'] in ('STUB', '') and was['identity.require_check'] == 'on' and was['etax.require_config'] == 'on', str(was))
        psql("DELETE FROM integration_tests WHERE integration_code = 'PASS'")
        c0 = call('POST', '/admin/identity/nice-check', {}, T_)
        last = psql("SELECT ok::text || ' ' || coalesce(error_kind, '') || ' ' || stub::text FROM integration_tests WHERE integration_code = 'PASS' AND kind = 'NICE_TOKEN' ORDER BY id DESC LIMIT 1")
        ok('② 키 없이 「NICE 키 확인」 → 실패(NOT_CONFIGURED) · 기록 남음 · 밖으로 안 나감', c0.get('ok') is False and c0.get('errorKind') == 'NOT_CONFIGURED' and last == 'false NOT_CONFIGURED false', f'{c0} · {last}')
        ok('② 운영(ADMIN)은 「NICE 키 확인」 403', call('POST', '/admin/identity/nice-check', {}, TA).get('_err') == 403, '')
        aud = psql("SELECT count(*) FROM audit.audit_logs WHERE action = 'INTEG_TEST_NICE' AND occurred_at > now() - interval '5 minutes'")
        ok('② 감사 기록 INTEG_TEST_NICE', aud not in ('', '0'), aud)
        put = [call('PUT', f'/admin/integration-keys/PASS/{n}', {'value': f'TEST1153{n[5:9]}abcdEFGH5678'}, T_) for n in NICE]
        ok('② 가짜 NICE 키 3개 넣음(점검판 · 밖으로 안 보냄)', all('_err' not in x for x in put), str([x.get('code') for x in put if '_err' in x]))
        r = sv('identity.provider', 'NICE')
        ok('② 키 확인 성공 없이 NICE → 422 IDENTITY_CHECK_FIRST · 그대로 STUB', r.get('_err') == 422 and r.get('code') == 'IDENTITY_CHECK_FIRST' and get('identity.provider') in ('STUB', ''), str(r)[:120])
        psql("DELETE FROM integration_tests WHERE integration_code = 'PASS'")   # 방금 남긴 NOT_CONFIGURED 줄(지금 시각)이 「마지막 확인」이 되지 않게
        fake('8 days')
        ok('② 8일 전 성공은 근거 아님(7일)', sv('identity.provider', 'NICE').get('code') == 'IDENTITY_CHECK_FIRST', '')
        fake('1 minute', stub=True)
        ok('② 스텁 성공은 근거 아님', sv('identity.provider', 'NICE').get('code') == 'IDENTITY_CHECK_FIRST', '')
        st = call('GET', '/admin/identity/status', t=T_)
        ok('② 상태 — 잠금 켜짐 · 7일 안 성공 없음 · 마지막 확인(스텁 성공 줄)', st.get('requireCheck') is True and st.get('lastCheckOkAt') is None and (st.get('lastCheck') or {}).get('ok') is True, str({k: st.get(k) for k in ('requireCheck', 'lastCheckOkAt')}))
        fake('1 minute')
        st = call('GET', '/admin/identity/status', t=T_)
        r = sv('identity.provider', 'NICE')
        ok('② 7일 안 성공 → NICE 로 바뀜 · 상태에 성공 시각', r.get('_err') is None and get('identity.provider') == 'NICE' and st.get('lastCheckOkAt'), str(r)[:100])
        ok('② STUB 되돌리기는 언제나', sv('identity.provider', 'STUB').get('_err') is None and get('identity.provider') == 'STUB', '')
        psql("DELETE FROM integration_tests WHERE integration_code = 'PASS'")
        ok('② 운영(ADMIN)은 잠금을 못 바꿈(403 INTEG_SETTING_SUPER)', sv('identity.require_check', 'off', TA).get('code') == 'INTEG_SETTING_SUPER' and get('identity.require_check') == 'on', '')
        ok('② 형식 오류(OFF) 거절', sv('identity.require_check', 'OFF').get('_err') in (400, 422) and get('identity.require_check') == 'on', '')
        r1 = sv('identity.require_check', 'off'); r2 = sv('identity.provider', 'NICE')
        ok('② SUPER 가 잠금 끔 → 키 3개만 보고 NICE 됨', r1.get('_err') is None and r2.get('_err') is None and get('identity.provider') == 'NICE', f'{r1} · {r2}'[:120])
        sv('identity.provider', 'STUB'); sv('identity.require_check', 'on')

        # ── ③ 세금계산서 ──
        ok('③ 전제 — 점검판 ETAX_URL · ETAX_KEY 없음(etax 상태 configured 거짓)', call('GET', '/admin/etax/status', t=T_).get('configured') is False, '')
        call('PATCH', '/admin/integrations/ETAX', {'status': 'TESTING'}, T_)
        r = sv('assume.etax', 'off')
        ok('③ 연동 TESTING 이어도 주소 · 키 없으면 간주 끄기 422 ETAX_CONFIG_FIRST · 그대로 on', r.get('_err') == 422 and r.get('code') == 'ETAX_CONFIG_FIRST' and get('assume.etax') == 'on'
           and 'ETAX_URL' in (r.get('message') or ''), str(r)[:140])
        ok('③ 운영(ADMIN)은 잠금을 못 바꿈(403 INTEG_SETTING_SUPER)', sv('etax.require_config', 'off', TA).get('code') == 'INTEG_SETTING_SUPER' and get('etax.require_config') == 'on', '')
        r1 = sv('etax.require_config', 'off'); r2 = sv('assume.etax', 'off')
        ok('③ SUPER 가 잠금 끔 → 연동 상태만 보고 간주 꺼짐', r1.get('_err') is None and r2.get('_err') is None and get('assume.etax') == 'off', f'{r1} · {r2}'[:120])
        ok('③ 간주 다시 켜기는 언제나', sv('assume.etax', 'on').get('_err') is None and get('assume.etax') == 'on', '')
    finally:
        for k, v in was.items():
            psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}';")
        for n in NICE:
            call('DELETE', f'/admin/integration-keys/PASS/{n}', None, T_)
        psql("DELETE FROM integration_tests WHERE integration_code = 'PASS'")
        if etax0: call('PATCH', '/admin/integrations/ETAX', {'status': etax0}, T_)
        psql(f"DELETE FROM account_roles WHERE role = 'ADMIN' AND account_id = (SELECT id FROM accounts WHERE email = '{SELLER}');")
    left = psql("SELECT count(*) FROM integration_secrets WHERE integration_code = 'PASS'")
    ok('②③ 되돌림 — 설정 4개 · 가짜 키 지움 · 시험 기록 지움 · ETAX 상태', all(get(k) == v for k, v in was.items()) and left == '0'
       and psql("SELECT status FROM integrations WHERE code = 'ETAX'") == etax0, f'{was} · 키 {left} · ETAX {etax0}')

# ── ④ 운영 화면 ───────────────────────────────────────────────────────
if ADMIN_WEB:
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if sync_playwright:
        with sync_playwright() as p:
            b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1400, 'height': 1000})
            pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
            pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(1500)
            pg.goto(ADMIN_WEB + '/#/integrations', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
            box = pg.locator('[data-identity-panel]')
            chk = box.locator('[data-identity-check]'); req = box.locator('[data-identity-require-check]')
            nice = box.locator('[data-identity-set="NICE"]')
            ok('④ 본인인증 — 「NICE 키 확인」 단추 · 「NICE 바꾸기 전 키 확인」 켜짐 · NICE 단추 잠김',
               chk.count() == 1 and chk.locator('[data-identity-nice-check]').count() == 1 and req.count() == 1 and req.get_attribute('data-identity-require-check') == 'on'
               and nice.count() == 1 and nice.is_disabled(), (req.inner_text()[:80] if req.count() else '없음'))
            if box.count(): req.scroll_into_view_if_needed()
            pg.screenshot(path=os.path.join(HERE, 'v1153_identity_lock.png'), full_page=False)
            pg.goto(ADMIN_WEB + '/#/checklist', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
            row = pg.locator('[data-etax-require-config]')
            ok('④ 관리자 스위치 — 「간주 끄기 전 설정 확인」 켜짐 · 단추', row.count() == 1 and row.get_attribute('data-etax-require-config') == 'on' and row.locator('[data-etax-require-flip]').count() == 1,
               row.inner_text()[:80] if row.count() else '없음')
            if row.count(): row.scroll_into_view_if_needed()
            pg.screenshot(path=os.path.join(HERE, 'v1153_etax_lock.png'), full_page=False)
            b.close()

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
