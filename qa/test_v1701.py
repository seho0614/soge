"""v10.701 (D322 · docs/809) 페이지 수정 가능 스위치 · 관 열림 규칙
  ① (코드) D322 칸 · 처음 값(꾸밀 페이지 수정 불가 · 관 안 페이지 수정 가능) · 서버 gate(LOCKED · GWAN_OPEN) · 게시 · 예약 · 되돌리기 · 처음 배치도 막음 · 예약 게시 기다림 · 관 안 페이지 GWAN_PAGE_LOCKED · 스위치 SUPER · 화면
  ② (DB) 처음 값 — site_layouts.editable false · gwan_pages.editable 처음 true
  ③ (API) 메인 — 처음 422 LOCKED · 회원 · 스위치 403 · SUPER 가능 → 초안 저장 → 불가 → 다시 422 · 관 안 페이지 — 불가 → 저장 · 게시 422 GWAN_PAGE_LOCKED · 가능 → 저장 — 끝나면 지움 · 처음으로
  ④ 문서 809 · 판
"""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

M = rd('prisma/migrations/D322_page_edit_lock_hub_page/migration.sql')
SV, CT, GS, GC = rd('src/modules/site/site-layouts.service.ts'), rd('src/modules/site/site-layouts.controller.ts'), rd('src/modules/site/gwan-pages.service.ts'), rd('src/modules/site/gwan-pages.controller.ts')
SP, GP = rd('web/src/app/admin/SitePages.tsx'), rd('web/src/app/admin/gwans/GwanPages.tsx')
ok('① D322 — 꾸밀 페이지 editable 처음 false · 관 안 페이지 editable 처음 true · EARN 열쇠 · 권한 주소 · 지우는 문장 없음',
   'ADD COLUMN IF NOT EXISTS editable boolean NOT NULL DEFAULT false' in M and "ALTER TABLE public.gwan_pages ADD COLUMN IF NOT EXISTS editable boolean NOT NULL DEFAULT true" in M
   and "'HOME', 'MNY', 'MAL', 'BIZ', 'LED', 'HLT', 'EARN'" in M and "('POST', '/admin/site-layouts/{key}/editable', 'gwan-ux', 'EDIT')" in M and 'DELETE FROM' not in M, '')
ok('① 서버 — gate(수정 불가 · 관 열림) · 초안 · 게시 · 예약 · 처음 배치 · 되돌리기 모두 막음 · 규칙 검사 먼저 · 예약 게시는 기다림 · 메인은 관 규칙 없음',
   "reason: !editable ? 'SITE_LAYOUT_LOCKED' : gwanOpen ? 'SITE_LAYOUT_GWAN_OPEN' : null" in SV and SV.count('await this.assertEditable(k);') == 5
   and 'const l = cleanLayout(k, layout);   // 입력 규칙을 먼저' in SV and 'if ((await this.gate(due[i]!.key as LayoutKey)).reason) due.splice(i, 1);' in SV
   and "LAYOUT_GWAN: Partial<Record<string, string>> = { MNY: 'MNY'" in SV and 'HOME' not in SV.split('LAYOUT_GWAN: Partial')[1].split('};')[0], '')
ok('① 관 안 페이지 — GWAN_PAGE_LOCKED(저장 · 게시 · 예약 · 되돌리기 · 번역 · 예약 게시 기다림) · 스위치 SUPER · 화면 잠금 표시',
   "'GWAN_PAGE_LOCKED'" in GS and GS.count('await this.assertEditable(id);   // v10.701') == 6 and 'AND editable AND' in GS
   and "@Post('admin/gwan-pages/:id/editable')\n  @HttpCode(200)\n  @ApiBearerAuth() @Roles('SUPER')" in GC and "@Post('admin/site-layouts/:key/editable')\n  @HttpCode(200)\n  @ApiBearerAuth() @Roles('SUPER')" in CT
   and 'data-site-layout-lock' in SP and 'data-site-page-editable-toggle' in SP and 'data-gwan-page-editable-toggle' in GP and "disabled={!!busy || p.editable === false}" in GP, '')

if up():
    ok('② DB 처음 값 — 꾸밀 페이지 수정 불가 · 관 안 페이지 수정 가능', psql("SELECT column_default FROM information_schema.columns WHERE table_name = 'site_layouts' AND column_name = 'editable'") == 'false'
       and psql("SELECT column_default FROM information_schema.columns WHERE table_name = 'gwan_pages' AND column_name = 'editable'") == 'true', '')
    slug = 't1701' + time.strftime('%H%M%S')
    try:
        reset('HOME')
        import consent_ok
        consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
        TS, TB = login('admin@x.com'), login('buyer@x.com')
        h0 = call('PATCH', '/admin/site-layouts/HOME', {'layout': {'texts': {'heroTitleA': '시험 1701'}}}, TS)
        hb = call('POST', '/admin/site-layouts/HOME/editable', {'editable': True}, TB)
        h1 = call('POST', '/admin/site-layouts/HOME/editable', {'editable': True}, TS)
        h2 = call('PATCH', '/admin/site-layouts/HOME', {'layout': {'texts': {'heroTitleA': '시험 1701'}}}, TS)
        call('POST', '/admin/site-layouts/HOME/editable', {'editable': False}, TS)
        h3 = call('POST', '/admin/site-layouts/HOME/publish', None, TS)
        ok('③ 메인 — 처음 422 LOCKED · 회원 스위치 403 · SUPER 가능 → 초안 저장 · 불가로 → 게시 422 LOCKED',
           h0.get('code') == 'SITE_LAYOUT_LOCKED' and hb.get('_err') == 403 and h1.get('editable') is True and h1.get('lockReason') is None
           and (h2.get('draft') or {}).get('texts', {}).get('heroTitleA') == '시험 1701' and h3.get('code') == 'SITE_LAYOUT_LOCKED', f"{h0.get('code')} {hb.get('_err')} {h1.get('lockReason')} {h3.get('code')}")
        pg = call('POST', '/admin/gwans/MNY/pages', {'slug': slug, 'title': '시험 1701'}, TS)
        pid = pg.get('id')
        e0 = call('POST', f'/admin/gwan-pages/{pid}/editable', {'editable': False}, TS)
        p1 = call('PATCH', f'/admin/gwan-pages/{pid}', {'blocks': [{'type': 'TEXT', 'body': '시험'}]}, TS)
        p2 = call('POST', f'/admin/gwan-pages/{pid}/publish', None, TS)
        call('POST', f'/admin/gwan-pages/{pid}/editable', {'editable': True}, TS)
        p3 = call('PATCH', f'/admin/gwan-pages/{pid}', {'blocks': [{'type': 'TEXT', 'body': '시험'}]}, TS)
        ok('③ 관 안 페이지 — 처음 수정 가능 · 불가 → 저장 · 게시 422 GWAN_PAGE_LOCKED · 가능 → 저장', pg.get('editable') is True and e0.get('editable') is False
           and p1.get('code') == 'GWAN_PAGE_LOCKED' and p2.get('code') == 'GWAN_PAGE_LOCKED' and len(p3.get('blocks') or []) == 1, f"{pg.get('editable')} {p1.get('code')} {p2.get('code')}")
    finally:
        reset('HOME')
        psql(f"DELETE FROM gwan_pages WHERE gwan_code = 'MNY' AND slug = '{slug}'")
        ok('③ 끝 — 메인 처음 · 시험 페이지 지움', psql(f"SELECT count(*) FROM gwan_pages WHERE slug = '{slug}'") == '0' and psql("SELECT editable FROM site_layouts WHERE key = 'HOME'") == 'f', '')
else:
    print('API · DB 없음 — ② · ③ 건너뜀')

d = doc('809_')
ok('④ 문서 809 — 수정 가능 · SUPER · 관이 열려 있으면 · 닫은 뒤 · 엔진 · 디자인', all(w in d for w in ('수정 가능', 'SUPER', '열려 있', '닫', '엔진', '디자인', 'D322')), str(len(d)))
ok('④ VERSION v10.701 이상', VT >= (10, 701), VER)
done()
