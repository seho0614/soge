"""v10.718 (docs/826) 그림 올리기 칸 — 안내 장 그림을 주소 대신 파일로(관 페이지 그림과 같은 보관)
  ① (코드) ImageField 내보냄 · 안내 장에 씀
  ④ 문서 826 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SP, GP = rd('web/src/app/admin/SitePages.tsx'), rd('web/src/app/admin/gwans/GwanPages.tsx')
ok('① 그림 칸 — ImageField 내보냄 · 안내 장 그림 · 블록 사진은 전처럼', 'export function ImageField(' in GP and '<ImageField label="그림(올리기 또는 주소' in SP and ('ImageField, checkPage' in SP or 'ImageField, SeoPreview, checkPage' in SP)   # v10.763 SeoPreview 더함
   , '')

d = doc('826_')
ok('④ 문서 826', all(w in d for w in ('그림', '올리')), str(len(d)))
ok('④ VERSION v10.718 이상', VT >= (10, 718), VER)
done()
