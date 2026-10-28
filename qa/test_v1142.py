"""v10.142 시험 — 알림톡 연동 틀(D138 · docs/215 · 설계 docs/213)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1142.py

  ① 코드 — D138(템플릿 4 · 보낸 기록 · 키 이름 · 설정 · SMS 채널 줄 · 지우는 문장 없음 · 176) · 템플릿 본문 · 오류 처리(보내기 전 막기 · 잠시 실패 재시도 ·
     번호 끝 4자리만) · 상담 인증번호 · 알림 SMS 배치 연결 · 켜기 조건 · 방식 SUPER · API 4개 · 화면 목록 · 운영 화면 「알림톡」 · 영어 문장 · 판
  ② (API · MOCK — 밖으로 보내지 않음) 처음 NONE · 권한 · HTTP 키 없이 422 · 준비 없이 켜기 422 · 템플릿 코드 · 승인 검사 · 시험 발송(번호 형식 ·
     코드 없음 · 보냄 · 끝 4자리 · 하루 한도) · 켜기 → 상담 신청 인증번호가 알림톡으로 · 알림 SMS QUEUED → SENT — 끝나면 되돌림
  ③ (운영 화면) 외부 연동 › 「알림톡」 다섯 줄 · 템플릿 4줄 · 시험 발송 · 보낸 기록
"""
import json, os, random, re, subprocess, urllib.error, urllib.request

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
D = rd('prisma/migrations/D138_alimtalk/migration.sql')
mig = sorted(x for x in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', x)))
ok('① D138 — 템플릿 표(4줄 · 심의 상태) · 보낸 기록(끝 4자리) · 키 이름 발신 프로필 · 설정(NONE · 20) · SMS 채널 줄 · 지우는 문장 없음 · 176 이상',
   'CREATE TABLE IF NOT EXISTS public.alimtalk_templates' in D and 'CREATE TABLE IF NOT EXISTS public.alimtalk_sends' in D and 'to_last4 text' in D
   and "('ALIMTALK','ALIMTALK_SENDER_KEY')" in D and "('alimtalk.provider', 'NONE'" in D and "('alimtalk.test_daily', '20'" in D
   and "'notify.alimtalk_ready'::text))), false) AS ready" in D and all(c in D for c in ("'CONSULT_OTP'", "'HANDOFF_ADMIN'", "'ORDER_STATUS'", "'NOTICE_GENERAL'"))
   and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE|DROP COLUMN)\b', D) and len(mig) >= 176 and 'D138_alimtalk' in mig, f'{len(mig)} · {mig[-1]}')
TP = rd('src/common/alimtalk/alimtalk.templates.ts'); AS = rd('src/common/alimtalk/alimtalk.service.ts')
ok('① 템플릿 본문 4개 · #{자리} 채우기(줄바꿈 정리 · 길이 제한)', all(f'{c}: {{' in TP for c in ('CONSULT_OTP', 'HANDOFF_ADMIN', 'ORDER_STATUS', 'NOTICE_GENERAL'))
   and 'export function renderAlimtalk' in TP and '#{인증번호}' in TP, '')
ok('① 오류 처리 — 보내기 전 막기(NOT_READY · BAD_PHONE · TEMPLATE) · 401/403 AUTH · 5xx SERVER · 시간 초과 · 잠시 실패만 재시도 3번 · 기록은 늘 · 번호 끝 4자리',
   all(f"'{k}'" in AS for k in ('NOT_READY', 'BAD_PHONE', 'TEMPLATE', 'AUTH', 'SERVER', 'REJECTED', 'TIMEOUT', 'NETWORK'))
   and "new Set<string>(['NETWORK', 'TIMEOUT', 'SERVER'])" in AS and 'tries < 3' in AS and 'last4(to)' in AS and 'INSERT INTO alimtalk_sends' in AS
   and "m === 'MOCK' && !isProd() ? 'MOCK' : 'NONE'" in AS, '')
CS = rd('src/modules/partner/consult.service.ts'); SCH = rd('src/worker/scheduler.service.ts')
ok('① 상담 인증번호 — 준비되면 알림톡(CONSULT_OTP) · 둘 다 못 보내면 신청 지움 · 알림 SMS 배치 연결',
   "return this.alimtalk.ready('CONSULT_OTP');" in CS and "template: 'CONSULT_OTP'" in CS and 'if (alimtalk && !atOk && !byMail)' in CS
   and 'await this.alimtalk.runNotify()' in SCH and 'private readonly alimtalk: AlimtalkService,' in SCH, '')
AD = rd('src/modules/admin/admin.service.ts')
ok('① 방식 · 켜기 — alimtalk.* SUPER · MOCK 운영 서버 422 · HTTP 키 · 주소 422 · 켜기는 준비 + 승인 템플릿', "key.startsWith('alimtalk.')" in AD
   and "'ALIMTALK_KEYS_MISSING'" in AD and "'ALIMTALK_NOT_READY'" in AD and "key === 'notify.alimtalk_ready'" in AD, '')
AC = rd('src/modules/site/alimtalk-admin.controller.ts')
routes = re.findall(r"@(Get|Post|Put)\('([^']+)'\)\n  @Roles\(([^)]*)\)", AC)
ok('① API 4개 — 보기 ADMIN · SUPER / 템플릿 · 시험 SUPER · 감사', sorted(routes) == sorted([('Get', 'status', "'ADMIN', 'SUPER'"), ('Get', 'sends', "'ADMIN', 'SUPER'"),
   ('Put', 'templates/:code', "'SUPER'"), ('Post', 'test', "'SUPER'")]) and "@Audit('ALIMTALK_TEST', 'INTEGRATION')" in AC and "@Audit('ALIMTALK_TEMPLATE', 'INTEGRATION')" in AC, str(routes))
SC = json.loads(rd('spec/screens.json') or '{"screens":[]}')
sit = next((s for s in SC['screens'] if s['id'] == 'SB-ADM-SIT-080'), {})
ok('① 화면 목록 — 외부 연동에 알림톡 API 4개', all(a in sit.get('apis', []) for a in ['GET /admin/alimtalk/status', 'GET /admin/alimtalk/sends', 'PUT /admin/alimtalk/templates/{code}', 'POST /admin/alimtalk/test']), '')
AP = rd('web/src/app/admin/AlimtalkPanel.tsx')
ok('① 운영 화면 — 외부 연동 「알림톡」(다섯 줄 · 템플릿 · 시험 · 기록 · SUPER 만 단추)', '<AlimtalkPanel />' in rd('web/src/app/admin/Integrations.tsx')
   and all(x in AP for x in ('data-alimtalk-panel', 'data-alimtalk-templates', 'data-alimtalk-test', 'data-alimtalk-sends', 'data-alimtalk-switch')) and "tokenRoles().includes('SUPER')" in AP, '')
RG = rd('src/common/integration/registry.ts'); SS = rd('src/common/integration/secret.service.ts'); EV = rd('deploy/aws/env.production.example')
ok('① 연동 목록 · 키 목록 · .env 예시', "'ALIMTALK_SENDER_KEY', 'ALIMTALK_URL'" in RG and "name: 'ALIMTALK_SENDER_KEY'" in SS and 'ALIMTALK_URL=' in EV, '')
EN = rd('src/common/i18n/server-text.en.ts')
ok('① 영어 문장', all(m in EN for m in ('"휴대폰(알림톡)으로 인증번호를 보냈습니다."', '"없는 템플릿입니다."', '"오늘 시험 발송 {0}통을 다 썼습니다."')), '')
ok('① 판 v10.142 이상', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 142), rd('VERSION').strip())


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


SETS = ['alimtalk.provider', 'alimtalk.test_daily', 'notify.alimtalk_ready', 'notify.email_verified']
BUYER, SELLER = 'buyer@x.com', 'seller@x.com'
if API and DB:
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': 'sgb-dev-1234'})['accessToken']
    BT = call('POST', '/auth/login', {'email': BUYER, 'password': 'sgb-dev-1234'})['accessToken']
    before = {k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'") for k in SETS}
    tpl0 = psql("SELECT string_agg(code || '=' || coalesce(vendor_code, '') || '=' || review_state, ';' ORDER BY code) FROM alimtalk_templates")
    mark = psql("SELECT now()::text")
    had_role = psql(f"SELECT count(*) FROM account_roles r JOIN accounts a ON a.id = r.account_id WHERE a.email = '{SELLER}' AND r.role = 'ADMIN'") != '0'
    bphone = psql(f"SELECT coalesce(phone, '') FROM accounts WHERE email = '{BUYER}'")
    setv = lambda k, v, t=T_: call('PATCH', '/admin/site-settings', {'key': k, 'value': v}, t)
    made_consult, nid = [], None
    try:
        setv('alimtalk.provider', 'NONE'); setv('notify.alimtalk_ready', 'off')
        s0 = call('GET', '/admin/alimtalk/status', t=T_)
        ok('② 처음 — NONE · 준비 안 됨 · 키 2개 없음 · 템플릿 4개(심의 전) · 값 칸 없음', s0.get('provider') == 'NONE' and s0.get('configured') is False
           and [k['set'] for k in s0.get('keys', [])] == [False, False] and len(s0.get('templates', [])) == 4 and 'value' not in json.dumps(s0.get('keys')), str(s0)[:160])
        psql(f"INSERT INTO account_roles(account_id, role) SELECT id, 'ADMIN' FROM accounts WHERE email = '{SELLER}' ON CONFLICT DO NOTHING;")
        AT = call('POST', '/auth/login', {'email': SELLER, 'password': 'sgb-dev-1234'})['accessToken']
        ok('② 권한 — 회원 403 · 운영(ADMIN) 보기만(방식 · 템플릿 · 시험 403)', call('GET', '/admin/alimtalk/status', t=BT).get('_err') == 403
           and 'provider' in call('GET', '/admin/alimtalk/status', t=AT) and setv('alimtalk.provider', 'MOCK', AT).get('code') == 'INTEG_SETTING_SUPER'
           and call('PUT', '/admin/alimtalk/templates/NOTICE_GENERAL', {'vendorCode': 'X1'}, AT).get('_err') == 403
           and call('POST', '/admin/alimtalk/test', {'to': '01012345678'}, AT).get('_err') == 403, '')
        if not had_role:
            psql(f"DELETE FROM account_roles WHERE role = 'ADMIN' AND account_id = (SELECT id FROM accounts WHERE email = '{SELLER}');")
        h = setv('alimtalk.provider', 'HTTP')
        ok('② HTTP — 키 · 주소 없이 422 ALIMTALK_KEYS_MISSING', h.get('code') == 'ALIMTALK_KEYS_MISSING', str(h)[:120])
        on0 = setv('notify.alimtalk_ready', 'on')
        ok('② 준비 없이 켜기 422 ALIMTALK_NOT_READY', on0.get('code') == 'ALIMTALK_NOT_READY', str(on0)[:100])
        ok('② MOCK 으로(점검판)', setv('alimtalk.provider', 'MOCK').get('_err') is None and call('GET', '/admin/alimtalk/status', t=T_).get('configured') is True, '')
        nc = call('POST', '/admin/alimtalk/test', {'to': '01012345678', 'template': 'NOTICE_GENERAL'}, T_)
        ok('② 시험 — 대행사 코드 없으면 보내지 않음(TEMPLATE) · 기록 FAILED', nc.get('ok') is False and nc.get('errorKind') == 'TEMPLATE', str(nc)[:100])
        bp = call('POST', '/admin/alimtalk/test', {'to': '0212345678'}, T_)
        ok('② 시험 — 휴대폰 번호 형식 아니면 422 PHONE_INVALID', bp.get('code') == 'PHONE_INVALID', str(bp)[:80])
        r1 = call('PUT', '/admin/alimtalk/templates/NOTICE_GENERAL', {'vendorCode': None, 'reviewState': 'APPROVED'}, T_)
        r2 = call('PUT', '/admin/alimtalk/templates/NOTICE_GENERAL', {'vendorCode': 'bad code!', 'reviewState': 'REVIEW'}, T_)
        r3 = call('PUT', '/admin/alimtalk/templates/NOPE', {'vendorCode': 'X'}, T_)
        ok('② 템플릿 — 코드 없이 승인 422 · 코드 형식 422 · 없는 템플릿 404', r1.get('code') == 'TEMPLATE_CODE_REQUIRED' and r2.get('code') == 'TEMPLATE_CODE_FORMAT' and r3.get('_err') == 404,
           f"{r1.get('code')} · {r2.get('code')} · {r3.get('_err')}")
        for c in ('NOTICE_GENERAL', 'CONSULT_OTP'):
            call('PUT', f'/admin/alimtalk/templates/{c}', {'vendorCode': f'SGB_{c}', 'reviewState': 'APPROVED'}, T_)
        t1 = call('POST', '/admin/alimtalk/test', {'to': '010-1234-5678', 'template': 'NOTICE_GENERAL'}, T_)
        last = psql("SELECT purpose || '|' || to_last4 || '|' || status || '|' || provider FROM alimtalk_sends ORDER BY id DESC LIMIT 1")
        ok('② 시험 발송(MOCK) — 보냄 · 번호 가림 · 기록은 끝 4자리만', t1.get('ok') is True and t1.get('to') == '***5678' and (t1.get('msgId') or '').startswith('MOCK-')
           and last == 'TEST|5678|SENT|MOCK' and psql("SELECT count(*) FROM alimtalk_sends WHERE error LIKE '%01012345678%' OR to_last4 = '01012345678'") == '0', f'{str(t1)[:100]} · {last}')
        psql("UPDATE site_settings SET value = '0' WHERE key = 'alimtalk.test_daily';")
        lm = call('POST', '/admin/alimtalk/test', {'to': '01012345678'}, T_)
        ok('② 하루 횟수 0 — 422 ALIMTALK_TEST_LIMIT', lm.get('code') == 'ALIMTALK_TEST_LIMIT', str(lm)[:80])
        on1 = setv('notify.alimtalk_ready', 'on')
        ok('② 준비 · 승인 템플릿이 있으면 켜짐', on1.get('_err') is None and call('GET', '/admin/alimtalk/status', t=T_).get('switchOn') is True, str(on1)[:80])

        # 상담 신청 인증번호 — 메일은 꺼 두고 알림톡만
        psql("UPDATE site_settings SET value = 'off' WHERE key = 'notify.email_verified';")
        ph = '010-%04d-%04d' % (random.randint(1000, 9999), random.randint(0, 9999))
        cr = call('POST', '/consult/requests', {'categoryCode': 'CSL_MOVING', 'name': '알림톡 시험', 'phone': ph, 'email': 'consult.test@example.com', 'sido': '서울', 'agree': True})
        if cr.get('id'): made_consult.append(cr['id'])
        sent = psql(f"SELECT status || '|' || to_last4 FROM alimtalk_sends WHERE purpose = 'CONSULT_OTP' AND created_at >= '{mark}' ORDER BY id DESC LIMIT 1")
        ok('② 상담 신청 — 인증번호가 알림톡으로(응답에 번호 없음 · 「휴대폰(알림톡)」 안내 · 기록 끝 4자리)', bool(cr.get('id')) and 'devCode' not in cr
           and '알림톡' in (cr.get('note') or '') and sent == f"SENT|{ph[-4:]}", f'{str(cr)[:120]} · {sent}')

        # 알림 SMS — QUEUED → SENT(알림톡 일반 템플릿)
        if not bphone:
            psql(f"UPDATE accounts SET phone = '01055551142' WHERE email = '{BUYER}';")
        bid = psql(f"SELECT id FROM accounts WHERE email = '{BUYER}'")
        nid = psql(f"INSERT INTO notifications (account_id, event_code, title, body) VALUES ('{bid}', 'TEST_V1142', '시험 알림', '알림톡 시험 알림') RETURNING id")
        did = psql(f"INSERT INTO notification_deliveries (notification_id, channel, status, idempotency_key) VALUES ({nid}, 'SMS', 'QUEUED', '{nid}:SMS:t1142') RETURNING id")
        jr = call('POST', '/admin/jobs', {'job': 'notify_dispatch'}, T_)
        st = psql(f"SELECT status || '|' || coalesce(provider, '') || '|' || (provider_msg_id LIKE 'MOCK-%')::text FROM notification_deliveries WHERE id = {did or 0}")
        ok('② 알림 SMS — 배치가 알림톡(일반 템플릿)으로 보냄 · SENT · ALIMTALK', st == 'SENT|ALIMTALK|true', f"{st} · {str(jr)[:120]}")
    finally:
        for k, v in before.items():
            psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}';")
        for part in (tpl0 or '').split(';'):
            if part.count('=') == 2:
                c, vc, stt = part.split('=')
                psql(f"UPDATE alimtalk_templates SET vendor_code = {('NULL' if not vc else repr(vc))}, review_state = '{stt}' WHERE code = '{c}';")
        if not had_role:
            psql(f"DELETE FROM account_roles WHERE role = 'ADMIN' AND account_id = (SELECT id FROM accounts WHERE email = '{SELLER}');")
        if not bphone:
            psql(f"UPDATE accounts SET phone = NULL WHERE email = '{BUYER}';")
        for i in made_consult:
            psql(f"DELETE FROM consult_requests WHERE id = '{i}' AND lead_id IS NULL;")
        if nid:
            psql(f"DELETE FROM notification_deliveries WHERE notification_id = {nid}; DELETE FROM notifications WHERE id = {nid};")
        psql(f"DELETE FROM alimtalk_sends WHERE created_at >= '{mark}';")
    ok('② 되돌림 — 설정 · 템플릿 · 기록', all(psql(f"SELECT value FROM site_settings WHERE key = '{k}'") == v for k, v in before.items())
       and psql("SELECT string_agg(code || '=' || coalesce(vendor_code, '') || '=' || review_state, ';' ORDER BY code) FROM alimtalk_templates") == tpl0
       and psql(f"SELECT count(*) FROM alimtalk_sends WHERE created_at >= '{mark}'") == '0', '')

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
            pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', 'sgb-dev-1234'); pg.click('button[type=submit]'); pg.wait_for_timeout(1500)
            pg.goto(ADMIN_WEB + '/#/integrations', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
            box = pg.locator('[data-alimtalk-panel]')
            ok('③ 외부 연동 › 「알림톡」 — 준비 다섯 줄 이상 · 템플릿 4줄 · 시험 발송 · 보낸 기록', box.count() == 1 and box.locator('[data-alimtalk-row]').count() >= 5
               and box.locator('[data-alimtalk-tpl]').count() == 4 and box.locator('[data-alimtalk-test]').count() == 1 and box.locator('[data-alimtalk-sends]').count() == 1,
               box.inner_text()[:120] if box.count() else '없음')
            ok('③ 연동 키 목록에 「발신 프로필 키」 · 「NICE 클라이언트 ID」', pg.get_by_text('발신 프로필 키').count() >= 1 and pg.get_by_text('NICE 클라이언트 ID').count() >= 1, '')
            if box.count(): box.scroll_into_view_if_needed()
            pg.screenshot(path=os.path.join(HERE, 'v1142_alimtalk_panel.png'), full_page=False)
            b.close()

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
