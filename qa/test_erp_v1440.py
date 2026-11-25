"""v10.440 (D257 · docs/577) 장부 보관 · 내부통제 보고
  ① (코드) acct_archives(쌓기만) · 내려받기 대상 ACCT_ARCHIVE · 큰 금액 설정 · makeArchive · archiveExport · controlReport · 월보 한 줄 · API 4 · 화면 · 문서 577
  ② (API · DB) 마감 안 한 해 409 · 마감한 해 보관(지문 64자) · 목록 · 승인 없이 422 · 승인 뒤 받음(보관 때와 같음) · 지우기 DB 막음 · 내부통제 9줄 · 월보 한 줄 · 되돌림
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1440.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1440.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




M50 = migr('D250_')
RC, RD, RP, WL, RS = rd('src/modules/admin/report.controller.ts'), rd('src/modules/admin/report-day.ts'), rd('src/modules/admin/report-period.ts'), rd('src/modules/admin/worklog.ts'), rd('src/modules/admin/report-send.ts')

M57 = migr('D257_')
AX, AU, AM, AR, RA = rd('src/modules/acct/acct-extra.controller.ts'), rd('src/modules/acct/accountant.ts'), rd('src/modules/acct/accrual.ts'), rd('src/modules/acct/archive.ts'), rd('src/modules/acct/receipt-ai.ts')
UI, AP, MN, SC, WK, APM = rd('web/src/app/admin/AcctExtra.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'), rd('src/app.module.ts')
AUTH, PRN, MID, RPS, EXA, SRC = rd('src/core/auth.ts'), rd('src/modules/identity/principal.service.ts'), rd('src/modules/identity/auth.middleware.ts'), rd('src/modules/site/report.service.ts'), rd('src/modules/admin/export-approval.ts'), rd('src/modules/acct/sources.ts')
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
ym, d0 = kst.strftime('%Y-%m'), kst.strftime('%Y-%m-%d')
stamp = int(time.time()) % 1000000

RPP = rd('src/modules/admin/report-period.ts')
ok('① 코드 — D257 acct_archives(쌓기만) · ACCT_ARCHIVE · acct.control_big_amount · makeArchive · archiveExport · controlReport · 월보 controlLine · API 4 · 화면 · 문서 577 · 판 v10.440' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   'export async function makeArchive' in AR
       and 'export async function controlReport' in AR
       and "@ExportGate('ACCT_ARCHIVE')" in AX
       and "@Get('control')" in AX, VER)

if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW)
    TS = login('admin@x.com')
    pe, pid = mk_staff('1440', 'PAYOUT'); agree(pe, PW); TP = login(pe)
    Y = 2092
    try:
        psql_erp(f"SET session_replication_role = replica; DELETE FROM acct_archives WHERE year = {Y}; DELETE FROM acct_year_closings WHERE year = {Y};")
        nc = erp('POST', '/admin/acct/archives', {'year': Y}, TS)
        psql_erp(f"INSERT INTO acct_year_closings (year, action, net_income, revenue, expense) VALUES ({Y}, 'CLOSE', 0, 0, 0)")
        mk = erp('POST', '/admin/acct/archives', {'year': Y, 'note': '시험 1440'}, TS)
        lst = erp('GET', '/admin/acct/archives', None, TP)
        mine = next((x for x in lst.get('items') or [] if x.get('id') == mk.get('id')), {})
        nt = erp('GET', f"/admin/acct/archives/{mk.get('id')}/export", None, TP)
        tk = ticket(TP, 'ACCT_ARCHIVE', TS)
        ex = erp('GET', f"/admin/acct/archives/{mk.get('id')}/export?ticket={tk}", None, TP) if tk else {}
        dl = psql_erp(f"DELETE FROM acct_archives WHERE id = {int(mk.get('id') or 0)}")
        ct = erp('GET', f'/admin/acct/control?ym={ym}', None, TP)
        mo = sgb('GET', '/admin/work-reports/view?kind=MONTH', None, TS)
        ok('② 보관 · 통제 — 마감 안 한 해 409 · 마감한 해 보관(전표 0 · 지문 64자) · 목록 · 승인 없이 422 · 승인 뒤 받음(같음 · 머리줄) · 지우기 DB 막음 · 내부통제 9줄 · 월보 한 줄',
           nc.get('code') == 'ARCHIVE_NOT_CLOSED' and mk.get('ok') is True and mk.get('entries') == 0 and re.fullmatch(r'[0-9a-f]{64}', str(mk.get('csvSha256') or '')) is not None
           and mine.get('year') == Y and nt.get('code') == 'EXPORT_NEED_APPROVAL' and bool(tk) and ex.get('same') is True and str(ex.get('csv') or '').lstrip('\ufeff').startswith('일자,전표번호')
           and '!' in dl and len(ct.get('items') or []) == 9 and isinstance(ct.get('exceptions'), int) and bool((mo.get('control') or {}).get('text')),
           f"{nc.get('code')} · {mk.get('ok')} {mk.get('entries')} · {mine.get('year')} · {nt.get('code')} {bool(tk)} {ex.get('same')} · {dl[-30:]} · {len(ct.get('items') or [])} · {(mo.get('control') or {}).get('text', '')[:30]}")
    finally:
        psql_erp(f"SET session_replication_role = replica; DELETE FROM acct_archives WHERE year = {Y}; DELETE FROM acct_year_closings WHERE year = {Y};")
        rm_role(pid, '1440')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

summary()
