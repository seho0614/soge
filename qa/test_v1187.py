"""v10.187 시험 — 메인 머리줄 「파트너센터」 글자 링크(대표 「B안으로」 · docs/293 · 마이그레이션 없음)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 -e SITE=http://localhost:15174 sgb-qa:v1 python3 test_v1187.py

  ① 코드 — 검색 단추 다음 · 로그인 앞 · /partners · 사전 header.partners · 휴대폰 비로그인 숨김(.pc-only) · 시안 같은 자리 · docs/293 · 판
  ② (사용자 웹) PC 비로그인 보임 · 로그인 단추 앞 · 누르면 /partners 길 · 휴대폰 비로그인 숨김(머리줄 높이 그대로) · 휴대폰 로그인 보임
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


FR = rd('site/src/components/home/Frame.tsx'); CSS = rd('site/src/styles/home.css'); PROTO = rd('spec/proto.html')
i_s = FR.find('href="#home-q"'); i_p = FR.find('href="/partners" data-home-partners'); i_l = FR.find('href="/login"')
ko = json.loads(rd('site/src/i18n/messages/ko.json') or '{}'); en = json.loads(rd('site/src/i18n/messages/en.json') or '{}')
ok('① 메인 머리줄 — 검색 다음 · 로그인 앞 · /partners · 사전 · 휴대폰 비로그인 숨김',
   0 < i_s < i_p < i_l and "h('partners')" in FR and "loggedIn ? '' : ' pc-only'" in FR
   and ko.get('header', {}).get('partners') == '파트너센터' and en.get('header', {}).get('partners') == 'Partner Center'
   and '.home-hdr .home-txt.pc-only { display: none; }' in CSS and '.home-txt { font-size: 14px;' in CSS, f'{i_s} {i_p} {i_l}')
ok('① 시안 — 같은 자리(data-go="p2dsh") · 휴대폰 비로그인 숨김',
   'data-go="p2dsh">파트너센터</button>' in PROTO and '.home-hdr .home-txt.pc-only { display: none; }' in PROTO, '')
ok('① 문서 · 판 — docs/293 · v10.187 이상', any(f.startswith('293_') for f in os.listdir(os.path.join(K, 'docs')))
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 187), rd('VERSION').strip())

if SITE and API:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import consent_ok
    consent_ok.agree('buyer@x.com', 'sgb-dev-1234')
    req = urllib.request.Request(API.rstrip('/') + '/auth/login', data=json.dumps({'email': 'buyer@x.com', 'password': 'sgb-dev-1234'}).encode(),
                                 headers={'content-type': 'application/json'}, method='POST')
    TOK = json.load(urllib.request.urlopen(req, timeout=60)).get('accessToken', '')
    from playwright.sync_api import sync_playwright
    PROBE = """() => { const a = document.querySelector('header [data-home-partners]'); const hd = document.querySelector('header[data-uni-header], .home-hd');   /* v10.188 — 공통 머리줄 */
      if (!a) return null; const r = a.getBoundingClientRect(); const lg = [...document.querySelectorAll('.sh-hdr a, .home-hdr a')].find(x => x.getAttribute('href') === '/login');
      return { vis: getComputedStyle(a).display !== 'none' && r.width > 0, href: a.getAttribute('href'), before: lg ? !!(a.compareDocumentPosition(lg) & 4) : null,
               text: a.textContent.trim(), hdH: Math.round(hd.getBoundingClientRect().height) } }"""
    with sync_playwright() as p:
        b = p.chromium.launch()

        def look(w, mob, tok):
            c = b.new_context(viewport={'width': w, 'height': 900}, is_mobile=mob, has_touch=mob)
            if tok: c.add_cookies([{'name': 'sgb_at', 'value': tok, 'url': SITE}])
            pg = c.new_page(); pg.goto(SITE + '/', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(500)
            r = pg.evaluate(PROBE)
            nav = None
            if r and r['vis'] and not mob and not tok:
                pg.click('header [data-home-partners]'); pg.wait_for_timeout(1500); nav = pg.url.replace(SITE, '')
            c.close(); return r, nav
        pc, nav = look(1280, False, '')
        ok('② PC 비로그인 — 보임 · 「파트너센터」 · 로그인 단추 앞 · 누르면 /partners 길(로그인 화면으로 넘어가도 됨)',
           pc and pc['vis'] and pc['text'] == '파트너센터' and pc['before'] is True and pc['href'] == '/partners' and nav and ('/partners' in nav or '/login' in nav),
           f'{pc} · {nav}')
        m0, _ = look(390, True, '')
        ok('② 휴대폰 비로그인 — 숨김 · 머리줄 두 줄 높이(100px 미만)', m0 and not m0['vis'] and m0['hdH'] < 100, str(m0))
        m1, _ = look(390, True, TOK)
        ok('② 휴대폰 로그인 — 보임', m1 and m1['vis'], str(m1))
        b.close()
else:
    print('  (SITE · API 없음 — ② 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
