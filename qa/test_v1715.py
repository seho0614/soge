"""v10.715 (docs/823) 블록 기간 보이기 — from · until(한국 날짜 · 끝 날 포함) · 사용자 웹이 그 기간에만
  ① (코드) 서버 withPeriod(모양 · 순서) · 사용자 웹 inPeriod · 운영 화면 보이는 기간 칸
  ③ (API) 관 페이지 블록 기간 모양 400 · 끝이 앞 422 · 정상 저장(MNY 잠깐 닫음 · 늘 혼자)
  ④ 문서 823 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

GS, GB, GP = rd('src/modules/site/gwan-pages.service.ts'), rd('site/src/components/gwan/GwanBlocks.tsx'), rd('web/src/app/admin/gwans/GwanPages.tsx')
ok('① 서버 · 사용자 웹 · 운영 화면 — 기간 검사 · 기간 밖 안 그림 · 날짜 칸', 'function withPeriod(' in GS and '보이는 기간의 끝이 시작보다 앞입니다' in GS and 'if (!inPeriod(b, today)) return null;' in GB and 'data-block-period' in GP, '')
if up():
    slug = 't1715' + time.strftime('%H%M%S')
    try:
        import consent_ok
        consent_ok.agree('admin@x.com', PW)
        TS = login('admin@x.com')
        psql("UPDATE gwans SET is_active = false WHERE code = 'MNY'")
        pg = call('POST', '/admin/gwans/MNY/pages', {'slug': slug, 'title': '시험 1715'}, TS)
        b1 = call('PATCH', f"/admin/gwan-pages/{pg.get('id')}", {'blocks': [{'type': 'TEXT', 'body': 'x', 'from': '2026/1/1'}]}, TS)
        b2 = call('PATCH', f"/admin/gwan-pages/{pg.get('id')}", {'blocks': [{'type': 'TEXT', 'body': 'x', 'from': '2026-12-31', 'until': '2026-01-01'}]}, TS)
        b3 = call('PATCH', f"/admin/gwan-pages/{pg.get('id')}", {'blocks': [{'type': 'TEXT', 'body': 'x', 'from': '2026-01-01', 'until': '2099-12-31'}]}, TS)
        ok('③ 기간 — 모양 틀림 422 · 끝이 앞 422 · 정상 저장(from · until 그대로)', b1.get('_err') == 422 and b2.get('_err') == 422 and (b3.get('blocks') or [{}])[0].get('until') == '2099-12-31', f"{b1.get('_err')} {b2.get('_err')} {(b3.get('blocks') or [{}])[0]}")
    finally:
        psql("UPDATE gwans SET is_active = true WHERE code = 'MNY' AND NOT is_active")
        psql(f"DELETE FROM gwan_pages WHERE gwan_code = 'MNY' AND slug = '{slug}'")

d = doc('823_')
ok('④ 문서 823', all(w in d for w in ('기간', '한국 날짜')), str(len(d)))
ok('④ VERSION v10.715 이상', VT >= (10, 715), VER)
done()
