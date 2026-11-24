"""v10.745 (docs/853) 꾸밀 페이지 편집 중 임시 저장(이 브라우저)
  ① (코드) localStorage 1초 · 되살리기 · 버리기 · 저장하면 지움
  ④ 문서 853 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SP = rd('web/src/app/admin/SitePages.tsx')
ok('① 화면 — 임시 저장 · 되살리기 · 버리기', 'slay-tmp:${k}' in SP and 'data-site-layout-tmp-restore' in SP and 'localStorage.removeItem(tmpKey)' in SP, '')

d = doc('853_')
ok('④ 문서 853', all(w in d for w in ('임시 저장',)), str(len(d)))
ok('④ VERSION v10.745 이상', VT >= (10, 745), VER)
done()
