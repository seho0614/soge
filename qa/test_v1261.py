"""v10.261 ~ v10.266 (docs/395) — 시뮬레이터 · 포인트 출금 준비 점검 · 약관 새 판 미리보기 · 알림 길 켜기 도우미 · 신청서 묶음 · 2단계 인증 켜기 흐름

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1261.py

  ① (코드) 6판 — 시뮬레이터(계산만 · 원천징수 나눔) · 점검 API taxRate · cashoutMin · 출금 준비 점검(API 읽기만 · 5줄 · 2인 원칙) · 약관 비교 기준(지금 시행 판) · 나란히 ·
     알림 길 도우미(3길 · 시험 단추 · 같은 API) · 신청서 값(운영 설정 · 받는 주소 · 키 이름 · 복사) · 2단계 켜기 흐름(3단계) · 명세 · 문서 395 · 마이그레이션 243 · 판 v10.266 이상
  ② (API · DB) 출금 준비 점검 — 5줄 · 원천징수율 비면 NO · 넣으면 OK · 확정 · 지급 다른 사람 = DB · ADMIN · PAYOUT 봄 · 회원 403 · 읽기만 ·
     켜기 전 점검에 taxRate · cashoutMin(= 설정) · 진행표 apply(= 운영 설정) · 회원 403
  ③ (화면) 운영 화면 — 추천 관계도 시뮬레이션(입력 → 계산 = 같은 식) · 지급 화면 준비 점검 · 운영 알림 「알림 길 켜기 도우미」 3줄 ·
     외부 연동 「신청서 값」(PASS · 받는 주소 · 키 이름) · 내 2단계 인증 「켜는 순서」 · 화면 오류 없음
  두 번 돌아도 통과 — 바꾼 설정은 끝나면 원래대로.
"""
import json, os, re, subprocess, urllib.error, urllib.request
# v10.260 — 혼자 돌려도(새 DB) 시험 회원이 약관 동의 화면으로 가지 않게 · 실패해도 멈추지 않음(consent_ok)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'
RPW = 'sgb-test-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


VER = rd('VERSION').strip()
AR, RS, RC = rd('web/src/app/admin/affiliates/Recommend.tsx'), rd('src/modules/affiliate/recommend.service.ts'), rd('src/modules/affiliate/recommend.controller.ts')
PS, PC, PY = rd('src/modules/settlement/payout.service.ts'), rd('src/modules/settlement/payout.controller.ts'), rd('web/src/app/admin/Payouts.tsx')
TP, OA, IT, MM = rd('web/src/app/admin/TermsPanel.tsx'), rd('web/src/app/admin/OpsAlerts.tsx'), rd('web/src/app/admin/Integrations.tsx'), rd('web/src/app/admin/MyMfa.tsx')
SV, CT, SPEC = rd('src/modules/site/site.service.ts'), rd('src/modules/site/site.controller.ts'), rd('spec/screens.json')

ok('① v10.261 시뮬레이터 — 계산만(api PUT 없음) · 지금 규칙 · 상한 · 원천징수(율 ÷ 1.1 · 10원 버림 · 지방 10%) · 최소 출금 · 점검 API taxRate · cashoutMin',
   'function RewardSim()' in AR and 'data-rcm-sim=' in AR and 'Math.floor(amt * (rate / 1.1) / 100 / 10) * 10' in AR and 'Math.floor(inc * 0.1 / 10) * 10' in AR
   and 'api(' not in AR[AR.index('function RewardSim()'):AR.index('/** 켜기 전 점검 상자')] and "taxRate: st?.tax_rate ?? null, cashoutMin: st?.min ?? 10000" in RS and 'cashoutMin:' in RC, '')
seg = PS[PS.index('async pointReadiness()'):PS.index('async confirm(')] if 'async pointReadiness()' in PS else ''
ok('① v10.262 출금 준비 점검 — API 읽기만(SELECT) · 5줄 · 2인 원칙(확정 ADMIN · SUPER ↔ 지급 PAYOUT · SUPER 다른 사람) · 처리방침 줄 · 지급 화면 상자',
   bool(seg) and not re.search(r'\b(UPDATE|INSERT|DELETE)\b', seg) and all(f"key: '{k}'" in seg for k in ('TAX_RATE', 'MIN', 'TWO_PEOPLE', 'TAX_ID', 'PRIVACY'))
   and 'confirmers.some((c) => payers.some((p) => p.id !== c.id))' in seg and "@Get('point-readiness')" in PC and 'function PointReadiness()' in PY and 'data-point-ready=' in PY, '')
ok('① v10.263 약관 새 판 미리보기 — 비교 기준(고치기 시작한 글 · 지금 시행 중 판) · 뺀 줄 ↔ 더한 줄 나란히 · 옛 손잡이 그대로',
   'function inForce(' in TP and 'data-term-diff-current' in TP and 'data-term-diff-orig' in TP and 'data-term-diff-col="minus"' in TP and 'data-term-diff-col="plus"' in TP
   and 'data-term-diff-count=' in TP and all(x in TP for x in ('data-term-diff-btn', 'data-term-diff={d.length}', 'data-diff-line="+"', 'function lineDiff')), '')
ok('① v10.264 알림 길 도우미 — 메일 · 텔레그램 · 슬랙 · 값 → 시험 성공 → 받는 중 · 시험 단추는 같은 API(mail · push · slack-test) · 두 길 이상 권함',
   'function ChannelGuide(' in OA and 'data-channel-guide=' in OA and 'data-channel-row={r.k}' in OA and 'data-channel-test={r.k}' in OA
   and 'onTest={{ mail: mailTest, telegram: pushTest, slack: slackTest }}' in OA, '')
ok('① v10.265 신청서 묶음 — 운영 설정(footer.* · site.base_url · infra.egress_ip) · 받는 주소 · 키 이름(코드 이름) · 복사 · 진행표 줄마다',
   "'footer.company_name:company', 'footer.biz_reg_no:biz_no'" in SV and "'infra.egress_ip:egress_ip'" in SV and 'apply: { company:' in SV and 'apply: { type:' in CT
   and 'const APPLY_INFO' in IT and "returnPath: '/verify/return'" in IT and "'NICE_CLIENT_ID', 'NICE_CLIENT_SECRET', 'NICE_PRODUCT_ID'" in IT and 'data-int-apply-btn={r.code}' in IT and 'data-int-copy=' in IT, '')
ok('① v10.266 2단계 켜기 흐름 — 내 등록 → 켜기 전 점검 → 켜기 · 꺼짐이면 최고 관리자만 먼저 · 켜져 있으면 모두로 넓히기',
   'data-mfa-flow=' in MM and "const target = s.mode === 'off' ? 'SUPER' : s.mode === 'SUPER' ? 'ALL' : ''" in MM and 'data-mfa-flow-check=' in MM and 'data-mfa-flow-enroll=' in MM, '')
D395 = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('395_')] if os.path.isdir(os.path.join(K, 'docs')) else []
mig = [d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isfile(os.path.join(K, 'prisma/migrations', d, 'migration.sql'))] if os.path.isdir(os.path.join(K, 'prisma/migrations')) else []
ok('① 명세(출금 준비 점검 API) · 문서 395 · 마이그레이션 없음(243) · 판 v10.266 이상',
   '"GET /admin/payouts/point-readiness"' in SPEC and bool(D395) and len(mig) in (243, 244, 245, 246) and tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 266), f'{D395} · {len(mig)} · {VER}')


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        raw = urllib.request.urlopen(r, timeout=120).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b'{}')
        except Exception:
            body = {}
        return {'_err': e.code, 'code': body.get('code')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return r.stdout.strip() if not r.returncode else ('!' + r.stderr.strip()[:200])


def q(v):
    return 'NULL' if v in (None, '') else "'" + v.replace("'", "''") + "'"


if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    TA = call('POST', '/auth/login', {'email': 'ops@t.local', 'password': RPW}).get('accessToken')
    TP_ = call('POST', '/auth/login', {'email': 'payout@t.local', 'password': RPW}).get('accessToken')
    TB = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW}).get('accessToken')
    rate0 = psql("SELECT value FROM site_settings WHERE key = 'point.cashout_tax_rate'")
    try:
        # ── ② 출금 준비 점검 ──
        psql("UPDATE site_settings SET value = NULL WHERE key = 'point.cashout_tax_rate'")
        r1 = call('GET', '/admin/payouts/point-readiness', None, TS)
        it1 = {x['key']: x for x in r1.get('items') or []}
        two = psql("""SELECT EXISTS (SELECT 1 FROM (SELECT a.id FROM accounts a JOIN account_roles r ON r.account_id = a.id WHERE a.status = 'ACTIVE' AND r.role IN ('ADMIN', 'SUPER')) c
                       JOIN (SELECT a.id FROM accounts a JOIN account_roles r ON r.account_id = a.id WHERE a.status = 'ACTIVE' AND r.role IN ('PAYOUT', 'SUPER')) p ON p.id <> c.id)::text""")
        ok('② 5줄 · 원천징수율 비면 NO · 준비 안 됨 · 확정 · 지급 다른 사람 = DB',
           len(it1) == 5 and it1.get('TAX_RATE', {}).get('level') == 'NO' and r1.get('ready') is False
           and (it1.get('TWO_PEOPLE', {}).get('level') == 'OK') == (two == 'true'), f"{[(k, v['level']) for k, v in it1.items()]} · {two}")
        psql("UPDATE site_settings SET value = '3.3' WHERE key = 'point.cashout_tax_rate'")
        r2 = call('GET', '/admin/payouts/point-readiness', None, TS)
        it2 = {x['key']: x for x in r2.get('items') or []}
        db_open = psql("SELECT count(*) FILTER (WHERE status = 'REQUESTED') || '|' || count(*) FILTER (WHERE status = 'CONFIRMED') FROM point_cashouts")
        ok('② 원천징수율 3.3 → OK · 처리 중 신청 수 = DB · ADMIN · PAYOUT 봄 · 회원 403',
           it2.get('TAX_RATE', {}).get('level') == 'OK' and it2.get('TAX_RATE', {}).get('value') == '3.3%'
           and f"{(r2.get('open') or {}).get('requested')}|{(r2.get('open') or {}).get('confirmed')}" == db_open
           and call('GET', '/admin/payouts/point-readiness', None, TA).get('_err') is None and call('GET', '/admin/payouts/point-readiness', None, TP_).get('_err') is None
           and call('GET', '/admin/payouts/point-readiness', None, TB).get('_err') == 403, f"{r2.get('open')} · DB {db_open}")
        c1 = call('GET', '/admin/affiliates/recommend-reward/check', None, TS)
        mn = psql("SELECT coalesce(nullif(value, '')::int, 10000) FROM site_settings WHERE key = 'point.cashout_min'") or '10000'
        p1 = call('GET', '/admin/integrations/progress', None, TS)
        st = dict(x.split('=', 1) for x in psql("SELECT string_agg(key || '=' || coalesce(value, ''), E'\\n') FROM site_settings WHERE key IN ('footer.company_name', 'footer.biz_reg_no', 'infra.egress_ip')").split('\n') if '=' in x)
        ap = p1.get('apply') or {}
        ok('② 켜기 전 점검 taxRate · cashoutMin = 설정 · 진행표 apply = 운영 설정(상호 · 사업자번호 · 발신 IP) · 진행표 회원 403',
           c1.get('taxRate') == '3.3' and str(c1.get('cashoutMin')) == mn
           and (ap.get('company') or '') == st.get('footer.company_name', '').strip() and (ap.get('bizNo') or '') == st.get('footer.biz_reg_no', '').strip()
           and (ap.get('egressIp') or '') == st.get('infra.egress_ip', '').strip() and call('GET', '/admin/integrations/progress', None, TB).get('_err') == 403,
           f"{c1.get('taxRate')} · {c1.get('cashoutMin')}/{mn} · {ap}")

        # ── ③ 운영 화면 ──
        try:
            from playwright.sync_api import sync_playwright
        except Exception:
            sync_playwright = None
        if ADMIN_WEB and sync_playwright:
            seen, errs = {}, []
            try:
                with sync_playwright() as p:
                    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 1000})
                    pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                    pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                    pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                    pg.wait_for_selector('[data-state-check]', timeout=30000)
                    # 시뮬레이션 — 10명 · 한 달 2명 · 50% · 3달 · 점수 1000 · 상한 비움
                    pg.goto(ADMIN_WEB + '/#/affiliates', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(1500)
                    pg.locator('button[role=tab][data-screen="SB-AFF-RCM-010"]').click(); pg.wait_for_timeout(2000)
                    for k, v in (('inviters', '10'), ('perMonth', '2'), ('verifyPct', '50'), ('months', '3'), ('points', '1000')):
                        pg.fill(f'[data-rcm-sim-in="{k}"]', v)
                    pg.wait_for_timeout(300)
                    seen['sim'] = pg.locator('[data-rcm-sim]').first.get_attribute('data-rcm-sim') if pg.locator('[data-rcm-sim]').count() else None
                    pg.goto(ADMIN_WEB + '/#/payouts', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2000)
                    seen['ready'] = pg.locator('[data-point-ready]').count()
                    if seen['ready'] and not pg.locator('[data-point-ready-item]').count():
                        pg.locator('[data-point-ready] button', has_text='펼치기').click(); pg.wait_for_timeout(300)
                    seen['readyItems'] = pg.locator('[data-point-ready-item]').count()
                    pg.goto(ADMIN_WEB + '/#/ops-alerts', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2000)
                    seen['guide'] = pg.locator('[data-channel-guide]').count()
                    seen['guideRows'] = pg.locator('[data-channel-row]').count()
                    pg.goto(ADMIN_WEB + '/#/integrations', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                    btn = pg.locator('[data-int-apply-btn="PASS"]')
                    if btn.count():
                        btn.click(); pg.wait_for_timeout(500)
                    box = pg.locator('[data-int-apply="PASS"]')
                    seen['apply'] = box.count()
                    seen['applyText'] = box.first.inner_text()[:600] if box.count() else ''
                    pg.goto(ADMIN_WEB + '/#/my-mfa', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2000)
                    seen['mfaMode'] = pg.locator('[data-mfa-mode]').first.get_attribute('data-mfa-mode') if pg.locator('[data-mfa-mode]').count() else None
                    seen['mfaFlow'] = pg.locator('[data-mfa-flow]').count()
                    seen['mfaSteps'] = pg.locator('[data-mfa-flow-step]').count()
                    b.close()
            except Exception as ex:
                errs.append(str(ex)[:160])
            exp_sim = f'{10 * 1000}|{10 * 1000 * 3}|1000'
            mfa_ok = (seen.get('mfaFlow') == 1 and seen.get('mfaSteps') == 3) if seen.get('mfaMode') in ('off', 'SUPER') else seen.get('mfaFlow') == 0
            ok('③ 운영 화면 — 시뮬레이션(10명 · 2명 · 50% · 3달 · 1000점 → 한 달 10,000 · 3달 30,000 · 한 사람 1,000) · 출금 준비 점검 5줄 · 알림 길 도우미 3줄 · '
               '신청서 값(PASS · 받는 주소 /verify/return · NICE_CLIENT_ID) · 2단계 켜는 순서 3단계 · 화면 오류 없음',
               seen.get('sim') == exp_sim and seen.get('ready') == 1 and seen.get('readyItems') == 5 and seen.get('guide') == 1 and seen.get('guideRows') == 3
               and seen.get('apply') == 1 and '/verify/return' in seen.get('applyText', '') and 'NICE_CLIENT_ID' in seen.get('applyText', '') and mfa_ok and not errs,
               f"{ {k: v for k, v in seen.items() if k != 'applyText'} } · {errs[:2]}")
        else:
            print('  (운영 화면 · playwright 없음 — ③ 건너뜀)')
    finally:
        psql(f"UPDATE site_settings SET value = {q(rate0)} WHERE key = 'point.cashout_tax_rate'")
    ok('되돌림 — 원천징수율', psql("SELECT value FROM site_settings WHERE key = 'point.cashout_tax_rate'") == rate0, rate0)

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
