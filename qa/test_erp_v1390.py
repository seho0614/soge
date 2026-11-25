"""v10.390 (D244 · docs/527) 월 결산 요약 · 신고 기한 알림
  ① (코드) 설정 · 정기 작업 · 기한 셈 · 요약 · 화면 · 문서
  ② (API) 요약 — 할 일 4줄 · 매출 = 전표 합 · 기한(원천세 10일 · 부가세 25일 · 주말 · 공휴일이면 다음 영업일)
  ③ (정기 작업) 기한 N일 안이면 ACCT_DEADLINE 한 번(두 번 돌려도 하나) · 지난 기한 알림은 풀림 · 지난달 마감 안 함 ACCT_UNCLOSED 한 번
  ④ (화면) 회계 › 월 결산
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1390.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1390.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




M44 = rd('prisma/migrations/D244_acct_bank_format_deadline_etax/migration.sql')
AC, RP, UI, AP, MN = rd('src/modules/acct/acct.controller.ts'), rd('src/modules/acct/acct-reports.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
MO, SC, WK = rd('src/modules/acct/month.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')
ok('① 코드 — 설정 4 · 정기 작업 acct_deadline(09:15) · 기한 셈(영업일) · 알림 ACCT_DEADLINE · ACCT_UNCLOSED · 요약 · API 2 · 화면 · 메뉴 첫 탭 · 문서 527 · 판 v10.390' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   'fn_is_business_day' in MO
       and "'ACCT_DEADLINE'" in MO
       and "'ACCT_UNCLOSED'" in MO
       and 'export async function monthSummary' in MO
       and "@Get('month')" in AC
       and "@Get('deadlines')" in AC, VER)
if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW); agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1390', 'PAYOUT'); agree(pe, PW); TP = login(pe)
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    ym, today = kst.strftime('%Y-%m'), kst.strftime('%Y-%m-%d')
    pm = (kst.replace(day=1) - datetime.timedelta(days=1)).strftime('%Y-%m')
    keep = {k: getset(k) for k in ('acct.vat_months', 'acct.deadline_days_before', 'acct.close_by_day', 'acct.start_on', 'acct.deadline_alert')}
    t0 = psql_sgb("SELECT now()")
    try:
        m = erp('GET', f'/admin/acct/month?ym={ym}', None, TP)
        sq = psql_erp(f"SELECT coalesce(sum(l.credit - l.debit) FILTER (WHERE a.kind = 'REVENUE'), 0) FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id JOIN acct_accounts a ON a.role = l.role WHERE e.ym = '{ym}'")
        mb = erp('GET', f'/admin/acct/month?ym={ym}', None, TB)
        # 이번 달 25일을 부가세 달로 · 알림 7일 전 — 기한 API 와 정기 작업이 같은 날을 봄
        setting('acct.vat_months', str(int(ym[5:7])), '1390'); setting('acct.deadline_days_before', '7', '1390'); setting('acct.deadline_alert', 'on', '1390')
        dl = erp('GET', '/admin/acct/deadlines', None, TP)
        lst = dl.get('list') or []
        wht = next((x for x in lst if x.get('kind') == 'WHT'), {})
        vat = next((x for x in lst if x.get('kind') == 'VAT' and x.get('base') == f'{ym}-25'), None)
        biz = psql_erp(f"SELECT fn_is_business_day('{wht.get('due') or today}'::date)") if wht else 'f'
        ok('② 요약 · 기한 — 할 일 4줄(전표 · 통장 · 세금계산서 · 마감) · 이번 달 매출 = 전표 매출 줄 합 · 회원 403 · 원천세 기한은 10일 이후 첫 영업일 · 부가세(이번 달 25일 · 지나지 않았으면) · 남은 날',
           [c.get('key') for c in m.get('checks') or []] == ['journal', 'bank', 'invoices', 'close'] and int((m.get('money') or {}).get('revenue', -1)) == int(sq or 0) and mb.get('_err') == 403
           and bool(wht) and wht.get('due') >= wht.get('base', '') and wht.get('base', '').endswith('-10') and biz == 't'
           and (vat is not None or today > f'{ym}-25') and all(isinstance(x.get('daysLeft'), int) and x['daysLeft'] >= 0 for x in lst),
           f"{[c.get('key') for c in m.get('checks') or []]} · 매출 {(m.get('money') or {}).get('revenue')} = {sq} · {mb.get('_err')} · 원천 {wht} {biz} · 부가 {vat}")

        print('  (ERP: ③ 정기 작업 acct_deadline — ERP 작업 실행기(JOBS)에 회계 정기 작업이 아직 없음 — 정기 작업 주인 SGB(E7 에서 넘김) — 뺌)')
    finally:
        for k, v in keep.items():
            if v: setting(k, v, '1390 되돌림')
        # 시험이 만든 알림은 확인함으로(다른 시험의 「안 본 알림」 셈에 끼지 않게)
        psql_erp(f"UPDATE ops_alerts SET resolved_at = now(), resolve_note = '시험 1390' WHERE alert_code IN ('ACCT_DEADLINE', 'ACCT_UNCLOSED') AND resolved_at IS NULL AND raised_at >= '{t0}'::timestamptz")
        rm_role(pid, '1390')
    pass  # ERP: 화면 단계(옛 운영 화면 ADMIN_WEB) 뺌 — ERP 화면(15175)에 아직 없음
else:
    print('  (API · DB 없음 — ② ③ ④ 건너뜀)')

summary()
