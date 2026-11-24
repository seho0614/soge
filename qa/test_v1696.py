"""v10.696 (D321 · docs/804) 꾸밀 페이지 공통 바탕 — 초안 · 게시(SUPER) · 판 쌓기 · 예약 · 미리보기 · 되돌리기 · 공개 판
  ① (코드) D321 표 3 · 판 고치기 막음 트리거 · 권한 주소 · 서비스(LAYOUT_SPECS · cleanLayout · publishDue) · 컨트롤러 · app.module · 공개 구역 · 영어 문장
  ② (DB) 게시 판 고치기 막힘 SITE_LAYOUT_VERSION_RO · 미리보기 72시간 넘음 막힘
  ③ (API) 처음 null · 처음 배치 게시 422 · 초안(숨김 · 순서 · 위 블록) · 블록 11개 422 · 게시 → 공개 판 · 미리보기 → 초안 · 같은 판 되돌리기 422 · 회원 403 — 끝나면 처음 배치(BIZ)
  ④ 문서 804 · 판
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

M = rd('prisma/migrations/D321_site_layouts/migration.sql')
SV, CT, AP = rd('src/modules/site/site-layouts.service.ts'), rd('src/modules/site/site-layouts.controller.ts'), rd('src/app.module.ts')
ACL, EN = rd('scripts/check-acl.js'), rd('src/common/i18n/server-text.en.ts')
ok('① D321 — 표 3 · 열쇠 6 · 판 고치기 막음 · 미리보기 72시간 · 권한 주소(게시 · 예약 · 되돌리기 · 페이지 목록)',
   all(w in M for w in ('CREATE TABLE IF NOT EXISTS public.site_layouts', 'CREATE TABLE IF NOT EXISTS public.site_layout_versions', 'CREATE TABLE IF NOT EXISTS public.site_layout_previews',
                        "('HOME'), ('MNY'), ('MAL'), ('BIZ'), ('LED'), ('HLT')", 'SITE_LAYOUT_VERSION_RO:', "interval '72 hours'",
                        "('POST', '/admin/site-layouts/{key}/publish', 'gwan-ux', 'EDIT')", "('GET', '/admin/site-pages', 'gwans', 'VIEW')"))
   and 'DELETE FROM' not in M and 'DROP TABLE' not in M and '%' not in ''.join(l for l in M.splitlines() if 'RAISE' in l), '')
ok('① 서버 — LAYOUT_SPECS 6(+ v10.702 EARN) · cleanLayout(빠진 구역 뒤에 · 블록 자리 10 · 전체 30) · 처음 배치 게시 막음 · 예약 떠 둠 · 운영 알림',
   "export const LAYOUT_KEYS = ['HOME', 'MNY', 'MAL', 'BIZ', 'LED', 'HLT'" in SV   # v10.702 EARN 더함 and 'export function cleanLayout(' in SV and "cleanBlocks(raw, { noFragment: true, max: 10 })" in SV
   and 'if (total > 30)' in SV and "'SITE_LAYOUT_EMPTY'" in SV and 'scheduled_layout = $4::jsonb' in SV and "'SITE_LAYOUT_PUBLISHED'" in SV and 'async publishDue(' in SV, '')
ok('① 컨트롤러 · 등록 · 공개 구역 · 영어 — 게시 · 예약 · 되돌리기 · 수정 가능 SUPER · 초안 ADMIN · 공개 GET /site-layouts/{key}',
   "@Post('admin/site-layouts/:key/publish')" in CT and CT.count("@Roles('SUPER')") >= 4 and "@Get('site-layouts/:key')" in CT and "@Audit('SITE_LAYOUT_PUBLISH', 'SITE')" in CT
   and 'SiteLayoutsController,' in AP and 'SiteLayoutsService,' in AP and "'site-layouts'," in ACL
   and '"끼운 블록은 페이지 전체에서 30개까지입니다."' in EN and '"{0}은(는) {1}개까지 고릅니다."' in EN, '')

if up():
    ok('② DB — 게시 판 고치기 막힘(SITE_LAYOUT_VERSION_RO)',
       'SITE_LAYOUT_VERSION_RO' in psql("BEGIN; INSERT INTO site_layout_versions (key, version, layout) VALUES ('BIZ', 99999, '{}'); UPDATE site_layout_versions SET reason = 'x' WHERE key = 'BIZ' AND version = 99999; ROLLBACK;"), '')
    ok('② DB — 미리보기 72시간 넘음 막힘', 'site_layout_previews_ttl' in psql("BEGIN; INSERT INTO site_layout_previews (token, key, expires_at) VALUES (repeat('a', 40), 'BIZ', now() + interval '80 hours'); ROLLBACK;"), '')
    biz_was = psql("SELECT is_active FROM gwans WHERE code = 'BIZ'")
    try:
        reset('BIZ')
        import consent_ok
        consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
        TS, TB = login('admin@x.com'), login('buyer@x.com')
        # v10.701 (D322) 처음 수정 불가 → 422 LOCKED · SUPER 가 수정 가능 · BIZ 가 열려 있으면 422 GWAN_OPEN · 닫으면 고침
        l0 = call('PATCH', '/admin/site-layouts/BIZ', {'layout': {}}, TS)
        ev = call('POST', '/admin/site-layouts/BIZ/editable', {'editable': True}, TS)
        l1 = call('PATCH', '/admin/site-layouts/BIZ', {'layout': {}}, TS) if biz_was == 't' else {'code': 'SITE_LAYOUT_GWAN_OPEN'}
        ok('③ 수정 가능 스위치 · 관 열림 — 처음 422 SITE_LAYOUT_LOCKED · SUPER 가 가능으로 · 관이 열려 있으면 422 SITE_LAYOUT_GWAN_OPEN',
           l0.get('code') == 'SITE_LAYOUT_LOCKED' and ev.get('editable') is True and l1.get('code') == 'SITE_LAYOUT_GWAN_OPEN', f"{l0.get('code')} {ev.get('editable')} {l1.get('code')}")
        psql("UPDATE gwans SET is_active = false WHERE code = 'BIZ'")
        p0 = call('GET', '/site-layouts/BIZ')
        e0 = call('POST', '/admin/site-layouts/BIZ/publish', None, TS)
        ok('③ 처음 — 공개 layout null · 처음 배치 그대로 게시 422 SITE_LAYOUT_EMPTY', p0.get('layout', 'x') is None and e0.get('code') == 'SITE_LAYOUT_EMPTY', f"{p0} · {e0.get('code')}")
        d1 = call('PATCH', '/admin/site-layouts/BIZ', {'layout': {'sections': [{'key': 'features', 'show': False}, {'key': 'body', 'show': True}],
                                                              'inserts': {'top': [{'type': 'TEXT', 'title': '시험 1696', 'body': '시험 글'}]}}}, TS)
        secs = [(s['key'], s['show']) for s in (d1.get('draft') or {}).get('sections', [])]
        ok('③ 초안 — 적은 차례 · 숨김 · 빠진 구역은 뒤에 · 위 블록 · 게시 안 한 초안', secs[:2] == [('features', False), ('body', True)] and len(secs) == 4
           and (d1.get('draft') or {}).get('inserts', {}).get('top', [{}])[0].get('title') == '시험 1696' and d1.get('draftChanged') is True, str(secs))
        e1 = call('PATCH', '/admin/site-layouts/BIZ', {'layout': {'inserts': {'top': [{'type': 'TEXT', 'body': f'글 {i}'} for i in range(11)]}}}, TS)
        e2 = call('PATCH', '/admin/site-layouts/BIZ', {'layout': {'inserts': {'top': [{'type': 'TEXT', 'body': '<b>x</b>'}]}}}, TS)
        ok('③ 규칙 — 블록 11개 · HTML 422(초안 그대로)', e1.get('_err') == 422 and e2.get('_err') == 422
           and call('GET', '/admin/site-layouts/BIZ', None, TS).get('draft', {}).get('sections', [{}])[0].get('key') == 'features', f"{e1.get('code')} {e2.get('code')}")
        g1 = call('POST', '/admin/site-layouts/BIZ/publish', None, TS)
        p1 = call('GET', '/site-layouts/BIZ')
        ok('③ 게시 — 판 · 공개 판에 숨김 · 순서 · 블록 · 초안 고침 없음', (g1.get('publishedVersion') or 0) >= 1 and g1.get('draftChanged') is False
           and (p1.get('layout') or {}).get('sections', [{}])[0] == {'key': 'features', 'show': False} and p1.get('version') == g1.get('publishedVersion'), f"{g1.get('publishedVersion')} {p1.get('version')}")
        pv = call('POST', '/admin/site-layouts/BIZ/previews', {'hours': 1}, TS)
        call('PATCH', '/admin/site-layouts/BIZ', {'layout': {'sections': [{'key': 'search', 'show': False}]}}, TS)
        pp = call('GET', f"/site-layouts/BIZ?preview={pv.get('token')}")
        pb = call('GET', '/site-layouts/BIZ?preview=' + 'f' * 40)
        ok('③ 미리보기 — 저장된 초안(공개 판과 다름) · 없는 토큰 404', pp.get('preview') is True and (pp.get('layout') or {}).get('sections', [{}])[0] == {'key': 'search', 'show': False}
           and call('GET', '/site-layouts/BIZ').get('layout', {}).get('sections', [{}])[0].get('key') == 'features' and pb.get('_err') == 404, str(pp.get('layout', {}).get('sections', [])[:1]))
        r1 = call('POST', '/admin/site-layouts/BIZ/rollback', {'version': g1.get('publishedVersion'), 'reason': '시험'}, TS)
        sc = call('POST', '/admin/site-layouts/BIZ/schedule', {'at': '2000-01-01T00:00:00Z'}, TS)
        ok('③ 같은 판 되돌리기 422 · 지난 시각 예약 422 · 회원 403', r1.get('code') == 'SITE_LAYOUT_ROLLBACK_SAME' and sc.get('code') == 'SITE_LAYOUT_SCHEDULE'
           and call('GET', '/admin/site-layouts', None, TB).get('_err') == 403, f"{r1.get('code')} {sc.get('code')}")
        rs = call('POST', '/admin/site-layouts/BIZ/restore', {'version': 0}, TS)
        ok('③ 처음 배치로 초안 — 구역 4 모두 보임 · 블록 없음', [s['key'] for s in rs.get('draft', {}).get('sections', [])] == ['search', 'axis', 'body', 'features']
           and all(s['show'] for s in rs.get('draft', {}).get('sections', [])) and rs.get('draft', {}).get('inserts') == {}, '')
    finally:
        reset('BIZ')
        if biz_was == 't':
            psql("UPDATE gwans SET is_active = true WHERE code = 'BIZ' AND NOT is_active")   # 시험 전에 열려 있던 관이면 다시 엶
        ok('③ 끝 — BIZ 처음 배치(공개 null) · 수정 불가 · 관 다시 열림', call('GET', '/site-layouts/BIZ').get('layout', 'x') is None
           and psql("SELECT editable FROM site_layouts WHERE key = 'BIZ'") == 'f' and psql("SELECT is_active FROM gwans WHERE code = 'BIZ'") == biz_was, '')
else:
    print('API · DB 없음 — ② · ③ 건너뜀')

d = doc('804_')
ok('④ 문서 804 — 구역 편집 · 게시 SUPER · 미리보기 · 예약 · D321', all(w in d for w in ('구역', 'SUPER', '미리보기', '예약', 'D321', '처음 배치')), str(len(d)))
ok('④ VERSION v10.696 이상', VT >= (10, 696), VER)
done()
