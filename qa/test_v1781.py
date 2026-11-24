"""v10.781 (D329 · docs/889) A/B 결과 — 누름 수 · 의견
  ① (코드) site_layout_ab_clicks · page_feedback.variant · recordClick · abList 칸 · 사용자 웹 누름 · 의견 판 · 화면
  ③ (API) 비교 없는 페이지 누름 counted false
  ④ 문서 889 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

M, SV, PF, LP, FB, SP = rd('prisma/migrations/D329_bundle5_open_prep/migration.sql'), rd('src/modules/site/site-layouts.service.ts'), rd('src/modules/site/page-feedback.ts'), rd('site/src/components/layout/LayoutViewPing.tsx'), rd('site/src/components/gwan/FeedbackBlock.tsx'), rd('web/src/app/admin/SitePages.tsx')
ok('① 표 · 서버 · 사용자 웹 · 화면', 'CREATE TABLE IF NOT EXISTS public.site_layout_ab_clicks' in M and "CHECK (variant IS NULL OR variant IN ('A', 'B'))" in M and 'async recordClick(' in SV and 'if (n > 20) return { counted: false };' in SV
   and 'AS "clicksA"' in SV and 'AS "yesB"' in SV and 'dev_hash, variant)' in PF and "closest('.lay-ins')" in LP and 'variant: /(?:^|;' in FB and 'data-site-layout-ab-more' in SP, '')
if up():
    r = call('POST', '/site-layouts/EARN/click?v=a')
    ok('③ 비교 없으면 counted false', r.get('counted') is False or psql("SELECT count(*) FROM site_layout_ab WHERE key = 'EARN' AND status = 'RUNNING'") != '0', str(r))

d = doc('889_')
ok('④ 문서 889', all(w in d for w in ('누름',)), str(len(d)))
ok('④ VERSION v10.781 이상', VT >= (10, 781), VER)
done()
