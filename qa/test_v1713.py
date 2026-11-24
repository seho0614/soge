"""v10.713 (docs/821) 관 점검 기록 보고 — 월보에 한 줄(점검 수 · 관 수 · 손님이 못 본 시간 합 · 다시 열지 못함 · 지금 점검 중)
  ① (코드) maintLine · reportView maint(월보만) · 운영 화면 보고 줄
  ③ (API) 지난달 점검 2건(하나는 다시 열지 못함 · 하나는 취소)을 DB 로 넣고 → 월보(GET /admin/reports?kind=MONTH&period=…)의 maint 줄 — 끝나면 지움
  ④ 문서 821 · 판
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SV, RP, RT, RC = rd('src/modules/site/gwan-maint.service.ts'), rd('src/modules/admin/report-period.ts'), rd('web/src/app/admin/Report.tsx'), rd('src/modules/admin/report.controller.ts')
ok('① 월보 한 줄 — maintLine(취소 뺌 · 열려 있던 관의 닫힌 시간 합 · 못 연 수 · 점검 중) · 월보만 · 화면',
   "@Get('work-reports/view')" in RC and 'export async function maintLine(' in SV and 'WHERE canceled_at IS NULL' in SV and "maint: kind === 'MONTH' ? await maintLine(db, r.from, r.to)" in RP and 'data-rpt-maint' in RT, '')
path = '/admin/work-reports/view'   # 운영 화면 › 보고 › 월보

if up():
    mark = psql("SELECT coalesce(max(id), 0) FROM gwan_maintenances")
    try:
        import consent_ok
        consent_ok.agree('admin@x.com', PW)
        TS = login('admin@x.com')
        ym = psql("SELECT to_char((now() AT TIME ZONE 'Asia/Seoul') - interval '1 month', 'YYYY-MM')")
        base = psql(f"SELECT (date_trunc('month', (now() AT TIME ZONE 'Asia/Seoul') - interval '1 month') + interval '9 days') AT TIME ZONE 'Asia/Seoul'")
        psql(f"""INSERT INTO gwan_maintenances (gwan_code, starts_at, ends_at, was_open, closed_at, reopened_at, reopen_error) VALUES
                 ('LED', '{base}'::timestamptz, '{base}'::timestamptz + interval '30 minutes', true, '{base}'::timestamptz, '{base}'::timestamptz + interval '30 minutes', NULL),
                 ('LED', '{base}'::timestamptz + interval '1 day', '{base}'::timestamptz + interval '1 day 20 minutes', true, '{base}'::timestamptz + interval '1 day', '{base}'::timestamptz + interval '1 day 20 minutes', '시험 1713'),
                 ('LED', '{base}'::timestamptz + interval '2 days', '{base}'::timestamptz + interval '2 days 10 minutes', NULL, NULL, NULL, NULL)""")
        psql(f"UPDATE gwan_maintenances SET canceled_at = now() WHERE id > {int(mark or 0)} AND closed_at IS NULL")
        rp = call('GET', f'{path}?kind=MONTH&period={ym}', None, TS)
        mt = rp.get('maint') or {}
        ok('③ 월보 maint 줄 — 다른 시험 기록이 없을 때 「관 점검 2건 · 50분 · 다시 열지 못함 1건」(취소 뺌)', mt.get('failed', 0) >= 1 and '관 점검' in mt.get('text', '') and '다시 열지 못함' in mt.get('text', ''), str(mt or rp.get('_err')))
    finally:
        psql(f"DELETE FROM gwan_maintenances WHERE id > {int(mark or 0)}")
        ok('③ 끝 — 시험 점검 지움', psql(f"SELECT count(*) FROM gwan_maintenances WHERE id > {int(mark or 0)}") == '0', '')
else:
    print('API · DB 없음 — ③ 건너뜀')

d = doc('821_')
ok('④ 문서 821 — 월보 · 관 점검', all(w in d for w in ('월보', '관 점검', '못 본 시간')), str(len(d)))
ok('④ VERSION v10.713 이상', VT >= (10, 713), VER)
done()
