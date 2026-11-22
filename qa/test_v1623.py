"""v10.623 (docs/766) 운영 화면 「?」 도움말에 옛 탭(v10.456 이전) 설명 — ADMIN_GUIDE 새 판 · 탭 → 절 잇기 · 본문 한도 ADMIN_GUIDE 4만(D305)
  ① (코드) TABS 모든 키가 ADMIN_GUIDE 절(D300 · D302 · D305)에 있음(빠짐 0) · D305 절 글 = 탭 머리글(PAGE sub) · 보는 역할 줄 · 한도 CHECK · 서버 MAX 40000 · SQL 모양 · 문서 766
  ② (DB) 지금 판 3판 이상 · 4만 자 안 · TABS 모든 키 · D305 잇기 · USER_MANUAL 은 2만 그대로(ROLLBACK 안 INSERT 막힘) · ADMIN_GUIDE 4만 1자 막힘
  ③ (API) 「?」 queue → LINK · 「검수 큐」 · 도움말 maxChars 40000
  (두 번 돌아도 통과 — 바꾸는 것은 모두 ROLLBACK)
"""
import json, os, re, socket, subprocess, sys, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
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


def psql_in(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()


def reachable(url):
    """닿지 않는 주소로 돌리면 ② · ③ 을 건너뜀(비운 값은 기본 주소로 가므로 쓰지 않음)"""
    try:
        u = urllib.parse.urlparse(url)
        with socket.create_connection((u.hostname, u.port or (443 if u.scheme == 'https' else 80)), timeout=3):
            return True
    except Exception:
        return False


def login(e):
    return call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')


VER = rd('VERSION').strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))
MD = os.path.join(K, 'prisma', 'migrations')
MIGS = {x: open(os.path.join(MD, x, 'migration.sql'), encoding='utf-8').read() for x in (sorted(os.listdir(MD)) if os.path.isdir(MD) else []) if os.path.exists(os.path.join(MD, x, 'migration.sql'))}
mig = lambda pre: next((t for n, t in MIGS.items() if n.startswith(pre)), '')
D300, D302, D305 = mig('D300_'), mig('D302_'), mig('D305_')
AM = rd('web/src/lib/adminMenu.ts')
APP = rd('web/src/App.tsx')
TH = rd('src/modules/sec2/tab-help.ts')
MAXV = re.findall(r'const MAX = (\d+);', TH)

seg = AM[AM.index('export const TABS'):AM.index('\n];', AM.index('export const TABS'))] if 'export const TABS' in AM else ''
TABS = list(dict.fromkeys(re.findall(r"\['([a-z0-9-]+)',\s*'[^']+'\]", seg)))
key_of = lambda t: set(re.findall(r'###[^\n]*\[([a-z][a-z0-9-]{1,39})\]', t)) | set(re.findall(r"\(\d+, '[^']*', '([a-z0-9-]+)', '", t))
K300, K302 = key_of(D300), key_of(D302)
ROWS = re.findall(r"^  \((\d+), '([^']*)', '([a-z0-9-]+)', '([^']*)', \$hdx\$(.*?)\$hdx\$\)", D305, re.M | re.S)
K305 = [r[2] for r in ROWS]
miss = [k for k in TABS if k not in (K300 | K302 | set(K305))]
ok('① 빠진 탭 0 — TABS 모든 키가 ADMIN_GUIDE 절(1판 D300 · 2판 D302 · 3판 D305)에 있음',
   len(TABS) >= 250 and not miss and len(ROWS) >= 100, f"TABS {len(TABS)} · D305 {len(ROWS)} · 빠짐 {miss[:8]}")
ok('① D305 절 — 키가 TABS 에 있음 · 겹침 없음 · 1 · 2판에 이미 있는 키는 안 넣음 · 제목 「이름 [키]」',
   all(k in TABS for k in K305) and len(set(K305)) == len(K305) and not (set(K305) & (K300 | K302))
   and all(r[3].endswith(f'[{r[2]}]') and len(r[3]) <= 120 for r in ROWS), f"{[k for k in K305 if k not in TABS][:5]} {sorted(set(K305) & (K300 | K302))[:5]}")


def page_sub(k):
    ov = re.findall(r"PAGE\['" + re.escape(k) + r"'\]\s*=\s*\{[^}]*?sub:\s*'([^']*)'", AM)
    ms = re.findall(r"^\s*'?" + re.escape(k) + r"'?\s*:\s*\{\s*title:\s*'([^']*)',\s*sub:\s*'([^']*)'", AM, re.M)
    return ov[-1] if ov else (ms[-1][1] if ms else None)


bad = [r[2] for r in ROWS if not (r[4].split('\n')[0] == '- ' + (page_sub(r[2]) or '\0').strip() and re.search(r'^- 보는 역할: .+\.$', r[4], re.M))]
ok('① D305 절 글 = 탭 머리글 설명(PAGE sub · 화면에 보이는 글) + 「보는 역할」 줄 · 묶음 16 이상', not bad and all(int(r[1].split('.')[0]) >= 16 for r in ROWS), f"{bad[:6]}")
so = re.findall(r"'([a-z0-9-]+)'", (re.search(r"const SUPER_ONLY = \[([^\]]*)\]", APP) or re.match('()', '')).group(1))
wrong = [r[2] for r in ROWS if r[2] in so and '보는 역할: SUPER 만.' not in r[4]]
ok('① 보는 역할 — SUPER 만 탭(SUPER_ONLY)은 「SUPER 만」 · 회계 지급 담당 탭은 세무사 읽기', not wrong and so
   and all('ACCOUNTANT(읽기)' in r[4] for r in ROWS if r[2] in ('acct-journal', 'acct-ledger')), f"{wrong[:5]}")
ok('① 한도 — help_docs_body_len(ADMIN_GUIDE 4만 · 그 밖 2만) · 서버 저장 MAX 40000 · USER_MANUAL 저장(help.service) 2만 그대로',
   'ADD CONSTRAINT help_docs_body_len' in D305 and "WHEN code = 'ADMIN_GUIDE' THEN 40000 ELSE 20000" in D305 and 'IF NOT EXISTS' in D305
   and re.search(r'const MAX = 40000;', TH) is not None, "MAX " + str(MAXV))
ok('① SQL 모양 — 쌓기만(새 판 INSERT · 붙일 절 없으면 안 만듦) · 4만 자 자리 · 잇기 ON CONFLICT · 주석 겹침 없음',
   'INSERT INTO public.help_docs (code, version, title, body, note)' in D305 and 'WHERE a.t IS NOT NULL' in D305 and '40000 - char_length' in D305
   and 'ON CONFLICT (tab_key) DO NOTHING' in D305 and 'UPDATE public.help_docs' not in D305 and 'DELETE FROM public.help_docs' not in D305 and '/*' not in D305)
D766 = doc('766_')
ok('① 문서 766 · 판 v10.623 이상 · 마이그레이션 D305 이상',
   'v10.623' in D766 and str(len(ROWS)) in D766 and VT >= (10, 623) and any(n.startswith('D305_') for n in MIGS), f"{VER} · migs {len(MIGS)}")

if API and DB and reachable(API):
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    q = urllib.parse.quote
    cur = psql("SELECT version || '|' || char_length(body) FROM v_help_doc_current WHERE code = 'ADMIN_GUIDE'")
    TK = "ARRAY[" + ', '.join("'" + k + "'" for k in TABS) + "]::text[]"
    RK = "ARRAY[" + ', '.join("'" + k + "'" for k in K305) + "]::text[]"
    has = psql(f"SELECT count(*) FROM unnest({TK}) k WHERE position('[' || k || ']' IN (SELECT body FROM v_help_doc_current WHERE code = 'ADMIN_GUIDE')) > 0")
    lk = psql(f"SELECT count(*) FROM sec2_tab_help WHERE doc_code = 'ADMIN_GUIDE' AND tab_key = ANY ({RK})")
    ok('② DB — 지금 판 3판 이상 · 4만 자 안 · TABS 모든 키 절 · D305 잇기 모두',
       '|' in cur and int(cur.split('|')[0]) >= 3 and int(cur.split('|')[1]) <= 40000 and has == str(len(TABS)) and lk == str(len(K305)), f"{cur} {has}/{len(TABS)} {lk}/{len(K305)}")
    um = psql_in("BEGIN;\nINSERT INTO help_docs (code, version, title, body) VALUES ('USER_MANUAL', 999999, '시험1623', repeat('가', 20001));\nROLLBACK;\n")
    ag = psql_in("BEGIN;\nINSERT INTO help_docs (code, version, title, body) VALUES ('ADMIN_GUIDE', 999999, '시험1623', repeat('가', 40001));\nROLLBACK;\n")
    ag2 = psql_in("BEGIN;\nINSERT INTO help_docs (code, version, title, body) VALUES ('ADMIN_GUIDE', 999999, '시험1623', '### 시험 [zz-1623]\n' || repeat('가', 30000));\nSELECT 'ok1623';\nROLLBACK;\n")
    ok('② 한도 — USER_MANUAL 2만 1자 · ADMIN_GUIDE 4만 1자는 CHECK 가 막음 · ADMIN_GUIDE 3만 자는 들어감(모두 ROLLBACK)',
       'help_docs_body_len' in um and 'help_docs_body_len' in ag and 'ok1623' in ag2, f"{um[-90:]} | {ag[-90:]} | {ag2[-60:]}")
    h1 = call('GET', f"/admin/help/tab?key=queue&label={q('검수 큐')}", None, TS)
    g = call('GET', '/admin/help/guide', None, TS)
    gk = {s.get('key') for s in ((g.get('current') or {}).get('sections') or [])}
    ok('③ API — 「?」 queue 는 잇기(LINK)로 「검수 큐」 · 도움말 maxChars 40000 · 목차에 D305 키 모두',
       h1.get('found') is True and h1.get('via') == 'LINK' and (h1.get('section') or {}).get('heading') == '검수 큐'
       and g.get('maxChars') == 40000 and all(k in gk for k in K305), f"{h1.get('via')} {(h1.get('section') or {}).get('heading')} {g.get('maxChars')} {len(gk)}")
else:
    print('  (API · DB 없음 또는 닿지 않음 — ② · ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
