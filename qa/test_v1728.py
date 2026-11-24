"""v10.728 (D325 · docs/836) 점검 · 없는 페이지 화면 꾸미기 — 전체 설정 글(GLOBAL · 사용자 웹이 읽음 · 비우면 사전 글)
  ① (코드) 설정 4 · MaintNotice · not-found
  ④ 문서 836 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

M, MB, NF = rd('prisma/migrations/D325_pages_ops_bundle/migration.sql'), rd('site/src/components/gwan/MaintBand.tsx'), rd('site/src/app/not-found.tsx')
ok('① 설정 GLOBAL 4 · 점검 화면 · 404', all(f"('{k}', '', 'GLOBAL'" in M for k in ('site.maint_title', 'site.maint_body', 'site.notfound_title', 'site.notfound_body'))
   and "st['site.maint_title'] || t('title')" in MB and "(ko && st['site.notfound_title']) || t('title')" in NF, '')

d = doc('836_')
ok('④ 문서 836', all(w in d for w in ('점검', '없는 페이지')), str(len(d)))
ok('④ VERSION v10.728 이상', VT >= (10, 728), VER)
done()
