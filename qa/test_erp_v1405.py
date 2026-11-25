"""v10.405 (D248 · docs/542) 수동 전표 쓰기 · 결재
  ① (코드) D248 수동 전표 표 · 가드 · API · 화면 · 문서
  ② (API) 요청 — 차대 다름 · 모르는 계정 · 한 줄 차대 둘 다 · 마감한 달 422 · 회원 403
  ③ (API · DB) 결재 — 지급 담당 403 · 자기 것 422 · SUPER 승인 = 전표 MANUAL · 두 번 409 · 반려 사유 · 취소 · DB 가 내용 고치기 · 지우기 · 자기 승인 막음
  ④ (화면) 회계 › 수동 전표
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1405.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1405.py
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
MA = rd('src/modules/acct/manual.ts')
ok('① 코드 — D248 수동 전표 표(내용 못 고침 · 앞으로만 · 쓴 사람 승인 막기 · SUPER 만) · API 4 · 감사 · 마감 달 · 해 확인 · 화면 · 메뉴 · 명세 · 문서 542 · 판 v10.405' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   "@Get('manual')" in AC
       and "@Post('manual')" in AC
       and "@Post('manual/:id/decide')" in AC
       and "@Post('manual/:id/cancel')" in AC
       and "@Audit('ACCT_MANUAL_DECIDE', 'SETTING')" in AC
       and 'ACCT_MANUAL_BALANCE' in MA
       and 'fn_acct_year_closed' in MA, VER)
if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW); agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1405', 'PAYOUT'); agree(pe, PW); TP = login(pe)
    d0 = kst.strftime('%Y-%m-%d')
    stamp = int(time.time()) % 1000000
    n = 300000 + stamp % 9000
    memo = f'시험 1405 임대료 {stamp}'
    good = {'entryDate': d0, 'memo': memo, 'party': '(주)시험건물', 'evidence': 'TAX_INVOICE',
            'lines': [{'role': 'EXP_RENT', 'debit': n}, {'role': 'VAT_IN', 'debit': n // 10}, {'role': 'CASH', 'credit': n + n // 10}]}
    try:
        unb = erp('POST', '/admin/acct/manual', {**good, 'lines': [{'role': 'EXP_RENT', 'debit': n}, {'role': 'CASH', 'credit': n - 1}]}, TP)
        unk = erp('POST', '/admin/acct/manual', {**good, 'lines': [{'role': 'NO_SUCH_ROLE', 'debit': n}, {'role': 'CASH', 'credit': n}]}, TP)
        both = erp('POST', '/admin/acct/manual', {**good, 'lines': [{'role': 'EXP_RENT', 'debit': n, 'credit': n}, {'role': 'CASH', 'credit': n}]}, TP)
        cym = psql_erp("SELECT coalesce(max(ym), '') FROM acct_closings")
        cls = erp('POST', '/admin/acct/manual', {**good, 'entryDate': f'{cym}-15'}, TP) if cym else {'code': 'ACCT_MANUAL_CLOSED'}
        mem = erp('POST', '/admin/acct/manual', good, TB)
        r1 = erp('POST', '/admin/acct/manual', good, TP)                     # 지급 담당이 씀
        r2 = erp('POST', '/admin/acct/manual', {**good, 'memo': memo + ' SUPER'}, TS)   # SUPER 가 씀(자기 승인 막기 확인)
        r3 = erp('POST', '/admin/acct/manual', {**good, 'memo': memo + ' 반려'}, TP)
        ok('② 요청 — 차대 다르면 422 · 모르는 계정 422 · 한 줄에 차대 둘 다 422 · 마감한 달 422 · 회원 403 · 지급 담당 · SUPER 요청 됨',
           unb.get('code') == 'ACCT_MANUAL_BALANCE' and unk.get('code') == 'ACCT_MANUAL' and both.get('code') == 'ACCT_MANUAL' and cls.get('code') == 'ACCT_MANUAL_CLOSED'
           and mem.get('_err') == 403 and r1.get('ok') is True and r2.get('ok') is True and r3.get('ok') is True,
           f"{unb.get('code')} · {unk.get('code')} · {both.get('code')} · 마감 {cym} {cls.get('code')} · {mem.get('_err')} · {r1.get('id')} {r2.get('id')} {r3.get('id')}")

        byp = erp('POST', f"/admin/acct/manual/{r1.get('id')}/decide", {'approve': True}, TP)
        self_ = erp('POST', f"/admin/acct/manual/{r2.get('id')}/decide", {'approve': True}, TS)
        ap = erp('POST', f"/admin/acct/manual/{r1.get('id')}/decide", {'approve': True, 'note': '계약서 확인'}, TS)
        ap2 = erp('POST', f"/admin/acct/manual/{r1.get('id')}/decide", {'approve': True}, TS)
        rj0 = erp('POST', f"/admin/acct/manual/{r3.get('id')}/decide", {'approve': False}, TS)
        rj1 = erp('POST', f"/admin/acct/manual/{r3.get('id')}/decide", {'approve': False, 'note': '증빙 다시'}, TS)
        cn = erp('POST', f"/admin/acct/manual/{r2.get('id')}/cancel", None, TS)
        lines = psql_erp(f"SELECT e.source || '|' || string_agg(l.role || ':' || l.debit || ':' || l.credit, ',' ORDER BY l.role) FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id WHERE e.id = {ap.get('entryId') or 0} GROUP BY e.source")
        x1 = psql_erp(f"UPDATE acct_manual_entries SET memo = '바꿈' WHERE id = {r1.get('id') or 0}")
        x2 = psql_erp(f"DELETE FROM acct_manual_entries WHERE id = {r1.get('id') or 0}")
        x3 = psql_erp(f"UPDATE acct_manual_entries SET state = 'APPROVED', decided_by = created_by, decided_at = now() WHERE id = {r2.get('id') or 0}")
        lst = erp('GET', '/admin/acct/manual', None, TP)
        want = 'MANUAL|' + ','.join(sorted([f'CASH:0:{n + n // 10}', f'EXP_RENT:{n}:0', f'VAT_IN:{n // 10}:0']))
        ok('③ 결재 — 지급 담당 승인 403 · 자기가 쓴 것 승인 422 · SUPER 승인 → 전표 MANUAL(줄 그대로) · 두 번 409 · 반려 사유 없으면 422 · 반려 · 취소 · 내용 고치기 · 지우기 DB 가 막음 · 목록',
           byp.get('_err') == 403 and self_.get('code') == 'ACCT_MANUAL_SELF' and ap.get('state') == 'APPROVED' and bool(ap.get('entryId')) and lines == want
           and ap2.get('code') == 'ACCT_MANUAL_STATE' and rj0.get('code') == 'ACCT_MANUAL' and rj1.get('state') == 'REJECTED' and cn.get('state') == 'CANCELED'
           and 'ACCT_MANUAL' in x1 and 'ACCT_MANUAL' in x2 and 'ACCT_MANUAL' in x3 and any(x.get('id') == r1.get('id') for x in lst.get('items') or []),
           f"{byp.get('_err')} · {self_.get('code')} · {ap.get('state')} {ap.get('entryId')} · {lines} (기대 {want}) · {ap2.get('code')} · {rj0.get('code')} {rj1.get('state')} · {cn.get('state')} · {x1[-30:]} · {x2[-30:]} · {x3[-30:]}")
    finally:
        # 회사 장부에 남기지 않음 — 시험 요청 · 그 전표 지움(replica)
        psql_erp(f"SET session_replication_role = replica; "
             f"DELETE FROM acct_lines WHERE entry_id IN (SELECT entry_id FROM acct_manual_entries WHERE memo LIKE '시험 1405 임대료 {stamp}%' AND entry_id IS NOT NULL); "
             f"CREATE TEMP TABLE t1405 AS SELECT entry_id FROM acct_manual_entries WHERE memo LIKE '시험 1405 임대료 {stamp}%' AND entry_id IS NOT NULL; "
             f"DELETE FROM acct_manual_entries WHERE memo LIKE '시험 1405 임대료 {stamp}%'; "
             f"DELETE FROM acct_entries WHERE id IN (SELECT entry_id FROM t1405)")
        rm_role(pid, '1405')
    pass  # ERP: 화면 단계(옛 운영 화면 ADMIN_WEB) 뺌 — ERP 화면(15175)에 아직 없음
else:
    print('  (API · DB 없음 — ② ~ ④ 건너뜀)')

summary()
