"""v10.233 (docs/373) — 급한 알림 텔레그램 나눠 보내기 — **docker 를 부르므로 서버에서 직접**

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb python3 test_v1233.py

  ① (코드) TG_MAX 4,000 · packLines · alertPush 최대 3통 · 제목 200자 · 보내진 통만 「보냄」 · send() truncated · 문서 373 · 판 v10.233 이상
  ② (가짜 텔레그램) test_v1200_push 와 같은 틀(가짜 서버 127.0.0.1:18233 · 두 번째 API 127.0.0.1:3998 · 같은 DB) —
     긴 제목 시험 알림 60건 → 한 차례에 여러 통(각 4,000자 이하 · (k/n) 머리) · 글 안 알림 수 = 「보냄」 기록 수 · 마지막 통에만 「n건 더」(n = 남은 수) ·
     다음 차례에 남은 것 한 통 · 둘째 통이 실패하면 첫 통 알림만 「보냄」 · 다시 열리면 나머지
  밖(실제 텔레그램)으로는 아무것도 나가지 않습니다. 끝나면 두 프로세스를 끄고 설정 · 시험 알림을 지웁니다.
"""
import json, os, re, subprocess, time, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
C = os.environ.get('API_CONTAINER') or 'sgb-api'
RES = []
PW = 'sgb-dev-1234'
TOKEN = '987654321:AAT1233splittokenabcdefghijklmnopqrstu'
CHAT = '-1001234501233'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ──────────────────────────────────────────────────────────────
TG, SC = rd('src/common/telegram/telegram.service.ts'), rd('src/worker/scheduler.service.ts')
ok('① 텔레그램 — TG_MAX 4,000 · packLines(최대 통 수 · 줄바꿈 포함 길이) · 잘리면 truncated · 로그',
   'export const TG_MAX = 4000;' in TG and 'export function packLines(lines: string[], budget: number, maxParts: number): string[][]' in TG
   and 'text.slice(0, TG_MAX)' in TG and 'truncated ? { ...r, truncated } : r' in TG, '')
ok('① 정기 작업 — 최대 3통 · 제목 200자 · 머리 · 끝 자리 먼저 · 보내진 통의 알림만 markPushed · 실패하면 그 자리에서 멈춤',
   'const PARTS = 3, TITLE_MAX = 200;' in SC and 'packLines(items.map(line), budget, PARTS)' in SC
   and 'const budget = TG_MAX - head(items, PARTS, PARTS).length - 2 - tail(Math.max(backlog, items.length)).length - 1;' in SC
   and SC.count('await this.launchWatch.markPushed(list.filter') == 1 and "reason: `SEND_${r.errorKind ?? 'FAILED'}`, parts }" in SC, '')
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('373_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 문서 373 · 판 v10.233 이상', bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 233), f'{DOC} · {rd("VERSION").strip()}')


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
    r = subprocess.run(['docker', 'exec', C, 'node', '-e', FETCH, m, url, json.dumps(b) if b is not None else '', t or ''], capture_output=True, text=True, timeout=120)
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


call2 = lambda m, p, b=None, t=None: inside(m, 'http://127.0.0.1:3998/api/v1' + p, b if b is not None else ({} if m == 'POST' else None), t)
fake = lambda b=None: inside('POST' if b is not None else 'GET', 'http://127.0.0.1:18233/__state', b)


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip() if not r.returncode else '!' + r.stderr.strip()[:120]


FAKE_JS = r"""
const http = require('http'); const S = { mode: 'ok', k: 0, calls: [] };
http.createServer((q, r) => { let d = ''; q.on('data', (c) => d += c); q.on('end', () => {
  const out = (c, o) => { r.writeHead(c, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
  if (q.url === '/__state') { if (q.method === 'POST') Object.assign(S, JSON.parse(d || '{}')); return out(200, S); }
  let body = null; try { body = d ? JSON.parse(d) : null; } catch (e) { body = d; }
  const m = /^\/bot([^/]+)\/(\w+)$/.exec(q.url || '');
  if (!m || m[1] !== 'TOKEN') return out(401, { ok: false, error_code: 401, description: 'Unauthorized' });
  if (m[2] === 'sendMessage') {
    if (S.mode === 'fail2' && S.k++ >= 1) return out(502, { ok: false, error_code: 502, description: 'Bad Gateway' });
    S.calls.push({ method: 'sendMessage', b: body });
    return out(200, { ok: true, result: { message_id: S.calls.length } });
  }
  return out(404, { ok: false, description: 'Not Found' });
}); }).listen(18233, '127.0.0.1', () => console.log('fake up'));
""".replace('TOKEN', TOKEN)

up = subprocess.run(['docker', 'inspect', '-f', '{{.State.Running}}', C], capture_output=True, text=True).stdout.strip() == 'true'
ok('② 전제 — 점검판 API 컨테이너가 떠 있음', up, C)
if up:
    chat0 = psql("SELECT CASE WHEN value IS NULL THEN 'NULL' ELSE quote_literal(value) END FROM site_settings WHERE key = 'ops.telegram_chat'")
    tok0 = psql("SELECT count(*) FROM integration_secrets WHERE integration_code = 'MAIL' AND name = 'TELEGRAM_BOT_TOKEN'")
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW})['accessToken']
    sends = lambda: [c for c in (fake().get('calls') or []) if c.get('method') == 'sendMessage']
    # 작업 안에서 다른 알림이 새로 생길 수 있음 — 부르기 전에 시험 아닌 알림을 「보냄」으로 · 수는 시험 줄로만 견줌(작업 pushed 는 그 이상)
    calm = lambda: psql("UPDATE ops_alerts SET pushed_at = now() - interval '2 hours' WHERE pushed_at IS NULL AND coalesce(detail->>'test', '') <> 'v1233'")
    job = lambda: (calm(), (call2('POST', '/admin/jobs', {'job': 'launch_watch'}, T_).get('detail') or {}).get('alertPush') or {})[1]
    near = lambda j, n: n <= (j.get('pushed') or 0) <= n + 3
    npushed = lambda b: psql(f"SELECT count(*) FILTER (WHERE pushed_at IS NOT NULL) || ':' || count(*) FROM ops_alerts WHERE detail->>'test' = 'v1233' AND detail->>'b' = '{b}'")
    texts = lambda s: [(x.get('b') or {}).get('text', '') for x in s]
    marks = lambda ts: sum(len(re.findall(r'T1233-[AB]\d\d ', t)) for t in ts)

    def insert(b, n):
        r = psql("INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at) "
                 f"SELECT 'TEST_V1233_{b}' || lpad(g::text, 2, '0'), 'CRITICAL', 'T1233-{b}' || lpad(g::text, 2, '0') || ' ' || repeat('가', 185), "
                 f"jsonb_build_object('test', 'v1233', 'b', '{b}'), now() - make_interval(secs => g) FROM generate_series(0, {n - 1}) g RETURNING 1")
        return r

    try:
        ok('② 전제 — 운영 화면에서 넣은 텔레그램 토큰이 없음(있으면 두 번째 API 의 시험 토큰을 덮음)', tok0 == '0', tok0)
        subprocess.run(['docker', 'exec', '-i', C, 'sh', '-c', 'cat > /tmp/fake_tg_1233.js'], input=FAKE_JS, text=True, check=True)
        subprocess.run(['docker', 'exec', '-d', C, 'sh', '-c', 'node /tmp/fake_tg_1233.js > /tmp/fake_tg_1233.log 2>&1 & echo $! > /tmp/fake_tg_1233.pid'], check=True)
        env = f'PORT=3998 TELEGRAM_API_BASE=http://127.0.0.1:18233 TELEGRAM_BOT_TOKEN={TOKEN} TELEGRAM_TIMEOUT_MS=3000'
        subprocess.run(['docker', 'exec', '-d', C, 'sh', '-c', f'cd /app && {env} node scripts/dev-server.js > /tmp/api_1233.log 2>&1 & echo $! > /tmp/api_1233.pid'], check=True)
        t1 = time.time(); h = {}
        while time.time() - t1 < 240:
            h = inside('GET', 'http://127.0.0.1:3998/api/v1/health')
            if h.get('_err') is None: break
            time.sleep(4)
        ready = h.get('_err') is None and fake().get('_err') is None
        if not ready:
            print(subprocess.run(['docker', 'exec', C, 'tail', '-15', '/tmp/api_1233.log'], capture_output=True, text=True).stdout)
        ok('② 준비 — 가짜 텔레그램 서버 · 두 번째 API(TELEGRAM_API_BASE · 시험 토큰) 뜸', ready, f'{int(time.time() - t1)}초')
        psql(f"UPDATE site_settings SET value = '{CHAT}' WHERE key = 'ops.telegram_chat'")

        # 다른 알림은 「2시간 전에 보냄」으로(이 시험 알림만 대기 목록에) · 긴 제목 CRITICAL 60건(종류마다 다름)
        psql("UPDATE ops_alerts SET pushed_at = now() - interval '2 hours' WHERE pushed_at IS NULL")
        psql("UPDATE ops_alerts SET repushed_at = now() - interval '1 hour' WHERE repushed_at IS NULL AND severity = 'CRITICAL'")
        ia = insert('A', 60)
        ok('② 시험 알림 60건 넣음', not ia.startswith('!') and ia.count('1') == 60, ia[:80])
        n1 = len(sends()); j1 = job(); s1 = texts(sends()[n1:])
        pa = npushed('A'); sent1 = int(pa.split(':')[0] or 0)
        heads = all(f'({i + 1}/{len(s1)})' in t.splitlines()[0] for i, t in enumerate(s1))
        m1 = re.search(r'보내지 못한 알림 (\d+)건 더', s1[-1]) if s1 else None
        ok('② 첫 차례 — 여러 통(2 ~ 3) · 각 4,000자 이하 · (k/n) 머리 · 글 안 알림 수 = 「보냄」 기록 ≤ 작업 pushed · 통 수 = parts',
           2 <= len(s1) <= 3 and all(len(t) <= 4000 for t in s1) and heads and marks(s1) == sent1 and near(j1, sent1) and j1.get('parts') == len(s1)
           and j1.get('reason') is None and all((x.get('b') or {}).get('chat_id') == CHAT for x in sends()[n1:]),
           f'{len(s1)}통 {[len(t) for t in s1]} · 보냄 {pa} · {j1}')
        ok('② 「n건 더」 — 마지막 통에만 · n = 60 − 보낸 수 · 앞 통에는 끝 안내 줄 없음 · 제목 줄 200자 이하',
           m1 is not None and 60 - sent1 <= int(m1.group(1)) <= 60 - sent1 + 3 and all('보내지 못한 알림' not in t and '「확인」을 누르십시오' not in t for t in s1[:-1])
           and '「확인」을 누르십시오' in s1[-1] and all(len(l) <= 260 for t in s1 for l in t.splitlines()),
           f'{m1.group(0) if m1 else None} · 보냄 {sent1}')

        n2 = len(sends()); j2 = job(); s2 = texts(sends()[n2:])
        ok('② 다음 차례 — 남은 것 한 통((1/1) 머리 없음 · 「n건 더」 없음) · 60건 모두 「보냄」',
           len(s2) == 1 and '(1/1)' not in s2[0] and '보내지 못한 알림' not in s2[0] and marks(s2) == 60 - sent1 and npushed('A') == '60:60' and j2.get('parts') == 1,
           f'{len(s2)}통 · {npushed("A")} · {j2}')

        # 둘째 통이 실패 → 첫 통 알림만 「보냄」 · 다시 열리면 나머지
        ib = insert('B', 40)
        fake({'mode': 'fail2', 'k': 0})
        n3 = len(sends()); j3 = job(); s3 = texts(sends()[n3:])
        pb = npushed('B'); sent3 = int(pb.split(':')[0] or 0)
        ok('② 둘째 통 실패(502) — 첫 통만 감 · 그 알림만 「보냄」 · 까닭 SEND_SERVER · 남은 수',
           not ib.startswith('!') and len(s3) == 1 and 0 < sent3 < 40 and marks(s3) == sent3 and near(j3, sent3) and j3.get('reason') == 'SEND_SERVER'
           and (j3.get('pending') or 0) >= 40 - sent3 and j3.get('parts') == 1, f'보냄 {pb} · {j3}')
        fake({'mode': 'ok'})
        n4 = len(sends()); j4 = job(); s4 = texts(sends()[n4:])
        ok('② 다시 열리면 — 나머지를 보냄 · 40건 모두 「보냄」 · 겹쳐 보낸 알림 없음',
           npushed('B') == '40:40' and marks(s4) == 40 - sent3 and j4.get('reason') is None and all(len(t) <= 4000 for t in s4), f'{len(s4)}통 · {npushed("B")} · {j4}')
    finally:
        for f in ('api_1233', 'fake_tg_1233'):
            subprocess.run(['docker', 'exec', C, 'sh', '-c', f'[ -f /tmp/{f}.pid ] && kill $(cat /tmp/{f}.pid) 2>/dev/null; rm -f /tmp/{f}.pid'], capture_output=True)
        subprocess.run(['docker', 'exec', C, 'sh', '-c', "for d in /proc/[0-9]*; do grep -qa -e 'TELEGRAM_API_BASE=http://127.0.0.1:1823[3]' -e 'fake_tg_[1]233' $d/environ $d/cmdline 2>/dev/null && kill ${d#/proc/} 2>/dev/null; done; true"], capture_output=True)
        psql("DELETE FROM ops_alerts WHERE detail->>'test' = 'v1233'")
        psql(f"UPDATE site_settings SET value = {chat0 or 'NULL'} WHERE key = 'ops.telegram_chat'")

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
