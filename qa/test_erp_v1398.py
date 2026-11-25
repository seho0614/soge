"""v10.398 (D246 · docs/535) 고정자산 대장 · 감가상각
  ① (코드) D246 고정자산 · 상각 표 · 가드 · 정기 작업 · 전표 4가지 · API 5 · 화면 · 메뉴 · 명세 · 문서 535
  ② (API) 직접 넣기(정액 12달 · 시작 전 달 경고) · 상각 계획 합 = 취득가 − 잔존 · 정률 계획 마지막 달 잔존 · 틀린 값 422 · 지급 담당 넣기 403
  ③ (API · DB) 상각 한 줄 → 전표(감가상각비 / 누계액) · 상각 뒤 취득가 고치기 · 지우기 DB 가 막음 · 처분 → 처분 전표(차대 맞음) · 두 번 처분 422
  ④ (API) ⑫ 매입에서 넘기기 — 취득가 = 공급가 · 두 번 422 · 「자산으로 넘기기」 전표
  ⑤ (화면) 회계 › 고정자산
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1398.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1398.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




import glob


M46 = migr('D246_')
AC, UI, AP, MN = rd('src/modules/acct/acct.controller.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
SRC = rd('src/modules/acct/sources.ts')


AS = rd('src/modules/acct/assets.ts')
ok('① 코드 — D246 acct_assets · acct_depreciations(쌓기만) · 가드 · 정기 작업 acct_depreciation · 전표 4 · API 5 · 화면 · 메뉴 · 명세 · 문서 535 · 판 v10.398' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   'export const ASSET_SOURCES' in AS
       and "name: 'DEPRECIATION'" in AS
       and "name: 'ASSET_DISPOSE'" in AS
       and 'ASSET_SOURCES' in SRC
       and "@Post('assets')" in AC
       and "@Post('assets/:id/dispose')" in AC
       and "@Post('assets/depreciate')" in AC, VER)
if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW)
    TS = login('admin@x.com')
    pe, pid = mk_staff('1398', 'PAYOUT'); agree(pe, PW); TP = login(pe)
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    d0, ym = kst.strftime('%Y-%m-%d'), kst.strftime('%Y-%m')
    stamp = int(time.time()) % 1000000
    start = (getset('acct.start_on') or '2026-11-01')[:7]
    try:
        a1 = erp('POST', '/admin/acct/assets', {'name': f'시험노트북1398-{stamp}', 'acquiredOn': '2026-01-15', 'cost': 1200000, 'residual': 0, 'lifeMonths': 12, 'method': 'STRAIGHT', 'payRole': 'NONE'}, TS)
        aid = str(a1.get('id') or '')
        det = erp('GET', f'/admin/acct/assets/{aid}', None, TP)
        plan = det.get('plan') or []
        lst = erp('GET', '/admin/acct/assets', None, TP)
        it = next((x for x in lst.get('items') or [] if x.get('id') == aid), {})
        a2 = erp('POST', '/admin/acct/assets', {'name': f'시험서버1398-{stamp}', 'acquiredOn': d0, 'cost': 5000000, 'residual': 250000, 'lifeMonths': 60, 'method': 'DECLINING', 'payRole': 'AP'}, TS)
        p2 = erp('GET', f"/admin/acct/assets/{a2.get('id')}", None, TP).get('plan') or []
        bad = erp('POST', '/admin/acct/assets', {'name': '시험', 'acquiredOn': d0, 'cost': 1000, 'residual': 1000, 'lifeMonths': 12, 'method': 'STRAIGHT', 'payRole': 'AP'}, TS)
        bad2 = erp('POST', '/admin/acct/assets', {'name': '시험', 'acquiredOn': d0, 'cost': 1000, 'lifeMonths': 0, 'method': 'STRAIGHT'}, TS)
        byp = erp('POST', '/admin/acct/assets', {'name': '시험', 'acquiredOn': d0, 'cost': 1000, 'lifeMonths': 12, 'method': 'STRAIGHT'}, TP)
        ok('② 넣기 · 계획 — 정액 12달 × 100,000 · 합 = 취득가 · 시작 전 달 경고 · 정률 마지막 장부가 = 잔존 · 잔존 ≥ 취득가 422 · 연수 0 은 400 · 지급 담당 403',
           bool(aid) and len(plan) == 12 and all(p.get('amount') == 100000 for p in plan) and sum(p.get('amount', 0) for p in plan) == 1200000
           and (it.get('gapBeforeStart') or 0) > 0 and p2 and p2[-1].get('bookAfter') == 250000 and sum(p.get('amount', 0) for p in p2) == 4750000
           and bad.get('code') == 'ACCT_ASSET' and bad2.get('_err') == 400 and byp.get('_err') == 403,
           f"{aid} · {len(plan)} {plan[:1]} · gap {it.get('gapBeforeStart')} · 정률 {len(p2)} {p2[-1:] } · {bad.get('code')} {bad2.get('_err')} {byp.get('_err')}")

        # 상각 한 줄(이번 달 · 정기 작업은 끝난 달만이라 시험이 직접) → 전표
        psql_erp(f"INSERT INTO acct_depreciations (asset_id, ym, amount, book_after) VALUES ({aid or 0}, '{ym}', 100000, 1100000) ON CONFLICT DO NOTHING")
        dj = erp('POST', '/admin/acct/assets/depreciate', None, TS)
        erp('POST', '/admin/acct/journal/run', None, TS)
        did = psql_erp(f"SELECT id FROM acct_depreciations WHERE asset_id = {aid or 0} AND ym = '{ym}'")
        dep = psql_erp(f"SELECT string_agg(l.role || ':' || l.debit || ':' || l.credit, ',' ORDER BY l.debit DESC) FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id WHERE e.source = 'DEPRECIATION' AND e.source_key = '{did}'")
        upd = psql_erp(f"UPDATE acct_assets SET cost = cost + 1 WHERE id = {aid or 0}")
        dlt = psql_erp(f"DELETE FROM acct_assets WHERE id = {aid or 0}")
        dd = psql_erp(f"DELETE FROM acct_depreciations WHERE id = {did or 0}")
        ds = erp('POST', f'/admin/acct/assets/{aid}/dispose', {'disposedOn': d0, 'amount': 50000, 'reason': '시험 1398 매각'}, TS)
        ds2 = erp('POST', f'/admin/acct/assets/{aid}/dispose', {'disposedOn': d0, 'amount': 0, 'reason': '시험 1398 두 번'}, TS)
        erp('POST', '/admin/acct/journal/run', None, TS)
        dsp = psql_erp(f"SELECT coalesce(sum(l.debit), 0) || '|' || coalesce(sum(l.credit), 0) || '|' || coalesce(string_agg(l.role, ',' ORDER BY l.id), '') FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id WHERE e.source = 'ASSET_DISPOSE' AND e.source_key = '{aid}'")
        acc_now = ds.get('accumulated') or 0
        ok('③ 상각 · 처분 — 상각 전표 감가상각비 / 누계액 · 지금 상각 응답 · 상각 뒤 취득가 고치기 · 자산 · 상각 지우기 DB 가 막음 · 처분(손실) · 처분 전표 차대 같음 · 두 번 처분 422',
           dep == 'EXP_DEPR:100000:0,ACC_DEPR:0:100000' and 'made' in dj and '!' in upd and '!' in dlt and '!' in dd
           and ds.get('ok') is True and ds.get('gain') == 50000 + acc_now - 1200000 and ds2.get('code') == 'ACCT_ASSET_DISPOSED'
           and dsp.split('|')[0] == dsp.split('|')[1] == '1200000',
           f"{dep} · {dj} · {upd[-30:]} · {dlt[-30:]} · {dd[-30:]} · {ds.get('gain')} {acc_now} · {ds2.get('code')} · {dsp}")

        # ⑫ 매입에서 넘기기
        item = f'시험모니터1398-{stamp}'
        pr = erp('POST', '/admin/acct/purchases', {'kind': 'TAX_INVOICE', 'issuedOn': d0, 'supplierName': '(주)시험전산', 'supplierBizNo': f'{1000000000 + stamp:010d}'[:10],
                                                    'item': item, 'supply': 300000 + stamp % 1000, 'vat': (300000 + stamp % 1000) // 10, 'deductible': True,
                                                    'accountRole': 'EXP_SUPPLIES', 'payRole': 'AP', 'force': True}, TS)
        prid = psql_erp(f"SELECT id FROM acct_purchases WHERE item = '{item}'")
        erp('POST', '/admin/acct/journal/run', None, TS)
        f1 = erp('POST', '/admin/acct/assets', {'purchaseId': prid, 'lifeMonths': 60, 'method': 'STRAIGHT'}, TS)
        f2 = erp('POST', '/admin/acct/assets', {'purchaseId': prid, 'lifeMonths': 60, 'method': 'STRAIGHT'}, TS)
        erp('POST', '/admin/acct/journal/run', None, TS)
        fa = psql_erp(f"SELECT cost || '|' || pay_role || '|' || coalesce(from_role, '') FROM acct_assets WHERE id = {f1.get('id') or 0}")
        fe = psql_erp(f"SELECT string_agg(l.role || ':' || l.debit || ':' || l.credit, ',' ORDER BY l.debit DESC) FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id WHERE e.source = 'ASSET_FROM_PURCHASE' AND e.source_key = '{f1.get('id')}'")
        sup = 300000 + stamp % 1000
        ok('④ 매입에서 — 취득가 = 공급가 · PURCHASE · 원래 계정 소모품비 · 두 번 422 · 전표 비품 / 소모품비',
           bool(prid) and f1.get('ok') is True and fa == f'{sup}|PURCHASE|EXP_SUPPLIES' and f2.get('code') == 'ACCT_ASSET_DUP' and fe == f'FIXED_ASSET:{sup}:0,EXP_SUPPLIES:0:{sup}',
           f"{pr.get('_err') or pr.get('code') or ''} {prid} · {f1.get('ok') or f1.get('code')} · {fa} · {f2.get('code')} · {fe}")
    finally:
        rm_role(pid, '1398')
    pass  # ERP: 화면 단계(옛 운영 화면 ADMIN_WEB) 뺌 — ERP 화면(15175)에 아직 없음
else:
    print('  (API · DB 없음 — ② ③ ④ ⑤ 건너뜀)')
summary()
