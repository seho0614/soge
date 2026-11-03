"""v10.180 시험 — 운영자 2단계 인증 · 운영자 권한 정기 점검 · 파기 실행 기록(D169 · docs/281)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1180.py

  ① 코드 — D169(account_mfa · role_reviews 고칠 수 없음 · 설정 3 · 지우는 문장 없음 · 207) · TOTP(RFC 6238 예시 값) · 권한 검사 · API · 화면 3 · 비상 초기화 스크립트 · docs/281 · 판
  ② (API · DB) 2단계 인증 — 꺼짐이면 그대로 · 등록 전 켜기 422 · 등록(틀린 번호 403 · 맞으면 예비 번호 10) · 다시 등록 409 · 켜면 확인 안 된 증표 403 MFA_REQUIRED(회원 기능은 그대로)
     · 확인된 증표 200 · 같은 번호 다시 403 · 예비 번호 한 번만 · refresh 해도 이어짐 · 5번 틀리면 423 · 감사 기록에 예비 번호 없음 · SUPER 초기화(본인 422) · 끄기
  ③ (API · DB) 운영자 권한 — 운영자 목록(역할 · 2단계) · 4분기 · 점검 완료(이미 했으면 409) · 범위 밖 422 · DB 고치기 거절 · 회원 403
  ④ (API · DB) 파기 기록 — 날짜별 건수 · 실패 표시 · 하루 요약 PII_PURGE_FAILED(실행마다 한 번)
"""
import base64, hashlib, hmac, json, os, re, struct, subprocess, time, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


def totp(secret, step, digits=6):
    key = base64.b32decode(secret.upper() + '=' * (-len(secret) % 8))
    h = hmac.new(key, struct.pack('>Q', step), hashlib.sha1).digest()
    o = h[-1] & 15
    return str((struct.unpack('>I', h[o:o + 4])[0] & 0x7fffffff) % 10 ** digits).zfill(digits)


# ── ① 코드 ────────────────────────────────────────────────────────────
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(d for d in os.listdir(MD) if os.path.isdir(os.path.join(MD, d)))
M = rd('prisma/migrations/D169_admin_mfa_role_review/migration.sql')
ok('① D169 — account_mfa(암호화 비밀값 · 예비 번호 해시 · 마지막 칸) · audit.role_reviews(고칠 수 없음) · 설정 3(2단계 off) · 지우는 문장 없음 · 207 이상',
   'CREATE TABLE IF NOT EXISTS public.account_mfa' in M and 'secret_enc    bytea NOT NULL' in M and 'last_step' in M and 'backup_hashes' in M
   and 'CREATE TABLE IF NOT EXISTS audit.role_reviews' in M and 'CREATE TRIGGER trg_role_reviews_ro' in M
   and "('admin.mfa_required', 'off', 'ADMIN'," in M and "('admin.mfa_hours', '12'" in M and "('ops.role_idle_days', '90'" in M
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|DROP FUNCTION|TRUNCATE)\b', M) and len(mig) >= 207 and 'D169_admin_mfa_role_review' in mig, f'{len(mig)} · {mig[-1]}')
# RFC 6238 부록 B 예시(SHA1 · 8자리) — 시험 쪽 계산이 맞는지 먼저 확인 · 서버 코드는 같은 칸 구성
seed = base64.b32encode(b'12345678901234567890').decode().rstrip('=')
T = rd('src/common/totp.ts')
ok('① TOTP — RFC 6238 예시 값(59 → 94287082 · 1111111109 → 07081804) · HMAC-SHA1 · 30초 · 앞뒤 한 칸 · 같은 칸 다시 못 씀 · 예비 번호 sha256',
   totp(seed, 59 // 30, 8) == '94287082' and totp(seed, 1111111109 // 30, 8) == '07081804'
   and "createHmac('sha1'" in T and 'TOTP_STEP_SEC = 30' in T and '[now, now - 1, now + 1]' in T and 'if (s <= afterStep) continue;' in T and "createHash('sha256')" in T, '')
AU = rd('src/core/auth.ts'); MW = rd('src/modules/identity/auth.middleware.ts'); AS = rd('src/modules/identity/auth.service.ts')
MC = rd('src/modules/identity/mfa.controller.ts'); MS = rd('src/modules/identity/mfa.service.ts'); OC = rd('src/modules/admin/ops-review.controller.ts')
MENU = rd('web/src/lib/adminMenu.ts'); APP = rd('web/src/App.tsx'); SP = rd('spec/screens.json')
ok('① 권한 검사 — 운영 역할만 요구하는 API 에서 MFA_REQUIRED · 증표 ma · refresh 이어짐 · @Audit 이 예비 번호를 남기지 않음 · 설정은 SUPER 만 · 켜기 전 등록',
   "principal.mfaPending && required.every((r) => MFA_OPS.includes(r))" in AU and "'MFA_REQUIRED'" in AU
   and 'principal.mfaPending = await this.mfa.pending(principal, ma)' in MW and '...(mfaAt ? { ma: mfaAt } : {})' in AS
   and 'return this.issue(payload.sub, payload.ma ? Number(payload.ma) : undefined);' in AS
   and MC.split("@Post('auth/mfa/enable')")[1].split('enable(')[0].count('@Audit(') == 0 and "'MFA_ENABLE'" in MS
   and "'MFA_SETTING_SUPER'" in rd('src/modules/admin/admin.service.ts') and "'MFA_ENROLL_FIRST'" in rd('src/modules/admin/admin.service.ts'), '')
ok('① API · 화면 — 2단계 5 · 권한 점검 2(SUPER) · 파기 기록 1 · 메뉴(위험감지 · 권한 계층) · role-review SUPER 만 · 번호 넣기 화면 · 회원 상세 초기화 · screens.json 3',
   all(x in MC for x in ("@Get('auth/mfa')", "@Post('auth/mfa/setup')", "@Post('auth/mfa/enable')", "@Post('auth/mfa/verify')", "@Post('admin/accounts/:id/mfa-reset')"))
   and all(x in OC for x in ("@Get('role-review')", "@Post('role-review')", "@Get('purge-log')"))
   and "['role-review', '운영자 권한']" in MENU and "['purge-log', '파기 기록']" in MENU and "['my-mfa', '내 2단계 인증']" in MENU
   and "'pii-review', 'role-review']" in APP and '<MfaGate status={mfa} onDone={checkMfa} />' in APP and 'data-mfa-reset' in rd('web/src/app/admin/Members.tsx')
   and all(f'"{x}"' in SP for x in ('SB-ADM-MFA-010', 'SB-ADM-ROLE-010', 'SB-ADM-PRG-010')), '')
SH = rd('deploy/aws/mfa-reset.sh')
ok('① 비상 초기화 mfa-reset.sh(목록 · 이메일 · off · yes 확인 · 감사 기록) · 하루 요약 ROLE_REVIEW_DUE · PII_PURGE_FAILED · PII_PURGE_MISSED · docs/281 · 판',
   'DELETE FROM account_mfa' in SH and "'MFA_RESET_SERVER'" in SH and "'MFA_OFF_SERVER'" in SH and SH.count('[ "$a" = "yes" ]') == 2
   and all(f"'{x}'" in rd('src/worker/scheduler.service.ts') for x in ('ROLE_REVIEW_DUE', 'PII_PURGE_FAILED', 'PII_PURGE_MISSED'))
   and any(f.startswith('281_') for f in os.listdir(os.path.join(K, 'docs'))) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 180), rd('VERSION').strip())


def call(method, path, tok=None, body=None):
    hd = {'content-type': 'application/json'}
    if tok: hd['authorization'] = f'Bearer {tok}'
    r = urllib.request.Request(API + path, method=method, headers=hd, data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(r, timeout=120) as x:
            b = x.read(); s = x.status
    except urllib.error.HTTPError as e:
        b = e.read(); s = e.code
    try: return s, json.loads(b or b'{}')
    except Exception: return s, {}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip(), r.stderr.strip())


def login(e):
    return call('POST', '/auth/login', None, {'email': e, 'password': PW})


def setting(tok, v):
    return call('PATCH', '/admin/site-settings', tok, {'key': 'admin.mfa_required', 'value': v})


if API and DB:
    _, la = login('admin@x.com'); TA, RA = la.get('accessToken'), la.get('refreshToken')
    TB = login('buyer@x.com')[1].get('accessToken')
    aid = psql("SELECT id FROM accounts WHERE email = 'admin@x.com'")[0]
    bid = psql("SELECT id FROM accounts WHERE email = 'buyer@x.com'")[0]

    # ── ② 2단계 인증 ──────────────────────────────────────────────────
    psql(f"DELETE FROM account_mfa WHERE account_id IN ('{aid}', '{bid}')")
    s0, _ = setting(TA, 'off')
    best = TA
    try:
        g0 = call('GET', '/auth/mfa', TA)[1]
        se, je = setting(TA, 'ALL')
        ss_, js = call('POST', '/auth/mfa/setup', TA)
        sec = js.get('secret', 'A' * 32)
        step = int(time.time() // 30)
        sw, jw = call('POST', '/auth/mfa/enable', TA, {'code': str((int(totp(sec, step)) + 1) % 1000000).zfill(6)})
        good = totp(sec, step)
        sn, jn = call('POST', '/auth/mfa/enable', TA, {'code': good})
        T2 = jn.get('accessToken'); codes = jn.get('backupCodes') or []
        best = T2 or TA
        sr, jr = call('POST', '/auth/mfa/setup', T2 or TA)
        ok('② 등록 — 꺼짐 · 등록 전 켜기 422 MFA_ENROLL_FIRST · 비밀값 · 틀린 번호 403 · 맞으면 예비 번호 10 · 다시 등록 409',
           s0 == 200 and g0.get('required') is False and g0.get('enrolled') is False and se == 422 and je.get('code') == 'MFA_ENROLL_FIRST'
           and ss_ == 200 and len(sec) >= 32 and (js.get('uri') or '').startswith('otpauth://totp/') and sw == 403 and jw.get('code') == 'MFA_INVALID'
           and sn == 200 and len(codes) == 10 and all(re.fullmatch(r'\d{5}-\d{5}', c) for c in codes) and T2 and sr == 409 and jr.get('code') == 'MFA_ENABLED',
           f"{s0} · {g0.get('required')} · {se} {je.get('code')} · {ss_} · {sw} {jw.get('code')} · {sn} {len(codes)} · {sr} {jr.get('code')}")

        so, _ = setting(T2, 'SUPER')
        a1, j1 = call('GET', '/admin/ops-alerts', TA)          # 옛 증표(확인 전)
        m1, _ = call('GET', '/me/summary', TA)                  # 회원 기능
        g1 = call('GET', '/auth/mfa', TA)[1]
        a2, _ = call('GET', '/admin/ops-alerts', T2)            # 확인된 증표
        ok('② 켜기(SUPER) — 확인 안 된 증표는 운영 API 403 MFA_REQUIRED · 회원 기능 200 · 상태 required · 확인된 증표 200',
           so == 200 and a1 == 403 and j1.get('code') == 'MFA_REQUIRED' and m1 == 200 and g1.get('required') is True and g1.get('verified') is False and g1.get('enrolled') is True and a2 == 200,
           f'{so} · {a1} {j1.get("code")} · 회원 {m1} · {g1.get("required")} {g1.get("verified")} · {a2}')

        v1, jv1 = call('POST', '/auth/mfa/verify', TA, {'code': good})     # 등록 때 쓴 번호 다시
        v2, jv2 = call('POST', '/auth/mfa/verify', TA, {'code': codes[0] if codes else '00000-00000'})
        v3, jv3 = call('POST', '/auth/mfa/verify', TA, {'code': codes[0] if codes else '00000-00000'})
        T3 = jv2.get('accessToken'); R3 = jv2.get('refreshToken')
        a3, _ = call('GET', '/admin/ops-alerts', T3)
        rf, jrf = call('POST', '/auth/refresh', None, {'refreshToken': R3})
        a4, _ = call('GET', '/admin/ops-alerts', jrf.get('accessToken'))
        rf0, jrf0 = call('POST', '/auth/refresh', None, {'refreshToken': RA})
        a5, j5 = call('GET', '/admin/ops-alerts', jrf0.get('accessToken'))
        if T3: best = T3
        ok('② 확인 — 같은 번호 다시 403 · 예비 번호 200(남은 9) · 같은 예비 번호 403 · 확인된 증표 200 · refresh 해도 이어짐 · 확인 전 refresh 는 그대로 403',
           v1 == 403 and jv1.get('code') == 'MFA_INVALID' and v2 == 200 and jv2.get('usedBackup') is True and jv2.get('backupLeft') == 9
           and v3 == 403 and a3 == 200 and rf == 200 and a4 == 200 and rf0 == 200 and a5 == 403 and j5.get('code') == 'MFA_REQUIRED',
           f'{v1} · {v2} {jv2.get("backupLeft")} · {v3} · {a3} · refresh {rf} {a4} · 옛 refresh {rf0} {a5}')

        psql(f"UPDATE account_mfa SET fails = 0 WHERE account_id = '{aid}'")   # 앞 시험의 틀린 번호 1회를 지움
        bad = [call('POST', '/auth/mfa/verify', TA, {'code': '000000' if good != '000000' else '111111'})[0] for _ in range(5)]
        lk = call('GET', '/auth/mfa', T3)[1].get('lockedUntil')
        psql(f"UPDATE account_mfa SET locked_until = NULL, fails = 0 WHERE account_id = '{aid}'")
        au = psql(f"SELECT string_agg(action || ':' || coalesce(after_data::text, ''), ' | ') FROM audit.audit_logs WHERE action IN ('MFA_ENABLE', 'MFA_BACKUP_USED', 'MFA_LOCKED') AND target_id = '{aid}' AND occurred_at > now() - interval '10 minutes'")[0]
        sec_db = psql(f"SELECT position('{sec}' in secret_enc::text) FROM account_mfa WHERE account_id = '{aid}'")[0]
        ok('② 잠금 · 기록 — 5번째 423 MFA_LOCKED · 잠금 시각 · 감사 기록 MFA_ENABLE · MFA_BACKUP_USED · MFA_LOCKED(예비 번호 · 비밀값 없음) · DB 비밀값 암호화',
           bad[:4] == [403] * 4 and bad[4] == 423 and lk and 'MFA_ENABLE' in au and 'MFA_BACKUP_USED' in au and 'MFA_LOCKED' in au
           and not any(c in au for c in codes) and sec not in au and sec_db == '0', f'{bad} · {bool(lk)} · {au[:120]} · {sec_db}')

        psql(f"INSERT INTO account_mfa (account_id, secret_enc, enabled_at) VALUES ('{bid}', '\\x00'::bytea, now()) ON CONFLICT DO NOTHING")
        x1, jx1 = call('POST', f'/admin/accounts/{aid}/mfa-reset', T3, {'reason': '시험 — 본인 초기화 시도'})
        x2, _ = call('POST', f'/admin/accounts/{bid}/mfa-reset', T3, {'reason': '시험 v1180 — 휴대폰 분실 가정'})
        x3, jx3 = call('POST', f'/admin/accounts/{bid}/mfa-reset', T3, {'reason': '시험 v1180 — 두 번째'})
        x4, _ = call('POST', f'/admin/accounts/{bid}/mfa-reset', TB, {'reason': '회원이 초기화 시도'})
        rl = psql(f"SELECT count(*) FROM audit.audit_logs WHERE action = 'MFA_RESET' AND target_id = '{bid}' AND occurred_at > now() - interval '10 minutes'")[0]
        ok('② SUPER 초기화 — 본인 422 SELF_RESET · 다른 계정 200 · 이미 지움 404 · 회원 403 · 감사 기록 MFA_RESET',
           x1 == 422 and jx1.get('code') == 'SELF_RESET' and x2 == 200 and x3 == 404 and jx3.get('code') == 'MFA_NOT_ENROLLED' and x4 == 403 and rl not in ('', '0'),
           f'{x1} {jx1.get("code")} · {x2} · {x3} · {x4} · {rl}')
    finally:
        sf, _ = setting(best, 'off')
        if sf != 200:
            psql("UPDATE site_settings SET value = 'off' WHERE key = 'admin.mfa_required'"); time.sleep(31)
        psql(f"DELETE FROM account_mfa WHERE account_id IN ('{aid}', '{bid}')")
    a6, _ = call('GET', '/admin/ops-alerts', TA)
    ok('② 끄기 — off 로 되돌리면 확인 안 된 증표도 운영 API 200', sf == 200 and a6 == 200, f'{sf} · {a6}')

    # ── ③ 운영자 권한 ──────────────────────────────────────────────────
    s1, rv = call('GET', '/admin/role-review', TA)
    me = next((o for o in rv.get('items', []) if o.get('email') == 'admin@x.com'), {})
    qs = rv.get('quarters') or []
    curq = next((q.get('quarter') for q in qs if q.get('current')), '')
    done = any(q.get('reviewedAt') for q in qs if q.get('current'))
    s2, j2 = call('POST', '/admin/role-review', TA, {'quarter': curq, 'note': '시험 v1180 — 운영자 확인 · 오래 안 쓴 계정 확인'})
    s3, j3 = call('POST', '/admin/role-review', TA, {'quarter': curq, 'note': '두 번째 점검 시도입니다'})
    s4, j4 = call('POST', '/admin/role-review', TA, {'quarter': '2020-Q1', 'note': '범위 밖 분기 시험'})
    _, e1 = psql("UPDATE audit.role_reviews SET note = '고침'")
    sm, _ = call('GET', '/admin/role-review', TB)
    ok('③ 운영자 권한 — 목록(역할 SUPER · 2단계) · 4분기 · 점검 완료(이미 했으면 409) · 두 번 409 · 범위 밖 422 · DB 고치기 거절 · 회원 403',
       s1 == 200 and 'SUPER' in (me.get('roles') or []) and 'mfa' in me and 'idle' in me and len(qs) == 4 and re.fullmatch(r'\d{4}-Q[1-4]', curq or '')
       and (s2 in (200, 201) or (done and s2 == 409)) and s3 == 409 and j3.get('code') == 'ROLE_REVIEW_DONE'
       and s4 == 422 and j4.get('code') == 'ROLE_REVIEW_QUARTER_RANGE' and 'append-only' in e1 and sm == 403,
       f"{s1} · {me.get('roles')} · {len(qs)} {curq} · {s2} · {s3} · {s4} {j4.get('code')} · {e1[:30]} · {sm}")

    # ── ④ 파기 기록 ───────────────────────────────────────────────────
    psql("DELETE FROM job_runs WHERE job = 'pii_purge' AND slot LIKE 'test-v1180-%'")
    psql("""INSERT INTO job_runs (job, slot, started_at, ended_at, ok, affected, detail) VALUES
            ('pii_purge', 'test-v1180-ok', now() - interval '2 hours', now() - interval '2 hours', true, 7, '{"accounts": 2, "ipMasked": 3, "leads": 1, "consultRequests": 1, "authRecords": 0, "overdue": 0}'),
            ('pii_purge', 'test-v1180-bad', now() - interval '1 hour', now() - interval '1 hour', false, 0, 'relation "x" does not exist')""")
    p1, pl = call('GET', '/admin/purge-log?days=7', TA)
    okrow = next((x for x in pl.get('items', []) if x.get('ok') and (x.get('counts') or {}).get('ipMasked') == 3), {})
    badrow = next((x for x in pl.get('items', []) if x.get('ok') is False and 'does not exist' in (x.get('error') or '')), {})
    d1 = call('POST', '/admin/jobs', TA, {'job': 'launch_digest'})[1].get('detail') or {}
    d2 = call('POST', '/admin/jobs', TA, {'job': 'launch_digest'})[1].get('detail') or {}
    na = psql("SELECT count(*) FROM ops_alerts WHERE alert_code = 'PII_PURGE_FAILED' AND detail->>'error' LIKE '%does not exist%' AND raised_at > now() - interval '10 minutes'")[0]
    pm, _ = call('GET', '/admin/purge-log', TB)
    ok('④ 파기 기록 — 날짜별 건수 · 실패 표시(오류) · 마지막 실행 · 하루 요약 PII_PURGE_FAILED 한 번(두 번째는 없음) · 회원 403',
       p1 == 200 and okrow.get('counts', {}).get('accounts') == 2 and badrow and pl.get('last') and pl.get('hoursSinceLast') is not None
       and d1.get('purgeFailed') and d2.get('purgeFailed') is None and na == '1' and 'roleReviewDue' in d1 and pm == 403,
       f"{p1} · {okrow.get('counts')} · {bool(badrow)} · {pl.get('last')} · {d1.get('purgeFailed')} → {d2.get('purgeFailed')} · {na} · {pm}")
    psql("DELETE FROM job_runs WHERE job = 'pii_purge' AND slot LIKE 'test-v1180-%'")
    psql("DELETE FROM ops_alerts WHERE alert_code IN ('PII_PURGE_FAILED', 'PII_PURGE_MISSED') AND raised_at > now() - interval '10 minutes'")
else:
    print('  (API · DB 없음 — ②③④ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
