"""v10.726 (D325 · docs/834) 관별 페이지 편집 권한 — site.page_edit_managers_only on 이면 SUPER 아닌 운영자는 자기 관만(메인은 SUPER 만)
  ① (코드) 설정 · 켤 조건 · gate MANAGER_ONLY · 관 페이지 GWAN_PAGE_MANAGER_ONLY
  ④ 문서 834 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

M, SV, GS = rd('prisma/migrations/D325_pages_ops_bundle/migration.sql'), rd('src/modules/site/site-layouts.service.ts'), rd('src/modules/site/gwan-pages.service.ts')
ok('① 설정 · 서버 두 곳', "('site.page_edit_managers_only', 'off'" in M and "INSERT INTO public.opx_switch_docs" in M and "'SITE_LAYOUT_MANAGER_ONLY'" in SV and 'private async managerOnly(' in SV and "'GWAN_PAGE_MANAGER_ONLY'" in GS, '')

d = doc('834_')
ok('④ 문서 834', all(w in d for w in ('담당자', '편집 권한')), str(len(d)))
ok('④ VERSION v10.726 이상', VT >= (10, 726), VER)
done()
