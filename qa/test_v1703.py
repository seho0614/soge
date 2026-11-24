"""v10.703 (docs/811) 초안 ↔ 게시 판 차이 보기 · 운영 화면 안 미리보기
  ① (코드) layoutDiff(구역 순서 · 숨김 · 글자 · 안내 장 · 고른 상품 · 블록 자리) · 차이 칸 · 게시 확인 창에 바뀌는 것 · 옆에서 보기(PC · 휴대폰 375 · 저장하면 다시 그림) · 사용자 웹 미리보기만 운영 화면 안에 끼워 보임
  ③ (화면 머리글) 미리보기 링크(?lp=40자)면 frame-ancestors 에 운영 화면 주소 · 링크가 없으면 'self' 만(그대로)
  ④ 문서 811 · 판
"""
import os, sys, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SP, NC = rd('web/src/app/admin/SitePages.tsx'), rd('site/next.config.js')
ok('① 차이 보기 — 구역 순서 · 숨김 · 글자 · 안내 장 · 고른 상품 · 블록 자리 · 게시 확인 창 · 처음 배치와 견줌',
   'export function layoutDiff(' in SP and all(w in SP for w in ('구역 순서:', "'보이기' : '숨기기'", '안내 장 「', '블록 자리 「', 'data-site-layout-diff', '바뀌는 것:\\n', "d.published ?? base0 ?? l")), '')
ok('① 옆에서 보기 — PC · 휴대폰 375 · 미리보기 링크 iframe · 저장하면 다시 그림',
   all(w in SP for w in ('data-site-layout-frame-pc', 'data-site-layout-frame-mobile', '<iframe key={frame.tick}', 'width: frame.mobile ? 375 : 1280', 'tick: f.tick + 1')), '')
ok('① 사용자 웹 머리글 — ?lp=40자 일 때만 운영 화면 주소 허용 · 그 밖은 frame-ancestors \'self\' 그대로',
   "has: [{ type: 'query', key: 'lp', value: '(?<lp>[0-9a-f]{40})' }]" in NC and "process.env.ADMIN_ORIGIN || 'https://admin.sogaebank.com'" in NC
   and NC.count("{ key: 'Content-Security-Policy', value: \"frame-ancestors 'self'\" }") == 1, '')


def head(path):
    try:
        r = urllib.request.urlopen(urllib.request.Request(SITE + path, headers={'User-Agent': 'sgb-qa'}), timeout=120)
        return r.headers.get_all('Content-Security-Policy') or []
    except Exception as e:
        return [f'! {e}']


if up() and SITE:
    try:
        import consent_ok
        consent_ok.agree('admin@x.com', PW)
        TS = login('admin@x.com')
        tok = call('POST', '/admin/site-layouts/HOME/previews', {'hours': 1}, TS).get('token', '')
        a, b = head('/'), head(f'/?lp={tok}')
        ok("③ 머리글 — 보통은 frame-ancestors 'self' 만 · 미리보기는 운영 화면 주소도", any(x.strip() == "frame-ancestors 'self'" for x in a)
           and any(x.startswith("frame-ancestors 'self' http") for x in b) and not any(x.startswith("frame-ancestors 'self' http") for x in a), f'{a} · {b}')
    finally:
        psql("UPDATE site_layout_previews SET revoked_at = now() WHERE key = 'HOME' AND revoked_at IS NULL")
else:
    print('API · DB · 사용자 웹 없음 — ③ 건너뜀')

d = doc('811_')
ok('④ 문서 811 — 차이 · 옆에서 보기 · 휴대폰 · 머리글', all(w in d for w in ('차이', '옆에서 보기', '휴대폰', 'frame-ancestors')), str(len(d)))
ok('④ VERSION v10.703 이상', VT >= (10, 703), VER)
done()
