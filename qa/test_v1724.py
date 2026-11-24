"""v10.724 (D325 · docs/832) hero 추천 칩 언어별 — 영어 화면은 home.hero_chips_en(비우면 사전 칩 · 한국어 인기 검색어를 내지 않음)
  ① (코드) 설정 · heroPicks(lang) · 사용자 웹 lang 붙여 부름 · 한국어만 인기 검색어
  ④ 문서 832 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

M, SS, HP = rd('prisma/migrations/D325_pages_ops_bundle/migration.sql'), rd('src/modules/search/search.service.ts'), rd('site/src/app/page.tsx')
ok('① 설정 · 서버 · 사용자 웹', "('home.hero_chips_en'," in M and "lang === 'en' ? 'home.hero_chips_en' : 'home.hero_chips'" in SS and '&lang=${locale}' in HP and "(locale === 'ko' && hot.length >= 3)" in HP, '')

d = doc('832_')
ok('④ 문서 832', all(w in d for w in ('추천 칩', '영어')), str(len(d)))
ok('④ VERSION v10.724 이상', VT >= (10, 724), VER)
done()
