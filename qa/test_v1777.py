"""v10.777 (docs/885) 매물 가격 거르기
  ① (코드) DTO priceMin · priceMax · filters 정수 확인 · 블록 priceMax · 화면 · 사용자 웹
  ③ (API) priceMax=1 이면 금액 큰 매물 없음
  ④ 문서 885 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

DT, RP, GS, GP, GB = rd('src/modules/listing/listing.dto.ts'), rd('src/modules/listing/listing.repository.ts'), rd('src/modules/site/gwan-pages.service.ts'), rd('web/src/app/admin/gwans/GwanPages.tsx'), rd('site/src/components/gwan/GwanBlocks.tsx')
ok('① 서버 · 화면 · 사용자 웹', 'priceMax?: number;' in DT and 'Number.isSafeInteger(v)' in RP and "AND l.deal_amount <= ${pmax}" in RP and '...(pmax ? { priceMax: pmax } : {})' in GS
   and 'data-block-listings-pricemax' in GP and "qs.set('priceMax'" in GB and '받지 않아 넣지 않았습니다' not in GP, '')
if up():
    r = call('GET', '/listings?priceMax=1&limit=50')
    rows = r.get('organic', []) if isinstance(r, dict) else []
    ok('③ priceMax=1 — 금액 큰 매물 없음', isinstance(r, dict) and '_err' not in r and all((x.get('dealAmount') is not None and float(x['dealAmount']) <= 1) for x in rows), f"{len(rows)} {r.get('_err') if isinstance(r, dict) else ''}")

d = doc('885_')
ok('④ 문서 885', all(w in d for w in ('priceMax',)), str(len(d)))
ok('④ VERSION v10.777 이상', VT >= (10, 777), VER)
done()
