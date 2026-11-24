"""v10.711 (D324 · docs/819) 페이지 게시 요청 · 승인
  ① (코드) page_publish_requests(열린 요청 하나 · 되돌림 사유) · 서비스(지문 · STALE · 승인 = 게시 · 되돌림 · 철회) · 컨트롤러(승인 · 되돌림 SUPER) · 화면(요청 단추 · 게시 요청 표)
  ③ (API) HOME 수정 가능 · 초안 → 요청 · 같은 페이지 다시 요청 422 · 초안 바꿈 → 승인 422 STALE · 되돌려 보냄(사유) · 다시 요청 → 승인 → 게시됨 · 회원 403 — 끝나면 처음(늘 혼자)
  ④ 문서 819 · 판
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

M, SV, CT, SP, GP = (rd('prisma/migrations/D324_maint_notice_publish_requests/migration.sql'), rd('src/modules/site/publish-requests.service.ts'), rd('src/modules/site/publish-requests.controller.ts'),
                     rd('web/src/app/admin/SitePages.tsx'), rd('web/src/app/admin/gwans/GwanPages.tsx'))
ok('① D324 · 서버 — 열린 요청 하나 · 지문 · 바뀌면 승인 막음 · 승인 = 게시(규칙 그대로) · 되돌림 사유 · 철회(요청한 사람 · SUPER) · 운영 알림',
   'page_publish_req_open_uq' in M and "'PUBLISH_REQ_STALE'" in SV and 'await this.layouts.publish(r.ref); else await this.pages.publish(Number(r.ref));' in SV
   and "'PUBLISH_REQ_REASON'" in SV and "'PAGE_PUBLISH_REQUEST'" in SV and CT.count("@Roles('SUPER')") == 2, '')
ok('① 화면 — ADMIN 「게시 요청」(꾸밀 페이지 · 관 안 페이지) · 페이지 목록 「게시 요청」 표(열어 보기 · 승인 · 되돌려 보냄 · 철회 · 초안 바뀜 표시)',
   'data-site-layout-request' in SP and 'data-gwan-page-request' in GP and 'function Requests(' in SP and 'data-publish-request-approve' in SP and '요청 뒤 초안 바뀜' in SP, '')

if up():
    mark = psql("SELECT coalesce(max(id), 0) FROM page_publish_requests")
    try:
        reset('HOME')
        import consent_ok
        consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
        TS, TB = login('admin@x.com'), login('buyer@x.com')
        call('POST', '/admin/site-layouts/HOME/editable', {'editable': True}, TS)
        call('PATCH', '/admin/site-layouts/HOME', {'layout': {'texts': {'heroTitleA': '시험 1711 가'}}}, TS)
        r1 = call('POST', '/admin/publish-requests', {'kind': 'LAYOUT', 'ref': 'HOME', 'note': '시험'}, TS)
        r1b = call('POST', '/admin/publish-requests', {'kind': 'LAYOUT', 'ref': 'HOME'}, TS)
        call('PATCH', '/admin/site-layouts/HOME', {'layout': {'texts': {'heroTitleA': '시험 1711 나'}}}, TS)
        a1 = call('POST', f"/admin/publish-requests/{r1.get('id')}/approve", None, TS)
        lst = call('GET', '/admin/publish-requests', None, TS)
        me = next((x for x in lst if x.get('id') == r1.get('id')), {}) if isinstance(lst, list) else {}
        ok('③ 요청 · 같은 페이지 다시 422 · 초안 바뀜 → 승인 422 STALE · 목록 stale', r1.get('status') == 'OPEN' and r1b.get('code') == 'PUBLISH_REQ_OPEN' and a1.get('code') == 'PUBLISH_REQ_STALE'
           and me.get('stale') is True and me.get('label') == '메인', f"{r1.get('status')} {r1b.get('code')} {a1.get('code')} {me.get('stale')}")
        j1 = call('POST', f"/admin/publish-requests/{r1.get('id')}/reject", {'reason': 'x'}, TS)
        j2 = call('POST', f"/admin/publish-requests/{r1.get('id')}/reject", {'reason': '초안이 바뀜'}, TS)
        r2 = call('POST', '/admin/publish-requests', {'kind': 'LAYOUT', 'ref': 'HOME'}, TS)
        b3 = call('POST', f"/admin/publish-requests/{r2.get('id')}/approve", None, TB)
        a2 = call('POST', f"/admin/publish-requests/{r2.get('id')}/approve", None, TS)
        pub = call('GET', '/site-layouts/HOME')
        ok('③ 사유 짧음 400 · 되돌려 보냄 · 다시 요청 → 회원 승인 403 · SUPER 승인 → 게시(글 나)', j1.get('_err') in (400, 422) and j2.get('status') == 'REJECTED' and b3.get('_err') == 403
           and a2.get('status') == 'APPROVED' and (pub.get('layout') or {}).get('texts', {}).get('heroTitleA') == '시험 1711 나', f"{j1.get('_err')} {j2.get('status')} {b3.get('_err')} {a2.get('status')}")
    finally:
        reset('HOME')
        psql(f"DELETE FROM page_publish_requests WHERE id > {int(mark or 0)}")
        ok('③ 끝 — HOME 처음 · 시험 요청 지움', call('GET', '/site-layouts/HOME').get('layout', 'x') is None, '')
else:
    print('API · DB 없음 — ③ 건너뜀')

d = doc('819_')
ok('④ 문서 819 — 게시 요청 · 승인 · 되돌려 보냄 · 초안이 바뀌면', all(w in d for w in ('게시 요청', '승인', '되돌려 보냄', '초안이 바뀌')), str(len(d)))
ok('④ VERSION v10.711 이상', VT >= (10, 711), VER)
done()
