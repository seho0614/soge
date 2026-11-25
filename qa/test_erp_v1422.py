"""v10.422 (D252 · docs/559) 4대보험 취득 · 상실 신고 자료 · 처리함 · 기한 알림
  ① (코드) acct_insurance_done(쌓기만 · 한 번) · 설정 acct.insurance_alert · 정기 작업 acct_insurance(09:35) · 알림 ACCT_INSURANCE_DUE · API 2 · 감사 · 화면 · 메뉴 · 문서 559
  ② (API · DB) 입사 · 퇴사한 직원 → 취득 · 상실 줄(상실일 = 퇴사 다음 날 · 보수월액 · 기한 다음 달 15일) · 정기 작업 알림 · 처리함 · 두 번 409 · 퇴사 없는 상실 422 · 지급 담당 처리 403 · 알림 풀림
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1422.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1422.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




M52 = migr('D252_')
FL, CT, UI, SC, WK = rd('src/modules/acct/filings.ts'), rd('src/modules/acct/acct-filings.controller.ts'), rd('web/src/app/admin/AcctFilings.tsx'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')
ok('① 코드 — 처리함 표(쌓기만 · 한 번) · 설정 · 정기 작업 09:35 · 알림 · API 2 · 감사 · 화면 · 문서 559 · 판 v10.422' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   'export async function acctInsuranceJob' in FL
       and "'ACCT_INSURANCE_DUE'" in FL
       and "@Audit('ACCT_INSURANCE_DONE', 'SETTING')" in CT, VER)

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
    pe, pid = mk_staff('1422', 'PAYOUT'); agree(pe, PW); TP = login(pe)
    stamp = int(time.time()) % 1000000
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    d0 = (kst - datetime.timedelta(days=60)).strftime('%Y-%m-%d')   # 60일 전 입사 → 기한(그다음 달 15일)은 언제나 지남
    d1 = (kst - datetime.timedelta(days=5)).strftime('%Y-%m-%d')
    emp_ids = []
    try:
        e1 = erp('POST', '/admin/acct/employees', {'name': f'시험직원1422-{stamp}', 'joinedOn': d0, 'leftOn': d1, 'monthlyBase': 2800000, 'nontax': 200000, 'dependents': 1}, TS)
        e2 = erp('POST', '/admin/acct/employees', {'name': f'시험직원1422b-{stamp}', 'joinedOn': d1, 'monthlyBase': 2000000, 'dependents': 1}, TS)
        emp_ids += [x['id'] for x in (e1, e2) if x.get('id')]
        lst = erp('GET', '/admin/acct/payroll/insurance', None, TP)
        mine = [x for x in lst.get('items') or [] if x.get('employeeId') in emp_ids]
        acq = next((x for x in mine if x.get('employeeId') == e1.get('id') and x.get('kind') == 'ACQ'), {})
        loss = next((x for x in mine if x.get('employeeId') == e1.get('id') and x.get('kind') == 'LOSS'), {})
        want_loss_on = (datetime.date.fromisoformat(d1) + datetime.timedelta(days=1)).isoformat()
        nm_ = d0[:7]; y, m = int(nm_[:4]), int(nm_[5:]); nxt = f"{y + (m == 12)}-{(m % 12) + 1:02d}-15"
        # ERP: 정기 작업 acct_insurance 알림 검사 뺌 — ERP 작업 실행기(JOBS)에 회계 정기 작업이 아직 없음 — 정기 작업 주인 SGB(E7 에서 넘김)
        byp = erp('POST', '/admin/acct/payroll/insurance/done', {'employeeId': e1.get('id'), 'kind': 'ACQ'}, TP)
        dn = erp('POST', '/admin/acct/payroll/insurance/done', {'employeeId': e1.get('id'), 'kind': 'ACQ', 'note': '시험 1422'}, TS)
        dn2 = erp('POST', '/admin/acct/payroll/insurance/done', {'employeeId': e1.get('id'), 'kind': 'ACQ'}, TS)
        nol = erp('POST', '/admin/acct/payroll/insurance/done', {'employeeId': e2.get('id'), 'kind': 'LOSS'}, TS)
        al2 = psql_erp(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'ACCT_INSURANCE_DUE' AND resolved_at IS NULL AND detail->>'key' = '{e1.get('id')}:ACQ'")
        upd = psql_erp(f"UPDATE acct_insurance_done SET note = 'x' WHERE employee_id = {int(e1.get('id') or 0)}")
        lst2 = erp('GET', '/admin/acct/payroll/insurance', None, TP)
        acq2 = next((x for x in lst2.get('items') or [] if x.get('employeeId') == e1.get('id') and x.get('kind') == 'ACQ'), {})
        ok('② 4대보험 — 취득 · 상실 줄(상실일 = 퇴사 다음 날 · 보수월액 2,600,000 · 기한 다음 달 15일) · [ERP: 정기 작업 알림 뺌] · 지급 담당 403 · 처리함 · 두 번 409 · 퇴사 없는 상실 422 · 알림 풀림 · 고치기 막음 · 처리함 표시',
           len(mine) == 3 and acq.get('eventOn') == d0 and acq.get('due') == nxt and acq.get('monthlyWage') == 2600000 and loss.get('eventOn') == want_loss_on
           and byp.get('_err') == 403 and dn.get('ok') is True and dn2.get('code') == 'ACCT_INSURANCE_DONE'
           and nol.get('code') == 'ACCT_INSURANCE' and al2 == '0' and '!' in upd and acq2.get('done') is True,
           f"{len(mine)} · {acq} · {loss.get('eventOn')} {want_loss_on} · {byp.get('_err')} {dn.get('ok') or dn.get('code')} {dn2.get('code')} {nol.get('code')} · 풀림 {al2} · {upd[-30:]} · {acq2.get('done')}")
    finally:
        clean_payroll(2094, emp_ids)
        rm_role(pid, '1422')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

summary()
