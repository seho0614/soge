"""v10.428 (D254 · docs/565) 무역 2단계 — 수출(수주 → 선적 → 수출신고 수리 → 대금 회수) · 국내 구매 발주(입고 = 매입 + 재고)
  ① (코드) D254 수출 · 발주 표 · 가드 · 계정 3 · 전표 EXPORT_SALE · EXPORT_PAID · 부가세 신고서 영세율 · API 8 · 화면 · 메뉴 · 문서
  ② (API) 수주 → 선적(환율 · 매출) → 전표 AR / REV_EXPORT → 수출신고 → 대금 회수(환율 차이 외환차익) · 뒤로 422 · 선적 뒤 취소 409 · 부가세 신고서 6번
  ③ (API) 발주 → 입고(매입 한 건 · 합계 = 공급가 + 10%) · 입고 뒤 취소 409 · 매입처 없음 422
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1428.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1428.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




M54 = migr('D254_')
TR, SR, VF, UI, MN, AP, AC = rd('src/modules/acct/trade.ts'), rd('src/modules/acct/sources.ts'), rd('src/modules/acct/vatform.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('src/modules/acct/acct.controller.ts')
ok('① 코드 — D254 acct_exports · acct_pos · 가드 · 계정(REV_EXPORT · FX_GAIN · FX_LOSS) · 전표 2 · 영세율 칸 · API · 화면 · 메뉴 · 문서 565 · 판 v10.428' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   "name: 'EXPORT_SALE'" in TR
       and "name: 'EXPORT_PAID'" in TR
       and 'EXPORT_SOURCES' in SR
       and "l.role = 'REV_EXPORT'" in VF
       and "@Get('exports')" in AC
       and "@Post('pos/:id/receive')" in AC, VER)

if API and DB:
    import random  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW)
    TS = login('admin@x.com')
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    d0 = kst.strftime('%Y-%m-%d'); q = f"{kst.year}-{(kst.month - 1) // 3 + 1}"
    stamp = random.randint(100000000, 999999999)
    pt = erp('POST', '/admin/acct/parties', {'kind': 'BOTH', 'name': f'시험1428 상사 {stamp}', 'bizNo': f'8{stamp}'}, TS)
    pid = str(pt.get('id') or '')
    exids = []
    try:
        vf0 = erp('GET', f'/admin/acct/tax/vat-form?q={q}', None, TS)
        six0 = next((l.get('supply') for l in vf0.get('lines') or [] if l.get('no') == '6'), 0) or 0
        ex = erp('POST', '/admin/acct/exports', {'partyId': pid, 'title': f'시험1428 수출 {stamp}', 'currency': 'USD', 'incoterms': 'FOB', 'orderedOn': d0,
                                                   'lines': [{'item': '시험 품목', 'qty': 3, 'foreignAmount': 1000.5}]}, TS)
        eid = str(ex.get('id') or ''); exids.append(eid)
        back = erp('POST', f'/admin/acct/exports/{eid}/advance', {'to': 'ORDERED', 'date': d0}, TS)
        sh = erp('POST', f'/admin/acct/exports/{eid}/advance', {'to': 'SHIPPED', 'date': d0, 'fxRate': 1300, 'blNo': 'BL1428'}, TS)
        cx = erp('POST', f'/admin/acct/exports/{eid}/cancel', {'reason': '시험 1428'}, TS)
        erp('POST', '/admin/acct/journal/run', None, TS)
        sale_lines = psql_erp(f"SELECT string_agg(l.role || ':' || l.debit || ':' || l.credit, ',' ORDER BY l.id) FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id WHERE e.source = 'EXPORT_SALE' AND e.source_key = '{eid}'")
        cl = erp('POST', f'/admin/acct/exports/{eid}/advance', {'to': 'CLEARED', 'date': d0, 'declNo': f'1428-{stamp}'}, TS)
        want = round(1000.5 * 1300)
        pd = erp('POST', f'/admin/acct/exports/{eid}/advance', {'to': 'PAID', 'date': d0, 'paidKrw': want + 5000 + stamp % 97}, TS)
        erp('POST', '/admin/acct/journal/run', None, TS)
        paid_lines = psql_erp(f"SELECT string_agg(l.role || ':' || l.debit || ':' || l.credit, ',' ORDER BY l.id) FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id WHERE e.source = 'EXPORT_PAID' AND e.source_key = '{eid}'")
        vf1 = erp('GET', f'/admin/acct/tax/vat-form?q={q}', None, TS)
        six1 = next((l.get('supply') for l in vf1.get('lines') or [] if l.get('no') == '6'), 0) or 0
        ok('② 수출 — 수주 · 뒤로 422 · 선적(매출 = 외화 × 환율) · 선적 뒤 취소 409 · 전표 AR / REV_EXPORT · 수출신고 · 대금 회수 외환차익 · 부가세 신고서 6번 늘어남',
           ex.get('ok') is True and back.get('_err') in (400, 422) and sh.get('saleKrw') == want and cx.get('_err') == 409
           and sale_lines == f'AR:{want}:0,REV_EXPORT:0:{want}' and cl.get('ok') is True and pd.get('fxDiff') == 5000 + stamp % 97
           and paid_lines.startswith(f'CASH:{want + 5000 + stamp % 97}:0,AR:0:{want},FX_GAIN:0:{5000 + stamp % 97}') and six1 - six0 == want,
           f"{ex.get('ok')} {back.get('_err')} {sh.get('saleKrw')} {cx.get('_err')} · {sale_lines} · {cl.get('ok')} {pd.get('fxDiff')} · {paid_lines} · {six0} → {six1}")
        po = erp('POST', '/admin/acct/pos', {'partyId': pid, 'title': f'시험1428 발주 {stamp}', 'orderedOn': d0, 'lines': [{'item': '시험 포장재', 'qty': 10, 'unitPrice': 1234}]}, TS)
        nop = erp('POST', '/admin/acct/pos', {'title': 'x 발주', 'orderedOn': d0, 'lines': [{'item': '시험', 'qty': 1, 'unitPrice': 1}]}, TS)
        rc = erp('POST', f"/admin/acct/pos/{po.get('id')}/receive", {'date': d0, 'kind': 'TAX_INVOICE'}, TS)
        tot = psql_erp(f"SELECT total || '|' || account_role FROM acct_purchases WHERE id = {int(rc.get('purchaseId') or 0)}")
        pc = erp('POST', f"/admin/acct/pos/{po.get('id')}/cancel", {'reason': '시험 1428'}, TS)
        ok('③ 발주 — 넣기 · 매입처 없음 400/422 · 입고 = 매입 한 건(공급가 12,340 + 부가세 1,234 · 소모품비) · 입고 뒤 취소 409',
           po.get('ok') is True and nop.get('_err') in (400, 422) and rc.get('ok') is True and tot == '13574|EXP_SUPPLIES' and pc.get('_err') == 409,
           f"{po.get('ok')} {nop.get('_err')} {rc.get('ok')} {tot} {pc.get('_err')}")
    finally:
        # 회사 장부 시험 줄 — 수출 전표(보통예금 줄이 은행 맞추기 시험에 섞이지 않게)는 지움 · 매입은 1392 처럼 남김
        for e in exids:
            if e:
                psql_erp(f"SET session_replication_role = replica; DELETE FROM acct_lines WHERE entry_id IN (SELECT id FROM acct_entries WHERE source IN ('EXPORT_SALE', 'EXPORT_PAID') AND source_key = '{e}'); "
                     f"DELETE FROM acct_entries WHERE source IN ('EXPORT_SALE', 'EXPORT_PAID') AND source_key = '{e}'; DELETE FROM acct_export_lines WHERE export_id = {int(e)}; DELETE FROM acct_exports WHERE id = {int(e)};")
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

summary()
