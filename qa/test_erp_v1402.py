"""v10.402 (D247 · docs/539) 해 마감 · 다음 해 이월
  ① (코드) 마감 표 · 전표 막기 · YEAR_CLOSE → RETAINED · 풀기 · 기초 잔액 초안 · API · 화면 · 문서
  ② (API) 올해 422 · 지급 담당 403 · 월 마감 남음 422 · 마감(손익 0 · RETAINED = 순이익) · 두 번 422 · 그 해 전표 막힘 · 기초 잔액 초안
  ③ (API) 풀기 — 사유 422 · 반대 전표 · 두 번 422
  ④ (화면) 회계 › 해 마감
  시험용 해 2025(시작일을 잠시 2025-12-01 로) · 끝에 시험이 만든 기록 · 전표 · 마감을 replica 로 지움
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1402.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1402.py
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


YC = rd('src/modules/acct/yearclose.ts')
ok('① 코드 — 해 마감 표(쌓기만) · 전표 막기(ACCT_YEAR_CLOSED · 마감 전표만 통과) · YEAR_CLOSE → RETAINED · 풀기 YEAR_REOPEN · 다음 해 기초 잔액(⑬ trialBalance) · API 3 · 화면 · 문서 539 · 판 v10.402' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   "'RETAINED'" in YC
       and "'YEAR_REOPEN'" in YC
       and 'trialBalance' in YC
       and 'acct_opening_sets' in YC
       and "@Get('year-closings')" in AC
       and "@Post('year-closings/:year/reopen')" in AC, VER)
if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW); agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1402', 'PAYOUT'); agree(pe, PW); TP = login(pe)
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    Y = 2025   # 시험용 지난 해 — 시작일을 2025-12-01 로 잠시 당겨 12월만 마감 대상으로
    stamp = int(time.time()) % 1000000
    st0 = getset('acct.start_on')
    had_dec = psql_erp(f"SELECT count(*) FROM acct_closings WHERE ym = '{Y}-12'")
    os0 = psql_erp("SELECT coalesce(max(id), 0) FROM acct_opening_sets") if psql_erp("SELECT to_regclass('public.acct_opening_sets') IS NOT NULL") == 't' else '0'
    try:
        fut = erp('POST', '/admin/acct/year-closings', {'year': kst.year}, TS)
        byp = erp('POST', '/admin/acct/year-closings', {'year': Y}, TP)
        setting('acct.start_on', f'{Y}-12-01', '1402')
        # 이미 마감 상태면(앞 돌림이 못 풀었으면) 먼저 풂
        if psql_erp(f"SELECT fn_acct_year_closed({Y})") == 't':
            erp('POST', f'/admin/acct/year-closings/{Y}/reopen', {'reason': '시험 1402 앞 돌림 정리'}, TS)
        # 12월 수익 · 비용 한 장(공급가 100,000 매출 · 비용 30,000) — 마감 전에 넣음
        ins = psql_erp(f"WITH e AS (INSERT INTO acct_entries (entry_date, source, source_key, memo) VALUES ('{Y}-12-15', 'TEST', 't1402a-{stamp}', '시험 1402') RETURNING id) "
                   f"INSERT INTO acct_lines (entry_id, role, debit, credit) SELECT e.id, x.r, x.d, x.c FROM e, (VALUES ('CASH', 70000, 0), ('EXP_ETC', 30000, 0), ('REV_AD', 0, 100000)) AS x(r, d, c)") if had_dec == '0' else ''
        open_m = erp('POST', '/admin/acct/year-closings', {'year': Y}, TS) if had_dec == '0' else {'code': 'ACCT_YEAR_OPEN_MONTHS'}
        if had_dec == '0':
            psql_erp(f"INSERT INTO acct_closings (ym, entries, debit_sum, note) VALUES ('{Y}-12', 0, 0, '시험 1402')")
        pl = psql_erp(f"SELECT coalesce(sum(l.credit - l.debit) FILTER (WHERE a.kind = 'REVENUE'), 0) - coalesce(sum(l.debit - l.credit) FILTER (WHERE a.kind = 'EXPENSE'), 0) FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id JOIN acct_accounts a ON a.role = l.role WHERE e.entry_date >= '{Y}-01-01' AND e.entry_date < '{Y + 1}-01-01' AND e.source NOT IN ('YEAR_CLOSE', 'YEAR_REOPEN')")
        c = erp('POST', '/admin/acct/year-closings', {'year': Y, 'note': '시험 1402'}, TS)
        c2 = erp('POST', '/admin/acct/year-closings', {'year': Y}, TS)
        after = psql_erp(f"SELECT coalesce(sum(l.debit - l.credit), 0) FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id JOIN acct_accounts a ON a.role = l.role WHERE a.kind IN ('REVENUE', 'EXPENSE') AND e.entry_date >= '{Y}-01-01' AND e.entry_date < '{Y + 1}-01-01'")
        ret = psql_erp(f"SELECT coalesce(sum(credit - debit), 0) FROM acct_lines WHERE entry_id = {int(c.get('entryId') or 0)} AND role = 'RETAINED'")
        blk = psql_erp(f"INSERT INTO acct_entries (entry_date, source, source_key) VALUES ('{Y}-06-01', 'TEST', 't1402b-{stamp}')")
        g = erp('GET', '/admin/acct/year-closings', None, TP)
        gy = next((x for x in g.get('years') or [] if x.get('year') == Y), {})
        ok('② 마감 — 올해 422(해가 안 끝남) · 지급 담당 403 · 월 마감 안 한 달 있으면 422 · 마감 → 그 해 수익 · 비용 합 0 · RETAINED = 순이익 · 두 번 422 · 그 해 전표 넣기 막힘(ACCT_YEAR_CLOSED) · 상태 「마감함」 · 다음 해 기초 잔액 초안',
           fut.get('code') == 'ACCT_YEAR_FUTURE' and byp.get('_err') == 403 and open_m.get('code') == 'ACCT_YEAR_OPEN_MONTHS' and '!' not in ins
           and c.get('ok') is True and int(after or -1) == 0 and int(ret or 0) == int(pl or 0) and int(c.get('netIncome', -1)) == int(pl or 0)
           and c2.get('code') == 'ACCT_YEAR_CLOSED' and 'ACCT_YEAR_CLOSED' in blk and gy.get('closed') is True and bool((c.get('opening') or {}).get('setId')),
           f"{fut.get('code')} {byp.get('_err')} {open_m.get('code')} · {c.get('ok') or c.get('code')} 손익 {pl} 뒤 {after} 잉여 {ret} · {c2.get('code')} · {blk[-50:]} · {gy.get('closed')} · {c.get('opening')}")
        bad = erp('POST', f'/admin/acct/year-closings/{Y}/reopen', {'reason': 'x'}, TS)
        ro = erp('POST', f'/admin/acct/year-closings/{Y}/reopen', {'reason': '시험 1402 풀기'}, TS)
        ro2 = erp('POST', f'/admin/acct/year-closings/{Y}/reopen', {'reason': '시험 1402 두 번'}, TS)
        back = psql_erp(f"SELECT coalesce(sum(l.credit - l.debit) FILTER (WHERE a.kind = 'REVENUE'), 0) - coalesce(sum(l.debit - l.credit) FILTER (WHERE a.kind = 'EXPENSE'), 0) FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id JOIN acct_accounts a ON a.role = l.role WHERE e.entry_date >= '{Y}-01-01' AND e.entry_date < '{Y + 1}-01-01'")
        ok('③ 풀기 — 사유 짧으면 422 · 풀기 → 반대 전표로 손익 되돌아옴 · 두 번 422(마감 안 한 해) · 다시 상태 열림',
           bad.get('code') == 'ACCT_REASON' and ro.get('ok') is True and int(back or 0) == int(pl or 0) and ro2.get('code') == 'ACCT_YEAR_NOT_CLOSED' and psql_erp(f"SELECT fn_acct_year_closed({Y})") == 'f',
           f"{bad.get('code')} · {ro.get('ok') or ro.get('code')} · 손익 {back} = {pl} · {ro2.get('code')}")
    finally:
        setting('acct.start_on', st0 or '2026-11-01', '1402 되돌림')
        # 시험이 만든 것 지움(쌓기만 표 · replica) — 마감 기록 · 마감 · 풀기 전표 · 시험 전표 · 기초 잔액 초안 · 12월 마감(시험이 넣었으면)
        psql_erp(f"BEGIN; SET LOCAL session_replication_role = replica; "
             f"DELETE FROM acct_lines WHERE entry_id IN (SELECT id FROM acct_entries WHERE (source IN ('YEAR_CLOSE', 'YEAR_REOPEN') AND source_key LIKE '{Y}#%') OR (source = 'TEST' AND source_key LIKE 't1402_-{stamp}')); "
             f"DELETE FROM acct_year_closings WHERE year = {Y}; "
             f"DELETE FROM acct_entries WHERE (source IN ('YEAR_CLOSE', 'YEAR_REOPEN') AND source_key LIKE '{Y}#%') OR (source = 'TEST' AND source_key LIKE 't1402_-{stamp}'); "
             f"DELETE FROM acct_opening WHERE set_id IN (SELECT id FROM acct_opening_sets WHERE as_of = '{Y + 1}-01-01' AND state = 'DRAFT') AND set_id > {int(os0 or 0)}; "
             f"DELETE FROM acct_opening_sets WHERE as_of = '{Y + 1}-01-01' AND state = 'DRAFT' AND id > {int(os0 or 0)}; "
             + (f"DELETE FROM acct_closings WHERE ym = '{Y}-12' AND note = '시험 1402'; " if had_dec == '0' else '') + "COMMIT;")
        rm_role(pid, '1402')
    pass  # ERP: 화면 단계(옛 운영 화면 ADMIN_WEB) 뺌 — ERP 화면(15175)에 아직 없음
else:
    print('  (API · DB 없음 — ② ③ ④ 건너뜀)')

summary()
