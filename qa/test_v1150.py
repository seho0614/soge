"""v10.150 시험 — 오픈일 한 칸(D144 · docs/230)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1150.py

  ① 코드 — D144(설정 · 보기 9줄 · 지우는 문장 없음 · 182) · API(SUPER · 감사) · DTO · 화면 목록 · 운영 화면 · docs/230 · 판
  ② (API · DB) 오픈일 넣기 → 홍보 끝 +3개월 · 게시 마감 −7 · −30 · 남은 날 · 지난 날 · 없는 날 422 · 손님 403 · 준비 점검 9줄(권장) ·
     오픈 차단 수 그대로 · 비우기(홍보 끝은 그대로) · 감사 기록 · 되돌림
  ③ (운영 화면) 오픈 체크리스트 「오픈일」 칸
"""
import datetime, json, os, re, subprocess, urllib.error, urllib.request

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
D = rd('prisma/migrations/D144_open_date/migration.sql')
mig = sorted(x for x in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', x)))
ok('① D144 — 설정 service.open_date(빈 값 · 날짜 형식) · v_open_readiness 9줄(OPEN_DATE 권장) · 지우는 문장 없음 · 182 이상',
   "('service.open_date', ''" in D and 'ON CONFLICT (key) DO NOTHING' in D and 'CREATE OR REPLACE VIEW public.v_open_readiness' in D
   and "('OPEN_DATE', '오픈일', false" in D and all(f"('{c}', " in D for c in ('IDENTITY', 'MAIL', 'NO_MOCK', 'REFERRAL_FEE', 'ALIMTALK', 'ESIGN', 'SAFENUM', 'AI'))
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|TRUNCATE|DROP COLUMN|UPDATE )\b', D)
   and len(mig) >= 182 and 'D144_open_date' in mig, f'{len(mig)} · {mig[-1]}')
TC = rd('src/modules/catalog/terms.controller.ts'); TS = rd('src/modules/catalog/terms.service.ts'); TD = rd('src/modules/catalog/terms.dto.ts')
ok('① API — GET · PUT /admin/open-date(SUPER 컨트롤러) · 감사 OPEN_DATE_SET · 지난 날 · 없는 날 거절 · 홍보 끝 +3개월 · 약관은 안 바꿈',
   "@Get('open-date')" in TC and "@Put('open-date')" in TC and "@Audit('OPEN_DATE_SET', 'SETTING')" in TC and "@Roles('SUPER')" in TC
   and 'class OpenDateDto' in TD and 'class SetOpenDateDto' in TD and "'OPEN_DATE_PAST'" in TS and "'OPEN_DATE_INVALID'" in TS
   and "interval '3 months'" in TS and 'UPDATE terms' not in TS.split('async openDate()')[1], '')
scr = {s['id']: s for s in json.loads(rd('spec/screens.json') or '{}').get('screens', [])}
ok('① 화면 목록 — 오픈 체크리스트에 API 2개', all(a in scr.get('SB-ADM-SIT-040', {}).get('apis', []) for a in ('GET /admin/open-date', 'PUT /admin/open-date')), '')
OC = rd('web/src/app/admin/OpenChecklist.tsx')
ok('① 운영 화면 — 「오픈일」 칸 · 저장 확인 창 · 홍보 끝 · 게시 마감 · 시행일 다른 약관', "'/admin/open-date'" in OC and 'data-open-date' in OC
   and 'window.confirm(' in OC.split('function OpenDateBox')[1] and 'data-promo-end' in OC and 'data-terms-other' in OC, '')
D230 = next((rd('docs/' + f) for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('230_')), '')
ok('① docs/230 — 오픈 + 3개월 · 게시 마감 7 · 30일 · 약관은 안 바꿈 · 덮어씀 안내', '오픈 + 3개월' in D230 and '30일' in D230 and '약관은 바꾸지 않음' in D230 and '덮어씁니다' in D230, '')
ok('① 판 v10.150 이상', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 150), rd('VERSION').strip())


# ── ② API · DB ───────────────────────────────────────────────────────
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
        return {'_err': e.code, 'code': body.get('code')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip()


def add_months(d, n):
    y, m = divmod(d.month - 1 + n, 12)
    y += d.year; m += 1
    import calendar
    return d.replace(year=y, month=m, day=min(d.day, calendar.monthrange(y, m)[1]))


if API and DB:
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW})['accessToken']
    BT = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW})['accessToken']
    before = {k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'") for k in ('service.open_date', 'request.view.limit_from')}
    blk0 = psql("SELECT count(*) FROM v_open_blockers")
    today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).date()
    od = today + datetime.timedelta(days=47)
    try:
        r = call('PUT', '/admin/open-date', {'date': od.isoformat()}, T_)
        ok('② 오픈일 넣기 → 홍보 끝 = +3개월 · 게시 마감 −7 · −30 · 남은 날', r.get('openDate') == od.isoformat()
           and r.get('promoEndsOn') == add_months(od, 3).isoformat() and r.get('termsPublishBy') == (od - datetime.timedelta(days=7)).isoformat()
           and r.get('termsUnfavorableBy') == (od - datetime.timedelta(days=30)).isoformat() and r.get('daysLeft') == 47
           and isinstance(r.get('termsOtherDate'), int), json.dumps(r)[:200])
        ok('② DB — service.open_date · request.view.limit_from 함께', psql("SELECT value FROM site_settings WHERE key = 'service.open_date'") == od.isoformat()
           and psql("SELECT value FROM site_settings WHERE key = 'request.view.limit_from'") == add_months(od, 3).isoformat(), '')
        ok('② GET 이 같은 값', call('GET', '/admin/open-date', t=T_).get('promoEndsOn') == add_months(od, 3).isoformat(), '')
        ok('② 지난 날 422 OPEN_DATE_PAST', call('PUT', '/admin/open-date', {'date': (today - datetime.timedelta(days=1)).isoformat()}, T_).get('code') == 'OPEN_DATE_PAST', '')
        ok('② 없는 날(2월 30일) 422 OPEN_DATE_INVALID', call('PUT', '/admin/open-date', {'date': f'{today.year + 1}-02-30'}, T_).get('code') == 'OPEN_DATE_INVALID', '')
        ok('② 형식 오류 400 · 손님 403', call('PUT', '/admin/open-date', {'date': '12/15'}, T_).get('_err') == 400
           and call('PUT', '/admin/open-date', {'date': od.isoformat()}, BT).get('_err') == 403 and call('GET', '/admin/open-date', t=BT).get('_err') == 403, '')
        R = {x['code']: x for x in call('GET', '/admin/open-readiness', t=T_)}
        ok('② 준비 점검 9줄 · 오픈일 줄 권장 · 됨 · 오픈 차단 수 그대로', len(R) == 9 and R['OPEN_DATE']['required'] is False and R['OPEN_DATE']['ok']
           and od.isoformat() in R['OPEN_DATE']['nowValue'] and psql("SELECT count(*) FROM v_open_blockers") == blk0, R.get('OPEN_DATE', {}).get('nowValue', ''))
        ok('② 감사 기록 OPEN_DATE_SET', psql("SELECT count(*) FROM audit.audit_logs WHERE action = 'OPEN_DATE_SET' AND occurred_at > now() - interval '5 minutes'") not in ('', '0'), '')
        pe = psql("SELECT value FROM site_settings WHERE key = 'request.view.limit_from'")
        r = call('PUT', '/admin/open-date', {'date': ''}, T_)
        ok('② 비우기 — 오픈일만 지움 · 홍보 끝 그대로 · 줄 꺼짐', r.get('openDate') is None and r.get('promoEndsOn') == pe
           and not {x['code']: x for x in call('GET', '/admin/open-readiness', t=T_)}['OPEN_DATE']['ok'], json.dumps(r)[:120])
    finally:
        for k, v in before.items():
            psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}'")
    ok('② 되돌림', all(psql(f"SELECT value FROM site_settings WHERE key = '{k}'") == v for k, v in before.items()), str(before))

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
            box = pg.locator('[data-open-date]')
            ok('③ 오픈 체크리스트 › 「오픈일」 칸 · 날짜 · 저장 · 준비 점검 9줄 · 파일 저장 위치',
               box.count() == 1 and box.locator('[data-open-date-input]').count() == 1 and box.locator('[data-open-date-save]').count() == 1
               and pg.locator('[data-open-ready] [data-ready]').count() == 9 and pg.locator('[data-storage]').count() == 1,
               box.inner_text()[:120] if box.count() else '없음')
            if box.count(): box.scroll_into_view_if_needed()
            pg.screenshot(path=os.path.join(HERE, 'v1150_open_date.png'), full_page=False)
            b.close()

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
