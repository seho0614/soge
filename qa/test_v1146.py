"""v10.146 시험 — 오픈 준비 점검 2판(D142 · docs/225)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1146.py

  ① 코드 — D142(보기 두 개 · 꼭 4 · 권장 4 · READY · 옛 다섯 가지 그대로 · 지우는 문장 없음 · 180) · API(SUPER) · DTO · 화면 목록 · 운영 화면 · 판
  ② (API · DB) 8줄(꼭 4) · 손님 403 · 꼭 줄 = READY 수 · 본인인증 NICE 면 풀림 · MOCK 이면 막힘 · 메일 켜면 풀림 ·
     소개비 먼저 켜면 막힘 · 다른 차단(설정 · 약관 · 연동 · 간주) 수 그대로 — 끝나면 되돌림
  ③ (운영 화면) 오픈 체크리스트 › 「오픈 준비 점검」 8줄
"""
import json, os, re, subprocess, urllib.error, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
D = rd('prisma/migrations/D142_open_ready/migration.sql')
mig = sorted(x for x in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', x)))
ok('① D142 — 보기 v_open_readiness · v_open_blockers 다시 만듦 · 꼭 4 · 권장 4 · READY · 지우는 문장 없음 · 180 이상',
   'CREATE OR REPLACE VIEW public.v_open_readiness' in D and 'CREATE OR REPLACE VIEW public.v_open_blockers' in D
   and all(f"('{c}', " in D for c in ('IDENTITY', 'MAIL', 'NO_MOCK', 'REFERRAL_FEE', 'ALIMTALK', 'ESIGN', 'SAFENUM', 'AI'))
   and "'READY'::text AS kind" in D and 'WHERE r.required AND NOT r.ok' in D
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|TRUNCATE|DROP COLUMN|UPDATE )\b', D)
   and len(mig) >= 180 and 'D142_open_ready' in mig, f'{len(mig)} · {mig[-1]}')
ok('① 옛 다섯 가지(설정 · 약관 · 푸터 · 연동 · 간주) 문장 그대로',
   all(f"'{k}'::text AS kind" in D for k in ('SETTING', 'TERM', 'FOOTER', 'INTEGRATION', 'ASSUME')) and "s.key LIKE 'assume.%'" in D, '')
TC = rd('src/modules/catalog/terms.controller.ts'); TS = rd('src/modules/catalog/terms.service.ts'); TD = rd('src/modules/catalog/terms.dto.ts')
ok('① API — GET /admin/open-readiness(SUPER 컨트롤러) · DTO · 보기에서 읽기만',
   "@Get('open-readiness')" in TC and "@Roles('SUPER')" in TC and 'class OpenReadinessDto' in TD and 'FROM v_open_readiness' in TS, '')
scr = {s['id']: s for s in json.loads(rd('spec/screens.json') or '{}').get('screens', [])}
ok('① 화면 목록 — 오픈 체크리스트에 API 연결', 'GET /admin/open-readiness' in scr.get('SB-ADM-SIT-040', {}).get('apis', []), '')
OC = rd('web/src/app/admin/OpenChecklist.tsx')
ok('① 운영 화면 — 「오픈 준비 점검」 표 · 꼭 / 권장 · 고칠 곳 · READY 이름',
   "'/admin/open-readiness'" in OC and 'data-open-ready' in OC and 'data-ready=' in OC and "READY: '오픈 준비'" in OC and '고칠 곳' in OC, '')
ok('① 판 v10.146 이상', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 146), rd('VERSION').strip())


# ── ② API · DB ───────────────────────────────────────────────────────
def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m)
    try:
        return json.load(urllib.request.urlopen(r, timeout=60))
    except urllib.error.HTTPError as e:
        return {'_err': e.code}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip()


SETS = ['identity.provider', 'alimtalk.provider', 'notify.email_verified', 'feature.referral_fee']
if API and DB:
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW})['accessToken']
    BT = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW})['accessToken']
    before = {k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'") for k in SETS}
    others0 = psql("SELECT string_agg(kind || ':' || c, ' ' ORDER BY kind) FROM (SELECT kind, count(*) c FROM v_open_blockers WHERE kind <> 'READY' GROUP BY kind) x")

    def setv(k, v):
        psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}'")

    def rows():
        r = call('GET', '/admin/open-readiness', t=T_)
        return {x['code']: x for x in r} if isinstance(r, list) else {}

    def ready_items():
        r = call('GET', '/admin/open-blockers', t=T_)
        return [x['item'] for x in r if x.get('kind') == 'READY'] if isinstance(r, list) else None

    try:
        setv('identity.provider', 'STUB'); setv('alimtalk.provider', 'NONE'); setv('notify.email_verified', 'off'); setv('feature.referral_fee', 'off')
        R = rows(); ri = ready_items()
        ok('② 8줄(v10.150 부터 9 — 오픈일 · v10.162 부터 11 — 약관 2) · 꼭 4 · 권장 4 · 지금 값 · 할 일 · 고칠 곳', len(R) in (8, 9, 11) and sum(1 for x in R.values() if x['required']) == 4
           and all(x.get('nowValue') and x.get('todo') for x in R.values()) and R.get('IDENTITY', {}).get('go') == 'integrations', ' · '.join(R)[:120])
        ok('② 손님 403', call('GET', '/admin/open-readiness', t=BT).get('_err') == 403, '')
        ok('② 꼭 줄 중 안 된 것 = 오픈 차단 READY(본인인증 STUB · 메일 꺼짐 → 2줄)',
           ri is not None and sorted(ri) == sorted(x['label'] for x in R.values() if x['required'] and not x['ok']) and len(ri) == 2, str(ri))

        setv('identity.provider', 'NICE'); R = rows(); ri = ready_items()
        ok('② 본인인증 NICE → 그 줄 풀림', R['IDENTITY']['ok'] and '본인인증 방식' not in (ri or ['본인인증 방식']), R['IDENTITY']['nowValue'])

        setv('alimtalk.provider', 'MOCK'); R = rows(); ri = ready_items()
        ok('② 알림톡 MOCK → 「가짜 방식 없음」 막힘 · 어느 설정인지 보임', not R['NO_MOCK']['ok'] and 'alimtalk.provider = MOCK' in R['NO_MOCK']['nowValue']
           and '시험용 가짜(MOCK) 방식 없음' in (ri or []) and not R['ALIMTALK']['required'], R['NO_MOCK']['nowValue'])
        setv('alimtalk.provider', 'NONE')

        setv('notify.email_verified', 'on'); R = rows()
        ok('② 메일 켜면 풀림', R['MAIL']['ok'], R['MAIL']['nowValue'])

        live = psql("SELECT count(*) FROM integrations WHERE code IN ('PASS', 'BANK') AND status = 'LIVE'")
        setv('feature.referral_fee', 'on'); R = rows(); ri = ready_items()
        ok('② 소개비를 본인인증 · 계좌인증 LIVE 전에 켜면 막힘', (not R['REFERRAL_FEE']['ok'] and '소개비 스위치 순서' in (ri or [])) if live != '2' else R['REFERRAL_FEE']['ok'],
           R['REFERRAL_FEE']['nowValue'])
        setv('feature.referral_fee', 'off')

        others1 = psql("SELECT string_agg(kind || ':' || c, ' ' ORDER BY kind) FROM (SELECT kind, count(*) c FROM v_open_blockers WHERE kind <> 'READY' GROUP BY kind) x")
        ok('② 다른 차단(설정 · 약관 · 연동 · 간주) 수는 그대로', others0 == others1, others1)
    finally:
        for k, v in before.items():
            psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}';")
    ok('② 되돌림 — 설정 4개', all(psql(f"SELECT value FROM site_settings WHERE key = '{k}'") == v for k, v in before.items()), str(before))

# ── ③ 운영 화면 ───────────────────────────────────────────────────────
if ADMIN_WEB:
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if sync_playwright:
        with sync_playwright() as p:
            b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1400, 'height': 1000})
            pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
            pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(1500)
            pg.goto(ADMIN_WEB + '/#/checklist', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
            box = pg.locator('[data-open-ready]')
            ok('③ 오픈 체크리스트 › 「오픈 준비 점검」 8줄 · 꼭 4', box.count() == 1 and box.locator('[data-ready]').count() in (8, 9, 11)
               and box.locator('.pill-danger').count() == 4, box.inner_text()[:120] if box.count() else '없음')
            if box.count(): box.scroll_into_view_if_needed()
            pg.screenshot(path=os.path.join(HERE, 'v1146_open_ready.png'), full_page=False)
            b.close()

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
