"""v10.397 (D246 · docs/534) 계정별 원장 · 매입매출장
  ① (코드) 원장 · 매입매출장 함수 · API 4 · 내려받기 승인 ACCT_LEDGER(D246 CHECK · export-approval) · 화면 · 메뉴 · 명세 · 문서 534
  ② (API) 광고 청구 · 입금 → 전표 → 외상매출금 원장(기초 + 차변 − 대변 = 기말) · 보통예금 원장에 입금 · 매출장에 거래처 · 공급가 · 세액 · 매입장 모양
  ③ (API) 틀린 종류 · 날짜 · 1년 넘는 기간 422 · CSV 승인 없이 422 · 승인 뒤 받음 · 회원 403
  ④ (화면) 회계 › 원장
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1397.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1397.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




import glob


M46 = migr('D246_')
AC, UI, AP, MN = rd('src/modules/acct/acct.controller.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
SRC = rd('src/modules/acct/sources.ts')


LG = rd('src/modules/acct/ledger.ts')
EA = rd('src/modules/admin/export-approval.ts')
ok('① 코드 — 원장 · 매입매출장 · API 4 · 내려받기 승인 ACCT_LEDGER · 화면 · 메뉴 · 명세 · 문서 534 · 판 v10.397' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   'export async function accountLedger' in LG
       and 'export async function salesPurchaseBook' in LG
       and "@Get('ledger')" in AC
       and "@Get('ledger/export')" in AC
       and "@Get('books')" in AC
       and "@Get('books/export')" in AC
       and "@ExportGate('ACCT_LEDGER')" in AC, VER)
if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW); agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1397', 'PAYOUT'); agree(pe, PW); TP = login(pe)
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    d0 = kst.strftime('%Y-%m-%d'); m0 = d0[:8] + '01'
    stamp = int(time.time()) % 1000000
    amt = 30000 + stamp % 9000
    name = f'시험원장1397{stamp}'
    try:
        adv = sgb('POST', '/admin/advertisers', {'code': f'ADV-1397-{stamp}', 'name': f'(주){name}'}, TS)
        inv = sgb('POST', '/admin/ad-invoices', {'advertiserId': adv.get('id'), 'periodFrom': d0, 'periodTo': d0, 'amount': amt, 'vat': amt // 10, 'dueDate': d0, 'memo': '시험 1397'}, TS)
        sv = (psql_sgb(f"SELECT amount || '|' || vat || '|' || total FROM ad_invoices WHERE id = '{inv.get('id')}'") or '0|0|0').split('|')
        sup, vat, tot0 = (int(x) if x.lstrip('-').isdigit() else 0 for x in (sv + ['0', '0', '0'])[:3])
        pay = sgb('POST', f"/admin/ad-invoices/{inv.get('id')}/payments", {'amount': tot0, 'method': 'TRANSFER', 'payerName': name}, TS)
        erp('POST', '/admin/acct/journal/run', None, TS)
        e_inv = psql_erp(f"SELECT id FROM acct_entries WHERE source = 'AD_INVOICE' AND source_key = '{inv.get('id')}'")
        ar = erp('GET', f'/admin/acct/ledger?role=AR&from={m0}&to={d0}', None, TP)
        ca = erp('GET', f'/admin/acct/ledger?role=CASH&from={m0}&to={d0}', None, TP)
        sb = erp('GET', f'/admin/acct/books?kind=SALES&from={m0}&to={d0}', None, TP)
        pb = erp('GET', f'/admin/acct/books?kind=PURCHASE&from={m0}&to={d0}', None, TP)
        arow = next((r for r in ar.get('rows') or [] if r.get('entryId') == e_inv), {})
        sale = next((x for x in sb.get('items') or [] if x.get('entryId') == e_inv), {})
        tot = ar.get('total') or {}
        ok('② 원장 · 장부 — 외상매출금 원장에 청구 줄 · 기초 + 차변 − 대변 = 기말 · 보통예금 원장에 입금 · 매출장에 거래처 · 공급가 · 세액 · 매입장 모양',
           bool(e_inv) and tot0 > 0 and arow.get('debit') == tot0 and ar.get('closing') == ar.get('opening', 0) + tot.get('debit', 0) - tot.get('credit', 0)
           and any(r.get('party') == f'(주){name}' and r.get('debit') == tot0 for r in ca.get('rows') or [])
           and sale.get('party') == f'(주){name}' and sale.get('supply') == sup and sale.get('vat') == vat and any(p.get('party') == f'(주){name}' for p in sb.get('parties') or [])
           and isinstance(pb.get('items'), list) and 'total' in pb,
           f"{e_inv} · {arow} · {ar.get('opening')} {tot} {ar.get('closing')} · 매출 {sale} · 매입 {len(pb.get('items') or [])}")
        bk = erp('GET', f'/admin/acct/books?kind=X&from={m0}&to={d0}', None, TP)
        bd = erp('GET', f'/admin/acct/ledger?role=CASH&from={d0}&to={m0}', None, TP) if d0 != m0 else {'code': 'ACCT_DATE'}
        by = erp('GET', f'/admin/acct/ledger?role=CASH&from=2024-01-01&to={d0}', None, TP)
        nf = erp('GET', f'/admin/acct/ledger?role=NO_SUCH&from={m0}&to={d0}', None, TP)
        mem = erp('GET', f'/admin/acct/ledger?role=CASH&from={m0}&to={d0}', None, TB)
        nt = erp('GET', f'/admin/acct/ledger/export?role=AR&from={m0}&to={d0}', None, TP)
        tk = ticket(TP, 'ACCT_LEDGER', TS)
        cv = erp('GET', f'/admin/acct/ledger/export?role=AR&from={m0}&to={d0}&ticket={tk}', None, TP) if tk else {}
        tk2 = ticket(TP, 'ACCT_LEDGER', TS)
        cb = erp('GET', f'/admin/acct/books/export?kind=SALES&from={m0}&to={d0}&ticket={tk2}', None, TP) if tk2 else {}
        head = (cv.get('csv') or '').lstrip('﻿').split('\r\n')[0]
        hb = (cb.get('csv') or '').lstrip('﻿').split('\r\n')[0]
        ok('③ 검사 · CSV — 틀린 종류 422 · 시작 > 끝 422 · 1년 넘음 422 · 없는 계정 404 · 회원 403 · 승인 없이 422 · 승인 뒤 원장 · 매출장 CSV',
           bk.get('code') == 'ACCT_BOOK' and bd.get('code') == 'ACCT_DATE' and by.get('code') == 'ACCT_DATE' and nf.get('_err') == 404 and mem.get('_err') == 403
           and nt.get('code') == 'EXPORT_NEED_APPROVAL' and head.startswith('일자,전표번호,근거,적요') and hb.startswith('일자,전표번호,근거,거래처') and f'(주){name}' in (cb.get('csv') or ''),
           f"{bk.get('code')} {bd.get('code')} {by.get('code')} {nf.get('_err')} {mem.get('_err')} · {nt.get('code')} · {bool(tk)} {head[:30]} · {bool(tk2)} {hb[:30]}")
    finally:
        rm_role(pid, '1397')
    pass  # ERP: 화면 단계(옛 운영 화면 ADMIN_WEB) 뺌 — ERP 화면(15175)에 아직 없음
else:
    print('  (API · DB 없음 — ② ③ ④ 건너뜀)')
summary()
