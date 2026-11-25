"""v10.449 (D260 · docs/586) 분개장
  ① (코드) books.ts dayBook · 컨트롤러 · 화면 AcctDaybook · 메뉴 acct-daybook · 화면 ID SB-ADM-LDG-010 · 권한 업무 · 문서 586
  ② (API) 이번 달 분개장 — 차변 = 대변 · 전표마다 차대 같음 · 날짜 순 · 잘못된 날짜 422 · 1년 넘음 422 · 회원 403 · CSV 승인 없이 422 · 승인 뒤 머리줄
  ③ (화면) 회계 › 장부 › 분개장
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1449.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1449.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




M60 = migr('D260_')
BK, BC = rd('src/modules/acct/books.ts'), rd('src/modules/acct/acct-books.controller.ts')
UI, AP, MN, AM, AT, MA = rd('web/src/app/admin/AcctBooks.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/app.module.ts'), rd('web/src/app/admin/Acct.tsx'), rd('src/modules/acct/manual.ts')
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today = kst.strftime('%Y-%m-%d'); ym = today[:7]; m1 = ym + '-01'
stamp = int(time.time()) % 1000000

ok('① 코드 — 분개장 함수 · API 2 · 내려받기 승인 ACCT_LEDGER · 화면 · 메뉴 · 탭 · 화면 ID · 권한 업무 · 문서 586 · 판 v10.449' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   'export async function dayBook' in BK
       and "@Get('daybook')" in BC
       and "@Get('daybook/export')" in BC
       and "@ExportGate('ACCT_LEDGER')" in BC
       and 'AcctBooksController' in AM, VER)

if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW); agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1449', 'PAYOUT'); agree(pe, PW); TP = login(pe)
    try:
        d = erp('GET', f'/admin/acct/daybook?from={m1}&to={today}', None, TP)
        es = d.get('entries') or []
        each = all(e.get('debit') == e.get('credit') and len(e.get('lines') or []) >= 2 for e in es)
        order = all((es[i]['date'], int(es[i]['entryId'])) <= (es[i + 1]['date'], int(es[i + 1]['entryId'])) for i in range(len(es) - 1))
        db_n = psql_erp(f"SELECT count(*) FROM acct_entries WHERE entry_date BETWEEN '{m1}' AND '{today}'")
        bad = erp('GET', '/admin/acct/daybook?from=2026-13-01&to=2026-11-30', None, TP)
        long_ = erp('GET', '/admin/acct/daybook?from=2024-01-01&to=2026-11-30', None, TP)
        mem = erp('GET', f'/admin/acct/daybook?from={m1}&to={today}', None, TB)
        nt = erp('GET', f'/admin/acct/daybook/export?from={m1}&to={today}', None, TP)
        tk = ticket(TP, 'ACCT_LEDGER', TS)
        ex = erp('GET', f'/admin/acct/daybook/export?from={m1}&to={today}&ticket={tk}', None, TP) if tk else {}
        ok('② 분개장 — 합계 차변 = 대변 · 전표마다 같음 · 날짜 · 번호 순 · 전표 수 = DB · 잘못된 날짜 422 · 1년 넘음 422 · 회원 403 · 승인 없이 422 · 승인 뒤 CSV 머리줄',
           d.get('balanced') is True and each and order and (d.get('truncated') or str(len(es)) == db_n) and bad.get('_err') == 422 and long_.get('_err') == 422
           and mem.get('_err') == 403 and nt.get('code') == 'EXPORT_NEED_APPROVAL' and bool(tk) and str(ex.get('csv') or '').lstrip('﻿').startswith('일자,전표번호,근거,적요,거래처,증빙,계정코드,계정,차변,대변'),
           f"{d.get('balanced')} {each} {order} {len(es)}/{db_n} · {bad.get('_err')} {long_.get('_err')} {mem.get('_err')} · {nt.get('code')} {bool(tk)} {str(ex.get('csv') or '')[:40]!r}")
    finally:
        rm_role(pid, '1449')
    pass  # ERP: 화면 단계(옛 운영 화면 ADMIN_WEB) 뺌 — ERP 화면(15175)에 아직 없음
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

summary()
