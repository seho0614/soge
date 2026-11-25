"""v10.408 (D249 · docs/545) 거래처 대장
  ① (코드) D249 거래처 표 · 가드 · API 5 · 화면 · 메뉴 · 문서 545
  ② (API · DB) 넣기 · 같은 사업자번호 409 · 계좌 끝 4자리 · 회원 403 · 찾기 · 한 곳 보기 · 닫기 · 지우기 막음
  ③ (API) 가져오기(SUPER · 다시 눌러도 같음)
  ④ (화면) 회계 › 거래처
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1408.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1408.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




def lines_of(source, key):
    """전표 줄 → 'ROLE:차변:대변' 정렬 목록"""
    out = psql_erp(f"SELECT l.role || ':' || l.debit || ':' || l.credit FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id WHERE e.source = '{source}' AND e.source_key = '{key}' ORDER BY 1")
    return sorted(x for x in out.split('\n') if x and not x.startswith('!'))


M49 = migr('D249_')
AC, UI, AP, MN = rd('src/modules/acct/acct.controller.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
PT = rd('src/modules/acct/parties.ts')
ok('① 코드 — D249 거래처 표 · 사업자번호 하나 · 계좌 끝 4자리 · 지우기 막음 · API 5 · 감사 · 화면 · 메뉴 · 명세 · 문서 545 · 판 v10.408' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   'export async function importParties' in PT
       and 'export async function partyDetail' in PT
       and "@Get('parties')" in AC
       and "@Get('parties/:id')" in AC
       and "@Post('parties')" in AC
       and "@Patch('parties/:id')" in AC
       and "@Post('parties/import')" in AC
       and "@Audit('ACCT_PARTY_ADD', 'SETTING')" in AC
       and "@Audit('ACCT_PARTY_IMPORT', 'SETTING')" in AC, VER)

if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW); agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1408', 'PAYOUT'); agree(pe, PW); TP = login(pe)
    stamp = int(time.time()) % 1000000
    biz = '8' + str(stamp).zfill(9)
    body = {'kind': 'SUPPLIER', 'name': f'(주)시험거래처1408-{stamp}', 'bizNo': biz[:3] + '-' + biz[3:5] + '-' + biz[5:], 'contactName': '김담당',
            'contactPhone': '02-123-4567', 'bankName': '국민은행', 'accountLast4': '1234'}
    try:
        p1 = erp('POST', '/admin/acct/parties', body, TP)
        dup = erp('POST', '/admin/acct/parties', dict(body, name=f'겹침1408-{stamp}'), TP)
        b4 = erp('POST', '/admin/acct/parties', dict(body, bizNo='', accountLast4='12345'), TP)
        bb = erp('POST', '/admin/acct/parties', dict(body, bizNo='123'), TP)
        mem = erp('POST', '/admin/acct/parties', dict(body, bizNo=''), TB)
        row = psql_erp(f"SELECT biz_no || '|' || coalesce(account_last4, '') FROM acct_parties WHERE id = {p1.get('id') or 0}")
        lst = erp('GET', f"/admin/acct/parties?q={urllib.parse.quote(biz)}", None, TP)
        dt = erp('GET', f"/admin/acct/parties/{p1.get('id')}", None, TP)
        cl = erp('PATCH', f"/admin/acct/parties/{p1.get('id')}", dict(body, state='CLOSED'), TP)
        st = psql_erp(f"SELECT state FROM acct_parties WHERE id = {p1.get('id') or 0}")
        delp = psql_erp(f"DELETE FROM acct_parties WHERE id = {p1.get('id') or 0}")
        ok('② 거래처 — 넣기(사업자번호 - 빼고 10자리 · 끝 4자리) · 같은 번호 409 · 계좌 5자리 422 · 번호 3자리 422 · 회원 403 · 찾기 · 한 곳 보기 · 닫기 · 지우기 DB 가 막음 · 감사',
           p1.get('ok') is True and dup.get('code') == 'PARTY_DUP' and b4.get('code') in ('PARTY_ACCOUNT', 'VALIDATION_ERROR') and bb.get('code') == 'PARTY_BIZNO' and mem.get('_err') == 403
           and row == f'{biz}|1234' and any(x.get('id') == p1.get('id') for x in lst.get('items') or []) and (dt.get('party') or {}).get('id') == p1.get('id')
           and cl.get('ok') is True and st == 'CLOSED' and 'ACCT_PARTY' in delp,
           f"{p1} · {dup.get('code')} · {b4.get('code')} · {bb.get('code')} · {mem.get('_err')} · {row} · {len(lst.get('items') or [])} · {(dt.get('party') or {}).get('id')} · {cl.get('ok')} {st} · {delp[-40:]}")
        i1 = erp('POST', '/admin/acct/parties/import', None, TS)
        i2 = erp('POST', '/admin/acct/parties/import', None, TS)
        ip = erp('POST', '/admin/acct/parties/import', None, TP)
        dupadv = psql_erp("SELECT count(*) FROM (SELECT advertiser_id FROM acct_parties WHERE advertiser_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1) x")
        aud = psql_erp("SELECT count(*) FROM erp_audit WHERE action = 'ACCT_PARTY_IMPORT' AND at > now() - interval '10 minutes'")   # ERP 감사는 erp_audit(at)
        ok('③ 가져오기 — SUPER 만(지급 담당 403) · 두 번째는 0곳(다시 눌러도 같음) · 광고주 겹침 없음 · 감사',
           i1.get('ok') is True and i2.get('made') == 0 and ip.get('_err') == 403 and dupadv == '0' and int(aud or 0) >= 1,
           f"{i1.get('made')} · {i2.get('made')} · {ip.get('_err')} · {dupadv} · {aud}")
    finally:
        rm_role(pid, '1408')
    pass  # ERP: 화면 단계(옛 운영 화면 ADMIN_WEB) 뺌 — ERP 화면(15175)에 아직 없음
else:
    print('  (API · DB 없음 — ② ③ ④ 건너뜀)')

summary()
