"""v10.184 시험 — 소개광장 · 나의공간 · 로그인 · 가입 디자인 검토 반영(docs/288 · 마이그레이션 없음)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 -e SITE=http://localhost:15174 sgb-qa:v1 python3 test_v1184.py

  ① 코드 — 화면 번호 지움 · 단추 글꼴 물려받기 · 가입 단추 남색 · 마지막 단추 남색 글자 · 굵은 말 문장 안 · 대비 색 · 소개코드 글꼴 · 시안 같이 · docs/288 · 판
  ② (사용자 웹) 가입 굵은 말이 문장 안 · 「다음」 남색 · 프로필에 화면 번호 없음 · 단추가 본문 글꼴
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


ACC = {f: rd(f'site/src/app/my/{f}/page.tsx') for f in ('account', 'account/privacy', 'account/withdraw', 'account/security', 'account/data')}
W1 = rd('site/src/styles/proto-w1.css'); MY = rd('site/src/styles/proto-my.css'); TOK = rd('site/src/styles/tokens.css'); PROTO = rd('spec/proto.html')

ok('① 나의공간 5화면 — 제목 아래 화면 번호(SB-MYP-…) 없음 · data-screen 은 그대로',
   all(s and not re.search(r'<b>SB-MYP-[A-Z]{3}-\d{3}</b>', s) and "sub={t('sub')}" in s for s in ACC.values()), str([k for k, s in ACC.items() if re.search(r'<b>SB-MYP', s)]))

ok('① 공통 — 단추 · 입력칸 글꼴 물려받기 · 소개코드 본문 글꼴(고정폭 아님)',
   'button, input, select, textarea { font-family: inherit; }' in TOK
   and '.my-code { font-family: var(--sgb-font-body); font-variant-numeric: tabular-nums;' in MY and 'ui-monospace' not in MY, '')

ok('① 가입 — 「다음」 시트 주요 단추 · 마지막 단추 남색 글자 · 굵은 말 문장 안 · 대비 색(--ink-2 · --bl-d)',
   '.w1-jb.p { background: var(--sgb-btn-bg, #00245a);' in W1 and '.w1-jb.a { background: var(--or); border-color: var(--or); color: var(--sgb-navy, #00245a); }' in W1
   and '.w1-jop > span > b { display: block;' in W1 and '.w1-jop b {' not in W1 and '.w1-jop > span > span b { font-weight: 700;' in W1
   and '.w1-js.on .t b { color: var(--bl-d); }' in W1 and '.w1-jc.i .lb { color: var(--bl-d); }' in W1 and '.w1-prfcta .pch span { font-size: 12px; color: var(--ink-2); }' in W1, '')

ok('① 시안 — 가입 단추 · 굵은 말 · 대비 같이 고침',
   '.jb.p{background:var(--sgb-btn-bg, #00245a)' in PROTO and '.jop>div>b{display:block' in PROTO and '  .jop b{display:block' not in PROTO
   and '.jop>div>span b{font-weight:700' in PROTO and '.js.on .t b{color:var(--bl-d)}' in PROTO and '.jc.i .lb{color:var(--bl-d)}' in PROTO, '')

ok('① 문서 · 판 — docs/288 · v10.184 이상', any(f.startswith('288_') for f in os.listdir(os.path.join(K, 'docs')))
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 184), rd('VERSION').strip())

if SITE and API:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import consent_ok
    consent_ok.agree('buyer@x.com', 'sgb-dev-1234')
    req = urllib.request.Request(API.rstrip('/') + '/auth/login', data=json.dumps({'email': 'buyer@x.com', 'password': 'sgb-dev-1234'}).encode(),
                                 headers={'content-type': 'application/json'}, method='POST')
    tok = json.load(urllib.request.urlopen(req, timeout=60)).get('accessToken', '')
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 1280, 'height': 900})
        pg.goto(SITE + '/signup', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(800)
        r = pg.evaluate("""() => { const i = document.querySelector('.w1-jop > span > span b'); const n = document.querySelector('.w1-jb.p');
          return [i ? getComputedStyle(i).display : null, n ? getComputedStyle(n).backgroundColor : null, n ? getComputedStyle(n).fontFamily.split(',')[0] : null] }""")
        ok('② 가입 — 설명 속 굵은 말이 문장 안(inline) · 「다음」 남색 · 단추 본문 글꼴', r[0] == 'inline' and r[1] == 'rgb(0, 36, 90)' and 'Arial' not in (r[2] or 'Arial'), str(r))
        c = b.new_context(viewport={'width': 1280, 'height': 900}); c.add_cookies([{'name': 'sgb_at', 'value': tok, 'url': SITE}])
        pg = c.new_page(); pg.goto(SITE + '/my/account', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(800)
        body = pg.locator('body').inner_text()
        ff = pg.evaluate("() => { const e = document.querySelector('main button, .my button, button.p2primary'); return e ? getComputedStyle(e).fontFamily.split(',')[0] : null }")
        ok('② 나의공간 프로필 — 화면 번호 안 보임 · 단추 본문 글꼴', '/my/account' in pg.url and 'SB-MYP-ACC-010' not in body and ff and 'Arial' not in ff, f'{pg.url[-20:]} · {ff}')
        b.close()
else:
    print('  (SITE · API 없음 — ② 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
