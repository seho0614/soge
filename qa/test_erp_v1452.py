"""v10.452 (D260 · docs/589) 결산 외화 받을 돈 환산 평가
  ① (코드) acct_fx_revals · 가드 · 계정 FX_REVAL_GAIN · FX_REVAL_LOSS · 미리보기 · 넣기(SUPER · 감사) · 화면 AcctFxReval · 화면 ID SB-ADM-LDG-030 · 문서 589
  ② (API · DB) 시험 수출(USD 100 · 선적 환율 1300) → 매출 전표 → 미리보기(환율 1400 · 차이 +10,000) · 환율 빠짐 422 · 앞달 422 · 지급 담당 넣기 403
              · 넣기 — 평가 전표(말일) + 되돌림(다음 달 첫날 · 차대 반대) · 두 번 409 · 기록 고치기 DB 막음
  ③ (화면) 회계 › 장부 › 외화 환산
  이번 달 시험 기록 · 전표 · 시험 수출은 끝에 지움(replica) — 시험 전에 이번 달 기록이 이미 있으면 넣기는 409 만 확인.
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1452.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1452.py
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
ok('① 코드 — 환산 평가 표 · 가드(말일 · 쌓기만) · 계정 2 · 함수 · API 3(넣기 SUPER · 감사 ACCT_FXREVAL) · 화면 · 메뉴 · 탭 · 화면 ID · 권한 업무 · 문서 589 · 판 v10.452' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   'export async function fxRevalPost' in BK
       and "@Get('fx-reval/preview')" in BC
       and "@Audit('ACCT_FXREVAL', 'SETTING')" in BC, VER)

if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW)
    TS = login('admin@x.com')
    pe, pid = mk_staff('1452', 'PAYOUT'); agree(pe, PW); TP = login(pe)
    had = psql_erp(f"SELECT count(*) FROM acct_fx_revals WHERE ym = '{ym}'") != '0'
    eid = None
    nym = (datetime.date(int(ym[:4]), int(ym[5:]), 28) + datetime.timedelta(days=5)).strftime('%Y-%m')
    try:
        ex = erp('POST', '/admin/acct/exports', {'title': f'시험1452 환산 {stamp}', 'currency': 'USD', 'orderedOn': today, 'lines': [{'item': '시험 품목 1452', 'qty': 1, 'foreignAmount': 100}]}, TS)
        eid = ex.get('id')
        sh = erp('POST', f'/admin/acct/exports/{eid}/advance', {'to': 'SHIPPED', 'date': today, 'fxRate': 1300}, TS)
        erp('POST', '/admin/acct/journal/run', None, TS)
        sale = psql_erp(f"SELECT count(*) FROM acct_entries WHERE source = 'EXPORT_SALE' AND source_key = '{eid}'")
        v = erp('GET', f'/admin/acct/fx-reval?ym={ym}', None, TP)
        cur = sorted(set((v.get('currencies') or []) + ['USD']))
        rates = ','.join(f'{c}:1400' for c in cur)
        pv = erp('GET', f'/admin/acct/fx-reval/preview?ym={ym}&rates={rates}', None, TP)
        mine = next((x for x in pv.get('items') or [] if x.get('exportId') == eid), {})
        miss = erp('GET', f'/admin/acct/fx-reval/preview?ym={ym}&rates=', None, TP)
        fut = erp('GET', f'/admin/acct/fx-reval/preview?ym={nym}&rates=USD:1400', None, TP)
        byp = erp('POST', '/admin/acct/fx-reval', {'ym': ym, 'rates': {c: 1400 for c in cur}}, TP)
        po = erp('POST', '/admin/acct/fx-reval', {'ym': ym, 'rates': {c: 1400 for c in cur}}, TS)
        again = erp('POST', '/admin/acct/fx-reval', {'ym': ym, 'rates': {c: 1400 for c in cur}}, TS)
        last = (datetime.date(int(nym[:4]), int(nym[5:]), 1) - datetime.timedelta(days=1)).strftime('%Y-%m-%d')
        e1 = psql_erp(f"SELECT entry_date::text || '|' || source || '|' || (SELECT sum(debit) FROM acct_lines WHERE entry_id = e.id) || '|' || (SELECT sum(credit) FROM acct_lines WHERE entry_id = e.id) FROM acct_entries e WHERE id = {int(po.get('entryId') or 0)}")
        e2 = psql_erp(f"SELECT entry_date::text || '|' || source FROM acct_entries WHERE id = {int(po.get('reverseEntryId') or 0)}")
        flip = psql_erp(f"SELECT count(*) FROM acct_lines a JOIN acct_lines b ON b.role = a.role AND b.debit = a.credit AND b.credit = a.debit WHERE a.entry_id = {int(po.get('entryId') or 0)} AND b.entry_id = {int(po.get('reverseEntryId') or 0)}")
        nl = psql_erp(f"SELECT count(*) FROM acct_lines WHERE entry_id = {int(po.get('entryId') or 0)}")
        up = psql_erp(f"UPDATE acct_fx_revals SET note = '시험 1452' WHERE ym = '{ym}'")
        posted = (po.get('ok') is True and po.get('gain', 0) >= 10000 and e1.startswith(f'{last}|FX_REVAL|') and e1.split('|')[2] == e1.split('|')[3]
                  and e2 == f'{nym}-01|FX_REVAL_REV' and flip == nl and nl != '0' and again.get('code') == 'ACCT_FXREVAL_DONE') if not had else po.get('code') == 'ACCT_FXREVAL_DONE'
        ok('② 환산 평가 — 매출 전표 · 미리보기(내 건 +10,000) · 환율 빠짐 표시 · 앞달 422 · 지급 담당 403 · 넣기(말일 차대 같음 · 되돌림 다음 달 첫날 · 차대 반대) · 두 번 409 · 고치기 DB 막음',
           ex.get('ok') is True and sh.get('saleKrw') == 130000 and sale == '1' and mine.get('diff') == 10000 and mine.get('evalKrw') == 140000
           and 'USD' in (miss.get('missing') or []) and fut.get('_err') == 422 and byp.get('_err') == 403 and posted and 'ACCT_FXREVAL' in up,
           f"{ex.get('ok')} {sh.get('saleKrw')} {sale} · {mine.get('diff')} {mine.get('evalKrw')} · {miss.get('missing')} · {fut.get('_err')} · {byp.get('_err')} · had={had} {po.get('ok') or po.get('code')} {po.get('gain')} {e1} {e2} {flip}/{nl} {again.get('code')} · {up[-30:]}")
    finally:
        if not had:
            psql_erp(f"SET session_replication_role = replica; "
                 f"CREATE TEMP TABLE t1452 AS SELECT entry_id AS id FROM acct_fx_revals WHERE ym = '{ym}' AND entry_id IS NOT NULL UNION SELECT reverse_entry_id FROM acct_fx_revals WHERE ym = '{ym}' AND reverse_entry_id IS NOT NULL; "
                 f"DELETE FROM acct_fx_revals WHERE ym = '{ym}'; DELETE FROM acct_lines WHERE entry_id IN (SELECT id FROM t1452); DELETE FROM acct_entries WHERE id IN (SELECT id FROM t1452)")
        if eid:
            psql_erp(f"SET session_replication_role = replica; "
                 f"CREATE TEMP TABLE e1452 AS SELECT id FROM acct_entries WHERE source IN ('EXPORT_SALE', 'EXPORT_PAID') AND source_key = '{eid}'; "
                 f"DELETE FROM acct_lines WHERE entry_id IN (SELECT id FROM e1452); DELETE FROM acct_entries WHERE id IN (SELECT id FROM e1452); "
                 f"DELETE FROM acct_export_lines WHERE export_id = {int(eid)}; DELETE FROM acct_exports WHERE id = {int(eid)}")
        rm_role(pid, '1452')
    pass  # ERP: 화면 단계(옛 운영 화면 ADMIN_WEB) 뺌 — ERP 화면(15175)에 아직 없음
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

summary()
