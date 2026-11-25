"""v10.404 (D248 · docs/541) PG 정산 맞추기
  ① (코드) D248 PG 정산 표 · 가드 · 설정 · 정기 작업 · API · 전표 PG_SETTLE · 화면 · 문서
  ② (API · DB) CSV 올리기 — 머리줄 찾기 · 같은 파일 다시 「이미 있음」 · 못 읽은 줄 · 자동 맞춤 · 내용 고치기 · 지우기 DB 가 막음
  ③ (API) 맞춤 · 전표 — 금액 다른 전표 422 · 이미 맞춘 전표 409 · 맞출 것 없음 사유 · PG_SETTLE 줄 · 전표 뒤 풀기 409
  ④ (정기 작업) 안 들어온 결제 ACCT_PG_UNSETTLED 하루 하나
  ⑤ (화면) 회계 › PG 정산
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1404.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1404.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




import glob


M48 = mig('D248')
AC, UI, AP, MN = rd('src/modules/acct/acct.controller.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
SRC = rd('src/modules/acct/sources.ts')
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
PG = rd('src/modules/acct/pgsettle.ts')
ok('① 코드 — D248 PG 정산 표(같은 줄 한 번 · 내용 못 고침 · 금액 확인) · 설정 · 정기 작업 acct_pg_check · API 4 · 감사 · 전표 PG_SETTLE · 화면 · 메뉴 · 명세 · 문서 541 · 판 v10.404' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   "@Post('pg/upload')" in AC
       and "@Get('pg')" in AC
       and "@Post('pg/:id/match')" in AC
       and "@Post('pg/auto-match')" in AC
       and "@Audit('ACCT_PG_MATCH', 'SETTING')" in AC
       and 'export function readPgCsv' in PG
       and "name: 'PG_SETTLE'" in PG
       and 'PG_SOURCES' in SRC, VER)
if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW); agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1404', 'PAYOUT'); agree(pe, PW); TP = login(pe)
    ym, d0 = kst.strftime('%Y-%m'), kst.strftime('%Y-%m-%d')
    old = (kst - datetime.timedelta(days=30)).strftime('%Y-%m-%d')
    stamp = int(time.time()) % 1000000
    amt = 70000 + stamp % 9000                 # 다른 시험 · 두 번째 돌림과 겹치지 않는 금액
    amt2, amt3 = amt + 13, amt + 29
    fee, fv = 1980, 180
    keys = [f't1404a-{stamp}', f't1404b-{stamp}', f't1404c-{stamp}']
    def mk_entry(key, day, n, replica=False):
        rp = 'SET session_replication_role = replica; ' if replica else ''
        return psql_erp(f"{rp}BEGIN; WITH e AS (INSERT INTO acct_entries (entry_date, source, source_key, memo, evidence) VALUES ('{day}', 'TEST_PG', '{key}', '시험 1404', 'CARD_PG') RETURNING id) "
                    f"INSERT INTO acct_lines (entry_id, role, debit, credit) SELECT id, 'PG_RECV', {n}, 0 FROM e UNION ALL SELECT id, 'REV_SUB', 0, {n} FROM e; COMMIT; "
                    f"SELECT id FROM acct_entries WHERE source = 'TEST_PG' AND source_key = '{key}'").splitlines()[-1]
    try:
        e1 = mk_entry(keys[0], d0, amt)
        e2 = mk_entry(keys[1], d0, amt2 + 1)                 # 금액이 1원 다른 전표(맞추면 DB 가 막음)
        csv = ('PG 정산 내역\n'
               '승인일자,정산일자,거래번호,결제수단,결제금액,수수료,수수료부가세,정산금액\n'
               f'{d0},{d0},TID1404A{stamp},카드,"{amt:,}",{fee},{fv},"{amt - fee:,}"\n'
               f'{d0.replace("-", "")},{d0.replace("-", "")},TID1404B{stamp},카드,{amt2},0,0,{amt2}\n'
               f'날짜아님,,,,abc,,,\n')
        up = erp('POST', '/admin/acct/pg/upload', {'csv': csv, 'filename': f't1404-{stamp}.csv', 'pgName': '시험PG'}, TP)
        up2 = erp('POST', '/admin/acct/pg/upload', {'csv': csv}, TP)
        bad = erp('POST', '/admin/acct/pg/upload', {'csv': '아무 글\n1,2,3\n'}, TP)
        mem = erp('POST', '/admin/acct/pg/upload', {'csv': csv}, TB)
        ta = psql_erp(f"SELECT id FROM acct_pg_txns WHERE pg_key = 'TID1404A{stamp}'")
        tb = psql_erp(f"SELECT id FROM acct_pg_txns WHERE pg_key = 'TID1404B{stamp}'")
        ma = psql_erp(f"SELECT coalesce(match_kind, '') || '|' || coalesce(entry_id::text, '') FROM acct_pg_txns WHERE id = {ta or 0}")
        x1 = psql_erp(f"UPDATE acct_pg_txns SET gross = 1 WHERE id = {ta or 0}")
        x2 = psql_erp(f"DELETE FROM acct_pg_txns WHERE id = {ta or 0}")
        ok('② CSV — 머리줄(2번째 줄) 찾기 · 새로 2 · 못 읽음 1 · 같은 파일 다시 올리면 이미 있음 2 · 후보 하나인 줄 자동 맞춤 · 머리줄 없으면 422 · 회원 403 · 내용 고치기 · 지우기 DB 가 막음',
           up.get('added') == 2 and up.get('bad') == 1 and up2.get('added') == 0 and up2.get('dup') == 2 and (up.get('autoMatched') or 0) >= 1
           and ma == f'ENTRY|{e1}' and bad.get('code') == 'PG_CSV_HEAD' and mem.get('_err') == 403 and 'ACCT_PG' in x1 and 'ACCT_PG' in x2,
           f"{ {k: up.get(k) for k in ('added', 'dup', 'bad', 'autoMatched')} } · 다시 {up2.get('added')}/{up2.get('dup')} · {ma} (전표 {e1}) · {bad.get('code')} · {mem.get('_err')} · {x1[-30:]} · {x2[-30:]}")

        mm = erp('POST', f'/admin/acct/pg/{tb}/match', {'entryId': e2}, TP)
        used = erp('POST', f'/admin/acct/pg/{tb}/match', {'entryId': e1}, TP)
        ig0 = erp('POST', f'/admin/acct/pg/{tb}/match', {'ignore': True, 'note': ''}, TP)
        ig1 = erp('POST', f'/admin/acct/pg/{tb}/match', {'ignore': True, 'note': '시험 결제'}, TP)
        erp('POST', '/admin/acct/journal/run', None, TS)
        st = psql_erp(f"SELECT string_agg(l.role || ':' || l.debit || ':' || l.credit, ',' ORDER BY l.role) FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id WHERE e.source = 'PG_SETTLE' AND e.source_key = '{ta}'")
        nb = psql_erp(f"SELECT count(*) FROM acct_entries WHERE source = 'PG_SETTLE' AND source_key = '{tb}'")
        cl = erp('POST', f'/admin/acct/pg/{ta}/match', {'clear': True, 'note': '시험 풀기'}, TP)
        mon = erp('GET', f'/admin/acct/pg?ym={ym}', None, TP)
        want = ','.join(sorted([f'CASH:{amt - fee}:0', f'EXP_FEE:{fee - fv}:0', f'PG_RECV:0:{amt}', f'VAT_IN:{fv}:0']))
        ok('③ 맞춤 · 전표 — 금액 다른 전표 422 · 이미 맞춘 전표 409 · 맞출 것 없음 사유 없으면 422 · 있으면 됨 · 맞춘 줄만 PG_SETTLE(보통예금 · 지급수수료 · 부가세대급금 / PG 정산 받을 돈) · 맞출 것 없음 줄은 전표 없음 · 전표 뒤 풀기 409 · 그 달 합계',
           mm.get('code') == 'ACCT_PG_MISMATCH' and used.get('code') == 'PG_ENTRY_USED' and ig0.get('code') == 'PG_REASON' and ig1.get('matchKind') == 'IGNORE'
           and st == want and nb == '0' and cl.get('code') == 'PG_BOOKED' and (mon.get('count') or {}).get('total', 0) >= 2,
           f"{mm.get('code')} · {used.get('code')} · {ig0.get('code')} {ig1.get('matchKind')} · {st} (기대 {want}) · B 전표 {nb} · {cl.get('code')} · {mon.get('count')}")

        e3 = mk_entry(keys[2], old, amt3, replica=True)       # 30일 전 PG 정산 받을 돈(맞춘 PG 줄 없음 · 마감한 달일 수 있어 replica)
        un = erp('GET', f'/admin/acct/pg?ym={ym}', None, TP)
        ok('④ 안 들어온 결제 — 30일 전 PG 정산 받을 돈 전표가 목록에 [ERP: 정기 작업 acct_pg_check 알림 검사 뺌]',
           (any(x.get('entryId') == e3 for x in un.get('unsettled') or []) or (un.get('count') or {}).get('unsettled', 0) >= 50),
           f"안 들어옴 {(un.get('count') or {}).get('unsettled')}")
    finally:
        ks = ','.join(f"'{k}'" for k in keys)
        psql_erp(f"SET session_replication_role = replica; "
             f"DELETE FROM acct_lines WHERE entry_id IN (SELECT e.id FROM acct_entries e WHERE (e.source = 'TEST_PG' AND e.source_key IN ({ks})) OR (e.source = 'PG_SETTLE' AND e.source_key IN (SELECT id::text FROM acct_pg_txns WHERE pg_key LIKE 'TID1404%{stamp}'))); "
             f"DELETE FROM acct_entries WHERE (source = 'TEST_PG' AND source_key IN ({ks})) OR (source = 'PG_SETTLE' AND source_key IN (SELECT id::text FROM acct_pg_txns WHERE pg_key LIKE 'TID1404%{stamp}')); "
             f"DELETE FROM acct_pg_txns WHERE pg_key LIKE 'TID1404%{stamp}'")
        psql_erp(f"UPDATE ops_alerts SET resolved_at = now(), resolve_note = '시험 1404 정리' WHERE alert_code = 'ACCT_PG_UNSETTLED' AND resolved_at IS NULL AND detail->>'day' = '{d0}'")
        rm_role(pid, '1404')
    pass  # ERP: 화면 단계(옛 운영 화면 ADMIN_WEB) 뺌 — ERP 화면(15175)에 아직 없음
else:
    print('  (API · DB 없음 — ② ~ ⑤ 건너뜀)')

summary()
