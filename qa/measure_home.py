"""메인(/) 배치를 주신 그림과 대조 — 1280px 에서 각 구역이 그림(838px 를 1280px 로 환산)과 같은 자리에 있는지. 결과: measure_home.json

그림: sgb/spec/design/hero_page_20261002.png (838×1877). 아래 표의 위 · 아래 값은 그림에서 읽은 자리(838 기준)입니다.
허용: 시작 위치 ±12px · 높이 ±12px (1280 환산). 글자를 그림이 아니라 화면 글자로 다시 넣었으므로 1 ~ 2px 단위까지 맞추지는 않습니다.
푸터는 대조하지 않습니다 — 그림에 없는 법정 표시 · 바로가기 · 「예시」 안내를 더 넣어 길이가 다릅니다.

사용:  SITE=http://localhost:5174 python3 measure_home.py
"""
import json, os, sys
from playwright.sync_api import sync_playwright
SITE = os.environ.get('SITE', 'http://localhost:5174').rstrip('/'); TOL = int(os.environ.get('TOL', '12'))
S = 1280 / 838
L = [('헤더', '.home-hd', 0, 43), ('히어로 제목', '#home-h1', 100, 172), ('히어로 설명', '.home-lead', 180, 222), ('검색 탭', '.home-stabs', 236, 272),
     ('검색창', '.home-sb', 272, 332), ('추천 칩', '.home-chips', 338, 372), ('안내 카드', '.home-promo', 86, 312),
     ('오늘의 소개뱅크 제목', '.home-band.today .home-sh', 402, 428), ('큰 배너', '.home-bn', 435, 641), ('순위 카드 1', '.home-rk:nth-of-type(1)', 433, 497), ('순위 카드 3', '.home-rk:nth-of-type(3)', 578, 642),
     ('어떤 소개 제목', '.home-band.needs .home-sh', 667, 693), ('어떤 소개 카드', '.home-nd', 701, 821),
     ('오늘의 PICK 제목', '.home-band.picks .home-sh', 842, 868), ('PICK 카드', '.home-pk', 876, 1059), ('PICK 사진', '.home-pk img', 880, 969),
     ('이건 어때? 제목', '.home-band.poll .home-sh', 1083, 1111), ('이건 어때? 카드', '.home-pl', 1121, 1301),
     ('띠배너', '.home-strip', 1314, 1386),
     ('지금 우리동네 제목', '.home-band.town .home-sh', 1398, 1424), ('우리동네 카드', '.home-tw', 1430, 1516),
     ('안심소개 제목', '.home-band.trust .home-sh', 1530, 1556), ('안심소개 카드', '.home-tr', 1559, 1627),
     ('최근 뜨는 창업 제목', '.home-band.startup .home-sh', 1640, 1666), ('창업 카드', '.home-st', 1668, 1747), ('창업 사진', '.home-st img', 1672, 1715),
     ('나를 위한 소개', '.home-forme', 1752, 1795), ('소개뱅크 핵심', '.home-core', 1803, 1847)]
R = []
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 900}); pg.goto(SITE + '/', wait_until='networkidle')
    for n, sel, a, c in L:
        r = pg.evaluate("(s)=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return [r.top+scrollY,r.bottom+scrollY]}", sel)
        if not r:
            R.append({'step': f'{n} — 화면에 없음', 'ok': False, 'detail': sel}); continue
        dt, dh = round(r[0] - a * S), round((r[1] - r[0]) - (c - a) * S)
        ok = abs(dt) <= TOL and abs(dh) <= TOL
        R.append({'step': f'{n} — 그림 {round(a * S)}–{round(c * S)} · 화면 {round(r[0])}–{round(r[1])}', 'ok': ok, 'detail': f'시작 {dt:+d}px · 높이 {dh:+d}px'})
        print('ok  ' if ok else 'FAIL', R[-1]['step'], R[-1]['detail'], file=sys.stderr)
    b.close()
json.dump(R, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'measure_home.json'), 'w'), ensure_ascii=False, indent=1)
print(f"통과 {sum(r['ok'] for r in R)} / {len(R)} (허용 ±{TOL}px)")
