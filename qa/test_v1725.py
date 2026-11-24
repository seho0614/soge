"""v10.725 (docs/833) 게시 요청 텔레그램 · 메일 — 준비됐을 때만 · 못 보내도 요청은 그대로
  ① (코드) tell(텔레그램 · SUPER 메일 5) · 결과 칸
  ④ 문서 833 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SV = rd('src/modules/site/publish-requests.service.ts')
ok('① 서버 — 텔레그램 · 메일 준비됐을 때 · SUPER · 결과', 'private async tell(text: string)' in SV and 'this.telegram.send(text)' in SV and 'await this.mail.ready()' in SV and "r.role = 'SUPER'" in SV and '...sent' in SV, '')

d = doc('833_')
ok('④ 문서 833', all(w in d for w in ('텔레그램', '메일')), str(len(d)))
ok('④ VERSION v10.725 이상', VT >= (10, 725), VER)
done()
