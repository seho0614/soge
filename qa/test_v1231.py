"""v10.231 (docs/370) — 업종 정정신고(통신판매중개) 기록 · 입점 열기 준비(D199)

  ① (코드) D199 설정 두 줄(형식 검사 · 처음 비어 있음) · 서비스(둘 다 있으면 준비됨 · 판매 열기 판단에 다시 넣음 · 둘 다 / 날짜 검사) ·
     API POST /admin/health/tenant/biz-report(SUPER · 감사 HLT_BIZ_REPORT) · 일반 설정 길 SUPER 만 · 화면 「적기」 · 명세 · 영어 · 문서 370
  ② (API) ADMIN 403 · 하나만 422 BIZ_REPORT_BOTH · 내일 날짜 422 BIZ_REPORT_DATE · SUPER 가 적으면 준비됨 · 일반 설정 길 ADMIN 403 ·
     감사 기록 · 비우면 막힘 · 끝에 처음 값으로
  ③ (화면) 업종 정정신고 줄 「적기」 → 날짜 · 접수번호 칸(저장은 누르지 않음)
"""
import json, os, re, subprocess, time, urllib.error, urllib.request
from datetime import datetime, timedelta, timezone

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []
PW = 'sgb-dev-1234'        # admin@x.com(SUPER)
RPW = 'sgb-test-1234'      # ops@t.local(ADMIN)


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ──────────────────────────────────────────────────────────────
M = rd('prisma/migrations/D199_mall_biz_report/migration.sql')
ok('① D199 — mall.biz_report_no · mall.biz_report_at(처음 NULL · 형식 검사) · ON CONFLICT DO NOTHING · 지우는 문장 없음',
   "('mall.biz_report_no', NULL, 'ADMIN'" in M and "('mall.biz_report_at', NULL, 'ADMIN'" in M and "'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'" in M
   and 'ON CONFLICT (key) DO NOTHING' in M and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE)\b', M), '')
SV, CT = rd('src/modules/health/health-tenant.service.ts'), rd('src/modules/health/health-tenant.controller.ts')
AS, AC = rd('src/modules/admin/admin.service.ts'), rd('src/modules/admin/admin.controller.ts')
ok('① 서비스 · API — 둘 다 있으면 준비됨 · 판매 열기 판단에 다시 넣음 · 둘 다 / 날짜 검사 · SUPER · 감사 · 일반 설정 길 SUPER 만',
   'const bizOk = !!r?.bizNo && !!r?.bizAt' in SV and "x.key !== 'biz-report'" not in SV and 'async setBizReport(' in SV
   and "'BIZ_REPORT_BOTH'" in SV and "'BIZ_REPORT_DATE'" in SV and "DATE '2020-01-01'" in SV
   and "@Post('admin/health/tenant/biz-report')" in CT and "@Roles('SUPER')" in CT and "@Audit('HLT_BIZ_REPORT', 'SITE_SETTING')" in CT
   and 'export class TenantBizReportDto' in CT and CT.index('export class TenantBizReportDto') < CT.index('export class TenantReadinessDto')
   and "key.startsWith('mall.biz_report_')" in AS and "'BIZ_REPORT_SETTING_SUPER'" in AS and 'BIZ_REPORT_SETTING_SUPER' in AC, '')
RW = rd('web/src/app/admin/HealthTenantReady.tsx')
EN = rd('src/common/i18n/server-text.en.ts')
SJ = json.loads(rd('spec/screens.json') or '{"screens":[]}'); sc = {s['id']: s for s in SJ.get('screens', [])}
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('370_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 화면 「적기」(SUPER) · 명세 · 영어 3줄 · 문서 370 · 판 v10.231 이상',
   "'/admin/health/tenant/biz-report'" in RW and 'data-biz-report-edit=""' in RW and 'data-biz-report-form=""' in RW and "tokenRoles().includes('SUPER')" in RW
   and 'POST /admin/health/tenant/biz-report' in sc.get('SB-ADM-HSL-010', {}).get('apis', [])
   and all(k in EN for k in ('"신고 날짜와 접수번호를 함께 적거나 함께 비우십시오."', '"신고 날짜는 2020-01-01 부터 오늘(한국 날짜)까지만 적을 수 있습니다."', '"업종 정정신고 기록은 최고 관리자(SUPER)만 적을 수 있습니다."'))
   and bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 231), f'{DOC} · {rd("VERSION").strip()}')


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
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return r.stdout.strip() if not r.returncode else ('!' + r.stderr.strip()[:200])


# ── ② API ──────────────────────────────────────────────────────────────
if API and DB:
    import sys
    sys.path.insert(0, HERE)
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    TA = call('POST', '/auth/login', {'email': 'ops@t.local', 'password': RPW}).get('accessToken')
    orig = psql("SELECT coalesce(value, 'NULL') FROM site_settings WHERE key = 'mall.biz_report_no' UNION ALL SELECT coalesce(value, 'NULL') FROM site_settings WHERE key = 'mall.biz_report_at'").splitlines()
    t0 = psql("SELECT now()")
    today = (datetime.now(timezone.utc) + timedelta(hours=9)).date()
    try:
        ra = call('POST', '/admin/health/tenant/biz-report', {'reportNo': '2026-시험-1231', 'reportedAt': str(today)}, TA)
        r1 = call('POST', '/admin/health/tenant/biz-report', {'reportNo': '2026-시험-1231'}, TS)
        r2 = call('POST', '/admin/health/tenant/biz-report', {'reportNo': '2026-시험-1231', 'reportedAt': str(today + timedelta(days=1))}, TS)
        r3 = call('POST', '/admin/health/tenant/biz-report', {'reportNo': '2026-시험-1231', 'reportedAt': str(today)}, TS)
        row = {x['key']: x for x in r3.get('rows') or []}.get('biz-report', {})
        ok('② 적기 — ADMIN 403 · 하나만 422 BIZ_REPORT_BOTH · 내일 422 BIZ_REPORT_DATE · SUPER 가 적으면 준비됨 · 돌려준 값',
           ra.get('_err') == 403 and (r1.get('_err'), r1.get('code')) == (422, 'BIZ_REPORT_BOTH') and (r2.get('_err'), r2.get('code')) == (422, 'BIZ_REPORT_DATE')
           and r3.get('_err') is None and row.get('state') == 'ok' and '2026-시험-1231' in row.get('now', '') and str(today) in row.get('now', '')
           and r3.get('bizReport') == {'reportNo': '2026-시험-1231', 'reportedAt': str(today)},
           f"{ra.get('_err')} · {r1.get('_err')} {r1.get('code')} · {r2.get('_err')} {r2.get('code')} · {r3.get('_err')} {row}")
        pa = call('PATCH', '/admin/site-settings', {'key': 'mall.biz_report_no', 'value': '2026-바꿈-0000'}, TA)
        ok('② 일반 설정 길 — ADMIN 403 BIZ_REPORT_SETTING_SUPER · 값 그대로 · 판매 열기 판단은 업종 줄이 준비돼도 다른 막힘 때문에 아직',
           (pa.get('_err'), pa.get('code')) == (403, 'BIZ_REPORT_SETTING_SUPER') and psql("SELECT value FROM site_settings WHERE key = 'mall.biz_report_no'") == '2026-시험-1231'
           and r3.get('saleReady') is False, f"{pa.get('_err')} {pa.get('code')} · {r3.get('saleReady')}")
        r4 = call('POST', '/admin/health/tenant/biz-report', {'reportNo': '', 'reportedAt': ''}, TS)
        time.sleep(1)
        row4 = {x['key']: x for x in r4.get('rows') or []}.get('biz-report', {})
        aud = psql(f"SELECT count(*) FROM audit.audit_logs WHERE action = 'HLT_BIZ_REPORT' AND occurred_at >= '{t0}'")
        ok('② 비우기 — 막힘 · 설정 NULL · 감사 기록 HLT_BIZ_REPORT 2건(적기 · 비우기)',
           r4.get('_err') is None and row4.get('state') == 'todo' and r4.get('bizReport') == {'reportNo': None, 'reportedAt': None}
           and psql("SELECT count(*) FROM site_settings WHERE key LIKE 'mall.biz_report_%' AND value IS NULL") == '2' and aud == '2',
           f"{r4.get('_err')} {row4.get('state')} · 감사 {aud}")
    finally:
        if len(orig) == 2:
            for k, v in zip(('mall.biz_report_no', 'mall.biz_report_at'), orig):
                psql(f"UPDATE site_settings SET value = {'NULL' if v == 'NULL' else repr(v)} WHERE key = '{k}'")

    # ── ③ 화면 ──
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
            pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
            pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
            pg.goto(ADMIN_WEB + '/#/hlt-sellers', wait_until='networkidle', timeout=120000)
            pg.reload(wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
            btn = pg.locator('[data-tenant-ready-row="biz-report"] [data-biz-report-edit]')
            had = btn.count()
            if had: btn.first.click(); pg.wait_for_timeout(500)
            form = pg.locator('[data-tenant-ready-row="biz-report"] [data-biz-report-form]')
            seen = (had, form.count(), form.locator('input[type=date]').count() if form.count() else 0, form.locator('input[aria-label="접수번호"]').count() if form.count() else 0)
            pg.screenshot(path=os.path.join(HERE, 'v1231_biz_report.png'), full_page=False)
            b.close()
        ok('③ 업종 정정신고 줄 「적기」 → 날짜 · 접수번호 칸 · 화면 오류 없음', seen == (1, 1, 1, 1) and not errs, f'{seen} · {errs[:2]}')
    else:
        print('  (운영 화면 · playwright 없음 — ③ 건너뜀)')
else:
    print('  (API · DB 없음 — ② · ③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
