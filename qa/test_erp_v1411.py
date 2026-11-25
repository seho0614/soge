"""v10.411 (D249 · docs/548) 무역 1단계 · 수입 건 관리
  ① (코드) D249 수입 건 · 품목 표 · 가드 · 전표 IMPORT_VAT · 재고 수불부 IN · API 5 · 화면 · 문서 548
  ② (API · DB) 발주 · 선적 · 통관 · 입력 검사 · 단계 건너뛰기 · 뒤로 · 통관 뒤 취소 · 품목 잠금
  ③ (API · DB) 입고 원가(물품 + 관세 + 운임 + 기타) · 재고 수불부 IN · 수입 부가세 전표 · STOCK_IN 전표
  ④ (화면) 회계 › 수입
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1411.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1411.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




def lines_of(source, key):
    """전표 줄 → 'ROLE:차변:대변' 정렬 목록"""
    out = psql_erp(f"SELECT l.role || ':' || l.debit || ':' || l.credit FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id WHERE e.source = '{source}' AND e.source_key = '{key}' ORDER BY 1")
    return sorted(x for x in out.split('\n') if x and not x.startswith('!'))


M49 = migr('D249_')
AC, UI, AP, MN = rd('src/modules/acct/acct.controller.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
IM, SR = rd('src/modules/acct/imports.ts'), rd('src/modules/acct/sources.ts')
ok('① 코드 — D249 수입 건 · 품목 표 · 가드(앞으로만 · 통관 전 취소 · 통관 뒤 품목 잠금) · 입고 → 재고 수불부 IN · 전표 IMPORT_VAT · API 5 · 감사 · 화면 · 메뉴 · 문서 548 · 판 v10.411' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   'export const IMPORT_SOURCES' in IM
       and "name: 'IMPORT_VAT'" in IM
       and 'INSERT INTO acct_stock_moves' in IM
       and 'IMPORT_SOURCES' in SR
       and "@Get('imports')" in AC
       and "@Get('imports/:id')" in AC
       and "@Post('imports')" in AC
       and "@Post('imports/:id/advance')" in AC
       and "@Post('imports/:id/cancel')" in AC
       and "@Audit('ACCT_IMPORT_ADVANCE', 'SETTING')" in AC, VER)

if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW); agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1411', 'PAYOUT'); agree(pe, PW); TP = login(pe)
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    d0 = kst.strftime('%Y-%m-%d'); tomorrow = (kst + datetime.timedelta(days=1)).strftime('%Y-%m-%d')
    stamp = int(time.time()) % 1000000
    opts = [x for x in psql_sgb("SELECT o.id FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id JOIN hlt_sellers s ON s.id = p.seller_id AND s.type = 'DIRECT' ORDER BY o.id LIMIT 2").split('\n') if len(x) == 36]
    notdirect = psql_sgb("SELECT o.id FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id JOIN hlt_sellers s ON s.id = p.seller_id AND s.type <> 'DIRECT' LIMIT 1")
    imp = None
    if len(opts) < 1:
        print('  (직판 상품 옵션 없음 — ② ③ 건너뜀)')
    else:
        lines = [{'optionId': o, 'qty': 10 * (i + 1), 'foreignAmount': 100.5 * (i + 1)} for i, o in enumerate(opts)]
        try:
            i1 = erp('POST', '/admin/acct/imports', {'title': f'시험 수입 1411-{stamp}', 'currency': 'usd', 'orderedOn': d0, 'lines': lines}, TP); imp = i1.get('id')
            fut = erp('POST', '/admin/acct/imports', {'title': f'시험 수입 1411 앞날', 'orderedOn': tomorrow, 'lines': lines}, TP)
            nd = erp('POST', '/admin/acct/imports', {'title': f'시험 수입 1411 입점', 'orderedOn': d0, 'lines': [{'optionId': notdirect, 'qty': 1, 'foreignAmount': 1}]}, TP) if len(notdirect) == 36 else {'code': 'IMPORT_LINES'}
            mem = erp('POST', '/admin/acct/imports', {'title': '회원 1411', 'orderedOn': d0, 'lines': lines}, TB)
            skip = erp('POST', f'/admin/acct/imports/{imp}/advance', {'to': 'RECEIVED', 'date': d0}, TP)
            s1 = erp('POST', f'/admin/acct/imports/{imp}/advance', {'to': 'SHIPPED', 'date': d0, 'blNo': f'BL1411{stamp}'}, TP)
            back = erp('POST', f'/admin/acct/imports/{imp}/advance', {'to': 'ORDERED', 'date': d0}, TP)
            nofx = erp('POST', f'/admin/acct/imports/{imp}/advance', {'to': 'CUSTOMS', 'date': d0}, TP)
            s2 = erp('POST', f'/admin/acct/imports/{imp}/advance', {'to': 'CUSTOMS', 'date': d0, 'fxRate': 1300, 'duty': 10000, 'importVat': 50000, 'brokerName': '시험관세사', 'declNo': f'D{stamp}'}, TP)
            cx = erp('POST', f'/admin/acct/imports/{imp}/cancel', {'reason': '시험 1411 통관 뒤 취소'}, TP)
            lk = psql_erp(f"UPDATE acct_import_lines SET qty = qty + 1 WHERE import_id = {imp or 0}")
            ok('② 발주 · 선적 · 통관 — 통화 대문자 · 앞날 422 · 입점 상품 422 · 회원 403 · 통관 없이 입고 422 · 뒤로 422 · 환율 없음 422 · 통관 뒤 취소 409 · 통관 뒤 품목 DB 가 막음',
               i1.get('ok') is True and psql_erp(f"SELECT currency FROM acct_imports WHERE id = {imp or 0}") == 'USD' and fut.get('code') == 'IMPORT_DATE' and nd.get('code') == 'IMPORT_LINES'
               and mem.get('_err') == 403 and skip.get('code') == 'IMPORT_STATE' and s1.get('state') == 'SHIPPED' and back.get('code') in ('IMPORT_STATE', 'VALIDATION_ERROR')
               and nofx.get('code') == 'IMPORT_FX' and s2.get('state') == 'CUSTOMS' and cx.get('code') == 'IMPORT_STATE' and 'ACCT_IMPORT' in lk,
               f"{i1} · {fut.get('code')} · {nd.get('code')} · {mem.get('_err')} · {skip.get('code')} · {s1.get('state')} · {back.get('code')} · {nofx.get('code')} · {s2.get('state')} · {cx.get('code')} · {lk[-40:]}")
            s3 = erp('POST', f'/admin/acct/imports/{imp}/advance', {'to': 'RECEIVED', 'date': d0, 'freight': 20000, 'otherCost': 5001}, TP)
            goods = sum(round(l['foreignAmount'] * 1300) for l in lines)
            landed = psql_erp(f"SELECT coalesce(sum(landed_cost), 0) FROM acct_import_lines WHERE import_id = {imp or 0}")
            mv = psql_erp(f"SELECT count(*) || '|' || coalesce(sum(qty), 0) FROM acct_stock_moves WHERE kind = 'IN' AND source_key LIKE 'IMP-{imp}-%'")
            erp('POST', '/admin/acct/journal/run', None, TS)
            vl = lines_of('IMPORT_VAT', imp)
            si = psql_erp(f"SELECT count(*) FROM acct_entries e JOIN acct_stock_moves m ON e.source = 'STOCK_IN' AND e.source_key = m.id::text WHERE m.source_key LIKE 'IMP-{imp}-%'")
            again = erp('POST', f'/admin/acct/imports/{imp}/advance', {'to': 'RECEIVED', 'date': d0}, TP)
            dt = erp('GET', f'/admin/acct/imports/{imp}', None, TP)
            ok('③ 입고 — 원가 = 물품(외화 × 환율) + 관세 + 운임 + 기타 · 품목마다 재고 수불부 IN · 수입 부가세 전표(부가세대급금 / 미지급금) · 재고 전표 STOCK_IN · 입고 뒤 다시 409 · 한 건 보기',
               s3.get('state') == 'RECEIVED' and s3.get('goodsKrw') == goods and landed == str(goods + 10000 + 20000 + 5001)
               and mv == f"{len(lines)}|{sum(l['qty'] for l in lines)}" and vl == ['AP:0:50000', 'VAT_IN:50000:0'] and si == str(len(lines))
               and again.get('code') == 'IMPORT_STATE' and len(dt.get('lines') or []) == len(lines) and all(x.get('moveId') for x in dt.get('lines') or []),
               f"{s3} · 물품 {goods} · 원가 {landed} · {mv} · {vl} · {si} · {again.get('code')} · {len(dt.get('lines') or [])}")
        finally:
            if imp:   # 시험 수불 · 전표 · 수입 건은 지움(같은 옵션 재고 시험 · 다시 돌림에 영향 없게)
                psql_erp(f"""BEGIN; SET LOCAL session_replication_role = replica;
                  DELETE FROM acct_lines WHERE entry_id IN (SELECT e.id FROM acct_entries e WHERE (e.source = 'IMPORT_VAT' AND e.source_key = '{imp}')
                     OR (e.source = 'STOCK_IN' AND e.source_key IN (SELECT m.id::text FROM acct_stock_moves m WHERE m.source_key LIKE 'IMP-{imp}-%')));
                  DELETE FROM acct_entries e WHERE (e.source = 'IMPORT_VAT' AND e.source_key = '{imp}')
                     OR (e.source = 'STOCK_IN' AND e.source_key IN (SELECT m.id::text FROM acct_stock_moves m WHERE m.source_key LIKE 'IMP-{imp}-%'));
                  DELETE FROM acct_stock_moves WHERE source_key LIKE 'IMP-{imp}-%';
                  DELETE FROM acct_import_lines WHERE import_id = {imp}; DELETE FROM acct_imports WHERE id = {imp}; COMMIT;""")
    rm_role(pid, '1411')
    pass  # ERP: 화면 단계(옛 운영 화면 ADMIN_WEB) 뺌 — ERP 화면(15175)에 아직 없음
else:
    print('  (API · DB 없음 — ② ③ ④ 건너뜀)')

summary()
