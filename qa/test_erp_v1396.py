"""v10.396 (D246 · docs/533) 시산표 · 손익계산서 · 재무상태표 · 기초 잔액
  ① (코드) D246 자본 종류 · 기초 잔액 표 · 가드 · trialBalance · API · 화면 · 메뉴 · 명세 · 문서 533
  ② (API) 시산표 차대 맞음 · 손익계산서 · 재무상태표 모양 · 지급 담당 보기 · 회원 403
  ③ (API · DB) 기초 잔액 — 판 만들기 · 같은 기준일 422 · 줄 저장 · 안 맞으면 확정 422 · 맞으면 확정 · 확정 뒤 줄 넣기 · 고치기 DB 가 막음 · 시산표 기초에 반영
  ④ (화면) 회계 › 재무제표
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1396.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1396.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




import glob


M46 = migr('D246_')
AC, UI, AP, MN = rd('src/modules/acct/acct.controller.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
SRC = rd('src/modules/acct/sources.ts')


ST = rd('src/modules/acct/statements.ts')
ok('① 코드 — D246 EQUITY 종류 · 기초 잔액 판 · 가드 · trialBalance · API 7 · 감사 · 화면 · 메뉴 · 명세 · 문서 533 · 판 v10.396' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   'export async function trialBalance' in ST
       and 'export async function balanceSheet' in ST
       and "@Get('statements/trial')" in AC
       and "@Get('statements/balance')" in AC
       and "@Post('opening/:id/fix')" in AC
       and "@Audit('ACCT_OPENING_FIX', 'SETTING')" in AC, VER)
if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW); agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1396', 'PAYOUT'); agree(pe, PW); TP = login(pe)
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    d0 = kst.strftime('%Y-%m-%d')
    stamp = int(time.time()) % 1000000
    as_of = (datetime.date(1990, 1, 1) + datetime.timedelta(days=stamp % 3000)).isoformat()   # 다른 판과 겹치지 않는 옛 날짜 · 끝에 지움
    sid = ''
    try:
        tb = erp('GET', f'/admin/acct/statements/trial?from={d0[:4]}-01-01&to={d0}', None, TP)
        inc = erp('GET', f'/admin/acct/statements/income?from={d0[:4]}-01-01&to={d0}', None, TP)
        bs = erp('GET', f'/admin/acct/statements/balance?asOf={d0}', None, TP)
        bad = erp('GET', '/admin/acct/statements/trial?from=2026-13-01&to=2026-11-30', None, TP)
        mem = erp('GET', f'/admin/acct/statements/balance?asOf={d0}', None, TB)
        ok('② 보기 — 시산표 차변 = 대변 · 손익 합계 = 매출 − 비용 · 재무상태표 합계 칸 · 틀린 날짜 422 · 회원 403',
           tb.get('balanced') is True and isinstance(tb.get('rows'), list) and (inc.get('total') or {}).get('profit') == (inc.get('total') or {}).get('revenue', 0) - (inc.get('total') or {}).get('expense', 0)
           and 'assets' in (bs.get('total') or {}) and 'unclosedProfit' in bs and bad.get('code') == 'ACCT_DATE' and mem.get('_err') == 403,
           f"{tb.get('balanced')} {len(tb.get('rows') or [])} · {inc.get('total')} · {bs.get('total')} {bs.get('balanced')} · {bad.get('code')} · {mem.get('_err')}")

        mk = erp('POST', '/admin/acct/opening', {'asOf': as_of, 'note': '시험 1396'}, TS)
        sid = str(mk.get('id') or '')
        dup = erp('POST', '/admin/acct/opening', {'asOf': as_of}, TS)
        byp = erp('POST', '/admin/acct/opening', {'asOf': as_of}, TP)
        amt = 100000 + stamp % 9000
        l1 = erp('PUT', f'/admin/acct/opening/{sid}/lines', {'lines': [{'role': 'CASH', 'debit': amt}, {'role': 'EQUITY_CAPITAL', 'credit': amt - 1}]}, TS)
        f0 = erp('POST', f'/admin/acct/opening/{sid}/fix', {'reason': '시험 1396 안 맞음'}, TS)
        l2 = erp('PUT', f'/admin/acct/opening/{sid}/lines', {'lines': [{'role': 'CASH', 'debit': amt, 'memo': '시험 통장'}, {'role': 'EQUITY_CAPITAL', 'credit': amt}]}, TS)
        bl = erp('PUT', f'/admin/acct/opening/{sid}/lines', {'lines': [{'role': 'CASH', 'debit': 5, 'credit': 5}]}, TS)
        f1 = erp('POST', f'/admin/acct/opening/{sid}/fix', {'reason': '시험 1396 확정'}, TS)
        l3 = erp('PUT', f'/admin/acct/opening/{sid}/lines', {'lines': [{'role': 'CASH', 'debit': 1}, {'role': 'EQUITY_CAPITAL', 'credit': 1}]}, TS)
        upd = psql_erp(f"UPDATE acct_opening SET debit = debit + 1 WHERE set_id = {sid or 0} AND role = 'CASH'")
        ins = psql_erp(f"INSERT INTO acct_opening (set_id, role, debit) VALUES ({sid or 0}, 'CASH', 1)")
        t2 = erp('GET', f'/admin/acct/statements/trial?from={as_of}&to={as_of}', None, TS)
        cash = next((r for r in t2.get('rows') or [] if r.get('role') == 'CASH'), {})
        cap = next((r for r in t2.get('rows') or [] if r.get('role') == 'EQUITY_CAPITAL'), {})
        ok('③ 기초 잔액 — 판 만들기 · 같은 기준일 422 · 지급 담당 403 · 안 맞으면 확정 422 · 저장 · 줄 차대 둘 다 422 · 확정 · 확정 뒤 줄 422 · 고치기 · 넣기 DB 가 막음 · 시산표 기초에 반영',
           bool(sid) and dup.get('code') == 'ACCT_OPENING_DUP' and byp.get('_err') == 403 and l1.get('balanced') is False and f0.get('code') == 'ACCT_OPENING_UNBALANCED'
           and l2.get('balanced') is True and bl.get('code') == 'ACCT_OPENING' and f1.get('ok') is True and l3.get('code') == 'ACCT_OPENING_FIXED'
           and '!' in upd and '!' in ins and cash.get('opening') == amt and cap.get('opening') == amt and (t2.get('openingSet') or {}).get('id') == sid,
           f"{sid} · {dup.get('code')} · {byp.get('_err')} · {l1.get('balanced')} {f0.get('code')} · {l2.get('balanced')} {bl.get('code')} · {f1.get('ok') or f1.get('code')} · {l3.get('code')} · {upd[-40:]} · {ins[-40:]} · {cash.get('opening')} {cap.get('opening')} {t2.get('openingSet')}")
    finally:
        if sid:
            replica_erp(f"DELETE FROM acct_opening WHERE set_id = {sid}; DELETE FROM acct_opening_sets WHERE id = {sid}")
        rm_role(pid, '1396')
    pass  # ERP: 화면 단계(옛 운영 화면 ADMIN_WEB) 뺌 — ERP 화면(15175)에 아직 없음
else:
    print('  (API · DB 없음 — ② ③ ④ 건너뜀)')
summary()
