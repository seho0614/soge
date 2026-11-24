"""v10.737 (D326 · docs/845) 게시 요청 하루 넘으면 다시 알림 — 하루 한 번 · 정기 작업 gwan_maint 가 부름
  ① (코드) reminded_at · remind · tick 에서 부름
  ③ (API) 이틀 전 요청 → 작업 → reminded_at 채워짐 · 다시 돌려도 그대로 — 끝나면 지움(늘 혼자)
  ④ 문서 845 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

M, RQ, MS = rd('prisma/migrations/D326_pages_ops_more/migration.sql'), rd('src/modules/site/publish-requests.service.ts'), rd('src/modules/site/gwan-maint.service.ts')
ok('① 칸 · 다시 알림 · 정기 작업', 'ADD COLUMN IF NOT EXISTS reminded_at timestamptz' in M and 'async remind(): Promise<number>' in RQ and "interval '1 day'" in RQ and 'await this.requests.remind()' in MS, '')
if up():
    mark = psql("SELECT coalesce(max(id), 0) FROM page_publish_requests")
    try:
        import consent_ok
        consent_ok.agree('admin@x.com', PW)
        TS = login('admin@x.com')
        psql("INSERT INTO page_publish_requests (kind, ref, draft_sig, requested_at) VALUES ('LAYOUT', 'EARN', repeat('a', 32), now() - interval '2 days')")
        call('POST', '/admin/jobs', {'job': 'gwan_maint'}, TS)
        r1 = psql(f"SELECT reminded_at IS NOT NULL FROM page_publish_requests WHERE id > {int(mark or 0)}")
        t1 = psql(f"SELECT reminded_at FROM page_publish_requests WHERE id > {int(mark or 0)}")
        call('POST', '/admin/jobs', {'job': 'gwan_maint'}, TS)
        t2 = psql(f"SELECT reminded_at FROM page_publish_requests WHERE id > {int(mark or 0)}")
        ok('③ 다시 알림 — 채워짐 · 하루 안 다시는 그대로', r1 == 't' and t1 == t2, f'{r1} {t1} {t2}')
    finally:
        psql(f"DELETE FROM page_publish_requests WHERE id > {int(mark or 0)}")

d = doc('845_')
ok('④ 문서 845', all(w in d for w in ('하루', '다시 알림')), str(len(d)))
ok('④ VERSION v10.737 이상', VT >= (10, 737), VER)
done()
