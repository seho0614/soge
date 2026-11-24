"""v10.644 (docs/788) 메인 — 「나를 위한 소개」 띠를 「오늘의 날씨」 위로(대표 11/23)
  ① HomeView 순서: 히어로 </section> → <ForMe> → 오늘의 날씨 → 오늘의 소개뱅크 · ForMe 는 한 번만(아래 옛 자리 없음) · 날씨는 그대로 available 일 때만
  ② 순서 주석(page.tsx · Sections.tsx) · 문서 788 · 판
  ③ (사용자 웹이 있으면) 메인에서 「나를 위한 소개」 띠가 날씨 띠보다 위 — 날씨가 없으면 「오늘의 소개뱅크」보다 위
  (읽기만 · 두 번 돌아도 통과)
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb' if os.path.isdir(KIT + '/sgb') else KIT
API = os.environ.get('API'); DB = os.environ.get('DB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


def doc(prefix):
    d = os.path.join(K, 'docs')
    return next((open(os.path.join(d, x), encoding='utf-8').read() for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith(prefix)), '')


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=120).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()


def login(e):
    return call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')


VER = rd('VERSION').strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))
SITE = os.environ.get('SITE')

HV = rd('site/src/components/home/HomeView.tsx')
i_hero, i_fm, i_wx, i_today = HV.find('</section>\n\n'), HV.find('<ForMe '), HV.find('<Weather w={weather} />'), HV.find('<Today c={c} />')
ok('① 히어로 → 나를 위한 소개 → 오늘의 날씨 → 오늘의 소개뱅크', 0 < i_hero < i_fm < i_wx < i_today, f'{i_hero} {i_fm} {i_wx} {i_today}')
# v10.697 (D321 · docs/805) 메인 구역은 운영이 정한 차례대로(처음 차례는 그대로) — 날씨 칸은 「weather?.available ? <Weather … : null」 모양
ok('① ForMe 는 한 번만 · 날씨는 available 일 때만', HV.count('<ForMe ') == 1 and ('{weather?.available && <Weather w={weather} />}' in HV or "(weather?.available ? <Weather w={weather} /> : null)" in HV), str(HV.count('<ForMe ')))
PG, SC = rd('site/src/app/page.tsx'), rd('site/src/components/home/Sections.tsx')
ok('② 순서 주석 — 나를 위한 소개(v10.644) → 오늘의 날씨', '나를 위한 소개(v10.644' in PG and '나를 위한 소개(v10.644' in SC, '')
d788 = doc('788_')
ok('② 문서 788 — 나를 위한 소개 · 오늘의 날씨', all(w in d788 for w in ('나를 위한 소개', '오늘의 날씨', 'HomeView')), str(len(d788)))
ok('② VERSION v10.644 이상', VT >= (10, 644), VER)

if SITE:
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = b.new_page(viewport={'width': 1280, 'height': 900})
            pg.goto(SITE + '/', wait_until='networkidle', timeout=120000)
            y = pg.evaluate("""() => { const t = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().top + scrollY : null; };
                                         return { fm: t('section.home-band.forme'), wx: t('.home-wx, [data-weather]'), today: t('#home-today-h, .home-band.today') }; }""")
            b.close()
        nxt = y.get('wx') if y.get('wx') is not None else y.get('today')
        ok('③ 화면 — 나를 위한 소개 띠가 날씨(없으면 오늘의 소개뱅크)보다 위', y.get('fm') is not None and nxt is not None and y['fm'] < nxt, str(y))
    except ImportError:
        print('playwright 없음 — ③ 건너뜀')
else:
    print('SITE 없음 — ③ 건너뜀')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
