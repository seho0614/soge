"""v10.144 시험 — 결제 · 계좌인증 연결 확인(D140 · docs/220 · 설계 docs/218)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1144.py

  ① 코드 — D140(시험 기록 · 코드 해시 · 설정 · 지우는 문장 없음 · 178) · 토스 응답 나누기(404 = 키 맞음 · 401/403 · 5xx · 연결) · 1원(하루 · 1분 · 30분 · 다섯 번 ·
     끝 4자리) · LIVE 조건(최근 7일 · 스텁 아님) · API 4개 · 화면 목록 · 운영 화면 · 영어 · 판
  ② (API — 점검판에는 결제 · 계좌 키가 없음) 권한 · 키 없이 결제 확인 NOT_CONFIGURED · 1원(입력 422 · 스텁 SGB01 · 연속 409 · 틀린 코드 · 맞는 코드 · 다시 확인 409) ·
     LIVE 막힘(스텁은 근거 아님) · 성공 기록이 있으면 LIVE 됨 · 내리기는 언제나 — 끝나면 되돌림
  ③ (운영 화면) 외부 연동 › 「결제 · 계좌 연결 확인」
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
D = rd('prisma/migrations/D140_integ_tests/migration.sql')
mig = sorted(x for x in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', x)))
ok('① D140 — 시험 기록(연동 PG · BANK · 종류 3 · 스텁 · 끝 4자리 · 코드 해시) · 설정 하루 3 · 지우는 문장 없음 · 178 이상',
   'CREATE TABLE IF NOT EXISTS public.integration_tests' in D and "integration_code IN ('PG', 'BANK')" in D and "kind IN ('PG_KEY', 'BANK_SEND', 'BANK_CONFIRM')" in D
   and 'code_hash text' in D and "account_last4 ~ '^[0-9]{1,4}$'" in D and "('integ.bank_test_daily', '3'" in D
   and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE|DROP COLUMN)\b', D) and len(mig) >= 178 and 'D140_integ_tests' in mig, f'{len(mig)} · {mig[-1]}')
SV = rd('src/modules/site/integ-test.service.ts')
ok('① 토스 응답 나누기 — 404 만 키 맞음 · 401/403 AUTH · 5xx UPSTREAM · 연결 · 2xx 는 이상 · 돈 안 나감(GET 조회만)',
   "if (status === 404 && (!body?.code || body.code === 'NOT_FOUND_PAYMENT'" in SV and "errorKind: 'AUTH'" in SV and "errorKind: 'UPSTREAM'" in SV
   and "/v1/payments/orders/${orderId}`, method: 'GET'" in SV and 'confirm(' not in SV.split('async bankConfirm')[0].split('async pgCheck')[1], '')
ok('① 1원 — 입력 검사 · 하루 한도(스텁은 안 셈) · 1분 안 연속 409 · 30분 · 다섯 번 · 코드는 해시(행 번호 소금) · 계좌 끝 4자리',
   "'BANK_TEST_INPUT'" in SV and "'BANK_TEST_LIMIT'" in SV and "'BANK_TEST_BUSY'" in SV and 'BANK_TTL_MIN = 30' in SV and 'BANK_MAX_TRIES = 5' in SV
   and "update(`${id}:${code.trim().toUpperCase()}`" in SV and 'last4(accountNo)' in SV, '')
SS = rd('src/modules/site/site.service.ts')
ok('① LIVE 조건 — PG · BANK 를 LIVE 로 올릴 때만 · 최근 7일 성공 · 스텁 아님 · 내리기는 그대로', "AND ok AND NOT stub AND created_at > now() - interval '7 days'" in SV
   and "'INTEG_TEST_REQUIRED'" in SV and "if (input.status === 'LIVE')" in SS and "if (cur && cur.status !== 'LIVE') await this.integTests.assertLiveAllowed(code);" in SS, '')
CT = rd('src/modules/site/integ-test.controller.ts')
routes = re.findall(r"@(Get|Post)\(('[^']*')?\)\n  @Roles\(([^)]*)\)", CT)
ok('① API 4개 — 보기 ADMIN · SUPER / 시험 SUPER · 감사', sorted(routes) == sorted([('Get', '', "'ADMIN', 'SUPER'"), ('Post', "'pg-check'", "'SUPER'"),
   ('Post', "'bank-send'", "'SUPER'"), ('Post', "'bank-confirm'", "'SUPER'")]) and "@Audit('INTEG_TEST_PG', 'INTEGRATION')" in CT and CT.count("@Audit('INTEG_TEST_BANK', 'INTEGRATION')") == 2, str(routes))
SC = json.loads(rd('spec/screens.json') or '{"screens":[]}')
sit = next((s for s in SC['screens'] if s['id'] == 'SB-ADM-SIT-080'), {})
ok('① 화면 목록 — 외부 연동에 API 4개', all(a in sit.get('apis', []) for a in ['GET /admin/integ-tests', 'POST /admin/integ-tests/pg-check',
   'POST /admin/integ-tests/bank-send', 'POST /admin/integ-tests/bank-confirm']), '')
AP = rd('web/src/app/admin/IntegTestPanel.tsx')
ok('① 운영 화면 — 「결제 · 계좌 연결 확인」(다섯 줄 · 결제 확인 · 1원 · 코드 · 최근 · SUPER 만 단추)', '<IntegTestPanel />' in rd('web/src/app/admin/Integrations.tsx')
   and all(x in AP for x in ('data-integtest-panel', 'data-integtest-row', 'data-integtest-pg', 'data-integtest-send', 'data-integtest-confirm', 'data-integtest-recent'))
   and "tokenRoles().includes('SUPER')" in AP, '')
EN = rd('src/common/i18n/server-text.en.ts')
ok('① 영어 문장', all(m in EN for m in ('"통장에 찍힌 코드를 넣어 주십시오."', '"확인할 1원 시험이 없습니다 — 다시 보내 주십시오."', '"오늘 1원 시험 {0}번을 다 썼습니다."')), '')
ok('① 판 v10.144 이상', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 144), rd('VERSION').strip())


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
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW})['accessToken']
    BT = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW})['accessToken']
    mark = psql("SELECT now()::text")
    st0 = {c: psql(f"SELECT status FROM integrations WHERE code = '{c}'") for c in ('PG', 'BANK')}
    had_role = psql("SELECT count(*) FROM account_roles r JOIN accounts a ON a.id = r.account_id WHERE a.email = 'seller@x.com' AND r.role = 'ADMIN'") != '0'
    try:
        s0 = call('GET', '/admin/integ-tests', t=T_)
        ok('② 상태 — 결제 · 계좌 줄 · 키 값 없음 · 하루 1원 3번', 'pg' in s0 and 'bank' in s0 and (s0.get('bank') or {}).get('test', {}).get('limit') == 3
           and 'sk_' not in json.dumps(s0), str(s0)[:160])
        psql("INSERT INTO account_roles(account_id, role) SELECT id, 'ADMIN' FROM accounts WHERE email = 'seller@x.com' ON CONFLICT DO NOTHING;")
        AT = call('POST', '/auth/login', {'email': 'seller@x.com', 'password': PW}).get('accessToken')
        ok('② 권한 — 회원 403 · 운영(ADMIN) 보기만(시험 403)', call('GET', '/admin/integ-tests', t=BT).get('_err') == 403 and 'pg' in call('GET', '/admin/integ-tests', t=AT)
           and call('POST', '/admin/integ-tests/pg-check', {}, AT).get('_err') == 403 and call('POST', '/admin/integ-tests/bank-send', {'bankCode': '004', 'accountNo': '1002123456789', 'holderName': '시험'}, AT).get('_err') == 403, '')
        if not had_role:
            psql("DELETE FROM account_roles WHERE role = 'ADMIN' AND account_id = (SELECT id FROM accounts WHERE email = 'seller@x.com');")
        has_toss = bool((s0.get('pg') or {}).get('secretKey'))
        pg = call('POST', '/admin/integ-tests/pg-check', {}, T_)
        ok('② 결제 키 확인 — 점검판(키 없음)은 NOT_CONFIGURED · 기록 남음' if not has_toss else '② 결제 키 확인 — 결과 기록',
           (pg.get('ok') is False and pg.get('errorKind') == 'NOT_CONFIGURED' or has_toss)
           and psql(f"SELECT count(*) FROM integration_tests WHERE kind = 'PG_KEY' AND created_at >= '{mark}'") == '1', str(pg)[:140])
        bi = call('POST', '/admin/integ-tests/bank-send', {'bankCode': '4', 'accountNo': '12', 'holderName': '시험'}, T_)
        ok('② 1원 — 입력 틀림 400/422', bi.get('_err') in (400, 422), str(bi)[:100])
        b1 = call('POST', '/admin/integ-tests/bank-send', {'bankCode': '004', 'accountNo': '1002-123-456789', 'holderName': '시험 관리자'}, T_)
        b2 = call('POST', '/admin/integ-tests/bank-send', {'bankCode': '004', 'accountNo': '1002123456789', 'holderName': '시험 관리자'}, T_)
        ok('② 1원(스텁) — 보냄 · 계좌 끝 4자리 · 기록에 코드 해시만 · 1분 안 연속 409 BANK_TEST_BUSY', b1.get('ok') is True and b1.get('stub') is True and b1.get('account') == '***6789'
           and b2.get('code') == 'BANK_TEST_BUSY'
           and psql(f"SELECT account_last4 || '|' || (code_hash ~ '^[0-9a-f]{{64}}$') || '|' || pending FROM integration_tests WHERE id = {b1.get('testId')}") == '6789|true|true', f'{b1} · {b2.get("code")}')
        w = call('POST', '/admin/integ-tests/bank-confirm', {'testId': b1.get('testId'), 'code': 'WRONG'}, T_)
        g = call('POST', '/admin/integ-tests/bank-confirm', {'testId': b1.get('testId'), 'code': 'SGB01'}, T_)
        again = call('POST', '/admin/integ-tests/bank-confirm', {'testId': b1.get('testId'), 'code': 'SGB01'}, T_)
        ok('② 코드 — 틀리면 남은 횟수 4 · 맞으면 확인(스텁) · 다시 확인 409 BANK_TEST_NOT_PENDING', w.get('ok') is False and w.get('triesLeft') == 4 and g.get('ok') is True and g.get('stub') is True
           and again.get('code') == 'BANK_TEST_NOT_PENDING', f'{w} · {g} · {again.get("code")}')
        for c in ('PG', 'BANK'):
            psql(f"UPDATE integrations SET status = 'TESTING' WHERE code = '{c}'")
        lv = call('PATCH', '/admin/integrations/BANK', {'status': 'LIVE'}, T_)
        lp = call('PATCH', '/admin/integrations/PG', {'status': 'LIVE'}, T_)
        ok('② LIVE 막힘 — 스텁 성공은 근거 아님 · 결제 키 확인 없음 → 422 INTEG_TEST_REQUIRED', lv.get('code') == 'INTEG_TEST_REQUIRED' and lp.get('code') == 'INTEG_TEST_REQUIRED'
           and psql("SELECT status FROM integrations WHERE code = 'BANK'") == 'TESTING', f"{lv.get('code')} · {lp.get('code')}")
        psql("INSERT INTO integration_tests (integration_code, kind, ok, stub, detail) VALUES ('BANK', 'BANK_CONFIRM', true, false, 'test_v1144 가짜 성공')")
        l2 = call('PATCH', '/admin/integrations/BANK', {'status': 'LIVE'}, T_)
        dn = call('PATCH', '/admin/integrations/BANK', {'status': 'TESTING'}, T_)
        ok('② 최근 7일 성공(스텁 아님)이 있으면 LIVE 됨 · 내리기(TESTING)는 조건 없음', l2.get('status') == 'LIVE' and dn.get('status') == 'TESTING', f'{l2} · {dn}')
        s1 = call('GET', '/admin/integ-tests', t=T_)
        ok('② 상태 — 최근 시험 줄 · 계좌 성공 시각 · 계좌번호 원문 없음', len(s1.get('recent', [])) >= 4 and bool((s1.get('bank') or {}).get('lastOkAt'))
           and '1002123456789' not in json.dumps(s1) and '123456789' not in json.dumps(s1), '')
    finally:
        for c, v in st0.items():
            psql(f"UPDATE integrations SET status = '{v}' WHERE code = '{c}'")
        psql(f"DELETE FROM integration_tests WHERE created_at >= '{mark}'")
        if not had_role:
            psql("DELETE FROM account_roles WHERE role = 'ADMIN' AND account_id = (SELECT id FROM accounts WHERE email = 'seller@x.com');")
    ok('② 되돌림 — 연동 상태 · 시험 기록', all(psql(f"SELECT status FROM integrations WHERE code = '{c}'") == v for c, v in st0.items())
       and psql(f"SELECT count(*) FROM integration_tests WHERE created_at >= '{mark}'") == '0', '')

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
            box = pg.locator('[data-integtest-panel]')
            ok('③ 외부 연동 › 「결제 · 계좌 연결 확인」 — 다섯 줄 · 결제 키 확인 · 1원 칸', box.count() == 1 and box.locator('[data-integtest-row]').count() == 5
               and box.locator('[data-integtest-pg]').count() == 1 and box.locator('[data-integtest-send]').count() == 1, box.inner_text()[:120] if box.count() else '없음')
            if box.count(): box.scroll_into_view_if_needed()
            pg.screenshot(path=os.path.join(HERE, 'v1144_integtest_panel.png'), full_page=False)
            b.close()

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
