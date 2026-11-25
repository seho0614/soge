"""v10.383 (D242 · docs/519) 신고 자료 · 세금계산서 대상 · 상품 과세
  ① (코드) D242 · API · 화면
  ② (상품) 면세 · 되돌림 · 권한
  ③ (신고 자료) 부가세 · 원천세 · 세금계산서 · CSV
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1383.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1383.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




M42, AC, RP, UI, EX = rd('prisma/migrations/D242_acct_journal_closing_tax_type/migration.sql'), rd('src/modules/acct/acct.controller.ts'), rd('src/modules/acct/acct-reports.ts'), rd('web/src/app/admin/Acct.tsx'), rd('src/modules/admin/export-approval.ts')
ok('① 코드 — D242 상품 · 주문 줄 과세 구분(옮김 트리거) · 내려받기 대상 ACCT_JOURNAL · ACCT_TAX · 부가세 · 원천세 · 세금계산서 · CSV(승인) · 신고 자료 화면 · 문서 519 · 판 v10.383' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   'export async function vatSummary' in RP, VER)
if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW); agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1383', 'PAYOUT'); agree(pe, PW); TP = login(pe)
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    ym, q = kst.strftime('%Y-%m'), f"{kst.year}-{(kst.month - 1) // 3 + 1}"
    try:
        pr = erp('GET', '/admin/acct/products', None, TS)
        items = pr.get('items') or []
        code = items[0]['code'] if items else None
        t0 = items[0]['taxType'] if items else None
        tenant = psql_sgb("SELECT p.code FROM hlt_products p JOIN hlt_sellers s ON s.id = p.seller_id AND s.type <> 'DIRECT' LIMIT 1")
        e1 = erp('PATCH', f'/admin/acct/products/{code}/tax-type', {'taxType': 'EXEMPT', 'reason': '시험 1383 면세'}, TS) if code else {}
        db1 = psql_sgb(f"SELECT tax_type FROM hlt_products WHERE code = '{code}'") if code else ''
        e2 = erp('PATCH', f'/admin/acct/products/{code}/tax-type', {'taxType': t0 or 'TAXABLE', 'reason': '시험 1383 되돌림'}, TS) if code else {}
        et = erp('PATCH', f'/admin/acct/products/{tenant}/tax-type', {'taxType': 'EXEMPT', 'reason': '시험 1383 입점'}, TS) if tenant else {'_err': 404}
        ep = erp('PATCH', f'/admin/acct/products/{code}/tax-type', {'taxType': 'EXEMPT', 'reason': '시험 1383 지급'}, TP) if code else {'_err': 403}
        aud = psql_erp("SELECT count(*) FROM erp_audit WHERE action = 'PRODUCT_TAX_TYPE' AND at > now() - interval '10 minutes'")   # ERP 감사는 erp_audit(at)
        ok('② 상품 과세 — 직판 상품 목록 · 면세로(DB) · 되돌림 · 입점 상품 404 · 지급 담당 403 · 감사',
           bool(code) and e1.get('ok') is True and db1 == 'EXEMPT' and e2.get('ok') is True and et.get('_err') == 404 and ep.get('_err') == 403 and int(aud or 0) >= 2,
           f"{code} {t0} · {e1.get('ok')} {db1} {e2.get('ok')} · 입점 {tenant or '없음'} {et.get('_err')} · {ep.get('_err')} · 감사 {aud}")
        erp('POST', '/admin/acct/journal/run', None, TS)
        v = erp('GET', f'/admin/acct/tax/vat?q={q}', None, TP)
        sq = psql_erp(f"SELECT coalesce(sum(l.credit - l.debit) FILTER (WHERE l.role IN ('REV_SUB','REV_REFCODE','REV_AD','REV_LEAD','REV_DIRECTORY','REV_COMMISSION','REV_MALL')), 0) || '|' || coalesce(sum(l.credit - l.debit) FILTER (WHERE l.role = 'VAT_OUT'), 0) FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id WHERE e.entry_date >= '{(v.get('from') or '2000-01-01')}' AND e.entry_date < '{(v.get('to') or '2000-01-01')}'")
        w = erp('GET', f'/admin/acct/tax/withholding?ym={ym}', None, TP)
        iv = erp('GET', f'/admin/acct/tax/invoices?ym={ym}', None, TP)
        bq = erp('GET', '/admin/acct/tax/vat?q=2026-5', None, TS)
        vb = erp('GET', f'/admin/acct/tax/vat?q={q}', None, TB)
        nt = erp('GET', f'/admin/acct/tax/export?kind=VAT&period={q}', None, TP)
        tk = ticket(TP, 'ACCT_TAX', TS)
        cv = erp('GET', f'/admin/acct/tax/export?kind=VAT&period={q}&ticket={tk}', None, TP) if tk else {}
        head = (cv.get('csv') or '').lstrip('﻿').split('\r\n')[0]
        tot = v.get('total') or {}
        ok('③ 신고 자료 — 부가세 분기 합 = 전표 매출 · 부가세 줄 합 · 원천세 달 · 세금계산서 대상(아직 수) · 틀린 분기 ok false · 회원 403 · CSV 승인 없이 422 · 승인 뒤 받음',
           v.get('ok') is True and f"{tot.get('supply')}|{tot.get('vat')}" == sq and 'month' in w and 'ytd' in w and isinstance(iv.get('items'), list) and 'todo' in iv
           and bq.get('ok') is False and vb.get('_err') == 403 and nt.get('code') == 'EXPORT_NEED_APPROVAL' and bool(tk) and head == '분기,증빙,돈 흐름,과세 공급가,세액,면세 매출,전표 수',
           f"{tot} = {sq} · 원천 {w.get('month')} · 계산서 {len(iv.get('items') or [])} 아직 {iv.get('todo')} · {bq.get('ok')} {vb.get('_err')} · {nt.get('code')} · {bool(tk)} · {head[:30]}")
    finally:
        rm_role(pid, '1383')
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

summary()
