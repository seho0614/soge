"""v10.185 시험 — 파트너센터 · 소개창업 · 고객센터 · 나의공간 나머지 디자인 검토 반영(docs/290 · 마이그레이션 없음) + 손님 화면 내부 표기 자동 점검

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 -e SITE=http://localhost:15174 sgb-qa:v1 python3 test_v1185.py

  ① 코드 — 제휴 메뉴 밝은 글자 · 설명 글 링크색 아님 · 보라 → 남색 · 소개창업 주황 위 남색 · 소개장터 검색 단추 남색 · 고른 탭 남색 글자 · 고정폭 없음 · 대비 · 시안 · docs/290 · 판
  ② (사용자 웹) 제휴 메뉴 글자 밝음 · 칸 설명 회색 · 소개장터 검색 단추 남색 · 소개창업 검색 글자 남색
  ③ (사용자 웹) 손님 · 구매자 · 파트너로 주요 화면을 돌며 보이는 글에 내부 화면 번호(SB-XXX-XXX-000) 없음
"""
import json, os, re, sys, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); SITE = os.environ.get('SITE')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


ST = 'site/src/styles/'
PTS = rd(ST + 'partners.css'); GW = rd(ST + 'proto-gwan.css'); MNY = rd(ST + 'money.css'); MY = rd(ST + 'proto-my.css')
PT = rd(ST + 'proto-partner.css'); W1 = rd(ST + 'proto-w1.css'); PROTO = rd('spec/proto.html')

ok('① 제휴 파트너센터 — 남색 메뉴 밝은 글자 · 설명 글이 링크색 아님 · 고른 탭 보라 아님',
   'color: #C3CCE3; font-size: 14px;' in PTS and '.p2brand .bs { font-size: 12px; color: #93A2C2;' in PTS
   and 'sgb-link-d' not in PTS and '.p2kpi .k { font-size: 12px; color: var(--sgb-ink-3);' in PTS and '#7C3AED' not in PTS,
   f"link-d {PTS.count('sgb-link-d')}")

ok('① 분쟁 접수 고르기 — 보라 → 시트 주요 단추',
   '.my-opts.my-opts-fill .my-opt.on { background: var(--sgb-btn-bg, #00245a);' in MY and '#7C3AED' not in MY, '')

ok('① 소개창업 주황 위 남색 글자 · 소개장터 검색 단추 남색 · 고른 탭 남색 글자',
   '.gw-gwl:not(.gw-mal):not(.gw-biz) .gw-fgo{background:var(--sgb-btn-bg, #00245a);color:var(--sgb-btn-fg, #fff)}' in GW
   and '.gw-gwl.gw-biz .gw-fgo,.gw-gwl.gw-biz .gw-cathd' in GW and '.gw-gwl.gw-biz .gw-mylist{color:#c2410c}' in GW
   and '.mny-tab[aria-selected=true] { border-color: var(--sgb-action); background: var(--sgb-action); color: var(--sgb-navy, #00245a); }' in MNY, '')

ok('① 고정폭 글꼴 없음 — 서비스 번호 · 목록 건수 · 챗봇 표 · 중개 번호',
   not re.search(r'\.(pt-code|gw-did|gw-brkno2|gw-code|w1-did)\s*\{[^}]*ui-monospace', PT + GW + W1) and '.pt-code { font-family: var(--sgb-font-body);' in PT,
   str(re.findall(r'\.(pt-code|gw-did|gw-brkno2|gw-code|w1-did)\s*\{[^}]*ui-monospace', PT + GW + W1)))

ok('① 대비 — 단계 번호 · 진한 링크색 · 어두운 칸 글자',
   'color: var(--sgb-ink-2, #4B5563); display: grid; place-items: center;' in PT
   and '.gw-rcall .gw-rck,.gw-rcall .gw-rcn,.gw-ru .gw-rn2{color:var(--bl-d)}' in GW and '.gw-c3a span{color:#93A2C2}' in GW, '')

ok('① 시안 — 같은 기준으로 고침',
   '.gwl:not(.mal):not(.biz) .fgo{background:var(--sgb-btn-bg, #00245a)' in PROTO and '.gwl.biz .mylist{color:#c2410c}' in PROTO
   and '.did{font:600 12px/1 ui-monospace' not in PROTO and '.brkno2{font-family:ui-monospace' not in PROTO
   and '.mny-tab[aria-selected=true] { border-color: var(--sgb-action); background: var(--sgb-action); color: var(--sgb-navy, #00245a); }' in PROTO, '')

ok('① 문서 · 판 — docs/290 · v10.185 이상', any(f.startswith('290_') for f in os.listdir(os.path.join(K, 'docs')))
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 185), rd('VERSION').strip())

# ③ 손님에게 보이는 내부 화면 번호 — 화면 번호는 data-screen · 명세 · 시험에만 둡니다(v10.184 에서 나의공간 5화면에 보이던 것을 사람 눈으로 찾음)
CODE = re.compile(r'\bSB-[A-Z]{2,4}-[A-Z0-9]{2,4}-\d{2,3}\b')
ANON = ['/', '/login', '/signup', '/money', '/money/list', '/biz', '/mall', '/community', '/community/polls', '/guide', '/safety/guide', '/support']
BUYER = ['/my', '/my/account', '/my/account/security', '/my/account/privacy', '/my/account/data', '/my/account/withdraw', '/my/listings', '/my/likes',
         '/my/deals', '/my/contracts', '/my/notifications', '/my/subscription', '/my/settlement', '/my/reports', '/my/events', '/my/intro',
         '/my/health/orders', '/my/inquiries', '/my/payment', '/my/broker', '/support/new', '/support/history', '/community/write']
INTRO = ['/partner', '/partner/leads', '/partner/services', '/partner/pricing', '/partner/cash', '/partner/settlement', '/partner/stats', '/partner/trust',
         '/partner/reviews', '/partner/business', '/partners', '/partners/links', '/partners/orders', '/partners/revenues', '/partners/settlements']

if SITE and API:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import consent_ok

    def token(email):
        consent_ok.agree(email, 'sgb-dev-1234')
        req = urllib.request.Request(API.rstrip('/') + '/auth/login', data=json.dumps({'email': email, 'password': 'sgb-dev-1234'}).encode(),
                                     headers={'content-type': 'application/json'}, method='POST')
        return json.load(urllib.request.urlopen(req, timeout=60)).get('accessToken', '')

    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()

        def ctx(tok):
            c = b.new_context(viewport={'width': 1280, 'height': 900})
            if tok: c.add_cookies([{'name': 'sgb_at', 'value': tok, 'url': SITE}])
            return c
        CA, CB, CI = ctx(''), ctx(token('buyer@x.com')), ctx(token('intro@x.com'))

        def css(c, url, js):
            pg = c.new_page(); pg.goto(SITE + url, wait_until='networkidle', timeout=120000); pg.wait_for_timeout(600)
            r = pg.evaluate(js); pg.close(); return r
        r = css(CI, '/partners', """() => { const m = document.querySelector('.p2menu a:not(.on)'); const k = document.querySelector('.p2kpi .k');
          return [m ? getComputedStyle(m).color : null, k ? getComputedStyle(k).color : null] }""")
        ok('② 제휴 파트너센터 — 메뉴 글자 밝음(#C3CCE3) · 칸 이름 흐린 회색(#646f8c)', r == ['rgb(195, 204, 227)', 'rgb(100, 111, 140)'], str(r))
        r = css(CB, '/money', "() => { const e = document.querySelector('.gw-fgo'); return e ? [getComputedStyle(e).backgroundColor, getComputedStyle(e).color] : null }")
        ok('② 소개장터 검색 단추 — 남색 바탕 · 흰 글자', r == ['rgb(0, 36, 90)', 'rgb(255, 255, 255)'], str(r))
        r = css(CB, '/biz', "() => { const e = document.querySelector('.gw-fgo'); return e ? getComputedStyle(e).color : null }")
        ok('② 소개창업 검색 단추 — 주황 위 남색 글자', r == 'rgb(0, 36, 90)', str(r))

        bad, seen, miss = [], 0, []
        for c, urls in ((CA, ANON), (CB, BUYER), (CI, INTRO)):
            pg = c.new_page()
            for u in urls:
                try:
                    pg.goto(SITE + u, wait_until='networkidle', timeout=120000); pg.wait_for_timeout(300)
                    t = pg.locator('body').inner_text(); seen += 1
                    hits = sorted(set(CODE.findall(t)))
                    if hits: bad.append(f'{u} {hits[:3]}')
                except Exception as e:
                    miss.append(f'{u} {str(e)[:60]}')
            pg.close()
        ok(f'③ 손님에게 보이는 내부 화면 번호 없음 — {seen}화면(손님 {len(ANON)} · 구매자 {len(BUYER)} · 파트너 {len(INTRO)})',
           not bad and not miss and seen == len(ANON) + len(BUYER) + len(INTRO), str(bad[:5] + miss[:3]))
        b.close()
else:
    print('  (SITE · API 없음 — ② ③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
