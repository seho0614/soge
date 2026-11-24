"""v10.709 (D323 · docs/817) 꾸밀 페이지 초안 고친 기록
  ① (코드) site_layout_draft_log · writeDraft(바뀐 곳이 있을 때만 · 처음 배치로 · n판으로 · 번역) · layoutChanges · GET draft-log · 화면
  ③ (API) HOME 수정 가능 → 순서 · 글자 바꿈 → 기록(구역 순서 · 글자 이름) · 같은 초안 다시 저장은 기록 안 함 · 처음 배치로 → 기록 · 회원 403 — 끝나면 처음(늘 혼자)
  ④ 문서 817 · 판
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

M, SV, SP = rd('prisma/migrations/D323_gwan_maint_layout_log/migration.sql'), rd('src/modules/site/site-layouts.service.ts'), rd('web/src/app/admin/SitePages.tsx')
ok('① 기록 표 · 서버 · 화면 — 바뀐 곳이 있을 때만 · 처음 배치로 · 판으로 · 최근 50줄',
   'CREATE TABLE IF NOT EXISTS public.site_layout_draft_log' in M and 'private async writeDraft(' in SV and 'if (ch.length || how)' in SV and 'export function layoutChanges(' in SV
   and "version === 0 ? '처음 배치로'" in SV and 'LIMIT 50' in SV and 'data-site-layout-draft-log' in SP, '')

if up():
    mark = psql("SELECT coalesce(max(id), 0) FROM site_layout_draft_log")
    try:
        reset('HOME')
        import consent_ok
        consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
        TS, TB = login('admin@x.com'), login('buyer@x.com')
        call('POST', '/admin/site-layouts/HOME/editable', {'editable': True}, TS)
        lay = {'sections': [{'key': 'core', 'show': True}], 'texts': {'heroTitleA': '시험 1709'}}
        call('PATCH', '/admin/site-layouts/HOME', {'layout': lay}, TS)
        call('PATCH', '/admin/site-layouts/HOME', {'layout': lay}, TS)
        call('POST', '/admin/site-layouts/HOME/restore', {'version': 0}, TS)
        lg = call('GET', '/admin/site-layouts/HOME/draft-log', None, TS)
        mine = [x for x in lg if isinstance(lg, list)][:3] if isinstance(lg, list) else []
        n = psql(f"SELECT count(*) FROM site_layout_draft_log WHERE key = 'HOME' AND id > {int(mark or 0)}")
        ok('③ 기록 — 처음 배치로(맨 위) · 순서 · 글자(한 번만 — 같은 초안 다시 저장은 안 셈) · 회원 403',
           n == '2' and mine and mine[0].get('changes', [''])[0] == '처음 배치로' and any('구역 순서' in x.get('changes', []) and 'hero 제목 첫 줄' in x.get('changes', []) for x in mine)
           and call('GET', '/admin/site-layouts/HOME/draft-log', None, TB).get('_err') == 403, f'{n} {[x.get("changes") for x in mine]}')
    finally:
        reset('HOME')
        ok('③ 끝 — HOME 처음', psql("SELECT editable FROM site_layouts WHERE key = 'HOME'") == 'f', '')
else:
    print('API · DB 없음 — ③ 건너뜀')

d = doc('817_')
ok('④ 문서 817 — 초안 고친 기록 · 바뀐 곳 · 50줄', all(w in d for w in ('초안 고친 기록', '바뀐 곳', '50')), str(len(d)))
ok('④ VERSION v10.709 이상', VT >= (10, 709), VER)
done()
