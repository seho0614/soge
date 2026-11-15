"""v10.313 (docs/437) — 약관 「게시 준비」 한 장 시험
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1313.py

  ① (코드) publish-ready · 항목 · 게시 뒤 켤 것 · 읽기만 · 화면 단추 · 문서 437 · 판 v10.313
  ② (API) 입점 약관 1.0 — 빈칸 todo · 제17조 · 시행일 · 재동의 · 알림 · 입점 신청 · 게시 판 422 · 없는 판 404 · ADMIN 403
  ③ (화면) 「게시 준비」 열고 닫기
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

TS_, TC, TP, D437 = rd('src/modules/catalog/terms.service.ts'), rd('src/modules/catalog/terms.controller.ts'), rd('web/src/app/admin/TermsPanel.tsx'), doc('437_')
ok('① 서버 · 화면 — publish-ready(SUPER · publishPreview 재사용 · 빈칸 · 시행일 7 · 30일 · 재동의 · 알림 · 위탁 · AI · 제17조 · 게시 뒤 켤 것) · 읽기만 · 줄마다 「게시 준비」 · 명세 · 문서 437 · 판 v10.313',
   "@Get('terms/:code/publish-ready')" in TC and 'async publishReady(code: string, version: string)' in TS_ and 'const pv = await this.publishPreview(code, version);' in TS_
   and "key: 'holes'" in TS_ and "key: 'date'" in TS_ and "key: 'consent'" in TS_ and "key: 'notify'" in TS_ and "key: 'outsource'" in TS_ and "key: 'ai'" in TS_ and "key: 'rate'" in TS_
   and "주민등록번호(암호화)" in TS_[TS_.find('async publishReady'):TS_.find('/** v10.206 (docs/330) — 지금 쓰는 외부 서비스')]
   and 'UPDATE' not in TS_[TS_.find('async publishReady'):TS_.find('/** v10.206 (docs/330) — 지금 쓰는 외부 서비스')]
   and 'data-term-ready-btn' in TP and 'data-term-ready-item=' in TP and '"GET /admin/terms/{code}/publish-ready"' in rd('spec/screens.json')
   and '게시 준비' in D437 and VT >= (10, 313), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    stamp = str(int(time.time()))[-7:]
    ADM, _ = admin_account('1313', stamp)
    TS, TA = login('admin@x.com'), login(ADM)
    r = call('GET', '/admin/terms/HLT_SELLER/publish-ready?version=1.0', None, TS)
    it = {x.get('key'): x for x in r.get('items') or []}
    pub = psql("SELECT code || '|' || version FROM terms WHERE status = 'PUBLISHED' ORDER BY code LIMIT 1").split('|')
    r2 = call('GET', f'/admin/terms/{pub[0]}/publish-ready?version={pub[1]}', None, TS) if len(pub) == 2 else {'_err': 'none'}
    r3 = call('GET', '/admin/terms/HLT_SELLER/publish-ready?version=9.99', None, TS)
    r4 = call('GET', '/admin/terms/HLT_SELLER/publish-ready?version=1.0', None, TA)
    first = r.get('first')
    ok('② API 입점 약관 1.0 — 빈칸 todo(〔 〕) · 제17조 항목 · 시행일 · 재동의 · 알림 info · 게시 뒤 「소개몰 입점 신청 받기」 · ready false · 게시 판 422 · 없는 판 404 · ADMIN 403',
       it.get('holes', {}).get('state') == 'todo' and '〔 〕' in it.get('holes', {}).get('text', '') and 'rate' in it
       and it.get('date', {}).get('state') == 'info' and (('게시하는 순간 시행' in it.get('date', {}).get('text', '')) if first else ('7일' in it.get('date', {}).get('text', '')))
       and it.get('consent', {}).get('state') == 'info' and it.get('notify', {}).get('state') == 'info'
       and any('소개몰 입점 신청 받기' in a for a in r.get('after') or []) and r.get('ready') is False
       and r2.get('_err') == 422 and r3.get('_err') == 404 and r4.get('_err') == 403,
       f"{ {k: v.get('state') for k, v in it.items()} } · first {first} · after {r.get('after')} · {r2.get('_err')} {r3.get('_err')} {r4.get('_err')}")
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
                pg.goto(ADMIN_WEB + '/#/terms', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                row = pg.locator('[data-term-row="HLT_SELLER:1.0"]')
                row.locator('[data-term-ready-btn]').click(); pg.wait_for_timeout(1500)
                box = pg.locator('[data-term-ready]')
                seen['state'] = box.get_attribute('data-term-ready') if box.count() else ''
                seen['items'] = sorted(x.get_attribute('data-term-ready-item') for x in box.locator('[data-term-ready-item]').all()) if box.count() else []
                seen['after'] = box.locator('[data-term-ready-after]').count() if box.count() else 0
                row.locator('[data-term-ready-btn]').click(); pg.wait_for_timeout(400)
                seen['closed'] = pg.locator('[data-term-ready]').count()
                b.close()
        except Exception as e:
            seen['err'] = str(e)[:200]
        ok('③ 화면 — 입점 약관 1.0 「게시 준비」 → 한 장(todo) · 빈칸 「아직」 · 제17조 줄 · 게시 뒤 켤 것 · 다시 누르면 닫힘',
           seen.get('state') == 'todo' and 'holes:todo' in seen.get('items', []) and any(x.startswith('rate:') for x in seen.get('items', [])) and seen.get('after') == 1 and seen.get('closed') == 0, f'{seen}')
    else:
        print('  (운영 화면 · playwright 없음 — ③ 건너뜀)')
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
