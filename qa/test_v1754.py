"""v10.754 (docs/862) 운영 반영 「바뀌는 것 한 장」 v10.694 → v10.773
  ① 문서에 D321 ~ D328 · 새 설정 6 · 정기 작업 3 · 할 일
  ④ 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

d = doc('862_')
ok('① 마이그레이션 8 · 설정 · 정기 작업 · 할 일', all(f'D32{i}' in d for i in range(1, 9)) and all(k in d for k in ('site.page_edit_managers_only', 'home.hero_chips_en', 'ops.board_pages', 'ops.digest_hour', 'site.publish_two_person', 'site.maint_title'))
   and all(j in d for j in ('gwan_maint', 'page_link_check', 'page_feedback_purge')) and '적용 뒤 운영자가 할 일' in d and 'docs/881' in d, str(len(d)))

d = doc('862_')
ok('④ 문서 862', all(w in d for w in ('바뀌는 것',)), str(len(d)))
ok('④ VERSION v10.754 이상', VT >= (10, 754), VER)
done()
