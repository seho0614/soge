"""v10.287 (D214 · docs/413) — 전체 설정 · 설정 바뀐 기록

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1287.py

  ① (코드) D214(바뀐 기록 · 가림 함수 · 트리거 · 쌓기만) · API(설정 기록 · 목록에 바꾼 때 · 사람) · 화면(정책 › 「전체 설정」) · 명세 · 문서 413 · 마이그레이션 252 · 판 v10.287
  ② (DB) 가림(비밀 키 · 계좌 끝 4자리) · psql 로 바꿔도 기록(DB · 사유) · 같은 값은 기록 안 함 · 고치기 · 지우기 막음
  ③ (API) 화면에서 바꾸면 전 · 후 · 누가 · 까닭 · 키 앞부분 · 날짜 거름 · 목록의 바꾼 때 · 사람 · 검수 · 회원 403
  ④ (화면) 정책 › 「전체 설정」 목록 · 찾기 · 「기록」
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
M14 = rd('prisma/migrations/D214_setting_history/migration.sql')
AD, AC = rd('src/modules/admin/admin.service.ts'), rd('src/modules/admin/admin.controller.ts')
SS, MENU, APP = rd('web/src/app/admin/SiteSettings.tsx'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx')
SCR = rd('spec/screens.json')
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []
D413 = next((open(os.path.join(K, 'docs', x), encoding='utf-8').read() for x in docs if x.startswith('413_')), '')
mig = [d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isfile(os.path.join(K, 'prisma/migrations', d, 'migration.sql'))] if os.path.isdir(os.path.join(K, 'prisma/migrations')) else []

ok('① D214 — site_setting_changes(전 · 후 · 가림 · 누가 · DB/APP · 사유) · fn_setting_is_secret · fn_setting_mask · trg_setting_history · 쌓기만(APND)',
   'CREATE TABLE IF NOT EXISTS public.site_setting_changes' in M14 and 'fn_setting_mask(NEW.key, OLD.value)' in M14
   and "current_setting('app.setting_reason', true)" in M14 and 'CREATE TRIGGER trg_setting_history AFTER UPDATE OF value ON public.site_settings' in M14
   and 'EXECUTE FUNCTION public.fn_append_only_guard()' in M14 and '(secret|token|password|api_key)' in M14, f'{len(M14)}')
ok('① API — GET site-settings/history(키 · 앞부분 · 기간 · 50줄) · 목록에 updatedAt · updatedBy',
   "@Get('site-settings/history')" in AC and 'async settingHistory(' in AD and "c.key LIKE $1 || '.%'" in AD and 'LIMIT 50 OFFSET' in AD
   and '"updatedAt", (SELECT a.name FROM accounts a WHERE a.id = s.updated_by) AS "updatedBy"' in AD)
ok('① 화면 · 명세 · 문서 — 정책 › 「전체 설정」(ADMIN · SUPER) · 찾기 · 묶음 · 고치기(까닭) · 기록 · 명세 SB-ADM-SET-010 · 문서 413 · 마이그레이션 252 · 판 v10.287',
   "['settings', '전체 설정']" in MENU and "tabs: ['policy', 'settings', 'codes']" in MENU and "{tab === 'settings' && <SiteSettings />}" in APP
   and 'data-site-settings-search' in SS and 'data-site-setting-history' in SS and '/admin/site-settings/history?' in SS and 'data-site-setting-reason' in SS
   and '"id": "SB-ADM-SET-010"' in SCR and '"GET /admin/site-settings/history"' in SCR and bool(D413)
   and len(mig) in (252, 253) and tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 287), f'{len(mig)} · {VER} · 413 {bool(D413)}')


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


stamp = str(int(time.time()))[-7:]
REV = f't1287rev{stamp}@x.com'
KEY = 'ops.board_retention_days'
if API and DB:
    import consent_ok
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{REV}', '시험검수1287', '{pw}', now()) ON CONFLICT DO NOTHING")
    rid = psql(f"SELECT id FROM accounts WHERE email = '{REV}'")
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 T1287', true); INSERT INTO account_roles (account_id, role) VALUES ('{rid}', 'REVIEWER') ON CONFLICT DO NOTHING; COMMIT;")
    consent_ok.agree(REV, PW); consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    login = lambda e: call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')
    TS, TB, TR = login('admin@x.com'), login('buyer@x.com'), login(REV)
    old = psql(f"SELECT value FROM site_settings WHERE key = '{KEY}'") or '365'
    a1, a2 = ('41' if old != '41' else '42'), ('43' if old != '43' else '44')
    try:
        mk = psql("SELECT fn_setting_mask('x.api_key', 'abcdefghijkl') || '|' || fn_setting_mask('company.bank_account', '123-45-678901') || '|' || fn_setting_mask('ops.telegram_chat', '12345') || '|' || fn_setting_is_secret('ops.slack_webhook_token')::text")
        n0 = psql("SELECT count(*) FROM site_setting_changes")
        psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 1287 psql', true); UPDATE site_settings SET value = '{a1}' WHERE key = '{KEY}'; COMMIT;")
        psql(f"UPDATE site_settings SET value = value WHERE key = '{KEY}'")
        dbrow = psql(f"SELECT before_val || '|' || after_val || '|' || via || '|' || coalesce(reason, '-') || '|' || secret FROM site_setting_changes WHERE key = '{KEY}' ORDER BY id DESC LIMIT 1")
        n1 = psql("SELECT count(*) FROM site_setting_changes")
        up = psql("UPDATE site_setting_changes SET reason = 'x' WHERE id = (SELECT max(id) FROM site_setting_changes)")
        de = psql("DELETE FROM site_setting_changes WHERE id = (SELECT max(id) FROM site_setting_changes)")
        ok('② DB — 가림(비밀 키 앞뒤 3자 · 계좌 끝 4자리 · 보통 값 그대로) · psql 로 바꿔도 기록(DB · 사유) · 같은 값은 안 남김 · 고치기 · 지우기 막음',
           mk == 'abc******jkl|***-**-**8901|12345|true' and dbrow == f'{old}|{a1}|DB|시험 1287 psql|false' and int(n1) == int(n0) + 1
           and 'APND' in up and 'APND' in de, f'{mk} · {dbrow} · {n0}→{n1} · {up[-60:]} · {de[-60:]}')

        r = call('PATCH', '/admin/site-settings', {'key': KEY, 'value': a2, 'reason': '시험 1287 화면'}, TS)
        h = call('GET', f'/admin/site-settings/history?key={KEY}', None, TS)
        it = (h.get('items') or [{}])[0]
        hp = call('GET', '/admin/site-settings/history?key=ops', None, TS)
        today = psql("SELECT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')")
        hd = call('GET', f'/admin/site-settings/history?key={KEY}&from={today}&to={today}', None, TS)
        hz = call('GET', f'/admin/site-settings/history?key={KEY}&to=2000-01-01', None, TS)
        ls = call('GET', '/admin/site-settings', None, TS)
        row = next((x for x in ls if isinstance(ls, list) and x.get('key') == KEY), {}) if isinstance(ls, list) else {}
        rv = call('GET', '/admin/site-settings/history', None, TR)
        bu = call('GET', '/admin/site-settings/history', None, TB)
        ok('③ API — 화면에서 바꾸면 전 · 후 · 누가 · 까닭 · 키 앞부분(ops) · 오늘 거름 · 옛 날짜 0 · 목록 바꾼 때 · 사람 · 검수 · 회원 403',
           '_err' not in r and it.get('before') == a1 and it.get('after') == a2 and it.get('via') == 'APP' and it.get('reason') == '시험 1287 화면' and bool(it.get('who'))
           and any(x.get('key') == KEY for x in hp.get('items') or []) and (hd.get('total') or 0) >= 2 and hz.get('total') == 0 and hz.get('pageSize') == 50
           and row.get('value') == a2 and bool(row.get('updatedAt')) and bool(row.get('updatedBy')) and rv.get('_err') == 403 and bu.get('_err') == 403,
           f"{r} · {it} · ops {len(hp.get('items') or [])} · 오늘 {hd.get('total')} · 옛 {hz.get('total')} · {row.get('updatedBy')} · {rv.get('_err')} · {bu.get('_err')}")

        try:
            from playwright.sync_api import sync_playwright
        except Exception:
            sync_playwright = None
        if sync_playwright and ADMIN_WEB:
            seen, perr = {}, []
            try:
                with sync_playwright() as p:
                    b = p.chromium.launch()
                    pg = b.new_page(viewport={'width': 1500, 'height': 1000}); pg.on('pageerror', lambda e: perr.append(str(e)[:120])); pg.on('dialog', lambda d: d.dismiss())
                    pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                    pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                    pg.wait_for_selector('[data-state-check]', timeout=30000)
                    pg.goto(ADMIN_WEB + '/#/settings', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                    seen['rows'] = pg.locator('[data-site-setting-row]').count()
                    pg.fill('[data-site-settings-search]', 'board_retention'); pg.wait_for_timeout(500)
                    seen['found'] = pg.locator('[data-site-setting-row]').count()
                    if pg.locator(f'[data-site-setting-history="{KEY}"]').count():
                        pg.locator(f'[data-site-setting-history="{KEY}"]').first.click(); pg.wait_for_timeout(2000)
                    seen['changes'] = pg.locator(f'[data-site-setting-change="{KEY}"]').count()
                    seen['other'] = pg.locator('[data-site-setting-change]').count() - seen['changes']
                    pg.locator(f'[data-site-setting-open="{KEY}"]').first.click(); pg.wait_for_timeout(500)
                    seen['edit'] = pg.locator('[data-site-setting-input]').count()
                    pg.screenshot(path=os.path.join(HERE, 'v1287_settings.png'), full_page=True)
                    b.close()
            except Exception as ex:
                perr.append(str(ex)[:160])
            ok('④ 화면 — 정책 › 「전체 설정」 목록 · 찾기로 좁힘 · 「기록」 누르면 그 설정 기록만 · 고치기 칸 · 화면 오류 없음',
               (seen.get('rows') or 0) >= 50 and seen.get('found') == 1 and (seen.get('changes') or 0) >= 2 and seen.get('other') == 0 and seen.get('edit') == 1 and not perr,
               f'{seen} · {perr[:2]}')
        else:
            print('  (화면 · playwright 없음 — ④ 건너뜀)')
    finally:
        psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 1287 정리', true); UPDATE site_settings SET value = '{old}' WHERE key = '{KEY}'; COMMIT;")
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 T1287 정리', true); DELETE FROM account_roles WHERE account_id = (SELECT id FROM accounts WHERE email = '{REV}') AND role = 'REVIEWER'; COMMIT;")
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
