"""v10.101 시험 — 다국어 2-5b(소개광장 · 등록 양식 · 거래 · 분쟁 · 신고 · 고객센터 · 채팅 · 가입 · 인증 · AI 도우미 · docs/159)

  KIT=… [SITE=http://localhost:15174] [API=http://localhost:13000/api/v1] [DB=postgresql://sgb:sgb@localhost:15432/sgb] python3 -I test_v1101.py

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
SHARED = ['gwan', 'money', 'shop', 'listing', 'searchPop', 'consult', 'refcode', 'aiChat'];  PAGE = ['main', 'search', 'detail', 'request', 'order', 'hlt', 'my', 'myDeal', 'partner', 'partnerOps', 'affiliate', 'billing', 'plaza', 'forms', 'deal', 'join']
NEW = ['plaza', 'forms', 'deal', 'join']   # 2-5b 에서 더한 묶음(모두 화면 전용)
_pg = re.search(r'const PAGE = \{([^}]*)\}', IX)
ok('① 묶음 파일 — SHARED 7 · PAGE 에 2-5b 묶음 4개 · 한국어 바탕에 그 언어를 덮음',
   ('const SHARED = { gwan, money, shop, listing, searchPop, consult, refcode };' in IX or 'const SHARED = { gwan, money, shop, listing, searchPop, consult, refcode, aiChat };' in IX) and _pg and set(PAGE) <= {x.strip() for x in _pg.group(1).split(',')} and 'return merge(KO as unknown as Dict, over);' in IX, '')
ok('① 없는 주소(404) — 서버 부품이 사전(join.notFound)을 읽고 창 제목만 DocTitle', "getTranslations('join.notFound')" in rd('site/src/app/not-found.tsx') and "'use client'" not in rd('site/src/app/not-found.tsx'), '')
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
    ph = [k for k in fk if set(re.findall(r'\{(\w+)[},]', fk[k])) != set(re.findall(r'\{(\w+)[},]', fe.get(k, ''))) - ({'m2'} if k.startswith('prompt.chip.size') else set())]   # v10.116 — 복수형({n, plural, …})은 같은 이름이 여러 번 · 영어 칩만 ㎡({m2})
    tg = [k for k in fk if sorted(re.findall(r'</?(\w+)>', fk[k])) != sorted(re.findall(r'</?(\w+)>', fe.get(k, '')))]
    hn = [k for k, v in fe.items() if re.search('[가-힣]', v)]
    ok(f'② {n} — ko · en 키 같음 · 자리표시 · 태그 짝 · 영어에 한글 없음', fk and set(fk) == set(fe) and not ph and not tg and not hn,
       f'{len(fk)}개 · 다름 {sorted(set(fk) ^ set(fe))[:3]} · 자리 {ph[:3]} · 태그 {tg[:3]} · 한글 {hn[:3]}')
print(f'   2-5b 사전 키 {tot}개')

S = 'site/src/'
FILES = [
    'app/ad/[id]/page.tsx',
    'app/ai/classify/page.tsx',
    'app/ai/match/page.tsx',
    'app/ai/profile/done/page.tsx',
    'app/ai/profile/page.tsx',
    'app/biz/register/page.tsx',
    'app/chat/[id]/page.tsx',
    'app/community/[id]/page.tsx',
    'app/community/food/[id]/page.tsx',
    'app/community/food/page.tsx',
    'app/community/food/write/page.tsx',
    'app/community/page.tsx',
    'app/community/polls/page.tsx',
    'app/community/write/page.tsx',
    'app/contracts/templates/[code]/page.tsx',
    'app/deal/[id]/confirm/page.tsx',
    'app/deal/[id]/contract/page.tsx',
    'app/deal/[id]/payment/page.tsx',
    'app/deal/[id]/review/page.tsx',
    'app/i/[token]/page.tsx',
    'app/listings/[id]/edit/page.tsx',
    'app/listings/page.tsx',
    'app/mal/brokers/BrokerForms.tsx',
    'app/mal/brokers/page.tsx',
    'app/mall/give/page.tsx',
    'app/mall/give/pay/page.tsx',
    'app/money/best/mine/page.tsx',
    'app/money/best/page.tsx',
    'app/money/event/page.tsx',
    'app/money/new/page.tsx',
    'app/money/urgent/page.tsx',
    'app/money/verified/page.tsx',
    'app/my/broker/page.tsx',
    'app/my/broker/status/page.tsx',
    'app/my/business/page.tsx',
    'app/my/health/addresses/page.tsx',
    'app/my/inquiries/[id]/page.tsx',
    'app/my/listings/page.tsx',
    'app/my/payment/page.tsx',
    'app/not-found.tsx',
    'app/partner/apply/page.tsx',
    'app/partner/leads-rejects/page.tsx',
    'app/partner/listings/page.tsx',
    'app/register/page.tsx',
    'app/report/[targetType]/[targetId]/page.tsx',
    'app/request/new/RequestForm.tsx',
    'app/request/new/page.tsx',
    'app/safety/cases/[no]/page.tsx',
    'app/safety/cases/new/page.tsx',
    'app/safety/guide/page.tsx',
    'app/signup/done/page.tsx',
    'app/support/dispute/page.tsx',
    'app/support/done/page.tsx',
    'app/support/history/page.tsx',
    'app/support/new/page.tsx',
    'app/support/page.tsx',
    'app/verify/page.tsx',
    'components/AddressInput.tsx',
    'components/ApplyForm.tsx',
    'components/ArchiveButton.tsx',
    'components/AxisApply.tsx',
    'components/BizVerify.tsx',
    'components/BrokerApply.tsx',
    'components/BrokerExtra.tsx',
    'components/BusinessForm.tsx',
    'components/ChatPanel.tsx',
    'components/ContractPanel.tsx',
    'components/DealConfirm.tsx',
    'components/DirectoryApply.tsx',
    'components/DisputeForm.tsx',
    'components/EventJoin.tsx',
    'components/FeeDisputeForm.tsx',
    'components/InquiryForm.tsx',
    'components/InviteConsent.tsx',
    'components/ListingEditForm.tsx',
    'components/ListingForm.tsx',
    'components/NoticeTerms.tsx',
    'components/PayMethod.tsx',
    'components/PaymentReportForm.tsx',
    'components/ProfileSurvey.tsx',
    'components/RegisterForm.tsx',
    'components/RegisterPicker.tsx',
    'components/RegisterTabs.tsx',
    'components/ReportForm.tsx',
    'components/ReviewForm.tsx',
    'components/VerifyPanel.tsx',
    'components/ai/ClassifyView.tsx',
    'components/ai/Engine.tsx',
    'components/ai/MatchView.tsx',
    'components/ai/ProfileDrop.tsx',
    'components/chat/AskChat.tsx',
    'components/community/CommentForm.tsx',
    'components/community/FoodMap.tsx',
    'components/community/FoodTab.tsx',
    'components/community/FoodWriteForm.tsx',
    'components/community/Plaza.tsx',
    'components/community/PollList.tsx',
    'components/community/PostEditor.tsx',
    'components/community/PostOwnerActions.tsx',
    'components/community/poll.ts',
    'components/community/types.ts',
    'components/deal/DealShell.tsx',
    'components/deal/load.ts',
    'components/form/RegParts.tsx',
    'components/register/RegisterForm.tsx',
    'components/support/ChatBot.tsx',
    'components/support/hours.ts',
    'i18n/messages/index.ts',
    'components/common/DocTitle.tsx',
]
# 남기기로 한 한글 — 그 줄에 이 표시가 있으면 뺌 · docs/159 §2
MONEY = ['원`', "원'", '}원', "'원'", '만원', "toLocaleString('ko-KR')", '년 ${', "'억'"]   # 금액 · 시각 표기(2-5c)
KEEP_ALL = MONEY + ["requestPayment('카드'", '.test(']   # 토스 결제수단 값 · 서버 글자 맞추기
KEEP = {'components/ReviewForm.tsx': ["'fast']", "'noPush']"],   # 후기 칩 — 서버로 보내는 tags 값
        'components/ai/ClassifyView.tsx': ['에 태양광 발전소', '3PL 풀필먼트', '일수 대출'],   # 분류 API 로 보내는 예문
        'components/community/poll.ts': ["pick: '보기를", "login: '로그인한"],   # 메인 투표 칸 기본 문구(2-5c · main 묶음)
        'components/register/RegisterForm.tsx': ['const WISH'],   # 서버로 보내는 고르기 값
        'components/support/ChatBot.tsx': ["'fee']", "'attr']", "?? '챗봇 상담'", '[챗봇]', '챗봇 상담원 연결']}   # 서버 FAQ 와 맞추는 질문 값 · 상담원에게 넘기는 기록


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
    post = (re.findall(r'href="(/community/[0-9a-f-]{36})"', get('/community')) + [''])[0]
    GUEST = [u for u in ('/community', post, '/community/polls', '/community/food', '/safety/guide', '/money/best', '/money/urgent', '/money/verified', '/money/event',
                         '/mal/brokers', '/mall/give', '/ai/classify', '/ai/match', '/support', '/support/new', '/listings', '/no-such-page-xyz') if u]
    ok('④ 살펴볼 주소를 찾음(소개광장 글)', post, post)
    ME = os.environ.get('MEMBER', 'person@x.com')
    ck = ('sgb_at=' + login(ME)) if API else ''
    MINE = ['/community/write', '/money/new', '/request/new', '/register', '/biz/register', '/support/history', '/support/dispute', '/verify', '/my/business', '/my/broker',
            '/my/payment', '/my/health/addresses', '/ai/profile', '/signup/done', '/report/listing/' + ((re.findall(r'href="/money/([0-9a-f-]{36})"', get('/money')) + ['x'])[0])] if ck else []
    def get_any(u, c=''):
        try: return get(u, c)
        except urllib.error.HTTPError as e: return e.read().decode('utf-8', 'replace')   # 없는 주소는 404 본문
    leak = []
    for u, c in [(u, '') for u in GUEST] + [(u, ck) for u in MINE]:
        h = re.sub(r'<script[\s\S]*?</script>', '', get_any(u, c))
        leak += [f'{u}:{m}' for m in re.findall(NSRE, h)]
    ok(f'④ 꺼짐 — 2-5b 화면 {len(GUEST) + len(MINE)}곳에 사전 키가 새지 않음({ME})', not leak and (MINE or not API), ' '.join(leak[:4]))
    flat_ns = {n: flat(json.loads(rd(f'{I}messages/ko/{n}.json') or '{}')) for n in SHARED + PAGE}
    allv = {n: ' '.join(d.values()) for n, d in flat_ns.items()}
    def only(n):
        rest = ' '.join(v for m, v in allv.items() if m != n) + rd(I + 'messages/ko.json')
        return [v for v in flat_ns[n].values() if len(v) >= 6 and '{' not in v and '<' not in v and v not in rest]
    enc = lambda v: json.dumps(v, ensure_ascii=False)[1:-1]
    home = get('/'); vis = re.sub(r'<script[\s\S]*?</script>', '', home)
    demo = rd('site/src/components/home/content.ts')   # 메인 예시 내용(2-5 · 브라우저 부품에 자료로 넘어감 — 예: 「소개몰 가기」)
    on = {n: [v for v in only(n) if v not in vis and v not in demo] for n in NEW}
    nf = set(flat_ns['join'][k] for k in flat_ns['join'] if k.startswith('notFound.'))   # 없는 주소 화면은 Next 가 모든 화면 데이터에 함께 실음(전에도 같음)
    on['join'] = [v for v in on['join'] if v not in nf]   # 메인 화면에 그대로 보이는 같은 글자는 뺌
    hit = [v for n in NEW for v in on[n] if enc(v) in home]
    ok('④ 메인에는 2-5b 묶음(plaza · forms · deal · join)이 실리지 않음', all(on.values()) and not hit, ' · '.join(f'{n} 전용 {len(on[n])}' for n in NEW) + (f' · 실린 것 {hit[:3]}' if hit else ''))
    if post:
        mh = get(post)
        ok('④ 소개광장 글에는 plaza 묶음이 실림(<Msgs>)', any(enc(v) in mh for v in on['plaza']), '')
    if DB:
        before = psql("SELECT (SELECT value FROM site_settings WHERE key='i18n.enabled') || ',' || (SELECT is_active FROM i18n_langs WHERE code='en')")
        try:
            psql("UPDATE site_settings SET value='on' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active=true WHERE code='en';")
            restart_site()
            # 언어 목록(/i18n/langs · 60초 캐시)은 로그인 토큰마다 따로 캐시됩니다(apiGet 이 Authorization 을 붙임) — 켠 뒤 첫 요청 한 번은 꺼짐 때 것이 나올 수 있어 한 번 미리 엶
            if ck: get('/my', ck)
            ens = [get_any(u, 'sgb_lang=en') for u in GUEST] + [get_any(u, ck + '; sgb_lang=en') for u in MINE]
            noen = [u for u, x in zip(GUEST + MINE, ens) if '<html lang="en"' not in x and u != '/no-such-page-xyz']   # 없는 주소 화면은 빌드 때 미리 그려 둔 판(언어 쿠키를 보지 않음 · docs/159 §3-1)
            ok('④ 켬 + 쿠키 en → 2-5b 화면이 영어(html lang=en)', not noen, ' '.join(noen[:4]))
            for u, x in zip(GUEST + MINE, ens):
                if u in noen: print("   ", u, re.search(r"<html[^>]*>", x).group(0) if re.search(r"<html[^>]*>", x) else x[:300])
            leak = [m for x in ens for m in re.findall(NSRE, re.sub(r'<script[\s\S]*?</script>', '', x))]
            ok('④ 영어에서도 사전 키가 새지 않음', not leak, ' '.join(leak[:4]))
        finally:
            en_on, en_act = (before.split(',') + ['off', 'f'])[:2]
            psql(f"UPDATE site_settings SET value='{en_on or 'off'}' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active={'true' if en_act == 't' else 'false'} WHERE code='en';")
            restart_site()

_v = tuple(int(x) for x in re.findall(r'\d+', rd('VERSION')))
ok('VERSION v10.101 이상', _v >= (10, 101), '.'.join(map(str, _v)))
bad = [x for x in RES if not x[0]]
print(f'\n결과 — 통과 {len(RES) - len(bad)} · 실패 {len(bad)}')
raise SystemExit(1 if bad else 0)
