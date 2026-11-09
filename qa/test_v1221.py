"""v10.221 (D191 · docs/356) — 보안 3가지: 외부 묶음 고침(next 16 · API 잠금 파일) · 보안 정책 보고 30일 · 낯선 기기 로그인 알림

  ① (코드) next 16 · proxy.ts(전 middleware.ts) · 설정 이름 · 수화 고침 장치 지움 · API 잠금 파일 고친 판 · 검사 장치 deps-audit.js · 예외 파일 ·
     D191 · 보고 pending → launch_watch 가 DB 에 · 운영 화면 30일 줄 · 낯선 기기 알림 · 알림 명세 · 문서 356 · 판
  ② (API · DB) 보안 정책 보고 → 정기 작업 → csp_report_days(날짜 · 규칙 · 출처만 · 건수 더함 · 30일 지난 줄 지움) → 지켜보기 csp30 /
     낯선 기기: 첫 로그인 · 같은 기기는 알림 없음 · 다른 브라우저 · 다른 IP 앞 두 마디면 알림(가린 값) · 하루 3번 · 설정 off 면 없음 · 정책(수신 거부 불가)
  ③ (화면 1400 · 390) next 16 사용자 웹 — 메인 · 소개광장 · 소개몰 · 소개장터 · 로그인 → 로그인 기록 화면(proxy 가 증표를 붙임) · 보안 머리글 /
     운영 화면 「정책 보고 30일」
  자료: 시험 회원은 매번 새 이메일 · 보고 줄은 끝에 지움 · 설정은 원래대로(두 번 돌려도 같음)
"""
import json, os, re, subprocess, time, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); SITE = os.environ.get('SITE'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'
TPW = 'Sgb-test-1221!'
UA = {'chrome': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      'firefox': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:130.0) Gecko/20100101 Firefox/130.0',
      'safari': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      'edge': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0'}


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


def js(rel):
    try:
        return json.loads(rd(rel))
    except Exception:
        return {}


def ver(lock, name):
    return tuple(int(x) for x in re.findall(r'\d+', (lock.get('packages', {}).get(f'node_modules/{name}', {}).get('version') or '0'))[:3])


# ── ① 코드 ──────────────────────────────────────────────────────────────
SPK, SLK, RLK = js('site/package.json'), js('site/package-lock.json'), js('package-lock.json')
PX, NC = rd('site/src/proxy.ts'), rd('site/next.config.js')
ok('① next 16 — package.json ^16 · 잠금 파일 16.x · proxy.ts(export function proxy · 하는 일 같음) · middleware.ts 없음 · 설정 proxyClientMaxBodySize · 수화 고침 장치(webpack) 지움',
   SPK.get('dependencies', {}).get('next', '').startswith('^16.') and ver(SLK, 'next') >= (16, 4, 6)
   and 'export async function proxy(req: NextRequest)' in PX and 'export const config' in PX and "const AT = 'sgb_at';" in PX
   and not os.path.exists(os.path.join(K, 'site/src/middleware.ts')) and not os.path.exists(os.path.join(K, 'site/next-loaders'))
   and "proxyClientMaxBodySize: '60mb'" in NC and 'middlewareClientMaxBodySize:' not in NC and 'webpack(' not in NC,
   f"next {SPK.get('dependencies', {}).get('next')} · lock {ver(SLK, 'next')}")
ok('① 사용자 웹 묶음 고친 판 — sharp ≥ 0.35.5 · source-map-js ≥ 1.2.2 / API — proxy-addr ≥ 2.0.8 · multer ≥ 2.5.0 · body-parser ≥ 2.4.0 · @nestjs/platform-express ≥ 11.2.6 · package.json 은 그대로(^11.2.3)',
   ver(SLK, 'sharp') >= (0, 35, 5) and ver(SLK, 'source-map-js') >= (1, 2, 2)
   and ver(RLK, 'proxy-addr') >= (2, 0, 8) and ver(RLK, 'multer') >= (2, 5, 0) and ver(RLK, 'body-parser') >= (2, 4, 0) and ver(RLK, '@nestjs/platform-express') >= (11, 2, 6)
   and js('package.json').get('dependencies', {}).get('@nestjs/platform-express') == '^11.2.3',
   f"proxy-addr {ver(RLK, 'proxy-addr')} · multer {ver(RLK, 'multer')} · sharp {ver(SLK, 'sharp')}")
DA, AL = rd('scripts/deps-audit.js'), js('scripts/deps-audit-allow.json')
ok('① 검사 장치 — deps-audit.js(서비스 묶음만 · 잠금 파일만 · 세 곳 · 아주 심각 → 1 · 못 닿으면 2 · 예외 파일) · 예외 목록 비어 있음',
   "['audit', '--package-lock-only', '--omit=dev', '--json']" in DA and "[['API', '.'], ['사용자 웹', 'site'], ['운영 화면', 'web']]" in DA
   and 'process.exit(unreachable ? 2 : critical ? 1 : 0);' in DA and "deps-audit-allow.json" in DA and AL.get('allow') == [], str(AL.get('allow')))
M = rd('prisma/migrations/D191_security_watch/migration.sql')
mig = sorted(d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d))) if os.path.isdir(os.path.join(K, 'prisma/migrations')) else []
ok('① D191 — csp_report_days(날짜 · 규칙 · 출처 · 화면 · 건수 · IP 칸 없음) · 알림 LOGIN_NEW_DEVICE(수신 거부 불가 · 조용한 시간 무시) · 설정 account.login_alert on · 지우는 문장 없음',
   'CREATE TABLE IF NOT EXISTS public.csp_report_days' in M and 'PRIMARY KEY (day, directive, blocked)' in M and not re.search(r'\bip\b', M.split('CREATE TABLE')[1].split(');')[0], re.I)
   and "('LOGIN_NEW_DEVICE', '낯선 기기 로그인', false, true," in M and "VALUES ('account.login_alert', 'on', 'GLOBAL'," in M
   and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE)\b', M) and mig and mig[-1] == 'D191_security_watch', f'{len(mig)} · {mig[-1] if mig else ""}')
CR, LW, SC, LT = rd('src/common/csp-report.ts'), rd('src/modules/admin/launch-watch.service.ts'), rd('src/worker/scheduler.service.ts'), rd('web/src/app/admin/LaunchWatch.tsx')
ok('① 보고 30일 — 메모리 pending(날짜 · 규칙 · 출처) · launch_watch 가 flushCsp(더함 · 못 넣으면 되돌림 · 30일 지난 줄 지움) · 지켜보기 csp30(처음 · 마지막 · 7일 새 출처 · 막기 판단 준비) · 운영 화면 칸 · 상세',
   'export function takeCspPending()' in CR and 'export function restoreCspPending(' in CR and 'pending.clear();' in CR
   and 'ON CONFLICT (day, directive, blocked) DO UPDATE SET n = csp_report_days.n + EXCLUDED.n' in LW and 'restoreCspPending(list);' in LW
   and "DELETE FROM csp_report_days WHERE day <= (now() AT TIME ZONE 'Asia/Seoul')::date - 30" in LW and 'csp30: await this.csp30(),' in LW
   and 'const ready = !!since && since <= d.week && fresh === 0;' in LW
   and 'const cs = await this.launchWatch.flushCsp();' in SC and 'csp: cs,' in SC
   and "'@data-csp-30'" in LT and 'data-csp-30=""' in LT and 'data-csp-ready=' in LT, '')
LH, AS, NJ = rd('src/modules/identity/login-history.ts'), rd('src/modules/identity/auth.service.ts'), js('spec/notifications.json')
ok('① 낯선 기기 알림 — 남기기 전에 90일 견줌 · 첫 로그인 · 설정 off · 하루 3번 · 가린 값만 · 링크 로그인 기록 · 로그인 성공 길에서 recordLogin 앞 · 알림 명세(SB-MYP-SEC-010)',
   'export async function notifyNewDevice(' in LH and "interval '90 days'" in LH and ") < 3 AS go" in LH and "'account.login_alert'" in LH
   and "'/my/account/security'" in LH and 'maskIp(c?.clientIp ?? c?.ip), ua = uaKind(c?.userAgent)' in LH
   and re.search(r'await notifyNewDevice\(this\.db, acc\.id\);[^\n]*\n\s*await recordLogin\(this\.db, acc\.id, true\);', AS) is not None
   and any(e.get('code') == 'LOGIN_NEW_DEVICE' and e.get('optout') is False and e.get('screen') == 'SB-MYP-SEC-010' for e in NJ.get('events', [])), '')
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('356_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 문서 356 · 판 v10.221 이상', bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 221), f'{DOC} · {rd("VERSION").strip()}')


# ── ② API · DB ─────────────────────────────────────────────────────────
def call(m_, p, b=None, t=None, ua=None, xff=None, ctype='application/json', raw=False):
    hd = {'content-type': ctype}
    if t: hd['Authorization'] = 'Bearer ' + t
    if ua: hd['User-Agent'] = ua
    if xff: hd['X-Forwarded-For'] = xff
    data = (b if isinstance(b, bytes) else json.dumps(b).encode()) if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None)
    r = urllib.request.Request(API + p, data=data, headers=hd, method=m_)
    try:
        resp = urllib.request.urlopen(r, timeout=120)
        body = resp.read()
        return resp.status if raw else (json.loads(body) if body else {})
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b'{}')
        except Exception:
            body = {}
        return e.code if raw else {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return r.stdout.strip() if not r.returncode else ('!' + r.stderr.strip()[:200])


stamp = str(int(time.time()))[-7:]
ORIGIN = f'https://v1221-{stamp}.example'
if API and DB:
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import consent_ok
    alert0 = psql("SELECT value FROM site_settings WHERE key = 'account.login_alert'")
    try:
        consent_ok.agree('admin@x.com', PW)
        TS = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
        job = lambda: (call('POST', '/admin/jobs', {'job': 'launch_watch'}, TS).get('detail') or {}).get('csp') or {}

        # 보안 정책 보고 → 정기 작업 → DB
        rep = lambda pg_: call('POST', '/csp-report', json.dumps({'csp-report': {'effective-directive': 'script-src-elem', 'blocked-uri': f'{ORIGIN}/x.js?k=1',
                                                                                'document-uri': f'http://localhost{pg_}?q=비밀'}}).encode(), ctype='application/csp-report', raw=True)
        s1 = rep('/v1221/a')
        j1 = job()
        row1 = psql(f"SELECT day::text || '|' || directive || '|' || blocked || '|' || coalesce(page, '') || '|' || n FROM csp_report_days WHERE blocked = '{ORIGIN}'")
        s2, s3 = rep('/v1221/b'), rep('/v1221/b')
        j2 = job()
        n2 = psql(f"SELECT sum(n) FROM csp_report_days WHERE blocked = '{ORIGIN}'")
        today = psql("SELECT ((now() AT TIME ZONE 'Asia/Seoul')::date)::text")
        ok('② 보고 → 정기 작업 → csp_report_days — 204 · 오늘(한국) · 규칙 · 출처(https://host 까지 · 경로 · 물음표 뒤 없음) · 화면(물음표 뒤 없음) · 두 번째는 건수 더함 · 마지막 화면',
           s1 == 204 and s2 == 204 and (j1.get('added') or 0) >= 1 and row1 == f'{today}|script-src-elem|{ORIGIN}|/v1221/a|1'
           and n2 == '3' and psql(f"SELECT page FROM csp_report_days WHERE blocked = '{ORIGIN}'") == '/v1221/b' and (j2.get('added') or 0) >= 2,
           f'{s1} · {j1} · {row1} · {n2} · {j2}')
        psql(f"INSERT INTO csp_report_days (day, directive, blocked, page, n) VALUES ((now() AT TIME ZONE 'Asia/Seoul')::date - 31, 'img-src', '{ORIGIN}-old', '/', 4)")
        j3 = job()
        ok('② 30일 지난 줄 지움(정기 작업)', psql(f"SELECT count(*) FROM csp_report_days WHERE blocked = '{ORIGIN}-old'") == '0' and (j3.get('purged') or 0) >= 1, str(j3))
        lw = call('GET', '/admin/launch-watch', None, TS)
        c30 = lw.get('csp30') or {}
        mine = next((r for r in c30.get('top', []) if r.get('blocked') == ORIGIN), {})
        ok('② 지켜보기 csp30 — 출처 · 건수 3 · 처음 = 마지막 = 오늘 · 7일 새 출처 ≥ 1 → 막기 판단 준비 아님',
           mine.get('n') == 3 and mine.get('firstDay') == today and mine.get('lastDay') == today and mine.get('page') == '/v1221/b'
           and (c30.get('new7') or 0) >= 1 and c30.get('ready') is False and c30.get('since') and (c30.get('origins') or 0) >= 1, f'{mine} · new7 {c30.get("new7")} · ready {c30.get("ready")}')

        # 낯선 기기 로그인
        pol = psql("SELECT optout_allowed::text || '|' || quiet_hours_exempt::text || '|' || tone FROM notification_event_policies WHERE event_code = 'LOGIN_NEW_DEVICE'")
        ok('② 알림 종류 — 수신 거부 불가 · 조용한 시간 무시 · 주황(warn) · 설정 처음 on', pol == 'false|true|warn' and alert0 == 'on', f'{pol} · {alert0}')
        email = f'nd-{stamp}@t.local'
        su = call('POST', '/auth/signup', {'email': email, 'password': TPW, 'name': '기기시험'}, xff=f'10.{int(stamp) % 200 + 20}.7.7')
        aid = psql(f"SELECT id FROM accounts WHERE email = '{email}'")
        consent_ok.agree(email, TPW)
        psql(f"DELETE FROM login_history WHERE account_id = '{aid}'; DELETE FROM notifications WHERE account_id = '{aid}' AND event_code = 'LOGIN_NEW_DEVICE'")   # 동의 도우미 로그인은 세지 않음
        lg = lambda ua, ip: call('POST', '/auth/login', {'email': email, 'password': TPW}, ua=UA[ua], xff=ip).get('accessToken')
        cnt = lambda: int(psql(f"SELECT count(*) FROM notifications WHERE account_id = '{aid}' AND event_code = 'LOGIN_NEW_DEVICE'") or -1)
        t1 = lg('chrome', '10.21.1.1'); c1 = cnt()
        lg('chrome', '10.21.9.9'); c2 = cnt()
        t3 = lg('firefox', '10.21.1.1'); c3 = cnt()
        body = psql(f"SELECT title || '|' || body || '|' || link_url FROM notifications WHERE account_id = '{aid}' AND event_code = 'LOGIN_NEW_DEVICE' ORDER BY id DESC LIMIT 1")
        lg('firefox', '10.21.1.1'); c4 = cnt()
        ok('② 첫 로그인 · 같은 기기(IP 뒤 두 마디만 다름)는 알림 없음 · 다른 브라우저면 알림 1 · 다시 같은 기기면 없음',
           su.get('_err') is None and bool(t1) and bool(t3) and (c1, c2, c3, c4) == (0, 0, 1, 1), f'{su.get("_err")} · {(c1, c2, c3, c4)}')
        ok('② 알림 글 — 「새 기기에서 로그인했습니다」 · 한국 시간 · 브라우저 종류 · IP 앞 두 마디만(원래 IP 없음) · 모든 기기 로그아웃 안내 · 링크 /my/account/security',
           body.startswith('새 기기에서 로그인했습니다|') and '(한국 시간) Firefox · Mac · 10.21.*.* 에서 로그인했습니다' in body and '10.21.1.1' not in body
           and '「모든 기기 로그아웃」' in body and body.endswith('|/my/account/security'), body[:200])
        mn = call('GET', '/me/notifications', None, t3)
        items = mn if isinstance(mn, list) else (mn.get('items') or [])
        got = next((x for x in items if x.get('eventCode') == 'LOGIN_NEW_DEVICE'), {})
        ok('② 회원 알림 목록 — LOGIN_NEW_DEVICE · 주황', got.get('tone') == 'warn' and got.get('linkUrl') == '/my/account/security', str(got)[:160])
        lg('chrome', '10.77.1.1'); c5 = cnt()
        lg('safari', '10.21.1.1'); c6 = cnt()
        lg('edge', '10.21.1.1'); c7 = cnt()
        ok('② 다른 IP 앞 두 마디면 알림 · 하루 3번까지(4번째 낯선 기기는 알림 없음)', (c5, c6, c7) == (2, 3, 3), str((c5, c6, c7)))
        off = psql("SELECT set_config('app.setting_reason', '시험 v1221 — 낯선 기기 알림 끔', false); UPDATE site_settings SET value = 'off' WHERE key = 'account.login_alert'")
        e2 = f'nd2-{stamp}@t.local'
        call('POST', '/auth/signup', {'email': e2, 'password': TPW, 'name': '기기시험둘'}, xff=f'10.{int(stamp) % 200 + 20}.8.8')
        bid = psql(f"SELECT id FROM accounts WHERE email = '{e2}'")
        call('POST', '/auth/login', {'email': e2, 'password': TPW}, ua=UA['chrome'], xff='10.31.1.1')
        call('POST', '/auth/login', {'email': e2, 'password': TPW}, ua=UA['firefox'], xff='10.32.1.1')
        c8 = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{bid}' AND event_code = 'LOGIN_NEW_DEVICE'")
        hist = psql(f"SELECT count(*) FROM login_history WHERE account_id = '{bid}' AND ok")
        ok('② 설정 off — 낯선 기기여도 알림 없음 · 로그인 기록은 그대로 남음', not off.startswith('!') and c8 == '0' and hist == '2', f'{off[:80]} · {c8} · {hist}')
    finally:
        if alert0:
            psql(f"SELECT set_config('app.setting_reason', '시험 v1221 — 되돌림', false); UPDATE site_settings SET value = '{alert0}' WHERE key = 'account.login_alert'")
    ok('되돌림 — 설정 account.login_alert 원래대로', psql("SELECT value FROM site_settings WHERE key = 'account.login_alert'") == (alert0 or 'on'), str(alert0))
else:
    ok('② API · DB — API · DB 필요', False, 'API 또는 DB 없음')

# ── ③ 화면 ─────────────────────────────────────────────────────────────
try:
    from playwright.sync_api import sync_playwright
except Exception:
    sync_playwright = None
if sync_playwright and SITE and API and DB:
    seen, errs = {}, []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            for w in (1400, 390):
                pg = b.new_page(viewport={'width': w, 'height': 900})
                pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                st = {}
                for path in ('/', '/community', '/health', '/money', '/login'):
                    r = pg.goto(SITE + path, wait_until='networkidle', timeout=120000)
                    st[path] = r.status if r else 0
                    if path == '/':
                        h = r.headers if r else {}
                        seen[f'hdr{w}'] = ('content-security-policy-report-only' in h and 'x-powered-by' not in h and h.get('x-frame-options') == 'SAMEORIGIN')
                seen[f'st{w}'] = st
                pg.fill('input[name=email]', email); pg.fill('input[name=password]', TPW)
                pg.click('form.auth button'); pg.wait_for_timeout(2500)
                pg.goto(SITE + '/my/account/security', wait_until='networkidle', timeout=120000)
                seen[f'sec{w}'] = (pg.url.split('?')[0].endswith('/my/account/security'), pg.locator('[data-security-links]').count())
                pg.close()
            b.close()
    except Exception as ex:
        errs.append(str(ex)[:200])
    for w in (1400, 390):
        ok(f'③ {w}px next 16 사용자 웹 — 메인 · 소개광장 · 소개몰 · 소개장터 · 로그인 200 · 보안 머리글(보고만 하기 · SAMEORIGIN · x-powered-by 없음) · 로그인 → 로그인 기록 화면(proxy 가 증표를 붙임)',
           all(v == 200 for v in seen.get(f'st{w}', {}).values()) and len(seen.get(f'st{w}', {})) == 5 and seen.get(f'hdr{w}') is True
           and seen.get(f'sec{w}') == (True, 1), f"{seen.get(f'st{w}')} · {seen.get(f'hdr{w}')} · {seen.get(f'sec{w}')}")
    ok('③ 사용자 웹 화면 오류 없음', not errs, str(errs[:3]))
    if ADMIN_WEB:
        seen, errs = {}, []
        rep('/v1221/admin'); job()
        try:
            with sync_playwright() as p:
                b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 1000})
                pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                pg.wait_for_selector('[data-launch-watch]', timeout=30000)
                box = pg.locator('[data-csp-30]')
                seen['box'] = box.count()
                if box.count():
                    box.locator('summary').click(); pg.wait_for_timeout(500)
                    seen['ready'] = pg.locator('[data-csp-ready]').get_attribute('data-csp-ready')
                    seen['origin'] = box.locator('td', has_text=ORIGIN).count()
                    seen['sum'] = box.locator('summary').inner_text()[:120]
                b.close()
        except Exception as ex:
            errs.append(str(ex)[:160])
        ok('③ 운영 화면 「공개 직후 지켜보기」 — 정책 보고 30일 상세 · 판단 줄(아직) · 시험 출처 줄', seen.get('box') == 1 and seen.get('ready') == 'no' and (seen.get('origin') or 0) >= 1
           and '정책 보고 30일' in seen.get('sum', '') and not errs, f'{seen} · {errs[:2]}')
else:
    ok('③ 화면 — playwright · SITE 필요', False, 'playwright 또는 SITE 없음')

if DB:
    psql(f"DELETE FROM csp_report_days WHERE blocked LIKE 'https://v1221-%'")

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
