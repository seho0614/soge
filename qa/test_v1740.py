"""v10.740 (docs/848) 점검 끝난 뒤 자동 화면 확인 — 다시 연 관 첫 화면 200 이면 INFO · 아니면 WARN
  ① (코드) siteCheck · SITE_INTERNAL_URL · 관 주소 표 · 다시 연 관만
  ④ 문서 848 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

MS = rd('src/modules/site/gwan-maint.service.ts')
ok('① 화면 확인 — 다시 연 관만 · 15초 · 200 · WARN', 'private async siteCheck(id: number, code: string)' in MS and 'SITE_INTERNAL_URL' in MS and "'GWAN_MAINT_SITE_FAIL'" in MS and 'if (m.was_open) await this.siteCheck(m.id, m.gwan_code)' in MS, '')

d = doc('848_')
ok('④ 문서 848', all(w in d for w in ('화면 확인', '200')), str(len(d)))
ok('④ VERSION v10.740 이상', VT >= (10, 740), VER)
done()
