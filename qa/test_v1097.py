"""v10.97 시험 — 다국어 2-2(메인 · 관 첫 화면 · 검색 · 사전 묶음 파일 · docs/155)

  KIT=… [SITE=http://localhost:15174] [DB=postgresql://sgb:sgb@localhost:15432/sgb] python3 -I test_v1097.py

  ① 바탕 — 사전 묶음 파일(messages/index.ts) · 레이아웃은 공통 묶음만 · 화면 전용 묶음은 <Msgs> · 형식 검사가 묶음까지
  ② 사전 — 묶음마다 ko · en 키가 같음 · 자리표시 · 굵게 짝 · 영어에 한글 없음 · 옮긴 파일에 한글 문자열 없음(주석 · 남기기로 한 자료 제외)
  ③ 화면 전용 묶음을 쓰는 브라우저 부품은 그 부품을 그리는 서버 화면이 <Msgs> 로 감쌈
  ④ (SITE · DB) 꺼짐 → 메인 · 관 · 검색이 한국어 · 사전 키가 화면에 새지 않음 · 메인 화면에 검색 결과 사전이 실리지 않음 · 켬 + 쿠키 en → 영어 — 끝나면 되돌림
"""
import json, os, re, subprocess, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
SITE = os.environ.get('SITE'); DB = os.environ.get('DB')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


I = 'site/src/i18n/'
IX = rd(I + 'messages/index.ts')
SHARED = ['gwan', 'money', 'shop', 'listing', 'searchPop']; PAGE = ['main', 'search']
ok('① 묶음 파일 — SHARED 5 · PAGE 2 · 한국어 바탕에 그 언어를 덮음',   # v10.98 — 묶음이 늘어도 통과
   re.search(r'const SHARED = \{ gwan, money, shop, listing, searchPop[ ,}]', IX) and re.search(r'const PAGE = \{ main, search[ ,}]', IX) and 'return merge(KO as unknown as Dict, over);' in IX, '')
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
    fk = flat(json.loads(rd(f'{I}messages/ko/{n}.json') or '{}')); fe = flat(json.loads(rd(f'{I}messages/en/{n}.json') or '{}'))
    tot += len(fk)
    ph = [k for k in fk if sorted(re.findall(r'\{(\w+)\}', fk[k])) != sorted(re.findall(r'\{(\w+)\}', fe.get(k, '')))]
    tg = [k for k in fk if sorted(re.findall(r'</?(\w+)>', fk[k])) != sorted(re.findall(r'</?(\w+)>', fe.get(k, '')))]
    hn = [k for k, v in fe.items() if re.search('[가-힣]', v)]
    ok(f'② {n} — ko · en 키 같음 · 자리표시 · 태그 짝 · 영어에 한글 없음', fk and set(fk) == set(fe) and not ph and not tg and not hn,
       f'{len(fk)}개 · 다름 {sorted(set(fk) ^ set(fe))[:3]} · 자리 {ph[:3]} · 태그 {tg[:3]} · 한글 {hn[:3]}')
print(f'   2-2 사전 키 {tot}개')

S = 'site/src/'
FILES = ['app/page.tsx', 'components/home/HomeView.tsx', 'components/home/Sections.tsx', 'components/home/HeroPromo.tsx', 'components/home/HeroSearch.tsx',
         'components/home/PickRail.tsx', 'components/home/PollCards.tsx', 'components/home/Weather.tsx',
         'components/gwan/GwanLanding.tsx', 'components/gwan/GwList.tsx', 'components/gwan/GwCard.tsx', 'components/gwan/GwParts.tsx', 'components/gwan/GwBizAxes.tsx',
         'components/gwan/GwBizClient.tsx', 'components/gwan/GwAds.tsx', 'components/gwan/GwClient.tsx',
         'components/money/MoneyMain.tsx', 'components/money/MoneyView.tsx', 'components/money/MoneySide.tsx', 'components/money/MoneyAd.tsx', 'components/money/MoneySearch.tsx',
         'components/shop/ShopMain.tsx', 'components/shop/ShopRankBox.tsx', 'components/ListingList.tsx', 'components/ListingCard.tsx',
         'app/search/page.tsx', 'app/search/PromptSearch.tsx', 'components/search/SearchPopup.tsx', 'components/search/SearchBox.tsx', 'components/common/BackBar.tsx']
# 남기기로 한 한글(자료 · 비교 값) — 그 줄에 이 표시가 있으면 뺌 · docs/155 §2
KEEP = {'components/gwan/GwanLanding.tsx': ['/[가-힣]$/'], 'components/money/MoneyMain.tsx': ['/[가-힣]$/'], 'components/money/MoneyView.tsx': ["josa === '이'"],
        'components/gwan/GwCard.tsx': ['const CARD_KO'], 'components/gwan/GwBizAxes.tsx': ["path: '/", "'공고'", "'지원'", "'빠른 매칭'"],
        'components/shop/ShopMain.tsx': ["'특별가격'"], 'app/search/PromptSearch.tsx': ['const eok'], 'components/search/SearchPopup.tsx': ['COND_KEY', "k: '", "x.k !== '등록'"]}


def strip_comments(t):
    t = re.sub(r'\{/\*[\s\S]*?\*/\}', '', t)
    t = re.sub(r'/\*[\s\S]*?\*/', '', t)
    return re.sub(r'(^|[^:\'"`])//[^\n]*', r'\1', t)


left = {}
for f in FILES:
    hits = [ln.strip() for ln in strip_comments(rd(S + f)).splitlines() if re.search('[가-힣]', ln) and not any(k in ln for k in KEEP.get(f, []))]
    if hits: left[f] = hits
ok(f'② 옮긴 파일 {len(FILES)}개에 한글 문자열 없음(주석 · 남기기로 한 자료 값 제외)', not left and all(rd(S + f) for f in FILES), ' | '.join(f'{os.path.basename(f)}: {v[0][:40]}' for f, v in list(left.items())[:4]))

# ③ 화면 전용 묶음(main · search)을 쓰는 브라우저 부품 → 그 부품을 가져오는 서버 화면에 <Msgs ns={[…'묶음'…]}>
src = {}
for root, _, fs in os.walk(os.path.join(K, S)):
    for x in fs:
        if x.endswith(('.ts', '.tsx')):
            p = os.path.join(root, x); src[os.path.relpath(p, os.path.join(K, S))] = open(p, encoding='utf-8').read()
imps = {f: [g for g in src if g != f and re.search(rf"from '[^']*/{re.escape(os.path.splitext(os.path.basename(f))[0])}'", src[g])] for f in src}
client = {f for f, t in src.items() if t.lstrip().startswith("'use client'")}
while True:   # 브라우저 부품만 가져다 쓰는 파일도 브라우저 쪽(예: HomeView → Sections)
    more = {f for f in src if f not in client and imps[f] and all(g in client for g in imps[f])}
    if not more: break
    client |= more
bad = []
for f, t in src.items():
    if f not in client: continue
    used = set(re.findall(r"useTranslations\('(\w+)'", t)) & set(PAGE)
    if not used: continue
    name = os.path.splitext(os.path.basename(f))[0]
    for g in imps[f]:
        if g in client: continue
        for n in used:
            if not re.search(rf"<Msgs ns=\{{\[[^\]]*'{n}'", src[g]): bad.append(f'{g}→{name}:{n}')
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


if SITE:
    PAGES = ['/', '/money', '/mall', '/biz', '/health', '/search?q=%EC%B0%BD%EC%97%85']
    leak = []
    for u in PAGES:
        h = re.sub(r'<script[\s\S]*?</script>', '', get(u))
        leak += [f'{u}:{m}' for m in re.findall(r'>\s*((?:main|search|searchPop|gwan|money|shop|listing)\.[a-zA-Z.]+)\s*<', h)]
    ok('④ 꺼짐 — 메인 · 관 4곳 · 검색에 사전 키가 새지 않음', not leak, ' '.join(leak[:4]))
    home = get('/')
    flat_ns = {n: flat(json.loads(rd(f'{I}messages/ko/{n}.json') or '{}')) for n in SHARED + PAGE}
    others = ' '.join(v for n, d in flat_ns.items() if n != 'search' for v in d.values()) + rd(I + 'messages/ko.json')
    only_search = [v for v in flat_ns['search'].values() if len(v) >= 6 and '{' not in v and '<' not in v and v not in others]
    only_main = [v for v in flat_ns['main'].values() if len(v) >= 6 and '{' not in v and '<' not in v and v not in others.replace(' '.join(flat_ns['main'].values()), '')]
    ok('④ 메인 화면에는 검색 결과 묶음(search)이 실리지 않음 · 메인 묶음(main)은 실림',
       only_search and not [v for v in only_search if json.dumps(v, ensure_ascii=False)[1:-1] in home] and any(json.dumps(v, ensure_ascii=False)[1:-1] in home for v in only_main), f'검색 전용 문장 {len(only_search)}개 중 실린 것 {[v for v in only_search if v in home][:2]}')
    if DB:
        before = psql("SELECT (SELECT value FROM site_settings WHERE key='i18n.enabled') || ',' || (SELECT is_active FROM i18n_langs WHERE code='en')")
        try:
            psql("UPDATE site_settings SET value='on' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active=true WHERE code='en';")
            restart_site()
            en = get('/', 'sgb_lang=en'); ens = get('/search?q=%EC%B0%BD%EC%97%85', 'sgb_lang=en'); enm = get('/mall', 'sgb_lang=en'); enh = get('/health', 'sgb_lang=en')
            ok('④ 켬 + 쿠키 en → 메인 · 검색 · 관이 영어(html lang=en)', all('<html lang="en"' in x for x in (en, ens, enm, enh)), '')
            leak = [m for x in (en, ens, enm, enh) for m in re.findall(r'>\s*((?:main|search|searchPop|gwan|money|shop|listing)\.[a-zA-Z.]+)\s*<', re.sub(r'<script[\s\S]*?</script>', '', x))]
            ok('④ 영어에서도 사전 키가 새지 않음', not leak, ' '.join(leak[:4]))
        finally:
            en_on, en_act = (before.split(',') + ['off', 'f'])[:2]
            psql(f"UPDATE site_settings SET value='{en_on or 'off'}' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active={'true' if en_act == 't' else 'false'} WHERE code='en';")
            restart_site()

_v = tuple(int(x) for x in re.findall(r'\d+', rd('VERSION')))
ok('VERSION v10.97 이상', _v >= (10, 97), '.'.join(map(str, _v)))
bad = [x for x in RES if not x[0]]
print(f'\n결과 — 통과 {len(RES) - len(bad)} · 실패 {len(bad)}')
raise SystemExit(1 if bad else 0)
