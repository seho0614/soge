"""v10.756 (D328 · docs/864) 손님 한 줄 의견 1년 자동 파기
  ① 정기 작업 이름 3곳 · job_schedules 04:40 · 5천 줄씩
  ③ 1년 지난 시험 줄 → 작업 → 지워짐(자기 줄만 만듦)
  ④ 문서 864 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

M, SC, WC = rd('prisma/migrations/D328_pages_ops_more3/migration.sql'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')
ok('① 서버 · 정기 작업', "case 'page_feedback_purge':" in SC and "| 'page_feedback_purge'" in SC and "'page_feedback_purge'," in WC and "at < now() - interval '1 year'" in SC
   and "VALUES ('page_feedback_purge', 1440, 4, 40" in M, '')
if up():
    ref = 'T1756/' + time.strftime('%H%M%S')
    try:
        psql(f"INSERT INTO page_feedback (page_kind, page_ref, helpful, dev_hash, at) VALUES ('PAGE', '{ref}', true, '0123456789abcdef', now() - interval '400 days'), ('PAGE', '{ref}', false, '0123456789abcdef', now())")
        import consent_ok
        consent_ok.agree('admin@x.com', PW)
        TS = login('admin@x.com')
        r = call('POST', '/admin/jobs', {'job': 'page_feedback_purge'}, TS)
        left = psql(f"SELECT count(*) FROM page_feedback WHERE page_ref = '{ref}'")
        ok('③ 1년 지난 줄만 지움', left == '1', f"{left} {str(r)[:80]}")
    finally:
        psql(f"DELETE FROM page_feedback WHERE page_ref = '{ref}'")

d = doc('864_')
ok('④ 문서 864', all(w in d for w in ('1년',)), str(len(d)))
ok('④ VERSION v10.756 이상', VT >= (10, 756), VER)
done()
