"""v10.749 (D327 · docs/857) 손님 한 줄 의견 「확인함」
  ① (코드) checked_at · check · 화면
  ③ (API) 확인함 → true · 다시 → false — 끝나면 지움
  ④ 문서 857 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

PF, SP = rd('src/modules/site/page-feedback.ts'), rd('web/src/app/admin/SitePages.tsx')
ok('① 서버 · 화면', 'async check(id: number, by: string | null)' in PF and 'checked_at IS NULL RETURNING id' in PF and 'data-page-feedback-check' in SP, '')
if up():
    ref = 'T1749/' + time.strftime('%H%M%S')
    try:
        call('POST', '/page-feedback', {'kind': 'PAGE', 'ref': ref, 'helpful': True, 'comment': '시험 1749'})
        fid = psql(f"SELECT id FROM page_feedback WHERE page_ref = '{ref}'")
        import consent_ok
        consent_ok.agree('admin@x.com', PW)
        TS = login('admin@x.com')
        a = call('POST', f'/admin/page-feedback/{fid}/check', None, TS); b = call('POST', f'/admin/page-feedback/{fid}/check', None, TS)
        ok('③ 확인함 한 번만', a.get('checked') is True and b.get('checked') is False, f'{a} {b}')
    finally:
        psql(f"DELETE FROM page_feedback WHERE page_ref = '{ref}'")

d = doc('857_')
ok('④ 문서 857', all(w in d for w in ('확인함',)), str(len(d)))
ok('④ VERSION v10.749 이상', VT >= (10, 749), VER)
done()
