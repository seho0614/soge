"""v10.434 (D256 · docs/571) 부서 · 프로젝트별 손익
  ① (코드) D256 부서 · 프로젝트 · 꼬리표 3가지 · 바꾼 기록(쌓기만) · v_acct_line_tags · API · 화면 · 문서 571
  ② (API · DB) 부서 · 프로젝트 더하기 · 같은 코드 422 · 지급 담당 더하기 403 · 전표 꼬리표 · 근거 꼬리표(전표 전에) · 부서별 · 프로젝트별 손익 · 기록 쌓임
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1434.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1434.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




M56 = migr('D256_')
EC, SD, DP, WH, DN = rd('src/modules/acct/erp.controller.ts'), rd('src/modules/acct/salesdocs.ts'), rd('src/modules/acct/depts.ts'), rd('src/modules/acct/warehouse.ts'), rd('src/modules/acct/dunning.ts')
UI, AP, MN, SR, AM, SC, WK = rd('web/src/app/admin/Erp.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/modules/acct/sources.ts'), rd('src/app.module.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')
stamp = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today = kst.strftime('%Y-%m-%d')
def party(tag, email=None):
    nm = f'시험거래처{tag}-{stamp}'
    e = f"'{email}'" if email else 'NULL'
    return psql_erp(f"INSERT INTO acct_parties (kind, name, contact_email) VALUES ('BOTH', '{nm}', {e}) RETURNING id").split('\n')[0], nm

ok('① 코드 — D256 acct_depts · acct_projects · acct_entry_tags · acct_source_tags · acct_rule_dept · acct_tag_changes · v_acct_line_tags · API · 화면 ErpDepts · 문서 571 · 판 v10.434' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   'export async function deptPnl' in DP
       and "@Get('dept-pnl')" in EC
       and "@Audit('ACCT_TAG_SET', 'SETTING')" in EC, VER)

if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW)
    TS = login('admin@x.com')
    pe, pid = mk_staff('1434', 'PAYOUT'); agree(pe, PW); TP = login(pe)
    code = f'T{stamp}'
    eids = []
    try:
        d1 = erp('POST', '/admin/acct/depts', {'code': code, 'name': '시험 부서 1434'}, TS)
        dup = erp('POST', '/admin/acct/depts', {'code': code, 'name': '또'}, TS)
        byp = erp('POST', '/admin/acct/depts', {'code': code + 'P', 'name': 'x'}, TP)
        p1 = erp('POST', '/admin/acct/projects', {'code': f'P{stamp}', 'name': '시험 프로젝트 1434', 'deptId': d1.get('id')}, TS)
        def entry(key, amt):
            return psql_erp(f"BEGIN; WITH e AS (INSERT INTO acct_entries (entry_date, source, source_key, memo) VALUES ('{today}', 'TEST', '{key}', '시험 1434') RETURNING id) "
                        f"INSERT INTO acct_lines (entry_id, role, debit, credit) SELECT id, 'CASH', {amt}, 0 FROM e UNION ALL SELECT id, 'REV_SALES', 0, {amt} FROM e; COMMIT; "
                        f"SELECT id FROM acct_entries WHERE source = 'TEST' AND source_key = '{key}'").split('\n')[-1]
        e1 = entry(f't1434a-{stamp}', 12340); eids.append(e1)
        tg = erp('POST', f'/admin/acct/tags/entry/{e1}', {'deptId': d1.get('id'), 'reason': '시험 1434 전표'}, TP)
        st = erp('POST', '/admin/acct/tags/source', {'source': 'TEST', 'sourceKey': f't1434b-{stamp}', 'projectId': p1.get('id'), 'reason': '시험 1434 근거'}, TP)
        e2 = entry(f't1434b-{stamp}', 5000); eids.append(e2)
        pd = erp('GET', f'/admin/acct/dept-pnl?from={today}&to={today}&by=dept', None, TP)
        pp = erp('GET', f'/admin/acct/dept-pnl?from={today}&to={today}&by=project', None, TP)
        rd_ = next((x for x in pd.get('items') or [] if x.get('key') == d1.get('id')), {})
        rp = next((x for x in pp.get('items') or [] if x.get('key') == p1.get('id')), {})
        te = erp('GET', f"/admin/acct/tags/entries?ym={today[:7]}", None, TP)
        row = next((x for x in te.get('items') or [] if x.get('id') == e1), {})
        logs = psql_erp(f"SELECT count(*) FROM acct_tag_changes WHERE reason LIKE '시험 1434%'")
        badp = erp('GET', '/admin/acct/dept-pnl?from=x&to=y', None, TP)
        ok('② 부서 손익 — 부서 · 프로젝트 더하기 · 같은 코드 422 · 지급 담당 더하기 403 · 전표 꼬리표 → 부서 매출 12,340 · 근거 꼬리표(전표 전) → 프로젝트 매출 5,000 · 정하기 화면 · 기록 2 · 틀린 기간 422',
           d1.get('ok') is True and dup.get('code') == 'ACCT_DEPT_DUP' and byp.get('_err') == 403 and p1.get('ok') is True and tg.get('ok') is True and st.get('ok') is True
           and int(rd_.get('revenue') or 0) >= 12340 and int(rp.get('revenue') or 0) >= 5000 and row.get('entryDept') == d1.get('id') and int(logs or 0) >= 2 and badp.get('_err') in (400, 422),
           f"{d1.get('ok')} {dup.get('code')} {byp.get('_err')} {p1.get('ok')} {tg.get('ok')} {st.get('ok')} {rd_.get('revenue')} {rp.get('revenue')} {row.get('entryDept')} {logs} {badp.get('_err')}")
    finally:
        ids = ','.join(x for x in eids if x.isdigit()) or '0'
        psql_erp(f"SET session_replication_role = replica; DELETE FROM acct_entry_tags WHERE entry_id IN ({ids}); DELETE FROM acct_source_tags WHERE source = 'TEST' AND source_key LIKE 't1434%'; "
             f"DELETE FROM acct_lines WHERE entry_id IN ({ids}); DELETE FROM acct_entries WHERE id IN ({ids}); DELETE FROM acct_tag_changes WHERE reason LIKE '시험 1434%'; "
             f"DELETE FROM acct_projects WHERE code LIKE 'P{stamp}%'; DELETE FROM acct_depts WHERE code LIKE 'T{stamp}%';")
        rm_role(pid, '1434')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

summary()
