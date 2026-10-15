"""10/3 v10.16 — 운영 방식 리허설 검증: 「9/30 에 세운 서버(API 만 · 마이그레이션 43)」를 흉내 낸 곳에 apply.sh 로 새 판을 올린 뒤,
실제 운영과 같은 길(브라우저 → Nginx(HTTPS) → 사용자 웹(next start) → API(node dist/main.js · production))로 확인합니다.   결과: aws_rehearsal.json

  A. 바깥 주소      https 로 메인 · 투표 화면 · API · 운영 화면 / 운영 API 문서 닫힘 / 메인이 실제 자료 판(live)
  B. 가입 · 로그인   https 에서 가입 → 로그인 유지(쿠키 Secure) · http(인증서 없이)에서는 유지되지 않음 · http://localhost(SSH 터널)에서는 유지됨
  C. 확정 질문 3건   올린 직후 투표 0건(카드 「준비 중」) → seed-polls.sql → 메인 카드 3장 · 다시 돌려도 3건
  D. 첫 관리자      가입한 계정에 SUPER 부여(SQL) → 운영 화면 로그인 → 「이건 어때? 투표」 만들기 → 열기 → 사용자 웹에 나옴
  E. 비로그인 투표   메인에서 투표 → DB 표 수 · 지어낸 X-Forwarded-For 로 하루 한도(5표)를 못 피함(Nginx 가 덮어씀)
  F. 다른 사이트 요청 Origin 이 다르면 403 CSRF (HTTPS 를 Nginx 에서 끊어도 같은 출처 판정이 맞음)
  G. 파일 올리기     로그인 회원이 사이트를 거쳐 올림 → 앱 폴더 밖(~/sgb-data/uploads)에 저장 → 내려받기
  H. 운영 서버만의 동작 정의에 없는 항목이 섞이면 400(개발 서버는 조용히 버림) · 알림톡 연동 전 상담 신청을 받지 않음

사용: python3 aws_rehearsal.py      (리허설 서버가 떠 있어야 합니다 — qa/README 「운영 방식 리허설」)
"""
import json, os, subprocess, sys, uuid, hashlib, ssl, urllib.request, urllib.error
from playwright.sync_api import sync_playwright
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from flow_lib import bo_tab as _bo_tab, bo_tab_names as _bo_tab_names   # v10.29 — 운영 화면 묶음 메뉴(묶음 단추 → .ad-snb 탭)

DOM = os.environ.get('DOM', 'sogaebaenk.co.kr'); ADOM = os.environ.get('ADOM', 'admin.' + DOM)
HTTPS = os.environ.get('HTTPS_PORT', '443'); HTTP = os.environ.get('HTTP_PORT', '8088')
_sp = '' if HTTPS == '443' else ':' + HTTPS
SITE = f'https://{DOM}{_sp}'; SITE_H = f'http://{DOM}:{HTTP}'; BO = f'https://{ADOM}{_sp}'
API_DIRECT = os.environ.get('API_DIRECT', 'http://127.0.0.1:3200')
SITE_DIRECT = os.environ.get('SITE_DIRECT', 'http://localhost:5274')
DB = os.environ.get('DB', 'postgresql://sgb:sgb@localhost:5432/sgb_aws')
APP = os.environ.get('APP', '/tmp/awshome/sgb'); DATA = os.environ.get('DATA', '/tmp/awshome/sgb-data')
OUT = os.path.dirname(os.path.abspath(__file__))
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print('ok  ' if ok else 'FAIL', step, str(detail)[:200], file=sys.stderr)
q = lambda s: subprocess.run(['psql', DB, '-X', '-tAc', s], capture_output=True, text=True).stdout.strip().split('\n')[0]
def curl(method, url, headers=None, body=None, jar=None, raw=None):
    """Nginx 를 거쳐 부릅니다(주소는 127.0.0.1 로 풀고, 자체 서명 인증서는 받아들임)."""
    host = url.split('/')[2]; name, _, port = host.partition(':'); port = port or ('443' if url.startswith('https') else '80')
    cmd = ['curl', '-sk', '--noproxy', '*', '--resolve', f'{name}:{port}:127.0.0.1', '-X', method, '-o', '-', '-w', '\n%{http_code}', '-A', UA, '--max-time', '60']
    for k, v in (headers or {}).items(): cmd += ['-H', f'{k}: {v}']
    if jar: cmd += ['-b', jar, '-c', jar]
    if body is not None: cmd += ['-H', 'content-type: application/json', '--data', json.dumps(body)]
    if raw is not None: cmd += ['--data-binary', '@-']
    p = subprocess.run(cmd + [url], capture_output=True, input=raw)
    out = p.stdout; i = out.rfind(b'\n'); code = int(out[i + 1:] or 0); data = out[:i]
    try: js = json.loads(data)
    except Exception: js = None
    return code, js, data

tag = uuid.uuid4().hex[:6]
EMAIL = f'owner-{tag}@sogaebaenk.co.kr'; PW = 'Rehearsal-' + uuid.uuid4().hex[:10]

with sync_playwright() as p:
    # 도메인을 이 PC(127.0.0.1)로 풀고, 프록시 환경 값은 뺍니다(있으면 브라우저가 https 를 프록시로 보내 닿지 못합니다)
    b = p.chromium.launch(args=['--no-proxy-server', f'--host-resolver-rules=MAP {DOM} 127.0.0.1, MAP www.{DOM} 127.0.0.1, MAP {ADOM} 127.0.0.1'],
                          env={k: v for k, v in os.environ.items() if 'proxy' not in k.lower()})
    errs = []
    def ctx():
        c = b.new_context(viewport={'width': 1280, 'height': 900}, user_agent=UA, ignore_https_errors=True); pg = c.new_page()
        pg.on('pageerror', lambda e: errs.append(str(e)[:160]))
        return c, pg

    # ── A. 바깥 주소 ──────────────────────────────────────────────
    c, pg = ctx()
    r = pg.goto(SITE + '/', wait_until='networkidle'); html = pg.content()
    rec('A-1 https 메인 200', r.status == 200, r.status)
    rec('A-2 메인이 실제 자료 판 — 「디자인 예시입니다」 문구 없음', '디자인 예시입니다' not in html)
    r = pg.goto(SITE + '/community/polls', wait_until='networkidle'); rec('A-3 https 소개광장 투표 화면 200', r.status == 200, r.status)
    st, js, _ = curl('GET', SITE + '/api/v1/health'); rec('A-4 사이트를 거친 API 상태', st == 200 and js and js.get('db') is True, js)
    st, js, _ = curl('GET', BO + '/api/v1/health'); rec('A-5 운영 화면 주소의 API', st == 200 and js and js.get('db') is True, js)
    st, _, d = curl('GET', BO + '/'); rec('A-6 운영 화면(빌드한 파일)이 Nginx 로 나옴', st == 200 and b'<div id="root">' in d, st)
    st, _, d = curl('GET', BO + '/admin/polls'); rec('A-7 운영 화면의 깊은 주소도 index.html 로', st == 200 and b'<div id="root">' in d, st)
    st, _, _ = curl('GET', API_DIRECT + '/docs'); rec('A-8 API 문서(/docs)는 운영 서버에 없음', st == 404, st)
    st, _, _ = curl('GET', SITE + '/proto/' + next(f for f in os.listdir(APP + '/site/public/proto') if f.startswith('SGB_Prototype_')))
    rec('A-9 시안 주소', st == 200, st)

    # ── B. 가입 · 로그인 ──────────────────────────────────────────
    pg.goto(SITE + '/signup', wait_until='networkidle')
    # v10.27(G-188) — 발행된 약관이 있으면 가입 화면에 약관마다 동의 칸(전체 동의 + 칸), 없으면 「약관 준비 중입니다」
    # v10.35 — 가입 화면이 v10.31 시안 5단계(SignupWizard)로 바뀐 것에 맞춤: 1 유형 → 3 담당자 정보 → 4 약관 → 5 성향(건너뜀) → 가입 신청
    #          약관 칸은 전체 대상(audience ALL) 약관만(v10.31 D090 — 파트너 이용약관은 가입 화면에 없음) · 알림(위탁)은 동의 칸 없음(v10.28 G-218)
    npub = q("select count(*) from terms where status='PUBLISHED' and not is_notice and audience='ALL'")
    pg.locator('.w1-jop[data-jt=PERSONAL]').click(); pg.locator('.w1-jnav .w1-jb.p').click()
    pg.fill('#j-nm', '운영담당'); pg.fill('#j-em', EMAIL); pg.fill('#j-pw', PW); pg.fill('#j-pw2', PW)
    pg.locator('.w1-jnav .w1-jb.p').click(); pg.wait_for_timeout(1500)
    nbox = pg.locator('[data-consent-term]').count(); tbd = pg.locator('[data-consent]').count()
    rec('B-1 가입 화면(5단계) — 발행 약관이 있으면 약관마다 동의 칸 · 없으면 「약관 준비 중입니다」', pg.locator('.w1-jw').count() == 1
        and ((npub not in ('', '0') and nbox == int(npub) and pg.locator('[data-consent-all]').count() == 1) or (npub in ('', '0') and nbox == 0)), f'발행 약관 {npub} · 동의 칸 {nbox} · 약관 단계 {tbd}')
    if nbox: pg.locator('[data-consent-all]').check()
    pg.locator('.w1-jnav .w1-jb.p').click(); pg.wait_for_timeout(500); pg.locator('.w1-jnav .w1-jb.a').click()
    try: pg.wait_for_url('**/signup/done**', timeout=30000)
    except Exception: pass
    n = q(f"select count(*) from accounts where email='{EMAIL}'")
    rec('B-2 가입됨 (운영 DB 에 계정 1건)', n == '1', f'{n} · 지금 주소 {pg.url}')
    cookies = {x['name']: x for x in c.cookies()}
    rec('B-3 로그인 쿠키가 심김 — Secure · HttpOnly', 'sgb_at' in cookies and cookies['sgb_at']['secure'] and cookies['sgb_at']['httpOnly'], {k: (v['secure'], v['httpOnly']) for k, v in cookies.items() if k.startswith('sgb_')})
    st = pg.evaluate("fetch('/api/v1/me/summary').then(r => r.status)")
    rec('B-4 브라우저의 로그인 필요 호출이 통함 (사이트가 토큰을 붙여 넘김)', st == 200, st)
    c.close()
    c2, pg2 = ctx()                                        # 인증서 없이(http) — 운영에서는 쿠키가 Secure 라 로그인이 유지되지 않습니다
    pg2.goto(SITE_H + '/login', wait_until='networkidle'); __import__('consent_ok').agree(EMAIL, PW); pg2.fill('input[name=email]', EMAIL); pg2.fill('input[name=password]', PW)
    pg2.click('form.auth button'); pg2.wait_for_timeout(2500)
    ck = [x['name'] for x in c2.cookies() if x['name'] in ('sgb_at', 'sgb_rt')]
    st = pg2.evaluate("fetch('/api/v1/me/summary').then(r => r.status)")
    rec('B-5 http 주소에서는 로그인이 유지되지 않음 (그래서 https 가 먼저입니다)', ck == [] and st != 200, f'쿠키 {ck} · me {st}')
    c2.close()
    c, pg = ctx()
    pg.goto(SITE + '/login', wait_until='networkidle'); __import__('consent_ok').agree(EMAIL, PW); pg.fill('input[name=email]', EMAIL); pg.fill('input[name=password]', PW)
    pg.click('form.auth button'); pg.wait_for_timeout(2500)
    st = pg.evaluate("fetch('/api/v1/me/summary').then(r => r.status)"); rec('B-6 https 에서 다시 로그인 — 유지됨', st == 200, st)

    c3, pg3 = ctx()                                        # SSH 터널로 미리 볼 때 — http://localhost:포트 (localhost 는 Secure 쿠키를 받아 줍니다)
    pg3.goto(SITE_DIRECT + '/login', wait_until='networkidle'); __import__('consent_ok').agree(EMAIL, PW); pg3.fill('input[name=email]', EMAIL); pg3.fill('input[name=password]', PW)
    pg3.click('form.auth button'); pg3.wait_for_timeout(2500)
    st = pg3.evaluate("fetch('/api/v1/me/summary').then(r => r.status)")
    rec('B-7 인증서 전에 미리 보기 — http://localhost(SSH 터널과 같은 조건)에서는 로그인이 유지됨', st == 200, st)
    c3.close()

    # ── C. 확정 질문 3건 (운영 DB 에 투표가 하나도 없을 때) ─────────
    rec('C-1 올린 직후에는 투표 0건 — 메인 카드 3장은 「준비 중」', q("select count(*) from polls") == '0' and pg.goto(SITE + '/', wait_until='networkidle').status == 200 and pg.locator('.home-pl[data-poll]').count() == 0,
        f"polls {q('select count(*) from polls')} · 카드 {pg.locator('.home-pl[data-poll]').count()}")
    sp = subprocess.run(['psql', DB, '-X', '-v', 'ON_ERROR_STOP=1', '-q', '-f', APP + '/scripts/seed-polls.sql'], capture_output=True, text=True)
    kinds = subprocess.run(['psql', DB, '-X', '-tAc', "select kind||':'||title from v_poll_home order by sort"], capture_output=True, text=True).stdout.strip().split('\n')
    rec('C-2 seed-polls.sql — 확정한 질문 3건이 메인에', sp.returncode == 0 and [k.split(':')[0] for k in kinds] == ['VS', 'ASK', 'USED'], kinds)
    sp = subprocess.run(['psql', DB, '-X', '-v', 'ON_ERROR_STOP=1', '-q', '-f', APP + '/scripts/seed-polls.sql'], capture_output=True, text=True)
    rec('C-3 한 번 더 돌려도 그대로 3건', sp.returncode == 0 and q("select count(*) from polls") == '3', q("select count(*) from polls"))
    ok = False
    for _ in range(9):                                      # 메인은 60초 캐시 — 보일 때까지 다시 엽니다
        pg.goto(SITE + '/', wait_until='networkidle')
        if pg.locator('.home-pl[data-poll]').count() == 3: ok = True; break
        pg.wait_for_timeout(9000)
    rec('C-4 메인에 카드 3장', ok, pg.locator('.home-pl[data-poll]').count())
    imgs = pg.evaluate("Array.from(document.querySelectorAll('.home-band.poll img')).map(i => [i.getAttribute('src'), i.naturalWidth])")
    rec('C-5 카드 그림이 깨지지 않음', len(imgs) > 0 and all(w > 0 for _, w in imgs), imgs[:4])

    # ── D. 첫 관리자 → 운영 화면 ──────────────────────────────────
    subprocess.run(['psql', DB, '-X', '-qc', f"INSERT INTO account_roles(account_id, role) SELECT id, 'SUPER' FROM accounts WHERE email = '{EMAIL}' ON CONFLICT DO NOTHING"], capture_output=True)
    rec('D-1 SUPER 부여 (SQL 한 줄)', q(f"select count(*) from account_roles r join accounts a on a.id=r.account_id where a.email='{EMAIL}' and r.role='SUPER'") == '1')
    cb, bo = ctx()
    bo.goto(BO + '/', wait_until='networkidle'); bo.wait_for_timeout(500)
    __import__('consent_ok').agree(EMAIL, PW); bo.fill('input[name=email]', EMAIL); bo.fill('input[name=password]', PW); bo.click('form button[type=submit]'); bo.wait_for_timeout(2000)
    rec('D-2 운영 화면 로그인', bo.locator('.bo-head nav button').count() > 5, bo.locator('.bo-head nav button').count())
    _bo_tab(bo, '이건 어때? 투표'); bo.wait_for_selector('[data-polls-admin]', timeout=10000)   # v10.29 — 묶음 단추 → .ad-snb 탭
    T = f'리허설 {tag} 어느 쪽이 좋을까요?'
    bo.select_option('select[name=poll-kind]', 'VS'); bo.fill('input[name=poll-title]', T); bo.fill('textarea[name=poll-options]', '왼쪽 | 가볍다\n오른쪽 | 오래 간다')
    bo.uncheck('input[name=poll-home]'); bo.click('[data-poll-create] button'); bo.wait_for_timeout(1800)
    PID = q(f"select id from polls where title='{T}'")
    rec('D-3 투표 만들기 (준비 중으로 저장)', PID != '' and q(f"select state from polls where id='{PID}'") == 'DRAFT', PID)
    bo.locator(f'tr[data-poll="{PID}"] button', has_text='열기').click(); bo.wait_for_timeout(1500)
    rec('D-4 열기', q(f"select state from polls where id='{PID}'") == 'OPEN')
    pg.goto(SITE + '/community/polls', wait_until='networkidle')
    rec('D-5 사용자 웹 투표 목록에 나옴', pg.locator(f'.poll-card[data-poll="{PID}"]').count() == 1)
    rec('D-6 감사 기록이 남음 (POLL_CREATE)', int(q("select count(*) from audit.audit_logs where action='POLL_CREATE'") or 0) >= 1)
    _bo_tab(bo, '법정 고지'); bo.wait_for_selector('[data-sns-settings]', timeout=10000)   # v10.29 — 묶음 단추 → .ad-snb 탭
    rec('D-7 「법정 고지」 — 사회관계망 주소 입력 칸 4개', bo.locator('[data-sns-settings] input').count() == 4, bo.locator('[data-sns-settings] input').count())
    cb.close(); c.close()

    # ── E. 비로그인 투표 (브라우저 → Nginx → 사용자 웹 → API) ──────
    VS = q("select id from polls where kind='VS' and show_on_home order by sort limit 1"); vo = subprocess.run(['psql', DB, '-X', '-tAc', f"select id from poll_options where poll_id='{VS}' order by sort"], capture_output=True, text=True).stdout.split()
    g, gp = ctx(); gp.goto(SITE + '/', wait_until='networkidle')
    gp.click(f'.home-pl[data-poll="{VS}"] [data-opt="{vo[0]}"]'); gp.click(f'.home-pl[data-poll="{VS}"] [data-vote]')
    try: gp.wait_for_selector(f'.home-pl[data-poll="{VS}"][data-voted="1"]', timeout=8000); voted = True
    except Exception: voted = False
    rec('E-1 메인 카드에서 비로그인 투표', voted and q(f"select count(*) from poll_votes where poll_id='{VS}'") == '1', gp.inner_text(f'.home-pl[data-poll="{VS}"]')[:120].replace('\n', ' '))
    gp.reload(wait_until='networkidle'); rec('E-2 새로 열어도 내 표가 유지됨', gp.locator(f'.home-pl[data-poll="{VS}"][data-voted="1"]').count() == 1)
    g.close()
    lim = int(q("select value from site_settings where key='poll.guest_ip_daily_limit'"))
    okv = 0; blocked = None
    for i in range(lim + 3):                                # 방문자를 매번 새로(쿠키 없음) · 접속 IP 를 지어내 보냄
        st, js, _ = curl('POST', SITE + f'/api/v1/community/polls/{PID}/vote', headers={'X-Forwarded-For': f'198.51.100.{i + 1}', 'X-Real-IP': f'198.51.100.{i + 1}'}, body={'optionId': q(f"select id from poll_options where poll_id='{PID}' order by sort limit 1")})
        if st in (200, 201): okv += 1
        else: blocked = (st, (js or {}).get('code')); break
    ips = q("select count(distinct ip_hash) from poll_votes where ip_hash is not null")
    # 한도는 「투표 하나에 · 같은 IP 에서 · 하루」 기준입니다 — 지어낸 주소가 통했다면 한도 없이 계속 들어갑니다
    rec(f'E-3 지어낸 X-Forwarded-For 로 하루 한도({lim}표)를 못 피함 — Nginx 가 실제 접속 IP 로 덮어씀', blocked == (422, 'POLL_IP_LIMIT') and okv == lim and ips == '1', f'{okv}표까지 받고 그다음 {blocked} · 기록된 IP 종류 {ips}')
    PO = q(f"select id from poll_options where poll_id='{PID}' order by sort limit 1")
    st, js, _ = curl('POST', SITE + f'/api/v1/community/polls/{PID}/vote', headers={'X-Visitor-Key': 'forged-visitor-key-0001'}, body={'optionId': PO})
    rec('E-4 한도에 걸린 뒤에는 방문자 키를 지어내도 같음', st == 422 and (js or {}).get('code') == 'POLL_IP_LIMIT', (st, js))

    # ── F. 다른 사이트에서 온 쓰기 요청 ───────────────────────────
    st, js, _ = curl('POST', SITE + f'/api/v1/community/polls/{PID}/vote', headers={'Origin': 'https://evil.example'}, body={'optionId': PO})
    rec('F-1 Origin 이 다른 사이트면 403 CSRF', st == 403 and (js or {}).get('code') == 'CSRF', (st, js))
    st, js, _ = curl('POST', SITE + f'/api/v1/community/polls/{PID}/vote', headers={'Origin': SITE}, body={'optionId': PO})
    rec('F-2 우리 주소(https)의 Origin 은 출처 검사를 통과 (그 뒤 한도에 걸림) — HTTPS 를 Nginx 에서 끊어도 같은 출처로 봄', st == 422 and (js or {}).get('code') == 'POLL_IP_LIMIT', (st, (js or {}).get('code')))

    # ── G. 파일 올리기 (로그인 회원 · 사이트를 거쳐) ────────────────
    c, pg = ctx()
    pg.goto(SITE + '/login', wait_until='networkidle'); __import__('consent_ok').agree(EMAIL, PW); pg.fill('input[name=email]', EMAIL); pg.fill('input[name=password]', PW); pg.click('form.auth button'); pg.wait_for_timeout(2500)
    res = pg.evaluate("""async () => {
      const head = new TextEncoder().encode('%PDF-1.4\\n1 0 obj <<>> endobj\\n'), tail = new TextEncoder().encode('\\n%%EOF\\n');
      const png = new Uint8Array(head.length + 1500 + tail.length); png.set(head, 0); for (let i = 0; i < 1500; i++) png[head.length + i] = (i * 7) % 251; png.set(tail, head.length + 1500);
      const hex = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', png))).map(b => b.toString(16).padStart(2, '0')).join('');
      const j = (r) => r.json().catch(() => null);
      const a = await fetch('/api/v1/files', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({purpose: 'OWNERSHIP_DOC', name: 'rehearsal.pdf', contentType: 'application/pdf', size: png.length, sha256: hex})});
      const t = await j(a); if (a.status !== 201) return {step: 'create', status: a.status, t};
      const u = await fetch(t.uploadUrl, {method: t.method, headers: t.headers, body: png});
      if (u.status !== 200) return {step: 'put', status: u.status, url: t.uploadUrl};
      const d = await fetch('/api/v1/files/' + t.fileId + '/complete', {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'}); const dj = await j(d);
      const g = await fetch('/api/v1/files/' + t.fileId); const gj = await j(g);
      const dl = gj && gj.url ? await fetch(gj.url) : null; const bytes = dl ? (await dl.arrayBuffer()).byteLength : -1;
      return {step: 'done', complete: d.status, state: dj && dj.status, get: g.status, url: gj && gj.url, bytes, size: png.length, id: t.fileId};
    }""")
    rec('G-1 올리기 → 확정 → 내려받기', res.get('step') == 'done' and res.get('state') == 'READY' and res.get('bytes') == res.get('size'), res)
    found = subprocess.run(['bash', '-c', f'find {DATA}/uploads -type f | wc -l; find {APP}/ -maxdepth 1 -name uploads | wc -l'], capture_output=True, text=True).stdout.split()
    rec('G-2 파일이 앱 폴더 밖(~/sgb-data/uploads)에 저장됨 — 판을 바꿔도 남음', int(found[0]) >= 1 and found[1] == '0', f'sgb-data/uploads 파일 {found[0]}개 · 앱 폴더 안 uploads {found[1]}')
    c.close()

    # ── H. 엄격한 입력 검사 (운영 서버만) ──────────────────────────
    st, js, _ = curl('POST', SITE + '/api/v1/auth/login', body={'email': EMAIL, 'password': PW, 'remember': True})
    rec('H-1 정의에 없는 항목이 섞이면 400 (개발 서버는 조용히 버림)', st == 400 and 'should not exist' in json.dumps(js or {}), (st, js))
    st, js, _ = curl('POST', SITE + '/api/v1/auth/login', body={'email': EMAIL, 'password': PW})
    rec('H-2 정의대로 보내면 로그인 201/200', st in (200, 201) and 'accessToken' in (js or {}), st)
    st, js, _ = curl('POST', SITE + '/api/v1/consult/requests', body={'categoryCode': 'CSL_CLEANING', 'name': '리허설', 'phone': '010-%04d-%04d' % (uuid.uuid4().int % 9000 + 1000, uuid.uuid4().int % 10000), 'email': 'consult.test@example.com', 'sido': '서울', 'agree': True})
    rec('H-3 운영(production)에서는 알림톡 연동 전 상담 신청을 받지 않음 · 응답에 인증번호 없음', st == 422 and (js or {}).get('code') == 'NOTIFY_NOT_READY' and 'devCode' not in json.dumps(js or {}), (st, js))
    # ── I. v10.24 — 상담 업종 상세 · 신청서 쪽 / 시험용 업체 · 사무소(개발 · 시연용 시드)는 운영에 들어가지 않음 ──────
    ci, pg = ctx()      # 앞에서 쓰던 창은 닫았으므로 새 창으로
    st, cats, _ = curl('GET', SITE + '/api/v1/consult/categories')
    opened = [c['code'] for c in (cats or []) if c.get('consultMode') == 'LEAD' and c.get('partnerCount', 0) > 0]
    rec('I-1 운영 DB 에는 시험용 업체 · 사무소가 없음 — 상담 업종 22종 · 받는 업종 0 · 「(시험)」 서비스 0 · 게재 0 (apply.sh 는 시드를 부르지 않음)',
        st == 200 and len(cats or []) == 22 and not opened and q("select count(*) from partner_services where title like '(시험)%'") == '0' and q("select count(*) from consult_directory_entries") == '0', (st, len(cats or []), opened))
    st, d, _ = curl('GET', SITE + '/api/v1/consult/categories/CSL_MOVING'); st2, _, _ = curl('GET', SITE + '/api/v1/consult/categories/CSL_NOPE')
    rec('I-2 새 길 GET /consult/categories/{code} — 이사짐 200(인증업체 0 · 받는 지역 없음 · 진행 규칙) · 없는 업종 404', st == 200 and (d or {}).get('partnerCount') == 0 and (d or {}).get('regions') == [] and (d or {}).get('rules', {}).get('deliverTo') == 1 and st2 == 404, (st, d, st2))
    r = pg.goto(SITE + '/mal/consult/CSL_MOVING', wait_until='networkidle')
    rec('I-3 업종 상세 쪽 — 200 · 받을 업체가 없어 「준비 중」(막힌 단추) · 신청서로 가는 단추 없음', r.status == 200 and pg.locator('[data-consult-detail="CSL_MOVING"]').count() == 1 and pg.locator('.mal-cd-bar button[disabled]').count() == 1 and pg.locator('a.mal-cd-go').count() == 0, r.status)
    r = pg.goto(SITE + '/mal/consult/CSL_MOVING/apply', wait_until='networkidle')
    rec('I-4 신청서 쪽(…/apply) — 200 · 신청서 없이 「아직 받지 않습니다」 안내', r.status == 200 and pg.locator('input[name=phone]').count() == 0 and '아직 받지 않습니다' in pg.inner_text('main'), r.status)
    r = pg.goto(SITE + '/mal/consult/CSL_LEGAL', wait_until='networkidle')
    rec('I-5 법률 사무소 쪽 — 200 · 게재 중인 사무소 없음(시험용 사무소가 들어가지 않음)', r.status == 200 and pg.locator('[data-dir-entry]').count() == 0 and '게재 중인 사무소가 없습니다' in pg.inner_text('main'), r.status)
    ci.close()
    # ── J. v10.25 — 소개몰: 이름 · 약관(D024) · 판매 범위 · 배송비(D025) · 새 메인 · 한글 「없는 주소」 ──────
    cj, pg = ctx()
    st, gw, _ = curl('GET', SITE + '/api/v1/gwans'); hname = next((g_.get('name') for g_ in (gw or []) if g_.get('code') == 'HLT'), None)
    rec('J-1 관 이름이 「소개몰」(D024) · 검색 사전에 옛 이름 → 소개몰', st == 200 and hname == '소개몰' and q("select canonical from search_synonyms where kind='GWAN' and term='소개뱅크몰'") == '소개몰', (st, hname))
    st, sc_, _ = curl('GET', SITE + '/api/v1/health/categories'); states = {c_['code']: c_['state'] for c_ in (sc_ or [])}
    rec('J-2 새 길 GET /health/categories — 건강기능식품 잠금 · 의료기기 미판매(D025) · 그 갈래에 판매 중 상품 0 · 청약철회 규칙 이름 「건강기기」',
        st == 200 and states.get('HLT_FUNC') == 'LOCKED' and states.get('HLT_MEDDEV') == 'NOT_SOLD' and q('select count(*) from v_hlt_locked_on_sale') == '0' and q("select label from withdrawal_rules where code='DEVICE'") == '건강기기', (st, states))
    # 9/30 서버에서는 약관이 아직 「초안」입니다(발행은 운영 절차) — D024 는 발행 전인 판의 본문만 고칩니다(이미 발행된 DB 에서는 다음 판을 만들어 발행). 그래서 상태와 관계없이 가장 새 판의 글을 봅니다
    tst = q("select status||' '||version from terms where code='HLT_SALE' and status <> 'ARCHIVED' order by (status='PUBLISHED') desc, version desc limit 1")
    body = subprocess.run(['psql', DB, '-tA', '-c', "select body from terms where code='HLT_SALE' and status <> 'ARCHIVED' order by (status='PUBLISHED') desc, version desc limit 1"], capture_output=True, text=True).stdout.strip()
    snap = open(os.path.join(OUT, 'hlt_sale_terms.md'), encoding='utf-8').read().strip() if os.path.exists(os.path.join(OUT, 'hlt_sale_terms.md')) else ''
    rec(f'J-3 판매 약관(HLT_SALE · {tst}) — 「배송비는 받지 않습니다」 · 옛 이름 없음 · 시안의 이용안내에 실은 글과 같음(9/30 서버에서 올려도 개발 DB 와 같은 글이 됨 — 발행 전인 초안은 본문만 고쳐짐)',
        '배송비는 받지 않습니다' in body and '건강몰' not in body and '소개뱅크몰' not in body and '3만원' not in body and body == (snap if tst.startswith('PUBLISHED') else snap.replace('시행일 2026년 11월 11일', '시행일 〔시행일〕')), (tst, len(body), len(snap)))   # v10.27(T-3) — 발행 전 초안은 시행일이 자리표시자(발행할 때 채움)
    r = pg.goto(SITE + '/health', wait_until='networkidle'); navs = [x.strip() for x in pg.locator('header nav a').all_inner_texts()]
    im = pg.evaluate("(() => { const a = [...document.querySelectorAll('main.shop img, .shop img')]; return [a.length, a.filter(i => !i.naturalWidth).length] })()")
    rec('J-4 소개몰 메인 — 200 · 사진 띠(제시 디자인) · 머리줄 메뉴 「소개몰」 · 그림이 모두 뜸(Nginx → 사용자 웹)', r.status == 200 and pg.locator('.shop-hero').count() == 1 and '소개몰' in navs and '소개뱅크몰' not in navs and im[0] >= 3 and im[1] == 0, (r.status, navs, im))      # 운영 DB 에는 성분 · 고민 · 상품 자료가 아직 없어 타일 그림은 없습니다 — 사진 띠 · 아래 띠의 그림 3장
    r = pg.goto(SITE + '/health/guide', wait_until='networkidle'); t_ = pg.inner_text('main')
    pub = tst.startswith('PUBLISHED')
    rec('J-5 이용안내 — 「배송비는 받지 않습니다(전 상품 무료)」 · 의료기기 「현재 판매하지 않습니다」 · 건강기능식품 준비 중 · 판매 약관은 발행됐으면 전문, 발행 전이면 「아직 발행되지 않았습니다」(' + tst + ')',
        r.status == 200 and '배송비는 받지 않습니다' in t_ and '현재 판매하지 않습니다' in t_ and '준비 중' in t_ and (('제9조 (분쟁)' in t_) if pub else ('아직 발행되지 않았습니다' in t_ and '제9조 (분쟁)' not in t_)), (r.status, tst))
    r = pg.goto(SITE + '/health/c/HLT_FUNC', wait_until='networkidle'); t_ = pg.inner_text('main')
    rec('J-6 잠긴 갈래(건강기능식품) 주소 — 200 · 「준비 중」 안내 · 상품 카드 없음', r.status == 200 and '준비 중' in t_ and pg.locator('main .hlt-card').count() == 0, r.status)
    r = pg.goto(SITE + '/no-such-page-v1025', wait_until='networkidle')
    rec('J-7 없는 주소 — 404 · 한글 화면(「없는 주소입니다」 · 「홈으로」)', r.status == 404 and '없는 주소입니다' in pg.inner_text('body') and pg.locator('a', has_text='홈으로').count() >= 1, r.status)
    cj.close()
    b.close()

json.dump({'items': R, 'errors': errs}, open(os.path.join(OUT, 'aws_rehearsal.json'), 'w'), ensure_ascii=False, indent=1)
bad = [x for x in R if not x['ok']]
print(f"통과 {len(R) - len(bad)} / {len(R)}" + (f" · 화면 오류 {len(errs)}" if errs else ''))
