"""v10.384 (D242 · docs/520) 경영 보고서
  ① (코드) API · 화면 · 첫 화면 카드
  ② (API) 매출 · 비용 · 이익 = 전표
  ③ (화면) 회계 메뉴 · 카드
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1384.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1384.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




AC, RP, UI, DB_, AP = rd('src/modules/acct/acct.controller.ts'), rd('src/modules/acct/acct-reports.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/app/admin/Dashboard.tsx'), rd('web/src/App.tsx')
ok('① 코드 — 경영 보고서 API · 화면 · 첫 화면 카드(SUPER) · 문서 520 · 판 v10.384' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   "@Get('report')" in AC
       and 'export async function acctReport' in RP, VER)
if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW); agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1384', 'PAYOUT'); agree(pe, PW); TP = login(pe)
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    ym, d0 = kst.strftime('%Y-%m'), kst.strftime('%Y-%m-%d')
    stamp = int(time.time()) % 1000000
    try:
        adv = sgb('POST', '/admin/advertisers', {'code': f'ADV-1384-{stamp}', 'name': f'시험광고주1384 {stamp}'}, TS)
        sgb('POST', '/admin/ad-invoices', {'advertiserId': adv.get('id'), 'periodFrom': d0, 'periodTo': d0, 'amount': 30000, 'dueDate': d0, 'memo': '시험 1384'}, TS)
        erp('POST', '/admin/acct/journal/run', None, TS)
        r = erp('GET', '/admin/acct/report?months=12', None, TP)
        sq = psql_erp(f"SELECT coalesce(sum(l.credit - l.debit) FILTER (WHERE a.kind = 'REVENUE'), 0) || '|' || coalesce(sum(l.debit - l.credit) FILTER (WHERE a.kind = 'EXPENSE'), 0) FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id JOIN acct_accounts a ON a.role = l.role WHERE e.ym = '{ym}' AND e.source NOT IN ('YEAR_CLOSE', 'YEAR_REOPEN')")   # v10.396 (D246) — 경영 보고서는 계정 종류로 셈(매출원가 · 처분 손익 포함)
        last = next((m for m in r.get('months') or [] if m.get('ym') == ym), {})
        rb = erp('GET', '/admin/acct/report', None, TB)
        rv, ex = (sq.split('|') + ['0', '0'])[:2]
        ok('② API — 이번 달 매출 = 전표 매출 줄 합 · 비용 = 비용 줄 합 · 이익 = 매출 − 비용 · 최근 달 · 지급 담당 보기 · 회원 403',
           int(last.get('revenue') or -1) == int(rv) and int(last.get('expense') or 0) == int(ex) and last.get('profit') == int(rv) - int(ex) and int(rv) >= 30000
           and (r.get('latest') or {}).get('ym') == ym and rb.get('_err') == 403, f"{last} · {sq} · {rb.get('_err')}")
    finally:
        rm_role(pid, '1384')
    pass  # ERP: 화면 단계(옛 운영 화면 ADMIN_WEB) 뺌 — ERP 화면(15175)에 아직 없음
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

summary()
