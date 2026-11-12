"""v10.238 ~ v10.240 (docs/379) — 급한 알림 받는 길 · 알림 길 연속 실패 경보 · 대표 할 일 — **docker 를 부르므로 서버에서 직접**

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1238.py

  ① (코드) AlertChannelsService(메일은 받는 주소까지 · 실패 시각 · ALERT_CHANNEL_FAIL CRITICAL · 풀림) · 정기 작업 failWatch · 하루 요약 줄 ·
     운영 상태 「급한 알림 받는 길」 줄 · 대표 할 일(OwnerTodoService · owner-todo API · 화면 카드) · 명세 · 문서 379 · 판 v10.240 이상
  ② (점검판 API · 길 0) 운영 상태 12줄 · 받는 길 줄(0 / 3 · CRITICAL 있으면 warn) · 하루 요약 줄 · 대표 할 일 12줄(자동 9 · 직접 3)
  ③ (가짜 슬랙) test_v1237 과 같은 틀(가짜 서버 127.0.0.1:18238 · 두 번째 API 127.0.0.1:3998 · SLACK_WEBHOOK_URL · ALERT_FAIL_MINUTES=0) —
     계속 502 → ALERT_CHANNEL_FAIL 1건(CRITICAL · 슬랙 · 까닭) · 다시 돌려도 1건 · 텔레그램 대기 목록에 들어감(다른 길로) ·
     받는 길 줄 1 / 3 ok · 다시 열리면 「풀림(슬랙 다시 보내짐)」 · 가짜 슬랙에 경보 글 도착
  ④ (화면) 첫 화면 받는 길 줄 · 대표 할 일 카드
  밖으로는 아무것도 나가지 않습니다. 끝나면 두 프로세스를 끄고 시험 알림을 지웁니다.
"""
import json, os, re, subprocess, time, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB = os.environ.get('ADMIN_WEB')
C = os.environ.get('API_CONTAINER') or 'sgb-api'
RES = []
PW = 'sgb-dev-1234'
HOOK = '/services/T1238TEST/B1238TEST/fakeslack1238abcdef'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ──────────────────────────────────────────────────────────────
AC, OT, SC = rd('src/modules/admin/alert-channels.service.ts'), rd('src/modules/admin/owner-todo.service.ts'), rd('src/worker/scheduler.service.ts')
ok('① 받는 길 — 메일은 설정 + 받는 주소(NO_TO) · 텔레그램 · 슬랙 상태 · 하루 요약 · 운영 상태가 같은 셈',
   "'NO_TO'" in AC and 'this.telegram.status()' in AC and 'this.slack.status()' in AC and 'static line(list: ChannelState[])' in AC
   and 'channelLine(await this.channels.channels())' in rd('src/modules/admin/launch-watch.service.ts')
   and "key: 'alert-channels'" in rd('src/modules/admin/state-check.service.ts'), '')
ok('① 연속 실패 경보 — SEND_ 만 실패 · 60분(ALERT_FAIL_MINUTES) · 길마다 한 건 · CRITICAL · 다시 되거나 꺼지면 풀림 · 정기 작업 detail channelFail',
   "r.reason.startsWith('SEND_') && r.pending > 0" in AC and ": 60;" in AC and "VALUES ('ALERT_CHANNEL_FAIL', 'CRITICAL'" in AC
   and "detail->>'channel' = $1" in AC and 'resolved_at = now()' in AC
   and 'this.channels.failWatch({ mail: am, telegram: ap, slack: as })' in SC and 'channelFail: cf' in SC, '')
CT, ST = rd('src/modules/admin/launch-watch.controller.ts'), rd('web/src/app/admin/StateCheck.tsx')
SJ = json.loads(rd('spec/screens.json') or '{"screens":[]}'); sc = {s['id']: s for s in SJ.get('screens', [])}
V241 = 'MANUAL_KEYS' in OT   # v10.241 ~ 242(test_v1241) — 직접 확인 줄은 manual: true · 정기 점검 3줄 더해 15줄
ok('① 대표 할 일 — 자동 9 · 직접 확인 3 · owner-todo API(읽기만) · 첫 화면 카드 · 명세',
   (OT.count("done: null") == 3 or (V241 and "manual: true" in OT)) and "@Get('owner-todo')" in CT and 'data-owner-todo' in ST and '<OwnerTodo onGo={onGo} canGo={canGo} />' in rd('web/src/app/admin/Dashboard.tsx')
   and any('GET /admin/launch-watch/owner-todo' in s.get('apis', []) for s in sc.values())
   and "ALERT_CHANNEL_FAIL: '급한 알림 길 연속 실패'" in rd('web/src/app/admin/OpsAlerts.tsx'), '')
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('379_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 문서 379 · 판 v10.240 이상', bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 240), f'{DOC} · {rd("VERSION").strip()}')


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


call2 = lambda m, p, b=None, t=None: inside(m, 'http://127.0.0.1:3998/api/v1' + p, b if b is not None else ({} if m == 'POST' else None), t)
fake = lambda b=None: inside('POST' if b is not None else 'GET', 'http://127.0.0.1:18238/__state', b)


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip() if not r.returncode else '!' + r.stderr.strip()[:120]


FAKE_JS = r"""
const http = require('http'); const S = { mode: 'ok', calls: [] };
http.createServer((q, r) => { let d = ''; q.on('data', (c) => d += c); q.on('end', () => {
  const out = (c, t, j) => { r.writeHead(c, { 'content-type': j ? 'application/json' : 'text/plain' }); r.end(j ? JSON.stringify(t) : t); };
  if (q.url === '/__state') { if (q.method === 'POST') Object.assign(S, JSON.parse(d || '{}')); return out(200, S, true); }
  if (q.url !== 'HOOK') return out(404, 'no_service');
  let body = null; try { body = JSON.parse(d); } catch (e) { return out(400, 'invalid_payload'); }
  if (S.mode === 'fail') return out(502, 'bad gateway');
  S.calls.push({ b: body });
  return out(200, 'ok');
}); }).listen(18238, '127.0.0.1', () => console.log('fake up'));
""".replace('HOOK', HOOK)

up = subprocess.run(['docker', 'inspect', '-f', '{{.State.Running}}', C], capture_output=True, text=True).stdout.strip() == 'true'
ok('② 전제 — 점검판 API 컨테이너가 떠 있음', up, C)
if up:
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW})['accessToken']
    key0 = psql("SELECT count(*) FROM integration_secrets WHERE integration_code = 'MAIL' AND name IN ('SLACK_WEBHOOK_URL', 'TELEGRAM_BOT_TOKEN')")
    t0 = psql("SELECT now()")
    try:
        # ── ② 길 0(점검판 API) ──
        ins = psql("INSERT INTO ops_alerts (alert_code, severity, title, detail) VALUES ('TEST_V1238_CRIT', 'CRITICAL', 'T1238 시험 긴급', '{\"test\": \"v1238\"}'::jsonb) RETURNING id")
        rows = call('GET', '/admin/launch-watch/state', None, T_)
        rw = {r['key']: r for r in rows} if isinstance(rows, list) else {}
        acr = rw.get('alert-channels') or {}
        keys = [r['key'] for r in rows] if isinstance(rows, list) else []
        ok('② 운영 상태 12줄 · 「급한 알림 받는 길」은 「운영 알림」 바로 아래 · 0 / 3 · 확인 안 한 CRITICAL 이 있어 warn · 까닭 글',
           len(rows) == 12 and keys.index('alert-channels') == keys.index('alerts') + 1 and acr.get('state') == 'warn'
           and acr.get('now', '').startswith('0 / 3') and '메일 준비 안 됨(' in acr.get('now', '') and '슬랙 준비 안 됨(웹훅 주소 없음)' in acr.get('now', '')
           and '운영 화면 밖으로 나가지 않음' in acr.get('now', '') and acr.get('go') == 'ops-alerts' and key0 == '0', f'{len(rows)}줄 · {json.dumps(acr, ensure_ascii=False)[:200]} · 키 {key0}')
        dg = call('GET', '/admin/launch-watch/digest', None, T_).get('text') or ''
        ok('② 하루 요약 — 「급한 알림 받는 길 0 / 3: …」 · 하나도 없으면 그 뜻', '급한 알림 받는 길 0 / 3: 메일 준비 안 됨(' in dg and '하나도 없어 급한 알림이 운영 화면 밖으로 나가지 않습니다' in dg,
           next((l for l in dg.splitlines() if '받는 길' in l), '')[:160])
        td = call('GET', '/admin/launch-watch/owner-todo', None, T_)
        tr = {r['key']: r for r in td.get('rows', [])}
        man = [r['key'] for r in td.get('rows', []) if (r.get('manual') if V241 else r.get('done') is None)]
        auto = [r for r in td.get('rows', []) if r.get('done') is not None]
        NR, NT = (15, 15) if V241 else (12, 9)
        ok('② 대표 할 일 — 12줄(자동 9 · 직접 확인 3: 요금제 · 법무 · EBS) · 끝남 = 자동 중 됨 · 받는 길 · CRITICAL 아직',
           len(tr) == NR and td.get('total') == NT and man == ['plans', 'legal', 'ebs'] and td.get('done') == sum(1 for r in auto if r['done'])
           and tr.get('channels', {}).get('done') is False and tr.get('critical', {}).get('done') is False
           and all(r.get('go') for r in td.get('rows', [])), f"{td.get('done')} / {td.get('total')} · {[(k, v.get('done')) for k, v in tr.items()]}")
        rev = call('GET', '/admin/launch-watch/owner-todo', None, call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW}).get('accessToken'))
        ok('② 대표 할 일 — 일반 회원은 403', rev.get('_err') == 403, str(rev.get('_err')))

        # ── ③ 가짜 슬랙 · 연속 실패 ──
        subprocess.run(['docker', 'exec', '-i', C, 'sh', '-c', 'cat > /tmp/fake_sl_1238.js'], input=FAKE_JS, text=True, check=True)
        subprocess.run(['docker', 'exec', '-d', C, 'sh', '-c', 'node /tmp/fake_sl_1238.js > /tmp/fake_sl_1238.log 2>&1 & echo $! > /tmp/fake_sl_1238.pid'], check=True)
        env = f'PORT=3998 SLACK_WEBHOOK_URL=http://127.0.0.1:18238{HOOK} SLACK_TIMEOUT_MS=3000 ALERT_FAIL_MINUTES=0'
        subprocess.run(['docker', 'exec', '-d', C, 'sh', '-c', f'cd /app && {env} node scripts/dev-server.js > /tmp/api_1238.log 2>&1 & echo $! > /tmp/api_1238.pid'], check=True)
        t1 = time.time(); h = {}
        while time.time() - t1 < 240:
            h = inside('GET', 'http://127.0.0.1:3998/api/v1/health')
            if h.get('_err') is None: break
            time.sleep(4)
        ready = h.get('_err') is None and fake().get('_err') is None
        if not ready:
            print(subprocess.run(['docker', 'exec', C, 'tail', '-15', '/tmp/api_1238.log'], capture_output=True, text=True).stdout)
        ok('③ 준비 — 가짜 슬랙 서버 · 두 번째 API(SLACK_WEBHOOK_URL · ALERT_FAIL_MINUTES=0) 뜸', ready, f'{int(time.time() - t1)}초')

        psql(f"UPDATE ops_alerts SET slack_pushed_at = now() - interval '2 hours' WHERE slack_pushed_at IS NULL AND id <> {int(ins) if ins.isdigit() else 0}")
        psql(f"UPDATE ops_alerts SET slack_repushed_at = now() - interval '1 hour' WHERE slack_repushed_at IS NULL AND severity = 'CRITICAL' AND id <> {int(ins) if ins.isdigit() else 0}")
        fake({'mode': 'fail'})
        job = lambda: call2('POST', '/admin/jobs', {'job': 'launch_watch'}, T_).get('detail') or {}
        fails = lambda: psql("SELECT count(*) || '|' || coalesce(string_agg(severity || '|' || (detail->>'channel') || '|' || title, ' ## '), '') FROM ops_alerts "
                             f"WHERE alert_code = 'ALERT_CHANNEL_FAIL' AND resolved_at IS NULL AND raised_at >= '{t0}'")
        j1 = job(); f1 = fails()
        ok('③ 슬랙 계속 실패(502) — ALERT_CHANNEL_FAIL 1건 · CRITICAL · 슬랙 · 까닭 「상대 서버 오류」 · 못 보낸 수 · detail channelFail',
           f1.startswith('1|CRITICAL|slack|급한 알림 슬랙이(가)') and '상대 서버 오류' in f1 and '못 보낸 알림' in f1
           and (j1.get('alertSlack') or {}).get('reason') == 'SEND_SERVER' and (j1.get('channelFail') or {}).get('raised') == ['slack'], f'{f1[:160]} · {j1.get("channelFail")}')
        j2 = job(); f2 = fails()
        ok('③ 다시 돌려도 1건(길마다 한 건) · 여전히 실패 중', f2.split('|')[0] == '1' and (j2.get('channelFail') or {}).get('raised') == [] and (j2.get('channelFail') or {}).get('failing') == ['slack'],
           f'{f2[:40]} · {j2.get("channelFail")}')
        other = psql("SELECT count(*) FROM fn_ops_alert_push_pending() WHERE alert_code = 'ALERT_CHANNEL_FAIL'")
        ok('③ 경보는 다른 길(텔레그램) 대기 목록에 들어감 — CRITICAL', other == '1', other)
        st2 = {r['key']: r for r in call2('GET', '/admin/launch-watch/state', None, T_)}.get('alert-channels') or {}
        ok('③ 슬랙이 준비된 API 에서는 받는 길 1 / 3 · ok', st2.get('state') == 'ok' and st2.get('now', '').startswith('1 / 3') and '슬랙 준비됨' in st2.get('now', ''), json.dumps(st2, ensure_ascii=False)[:160])
        fake({'mode': 'ok'})
        n0 = len(fake().get('calls') or [])
        j3 = job()
        res = psql(f"SELECT count(*) FILTER (WHERE resolved_at IS NOT NULL) || '|' || coalesce(max(resolve_note), '') FROM ops_alerts WHERE alert_code = 'ALERT_CHANNEL_FAIL' AND raised_at >= '{t0}'")
        got = ' '.join(((x.get('b') or {}).get('text') or '') for x in (fake().get('calls') or [])[n0:])
        ok('③ 다시 열리면 — 보냄 · 경보 「풀림(슬랙 다시 보내짐)」 · 슬랙에 경보 글 · 시험 긴급도 감',
           res == '1|슬랙 다시 보내짐' and (j3.get('alertSlack') or {}).get('reason') is None and '급한 알림 슬랙이(가)' in got and 'T1238 시험 긴급' in got
           and (j3.get('channelFail') or {}).get('resolved') == 1, f'{res} · {j3.get("channelFail")} · 글 {len(got)}자')
    finally:
        for f in ('api_1238', 'fake_sl_1238'):
            subprocess.run(['docker', 'exec', C, 'sh', '-c', f'[ -f /tmp/{f}.pid ] && kill $(cat /tmp/{f}.pid) 2>/dev/null; rm -f /tmp/{f}.pid'], capture_output=True)
        subprocess.run(['docker', 'exec', C, 'sh', '-c', "for d in /proc/[0-9]*; do grep -qa -e 'SLACK_WEBHOOK_URL=http://127.0.0.1:1823[8]' -e 'fake_sl_[1]238' $d/environ $d/cmdline 2>/dev/null && kill ${d#/proc/} 2>/dev/null; done; true"], capture_output=True)
        psql("DELETE FROM ops_alerts WHERE detail->>'test' = 'v1238'")
        if not t0.startswith('!'):
            psql(f"DELETE FROM ops_alerts WHERE alert_code = 'ALERT_CHANNEL_FAIL' AND raised_at >= '{t0}'")

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
            pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
            seen = (pg.locator('[data-state-row="alert-channels"]').count(), pg.locator('[data-owner-todo]').count(),
                    pg.locator('[data-owner-row]').count(), pg.locator('[data-owner-row="plans"], [data-owner-row="legal"], [data-owner-row="ebs"]').count())
            b.close()
        ok('④ 첫 화면 — 받는 길 줄 · 대표 할 일 카드 12줄(직접 확인 3) · 화면 오류 없음', seen == (1, 1, 15 if V241 else 12, 3) and not errs, f'{seen} · {errs[:2]}')
    else:
        print('  (운영 화면 · playwright 없음 — ④ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
