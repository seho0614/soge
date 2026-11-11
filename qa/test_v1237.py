"""v10.237 (D200 · docs/377) — 급한 운영 알림 · 하루 요약 슬랙 — **docker 를 부르므로 서버에서 직접**

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1237.py

  ① (코드) SlackService(웹훅 · 로그에 주소 없음 · & < > 바꿈 · mrkdwn 끔) · 정기 작업 alertSlack(텔레그램과 같은 글 · 보내진 통만 markSlacked) ·
     하루 요약 digestSlack · 연동 키 SLACK_WEBHOOK_URL · 설정 ops.slack_digest(SUPER) · API · 화면 · 명세 · 문서 377 · 판 v10.237 이상
  ② (DB) D200 — 칸 · 함수 3개 · 설정 on · 이미 있는 알림은 「슬랙 보냄」 · 웹훅 형식 검사(422 INTEG_SECRET_FORMAT) · 화면 상태(준비 안 됨 NO_WEBHOOK)
  ③ (가짜 슬랙) test_v1233 과 같은 틀(가짜 서버 127.0.0.1:18237 · 두 번째 API 127.0.0.1:3997 · SLACK_WEBHOOK_URL · 같은 DB) —
     시험 알림 60건 → 여러 통(각 4,000자 이하 · (k/n)) · 「보냄」 = 글 안 수 · 다음 차례 나머지 · 둘째 통 실패면 첫 통만 · 다시 열리면 나머지 ·
     텔레그램 기록(pushed_at)은 그대로 · 미리보기는 읽기만 · 시험 메시지 한 통(1분에 1번 409)
  ④ (화면) 「운영 알림」 슬랙 줄 · 미리보기 단추
  밖(실제 슬랙)으로는 아무것도 나가지 않습니다. 끝나면 두 프로세스를 끄고 시험 알림 · 감사 기록을 지웁니다.
"""
import json, os, re, subprocess, time, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB = os.environ.get('ADMIN_WEB')
C = os.environ.get('API_CONTAINER') or 'sgb-api'
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []
PW = 'sgb-dev-1234'
HOOK = '/services/T1237TEST/B1237TEST/fakeslack1237abcdef'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ──────────────────────────────────────────────────────────────
SL, SC = rd('src/common/slack/slack.service.ts'), rd('src/worker/scheduler.service.ts')
ok('① 슬랙 서비스 — 웹훅 주소는 연동 키(process.env) · 로그에 주소 없음 · & < > 바꿈 · mrkdwn 끔 · 4,000자 · 상태는 끝 4자만',
   "process.env.SLACK_WEBHOOK_URL?.trim()" in SL and "mrkdwn: false" in SL and "text.slice(0, TG_MAX)" in SL
   and "replace(/&/g, '&amp;')" in SL and "hook: `…${u.slice(-4)}`" in SL and 'this.log.warn(`슬랙 보내기 실패 ${r.errorKind}' in SL
   and not re.search(r'log\.\w+\([^)]*\bu\b[^)]*\)', SL), '')
ok('① 정기 작업 — alertSlack(텔레그램과 같은 buildAlertPush · 보내진 통만 markSlacked · 실패면 멈춤) · 하루 요약 digestSlack(ops.slack_digest) · detail alertSlack',
   "buildAlertPush(items, await this.launchWatch.alertBacklog('slack'))" in SC and SC.count('await this.launchWatch.markSlacked(p.items.filter') == 1
   and 'alertPush: ap, alertSlack: as,' in SC and "key = 'ops.slack_digest'" in SC and 'slacked: ds.pushed, slackReason: ds.reason' in SC
   and "this.launchWatch.alertPushPending('slack')" in SC, '')
LW, SE, AD = rd('src/modules/admin/launch-watch.service.ts'), rd('src/common/integration/secret.service.ts'), rd('src/modules/admin/admin.service.ts')
ok('① 대기 목록 · 기록 · 연동 키 · 설정 SUPER',
   "'FROM fn_ops_alert_slack_pending()'" in LW and "'FROM fn_ops_alert_slack_repush_pending()'" in LW and "slack: 'fn_ops_alert_slack_backlog()'" in LW
   and 'SET slack_pushed_at = now()' in LW and 'SET slack_repushed_at = now()' in LW
   and "name: 'SLACK_WEBHOOK_URL'" in SE and "k.name !== 'SLACK_WEBHOOK_URL'" in SE and "'ops.slack_digest'" in AD, '')
OS, CT, OA = rd('src/modules/admin/ops-alerts.service.ts'), rd('src/modules/admin/ops-review.controller.ts'), rd('web/src/app/admin/OpsAlerts.tsx')
SJ = json.loads(rd('spec/screens.json') or '{"screens":[]}'); sc = {s['id']: s for s in SJ.get('screens', [])}
ok('① API · 화면 · 명세 — slack-test(SUPER · OPS_SLACK_TEST · 1분) · slack-preview(읽기만) · mail-status 의 slack · 슬랙 줄',
   "@Post('ops-alerts/slack-test')" in CT and "@Audit('OPS_SLACK_TEST', 'OPS_ALERT')" in CT and "@Get('ops-alerts/slack-preview')" in CT
   and "'SLACK_TEST_WAIT'" in OS and 'slack: await this.slackStatus(j),' in OS
   and 'markSlacked' not in OS[OS.index('async slackPreview'):] and 'send(' not in OS[OS.index('async slackPreview'):]
   and 'data-slack-status=' in OA and 'data-slack-test=""' in OA and 'data-slack-digest-flip=""' in OA and "api<Preview>('/admin/ops-alerts/slack-preview')" in OA
   and all(a in sc.get('SB-ADM-OPS-010', {}).get('apis', []) for a in ('GET /admin/ops-alerts/slack-preview', 'POST /admin/ops-alerts/slack-test')), '')
MIG = os.path.join(K, 'prisma/migrations/D200_ops_alert_slack/migration.sql')
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('377_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 마이그레이션 D200 · 문서 377 · 판 v10.237 이상', os.path.exists(MIG) and bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 237),
   f'{DOC} · {rd("VERSION").strip()}')


def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m in ('POST', 'PUT', 'PATCH') else None), headers=hd, method=m)
    try:
        raw = urllib.request.urlopen(r, timeout=60).read()
        return json.loads(raw) if raw else {}
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


call2 = lambda m, p, b=None, t=None: inside(m, 'http://127.0.0.1:3997/api/v1' + p, b if b is not None else ({} if m == 'POST' else None), t)
fake = lambda b=None: inside('POST' if b is not None else 'GET', 'http://127.0.0.1:18237/__state', b)


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip() if not r.returncode else '!' + r.stderr.strip()[:120]


FAKE_JS = r"""
const http = require('http'); const S = { mode: 'ok', k: 0, calls: [] };
http.createServer((q, r) => { let d = ''; q.on('data', (c) => d += c); q.on('end', () => {
  const out = (c, t, j) => { r.writeHead(c, { 'content-type': j ? 'application/json' : 'text/plain' }); r.end(j ? JSON.stringify(t) : t); };
  if (q.url === '/__state') { if (q.method === 'POST') Object.assign(S, JSON.parse(d || '{}')); return out(200, S, true); }
  if (q.url !== 'HOOK') return out(404, 'no_service');
  let body = null; try { body = JSON.parse(d); } catch (e) { return out(400, 'invalid_payload'); }
  if (S.mode === 'fail2' && S.k++ >= 1) return out(502, 'bad gateway');
  S.calls.push({ b: body });
  return out(200, 'ok');
}); }).listen(18237, '127.0.0.1', () => console.log('fake up'));
""".replace('HOOK', HOOK)

# ── ② DB · ③ 가짜 슬랙 ───────────────────────────────────────────────────
up = subprocess.run(['docker', 'inspect', '-f', '{{.State.Running}}', C], capture_output=True, text=True).stdout.strip() == 'true'
ok('② 전제 — 점검판 API 컨테이너가 떠 있음', up, C)
if up:
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW})['accessToken']
    cols = psql("SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_name = 'ops_alerts' AND column_name LIKE 'slack_%'")
    fns = psql("SELECT string_agg(proname, ',' ORDER BY proname) FROM pg_proc WHERE proname LIKE 'fn_ops_alert_slack_%'")
    dg = psql("SELECT value FROM site_settings WHERE key = 'ops.slack_digest'")
    MS = open(MIG, encoding='utf-8').read() if os.path.exists(MIG) else ''
    old = '0' if ('UPDATE public.ops_alerts SET slack_pushed_at = coalesce(pushed_at, raised_at) WHERE slack_pushed_at IS NULL;' in MS
                  and "UPDATE public.ops_alerts SET slack_repushed_at = coalesce(repushed_at, raised_at) WHERE slack_repushed_at IS NULL AND severity = 'CRITICAL';" in MS) else '!'
    ok('② D200 — 칸 2 · 함수 3 · 설정 ops.slack_digest = on · 이미 있던 알림은 「슬랙 보냄」',
       cols == 'slack_pushed_at,slack_repushed_at' and fns == 'fn_ops_alert_slack_backlog,fn_ops_alert_slack_pending,fn_ops_alert_slack_repush_pending'
       and dg == 'on' and old == '0', f'{cols} · {fns} · {dg} · 옛 알림 보냄 처리 {old}')
    bad = call('PUT', '/admin/integration-keys/MAIL/SLACK_WEBHOOK_URL', {'value': 'https://evil.example.com/services/T1/B1/abc'}, T_)
    bad2 = call('PUT', '/admin/integration-keys/MAIL/SLACK_WEBHOOK_URL', {'value': 'http://hooks.slack.com/services/T1/B1/abc'}, T_)
    key0 = psql("SELECT count(*) FROM integration_secrets WHERE integration_code = 'MAIL' AND name = 'SLACK_WEBHOOK_URL'")
    ok('② 웹훅 형식 검사 — 다른 주소 · http 는 422 INTEG_SECRET_FORMAT · 저장 안 됨', bad.get('_err') == 422 and bad2.get('_err') == 422 and 'INTEG_SECRET_FORMAT' in f"{bad.get('code')}{bad.get('message')}"
       and key0 == '0', f"{bad.get('_err')} {bad.get('code')} · {bad2.get('_err')} · 저장 {key0}")
    ms = call('GET', '/admin/ops-alerts/mail-status', None, T_).get('slack') or {}
    ok('② 화면 상태 — 웹훅 없으면 준비 안 됨 NO_WEBHOOK · 하루 요약 on', ms.get('ready') is False and ms.get('reason') == 'NO_WEBHOOK' and (ms.get('digest') or {}).get('on') is True, json.dumps(ms, ensure_ascii=False)[:160])

    sends = lambda: fake().get('calls') or []
    calm = lambda: psql("UPDATE ops_alerts SET slack_pushed_at = now() - interval '2 hours' WHERE slack_pushed_at IS NULL AND coalesce(detail->>'test', '') <> 'v1237'")
    job = lambda: (calm(), (call2('POST', '/admin/jobs', {'job': 'launch_watch'}, T_).get('detail') or {}).get('alertSlack') or {})[1]
    near = lambda j, n: n <= (j.get('pushed') or 0) <= n + 3
    nslack = lambda b: psql(f"SELECT count(*) FILTER (WHERE slack_pushed_at IS NOT NULL) || ':' || count(*) FROM ops_alerts WHERE detail->>'test' = 'v1237' AND detail->>'b' = '{b}'")
    texts = lambda s: [(x.get('b') or {}).get('text', '') for x in s]
    marks = lambda ts: sum(len(re.findall(r'T1237-[AB]\d\d ', t)) for t in ts)

    def insert(b, n):
        return psql("INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at) "
                    f"SELECT 'TEST_V1237_{b}' || lpad(g::text, 2, '0'), 'CRITICAL', 'T1237-{b}' || lpad(g::text, 2, '0') || ' <a&b> ' || repeat('나', 180), "
                    f"jsonb_build_object('test', 'v1237', 'b', '{b}'), now() - make_interval(secs => g) FROM generate_series(0, {n - 1}) g RETURNING 1")

    t0 = psql("SELECT now()")
    try:
        ok('③ 전제 — 운영 화면에서 넣은 슬랙 웹훅이 없음(있으면 두 번째 API 의 시험 주소를 덮음)', key0 == '0', key0)
        subprocess.run(['docker', 'exec', '-i', C, 'sh', '-c', 'cat > /tmp/fake_sl_1237.js'], input=FAKE_JS, text=True, check=True)
        subprocess.run(['docker', 'exec', '-d', C, 'sh', '-c', 'node /tmp/fake_sl_1237.js > /tmp/fake_sl_1237.log 2>&1 & echo $! > /tmp/fake_sl_1237.pid'], check=True)
        env = f'PORT=3997 SLACK_WEBHOOK_URL=http://127.0.0.1:18237{HOOK} SLACK_TIMEOUT_MS=3000'
        subprocess.run(['docker', 'exec', '-d', C, 'sh', '-c', f'cd /app && {env} node scripts/dev-server.js > /tmp/api_1237.log 2>&1 & echo $! > /tmp/api_1237.pid'], check=True)
        t1 = time.time(); h = {}
        while time.time() - t1 < 240:
            h = inside('GET', 'http://127.0.0.1:3997/api/v1/health')
            if h.get('_err') is None: break
            time.sleep(4)
        ready = h.get('_err') is None and fake().get('_err') is None
        if not ready:
            print(subprocess.run(['docker', 'exec', C, 'tail', '-15', '/tmp/api_1237.log'], capture_output=True, text=True).stdout)
        ok('③ 준비 — 가짜 슬랙 서버 · 두 번째 API(SLACK_WEBHOOK_URL) 뜸', ready, f'{int(time.time() - t1)}초')

        psql("UPDATE ops_alerts SET slack_pushed_at = now() - interval '2 hours' WHERE slack_pushed_at IS NULL")
        psql("UPDATE ops_alerts SET slack_repushed_at = now() - interval '1 hour' WHERE slack_repushed_at IS NULL AND severity = 'CRITICAL'")
        ia = insert('A', 60)
        ok('③ 시험 알림 60건 넣음', not ia.startswith('!') and ia.count('1') == 60, ia[:80])
        st2 = call2('GET', '/admin/ops-alerts/mail-status', None, T_).get('slack') or {}
        pv1 = call2('GET', '/admin/ops-alerts/slack-preview', None, T_)
        pv2 = call2('GET', '/admin/ops-alerts/slack-preview', None, T_)
        ok('③ 준비됨(웹훅 끝 4자만) · 미리보기 — 1 ~ 3통 · 읽기만(두 번 같음 · 「보냄」 그대로 · 보낸 글 0)',
           st2.get('ready') is True and st2.get('hook') == '…' + HOOK[-4:] and HOOK[:-4] not in json.dumps(st2)
           and 1 <= len(pv1.get('parts') or []) <= 3 and pv1.get('parts') == pv2.get('parts') and nslack('A') == '0:60' and len(sends()) == 0,
           f"{st2.get('hook')} · {len(pv1.get('parts') or [])}통 · {nslack('A')} · 보낸 글 {len(sends())}")
        push0 = psql("SELECT count(*) FILTER (WHERE pushed_at IS NOT NULL) FROM ops_alerts WHERE detail->>'test' = 'v1237'")
        n1 = len(sends()); j1 = job(); s1 = texts(sends()[n1:])
        pa = nslack('A'); sent1 = int(pa.split(':')[0] or 0)
        heads = all(f'({i + 1}/{len(s1)})' in t.splitlines()[0] for i, t in enumerate(s1))
        m1 = re.search(r'보내지 못한 알림 (\d+)건 더', s1[-1]) if s1 else None
        bodies = [x.get('b') or {} for x in sends()[n1:]]
        ok('③ 첫 차례 — 여러 통(2 ~ 3) · 각 4,000자 이하 · (k/n) 머리 · 글 안 알림 수 = 「보냄」 ≤ 작업 pushed · mrkdwn 끔 · & < > 바꿈',
           2 <= len(s1) <= 3 and all(len(t) <= 4000 for t in s1) and heads and marks(s1) == sent1 and near(j1, sent1) and j1.get('parts') == len(s1)
           and j1.get('reason') is None and all(b.get('mrkdwn') is False for b in bodies) and all('&lt;a&amp;b&gt;' in t and '<a&b>' not in t for t in s1),
           f'{len(s1)}통 {[len(t) for t in s1]} · 보냄 {pa} · {j1}')
        ok('③ 「n건 더」 — 마지막 통에만 · n = 60 − 보낸 수', m1 is not None and 60 - sent1 <= int(m1.group(1)) <= 60 - sent1 + 3
           and all('보내지 못한 알림' not in t for t in s1[:-1]), f'{m1.group(0) if m1 else None} · 보냄 {sent1}')
        n2 = len(sends()); j2 = job(); s2 = texts(sends()[n2:])
        ok('③ 다음 차례 — 남은 것 한 통 · 60건 모두 「보냄」', len(s2) == 1 and '(1/1)' not in s2[0] and marks(s2) == 60 - sent1 and nslack('A') == '60:60' and j2.get('parts') == 1,
           f'{len(s2)}통 · {nslack("A")} · {j2}')

        ib = insert('B', 40)
        fake({'mode': 'fail2', 'k': 0})
        n3 = len(sends()); j3 = job(); s3 = texts(sends()[n3:])
        pb = nslack('B'); sent3 = int(pb.split(':')[0] or 0)
        ok('③ 둘째 통 실패(502) — 첫 통만 · 그 알림만 「보냄」 · 까닭 SEND_SERVER',
           not ib.startswith('!') and len(s3) == 1 and 0 < sent3 < 40 and marks(s3) == sent3 and near(j3, sent3) and j3.get('reason') == 'SEND_SERVER', f'보냄 {pb} · {j3}')
        fake({'mode': 'ok'})
        n4 = len(sends()); j4 = job(); s4 = texts(sends()[n4:])
        push1 = psql("SELECT count(*) FILTER (WHERE pushed_at IS NOT NULL) FROM ops_alerts WHERE detail->>'test' = 'v1237'")
        ok('③ 다시 열리면 나머지 · 40건 모두 「보냄」 · 텔레그램 기록(pushed_at)은 건드리지 않음',
           nslack('B') == '40:40' and marks(s4) == 40 - sent3 and j4.get('reason') is None and push0 == push1 == '0', f'{len(s4)}통 · {nslack("B")} · 텔레그램 {push0}/{push1}')

        for _ in range(14):   # 감사 기록은 지울 수 없음 — 앞선 실행의 시험 메시지가 1분 안이면 기다림(두 번 돌려도 통과)
            if psql("SELECT count(*) FROM audit.audit_logs WHERE action = 'OPS_SLACK_TEST' AND occurred_at > now() - interval '1 minute'") == '0': break
            time.sleep(5)
        n5 = len(sends())
        tt = call2('POST', '/admin/ops-alerts/slack-test', {}, T_)
        tt2 = call2('POST', '/admin/ops-alerts/slack-test', {}, T_)
        s5 = texts(sends()[n5:])
        ok('③ 시험 메시지 — 한 통 · 1분 안에 다시 누르면 409 SLACK_TEST_WAIT', tt.get('ok') is True and len(s5) == 1 and '시험 메시지' in s5[0]
           and (tt2.get('_err'), tt2.get('code')) == (409, 'SLACK_TEST_WAIT'), f"{tt} · {tt2.get('_err')} {tt2.get('code')}")
    finally:
        for f in ('api_1237', 'fake_sl_1237'):
            subprocess.run(['docker', 'exec', C, 'sh', '-c', f'[ -f /tmp/{f}.pid ] && kill $(cat /tmp/{f}.pid) 2>/dev/null; rm -f /tmp/{f}.pid'], capture_output=True)
        subprocess.run(['docker', 'exec', C, 'sh', '-c', "for d in /proc/[0-9]*; do grep -qa -e 'SLACK_WEBHOOK_URL=http://127.0.0.1:1823[7]' -e 'fake_sl_[1]237' $d/environ $d/cmdline 2>/dev/null && kill ${d#/proc/} 2>/dev/null; done; true"], capture_output=True)
        psql("DELETE FROM ops_alerts WHERE detail->>'test' = 'v1237'")

    # ── ④ 화면 ──
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if ADMIN_WEB and sync_playwright:
        errs = []
        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = b.new_page(viewport={'width': 1400, 'height': 900})
            pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
            pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
            pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
            pg.goto(ADMIN_WEB + '/#/ops-alerts', wait_until='networkidle', timeout=120000)
            pg.reload(wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
            row = pg.locator('[data-slack-status]')
            st = row.first.get_attribute('data-slack-status') if row.count() else None
            btn = pg.locator('[data-slack-preview-load]')
            if btn.count(): btn.first.click(); pg.wait_for_timeout(2500)
            note = pg.locator('[data-slack-preview-note]')
            seen = (st, pg.locator('[data-slack-test]').count(), pg.locator('[data-slack-digest-flip]').count(), note.count())
            pg.screenshot(path=os.path.join(HERE, 'v1237_slack_row.png'), full_page=False)
            b.close()
        ok('④ 「운영 알림」 슬랙 줄(준비 안 됨) · 시험 · 하루 요약 단추 · 미리보기 안내 줄 · 화면 오류 없음', seen == ('not-ready', 1, 1, 1) and not errs, f'{seen} · {errs[:2]}')
    else:
        print('  (운영 화면 · playwright 없음 — ④ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
