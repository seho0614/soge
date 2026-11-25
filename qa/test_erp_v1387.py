"""v10.387 (D243 · docs/523) 부가세 별도 — 리드 캐시 충전 · 충전 때 세금계산서
  ① (코드) D243 · 충전 · 확인 · 자동 · 환불 · 화면
  ② (충전) 시작일 전 = 충전 금액 · 뒤 = 충전 + 부가세 · 지갑은 충전 금액만 · 세금계산서 요청 줄 · 전표
  ③ (환불) 부가세 몫 함께 취소
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1387.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1387.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




def setvat(v):
    """부가세 별도 시작일을 SQL 로(시험만 · 지난 날짜도) — 비우기는 ''"""
    return psql_sgb(f"BEGIN; SELECT set_config('app.setting_reason', '시험 {TAG}', true); UPDATE site_settings SET value = '{v}' WHERE key = 'vat.separate_from'; COMMIT;")

TAG = '1387'
M43, LC, CP, JN = rd('prisma/migrations/D243_vat_separate/migration.sql'), rd('src/modules/partner/lead-cash.service.ts'), rd('site/src/components/partner/CashPanel.tsx'), rd('src/modules/acct/journal.ts')
ok('① 코드 — D243 충전 부가세 · 충전 세금계산서 트리거 · 달 사용액은 시작일 전만 · 충전 · 확인 대조 · 자동 · 환불 부가세 몫 · 화면 · 전표 · 문서 523 · 판 v10.387' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   "revenueSep('REV_LEAD'" in JN, VER)
if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW); agree('intro@x.com', PW)
    TS, TP = login('admin@x.com'), login('intro@x.com')
    v0 = psql_sgb("SELECT coalesce(value, '') FROM site_settings WHERE key = 'vat.separate_from'")
    is0 = psql_sgb("SELECT coalesce(value, '') FROM site_settings WHERE key = 'acct.include_stub'")
    st0 = psql_sgb("SELECT coalesce(value, '') FROM site_settings WHERE key = 'acct.start_on'")
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    today = kst.strftime('%Y-%m-%d')
    seta = lambda k, v: psql_sgb(f"BEGIN; SELECT set_config('app.setting_reason', '시험 {TAG}', true); UPDATE site_settings SET value = '{v}' WHERE key = '{k}'; COMMIT;")
    wal = lambda: (sgb('GET', '/partner/cash', None, TP) or {})
    def charge(amt, pay):
        c = sgb('POST', '/partner/cash/charges', {'amount': amt}, TP)
        j = sgb('POST', '/partner/cash/charges/confirm', {'orderId': c.get('orderId'), 'paymentKey': f'stub_{TAG}_{time.time_ns()}', 'amount': pay(c)}, TP) if c.get('orderId') else {}
        return c, j
    try:
        seta('acct.include_stub', 'on'); seta('acct.start_on', '2026-01-01')
        setvat('')
        w0 = wal(); room = int((w0.get('limits') or {}).get('maxBalance') or 0) - int(w0.get('paid') or 0)
        if room < 60000 and int(w0.get('paid') or 0) > 0:   # 다른 시험이 채운 잔액 — 시작일 전(부가세 없음)에 덜어 둠
            sgb('POST', '/partner/cash/refunds', {'amount': min(int(w0.get('paid') or 0), 60000 - room), 'reason': f'시험 {TAG} 자리 만들기'}, TP)
        c0, j0 = charge(20000, lambda c: c.get('amount'))
        inv0 = psql_sgb(f"SELECT count(*) FROM lead_cash_invoices WHERE charge_id = '{c0.get('id')}'")
        setvat(today)
        w1 = wal()
        bad = sgb('POST', '/partner/cash/charges', {'amount': 20000}, TP)
        badc = sgb('POST', '/partner/cash/charges/confirm', {'orderId': bad.get('orderId'), 'paymentKey': f'stub_{TAG}_bad_{time.time_ns()}', 'amount': 20000}, TP) if bad.get('orderId') else {}
        c1, j1 = charge(20000, lambda c: c.get('payAmount'))
        w2 = wal()
        inv1 = psql_sgb(f"SELECT total || '|' || supply || '|' || vat || '|' || state FROM lead_cash_invoices WHERE charge_id = '{c1.get('id')}'")
        erp('POST', '/admin/acct/journal/run', None, TS)
        en = psql_erp(f"SELECT (SELECT string_agg(l.role || ':' || l.debit || ':' || l.credit, ',' ORDER BY l.id) FROM acct_lines l WHERE l.entry_id = e.id) FROM acct_entries e WHERE e.source = 'LEAD_CHARGE' AND e.source_key = '{c1.get('id')}'")
        ok('② 충전 — 시작일 전 결제 = 충전 금액 · 세금계산서 줄 없음 · 뒤 결제 = 22,000(충전 금액만 보내면 422) · 지갑 +20,000 · 세금계산서 요청 22,000 = 20,000 + 2,000 · 전표 받을 돈 22,000 · 매출 20,000 · 부가세 2,000 · vatSeparate',
           j0.get('ok') is True and int(c0.get('vat') or 0) == 0 and int(c0.get('payAmount') or 0) == 20000 and inv0 == '0'
           and int(c1.get('vat') or 0) == 2000 and int(c1.get('payAmount') or 0) == 22000 and j1.get('ok') is True and badc.get('code') == 'AMOUNT_MISMATCH'
           and int(w2.get('paid') or 0) - int(w1.get('paid') or 0) == 20000 and inv1 == '22000|20000|2000|REQUESTED' and en == 'PG_RECV:22000:0,REV_LEAD:0:20000,VAT_OUT:0:2000' and w2.get('vatSeparate') is True,
           f"전 {c0.get('payAmount')} {j0.get('ok') or j0.get('code')} 줄 {inv0} · 뒤 {c1.get('payAmount')} {j1.get('ok') or j1.get('code')} · 잘못 {badc.get('code')} · 지갑 {w1.get('paid')} → {w2.get('paid')} · {inv1} · {en} · {w2.get('vatSeparate')}")
        rf = sgb('POST', '/partner/cash/refunds', {'amount': 10000, 'reason': f'시험 {TAG} 환불'}, TP)
        pt = psql_sgb(f"SELECT p.amount || '|' || p.vat || '|' || c.vat_refunded FROM lead_cash_refund_parts p JOIN lead_cash_charges c ON c.id = p.charge_id WHERE p.charge_id = '{c1.get('id')}' ORDER BY p.refund_id DESC LIMIT 1")
        ok('③ 환불 — 10,000 환불이면 그 충전 부가세 몫 1,000 함께 취소 · vat_refunded 1,000',
           rf.get('ok') is True and pt == '10000|1000|1000', f"{rf.get('state') or rf.get('code')} · {pt}")
    finally:
        setvat(v0); seta('acct.include_stub', is0 or 'off'); seta('acct.start_on', st0 or '2026-11-01')
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

summary()
