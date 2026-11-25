"""v10.400 (D247 · docs/537) 부가세 신고서 미리보기
  ① (코드) 신고서 칸 · 설정 · API 2 · 화면 · 문서
  ② (API) 칸 15줄 · 매출세액 = 전표 VAT_OUT · 매입세액 = 전표 VAT_IN · 납부 · 차가감 · 틀린 분기 422 · 회원 403
  ③ (CSV) 승인 없이 422 · 승인 뒤 머리줄 · 16줄
  ④ (화면) 회계 › 부가세 신고서
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1400.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1400.py
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


VF = rd('src/modules/acct/vatform.ts')
ok('① 코드 — 신고서 미리보기(매출 1 · 3 · 4 · 매입 10 · 11 · 14 · 불공제 16 · 납부세액 · 전자신고 공제) · 설정 acct.vat_efile_credit · API 2(CSV 승인 ACCT_TAX) · 화면 · 메뉴 · 문서 537 · 판 v10.400' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   'export async function vatForm' in VF
       and "'VAT_IN'" in VF
       and "'FIXED_ASSET'" in VF
       and 'acct.vat_efile_credit' in VF
       and "@Get('tax/vat-form')" in AC
       and "@Get('tax/vat-form/export')" in AC, VER)
if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW); agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1400', 'PAYOUT'); agree(pe, PW); TP = login(pe)
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    q = f"{kst.year}-{(kst.month - 1) // 3 + 1}"
    k = (kst.month - 1) // 3 + 1
    fr = f"{kst.year}-{k * 3 - 2:02d}-01"
    to = f"{kst.year + 1}-01-01" if k == 4 else f"{kst.year}-{k * 3 + 1:02d}-01"
    try:
        f = erp('GET', f'/admin/acct/tax/vat-form?q={q}', None, TP)
        L = {x['no']: x for x in f.get('lines') or []}
        out_sql = psql_erp(f"SELECT coalesce(sum(l.credit - l.debit), 0) FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id WHERE l.role = 'VAT_OUT' AND e.entry_date >= '{fr}' AND e.entry_date < '{to}' AND e.source NOT IN ('YEAR_CLOSE', 'YEAR_REOPEN')")
        in_sql = psql_erp(f"SELECT coalesce(sum(l.debit - l.credit), 0) FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id WHERE l.role = 'VAT_IN' AND e.entry_date >= '{fr}' AND e.entry_date < '{to}'")
        s9 = sum(int(L[n]['vat']) for n in ('1', '2', '3', '4', '5', '6') if n in L)
        s15 = sum(int(L[n]['vat']) for n in ('10', '11', '14') if n in L)
        bad = erp('GET', '/admin/acct/tax/vat-form?q=2026-9', None, TP)
        mb = erp('GET', f'/admin/acct/tax/vat-form?q={q}', None, TB)
        ok('② 신고서 — 칸 15줄 · 매출세액(9) = 1 ~ 6 합 = 전표 VAT_OUT · 매입세액(15) = 10 + 11 + 14 = 전표 VAT_IN · 납부(다) = 9 − 15 · 차가감(마) = 다 − 전자신고 공제 · 틀린 분기 422 · 회원 403',
           len(L) == 15 and int(L['9']['vat']) == s9 == int(out_sql or 0) and int(L['15']['vat']) == s15 == int(in_sql or 0)
           and int(L['다']['vat']) == s9 - s15 and int(L['마']['vat']) == int(L['다']['vat']) + int(L['라']['vat']) == int(f.get('due', -1))
           and bad.get('code') == 'ACCT_PERIOD' and mb.get('_err') == 403,
           f"{len(L)} · 9 {L.get('9', {}).get('vat')} = {s9} = {out_sql} · 15 {L.get('15', {}).get('vat')} = {s15} = {in_sql} · 다 {L.get('다', {}).get('vat')} 마 {L.get('마', {}).get('vat')} · {bad.get('code')} {mb.get('_err')}")
        nt = erp('GET', f'/admin/acct/tax/vat-form/export?q={q}', None, TP)
        tk = ticket(TP, 'ACCT_TAX', TS)
        cv = erp('GET', f'/admin/acct/tax/vat-form/export?q={q}&ticket={tk}', None, TP) if tk else {}
        head = (cv.get('csv') or '').lstrip('﻿').split('\r\n')[0]
        ok('③ CSV — 승인 없이 422 · 승인 뒤 머리줄(칸 · 나눔 · 항목 · 금액 · 세액) · 16줄(면세 한 줄 더)',
           nt.get('code') == 'EXPORT_NEED_APPROVAL' and bool(tk) and head == '칸,나눔,항목,금액(공급가),세액' and int(cv.get('rows') or 0) == 16,
           f"{nt.get('code')} · {bool(tk)} · {head} · {cv.get('rows')}")
    finally:
        rm_role(pid, '1400')
    pass  # ERP: 화면 단계(옛 운영 화면 ADMIN_WEB) 뺌 — ERP 화면(15175)에 아직 없음
else:
    print('  (API · DB 없음 — ② ③ ④ 건너뜀)')

summary()
