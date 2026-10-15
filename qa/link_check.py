"""연동 테스트 — 연결 구간을 하나씩 실제로 불러 봅니다.  (v10.25 점검 보강 · 2026-10-08)

  A. 화면 ↔ API          사용자 웹(서버 쪽 조회 · 브라우저 쪽 /api 넘김 · 로그인) · 운영 화면 · 화면이 부르는 주소가 모두 실제 API 인지
  B. 시안 ↔ 서버         사용자 웹이 내주는 시안 = 킷의 시안(3벌 같은 파일)
  C. 서버 ↔ 서버         예약 작업(스케줄러 → API · X-Job-Token) · 광고 서버 → 본체(내부 키) · 광고 노출 기록 · 동시 조회(DB 연결 풀)
  D. 외부 연동 7건       상태 표 = 운영 API · 키 이름이 서버 코드가 읽는 환경 변수와 같은지 · 연동 전에는 「시험(스텁)」 표식이 나가는지
  E. 간주 모드 3종       켜져 있는 것 · 공개 설정으로 내려가는 값 · 오픈 막는 항목에 잡히는지 · 어디가 그 값을 읽는지

가짜 상대 서버를 세워 실제 HTTP 로 보는 어댑터 시험(토스 · S3 · 1원 인증 · 중개사 · 국세청 · 정기결제)은 전수 검정 B 구간의 묶음(srv_pay · srv_file · srv_lead · srv_billing · srv_consult)이 합니다 — 매트릭스 「연동 테스트」 시트가 이번 실행 결과를 함께 싣습니다.
**실제 외부 기관(토스 · 국세청 · 금융결제원 등)으로는 보내지 않습니다**(키 없음). 그 구간은 「실연동 미확인」입니다.

사용:  python3 link_check.py     API · SITE · BO · KIT · DB · JOB_TOKEN
"""
import concurrent.futures, hashlib, json, os, re, subprocess, sys, time, uuid, urllib.request, urllib.error
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flow_lib import bo_groups, bo_tab   # v10.29 — 운영 화면 묶음 메뉴

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
B = os.environ.get('API', 'http://localhost:3000/api/v1')
SITE = os.environ.get('SITE', 'http://localhost:5174')
BO = os.environ.get('BO', 'http://127.0.0.1:5173')
DB = os.environ.get('DB', 'postgresql://sgb:sgb@localhost:5432/sgb')
JOB = os.environ.get('JOB_TOKEN', 'docker-test-job-token-0123456789abcdef')
HERE = os.path.dirname(os.path.abspath(__file__))
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
R = []

def rec(step, ok, detail='', skip=False):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:400], **({'skip': True} if skip else {})})
    print(('건너뜀' if skip else 'ok  ' if ok else 'FAIL'), step, '|', str(detail)[:220], file=sys.stderr, flush=True)
def rows(sql):
    p = subprocess.run(['psql', DB, '-tA', '-F', '\t', '-c', sql], capture_output=True, text=True)
    assert p.returncode == 0, p.stderr[:300]
    return [l.split('\t') for l in p.stdout.strip().split('\n') if l]
def q(sql):
    r = rows(sql); return r[0][0] if r else ''
def http(m, url, headers=None, body=None, raw=False):
    h = {'user-agent': UA, **(headers or {})}
    data = None
    if body is not None: data = json.dumps(body).encode(); h['content-type'] = 'application/json'
    elif m in ('POST', 'PATCH'): data = b'{}'; h['content-type'] = 'application/json'
    req = urllib.request.Request(url, method=m, data=data, headers=h)
    try: r = urllib.request.urlopen(req, timeout=40); st = r.status; b = r.read(); hd = dict(r.headers)
    except urllib.error.HTTPError as e: st = e.code; b = e.read(); hd = dict(e.headers)
    if raw: return st, b, hd
    try: return st, json.loads(b) if b else None, hd
    except Exception: return st, None, hd
def call(m, p, tok=None, body=None, headers=None):
    h = {'Idempotency-Key': uuid.uuid4().hex, **(headers or {})}
    if tok: h['authorization'] = 'Bearer ' + tok
    st, j, _ = http(m, B + p, h, body); return st, j
def login(e, pw='sgb-dev-1234'):
    return (call('POST', '/auth/login', body={'email': e, 'password': pw})[1] or {}).get('accessToken')

def main():
    ADM = login('admin@x.com'); BUY = login('buyer@x.com'); INT = login('intro@x.com')
    mx = json.load(open(f'{KIT}/docs/matrix/matrix.json'))
    src = ''
    for root, _, files in os.walk(f'{KIT}/src'):
        if 'generated' in root: continue
        for f in files:
            if f.endswith('.ts'): src += open(os.path.join(root, f), encoding='utf8', errors='ignore').read() + '\n'
    def tree(d):
        s = ''
        for root, _, files in os.walk(d):
            if 'node_modules' in root or '.next' in root: continue
            for f in files:
                if f.endswith(('.ts', '.tsx')): s += open(os.path.join(root, f), encoding='utf8', errors='ignore').read() + '\n'
        return s
    site_src = tree(f'{KIT}/site/src'); web_src = tree(f'{KIT}/web/src')

    # ── A ── 화면 ↔ API
    st, h, _ = http('GET', B + '/health'); st2, h2, _ = http('GET', SITE + '/api/v1/health'); st3, h3, _ = http('GET', BO + '/api/v1/health')
    rec('A-1 사용자 웹의 /api 넘김 → API (GET {사용자 웹}/api/v1/health = API 의 응답 · db: true)', st == 200 and st2 == 200 and (h2 or {}).get('db') is True and (h2 or {}).get('status') == (h or {}).get('status'), (st2, h2))
    rec('A-2 운영 화면의 /api 넘김 → API (GET {운영 화면}/api/v1/health · db: true)', st3 == 200 and (h3 or {}).get('db') is True, (st3, h3))
    l = rows("select id, title from listings where status='PUBLISHED' and gwan_code='MNY' and created_at < now() - interval '10 minutes' order by created_at desc limit 1")
    lid, ltitle = l[0]
    st, b, _ = http('GET', f'{SITE}/money/{lid}', raw=True); html = b.decode('utf8', 'ignore')
    esc = lambda s: s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;').replace("'", '&#x27;')
    rec('A-3 사용자 웹의 서버 쪽 조회 → API → DB (매물 상세 쪽에 DB 의 그 제목이 그려짐)', st == 200 and (ltitle in html or esc(ltitle) in html), (st, ltitle[:30]))
    st, j = call('GET', f'/listings/{lid}')
    rec('A-3b 같은 매물을 API 로 읽어도 같은 제목', st == 200 and (j or {}).get('title') == ltitle, st)
    hp = rows("select code, name, price from hlt_products where status='ON_SALE' order by code limit 1")[0]
    st, b, _ = http('GET', f'{SITE}/health/p/{hp[0]}', raw=True); html = b.decode('utf8', 'ignore')
    rec('A-4 소개몰 상품 상세 — DB 의 이름 · 값이 화면에 그려짐', st == 200 and (hp[1] in html or esc(hp[1]) in html) and f'{int(hp[2]):,}' in html, (st, hp))
    # 브라우저 — 로그인(서버 액션) → 쿠키 → /api 넘김으로 내 자료
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        br = pw.chromium.launch(); ctx = br.new_context(); pg = ctx.new_page()
        pg.goto(SITE + '/login'); __import__('consent_ok').agree('buyer@x.com', 'sgb-dev-1234'); pg.fill('input[name=email]', 'buyer@x.com'); pg.fill('input[name=password]', 'sgb-dev-1234'); pg.click('form.auth button'); pg.wait_for_timeout(2500)
        ck = ctx.cookies(); names = sorted(c['name'] for c in ck); httponly = all(c['httpOnly'] for c in ck if 'token' in c['name'].lower() or c['name'] in ('sgb_at', 'sgb_rt', 'at', 'rt'))
        rec('A-5 사용자 웹 로그인(서버 액션 → API /auth/login) → 쿠키가 심김 · 스크립트가 못 읽는 쿠키(httpOnly)', len(ck) >= 1 and httponly and '/login' not in pg.url, (names, pg.url.replace(SITE, '')))
        r = ctx.request.get(SITE + '/api/v1/me/summary')
        bid = q("select id from accounts where email='buyer@x.com'")
        rec('A-6 브라우저 → 사용자 웹 /api 넘김 → API (쿠키만으로 내 요약 200 · 그 계정의 id)', r.status == 200 and bid in r.text(), r.status)
        r = br.new_context().request.get(SITE + '/api/v1/me/summary')
        rec('A-6b 쿠키 없이는 거절(401 · 403)', r.status in (401, 403), r.status)
        apis = []; pg.on('response', lambda res: apis.append((res.status, res.request.method, res.url.split('/api/v1')[-1][:50])) if '/api/' in res.url else None)
        pg.goto(SITE + '/my/health/orders', wait_until='networkidle'); body = pg.inner_text('body')
        ono = q("select o.order_no from hlt_orders o join accounts a on a.id=o.account_id where a.email='buyer@x.com' order by o.created_at desc limit 1")
        rec('A-7 로그인한 화면이 DB 의 내 주문을 그림(내 주문 쪽에 DB 의 최근 주문 번호)', bool(ono) and ono in body, ono)
        ctx.close()
        # 운영 화면
        ctx = br.new_context(); pg = ctx.new_page(); bad = []; okc = []
        pg.on('response', lambda res: (bad if res.status >= 400 else okc).append(f"{res.status} {res.request.method} {res.url.split('/api/v1')[-1][:40]}") if '/api/' in res.url else None)
        pg.goto(BO); pg.wait_for_timeout(800); __import__('consent_ok').agree('admin@x.com', 'sgb-dev-1234'); pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', 'sgb-dev-1234'); pg.click('form button[type=submit]'); pg.wait_for_timeout(1800)
        try: pg.wait_for_selector('.bo-head nav button', timeout=15000)
        except Exception: pass
        groups = bo_groups(pg); tabs = [t for _, ts in groups for t in ts]      # v10.29 — 묶음 단추(data-tabs) × 묶음 안 탭
        rec(f'A-8 운영 화면 로그인 → API → 묶음 {len(groups)}개 · 탭 {len(tabs)}개가 열림 · 실패한 API 응답 0', len(tabs) >= 30 and not bad, (len(okc), bad[:3]))   # v10.29
        i = tabs.index('외부 연동') if '외부 연동' in tabs else -1
        if i >= 0:
            bo_tab(pg, '외부 연동'); pg.wait_for_timeout(1500); main = pg.inner_text('.bo-main')      # v10.29
            names_ = [r_[0] for r_ in rows('select name from integrations')]
            rec('A-9 운영 화면 「외부 연동」이 DB 의 7건을 모두 그림', all(n in main for n in names_), [n for n in names_ if n not in main])
        ctx.close(); br.close()
    # 화면이 부르는 주소가 모두 실제 API 인가(매트릭스의 정적 대조)
    # 화면 코드의 주소는 변수 자리가 {} · 뒤가 조립되면 ** 로 적혀 있습니다 → 마디마다 견줌({} 는 어느 쪽이든 아무 마디 · ** 는 그 뒤 전부)
    keys = [(a['method'], re.sub(r':[A-Za-z]+', '{}', a['path']).strip('/').split('/')) for a in mx['apis']]
    def hit(c):
        m_, p_ = c.split(' ', 1); seg = p_.strip('/').split('/')
        for km, ks in keys:
            if km != m_: continue
            if seg and seg[-1] == '**':
                if len(ks) >= len(seg) - 1 and all(a_ == b_ or '{}' in (a_, b_) for a_, b_ in zip(seg[:-1], ks)): return True
            elif len(ks) == len(seg) and all(a_ == b_ or '{}' in (a_, b_) for a_, b_ in zip(seg, ks)): return True
        return False
    calls = {}
    for p in mx['pages']:
        for c in p.get('calls', []): calls.setdefault(p['app'], set()).add(c)
    un = {app: sorted(c for c in cs if not hit(c)) for app, cs in calls.items()}
    rec(f"A-10 화면 코드가 부르는 API 주소가 모두 서버에 있음 — 사용자 웹 {len(calls.get('site', []))}종 · 운영 화면 {len(calls.get('admin', []))}종 · 없는 주소 0", not any(un.values()), {k: v[:5] for k, v in un.items() if v})
    # 운영 화면은 로그인 토큰을 공용 함수 api() 가 머리말로 붙입니다 — fetch() 를 직접 쓰면 토큰이 빠져 서버가 403 으로 거절합니다(G-178)
    rawf = []
    for root, _, files in os.walk(f'{KIT}/web/src/app'):
        for f in files:
            if not f.endswith('.tsx'): continue
            for i, line in enumerate(open(os.path.join(root, f), encoding='utf8', errors='ignore').read().split('\n'), 1):
                m_ = re.search(r"fetch\(`?['\"]?(/api/v1/[^`'\"\s,)]*)?", line)
                if 'fetch(' in line and '/internal/' not in line: rawf.append(f"{f}:{i}")
    rec('A-12 운영 화면의 쓰기 요청이 모두 로그인 토큰을 붙이는 공용 함수(api)를 거침 — 직접 fetch() 로 보내는 곳 0(G-178)', not rawf, rawf)
    st_a, _, _ = http('PATCH', B + '/admin/reports/00000000-0000-4000-8000-000000000000/resolve', body={'state': 'DISMISSED', 'resolution': '점검'})
    rec('A-12b (사실 기록) 토큰 없는 운영 쓰기 요청은 서버가 거절(403) — 그래서 위 화면의 단추는 눌러도 처리되지 않음', st_a in (401, 403), st_a)
    nocall = [a for a in mx['apis'] if not a.get('callers')]
    cls = {}
    for a in nocall:
        p = a['path']; pat = re.escape(p.split('/:')[0]).replace(r'\/', '/')
        frag = p.split('/:')[0]
        where = ('사용자 웹(서버 쪽 호출 · 조립한 주소)' if frag in site_src else '운영 화면(조립한 주소)' if frag in web_src else
                 '서버끼리(스케줄러 · 웹훅 · 내부 키)' if re.search(r'/admin/jobs|/webhooks|/internal/', p) else '화면 없음(API 만)')
        cls.setdefault(where, []).append(a['method'] + ' ' + p)
    json.dump(cls, open(f'{HERE}/link_nocaller.json', 'w'), ensure_ascii=False, indent=1)
    rec(f"A-11 API {len(mx['apis'])}개 가운데 화면 코드와 이어진 것 {len(mx['apis']) - len(nocall)}개 · 정적 대조로 못 이은 {len(nocall)}개의 갈래", True, {k: len(v) for k, v in cls.items()})

    # ── B ── 시안 ↔ 서버
    ver = open(f'{KIT}/VERSION').read().strip().lstrip('v').replace('.', '_')
    name = f'SGB_Prototype_v{ver}.html'
    st, b, hd = http('GET', f'{SITE}/proto/{name}', raw=True)
    sha = lambda x: hashlib.sha256(x).hexdigest()[:16]
    files = {'킷 맨 위': f'{KIT}/../{name}', 'spec/proto.html': f'{KIT}/spec/proto.html', 'site/public/proto': f'{KIT}/site/public/proto/{name}'}
    hs = {k: sha(open(v, 'rb').read()) if os.path.exists(v) else '없음' for k, v in files.items()}
    rec(f'B-1 사용자 웹이 내주는 시안(/proto/{name})이 킷의 시안 3벌과 같은 파일', st == 200 and len(set(hs.values()) | {sha(b)}) == 1, (st, len(b), hs))
    try:
        sp = json.load(open(f'{HERE}/srv_proto.json')); sp = sp if isinstance(sp, list) else sp.get('items', [])
        rec(f"B-2 (참고) 시안 ↔ 서버 대조 묶음 srv_proto — 통과 {sum(1 for x in sp if x.get('ok'))} / {len(sp)}", all(x.get('ok') or x.get('skip') for x in sp), '')
    except Exception as ex:
        rec('B-2 (참고) 시안 ↔ 서버 대조 묶음 srv_proto 결과', False, str(ex)[:80])

    # ── C ── 서버 ↔ 서버
    s0, _, _ = http('POST', B + '/admin/jobs/tick'); s1, _, _ = http('POST', B + '/admin/jobs/tick', {'x-job-token': 'wrong-token-0123456789abcdef0123456789'})
    rec('C-1 예약 작업 실행 주소는 토큰 없이 · 틀린 토큰으로 403', s0 == 403 and s1 == 403, (s0, s1))
    s2, j2, _ = http('POST', B + '/admin/jobs/tick', {'x-job-token': JOB}); s3, j3, _ = http('POST', B + '/admin/jobs/tick', {'x-job-token': JOB})
    rec('C-2 맞는 토큰(X-Job-Token)이면 실행 — 곧바로 한 번 더 불러도 안전(같은 시간대 작업은 한 번만)', s2 in (200, 201) and s3 in (200, 201), (s2, json.dumps(j2, ensure_ascii=False)[:120], s3, json.dumps(j3, ensure_ascii=False)[:80]))
    sd = open(f'{KIT}/scripts/scheduler-daemon.js', encoding='utf8').read()
    rec('C-3 스케줄러(scripts/scheduler-daemon.js)가 부르는 주소 · 머리말이 그 API 와 같음', '/api/v1/admin/jobs/tick' in sd and re.search(r"x-job-token", sd, re.I) is not None, '')
    acc = q("select id from accounts where email='buyer@x.com'"); biz = q('select id from businesses limit 1')
    ik = q("select value from site_settings where key='internal.api_key'")
    a0, _, _ = http('GET', f'{B}/internal/businesses/{biz}'); a1, _, _ = http('GET', f'{B}/internal/businesses/{biz}', {'x-internal-key': 'x' * len(ik or 'x')})
    rec('C-4 광고 서버용 내부 API 는 키 없이 · 틀린 키로 403(회원 사업자 명부를 긁지 못하게)', a0 == 403 and a1 == 403, (a0, a1))
    if ik:
        a2, j, _ = http('GET', f'{B}/internal/businesses/{biz}', {'x-internal-key': ik}); a3, j3_, _ = http('GET', f'{B}/internal/accounts/{acc}/ad-profile', {'x-internal-key': ik})
        rec('C-5 맞는 내부 키(X-Internal-Key)면 사업자 실재 · 성향 조회 200', a2 == 200 and 'exists' in (j or {}) and a3 == 200, (a2, j, a3))
    else:
        rec('C-5 맞는 내부 키면 200', False, 'site_settings.internal.api_key 가 비어 있음')
    core = open(f'{KIT}/../sgb-ads/src/core/core-api.ts', encoding='utf8').read()
    sent = re.findall(r"headers:\s*\{\s*'([^']+)'", core)
    rec('C-6 광고 서버(sgb-ads)의 호출 코드가 본체와 같은 주소 · 같은 머리말(X-Internal-Key)을 씀(G-175)', '/internal/accounts/' in core and '/internal/businesses/' in core and [x.lower() for x in sent] == ['x-internal-key'], {'광고 서버가 보내는 머리말': sent, '본체가 읽는 머리말': 'x-internal-key'})
    rec('C-7 본체 서버는 광고 DB(sgb_ads)에 직접 붙지 않음(접속 문자열 없음 — 광고 쪽이 본체에 물어봄)', 'sgb_ads' not in src and 'ADS_DB' not in src, '')
    pl = rows("select id from ad_placements where status in ('ACTIVE','LIVE','ON') limit 1") if q("select count(*) from information_schema.columns where table_name='ad_placements' and column_name='status'") == '1' else []
    if not pl: pl = rows('select id from ad_placements limit 1')
    if pl:
        n0 = int(q('select count(*) from ad_events')); st, j = call('POST', f'/ads/{pl[0][0]}/impression'); n1 = int(q('select count(*) from ad_events'))
        rec('C-8 광고 노출 기록(POST /ads/:id/impression) → ad_events 에 한 줄', st < 300 and n1 == n0 + 1, (st, n0, n1, json.dumps(j, ensure_ascii=False)[:80]))
    else:
        rec('C-8 광고 노출 기록 → ad_events', True, '광고 자리 자료가 없음', skip=True)
    t0 = time.time()
    with concurrent.futures.ThreadPoolExecutor(40) as ex:
        sts = list(ex.map(lambda i: http('GET', B + ('/listings?gwanCode=MNY&limit=20' if i % 2 else '/health/products'))[0], range(80)))
    rec(f'C-9 조회 80건을 40개씩 동시에 — 모두 200(DB 연결 풀이 버팀 · {round(time.time()-t0,1)}초)', all(s == 200 for s in sts), {s: sts.count(s) for s in set(sts)})
    st, _, hd = http('GET', B + '/health', {'Origin': 'https://evil.example'})
    rec('C-10 API 는 다른 출처의 브라우저 호출을 허용하지 않음(CORS 허용 머리말 없음 — 화면은 같은 출처의 /api 넘김으로만 부름)', not any(k.lower() == 'access-control-allow-origin' for k in hd), [k for k in hd if k.lower().startswith('access-control')])

    # ── D ── 외부 연동 9건(v10.27 · D031 에서 국토부 중개사 자격 대조 BROKER · v10.34 D093 에서 전자세금계산서 ETAX 를 더함)
    dbi = rows('select code, name, status, coalesce(secret_key_name,\'\'), secret_registered, blocks_open from integrations order by sort_order, code')
    st, api_i = call('GET', '/admin/integrations', ADM); items = api_i if isinstance(api_i, list) else (api_i or {}).get('items') or (api_i or {}).get('rows') or []
    amap = {x.get('code'): x for x in items}
    rec(f'D-1 외부 연동 상태 — DB {len(dbi)}건 = 운영 API(GET /admin/integrations) {len(items)}건 · 상태 값이 같음', st == 200 and len(dbi) == len(items) == 9 and all(amap.get(r[0], {}).get('status') == r[2] for r in dbi), [(r[0], r[2]) for r in dbi])
    st, _ = call('GET', '/admin/integrations', BUY)
    rec('D-2 연동 상태는 운영자만(일반 회원 403)', st == 403, st)
    envs = set(re.findall(r'process\.env\.([A-Z0-9_]+)', src)) | set(re.findall(r"env\.([A-Z0-9_]+)", src))
    look = []
    for code, name, status, keyname, reg, blocks in dbi:
        reads = keyname in envs if keyname else None
        look.append({'code': code, 'name': name, 'status': status, 'key': keyname, 'code_reads_key': reads, 'secret_registered': reg == 't', 'blocks_open': blocks == 't'})
    json.dump(look, open(f'{HERE}/link_integrations.json', 'w'), ensure_ascii=False, indent=1)
    started = [x for x in look if x['status'] != 'NOT_STARTED']
    wrong = [f"{x['code']}: 화면 · 표의 키 이름 {x['key']} 을(를) 서버 코드가 읽지 않음" for x in look if x['key'] and x['code_reads_key'] is False and (x['status'] != 'NOT_STARTED' or x['code'] in ('PG', 'PASS', 'BANK', 'ESIGN'))]
    rec('D-3 연동 표의 키 이름(운영 화면 「외부 연동」에 보이는 이름) = 서버 코드가 읽는 환경 변수 이름 — 어댑터가 있는 연동 모두(G-174)', not wrong, wrong or [(x['code'], x['key']) for x in look])
    nocode = [x['code'] for x in look if x['key'] and x['code_reads_key'] is False and x['status'] == 'NOT_STARTED' and x['code'] not in ('PG', 'PASS', 'BANK', 'ESIGN')]
    rec('D-4 (사실 기록) 어댑터 코드가 아직 없는 연동 — 상태가 모두 「미착수」', all(x in ('ALIMTALK', 'SAFENUM') for x in nocode), nocode)
    # 연동 전 표식
    em = f'lnk_{uuid.uuid4().hex[:6]}@t.local'
    st, j = call('POST', '/auth/signup', body={'email': em, 'password': 'Sgb-lnk-1234!', 'name': '연동 시험', 'agreedTerms': []}); NEW = (j or {}).get('accessToken') or login(em, 'Sgb-lnk-1234!')
    st, j = call('POST', '/verifications/identity', NEW, {'provider': 'PASS'})
    rec('D-5 본인인증 — 키(PASS_API_KEY)가 없는 지금은 「시험(stub)」 표식이 응답에 실림', st < 300 and (j or {}).get('stub') is True, (st, j))
    st, j = call('GET', '/me/referral-codes/quota', INT)
    rec('D-6 결제 — 키(TOSS_SECRET_KEY)가 없는 지금은 「시험 결제(paymentStub)」 표식이 응답에 실림(GET /me/referral-codes/quota)', st == 200 and (j or {}).get('paymentStub') is True, (st, (j or {}).get('paymentStub')))
    st, pub = call('GET', '/site-settings/public')
    alim = q("select status from integrations where code='ALIMTALK'")
    cs = open(f'{KIT}/src/modules/partner/consult.service.ts', encoding='utf8').read()
    rec('D-7 알림톡 — 연동 전(미착수)에는 상담 신청의 인증번호를 문자로 보내지 못함 → 개발 환경에서만 응답에 실어 주고, 그 밖의 환경은 접수를 받지 않음(코드가 integrations.ALIMTALK 를 읽음)', alim == 'NOT_STARTED' and "integrations WHERE code = 'ALIMTALK'" in cs, alim)
    es = open(f'{KIT}/src/modules/deal/esign.provider.ts', encoding='utf8').read()
    rec('D-8 전자계약 — 키(ESIGN_API_KEY)가 없으면 stub 표식을 싣는 코드 경로', 'stub: true' in es and 'ESIGN_API_KEY' in es, '')
    rec('D-9 (사실 기록) 050 안심번호 — 서버에 호출 코드가 없음(도입 여부 미결 · 상태 「미착수」)', 'SAFENUM' not in src and q("select status from integrations where code='SAFENUM'") == 'NOT_STARTED', '')
    reg_true = [x['code'] for x in look if x['secret_registered']]
    rec('D-10 (사실 기록) 「키 등록됨」으로 표시된 연동 — 이 표시는 운영자가 손으로 켜는 값이며 서버가 환경 변수를 보고 정하지 않음(이 개발 환경에는 그 키가 없음)', True, {'표시 켜짐': reg_true, '이 환경의 키': [k for k in ('NTS_SERVICE_KEY', 'TOSS_SECRET_KEY', 'PASS_API_KEY', 'BANK_VERIFY_KEY', 'ESIGN_API_KEY') if os.environ.get(k)]})

    # ── E ── 간주 모드
    on = {r[0]: r[1] for r in rows('select key, value from v_assumed_on')}
    rec('E-1 간주 모드 4종(assume.payment · assume.broker · assume.bank · assume.etax — v10.34 전자세금계산서)이 지금 모두 켜짐(개발 기본값)', set(on) == {'assume.payment', 'assume.broker', 'assume.bank', 'assume.etax'}, on)
    rec('E-2 공개 설정 API 가 간주 값을 화면으로 내려 줌(화면이 「간주」 표식을 그릴 수 있게)', all((pub or {}).get(k) == 'on' for k in on), {k: (pub or {}).get(k) for k in on})
    oc = open(f'{KIT}/scripts/open-check.sh', encoding='utf8').read()
    rec('E-3 오픈 점검(scripts/open-check.sh)이 간주 모드를 「0이어야 함」으로 봄 — 켠 채로는 통과하지 못함(지금 켜진 수 ' + q('select count(*) from v_assumed_on') + ' · 가상 계좌 ' + q('select count(*) from v_bank_assumed') + ')',
        'FROM v_assumed_on;" "0"' in oc and 'FROM v_bank_assumed;" "0"' in oc, '')
    st, ob = call('GET', '/admin/open-blockers', ADM); obs = json.dumps(ob, ensure_ascii=False)
    kinds = sorted({x.get('kind') for x in (ob or [])})
    rec('E-3b (사실 기록 · G-176) 운영 화면 「오픈 체크리스트」(GET /admin/open-blockers)는 설정 · 약관 · 바닥줄 · 외부 연동만 보고 간주 모드는 보지 않음 — 간주는 쉘 점검과 「불변식」 탭이 봄', st == 200, {'지금 잡힌 갈래': kinds, '건수': len(ob or []), '간주 언급': ('간주' in obs or 'assume' in obs)})
    rec('E-3c (v10.27 · G-176) 중개사 자격 대조(국토부)가 외부 연동 표에 BROKER 로 있음(오픈 차단 · 키 이름 BROKER_LOOKUP_KEY) · 서버는 환경 변수(BROKER_LOOKUP_*)와 assume.broker 스위치로 동작', q("select count(*) from integrations where code='BROKER' and blocks_open and secret_key_name='BROKER_LOOKUP_KEY'") == '1' and 'BROKER_LOOKUP_URL' in src, q("select code, status, blocks_open, secret_key_name from integrations where code='BROKER'"))
    readers = {k: {'서버': len(re.findall(re.escape(k), src)), '사용자 웹': len(re.findall(re.escape(k), site_src)), '운영 화면': len(re.findall(re.escape(k), web_src)),
                   'DB 함수 · 뷰': int(q(f"select (select count(*) from pg_proc where prosrc like '%{k}%') + (select count(*) from pg_views where schemaname='public' and definition like '%{k}%')"))} for k in ('assume.payment', 'assume.broker', 'assume.bank')}
    json.dump(readers, open(f'{HERE}/link_assume.json', 'w'), ensure_ascii=False, indent=1)
    rec('E-4 (사실 기록) 간주 값을 읽는 곳 — assume.broker 는 서버가 읽어 중개사 대조를 건너뜀 · assume.payment 는 사용자 웹의 표시 · assume.bank 는 DB(가상 계좌 · 오픈 점검)', readers['assume.broker']['서버'] > 0 and readers['assume.payment']['사용자 웹'] > 0 and readers['assume.bank']['DB 함수 · 뷰'] > 0, readers)
    rec('E-5 (사실 기록) 실제 결제가 시험 결제인지는 assume.payment 가 아니라 결제 키(TOSS_SECRET_KEY)가 정함 — 스위치만 끄고 키를 안 넣으면 여전히 시험 결제', 'assume.payment' not in src and '!process.env.TOSS_SECRET_KEY' in src, '')

    json.dump(R, open(f'{HERE}/link_check.json', 'w'), ensure_ascii=False, indent=1)
    bad = [r for r in R if not r['ok']]
    print(f"\n통과 {sum(r['ok'] for r in R)} / {len(R)}" + (f" · 실패 {len(bad)}: " + ' · '.join(b['step'][:24] for b in bad) if bad else ''))

if __name__ == '__main__':
    main()
