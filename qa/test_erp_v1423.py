"""v10.423 (D252 · docs/560) 산재보험 회사 부담 — 급여 줄 company_ia · 급여 전표
  ① (코드) company_ia 칸 · 셈(ia_company_rate) · 줄 넣기 · 고침 · 급여 전표 회사 보험료에 더함 · 화면 칸 · 문서 560
  ② (API · DB) 먼 해(2093) 급여 → 산재 = 과세 급여 × 요율(10원 버림) · 실지급 그대로 · 회사 4대보험 합에 산재 · 확정 → 전표 보험료 = 회사 몫 합 · 차변 = 대변
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1423.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1423.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




M52 = migr('D252_')
PR, UI = rd('src/modules/acct/payroll.ts'), rd('web/src/app/admin/Acct.tsx')
ok('① 코드 — company_ia 칸 · 셈 · 넣기 · 고침 · 전표 com_ins · 화면 · 문서 560 · 판 v10.423' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   'ia_company_rate ?? 0' in PR
       and 'company_ia: cia' in PR
       and 'c.company_ia]' in PR
       and 'l.company_ei + l.company_ia)::bigint AS com_ins' in PR, VER)

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
    stamp = int(time.time()) % 1000000
    YR = 2093; YM = f'{YR}-{(stamp % 12) + 1:02d}'
    emp_ids = []
    try:
        clean_payroll(YR, [])
        e1 = erp('POST', '/admin/acct/employees', {'name': f'시험직원1423-{stamp}', 'joinedOn': f'{YR}-01-01', 'monthlyBase': 3000000, 'nontax': 200000, 'dependents': 1}, TS)
        if e1.get('id'): emp_ids.append(e1['id'])
        rates = erp('GET', f'/admin/acct/payroll/rates?year={YR}', None, TS).get('rates') or {}
        r1 = erp('POST', '/admin/acct/payroll/runs', {'ym': YM}, TS)
        p = erp('GET', f'/admin/acct/payroll?ym={YM}', None, TS)
        ln = next((x for x in p.get('lines') or [] if x.get('employeeId') == e1.get('id')), {})
        want = int(2800000 * float(rates.get('ia_company_rate') or 0) / 100 // 10 * 10)
        net_ok = ln.get('net') == ln.get('gross', 0) - ln.get('incomeTax', 0) - ln.get('localTax', 0) - ln.get('np', 0) - ln.get('hi', 0) - ln.get('ltc', 0) - ln.get('ei', 0)
        com = sum(int(ln.get(k) or 0) for k in ('companyNp', 'companyHi', 'companyLtc', 'companyEi', 'companyIa'))
        fx = erp('POST', f"/admin/acct/payroll/runs/{r1.get('id')}/fix", None, TS)
        erp('POST', '/admin/acct/journal/run', None, TS)
        pe = psql_erp(f"SELECT coalesce(sum(debit), 0) || '|' || coalesce(sum(credit), 0) || '|' || coalesce(sum(debit) FILTER (WHERE role = 'EXP_INSURANCE'), 0) FROM acct_lines WHERE entry_id = (SELECT id FROM acct_entries WHERE source = 'PAYROLL' AND source_key = '{r1.get('id')}')")
        d, c_, ins = (pe.split('|') + ['', '', ''])[:3]
        ok('② 산재 — 과세 급여 × 요율(10원 버림) · 실지급 그대로 · 회사 몫 합(산재 포함) = 합계 · 전표 보험료 = 회사 몫 · 차변 = 대변',
           float(rates.get('ia_company_rate') or 0) > 0 and ln.get('companyIa') == want and net_ok and (p.get('total') or {}).get('companyIns') == com
           and fx.get('ok') is True and d == c_ and int(ins or 0) == com,
           f"요율 {rates.get('ia_company_rate')} · {ln.get('companyIa')} 기대 {want} · net {net_ok} · {(p.get('total') or {}).get('companyIns')} {com} · {fx.get('ok') or fx.get('code')} · 전표 {pe}")
    finally:
        clean_payroll(YR, emp_ids)
else:
    print('  (API · DB 없음 — ② 건너뜀)')

summary()
