"""v10.454 (D261 · docs/591) 대량 이체 — 금융결제원 오픈뱅킹 어댑터 · 두 사람 승인 · 처음 꺼짐 · 간주
  ① (코드) D261 묶음 · 줄 · 승인 · 가드 · CHECKING · HOLD · PENDING · 거래고유번호 · 설정 · 외부 연동 FIRMBANK(금융결제원 · 키 둘 · .env) · KftcTransfer · 결과 조회 · 전표 · 화면 · 문서 591
  ② (API · DB) 만들기 · 줄(암호문 · 끝 4자리) · 꺼짐 422 · 만든 사람 승인 422 · 두 명 → APPROVED · DB 막음 · LIVE 키 없음 422 ·
     간주 보내기 → 이름 다름 HOLD(안 보냄) · 처리 중 PENDING → CHECKING · 다시 보내기 409 · 거래고유번호 그대로 · 결과 조회 → PARTIAL · 간주 전표 0 · 취소
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1454.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1454.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




M61 = migr('D261_')
TR, FC, UI, AP, MN, SR, RG, SS, EV = (rd('src/modules/acct/transfer.ts'), rd('src/modules/acct/fin.controller.ts'), rd('web/src/app/admin/Fin.tsx'), rd('web/src/App.tsx'),
                                      rd('web/src/lib/adminMenu.ts'), rd('src/modules/acct/sources.ts'), rd('src/common/integration/registry.ts'),
                                      rd('src/common/integration/secret.service.ts'), rd('deploy/aws/env.production.example'))
stamp = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today, yday = kst.strftime('%Y-%m-%d'), (kst - datetime.timedelta(days=1)).strftime('%Y-%m-%d')

ok('① 코드 — D261 묶음 · 줄(계좌 암호문 · 끝 4자리 · 거래고유번호 UNIQUE) · 승인(만든 사람 막음) · 가드 3 · CHECKING · HOLD · PENDING · 설정 acct.transfer off · ASSUME · 외부 연동 FIRMBANK(금융결제원 · 키 둘 · .env) · 어댑터 간주 · KFTC(토큰 · 수취조회 · 입금이체 · 결과조회) · 전표 TRANSFER_PAID · 화면 FIN-020 · 문서 591 · 판 v10.454' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   'export class AssumeTransfer' in TR
       and 'export class KftcTransfer' in TR
       and "'/v2.0/inquiry/receive'" in TR
       and "'/v2.0/transfer/deposit/acnt_num'" in TR
       and "'/v2.0/transfer/result'" in TR
       and "scope: 'oob'" in TR
       and 'export async function checkTransfer' in TR
       and "@Post('fin/transfers/:id/check')" in FC
       and "name: 'TRANSFER_PAID'" in TR
       and 'ALL_SOURCES.push(...TRANSFER_SOURCES)' in SR
       and "@Post('fin/transfers/:id/send')" in FC, VER)

if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW); agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    p1e, p1 = mk_staff('1454a', 'PAYOUT'); agree(p1e, PW); T1 = login(p1e)
    p2e, p2 = mk_staff('1454b', 'PAYOUT'); agree(p2e, PW); T2 = login(p2e)
    s0 = {k: getset(k) for k in ('acct.transfer', 'acct.transfer_mode')}
    bid = bid2 = ''
    try:
        setting('acct.transfer', 'off', '1454'); setting('acct.transfer_mode', 'ASSUME', '1454')
        c = erp('POST', '/admin/fin/transfers', {'title': f'시험 이체 1454-{stamp}', 'payOn': today}, T1); bid = str(c.get('id') or '')
        mb = erp('POST', '/admin/fin/transfers', {'title': '회원 1454'}, TB)
        past = erp('POST', '/admin/fin/transfers', {'title': '시험 1454 지난날', 'payOn': yday}, T1)
        items = [{'payee': '시험 받는분 1454', 'bankCode': '004', 'accountNo': '123-456-789012', 'amount': 10000, 'memo': '시험1454'},
                 {'payee': '(간주 실패) 시험 1454', 'bankCode': '088', 'accountNo': '110123456789', 'amount': 5000},
                 {'payee': '(간주 이름다름) 시험 1454', 'bankCode': '020', 'accountNo': '1002-333-444555', 'amount': 3000},
                 {'payee': '(간주 처리중) 시험 1454', 'bankCode': '081', 'accountNo': '220-777-888999', 'amount': 2000}]
        add = erp('POST', f'/admin/fin/transfers/{bid}/items', {'items': items}, T1)
        badb = erp('POST', f'/admin/fin/transfers/{bid}/items', {'items': [{**items[0], 'bankCode': '04'}]}, T1)
        enc = psql_erp(f"SELECT string_agg(acct_last4 || ':' || (position(convert_to('123456789012', 'UTF8') in acct_no_enc) = 0)::text, ',' ORDER BY id) FROM acct_transfer_items WHERE batch_id = {int(bid or 0)}")
        off = erp('POST', f'/admin/fin/transfers/{bid}/send', None, TS)
        setting('acct.transfer', 'on', '1454')
        early = erp('POST', f'/admin/fin/transfers/{bid}/send', None, TS)
        self_ = erp('POST', f'/admin/fin/transfers/{bid}/approve', {}, T1)
        a1 = erp('POST', f'/admin/fin/transfers/{bid}/approve', {'note': '시험 1454'}, T2)
        a1b = erp('POST', f'/admin/fin/transfers/{bid}/approve', {}, T2)
        a2 = erp('POST', f'/admin/fin/transfers/{bid}/approve', {}, TS)
        after = erp('POST', f'/admin/fin/transfers/{bid}/items', {'items': items[:1]}, T1)
        dbb = psql_erp(f"UPDATE acct_transfer_items SET amount = amount + 1 WHERE batch_id = {int(bid or 0)}")
        setting('acct.transfer_mode', 'LIVE', '1454')
        live = erp('POST', f'/admin/fin/transfers/{bid}/send', None, T1)
        setting('acct.transfer_mode', 'ASSUME', '1454')
        snd = erp('POST', f'/admin/fin/transfers/{bid}/send', None, T1)
        again = erp('POST', f'/admin/fin/transfers/{bid}/send', None, T1)
        tr0 = psql_erp(f"SELECT string_agg(coalesce(result, '-') || ':' || coalesce(bank_tran_id, '-'), ',' ORDER BY id) FROM acct_transfer_items WHERE batch_id = {int(bid or 0)}")
        trx = psql_erp(f"UPDATE acct_transfer_items SET bank_tran_id = 'SGBASSUME0U999999999' WHERE batch_id = {int(bid or 0)} AND bank_tran_id IS NOT NULL")
        setting('acct.transfer', 'off', '1454')
        chk = erp('POST', f'/admin/fin/transfers/{bid}/check', None, T2)
        tr1 = psql_erp(f"SELECT string_agg(coalesce(result, '-') || ':' || coalesce(bank_tran_id, '-'), ',' ORDER BY id) FROM acct_transfer_items WHERE batch_id = {int(bid or 0)}")
        chk2 = erp('POST', f'/admin/fin/transfers/{bid}/check', None, T2)
        setting('acct.transfer', 'on', '1454')
        tids = [x.split(':')[1] for x in tr0.split(',') if ':' in x]
        tid_ok = (len(tids) == 4 and tids[2] == '-' and all(re.match(r'^SGBASSUME0U\d{9}$', x) for x in tids[:2] + tids[3:]) and len(set(tids)) == 4
                  and [x.split(':')[1] for x in tr1.split(',') if ':' in x] == tids)
        erp('POST', '/admin/acct/journal/run', None, TS)
        ent = psql_erp(f"SELECT count(*) FROM acct_entries WHERE source = 'TRANSFER_PAID' AND source_key IN (SELECT id::text FROM acct_transfer_items WHERE batch_id = {int(bid or 0)})")
        det = erp('GET', f'/admin/fin/transfers/{bid}', None, T2)
        res = sorted(str(x.get('result')) for x in det.get('lines') or [])
        accs = sorted(str(x.get('account')) for x in det.get('lines') or [])
        cx = erp('POST', f'/admin/fin/transfers/{bid}/cancel', {'reason': '시험 1454 보낸 뒤'}, T1)
        c2 = erp('POST', '/admin/fin/transfers', {'title': f'시험 이체 1454 취소-{stamp}'}, T2); bid2 = str(c2.get('id') or '')
        cx0 = erp('POST', f'/admin/fin/transfers/{bid2}/cancel', {'reason': 'x'}, T2)
        cx2 = erp('POST', f'/admin/fin/transfers/{bid2}/cancel', {'reason': '시험 1454 취소'}, T2)
        # ERP: 소개뱅크 권한 주소 표(perm_route_map 9줄) 검사 뺌 — ERP 권한은 introspect · @Roles 판정
        ok('② 이체 — 만들기 · 회원 403 · 지난 지급일 422 · 줄 4(합 20,000) · 은행 코드 400 · 계좌 암호문(끝 4자리만) · 꺼짐 422 · 승인 전 409 · 만든 사람 승인 422 · 두 번 409 · 두 명 → APPROVED · 뒤 줄 넣기 409 · DB 막음 · LIVE 키 없음 422 · 간주 보내기 CHECKING(간주 1 · 실패 1 · 이름 다름 HOLD 1 · 처리 중 PENDING 1) · 다시 보내기 409 · 거래고유번호(HOLD 는 없음 · 겹침 없음 · DB 가 바꾸기 막음) · 결과 조회(보내기 꺼져도) → PARTIAL · 번호 그대로(다시 안 보냄) · 두 번째 조회 409 · 간주는 전표 0 · 보낸 뒤 취소 409 · 취소 사유 400 · 취소 [ERP: 권한 주소 9 뺌]',
           c.get('ok') is True and mb.get('_err') == 403 and past.get('code') == 'TRANSFER_DATE' and add.get('total') == 20000 and add.get('itemCount') == 4 and badb.get('_err') == 400
           and enc == '9012:true,6789:true,4555:true,8999:true' and off.get('code') == 'TRANSFER_OFF' and early.get('_err') == 409 and self_.get('code') == 'TRANSFER_SELF'
           and a1.get('state') == 'DRAFT' and a1.get('approvals') == 1 and a1b.get('_err') == 409 and a2.get('state') == 'APPROVED' and after.get('_err') == 409 and 'ACCT_TRANSFER_STATE' in dbb
           and live.get('code') == 'TRANSFER_NOT_READY' and snd.get('state') == 'CHECKING' and snd.get('assumed') == 1 and snd.get('failed') == 1 and snd.get('held') == 1 and snd.get('pending') == 1
           and again.get('_err') == 409 and tid_ok and 'ACCT_TRANSFER' in trx and chk.get('state') == 'PARTIAL' and chk.get('checked') == 1 and chk2.get('_err') == 409 and ent == '0'
           and res == ['ASSUMED', 'ASSUMED', 'FAIL', 'HOLD'] and accs == ['****4555', '****6789', '****8999', '****9012'] and cx.get('_err') == 409 and cx0.get('_err') == 400 and cx2.get('ok') is True,
           f"{c.get('ok')} {mb.get('_err')} {past.get('code')} {add.get('total')} {badb.get('_err')} {enc} · {off.get('code')} {early.get('_err')} {self_.get('code')} · {a1.get('approvals')} {a1b.get('_err')} {a2.get('state')} {after.get('_err')} {dbb[-30:]} · {live.get('code')} {snd.get('state')} {snd.get('assumed')} {snd.get('failed')} {snd.get('held')} {snd.get('pending')} {again.get('_err')} · {tr0} {trx[-30:]} {chk.get('state') or chk.get('code')} {chk.get('checked')} {chk2.get('_err')} {tr1} · {ent} {res} {accs} · {cx.get('_err')} {cx0.get('_err')} {cx2.get('ok')}")
    finally:
        ids = ','.join(x for x in (bid, bid2) if x.isdigit())
        if ids:
            psql_erp(f"SET session_replication_role = replica; DELETE FROM acct_transfer_approvals WHERE batch_id IN ({ids}); DELETE FROM acct_transfer_items WHERE batch_id IN ({ids}); "
                 f"DELETE FROM acct_transfer_batches WHERE id IN ({ids});")
        for k, x in s0.items():
            setting(k, x or None, '1454 되돌림')
        rm_role(p1, '1454a'); rm_role(p2, '1454b')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

summary()
