"""v10.748 (D327 · docs/856) 점검 미리 알림 공지 올리는 때
  ① (코드) notice_lead_min CHECK · 공지 게시 시각 · 화면 고르기
  ③ (API) LED 점검(3일 뒤 · 하루 전) → 공지 게시 시각 = 시작 - 하루 — 끝나면 지움(늘 혼자)
  ④ 문서 856 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

M, MS, SP = rd('prisma/migrations/D327_pages_ops_more2/migration.sql'), rd('src/modules/site/gwan-maint.service.ts'), rd('web/src/app/admin/SitePages.tsx')
ok('① 표 · 서버 · 화면', 'CHECK (notice_lead_min IN (0, 60, 1440))' in M and "greatest(now(), $7::timestamptz - make_interval(mins => $8))" in MS and 'data-gwan-maint-lead' in SP, '')
if up():
    mark = psql("SELECT coalesce(max(id), 0) FROM gwan_maintenances"); nid = ''
    try:
        import consent_ok
        consent_ok.agree('admin@x.com', PW)
        TS = login('admin@x.com')
        iso = lambda s: time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + s))
        m = call('POST', '/admin/gwan-maintenances', {'gwanCode': 'LED', 'startsAt': iso(3 * 86400), 'endsAt': iso(3 * 86400 + 1800), 'announce': True, 'noticeLeadMin': 1440}, TS)
        nid = m.get('noticeId') or ''
        d = psql(f"SELECT round(extract(epoch FROM (('{iso(3 * 86400)}'::timestamptz - interval '1 day') - published_at)))::int FROM notices WHERE id = '{nid}'") if nid else ''
        ok('③ 공지 게시 시각 = 시작 - 하루', m.get('noticeLeadMin') == 1440 and d != '' and abs(int(d)) <= 5, f"{m.get('noticeLeadMin')} {d}")
    finally:
        psql(f"DELETE FROM gwan_maintenances WHERE id > {int(mark or 0)}")
        if nid: psql(f"DELETE FROM notices WHERE id = '{nid}'")

d = doc('856_')
ok('④ 문서 856', all(w in d for w in ('공지', '하루 전')), str(len(d)))
ok('④ VERSION v10.748 이상', VT >= (10, 748), VER)
done()
