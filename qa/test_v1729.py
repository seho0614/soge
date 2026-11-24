"""v10.729 (D325 · docs/837) 손님 한 줄 의견 블록
  ① (코드) page_feedback · FEEDBACK 블록 · 공개 POST(하루 한 번 · 해시) · 모아 보기 · 사용자 웹 · 사전 · 공개 구역
  ③ (API) 보냄 → saved · 같은 기기 다시 → false · HTML 422 · 모아 보기 — 끝나면 지움
  ④ 문서 837 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

M, PF, GB, ACL = rd('prisma/migrations/D325_pages_ops_bundle/migration.sql'), rd('src/modules/site/page-feedback.ts'), rd('site/src/components/gwan/GwanBlocks.tsx'), rd('scripts/check-acl.js')
KO = json.loads(rd('site/src/i18n/messages/ko/gwan.json') or '{}').get('feedback', {})
ok('① 표 · 서버 · 사용자 웹 · 사전 · 공개 구역', 'CREATE TABLE IF NOT EXISTS public.page_feedback' in M and "@Post('page-feedback')" in PF and 'interval \'1 day\'' in PF and "case 'FEEDBACK': return <FeedbackBlock" in GB and "'page-feedback'," in ACL and all(k in KO for k in ('yes', 'no', 'send', 'thanks')), '')
if up():
    ref = 'T1729/' + time.strftime('%H%M%S')
    try:
        a = call('POST', '/page-feedback', {'kind': 'PAGE', 'ref': ref, 'helpful': True, 'comment': '시험 1729'})
        b = call('POST', '/page-feedback', {'kind': 'PAGE', 'ref': ref, 'helpful': False})
        c = call('POST', '/page-feedback', {'kind': 'PAGE', 'ref': ref + 'x', 'helpful': True, 'comment': '<b>x</b>'})
        import consent_ok
        consent_ok.agree('admin@x.com', PW)
        sm = call('GET', '/admin/page-feedback?days=1', None, login('admin@x.com'))
        ok('③ 보냄 · 같은 기기 다시 안 받음 · HTML 422 · 모아 보기', a.get('saved') is True and b.get('saved') is False and c.get('_err') == 422 and any(p.get('ref') == ref and p.get('yes') == 1 for p in sm.get('pages', [])), f"{a} {b} {c.get('_err')}")
    finally:
        psql(f"DELETE FROM page_feedback WHERE page_ref LIKE 'T1729/%'")

d = doc('837_')
ok('④ 문서 837', all(w in d for w in ('한 줄 의견', '도움')), str(len(d)))
ok('④ VERSION v10.729 이상', VT >= (10, 729), VER)
done()
