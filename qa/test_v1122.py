"""v10.122 시험 — 로그인한 화면의 영어(코드 이름표 · API 안내 · 은행 이름 · docs/186)

  KIT=$K SITE=http://localhost:15174 API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb python3 -I test_v1122.py

  ① 사전 codes — 한국어가 DB code_labels(손님 · 회원에게 보이는 것)와 똑같음 · ko/en 키 같음 · 영어 빈칸 없음
  ② 이름표 바꾸기는 사용자 웹이 API 응답을 받는 곳 한 군데(apiGet · apiGetPersonal · apiGetVisitor — 공개 응답 apiGetPublic 은 빼고) ·
     getLocale 오류를 잡지 않음(잡으면 빌드가 멈춤)
  ③ 파트너 등록 방식 · 단계 · 블록 사전이 API(FORM_KO · FORM_STEPS · BLOCK_KO)와 같은 순서 · 같은 글자 · 은행 코드가 두 화면 목록과 같음 ·
     추천 가중치 코드가 DB 와 같음 · 새 사전 키 ko/en 같음
  ④ (사용자 웹) 영어 켜고 — 단가표 · 정산 계좌 · 거래 목록 · 분쟁 · 추천 화면이 영어 · 한국어 화면은 서버 글자 그대로 — 끝나면 원래대로
"""
import json, os, re, subprocess, time, urllib.error, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
SITE = os.environ.get('SITE'); API = os.environ.get('API'); DB = os.environ.get('DB')
M = 'site/src/i18n/messages/'
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


def js(rel):
    return json.loads(rd(rel) or '{}')


def flat(d, pre=''):
    out = {}
    for k, v in d.items():
        if isinstance(v, dict): out.update(flat(v, pre + k + '.'))
        else: out[pre + k] = v
    return out


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return r.stdout.strip()


# ① 사전 codes
ck, ce = flat(js(M + 'ko/codes.json')), flat(js(M + 'en/codes.json'))
ok('① codes ko/en 키 같음 · 영어 빈칸 · 한글 없음', ck and set(ck) == set(ce) and all(v and not re.search(r'[가-힣]', v) for v in ce.values()), f'{len(ck)}개')
if DB:
    rows = {f'{d}.{c}': l for d, c, l in (x.split('|') for x in psql("SELECT domain, code, label FROM code_labels WHERE is_active AND audience = 'ALL'").splitlines())}
    ok('① codes 한국어 = DB code_labels(audience ALL)', rows == ck, f'DB {len(rows)} · 사전 {len(ck)} · 다름 {[k for k in set(rows) | set(ck) if rows.get(k) != ck.get(k)][:4]}')

# ② 바꾸는 곳
API_TS = rd('site/src/lib/api.ts'); CL = rd('site/src/lib/codeLabels.ts')
fn = {m.group(1): m.group(2) for m in re.finditer(r'export async function (\w+)<T>\([^)]*\): Promise<T> \{([\s\S]*?)\n\}', API_TS)}
ok('② apiGet · apiGetPersonal · apiGetVisitor 는 이름표를 바꾸고 apiGetPublic 은 그대로',
   all('localizeLabels(' in fn.get(n, '') for n in ('apiGet', 'apiGetPersonal', 'apiGetVisitor')) and 'localizeLabels(' not in fn.get('apiGetPublic', 'x'), str(sorted(fn)))
ok('② 한국어면 그대로 · …Label · label 칸만 · 겹치는 한국어는 안 바꿈 · getLocale 오류를 잡지 않음',
   "if (locale === 'ko') return body;" in CL and 'Label)$/' in CL and '겹침 → null' in CL and 'const locale = await getLocale();' in CL
   and not re.search(r'try\s*\{[^}]*getLocale', CL), '')
ok('② 화면 언어 갈래 f.srv(서버, 사전) — 한국어는 서버 글자', "srv: (server: string | null | undefined, other: string) => (loc === 'ko' && server ? server : other)" in rd('site/src/lib/fmtBind.ts'), '')

# ③ 파트너 등록 사전 = API 상수
PC = rd('src/modules/partner/partner-center.service.ts'); PF = rd('src/modules/partner/partner-service-form.service.ts')
fko = dict(re.findall(r"(\w+): '([^']+)'", re.search(r'FORM_KO[^{]*\{([\s\S]*?)\};', PC).group(1)))
steps = {k: re.findall(r"'([^']+)'", v) for k, v in re.findall(r'(\w+): \[([^\]]*)\]', re.search(r'FORM_STEPS[^{]*\{([\s\S]*?)\};', PC).group(1))}
bko = dict(re.findall(r"(\w+): '([^']+)'", re.search(r'BLOCK_KO[^{]*\{([\s\S]*?)\};', PF).group(1)))
sf_k, sf_e = js(M + 'ko/partnerOps.json').get('svcForm', {}), js(M + 'en/partnerOps.json').get('svcForm', {})
ok('③ 등록 방식 · 단계(순서) · 블록 사전 한국어 = API', fko and sf_k.get('form') == fko and sf_k.get('block') == bko
   and {k: [sf_k.get('step', {}).get(k, {}).get(str(i)) for i in range(len(v))] for k, v in steps.items()} == steps, f'방식 {len(fko)} · 블록 {len(bko)} · 단계 {sum(map(len, steps.values()))}')
ok('③ 등록 사전 영어 — 키 같음', flat(sf_k).keys() == flat(sf_e).keys(), '')
banks = lambda p: re.findall(r"\['(\d{3})', '([^']+)'\]", rd(p))
bk, be = js(M + 'ko.json').get('bank', {}), js(M + 'en.json').get('bank', {})
ok('③ 은행 사전 = 두 화면 목록(PayoutBox · SettlementAccountForm) · ko/en 키 같음',
   dict(banks('site/src/app/my/settlement/PayoutBox.tsx')) == bk == dict(banks('site/src/components/partners/SettlementAccountForm.tsx')) and set(bk) == set(be), f'{len(bk)}곳')
mw = js(M + 'ko/join.json').get('ai', {}).get('match', {}).get('w', {})
if DB:
    ok('③ 추천 가중치 사전 = DB recommend_weights', dict(x.split('|') for x in psql('SELECT code, name FROM recommend_weights').splitlines()) == mw, str(mw))
NEW = [('affiliate', 'dash.noteSrv'), ('affiliate', 'settlements.noteSrv'), ('affiliate', 'revenues.noteSrv'), ('affiliate', 'revenues.memo.pending'),
       ('billing', 'pricing.noteSrv'), ('billing', 'pricing.rangeMx'), ('partner', 'perf.noteSrv'), ('partner', 'biz.notesSrv.info'), ('partner', 'stats.ungraded'),
       ('partnerOps', 'settle.noteSrv'), ('partnerOps', 'svcNew.noteSrv'), ('myDeal', 'intro.regToMatch'), ('join', 'ai.match.w.loc')]
miss = [f'{n}.{k}' for n, k in NEW if not (flat(js(f'{M}ko/{n}.json')).get(k) and flat(js(f'{M}en/{n}.json')).get(k))]
ok(f'③ 새 사전 키 {len(NEW)}개 ko/en 모두', not miss, ' · '.join(miss))
srv_same = [(PC, '계약 성사형은 파트너가 이행을 보고하고 소비자가 확인해야 성사로 잡힙니다. 성사는 확인비용과 무관합니다.', flat(js(M + 'ko/partner.json')).get('perf.noteSrv')),
            (rd('src/modules/affiliate/affiliate.service.ts'), '정산 계좌를 등록하고 인증하셔야 지급됩니다.', flat(js(M + 'ko/affiliate.json')).get('settlements.noteSrv'))]
ok('③ 사전 한국어가 서버 안내와 같은 글자(예 2개)', all(t in src and t == v for src, t, v in srv_same), '')
ok('③ 판 v10.122 · 마이그레이션 없음(163)', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 122) and len([d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d))]) in (163, 164, 165, 166, 167, 168, 169, 170, 171), rd('VERSION').strip())


# ④ 사용자 웹
def get(path, cookie=''):
    req = urllib.request.Request(SITE + path, headers={'Cookie': cookie, 'User-Agent': 'test_v1122'})
    try: h = urllib.request.urlopen(req, timeout=120).read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e: h = e.read().decode('utf-8', 'replace')
    return re.sub(r'<script[\s\S]*?</script>', '', h)


def login(email):
    r = urllib.request.Request(API + '/auth/login', data=json.dumps({'email': email, 'password': 'sgb-dev-1234'}).encode(), headers={'content-type': 'application/json'}, method='POST')
    return 'sgb_at=' + json.load(urllib.request.urlopen(r, timeout=30))['accessToken']


def restart_site():
    subprocess.run(['docker', 'restart', 'sgb-site'], capture_output=True)   # 언어 목록 캐시(60초)를 비움 · 운영 방식이면 다시 빌드(몇 분)
    for _ in range(200):
        try:
            if '<html' in get('/login'): return
        except Exception: pass
        time.sleep(5)


if SITE and API and DB:
    I, B = login('intro@x.com'), login('buyer@x.com')
    deal = psql("SELECT d.id FROM deals d JOIN accounts a ON a.id = d.buyer_account_id WHERE a.email = 'buyer@x.com' AND d.status = 'PAYMENT_REPORTED' LIMIT 1")
    CHK = [  # (주소, 쿠키, 한국어에 있어야 할 글자, 영어에 있어야 할 글자, 영어에 없어야 할 글자)
        ('/partner/pricing', I, '건당', 'Per case', '건당'),
        ('/partners/settlements', I, '국민은행', 'KB Kookmin Bank', '국민은행'),
        ('/support/dispute', B, '소개 사실이 없습니다', 'There was no referral', '소개 사실이 없습니다'),
        ('/ai/match', B, '지역 적합', 'Region fit', '지역 적합'),
    ] + ([(f'/deal/{deal}/confirm', B, '대금 지급 신고됨', 'Payment reported', '대금 지급 신고됨')] if deal else [])
    ko_ = {u: get(u, c) for u, c, *_ in CHK}
    ok(f'④ 한국어 화면 {len(CHK)}곳 — 서버 글자 그대로', all(k in ko_[u] for u, c, k, *_ in CHK), ' · '.join(u for u, c, k, *_ in CHK if k not in ko_[u]))
    before = psql("SELECT (SELECT value FROM site_settings WHERE key='i18n.enabled') || '|' || (SELECT is_active FROM i18n_langs WHERE code='en')")
    try:
        psql("UPDATE site_settings SET value='on' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active=true WHERE code='en';")
        restart_site()
        get('/my', I + '; sgb_lang=en'); get('/my', B + '; sgb_lang=en')   # 토큰마다 언어 목록 캐시 — 한 번 미리
        en_ = {u: get(u, c + '; sgb_lang=en') for u, c, *_ in CHK}
        bad = [u for u, c, k, e, no in CHK if e not in en_[u] or no in en_[u]]
        ok(f'④ 영어 화면 {len(CHK)}곳 — 사전 글자 · 한국어 없음', not bad, ' · '.join(bad))
        ko2 = {u: get(u, c) for u, c, *_ in CHK}
        ok('④ 영어를 켜도 한국어 쿠키 화면은 서버 글자 그대로', all(k in ko2[u] for u, c, k, *_ in CHK), '')
    finally:
        en0, act0 = (before.split('|') + ['off', 'f'])[:2]
        psql(f"UPDATE site_settings SET value='{en0 or 'off'}' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active={'true' if act0 == 't' else 'false'} WHERE code='en';")
        restart_site()

n = sum(1 for r in RES if r[0])
print(f'결과: {n} / {len(RES)}')
raise SystemExit(0 if n == len(RES) else 1)
