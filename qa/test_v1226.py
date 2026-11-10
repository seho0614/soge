"""v10.226 (docs/363) — 운영 화면 접속 인증(허용 IP 밖이면 그날 텔레그램 인증번호)

  ① (코드) D195(허용 IP · 인증번호 sha256 · 통과 기록 고칠 수 없음 · 받을 곳 · admin.ip_verify off · 중요 설정 감시) · 서비스(자정까지 · 5분 · 5번 · 1분 · 하루 10번) ·
     가드 IP_VERIFY_REQUIRED(운영 역할만 요구하는 API) · 켜기 SUPER · 봇 토큰 · 받을 곳 · 운영 화면 인증 화면 · 「접속 인증」 탭 · 명세 · 영어 · 문서 363
  ② (API · DB) 꺼짐이면 그대로 · 켜기 ADMIN 403 · SUPER 도 봇 토큰 없으면 422 / 켜짐(DB) — 허용 IP 밖이면 운영 API 403 IP_VERIFY_REQUIRED · 회원 API 는 그대로 ·
     내 상태 required · 받을 곳 없음 · 번호 보내기 422 · 허용 IP 더하면 통과 · 통과 기록(오늘)이면 통과 · 어제 기록은 안 됨 · 받을 곳 바꾸기는 인증 뒤에만
  ③ (화면) 켜짐 · 허용 밖 주소 → 운영 화면 「접속 인증」(받을 곳 없음 줄) · 허용하면 운영 화면 · 「접속 인증」 탭(허용 IP · 운영자 줄)
  번호 받기 → 넣기 끝까지는 test_v1226_tg.py(가짜 텔레그램 · 서버에서).
  ★ 켜짐은 이 시험 안에서만 — 끝에 반드시 끔(다른 시험이 막히지 않게).
"""
import json, os, re, subprocess, time, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []
PW = 'sgb-dev-1234'
FAR = '203.0.113.26'     # 시험용 허용 밖 주소(문서용 대역)


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ──────────────────────────────────────────────────────────────
mig = sorted(d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d))) if os.path.isdir(os.path.join(K, 'prisma/migrations')) else []
M = rd('prisma/migrations/D195_staff_ip_verify/migration.sql')
ok('① D195 — 허용 IP(메모) · 인증번호(sha256 64자 · 5번) · 통과 기록(한국 날짜 · 고칠 수 없음) · 받을 곳(텔레그램 번호 형식) · admin.ip_verify off · 중요 설정 감시에 더함 · 지우는 문장 없음 · 233',
   'CREATE TABLE IF NOT EXISTS public.staff_ip_allow' in M and 'CHECK (length(code_hash) = 64)' in M and 'CHECK (tries BETWEEN 0 AND 5)' in M
   and 'PRIMARY KEY (account_id, ip, day)' in M and 'trg_staff_ip_passes_ro BEFORE UPDATE' in M and "telegram_chat ~ '^-?[0-9]{5,20}$'" in M
   and "('admin.ip_verify', 'off', 'ADMIN'" in M and "'mall.tenant', 'mall.tenant_apply', 'admin.ip_verify')" in M
   and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE)\b', M) and len(mig) >= 233 and 'D195_staff_ip_verify' in mig, f'{len(mig)} · {mig[-1] if mig else ""}')
SV, CT = rd('src/modules/identity/staff-ip.service.ts'), rd('src/modules/identity/staff-ip.controller.ts')
ok('① 서비스 — 오늘(한국) 통과 · 허용 IP · 5분 · 5번 · 15분 · 하루 10번 · sha256 · 개인 대화 없으면 운영 대화방 · 감사(번호 안 남김) · 켜기 전 검사',
   "day = (now() AT TIME ZONE 'Asia/Seoul')::date" in SV and 'FROM staff_ip_allow WHERE ip = $2::inet' in SV and 'const CODE_MIN = 5;' in SV and 'const MAX_TRIES = 5;' in SV
   and 'const LOCK_MIN = 15;' in SV and 'const DAY_MAX = 10;' in SV and "createHash('sha256')" in SV and "channel: 'TELEGRAM_OPS'" in SV
   and "'STAFF_IP_VERIFIED'" in SV and 'export async function assertStaffIpCanTurnOn' in SV and "'IP_VERIFY_NO_RECEIVER'" in SV, '')
AU, MW, AS = rd('src/core/auth.ts'), rd('src/modules/identity/auth.middleware.ts'), rd('src/modules/admin/admin.service.ts')
ok('① 가드 · 미들웨어 · 켜기 — 운영 역할만 요구하는 API 403 IP_VERIFY_REQUIRED · /auth/ip-verify* 는 로그인만 · 받을 곳 바꾸기는 운영 역할(인증 뒤) · 켜기 SUPER · 봇 토큰 · 받을 곳',
   "principal.ipPending && required.every((r) => MFA_OPS.includes(r))" in AU and "'IP_VERIFY_REQUIRED'" in AU and 'principal.ipPending = await this.staffIp.pending(principal)' in MW
   and "@Get('auth/ip-verify')" in CT and "@Post('auth/ip-verify/send')" in CT and "@Post('auth/ip-verify/confirm')" in CT
   and "@Put('me/staff/telegram')\n  @Roles(" in CT and "key === 'admin.ip_verify'" in AS and "'IP_VERIFY_SETTING_SUPER'" in AS and 'await assertStaffIpCanTurnOn(this.db)' in AS, '')
IG, SA, AP, AM, AA = rd('web/src/components/IpGate.tsx'), rd('web/src/app/admin/StaffAccess.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('web/src/lib/api.ts')
ok('① 운영 화면 — 인증 화면(받기 · 넣기 · 받을 곳 없음) · 2단계 다음 · 403 이면 다시 봄 · 「접속 인증」 탭(스위치 · 허용 IP · 운영자 · 기록) · 메뉴 권한 계층',
   'data-ip-gate=""' in IG and 'data-ip-send=""' in IG and 'data-ip-confirm=""' in IG and 'data-ip-noready=""' in IG
   and '<IpGate status={ipv} onDone={checkIp} />' in AP and "{tab === 'staff-access' && <StaffAccess />}" in AP and "'IP_VERIFY_REQUIRED') ipListeners" in AA
   and 'data-ip-allow=""' in SA and 'data-ip-staff=""' in SA and 'data-ip-toggle=""' in SA and 'data-my-chat=""' in SA
   and "tabs: ['roles', 'my-mfa', 'staff-access']" in AM and "screen: 'SB-ADM-SIP-010'" in AM, '')
SJ = json.loads(rd('spec/screens.json') or '{"screens":[]}'); sc = {s['id']: s for s in SJ.get('screens', [])}
EN = rd('src/common/i18n/server-text.en.ts')
ok('① 명세 SB-ADM-SIP-010(API 9) · 영어(접속 인증 글)',
   all(a in sc.get('SB-ADM-SIP-010', {}).get('apis', []) for a in ('GET /auth/ip-verify', 'POST /auth/ip-verify/send', 'POST /auth/ip-verify/confirm', 'PUT /me/staff/telegram',
       'GET /admin/staff-access', 'POST /admin/staff-access/allow', 'DELETE /admin/staff-access/allow/{id}', 'PUT /admin/staff-access/{id}/telegram', 'POST /admin/staff-access/{id}/test'))
   and '"처음 쓰는 곳에서 접속했습니다 — 접속 인증번호를 받아 넣어 주십시오.":' in EN and '"인증번호는 1분에 한 번 보낼 수 있습니다.":' in EN, '')
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('363_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 문서 363 · 판 v10.226 이상', bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 226), f'{DOC} · {rd("VERSION").strip()}')


# ── ② API · DB ─────────────────────────────────────────────────────────
def call(m_, p, b=None, t=None, ip=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    if ip: hd['X-Forwarded-For'] = ip
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        raw = urllib.request.urlopen(r, timeout=120).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b'{}')
        except Exception:
            body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return r.stdout.strip() if not r.returncode else ('!' + r.stderr.strip()[:200])


stamp = str(int(time.time()))[-7:]
STF = f't1226adm{stamp}@x.com'
seen = {}
if API and DB:
    import sys
    sys.path.insert(0, HERE)
    import consent_ok
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{STF}', '시험운영1226', '{pw}', now()) ON CONFLICT DO NOTHING")
    sid = psql(f"SELECT id FROM accounts WHERE email = '{STF}'")
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 T1226', true); INSERT INTO account_roles(account_id, role) VALUES ('{sid}', 'ADMIN') ON CONFLICT DO NOTHING; COMMIT;")
    for e in (STF, 'admin@x.com', 'buyer@x.com'): consent_ok.agree(e, PW)
    login = lambda e: call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')
    TS, TA, TB = login('admin@x.com'), login(STF), login('buyer@x.com')
    v0 = psql("SELECT value FROM site_settings WHERE key = 'admin.ip_verify'")
    hasTok = psql("SELECT count(*) FROM integration_secrets WHERE integration_code = 'MAIL' AND name = 'TELEGRAM_BOT_TOKEN'")

    def turn_off():
        """API 로 끔(설정 30초 메모리를 바로 비움) — 켜져 있으면 운영 API 가 막히므로 127.0.0.1 을 잠깐 허용"""
        psql("INSERT INTO staff_ip_allow (ip, memo) VALUES ('127.0.0.1', '시험 1226 끄기') ON CONFLICT DO NOTHING")
        r = call('PATCH', '/admin/site-settings', {'key': 'admin.ip_verify', 'value': 'off'}, TS, '127.0.0.1')
        psql("DELETE FROM staff_ip_allow WHERE memo LIKE '시험 1226%'")
        return r

    def turn_on_db():
        """켜기 검사(봇 토큰)를 거치지 않고 DB 로 켬 — 먼저 API 로 off 저장해 메모리를 비운 뒤"""
        call('PATCH', '/admin/site-settings', {'key': 'admin.ip_verify', 'value': 'off'}, TS)
        psql("UPDATE site_settings SET value = 'on' WHERE key = 'admin.ip_verify'")
    try:
        g0 = call('GET', '/admin/ops-alerts', None, TA, FAR)
        st0 = call('GET', '/auth/ip-verify', None, TA, FAR)
        a1 = call('PATCH', '/admin/site-settings', {'key': 'admin.ip_verify', 'value': 'on'}, TA)
        a2 = call('PATCH', '/admin/site-settings', {'key': 'admin.ip_verify', 'value': 'on'}, TS)
        ok('② 꺼짐 — 허용 밖 주소도 운영 API 그대로 · 상태 required false · 켜기 ADMIN 403 · SUPER 도 봇 토큰 없으면 422 IP_VERIFY_NO_TELEGRAM',
           g0.get('_err') is None and st0.get('required') is False and st0.get('verified') is True and a1.get('code') == 'IP_VERIFY_SETTING_SUPER'
           and (a2.get('code') == 'IP_VERIFY_NO_TELEGRAM' or hasTok != '0'), f"{g0.get('_err')} · {st0} · {a1.get('code')} · {a2.get('code')} · 토큰 {hasTok}")

        turn_on_db()
        g1 = call('GET', '/admin/ops-alerts', None, TA, FAR)
        b1 = call('GET', '/me/summary', None, TB, FAR)
        st1 = call('GET', '/auth/ip-verify', None, TA, FAR)
        s1 = call('POST', '/auth/ip-verify/send', None, TA, FAR)
        t1 = call('PUT', '/me/staff/telegram', {'chat': '123456789'}, TA, FAR)
        ok('② 켜짐 · 허용 밖 — 운영 API 403 IP_VERIFY_REQUIRED · 회원 API(회원 내 요약)는 그대로 · 상태 required · 안 됨 · 가린 주소 · 받을 곳 없으면 보내기 422 · 받을 곳 바꾸기도 403(인증 뒤에만)',
           g1.get('code') == 'IP_VERIFY_REQUIRED' and b1.get('_err') is None and st1.get('required') is True and st1.get('verified') is False
           and st1.get('ip') == '203.0.*.*' and st1.get('ready') is False and s1.get('code') == 'IP_VERIFY_NO_CHANNEL' and t1.get('code') == 'IP_VERIFY_REQUIRED',
           f"{g1.get('code')} · {b1.get('_err')} · {st1} · {s1.get('code')} · {t1.get('code')}")

        psql(f"INSERT INTO staff_ip_allow (ip, memo) VALUES ('{FAR}', '시험 1226 허용')")
        g2 = call('GET', '/admin/ops-alerts', None, TA, FAR)
        g2b = call('GET', '/admin/ops-alerts', None, TA, '203.0.113.27')
        psql("DELETE FROM staff_ip_allow WHERE memo = '시험 1226 허용'")
        psql(f"INSERT INTO staff_ip_passes (account_id, ip, day, channel) VALUES ('{sid}', '203.0.113.28', (now() AT TIME ZONE 'Asia/Seoul')::date - 1, 'TELEGRAM_OPS')")
        g3 = call('GET', '/admin/ops-alerts', None, TA, '203.0.113.28')
        psql(f"INSERT INTO staff_ip_passes (account_id, ip, day, channel) VALUES ('{sid}', '203.0.113.28', (now() AT TIME ZONE 'Asia/Seoul')::date, 'TELEGRAM_OPS')")
        g4 = call('GET', '/admin/ops-alerts', None, TA, '203.0.113.28')
        g5 = call('GET', '/admin/ops-alerts', None, TS, '203.0.113.28')
        up = psql(f"UPDATE staff_ip_passes SET day = day + 1 WHERE account_id = '{sid}'")
        ok('② 허용 IP 면 통과(옆 주소는 아님) · 어제 인증은 안 됨 · 오늘 인증이면 통과 · 그 운영자만(다른 운영자는 막힘) · 통과 기록 고칠 수 없음',
           g2.get('_err') is None and g2b.get('code') == 'IP_VERIFY_REQUIRED' and g3.get('code') == 'IP_VERIFY_REQUIRED' and g4.get('_err') is None
           and g5.get('code') == 'IP_VERIFY_REQUIRED' and up.startswith('!'), f"{g2.get('_err')} · {g2b.get('code')} · {g3.get('code')} · {g4.get('_err')} · {g5.get('code')} · {up[:60]}")

        # ③ 화면 — 운영 화면이 허용 밖 주소로 부르게(브라우저 요청에 X-Forwarded-For)
        try:
            from playwright.sync_api import sync_playwright
        except Exception:
            sync_playwright = None
        if ADMIN_WEB and sync_playwright:
            errs = []
            with sync_playwright() as p:
                b = p.chromium.launch()
                pg = b.new_page(viewport={'width': 1400, 'height': 900})
                pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                pg.route('**/api/**', lambda r: r.continue_(headers={**r.request.headers, 'x-forwarded-for': FAR}))
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                gate = (pg.locator('[data-ip-gate]').count(), pg.locator('[data-ip-noready]').count(), '203.0.*.*' in (pg.locator('[data-ip-gate]').inner_text() if pg.locator('[data-ip-gate]').count() else ''))
                pg.screenshot(path=os.path.join(HERE, 'v1226_ip_gate.png'), full_page=False)
                psql(f"INSERT INTO staff_ip_allow (ip, memo) VALUES ('{FAR}', '시험 1226 화면')")
                pg.goto(ADMIN_WEB + '/#/staff-access', wait_until='networkidle', timeout=120000)
                pg.reload(wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                tab = (pg.locator('[data-ip-gate]').count(), pg.locator('[data-staff-access]').count(), pg.locator(f'[data-ip-allow-row="{FAR}"]').count(),
                       pg.locator(f'[data-ip-staff-row="{STF}"]').count(), pg.locator('[data-ip-on="1"]').count())
                pg.screenshot(path=os.path.join(HERE, 'v1226_staff_access.png'), full_page=True)
                b.close()
            psql("DELETE FROM staff_ip_allow WHERE memo = '시험 1226 화면'")
            ok('③ 켜짐 · 허용 밖 — 로그인하면 운영 화면 대신 「접속 인증」(가린 주소 · 받을 곳 없음 줄)', gate == (1, 1, True), str(gate))
            ok('③ 허용하면 운영 화면 · 「접속 인증」 탭 — 켜짐 · 허용 IP 줄 · 시험 운영자 줄 · 화면 오류 없음', tab == (0, 1, 1, 1, 1) and not errs, f'{tab} · {errs[:2]}')
        else:
            ok('③ 화면 — playwright · ADMIN_WEB 필요', False, '없음')
    except Exception as ex:
        ok('② · ③ 진행 중 예외 없음', False, str(ex)[:200])
    finally:
        off = turn_off()
        psql(f"UPDATE site_settings SET value = '{v0 or 'off'}' WHERE key = 'admin.ip_verify'")
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 T1226 정리', true); DELETE FROM account_roles WHERE account_id = '{sid}' AND role = 'ADMIN'; COMMIT;")
    g9 = call('GET', '/admin/ops-alerts', None, TS, FAR)
    ok('끝 — 끔(API · 바로) · 허용 밖 주소도 운영 API 그대로 · 시험 허용 IP 없음 · 시험 운영자 역할 뺌',
       off.get('_err') is None and g9.get('_err') is None and psql("SELECT value FROM site_settings WHERE key = 'admin.ip_verify'") == (v0 or 'off')
       and psql("SELECT count(*) FROM staff_ip_allow WHERE memo LIKE '시험 1226%'") == '0'
       and psql(f"SELECT count(*) FROM account_roles WHERE account_id = '{sid}' AND role = 'ADMIN'") == '0', f"{off.get('_err')} {off.get('code')} · {g9.get('_err')}")
else:
    print('  (API · DB 없음 — ② · ③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
