"""v10.407 (D248 · docs/544) 법인세 추정 미리보기
  ① (코드) D248 설정 · 누진 셈 · 기한 · API · 화면 · 문서
  ② (API) 추정 — 세율 구간 설정 그대로 · 누진 세액 · 지방소득세 · 기한 · 회원 403 · 틀린 설정 DB 가 막음
  ③ (API · DB) 손익 — 시험 전표만큼 매출 · 비용 · 이익이 늘어남
  ④ (화면) 회계 › 법인세 추정
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1407.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1407.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




import glob


M48 = mig('D248')
AC, UI, AP, MN = rd('src/modules/acct/acct.controller.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
SRC = rd('src/modules/acct/sources.ts')
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
CT = rd('src/modules/acct/corptax.ts')
ok('① 코드 — D248 설정(세율 구간 · 지방소득세 · 사업연도 끝 달) · 누진 셈 · 중간예납 · 확정 기한 · API · 화면 · 메뉴 · 명세 · 문서 544 · 판 v10.407' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   'export function corpTax' in CT
       and 'export async function corpDeadlines' in CT
       and "'YEAR_CLOSE', 'YEAR_REOPEN'" in CT
       and "@Get('corptax')" in AC, VER)


def tax_of(base, br):
    if base <= 0:
        return 0
    t, prev = 0.0, 0
    for up, rate in br:
        top = float('inf') if up is None else up
        if base > prev:
            t += (min(base, top) - prev) * rate / 100
        prev = top
        if base <= top:
            break
    return int(t)


if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW); agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1407', 'PAYOUT'); agree(pe, PW); TP = login(pe)
    b0, l0 = getset('acct.corp_tax_brackets'), getset('acct.corp_local_rate')
    try:
        g0 = erp('GET', '/admin/acct/corptax', None, TP)
        mem = erp('GET', '/admin/acct/corptax', None, TB)
        badset = setting('acct.corp_tax_brackets', 'abc', '1407')
        setting('acct.corp_tax_brackets', '1000:10,5000:20,*:30', '1407'); setting('acct.corp_local_rate', '10', '1407')
        g1 = erp('GET', '/admin/acct/corptax', None, TP)
        br = [(b.get('upTo'), b.get('rate')) for b in g1.get('brackets') or []]
        an = g1.get('annualized') or {}
        ytd = g1.get('ytd') or {}
        dl = g1.get('deadlines') or []
        fy = g1.get('fiscalYear') or {}
        today = kst.strftime('%Y-%m-%d')
        ok('② 추정 — 지급 담당 봄 · 회원 403 · 틀린 세율 설정은 DB 가 막음 · 바꾼 세율 구간 그대로 · 누진 세액 · 지방소득세 10% · 지금까지 이익 = 매출 − 비용 · 기한(중간예납 · 확정) 지나지 않은 것',
           not g0.get('_err') and mem.get('_err') == 403 and '!' in badset and br == [(1000, 10), (5000, 20), (None, 30)]
           and an.get('tax') == tax_of(an.get('profit') or 0, br) and an.get('local') == int((an.get('tax') or 0) * 10 / 100)
           and ytd.get('profit') == (ytd.get('revenue') or 0) - (ytd.get('expense') or 0) and ytd.get('tax') == tax_of(ytd.get('profit') or 0, br)
           and len(dl) >= 1 and all('법인세' in x.get('label', '') and x.get('due', '') >= today and x.get('daysLeft', -1) >= 0 for x in dl)
           and fy.get('start', '') <= today <= fy.get('end', ''),
           f"{g0.get('_err') or 'ok'} · {mem.get('_err')} · {badset[-40:]} · {br} · 1년 {an} · 지금 {ytd} · 기한 {[(x.get('label'), x.get('due')) for x in dl]} · {fy}")
        # 손익 계산 확인 — 시험 전표 한 장(매출 11,000 · 비용 3,000)을 넣고 차이만 봄
        stamp = int(time.time()) % 1000000
        before = (erp('GET', '/admin/acct/corptax', None, TP).get('ytd') or {})
        psql_erp(f"BEGIN; WITH e AS (INSERT INTO acct_entries (entry_date, source, source_key, memo) VALUES ('{today}', 'TEST_CT', 't1407-{stamp}', '시험 1407') RETURNING id) "
             f"INSERT INTO acct_lines (entry_id, role, debit, credit) SELECT id, 'CASH', 8000, 0 FROM e UNION ALL SELECT id, 'EXP_FEE', 3000, 0 FROM e UNION ALL SELECT id, 'REV_SUB', 0, 11000 FROM e; COMMIT;")
        after = (erp('GET', '/admin/acct/corptax', None, TP).get('ytd') or {})
        ok('③ 손익 — 시험 전표(매출 11,000 · 비용 3,000)만큼 매출 +11,000 · 비용 +3,000 · 이익 +8,000',
           (after.get('revenue') or 0) - (before.get('revenue') or 0) == 11000 and (after.get('expense') or 0) - (before.get('expense') or 0) == 3000
           and (after.get('profit') or 0) - (before.get('profit') or 0) == 8000, f"{before} → {after}")
    finally:
        setting('acct.corp_tax_brackets', b0 or None, '1407 되돌림'); setting('acct.corp_local_rate', l0 or None, '1407 되돌림')
        psql_erp("SET session_replication_role = replica; DELETE FROM acct_lines WHERE entry_id IN (SELECT id FROM acct_entries WHERE source = 'TEST_CT'); DELETE FROM acct_entries WHERE source = 'TEST_CT'")
        rm_role(pid, '1407')
    pass  # ERP: 화면 단계(옛 운영 화면 ADMIN_WEB) 뺌 — ERP 화면(15175)에 아직 없음
else:
    print('  (API · DB 없음 — ② ~ ④ 건너뜀)')

summary()
