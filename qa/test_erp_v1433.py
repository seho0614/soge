"""v10.433 (D256 · docs/570) 견적서 · 주문서 · 거래명세서 · 발주서 인쇄
  ① (코드) D256 문서 표 · 가드(내용 못 고침) · 세금계산서 종류 SALES_DOC · 전표 SALES_DOC · 새 컨트롤러 · 화면 · 문서 570
  ② (API · DB) 견적 → 새 판 → 주문 → 거래명세서 · 확정 · 매출 전표(차변 = 대변) · 세금계산서 요청 · 내용 고치기 DB 막음 · ADMIN 만들기 · 상태 403 · 회원 403 · 취소 → 반대 전표
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1433.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1433.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




M56 = migr('D256_')
EC, SD, DP, WH, DN = rd('src/modules/acct/erp.controller.ts'), rd('src/modules/acct/salesdocs.ts'), rd('src/modules/acct/depts.ts'), rd('src/modules/acct/warehouse.ts'), rd('src/modules/acct/dunning.ts')
UI, AP, MN, SR, AM, SC, WK = rd('web/src/app/admin/Erp.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/modules/acct/sources.ts'), rd('src/app.module.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')
stamp = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today = kst.strftime('%Y-%m-%d')
def party(tag, email=None):
    nm = f'시험거래처{tag}-{stamp}'
    e = f"'{email}'" if email else 'NULL'
    return psql_erp(f"INSERT INTO acct_parties (kind, name, contact_email) VALUES ('BOTH', '{nm}', {e}) RETURNING id").split('\n')[0], nm

ok('① 코드 — D256 acct_sales_docs · 줄 · 가드 · 번호 · SALES_DOC 세금계산서 · 전표 2 · ErpController · 화면 ErpDocs · 메뉴 acct-docs · 문서 570 · 판 v10.433' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   "name: 'SALES_DOC'" in SD
       and "name: 'SALES_DOC_CANCEL'" in SD
       and 'SALES_DOC_SOURCES' in SR
       and 'export class ErpController' in EC
       and 'ErpController' in AM
       and "@Audit('ACCT_DOC_ADD', 'SETTING')" in EC, VER)

if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW); agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    ae, aid = mk_staff('1433', 'ADMIN'); agree(ae, PW); TA = login(ae)
    pid, pnm = party('1433')
    try:
        lines = [{'item': '시험 컨설팅', 'qty': 2, 'unitPrice': 50000, 'taxType': 'TAXABLE'}, {'item': '시험 면세', 'qty': 1, 'unitPrice': 10000, 'taxType': 'EXEMPT'}]
        q1 = erp('POST', '/admin/acct/sales-docs', {'kind': 'QUOTE', 'partyId': pid, 'title': f'시험 1433 {stamp}', 'lines': lines}, TA)
        bad = erp('POST', '/admin/acct/sales-docs', {'kind': 'QUOTE', 'partyId': pid, 'title': 'x', 'lines': []}, TS)
        rv = erp('POST', f"/admin/acct/sales-docs/{q1.get('id')}/revise", {'lines': lines + [{'item': '추가', 'qty': 1, 'unitPrice': 1000}]}, TS)
        rv2 = erp('POST', f"/admin/acct/sales-docs/{q1.get('id')}/revise", {'lines': lines}, TS)
        o1 = erp('POST', f"/admin/acct/sales-docs/{rv.get('id')}/convert", {'to': 'ORDER'}, TS)
        s1 = erp('POST', f"/admin/acct/sales-docs/{o1.get('id')}/convert", {'to': 'STATEMENT'}, TS)
        byadm = erp('POST', f"/admin/acct/sales-docs/{s1.get('id')}/state", {'state': 'ACCEPTED'}, TA)
        acc = erp('POST', f"/admin/acct/sales-docs/{s1.get('id')}/state", {'state': 'ACCEPTED'}, TS)
        det = erp('GET', f"/admin/acct/sales-docs/{s1.get('id')}", None, TS)
        fixed = psql_erp(f"UPDATE acct_sales_docs SET title = '바꿈' WHERE id = '{s1.get('id')}'")
        erp('POST', '/admin/acct/journal/run', None, TS)
        ent = psql_erp(f"SELECT coalesce(sum(l.debit), 0) || '|' || coalesce(sum(l.credit), 0) || '|' || count(*) FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id WHERE e.source = 'SALES_DOC' AND e.source_key = '{s1.get('id')}'")
        ti = erp('POST', f"/admin/acct/sales-docs/{s1.get('id')}/tax-invoice", None, TS)
        ti2 = erp('POST', f"/admin/acct/sales-docs/{s1.get('id')}/tax-invoice", None, TS)
        kind = psql_erp(f"SELECT kind || '|' || total FROM acct_tax_invoices WHERE id = '{ti.get('taxInvoiceId')}'") if ti.get('taxInvoiceId') else ''
        cx_ti = erp('POST', f"/admin/acct/tax/invoices/{ti.get('taxInvoiceId')}/cancel", {'reason': '시험 1433 취소'}, TS) if ti.get('taxInvoiceId') else {}
        cx = erp('POST', f"/admin/acct/sales-docs/{s1.get('id')}/state", {'state': 'CANCELED', 'reason': '시험 1433 취소'}, TS)
        erp('POST', '/admin/acct/journal/run', None, TS)
        rev = psql_erp(f"SELECT count(*) FROM acct_entries WHERE source = 'SALES_DOC_CANCEL' AND source_key = '{s1.get('id')}'")
        lst = erp('GET', '/admin/acct/sales-docs', None, TB)
        want = 100000 + 10000 + 10000 + 1000 + 100   # 과세 10만 + 부가세 1만 + 면세 1만 + 고친 판에 더한 「추가」 1천(과세 · 부가세 100)
        ok('② 문서 — 견적(ADMIN) · 빈 품목 400/422 · 새 판 2 · 옛 판 다시 고치기 409 · 주문 · 거래명세서 · ADMIN 확정 403 · 확정 · 합계(과세 · 면세) · DB 고치기 막음 · 매출 전표 차변 = 대변 3줄 · 세금계산서 요청(SALES_DOC) · 두 번 409 · 취소 → 반대 전표 · 회원 403',
           q1.get('ok') is True and str(q1.get('docNo', '')).startswith('Q-') and bad.get('_err') in (400, 422) and rv.get('rev') == 2 and rv2.get('code') == 'ACCT_DOC_STATE'
           and str(o1.get('docNo', '')).startswith('O-') and str(s1.get('docNo', '')).startswith('S-') and byadm.get('_err') == 403 and acc.get('ok') is True
           and (det.get('doc') or {}).get('total') == want and 'ACCT_DOC_FIXED' in fixed and ent == f'{want}|{want}|3'
           and ti.get('ok') is True and ti2.get('code') == 'ACCT_DOC_STATE' and kind == f'SALES_DOC|{want}' and cx.get('ok') is True and rev == '1' and lst.get('_err') == 403,
           f"{q1.get('docNo')} {bad.get('_err')} {rv.get('rev')} {rv2.get('code')} {o1.get('docNo')} {s1.get('docNo')} {byadm.get('_err')} {acc.get('ok')} {(det.get('doc') or {}).get('total')} {fixed[-30:]} {ent} {ti.get('ok')} {ti2.get('code')} {kind} {cx.get('ok') or cx.get('code')} {rev} {lst.get('_err')}")
    finally:
        rm_role(aid, '1433')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

summary()
