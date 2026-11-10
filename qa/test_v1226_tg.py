"""v10.226 시험 — 운영 화면 접속 인증을 가짜 텔레그램 서버로 끝까지(D195 · docs/363) — **docker 를 부르므로 서버에서 직접**

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb python3 test_v1226_tg.py

  점검판 API 컨테이너(sgb-api) 안에 ① 가짜 텔레그램 서버(127.0.0.1:18226)와 ② 봇 토큰 · TELEGRAM_API_BASE 를 둔 두 번째 API(127.0.0.1:3998 · 같은 DB)를 띄웁니다.
  밖(실제 텔레그램)으로는 아무것도 나가지 않습니다. 끝나면 두 프로세스를 끄고 설정을 되돌립니다(두 API 모두 끔 — 설정 30초 메모리를 바로 비움).

  · 켜기 — 받을 곳 없는 운영자가 있으면 422 IP_VERIFY_NO_RECEIVER · 운영 대화방을 정하면 켜짐
  · 허용 밖 주소 → 403 → 번호 보내기(운영 대화방 · 가린 이메일 · 가린 주소) → 1분 안 다시 429 → 틀림 403(남은 횟수) → 맞음 → 그 주소로 운영 API · 감사 · 번호 원문 저장 안 함
  · 받을 곳 바꾸기(인증 뒤) → 개인 대화로(이메일 없이) · 5번 틀리면 423 · 막힌 동안 보내기도 423
"""
import json, os, re, subprocess, time, urllib.error, urllib.request

API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
C = os.environ.get('API_CONTAINER') or 'sgb-api'
RES = []
PW = 'sgb-dev-1234'
TOKEN = '987654321:AAT1226ipverifytokenabcdefghijklmnopq'
OPS_CHAT, ME_CHAT = '-1001234500226', '5551226'
FAR, FAR2 = '203.0.113.61', '203.0.113.62'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def call(m, p, b=None, t=None, ip=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    if ip: hd['X-Forwarded-For'] = ip
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m)
    try:
        raw = urllib.request.urlopen(r, timeout=60).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b'{}')
        except Exception:
            body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message'), 'details': body.get('details')}


FETCH = ("const [m,u,b,t,ip]=process.argv.slice(1);const h={'content-type':'application/json'};if(t)h.Authorization='Bearer '+t;if(ip)h['x-forwarded-for']=ip;"
         "fetch(u,{method:m,headers:h,body:b||undefined}).then(async r=>console.log(JSON.stringify({s:r.status,b:await r.text()})))"
         ".catch(e=>console.log(JSON.stringify({s:0,b:String(e)})))")


def inside(m, url, b=None, t=None, ip=None):
    """컨테이너 안에서 부름(두 번째 API · 가짜 서버는 컨테이너 밖에 열려 있지 않음)"""
    r = subprocess.run(['docker', 'exec', C, 'node', '-e', FETCH, m, url, json.dumps(b) if b is not None else '', t or '', ip or ''], capture_output=True, text=True, timeout=120)
    try:
        o = json.loads((r.stdout.strip().splitlines() or ['{}'])[-1])
    except Exception:
        return {'_err': 0, 'message': (r.stdout + r.stderr)[:200]}
    try:
        body = json.loads(o.get('b') or '{}')
    except Exception:
        body = {'raw': (o.get('b') or '')[:200]}
    if o.get('s', 0) >= 400 or o.get('s') == 0:
        return {'_err': o.get('s'), 'code': body.get('code') if isinstance(body, dict) else None, 'message': body.get('message') if isinstance(body, dict) else body,
                'details': body.get('details') if isinstance(body, dict) else None}
    return body


call2 = lambda m, p, b=None, t=None, ip=None: inside(m, 'http://127.0.0.1:3998/api/v1' + p, b if b is not None else ({} if m in ('POST', 'PUT', 'PATCH') else None), t, ip)
fake = lambda b=None: inside('POST' if b is not None else 'GET', 'http://127.0.0.1:18226/__state', b)


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip() if not r.returncode else '!' + r.stderr.strip()[:120]


FAKE_JS = r"""
const http = require('http'); const S = { calls: [] };
http.createServer((q, r) => { let d = ''; q.on('data', (c) => d += c); q.on('end', () => {
  const out = (c, o) => { r.writeHead(c, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
  if (q.url === '/__state') { if (q.method === 'POST') Object.assign(S, JSON.parse(d || '{}')); return out(200, S); }
  let body = null; try { body = d ? JSON.parse(d) : null; } catch (e) { body = d; }
  const m = /^\/bot([^/]+)\/(\w+)$/.exec(q.url || '');
  S.calls.push({ method: m ? m[2] : q.url, tokenOk: !!m && m[1] === 'TOKEN', b: body });
  if (!m || m[1] !== 'TOKEN') return out(401, { ok: false, error_code: 401, description: 'Unauthorized' });
  if (m[2] === 'sendMessage') return out(200, { ok: true, result: { message_id: S.calls.length } });
  return out(404, { ok: false, description: 'Not Found' });
}); }).listen(18226, '127.0.0.1', () => console.log('fake up'));
""".replace('TOKEN', TOKEN)

up = subprocess.run(['docker', 'inspect', '-f', '{{.State.Running}}', C], capture_output=True, text=True).stdout.strip() == 'true'
ok('전제 — 점검판 API 컨테이너가 떠 있음', up, C)
if up:
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import consent_ok
    stamp = str(int(time.time()))[-7:]
    STF = f't1226tg{stamp}@x.com'
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{STF}', '시험운영1226', '{pw}', now()) ON CONFLICT DO NOTHING")
    sid = psql(f"SELECT id FROM accounts WHERE email = '{STF}'")
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 T1226tg', true); INSERT INTO account_roles(account_id, role) VALUES ('{sid}', 'ADMIN') ON CONFLICT DO NOTHING; COMMIT;")
    for e in (STF, 'admin@x.com'): consent_ok.agree(e, PW)
    chat0 = psql("SELECT CASE WHEN value IS NULL THEN 'NULL' ELSE quote_literal(value) END FROM site_settings WHERE key = 'ops.telegram_chat'")
    v0 = psql("SELECT value FROM site_settings WHERE key = 'admin.ip_verify'")
    tok0 = psql("SELECT count(*) FROM integration_secrets WHERE integration_code = 'MAIL' AND name = 'TELEGRAM_BOT_TOKEN'")
    t0 = psql('SELECT now()')
    TS = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    TA = call('POST', '/auth/login', {'email': STF, 'password': PW}).get('accessToken')
    sends = lambda: [c for c in (fake().get('calls') or []) if c.get('method') == 'sendMessage']
    code_of = lambda c: (re.search(r'인증번호 (\d{6})', (c.get('b') or {}).get('text') or '') or [None, None])[1]
    try:
        ok('전제 — 운영 화면에서 넣은 텔레그램 토큰이 없음(있으면 두 번째 API 의 시험 토큰을 덮음)', tok0 == '0', tok0)
        subprocess.run(['docker', 'exec', '-i', C, 'sh', '-c', 'cat > /tmp/fake_tg_1226.js'], input=FAKE_JS, text=True, check=True)
        subprocess.run(['docker', 'exec', '-d', C, 'sh', '-c', 'node /tmp/fake_tg_1226.js > /tmp/fake_tg_1226.log 2>&1 & echo $! > /tmp/fake_tg_1226.pid'], check=True)
        env = f'PORT=3998 TELEGRAM_API_BASE=http://127.0.0.1:18226 TELEGRAM_BOT_TOKEN={TOKEN} TELEGRAM_TIMEOUT_MS=3000'
        subprocess.run(['docker', 'exec', '-d', C, 'sh', '-c', f'cd /app && {env} node scripts/dev-server.js > /tmp/api_1226.log 2>&1 & echo $! > /tmp/api_1226.pid'], check=True)
        t1 = time.time(); h = {}
        while time.time() - t1 < 240:
            h = inside('GET', 'http://127.0.0.1:3998/api/v1/health')
            if h.get('_err') is None: break
            time.sleep(4)
        ready = h.get('_err') is None and fake().get('_err') is None
        if not ready:
            print(subprocess.run(['docker', 'exec', C, 'tail', '-15', '/tmp/api_1226.log'], capture_output=True, text=True).stdout)
        ok('준비 — 가짜 텔레그램 서버 · 두 번째 API(봇 토큰 · TELEGRAM_API_BASE) 뜸', ready, f'{int(time.time() - t1)}초')

        # 켜기 — 받을 곳 없는 운영자 → 422 · 운영 대화방 정하면 켜짐
        psql("UPDATE site_settings SET value = NULL WHERE key = 'ops.telegram_chat'")
        n1 = call2('PATCH', '/admin/site-settings', {'key': 'admin.ip_verify', 'value': 'on'}, TS)
        psql(f"UPDATE site_settings SET value = '{OPS_CHAT}' WHERE key = 'ops.telegram_chat'")
        n2 = call2('PATCH', '/admin/site-settings', {'key': 'admin.ip_verify', 'value': 'on'}, TS)
        al = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'SETTING_CHANGED' AND detail->>'key' = 'admin.ip_verify' AND raised_at >= '{t0}'")
        ok('② 켜기 — 받을 곳 없는 운영자가 있으면 422 IP_VERIFY_NO_RECEIVER(이메일 목록) · 운영 대화방을 정하면 켜짐 · 중요 설정 바뀜 알림',
           n1.get('code') == 'IP_VERIFY_NO_RECEIVER' and STF in (n1.get('message') or '') and n2.get('_err') is None and al == '1', f"{n1.get('code')} · {n2.get('_err')} {n2.get('code')} · {al}")

        # 허용 밖 → 403 → 번호(운영 대화방) → 다시 429 → 틀림 → 맞음
        g1 = call2('GET', '/admin/ops-alerts', None, TA, FAR)
        k0 = len(sends())
        s1 = call2('POST', '/auth/ip-verify/send', None, TA, FAR)
        sl = sends(); m1 = sl[-1] if len(sl) > k0 else {}
        txt = (m1.get('b') or {}).get('text') or ''
        s2 = call2('POST', '/auth/ip-verify/send', None, TA, FAR)
        code = code_of(m1) or '000000'
        bad = '%06d' % ((int(code) + 1) % 1000000)
        c1 = call2('POST', '/auth/ip-verify/confirm', {'code': bad}, TA, FAR)
        raw = psql(f"SELECT count(*) FROM staff_ip_codes WHERE account_id = '{sid}' AND code_hash LIKE '%{code}%'")
        ok('② 허용 밖 403 IP_VERIFY_REQUIRED → 번호 보냄(운영 대화방 · 6자리 · 가린 이메일 · 가린 주소 · 토큰 맞음) · 1분 안 다시 429 IP_VERIFY_WAIT · 틀리면 403(남은 4) · 번호 원문은 DB 에 없음',
           g1.get('code') == 'IP_VERIFY_REQUIRED' and s1.get('channel') == 'TELEGRAM_OPS' and (m1.get('b') or {}).get('chat_id') == OPS_CHAT and m1.get('tokenOk') is True
           and bool(code_of(m1)) and 't1***@x.com' in txt and '203.0.*.*' in txt and s2.get('code') == 'IP_VERIFY_WAIT'
           and c1.get('code') == 'IP_VERIFY_INVALID' and (c1.get('details') or {}).get('attemptsLeft') == 4 and raw == '0',
           f"{g1.get('code')} · {s1} · {txt[:80]} · {s2.get('code')} · {c1.get('code')} {c1.get('details')} · {raw}")
        c2 = call2('POST', '/auth/ip-verify/confirm', {'code': code}, TA, FAR)
        g2 = call2('GET', '/admin/ops-alerts', None, TA, FAR)
        g2b = call2('GET', '/admin/ops-alerts', None, TA, FAR2)
        st = call2('GET', '/auth/ip-verify', None, TA, FAR)
        au = psql(f"SELECT string_agg(action, ',' ORDER BY occurred_at) FROM audit.audit_logs WHERE target_id = '{sid}' AND action LIKE 'STAFF_IP_%' AND occurred_at >= '{t0}'")
        aud_code = psql(f"SELECT count(*) FROM audit.audit_logs WHERE target_id = '{sid}' AND after_data::text LIKE '%{code}%' AND occurred_at >= '{t0}'")
        ok('② 맞는 번호 → 그 주소는 운영 API 통과 · 다른 주소는 여전히 403 · 상태 verified · 통과 기록(오늘) · 감사 STAFF_IP_CODE_SENT · VERIFIED(번호는 안 남김)',
           c2.get('verified') is True and '24:00' in (c2.get('until') or '') and g2.get('_err') is None and g2b.get('code') == 'IP_VERIFY_REQUIRED' and st.get('verified') is True
           and psql(f"SELECT count(*) FROM staff_ip_passes WHERE account_id = '{sid}' AND host(ip) = '{FAR}' AND day = (now() AT TIME ZONE 'Asia/Seoul')::date") == '1'
           and au == 'STAFF_IP_CODE_SENT,STAFF_IP_VERIFIED' and aud_code == '0', f"{c2} · {g2.get('_err')} · {g2b.get('code')} · {au} · {aud_code}")

        # 받을 곳 바꾸기(인증 뒤) → 개인 대화 · 5번 틀리면 423
        p1 = call2('PUT', '/me/staff/telegram', {'chat': ME_CHAT}, TA, FAR)
        time.sleep(61)
        k1 = len(sends())
        s3 = call2('POST', '/auth/ip-verify/send', None, TA, FAR2)
        sl = sends(); m3 = sl[-1] if len(sl) > k1 else {}
        t3 = (m3.get('b') or {}).get('text') or ''
        code3 = code_of(m3) or '000000'
        bad3 = '%06d' % ((int(code3) + 1) % 1000000)
        cs = [call2('POST', '/auth/ip-verify/confirm', {'code': bad3}, TA, FAR2) for _ in range(5)]
        c6 = call2('POST', '/auth/ip-verify/confirm', {'code': code3}, TA, FAR2)
        time.sleep(61)
        s4 = call2('POST', '/auth/ip-verify/send', None, TA, FAR2)
        lk = psql(f"SELECT count(*) FROM audit.audit_logs WHERE target_id = '{sid}' AND action = 'STAFF_IP_LOCKED' AND occurred_at >= '{t0}'")
        ok('② 받을 곳 바꾸기(인증한 주소에서) → 개인 대화로(이메일 없음) · 5번 틀리면 423 IP_VERIFY_LOCKED · 그 뒤 맞는 번호도 423 · 막힌 동안 보내기 423 · 감사 STAFF_IP_LOCKED',
           p1.get('personalChat') is True and s3.get('channel') == 'TELEGRAM_ME' and (m3.get('b') or {}).get('chat_id') == ME_CHAT and '@' not in t3
           and [c.get('code') for c in cs] == ['IP_VERIFY_INVALID'] * 4 + ['IP_VERIFY_LOCKED'] and c6.get('code') == 'IP_VERIFY_LOCKED' and s4.get('code') == 'IP_VERIFY_LOCKED' and lk == '1',
           f"{p1} · {s3.get('channel')} · {t3[:60]} · {[c.get('code') for c in cs]} · {c6.get('code')} · {s4.get('code')} · {lk}")

        ov = call2('GET', '/admin/staff-access', None, TA, FAR)
        row = next((x for x in ov.get('staff') or [] if x.get('email') == STF), {})
        ok('② 운영 화면 한눈에 — 켜짐 · 텔레그램 준비됨 · 시험 운영자 받을 곳 개인 · 오늘 인증 1 · 최근 기록(가린 주소 · 막힘)',
           ov.get('on') is True and (ov.get('telegram') or {}).get('ready') is True and row.get('receive') == 'TELEGRAM_ME' and row.get('todayPasses') == 1
           and any(r.get('kind') == 'LOCKED' and r.get('ip') == '203.0.*.*' for r in ov.get('recent') or []), f"{ov.get('on')} · {ov.get('telegram')} · {row}")
    except Exception as ex:
        ok('진행 중 예외 없음', False, str(ex)[:200])
    finally:
        psql("INSERT INTO staff_ip_allow (ip, memo) VALUES ('127.0.0.1', '시험 1226tg 끄기') ON CONFLICT DO NOTHING")
        f1 = call2('PATCH', '/admin/site-settings', {'key': 'admin.ip_verify', 'value': 'off'}, TS, '127.0.0.1')
        f2 = call('PATCH', '/admin/site-settings', {'key': 'admin.ip_verify', 'value': 'off'}, TS, '127.0.0.1')
        psql("DELETE FROM staff_ip_allow WHERE memo LIKE '시험 1226tg%'")
        psql(f"UPDATE site_settings SET value = '{v0 or 'off'}' WHERE key = 'admin.ip_verify'")
        psql(f"UPDATE site_settings SET value = {chat0 if chat0 != 'NULL' else 'NULL'} WHERE key = 'ops.telegram_chat'")
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 T1226tg 정리', true); DELETE FROM account_roles WHERE account_id = '{sid}' AND role = 'ADMIN'; COMMIT;")
        for f in ('api_1226', 'fake_tg_1226'):
            subprocess.run(['docker', 'exec', C, 'sh', '-c', f'[ -f /tmp/{f}.pid ] && kill $(cat /tmp/{f}.pid) 2>/dev/null; rm -f /tmp/{f}.pid'], capture_output=True)
        subprocess.run(['docker', 'exec', C, 'sh', '-c', "for d in /proc/[0-9]*; do grep -qa -e 'TELEGRAM_API_BASE=http://127.0.0.1:1822[6]' -e 'fake_tg_[1]226' $d/environ $d/cmdline 2>/dev/null && kill ${d#/proc/} 2>/dev/null; done; true"], capture_output=True)
    g9 = call('GET', '/admin/ops-alerts', None, TS, FAR)
    ok('끝 — 두 API 모두 끔 · 허용 밖 주소도 운영 API 그대로 · 대화방 · 시험 허용 IP · 운영자 역할 되돌림',
       f1.get('_err') is None and f2.get('_err') is None and g9.get('_err') is None and psql("SELECT value FROM site_settings WHERE key = 'admin.ip_verify'") == (v0 or 'off')
       and psql("SELECT count(*) FROM staff_ip_allow WHERE memo LIKE '시험 1226tg%'") == '0', f"{f1.get('_err')} {f1.get('code')} · {f2.get('_err')} {f2.get('code')} · {g9.get('_err')}")

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
