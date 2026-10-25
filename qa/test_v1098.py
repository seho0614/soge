"""v10.98 시험 — 다국어 2-3(매물 상세 · 문의 · 안심소개 상담 · 요청 상세 · 소개 공유 · docs/156)

  KIT=… [SITE=http://localhost:15174] [DB=postgresql://sgb:sgb@localhost:15432/sgb] python3 -I test_v1098.py

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
SHARED = ['gwan', 'money', 'shop', 'listing', 'searchPop', 'consult', 'refcode']; PAGE = ['main', 'search', 'detail', 'request']
NEW = ['detail', 'consult', 'request', 'refcode']   # 2-3 에서 더한 묶음
ok('① 묶음 파일 — SHARED 7 · PAGE 4 · 한국어 바탕에 그 언어를 덮음',
   'const SHARED = { gwan, money, shop, listing, searchPop, consult, refcode };' in IX and 'const PAGE = { main, search, detail, request };' in IX and 'return merge(KO as unknown as Dict, over);' in IX, '')
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
print(f'   2-3 사전 키 {tot}개')

S = 'site/src/'
FILES = ['app/[gwan]/[id]/page.tsx', 'app/[gwan]/[id]/qna/page.tsx', 'components/gwan/GwDetailClient.tsx', 'components/gwan/GwQnaBoard.tsx', 'components/gwan/GwOwnerTools.tsx',
         'components/gwan/SafetyCaseForm.tsx', 'components/gwan/StoryConsent.tsx',
         'app/consult/page.tsx', 'app/consult/ConsultForm.tsx', 'app/mal/consult/page.tsx', 'app/mal/consult/[code]/page.tsx', 'app/mal/consult/[code]/apply/page.tsx',
         'components/mal/ConsultRows.tsx',
         'app/request/page.tsx', 'app/request/[id]/page.tsx', 'components/request/ProposalForm.tsx', 'components/request/ProposalList.tsx', 'components/request/ReqCard.tsx',
         'components/refcode/RefShare.tsx', 'components/refcode/RefShareButton.tsx', 'components/refcode/RefPayConfirm.tsx', 'components/refcode/CopyLink.tsx', 'components/map/KakaoMap.tsx']
ok('② 안전 수칙(SAFE_CONSULT) · 업종 설명(CSL_DESC)은 사전 키(copy.ts — AXIS · SAFE_LISTING 은 쓰지 않는 MalMain 만)',
   "export const SAFE_CONSULT = ['safe.s1', 'safe.s2', 'safe.s3'] as const" in rd('site/src/components/mal/copy.ts') and "SAFE_CONSULT.map((k) => tc(k))" in rd('site/src/components/gwan/GwanLanding.tsx'), '')
# 남기기로 한 한글(자료 · 비교 값) — 그 줄에 이 표시가 있으면 뺌 · docs/155 §2
KEEP = {'app/consult/ConsultForm.tsx': ['const SIDO', "'강원'"], 'components/request/ReqCard.tsx': ["'예산 비공개'", '억`', '이내`', '이상`', "'예산 협의'"],
        'components/refcode/RefShareButton.tsx': ["requestPayment('카드'", "orderName: '소개코드 추가 1건'"]}   # 시도 이름(서버로 보내는 값) · 금액 표기(2-5) · 토스 결제수단 값


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


NSRE = r'>\s*((?:' + '|'.join(SHARED + PAGE) + r')\.[a-zA-Z.]+)\s*<'


def links(path, pat):
    return re.findall(pat, get(path))


if SITE:
    lst = (links('/money', r'href="(/money/[0-9a-f-]{36})"') + [''])[0]
    mal = (links('/mall?axis=realty', r'href="(/mall/[0-9a-f-]{36})"') + [''])[0]
    req = (links('/request', r'href="(/request/[0-9a-f-]{36})"') + [''])[0]
    PAGES = [u for u in (lst, mal, lst and lst + '/qna', '/consult', '/mal/consult', '/mal/consult/CSL_AUTO', '/mal/consult/CSL_AUTO/apply', '/mall?axis=consult', '/request', req) if u]
    ok('④ 살펴볼 주소를 찾음(매물 · 안심소개 매물 · 요청 상세)', lst and mal and req, f'{lst} {mal} {req}')
    leak = []
    for u in PAGES:
        h = re.sub(r'<script[\s\S]*?</script>', '', get(u))
        leak += [f'{u}:{m}' for m in re.findall(NSRE, h)]
    ok(f'④ 꺼짐 — 2-3 화면 {len(PAGES)}곳에 사전 키가 새지 않음', not leak, ' '.join(leak[:4]))
    flat_ns = {n: flat(json.loads(rd(f'{I}messages/ko/{n}.json') or '{}')) for n in SHARED + PAGE}
    allv = {n: ' '.join(d.values()) for n, d in flat_ns.items()}
    def only(n):
        rest = ' '.join(v for m, v in allv.items() if m != n) + rd(I + 'messages/ko.json')
        return [v for v in flat_ns[n].values() if len(v) >= 6 and '{' not in v and '<' not in v and v not in rest]
    enc = lambda v: json.dumps(v, ensure_ascii=False)[1:-1]
    home = get('/'); det = get(lst) if lst else ''
    od, orq = only('detail'), only('request')
    ok('④ 메인에는 상세 · 요청 전용 묶음이 실리지 않음 · 매물 상세에는 detail 묶음이 실림',
       od and orq and not [v for v in od + orq if enc(v) in home] and any(enc(v) in det for v in od), f'상세 전용 {len(od)} · 요청 전용 {len(orq)}')
    if DB:
        before = psql("SELECT (SELECT value FROM site_settings WHERE key='i18n.enabled') || ',' || (SELECT is_active FROM i18n_langs WHERE code='en')")
        try:
            psql("UPDATE site_settings SET value='on' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active=true WHERE code='en';")
            restart_site()
            ens = [get(u, 'sgb_lang=en') for u in PAGES]
            ok('④ 켬 + 쿠키 en → 2-3 화면이 영어(html lang=en)', all('<html lang="en"' in x for x in ens), '')
            leak = [m for x in ens for m in re.findall(NSRE, re.sub(r'<script[\s\S]*?</script>', '', x))]
            ok('④ 영어에서도 사전 키가 새지 않음', not leak, ' '.join(leak[:4]))
        finally:
            en_on, en_act = (before.split(',') + ['off', 'f'])[:2]
            psql(f"UPDATE site_settings SET value='{en_on or 'off'}' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active={'true' if en_act == 't' else 'false'} WHERE code='en';")
            restart_site()

_v = tuple(int(x) for x in re.findall(r'\d+', rd('VERSION')))
ok('VERSION v10.98 이상', _v >= (10, 98), '.'.join(map(str, _v)))
bad = [x for x in RES if not x[0]]
print(f'\n결과 — 통과 {len(RES) - len(bad)} · 실패 {len(bad)}')
raise SystemExit(1 if bad else 0)
