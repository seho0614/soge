"""v10.764 (docs/872) 번역판 「다시 번역 필요」
  ① koSig · staleLangs · 번역 때 지문 · 목록 · 화면
  ④ 문서 872 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SV, SPg = rd('src/modules/site/site-layouts.service.ts'), rd('web/src/app/admin/SitePages.tsx')
ok('① 서버 · 화면', 'export function koSig(' in SV and 'export function staleLangs(' in SV and 'i18nSig: { ...(l.i18nSig ?? {}), [lang]: koSig(k, l) }' in SV and 'staleLangs: staleLangs(k, draft)' in SV
   and 'data-lay-lang-stale' in SPg and '<option value="stale">다시 번역 필요</option>' in SPg, '')

d = doc('872_')
ok('④ 문서 872', all(w in d for w in ('다시 번역',)), str(len(d)))
ok('④ VERSION v10.764 이상', VT >= (10, 764), VER)
done()
