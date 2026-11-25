"""v10.403 (D247 · docs/540) 급여 대장 · 4대보험
  ① (코드) 직원 · 대장 · 줄 · 요율 · 간이세액표 · 계정 · 전표 PAYROLL · PAYROLL_PAID · API · 화면 · 문서
  ② (API) 직원 넣기(400 · 403) · 간이세액표 올림 · 대장 만들기 · 같은 달 409 · 셈(4대보험 10원 버림 · 소득세 · 지방소득세 · 실지급)
  ③ (API) 초안 줄 다시 셈 · 확정 뒤 409 · DB 도 막음 · 급여 전표 차대 같음 · 지급 처리 · 지급 전표
  ④ (화면) 회계 › 급여
  시험용 해 2098 · 끝에 직원 · 대장 · 전표 · 간이세액표를 replica 로 지움
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1403.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1403.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




import glob as _glob


M47 = mig('D247')
AC, UI, AP, MN = rd('src/modules/acct/acct.controller.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
SR = rd('src/modules/acct/sources.ts')
SC, WK = rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')


PR = rd('src/modules/acct/payroll.ts')
ok('① 코드 — 직원(주민번호 · 계좌 없음) · 급여 대장(초안 → 확정 → 지급 · 앞으로만) · 줄(net = 지급 − 공제) · 요율 표 · 간이세액표 · 계정 INS_PAYABLE · EXP_INSURANCE · 전표 PAYROLL · PAYROLL_PAID · API · 화면 · 문서 540 · 판 v10.403' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   "name: 'PAYROLL'" in PR
       and "name: 'PAYROLL_PAID'" in PR
       and 'PAYROLL_SOURCES' in SR
       and "@Post('payroll/runs')" in AC
       and "@Post('payroll/wht-table')" in AC, VER)
if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW); agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1403', 'PAYOUT'); agree(pe, PW); TP = login(pe)
    stamp = int(time.time()) % 1000000
    YR = 2098   # 시험용 먼 해 — 실제 급여 · 요율과 겹치지 않음(요율은 가장 가까운 앞 해 2026 초안을 씀)
    YM = f'{YR}-{(stamp % 12) + 1:02d}'
    nm = f'시험직원1403-{stamp}'
    emp_ids, run_id = [], None
    try:
        # 다른 시험이 남긴 같은 달 대장이 있으면 지움(replica)
        psql_erp(f"BEGIN; SET LOCAL session_replication_role = replica; DELETE FROM acct_payroll_lines WHERE run_id IN (SELECT id FROM acct_payroll_runs WHERE ym = '{YM}'); DELETE FROM acct_payroll_runs WHERE ym = '{YM}'; COMMIT;")
        badd = erp('POST', '/admin/acct/employees', {'name': nm, 'joinedOn': f'{YR}-01-01', 'monthlyBase': 3000000, 'dependents': 12}, TS)
        byp = erp('POST', '/admin/acct/employees', {'name': nm, 'joinedOn': f'{YR}-01-01', 'monthlyBase': 3000000}, TP)
        e1 = erp('POST', '/admin/acct/employees', {'name': nm, 'joinedOn': f'{YR}-01-01', 'monthlyBase': 3000000, 'nontax': 200000, 'dependents': 1}, TS)
        if e1.get('id'): emp_ids.append(e1['id'])
        # 간이세액표 시험 줄(천원 단위 · 2,700 ~ 2,900 천원 · 가족 1 = 50,000원)
        csv = '이상,미만,1,2\n2700,2900,50000,30000\n'
        wt = erp('POST', '/admin/acct/payroll/wht-table', {'year': YR, 'csv': csv, 'reason': '시험 1403'}, TS)
        rates = erp('GET', f'/admin/acct/payroll/rates?year={YR}', None, TP).get('rates') or {}
        r1 = erp('POST', '/admin/acct/payroll/runs', {'ym': YM}, TS)
        run_id = r1.get('id')
        r2 = erp('POST', '/admin/acct/payroll/runs', {'ym': YM}, TS)
        p = erp('GET', f'/admin/acct/payroll?ym={YM}', None, TP)
        ln = next((x for x in p.get('lines') or [] if x.get('employeeId') == e1.get('id')), {})
        f10 = lambda v: int(v // 10 * 10)
        tx = 2800000
        base = min(max(tx, rates.get('np_base_min', 0)), rates.get('np_base_max', 10 ** 12))
        np_ = f10(base * rates.get('np_rate', 0) / 100); hi = f10(tx * rates.get('hi_rate', 0) / 100); ltc = f10(hi * rates.get('ltc_rate', 0) / 100); ei = f10(tx * rates.get('ei_rate', 0) / 100)
        want_net = 3000000 - 50000 - 5000 - np_ - hi - ltc - ei
        mb = erp('GET', f'/admin/acct/payroll?ym={YM}', None, TB)
        ok('② 직원 · 대장 — 가족 12명 400 · 지급 담당 넣기 403 · 넣음 · 간이세액표 올림 · 대장 만들기 · 같은 달 409 · 셈(과세 2,800,000 · 국민연금 · 건강 · 장기요양 · 고용 10원 버림 · 소득세 50,000 · 지방 5,000 · 실지급 = 지급 − 공제) · 회원 403',
           badd.get('_err') == 400 and byp.get('_err') == 403 and bool(e1.get('id')) and wt.get('rows') == 2 and bool(run_id) and r2.get('code') == 'ACCT_PAYROLL_EXISTS'
           and ln.get('gross') == 3000000 and ln.get('nontax') == 200000 and ln.get('incomeTax') == 50000 and ln.get('localTax') == 5000
           and ln.get('np') == np_ and ln.get('hi') == hi and ln.get('ltc') == ltc and ln.get('ei') == ei and ln.get('net') == want_net and ln.get('whtMissing') is False and mb.get('_err') == 403,
           f"{badd.get('_err')} {byp.get('_err')} · {e1.get('id')} · 표 {wt.get('rows') or wt.get('code')} · 대장 {run_id} {r2.get('code')} · {ln} · 기대 {np_} {hi} {ltc} {ei} {want_net} · {mb.get('_err')}")
        up = erp('PATCH', f"/admin/acct/payroll/lines/{ln.get('id')}", {'gross': 3100000}, TS)
        dbnet = psql_erp(f"SELECT net = gross - income_tax - local_tax - np - hi - ltc - ei FROM acct_payroll_lines WHERE id = {int(ln.get('id') or 0)}")
        fx = erp('POST', f'/admin/acct/payroll/runs/{run_id}/fix', None, TS)
        up2 = erp('PATCH', f"/admin/acct/payroll/lines/{ln.get('id')}", {'gross': 3200000}, TS)
        raw = psql_erp(f"UPDATE acct_payroll_lines SET gross = 1 WHERE id = {int(ln.get('id') or 0)}")
        erp('POST', '/admin/acct/journal/run', None, TS)
        pe1 = psql_erp(f"SELECT coalesce(sum(debit), 0) || '|' || coalesce(sum(credit), 0) || '|' || coalesce(sum(debit) FILTER (WHERE role = 'EXP_SALARY'), 0) FROM acct_lines WHERE entry_id = (SELECT id FROM acct_entries WHERE source = 'PAYROLL' AND source_key = '{run_id}')")
        pd = erp('POST', f'/admin/acct/payroll/runs/{run_id}/paid', None, TP)
        erp('POST', '/admin/acct/journal/run', None, TS)
        pe2 = psql_erp(f"SELECT count(*) FROM acct_entries WHERE source = 'PAYROLL_PAID' AND source_key = '{run_id}'")
        d, c_, sal = (pe1.split('|') + ['', '', ''])[:3]
        ok('③ 확정 · 지급 · 전표 — 초안 줄 고치면 다시 셈(net 맞음) · 확정 뒤 고치기 409 · DB 도 막음 · 급여 전표 차변 = 대변 · 직원급여 = 지급액 합 · 지급 담당이 지급 처리 · 지급 전표 하나',
           up.get('ok') is True and dbnet == 't' and fx.get('ok') is True and up2.get('code') == 'ACCT_PAYROLL_FIXED' and 'ACCT_PAYROLL_FIXED' in raw
           and d == c_ and int(sal or 0) >= 3100000 and pd.get('ok') is True and pe2 == '1',
           f"{up.get('ok') or up.get('code')} {dbnet} · {fx.get('ok') or fx.get('code')} · {up2.get('code')} · {raw[-40:]} · 전표 {pe1} · {pd.get('ok') or pd.get('code') or pd.get('_err')} · 지급 전표 {pe2}")
    finally:
        # 시험 대장 · 줄 · 전표 · 직원 · 간이세액표 지움(replica)
        rid = int(run_id or 0)
        ids = ','.join(str(int(x)) for x in emp_ids) or '0'
        psql_erp(f"BEGIN; SET LOCAL session_replication_role = replica; "
             f"DELETE FROM acct_lines WHERE entry_id IN (SELECT id FROM acct_entries WHERE source IN ('PAYROLL', 'PAYROLL_PAID') AND source_key = '{rid}'); "
             f"DELETE FROM acct_entries WHERE source IN ('PAYROLL', 'PAYROLL_PAID') AND source_key = '{rid}'; "
             f"DELETE FROM acct_payroll_lines WHERE run_id = {rid} OR employee_id IN ({ids}); DELETE FROM acct_payroll_runs WHERE id = {rid}; "
             f"DELETE FROM acct_employees WHERE id IN ({ids}); DELETE FROM acct_wht_table WHERE year = {YR}; COMMIT;")
        rm_role(pid, '1403')
    pass  # ERP: 화면 단계(옛 운영 화면 ADMIN_WEB) 뺌 — ERP 화면(15175)에 아직 없음
else:
    print('  (API · DB 없음 — ② ③ ④ 건너뜀)')

summary()
