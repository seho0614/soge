"""v10.307 (docs/430) — 약관 초안 「개발 원문으로 채우기」 시험
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1307.py

  ① (코드) 단추 · 확인 창 · 칸만 채움(저장 없음) · 「채웠습니다」 · 「채우기 되돌리기」 · 문서 430 · 판 v10.307
  ② (화면) 관 관리 › 「약관」 › HLT_SELLER 1.0 「고치기」 → 한 줄 고침 → 채우기 → 칸 = 원문 → 되돌리기 → 「취소」 → 약관 표 md5 그대로
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

TP, D430 = rd('web/src/app/admin/TermsPanel.tsx'), doc('430_')
FS = TP[TP.find('async function fillSource(e: Edit)'):TP.find('function goHole(')]
ok('① 화면 — 「개발 원문으로 채우기」(원문 있는 판 · 칸이 원문과 같으면 안 보임) · 확인 창 · 칸만 채움(저장 PUT 없음) · 비교 기준 orig · 「채웠습니다」 · 「채우기 되돌리기」 · 문서 430 · 판 v10.307',
   'data-term-src-fill' in TP and 'hasSrc && !(ed.src && ed.body === ed.src.body)' in TP and 'window.confirm(' in FS and "method: 'PUT'" not in FS
   and "body: src.body, filled: true, diff: true, base: 'orig'" in FS and 'data-term-src-filled' in TP and "setEd({ ...ed, body: ed.orig, filled: false })" in TP
   and '저장(게시 아님)' in D430 and VT >= (10, 307), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    before = psql(TERMS_MD5)
    src = call('GET', '/admin/terms/HLT_SELLER/source?version=1.0', None, TS).get('body') or ''
    dbbody = psql("SELECT body FROM terms WHERE code = 'HLT_SELLER' AND version = '1.0'")
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if ADMIN_WEB and sync_playwright:
        seen = {}
        try:
            with sync_playwright() as p:
                b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 1000})
                dialogs = []
                pg.on('dialog', lambda d: (dialogs.append(d.message[:30]), d.accept()))
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                pg.goto(ADMIN_WEB + '/#/terms', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                row = pg.locator('[data-term-row="HLT_SELLER:1.0"]')
                seen['row'] = row.count()
                if row.count():
                    row.locator('[data-term-edit]').first.click(); pg.wait_for_timeout(800)
                    ed = pg.locator('[data-term-editor="HLT_SELLER:1.0"]')
                    tx = ed.locator('[data-term-text]')
                    first = tx.input_value()
                    tx.fill(first + '\n시험 1307 한 줄'); pg.wait_for_timeout(400)
                    seen['fillBtn'] = ed.locator('[data-term-src-fill]').count()
                    ed.locator('[data-term-src-fill]').click(); pg.wait_for_timeout(1500)
                    seen['isSrc'] = tx.input_value().strip() == src.strip() and len(src) > 1000
                    seen['filled'] = ed.locator('[data-term-src-filled]').count()
                    seen['base'] = ed.locator('[data-term-diff]').get_attribute('data-term-diff-base') if ed.locator('[data-term-diff]').count() else ''
                    seen['fillGone'] = ed.locator('[data-term-src-fill]').count()
                    seen['dlg'] = len(dialogs)
                    ed.locator('[data-term-src-undo]').click(); pg.wait_for_timeout(500)
                    seen['undo'] = tx.input_value() == first and first.strip() == dbbody.strip()
                    seen['filled2'] = ed.locator('[data-term-src-filled]').count()
                    ed.get_by_role('button', name='취소', exact=True).click(); pg.wait_for_timeout(500)
                    seen['closed'] = pg.locator('[data-term-editor="HLT_SELLER:1.0"]').count()
                b.close()
        except Exception as e:
            seen['err'] = str(e)[:200]
        after = psql(TERMS_MD5)
        ok('② 화면 — 1.0 「고치기」 → 한 줄 고친 뒤 「개발 원문으로 채우기」(확인 창) → 칸 = 원문(docs/400) · 「채웠습니다」 · 비교 기준 orig · 단추 사라짐 → 「채우기 되돌리기」 → 처음 글 → 「취소」 → 약관 표 그대로',
           seen.get('row') == 1 and seen.get('fillBtn') == 1 and seen.get('isSrc') is True and seen.get('filled') == 1 and seen.get('base') == 'orig'
           and seen.get('fillGone') == 0 and seen.get('dlg') == 1 and seen.get('undo') is True and seen.get('filled2') == 0 and seen.get('closed') == 0
           and after == before and before and not before.startswith('!'), f'{seen} · 표 {before == after}')
    else:
        print('  (운영 화면 · playwright 없음 — ② 건너뜀)')
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
