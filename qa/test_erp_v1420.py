"""v10.420 (D252 · docs/557) 원천세 이행상황신고서 미리보기
  ① (코드) filings.whtReturn · 칸 A01 · A20 · A25 · A99 · 기한(영업일) · API 2 · 내려받기 승인 ACCT_TAX · 화면 · 메뉴 · 명세 · 문서 557
  ② (API · DB) 먼 해(2096) 급여 확정 → A01 인원 · 지급액 · 소득세 · 합계 · 기한 다음 달 10일 이후 · 틀린 달 422 · ADMIN 403 · CSV 승인 없이 422 · 승인 뒤 머리줄
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1420.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1420.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




M52 = migr('D252_')
FL, CT, UI, MN, AP = rd('src/modules/acct/filings.ts'), rd('src/modules/acct/acct-filings.controller.ts'), rd('web/src/app/admin/AcctFilings.tsx'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx')
ok('① 코드 — 신고서 칸 A01 · A20 · A25 · A99 · 기한 영업일 · API 2 · ACCT_TAX 승인 · 화면 · 메뉴 · 명세 · 문서 557 · 판 v10.420' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   'export async function whtReturn' in FL
       and all(c in FL for c in ("code: 'A01'", "code: 'A20'", "code: 'A25'", "code: 'A99'"))
       and 'fn_is_business_day' in FL
       and "@Get('tax/wht-return')" in CT
       and "@Get('tax/wht-return/export')" in CT
       and "@ExportGate('ACCT_TAX')" in CT, VER)

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
    pe, pid = mk_staff('1420', 'PAYOUT'); agree(pe, PW); TP = login(pe)
    ae, aid = mk_staff('1420a', 'ADMIN'); agree(ae, PW); TA = login(ae)
    stamp = int(time.time()) % 1000000
    YR = 2096; YM = f'{YR}-{(stamp % 11) + 1:02d}'
    emp_ids = []
    try:
        clean_payroll(YR, [])
        e1 = erp('POST', '/admin/acct/employees', {'name': f'시험직원1420-{stamp}', 'joinedOn': f'{YR}-01-01', 'monthlyBase': 3000000, 'nontax': 200000, 'dependents': 1}, TS)
        if e1.get('id'): emp_ids.append(e1['id'])
        r1 = erp('POST', '/admin/acct/payroll/runs', {'ym': YM}, TS)
        p = erp('GET', f'/admin/acct/payroll?ym={YM}', None, TS)
        ln = next((x for x in p.get('lines') or [] if x.get('employeeId') == e1.get('id')), {})
        fx = erp('POST', f"/admin/acct/payroll/runs/{r1.get('id')}/fix", None, TS)
        w = erp('GET', f'/admin/acct/tax/wht-return?ym={YM}', None, TP)
        rows = {r.get('code'): r for r in w.get('rows') or []}
        a01, tot = rows.get('A01') or {}, w.get('total') or {}
        bad = erp('GET', '/admin/acct/tax/wht-return?ym=2096-13', None, TP)
        byad = erp('GET', f'/admin/acct/tax/wht-return?ym={YM}', None, TA)
        nt = erp('GET', f'/admin/acct/tax/wht-return/export?ym={YM}', None, TP)
        tk = ticket(TP, 'ACCT_TAX', TS)
        cv = erp('GET', f'/admin/acct/tax/wht-return/export?ym={YM}&ticket={tk}', None, TP) if tk else {}
        head = (cv.get('csv') or '').lstrip('\ufeff').split('\r\n')[0]
        nxt = f"{YR}-{int(YM[5:]) + 1:02d}"
        ok('② 신고서 — A01 = 확정 급여(인원 1 · 지급액 3,000,000 · 소득세 = 급여 줄) · A99 합계 · 기한 다음 달 10일 이후(영업일) · 틀린 달 422 · ADMIN 403 · 승인 없이 422 · 승인 뒤 CSV',
           fx.get('ok') is True and a01.get('people') == 1 and a01.get('paid') == 3000000 and a01.get('incomeTax') == ln.get('incomeTax') and a01.get('localTax') == ln.get('localTax')
           and tot.get('code') == 'A99' and tot.get('incomeTax', -1) >= a01.get('incomeTax', 0) and set(rows) == {'A01', 'A20', 'A25'}
           and str(w.get('due', '')) >= f'{nxt}-10' and str(w.get('due', '')).startswith(nxt) and bad.get('code') == 'ACCT_PERIOD' and byad.get('_err') == 403
           and nt.get('code') == 'EXPORT_NEED_APPROVAL' and head.startswith('귀속 · 지급 달,코드') and int(cv.get('rows') or 0) == 4,
           f"{fx.get('ok') or fx.get('code')} · {a01} · {ln.get('incomeTax')} · {tot} · {w.get('due')} · {bad.get('code')} {byad.get('_err')} · {nt.get('code')} · {head[:20]} {cv.get('rows')}")
    finally:
        clean_payroll(YR, emp_ids)
        rm_role(pid, '1420'); rm_role(aid, '1420a')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

summary()
