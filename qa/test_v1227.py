"""v10.227 시험 — 운영 화면 접속 인증 문자 길(D196 · docs/364) — **docker 를 부르므로 서버에서 직접**

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb python3 test_v1227.py

  ① 코드 — D196(휴대폰 칸 · 확인 번호 표 · 템플릿 STAFF_IP_OTP · 목적 STAFF_OTP · admin.ip_verify_channel) · 서비스 · API 3 · 운영 화면 · postcheck 템플릿 5 · 명세 · 영어 · 문서 364
  ② 점검판 API 컨테이너 안에 가짜 서버(127.0.0.1:18227 — 알림톡 /send · 텔레그램 /bot…)와 알림톡 · 텔레그램 열쇠를 둔 두 번째 API(127.0.0.1:3997 · 같은 DB)를 띄워
     휴대폰 확인(형식 · 틀림 · 맞음 · 끝 4자리만) → 길 SMS → 켜기(휴대폰 없는 운영자 있으면 422) → 허용 밖 문자 인증 → 알림톡 실패면 텔레그램으로 넘어감 → 알림톡 꺼지면 422 → 휴대폰 지우기.
  밖으로는 아무것도 나가지 않습니다. 끝나면 두 프로세스를 끄고 설정 · 템플릿 · 휴대폰을 되돌립니다(두 API 모두 끔).
"""
import json, os, re, subprocess, time, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
C = os.environ.get('API_CONTAINER') or 'sgb-api'
RES = []
PW = 'sgb-dev-1234'
TOKEN = '987654321:AAT1227smsverifytokenabcdefghijklmnopq'
OPS_CHAT = '-1001234500227'
FAR, FAR2 = '203.0.113.71', '203.0.113.72'
PH1, PH2 = '01012270001', '01012270002'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ──────────────────────────────────────────────────────────────
mig = sorted(d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d))) if os.path.isdir(os.path.join(K, 'prisma/migrations')) else []
M = rd('prisma/migrations/D196_staff_sms/migration.sql')
ok('① D196 — 휴대폰(확인해야만 · 형식) · 확인 번호(sha256 · 5번) · 템플릿 STAFF_IP_OTP · 목적 STAFF_OTP · 길 설정 TELEGRAM 처음 · 지우는 문장 없음 · 234',
   'ADD COLUMN IF NOT EXISTS phone text' in M and "phone_verified_at IS NOT NULL))" in M and 'CREATE TABLE IF NOT EXISTS public.staff_phone_codes' in M
   and "'NOTICE_GENERAL', 'STAFF_IP_OTP'))" in M and "'TEST', 'STAFF_OTP'))" in M and "('admin.ip_verify_channel', 'TELEGRAM', 'ADMIN'" in M
   and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE)\b', M) and len(mig) >= 234 and 'D196_staff_sms' in mig, f'{len(mig)} · {mig[-1] if mig else ""}')
SV, CT, TP = rd('src/modules/identity/staff-ip.service.ts'), rd('src/modules/identity/staff-ip.controller.ts'), rd('src/common/alimtalk/alimtalk.templates.ts')
ok('① 서비스 — 길(TELEGRAM · SMS · SMS_THEN_TELEGRAM) · 문자 준비(켜기 · 방식 · 키 · 템플릿 승인) · 차례대로 보내고 실패면 다음 · 휴대폰 확인 · 지우기 · 끝 4자리만 · 템플릿 본문',
   "type Mode = 'TELEGRAM' | 'SMS' | 'SMS_THEN_TELEGRAM';" in SV and 'export async function staffSmsReady' in SV and "template: 'STAFF_IP_OTP'" in SV and "purpose: 'STAFF_OTP'" in SV
   and 'if (r.ok) { t = x; break; }' in SV and 'async phoneSend(' in SV and 'async phoneConfirm(' in SV and 'async removePhone(' in SV and "{ last4: last4(to) }" in SV
   and "STAFF_IP_OTP: {" in TP and '#{인증번호}' in TP, '')
WA, AS, PC = rd('web/src/app/admin/StaffAccess.tsx'), rd('src/modules/admin/admin.service.ts'), rd('deploy/aws/postcheck.sh')
ok('① API · 운영 화면 · 켜기 · postcheck — 휴대폰 받기 · 확인(운영 역할 · 인증 뒤) · 지우기(SUPER) · 길 바꾸기 SUPER(켜진 채면 새 길 검사) · 화면 휴대폰 칸 · 길 고르기 · 템플릿 5',
   "@Post('me/staff/phone')" in CT and "@Post('me/staff/phone/confirm')" in CT and "@Delete('admin/staff-access/:id/phone')" in CT
   and "key === 'admin.ip_verify_channel'" in AS and "assertStaffIpCanTurnOn(this.db, (value ?? '').trim())" in AS
   and 'data-my-phone=""' in WA and 'data-ip-mode={d.mode}' in WA and 'data-ip-staff-phone=' in WA and '[ "$n" = "5" ] && ok "알림톡 템플릿 5개' in PC, '')
SJ = json.loads(rd('spec/screens.json') or '{"screens":[]}'); sc = {s['id']: s for s in SJ.get('screens', [])}
EN = rd('src/common/i18n/server-text.en.ts')
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('364_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 명세 API 3 · 영어 · 문서 364 · 판 v10.227 이상',
   all(a in sc.get('SB-ADM-SIP-010', {}).get('apis', []) for a in ('POST /me/staff/phone', 'POST /me/staff/phone/confirm', 'DELETE /admin/staff-access/{id}/phone'))
   and '"휴대폰 번호(010 으로 시작하는 숫자)를 넣으십시오.":' in EN and bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 227), f'{DOC} · {rd("VERSION").strip()}')


# ── ② 끝까지 ───────────────────────────────────────────────────────────
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


call2 = lambda m, p, b=None, t=None, ip=None: inside(m, 'http://127.0.0.1:3997/api/v1' + p, b if b is not None else ({} if m in ('POST', 'PUT', 'PATCH') else None), t, ip)
fake = lambda b=None: inside('POST' if b is not None else 'GET', 'http://127.0.0.1:18227/__state', b)


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip() if not r.returncode else '!' + r.stderr.strip()[:120]


FAKE_JS = r"""
const http = require('http'); const S = { sms: 'ok', calls: [] };
http.createServer((q, r) => { let d = ''; q.on('data', (c) => d += c); q.on('end', () => {
  const out = (c, o) => { r.writeHead(c, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
  if (q.url === '/__state') { if (q.method === 'POST') Object.assign(S, JSON.parse(d || '{}')); return out(200, S); }
  let body = null; try { body = d ? JSON.parse(d) : null; } catch (e) { body = d; }
  if (q.url === '/send') {
    S.calls.push({ kind: 'sms', auth: q.headers.authorization || '', b: body });
    if (S.sms === 'fail') return out(500, { error: 'vendor down' });
    return out(200, { messageId: 'M' + S.calls.length });
  }
  const m = /^\/bot([^/]+)\/(\w+)$/.exec(q.url || '');
  S.calls.push({ kind: 'tg', method: m ? m[2] : q.url, b: body });
  if (!m || m[1] !== 'TOKEN') return out(401, { ok: false, description: 'Unauthorized' });
  return out(200, { ok: true, result: { message_id: S.calls.length } });
}); }).listen(18227, '127.0.0.1', () => console.log('fake up'));
""".replace('TOKEN', TOKEN)

up = subprocess.run(['docker', 'inspect', '-f', '{{.State.Running}}', C], capture_output=True, text=True).stdout.strip() == 'true'
ok('전제 — 점검판 API 컨테이너가 떠 있음', up, C)
if up:
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import consent_ok
    stamp = str(int(time.time()))[-7:]
    STF = f't1227sms{stamp}@x.com'
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{STF}', '시험운영1227', '{pw}', now()) ON CONFLICT DO NOTHING")
    sid = psql(f"SELECT id FROM accounts WHERE email = '{STF}'")
    aid = psql("SELECT id FROM accounts WHERE email = 'admin@x.com'")
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 T1227', true); INSERT INTO account_roles(account_id, role) VALUES ('{sid}', 'ADMIN') ON CONFLICT DO NOTHING; COMMIT;")
    for e in (STF, 'admin@x.com'): consent_ok.agree(e, PW)
    q = lambda k: psql(f"SELECT CASE WHEN value IS NULL THEN 'NULL' ELSE quote_literal(value) END FROM site_settings WHERE key = '{k}'")
    S0 = {k: q(k) for k in ('admin.ip_verify', 'admin.ip_verify_channel', 'alimtalk.provider', 'notify.alimtalk_ready', 'ops.telegram_chat')}
    T0 = psql("SELECT coalesce(quote_literal(vendor_code), 'NULL') || '|' || review_state FROM alimtalk_templates WHERE code = 'STAFF_IP_OTP'")
    NEED = [x for x in psql(f"SELECT coalesce(string_agg(a.id::text || ':' || (s.account_id IS NOT NULL)::text, ','), '') FROM accounts a LEFT JOIN staff_access s ON s.account_id = a.id WHERE a.status = 'ACTIVE' AND a.id <> '{sid}' AND coalesce(s.phone_verified_at IS NULL, true) AND EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id = a.id AND r.role IN ('REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER', 'PARTNER_MAL', 'PARTNER_AFF'))").split(',') if x]
    secrets = psql("SELECT count(*) FROM integration_secrets WHERE name IN ('ALIMTALK_KEY', 'ALIMTALK_SENDER_KEY', 'TELEGRAM_BOT_TOKEN')")
    t0 = psql('SELECT now()')
    TS = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    TA = call('POST', '/auth/login', {'email': STF, 'password': PW}).get('accessToken')
    calls = lambda kind: [c for c in (fake().get('calls') or []) if c.get('kind') == kind]
    code_sms = lambda c: (re.search(r'인증번호는 (\d{6})', (c.get('b') or {}).get('content') or '') or [None, None])[1]
    bad = lambda c: '%06d' % ((int(c or '0') + 1) % 1000000)
    try:
        ok('전제 — 운영 화면에서 넣은 알림톡 · 텔레그램 열쇠가 없음(있으면 두 번째 API 의 시험 열쇠를 덮음)', secrets == '0', secrets)
        subprocess.run(['docker', 'exec', '-i', C, 'sh', '-c', 'cat > /tmp/fake_1227.js'], input=FAKE_JS, text=True, check=True)
        subprocess.run(['docker', 'exec', '-d', C, 'sh', '-c', 'node /tmp/fake_1227.js > /tmp/fake_1227.log 2>&1 & echo $! > /tmp/fake_1227.pid'], check=True)
        env = (f'PORT=3997 TELEGRAM_API_BASE=http://127.0.0.1:18227 TELEGRAM_BOT_TOKEN={TOKEN} TELEGRAM_TIMEOUT_MS=3000 '
               'ALIMTALK_URL=http://127.0.0.1:18227/send ALIMTALK_KEY=k1227 ALIMTALK_SENDER_KEY=s1227 ALIMTALK_TIMEOUT_MS=3000')
        subprocess.run(['docker', 'exec', '-d', C, 'sh', '-c', f'cd /app && {env} node scripts/dev-server.js > /tmp/api_1227.log 2>&1 & echo $! > /tmp/api_1227.pid'], check=True)
        t1 = time.time(); h = {}
        while time.time() - t1 < 240:
            h = inside('GET', 'http://127.0.0.1:3997/api/v1/health')
            if h.get('_err') is None: break
            time.sleep(4)
        ready = h.get('_err') is None and fake().get('_err') is None
        if not ready:
            print(subprocess.run(['docker', 'exec', C, 'tail', '-15', '/tmp/api_1227.log'], capture_output=True, text=True).stdout)
        ok('준비 — 가짜 알림톡 · 텔레그램 서버 · 두 번째 API 뜸', ready, f'{int(time.time() - t1)}초')

        # 문자 준비 전 → 휴대폰 확인 422 · 준비(HTTP · 켜기 · 템플릿 승인) → 확인 번호
        p0 = call2('POST', '/me/staff/phone', {'phone': PH1}, TA)
        psql("UPDATE site_settings SET value = 'HTTP' WHERE key = 'alimtalk.provider'")
        psql("UPDATE site_settings SET value = 'on' WHERE key = 'notify.alimtalk_ready'")
        psql("UPDATE alimtalk_templates SET vendor_code = 'T1227', review_state = 'APPROVED' WHERE code = 'STAFF_IP_OTP'")
        p1 = call2('POST', '/me/staff/phone', {'phone': '02-123-4567'}, TA)
        k0 = len(calls('sms'))
        p2 = call2('POST', '/me/staff/phone', {'phone': '010-1227-0001'}, TA)
        sl = calls('sms'); m2 = sl[-1] if len(sl) > k0 else {}
        c2 = code_sms(m2)
        w2 = call2('POST', '/me/staff/phone/confirm', {'code': bad(c2)}, TA)
        v2 = call2('POST', '/me/staff/phone/confirm', {'code': c2 or '000000'}, TA)
        au = psql(f"SELECT coalesce(string_agg(after_data::text, ' '), '') FROM audit.audit_logs WHERE target_id = '{sid}' AND action LIKE 'STAFF_PHONE_%' AND occurred_at >= '{t0}'")
        snd = psql(f"SELECT purpose || ':' || template_code || ':' || to_last4 FROM alimtalk_sends WHERE created_at >= '{t0}' ORDER BY id DESC LIMIT 1")
        ok('② 휴대폰 확인 — 문자 준비 전 422 SMS_NOT_READY · 형식 422 · 알림톡(템플릿 T1227 · 받는 번호 · 키 · 6자리) · 틀림 403 · 맞음 등록(끝 0001) · 감사 · 보낸 기록은 끝 4자리만',
           p0.get('code') == 'SMS_NOT_READY' and p1.get('code') == 'PHONE_FORMAT' and p2.get('phoneLast4') == '0001' and (m2.get('b') or {}).get('recipientNo') == PH1
           and (m2.get('b') or {}).get('templateCode') == 'T1227' and m2.get('auth') == 'Bearer k1227' and bool(c2) and w2.get('code') == 'IP_VERIFY_INVALID'
           and v2.get('verified') is True and v2.get('phoneLast4') == '0001' and PH1 not in au and '0001' in au and snd == 'STAFF_OTP:STAFF_IP_OTP:0001',
           f"{p0.get('code')} · {p1.get('code')} · {p2} · {w2.get('code')} · {v2} · {snd} · {au[:80]}")

        # 길 SMS → 켜기: 휴대폰 없는 운영자(admin 등) → 422 · 휴대폰 없던 운영자 모두 휴대폰(DB) → 켜짐 · 끝에 되돌림
        g1 = call2('PATCH', '/admin/site-settings', {'key': 'admin.ip_verify_channel', 'value': 'SMS'}, TS)
        n1 = call2('PATCH', '/admin/site-settings', {'key': 'admin.ip_verify', 'value': 'on'}, TS)
        for x in NEED:
            psql(f"INSERT INTO staff_access (account_id, phone, phone_verified_at) VALUES ('{x.split(':')[0]}', '{PH2}', now()) ON CONFLICT (account_id) DO UPDATE SET phone = EXCLUDED.phone, phone_verified_at = now()")
        n2 = call2('PATCH', '/admin/site-settings', {'key': 'admin.ip_verify', 'value': 'on'}, TS)
        ok('② 길 SMS(꺼진 동안은 검사 없이) · 켜기 — 휴대폰 없는 운영자 있으면 422 IP_VERIFY_NO_RECEIVER(휴대폰 안내) · 모두 있으면 켜짐',
           g1.get('_err') is None and n1.get('code') == 'IP_VERIFY_NO_RECEIVER' and 'admin@x.com' in (n1.get('message') or '') and '휴대폰' in (n1.get('message') or '') and n2.get('_err') is None,
           f"{g1.get('_err')} · {n1.get('code')} {(n1.get('message') or '')[:60]} · {n2.get('_err')} {n2.get('code')}")

        # 허용 밖 → 문자 인증
        st = call2('GET', '/auth/ip-verify', None, TA, FAR)
        k1 = len(calls('sms'))
        s1 = call2('POST', '/auth/ip-verify/send', None, TA, FAR)
        sl = calls('sms'); m3 = sl[-1] if len(sl) > k1 else {}
        c3 = code_sms(m3)
        v3 = call2('POST', '/auth/ip-verify/confirm', {'code': c3 or '000000'}, TA, FAR)
        g3 = call2('GET', '/admin/ops-alerts', None, TA, FAR)
        ps = psql(f"SELECT channel FROM staff_ip_passes WHERE account_id = '{sid}' AND host(ip) = '{FAR}'")
        ok('② 허용 밖 — 상태 받을 곳 SMS · 길 SMS · 번호를 내 휴대폰 알림톡으로(끝 0001) · 맞으면 그 주소 통과 · 통과 기록 SMS',
           st.get('channel') == 'SMS' and st.get('mode') == 'SMS' and s1.get('channel') == 'SMS' and s1.get('phoneLast4') == '0001' and (m3.get('b') or {}).get('recipientNo') == PH1
           and v3.get('verified') is True and g3.get('_err') is None and ps == 'SMS', f"{st} · {s1} · {v3} · {g3.get('_err')} · {ps}")

        # 알림톡 실패 → 텔레그램으로(길 SMS_THEN_TELEGRAM) · 길 SMS 면 502
        psql("INSERT INTO staff_ip_allow (ip, memo) VALUES ('127.0.0.1', '시험 1227 설정') ON CONFLICT DO NOTHING")
        psql(f"UPDATE site_settings SET value = '{OPS_CHAT}' WHERE key = 'ops.telegram_chat'")
        fake({'sms': 'fail'})
        time.sleep(61)
        f1 = call2('POST', '/auth/ip-verify/send', None, TA, FAR2)
        g4 = call2('PATCH', '/admin/site-settings', {'key': 'admin.ip_verify_channel', 'value': 'SMS_THEN_TELEGRAM'}, TS, '127.0.0.1')
        kt = len(calls('tg'))
        f2 = call2('POST', '/auth/ip-verify/send', None, TA, FAR2)
        tl = calls('tg'); mt = tl[-1] if len(tl) > kt else {}
        ok('② 알림톡 실패 — 길 SMS 면 502 IP_VERIFY_SEND_FAILED · 길 SMS_THEN_TELEGRAM(켜진 채 바꾸기 검사 통과)이면 텔레그램 운영 대화방으로 넘어감',
           f1.get('code') == 'IP_VERIFY_SEND_FAILED' and g4.get('_err') is None and f2.get('channel') == 'TELEGRAM_OPS' and (mt.get('b') or {}).get('chat_id') == OPS_CHAT,
           f"{f1.get('code')} · {g4.get('_err')} {g4.get('code')} · {f2} · {(mt.get('b') or {}).get('chat_id')}")

        # 알림톡 꺼짐 → 휴대폰 확인 422 · SUPER 휴대폰 지우기
        fake({'sms': 'ok'})
        psql("UPDATE site_settings SET value = 'off' WHERE key = 'notify.alimtalk_ready'")
        p9 = call2('POST', '/me/staff/phone', {'phone': PH1}, TA, FAR)
        r9 = call2('DELETE', f'/admin/staff-access/{sid}/phone', None, TS, '127.0.0.1')
        r9b = call2('DELETE', f'/admin/staff-access/{sid}/phone', None, TS, '127.0.0.1')
        ov = call2('GET', '/admin/staff-access', None, TS, '127.0.0.1')
        row = next((x for x in ov.get('staff') or [] if x.get('email') == STF), {})
        rm = psql(f"SELECT count(*) FROM audit.audit_logs WHERE target_id = '{sid}' AND action = 'STAFF_PHONE_REMOVED' AND after_data::text LIKE '%0001%' AND occurred_at >= '{t0}'")
        ok('② 알림톡 꺼지면 휴대폰 확인 422 SMS_NOT_READY · SUPER 휴대폰 지우기(다시 지우면 404) · 한눈에 휴대폰 없음 · 길 표시 · 문자 준비 안 됨 · 감사(끝 4자리)',
           p9.get('code') == 'SMS_NOT_READY' and r9.get('removed') is True and r9b.get('code') == 'PHONE_NOT_FOUND' and row.get('phoneLast4') is None
           and ov.get('mode') == 'SMS_THEN_TELEGRAM' and (ov.get('sms') or {}).get('ready') is False and rm == '1', f"{p9.get('code')} · {r9} · {r9b.get('code')} · {row} · {ov.get('mode')} · {rm}")
    except Exception as ex:
        ok('진행 중 예외 없음', False, str(ex)[:200])
    finally:
        psql("INSERT INTO staff_ip_allow (ip, memo) VALUES ('127.0.0.1', '시험 1227 끄기') ON CONFLICT DO NOTHING")
        f8 = call2('PATCH', '/admin/site-settings', {'key': 'admin.ip_verify', 'value': 'off'}, TS, '127.0.0.1')
        f9 = call('PATCH', '/admin/site-settings', {'key': 'admin.ip_verify', 'value': 'off'}, TS, '127.0.0.1')
        call('PATCH', '/admin/site-settings', {'key': 'admin.ip_verify_channel', 'value': 'TELEGRAM'}, TS, '127.0.0.1')
        psql("DELETE FROM staff_ip_allow WHERE memo LIKE '시험 1227%'")
        for k, v in S0.items():
            psql(f"UPDATE site_settings SET value = {v} WHERE key = '{k}'")
        vc, rs = (T0.split('|') + ['NONE'])[:2]
        psql(f"UPDATE alimtalk_templates SET vendor_code = {vc}, review_state = '{rs}' WHERE code = 'STAFF_IP_OTP'")
        for x in NEED:
            i, had = x.split(':')
            if had == 'false': psql(f"DELETE FROM staff_access WHERE account_id = '{i}'")
            else: psql(f"UPDATE staff_access SET phone = NULL, phone_verified_at = NULL WHERE account_id = '{i}' AND phone = '{PH2}'")
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 T1227 정리', true); DELETE FROM account_roles WHERE account_id = '{sid}' AND role = 'ADMIN'; COMMIT;")
        for f in ('api_1227', 'fake_1227'):
            subprocess.run(['docker', 'exec', C, 'sh', '-c', f'[ -f /tmp/{f}.pid ] && kill $(cat /tmp/{f}.pid) 2>/dev/null; rm -f /tmp/{f}.pid'], capture_output=True)
        subprocess.run(['docker', 'exec', C, 'sh', '-c', "for d in /proc/[0-9]*; do grep -qa -e 'ALIMTALK_URL=http://127.0.0.1:1822[7]' -e 'fake_[1]227' $d/environ $d/cmdline 2>/dev/null && kill ${d#/proc/} 2>/dev/null; done; true"], capture_output=True)
    g9 = call('GET', '/admin/ops-alerts', None, TS, FAR2)
    ok('끝 — 두 API 모두 끔 · 허용 밖도 운영 API 그대로 · 설정 · 템플릿 · admin 휴대폰 · 시험 허용 IP 되돌림',
       f8.get('_err') is None and f9.get('_err') is None and g9.get('_err') is None and all(q(k) == v for k, v in S0.items())
       and psql("SELECT count(*) FROM staff_ip_allow WHERE memo LIKE '시험 1227%'") == '0'
       and psql(f"SELECT count(*) FROM staff_access WHERE phone = '{PH2}'") == '0', f"{f8.get('_err')} {f8.get('code')} · {f9.get('_err')} {f9.get('code')} · {g9.get('_err')}")

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
