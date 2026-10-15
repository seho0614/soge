"""사용자 웹의 날짜 · 시각이 서버 시간대와 관계없이 한국 시각으로 나오는지 (v10.20 · G-125 · G-126)

왜: 개발 Docker · AWS 의 서버는 UTC 입니다. 날짜를 글로 바꿀 때 시간대를 주지 않으면
    ① 서버가 그린 화면에는 UTC 날짜(한국 0 ~ 9시의 일은 하루 전), 브라우저가 다시 그리면 한국 날짜 → 글이 달라 수화 오류(React #418)
    ② 서버만 그리는 화면은 계속 UTC 날짜 · 시각(9시간 늦음)
    작업 환경(한국 시각)에서는 드러나지 않아, 서버를 일부러 TZ=UTC 로 띄워 봅니다.

  S. 소스 점검   site/src 에서 날짜 → 글(toLocaleDateString · toLocaleTimeString · Date 의 toLocaleString · Intl.DateTimeFormat)에 timeZone 이 빠진 곳 0
  D. 실제 화면   TZ=UTC 로 띄운 사용자 웹(운영 빌드) + 한국 시각 브라우저
                 「내 구독」: 이용 기간이 한국 날짜 · 서버가 그린 글과 브라우저가 그린 글이 같음 · 콘솔 오류 0
                 건강몰 주문 내역: 한국 0 ~ 9시에 넣은 주문의 주문일이 한국 날짜

사용:  python3 site_tz.py     API=http://localhost:3000  DB=postgresql://sgb:sgb@localhost:5432/sgb  SITE_UTC=http://localhost:5177 (없으면 스스로 띄우고 끕니다)
결과:  site_tz.json
"""
import json, os, re, subprocess, sys, time, urllib.request, uuid, signal
from playwright.sync_api import sync_playwright

_kit = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sgb')
K = os.environ.get('KIT') or (_kit if os.path.isdir(os.path.join(_kit, 'site')) else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
API = os.environ.get('API', 'http://localhost:3000').rstrip('/'); B = API if API.endswith('/api/v1') else API + '/api/v1'
DB = os.environ.get('DB', 'postgresql://sgb:sgb@localhost:5432/sgb')
SITE = os.environ.get('SITE_UTC', 'http://localhost:5177').rstrip('/')
OUT = os.path.dirname(os.path.abspath(__file__)); PW = 'sgb-test-1234'
R = []
def rec(step, ok, detail='', skip=False):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:400], **({'skip': True} if skip else {})})
    print('ok  ' if ok else 'FAIL', step, '' if ok else str(detail)[:300], file=sys.stderr)
def q(sql):
    r = subprocess.run(['psql', DB, '-v', 'ON_ERROR_STOP=1', '-tAc', sql], capture_output=True, text=True)
    if r.returncode: raise RuntimeError(r.stderr.strip()[:300])
    return r.stdout.strip().split('\n')[0]
def call(m, p, tok=None, body=None):
    h = {'content-type': 'application/json', 'Idempotency-Key': uuid.uuid4().hex}
    if tok: h['authorization'] = 'Bearer ' + tok
    data = json.dumps(body).encode() if body is not None else (b'{}' if m in ('POST', 'PATCH') else None)
    try: r = urllib.request.urlopen(urllib.request.Request(B + p, method=m, data=data, headers=h), timeout=30); return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')
def up(url):
    try: return urllib.request.urlopen(url, timeout=5).status == 200
    except Exception: return False

# ── S. 소스 점검 ─────────────────────────────────────────────────────────
bad = []
PAT = [re.compile(r'\.toLocaleDateString\(([^()]*(?:\([^()]*\))?[^()]*)\)'), re.compile(r'\.toLocaleTimeString\(([^()]*(?:\([^()]*\))?[^()]*)\)'),
       re.compile(r'new Date\([^()]*\)\.toLocaleString\(([^()]*(?:\([^()]*\))?[^()]*)\)'), re.compile(r'Intl\.DateTimeFormat\(([^()]*(?:\([^()]*\))?[^()]*)\)')]
n_date = 0
for root, _, files in os.walk(os.path.join(K, 'site', 'src')):
    for f in files:
        if not f.endswith(('.ts', '.tsx')): continue
        p = os.path.join(root, f); src = open(p, encoding='utf-8').read()
        for i, line in enumerate(src.split('\n'), 1):
            for pat in PAT:
                for m in pat.finditer(line):
                    n_date += 1
                    if 'timeZone' not in m.group(1): bad.append(f"{os.path.relpath(p, os.path.join(K, 'site', 'src'))}:{i}  {m.group(0)[:70]}")
# v10.27 — 화면 22개 파일의 날짜 → 글은 lib/format.ts 의 한국 날짜 함수(ymdKst · dtKst · hmKst)로 바꿨습니다 — 그 함수가 timeZone 을 주는지 + 쓰는 곳 수를 함께 셉니다
FMT = open(os.path.join(K, 'site', 'src', 'lib', 'format.ts'), encoding='utf-8').read()
def _body(h):      # 그 함수의 본문(다음 export 앞까지)
    m = re.search(r'export function ' + h + r'\b([\s\S]*?)(?=\nexport |\Z)', FMT); return m.group(1) if m else ''
# ymdKst · dtKst 는 스스로 timeZone 'Asia/Seoul' 을 주고, hmKst 는 dtKst 를 거쳐 씁니다
helper_ok = all("timeZone: 'Asia/Seoul'" in _body(h) for h in ('ymdKst', 'dtKst')) and 'dtKst(' in _body('hmKst')
n_helper = 0
for root, _, files in os.walk(os.path.join(K, 'site', 'src')):
    for f in files:
        if f.endswith(('.ts', '.tsx')) and f != 'format.ts':
            n_helper += len(re.findall(r'\b(?:ymdKst|dtKst|hmKst)\(', open(os.path.join(root, f), encoding='utf-8').read()))
rec(f'S-1 날짜 → 글 {n_date}곳 + 한국 날짜 함수 쓰는 곳 {n_helper}곳 — 모두 timeZone 을 줌(서버 시간대와 관계없이 한국 시각) · 빠진 곳 {len(bad)}', n_date + n_helper >= 10 and helper_ok and not bad, (bad[:30], helper_ok, n_helper))

bad2 = []; n2 = 0
for root, _, files in os.walk(os.path.join(K, 'src')):
    for f in files:
        if not f.endswith('.ts'): continue
        p = os.path.join(root, f)
        for i, line in enumerate(open(p, encoding='utf-8').read().split('\n'), 1):
            for pat in PAT:
                for m in pat.finditer(line):
                    n2 += 1
                    if 'timeZone' not in m.group(1): bad2.append(f"{os.path.relpath(p, K)}:{i}  {m.group(0)[:70]}")
rec(f'S-2 서버(API)가 안내 글에 넣는 날짜 {n2}곳도 timeZone 을 줌 — 빠진 곳 {len(bad2)}', not bad2, bad2[:10])

# ── D. TZ=UTC 서버 ───────────────────────────────────────────────────────
proc = None; aproc = None
API_UTC = os.environ.get('API_UTC', 'http://localhost:3177').rstrip('/')
if not up(API_UTC + '/api/v1/health'):
    aenv = {**os.environ, 'TZ': 'UTC', 'PORT': API_UTC.rsplit(':', 1)[-1], 'DATABASE_URL': DB, 'NODE_ENV': 'development',
            'JWT_SECRET': os.environ.get('JWT_SECRET', 'docker-test-secret-0123456789abcdef'), 'JOB_TOKEN': os.environ.get('JOB_TOKEN', 'docker-test-job-token-0123456789abcdef'),
            'ENC_KEY': os.environ.get('ENC_KEY', 'docker-dev-enc-key-0123456789abcdef')}
    aenv.pop('TOSS_SECRET_KEY', None)
    aproc = subprocess.Popen(['node', 'dist/main.js'], cwd=K, env=aenv, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    for _ in range(60):
        if up(API_UTC + '/api/v1/health'): break
        time.sleep(1)
if not up(SITE + '/login'):
    port = SITE.rsplit(':', 1)[-1]
    env = {**os.environ, 'TZ': 'UTC', 'API_ORIGIN': API_UTC, 'API_BASE': API_UTC + '/api/v1'}
    proc = subprocess.Popen(['npx', 'next', 'start', '-p', port], cwd=os.path.join(K, 'site'), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    for _ in range(40):
        if up(SITE + '/login'): break
        time.sleep(1)
try:
    rec('D-0 TZ=UTC 로 띄운 API · 사용자 웹이 열림', up(SITE + '/login') and up(API_UTC + '/api/v1/health'), (SITE, API_UTC))
    # 구독 회원 — 이용 기간을 「UTC 로는 10/5 · 11/4, 한국 시각으로는 10/6 · 11/5」인 때로 둡니다(한국 01:30)
    e = f'tz_{uuid.uuid4().hex[:8]}@t.local'
    st, j = call('POST', '/auth/signup', body={'email': e, 'password': PW, 'name': '시간대시험'}); assert st < 300, (st, j)
    aid = q(f"select id from accounts where email='{e}'"); q(f"insert into account_roles(account_id, role) values ('{aid}','BIZ_OWNER') on conflict do nothing")
    tok = call('POST', '/auth/login', body={'email': e, 'password': PW})[1]['accessToken']
    st, j = call('POST', '/subscriptions', tok, {'planCode': 'STANDARD', 'paymentKey': 'tpk_' + uuid.uuid4().hex[:18], 'orderId': 'ord_' + uuid.uuid4().hex[:18]}); assert st < 300, (st, j)
    sub = j['subscriptionId']; fixed = True
    try:
        q(f"update subscriptions set current_period_start='2026-10-05T16:30:00Z', current_period_end='2026-11-04T16:30:00Z' where id='{sub}'")
        want, wrong = ['2026. 10. 6.', '2026. 11. 5.'], ['2026. 10. 5.', '2026. 11. 4.']
        want2, wrong2 = ['2026-10-06', '2026-11-05'], ['2026-10-05', '2026-11-04']      # v10.27 — 「내 구독」은 ymdKst(YYYY-MM-DD)로 씀
    except RuntimeError as ex:
        fixed = False      # 트리거가 막으면 지금의 기간으로 — 한국 날짜와 UTC 날짜가 다를 때만 가려낼 수 있습니다
        kst = q(f"select to_char(current_period_start at time zone 'Asia/Seoul','YYYY. FMMM. FMDD.')||'|'||to_char(current_period_end at time zone 'Asia/Seoul','YYYY. FMMM. FMDD.') from subscriptions where id='{sub}'").split('|')
        utc = q(f"select to_char(current_period_start at time zone 'UTC','YYYY. FMMM. FMDD.')||'|'||to_char(current_period_end at time zone 'UTC','YYYY. FMMM. FMDD.') from subscriptions where id='{sub}'").split('|')
        want, wrong = kst, [u for u, k in zip(utc, kst) if u != k]
        k2 = q(f"select to_char(current_period_start at time zone 'Asia/Seoul','YYYY-MM-DD')||'|'||to_char(current_period_end at time zone 'Asia/Seoul','YYYY-MM-DD') from subscriptions where id='{sub}'").split('|')
        u2 = q(f"select to_char(current_period_start at time zone 'UTC','YYYY-MM-DD')||'|'||to_char(current_period_end at time zone 'UTC','YYYY-MM-DD') from subscriptions where id='{sub}'").split('|')
        want2, wrong2 = k2, [u for u, k in zip(u2, k2) if u != k]
    with sync_playwright() as p:
        br = p.chromium.launch()
        def login(ctx, email, pw):
            pg = ctx.new_page(); pg.goto(SITE + '/login', wait_until='networkidle'); __import__('consent_ok').agree(email, pw); pg.fill('input[name=email]', email); pg.fill('input[name=password]', pw)
            pg.locator('button', has_text='로그인').last.click(); pg.wait_for_timeout(2500); pg.close()
        # 서버가 그린 글(스크립트를 끈 브라우저)
        c0 = br.new_context(java_script_enabled=True, timezone_id='Asia/Seoul'); login(c0, e, PW); cookies = c0.cookies(); c0.close()
        c1 = br.new_context(java_script_enabled=False, timezone_id='Asia/Seoul'); c1.add_cookies(cookies); pg = c1.new_page()
        r = pg.goto(SITE + '/my/subscription'); ssr = pg.inner_text('[data-sub-manage]') if pg.locator('[data-sub-manage]').count() else pg.inner_text('body')[:600]
        rec(f"D-1 「내 구독」 서버가 그린 글: 이용 기간 · 다음 청구가 한국 날짜({' ~ '.join(want)})" + ('' if fixed else ' (기간을 고정하지 못해 지금 기간으로 봄)'),
            r.status == 200 and ((all(w in ssr for w in want) and not any(w in ssr for w in wrong)) or (all(w in ssr for w in want2) and not any(w in ssr for w in wrong2))), ssr[:300])
        c1.close()
        # 브라우저가 다시 그린 뒤(한국 시각) — 글이 같고 오류가 없음
        c2 = br.new_context(timezone_id='Asia/Seoul'); c2.add_cookies(cookies); pg = c2.new_page(); errs = []
        pg.on('pageerror', lambda x: errs.append(str(x)[:200])); pg.on('console', lambda m: errs.append(m.text[:200]) if m.type == 'error' else None)
        pg.goto(SITE + '/my/subscription', wait_until='networkidle'); pg.wait_for_timeout(400)
        csr = pg.inner_text('[data-sub-manage]') if pg.locator('[data-sub-manage]').count() else ''
        rec('D-2 「내 구독」 브라우저(한국 시각)가 다시 그린 글이 서버가 그린 글과 같음 · 콘솔 오류 0(수화 오류 없음)', csr.strip() == ssr.strip() and not errs, (errs[:2], csr[:120]))
        c2.close()
        # 건강몰 주문 내역 — 한국 날짜와 UTC 날짜가 다른 주문(한국 0 ~ 9시). v10.25 — 소개몰의 날짜 표기가 시안대로 「2026.10.08」이 됐습니다(전: 「2026. 10. 8.」)
        row = q("""select o.order_no||'|'||to_char(o.created_at at time zone 'Asia/Seoul','YYYY.MM.DD')||'|'||to_char(o.created_at at time zone 'UTC','YYYY.MM.DD')
                     from hlt_orders o where o.account_id=(select id from accounts where email='buyer@x.com')
                      and (o.created_at at time zone 'UTC')::date <> (o.created_at at time zone 'Asia/Seoul')::date order by o.created_at desc limit 1""")
        if row:
            no, kst, utc = row.split('|')
            c3 = br.new_context(timezone_id='Asia/Seoul'); login(c3, 'buyer@x.com', 'sgb-dev-1234'); ck = c3.cookies(); c3.close()
            c4 = br.new_context(java_script_enabled=False); c4.add_cookies(ck); pg = c4.new_page()
            r = pg.goto(f'{SITE}/my/health/orders/{no}'); t = pg.inner_text('main') if pg.locator('main').count() else ''
            line = next((x for x in t.split('\n') if re.match(r'^주문\s+\d{4}\.', x)), '')            # 「주문 <날짜 시각>」 줄 — 다른 줄(발송 · 배송 완료)의 날짜와 섞이지 않게 그 줄만 봅니다
            rec(f'D-3 건강몰 주문 상세({no}): 서버가 그린 주문일이 한국 날짜({kst}) — UTC 날짜({utc})가 아님', r.status == 200 and kst in line and utc not in line, (line, t[:160]))
            c4.close()
        else:
            rec('D-3 건강몰 주문 상세 — 한국 0 ~ 9시에 넣은 주문이 없어 건너뜀(소스 점검 S-1 이 대신 봄)', True, '', skip=True)
        br.close()
    # 서버(API)가 만드는 안내 글의 날짜 — TZ=UTC 로 띄운 API 에 해지를 요청
    def ucall(m, pth, tok_, body=None):
        h = {'content-type': 'application/json', 'Idempotency-Key': uuid.uuid4().hex, 'authorization': 'Bearer ' + tok_}
        try: r_ = urllib.request.urlopen(urllib.request.Request(API_UTC + '/api/v1' + pth, method=m, data=(json.dumps(body).encode() if body is not None else (b'{}' if m == 'POST' else None)), headers=h), timeout=30); return r_.status, json.loads(r_.read() or b'null')
        except urllib.error.HTTPError as ex: return ex.code, json.loads(ex.read() or b'null')
    st, j = ucall('POST', '/me/subscription/cancel', tok, {})
    msg = json.dumps(j, ensure_ascii=False)
    rec(f"D-4 TZ=UTC 인 API 의 해지 안내 글: 「{want[-1]}까지 이용」(한국 날짜) — UTC 날짜가 아님", st < 300 and (want[-1] + '까지') in msg and not any((w + '까지') in msg for w in wrong), msg[:300])
finally:
    for pr in (proc, aproc):
        if pr is not None:
            try: os.killpg(os.getpgid(pr.pid), signal.SIGTERM)
            except Exception: pass
ok = sum(1 for r in R if r['ok'])
json.dump({'items': R, 'pass': ok, 'total': len(R)}, open(os.path.join(OUT, 'site_tz.json'), 'w'), ensure_ascii=False, indent=1)
print(f'통과 {ok} / {len(R)}')
