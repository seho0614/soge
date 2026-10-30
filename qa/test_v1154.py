"""v10.154 시험 — 메일 켜기 전 시험 메일 확인 잠금(D147 · docs/234 · 리허설 docs/228 발견 4) · realcheck [9] 운영 적용과 같은 빌드

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1154.py

  ① 코드 — D147(설정 처음 on · 형식 · 시험 기록 종류 MAIL · MAIL_TEST · 지우는 문장 없음 · 185) · 서버 잠금 · 시험 메일 기록(받는 주소 가림) ·
     운영 화면(메일) · postcheck [10] 잠금 3개 · realcheck [9](sh · ps1) · docs/234 · 판
  ② (API) 설정 없이 메일 켜기 → 422 MAIL_CONFIG_FIRST · 시험 메일은 설정 없으면 422(기록 안 남음) · 가짜 SMTP 키 · 보내는 주소를 넣고(밖으로 안 보냄)
     → 422 MAIL_TEST_FIRST · 8일 전 · 스텁 · 실패 줄은 근거 아님 · 7일 안 성공 → 켜짐 · 끄기는 언제나 · ADMIN 은 잠금 403 · 형식 오류 · SUPER 가 끄면 그대로 켜짐 · 되돌림
  ③ (운영 화면) 메일 — 「마지막 시험 메일」 줄 · 「메일 켜기 전 시험 메일 확인」 켜짐 · 단추
"""
import json, os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel, base=None):
    p = os.path.join(base or K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
D = rd('prisma/migrations/D147_mail_lock/migration.sql')
mig = sorted(x for x in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', x)))
ok('① D147 — 설정 notify.require_mail_test 처음 on · on/off 형식 · 시험 기록 MAIL · MAIL_TEST(앞 종류 그대로) · 지우는 문장 없음 · 185 이상',
   "('notify.require_mail_test', 'on'" in D and D.count("'^(on|off)$'") == 1 and 'ON CONFLICT (key) DO NOTHING' in D
   and "integration_code IN ('PG', 'BANK', 'PASS', 'MAIL')" in D and "kind IN ('PG_KEY', 'BANK_SEND', 'BANK_CONFIRM', 'NICE_TOKEN', 'MAIL_TEST')" in D
   and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE|UPDATE )\b', D) and len(mig) >= 185 and 'D147_mail_lock' in mig, f'{len(mig)} · {mig[-1]}')
AS = rd('src/modules/admin/admin.service.ts')
blk = AS.split("if (key === 'notify.email_verified' && v === 'on'")[1].split("if (key === 'alimtalk.provider')")[0] if "if (key === 'notify.email_verified' && v === 'on'" in AS else ''
ok('① 서버 — 메일 켤 때만(값 없으면 on) 설정 빠짐 → MAIL_CONFIG_FIRST · 7일 안 시험 성공 없음 → MAIL_TEST_FIRST · 잠금 설정은 SUPER',
   "settingVal('notify.require_mail_test', 'on')" in AS and "new PolicyViolation('MAIL_CONFIG_FIRST'" in blk and "new PolicyViolation('MAIL_TEST_FIRST'" in blk
   and 'MailAdminService.missing(this.db)' in blk and 'MailAdminService.lastTestOk(this.db)' in blk
   and "key === 'notify.require_mail_test'" in AS.split('static isIntegSetting')[1].split('\n')[0], '')
MS = rd('src/common/mail/mail-admin.service.ts')
ok('① 시험 메일 기록 — MAIL · MAIL_TEST · 받는 주소는 maskMail · 7일 · 스텁 아님 · 빠진 설정(SMTP_USER · SMTP_PASS · 보내는 주소)',
   "VALUES ('MAIL', 'MAIL_TEST'" in MS and '`${maskMail(addr)}' in MS and "AND ok AND NOT stub AND created_at > now() - interval '7 days'" in MS
   and "miss.push('SMTP_USER')" in MS and "miss.push('SMTP_PASS')" in MS and "notify.mail_from" in MS.split('static async missing')[1], '')
MC = rd('src/modules/site/mail-admin.controller.ts')
ok('① 상태 DTO — requireTest · lastTestOkAt · lastTest · MailLastTestDto 를 MailStatusDto 보다 먼저(ts-node)',
   0 < MC.find('export class MailLastTestDto') < MC.find('export class MailStatusDto') and 'requireTest!: boolean' in MC and 'lastTest!: MailLastTestDto | null' in MC, '')
MP = rd('web/src/app/admin/MailPanel.tsx')
ok('① 운영 화면 — 마지막 시험 메일 줄 · 잠금 줄 · SUPER 단추 · 끌 때 확인 창',
   'data-mail-check' in MP and 'data-mail-require-test' in MP and 'data-mail-require-flip' in MP and "key: 'notify.require_mail_test'" in MP
   and 'window.confirm(' in MP.split('async function flipRequire')[1].split('if (err)')[0] and '{isSuper && <>' in MP.split('data-mail-require-test')[1], '')
PC = rd('deploy/aws/postcheck.sh')
ok('① postcheck [10] — 잠금 3개 on(읽기만)', "'identity.require_check', 'etax.require_config', 'notify.require_mail_test'" in PC and '잠금 3개 on' in PC
   and 'etax.require_config=on · identity.require_check=on · notify.require_mail_test=on' in PC, '')
RS = rd('docker/realcheck.sh', KIT); RP = rd('docker/realcheck.ps1', KIT)
ok('① realcheck [9] — 컨테이너 안 API tsc · 운영 화면 tsc -b && vite build(sh · ps1 같음)',
   '[9] 운영 적용과 같은 빌드' in RS and "api 'npx tsc -p tsconfig.json --noEmit'" in RS and "web 'npx tsc -b && npx vite build" in RS
   and '[9] 운영 적용과 같은 빌드' in RP and '"api" "npx tsc -p tsconfig.json --noEmit"' in RP and '"web" "npx tsc -b && npx vite build' in RP
   and RS.find('[9] 운영') < RS.rfind('\nfinish') and RP.find('[9] 운영') < RP.rfind('\nFinish'), '')
D234 = next((rd('docs/' + f) for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('234_')), '')
ok('① docs/234 — 발견 4 · 처음 on · SUPER · 오류 코드 · 끄기는 언제나 · realcheck [9]', all(x in D234 for x in ('MAIL_CONFIG_FIRST', 'MAIL_TEST_FIRST', 'notify.require_mail_test', '발견 4', '메일 끄기는 언제나', '[9]')), '')
ok('① 판 v10.154 이상', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 154), rd('VERSION').strip())


# ── ② API ────────────────────────────────────────────────────────────
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


KEYS = ('notify.email_verified', 'notify.require_mail_test', 'notify.mail_from')
SMTP = ('SMTP_USER', 'SMTP_PASS')
SELLER = 'seller@x.com'
TAG = 'v1154-test'
if API and DB:
    was = {k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'") for k in KEYS}
    keys0 = psql("SELECT count(*) FROM integration_secrets WHERE integration_code = 'MAIL'")
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW})['accessToken']
    psql(f"INSERT INTO account_roles(account_id, role) SELECT id, 'ADMIN' FROM accounts WHERE email = '{SELLER}' ON CONFLICT DO NOTHING;")
    TA = call('POST', '/auth/login', {'email': SELLER, 'password': PW})['accessToken']
    sv = lambda k, v, t=T_: call('PATCH', '/admin/site-settings', {'key': k, 'value': v}, t)
    get = lambda k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'")
    fake = lambda age, ok_=True, stub=False: psql(f"INSERT INTO integration_tests (integration_code, kind, ok, stub, detail, created_at) VALUES ('MAIL', 'MAIL_TEST', {str(ok_).lower()}, {str(stub).lower()}, '{TAG}', now() - interval '{age}') RETURNING 1")
    try:
        st0 = call('GET', '/admin/mail/status', t=T_)
        ok('② 전제 — 점검판 SMTP 키 없음 · 메일 꺼짐 · 잠금 on(처음 값) · 상태에 requireTest',
           keys0 == '0' and st0.get('user', {}).get('set') is False and was['notify.email_verified'] in ('off', '') and was['notify.require_mail_test'] == 'on'
           and st0.get('requireTest') is True and st0.get('lastTestOkAt') is None, str({k: st0.get(k) for k in ('configured', 'requireTest', 'lastTestOkAt')}))
        psql("DELETE FROM integration_tests WHERE integration_code = 'MAIL'")
        r = sv('notify.email_verified', 'on')
        ok('② 설정 없이 메일 켜기 → 422 MAIL_CONFIG_FIRST(빠진 이름) · 그대로 꺼짐', r.get('_err') == 422 and r.get('code') == 'MAIL_CONFIG_FIRST' and 'SMTP_USER' in (r.get('message') or '')
           and get('notify.email_verified') in ('off', ''), str(r)[:140])
        t0 = call('POST', '/admin/mail/test', {'to': 'qa@example.com'}, T_)
        ok('② 설정 없이 시험 메일 → 422 MAIL_NOT_CONFIGURED · 기록 안 남음', t0.get('_err') == 422 and t0.get('code') == 'MAIL_NOT_CONFIGURED'
           and psql("SELECT count(*) FROM integration_tests WHERE integration_code = 'MAIL'") == '0', str(t0)[:100])
        FAKE = {'SMTP_USER': 'TEST1154USERABCD5678', 'SMTP_PASS': 'TEST1154passABCDefgh5678xyz='}   # SES 형식(D136) 모양만 · 시험 메일은 보내지 않음
        put = [call('PUT', f'/admin/integration-keys/MAIL/{n}', {'value': FAKE[n]}, T_) for n in SMTP]
        psql("UPDATE site_settings SET value = 'no-reply@mail.sogaebank.com' WHERE key = 'notify.mail_from'")
        st1 = call('GET', '/admin/mail/status', t=T_)
        ok('② 가짜 SMTP 키 2개 · 보내는 주소 넣음(점검판 · 시험 메일은 보내지 않음) → 설정 다 있음', all('_err' not in x for x in put) and st1.get('configured') is True,
           str([x.get('code') for x in put if '_err' in x]) + f" · configured {st1.get('configured')}")
        r = sv('notify.email_verified', 'on')
        ok('② 시험 메일 성공 없이 켜기 → 422 MAIL_TEST_FIRST · 그대로 꺼짐', r.get('_err') == 422 and r.get('code') == 'MAIL_TEST_FIRST' and get('notify.email_verified') in ('off', ''), str(r)[:120])
        fake('8 days')
        ok('② 8일 전 성공은 근거 아님(7일)', sv('notify.email_verified', 'on').get('code') == 'MAIL_TEST_FIRST', '')
        fake('2 minutes', stub=True)
        ok('② 스텁 성공은 근거 아님', sv('notify.email_verified', 'on').get('code') == 'MAIL_TEST_FIRST', '')
        fake('1 minute', ok_=False)
        st = call('GET', '/admin/mail/status', t=T_)
        ok('② 실패 줄은 근거 아님 · 상태 — 마지막 시험(실패) · 7일 안 성공 없음', sv('notify.email_verified', 'on').get('code') == 'MAIL_TEST_FIRST'
           and (st.get('lastTest') or {}).get('ok') is False and st.get('lastTestOkAt') is None, str({k: st.get(k) for k in ('lastTestOkAt',)}))
        fake('30 seconds')
        r = sv('notify.email_verified', 'on'); st = call('GET', '/admin/mail/status', t=T_)
        ok('② 7일 안 성공 → 메일 켜짐 · 상태에 성공 시각', r.get('_err') is None and get('notify.email_verified') == 'on' and st.get('lastTestOkAt'), str(r)[:100])
        ok('② 메일 끄기는 언제나', sv('notify.email_verified', 'off').get('_err') is None and get('notify.email_verified') == 'off', '')
        psql("DELETE FROM integration_tests WHERE integration_code = 'MAIL'")
        ok('② 운영(ADMIN)은 잠금을 못 바꿈(403 INTEG_SETTING_SUPER)', sv('notify.require_mail_test', 'off', TA).get('code') == 'INTEG_SETTING_SUPER' and get('notify.require_mail_test') == 'on', '')
        ok('② 운영(ADMIN)이 켜도 잠금은 같음(422 MAIL_TEST_FIRST)', sv('notify.email_verified', 'on', TA).get('code') == 'MAIL_TEST_FIRST', '')
        ok('② 형식 오류(OFF) 거절', sv('notify.require_mail_test', 'OFF').get('_err') in (400, 422) and get('notify.require_mail_test') == 'on', '')
        for n in SMTP:
            call('DELETE', f'/admin/integration-keys/MAIL/{n}', None, T_)
        r1 = sv('notify.require_mail_test', 'off'); r2 = sv('notify.email_verified', 'on')
        ok('② SUPER 가 잠금 끔 → 설정 · 시험 없이도 그대로 켜짐(전과 같음)', r1.get('_err') is None and r2.get('_err') is None and get('notify.email_verified') == 'on', f'{r1} · {r2}'[:120])
        sv('notify.email_verified', 'off'); sv('notify.require_mail_test', 'on')
    finally:
        for k, v in was.items():
            psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}';")
        for n in SMTP:
            call('DELETE', f'/admin/integration-keys/MAIL/{n}', None, T_)
        psql("DELETE FROM integration_tests WHERE integration_code = 'MAIL'")
        psql(f"DELETE FROM account_roles WHERE role = 'ADMIN' AND account_id = (SELECT id FROM accounts WHERE email = '{SELLER}');")
    left = psql("SELECT count(*) FROM integration_secrets WHERE integration_code = 'MAIL'")
    ok('② 되돌림 — 설정 3개 · 가짜 키 지움 · 시험 기록 지움', all(get(k) == v for k, v in was.items()) and left == keys0
       and psql("SELECT count(*) FROM integration_tests WHERE integration_code = 'MAIL'") == '0', f'{was} · 키 {left}')

# ── ③ 운영 화면 ───────────────────────────────────────────────────────
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
            box = pg.locator('[data-mail-panel]')
            chk = box.locator('[data-mail-check]'); req = box.locator('[data-mail-require-test]')
            ok('③ 메일 — 「마지막 시험 메일」 줄(7일 안 성공 없음) · 「메일 켜기 전 시험 메일 확인」 켜짐 · 단추',
               chk.count() == 1 and chk.get_attribute('data-mail-check') == 'none' and req.count() == 1 and req.get_attribute('data-mail-require-test') == 'on'
               and req.locator('[data-mail-require-flip]').count() == 1, (req.inner_text()[:80] if req.count() else '없음'))
            if req.count(): req.scroll_into_view_if_needed()
            pg.screenshot(path=os.path.join(HERE, 'v1154_mail_lock.png'), full_page=False)
            b.close()

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
