"""v10.418 (D251 · docs/555) 회계 숫자 · 알림 빠진 것 — 퇴직금 장부 잔액에 기초 잔액 · 법인세 · 급여 · 카드 대금 기한
  ① (코드) severance 장부 잔액(acct_opening_sets · 확정 판) · month.ts corpDeadlines · PAY · CARD · acct.deadline_payday · 문서
  ② (API) 기한 목록에 급여 · 카드 대금(목록엔 늘) · 알림은 처음 꺼짐 · 켜면 7일 안 급여 기한 알림 하나
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1418.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1418.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




import glob


M48 = mig('D248')

M51 = mig('D251')
SV, MO = rd('src/modules/acct/severance.ts'), rd('src/modules/acct/month.ts')
ok('① 코드 — 퇴직금 장부 잔액 = 확정 기초 잔액 판 + 그 뒤 전표 · 법인세 기한(CORP) 합침 · 급여(PAY) · 카드(CARD) 기한 · 알림 스위치 acct.deadline_payday(처음 off) · 문서 555 · 판 v10.418' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   'acct_opening_sets' in SV
       and "o.role = 'SEVERANCE_RES'" in SV
       and 'corpDeadlines' in MO
       and "kind: 'PAY'" in MO
       and "kind: 'CARD'" in MO
       and 's.payAlert' in MO, VER)

if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW)
    TS = login('admin@x.com')
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    keep = {k: getset(k) for k in ('acct.pay_day', 'acct.deadline_payday', 'acct.deadline_days_before', 'acct.deadline_alert')}
    t0 = psql_sgb("SELECT now()")
    try:
        d0 = erp('GET', '/admin/acct/deadlines', None, TS)
        kinds = {x.get('kind') for x in d0.get('list') or []}
        # 급여일을 이틀 뒤로(28일 넘으면 건너뜀) · 알림 켜고 정기 작업
        day2 = (kst + datetime.timedelta(days=2)).day
        if day2 <= 28:
            setting('acct.pay_day', str(day2), '1418'); setting('acct.deadline_days_before', '7', '1418'); setting('acct.deadline_alert', 'on', '1418')
            setting('acct.deadline_payday', 'off', '1418')
            # ERP: 정기 작업 acct_deadline 알림(꺼짐 0 · 켬 1) 검사 뺌 — ERP 작업 실행기(JOBS)에 회계 정기 작업이 아직 없음 — 정기 작업 주인 SGB(E7 에서 넘김)
            d1 = erp('GET', '/admin/acct/deadlines', None, TS)
            pay = next((x for x in d1.get('list') or [] if x.get('kind') == 'PAY' and x.get('daysLeft', 99) <= 7), {})
            setting('acct.deadline_payday', 'on', '1418')
            ok('② 기한 — 목록에 급여 · 카드 대금 · 급여 기한 7일 안 [ERP: 정기 작업 알림 검사 뺌]',
               {'PAY', 'CARD'} <= kinds and bool(pay), f"{sorted(k for k in kinds if k)} · {pay}")
        else:
            ok('② 기한 — 목록에 급여 · 카드 대금(월말이라 알림 확인 건너뜀)', {'PAY', 'CARD'} <= kinds, f"{sorted(k for k in kinds if k)}")
    finally:
        for k, v in keep.items():
            if v: setting(k, v, '1418 되돌림')
        psql_erp(f"UPDATE ops_alerts SET resolved_at = now(), resolve_note = '시험 1418' WHERE alert_code = 'ACCT_DEADLINE' AND resolved_at IS NULL AND detail->>'kind' IN ('PAY', 'CARD') AND raised_at >= '{t0}'::timestamptz")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

summary()
