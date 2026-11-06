"""v10.200 시험 — 급한 알림 텔레그램을 가짜 텔레그램 서버로 끝까지(D178 · docs/316) — **docker 를 부르므로 서버에서 직접**

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb python3 test_v1200_push.py

  점검판 API 컨테이너(sgb-api) 안에 ① 가짜 텔레그램 서버(127.0.0.1:18200 · sendMessage · getUpdates)와
  ② TELEGRAM_API_BASE 를 그 주소로 · TELEGRAM_BOT_TOKEN 을 시험 토큰으로 둔 두 번째 API(127.0.0.1:3999 · 같은 DB)를 띄웁니다.
  밖(실제 텔레그램)으로는 아무것도 나가지 않습니다. 끝나면 두 프로세스를 끄고 설정 · 시험 알림을 되돌립니다.

  · 대화방 찾기 — 봇에게 말을 건 대화방(겹침 없이) · 고르면 설정
  · 시험 메시지 — 같은 길로 한 통 · 토큰이 주소에 · 대화방 번호 · 감사 OPS_PUSH_TEST
  · 정기 작업 — 새 긴급 · 중요 설정 바뀜을 한 통으로 · 제목만(내용 없음) · pushed_at · 같은 종류 1시간 안 다시 안 보냄 · 12시간 넘게 확인 안 한 긴급 「[다시]」 한 번
  · 텔레그램이 토큰을 거절(401) → 보낸 것으로 안 적음 · 까닭 SEND_AUTH · 메일이 준비 안 돼도 텔레그램은 감
"""
import json, os, subprocess, time, urllib.error, urllib.request

API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
C = os.environ.get('API_CONTAINER') or 'sgb-api'
RES = []
PW = 'sgb-dev-1234'
TOKEN = '987654321:AAT1200pushtokenabcdefghijklmnopqrstuv'
CHAT = '-1001234500200'


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


call2 = lambda m, p, b=None, t=None: inside(m, 'http://127.0.0.1:3999/api/v1' + p, b if b is not None else ({} if m == 'POST' else None), t)
fake = lambda b=None: inside('POST' if b is not None else 'GET', 'http://127.0.0.1:18200/__state', b)


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip() if not r.returncode else '!' + r.stderr.strip()[:120]


FAKE_JS = r"""
const http = require('http'); const S = { mode: 'ok', calls: [] };
http.createServer((q, r) => { let d = ''; q.on('data', (c) => d += c); q.on('end', () => {
  const out = (c, o) => { r.writeHead(c, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
  if (q.url === '/__state') { if (q.method === 'POST') Object.assign(S, JSON.parse(d || '{}')); return out(200, S); }
  let body = null; try { body = d ? JSON.parse(d) : null; } catch (e) { body = d; }
  const m = /^\/bot([^/]+)\/(\w+)$/.exec(q.url || '');
  S.calls.push({ m: q.method, method: m ? m[2] : q.url, tokenOk: !!m && m[1] === 'TOKEN', b: body });
  if (!m || m[1] !== 'TOKEN' || S.mode === 'auth') return out(401, { ok: false, error_code: 401, description: 'Unauthorized' });
  if (m[2] === 'getUpdates') return out(200, { ok: true, result: [
    { update_id: 1, message: { chat: { id: -1001234500200, type: 'supergroup', title: '소개뱅크 운영' }, text: 'hi' } },
    { update_id: 2, message: { chat: { id: 5551200, type: 'private', first_name: '대표' }, text: 'hello' } },
    { update_id: 3, message: { chat: { id: -1001234500200, type: 'supergroup', title: '소개뱅크 운영' }, text: 'again' } } ] });
  if (m[2] === 'sendMessage') {
    if (S.mode === 'reject') return out(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' });
    return out(200, { ok: true, result: { message_id: S.calls.length } });
  }
  return out(404, { ok: false, description: 'Not Found' });
}); }).listen(18200, '127.0.0.1', () => console.log('fake up'));
""".replace('TOKEN', TOKEN)

up = subprocess.run(['docker', 'inspect', '-f', '{{.State.Running}}', C], capture_output=True, text=True).stdout.strip() == 'true'
ok('전제 — 점검판 API 컨테이너가 떠 있음', up, C)
if up:
    chat0 = psql("SELECT CASE WHEN value IS NULL THEN 'NULL' ELSE quote_literal(value) END FROM site_settings WHERE key = 'ops.telegram_chat'")
    tok0 = psql("SELECT count(*) FROM integration_secrets WHERE integration_code = 'MAIL' AND name = 'TELEGRAM_BOT_TOKEN'")
    t0 = psql('SELECT now()')
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW})['accessToken']
    sends = lambda: [c for c in (fake().get('calls') or []) if c.get('method') == 'sendMessage']
    job = lambda: (call2('POST', '/admin/jobs', {'job': 'launch_watch'}, T_).get('detail') or {}).get('alertPush') or {}
    pushed = lambda title: psql(f"SELECT (pushed_at IS NOT NULL)::text || ':' || (repushed_at IS NOT NULL)::text FROM ops_alerts WHERE detail->>'test' = 'v1200p' AND title = '{title}'")
    try:
        ok('전제 — 운영 화면에서 넣은 텔레그램 토큰이 없음(있으면 두 번째 API 의 시험 토큰을 덮음)', tok0 == '0', tok0)
        subprocess.run(['docker', 'exec', '-i', C, 'sh', '-c', 'cat > /tmp/fake_tg_1200.js'], input=FAKE_JS, text=True, check=True)
        subprocess.run(['docker', 'exec', '-d', C, 'sh', '-c', 'node /tmp/fake_tg_1200.js > /tmp/fake_tg_1200.log 2>&1 & echo $! > /tmp/fake_tg_1200.pid'], check=True)
        env = f'PORT=3999 TELEGRAM_API_BASE=http://127.0.0.1:18200 TELEGRAM_BOT_TOKEN={TOKEN} TELEGRAM_TIMEOUT_MS=3000'
        subprocess.run(['docker', 'exec', '-d', C, 'sh', '-c', f'cd /app && {env} node scripts/dev-server.js > /tmp/api_1200.log 2>&1 & echo $! > /tmp/api_1200.pid'], check=True)
        t1 = time.time(); h = {}
        while time.time() - t1 < 240:
            h = inside('GET', 'http://127.0.0.1:3999/api/v1/health')
            if h.get('_err') is None: break
            time.sleep(4)
        ready = h.get('_err') is None and fake().get('_err') is None
        if not ready:
            print(subprocess.run(['docker', 'exec', C, 'tail', '-15', '/tmp/api_1200.log'], capture_output=True, text=True).stdout)
        ok('준비 — 가짜 텔레그램 서버 · 두 번째 API(TELEGRAM_API_BASE · 시험 토큰) 뜸', ready, f'{int(time.time() - t1)}초')

        # 대화방 찾기 → 고르기
        psql("UPDATE site_settings SET value = NULL WHERE key = 'ops.telegram_chat'")
        st0 = (call2('GET', '/admin/ops-alerts/mail-status', None, T_) or {}).get('push') or {}
        fc = call2('POST', '/admin/ops-alerts/push-find-chat', None, T_)
        ids = [c.get('id') for c in fc.get('chats') or []]
        gu = [c for c in (fake().get('calls') or []) if c.get('method') == 'getUpdates']
        ok('대화방 찾기 — 토큰만 있으면 됨(대화방 없음 = NO_CHAT) · 봇에게 말을 건 대화방 2곳(같은 곳은 한 번) · 이름 · 종류 · 주소에 토큰',
           st0.get('reason') == 'NO_CHAT' and fc.get('ok') is True and sorted(ids) == sorted([CHAT, '5551200'])
           and any(c.get('title') == '소개뱅크 운영' and c.get('type') == 'supergroup' for c in fc.get('chats') or []) and gu and all(c.get('tokenOk') for c in gu),
           f'{st0.get("reason")} · {fc.get("note")} · {ids}')
        sv = call('PATCH', '/admin/site-settings', {'key': 'ops.telegram_chat', 'value': CHAT}, T_)

        # 시험 메시지
        n0 = len(sends())
        pt = call2('POST', '/admin/ops-alerts/push-test', None, T_)
        s = sends()[n0:]
        st1 = (call2('GET', '/admin/ops-alerts/mail-status', None, T_) or {}).get('push') or {}
        ok('시험 메시지 — 고른 대화방으로 한 통 · 토큰 맞음 · 「시험 메시지」 · 줄에 준비됨 · 마지막 시험 보냄',
           not sv.get('_err') and pt.get('ok') is True and len(s) == 1 and (s[0].get('b') or {}).get('chat_id') == CHAT and s[0].get('tokenOk')
           and '시험 메시지' in (s[0].get('b') or {}).get('text', '') and st1.get('ready') is True and (st1.get('lastTest') or {}).get('ok') is True,
           f'{pt.get("note")} · {len(s)} · {st1}')

        # 정기 작업 — 다른 알림은 「2시간 전에 보냄」으로 두고(이 시험만 고르게) 시험 알림 2건
        psql("UPDATE ops_alerts SET pushed_at = now() - interval '2 hours' WHERE pushed_at IS NULL")
        psql("UPDATE ops_alerts SET repushed_at = now() - interval '1 hour' WHERE repushed_at IS NULL AND severity = 'CRITICAL'")
        psql("INSERT INTO ops_alerts (alert_code, severity, title, detail) VALUES "
             "('TEST_V1200P_A', 'CRITICAL', '시험 T1200 긴급', '{\"test\":\"v1200p\", \"secret\":\"내용-보내지-않음\"}'), "
             "('SETTING_CHANGED', 'WARN', '시험 T1200 중요 설정', '{\"test\":\"v1200p\"}')")
        n1 = len(sends())
        j1 = job()
        s = sends()[n1:]
        tx = (s[0].get('b') or {}).get('text', '') if s else ''
        ok('정기 작업 — 새 긴급 · 중요 설정 바뀜을 한 통으로 · 대화방 · 제목 · 등급만(내용 detail 은 안 감) · 보낸 시각 · 작업 기록 alertPush',
           len(s) == 1 and (s[0].get('b') or {}).get('chat_id') == CHAT and '시험 T1200 긴급' in tx and '시험 T1200 중요 설정' in tx and '[CRITICAL]' in tx
           and '내용-보내지-않음' not in tx and pushed('시험 T1200 긴급') == 'true:false' and pushed('시험 T1200 중요 설정') == 'true:false' and j1.get('pushed', 0) >= 2 and j1.get('reason') is None,
           f'{len(s)} · {tx[:80]} · {j1}')

        # 같은 종류 1시간 안 → 안 보냄
        psql("INSERT INTO ops_alerts (alert_code, severity, title, detail) VALUES ('TEST_V1200P_A', 'CRITICAL', '시험 T1200 긴급2', '{\"test\":\"v1200p\"}')")
        n2 = len(sends())
        j2 = job()
        s = sends()[n2:]
        ok('같은 종류는 1시간에 한 통 — 두 번째 긴급은 아직 안 보냄', not any('시험 T1200 긴급2' in (x.get('b') or {}).get('text', '') for x in s) and pushed('시험 T1200 긴급2') == 'false:false',
           f'{len(s)} · {j2}')

        # 12시간 넘게 확인 안 함 → 「[다시]」 한 번(같은 종류 두 번째도 이제 1시간 지남 → 함께)
        psql("UPDATE ops_alerts SET pushed_at = now() - interval '13 hours' WHERE detail->>'test' = 'v1200p' AND title = '시험 T1200 긴급'")
        n3 = len(sends())
        j3 = job()
        s = sends()[n3:]
        tx = (s[0].get('b') or {}).get('text', '') if s else ''
        j3b = job()
        s3b = sends()[n3 + len(s):]
        ok('다시 보내기 — 12시간 넘게 확인 안 한 긴급은 「[다시]」 한 번(같은 통에 묶임) · 다음 작업에는 안 감',
           len(s) == 1 and '[다시] [CRITICAL]' in tx and '시험 T1200 긴급' in tx and '시험 T1200 긴급2' in tx and pushed('시험 T1200 긴급') == 'true:true'
           and not any('시험 T1200' in (x.get('b') or {}).get('text', '') for x in s3b),
           f'{len(s)} · {tx[:120]} · {j3} · {j3b}')

        # 텔레그램이 거절 → 보낸 것으로 안 적음
        fake({'mode': 'auth'})
        psql("INSERT INTO ops_alerts (alert_code, severity, title, detail) VALUES ('TEST_V1200P_D', 'CRITICAL', '시험 T1200 거절', '{\"test\":\"v1200p\"}')")
        j4 = job()
        ms = call2('GET', '/admin/ops-alerts/mail-status', None, T_) or {}
        # 줄의 「마지막 정기 작업」은 job_runs(정해진 시각 작업)만 읽음 — 손으로 부른 작업은 기록되지 않으므로 모양만 봄
        lj = (ms.get('push') or {}).get('lastJob')
        ok('토큰 거절(401) — 보낸 것으로 안 적음(다음 작업에 다시) · 까닭 SEND_AUTH · 줄의 마지막 정기 작업 모양 · 메일 준비 안 됨과 따로',
           j4.get('reason') == 'SEND_AUTH' and j4.get('pushed') == 0 and pushed('시험 T1200 거절') == 'false:false'
           and (lj is None or {'at', 'pending', 'pushed', 'reason'} <= set(lj)) and ms.get('ready') is False,
           f'{j4} · {(ms.get("push") or {}).get("lastJob")} · mail {ms.get("reason")}')
        fake({'mode': 'ok'})
        j5 = job()
        ok('다시 열리면 — 거절됐던 알림을 보냄', j5.get('pushed', 0) >= 1 and pushed('시험 T1200 거절') == 'true:false', str(j5))
        au = psql(f"SELECT count(*) FROM audit.audit_logs WHERE action = 'OPS_PUSH_TEST' AND occurred_at >= '{t0}'")
        ok('감사 기록 — 시험 메시지 OPS_PUSH_TEST 1건', au == '1', au)
    finally:
        for f in ('api_1200', 'fake_tg_1200'):
            subprocess.run(['docker', 'exec', C, 'sh', '-c', f'[ -f /tmp/{f}.pid ] && kill $(cat /tmp/{f}.pid) 2>/dev/null; rm -f /tmp/{f}.pid'], capture_output=True)
        # 두 번째 API(3999) · 가짜 서버(18200)가 남지 않게 — 환경에 시험 주소가 든 node 를 끔
        subprocess.run(['docker', 'exec', C, 'sh', '-c', "for d in /proc/[0-9]*; do grep -qa -e 'TELEGRAM_API_BASE=http://127.0.0.1:1820[0]' -e 'fake_tg_[1]200' $d/environ $d/cmdline 2>/dev/null && kill ${d#/proc/} 2>/dev/null; done; true"], capture_output=True)
        psql("DELETE FROM ops_alerts WHERE detail->>'test' = 'v1200p'")
        psql(f"UPDATE site_settings SET value = {chat0 or 'NULL'} WHERE key = 'ops.telegram_chat'")

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
