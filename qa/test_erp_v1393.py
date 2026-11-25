"""v10.393 (D245 · docs/530) 경비 청구 · 법인카드
  ① (코드) D245 경비 · 카드 표 · 가드 · API 8 · 전표 규칙 3 · 화면 · 메뉴 · 명세 · 문서 530
  ② (API · DB) 경비 청구 — 올리기 · 간이영수증 부가세 0 · 본인 승인 422(API · DB) · 반려 사유 · 승인 · 지급(PAYOUT · 본인 불가) · 취소(본인) · 목록 범위 · 전표
  ③ (API · DB) 법인카드 — CSV 머리줄 · 같은 파일 다시 · 취소 음수 · 장부에 넣기(공제 ÷ 11) · 넣지 않음 사유 · 넣은 줄 409 · 수익 계정 422 · 내용 고치기 DB 가 막음 · 전표
  ④ (화면) 회계 › 경비 · 법인카드
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1393.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1393.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




import glob
_m45 = sorted(glob.glob(os.path.join(K, 'prisma/migrations/D245_*/migration.sql')))
M45 = open(_m45[0], encoding='utf-8').read() if _m45 else ''
AC, JN, UI, AP, MN = rd('src/modules/acct/acct.controller.ts'), rd('src/modules/acct/sources.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
EX = rd('src/modules/acct/expense.ts')
ok('① 코드 — D245 경비 · 카드 표 · 본인 승인 가드 · API 8 · 감사 · 전표 규칙 3 · 화면 · 메뉴 · 명세 · 문서 530 · 판 v10.393' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   "@Get('expenses')" in AC
       and "@Post('expenses')" in AC
       and "@Post('expenses/:id/decide')" in AC
       and "@Post('expenses/:id/paid')" in AC
       and "@Post('expenses/:id/cancel')" in AC
       and "@Post('cards/upload')" in AC
       and "@Get('cards')" in AC
       and "@Post('cards/:id/book')" in AC
       and "@Audit('ACCT_EXPENSE_DECIDE', 'SETTING')" in AC
       and "@Audit('ACCT_CARD_BOOK', 'SETTING')" in AC
       and "name: 'EXPENSE_APPROVED'" in EX
       and "name: 'EXPENSE_PAID'" in EX
       and "name: 'CARD_TXN'" in EX
       and 'EXPENSE_SOURCES' in JN, VER)


def lines_of(source, key):
    return psql_erp(f"SELECT string_agg(l.role || ':' || l.debit || ':' || l.credit, ',' ORDER BY l.role) FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id WHERE e.source = '{source}' AND e.source_key = '{key}'")


if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW)
    TS = login('admin@x.com')
    ae, aid = mk_staff('1393a', 'ADMIN'); agree(ae, PW); TA = login(ae)
    pe, pid = mk_staff('1393p', 'PAYOUT'); agree(pe, PW); TP = login(pe)
    sid = psql_sgb("SELECT id FROM accounts WHERE email = 'admin@x.com'")
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    ym, d0 = kst.strftime('%Y-%m'), kst.strftime('%Y-%m-%d')
    fut = (kst + datetime.timedelta(days=3)).strftime('%Y-%m-%d')
    stamp = int(time.time()) % 1000000
    try:
        c1 = erp('POST', '/admin/acct/expenses', {'spentOn': d0, 'accountRole': 'EXP_TRAVEL', 'amount': 33000, 'vat': 3000, 'evidence': 'CARD', 'item': f'시험 택시 {stamp}'}, TA)
        c2 = erp('POST', '/admin/acct/expenses', {'spentOn': d0, 'accountRole': 'EXP_SUPPLIES', 'amount': 11000, 'vat': 1000, 'evidence': 'SIMPLE', 'item': f'시험 간이 {stamp}'}, TA)
        c3 = erp('POST', '/admin/acct/expenses', {'spentOn': d0, 'accountRole': 'EXP_WELFARE', 'amount': 5000, 'evidence': 'CASH', 'item': f'시험 취소할 것 {stamp}'}, TA)
        cs = erp('POST', '/admin/acct/expenses', {'spentOn': d0, 'accountRole': 'EXP_ETC', 'amount': 2200, 'evidence': 'CASH', 'item': f'시험 슈퍼 본인 {stamp}'}, TS)
        bad_f = erp('POST', '/admin/acct/expenses', {'spentOn': fut, 'accountRole': 'EXP_TRAVEL', 'amount': 1000, 'evidence': 'CASH', 'item': '앞날짜'}, TA)
        bad_r = erp('POST', '/admin/acct/expenses', {'spentOn': d0, 'accountRole': 'REV_AD', 'amount': 1000, 'evidence': 'CASH', 'item': '수익 계정'}, TA)
        bad_v = erp('POST', '/admin/acct/expenses', {'spentOn': d0, 'accountRole': 'EXP_TRAVEL', 'amount': 1000, 'vat': 500, 'evidence': 'CASH', 'item': '부가세 큼'}, TA)
        bad_file = erp('POST', '/admin/acct/expenses', {'spentOn': d0, 'accountRole': 'EXP_TRAVEL', 'amount': 1000, 'evidence': 'CASH', 'item': '파일', 'attachments': ['00000000-0000-0000-0000-000000000001']}, TA)
        i1, i2, i3, isup = (str(x.get('id')) for x in (c1, c2, c3, cs))
        v2 = psql_erp(f"SELECT vat FROM acct_expense_claims WHERE id = {i2 if i2.isdigit() else 0}")
        selfa = erp('POST', f'/admin/acct/expenses/{isup}/decide', {'decision': 'approve'}, TS)
        selfdb = psql_erp(f"UPDATE acct_expense_claims SET state = 'APPROVED', decided_by = '{sid}', decided_at = now() WHERE id = {isup if isup.isdigit() else 0}")
        notsup = erp('POST', f'/admin/acct/expenses/{i1}/decide', {'decision': 'approve'}, TP)
        rj0 = erp('POST', f'/admin/acct/expenses/{i2}/decide', {'decision': 'reject'}, TS)
        rj1 = erp('POST', f'/admin/acct/expenses/{i2}/decide', {'decision': 'reject', 'reason': '증빙 흐림'}, TS)
        ap1 = erp('POST', f'/admin/acct/expenses/{i1}/decide', {'decision': 'approve'}, TS)
        ap2 = erp('POST', f'/admin/acct/expenses/{i1}/decide', {'decision': 'approve'}, TS)
        cn0 = erp('POST', f'/admin/acct/expenses/{i3}/cancel', None, TP)
        cn1 = erp('POST', f'/admin/acct/expenses/{i3}/cancel', None, TA)
        pa0 = erp('POST', f'/admin/acct/expenses/{i1}/paid', None, TA)
        pa1 = erp('POST', f'/admin/acct/expenses/{i1}/paid', None, TP)
        edit = psql_erp(f"UPDATE acct_expense_claims SET amount = 1 WHERE id = {i1 if i1.isdigit() else 0}")
        dele = psql_erp(f"DELETE FROM acct_expense_claims WHERE id = {i1 if i1.isdigit() else 0}")
        simple_db = psql_erp(f"INSERT INTO acct_expense_claims (claimant, spent_on, account_role, amount, vat, evidence, item) VALUES ('{aid}', current_date, 'EXP_ETC', 11000, 1000, 'SIMPLE', '간이 부가세')")
        la = erp('GET', '/admin/acct/expenses', None, TA)
        lp = erp('GET', '/admin/acct/expenses', None, TP)
        erp('POST', '/admin/acct/journal/run', None, TS)
        ln1 = lines_of('EXPENSE_APPROVED', i1)
        ln2 = lines_of('EXPENSE_PAID', i1)
        mine_only = all(x.get('mine') for x in la.get('items') or []) and la.get('all') is False
        ok('② 경비 — 올리기 · 간이영수증 부가세 0 · 앞날짜 · 수익 계정 · 부가세 큼 · 남의 파일 422 · 본인 승인 422(API · DB) · PAYOUT 승인 403 · 반려 사유 · 승인 · 두 번 409 · 남이 취소 422 · 본인 취소 · 본인 지급 403/422 · 지급 · 고치기 · 지우기 · 간이 부가세 DB 가 막음 · 목록 범위 · 전표',
           all(str(x).isdigit() for x in (i1, i2, i3, isup)) and v2 == '0' and bad_f.get('code') == 'ACCT_EXPENSE_INPUT' and bad_r.get('code') == 'ACCT_EXPENSE_ROLE'
           and bad_v.get('code') == 'ACCT_EXPENSE_INPUT' and bad_file.get('code') == 'FILE_INVALID'
           and selfa.get('code') == 'EXPENSE_SELF' and 'EXPENSE_SELF' in selfdb and notsup.get('_err') == 403 and rj0.get('code') == 'ACCT_REASON' and rj1.get('state') == 'REJECTED'
           and ap1.get('state') == 'APPROVED' and ap2.get('_err') == 409 and cn0.get('code') == 'ACCT_EXPENSE_OWNER' and cn1.get('state') == 'CANCELED'
           and pa0.get('_err') == 403 and pa1.get('state') == 'PAID' and 'ACCT_EXPENSE' in edit and 'ACCT_EXPENSE' in dele and 'ck_aec_simple' in simple_db
           and mine_only and lp.get('all') is True and any(x.get('id') == i1 for x in lp.get('items') or [])
           and ln1 == 'AP:0:33000,EXP_TRAVEL:30000:0,VAT_IN:3000:0' and ln2 == 'AP:33000:0,CASH:0:33000',
           f"{i1} {i2} {i3} {isup} · 간이 {v2} · {bad_f.get('code')} {bad_r.get('code')} {bad_v.get('code')} {bad_file.get('code')} · 본인 {selfa.get('code')} {selfdb[-50:]} · {notsup.get('_err')} · "
           f"반려 {rj0.get('code')} {rj1.get('state')} · 승인 {ap1.get('state')} {ap2.get('_err')} · 취소 {cn0.get('code')} {cn1.get('state')} · 지급 {pa0.get('_err')} {pa1.get('state')} · "
           f"{edit[-30:]} {dele[-30:]} {simple_db[-40:]} · 범위 {mine_only} {lp.get('all')} · {ln1} · {ln2}")

        amt = 20000 + (stamp % 900) * 11
        merch = f'시험식당1393{stamp}'
        csv = ('법인카드 이용내역\n'
               '이용일자,가맹점명,이용금액,승인번호,카드번호,취소여부\n'
               f'{d0},{merch},"{amt:,}",A{stamp},1234-****-****-5678,\n'
               f'{d0.replace("-", ".")},{merch},"{amt:,}",A{stamp},1234-****-****-5678,취소\n'
               f'{d0},{merch}-2,3300,B{stamp},1234-****-****-5678,\n'
               '날짜아님,이상,abc,,,\n')
        up = erp('POST', '/admin/acct/cards/upload', {'csv': csv, 'filename': f't1393-{stamp}.csv', 'card': '시험카드'}, TP)
        up2 = erp('POST', '/admin/acct/cards/upload', {'csv': csv}, TP)
        badh = erp('POST', '/admin/acct/cards/upload', {'csv': '아무 글\n1,2,3\n'}, TP)
        adm = erp('POST', '/admin/acct/cards/upload', {'csv': csv}, TA)
        t1 = psql_erp(f"SELECT id FROM acct_card_txns WHERE merchant = '{merch}' AND amount > 0")
        t2 = psql_erp(f"SELECT id FROM acct_card_txns WHERE merchant = '{merch}' AND amount < 0")
        t3 = psql_erp(f"SELECT id FROM acct_card_txns WHERE merchant = '{merch}-2'")
        b_rev = erp('POST', f'/admin/acct/cards/{t1}/book', {'accountRole': 'REV_AD', 'deductible': True}, TP)
        b1 = erp('POST', f'/admin/acct/cards/{t1}/book', {'accountRole': 'EXP_WELFARE', 'deductible': True}, TP)
        b1b = erp('POST', f'/admin/acct/cards/{t1}/book', {'accountRole': 'EXP_FEE'}, TP)
        b2 = erp('POST', f'/admin/acct/cards/{t2}/book', {'accountRole': 'EXP_WELFARE', 'deductible': True}, TP)
        ig0 = erp('POST', f'/admin/acct/cards/{t3}/book', {'ignore': True, 'note': ''}, TP)
        ig1 = erp('POST', f'/admin/acct/cards/{t3}/book', {'ignore': True, 'note': '개인 사용'}, TP)
        e1 = psql_erp(f"UPDATE acct_card_txns SET amount = 1 WHERE id = {t3 or 0}")
        e2 = psql_erp(f"DELETE FROM acct_card_txns WHERE id = {t3 or 0}")
        e3 = psql_erp(f"UPDATE acct_card_txns SET account_role = 'EXP_FEE' WHERE id = {t1 or 0}")
        cm = erp('GET', f'/admin/acct/cards?ym={ym}', None, TP)
        erp('POST', '/admin/acct/journal/run', None, TS)
        vat = amt - round(amt / 1.1)
        lc1 = lines_of('CARD_TXN', t1)
        lc2 = lines_of('CARD_TXN', t2)
        ok('③ 카드 — 머리줄(2번째 줄) · 새로 3 · 못 읽음 1 · 다시 올리면 새로 0 · 머리줄 없으면 422 · ADMIN 403 · 취소 음수 · 수익 계정 422 · 넣기(공제 ÷ 11) · 넣은 줄 409 · 넣지 않음 사유 · 고치기 · 지우기 · 넣은 줄 바꾸기 DB 가 막음 · 전표(취소는 반대)',
           up.get('added') == 3 and up.get('bad') == 1 and up2.get('added') == 0 and up2.get('dup') == 3 and badh.get('code') == 'CARD_CSV_HEAD' and adm.get('_err') == 403
           and bool(t1) and bool(t2) and bool(t3) and b_rev.get('code') == 'ACCT_CARD_ROLE' and b1.get('vat') == vat and b1b.get('_err') == 409 and b2.get('state') == 'BOOKED'
           and ig0.get('code') == 'ACCT_REASON' and ig1.get('state') == 'IGNORED' and 'ACCT_CARD' in e1 and 'ACCT_CARD' in e2 and 'ACCT_CARD_BOOKED' in e3
           and (cm.get('count') or {}).get('booked', 0) >= 2 and lc1 == f'CARD_AP:0:{amt},EXP_WELFARE:{amt - vat}:0,VAT_IN:{vat}:0' and lc2 == f'CARD_AP:{amt}:0,EXP_WELFARE:0:{amt - vat},VAT_IN:0:{vat}',
           f"{ {k: up.get(k) for k in ('added', 'dup', 'bad')} } · 다시 {up2.get('added')}/{up2.get('dup')} · {badh.get('code')} · {adm.get('_err')} · {t1} {t2} {t3} · {b_rev.get('code')} · 공제 {b1.get('vat')}/{vat} · "
           f"{b1b.get('_err')} · {b2.get('state')} · {ig0.get('code')} {ig1.get('state')} · {e1[-30:]} {e2[-30:]} {e3[-40:]} · {(cm.get('count') or {})} · {lc1} · {lc2}")
    finally:
        # SUPER(공유 계정) 본인 청구는 남기지 않음 — 취소
        for x in locals().get('cs') and [cs] or []:
            if str(x.get('id', '')).isdigit():
                erp('POST', f"/admin/acct/expenses/{x.get('id')}/cancel", None, TS)
        rm_role(aid, '1393a'); rm_role(pid, '1393p')
    pass  # ERP: 화면 단계(옛 운영 화면 ADMIN_WEB) 뺌 — ERP 화면(15175)에 아직 없음
else:
    print('  (API · DB 없음 — ② ③ ④ 건너뜀)')

summary()
