"""v10.190 시험 — 머리줄 전체 폭 · 메뉴 겹침 고침(docs/297)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e SITE=http://localhost:15174 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1190.py

  ① 코드 — 로고 40px · .sh-in 최대 폭 없음 · .sh-nav 어느 폭에서나 옆으로 밂 · 시안 · docs/297 · v10.190
  ② (화면 · 다국어 켜짐) 로그아웃 · 회원 · 운영 계정 × 1920 ~ 390px — 메뉴가 오른쪽 단추 묶음과 겹치지 않음 · 페이지 가로 넘침 없음 ·
     1920px 머리줄 전체 폭 · 1280px 이상은 메뉴가 다 보임 · 끝나면 다국어 설정 되돌림
"""
import json, os, re, subprocess, sys, time, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); SITE = os.environ.get('SITE'); DB = os.environ.get('DB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
HC = rd('site/src/styles/site-head.css'); PR = rd('spec/proto.html')
ok('① 머리줄 — .sh-in 최대 폭 없음(전체 폭) · .sh-nav 어느 폭에서나 넘치면 옆으로 밂',
   '.sh-in { max-width: none; margin: 0 auto; padding: 0 28px;' in HC and 'max-width: 1248px' not in HC
   and '\n.sh-nav { overflow-x: auto; scrollbar-width: none; }' in HC, '')
ok('① 로그인 1440px 아래 — 파트너센터 메뉴 줄 끝(.sh-hd.in)', "className={`sh-hd${st.in ? ' in' : ''}`}" in rd('site/src/components/common/UniHeader.tsx')
   and '@media (max-width: 1440px) {\n  .sh-hd.in .sh-txt { display: none; }\n  .sh-hd.in .sh-nav .m-only { display: inline; }' in HC, '')
ok('① 로고 높이 40px(사이트 · 시안)', '<Pic name="logo" h={40}' in rd('site/src/components/common/UniHeader.tsx') and 'mxPic("logo",40,' in PR, '')
ok('① 시안 — 로그인 메뉴 줄 끝 파트너센터 · 1440px 아래', "'<a href=\"#\" class=\"m-only\" data-go=\"p2dsh\">파트너센터</a>'" in PR
   and '.sh-uni.in .home-hdr .home-txt { display: none; } .sh-uni.in .gnb .m-only { display: inline; }' in PR and "home-hd sh-uni'+(inn ? ' in' : '')" in PR, '')
ok('① 시안 — 공통 머리줄 전체 폭 · 메뉴 옆으로 밂', '.sh-uni > .home-in { max-width: none; }' in PR
   and '.sh-uni .gnb { min-width: 0; overflow-x: auto; scrollbar-width: none; }' in PR, '')
ok('① 문서 · 판 — docs/297 · v10.190 이상', any(f.startswith('297_') for f in os.listdir(os.path.join(K, 'docs')))
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 190), rd('VERSION').strip())


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-c', sql], capture_output=True, text=True)
    return r.stdout.strip()


def login(email):
    rq = urllib.request.Request(API.rstrip('/') + '/auth/login', data=json.dumps({'email': email, 'password': PW}).encode(),
                                headers={'content-type': 'application/json'}, method='POST')
    return json.load(urllib.request.urlopen(rq, timeout=60)).get('accessToken', '')


HD = """() => {
  const h = document.querySelector('header[data-uni-header]'); if (!h) return null;
  const R = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
  const nav = h.querySelector('.sh-nav'), hdr = h.querySelector('.sh-hdr'), logo = h.querySelector('.sh-logo');
  const n = R(nav), d = R(hdr), g = R(logo);
  const cross = (a, b) => !!(a && b && a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1);
  return { navHdr: cross(n, d), navLogo: cross(n, g), full: nav ? nav.scrollWidth <= nav.clientWidth + 1 : false,
           inW: Math.round(h.querySelector('.sh-in').getBoundingClientRect().width), vw: innerWidth,
           ox: document.documentElement.scrollWidth > innerWidth + 1, lang: !!h.querySelector('select'),
           admin: !!h.querySelector('a[href="/go/admin"]'), out: !!h.querySelector('a[href="/login"]') };
}"""

# ── ② 화면 ────────────────────────────────────────────────────────────
if SITE and API and DB:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import consent_ok
    before = psql("SELECT (SELECT value FROM site_settings WHERE key='i18n.enabled') || ',' || (SELECT is_active FROM i18n_langs WHERE code='en')")
    try:
        psql("UPDATE site_settings SET value='on' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active=true WHERE code='en';")
        # 사용자 웹의 언어 목록 캐시(60초) — 로그아웃 화면은 캐시가 비워질 때까지 기다림(로그인은 새 토큰이라 새로 읽음)
        time.sleep(65)
        psql('DELETE FROM auth_throttle')
        toks = {}
        for who, email in (('회원', 'buyer@x.com'), ('운영', 'admin@x.com')):
            consent_ok.agree(email, PW)
            toks[who] = login(email)
        WIDTHS = (1920, 1600, 1440, 1280, 1100, 900, 390)
        bad, info, seen = [], [], {}
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            b = p.chromium.launch()
            for who in ('로그아웃', '회원', '운영'):
                for w in WIDTHS:
                    cx = b.new_context(viewport={'width': w, 'height': 900})
                    if who != '로그아웃':
                        cx.add_cookies([{'name': 'sgb_at', 'value': toks[who], 'url': SITE}])
                    for u in ('/', '/money'):
                        pg = cx.new_page(); pg.goto(SITE + u, wait_until='networkidle', timeout=120000); pg.wait_for_timeout(300)
                        r = pg.evaluate(HD); pg.close()
                        if r is None:
                            bad.append(f'{who} {w} {u} 머리줄 없음'); continue
                        seen.setdefault(who, set()).add((r['lang'], r['admin'], r['out']))
                        if r['navHdr'] or r['navLogo'] or r['ox']:
                            bad.append(f'{who} {w} {u} {r}')
                        if w >= 1280 and not r['full']:
                            bad.append(f'{who} {w} {u} 메뉴 다 안 보임')
                        if w == 1920 and u == '/':
                            info.append(f'{who} 1920 안쪽 {r["inW"]}')
                        if w == 1920 and r['inW'] < w - 60:
                            bad.append(f'{who} 1920 {u} 전체 폭 아님 {r["inW"]}')
                    cx.close()
            b.close()
        state = {k: sorted(v) for k, v in seen.items()}
        good_state = all(any(x[0] for x in seen.get(k, ())) for k in ('로그아웃', '회원', '운영')) \
            and any(x[1] for x in seen.get('운영', ())) and any(x[2] for x in seen.get('로그아웃', ()))
        ok('② 다국어 켜짐 — 세 상태 모두 언어 칸 · 운영 계정은 관리자 페이지 단추 · 로그아웃은 로그인 단추', good_state, str(state))
        ok(f'② 메뉴 겹침 없음 · 가로 넘침 없음 · 1280px 이상 메뉴 다 보임 · 1920px 전체 폭 — 3상태 × {len(WIDTHS)}폭 × 2화면',
           not bad, f'{bad[:3]} · {info}')
    finally:
        en_on, en_act = (before.split(',') + ['off', 'f'])[:2]
        psql(f"UPDATE site_settings SET value='{en_on or 'off'}' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active={'true' if en_act == 't' else 'false'} WHERE code='en';")
    ok('끝 — 다국어 설정 되돌림', psql("SELECT (SELECT value FROM site_settings WHERE key='i18n.enabled') || ',' || (SELECT is_active FROM i18n_langs WHERE code='en')") == before, before)
else:
    print('  (SITE · API · DB 없음 — ② 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
