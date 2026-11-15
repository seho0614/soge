"""v10.309 (docs/432) — 약관 「고치기」 빈칸 도우미 시험
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1309.py

  ① (코드) 빈칸 자리마다 · 〔시행일〕 뺌 · 누르면 그 자리 선택 · 게시 막힘 규칙 그대로 · 문서 432 · 판 v10.309
  ② (화면) 입점 약관 1.0 「고치기」 → 목록 수 = 본문 빈칸 자리 수 · 둘째 줄 → 칸 선택 · 치면 하나 줄어듦 · 「취소」 → 약관 표 그대로
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

TP, D432 = rd('web/src/app/admin/TermsPanel.tsx'), doc('432_')
ok('① 화면 — 빈칸 자리마다(〔시행일〕 뺌) 줄 · 앞뒤 글 · 누르면 칸에서 그 자리 선택 · 12곳 이하 펼침 · 게시 막힘 규칙 그대로 · 문서 432 · 판 v10.309',
   'function holeSpots(b: string)' in TP and "if (m[0] === '〔시행일〕') continue;" in TP and 'data-term-hole-list={occ.length}' in TP
   and 'data-term-hole-go={i}' in TP and 'ta.setSelectionRange(o.start, o.end)' in TP and 'open={occ.length <= 12}' in TP and 'ref={textRef}' in TP
   and "const holes = (b: string) => [...new Set(b.match(/〔[^〕]*〕/g) ?? [])].filter((m) => m !== '〔시행일〕');" in TP
   and '빈칸 자리' in D432 and VT >= (10, 309), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    before = psql(TERMS_MD5)
    body = psql("SELECT body FROM terms WHERE code = 'HLT_SELLER' AND version = '1.0'")   # 점검판 DB 에는 처리방침 1.1 이 없음(D207 이 시드 전에 돌아 건너뜀)
    spots = [m for m in re.finditer(r'〔[^〕]*〕', body) if m.group(0) != '〔시행일〕']
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    ok('② 입점 약관 1.0 본문에 빈칸 자리 2곳 이상(제17조 요율 〔 〕% 두 칸)', len(spots) >= 2, f'{len(spots)}곳')
    if ADMIN_WEB and sync_playwright and len(spots) >= 2:
        seen = {}
        try:
            with sync_playwright() as p:
                b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 1000})
                pg.on('dialog', lambda d: d.accept())
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                pg.goto(ADMIN_WEB + '/#/terms', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                row = pg.locator('[data-term-row="HLT_SELLER:1.0"]')
                seen['row'] = row.count()
                if row.count():
                    row.locator('[data-term-edit]').first.click(); pg.wait_for_timeout(800)
                    ed = pg.locator('[data-term-editor="HLT_SELLER:1.0"]')
                    hl = ed.locator('[data-term-hole-list]')
                    seen['n'] = hl.get_attribute('data-term-hole-list') if hl.count() else ''
                    if hl.count() and hl.get_attribute('open') is None:
                        hl.locator('summary').click(); pg.wait_for_timeout(300)
                    seen['items'] = ed.locator('[data-term-hole-go]').count()
                    ed.locator('[data-term-hole-go="1"]').click(); pg.wait_for_timeout(400)
                    sel = ed.locator('[data-term-text]').evaluate('t => [t.selectionStart, t.selectionEnd, t.value.slice(t.selectionStart, t.selectionEnd), document.activeElement === t]')
                    seen['sel'] = sel[:2]
                    seen['selText'] = sel[2]
                    seen['focus'] = sel[3]
                    pg.keyboard.type('시험1309')
                    pg.wait_for_timeout(400)
                    seen['n2'] = ed.locator('[data-term-hole-list]').get_attribute('data-term-hole-list') if ed.locator('[data-term-hole-list]').count() else '0'
                    ed.get_by_role('button', name='취소', exact=True).click(); pg.wait_for_timeout(400)
                b.close()
        except Exception as e:
            seen['err'] = str(e)[:200]
        after = psql(TERMS_MD5)
        ok('② 화면 — 입점 약관 1.0 「고치기」 → 빈칸 목록 = 본문 〔 〕 자리 수(같은 빈칸 두 곳도 따로) · 둘째 줄 누르면 칸 선택 = 그 빈칸 · 치면 목록 하나 줄어듦 · 「취소」 → 약관 표 그대로',
           seen.get('row') == 1 and seen.get('n') == str(len(spots)) and seen.get('items') == len(spots)
           and seen.get('sel') == [spots[1].start(), spots[1].end()] and seen.get('selText') == spots[1].group(0) and seen.get('focus') is True
           and seen.get('n2') == str(len(spots) - 1) and after == before, f'{seen} · 빈칸 {len(spots)} · 표 {before == after}')
    else:
        print(f'  (운영 화면 · playwright 없음 또는 빈칸 {len(spots)}곳 — ② 건너뜀)')
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
