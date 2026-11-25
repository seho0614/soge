"""v10.451 (D260 · docs/588) 승인된 수동 전표 반대 전표(역분개)
  ① (코드) acct_entry_reversals · 가드 · reverseManual · POST manual/{id}/reverse(SUPER · 감사) · 수동 전표 화면 단추 · 문서 588
  ② (API · DB) 요청 상태 409 · 지급 담당 403 · 짧은 사유 400/422 · 원래 날짜 앞 422 · 반대 전표(차대 바뀜) · 두 번 409 · 목록에 표시 · 기록 고치기 DB 막음
  ③ (화면) 회계 › 장부 › 수동 전표 — 반대 전표 표시
  시험 전표는 끝에 지움(replica).
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1451.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1451.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




M60 = migr('D260_')
BK, BC = rd('src/modules/acct/books.ts'), rd('src/modules/acct/acct-books.controller.ts')
UI, AP, MN, AM, AT, MA = rd('web/src/app/admin/AcctBooks.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/app.module.ts'), rd('web/src/app/admin/Acct.tsx'), rd('src/modules/acct/manual.ts')
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today = kst.strftime('%Y-%m-%d'); ym = today[:7]; m1 = ym + '-01'
stamp = int(time.time()) % 1000000
ok('① 코드 — 반대 전표 표 · 가드 · 함수 · API(SUPER · 감사 ACCT_MANUAL_REVERSE) · 마감 확인 assertOpen 내보냄 · 목록 칸 · 화면 단추 · 화면 목록 · 권한 주소 · 문서 588 · 판 v10.451' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   'export async function reverseManual' in BK
       and "@Post('manual/:id/reverse')" in BC
       and "@Audit('ACCT_MANUAL_REVERSE', 'SETTING')" in BC
       and 'export async function assertOpen' in MA
       and '"reverseEntryId"' in MA, VER)

if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW)
    TS = login('admin@x.com')
    pe, pid = mk_staff('1451', 'PAYOUT'); agree(pe, PW); TP = login(pe)
    memo = f'시험 1451 반대 {stamp}'
    mid = None
    try:
        r = erp('POST', '/admin/acct/manual', {'entryDate': today, 'memo': memo, 'evidence': 'NONE',
                 'lines': [{'role': 'EXP_SUPPLIES', 'debit': 1451}, {'role': 'CASH_HAND', 'credit': 1451}]}, TP)
        mid = r.get('id')
        early = erp('POST', f'/admin/acct/manual/{mid}/reverse', {'reason': '시험 1451 요청 상태'}, TS)
        ap = erp('POST', f'/admin/acct/manual/{mid}/decide', {'approve': True}, TS)
        byp = erp('POST', f'/admin/acct/manual/{mid}/reverse', {'reason': '시험 1451 지급 담당'}, TP)
        short = erp('POST', f'/admin/acct/manual/{mid}/reverse', {'reason': 'x'}, TS)
        before = erp('POST', f'/admin/acct/manual/{mid}/reverse', {'reason': '시험 1451 앞 날짜', 'reverseOn': '2026-01-01'}, TS)
        rv = erp('POST', f'/admin/acct/manual/{mid}/reverse', {'reason': '시험 1451 되돌림', 'reverseOn': today}, TS)
        again = erp('POST', f'/admin/acct/manual/{mid}/reverse', {'reason': '시험 1451 두 번째'}, TS)
        sw = psql_erp(f"SELECT string_agg(role || ':' || debit || ':' || credit, ',' ORDER BY role) FROM acct_lines WHERE entry_id = {int(rv.get('reverseEntryId') or 0)}")
        src = psql_erp(f"SELECT source || '|' || source_key FROM acct_entries WHERE id = {int(rv.get('reverseEntryId') or 0)}")
        lst = erp('GET', '/admin/acct/manual?state=APPROVED', None, TP)
        mine = next((x for x in lst.get('items') or [] if x.get('id') == mid), {})
        up = psql_erp(f"UPDATE acct_entry_reversals SET reason = '바꿈 시험 1451' WHERE manual_id = {int(mid or 0)}")
        ok('② 반대 전표 — 요청 상태 409 · 지급 담당 403 · 짧은 사유 400/422 · 원래 날짜 앞 422 · 반대 전표(차대 바뀜 · MANUAL_REVERSE) · 두 번 409 · 목록에 반대 전표 · 기록 고치기 DB 막음',
           r.get('ok') is True and early.get('code') == 'ACCT_REVERSE_STATE' and ap.get('state') == 'APPROVED' and byp.get('_err') == 403 and short.get('_err') in (400, 422)
           and before.get('code') == 'ACCT_REVERSE_DATE' and rv.get('ok') is True and sw == 'CASH_HAND:1451:0,EXP_SUPPLIES:0:1451' and src == f'MANUAL_REVERSE|{mid}'
           and again.get('code') == 'ACCT_REVERSE_DONE' and mine.get('reverseEntryId') == rv.get('reverseEntryId') and 'ACCT_REVERSE' in up,
           f"{r.get('ok')} · {early.get('code')} · {ap.get('state')} · {byp.get('_err')} · {short.get('_err')} · {before.get('code')} · {rv.get('ok')} {sw} {src} · {again.get('code')} · {mine.get('reverseEntryId')} · {up[-30:]}")
    finally:
        if mid:
            psql_erp(f"SET session_replication_role = replica; "
                 f"CREATE TEMP TABLE t1451 AS SELECT entry_id AS id FROM acct_entry_reversals WHERE manual_id = {int(mid)} UNION SELECT reverse_entry_id FROM acct_entry_reversals WHERE manual_id = {int(mid)} "
                 f"UNION SELECT entry_id FROM acct_manual_entries WHERE id = {int(mid)} AND entry_id IS NOT NULL; "
                 f"DELETE FROM acct_entry_reversals WHERE manual_id = {int(mid)}; "
                 f"DELETE FROM acct_approval_steps WHERE doc_kind = 'MANUAL' AND doc_id = {int(mid)}; "
                 f"DELETE FROM acct_manual_entries WHERE id = {int(mid)}; "
                 f"DELETE FROM acct_lines WHERE entry_id IN (SELECT id FROM t1451); DELETE FROM acct_entries WHERE id IN (SELECT id FROM t1451)")
        rm_role(pid, '1451')
    pass  # ERP: 화면 단계(옛 운영 화면 ADMIN_WEB) 뺌 — ERP 화면(15175)에 아직 없음
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

summary()
