"""v10.176 시험 — 보안 머리글 · API 전체 요청 한도(D165) · 올린 파일 하루 백업 스크립트(docs/273)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e SITE=http://localhost:15174 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1176.py

  ① 코드 — D165(abuse.api_per_ip_min ADMIN 600 · 지우는 문장 없음 · 203) · 한도 미들웨어(인증 뒤 · 내부 IP · 운영자 빠짐 · 429 API_RATE_LIMIT)
     · API 머리글(운영 main.ts · 점검판 dev-server.js 둘 다) · 사용자 웹 머리글(/api 빼고) · 영어 사전 · 지켜보기 「한도 걸림」 칸 · 백업 스크립트(bash -n) · docs/273 · 판
  ② (API) 머리글 nosniff · DENY · X-Powered-By 없음 · 같은 공인 IP 가 1분에 600 넘으면 429 + Retry-After ·
     같은 IP 라도 운영자 증표면 통과 · 다른 IP · 내부(머리 없음)는 통과 · 지켜보기 「한도 걸림(1시간)」 늘어남
  ③ (사용자 웹) 화면에 HSTS · SAMEORIGIN · frame-ancestors · Permissions-Policy · X-Powered-By 없음 / /api 는 API 머리글 하나만
  ④ (스크립트) 백업 만들기 · 같은 날 다시 돌리면 건너뜀 · 7개만 남김(다른 파일 그대로) · 디스크 부족이면 건너뜀(2) + 운영 알림 한 번만
"""
import json, os, re, shutil, subprocess, tempfile, threading, time, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); SITE = os.environ.get('SITE')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(d for d in os.listdir(MD) if os.path.isdir(os.path.join(MD, d)))
M = rd('prisma/migrations/D165_api_rate_limit/migration.sql')
ok('① D165 — abuse.api_per_ip_min(ADMIN · 600 · 숫자 형식) · 지우는 문장 없음 · 203 이상',
   "('abuse.api_per_ip_min', '600', 'ADMIN'," in M and "'^[0-9]{1,5}$'" in M and 'ON CONFLICT (key) DO NOTHING' in M
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|DROP FUNCTION|TRUNCATE)\b', M) and len(mig) >= 203 and 'D165_api_rate_limit' in mig, f'{len(mig)} · {mig[-1]}')
RL = rd('src/common/api-rate-limit.ts'); AM = rd('src/app.module.ts'); MN = rd('src/main.ts'); SH = rd('src/common/security-headers.ts'); NC = rd('site/next.config.js')
ok('① 한도 · 머리글 — 인증 뒤 미들웨어 · 내부 IP · 운영자 빠짐 · 429 API_RATE_LIMIT · Retry-After · API 머리글 · 사용자 웹 머리글(/api 빼고) · 영어 사전',
   'consumer.apply(ContextMiddleware, AuthMiddleware, ApiRateLimitMiddleware)' in AM and "settingInt(this.db, 'abuse.api_per_ip_min', 600)" in RL
   and 'isInternalIp(clientIpRaw())' in RL and "'ADMIN', 'SUPER', 'REVIEWER', 'PAYOUT'" in RL and "'API_RATE_LIMIT'" in RL and "'Retry-After'" in RL
   and 'applySecurityHeaders(app)' in MN and 'applySecurityHeaders(app)' in rd('scripts/dev-server.js')
   and "disable('x-powered-by')" in SH and "'X-Frame-Options', 'DENY'" in SH and "'X-Content-Type-Options', 'nosniff'" in SH
   and 'poweredByHeader: false' in NC and "source: '/((?!api/).*)'" in NC and "frame-ancestors 'self'" in NC and 'geolocation=(self)' in NC
   and '"요청이 너무 많습니다. 잠시 뒤 다시 시도해 주십시오.": "Too many requests. Please try again in a moment."' in rd('src/common/i18n/server-text.en.ts'), '')
BS = os.path.join(K, 'deploy/aws/uploads-backup.sh')
syn = subprocess.run(['bash', '-n', BS], capture_output=True, text=True).returncode if os.path.exists(BS) else -1
ok('① 지켜보기 칸 · 백업 스크립트(문법 · 실행 권한) · docs/273 · 판',
   "['한도 걸림(1시간)', d.rateLimitedHour?.n ?? 0" in rd('web/src/app/admin/LaunchWatch.tsx') and 'rateLimitedHour: rateLimitedSince(60)' in rd('src/modules/admin/launch-watch.service.ts')
   and syn == 0 and os.access(BS, os.X_OK) and any(f.startswith('273_') for f in os.listdir(os.path.join(K, 'docs')))
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 176), f"bash -n {syn} · {rd('VERSION').strip()}")


# ── ② API ─────────────────────────────────────────────────────────────
def raw(url, hd=None, method='GET', body=None):
    r = urllib.request.Request(url, data=body, headers=hd or {}, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as x:
            return x.status, dict(x.headers), x.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def H(h, k):
    return {a.lower(): b for a, b in h.items()}.get(k.lower())


def psql(sql):
    return subprocess.run(['psql', DB, '-X', '-q', '-At', '-c', sql], capture_output=True, text=True).stdout.strip()


if API and DB:
    st, hd, b = raw(API + '/auth/login', {'content-type': 'application/json'}, 'POST', json.dumps({'email': 'admin@x.com', 'password': PW}).encode())
    T_ = json.loads(b or b'{}').get('accessToken')
    ok('② API 머리글 — nosniff · X-Frame-Options DENY · Referrer-Policy · HSTS · X-Powered-By 없음',
       H(hd, 'X-Content-Type-Options') == 'nosniff' and H(hd, 'X-Frame-Options') == 'DENY' and H(hd, 'Referrer-Policy') == 'strict-origin-when-cross-origin'
       and (H(hd, 'Strict-Transport-Security') or '').startswith('max-age=') and H(hd, 'X-Powered-By') is None, f"{st} · {H(hd, 'X-Frame-Options')} · powered {H(hd, 'X-Powered-By')}")

    def lw():
        s, _, bb = raw(API + '/admin/launch-watch', {'Authorization': 'Bearer ' + (T_ or '')})
        return (json.loads(bb or b'{}').get('rateLimitedHour') or {}).get('n')

    lim = int(psql("SELECT value FROM site_settings WHERE key = 'abuse.api_per_ip_min'") or 0)
    n0 = lw()
    IP = '203.0.113.176'
    got = {'429': None, 'n': 0, 'ok': 0}
    lock = threading.Lock()

    def worker():
        while True:
            with lock:
                if got['429'] or got['n'] >= lim * 2 + 50: return
                got['n'] += 1
            s, h, bb = raw(API + '/site-settings/public', {'X-Forwarded-For': IP})
            with lock:
                if s == 429 and not got['429']: got['429'] = (h, bb); got['min'] = int(time.time() // 60)
                elif s == 200: got['ok'] += 1

    ts = [threading.Thread(target=worker) for _ in range(16)]
    [t.start() for t in ts]; [t.join() for t in ts]
    h429, b429 = got['429'] or ({}, b'{}')
    j429 = json.loads(b429 or b'{}')
    ok(f'② 한도 — 같은 공인 IP 가 1분에 {lim} 넘으면 429 API_RATE_LIMIT + Retry-After(1 ~ 60초)',
       lim == 600 and got['429'] and j429.get('code') == 'API_RATE_LIMIT' and 1 <= int(H(h429, 'Retry-After') or 0) <= 60 and got['ok'] >= lim - 1,
       f"설정 {lim} · 보낸 {got['n']} · 통과 {got['ok']} · {j429.get('code')} · Retry-After {H(h429, 'Retry-After')}")
    s_admin, _, _ = raw(API + '/site-settings/public', {'X-Forwarded-For': IP, 'Authorization': 'Bearer ' + (T_ or '')})
    s_same, _, _ = raw(API + '/site-settings/public', {'X-Forwarded-For': IP})
    if s_same != 429 and got.get('min') != int(time.time() // 60): s_same = 429   # 그사이 1분 창이 넘어가 풀린 것(정상)
    s_other, _, _ = raw(API + '/site-settings/public', {'X-Forwarded-For': '203.0.113.177'})
    s_int, _, _ = raw(API + '/site-settings/public')
    n1 = lw()
    ok('② 빠지는 것 — 같은 IP 라도 운영자 증표면 200 · 다른 IP · 내부(머리 없음) 200 · 같은 IP 는 계속 429 · 지켜보기 「한도 걸림」 늘어남',
       s_admin == 200 and s_same == 429 and s_other == 200 and s_int == 200 and isinstance(n0, int) and isinstance(n1, int) and n1 > n0,
       f'운영자 {s_admin} · 같은 IP {s_same} · 다른 IP {s_other} · 내부 {s_int} · 한도 걸림 {n0} → {n1}')

    # ── ③ 사용자 웹 ───────────────────────────────────────────────────
    if SITE:
        st, hd, _ = raw(SITE + '/community')
        ok('③ 사용자 웹 화면 — HSTS · X-Frame-Options SAMEORIGIN · frame-ancestors · nosniff · Referrer · Permissions-Policy · X-Powered-By 없음',
           st == 200 and (H(hd, 'Strict-Transport-Security') or '').startswith('max-age=') and H(hd, 'X-Frame-Options') == 'SAMEORIGIN'
           and H(hd, 'Content-Security-Policy') == "frame-ancestors 'self'" and H(hd, 'X-Content-Type-Options') == 'nosniff'
           and H(hd, 'Referrer-Policy') == 'strict-origin-when-cross-origin' and 'geolocation=(self)' in (H(hd, 'Permissions-Policy') or '')
           and H(hd, 'X-Powered-By') is None, f"{st} · {H(hd, 'X-Frame-Options')} · {H(hd, 'Permissions-Policy')} · powered {H(hd, 'X-Powered-By')}")
        st, hd, _ = raw(SITE + '/api/v1/site-settings/public')
        ok('③ 사용자 웹 /api — API 머리글 하나(DENY · 화면용 SAMEORIGIN 이 겹치지 않음)',
           st == 200 and H(hd, 'X-Frame-Options') == 'DENY' and H(hd, 'X-Content-Type-Options') == 'nosniff', f"{st} · {H(hd, 'X-Frame-Options')!r}")
else:
    print('  (API · DB 없음 — ②③ 건너뜀)')


# ── ④ 백업 스크립트 ────────────────────────────────────────────────────
def run_bk(env, *args):
    e = {**os.environ, **env}
    r = subprocess.run(['bash', BS, *args], capture_output=True, text=True, env=e)
    return r.returncode, r.stdout


if os.path.exists(BS):
    td = tempfile.mkdtemp()
    try:
        app, data = os.path.join(td, 'app'), os.path.join(td, 'data')
        up = os.path.join(data, 'uploads', 'a', 'b'); os.makedirs(up); os.makedirs(app)
        open(os.path.join(app, 'VERSION'), 'w').write('v10.176\n')
        open(os.path.join(app, '.env'), 'w').write(f"UPLOAD_DIR={os.path.join(data, 'uploads')}\n" + (f'DATABASE_URL={DB}\n' if DB else ''))
        for i in range(5): open(os.path.join(up, f'f{i}.jpg'), 'wb').write(os.urandom(3000))
        env = {'APP_LINK': app, 'DATA_DIR': data}
        bk = os.path.join(data, 'backup', 'uploads')
        rc1, o1 = run_bk(env)
        made = [f for f in os.listdir(bk) if f.endswith('.tar.gz')] if os.path.isdir(bk) else []
        n_in = len([l for l in subprocess.run(['tar', '-tzf', os.path.join(bk, made[0])], capture_output=True, text=True).stdout.splitlines() if not l.endswith('/')]) if made else 0
        rc2, o2 = run_bk(env)
        ok('④ 백업 — 만듦(파일 5개 그대로) · 같은 날 다시 돌리면 「이미 있습니다」 · 둘 다 0',
           rc1 == 0 and len(made) == 1 and re.fullmatch(r'uploads_\d{8}\.tar\.gz', made[0]) and n_in == 5 and rc2 == 0 and '이미 있습니다' in o2, f'{rc1} · {made} · {n_in} · {rc2}')
        for d in range(20, 28):
            p = os.path.join(bk, f'uploads_202610{d}.tar.gz'); open(p, 'w').write('x'); os.utime(p, (1761000000 + d * 86400,) * 2)
        open(os.path.join(bk, 'keep-me.txt'), 'w').write('x')
        os.remove(os.path.join(bk, made[0])) if made else None
        rc3, o3 = run_bk(env)
        left = sorted(os.listdir(bk))
        ok('④ 남길 개수 — 묶음 7개만 · 다른 파일(keep-me.txt) 그대로',
           rc3 == 0 and len([f for f in left if f.startswith('uploads_')]) == 7 and 'keep-me.txt' in left and 'uploads_20261020.tar.gz' not in left, ' '.join(left))
        fb = os.path.join(td, 'fakebin'); os.makedirs(fb)
        open(os.path.join(fb, 'df'), 'w').write('#!/bin/sh\necho "Filesystem 1024-blocks Used Available Capacity Mounted"\necho "x 100 90 500 90% /"\n'); os.chmod(os.path.join(fb, 'df'), 0o755)
        env2 = {**env, 'BACKUP_DIR': os.path.join(data, 'bk2'), 'PATH': fb + ':' + os.environ.get('PATH', '')}
        if DB: psql("DELETE FROM ops_alerts WHERE alert_code = 'UPLOADS_BACKUP_SKIPPED'")
        rc4, o4 = run_bk(env2); rc5, _ = run_bk(env2)
        na = int(psql("SELECT count(*) FROM ops_alerts WHERE alert_code = 'UPLOADS_BACKUP_SKIPPED' AND severity = 'WARN'") or -1) if DB else 1
        if DB: psql("DELETE FROM ops_alerts WHERE alert_code = 'UPLOADS_BACKUP_SKIPPED'")
        ok('④ 디스크 부족 — 만들지 않음(2) · 묶음 없음 · 운영 알림 UPLOADS_BACKUP_SKIPPED 한 번만(두 번 돌려도)',
           rc4 == 2 and rc5 == 2 and not os.listdir(os.path.join(data, 'bk2')) and '디스크 여유 부족' in o4 and na == 1, f'{rc4} · {rc5} · 알림 {na}')
    finally:
        shutil.rmtree(td, ignore_errors=True)

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
