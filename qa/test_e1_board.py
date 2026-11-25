"""ERP e1.5 (docs/005) 점검판 끝까지 — 소개뱅크(v10.800 이상 · 13000) + ERP(13100 · 15175)
  ERP_API=http://localhost:13100/api/v1 SGB_API=http://localhost:13000/api/v1 ERP_WEB=http://localhost:15175 python3 qa/test_e1_board.py
  ① 건강 — sgb_erp · 마이그레이션 E001 ~ · 로그인 없이 /me 401 · 엉터리 증표 401
  ② 넘겨주기 — 소개뱅크 운영 화면 POST /admin/erp/handoff(SUPER) → ERP POST /auth/handoff → 증표 → ERP /me(SUPER · 업무 권한 목록) · 같은 코드 다시 404
  ③ 회원 증표 → ERP 403 ERP_NOT_STAFF · 정기 작업 목록(주인 SGB) · erp_heartbeat 손 실행 성공 · 감사 기록
  ④ 화면 — #/handoff?code= 로 열면 주소에서 코드가 지워지고 메뉴 · 정기 작업 화면 · 화면 오류 없음
  (서비스 토큰은 erp-board.sh up 때 ERP_SVC_TOKEN 으로 넣은 것 — 이 시험은 소개뱅크 토큰을 바꾸지 않음)
"""
import json, os, subprocess, sys, time, urllib.error, urllib.request

ERP = os.environ.get('ERP_API', 'http://localhost:13100/api/v1')
SGB = os.environ.get('SGB_API', 'http://localhost:13000/api/v1')
WEB = os.environ.get('ERP_WEB', 'http://localhost:15175')
if not all(':' + p in u for p, u in (('13100', ERP), ('13000', SGB), ('15175', WEB))):
    print('점검판 주소만(13000 · 13100 · 15175)'); raise SystemExit(2)
PW = 'sgb-dev-1234'
RES = []


def ok(name, cond, detail=''):
    RES.append(bool(cond)); print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def call(base, m, p, b=None, t=None):
    hd = {'content-type': 'application/json', **({'Authorization': 'Bearer ' + t} if t else {})}
    r = urllib.request.Request(base + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m == 'POST' else None), headers=hd, method=m)
    try:
        body = urllib.request.urlopen(r, timeout=60).read(); return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code')}


def login(email):
    return call(SGB, 'POST', '/auth/login', {'email': email, 'password': PW}).get('accessToken')


h = call(ERP, 'GET', '/health')
me0 = call(ERP, 'GET', '/me'); me1 = call(ERP, 'GET', '/me', t='x' * 40)
ok('① 건강 sgb_erp · 마이그레이션 · /me 401 두 가지', h.get('db') is True and h.get('database') == 'sgb_erp' and h.get('migrations', 0) >= 3
   and me0.get('_err') == 401 and me1.get('_err') in (401, 503), f"{h.get('version')} · {h.get('migrations')} · {me0.get('_err')} · {me1.get('_err')}")

T = login('admin@x.com')
ho = call(SGB, 'POST', '/admin/erp/handoff', {}, T)
code = ho.get('code') or ''
x = call(ERP, 'POST', '/auth/handoff', {'code': code})
ET = x.get('accessToken') or ''
me = call(ERP, 'GET', '/me', t=ET)
again = call(ERP, 'POST', '/auth/handoff', {'code': code})
ok('② 넘겨주기 → ERP 증표 → /me SUPER · 업무 권한 목록 · 같은 코드 다시 404', bool(ET) and me.get('super') is True and isinstance((me.get('perm') or {}).get('tasks'), list)
   and again.get('_err') == 404, f"{bool(ET)} · {me.get('super')} · {again.get('_err')} · {x.get('code')}")

TB = login('buyer@x.com')
mb = call(ERP, 'GET', '/me', t=TB or '')
jobs = call(ERP, 'GET', '/admin/jobs', t=ET)
run = call(ERP, 'POST', '/admin/jobs/erp_heartbeat/run', {}, ET)
_AQ = "SELECT count(*) FROM erp_audit WHERE action IN ('ERP_LOGIN', 'ERP_JOB_RUN') AND at > now() - interval '10 minutes'"
# 11/25 qa 컨테이너(playwright)에는 docker 가 없음 → ERP_DB(점검판 15432 · sgb_erp)가 있으면 psql 로 · 없으면 docker exec
aud = (subprocess.run(['psql', os.environ['ERP_DB'], '-X', '-At', '-c', _AQ], capture_output=True, text=True).stdout.strip() if os.environ.get('ERP_DB') else None) or subprocess.run(['docker', 'exec', 'sgb-db', 'psql', '-U', 'sgb', '-d', 'sgb_erp', '-Atc', "SELECT count(*) FROM erp_audit WHERE action IN ('ERP_LOGIN', 'ERP_JOB_RUN') AND at > now() - interval '10 minutes'"], capture_output=True, text=True).stdout.strip()
ok('③ 회원 403 ERP_NOT_STAFF · 작업 목록 주인 SGB · heartbeat 손 실행 성공 · 감사 2줄 이상', mb.get('_err') == 403 and mb.get('code') == 'ERP_NOT_STAFF'
   and jobs.get('owner') == 'SGB' and any(j.get('name') == 'erp_heartbeat' for j in jobs.get('jobs', [])) and run.get('ok') is True and aud.isdigit() and int(aud) >= 2,
   f"{mb.get('code')} · {jobs.get('owner')} · {run} · 감사 {aud}")

try:
    from playwright.sync_api import sync_playwright
except Exception:
    sync_playwright = None
if sync_playwright:
    code2 = call(SGB, 'POST', '/admin/erp/handoff', {}, T).get('code') or ''
    seen = {}
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1300, 'height': 900}); errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
            pg.goto(WEB + '/#/handoff?code=' + code2, wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
            seen['url'] = pg.url; seen['me'] = pg.locator('[data-erp-me]').count(); seen['menu'] = pg.locator('[data-erp-menu]').count()
            pg.locator('[data-erp-menu="jobs"]').click(); pg.wait_for_timeout(1200)
            seen['jobs'] = pg.locator('[data-erp-job]').count(); seen['errs'] = errs
            b.close()
    except Exception as e:
        seen['err'] = str(e)[:200]
    ok('④ 화면 — 코드가 주소에서 지워짐 · 로그인 · 메뉴 11 · 정기 작업 2 이상 · 화면 오류 없음',
       'code=' not in seen.get('url', 'code=') and seen.get('me') == 1 and seen.get('menu') == 11 and (seen.get('jobs') or 0) >= 2 and not seen.get('errs'), f'{seen}')
else:
    print('  (playwright 없음 — ④ 건너뜀)')
print(f'\n결과: {sum(RES)} / {len(RES)}')
raise SystemExit(0 if all(RES) else 1)
