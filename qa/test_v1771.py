"""v10.771 (docs/879) 페이지 게시 업무 권한(gwan-ux APPROVE)
  ① canPublish · assertPublisher 를 게시 · 예약 · 되돌리기 · A/B 에 · 컨트롤러 ADMIN 도 · 화면
  ④ 문서 879 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

PP, SV, GS, CT, GC, SPg = rd('src/modules/site/page-publisher.ts'), rd('src/modules/site/site-layouts.service.ts'), rd('src/modules/site/gwan-pages.service.ts'), rd('src/modules/site/site-layouts.controller.ts'), rd('src/modules/site/gwan-pages.controller.ts'), rd('web/src/app/admin/SitePages.tsx')
ok('① 서버 · 화면', "o.task_key = 'gwan-ux' AND o.level = 'APPROVE' AND o.effect = 'ALLOW'" in PP and 'fn_perm_effective' not in PP and "'PAGE_PUBLISH_FORBIDDEN'" in PP and SV.count('await assertPublisher(this.db)') >= 5 and GS.count('await assertPublisher(this.db)') >= 3
   and "@Post('admin/site-layouts/:key/publish')\n  @HttpCode(200)\n  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')" in CT and "@Post('admin/gwan-pages/:id/publish')\n  @HttpCode(200)\n  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')" in GC
   and 'const isSuper = isSuperRole || !!d.canPublish' in SPg, '')

d = doc('879_')
ok('④ 문서 879', all(w in d for w in ('APPROVE',)), str(len(d)))
ok('④ VERSION v10.771 이상', VT >= (10, 771), VER)
done()
