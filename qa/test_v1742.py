"""v10.742 (docs/850) 관 안 페이지 복사 — 다른 관(또는 같은 관 다른 주소)에 새 페이지로
  ① (코드) copy(첫 화면 막음 · 받는 관 규칙) · 컨트롤러 · 화면 단추
  ③ (API) LED(닫힌 관)로 복사 → 새 페이지(초안 · 제목) — 끝나면 지움
  ④ 문서 850 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

GS, GC, GP = rd('src/modules/site/gwan-pages.service.ts'), rd('src/modules/site/gwan-pages.controller.ts'), rd('web/src/app/admin/gwans/GwanPages.tsx')
ok('① 서버 · 화면', 'async copy(id: number, input: { gwanCode: string; slug: string })' in GS and "'GWAN_PAGE_COPY'" in GS and "@Post('admin/gwan-pages/:id/copy')" in GC and 'data-gwan-page-copy' in GP, '')
if up() and psql("SELECT is_active FROM gwans WHERE code = 'LED'") == 'f':
    s1, s2 = 't1742a' + time.strftime('%H%M%S'), 't1742b' + time.strftime('%H%M%S')
    try:
        import consent_ok
        consent_ok.agree('admin@x.com', PW)
        TS = login('admin@x.com')
        pg = call('POST', '/admin/gwans/LED/pages', {'slug': s1, 'title': '시험 1742'}, TS)
        call('PATCH', f"/admin/gwan-pages/{pg.get('id')}", {'blocks': [{'type': 'TEXT', 'body': '복사 시험'}]}, TS)
        cp = call('POST', f"/admin/gwan-pages/{pg.get('id')}/copy", {'gwanCode': 'LED', 'slug': s2}, TS)
        ok('③ 복사 — 새 페이지 · 같은 제목 · 블록 · 초안(게시 아님)', cp.get('slug') == s2 and cp.get('title') == '시험 1742' and (cp.get('blocks') or [{}])[0].get('body') == '복사 시험' and cp.get('status') == 'DRAFT', f"{cp.get('slug')} {cp.get('status')} {cp.get('code')}")
    finally:
        psql(f"DELETE FROM gwan_pages WHERE gwan_code = 'LED' AND slug IN ('{s1}', '{s2}')")

d = doc('850_')
ok('④ 문서 850', all(w in d for w in ('복사',)), str(len(d)))
ok('④ VERSION v10.742 이상', VT >= (10, 742), VER)
done()
