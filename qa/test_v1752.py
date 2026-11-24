"""v10.752 (docs/860) 운영자 게시판에서 페이지 목록 바로 열기
  ① (코드) OpsBoard onGo · PAGES 글 단추 · App 넘김
  ④ 문서 860 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

OB, APP = rd('web/src/app/admin/OpsBoard.tsx'), rd('web/src/App.tsx')
ok('① 화면', "open.kind === 'PAGES' && onGo" in OB and 'data-ops-board-go-pages' in OB and "<OpsBoard onGo={visible('site-pages') ? go : undefined} />" in APP, '')

d = doc('860_')
ok('④ 문서 860', all(w in d for w in ('페이지 목록',)), str(len(d)))
ok('④ VERSION v10.752 이상', VT >= (10, 752), VER)
done()
