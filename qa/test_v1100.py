"""v10.100 시험 — 다국어 2-5a(파트너센터 · 제휴 파트너센터 · 요금 · 공급사 · docs/158)

  KIT=… [SITE=http://localhost:15174] [API=http://localhost:13000/api/v1] [DB=postgresql://sgb:sgb@localhost:15432/sgb] python3 -I test_v1100.py

  ① 바탕 — 사전 묶음 파일(messages/index.ts) · 레이아웃은 공통 묶음만 · 화면 전용 묶음은 <Msgs> · 형식 검사가 묶음까지
  ② 사전 — 묶음마다 ko · en 키가 같음 · 자리표시 · 굵게 짝 · 영어에 한글 없음 · 옮긴 파일에 한글 문자열 없음(주석 · 남기기로 한 자료 제외)
  ③ 화면 전용 묶음을 쓰는 브라우저 부품은 그 부품을 그리는 서버 화면이 <Msgs> 로 감쌈
  ④ (SITE · API · DB) 꺼짐 → 파트너센터 · 제휴 · 공급사가 한국어 · 사전 키가 화면에 새지 않음 · 메인에 2-5a 묶음이 실리지 않음 · 파트너센터에는 실림 · 켬 + 쿠키 en → 영어 — 끝나면 되돌림
"""
import json, os, re, subprocess, urllib.request

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
SHARED = ['gwan', 'money', 'shop', 'listing', 'searchPop', 'consult', 'refcode']; PAGE = ['main', 'search', 'detail', 'request', 'order', 'hlt', 'my', 'myDeal', 'partner', 'partnerOps', 'affiliate', 'billing']
NEW = ['partner', 'partnerOps', 'affiliate', 'billing']   # 2-5a 에서 더한 묶음(모두 화면 전용)
_pg = re.search(r'const PAGE = \{([^}]*)\}', IX)
ok('① 묶음 파일 — SHARED 7 · PAGE 에 2-5a 묶음 4개 · 한국어 바탕에 그 언어를 덮음',
   ('const SHARED = { gwan, money, shop, listing, searchPop, consult, refcode };' in IX or 'const SHARED = { gwan, money, shop, listing, searchPop, consult, refcode, aiChat };' in IX) and _pg and set(PAGE) <= {x.strip() for x in _pg.group(1).split(',')} and 'return merge(KO as unknown as Dict, over);' in IX, '')
ok("① 파트너센터 레이아웃 — <Msgs ns={['partner', 'partnerOps', 'affiliate']}> · 제휴 — ['affiliate', 'partner']",
   "<Msgs ns={['partner', 'partnerOps', 'affiliate']}>" in rd('site/src/app/partner/layout.tsx') and "<Msgs ns={['affiliate', 'partner']}>" in rd('site/src/app/partners/layout.tsx'), '')
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
print(f'   2-5a 사전 키 {tot}개')

S = 'site/src/'
FILES = [
    'app/my/subscription/page.tsx',
    'app/my/subscription/pay/page.tsx',
    'app/my/subscription/upgrade/page.tsx',
    'app/partner/apply/page.tsx',
    'app/partner/business/BizForms.tsx',
    'app/partner/business/page.tsx',
    'app/partner/cash/page.tsx',
    'app/partner/cash/pay/page.tsx',
    'app/partner/layout.tsx',
    'app/partner/leads-rejects/page.tsx',
    'app/partner/leads/LeadMemo.tsx',
    'app/partner/leads/ViewLeadButton.tsx',
    'app/partner/leads/page.tsx',
    'app/partner/listings/page.tsx',
    'app/partner/notices/page.tsx',
    'app/partner/page.tsx',
    'app/partner/performance/ReportForm.tsx',
    'app/partner/performance/page.tsx',
    'app/partner/pricing/page.tsx',
    'app/partner/regions/page.tsx',
    'app/partner/reviews/page.tsx',
    'app/partner/services/[id]/page.tsx',
    'app/partner/services/new/ServiceForm.tsx',
    'app/partner/services/new/page.tsx',
    'app/partner/services/page.tsx',
    'app/partner/settlement/page.tsx',
    'app/partner/stats/page.tsx',
    'app/partner/tracks/TrackForms.tsx',
    'app/partner/tracks/page.tsx',
    'app/partner/trust/page.tsx',
    'app/partners/guides/page.tsx',
    'app/partners/inquiries/page.tsx',
    'app/partners/layout.tsx',
    'app/partners/links/page.tsx',
    'app/partners/materials/page.tsx',
    'app/partners/notices/page.tsx',
    'app/partners/orders/page.tsx',
    'app/partners/page.tsx',
    'app/partners/products/page.tsx',
    'app/partners/revenues/page.tsx',
    'app/partners/settlements/page.tsx',
    'app/supplier/[id]/page.tsx',
    'app/supplier/page.tsx',
    'components/billing/PlanPicker.tsx',
    'components/billing/SubPayConfirm.tsx',
    'components/billing/SubscriptionManage.tsx',
    'components/billing/viewLimit.ts',
    'components/partner/CashPanel.tsx',
    'components/partner/P2Frame.tsx',
    'components/partner/P2Promo.tsx',
    'components/partner/PartnerShell.tsx',
    'components/partner/RegionEditor.tsx',
    'components/partner/ServiceTools.tsx',
    'components/partner/act.tsx',
    'components/partner/ui.tsx',
    'components/partners/AffiliateApply.tsx',
    'components/partners/CopyButton.tsx',
    'components/partners/LinkCreateForm.tsx',
    'components/partners/PartnerInquiryForm.tsx',
    'components/partners/PartnerNav.tsx',
    'components/partners/SettlementAccountForm.tsx',
    'components/partners/fmt.ts',
    'i18n/messages/index.ts',
]
# 남기기로 한 한글 — 그 줄에 이 표시가 있으면 뺌 · docs/158 §2
MONEY = ['원`', "원'", '}원', "'원'", '만원', "toLocaleString('ko-KR')"]   # 금액 · 시각 표기(2-5c)
KEEP_ALL = MONEY + ["requestPayment('카드'", '.test(', "startsWith('리드 확인')"]   # 토스 결제수단 값 · 서버 글자 맞추기
BANKS = ["은행']", "'우체국']", "'새마을금고']", "'신협']"]   # 서버로 보내는 은행 이름
SIDO = ['const SIDO', "'강원', '충북'", "useState('서울')"]   # 서버로 보내는 시도 값
KEEP = {'app/partner/business/BizForms.tsx': SIDO, 'components/partner/RegionEditor.tsx': SIDO,
        'components/partners/SettlementAccountForm.tsx': BANKS,
        'app/partner/page.tsx': ['(주\\)'],   # 상호 앞 (주) 떼기
        'app/partner/tracks/page.tsx': ['const STAGE'], 'app/partner/trust/page.tsx': ['const BADGE_TONE'],   # 서버가 준 단계 · 배지 상태 글자에 색만 붙임
        'app/partners/orders/page.tsx': ['시간`', '일`'], 'app/partners/page.tsx': ['월 ${', '분 전'],   # 시각 표기(2-5c)
        'components/billing/PlanPicker.tsx': ['const ro = ', '구독료`'], 'components/billing/SubscriptionManage.tsx': ["reason: '회원 해지'"],   # 한국어 조사 · 결제 · API 값
        'components/partner/act.tsx': ["'처리하지 못했습니다. 잠시 뒤 다시 해 주십시오.'"],   # 서버가 사유를 주지 않을 때(여러 파일이 쓰는 일반 함수)
        'components/partner/ui.tsx': ['export const GRADE_KO', "['운영중'", "['반려'", "['작성중'"]}   # 사전에 없는 코드일 때만 쓰는 옛 표(ptCode fallback)


def strip_comments(t):
    t = re.sub(r'\{/\*[\s\S]*?\*/\}', '', t)
    t = re.sub(r'/\*[\s\S]*?\*/', '', t)
    return re.sub(r'(^|[^:\'"`])//[^\n]*', r'\1', t)


left = {}
for f in FILES:
    hits = [ln.strip() for ln in strip_comments(rd(S + f)).splitlines() if re.search('[가-힣]', ln) and not any(k in ln for k in KEEP.get(f, []) + KEEP_ALL)]
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
    sup = (re.findall(r'href="(/supplier/[^"]+)"', get('/supplier')) + [''])[0].replace('&amp;', '&')
    GUEST = [u for u in ('/supplier', sup, '/partner/apply') if u]
    ok('④ 살펴볼 주소를 찾음(공급사)', sup, sup)
    ME = os.environ.get('MEMBER', 'intro@x.com')   # 파트너 · 제휴 화면이 다 열리는 시험 계정
    ck = ('sgb_at=' + login(ME)) if API else ''
    MINE = ['/partner', '/partner/apply', '/partner/business', '/partner/cash', '/partner/leads', '/partner/leads-rejects', '/partner/listings', '/partner/notices', '/partner/performance',
            '/partner/pricing', '/partner/regions', '/partner/reviews', '/partner/services', '/partner/services/new', '/partner/settlement', '/partner/stats', '/partner/tracks', '/partner/trust',
            '/partners', '/partners/links', '/partners/settlements', '/partners/orders', '/my/subscription'] if ck else []
    leak = []
    for u, c in [(u, '') for u in GUEST] + [(u, ck) for u in MINE]:
        h = re.sub(r'<script[\s\S]*?</script>', '', get(u, c))
        leak += [f'{u}:{m}' for m in re.findall(NSRE, h)]
    ok(f'④ 꺼짐 — 2-5a 화면 {len(GUEST) + len(MINE)}곳에 사전 키가 새지 않음({ME})', not leak and (MINE or not API), ' '.join(leak[:4]))
    flat_ns = {n: flat(json.loads(rd(f'{I}messages/ko/{n}.json') or '{}')) for n in SHARED + PAGE}
    allv = {n: ' '.join(d.values()) for n, d in flat_ns.items()}
    def only(n):
        rest = ' '.join(v for m, v in allv.items() if m != n) + rd(I + 'messages/ko.json')
        return [v for v in flat_ns[n].values() if len(v) >= 6 and '{' not in v and '<' not in v and v not in rest]
    enc = lambda v: json.dumps(v, ensure_ascii=False)[1:-1]
    home = get('/'); vis = re.sub(r'<script[\s\S]*?</script>', '', home)
    demo = rd('site/src/components/home/content.ts')   # 메인 예시 내용(2-5 · 브라우저 부품에 자료로 넘어감 — 예: 「소개몰 가기」)
    on = {n: [v for v in only(n) if v not in vis and v not in demo] for n in NEW}   # 메인 화면에 그대로 보이는 같은 글자는 뺌
    hit = [v for n in NEW for v in on[n] if enc(v) in home]
    ok('④ 메인에는 2-5a 묶음(partner · partnerOps · affiliate · billing)이 실리지 않음', all(on.values()) and not hit, ' · '.join(f'{n} 전용 {len(on[n])}' for n in NEW) + (f' · 실린 것 {hit[:3]}' if hit else ''))
    if ck:
        mh = get('/partner', ck)
        ok('④ 파트너센터에는 partner 묶음이 실림(레이아웃 <Msgs>)', any(enc(v) in mh for v in on['partner']), '')
    if DB:
        before = psql("SELECT (SELECT value FROM site_settings WHERE key='i18n.enabled') || ',' || (SELECT is_active FROM i18n_langs WHERE code='en')")
        try:
            psql("UPDATE site_settings SET value='on' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active=true WHERE code='en';")
            restart_site()
            # 언어 목록(/i18n/langs · 60초 캐시)은 로그인 토큰마다 따로 캐시됩니다(apiGet 이 Authorization 을 붙임) — 켠 뒤 첫 요청 한 번은 꺼짐 때 것이 나올 수 있어 한 번 미리 엶
            if ck: get('/my', ck)
            ens = [get(u, 'sgb_lang=en') for u in GUEST] + [get(u, ck + '; sgb_lang=en') for u in MINE]
            noen = [u for u, x in zip(GUEST + MINE, ens) if '<html lang="en"' not in x]
            ok('④ 켬 + 쿠키 en → 2-5a 화면이 영어(html lang=en)', not noen, ' '.join(noen[:4]))
            for u, x in zip(GUEST + MINE, ens):
                if u in noen: print("   ", u, re.search(r"<html[^>]*>", x).group(0) if re.search(r"<html[^>]*>", x) else x[:300])
            leak = [m for x in ens for m in re.findall(NSRE, re.sub(r'<script[\s\S]*?</script>', '', x))]
            ok('④ 영어에서도 사전 키가 새지 않음', not leak, ' '.join(leak[:4]))
        finally:
            en_on, en_act = (before.split(',') + ['off', 'f'])[:2]
            psql(f"UPDATE site_settings SET value='{en_on or 'off'}' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active={'true' if en_act == 't' else 'false'} WHERE code='en';")
            restart_site()

_v = tuple(int(x) for x in re.findall(r'\d+', rd('VERSION')))
ok('VERSION v10.100 이상', _v >= (10, 100), '.'.join(map(str, _v)))
bad = [x for x in RES if not x[0]]
print(f'\n결과 — 통과 {len(RES) - len(bad)} · 실패 {len(bad)}')
raise SystemExit(1 if bad else 0)
