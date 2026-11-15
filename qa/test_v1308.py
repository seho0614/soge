"""v10.308 (docs/431) — 요율 공지 자동 다시 알림 미리보기 · 켜기 시험
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1308.py

  ① (코드) GET admin/health/rate-schedules/auto-remind-preview(ADMIN · SUPER · 1 ~ 30) · 실제 작업과 같은 조건 · 읽기만 · 화면 칸 · SUPER 켜기 · 문서 431
  ② (API) 예약 두 건(5일 뒤 · 20일 뒤 · 공지 게시) → 7일: 「다음」 · 「그날」(시행일 − 7일 뒤 첫 00:05) · 0 · 31 은 422 · ADMIN 은 보기만
  ③ (작업) ADMIN 켜기 403 · SUPER 7일 → 정기 작업 → S1 만 자동 다시 알림 · 미리보기 「이미 보냄」 · 끔 · 설정 되돌림
  ④ (화면) 소개몰 정산 › 「요율 변경 예정」 › 미리보기 칸
  판매자는 고정 기록이 가리켜 지우지 못하면 폐점(CLOSED)으로 둠 — 두 번 돌아도 통과.
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB = os.environ.get('ADMIN_WEB')
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


def admin_account(tag, stamp):
    """ADMIN(최고 관리자 아님) 시험 계정 — 남겨 두어도 두 번째 실행에 지장 없음"""
    import consent_ok
    em = f't{tag}adm{stamp}@x.com'
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{em}', '시험{tag}', '{pw}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{em}'")
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag}', true); INSERT INTO account_roles (account_id, role) VALUES ('{aid}', 'ADMIN') ON CONFLICT DO NOTHING; COMMIT;")
    consent_ok.agree(em, PW)
    return em, aid


def login(e):
    return call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')


TERMS_MD5 = "SELECT md5(string_agg(code || version || status || coalesce(body, ''), '|' ORDER BY code, version)) FROM terms"

KEY = 'hlt.rate_auto_remind_days'
RS, HC = rd('src/modules/health/health-rate-schedule.service.ts'), rd('src/modules/health/health-seller.controller.ts')
RP, HT = rd('web/src/app/admin/RateAutoRemindPreview.tsx'), rd('web/src/app/admin/HealthTypeRates.tsx')
SJ, ST, D431 = rd('spec/screens.json'), rd('src/common/i18n/server-text.en.ts'), doc('431_')
ok('① 서버 — 미리보기 API(ADMIN · SUPER · 1 ~ 30 · 422 DAYS_RANGE) · 실제 작업과 같은 조건(예정 · 시행 전 · 자동 한 번 · 24시간 · 안 펼친 대상) · 읽기만 · 명세 · 영어',
   "@Get('admin/health/rate-schedules/auto-remind-preview')" in HC and 'async autoRemindPreview(daysIn' in RS and "'DAYS_RANGE'" in RS
   and "r.status = 'SCHEDULED' AND r.effective_at > now()" in RS and 'm.auto' in RS and "interval '24 hours'" in RS
   and 'NOT EXISTS (SELECT 1 FROM notice_reads nr WHERE nr.notice_id = c.notice_id' in RS
   and 'UPDATE' not in RS[RS.find('async autoRemindPreview'):RS.find('/** v10.283 (D212 · docs/411)')] and 'INSERT' not in RS[RS.find('async autoRemindPreview'):RS.find('/** v10.283 (D212 · docs/411)')]
   and '"GET /admin/health/rate-schedules/auto-remind-preview"' in SJ and '"일수는 1 ~ 30 사이 정수로 적어 주십시오.":' in ST, '')
ok('① 화면 — 「요율 변경 예정」 안 미리보기(예약 없어도) · SUPER 만 켜기 · 끄기 · 확인 창 · 사유 · 기존 설정 저장 · 문서 431 · 판 v10.308',
   '<RateAutoRemindPreview onChanged={q.reload} />' in HT and 'data-rate-auto-preview' in RP and "tokenRoles().includes('SUPER')" in RP
   and 'isSuper && p && p.days !== p.current' in RP and 'window.confirm' in RP and 'window.prompt' in RP
   and "api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key: 'hlt.rate_auto_remind_days'" in RP
   and 'auto-remind-preview' in D431 and VT >= (10, 308), VER)

stamp = str(int(time.time()))[-7:]
TAG = f'시험 1308 {stamp}'
EM = {k: f't1308{k.lower()}{stamp}@x.com' for k in ('A', 'B')}


def kst_run(ts):
    """ts(UTC aware) 뒤 첫 00:05(한국) — 서버와 같은 규칙"""
    k = ts.astimezone(datetime.timezone(datetime.timedelta(hours=9)))
    c = k.replace(hour=0, minute=5, second=0, microsecond=0)
    if k > c:
        c += datetime.timedelta(days=1)
    return c.strftime('%Y-%m-%d %H:%M')


if API and DB:
    import consent_ok
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    acc = {}
    for k, e_ in EM.items():
        psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{e_}', '시험1308{k}', '{pw}', now()) ON CONFLICT DO NOTHING")
        consent_ok.agree(e_, PW)
        acc[k] = psql(f"SELECT id FROM accounts WHERE email = '{e_}'")
    consent_ok.agree('admin@x.com', PW)
    ADM, _ = admin_account('1308', stamp)
    TS, TA = login('admin@x.com'), login(ADM)
    orig = psql(f"SELECT coalesce(value, '0') FROM site_settings WHERE key = '{KEY}'") or '0'
    sid, sch, nts, eff = {}, {}, [], {}
    try:
        call('PATCH', '/admin/site-settings', {'key': KEY, 'value': '0', 'reason': f'{TAG} 처음'}, TS)
        for k in ('A', 'B'):
            sid[k] = psql(f"INSERT INTO hlt_sellers (code, account_id, type, name, personal, ceo_name, cs_tel, return_addr, status, applied_at, submerchant_id) "
                          f"VALUES ('TN-P{k}{stamp}', '{acc[k]}', 'TENANT', '시험 가게 1308{k}', true, '홍길동', '02-000-0000', '서울 강남구 테헤란로 1', 'ACTIVE', now(), 'SUB-P{k}{stamp}') RETURNING id").splitlines()[0]
        for s_, k, days in (('S1', 'A', 5), ('S2', 'B', 20)):
            n_ = psql(f"INSERT INTO notices (gwan_code, title, body, grades, published_at) VALUES ('HLT', '{TAG} {s_} 공지', '요율 본문', ARRAY['SELLER'], now() - interval '1 minute') RETURNING id").splitlines()[0]
            nts.append(n_)
            row = psql(f"INSERT INTO hlt_rate_schedules (scope, target, from_rate, to_rate, effective_at, reason, created_at, notice_id) "
                       f"VALUES ('SELLER', '{sid[k]}', 10, 20, now() + interval '{days} days', '{TAG} {s_}', now() - interval '40 days', '{n_}') RETURNING id || '|' || to_char(effective_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS')").splitlines()[0]
            sch[s_], e = row.split('|')
            eff[s_] = datetime.datetime.fromisoformat(e).replace(tzinfo=datetime.timezone.utc)
        now = datetime.datetime.now(datetime.timezone.utc)
        pv = call('GET', '/admin/health/rate-schedules/auto-remind-preview?days=7', None, TS)
        rows = {x.get('id'): x for x in pv.get('rows') or []}
        r1, r2 = rows.get(sch['S1'], {}), rows.get(sch['S2'], {})
        want2 = kst_run(eff['S2'] - datetime.timedelta(days=7))
        ok('② 미리보기 7일 — S1(5일 뒤) 「다음 정기 작업」 · 날짜 = 다음 00:05 · S2(20일 뒤) 「그날」 = 시행일 − 7일 뒤 첫 00:05 · 대상 1 · 안 읽음 1 · 지금 설정 0 · 요약에 S1',
           r1.get('state') == 'next' and r1.get('runDate') == pv.get('nextRun') == kst_run(now) and r2.get('state') == 'later' and r2.get('runDate') == want2
           and r1.get('targets') == 1 and r1.get('unread') == 1 and r2.get('unread') == 1 and pv.get('current') == 0 and pv.get('days') == 7
           and (pv.get('summary') or {}).get('nextSchedules', 0) >= 1 and '시험 가게 1308A' == r1.get('label'),
           f"{ {k: r1.get(k) for k in ('state', 'runDate', 'targets', 'unread')} } · { {k: r2.get(k) for k in ('state', 'runDate')} } want {want2} · next {pv.get('nextRun')} · {pv.get('summary')}")
        b0 = call('GET', '/admin/health/rate-schedules/auto-remind-preview?days=0', None, TS)
        b1 = call('GET', '/admin/health/rate-schedules/auto-remind-preview?days=31', None, TS)
        a1 = call('GET', '/admin/health/rate-schedules/auto-remind-preview?days=3', None, TA)
        p30 = call('GET', '/admin/health/rate-schedules/auto-remind-preview?days=30', None, TS)
        r30 = {x.get('id'): x for x in p30.get('rows') or []}
        ok('② 0 · 31 은 422 DAYS_RANGE · ADMIN 도 볼 수 있음(3일 — S1 「그날」) · 30일이면 둘 다 「다음」 · 읽기만(설정 그대로)',
           b0.get('_err') == 422 and b0.get('code') == 'DAYS_RANGE' and b1.get('_err') == 422 and '_err' not in a1
           and {x.get('id'): x for x in a1.get('rows') or []}.get(sch['S1'], {}).get('state') == 'later'
           and r30.get(sch['S1'], {}).get('state') == 'next' and r30.get(sch['S2'], {}).get('state') == 'next'
           and psql(f"SELECT value FROM site_settings WHERE key = '{KEY}'") == '0', f"{b0.get('code')} {b1.get('code')} · {str(a1)[:60]}")

        na = call('PATCH', '/admin/site-settings', {'key': KEY, 'value': '7', 'reason': f'{TAG} ADMIN'}, TA)
        on = call('PATCH', '/admin/site-settings', {'key': KEY, 'value': '7', 'reason': f'{TAG} 켬'}, TS)
        j1 = call('POST', '/admin/jobs', {'job': 'hlt_rate_schedule'}, TS)
        au = lambda s_: psql(f"SELECT count(*) FROM hlt_rate_reminds WHERE schedule_id = '{sch[s_]}' AND auto")
        pv2 = call('GET', '/admin/health/rate-schedules/auto-remind-preview?days=7', None, TS)
        rows2 = {x.get('id'): x for x in pv2.get('rows') or []}
        ok('③ 미리보기대로 — ADMIN 켜기 403 · SUPER 7일 켬 → 작업 → S1 자동 다시 알림 1 · S2 0 · 다시 본 미리보기 S1 「이미 보냄」 · S2 「그날」 · 지금 설정 7',
           na.get('_err') == 403 and '_err' not in on and '_err' not in j1 and au('S1') == '1' and au('S2') == '0'
           and rows2.get(sch['S1'], {}).get('state') == 'done' and rows2.get(sch['S2'], {}).get('state') == 'later' and pv2.get('current') == 7,
           f"{na.get('_err')} · {str(on)[:40]} · S1 {au('S1')} S2 {au('S2')} · {rows2.get(sch['S1'], {}).get('state')} {rows2.get(sch['S2'], {}).get('state')} · {pv2.get('current')}")
        call('PATCH', '/admin/site-settings', {'key': KEY, 'value': '0', 'reason': f'{TAG} 끔'}, TS)

        try:
            from playwright.sync_api import sync_playwright
        except Exception:
            sync_playwright = None
        if ADMIN_WEB and sync_playwright:
            seen = {}
            try:
                with sync_playwright() as p:
                    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 1000})
                    pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                    pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                    pg.goto(ADMIN_WEB + '/#/hlt-settle', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                    box = pg.locator('[data-rate-auto-preview]')
                    seen['box'] = box.count()
                    if box.count():
                        box.locator('summary').click(); pg.wait_for_timeout(500)
                        box.locator('[data-rate-auto-days]').fill('30'); box.locator('[data-rate-auto-see]').click(); pg.wait_for_timeout(1500)
                        seen['cur'] = box.locator('[data-rate-auto-current]').get_attribute('data-rate-auto-current') if box.locator('[data-rate-auto-current]').count() else ''
                        seen['onBtn'] = box.locator('[data-rate-auto-on]').count()
                        seen['rows'] = box.locator('[data-rate-auto-row]').count()
                        seen['txt'] = '시험 가게 1308B' in box.inner_text()
                    b.close()
            except Exception as e:
                seen['err'] = str(e)[:200]
            ok('④ 화면 — 소개몰 정산 › 「요율 변경 예정」 › 미리보기 칸 · 30일 미리보기 · 지금 설정 0 · SUPER 에게 「이 값으로 켜기」 · 시험 예약 줄',
               seen.get('box') == 1 and seen.get('cur') == '0' and seen.get('onBtn') == 1 and (seen.get('rows') or 0) >= 2 and seen.get('txt') is True, f'{seen}')
        else:
            print('  (운영 화면 · playwright 없음 — ④ 건너뜀)')
    finally:
        call('PATCH', '/admin/site-settings', {'key': KEY, 'value': orig, 'reason': f'{TAG} 정리'}, TS)
        if psql(f"SELECT value FROM site_settings WHERE key = '{KEY}'") != orig:
            psql(f"UPDATE site_settings SET value = '{orig}' WHERE key = '{KEY}'")
        for s_ in sch.values():
            psql(f"UPDATE hlt_rate_schedules SET status = 'CANCELED', canceled_at = now(), cancel_reason = '시험 1308 정리' WHERE id = '{s_}' AND status = 'SCHEDULED'")
        for n_ in nts:
            psql(f"UPDATE notices SET is_pinned = false WHERE id = '{n_}'")
        psql(f"DELETE FROM notifications WHERE account_id IN (SELECT id FROM accounts WHERE email IN ({', '.join(repr(e_) for e_ in EM.values())}))")
        for s_ in sid.values():
            if psql(f"DELETE FROM hlt_sellers WHERE id = '{s_}'").find('!') != -1:
                psql(f"UPDATE hlt_sellers SET status = 'CLOSED', status_reason = '시험 1308 정리' WHERE id = '{s_}' AND status <> 'CLOSED'")
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
