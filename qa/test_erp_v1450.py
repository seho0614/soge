"""v10.450 (D260 · docs/587) 현금출납장
  ① (코드) books.ts cashBook · 계정 CASH_HAND(현금 101) · API 2 · 화면 AcctCashbook · 메뉴 · 화면 ID SB-ADM-LDG-020 · 문서 587
  ② (API) 보통예금 · 현금 — 기초 + 들어옴 − 나감 = 기말 · 날짜별 합 = 전체 · 원장과 같은 기말 · 모르는 계정은 보통예금 · 회원 403 · CSV 승인
  ③ (화면) 회계 › 장부 › 현금출납장
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1450.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1450.py
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
ok('① 코드 — 출납장 함수 · 현금 계정 CASH_HAND(101) · API 2 · 내려받기 승인 · 화면 · 메뉴 · 탭 · 화면 ID · 권한 업무 · 문서 587 · 판 v10.450' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   'export async function cashBook' in BK
       and "CASHBOOK_ROLES = ['CASH', 'CASH_HAND']" in BK
       and "@Get('cashbook')" in BC
       and "@Get('cashbook/export')" in BC, VER)

if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW); agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1450', 'PAYOUT'); agree(pe, PW); TP = login(pe)
    try:
        c = erp('GET', f'/admin/acct/cashbook?role=CASH&from={m1}&to={today}', None, TP)
        h = erp('GET', f'/admin/acct/cashbook?role=CASH_HAND&from={m1}&to={today}', None, TP)
        x = erp('GET', f'/admin/acct/cashbook?role=AR&from={m1}&to={today}', None, TP)
        lg = erp('GET', f'/admin/acct/ledger?role=CASH&from={m1}&to={today}', None, TP)
        t = c.get('total') or {}
        days = c.get('days') or []
        same = c.get('opening', 0) + t.get('in', -1) - t.get('out', 0) == c.get('closing') and sum(d['in'] for d in days) == t.get('in') and sum(d['out'] for d in days) == t.get('out')
        mem = erp('GET', f'/admin/acct/cashbook?from={m1}&to={today}', None, TB)
        nt = erp('GET', f'/admin/acct/cashbook/export?role=CASH&from={m1}&to={today}', None, TP)
        tk = ticket(TP, 'ACCT_LEDGER', TS)
        ex = erp('GET', f'/admin/acct/cashbook/export?role=CASH&from={m1}&to={today}&ticket={tk}', None, TP) if tk else {}
        ok('② 출납장 — 기초 + 들어옴 − 나감 = 기말 · 날짜별 합 = 전체 · 원장 기말과 같음 · 현금(시재) 계정 · 모르는 계정은 보통예금 · 회원 403 · 승인 없이 422 · 승인 뒤 머리줄',
           c.get('role') == 'CASH' and same and c.get('closing') == lg.get('closing') and h.get('role') == 'CASH_HAND' and (h.get('account') or {}).get('name') == '현금(시재)'
           and x.get('role') == 'CASH' and mem.get('_err') == 403 and nt.get('code') == 'EXPORT_NEED_APPROVAL' and bool(tk)
           and str(ex.get('csv') or '').lstrip('﻿').startswith('일자,전표번호,근거,적요,거래처,들어옴,나감,잔액'),
           f"{c.get('role')} {same} {c.get('closing')}/{lg.get('closing')} · {h.get('role')} {(h.get('account') or {}).get('name')} · {x.get('role')} · {mem.get('_err')} · {nt.get('code')} {bool(tk)} {str(ex.get('csv') or '')[:30]!r}")
    finally:
        rm_role(pid, '1450')
    pass  # ERP: 화면 단계(옛 운영 화면 ADMIN_WEB) 뺌 — ERP 화면(15175)에 아직 없음
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

summary()
