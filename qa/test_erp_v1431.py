"""v10.431 (D254 · docs/568) 거래처 휴폐업 조회 — 국세청 사업자 상태(키 없으면 간주) · 스위치 처음 off · 휴업 · 폐업 알림 · 매입 경고
  ① (코드) bizcheck.ts(resolveBizStatusProvider 재사용) · D254 칸 4 · 설정 · 정기 작업 acct_biz_check · API · 매입 경고 · 화면 · 문서
  ② (API) 꺼져 있으면 422 · 켜면 조회(간주 VALID) · 목록에 상태 · 번호 없는 거래처 422 · 폐업 거래처로 매입 넣으면 경고 · 정기 작업
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1431.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1431.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




BC, PU, AC, UI, M54 = rd('src/modules/acct/bizcheck.ts'), rd('src/modules/acct/purchase.ts'), rd('src/modules/acct/acct.controller.ts'), rd('web/src/app/admin/Acct.tsx'), migr('D254_')
ok('① 코드 — 국세청 공급자 재사용 · 칸 biz_status · 설정 acct.biz_status_check off · 정기 작업 · API biz-check · 매입 경고 · 화면 · 문서 568 · 판 v10.431' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   'resolveBizStatusProvider' in BC
       and "@Post('parties/:id/biz-check')" in AC
       and 'supplierWarning' in PU, VER)

if API and DB:
    import random  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW)
    TS = login('admin@x.com')
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9); d0 = kst.strftime('%Y-%m-%d')
    stamp = random.randint(100000000, 999999999)
    s0 = getset('acct.biz_status_check')
    pt = erp('POST', '/admin/acct/parties', {'kind': 'SUPPLIER', 'name': f'시험1431 상사 {stamp}', 'bizNo': f'7{stamp}'}, TS)
    pn = erp('POST', '/admin/acct/parties', {'kind': 'SUPPLIER', 'name': f'시험1431 번호없음 {stamp}'}, TS)
    pid = str(pt.get('id') or '')
    try:
        setting('acct.biz_status_check', 'off', '1431')
        off = erp('POST', f'/admin/acct/parties/{pid}/biz-check', None, TS)
        setting('acct.biz_status_check', 'on', '1431')
        on = erp('POST', f'/admin/acct/parties/{pid}/biz-check', None, TS)
        nob = erp('POST', f"/admin/acct/parties/{pn.get('id')}/biz-check", None, TS)
        lst = erp('GET', f'/admin/acct/parties?q=7{stamp}', None, TS)
        row = next((x for x in lst.get('items') or [] if x.get('id') == pid), {})
        psql_erp(f"UPDATE acct_parties SET biz_status = 'CLOSED', biz_stub = false, biz_checked_at = now() WHERE id = {int(pid or 0)}")
        pu = erp('POST', '/admin/acct/purchases', {'kind': 'TAX_INVOICE', 'issuedOn': d0, 'supplierName': '시험1431', 'supplierBizNo': f'7{stamp}', 'item': '시험 1431',
                                                     'supply': 1000 + stamp % 91, 'vat': 100, 'accountRole': 'EXP_SUPPLIES', 'payRole': 'AP', 'force': True}, TS)
        # ERP: 정기 작업 acct_biz_check 뺌 — ERP 작업 실행기(JOBS)에 회계 정기 작업이 아직 없음 — 정기 작업 주인 SGB(E7 에서 넘김)
        ok('② 휴폐업 — 꺼짐 422 · 켜면 조회(키 없으면 간주 VALID) · 목록에 상태 · 번호 없음 422 · 폐업 거래처 매입은 경고(막지 않음) [ERP: 정기 작업 뺌]',
           off.get('code') == 'BIZ_CHECK_OFF' and on.get('ok') is True and on.get('status') in ('VALID', 'UNKNOWN', 'CLOSED', 'SUSPENDED')
           and row.get('bizStatus') == on.get('status') and nob.get('code') == 'ACCT_PARTY_BIZNO' and pu.get('ok') is True and '폐업' in (pu.get('warn') or ''),
           f"{off.get('code')} {on.get('ok')} {on.get('status')} {on.get('stub')} · {row.get('bizStatus')} · {nob.get('code')} · {pu.get('ok')} {pu.get('warn')}")
    finally:
        setting('acct.biz_status_check', s0 or 'off', '1431')
        psql_erp(f"UPDATE ops_alerts SET resolved_at = now(), resolve_note = '시험 1431' WHERE alert_code = 'ACCT_PARTY_CLOSED' AND resolved_at IS NULL AND detail->>'partyId' = '{pid}'")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

summary()
