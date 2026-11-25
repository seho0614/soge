"""v10.388 (D244 · docs/525) 은행 거래 내역 맞추기
  ① (코드) D244 통장 표 · 가드 · API · 화면 · 문서
  ② (API · DB) CSV 올리기 — 머리줄 찾기 · 같은 파일 다시 올리면 「이미 있음」 · 못 읽은 줄 · 내용 고치기 · 지우기 DB 가 막음
  ③ (API) 맞춤 — 후보(금액 · 날짜 · 이름) · 다른 금액 전표 422 · 맞춤 · 같은 전표 409 · 맞출 것 없음 사유 · 풀기 · 자동 맞춤
  ④ (화면) 회계 › 은행 맞추기
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1388.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1388.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




M44 = rd('prisma/migrations/D244_acct_bank_format_deadline_etax/migration.sql')
AC, RP, UI, AP, MN = rd('src/modules/acct/acct.controller.ts'), rd('src/modules/acct/acct-reports.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
BK = rd('src/modules/acct/bank.ts')
ok('① 코드 — D244 통장 표 · 같은 줄 한 번 · 맞춤 가드 · 설정 · API 4 · 감사 · 화면 · 메뉴 · 명세 · 문서 525 · 판 v10.388' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   "@Post('bank/upload')" in AC
       and "@Get('bank')" in AC
       and "@Post('bank/:id/match')" in AC
       and "@Post('bank/auto-match')" in AC
       and "@Audit('ACCT_BANK_MATCH', 'SETTING')" in AC
       and 'export function readBankCsv' in BK, VER)
if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW); agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1388', 'PAYOUT'); agree(pe, PW); TP = login(pe)
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    ym, d0 = kst.strftime('%Y-%m'), kst.strftime('%Y-%m-%d')
    stamp = int(time.time()) % 1000000
    amt = 40000 + stamp % 9000            # 다른 시험 · 두 번째 돌림과 겹치지 않는 금액
    name = f'시험광고1388{stamp}'
    try:
        adv = sgb('POST', '/admin/advertisers', {'code': f'ADV-1388-{stamp}', 'name': f'(주){name}'}, TS)
        inv = sgb('POST', '/admin/ad-invoices', {'advertiserId': adv.get('id'), 'periodFrom': d0, 'periodTo': d0, 'amount': amt, 'vat': 0, 'dueDate': d0, 'memo': '시험 1388'}, TS)
        pay = sgb('POST', f"/admin/ad-invoices/{inv.get('id')}/payments", {'amount': amt, 'method': 'TRANSFER', 'payerName': name}, TS)
        erp('POST', '/admin/acct/journal/run', None, TS)
        eid = psql_erp(f"SELECT e.id FROM acct_entries e JOIN svc.ad_payments p ON p.id::text = e.source_key WHERE e.source = 'AD_PAYMENT' AND p.invoice_id = '{inv.get('id')}'")
        other = psql_erp(f"SELECT e.id FROM acct_entries e WHERE e.source = 'AD_INVOICE' AND e.source_key = '{inv.get('id')}'")
        intr = 1 + stamp % 97
        csv = ('은행 거래내역 조회\n조회기간,2026-11-01 ~ 2026-11-30\n'
               '거래일시,적요,기재내용,찾으신금액,맡기신금액,거래후잔액,메모\n'
               f'"{d0} 10:11:12",타행이체,{name},0,"{amt:,}","{1000000 + amt:,}",시험1388-{stamp}\n'
               f'{d0.replace("-", ".")},이자,예금이자,0,{intr},{1000000 + amt + intr},시험1388-{stamp}\n'
               f'날짜아님,이상한줄,,0,abc,,\n')
        up = erp('POST', '/admin/acct/bank/upload', {'csv': csv, 'filename': f't1388-{stamp}.csv', 'bank': '시험은행'}, TP)
        up2 = erp('POST', '/admin/acct/bank/upload', {'csv': csv, 'filename': f't1388-{stamp}.csv'}, TP)
        bad = erp('POST', '/admin/acct/bank/upload', {'csv': '아무 글\n1,2,3\n'}, TP)
        mem = erp('POST', '/admin/acct/bank/upload', {'csv': csv}, TB)
        tid = psql_erp(f"SELECT id FROM acct_bank_txns WHERE memo = '시험1388-{stamp}' AND deposit = {amt}")
        iid = psql_erp(f"SELECT id FROM acct_bank_txns WHERE memo = '시험1388-{stamp}' AND deposit = {intr}")
        e1 = psql_erp(f"UPDATE acct_bank_txns SET deposit = 1 WHERE id = {tid or 0}")
        e2 = psql_erp(f"DELETE FROM acct_bank_txns WHERE id = {tid or 0}")
        ok('② CSV — 머리줄(3번째 줄) 찾기 · 새로 2 · 못 읽음 1 · 같은 파일 다시 올리면 새로 0 · 이미 있음 2 · 머리줄 없으면 422 · 회원 403 · 내용 고치기 · 지우기 DB 가 막음',
           up.get('added') == 2 and up.get('bad') == 1 and up2.get('added') == 0 and up2.get('dup') == 2 and bad.get('code') == 'BANK_CSV_HEAD' and mem.get('_err') == 403
           and bool(tid) and bool(iid) and 'ACCT_BANK' in e1 and 'ACCT_BANK' in e2 and bool(eid),
           f"{ {k: up.get(k) for k in ('added', 'dup', 'bad')} } · 다시 {up2.get('added')}/{up2.get('dup')} · {bad.get('code')} · {mem.get('_err')} · {tid} {iid} · {e1[-40:]} · {e2[-40:]} · 전표 {eid} {pay.get('_err') or ''}")

        bm = erp('GET', f'/admin/acct/bank?ym={ym}', None, TP)
        row = next((x for x in bm.get('items') or [] if x.get('id') == tid), {})
        cand = row.get('candidates') or []
        wrong = erp('POST', f'/admin/acct/bank/{tid}/match', {'entryId': other}, TP)
        m1 = erp('POST', f'/admin/acct/bank/{tid}/match', {'entryId': eid}, TP)
        m2 = erp('POST', f'/admin/acct/bank/{iid}/match', {'entryId': eid}, TP)
        ig0 = erp('POST', f'/admin/acct/bank/{iid}/match', {'ignore': True, 'note': ''}, TP)
        ig1 = erp('POST', f'/admin/acct/bank/{iid}/match', {'ignore': True, 'note': '예금 이자'}, TP)
        cl0 = erp('POST', f'/admin/acct/bank/{tid}/match', {'clear': True}, TP)
        cl1 = erp('POST', f'/admin/acct/bank/{tid}/match', {'clear': True, 'note': '시험 다시 맞춤'}, TP)
        au = erp('POST', '/admin/acct/bank/auto-match', {'ym': ym}, TP)
        st = psql_erp(f"SELECT coalesce(match_kind, '') || '|' || coalesce(entry_id::text, '') FROM acct_bank_txns WHERE id = {tid}")
        st2 = psql_erp(f"SELECT coalesce(match_kind, '') || '|' || coalesce(match_note, '') FROM acct_bank_txns WHERE id = {iid}")
        ok('③ 맞춤 — 후보에 그 전표(이름 ✓) · 다른 금액 전표 422 · 맞춤 · 같은 전표 두 번 409 · 맞출 것 없음 사유 없으면 422 · 사유 있으면 됨 · 풀기 사유 없으면 422 · 풀기 · 자동 맞춤이 다시 맞춤',
           any(c.get('entryId') == eid and c.get('nameOk') for c in cand) and wrong.get('code') == 'ACCT_BANK_MISMATCH' and m1.get('matchKind') == 'ENTRY'
           and m2.get('code') == 'BANK_ENTRY_USED' and ig0.get('code') == 'BANK_REASON' and ig1.get('matchKind') == 'IGNORE' and cl0.get('code') == 'BANK_REASON'
           and cl1.get('ok') is True and (au.get('matched') or 0) >= 1 and st == f'ENTRY|{eid}' and st2 == 'IGNORE|예금 이자' and (bm.get('lastBalance') or {}).get('balance') is not None,
           f"후보 {[(c.get('entryId'), c.get('nameOk')) for c in cand]} · {wrong.get('code')} · {m1.get('matchKind')} · {m2.get('code')} · {ig0.get('code')} {ig1.get('matchKind')} · {cl0.get('code')} {cl1.get('ok')} · 자동 {au.get('matched')} · {st} · {st2}")
    finally:
        rm_role(pid, '1388')
    pass  # ERP: 화면 단계(옛 운영 화면 ADMIN_WEB) 뺌 — ERP 화면(15175)에 아직 없음
else:
    print('  (API · DB 없음 — ② ③ ④ 건너뜀)')

summary()
