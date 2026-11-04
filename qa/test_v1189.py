"""v10.189 시험 — 휴대폰 화면 검토 반영(대비 · 누름 영역) · 옛 머리줄 코드 지우기 · 메인 Hero 추천 칩 운영이 고르기(D172 · docs/296)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e SITE=http://localhost:15174 -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1189.py

  ① 코드 — D172(설정 home.hero_chips · 빈 값 · 형식 · 지우는 문장 없음 · 210) · heroPicks · place=hero · 메인 · 운영 화면 칸 · 옛 머리줄 파일 없음 · CSS 값 · 시안 · docs/296
  ② (화면) 색 — 안심소개 검색 단추 진한 초록(#047857) · 매물 상세 「전화하기」 남색 글자 · 휴대폰 로고 · Hero 카드 단추 누르는 자리 넓힘
  ③ (API · DB · 화면) 추천 칩 — 비어 있으면 auto · 고르면 pick(제한업종 낱말 든 말은 빠짐) · 형식 틀리면 저장 안 됨 · 메인에 1분 안에 · 운영 화면 칸 · 되돌림
"""
import json, os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); SITE = os.environ.get('SITE'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
S = 'site/src/'
mig = sorted(d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d)))
M = rd('prisma/migrations/D172_home_hero_chips/migration.sql')
ok('① D172 — 설정 home.hero_chips 빈 값 · ADMIN · 형식(쉼표 최대 4 · 2 ~ 20자) · 지우는 문장 없음 · 210 이상',
   "('home.hero_chips', '', 'ADMIN'," in M and "'^$|^[^,]{2,20}(,[^,]{2,20}){0,3}$'" in M and 'ON CONFLICT (key) DO NOTHING' in M
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|TRUNCATE|UPDATE)\b', M) and len(mig) >= 210 and 'D172_home_hero_chips' in mig, str(len(mig)))
SS = rd('src/modules/search/search.service.ts'); MS = rd('src/modules/market/market.service.ts'); MC = rd('src/modules/market/market.controller.ts')
PG = rd(S + 'app/page.tsx'); SD = rd('web/src/app/admin/ailearn/SearchDict.tsx')
ok('① 서버 · 메인 · 운영 화면 — heroPicks(제한업종 빼기) · place=hero(pick · auto) · 메인 1분 · 운영 화면 칸(검색 사전)',
   'async heroPicks()' in SS and "WHERE key = 'home.hero_chips'" in SS and 'restrict_vocab' in SS.split('async heroPicks()')[1][:900]
   and "place === 'hero' && !gwanCode" in MS and "source: 'pick'" in MS and "source: 'auto'" in MS and "@Query('place') place?: string" in MC
   and "'/search/keywords?limit=4&place=hero', 60" in PG and "hotKw?.source === 'pick' && hot.length" in PG
   and 'data-hero-chips=""' in SD and "key: 'home.hero_chips'" in SD and "method: 'PATCH'" in SD, '')
gone = [f for f in ('components/b2/AuthArea.tsx', 'components/b2/NavLink.tsx', 'components/home/HomeLogout.tsx', 'i18n/LangAuto.tsx') if os.path.exists(os.path.join(K, S + f))]
B2 = rd(S + 'components/b2/Frame.tsx'); HF = rd(S + 'components/home/Frame.tsx')
ok('① 옛 머리줄 지움 — AuthArea · NavLink · HomeLogout · LangAuto 파일 없음 · B2Header · HomeHeader 없음 · 바닥줄 · Logo 는 남음',
   not gone and 'export function B2Header' not in B2 and 'export function B2Footer' in B2 and 'export function HomeHeader' not in HF
   and 'export function HomeFooter' in HF and 'export function Logo' in HF, str(gone))
G = rd(S + 'styles/proto-gwan.css'); W1 = rd(S + 'styles/proto-w1.css'); SH = rd(S + 'styles/shop.css'); MY = rd(S + 'styles/proto-my.css')
HC = rd(S + 'styles/site-head.css'); HM = rd(S + 'styles/home.css'); PR = rd('spec/proto.html')
ok('① 색 · 누름 — 주황 위 남색(전화하기 · 노출 중 · 소개 제안하기 · !) · 안심소개 #047857 · 진한 빨강 · 탭 진한 링크색 · 로고 · 🔔 · Hero 단추 44px · 시안도',
   '.gw .gw-bcall,.gw a.gw-bcall,.gw-dtimg .gw-st2{color:var(--sgb-navy, #00245a)}' in G and '.gw-gwl.gw-mal{--gc:#047857}' in G
   and 'background:var(--card);color:var(--bl-d)}' in G and '.w1-bprop { color: var(--sgb-navy, #00245a) !important; }' in W1
   and '.w1-wrn .ic { color: var(--sgb-navy, #00245a); }' in W1 and '--shop-red: #b91c1c;' in SH and MY.count('background: #b91c1c;') == 2
   and '.sh-logo::after, .sh-bell::after' in HC and '.home-pnext::after' in HM
   and '.bcall{background:var(--or);color:var(--sgb-navy, #00245a);' in PR and '--shop-red: #b91c1c;' in PR, '')
ok('① 문서 · 판 — docs/296 · v10.189 이상', any(f.startswith('296_') for f in os.listdir(os.path.join(K, 'docs')))
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 189), rd('VERSION').strip())


def call(method, path, tok=None, body=None):
    hd = {'content-type': 'application/json'}
    if tok: hd['authorization'] = f'Bearer {tok}'
    r = urllib.request.Request(API + path, method=method, headers=hd, data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(r, timeout=120) as x:
            b = x.read(); s = x.status
    except urllib.error.HTTPError as e:
        b = e.read(); s = e.code
    try: return s, json.loads(b or b'{}')
    except Exception: return s, {}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip(), r.stderr.strip())


# ── ② 화면 색 · 누름 ──────────────────────────────────────────────────
if SITE:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        pc = b.new_context(viewport={'width': 1280, 'height': 900}); mo = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1)
        pg = pc.new_page(); pg.goto(SITE + '/mall', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(300)
        mall = pg.evaluate("() => { const e = document.querySelector('.gw-gwl.gw-mal .gw-fgo') || document.querySelector('.gw-gwl.gw-mal .sg'); return e ? getComputedStyle(e).backgroundColor : null; }")
        pg.close()
        ok('② 안심소개 검색 단추 — 진한 초록 #047857(흰 글자 5.5)', mall == 'rgb(4, 120, 87)', str(mall))
        pg = pc.new_page(); pg.goto(SITE + '/money/list', wait_until='networkidle', timeout=120000)
        href = pg.evaluate(r"() => { const a = [...document.querySelectorAll('a[href^=\"/money/\"]')].find((x) => /^\/money\/[0-9a-f-]{36}$/.test(x.getAttribute('href'))); return a ? a.getAttribute('href') : null; }")
        call_c = None
        if href:
            pg.goto(SITE + href, wait_until='networkidle', timeout=120000); pg.wait_for_timeout(300)
            call_c = pg.evaluate("() => { const e = document.querySelector('.gw-bcall'); const s = document.querySelector('.gw-dtimg .gw-st2'); return e ? [getComputedStyle(e).color, s ? getComputedStyle(s).color : null] : null; }")
        pg.close()
        ok('② 매물 상세 — 「전화하기」 · 「노출 중」 주황 위 남색 글자', bool(href) and call_c and call_c[0] == 'rgb(0, 36, 90)' and call_c[1] in (None, 'rgb(0, 36, 90)'), f'{href} · {call_c}')
        pg = mo.new_page(); pg.goto(SITE + '/', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(500)
        tap = pg.evaluate("""() => {
          const hit = (el, dx, dy) => { const r = el.getBoundingClientRect(); const x = r.left + r.width / 2 + dx, y = (dy < 0 ? r.top : r.bottom) + dy;
                                        const t = document.elementFromPoint(x, y); return !!(t && (t === el || el.contains(t))); };
          const lg = document.querySelector('.sh-logo'); const nx = document.querySelector('.home-pnext[data-promo="next"]');
          if (nx) nx.scrollIntoView({ block: 'center' });
          return { logoH: lg ? Math.round(lg.getBoundingClientRect().height) : 0, logoUp: lg ? hit(lg, 0, -5) : null, logoDown: lg ? hit(lg, 0, 5) : null,
                   next: nx ? [Math.round(nx.getBoundingClientRect().height), hit(nx, 0, -5), hit(nx, 0, 5)] : null };
        }""")
        pg.close(); b.close()
        ok('② 휴대폰 누름 — 로고 위아래 5px 도 로고 · Hero 「›」 위아래 5px 도 단추(보이는 크기 그대로)',
           tap.get('logoUp') and tap.get('logoDown') and (tap.get('next') is None or (tap['next'][0] <= 32 and tap['next'][1] and tap['next'][2])), str(tap))
else:
    print('  (SITE 없음 — ② 건너뜀)')

# ── ③ 추천 칩 ─────────────────────────────────────────────────────────
if API and DB:
    psql('DELETE FROM auth_throttle')
    TA = call('POST', '/auth/login', None, {'email': 'admin@x.com', 'password': PW})[1].get('accessToken')
    TB = call('POST', '/auth/login', None, {'email': 'buyer@x.com', 'password': PW})[1].get('accessToken')
    v0 = psql("SELECT value FROM site_settings WHERE key = 'home.hero_chips'")[0]
    blk = psql("SELECT term FROM restrict_vocab WHERE length(term) BETWEEN 2 AND 10 ORDER BY term LIMIT 1")[0] or \
        psql("SELECT name FROM restricted_industries WHERE is_active AND mode IN ('BLOCK','AD_ONLY') AND length(name) BETWEEN 2 AND 10 ORDER BY name LIMIT 1")[0]
    try:
        s0, j0 = call('GET', '/search/keywords?limit=4&place=hero')
        ok('③ 처음 — 설정 빈 값 · place=hero 는 인기 검색어(source auto)', v0 == '' and s0 == 200 and j0.get('source') == 'auto', f'{v0!r} · {s0} · {j0.get("source")}')
        bad1 = call('PATCH', '/admin/site-settings', TA, {'key': 'home.hero_chips', 'value': '가,나,다,라,마'})[0]
        bad2 = call('PATCH', '/admin/site-settings', TA, {'key': 'home.hero_chips', 'value': '시험칩A,시험칩B,시험칩C,시험칩D,시험칩E'})[0]
        mem = call('PATCH', '/admin/site-settings', TB, {'key': 'home.hero_chips', 'value': '시험칩A'})[0]
        ok('③ 형식 틀림(한 글자 · 5개) 저장 안 됨 · 회원은 못 바꿈', bad1 >= 400 and bad2 >= 400 and mem in (401, 403), f'{bad1} · {bad2} · {mem}')
        val = f'시험칩A,{blk}칩,시험칩B' if blk else '시험칩A,시험칩B'
        s1 = call('PATCH', '/admin/site-settings', TA, {'key': 'home.hero_chips', 'value': val})[0]
        s2, j2 = call('GET', '/search/keywords?limit=4&place=hero')
        terms = [x.get('term') for x in j2.get('items') or []]
        s3, j3 = call('GET', '/search/keywords?limit=4')
        ok('③ 고르면 pick — 고른 말(제한업종 낱말이 든 말은 빠짐) · place 없으면 그대로 auto',
           s1 == 200 and s2 == 200 and j2.get('source') == 'pick' and terms == ['시험칩A', '시험칩B'] and j3.get('source') == 'auto',
           f'{s1} · {blk!r} · {terms} · {j3.get("source")}')
        if SITE:
            import time
            time.sleep(65)   # 메인은 60초 캐시
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 900})
                pg.goto(SITE + '/', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(500)
                chips = pg.evaluate("() => [...document.querySelectorAll('.home-chip')].map((e) => e.textContent.trim())")
                b.close()
            ok('③ 메인 — 1분 안에 고른 칩(시험칩A · 시험칩B)', any('시험칩A' in c for c in chips) and any('시험칩B' in c for c in chips)
               and not any(blk and blk in c for c in chips), str(chips))
        if ADMIN_WEB:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1400, 'height': 1000}); errs = []
                pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                pg.goto(ADMIN_WEB + '/#/ai-ops/dict', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(1500)
                box = pg.evaluate("() => { const s = document.querySelector('[data-hero-chips]'); const i = document.querySelector('#hero-chips'); return s ? { v: i ? i.value : null, t: s.textContent.includes('메인 Hero 추천 칩') } : null; }")
                b.close()
            ok('③ 운영 화면 검색 사전 — 「메인 Hero 추천 칩」 칸에 지금 값 · 오류 없음', box and box.get('t') and box.get('v') == val and not errs, f'{box} · {errs[:2]}')
    finally:
        psql("UPDATE site_settings SET value = '' WHERE key = 'home.hero_chips'")
    ok('끝 — 되돌림(빈 값)', psql("SELECT value FROM site_settings WHERE key = 'home.hero_chips'")[0] == '', '')
else:
    print('  (API · DB 없음 — ③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
