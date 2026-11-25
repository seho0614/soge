"""v10.389 (D244 · docs/526) 전표 CSV 양식 맞춤
  ① (코드) D244 양식 표 · 칸 목록 · 검사 · API · 화면 · 문서
  ② (API) 처음 「일반 양식」 = 옛 머리줄 · 새 양식(구분 + 금액 · YYYYMMDD) 미리보기 · 저장 · 같은 이름 409 · 틀린 칸 422 · ADMIN 403 · 내려받기에 양식 · 기본은 하나
  ③ (화면) 회계 › 계정 · 규칙 › 전표 CSV 양식
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1389.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1389.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




M44 = rd('prisma/migrations/D244_acct_bank_format_deadline_etax/migration.sql')
AC, RP, UI, AP, MN = rd('src/modules/acct/acct.controller.ts'), rd('src/modules/acct/acct-reports.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
FM = rd('src/modules/acct/formats.ts')
OLD_HEAD = '일자,전표번호,줄,계정코드,계정명,차변,대변,거래처,적요,증빙,근거'
ok('① 코드 — D244 양식 표(기본 하나 · 일반 양식) · 칸 목록 · 검사(두 칸 · 구분 + 금액) · API 4 · 내려받기 format · 감사 · 화면 · 문서 526 · 판 v10.389' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   'export const FIELDS' in FM
       and 'export function checkFormat' in FM
       and 'export function renderRows' in FM
       and "@Get('formats')" in AC
       and "@Post('formats')" in AC
       and "@Patch('formats/:id')" in AC
       and "@Post('formats/preview')" in AC
       and "@Audit('ACCT_FORMAT_SET', 'SETTING')" in AC
       and "@Query('format') format?: string" in AC, VER)
if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW)
    TS = login('admin@x.com')
    pe, pid = mk_staff('1389', 'PAYOUT'); agree(pe, PW); TP = login(pe)
    ae, aid = mk_staff('1389a', 'ADMIN'); agree(ae, PW); TA = login(ae)
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    ym, d0 = kst.strftime('%Y-%m'), kst.strftime('%Y-%m-%d')
    stamp = int(time.time()) % 1000000
    nm = f'시험양식1389-{stamp}'
    cols = [{'field': 'date', 'title': '전표일자'}, {'field': 'code', 'title': '계정'}, {'field': 'dc', 'title': '구분'}, {'field': 'amount', 'title': '금액'}, {'field': 'memo', 'title': '적요'}, {'field': 'blank', 'title': '비고'}]
    body = {'name': nm, 'columns': cols, 'dateStyle': 'YYYYMMDD', 'dcStyle': 'SIGN', 'dcDebit': '1', 'dcCredit': '2'}
    gen = psql_erp("SELECT id FROM acct_export_formats WHERE name = '일반 양식'")
    # v10.392 부터 기본이 「세무사랑 일반전표」일 수 있음 — 이 시험 동안만 「일반 양식」을 기본으로 두고 끝나면 되돌림
    prev_def = psql_erp("SELECT coalesce(max(name) FILTER (WHERE is_default), '') FROM acct_export_formats")
    psql_erp("UPDATE acct_export_formats SET is_default = false WHERE is_default AND name <> '일반 양식'")
    psql_erp("UPDATE acct_export_formats SET is_default = true WHERE name = '일반 양식'")
    try:
        f0 = erp('GET', '/admin/acct/formats', None, TP)
        g = next((x for x in f0.get('items') or [] if x.get('name') == '일반 양식'), {})
        pv = erp('POST', '/admin/acct/formats/preview', body, TP)
        new = erp('POST', '/admin/acct/formats', body, TS)
        dup = erp('POST', '/admin/acct/formats', body, TS)
        badf = erp('POST', '/admin/acct/formats', {**body, 'name': nm + 'x', 'columns': [{'field': 'date'}, {'field': 'nope'}]}, TS)
        badd = erp('POST', '/admin/acct/formats', {**body, 'name': nm + 'y', 'columns': [{'field': 'date'}, {'field': 'code'}, {'field': 'debit'}]}, TS)
        byadmin = erp('POST', '/admin/acct/formats', {**body, 'name': nm + 'z'}, TA)
        # 내려받기 — 이번 달 전표가 하나는 있게
        adv = sgb('POST', '/admin/advertisers', {'code': f'ADV-1389-{stamp}', 'name': f'시험광고1389 {stamp}'}, TS)
        sgb('POST', '/admin/ad-invoices', {'advertiserId': adv.get('id'), 'periodFrom': d0, 'periodTo': d0, 'amount': 20000, 'dueDate': d0, 'memo': '시험 1389'}, TS)
        erp('POST', '/admin/acct/journal/run', None, TS)
        tk = ticket(TP, 'ACCT_JOURNAL', TS)
        ex = erp('GET', f"/admin/acct/journal/export?ym={ym}&ticket={tk}&format={new.get('id')}", None, TP) if tk and new.get('id') else {}
        tk2 = ticket(TP, 'ACCT_JOURNAL', TS)
        ex0 = erp('GET', f"/admin/acct/journal/export?ym={ym}&ticket={tk2}", None, TP) if tk2 else {}
        lines = (ex.get('csv') or '').lstrip('﻿').split('\r\n')
        mk = erp('PATCH', f"/admin/acct/formats/{new.get('id')}", {**body, 'isDefault': True}, TS)
        defs = psql_erp("SELECT count(*) FILTER (WHERE is_default) || '|' || coalesce(max(name) FILTER (WHERE is_default), '') FROM acct_export_formats")
        ok('② 양식 — 일반 양식 = 옛 머리줄 · 미리보기(YYYYMMDD · 구분 1/2 · 금액) · 저장 · 같은 이름 409 · 모르는 칸 422 · 두 칸 방식인데 대변 없음 422 · ADMIN 403 · 고른 양식으로 내려받기 · 기본 양식(비움) = 옛 머리줄 · 기본으로 바꾸면 하나만',
           ','.join(c.get('title') for c in g.get('columns') or []) == OLD_HEAD and g.get('isDefault') is True
           and pv.get('head') == ['전표일자', '계정', '구분', '금액', '적요', '비고'] and (pv.get('rows') or [[None]])[0][:4] == ['20261105', '108', '1', 110000]
           and bool(new.get('id')) and dup.get('code') == 'ACCT_FORMAT_NAME' and badf.get('code') == 'ACCT_FORMAT' and badd.get('code') == 'ACCT_FORMAT' and byadmin.get('_err') == 403
           and lines[0] == '전표일자,계정,구분,금액,적요,비고' and len(lines) > 2 and re.match(r'^\d{8},', lines[1] or '') is not None
           and (ex0.get('csv') or '').lstrip('﻿').split('\r\n')[0] == OLD_HEAD and mk.get('ok') is True and defs == f'1|{nm}',
           f"일반 {g.get('isDefault')} · 미리 {pv.get('head')} {(pv.get('rows') or [[]])[0][:4]} · 새 {new.get('id')} · {dup.get('code')} {badf.get('code')} {badd.get('code')} {byadmin.get('_err')} · {lines[:2]} · 기본 {defs}")
    finally:
        # 기본 양식은 「일반 양식」으로 되돌림(옛 시험 · 다음 돌림이 그 머리줄을 봄) — 고유 색인 때문에 두 번에 나눔
        back = prev_def if prev_def else '일반 양식'
        psql_erp(f"UPDATE acct_export_formats SET is_default = false WHERE is_default AND name <> '{back}'")
        psql_erp(f"UPDATE acct_export_formats SET is_default = true WHERE name = '{back}'")
        rm_role(pid, '1389'); rm_role(aid, '1389a')
    pass  # ERP: 화면 단계(옛 운영 화면 ADMIN_WEB) 뺌 — ERP 화면(15175)에 아직 없음
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

summary()
