"""v10.763 (docs/871) 검색 결과 미리 보기
  ① SeoPreview · 꾸밀 페이지 · 관 안 페이지
  ④ 문서 871 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

GPx, SPg = rd('web/src/app/admin/gwans/GwanPages.tsx'), rd('web/src/app/admin/SitePages.tsx')
ok('① 화면', 'export function SeoPreview(' in GPx and 't.length > 60 || desc.length > 160' in GPx and '<SeoPreview title={p.title}' in GPx and '<SeoPreview title=' in SPg and 'SeoPreview, checkPage' in SPg, '')

d = doc('871_')
ok('④ 문서 871', all(w in d for w in ('검색',)), str(len(d)))
ok('④ VERSION v10.763 이상', VT >= (10, 763), VER)
done()
