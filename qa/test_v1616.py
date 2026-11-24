"""v10.616 (docs/758) 운영 화면 「?」 도움말에 v10.457 ~ 614 새 탭 설명 — ADMIN_GUIDE 새 판 · 탭 → 절 잇기(SQL hdx_) · docs/700 부록 B
  ① (코드) 새 탭(adminMenu.ts TABS 주석 판 ≥ v10.457) 모두 절 있음 · [탭 키] · 2만 자 안 · 절마다 무엇 · 스위치 키가 실제 설정 · SQL 모양(쌓기만 · 다시 돌려도 같음) · 문서 758 · 700 부록 B(10개 이하 · ① ~ ⑥) · 판
  ② (DB · API) 지금 판에 절 모두 · 잇기 · 같은 SQL 다시 돌려도 판 · 잇기 그대로(ROLLBACK 안에서) · 「?」 LINK 로 찾음 · 옛 탭(home)은 KEY 그대로
  ③ (화면) 매물 가격 제안 탭 「?」 → 절 「매물 가격 제안」
  (두 번 돌아도 통과 — 공유 데이터를 남기지 않음 · 다시 돌리기는 ROLLBACK)
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB = os.environ.get('ADMIN_WEB')
SITE = os.environ.get('SITE')
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




def login(e):
    return call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')

def ui(fn):
    """playwright 가 있으면 브라우저 하나로 fn(b, seen, perr) · 없으면 None"""
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return None
    seen, perr = {}, []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            fn(b, seen, perr)
            b.close()
    except Exception as ex:
        perr.append(str(ex)[:160])
    return seen, perr


def site_login(b, perr, email):
    ps = b.new_page(viewport={'width': 1280, 'height': 900}); ps.on('pageerror', lambda e: perr.append(str(e)[:120]))
    ps.goto(SITE + '/login', wait_until='networkidle', timeout=120000)
    ps.fill('input[name=email]', email); ps.fill('input[name=password]', PW); ps.click('form.auth button'); ps.wait_for_timeout(2500)
    return ps

SJ = rd('spec/screens.json')

import base64
def jwt_life(tok):
    try:
        p = tok.split(".")[1]; p += "=" * (-len(p) % 4)
        j = json.loads(base64.urlsafe_b64decode(p)); return int(j["exp"]) - int(j["iat"])
    except Exception:
        return None
def login_full(e, pw=PW):
    return call("POST", "/auth/login", {"email": e, "password": pw})
def mk_staff(tag, role="ADMIN"):
    stamp = int(time.time()) % 100000
    em = f"t{tag}s{stamp}@x.com"
    h = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{em}', '시험{tag}', '{h}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{em}'")
    if role:
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag}', true); INSERT INTO account_roles (account_id, role) VALUES ('{aid}', '{role}') ON CONFLICT DO NOTHING; COMMIT;")
    return em, aid
def rm_role(aid, tag):
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag} 지움', true); DELETE FROM account_roles WHERE account_id = '{aid}' AND role <> 'MEMBER'; COMMIT;")




def admin_page(path, fn):
    def run(b, seen, perr):
        pg = b.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: perr.append(str(e)[:120]))
        pg.goto(ADMIN_WEB + "/", wait_until="networkidle", timeout=120000)
        pg.fill("input[name=email]", "admin@x.com"); pg.fill("input[name=password]", PW); pg.click("button[type=submit]"); pg.wait_for_timeout(3000)
        pg.goto(ADMIN_WEB + path, wait_until="networkidle", timeout=120000); pg.wait_for_timeout(3000)
        fn(pg, seen)
    return ui(run)


"""시험 몸통 — v10.616 운영 화면 도움말 새 탭 설명"""
import socket


def migs_all():
    d = os.path.join(K, 'prisma', 'migrations')
    if not os.path.isdir(d):
        return {}
    return {x: open(os.path.join(d, x, 'migration.sql'), encoding='utf-8').read() for x in sorted(os.listdir(d)) if os.path.exists(os.path.join(d, x, 'migration.sql'))}


def sections(body):
    """HelpService.sections 와 같은 규칙 — ### 제목마다 한 절 · ## 이 나오면 끊음"""
    out, cur = [], None
    for line in body.split('\n'):
        m = re.match(r'^###\s+(.+?)\s*$', line)
        if m:
            cur = {'heading': m.group(1), 'text': ''}; out.append(cur); continue
        if re.match(r'^##\s', line):
            cur = None; continue
        if cur is not None:
            cur['text'] += line + '\n'
    for s in out:
        s['text'] = s['text'].strip()
    return out


def new_tabs(am):
    """adminMenu.ts TABS 줄 주석의 첫 판 번호가 v10.457 이상인 탭"""
    if 'export const TABS' not in am:
        return []
    part = am[am.index('export const TABS'):am.index('] as const;')]
    out = []
    for line in part.split('\n'):
        m = re.search(r'v10\.(\d+)', line.split('/*', 1)[1] if '/*' in line else (line.split('//', 1)[1] if '//' in line else ''))
        if m and int(m.group(1)) >= 457:
            out += re.findall(r"\['([a-z0-9-]+)',\s*'[^']*'\]", line)
    return out


def psql_in(sql):
    """여러 문장을 표준 입력으로(문장마다 결과 줄)"""
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()


def reachable(url):
    """주소가 닿는지(닿지 않는 주소로 돌리면 ② 를 건너뜀 — 비운 값은 기본 주소로 가므로 쓰지 않음)"""
    try:
        u = urllib.parse.urlparse(url)
        with socket.create_connection((u.hostname, u.port or (443 if u.scheme == 'https' else 80)), timeout=3):
            return True
    except Exception:
        return False


MIGS = migs_all()
HDX_NAME = next((n for n, t in MIGS.items() if 'hdx_ · v10.616' in t), '')
HDX = MIGS.get(HDX_NAME, '')
D300 = next((t for n, t in MIGS.items() if n.startswith('D300_')), '')
V1 = (re.search(r"\$guide\$(.*?)\$guide\$", D300, re.S) or [None, ''])[1] if D300 else ''
ROWS = re.findall(r"\((\d+), '([^']*)', '([a-z][a-z0-9-]{1,39})', '([^']*)', \$hdx\$(.*?)\$hdx\$\)", HDX, re.S)
AM = rd('web/src/lib/adminMenu.ts')
NEW = new_tabs(AM)
ALL_TABS = re.findall(r"\['([a-z0-9-]+)',\s*'[^']*'\]", AM[AM.index('export const TABS'):AM.index('] as const;')]) if 'export const TABS' in AM else []
SETTING_KEYS = set(re.findall(r"\(\s*'([a-z][a-z0-9_]*\.[a-z0-9_.]+)',\s*'", '\n'.join(MIGS.values())))
TOK = re.compile(r'(?<![\w./])([a-z][a-z0-9]*\.[a-z][a-z0-9_]*)(?![\w.]*[\w])')

# SQL 과 같은 식으로 새 판 본문을 만들어 봄(1판 그대로일 때)
groups = []
for r in ROWS:
    if r[1] not in groups:
        groups.append(r[1])
ADD = '\n\n'.join('## ' + g + '\n\n' + '\n\n'.join('### ' + r[3] + '\n' + r[4] for r in ROWS if r[1] == g) for g in groups)
BODY = V1.rstrip('\n') + '\n\n' + ADD + '\n' if V1 and ROWS else ''
SECS = sections(BODY)
KEYED = {}
for s in SECS:
    m = re.search(r'\[([a-z][a-z0-9-]{1,39})\]$', s['heading'])
    if m and m.group(1) not in KEYED:
        KEYED[m.group(1)] = s
# v10.700 (docs/808) 1판(D300) · 2판(이 SQL) 뒤 새 탭은 그 판의 hdx 절(D305 다음 마이그레이션 · 「[탭 키]', $hdx$」)로 들어감
LATER = {k for n, t in MIGS.items() if n > 'D305' and n[:1] == 'D' and '$hdx$' in t for k in re.findall(r"'([a-z][a-z0-9-]{1,39})', '[^']*\[\1\]', \$hdx\$", t)}
missing = [k for k in NEW if k not in KEYED and k not in LATER]
typo = [r[2] for r in ROWS if r[2] not in ALL_TABS]
dup = [k for k in [r[2] for r in ROWS] if [r[2] for r in ROWS].count(k) > 1]
in_v1 = [r[2] for r in ROWS if '[' + r[2] + ']' in V1]
bad_tok = sorted({t for r in ROWS for t in TOK.findall(r[4]) if t not in SETTING_KEYS})
short = [r[2] for r in ROWS if len(r[4]) < 30 or not r[4].startswith('- ')]

ok('① 코드 — 새 탭(TABS 주석 판 ≥ v10.457) 모두 절 · 절 키는 TABS 에 있음 · 겹침 없음 · 1판 절과 겹치지 않음',
   len(NEW) >= 120 and len(ROWS) >= 120 and not missing and not typo and not dup and not in_v1,
   f"새 탭 {len(NEW)} · 절 {len(ROWS)} · 빠짐 {missing[:5]} · 없는 키 {typo[:5]} · 겹침 {dup[:3]} · 1판과 겹침 {in_v1[:3]}")
ok('① 본문 — 2만 자 안(help_docs CHECK · 서버 저장 한도) · 절 모두 읽힘(HelpService.sections) · 1판 절 제목 그대로 · 절마다 한 줄 이상',
   0 < len(BODY) <= 20000 and len(SECS) == len(sections(V1)) + len(ROWS) and all(s['heading'] in [x['heading'] for x in SECS] for s in sections(V1)) and not short
   and all(KEYED[r[2]]['text'] == r[4].strip() for r in ROWS),
   f"{len(BODY)}자 · 절 {len(SECS)} · 짧음 {short[:3]}")
ok('① 본문 — 절에 적은 설정 키(xxx.yyy)가 모두 마이그레이션 site_settings 에 있음',
   len(SETTING_KEYS) > 300 and not bad_tok, f"없는 키 {bad_tok[:8]}")
ok('① SQL — hdx_ 머리 · ADMIN_GUIDE 새 판(INSERT 만 · 고치기 · 지우기 없음) · [탭 키] 있는 절 건너뜀 · 2만 자 자리 · 잇기 ON CONFLICT DO NOTHING · RAISE 없음 · D300 뒤',
   HDX_NAME > 'D300' and "INSERT INTO public.help_docs (code, version, title, body, note)" in HDX and "position('[' || a.tab_key || ']' IN c.body) = 0" in HDX
   and '20000 - char_length' in HDX and 'ON CONFLICT (tab_key) DO NOTHING' in HDX and 'WHERE a.t IS NOT NULL' in HDX
   and not re.search(r'\b(UPDATE|DELETE\s+FROM|TRUNCATE|DROP)\b', HDX.replace('--', '\n--')) and 'RAISE' not in HDX,
   HDX_NAME)
D758, D700 = doc('758_'), doc('700_')
BLK = re.split(r'\n### B-\d+\.', D700.split('## 부록 B.', 1)[1]) if '## 부록 B.' in D700 else []
ok('① 문서 — 758(v10.616 · 절 수 · 빠진 탭) · 700 부록 A 그대로 + 부록 B(2차 · 10개 이하 · 블록마다 ① ~ ⑥ · 뺀 것 표) · 판 v10.616',
   'v10.616' in D758 and str(len(ROWS)) in D758 and '## 부록 A. 1차 켜기 블록' in D700 and '### A-6.' in D700 and 1 <= len(BLK) - 1 <= 10
   and all(all(c in b for c in '①②③④⑤⑥') for b in BLK[1:]) and '2차에서 뺀 것' in D700
   and not sorted({t for t in re.findall(r'`([a-z][a-z0-9]*\.[a-z][a-z0-9_]*)`', D700.split('## 부록 B.', 1)[-1]) if t not in SETTING_KEYS})
   and VT >= (10, 616), f"{VER} · B {len(BLK) - 1}")

if API and DB and reachable(API):
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    q = urllib.parse.quote
    KEYS = "ARRAY[" + ', '.join("'" + r[2] + "'" for r in ROWS) + "]::text[]"
    cur = psql("SELECT version || '|' || char_length(body) FROM v_help_doc_current WHERE code = 'ADMIN_GUIDE'")
    has = psql(f"SELECT count(*) FROM unnest({KEYS}) k WHERE position('[' || k || ']' IN (SELECT body FROM v_help_doc_current WHERE code = 'ADMIN_GUIDE')) > 0")
    lk = psql(f"SELECT count(*) FROM sec2_tab_help WHERE doc_code = 'ADMIN_GUIDE' AND tab_key = ANY ({KEYS})")
    ok('② DB — 지움 없이 새 판(2판 이상 · 2만 자 안 — v10.623 부터 ADMIN_GUIDE 4만) · 새 탭 절 모두 · 탭 → 절 잇기 모두',
       '|' in cur and int(cur.split('|')[0]) >= 2 and int(cur.split('|')[1]) <= (40000 if VT >= (10, 623) else 20000) and has == str(len(ROWS)) and lk == str(len(ROWS)), f"{cur} {has} {lk}")
    again = psql_in("BEGIN;\nSELECT max(version) || '|' || (SELECT count(*) FROM sec2_tab_help) FROM help_docs WHERE code = 'ADMIN_GUIDE';\n"
                    + HDX + "\nSELECT max(version) || '|' || (SELECT count(*) FROM sec2_tab_help) FROM help_docs WHERE code = 'ADMIN_GUIDE';\nROLLBACK;\n")
    ln = [x for x in again.split('\n') if re.match(r'^\d+\|\d+$', x)]
    ok('② 다시 돌리기 — 같은 SQL 을 한 번 더(ROLLBACK 안) 돌려도 판 · 잇기 수 그대로', len(ln) == 2 and ln[0] == ln[1] and '!' not in again, again[-160:])
    h1 = call('GET', f"/admin/help/tab?key=lpx-offers&label={q('매물 가격 제안')}", None, TS)
    h2 = call('GET', f"/admin/help/tab?key=perm-log&label={q('바뀐 기록')}", None, TS)
    h3 = call('GET', f"/admin/help/tab?key=home&label={q('운영 대시보드')}", None, TS)
    g = call('GET', '/admin/help/guide', None, TS)
    gk = {s.get('key') for s in ((g.get('current') or {}).get('sections') or [])}
    ok('② API — 「?」 새 탭은 잇기(LINK)로 절 · 제목에서 [탭 키] 뺌 · 옛 탭(home)은 KEY 그대로 · 도움말 목차에 새 탭 키 모두',
       h1.get('found') is True and h1.get('via') == 'LINK' and (h1.get('section') or {}).get('heading') == '매물 가격 제안' and 'lpx.offer' in ((h1.get('section') or {}).get('text') or '')
       and h2.get('found') is True and (h2.get('section') or {}).get('heading') == '바뀐 기록' and h3.get('via') == 'KEY'
       and all(r[2] in gk for r in ROWS), f"{h1.get('via')} {(h1.get('section') or {}).get('heading')} {h2.get('via')} {h3.get('via')} {len(gk)}")
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.click('[data-help-tip]'); pg.wait_for_timeout(2500)
            seen['h'] = pg.locator('[data-help-heading]').first.inner_text() if pg.locator('[data-help-heading]').count() else ''
        u = admin_page('/#/lpx-offers', chk)
        if u is not None:
            seen, perr = u
            ok('③ 화면 — 검수 › 매물 가격 제안 제목 옆 「?」 → 절 「매물 가격 제안」', seen.get('h') == '매물 가격 제안' and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 또는 닿지 않음 — ② · ③ 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
