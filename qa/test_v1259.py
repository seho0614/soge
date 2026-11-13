"""v10.259 · v10.260 (docs/392 · 393) — 추천 보상 켜기 전 점검 · 외부 연동 신청 진행표 · 처리방침 1.1 초안 · 시험 혼자 돌기

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1259.py

  ① (코드) 켜기 전 점검(API 읽기만 · 7줄 · OK · WARN · NO · 어림) · 운영 화면 상자 · D205(칸 4개 · 지우는 문장 없음) · 진행표 API · 날짜 받기 ·
     LIVE 로 바꾸면 live_at · 운영 화면 진행표 · 대표 할 일 줄 · 명세 · 문서 392 · 393 · 혼자 돌기(consent_ok.agree_seed · 시험 20개) · 마이그레이션 243 · 판 v10.260 이상
  ② (API · DB) 켜기 전 점검 — 7줄 · 점검판은 본인인증 STUB → NO · 준비 안 됨 · 같은 사람 여러 계정 block 이면 OK · 한 달 상한 넣으면 OK ·
     어림(기다림 = DB · 상한이면 한 사람 몫 상한까지) · ADMIN 봄 · 회원 403 · 읽기만(규칙 그대로)
  ③ (API · DB) 진행표 — 연동 수 = DB · 업종 정정 없으면 BIZ 「지금」 · 날짜 적기(신청 · 키 · 시험) → 단계 「됨」 · 비-IP 연동은 IP 칸 없음 ·
     LIVE 로 바꾸면 live_at 오늘 · 「운영 중」 · 업종 정정 날짜 넣으면 BIZ 됨 · 회원 403 · 끝나면 되돌림
  ④ (화면) 운영 화면 — 추천 관계도 「켜기 전 점검」 상자(줄 7 · 위험 표시 · 어림) · 외부 연동 「신청 진행표」(줄 = 연동 수 · 칸)
  두 번 돌아도 통과 — 바꾼 설정 · 연동 값은 끝나면 원래대로.
"""
import json, os, re, subprocess, time, urllib.error, urllib.request
# v10.260 — 혼자 돌려도(새 DB) 시험 회원이 약관 동의 화면으로 가지 않게 · 실패해도 멈추지 않음(consent_ok)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB = os.environ.get('ADMIN_WEB')
HERE = os.path.dirname(os.path.abspath(__file__))
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
# ── ① 코드 ──────────────────────────────────────────────────────────────
RS, RC, AR = rd('src/modules/affiliate/recommend.service.ts'), rd('src/modules/affiliate/recommend.controller.ts'), rd('web/src/app/admin/affiliates/Recommend.tsx')
SV, CT, DT = rd('src/modules/site/site.service.ts'), rd('src/modules/site/site.controller.ts'), rd('src/modules/site/site.dto.ts')
IT, OT, MG = rd('web/src/app/admin/Integrations.tsx'), rd('src/modules/admin/owner-todo.service.ts'), rd('prisma/migrations/D205_integration_progress/migration.sql')
SPEC = rd('spec/screens.json')

ok('① 켜기 전 점검 API — 읽기만(SELECT 만) · 7줄(점수 · 상한 · 본인인증 · 같은 사람 · 처리방침 「추천」 · 원천징수율 · 주민등록번호) · OK · WARN · NO · 어림',
   'async turnOnCheck()' in RS and all(f"key: '{k}'" in RS for k in ('POINTS', 'CAP', 'IDENTITY', 'CI_DUPLICATE', 'PRIVACY', 'CASHOUT_TAX', 'CASHOUT_TAX_ID'))
   and "body ILIKE '%추천%' FROM v_terms_current WHERE code = 'PRIVACY'" in RS and "provider === 'NICE' ? 'OK' : 'NO'" in RS
   and 'waitingPoints: capped(wait)' in RS and "@Get('admin/affiliates/recommend-reward/check')" in RC and "@Roles('ADMIN', 'PARTNER_AFF')" in RC
   and 'UPDATE' not in RS[RS.index('async turnOnCheck()'):RS.index('async setRewardRule(')], '')
ok('① 운영 화면 — 「켜기 전 점검」 상자(꺼져 있으면 펼침 · 줄 · 위험 수 · 어림) · 「확인」 색',
   'function RewardCheck(' in AR and "useApi<Check>('/admin/affiliates/recommend-reward/check')" in AR and 'data-rcm-check=' in AR
   and 'data-rcm-check-item={x.key}' in AR and 'data-rcm-estimate=' in AR and 'useState(!on)' in AR and '.st.warn{color:var(--sgb-or-text)}' in rd('web/src/styles/app.css'), '')
ok('① D205 — integrations 칸 4개(applied_at · key_at · tested_at · live_at) · 처음 채움 · 지우는 문장 없음 · 재실행 안전',
   all(f'ADD COLUMN IF NOT EXISTS {c}' in MG for c in ('applied_at', 'key_at', 'tested_at', 'live_at'))
   and "SET live_at = updated_at WHERE status = 'LIVE' AND live_at IS NULL" in MG and not re.search(r'\b(DROP|DELETE|TRUNCATE)\b', MG), '')
ok('① 진행표 API — 업종 정정(mall.biz_report_at) → 신청 → IP 신청 · 승인(IP 필요만) → 키 → 시험 → LIVE · 다음에 할 일 · 날짜 받기 · LIVE 면 live_at',
   'async integrationProgress()' in SV and "key = 'mall.biz_report_at'" in SV and "...(r.requires_ip ? [{ key: 'IP_REQ'" in SV
   and "live_at = coalesce($13::timestamptz, live_at, CASE WHEN $2 = 'LIVE' THEN now() END)" in SV and "@Get('integrations/progress')" in CT
   and all(f'@IsDateString() {k}?: string' in DT for k in ('appliedAt', 'keyAt', 'testedAt', 'liveAt')), '')
ok('① 운영 화면 진행표(칸 7 · 지금 · 해당 없음 · 업종 정정 안내) · 날짜 칸(업체 신청일 · 키 받은 날 · 시험 성공일) · 대표 할 일 줄 · 명세',
   'function ProgressTable(' in IT and 'data-int-progress=' in IT and 'data-int-row={r.code}' in IT and 'data-int-step={k}' in IT and 'data-int-biz="none"' in IT
   and all(f'data-int-{k}={{r.code}}' in IT for k in ('applied', 'keyat', 'tested')) and '업체 신청 ${ig.applied}' in OT
   and SPEC.count('"GET /admin/integrations/progress"') >= 1 and '"GET /admin/affiliates/recommend-reward/check"' in SPEC, '')
D392 = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('392_')] if os.path.isdir(os.path.join(K, 'docs')) else []
D393 = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('393_')] if os.path.isdir(os.path.join(K, 'docs')) else []
d393 = rd('docs/' + D393[0]) if D393 else ''
ok('① 문서 392 · 393(처리방침 1.1 초안 — 추천 관계 · 주민등록번호 줄 · 법무에 물을 것 · 게시는 법무 뒤)',
   bool(D392) and '### 추천 코드로 가입하실 때' in d393 and '### 포인트를 출금하실 때' in d393 and '## 4. 법무에 물을 것' in d393 and '900101' not in d393, f'{D392} · {D393}')
SOLO = 'test_v1120 test_v1128 test_v1129 test_v1131 test_v1132 test_v1135 test_v1137 test_v1139 test_v1143 test_v1145 test_v1151 test_v1159 test_v1161 test_v1164 test_v1165 test_v1166 test_v1167 test_v1168 test_v1189 test_v1220'.split()
co = open(os.path.join(HERE, 'consent_ok.py'), encoding='utf-8').read()
solo_ok = [t for t in SOLO if "__import__('consent_ok').agree_seed()" in open(os.path.join(HERE, t + '.py'), encoding='utf-8').read()]
mig = [d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isfile(os.path.join(K, 'prisma/migrations', d, 'migration.sql'))] if os.path.isdir(os.path.join(K, 'prisma/migrations')) else []
ok('① 혼자 돌기 — consent_ok.agree_seed(시험 회원 넷) · 화면 시험 20개 맨 위 · 마이그레이션 243 · 판 v10.260 이상',
   'def agree_seed(' in co and len(solo_ok) == len(SOLO) and len(mig) in (243, 244, 245, 246) and tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 260),
   f'{len(solo_ok)}/{len(SOLO)} · {len(mig)} · {VER}')


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
    TB = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW}).get('accessToken')
    rule0 = psql("SELECT is_active::text || '|' || points || '|' || coalesce(monthly_cap::text, '') FROM point_rules WHERE code = 'REFERRAL_DIRECT'")
    dup0 = psql("SELECT value FROM site_settings WHERE key = 'identity.ci_duplicate'")
    biz0 = psql("SELECT value FROM site_settings WHERE key = 'mall.biz_report_at'")
    esign0 = psql("SELECT status || '|' || coalesce(applied_at::text, '') || '|' || coalesce(key_at::text, '') || '|' || coalesce(tested_at::text, '') || '|' || coalesce(live_at::text, '') || '|' || coalesce(ip_requested_at::text, '') FROM integrations WHERE code = 'ESIGN'")
    try:
        # ── ② 켜기 전 점검 ──
        c1 = call('GET', '/admin/affiliates/recommend-reward/check', None, TS)
        items = {x['key']: x for x in c1.get('items') or []}
        prov = (psql("SELECT coalesce(value, 'STUB') FROM site_settings WHERE key = 'identity.provider'") or 'STUB').upper()
        ok('② 7줄 · 점검판 본인인증이 NICE 가 아니면 NO · 준비 안 됨 · 수 맞음',
           len(items) == 7 and (items.get('IDENTITY', {}).get('level') == ('OK' if prov == 'NICE' else 'NO')) and c1.get('ready') == (prov == 'NICE' and all(x['level'] != 'NO' for x in items.values()))
           and sum((c1.get('counts') or {}).values()) == 7, f"{prov} · {[(k, v['level']) for k, v in items.items()]}")
        psql("UPDATE site_settings SET value = 'block' WHERE key = 'identity.ci_duplicate'")
        psql("UPDATE point_rules SET monthly_cap = 3 WHERE code = 'REFERRAL_DIRECT'")
        c2 = call('GET', '/admin/affiliates/recommend-reward/check', None, TS)
        it2 = {x['key']: x for x in c2.get('items') or []}
        db_wait = psql("SELECT coalesce(sum(n), 0) || '|' || coalesce(sum(least(n, 3)), 0) FROM (SELECT count(*) AS n FROM introducer_referrals r JOIN accounts a ON a.id = r.invitee_id WHERE r.rewarded_at IS NULL AND a.identity_verified_at IS NULL GROUP BY r.inviter_id) x")
        pts = int(psql("SELECT points FROM point_rules WHERE code = 'REFERRAL_DIRECT'") or 0)
        est = c2.get('estimate') or {}
        ok('② 같은 사람 여러 계정 block → OK · 한 달 상한 3 → OK · 어림 기다림 = DB · 포인트 = 한 사람 몫 상한 3까지 × 점수',
           it2.get('CI_DUPLICATE', {}).get('level') == 'OK' and it2.get('CAP', {}).get('level') == 'OK' and it2.get('CAP', {}).get('value') == '한 달 3건'
           and f"{est.get('waiting')}|{(est.get('waitingPoints') or 0) // max(pts, 1)}" == db_wait, f'{est} · DB {db_wait} · {pts}')
        ok('② ADMIN 봄 · 회원 403 · 읽기만(규칙 is_active · points 그대로)',
           call('GET', '/admin/affiliates/recommend-reward/check', None, TA).get('_err') is None
           and call('GET', '/admin/affiliates/recommend-reward/check', None, TB).get('_err') == 403
           and psql("SELECT is_active::text || '|' || points FROM point_rules WHERE code = 'REFERRAL_DIRECT'") == '|'.join(rule0.split('|')[:2]), rule0)

        # ── ③ 진행표 ──
        psql("UPDATE site_settings SET value = NULL WHERE key = 'mall.biz_report_at'")
        psql("UPDATE integrations SET status = 'NOT_STARTED', applied_at = NULL, key_at = NULL, tested_at = NULL, live_at = NULL, ip_requested_at = NULL WHERE code = 'ESIGN'")
        p1 = call('GET', '/admin/integrations/progress', None, TS)
        rows = {r['code']: r for r in p1.get('rows') or []}
        e1 = rows.get('ESIGN') or {}
        n_int = psql('SELECT count(*) FROM integrations')
        ok('③ 연동 수 = DB · 업종 정정 없음 → BIZ 지금 · 비-IP 연동(ESIGN)은 IP 칸 없음 · IP 연동(PASS)은 칸 7',
           str(len(rows)) == n_int and p1.get('bizReportAt') is None and e1.get('now') == 'BIZ' and [s['key'] for s in e1.get('steps', [])] == ['BIZ', 'APPLY', 'KEY', 'TEST', 'LIVE']
           and len((rows.get('PASS') or {}).get('steps', [])) == 7, f"{len(rows)}/{n_int} · {e1.get('now')} · {[s['key'] for s in e1.get('steps', [])]}")
        today = time.strftime('%Y-%m-%d', time.gmtime(time.time() + 9 * 3600))
        psql(f"UPDATE site_settings SET value = '{today}' WHERE key = 'mall.biz_report_at'")
        u1 = call('PATCH', '/admin/integrations/ESIGN', {'ipRequestedAt': '2026-11-01', 'keyAt': '2026-11-05', 'testedAt': '2026-11-07'}, TS)
        e2 = {r['code']: r for r in call('GET', '/admin/integrations/progress', None, TS).get('rows') or []}.get('ESIGN') or {}
        st2 = {s['key']: s for s in e2.get('steps', [])}
        ok('③ 업종 정정 날짜 → BIZ 됨 · 신청일(비-IP 는 IP 신청일 칸) · 키 · 시험 날짜 → 됨 · 지금 LIVE · 다음에 할 일',
           u1.get('_err') is None and st2.get('BIZ', {}).get('at') == today and st2.get('APPLY', {}).get('at') == '2026-11-01'
           and st2.get('KEY', {}).get('at') == '2026-11-05' and st2.get('TEST', {}).get('at') == '2026-11-07' and e2.get('now') == 'LIVE' and bool(e2.get('next')),
           f"{e2.get('now')} · {[(k, v.get('at')) for k, v in st2.items()]}")
        u2 = call('PATCH', '/admin/integrations/ESIGN', {'status': 'LIVE'}, TS)
        e3 = {r['code']: r for r in call('GET', '/admin/integrations/progress', None, TS).get('rows') or []}.get('ESIGN') or {}
        live_at = psql("SELECT to_char(live_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') FROM integrations WHERE code = 'ESIGN'")
        ok('③ LIVE 로 바꾸면 live_at 오늘 · 「운영 중」(DONE) · 단계 모두 됨 · 날짜 형식 틀리면 400 · 회원 403',
           u2.get('_err') is None and live_at == today and e3.get('now') == 'DONE' and e3.get('doneSteps') == e3.get('totalSteps')
           and call('PATCH', '/admin/integrations/ESIGN', {'keyAt': '어제'}, TS).get('_err') == 400
           and call('GET', '/admin/integrations/progress', None, TB).get('_err') == 403, f"{u2} · {live_at} · {e3.get('now')}")

        # ── ④ 운영 화면 ──
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
                    pg.goto(ADMIN_WEB + '/#/affiliates', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(1500)
                    pg.locator('button[role=tab][data-screen="SB-AFF-RCM-010"]').click(); pg.wait_for_timeout(2000)
                    box = pg.locator('[data-rcm-check]')
                    seen['check'] = box.count()
                    if box.count() and not pg.locator('[data-rcm-check-item]').count():
                        box.locator('button', has_text='펼치기').click(); pg.wait_for_timeout(500)
                    seen['items'] = pg.locator('[data-rcm-check-item]').count()
                    seen['est'] = pg.locator('[data-rcm-estimate]').count()
                    seen['counts'] = box.first.get_attribute('data-rcm-check-counts') if box.count() else None
                    pg.goto(ADMIN_WEB + '/#/integrations', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                    seen['prog'] = pg.locator('[data-int-progress]').count()
                    seen['rows'] = pg.locator('[data-int-row]').count()
                    seen['esign'] = pg.locator('[data-int-row="ESIGN"]').first.get_attribute('data-int-now') if pg.locator('[data-int-row="ESIGN"]').count() else None
                    seen['keyat'] = pg.locator('[data-int-keyat]').count()
                    b.close()
            except Exception as ex:
                errs.append(str(ex)[:160])
            cc = c2.get('counts') or {}
            ok('④ 운영 화면 — 켜기 전 점검 상자(줄 7 · 어림 · 수 = API) · 신청 진행표(줄 = 연동 수 · ESIGN 운영 중 · 날짜 칸) · 화면 오류 없음',
               seen.get('check') == 1 and seen.get('items') == 7 and seen.get('est') == 1 and seen.get('counts') == f"{cc.get('ok')}|{cc.get('warn')}|{cc.get('no')}"
               and seen.get('prog') == 1 and str(seen.get('rows')) == n_int and seen.get('esign') == 'DONE' and str(seen.get('keyat')) == n_int and not errs,
               f'{seen} · {errs[:2]}')
        else:
            print('  (운영 화면 · playwright 없음 — ④ 건너뜀)')
    finally:
        cap0 = rule0.split('|')[2] if rule0.count('|') == 2 else ''
        psql(f"UPDATE point_rules SET monthly_cap = {cap0 or 'NULL'} WHERE code = 'REFERRAL_DIRECT'")
        psql(f"UPDATE site_settings SET value = {q(dup0)} WHERE key = 'identity.ci_duplicate'")
        psql(f"UPDATE site_settings SET value = {q(biz0)} WHERE key = 'mall.biz_report_at'")
        e = (esign0.split('|') + [''] * 6)[:6]
        psql(f"UPDATE integrations SET status = {q(e[0])}, applied_at = {q(e[1])}, key_at = {q(e[2])}, tested_at = {q(e[3])}, live_at = {q(e[4])}, ip_requested_at = {q(e[5])} WHERE code = 'ESIGN'")
    ok('되돌림 — 보상 규칙 · 같은 사람 설정 · 업종 정정 날짜 · 전자계약 연동 값',
       psql("SELECT is_active::text || '|' || points || '|' || coalesce(monthly_cap::text, '') FROM point_rules WHERE code = 'REFERRAL_DIRECT'") == rule0
       and psql("SELECT value FROM site_settings WHERE key = 'identity.ci_duplicate'") == dup0
       and psql("SELECT value FROM site_settings WHERE key = 'mall.biz_report_at'") == biz0
       and psql("SELECT status || '|' || coalesce(applied_at::text, '') || '|' || coalesce(key_at::text, '') || '|' || coalesce(tested_at::text, '') || '|' || coalesce(live_at::text, '') || '|' || coalesce(ip_requested_at::text, '') FROM integrations WHERE code = 'ESIGN'") == esign0,
       f'{rule0} · {dup0} · {biz0}')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
