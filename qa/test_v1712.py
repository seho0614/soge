"""v10.712 (docs/820) 꾸밀 페이지 게시 전 점검 — 알려 주기만(게시는 막지 않음)
  ① (코드) checkLayout — 모든 구역 숨김 · 적게 보임 · 안내 장 모두 숨김 · 그림 주소 · 긴 글 · 숨긴 구역 뒤 블록 · 블록 점검(관 페이지 checkPage) · 언어 글자 빠짐 · 화면 칸 · 게시 확인 창 수
  ④ 문서 820 · 판
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SP = rd('web/src/app/admin/SitePages.tsx')
ok('① 점검 규칙 — 구역 · 안내 장 · 그림 주소 · 긴 글 · 숨긴 구역 뒤 블록 · 블록(checkPage) · 언어 빠짐',
   'export function checkLayout(' in SP and all(w in SP for w in ('모든 구역을 숨겼습니다', '안내 장을 모두 숨겼습니다', '그림 주소는 /… 또는 https://… 여야 합니다.', '휴대폰에서 두 줄 넘게',
                                                               '숨긴 구역 뒤 블록', "checkPage('-', blocks, 'lay')", '칸에 없습니다')), '')
ok('① 화면 — 「게시 전 점검」 칸 · 게시 확인 창에 고칠 것 수 · 게시는 막지 않음', 'data-site-layout-check={warnN}' in SP and '게시 전 점검: 고칠 것 ${warnN}개' in SP and '게시는 막지 않음' in SP, '')
d = doc('820_')
ok('④ 문서 820 — 게시 전 점검 · 막지 않음', all(w in d for w in ('게시 전 점검', '막지 않', '고칠 것')), str(len(d)))
ok('④ VERSION v10.712 이상', VT >= (10, 712), VER)
done()
