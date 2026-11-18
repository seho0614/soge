"""v10.348 (docs/482) 운영 화면 허용 IP → Nginx 반영 스크립트
  ① (코드) API 둘 · 마지막 IP 막음 · 화면 상자 · 스크립트 · 준비 스크립트 · screens.json · 문서 482 · 판 v10.348
  ② (준비 편집기) 예시 설정 → include 3곳 · READY
  ③ (API) 스크립트 · 반영했음 · 409 · 422 · 403
  ④ (스크립트 실행 흉내) 통과 · 되돌림 · 루트 감시 스크립트(통과 · 되돌림 · 거절)
  ⑤ (화면) 상자
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB = os.environ.get('ADMIN_WEB')
SITE = os.environ.get('SITE')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


def doc(prefix):
    d = os.path.join(K, 'docs')
    return next((open(os.path.join(d, x), encoding='utf-8').read() for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith(prefix)), '')


VER = rd('VERSION').strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=180).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()




def login(e):
    return call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')

def ui(fn):
    """playwright 가 있으면 브라우저 하나로 fn(b, seen, perr) · 없으면 None"""
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return None
    seen, perr = {}, []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            fn(b, seen, perr)
            b.close()
    except Exception as ex:
        perr.append(str(ex)[:160])
    return seen, perr


def site_login(b, perr, email):
    ps = b.new_page(viewport={'width': 1280, 'height': 900}); ps.on('pageerror', lambda e: perr.append(str(e)[:120]))
    ps.goto(SITE + '/login', wait_until='networkidle', timeout=120000)
    ps.fill('input[name=email]', email); ps.fill('input[name=password]', PW); ps.click('form.auth button'); ps.wait_for_timeout(2500)
    return ps

M26 = rd('prisma/migrations/D226_faq_feedback_inquiry_templates/migration.sql')
FB, TC = rd('src/modules/help/faq-feedback.controller.ts'), rd('src/modules/support/inquiry-template.controller.ts')
FS, AM = rd('src/modules/help/faq-admin.service.ts'), rd('src/app.module.ts')
HUB, FA, DESK = rd('site/src/components/support/CsHub.tsx'), rd('web/src/app/admin/FaqAdmin.tsx'), rd('web/src/app/admin/InquiryDesk.tsx')
SJ = rd('spec/screens.json')

import shutil, tempfile
NS, SV, SC = rd('src/modules/identity/nginx-allow-script.ts'), rd('src/modules/identity/staff-ip.service.ts'), rd('src/modules/identity/staff-ip.controller.ts')
NB, SA, SJ = rd('web/src/app/admin/NginxAllowBox.tsx'), rd('web/src/app/admin/StaffAccess.tsx'), rd('spec/screens.json')
SET, ED = rd('deploy/aws/nginx-admin-allow-setup.sh'), rd('deploy/aws/nginx_admin_allow_edit.py')
APPLY, WINST = rd('deploy/aws/nginx-allow-apply.sh'), rd('deploy/aws/nginx-allow-watch-install.sh')
ok('① 코드 — 반영 스크립트 API · 반영했음(SUPER · 감사) · 마지막 IP 막음 · 화면 상자(복사 · 반영했음 · 지금 주소 경고) · 스크립트(준비 확인 · nginx -t · 되돌림) · 준비 스크립트(미리 보기 · --apply · 백업) · screens.json · 문서 482 · 판 v10.348',
   "@Get('admin/staff-access/nginx-script')" in SC and "@Post('admin/staff-access/nginx-applied')" in SC and "@Audit('STAFF_IP_NGINX_APPLIED', 'SETTING')" in SC
   and SC.count("@Roles('SUPER')") >= 4 and "'IP_LAST'" in SV and "'NGINX_LIST_CHANGED'" in SV and 'sudo nginx -t' in NS and 'sudo cp -p "$F.bak" "$F"' in NS and 'include ${NGINX_ALLOW_FILE};' in NS
   and 'data-nginx-script' in NB and 'data-nginx-copy' in NB and 'data-nginx-applied' in NB and 'data-nginx-myip' in NB and '<NginxAllowBox' in SA
   and "@Post('admin/staff-access/nginx-apply')" in SC and "'NGINX_WATCH_NOT_READY'" in SV and "'NGINX_MY_IP_MISSING'" in SV and 'data-nginx-apply' in NB and 'data-nginx-last' in NB
   and '[ -L "$REQ" ]' in APPLY and 'result false "모르는 줄이 있음' in APPLY and 'PathChanged=' in WINST and '/usr/local/sbin/sgb-nginx-allow-apply' in WINST
   and '--apply' in SET and 'bak-allow-' in SET and 'sudo nginx -t' in SET and 'RESULT READY' in ED
   and '"GET /admin/staff-access/nginx-script"' in SJ and '"POST /admin/staff-access/nginx-applied"' in SJ and 'Nginx' in doc('482_') and VT >= (10, 348), VER)

T = tempfile.mkdtemp(prefix='t1348')
try:
    conf = rd('deploy/aws/nginx-sgb.conf.example').replace('__OFFICE_IP__', '121.168.92.13').replace('__ADMIN_DOMAIN__', 'admin.sogaebank.com') \
        .replace('__DOMAIN__', 'sogaebank.com').replace('__APP__', '/home/ubuntu/sgb')
    open(os.path.join(T, 'sgb'), 'w').write(conf)
    ed = os.path.join(K, 'deploy/aws/nginx_admin_allow_edit.py')
    r1 = subprocess.run(['python3', ed, os.path.join(T, 'sgb'), 'admin.sogaebank.com', os.path.join(T, 'out'), os.path.join(T, 'allow')], capture_output=True, text=True)
    out = open(os.path.join(T, 'out')).read() if os.path.exists(os.path.join(T, 'out')) else ''
    al = open(os.path.join(T, 'allow')).read() if os.path.exists(os.path.join(T, 'allow')) else ''
    r2 = subprocess.run(['python3', ed, os.path.join(T, 'out'), 'admin.sogaebank.com', os.path.join(T, 'o2'), os.path.join(T, 'a2')], capture_output=True, text=True)
    r3 = subprocess.run(['python3', ed, os.path.join(T, 'sgb'), 'nope.example.com', os.path.join(T, 'o3'), os.path.join(T, 'a3')], capture_output=True, text=True)
    ok('② 준비 편집기 — 운영 화면 블록 3곳만 include · 사용자 웹 allow 그대로 · 허용 파일(IP · deny all) · 다시 돌리면 READY · 없는 주소는 멈춤',
       r1.stdout.strip().endswith('RESULT 3 1 121.168.92.13') and out.count('include /etc/nginx/snippets/sgb-admin-allow.conf;') == 3
       and conf.count('allow 121.168.92.13;') - out.count('allow 121.168.92.13;') == 3 and 'allow 121.168.92.13;\naccess_log /var/log/nginx/sgb-admin-access.log;\ndeny all;' in al
       and r2.stdout.strip() == 'RESULT READY' and r3.returncode == 1, f'{r1.stdout.strip()[-40:]} · {r2.stdout.strip()} · {r3.returncode}')
finally:
    shutil.rmtree(T, ignore_errors=True)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS = login('admin@x.com')
    stamp = int(time.time()) % 100000
    ADM = f't1348adm{stamp}@x.com'
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{ADM}', '시험1348', '{pw}', now()) ON CONFLICT DO NOTHING")
    adm = psql(f"SELECT id FROM accounts WHERE email = '{ADM}'")
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 1348', true); INSERT INTO account_roles (account_id, role) VALUES ('{adm}', 'ADMIN') ON CONFLICT DO NOTHING; COMMIT;")
    consent_ok.agree(ADM, PW)
    TA = login(ADM)
    IP1, IP2 = f'198.51.100.{10 + stamp % 100}', f'198.51.100.{110 + stamp % 100}'
    clean = lambda: psql("DELETE FROM staff_ip_allow WHERE memo LIKE '시험 1348%'")   # 감사 기록은 고치지 않음(v10.356 사슬) — 판마다 다른 IP 로 앞 실행의 「반영했음」과 겹치지 않게
    clean()
    try:
        a1 = call('POST', '/admin/staff-access/allow', {'ip': IP1, 'memo': '시험 1348 집 `$(rm -rf /)` ; "x"'}, TS)
        g1 = call('GET', '/admin/staff-access/nginx-script', None, TS)
        sc = g1.get('script') or ''
        ap = call('POST', '/admin/staff-access/nginx-applied', {'hash': g1.get('hash')}, TS)
        g2 = call('GET', '/admin/staff-access/nginx-script', None, TS)
        a2 = call('POST', '/admin/staff-access/allow', {'ip': IP2, 'memo': '시험 1348 사무실'}, TS)
        g3 = call('GET', '/admin/staff-access/nginx-script', None, TS)
        old = call('POST', '/admin/staff-access/nginx-applied', {'hash': g1.get('hash')}, TS)
        fa = call('GET', '/admin/staff-access/nginx-script', None, TA)
        nr = call('POST', '/admin/staff-access/nginx-apply', {'confirm': '적용', 'reason': '시험 1348'}, TS)
        nc = call('POST', '/admin/staff-access/nginx-apply', {'confirm': '아니', 'reason': '시험 1348'}, TS)
        na = call('POST', '/admin/staff-access/nginx-apply', {'confirm': '적용', 'reason': '시험 1348'}, TA)
        others = psql("SELECT count(*) FROM staff_ip_allow WHERE memo NOT LIKE '시험 1348%'")
        id2 = psql(f"SELECT id FROM staff_ip_allow WHERE ip = '{IP2}'"); id1 = psql(f"SELECT id FROM staff_ip_allow WHERE ip = '{IP1}'")
        d2 = call('DELETE', f'/admin/staff-access/allow/{id2}', None, TS)
        d1 = call('DELETE', f'/admin/staff-access/allow/{id1}', None, TS)
        last_ok = (d1.get('code') == 'IP_LAST') if others == '0' else (d1.get('_err') is None)
        aud = psql("SELECT count(*) FROM audit.audit_logs WHERE action = 'STAFF_IP_NGINX_APPLIED' AND occurred_at > now() - interval '10 minutes'")
        ok('③ API — 스크립트(시험 IP · 메모 특수 글자 뺌 · nginx -t · 되돌림) · 반영했음 → 같음 · 목록 바꾸면 다름 · 「적용」은 점검판에 감시 서비스가 없어 422 · 확인 문구 422 · ADMIN 403 · 옛 지문 409 · 마지막 IP 422(다른 IP 없을 때) · ADMIN 403 · 감사',
           a1.get('ip') == IP1 and f'allow {IP1};' in sc and '$(' not in sc.split('SGB_ALLOW_END')[1] and '`' not in sc and 'sudo nginx -t' in sc and g1.get('appliedSame') is False
           and ap.get('ok') is True and g2.get('appliedSame') is True and a2.get('ip') == IP2 and g3.get('appliedSame') is False and g3.get('hash') != g1.get('hash')
           and (g3.get('watcher') or {}).get('installed') is False and nr.get('code') == 'NGINX_WATCH_NOT_READY' and nc.get('code') == 'NGINX_CONFIRM' and na.get('_err') == 403
           and old.get('_err') == 409 and old.get('code') == 'NGINX_LIST_CHANGED' and fa.get('_err') == 403 and d2.get('_err') is None and last_ok and int(aud or 0) >= 1,
           f"{g1.get('hash')} {g1.get('appliedSame')}→{g2.get('appliedSame')}→{g3.get('appliedSame')} · {old.get('code')} · {fa.get('_err')} · 다른 IP {others} · {d1.get('code')}")
        call('POST', '/admin/staff-access/allow', {'ip': IP2, 'memo': '시험 1348 사무실'}, TS)
        sc2 = (call('GET', '/admin/staff-access/nginx-script', None, TS).get('script') or '')
        T = tempfile.mkdtemp(prefix='t1348r')
        try:
            fb = os.path.join(T, 'bin'); os.makedirs(fb)
            open(os.path.join(fb, 'sudo'), 'w').write('#!/usr/bin/env bash\nexec "$@"\n')
            open(os.path.join(fb, 'nginx'), 'w').write('#!/usr/bin/env bash\nexit ${NGX_RC:-0}\n')
            open(os.path.join(fb, 'systemctl'), 'w').write('#!/usr/bin/env bash\necho "systemctl $*"\n')
            for f in ('sudo', 'nginx', 'systemctl'):
                os.chmod(os.path.join(fb, f), 0o755)
            site, allowf = os.path.join(T, 'sgb'), os.path.join(T, 'allow.conf')
            run_sc = sc2.replace('/etc/nginx/snippets/sgb-admin-allow.conf', allowf).replace('/etc/nginx/sites-enabled/sgb', site)
            open(os.path.join(T, 'apply.sh'), 'w').write(run_sc)
            res = {}
            for rc in ('0', '1'):
                open(site, 'w').write(f'server {{ location / {{ include {allowf}; }} }}\n')
                open(allowf, 'w').write('allow 198.51.100.9;\ndeny all;\n')
                p = subprocess.run(['bash', os.path.join(T, 'apply.sh')], capture_output=True, text=True, env={**os.environ, 'PATH': fb + ':' + os.environ.get('PATH', ''), 'NGX_RC': rc})
                res[rc] = (p.stdout + p.stderr, open(allowf).read())
            ok('④ 스크립트 실행(흉내) — 바뀌는 줄 · nginx -t 통과면 새 허용 파일 · 다시 읽기 · 실패면 옛 파일로 되돌림',
               f'allow {IP1};' in res['0'][1] and f'allow {IP2};' in res['0'][1] and 'deny all;' in res['0'][1] and '== 반영함' in res['0'][0] and 'systemctl reload nginx' in res['0'][0]
               and f'> allow {IP1}' in res['0'][0] and '< allow 198.51.100.9' in res['0'][0]
               and res['1'][1] == 'allow 198.51.100.9;\ndeny all;\n' and '되돌립니다' in res['1'][0] and 'systemctl reload' not in res['1'][0],
               f"{res['0'][0][-120:]!r} · {res['1'][0][-80:]!r}")
        finally:
            shutil.rmtree(T, ignore_errors=True)
        T = tempfile.mkdtemp(prefix='t1348w')
        try:
            ap_sh = os.path.join(K, 'deploy/aws/nginx-allow-apply.sh')
            site, allowf, req, outd = os.path.join(T, 'sgb'), os.path.join(T, 'allow.conf'), os.path.join(T, 'req'), os.path.join(T, 'out')
            open(site, 'w').write(f'server {{ include {allowf}; }}\n')
            def wrun(text, ngx='true', link=False):
                open(allowf, 'w').write('allow 198.51.100.9;\ndeny all;\n')
                if os.path.lexists(req): os.remove(req)
                if link: os.symlink('/etc/passwd', req)
                else: open(req, 'w').write(text)
                env = {**os.environ, 'SGB_ALLOW_REQ': req, 'SGB_ALLOW_FILE': allowf, 'SGB_ALLOW_SITE': site, 'SGB_ALLOW_OUT': outd, 'SGB_NGINX': ngx, 'SGB_RELOAD': 'true'}
                p = subprocess.run(['bash', ap_sh], capture_output=True, text=True, env=env)
                try: res = json.loads(open(os.path.join(outd, 'result.json')).read())
                except Exception: res = {}
                return p.returncode, res, open(allowf).read()
            good = f'# sgb-admin-allow abcdef123456 id=req-t1348ok\nallow {IP1};   # 집 메모\nallow 2001:db8::1;\ndeny all;\n'
            w1 = wrun(good); w2 = wrun(good, ngx='false')
            w3 = wrun('# sgb-admin-allow abcdef123456 id=req-t1348bad\nallow 203.0.113.47;\nreturn 200;\ndeny all;\n')
            w4 = wrun('# sgb-admin-allow abcdef123456 id=req-t1348ip\nallow 999.1.1.1;\ndeny all;\n')
            w5 = wrun('', link=True)
            w6 = wrun('# sgb-admin-allow abcdef123456 id=req-t1348none\ndeny all;\n')
            old_f = 'allow 198.51.100.9;\ndeny all;\n'
            ok('④-2 루트 감시 스크립트(흉내) — 통과면 허용 파일(메모 버림) · 결과 ok · nginx -t 실패면 되돌림 · 모르는 줄 · 잘못된 IP · 링크 · 빈 목록 거절(파일 그대로)',
               w1[0] == 0 and w1[1].get('ok') is True and w1[1].get('id') == 'req-t1348ok' and f'allow {IP1};\nallow 2001:db8::1;\naccess_log /var/log/nginx/sgb-admin-access.log;\ndeny all;' in w1[2] and '메모' not in w1[2]
               and w2[0] == 1 and w2[1].get('ok') is False and w2[2] == old_f
               and all(x[0] == 1 and x[1].get('ok') is False and x[2] == old_f for x in (w3, w4, w5, w6)),
               f"{w1[0]} {w1[1].get('message')} · {w2[1].get('message')} · {w3[1].get('message')} · {w4[1].get('message')} · {w5[1].get('message')} · {w6[1].get('message')}")
        finally:
            shutil.rmtree(T, ignore_errors=True)
        if ADMIN_WEB:
            def run(b, seen, perr):
                pg = b.new_page(viewport={'width': 1440, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
                pg.goto(ADMIN_WEB + '/#/staff-access', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(3000)
                seen['box'] = pg.locator('[data-nginx-allow]').count()
                seen['state'] = pg.locator('[data-nginx-state]').get_attribute('data-nginx-state') if pg.locator('[data-nginx-state]').count() else None
                seen['script'] = 'nginx -t' in (pg.locator('[data-nginx-script]').inner_text() if pg.locator('[data-nginx-script]').count() else '')
                seen['copy'] = pg.locator('[data-nginx-copy]').count()
                seen['watch'] = pg.locator('[data-nginx-watch]').get_attribute('data-nginx-watch') if pg.locator('[data-nginx-watch]').count() else None
                pg.screenshot(path=os.path.join(HERE, 'v1348_nginx.png'), full_page=False)
            r = ui(run)
            if r is None:
                print('  (playwright 없음 — ⑤ 건너뜀)')
            else:
                seen, perr = r
                ok('⑤ 화면 — 권한 계층 › 접속 인증 › 「Nginx 반영」 상자 · 「아직 반영 안 함」 · 스크립트 · 복사 단추 · 감시 서비스 설치 전 안내 · 화면 오류 없음',
                   seen.get('box') == 1 and seen.get('state') == 'diff' and seen.get('script') and seen.get('copy') == 1 and seen.get('watch') == 'off' and not perr, f'{seen} · {perr[:2]}')
        else:
            print('  (ADMIN_WEB 없음 — ⑤ 건너뜀)')
    finally:
        clean()
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 1348 지움', true); DELETE FROM account_roles WHERE account_id = '{adm}'; COMMIT;")
else:
    print('  (API · DB 없음 — ③ ~ ⑤ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
