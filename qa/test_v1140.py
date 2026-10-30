"""v10.140 시험 — 메일 운영 화면(D136 · docs/211 · 설계 docs/210 · 절차서 docs/167 v1.3)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1140.py

  ① 코드 — D136(연동 키 SMTP_USER · 형식 · 시험 하루 횟수 · 지우는 문장 없음 · 174) · 주소 기본값(서울 SES) · 준비 여부 · 운영 API 4개(권한) ·
     시험 메일은 스위치와 따로 · 주소 가림 · 화면 목록 연결 · 운영 화면 「메일」 · 절차서 v1.3 · 판
  ② (API) 상태(값 없이) · 권한(일반 회원 403 · ADMIN 은 보기만) · 사용자 이름 형식 · 연동 키로 넣으면 「운영 화면」 · 설정 없으면 시험 422 ·
     주소 형식 422 · 하루 횟수 0 이면 422(보내지 않음) · 발송 기록(실패 줄 주소 가림) · 연결 확인 응답 모양 — 끝나면 되돌림
     ※ 실제 SES 로 메일을 보내는 시험은 하지 않음(가짜 자격 증명으로 바깥에 로그인하지 않음)
  ③ (운영 화면) 외부 연동 › 「메일」 다섯 줄 · 연결 확인 · 시험 메일 단추(SUPER)
"""
import json, os, re, subprocess, urllib.error, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
D = rd('prisma/migrations/D136_mail_admin/migration.sql'); D128 = rd('prisma/migrations/D128_integ_keys_admin/migration.sql')
mig = sorted(x for x in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', x)))
fn = lambda s: re.sub(r"\n  ELSIF p_name = 'SMTP_USER' THEN[\s\S]*?END IF;", '', (re.search(r'CREATE OR REPLACE FUNCTION public\.fn_integ_secret_set[\s\S]*?END \$function\$;', s) or [''])[0], count=1)
ok('① D136 — 연동 키 SMTP_USER · 형식(영문 대문자 · 숫자) · 함수는 D128 그대로 + 한 칸 · 시험 하루 횟수 20 · 지우는 문장 없음 · 174',
   "('MAIL','SMTP_USER')" in D and "p_name = 'SMTP_USER'" in D and "'^[A-Z0-9]{16,128}$'" in D and fn(D) == fn(D128) and fn(D)
   and "('notify.mail_test_daily', '20'" in D and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE)\b', D) and (len(mig), mig[-1]) in ((174, 'D136_mail_admin'), (175, 'D137_identity_nice'), (176, 'D138_alimtalk'), (177, 'D139_esign'), (178, 'D140_integ_tests'), (179, 'D141_safenum'), (180, 'D142_open_ready'), (181, 'D143_files_move'), (182, 'D144_open_date'), (183, 'D145_agent_privacy_gate'), (184, 'D146_switch_locks')), f'{len(mig)} · {mig[-1]}')
SS = rd('src/common/integration/secret.service.ts'); MS = rd('src/common/mail/mail.service.ts')
ok('① 연동 키 목록에 SMTP 사용자 이름(SMTP_USER 로 얹음) · 주소 기본값 서울 SES · 준비 여부는 사용자 이름 · 비밀번호로',
   "name: 'SMTP_USER', label: 'SMTP 사용자 이름', env: 'SMTP_USER'" in SS and "export const SES_SEOUL_HOST = 'email-smtp.ap-northeast-2.amazonaws.com';" in MS
   and 'env.SMTP_HOST?.trim() || SES_SEOUL_HOST' in MS and 'if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return false;' in MS, '')
AS = rd('src/common/mail/mail-admin.service.ts'); AC = rd('src/modules/site/mail-admin.controller.ts')
routes = re.findall(r"@(Get|Post)\('([^']+)'\)\n  @Roles\(([^)]*)\)", AC)
ok('① 운영 API 4개 — 보기(상태 · 기록) ADMIN · SUPER / 연결 확인 · 시험 SUPER · 시험은 감사 MAIL_TEST',
   sorted(routes) == sorted([('Get', 'status', "'ADMIN', 'SUPER'"), ('Get', 'deliveries', "'ADMIN', 'SUPER'"), ('Post', 'connect', "'SUPER'"), ('Post', 'test', "'SUPER'")])
   and "@Audit('MAIL_TEST', 'INTEGRATION')" in AC and "@Controller('api/v1/admin/mail')" in AC, str(routes))
ok('① 시험 메일 — 스위치와 따로(설정만 봄) · 하루 횟수 · 받는 주소 가림 · 연결 확인은 메일 · 로그인 없이 첫 인사만',
   'if (!s.configured)' in AS and 's.test.left <= 0' in AS and "to: maskMail(addr)" in AS and 'switchOn' in AS
   and "/^220/.test(d)" in AS and 'AUTH LOGIN' not in AS and "action = 'MAIL_TEST'" in AS, '')
SC = json.loads(rd('spec/screens.json') or '{"screens":[]}')
sit = next((s for s in SC['screens'] if s['id'] == 'SB-ADM-SIT-080'), {})
ok('① 화면 목록 — 외부 연동(SB-ADM-SIT-080)에 메일 API 4개(레지스트리 드리프트 없음)',
   all(a in sit.get('apis', []) for a in ['GET /admin/mail/status', 'GET /admin/mail/deliveries', 'POST /admin/mail/connect', 'POST /admin/mail/test']), '')
MP = rd('web/src/app/admin/MailPanel.tsx'); IG = rd('web/src/app/admin/Integrations.tsx')
ok('① 운영 화면 — 외부 연동에 「메일」(다섯 줄 · 연결 확인 · 시험 메일 · 발송 기록) · SUPER 만 단추',
   '<MailPanel />' in IG and 'data-mail-panel' in MP and 'data-mail-connect' in MP and 'data-mail-test' in MP and 'data-mail-deliveries' in MP
   and "tokenRoles().includes('SUPER')" in MP and all(f"row('{k}'" in MP for k in ('host', 'user', 'pass', 'from', 'switch')), '')
P167 = rd('docs/167_메일구축절차서_v1.2_SES_가비아_20261025.md'); TO = rd('scripts/test-mail-offline.ts')
ok('① 절차서 v1.3(5 · 7 · 8단계 운영 화면 · v10.140 전 방법 남김) · 오프라인 시험이 주소 기본값을 봄',
   '절차서 v1.3' in P167 and '「시험 메일 보내기」' in P167 and 'v10.140 전' in P167 and 'SES_SEOUL_HOST' in TO, '')
ok('① 판 v10.140 이상', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 140), rd('VERSION').strip())


def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m)
    try:
        return json.load(urllib.request.urlopen(r, timeout=60))
    except urllib.error.HTTPError as e:
        try: body = json.loads(e.read().decode('utf-8', 'replace'))
        except Exception: body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip()


if API and DB:
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': 'sgb-dev-1234'})['accessToken']
    had_role = psql("SELECT count(*) FROM account_roles r JOIN accounts a ON a.id = r.account_id WHERE a.email = 'seller@x.com' AND r.role = 'ADMIN'") != '0'
    psql("INSERT INTO account_roles(account_id, role) SELECT id, 'ADMIN' FROM accounts WHERE email = 'seller@x.com' ON CONFLICT DO NOTHING;")   # 운영(ADMIN) 시험용 · 끝나면 되돌림(test_v1129 방식)
    AT = call('POST', '/auth/login', {'email': 'seller@x.com', 'password': 'sgb-dev-1234'})['accessToken']
    BT = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': 'sgb-dev-1234'})['accessToken']
    had = psql("SELECT string_agg(name, ',') FROM integration_secrets WHERE integration_code = 'MAIL'")
    KEYS = ['notify.mail_from', 'notify.mail_test_daily', 'notify.email_verified']
    before = {k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'") for k in KEYS}
    nid = None
    try:
        if had:
            ok('② 점검판에 메일 연동 키가 이미 있음 — 키를 건드리는 시험은 건너뜀', False, had)
        else:
            s0 = call('GET', '/admin/mail/status', t=T_)
            ok('② 상태 — 주소 기본값(서울 SES · 465) · 사용자 이름 · 비밀번호 없음 · 설정 없음 · 값 칸 없음',
               s0.get('host', {}).get('value') == 'email-smtp.ap-northeast-2.amazonaws.com' and s0['host'].get('port') == 465
               and s0.get('user') == {'set': False, 'source': 'NONE'} and s0.get('pass') == {'set': False, 'source': 'NONE'} and s0.get('configured') is False
               and 'value' not in s0.get('user', {}) and s0.get('test', {}).get('limit') == int(before['notify.mail_test_daily'] or 20), str(s0)[:200])
            ok('② 권한 — 일반 회원 상태 403 · 시험 403', call('GET', '/admin/mail/status', t=BT).get('_err') == 403
               and call('POST', '/admin/mail/test', {'to': 'a@example.com'}, BT).get('_err') == 403, '')
            sa = call('GET', '/admin/mail/status', t=AT)
            ok('② 운영(ADMIN) — 상태 · 기록은 보고 연결 확인 · 시험은 403', 'host' in sa and 'sent' in call('GET', '/admin/mail/deliveries', t=AT)
               and call('POST', '/admin/mail/test', {'to': 'a@example.com'}, AT).get('_err') == 403 and call('POST', '/admin/mail/connect', {}, AT).get('_err') == 403, str(sa)[:80])
            nc = call('POST', '/admin/mail/test', {'to': 'a@example.com'}, T_)
            ok('② 설정이 없으면 시험 메일 422 MAIL_NOT_CONFIGURED', nc.get('_err') == 422 and nc.get('code') == 'MAIL_NOT_CONFIGURED', str(nc)[:100])
            bad = call('PUT', '/admin/integration-keys/MAIL/SMTP_USER', {'value': 'not-a-user-name'}, T_)
            ok('② SMTP 사용자 이름 형식이 아니면 422 INTEG_SECRET_FORMAT', bad.get('_err') == 422 and 'INTEG_SECRET_FORMAT' in json.dumps(bad), str(bad)[:120])
            pu = call('PUT', '/admin/integration-keys/MAIL/SMTP_USER', {'value': 'AKIATESTUSER0001V1140'}, T_)
            pp = call('PUT', '/admin/integration-keys/MAIL/SMTP_PASS', {'value': 'dGVzdHBhc3N3b3JkZm9ydjExNDBvbmx5'}, T_)
            row = next((r for r in pu if isinstance(pu, list) and r.get('name') == 'SMTP_USER'), {}) if isinstance(pu, list) else {}
            ok('② 연동 키에 사용자 이름 · 비밀번호 저장(끝 4자리만 · 값 없음)', row.get('source') == 'ADMIN' and row.get('masked', '').endswith('1140') and isinstance(pp, list)
               and 'AKIATESTUSER0001V1140' not in json.dumps(pu), str(row)[:120])
            psql("UPDATE site_settings SET value = 'no-reply@mail.sogaebank.com' WHERE key = 'notify.mail_from'; UPDATE site_settings SET value = 'off' WHERE key = 'notify.email_verified';")
            s1 = call('GET', '/admin/mail/status', t=T_)
            ok('② 넣은 뒤 상태 — 사용자 이름 · 비밀번호 「운영 화면」 · 보내는 주소(사이트 설정) · 설정 다 있음 · 스위치 꺼짐이라 회원에게는 안 나감',
               s1.get('user') == {'set': True, 'source': 'ADMIN'} and s1.get('pass') == {'set': True, 'source': 'ADMIN'} and s1.get('from', {}).get('source') == 'SETTING'
               and s1.get('configured') is True and s1.get('switchOn') is False and s1.get('ready') is False, str(s1)[:200])
            iv = call('POST', '/admin/mail/test', {'to': 'not-an-email'}, T_)
            ok('② 받는 주소 형식이 아니면 422 EMAIL_INVALID', iv.get('_err') == 422 and iv.get('code') == 'EMAIL_INVALID', str(iv)[:80])
            psql("UPDATE site_settings SET value = '0' WHERE key = 'notify.mail_test_daily';")
            lm = call('POST', '/admin/mail/test', {'to': 'a@example.com'}, T_)
            ok('② 하루 횟수 0 — 422 MAIL_TEST_LIMIT(보내지 않음)', lm.get('_err') == 422 and lm.get('code') == 'MAIL_TEST_LIMIT', str(lm)[:100])
            cn = call('POST', '/admin/mail/connect', {}, T_)
            ok('② 연결 확인 — 응답 모양(성공 여부 · 주소 · 포트 · 걸린 시간 6초 안) · 메일 안 보냄', isinstance(cn.get('ok'), bool) and cn.get('host') == 'email-smtp.ap-northeast-2.amazonaws.com'
               and cn.get('port') == 465 and 0 <= (cn.get('ms') or -1) <= 6000, str(cn)[:140])
            # 발송 기록 — 시험용 실패 줄 하나(끝나면 지움)
            bid = psql("SELECT id FROM accounts WHERE email = 'buyer@x.com'")
            nid = psql(f"INSERT INTO notifications (account_id, event_code, title, body) VALUES ('{bid}', 'TEST_V1140', '시험', '시험 알림') RETURNING id")
            nid = nid.splitlines()[0] if nid else None
            if nid:
                psql(f"INSERT INTO notification_deliveries (notification_id, channel, status, failed_reason) VALUES ({nid}, 'EMAIL', 'FAILED', 'REJECTED 시험 v1140');")
            dv = call('GET', '/admin/mail/deliveries?days=1', t=T_)
            mine = [r for r in dv.get('recent', []) if r.get('event') == 'TEST_V1140']
            ok('② 발송 기록 — 실패 수 · 까닭별 · 최근 실패 줄(받는 주소는 앞 2글자 · 도메인만)', dv.get('days') == 1 and dv.get('failed', 0) >= 1
               and any(x.get('reason') == 'REJECTED' for x in dv.get('reasons', [])) and mine and mine[0].get('to') == 'bu***@x.com', str(mine)[:120])
    finally:
        if not had_role:
            psql("DELETE FROM account_roles WHERE role = 'ADMIN' AND account_id = (SELECT id FROM accounts WHERE email = 'seller@x.com');")
        if not had:
            for n in ('SMTP_USER', 'SMTP_PASS'):
                call('DELETE', f'/admin/integration-keys/MAIL/{n}', t=T_)
            psql("UPDATE integrations SET secret_registered = false WHERE code = 'MAIL';")
        for k, v in before.items():
            psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}';")
        if nid:
            psql(f"DELETE FROM notification_deliveries WHERE notification_id = {nid}; DELETE FROM notifications WHERE id = {nid};")
    if not had:
        s2 = call('GET', '/admin/mail/status', t=T_)
        ok('② 되돌림 — 연동 키 지움 · 상태 다시 「없음」', s2.get('user', {}).get('source') == 'NONE' and s2.get('pass', {}).get('source') == 'NONE', str(s2.get('user')))

# ── ③ 운영 화면(브라우저) ──────────────────────────────────────────────
if ADMIN_WEB:
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if sync_playwright:
        with sync_playwright() as p:
            b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1400, 'height': 1000})
            pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
            pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', 'sgb-dev-1234'); pg.click('button[type=submit]'); pg.wait_for_timeout(1500)
            pg.goto(ADMIN_WEB + '/#/integrations', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
            box = pg.locator('[data-mail-panel]')
            ok('③ 외부 연동 › 「메일」 — 다섯 줄 · 연결 확인 · 시험 메일 단추(SUPER) · 발송 기록', box.count() == 1 and box.locator('[data-mail-row]').count() == 5
               and box.locator('[data-mail-connect]').count() == 1 and box.locator('[data-mail-test]').count() == 1 and box.locator('[data-mail-deliveries]').count() == 1,
               box.inner_text()[:120] if box.count() else '없음')
            ok('③ 연동 키 목록에 「SMTP 사용자 이름」 줄', pg.get_by_text('SMTP 사용자 이름').count() >= 1, '')
            if box.count(): box.scroll_into_view_if_needed()
            pg.screenshot(path=os.path.join(HERE, 'v1140_mail_panel.png'), full_page=False)
            b.close()

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
