"""v10.421 (D252 · docs/558) 근로소득 지급명세서 · 간이지급명세서 · 원천징수영수증
  ① (코드) wageStatements · periodRange(YYYY · H1 · H2 · YYYY-MM) · 영수증 · CSV(주민등록번호 빈 칸) · API 3 · 화면 · 메뉴 · 문서 558
  ② (API · DB) 먼 해(2095) 두 달 급여 확정 → 해 합계 = 두 달 · 반기 · 영수증 · 없는 직원 404 · 틀린 기간 422 · CSV 승인 뒤 머리줄 주민등록번호 칸
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1421.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1421.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




M52 = migr('D252_')
FL, CT, UI, MN = rd('src/modules/acct/filings.ts'), rd('src/modules/acct/acct-filings.controller.ts'), rd('web/src/app/admin/AcctFilings.tsx'), rd('web/src/lib/adminMenu.ts')
ok('① 코드 — 지급명세서 · 반기 · 영수증 · CSV 주민등록번호 빈 칸 · API 3 · 화면 · 메뉴 · 명세 · 문서 558 · 판 v10.421' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   'export async function wageStatements' in FL
       and 'export function periodRange' in FL
       and 'export async function wageReceipt' in FL
       and "'주민등록번호(신고 때 채움)'" in FL
       and "@Get('payroll/statements')" in CT
       and "@Get('payroll/statements/export')" in CT
       and "@Get('payroll/statements/:employeeId/receipt')" in CT, VER)

def clean_payroll(YR, emp_ids):
    ids = ','.join(str(int(x)) for x in emp_ids) or '0'
    psql_erp(f"BEGIN; SET LOCAL session_replication_role = replica; "
         f"DELETE FROM acct_lines WHERE entry_id IN (SELECT e.id FROM acct_entries e WHERE e.source IN ('PAYROLL', 'PAYROLL_PAID') AND e.source_key IN (SELECT id::text FROM acct_payroll_runs WHERE ym LIKE '{YR}-%')); "
         f"DELETE FROM acct_entries WHERE source IN ('PAYROLL', 'PAYROLL_PAID') AND source_key IN (SELECT id::text FROM acct_payroll_runs WHERE ym LIKE '{YR}-%'); "
         f"DELETE FROM acct_payroll_lines WHERE run_id IN (SELECT id FROM acct_payroll_runs WHERE ym LIKE '{YR}-%') OR employee_id IN ({ids}); "
         f"DELETE FROM acct_payroll_runs WHERE ym LIKE '{YR}-%'; "
         f"DELETE FROM acct_insurance_done WHERE employee_id IN ({ids}); "
         f"UPDATE ops_alerts SET resolved_at = now(), resolve_note = '시험 정리' WHERE alert_code = 'ACCT_INSURANCE_DUE' AND resolved_at IS NULL AND split_part(detail->>'key', ':', 1) IN (SELECT unnest(string_to_array('{ids}', ','))); "
         f"DELETE FROM acct_employees WHERE id IN ({ids}); COMMIT;")


if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW)
    TS = login('admin@x.com')
    pe, pid = mk_staff('1421', 'PAYOUT'); agree(pe, PW); TP = login(pe)
    stamp = int(time.time()) % 1000000
    YR = 2095
    emp_ids = []
    try:
        clean_payroll(YR, [])
        e1 = erp('POST', '/admin/acct/employees', {'name': f'시험직원1421-{stamp}', 'joinedOn': f'{YR}-01-01', 'monthlyBase': 2500000, 'nontax': 100000, 'dependents': 2}, TS)
        if e1.get('id'): emp_ids.append(e1['id'])
        lines = []
        for m in ('03', '08'):
            r = erp('POST', '/admin/acct/payroll/runs', {'ym': f'{YR}-{m}'}, TS)
            p = erp('GET', f'/admin/acct/payroll?ym={YR}-{m}', None, TS)
            lines.append(next((x for x in p.get('lines') or [] if x.get('employeeId') == e1.get('id')), {}))
            erp('POST', f"/admin/acct/payroll/runs/{r.get('id')}/fix", None, TS)
        yr = erp('GET', f'/admin/acct/payroll/statements?period={YR}', None, TP)
        me = next((x for x in yr.get('items') or [] if x.get('employeeId') == e1.get('id')), {})
        h1 = erp('GET', f'/admin/acct/payroll/statements?period={YR}-H1', None, TP)
        h1me = next((x for x in h1.get('items') or [] if x.get('employeeId') == e1.get('id')), {})
        rc = erp('GET', f"/admin/acct/payroll/statements/{e1.get('id')}/receipt?year={YR}", None, TP)
        nf = erp('GET', f'/admin/acct/payroll/statements/999999999/receipt?year={YR}', None, TP)
        bad = erp('GET', '/admin/acct/payroll/statements?period=2095-H3', None, TP)
        tk = ticket(TP, 'ACCT_TAX', TS)
        cv = erp('GET', f'/admin/acct/payroll/statements/export?period={YR}&ticket={tk}', None, TP) if tk else {}
        head = (cv.get('csv') or '').lstrip('\ufeff').split('\r\n')[0]
        want_it = sum(int(x.get('incomeTax') or 0) for x in lines)
        ok('② 지급명세서 — 해 = 두 달(달 2 · 총급여 5,000,000 · 비과세 200,000 · 소득세 합) · 상반기 = 3월만 · 영수증 · 없는 직원 404 · 틀린 기간 422 · CSV 주민등록번호 칸',
           me.get('months') == 2 and me.get('gross') == 5000000 and me.get('nontax') == 200000 and me.get('incomeTax') == want_it
           and h1me.get('months') == 1 and h1me.get('gross') == 2500000 and (rc.get('employee') or {}).get('gross') == 5000000
           and nf.get('_err') == 404 and bad.get('code') == 'ACCT_PERIOD' and '주민등록번호(신고 때 채움)' in head and int(cv.get('rows') or 0) >= 1,
           f"{me} · {h1me.get('months')} {h1me.get('gross')} · {(rc.get('employee') or {}).get('gross')} · {nf.get('_err')} {bad.get('code')} · {head[:40]} {cv.get('rows')}")
    finally:
        clean_payroll(YR, emp_ids)
        rm_role(pid, '1421')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

summary()
