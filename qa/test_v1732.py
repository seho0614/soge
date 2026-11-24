"""v10.732 (docs/840) 게시 전 · 뒤 나란히 보기 — 게시된 화면과 초안(미리보기 링크)을 휴대폰 폭으로 나란히
  ① (코드) 나란히 단추 · 두 iframe
  ④ 문서 840 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SP = rd('web/src/app/admin/SitePages.tsx')
ok('① 화면 — 나란히 · 게시된 화면 · 초안', 'data-site-layout-frame-both' in SP and 'data-site-layout-side' in SP and 'title="게시된 화면"' in SP and 'title="초안 화면"' in SP, '')

d = doc('840_')
ok('④ 문서 840', all(w in d for w in ('나란히',)), str(len(d)))
ok('④ VERSION v10.732 이상', VT >= (10, 732), VER)
done()
