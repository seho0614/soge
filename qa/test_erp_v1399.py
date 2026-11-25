"""v10.399 (D246 · docs/536) 예산 대비 실적
  ① (코드) D246 예산 표 · 가드 · 바꾼 기록(쌓기만) · 설정 · 정기 작업 · API 2 · 화면 · 메뉴 · 명세 · 문서 536
  ② (API) 예산 넣기 · 실적 · 차이 · 넘음 → 운영 알림 ACCT_BUDGET_OVER · 예산 올리면 풀림 · 지난달 옮기기 · 0 이면 지움
  ③ (API · DB) 자산 계정 422 · 사유 없음 422 · 지급 담당 넣기 403 · 바꾼 기록 지우기 DB 가 막음
  ④ (화면) 회계 › 예산
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1399.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1399.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




import glob


M46 = migr('D246_')
AC, UI, AP, MN = rd('src/modules/acct/acct.controller.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
SRC = rd('src/modules/acct/sources.ts')


BG = rd('src/modules/acct/budget.ts')
ok('① 코드 — D246 acct_budgets · 가드 · acct_budget_changes(쌓기만) · acct.budget_alert · 정기 작업 acct_budget · API 2 · 화면 · 메뉴 · 명세 · 문서 536 · 판 v10.399' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   'export async function budgetJob' in BG
       and 'export async function budgetLine' in BG
       and "ACCT_BUDGET_OVER" in BG
       and "@Get('budget')" in AC
       and "@Put('budget')" in AC
       and "@Audit('ACCT_BUDGET_SET', 'SETTING')" in AC, VER)
if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW)
    TS = login('admin@x.com')
    pe, pid = mk_staff('1399', 'PAYOUT'); agree(pe, PW); TP = login(pe)
    stamp = int(time.time()) % 1000000
    y, m = 2001 + stamp % 9, 1 + (stamp // 9) % 11          # 다른 돌림 · 운영 달과 겹치지 않는 옛 달(끝에 알림 · 전표 정리)
    ym, ym2 = f'{y}-{m:02d}', f'{y}-{m + 1:02d}'
    key = f'{ym}:EXP_ETC'
    amt = 7000 + stamp % 900
    eid = ''
    try:
        eid = psql_erp(f"WITH e AS (INSERT INTO acct_entries (entry_date, source, source_key, memo) VALUES ('{ym}-15', 'TEST', 't1399-{stamp}', '시험 1399 잡비') RETURNING id), "
                   f"l AS (INSERT INTO acct_lines (entry_id, role, debit, credit) SELECT id, 'EXP_ETC', {amt}, 0 FROM e UNION ALL SELECT id, 'CASH', 0, {amt} FROM e) SELECT id FROM e")
        s1 = erp('PUT', '/admin/acct/budget', {'ym': ym, 'items': [{'role': 'EXP_ETC', 'amount': amt - 1000}, {'role': 'REV_SUB', 'amount': 500000}], 'reason': '시험 1399 예산'}, TS)
        v1 = erp('GET', f'/admin/acct/budget?ym={ym}', None, TP)
        r1 = next((x for x in v1.get('items') or [] if x.get('role') == 'EXP_ETC'), {})
        al1 = psql_erp(f"SELECT count(*) FILTER (WHERE resolved_at IS NULL) FROM ops_alerts WHERE alert_code = 'ACCT_BUDGET_OVER' AND detail->>'key' = '{key}'")
        s2 = erp('PUT', '/admin/acct/budget', {'ym': ym, 'items': [{'role': 'EXP_ETC', 'amount': amt + 1000}], 'reason': '시험 1399 올림'}, TS)
        al2 = psql_erp(f"SELECT count(*) FILTER (WHERE resolved_at IS NULL) || '|' || count(*) FROM ops_alerts WHERE alert_code = 'ACCT_BUDGET_OVER' AND detail->>'key' = '{key}'")
        cp = erp('PUT', '/admin/acct/budget', {'ym': ym2, 'copyFrom': ym, 'items': [], 'reason': '시험 1399 옮김'}, TS)
        v2 = erp('GET', f'/admin/acct/budget?ym={ym2}', None, TP)
        r2 = next((x for x in v2.get('items') or [] if x.get('role') == 'EXP_ETC'), {})
        z = erp('PUT', '/admin/acct/budget', {'ym': ym2, 'items': [{'role': 'EXP_ETC', 'amount': 0}, {'role': 'REV_SUB', 'amount': 0}], 'reason': '시험 1399 지움'}, TS)
        left = psql_erp(f"SELECT count(*) FROM acct_budgets WHERE ym = '{ym2}'")
        ok('② 예산 — 넣기 · 실적 · 넘음 · 쓴 비율 · 운영 알림 · 올리면 풀림 · 지난달 옮기기 · 0 이면 지움',
           s1.get('changed') == 2 and r1.get('actual') == amt and r1.get('budget') == amt - 1000 and r1.get('over') is True and r1.get('diff') == -1000
           and al1 == '1' and s2.get('changed') == 1 and al2 == '0|1' and cp.get('changed') == 2 and r2.get('budget') == amt + 1000 and z.get('changed') == 2 and left == '0',
           f"{s1.get('changed')} · {r1} · 알림 {al1} → {al2} · 옮김 {cp.get('changed')} {r2.get('budget')} · 지움 {z.get('changed')} 남음 {left}")
        b1 = erp('PUT', '/admin/acct/budget', {'ym': ym, 'items': [{'role': 'CASH', 'amount': 1000}], 'reason': '시험 1399 자산'}, TS)
        b2 = erp('PUT', '/admin/acct/budget', {'ym': ym, 'items': [{'role': 'EXP_ETC', 'amount': 1000}], 'reason': ' '}, TS)
        b3 = erp('PUT', '/admin/acct/budget', {'ym': ym, 'items': [{'role': 'EXP_ETC', 'amount': 1000}], 'reason': '시험 1399 지급 담당'}, TP)
        b4 = erp('PUT', '/admin/acct/budget', {'ym': ym, 'items': [], 'reason': '시험 1399 빈 것'}, TS)
        dl = psql_erp(f"DELETE FROM acct_budget_changes WHERE ym = '{ym}'")
        dbg = psql_erp(f"INSERT INTO acct_budgets (ym, role, amount) VALUES ('{ym}', 'CASH', 1)")
        ok('③ 검사 — 자산 계정 422 · 사유 없음 422 · 지급 담당 403 · 빈 예산 422 · 바꾼 기록 지우기 · 자산 계정 예산 DB 가 막음',
           b1.get('code') == 'ACCT_BUDGET' and b2.get('code') == 'ACCT_REASON' and b3.get('_err') == 403 and b4.get('code') == 'ACCT_BUDGET' and '!' in dl and '!' in dbg,
           f"{b1.get('code')} {b2.get('code')} {b3.get('_err')} {b4.get('code')} · {dl[-30:]} · {dbg[-40:]}")
    finally:
        erp('PUT', '/admin/acct/budget', {'ym': ym, 'items': [{'role': 'EXP_ETC', 'amount': 0}, {'role': 'REV_SUB', 'amount': 0}], 'reason': '시험 1399 정리'}, TS)
        replica_erp(f"DELETE FROM ops_alerts WHERE alert_code = 'ACCT_BUDGET_OVER' AND detail->>'key' LIKE '{ym}:%'")
        if eid.isdigit():
            replica_erp(f"DELETE FROM acct_lines WHERE entry_id = {eid}; DELETE FROM acct_entries WHERE id = {eid}")
        rm_role(pid, '1399')
    pass  # ERP: 화면 단계(옛 운영 화면 ADMIN_WEB) 뺌 — ERP 화면(15175)에 아직 없음
else:
    print('  (API · DB 없음 — ② ③ ④ 건너뜀)')
summary()
