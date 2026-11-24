"""v10.704 (docs/812) 페이지 목록에서 관 안 페이지 바로 편집 · 수정 가능 스위치
  ① (코드) GwanPageEditor 내보냄 · 페이지 목록 아래 표 「편집」 → 그 자리에서 편집 · 수정 칸(가능 · 불가 · SUPER 스위치) · site-pages 응답에 editable · gwanOpen
  ③ (API) site-pages 관 안 페이지 줄에 editable · gwanOpen 칸 · 꾸밀 페이지 줄에 editable · gwanCode · gwanOpen(EARN 포함 7)
  ④ 문서 812 · 판
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SP, GP, SV = rd('web/src/app/admin/SitePages.tsx'), rd('web/src/app/admin/gwans/GwanPages.tsx'), rd('src/modules/site/site-layouts.service.ts')
ok('① 바로 편집 — GwanPageEditor · 아래 표 「편집」 · 돌아오면 목록 다시 읽음',
   'export function GwanPageEditor(' in GP and "import { BlockList, GwanPageEditor" in SP and 'data-site-page-row-edit' in SP
   and '<GwanPageEditor id={pageEdit} isSuper={isSuper} onBack={() => { setPageEdit(null); reload(); }} />' in SP, '')
ok('① 수정 칸 — 꾸밀 페이지 · 관 안 페이지 모두(가능 · 불가 · 관 열림 · SUPER 스위치) · 서버 응답 칸',
   'data-site-page-editable=' in SP and 'data-site-page-row-editable' in SP and "/admin/gwan-pages/${p.id}/editable" in SP and 'p.editable, g.is_active AS "gwanOpen"' in SV, '')

if up():
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    sp = call('GET', '/admin/site-pages', None, TS)
    ly, pg = sp.get('layouts') or [], sp.get('pages') or []
    ok('③ site-pages — 꾸밀 페이지 7(EARN 포함) · editable · gwanCode · gwanOpen · 관 안 페이지 editable · gwanOpen', [x.get('key') for x in ly] == ['HOME', 'MNY', 'MAL', 'BIZ', 'LED', 'HLT', 'EARN']
       and all('editable' in x and 'gwanOpen' in x and 'gwanCode' in x for x in ly) and next((x for x in ly if x['key'] == 'HOME'), {}).get('gwanCode') is None
       and all('editable' in p and 'gwanOpen' in p for p in pg), f"{[x.get('key') for x in ly]} pages {len(pg)}")
else:
    print('API · DB 없음 — ③ 건너뜀')

d = doc('812_')
ok('④ 문서 812 — 바로 편집 · 수정 가능', all(w in d for w in ('바로 편집', '수정 가능', '페이지 목록')), str(len(d)))
ok('④ VERSION v10.704 이상', VT >= (10, 704), VER)
done()
