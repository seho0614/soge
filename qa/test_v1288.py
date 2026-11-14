"""v10.288 (D215 · docs/413) — 감사 기록 찾기 키우기

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1288.py

  ① (코드) D215 색인 2개 · 찾기(사람 · 행위 앞부분 · 대상 · 기간 · 종류 · 100줄) · 상세 · CSV(SUPER · 1만 줄 · AUDIT_LOG_EXPORT) · 화면 · 명세 · 영어
  ② (API) 설정을 바꾼 감사 줄을 사람 · 행위 앞부분 · 대상 · 오늘로 찾음 · 상세(내용) · 기간 오류 422 · 검수 403
  ③ (CSV) SUPER 는 받음(엑셀용 머리 · 줄) · 감사 AUDIT_LOG_EXPORT · ADMIN 만인 사람은 403
  ④ (화면) 위험감지 › 감사 › 「감사 기록」 사람 · 행위로 찾기 · 줄 누르면 상세 · CSV 단추(SUPER)
  설정은 처음대로(두 번 돌아도 통과).
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.request

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


VER = rd('VERSION').strip()
M15 = rd('prisma/migrations/D215_audit_search/migration.sql')
AS, AC = rd('src/modules/govern/audit.service.ts'), rd('src/modules/govern/audit.controller.ts')
AU, SCR, EN = rd('web/src/app/admin/Audit.tsx'), rd('spec/screens.json'), rd('src/common/i18n/server-text.en.ts')

ok('① D215 — 기간 색인 · 행위(앞부분) 색인',
   'CREATE INDEX IF NOT EXISTS ix_audit_logs_at ON audit.audit_logs (occurred_at DESC)' in M15 and 'ix_audit_logs_action ON audit.audit_logs (action text_pattern_ops, occurred_at DESC)' in M15)
ok('① API — search(100줄 · 1년 · 최근 7일) · logs/:id · export(SUPER · 1만 줄 · AUDIT_LOG_EXPORT · 엑셀 수식 막기) · 화면 · 명세 · 영어',
   "@Get('search')" in AC and "@Get('export')" in AC and "@Roles('SUPER')" in AC and "@Get('logs/:id')" in AC
   and 'LIMIT 100 OFFSET' in AS and 'LIMIT 10001' in AS and "'AUDIT_LOG_EXPORT'" in AS and "PERIOD_TOO_LONG" in AS and "/^[=+\\-@]/" in AS
   and 'data-audit-who' in AU and 'data-audit-detail' in AU and 'data-audit-csv' in AU and '/admin/audit/search?' in AU and 'aria-label="행위"' in AU
   and '"GET /admin/audit/search"' in SCR and '"GET /admin/audit/export"' in SCR and '"기간은 1년(366일)까지 고를 수 있습니다.": ' in EN)


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        raw = urllib.request.urlopen(r, timeout=180).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()




def pw_page(path, steps):
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return None, ['playwright 없음']
    seen, perr = {}, []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = b.new_page(viewport={'width': 1500, 'height': 1000}); pg.on('pageerror', lambda e: perr.append(str(e)[:120])); pg.on('dialog', lambda d: d.dismiss())
            pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
            pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
            pg.wait_for_selector('[data-state-check]', timeout=30000)
            pg.goto(ADMIN_WEB + path, wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
            steps(pg, seen)
            b.close()
    except Exception as ex:
        perr.append(str(ex)[:160])
    return seen, perr

stamp = str(int(time.time()))[-7:]
TAGN = 'T1288'
ADM = f't1288adm{stamp}@x.com'
REV = f't1288rev{stamp}@x.com'
KEY = 'ops.board_retention_days'
if API and DB:
    import consent_ok
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    def staff(email, name, role):
        psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{email}', '{name}', '{pw}', now()) ON CONFLICT DO NOTHING")
        i = psql(f"SELECT id FROM accounts WHERE email = '{email}'")
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {TAGN}', true); INSERT INTO account_roles (account_id, role) VALUES ('{i}', '{role}') ON CONFLICT DO NOTHING; COMMIT;")
        consent_ok.agree(email, PW)
    def unstaff(email, role):
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {TAGN} 정리', true); DELETE FROM account_roles WHERE account_id = (SELECT id FROM accounts WHERE email = '{email}') AND role = '{role}'; COMMIT;")
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    login = lambda e: call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')
    staff(ADM, '시험운영1288', 'ADMIN'); staff(REV, '시험검수1288', 'REVIEWER')
    TS, TA, TR = login('admin@x.com'), login(ADM), login(REV)
    old = psql(f"SELECT value FROM site_settings WHERE key = '{KEY}'") or '365'
    nv = '45' if old != '45' else '46'
    try:
        me = psql("SELECT name FROM accounts WHERE email = 'admin@x.com'")
        r = call('PATCH', '/admin/site-settings', {'key': KEY, 'value': nv, 'reason': '시험 1288'}, TS)
        time.sleep(1.5)
        today = psql("SELECT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')")
        s1 = call('GET', f'/admin/audit/search?who=admin%40x.com&action=site_setting&target=SITE_SETTING&from={today}&to={today}', None, TS)
        it = (s1.get('items') or [{}])[0]
        dt = call('GET', f"/admin/audit/logs/{it.get('id')}", None, TS) if it.get('id') else {}
        s2 = call('GET', '/admin/audit/search?kind=OPS', None, TS)
        b1 = call('GET', '/admin/audit/search?from=2026-02-01&to=2026-01-01', None, TS)
        b2 = call('GET', '/admin/audit/search?from=2024-01-01&to=2026-01-01', None, TS)
        nf = call('GET', '/admin/audit/logs/999999999999', None, TS)
        rv = call('GET', '/admin/audit/search', None, TR)
        ok('② API — 사람(이메일 일부) · 행위 앞부분(소문자도) · 대상 · 오늘로 찾음 · 상세 내용 · 최근 7일 기본 · 기간 오류 422 · 없는 번호 404 · 검수 403',
           '_err' not in r and it.get('action') == 'SITE_SETTING_UPDATE' and it.get('actor') == me and s1.get('pageSize') == 100
           and (dt.get('after') or {}).get('key') == KEY and s2.get('from') and (s2.get('total') or 0) >= 1
           and b1.get('code') == 'BAD_PERIOD' and b2.get('code') == 'PERIOD_TOO_LONG' and nf.get('_err') == 404 and rv.get('_err') == 403,
           f"{r} · {it} · {(dt.get('after') or {})} · {s2.get('from')} {s2.get('total')} · {b1.get('code')} · {b2.get('code')} · {nf.get('_err')} · {rv.get('_err')}")

        n0 = psql("SELECT count(*) FROM audit.audit_logs WHERE action = 'AUDIT_LOG_EXPORT'")
        ex = call('GET', f'/admin/audit/export?action=SITE_SETTING&from={today}&to={today}', None, TS)
        n1 = psql("SELECT count(*) FROM audit.audit_logs WHERE action = 'AUDIT_LOG_EXPORT'")
        lastx = psql("SELECT after_data->>'action' || '|' || (after_data->>'rows') FROM audit.audit_logs WHERE action = 'AUDIT_LOG_EXPORT' ORDER BY id DESC LIMIT 1")
        ea = call('GET', '/admin/audit/export', None, TA)
        sa = call('GET', '/admin/audit/search', None, TA)
        csv = ex.get('csv') or ''
        ok('③ CSV — SUPER 받음(엑셀 머리 · 그날 설정 줄) · 감사 AUDIT_LOG_EXPORT(조건 · 줄 수) · ADMIN 만인 사람은 CSV 403 · 찾기는 됨',
           csv.startswith('\ufeff일시(한국),행위,') and 'SITE_SETTING_UPDATE' in csv and (ex.get('rows') or 0) >= 1 and ex.get('truncated') is False
           and int(n1) == int(n0) + 1 and lastx.startswith('SITE_SETTING|') and ea.get('_err') == 403 and '_err' not in sa,
           f"{csv[:40]!r} · {ex.get('rows')} · {n0}→{n1} · {lastx} · {ea.get('_err')} · {sa.get('_err')}")

        if ADMIN_WEB:
            def steps(pg, seen):
                pg.fill('input[aria-label="사람"]', 'admin@x.com'); pg.fill('input[aria-label="행위"]', 'SITE_SETTING'); pg.click('form.search-row button'); pg.wait_for_timeout(2000)
                rows = pg.locator('[data-audit-log-table] tbody tr')
                seen['rows'] = rows.count()
                seen['allSet'] = all('SITE_SETTING' in rows.nth(i).inner_text() for i in range(min(5, rows.count())))
                if rows.count():
                    rows.first.click(); pg.wait_for_timeout(1500)
                seen['detail'] = pg.locator('[data-audit-detail]').count()
                seen['csv'] = pg.locator('[data-audit-csv]').count()
                pg.screenshot(path=os.path.join(HERE, 'v1288_audit.png'), full_page=True)
            seen, perr = pw_page('/#/gov-audit/logs', steps)
            if seen is None:
                print('  (화면 · playwright 없음 — ④ 건너뜀)')
            else:
                ok('④ 화면 — 감사 기록 사람 · 행위로 찾기 · 줄 누르면 상세 · CSV 단추(SUPER) · 화면 오류 없음',
                   (seen.get('rows') or 0) >= 1 and seen.get('allSet') and seen.get('detail') == 1 and seen.get('csv') == 1 and not perr, f'{seen} · {perr[:2]}')
    finally:
        psql(f"UPDATE site_settings SET value = '{old}' WHERE key = '{KEY}'")
        unstaff(ADM, 'ADMIN'); unstaff(REV, 'REVIEWER')
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
