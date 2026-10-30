"""v10.155 시험 — 세금계산서 키 확인 · 시험 발행을 가짜 업체 서버로 끝까지(D148 · docs/235) — **docker 를 부르므로 서버에서 직접**

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb python3 test_v1155_etax.py

  점검판 API 컨테이너(sgb-api) 안에 ① 가짜 업체 서버(127.0.0.1:18141 · /prod = 운영 주소 · /sandbox = 시험 주소)와
  ② 그 주소를 ETAX_URL · ETAX_TEST_URL 로 둔 두 번째 API(127.0.0.1:3999 · 같은 DB · 같은 열쇠 — 값은 컨테이너 환경을 그대로 물려받음 · 시험이 읽지 않음)를 띄웁니다.
  밖(실제 업체 · 국세청)으로는 아무것도 나가지 않습니다. 끝나면 두 프로세스를 끄고 설정 · 연동 상태 · 시험 기록을 되돌립니다.

  · 상태 — 주소 · 키 · 시험 주소 · 시험 키 이름(ETAX_TEST_KEY)
  · 키 확인 · 시험 발행 없이 간주 끄기 → 422 ETAX_TEST_FIRST(빠진 두 이름)
  · 승인 대기(PENDING) · 업체 거절은 시험 발행 실패 · 키 틀림(401)은 키 확인 실패(AUTH) — 빠진 이름만 남음
  · 둘 다 성공 → 승인번호 8-8-8 · 가짜 서버가 받은 것: 운영 주소는 조회(GET)만 · 발행(POST)은 시험 주소로만 · 각 키 · 1,000 + 100 · 공급자 = 공급받는 자
  · 8일 전 성공은 근거 아님 · 7일 안 둘 다 → 간주 꺼짐 · 다시 켜기는 언제나 · 하루 횟수 0 → 422 ETAX_TEST_LIMIT · 감사 INTEG_TEST_ETAX
"""
import json, os, subprocess, time, urllib.error, urllib.request

API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
C = os.environ.get('API_CONTAINER') or 'sgb-api'
RES = []
PW = 'sgb-dev-1234'
PROD_KEY, TEST_KEY = 'prod-key-1155', 'test-key-1155'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m)
    try:
        return json.load(urllib.request.urlopen(r, timeout=60))
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b'{}')
        except Exception:
            body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


FETCH = ("const [m,u,b,t]=process.argv.slice(1);const h={'content-type':'application/json'};if(t)h.Authorization='Bearer '+t;"
         "fetch(u,{method:m,headers:h,body:b||undefined}).then(async r=>console.log(JSON.stringify({s:r.status,b:await r.text()})))"
         ".catch(e=>console.log(JSON.stringify({s:0,b:String(e)})))")


def inside(m, url, b=None, t=None):
    """컨테이너 안에서 부름(두 번째 API · 가짜 서버는 컨테이너 밖에 열려 있지 않음)"""
    r = subprocess.run(['docker', 'exec', C, 'node', '-e', FETCH, m, url, json.dumps(b) if b is not None else '', t or ''], capture_output=True, text=True, timeout=90)
    try:
        o = json.loads((r.stdout.strip().splitlines() or ['{}'])[-1])
    except Exception:
        return {'_err': 0, 'message': (r.stdout + r.stderr)[:200]}
    try:
        body = json.loads(o.get('b') or '{}')
    except Exception:
        body = {'raw': (o.get('b') or '')[:200]}
    if o.get('s', 0) >= 400 or o.get('s') == 0:
        return {'_err': o.get('s'), 'code': body.get('code') if isinstance(body, dict) else None, 'message': body.get('message') if isinstance(body, dict) else body}
    return body


call2 = lambda m, p, b=None, t=None: inside(m, 'http://127.0.0.1:3999/api/v1' + p, b, t)
fake = lambda b=None: inside('POST' if b is not None else 'GET', 'http://127.0.0.1:18141/__state', b)


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip()


FAKE_JS = r"""
const http = require('http'); const S = { mode: 'ok', seq: 0, calls: [] };
http.createServer((q, r) => { let d = ''; q.on('data', (c) => d += c); q.on('end', () => {
  const out = (c, o) => { r.writeHead(c, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
  if (q.url === '/__state') { if (q.method === 'POST') Object.assign(S, JSON.parse(d || '{}')); return out(200, S); }
  let body = null; try { body = d ? JSON.parse(d) : null; } catch (e) { body = d; }
  S.calls.push({ m: q.method, u: q.url, a: q.headers.authorization || '', b: body });
  const prod = q.url.startsWith('/prod/'), sbx = q.url.startsWith('/sandbox/');
  if (prod && S.mode === 'badkey') return out(401, { code: 'AUTH', message: 'key mismatch (test)' });
  if (q.headers.authorization !== 'Bearer ' + (prod ? 'PROD_KEY' : 'TEST_KEY')) return out(401, { code: 'AUTH', message: 'key mismatch (test)' });
  if (q.method === 'GET' && /\/invoices\/[^/]+$/.test(q.url)) return out(404, { code: 'NOT_FOUND' });
  if (q.method === 'POST' && sbx && q.url === '/sandbox/invoices') {
    if (S.mode === 'pending') return out(200, { result: 'PENDING' });
    if (S.mode === 'reject') return out(400, { code: 'E_TEST', message: 'rejected (test)' });
    S.seq++; return out(200, { result: 'SENT', approvalNo: '20261030' + String(S.seq).padStart(16, '0') });
  }
  return out(404, {});
}); }).listen(18141, '127.0.0.1', () => console.log('fake up'));
""".replace('PROD_KEY', PROD_KEY).replace('TEST_KEY', TEST_KEY)

KEYS = ('assume.etax', 'etax.require_config', 'integ.etax_test_daily')
up = subprocess.run(['docker', 'inspect', '-f', '{{.State.Running}}', C], capture_output=True, text=True).stdout.strip() == 'true'
ok('전제 — 점검판 API 컨테이너가 떠 있음', up, C)
if up:
    was = {k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'") for k in KEYS}
    etax0 = psql("SELECT status FROM integrations WHERE code = 'ETAX'")
    foot0 = {k: psql(f"SELECT coalesce(nullif(btrim(value), ''), '') FROM site_settings WHERE key = '{k}'") for k in ('footer.company_name', 'footer.biz_reg_no')}
    foot_raw = {k: psql(f"SELECT CASE WHEN value IS NULL THEN 'NULL' ELSE quote_literal(value) END FROM site_settings WHERE key = '{k}'") for k in foot0}
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW})['accessToken']
    sv2 = lambda k, v: call2('PATCH', '/admin/site-settings', {'key': k, 'value': v}, T_)
    get = lambda k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'")
    rows = lambda: psql("SELECT coalesce(string_agg(kind || '|' || ok || '|' || coalesce(error_kind, ''), ',' ORDER BY kind), '') FROM integration_tests WHERE integration_code = 'ETAX'")
    try:
        subprocess.run(['docker', 'exec', '-i', C, 'sh', '-c', 'cat > /tmp/fake_etax_1155.js'], input=FAKE_JS, text=True, check=True)
        subprocess.run(['docker', 'exec', '-d', C, 'sh', '-c', 'node /tmp/fake_etax_1155.js > /tmp/fake_etax_1155.log 2>&1 & echo $! > /tmp/fake_etax_1155.pid'], check=True)
        env = (f'PORT=3999 ETAX_URL=http://127.0.0.1:18141/prod ETAX_KEY={PROD_KEY} ETAX_TEST_URL=http://127.0.0.1:18141/sandbox '
               f'ETAX_TEST_KEY={TEST_KEY} ETAX_TIMEOUT_MS=3000')
        subprocess.run(['docker', 'exec', '-d', C, 'sh', '-c', f'cd /app && {env} node scripts/dev-server.js > /tmp/api_1155.log 2>&1 & echo $! > /tmp/api_1155.pid'], check=True)
        t0 = time.time(); h = {}
        while time.time() - t0 < 240:
            h = inside('GET', 'http://127.0.0.1:3999/api/v1/health')
            if h.get('_err') is None: break
            time.sleep(4)
        ready = h.get('_err') is None and fake().get('_err') is None
        if not ready:   # 못 뜬 까닭 — 두 번째 API 로그 끝(키 값은 찍지 않는 로그)
            print(subprocess.run(['docker', 'exec', C, 'tail', '-15', '/tmp/api_1155.log'], capture_output=True, text=True).stdout)
        ok('준비 — 가짜 업체 서버 · 두 번째 API(ETAX_URL · ETAX_TEST_URL) 뜸', ready, f'{int(time.time() - t0)}초 · {str(h)[:80]}')
        if not foot0['footer.company_name']: psql("UPDATE site_settings SET value = '(주)한국바이오헬스케어' WHERE key = 'footer.company_name'")
        if not foot0['footer.biz_reg_no']: psql("UPDATE site_settings SET value = '123-45-67890' WHERE key = 'footer.biz_reg_no'")
        psql("UPDATE site_settings SET value = '20' WHERE key = 'integ.etax_test_daily'")
        psql("DELETE FROM integration_tests WHERE integration_code = 'ETAX'")
        call('PATCH', '/admin/integrations/ETAX', {'status': 'TESTING'}, T_)

        s = call2('GET', '/admin/integ-tests', None, T_).get('etax') or {}
        ok('상태 — 주소 · 키 · 시험 주소 있음 · 시험 키 이름 ETAX_TEST_KEY · 잠금 켜짐 · 성공 없음', s.get('url') is True and s.get('key') is True and s.get('testUrl') is True
           and s.get('testKey') == 'ETAX_TEST_KEY' and s.get('requireTest') is True and s.get('lastKeyOkAt') is None and s.get('lastIssueOkAt') is None, str(s)[:160])
        r = sv2('assume.etax', 'off')
        ok('시험 없이 간주 끄기 → 422 ETAX_TEST_FIRST(키 확인 · 시험 발행 둘 다 빠짐) · 간주 그대로', r.get('code') == 'ETAX_TEST_FIRST'
           and '세금계산서 키 확인 · 시험 발행 성공' in (r.get('message') or '') and get('assume.etax') == 'on', str(r)[:140])

        fake({'mode': 'pending', 'calls': []})
        x = call2('POST', '/admin/integ-tests/etax-test', {}, T_)
        ok('승인 대기(PENDING) — 키 확인 성공 · 시험 발행 실패(PENDING)', (x.get('key') or {}).get('ok') is True and (x.get('issue') or {}).get('errorKind') == 'PENDING' and x.get('ok') is False, str(x)[:140])
        r = sv2('assume.etax', 'off')
        ok('  → 간주 끄기는 시험 발행만 빠졌다고 거절', r.get('code') == 'ETAX_TEST_FIRST' and '세금계산서 키 확인' not in (r.get('message') or '') and '7일 안 시험 발행 성공' in (r.get('message') or ''), str(r)[:140])
        fake({'mode': 'reject'})
        x = call2('POST', '/admin/integ-tests/etax-test', {}, T_)
        ok('업체 거절 — 시험 발행 실패(HTTP_4XX · 업체 문구)', (x.get('issue') or {}).get('ok') is False and (x.get('issue') or {}).get('errorKind') == 'HTTP_4XX' and 'rejected' in ((x.get('issue') or {}).get('detail') or ''), str(x.get('issue'))[:140])

        psql("DELETE FROM integration_tests WHERE integration_code = 'ETAX'")
        fake({'mode': 'badkey'})
        x = call2('POST', '/admin/integ-tests/etax-test', {}, T_)
        r = sv2('assume.etax', 'off')
        ok('운영 키 틀림(401) — 키 확인 AUTH · 시험 발행은 성공 → 간주 끄기는 키 확인만 빠졌다고 거절', (x.get('key') or {}).get('errorKind') == 'AUTH' and (x.get('issue') or {}).get('ok') is True
           and r.get('code') == 'ETAX_TEST_FIRST' and '7일 안 세금계산서 키 확인 성공' in (r.get('message') or ''), f"{str(x)[:100]} · {str(r)[:100]}")

        psql("DELETE FROM integration_tests WHERE integration_code = 'ETAX'")
        fake({'mode': 'ok', 'calls': []})
        x = call2('POST', '/admin/integ-tests/etax-test', {}, T_)
        st = fake(); calls = st.get('calls') or []
        posts = [c_ for c_ in calls if c_.get('m') == 'POST']
        gets = [c_ for c_ in calls if c_.get('m') == 'GET']
        b = (posts[0].get('b') if posts else None) or {}
        ok('둘 다 성공 — 승인번호 8-8-8 · 기록 두 줄 성공', x.get('ok') is True and (x.get('key') or {}).get('ok') is True and (x.get('issue') or {}).get('ok') is True
           and len(((x.get('issue') or {}).get('approvalNo') or '').split('-')) == 3 and rows() == 'ETAX_KEY|true|,ETAX_TEST_ISSUE|true|', f'{str(x)[:120]} · {rows()}')
        ok('가짜 서버가 받은 것 — 운영 주소는 조회(GET)만 · 발행(POST)은 시험 주소 한 번 · 각자의 키', len(posts) == 1 and posts[0].get('u') == '/sandbox/invoices'
           and posts[0].get('a') == 'Bearer ' + TEST_KEY and len(gets) == 1 and gets[0].get('u', '').startswith('/prod/invoices/SGB-K-') and gets[0].get('a') == 'Bearer ' + PROD_KEY
           and not any(c_.get('u', '').startswith('/prod/') and c_.get('m') == 'POST' for c_ in calls), str([(c_.get('m'), c_.get('u')) for c_ in calls]))
        ok('시험 발행 내용 — 1,000 + 100 = 1,100 · 공급자 = 공급받는 자(운영 법인) · 시험 문서 번호 SGB-T-', b.get('supplyAmount') == 1000 and b.get('taxAmount') == 100 and b.get('totalAmount') == 1100
           and (b.get('buyer') or {}).get('bizNo') == (b.get('supplier') or {}).get('bizNo') and str(b.get('docKey', '')).startswith('SGB-T-') and len(str(b.get('docKey', ''))) <= 24, str(b)[:160])
        psql("UPDATE integration_tests SET created_at = now() - interval '8 days' WHERE integration_code = 'ETAX'")
        ok('8일 전 성공은 근거 아님(7일)', sv2('assume.etax', 'off').get('code') == 'ETAX_TEST_FIRST' and get('assume.etax') == 'on', '')
        x = call2('POST', '/admin/integ-tests/etax-test', {}, T_)
        r = sv2('assume.etax', 'off'); s = call2('GET', '/admin/integ-tests', None, T_).get('etax') or {}
        ok('7일 안 둘 다 성공 → 간주 꺼짐 · 상태에 성공 시각 두 개', x.get('ok') is True and r.get('_err') is None and get('assume.etax') == 'off' and s.get('lastKeyOkAt') and s.get('lastIssueOkAt'), str(r)[:100])
        ok('간주 다시 켜기는 언제나', sv2('assume.etax', 'on').get('_err') is None and get('assume.etax') == 'on', '')
        psql("UPDATE site_settings SET value = '0' WHERE key = 'integ.etax_test_daily'")
        lm = call2('POST', '/admin/integ-tests/etax-test', {}, T_)
        ok('하루 횟수 0 → 422 ETAX_TEST_LIMIT(보내기 전에)', lm.get('code') == 'ETAX_TEST_LIMIT', str(lm)[:100])
        ok('감사 기록 — INTEG_TEST_ETAX', int(psql("SELECT count(*) FROM audit.audit_logs WHERE action = 'INTEG_TEST_ETAX' AND occurred_at > now() - interval '30 minutes'") or 0) >= 4, '')
    finally:
        for f in ('api_1155', 'fake_etax_1155'):
            subprocess.run(['docker', 'exec', C, 'sh', '-c', f'[ -f /tmp/{f}.pid ] && kill $(cat /tmp/{f}.pid) 2>/dev/null; rm -f /tmp/{f}.pid'], capture_output=True)
        for k, v in was.items():
            psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}';")
        for k, v in foot0.items():
            if not v and foot_raw.get(k): psql(f"UPDATE site_settings SET value = {foot_raw[k]} WHERE key = '{k}';")
        if etax0: psql(f"UPDATE integrations SET status = '{etax0}' WHERE code = 'ETAX';")
        psql("DELETE FROM integration_tests WHERE integration_code = 'ETAX'")
    time.sleep(2)
    gone = inside('GET', 'http://127.0.0.1:3999/api/v1/health').get('_err') is not None
    ok('되돌림 — 두 번째 API · 가짜 서버 끔 · 설정 3개 · 연동 상태 · 시험 기록', gone and all(get(k) == v for k, v in was.items())
       and psql("SELECT status FROM integrations WHERE code = 'ETAX'") == etax0 and psql("SELECT count(*) FROM integration_tests WHERE integration_code = 'ETAX'") == '0', str(was))

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
