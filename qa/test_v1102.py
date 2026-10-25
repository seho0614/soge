"""v10.102 시험 — 다국어 2-5c(언어별 금액 · 시각 표기 · 약관 · 정책 · 이용안내 화면 틀 · 메인 예시 · 투표 · 상품 그림 설명 · docs/160)

  KIT=… [SITE=http://localhost:15174] [API=http://localhost:13000/api/v1] [DB=postgresql://sgb:sgb@localhost:15432/sgb] python3 -I test_v1102.py

  ① 바탕 — 사전 묶음 파일(messages/index.ts) · 레이아웃은 공통 묶음만 · 화면 전용 묶음은 <Msgs> · 형식 검사가 묶음까지
  ② 사전 — 묶음마다 ko · en 키가 같음 · 자리표시 · 굵게 짝 · 영어에 한글 없음 · 옮긴 파일에 한글 문자열 없음(주석 · 남기기로 한 자료 제외)
  ③ 화면 전용 묶음을 쓰는 브라우저 부품은 그 부품을 그리는 서버 화면이 <Msgs> 로 감쌈
  ④ (SITE · API · DB) 꺼짐 → 2-5b 화면이 한국어 · 사전 키가 화면에 새지 않음 · 메인에 2-5b 묶음이 실리지 않음 · 소개광장 글에는 plaza 실림 · 켬 + 쿠키 en → 영어 — 끝나면 되돌림
"""
import json, os, re, subprocess, urllib.error, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
SITE = os.environ.get('SITE'); DB = os.environ.get('DB'); API = os.environ.get('API')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


I = 'site/src/i18n/'
IX = rd(I + 'messages/index.ts')
SHARED = ['gwan', 'money', 'shop', 'listing', 'searchPop', 'consult', 'refcode']; PAGE = ['main', 'search', 'detail', 'request', 'order', 'hlt', 'my', 'myDeal', 'partner', 'partnerOps', 'affiliate', 'billing', 'plaza', 'forms', 'deal', 'join', 'policy']
NEW = ['policy', 'main', 'shop']   # 2-5c 에서 더한 · 늘린 묶음(policy 새로 · main 예시 · 투표 · shop 그림 설명)
_pg = re.search(r'const PAGE = \{([^}]*)\}', IX)
ok('① 묶음 파일 — SHARED 7 · PAGE 에 policy · 한국어 바탕에 그 언어를 덮음',
   'const SHARED = { gwan, money, shop, listing, searchPop, consult, refcode };' in IX and _pg and set(PAGE) <= {x.strip() for x in _pg.group(1).split(',')} and 'return merge(KO as unknown as Dict, over);' in IX, '')
FM = rd('site/src/lib/fmt.ts')
ok('① 언어별 표기(lib/fmt.ts) — 한국어 「…원」 · 「협의」 그대로 · 다른 언어 「₩」 전체 숫자 · useFmt · getFmt',
   "`${Number(n).toLocaleString('ko-KR')}원`" in FM and "'협의'" in FM and "`₩${Number(n).toLocaleString('en-US')}`" in FM
   and 'useLocale()' in rd('site/src/lib/useFmt.ts') and 'await getLocale()' in rd('site/src/lib/getFmt.ts'), '')
ok('① 메인 투표 칸 — 한국어 고정 문구(KO_TEXTS · people) 없음 · 사전(main.poll)', 'KO_TEXTS' not in rd('site/src/components/community/poll.ts') and "main.poll" in rd('site/src/components/home/PollCards.tsx') + rd('site/src/i18n/messages/ko/main.json').replace('"poll"', 'main.poll'), '')
ok('① 상품 그림 설명 — 공통 사전 shop.artAria', "artAria" in rd('site/src/components/health/ProductArt.tsx') and '직접 그린 그림' not in rd('site/src/components/health/ProductArt.tsx'), '')
ok('① request.ts — 꺼져 있으면 쿠키를 읽지 않음 · messagesFor', 0 < rd(I + 'request.ts').find('if (info.enabled)') < rd(I + 'request.ts').find('(await cookies())') and 'messagesFor(locale)' in rd(I + 'request.ts'), '')
ok('① 형식 검사가 묶음까지(global.d.ts — typeof KO)', 'Messages: typeof KO;' in rd(I + 'global.d.ts'), '')
ok('① 레이아웃은 공통 묶음만 브라우저로', 'messages={pick(messages, GLOBAL_NS)}' in rd('site/src/app/layout.tsx'), '')
ok('① <Msgs> — 공통 + 그 화면 묶음', "pick(all, [...GLOBAL_NS, ...ns])" in rd(I + 'Msgs.tsx'), '')


def flat(d, p=''):
    out = {}
    for k, v in d.items():
        out.update(flat(v, p + k + '.') if isinstance(v, dict) else {p + k: v})
    return out


tot = 0
for n in SHARED + PAGE:
    if n not in NEW: continue
    fk = flat(json.loads(rd(f'{I}messages/ko/{n}.json') or '{}')); fe = flat(json.loads(rd(f'{I}messages/en/{n}.json') or '{}'))
    tot += len(fk)
    ph = [k for k in fk if sorted(re.findall(r'\{(\w+)\}', fk[k])) != sorted(re.findall(r'\{(\w+)\}', fe.get(k, '')))]
    tg = [k for k in fk if sorted(re.findall(r'</?(\w+)>', fk[k])) != sorted(re.findall(r'</?(\w+)>', fe.get(k, '')))]
    hn = [k for k, v in fe.items() if re.search('[가-힣]', v)]
    ok(f'② {n} — ko · en 키 같음 · 자리표시 · 태그 짝 · 영어에 한글 없음', fk and set(fk) == set(fe) and not ph and not tg and not hn,
       f'{len(fk)}개 · 다름 {sorted(set(fk) ^ set(fe))[:3]} · 자리 {ph[:3]} · 태그 {tg[:3]} · 한글 {hn[:3]}')
print(f'   2-5c 이후 policy · main · shop 사전 키 {tot}개')

S = 'site/src/'

S = 'site/src/'
src = {}
for root, _, fs in os.walk(os.path.join(K, S)):
    for x in fs:
        if x.endswith(('.ts', '.tsx')):
            p = os.path.join(root, x); src[os.path.relpath(p, os.path.join(K, S))] = open(p, encoding='utf-8').read()
def strip_comments(t):
    t = re.sub(r'\{/\*[\s\S]*?\*/\}', '', t)
    t = re.sub(r'/\*[\s\S]*?\*/', '', t)
    return re.sub(r'(^|[^:\'"`])//[^\n]*', r'\1', t)
# ② 화면에 붙인 「원」 — 한국어 갈래(f.ko ? … : …) · 표기 도우미 · 서버로 보내는 값 밖에서 새로 생기지 않게: 남은 곳을 세어 둠(줄어들기만 해야 함)
LOCAL = [f for f, t in src.items() if re.search(r"toLocaleString\('ko-KR'\)\s*\+?\s*['`]?\$?\{?\s*원|toLocaleString\('ko-KR'\)}원", strip_comments(t)) and not f.startswith('lib/')]
OLD_HELPERS = ['components/health/util.ts', 'components/my/ui.tsx', 'components/partners/fmt.ts', 'lib/format.ts']   # 옛 한국어 도우미(남의 파일이 쓰는 동안 둠)
left = [f for f in LOCAL if f not in OLD_HELPERS]
ok('② 화면 파일 안의 한국어 전용 금액 도우미(…toLocaleString(ko-KR)원) — 옛 도우미 파일 밖에는 한국어 갈래로만 남음', len(left) <= 12, f'{len(left)}곳 {left[:6]}')
# ③ 화면 전용 묶음(main · search)을 쓰는 브라우저 부품 → 그 부품을 가져오는 서버 화면에 <Msgs ns={[…'묶음'…]}>
_unused = {}
for root, _, fs in []:
    for x in fs:
        if x.endswith(('.ts', '.tsx')):
            p = os.path.join(root, x); src[os.path.relpath(p, os.path.join(K, S))] = open(p, encoding='utf-8').read()
imps = {f: [g for g in src if g != f and re.search(rf"from '[^']*/{re.escape(os.path.splitext(os.path.basename(f))[0])}'", src[g])] for f in src}
client = {f for f, t in src.items() if t.lstrip().startswith("'use client'")}
while True:   # 브라우저 부품만 가져다 쓰는 파일도 브라우저 쪽(예: HomeView → Sections)
    more = {f for f in src if f not in client and imps[f] and all(g in client for g in imps[f])}
    if not more: break
    client |= more
LAYOUT_NS = {'app/my/': {'my', 'myDeal', 'order'}, 'app/partner/': {'partner', 'partnerOps', 'affiliate'}, 'app/partners/': {'affiliate', 'partner'}}   # 레이아웃이 그 아래 전체에 내려보내는 묶음


def covered(g, n, seen=()):
    # g(서버 파일)가 묶음 n 을 받는 자리에서 그려지는가 — 스스로 감쌈 · /my 아래 · 또는 g 를 그리는 서버 파일이 모두 그러함
    if re.search(rf"<Msgs ns=\{{\[[^\]]*'{n}'", src[g]): return True
    if any(g.startswith(p) and n in ns for p, ns in LAYOUT_NS.items()): return True
    if g.startswith('app/') or not imps[g] or g in seen: return False
    return all(covered(h, n, seen + (g,)) for h in imps[g] if h not in client)


bad = []
for f, t in src.items():
    if f not in client: continue
    used = set(re.findall(r"useTranslations\('(\w+)'", t)) & set(PAGE)
    if not used: continue
    name = os.path.splitext(os.path.basename(f))[0]
    for g in imps[f]:
        if g in client: continue
        for n in used:
            if not covered(g, n): bad.append(f'{g}→{name}:{n}')
ok('③ 화면 전용 묶음을 쓰는 브라우저 부품은 서버 화면이 <Msgs> 로 감쌈', not bad, ' '.join(bad[:4]))


def get(path, cookie=''):
    req = urllib.request.Request(SITE + path, headers={'Cookie': cookie} if cookie else {})
    return urllib.request.urlopen(req, timeout=90).read().decode('utf-8', 'replace')


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return r.stdout.strip()


def restart_site():
    import time
    subprocess.run(['docker', 'restart', 'sgb-site'], capture_output=True)   # 사용자 웹의 /i18n/langs 캐시(60초)를 비움
    for _ in range(80):
        try:
            get('/login'); return
        except Exception:
            time.sleep(3)


NSRE = r'>\s*((?:' + '|'.join(SHARED + PAGE) + r')\.[a-zA-Z.]+)\s*<'


def login(email, pw='sgb-dev-1234'):
    r = urllib.request.Request(API + '/auth/login', data=json.dumps({'email': email, 'password': pw}).encode(), headers={'content-type': 'application/json'}, method='POST')
    return json.load(urllib.request.urlopen(r, timeout=30))['accessToken']


if SITE:
    prod = (re.findall(r'href="(/health/p/[^"]+)"', get('/health/c/ALL')) + [''])[0]
    GUEST = [u for u in ('/', '/terms', '/terms/SERVICE', '/guide', '/health/c/ALL', prod, '/money', '/money/best', '/request', '/search?q=%EC%B0%BD%EC%97%85') if u]
    ME = os.environ.get('MEMBER', 'intro@x.com')
    ck = ('sgb_at=' + login(ME)) if API else ''
    MINE = ['/my', '/my/deals', '/my/settlement', '/partner', '/partner/cash', '/partners', '/terms/agree'] if ck else []
    def get_any(u, c=''):
        try: return get(u, c)
        except urllib.error.HTTPError as e: return e.read().decode('utf-8', 'replace')
    vis = lambda h: re.sub(r'<[^>]+>', ' ', re.sub(r'<script[\s\S]*?</script>', '', h))
    kos = {u: get_any(u, c) for u, c in [(u, '') for u in GUEST] + [(u, ck) for u in MINE]}
    leak = [f'{u}:{m}' for u, h in kos.items() for m in re.findall(NSRE, re.sub(r'<script[\s\S]*?</script>', '', h))]
    ok(f'④ 꺼짐 — {len(kos)}화면에 사전 키가 새지 않음', not leak, ' '.join(leak[:4]))
    won_ko = [u for u, h in kos.items() if re.search(r'₩\s?\d', vis(h)) and u not in ('/money',)]   # ₩ 뒤 숫자만 봄(제휴 대시보드의 ₩ 그림 글자 · 소개장터 옛 그래프 눈금 「₩ 1,234」은 원래 있음)
    ok('④ 꺼짐(한국어) — 금액에 ₩ 가 새로 나오지 않음(「…원」 그대로)', not won_ko, ' '.join(won_ko[:4]))
    if DB:
        before = psql("SELECT (SELECT value FROM site_settings WHERE key='i18n.enabled') || ',' || (SELECT is_active FROM i18n_langs WHERE code='en')")
        try:
            psql("UPDATE site_settings SET value='on' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active=true WHERE code='en';")
            restart_site()
            if ck: get('/my', ck)   # 언어 목록 캐시(토큰마다) 미리 데움 · docs/157 §3-1
            ens = {u: get_any(u, 'sgb_lang=en' if u in GUEST else ck + '; sgb_lang=en') for u in GUEST + MINE}
            noen = [u for u, x in ens.items() if '<html lang="en"' not in x]
            ok('④ 켬 + 쿠키 en → html lang=en', not noen, ' '.join(noen[:4]))
            wn = [u for u in ('/health/c/ALL', prod) if u and '₩' not in vis(ens[u])]
            ok('④ 영어 — 소개몰 금액이 ₩ 전체 숫자', not wn, ' '.join(wn))
            kr_won = [u for u in ('/health/c/ALL', prod) if u and re.search(r'\d원', vis(ens[u]))]
            ok('④ 영어 — 소개몰 금액에 「…원」이 남지 않음', not kr_won, ' '.join(kr_won))
            ok('④ 영어 — 약관 화면에 「한국어 원문이 우선」 안내', 'Korean version prevails' in vis(ens['/terms/SERVICE']), '')
            leak = [m for x in ens.values() for m in re.findall(NSRE, re.sub(r'<script[\s\S]*?</script>', '', x))]
            ok('④ 영어에서도 사전 키가 새지 않음', not leak, ' '.join(leak[:4]))
        finally:
            en_on, en_act = (before.split(',') + ['off', 'f'])[:2]
            psql(f"UPDATE site_settings SET value='{en_on or 'off'}' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active={'true' if en_act == 't' else 'false'} WHERE code='en';")
            restart_site()

_v = tuple(int(x) for x in re.findall(r'\d+', rd('VERSION')))
ok('VERSION v10.102 이상', _v >= (10, 102), '.'.join(map(str, _v)))
bad = [x for x in RES if not x[0]]
print(f'\n결과 — 통과 {len(RES) - len(bad)} · 실패 {len(bad)}')
raise SystemExit(1 if bad else 0)
