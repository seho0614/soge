"""v10.289 (docs/413) — 운영 화면 전체 찾기

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1289.py

  ① (코드) 찾기 API(6묶음 · 5건 · 가림 · 역할 · ADMIN_SEARCH) · 메뉴 줄 칸 · 명세 · 영어
  ② (API) 이메일 일부 · 휴대폰 4자리로 회원 찾음(이름 · 이메일 가림 · 원래 값 없음) · SUPER 는 6묶음 · 검수는 공지 · 매물만 · 회원 403 · 한 글자 422 · 감사(찾은 말 앞 2자)
  ③ (화면) 메뉴 줄 오른쪽 「전체 찾기」 — 적으면 묶음별 결과
  만든 시험 회원은 남음(이메일마다 다름 · 두 번 돌아도 통과).
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


SV, SC = rd('src/modules/admin/admin-search.service.ts'), rd('src/modules/admin/admin-search.controller.ts')
APP, AS2, SCR, EN, AM = rd('web/src/App.tsx'), rd('web/src/app/admin/AdminSearch.tsx'), rd('spec/screens.json'), rd('src/common/i18n/server-text.en.ts'), rd('src/app.module.ts')
VER = rd('VERSION').strip()
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []
D413 = next((open(os.path.join(K, 'docs', x), encoding='utf-8').read() for x in docs if x.startswith('413_')), '')
ok('① 찾기 API — 6묶음(역할별) · 5건 · 이름 · 이메일 가림 · ADMIN_SEARCH(앞 2자) · 운영 계정 모두 · 모듈 등록',
   "@Controller('api/v1/admin/search')" in SC and "members:  { roles: ['ADMIN']" in SV and 'LIMIT 5' in SV and 'maskName(r.name)' in SV and 'maskEmail(r.email)' in SV
   and "'ADMIN_SEARCH'" in SV and "QUERY_TOO_SHORT" in SV and 'AdminSearchController,' in AM and 'AdminSearchService,' in AM)
ok('① 화면 · 명세 · 영어 · 문서 413 · 판 v10.289 — 메뉴 줄 「전체 찾기」 · 줄 누르면 그 화면 · 번호 복사',
   '<AdminSearch onGo=' in APP and 'data-admin-search-input' in AS2 and 'data-admin-search-item' in AS2 and 'navigator.clipboard' in AS2
   and '"GET /admin/search"' in SCR and '"두 글자 이상 적어 주십시오.": ' in EN and '전체 찾기' in D413
   and tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 289), VER)


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
TAGN = 'T1289'
REV = f't1289rev{stamp}@x.com'
MEM = f't1289mem{stamp}@x.com'
PH = f'010-12{stamp[-6:-4]}-{stamp[-4:]}'
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
    staff(REV, '시험검수1289', 'REVIEWER')
    psql(f"INSERT INTO accounts(email, name, password_hash, phone) VALUES ('{MEM}', '찾기시험회원', '{pw}', '{PH}') ON CONFLICT DO NOTHING")
    TS, TB, TR = login('admin@x.com'), login('buyer@x.com'), login(REV)
    try:
        r1 = call('GET', f'/admin/search?q=t1289mem{stamp}', None, TS)
        mem = next((s for s in r1.get('sections') or [] if s.get('key') == 'members'), {})
        m0 = (mem.get('items') or [{}])[0]
        raw = json.dumps(r1, ensure_ascii=False)
        r2 = call('GET', f"/admin/search?q={stamp[-4:]}", None, TS)
        ph_hit = any(it.get('id') == m0.get('id') for s in r2.get('sections') or [] if s.get('key') == 'members' for it in s.get('items') or [])
        keys = [s.get('key') for s in r1.get('sections') or []]
        rr = call('GET', '/admin/search?q=시험', None, TR)
        rkeys = sorted(s.get('key') for s in rr.get('sections') or [])
        rb = call('GET', '/admin/search?q=시험', None, TB)
        r1c = call('GET', '/admin/search?q=a', None, TS)
        au = psql("SELECT after_data->>'q' FROM audit.audit_logs WHERE action = 'ADMIN_SEARCH' AND actor_account_id = (SELECT id FROM accounts WHERE email = 'admin@x.com') ORDER BY id DESC LIMIT 1")
        ok('② API — 이메일 일부로 회원(이름 찾** · 이메일 가림 · 원래 이메일 · 이름 없음) · 휴대폰 4자리 · SUPER 6묶음 · 검수 공지 · 매물만 · 회원 403 · 한 글자 422 · 감사 앞 2자(휴대폰 찾기)',
           m0.get('title') == '찾***' and str(m0.get('sub') or '').startswith('t12****@x.com') and MEM not in raw and '찾기시험회원' not in raw and ph_hit
           and keys == ['members', 'orders', 'sellers', 'notices', 'listings', 'deals'] and rkeys == ['listings', 'notices']
           and rb.get('_err') == 403 and r1c.get('code') == 'QUERY_TOO_SHORT' and au == stamp[-4:-2] + '**',
           f"{m0} · 폰 {ph_hit} · {keys} · 검수 {rkeys} · {rb.get('_err')} · {r1c.get('code')} · 감사 {au}")

        if ADMIN_WEB:
            def steps(pg, seen):
                pg.fill('[data-admin-search-input]', f't1289mem{stamp}'); pg.wait_for_timeout(2500)
                seen['panel'] = pg.locator('[data-admin-search-result]').count()
                seen['members'] = pg.locator('[data-admin-search-section="members"] [data-admin-search-item]').count()
                pg.screenshot(path=os.path.join(HERE, 'v1289_search.png'))
                if seen['members']:
                    pg.locator('[data-admin-search-item="members"]').first.click(); pg.wait_for_timeout(1500)
                seen['hash'] = pg.evaluate('location.hash')
            seen, perr = pw_page('/#/home', steps)
            if seen is None:
                print('  (화면 · playwright 없음 — ③ 건너뜀)')
            else:
                ok('③ 화면 — 메뉴 줄 「전체 찾기」 적으면 결과 · 회원 줄 누르면 회원 화면 · 화면 오류 없음',
                   seen.get('panel') == 1 and seen.get('members') == 1 and str(seen.get('hash', '')).startswith('#/members') and not perr, f'{seen} · {perr[:2]}')
    finally:
        unstaff(REV, 'REVIEWER')
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
