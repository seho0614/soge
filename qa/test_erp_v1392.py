"""v10.392 (D245 · docs/529) 매입 관리
  ① (코드) D245 매입 표 · 가드 · 증빙 파일 용도 · 전표 PURCHASE · API 4 · 화면 · 메뉴 · 문서 529
  ② (API · DB) 매입 넣기 — 세금계산서(공제) · 간이영수증(불공제 · 부가세 막음) · 기업업무추진비(언제나 불공제) · 입력 검사 422 · 같은 건 409 · force · 회원 403 · 금액 고치기 · 지우기 DB 가 막음
  ③ (API) 증빙 파일(ACCT_EVIDENCE) 올려 붙이기 · 붙은 파일 지우기 막음 · 전표(차변 비용 · 부가세대급금 / 대변 미지급금) · 취소(사유) · 반대 전표 · 분기 매입 부가세
  ④ (화면) 회계 › 매입
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1392.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1392.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




def lines_of(source, key):
    """전표 줄 → 'ROLE:차변:대변' 정렬 목록"""
    out = psql_erp(f"SELECT l.role || ':' || l.debit || ':' || l.credit FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id WHERE e.source = '{source}' AND e.source_key = '{key}' ORDER BY 1")
    return sorted(x for x in out.split('\n') if x and not x.startswith('!'))


M45 = migr('D245_')
AC, UI, AP, MN = rd('src/modules/acct/acct.controller.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
PU, JN, FD = rd('src/modules/acct/purchase.ts'), rd('src/modules/acct/sources.ts'), rd('src/modules/file/file.dto.ts')
ok('① 코드 — D245 매입 표 · 가드 · 증빙 파일 용도 · 전표 PURCHASE · API 4 · 감사 · 화면 · 메뉴 · 명세 · 문서 529 · 판 v10.392' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   'export const PURCHASE_SOURCES' in PU
       and 'export async function purchaseVat' in PU
       and 'PURCHASE_SOURCES' in JN
       and "@Get('purchases')" in AC
       and "@Post('purchases')" in AC
       and "@Post('purchases/:id/cancel')" in AC
       and "@Get('tax/vat-purchase')" in AC
       and "@Audit('ACCT_PURCHASE_ADD', 'SETTING')" in AC
       and "@Audit('ACCT_PURCHASE_CANCEL', 'SETTING')" in AC, VER)


# ⑤ (v10.392 메인 · 대표 「자동전표양식 및 규칙 만들어서 적용」) 규칙 고치기 · 계정 더하기 · 확인표 · 세무사랑 양식
RU, FM, AC5, UI5, SR = rd('src/modules/acct/rules.ts'), rd('src/modules/acct/formats.ts'), rd('src/modules/acct/acct.controller.ts'), rd('web/src/app/admin/Acct.tsx'), rd('src/modules/acct/sources.ts')
ok('⑤ 코드 — D245 규칙 표 3 · 같은 종류 가드 · 증빙 CARD · SIMPLE · 계정 16 더함 · 세무사랑 양식(월 · 일 · 구분 3/4) · rules.ts · API 3 · 감사 · 화면 · 문서 529' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   "month: '월'" in FM
       and "case 'day':" in FM
       and 'export async function setRule' in RU
       and 'export async function ruleSheet' in RU
       and 'export const ALL_SOURCES' in SR
       and "@Audit('ACCT_RULE_SET', 'SETTING')" in AC5
       and "@Audit('ACCT_ACCOUNT_ADD', 'SETTING')" in AC5
       and "@Get('rules/sheet')" in AC5)

if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW); agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1392', 'PAYOUT'); agree(pe, PW); TP = login(pe)
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    ym, d0 = kst.strftime('%Y-%m'), kst.strftime('%Y-%m-%d')
    tomorrow = (kst + datetime.timedelta(days=1)).strftime('%Y-%m-%d')
    qtr = f"{kst.year}-{(kst.month - 1) // 3 + 1}"
    stamp = int(time.time()) % 1000000
    biz = '9' + str(stamp).zfill(9)                       # 돌릴 때마다 다른 공급자
    sup = 70000 + stamp % 9000; vat = sup // 10
    base = {'kind': 'TAX_INVOICE', 'issuedOn': d0, 'supplierName': f'(주)시험매입1392-{stamp}', 'supplierBizNo': biz, 'item': f'시험 사무용품 {stamp}',
            'supply': sup, 'vat': vat, 'accountRole': 'EXP_SUPPLIES', 'payRole': 'AP'}
    try:
        p1 = erp('POST', '/admin/acct/purchases', base, TP)
        dup = erp('POST', '/admin/acct/purchases', base, TP)
        p1f = erp('POST', '/admin/acct/purchases', dict(base, force=True, memo='같은 날 두 번째'), TP)
        sv = erp('POST', '/admin/acct/purchases', dict(base, kind='SIMPLE', supplierBizNo='', vat=500), TP)
        s1 = erp('POST', '/admin/acct/purchases', dict(base, kind='SIMPLE', supplierBizNo='', supply=sup + 11, vat=0), TP)
        en = erp('POST', '/admin/acct/purchases', dict(base, kind='CARD', payRole='CARD_AP', accountRole='EXP_ENTERTAIN', supply=sup + 22, vat=vat + 2, deductible=True), TP)
        nb = erp('POST', '/admin/acct/purchases', dict(base, supplierBizNo=''), TP)
        fu = erp('POST', '/admin/acct/purchases', dict(base, issuedOn=tomorrow), TP)
        ca = erp('POST', '/admin/acct/purchases', dict(base, accountRole='CASH'), TP)
        cp = erp('POST', '/admin/acct/purchases', dict(base, kind='CARD', payRole='AP'), TP)
        bf = erp('POST', '/admin/acct/purchases', dict(base, attachments=['00000000-0000-0000-0000-000000000000'], force=True), TP)
        mem = erp('POST', '/admin/acct/purchases', base, TB)
        e1 = psql_erp(f"UPDATE acct_purchases SET supply = supply + 1, total = total + 1 WHERE id = {p1.get('id') or 0}")
        e2 = psql_erp(f"DELETE FROM acct_purchases WHERE id = {p1.get('id') or 0}")
        st = psql_erp(f"SELECT deductible::text || '|' || total FROM acct_purchases WHERE id = {s1.get('id') or 0}")
        ok('② 넣기 — 세금계산서 공제 · 같은 건 409 · force 넣음 · 간이영수증 부가세 422 · 간이영수증 불공제 · 기업업무추진비 공제 골라도 불공제 · 사업자번호 없음 · 앞날 · 돈 계정 · 카드+미지급금 422 · 없는 파일 422 · 회원 403 · 고치기 · 지우기 DB 가 막음',
           p1.get('ok') is True and p1.get('deductible') is True and dup.get('code') == 'PURCHASE_DUP' and p1f.get('ok') is True and sv.get('code') == 'PURCHASE_SIMPLE_VAT'
           and s1.get('deductible') is False and st == f"false|{sup + 11}" and en.get('deductible') is False and nb.get('code') == 'PURCHASE_BIZNO' and fu.get('code') == 'PURCHASE_DATE'
           and ca.get('code') == 'PURCHASE_ACCOUNT' and cp.get('code') == 'PURCHASE_PAY' and bf.get('code') == 'PURCHASE_FILES' and mem.get('_err') == 403
           and 'ACCT_PURCHASE' in e1 and 'ACCT_PURCHASE' in e2,
           f"{p1} · {dup.get('code')} · {p1f.get('ok')} · {sv.get('code')} · {s1.get('deductible')} {st} · {en.get('deductible')} · {nb.get('code')} {fu.get('code')} {ca.get('code')} {cp.get('code')} {bf.get('code')} · {mem.get('_err')} · {e1[-40:]} · {e2[-40:]}")

        # ③ 증빙 파일 — PAYOUT 이 ACCT_EVIDENCE 를 올려 붙임
        png = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) + b'\x00\x00\x00\rIHDR' + os.urandom(600)
        t = sgb('POST', '/files', {'purpose': 'ACCT_EVIDENCE', 'name': f'영수증1392-{stamp}.png', 'contentType': 'image/png', 'size': len(png)}, TP)
        origin = SGB_API.rsplit('/api/v1', 1)[0]   # 파일 올리기는 소개뱅크(/files)
        url = t.get('uploadUrl') or ''
        put = raw(t.get('method') or 'PUT', (origin + url) if url.startswith('/') else url, png, (t.get('headers') or {}).get('Content-Type', 'image/png')) if url else 0
        cpl = sgb('POST', f"/files/{t.get('fileId')}/complete", None, TP)
        pf = erp('POST', '/admin/acct/purchases', dict(base, item=f'증빙 있음 {stamp}', supply=sup + 33, vat=vat + 3, attachments=[t.get('fileId')]), TP)
        fdel = psql_sgb(f"UPDATE files SET status = 'DELETED' WHERE id = '{t.get('fileId')}'")
        erp('POST', '/admin/acct/journal/run', None, TS)
        l1 = lines_of('PURCHASE', p1.get('id'))
        ls = lines_of('PURCHASE', s1.get('id'))
        le = lines_of('PURCHASE', en.get('id'))
        ev = psql_erp(f"SELECT evidence FROM acct_entries WHERE source = 'PURCHASE' AND source_key IN ('{p1.get('id')}', '{s1.get('id')}', '{en.get('id')}') ORDER BY source_key::bigint")
        c0 = erp('POST', f"/admin/acct/purchases/{p1f.get('id')}/cancel", {'reason': 'x'}, TP)
        c1 = erp('POST', f"/admin/acct/purchases/{p1f.get('id')}/cancel", {'reason': '시험 1392 두 번 넣음'}, TP)
        c2 = erp('POST', f"/admin/acct/purchases/{p1f.get('id')}/cancel", {'reason': '시험 1392 다시'}, TP)
        erp('POST', '/admin/acct/journal/run', None, TS)
        lc = lines_of('PURCHASE_CANCEL', p1f.get('id'))
        lst = erp('GET', f'/admin/acct/purchases?ym={ym}', None, TP)
        mine = [x for x in lst.get('items') or [] if x.get('supplierBizNo') == biz]
        withf = next((x for x in mine if x.get('id') == pf.get('id')), {})
        vp = erp('GET', f'/admin/acct/tax/vat-purchase?q={qtr}', None, TP)
        vs = next((x for x in vp.get('bySupplier') or [] if x.get('bizNo') == biz), {})
        bad = erp('GET', '/admin/acct/tax/vat-purchase?q=2026-9', None, TP)
        want1 = sorted([f'AP:0:{sup + vat}', f'EXP_SUPPLIES:{sup}:0', f'VAT_IN:{vat}:0'])
        wantc = sorted([f'AP:{sup + vat}:0', f'EXP_SUPPLIES:0:{sup}', f'VAT_IN:0:{vat}'])
        ok('③ 증빙 파일 올려 붙임 · 붙은 파일 지우기 막음 · 전표(공제 · 간이 · 기업업무추진비 불공제) · 증빙 표시 · 취소 사유 422 · 취소 · 두 번 409 · 반대 전표 · 목록 · 분기 매입 부가세(공급자별) · 잘못된 분기 ok:false',
           put in (200, 204) and cpl.get('status') == 'READY' and pf.get('ok') is True and 'FILE' in fdel and len(withf.get('files') or []) == 1
           and l1 == want1 and ls == sorted([f'AP:0:{sup + 11}', f'EXP_SUPPLIES:{sup + 11}:0']) and le == sorted([f'CARD_AP:0:{sup + vat + 24}', f'EXP_ENTERTAIN:{sup + vat + 24}:0'])
           and ev.split('\n') == ['TAX_INVOICE', 'SIMPLE', 'CARD'] and c0.get('code') == 'PURCHASE_REASON' and c1.get('ok') is True and c2.get('code') == 'PURCHASE_STATE' and lc == wantc
           and len(mine) >= 4 and any(x.get('state') == 'CANCELED' for x in mine) and vs.get('count') == 2 and vs.get('vat') == vat * 2 + 3
           and (vp.get('total') or {}).get('deductVat', 0) >= vat * 2 + 3 and bad.get('ok') is False,
           f"파일 {put} {cpl.get('status')} {pf.get('ok')} {fdel[-30:]} {len(withf.get('files') or [])} · {l1} · {ls} · {le} · {ev!r} · {c0.get('code')} {c1.get('ok')} {c2.get('code')} · {lc} · {len(mine)} · {vs} · {bad.get('ok')}")

        # ⑤ 규칙 고치기 · 계정 더하기 · 확인표 · 세무사랑 양식
        g0 = erp('GET', '/admin/acct/accounts', None, TS)
        accs = {a['role']: a for a in g0.get('accounts') or []}
        add = erp('POST', '/admin/acct/accounts', {'role': 'U_TEST_RULE', 'name': '시험 1392 매출', 'kind': 'REVENUE', 'extCode': '4049', 'extName': '시험매출', 'reason': '시험 1392'}, TS)
        badrole = erp('POST', '/admin/acct/accounts', {'role': 'T1392', 'name': 'x', 'kind': 'REVENUE', 'reason': '시험 1392'}, TS)
        try:
            ch = erp('PATCH', '/admin/acct/rules/SUB_PAID', {'maps': [{'from': 'REV_SUB', 'to': 'U_TEST_RULE'}], 'evidence': 'CARD', 'reason': '시험 1392 규칙'}, TS)
            kind = erp('PATCH', '/admin/acct/rules/SUB_PAID', {'maps': [{'from': 'REV_SUB', 'to': 'CASH'}], 'reason': '시험 1392 종류'}, TS)
            slot = erp('PATCH', '/admin/acct/rules/SUB_PAID', {'maps': [{'from': 'COGS', 'to': 'COGS'}], 'reason': '시험 1392 자리'}, TS)
            byp = erp('PATCH', '/admin/acct/rules/SUB_PAID', {'maps': [{'from': 'REV_SUB', 'to': 'REV_SUB'}], 'reason': '시험 1392 지급'}, TP)
            nos = erp('PATCH', '/admin/acct/rules/NO_SUCH', {'evidence': 'CARD', 'reason': '시험 1392 없음'}, TS)
            g1 = erp('GET', '/admin/acct/accounts', None, TP)
            r1 = next((r for r in g1.get('rules') or [] if r.get('source') == 'SUB_PAID'), {})
            sh = erp('GET', '/admin/acct/rules/sheet?csv=1', None, TP)
            head = (sh.get('csv') or '').lstrip('\ufeff').split('\r\n')[0]
        finally:
            back = erp('PATCH', '/admin/acct/rules/SUB_PAID', {'maps': [{'from': 'REV_SUB', 'to': 'REV_SUB'}], 'evidence': 'CARD_PG', 'reason': '시험 1392 되돌림'}, TS)
        g2 = erp('GET', '/admin/acct/accounts', None, TS)
        r2 = next((r for r in g2.get('rules') or [] if r.get('source') == 'SUB_PAID'), {})
        logn = psql_erp("SELECT count(*) FROM acct_rule_changes WHERE reason LIKE '시험 1392%'")
        ok('⑤ 규칙 — 계정 16 더함 · 추천 수당 코드 초안 · U_ 계정 더하기(두 번째는 이미 있음) · 역할 틀림 400/422 · 계정 자리 바꿈 · 증빙 바꿈 · 다른 종류 422 · 없는 자리 422 · 지급 담당 403 · 없는 흐름 404 · 확인표 CSV(바꿈 표시) · 되돌림 · 바꾼 기록 쌓임',
           all(k in accs for k in ('VAT_IN', 'AP', 'CARD_AP', 'INVENTORY', 'COGS', 'EXP_FEE')) and bool(accs.get('EXP_PROMO', {}).get('extCode'))
           and (add.get('ok') is True or add.get('code') == 'ACCT_ACCOUNT_DUP') and badrole.get('_err') in (400, 422)
           and ch.get('ok') is True and kind.get('code') == 'ACCT_RULE_KIND' and slot.get('code') == 'ACCT_RULE' and byp.get('_err') == 403 and nos.get('_err') == 404
           and r1.get('changed') is True and r1.get('evidence') == 'CARD' and any(l.get('role') == 'U_TEST_RULE' for l in r1.get('lines') or [])
           and head.startswith('돈 흐름,근거 코드,증빙') and '바꿈' in (sh.get('csv') or '') and int(sh.get('count') or 0) >= 13
           and back.get('ok') is True and r2.get('changed') is False and r2.get('evidence') == 'CARD_PG' and int(logn or 0) >= 4,
           f"{len(accs)} {accs.get('EXP_PROMO', {}).get('extCode')} · {add.get('ok') or add.get('code')} {badrole.get('_err')} · {ch.get('ok')} {kind.get('code')} {slot.get('code')} {byp.get('_err')} {nos.get('_err')} · {r1.get('changed')} {r1.get('evidence')} · {head[:20]} {sh.get('count')} · {back.get('ok')} {r2.get('changed')} · {logn}")
        fm = erp('GET', '/admin/acct/formats', None, TP)
        sj = next((x for x in fm.get('items') or [] if x.get('name') == '세무사랑 일반전표'), {})
        pv = erp('POST', '/admin/acct/formats/preview', {'name': '미리', 'columns': sj.get('columns') or [], 'dateStyle': sj.get('dateStyle') or 'YYYY-MM-DD', 'dcStyle': 'SPLIT', 'dcDebit': '3', 'dcCredit': '4'}, TP)
        row0 = (pv.get('rows') or [[]])[0]
        ok('⑤ 세무사랑 양식 — 있음 · 칸 월 · 일 · 구분 · 계정코드 · 계정과목 … · 미리보기 월 두 자리 · 구분 3/4',
           bool(sj) and ','.join(c.get('title') for c in sj.get('columns') or []).startswith('월,일,구분,계정코드,계정과목') and sj.get('dcDebit') == '3'
           and len(str(row0[0] if row0 else '')) == 2 and (row0[2] if len(row0) > 2 else '') in ('3', '4'),
           f"{bool(sj)} {[c.get('title') for c in sj.get('columns') or []][:5]} · {pv.get('head')} {row0[:4]}")
    finally:
        # 시험이 올린 증빙 파일 — 매입에 붙어 지우기가 막히므로 replica 로 DELETED(다른 시험 test_v1149 가 디스크 파일 수를 셈)
        psql_sgb("SET session_replication_role = replica; UPDATE files SET status = 'DELETED', deleted_at = now() WHERE purpose = 'ACCT_EVIDENCE' AND original_name LIKE '영수증1392-%' AND status <> 'DELETED';")
        rm_role(pid, '1392')
    pass  # ERP: 화면 단계(옛 운영 화면 ADMIN_WEB) 뺌 — ERP 화면(15175)에 아직 없음

else:
    print('  (API · DB 없음 — ② ③ ④ ⑤ 건너뜀)')

summary()
