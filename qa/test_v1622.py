"""v10.622 (docs/765) 사용자 설명서에 v10.559 ~ 617 회원 기능 절 — USER_MANUAL 새 판(SQL D304)
  ① (코드) D304 모양(쌓기만 · 지금 판 끝에 붙임 · 같은 제목 건너뜀 · 2만 자) · 절 15개 · 제목 겹침 없음 · 1판과 겹치지 않음 · 2만 자 안 ·
     처음 꺼진 기능만 「(운영에서 켠 뒤 보입니다)」 · 따옴표 화면 이름은 사용자 웹 소스에 있음 · 주소는 사용자 웹 화면 · docs/765
  ② (DB · API) 지금 판에 절 15개 · 같은 SQL 을 다시 돌려도(ROLLBACK 안) 판 그대로 · 공개 GET /site/manual 절 목차에 보임
  (두 번 돌아도 통과 — 공유 데이터를 남기지 않음 · 다시 돌리기는 ROLLBACK)
"""
import json, os, re, socket, subprocess, sys, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
RES = []


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
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=120).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code')}
    except Exception as e:
        return {'_err': str(e)[:80]}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()


def psql_in(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()


def reachable(url):
    """주소가 닿는지(닿지 않는 주소로 돌리면 ② 를 건너뜀)"""
    try:
        u = urllib.parse.urlparse(url)
        with socket.create_connection((u.hostname, u.port or (443 if u.scheme == 'https' else 80)), timeout=3):
            return True
    except Exception:
        return False


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
    return out


def site_text():
    """사용자 웹 소스(site/src) + 서버가 회원에게 돌려주는 글(src · 오류 문구)"""
    buf = []
    for dp, _, fs in [w for root in (os.path.join(K, 'site', 'src'), os.path.join(K, 'src')) for w in os.walk(root)]:
        for f in fs:
            if f.endswith(('.ts', '.tsx', '.json')):
                try:
                    buf.append(open(os.path.join(dp, f), encoding='utf-8').read())
                except Exception:
                    pass
    return '\n'.join(buf)


MIGS = migs_all()
NAME = next((n for n in MIGS if n.startswith('D304_')), '')
SQL = MIGS.get(NAME, '')
D180 = next((t for n, t in MIGS.items() if n.startswith('D180_')), '')
V1 = (re.search(r"\$manual\$(.*?)\$manual\$", D180, re.S) or [None, ''])[1] if D180 else ''
ROWS = re.findall(r"\((\d+), '([^']*)', \$um\$(.*?)\$um\$\)", SQL, re.S)
GRP = '## 10. 새로 생긴 기능(2026-11)'
BODY = (V1.rstrip('\n') + '\n\n---\n\n' + GRP + '\n\n' + '\n\n'.join('### ' + h + '\n' + b for _, h, b in ROWS) + '\n') if V1 and ROWS else ''
SECS = sections(BODY)
ALLSQL = '\n'.join(MIGS.values())
SETTING = dict(re.findall(r"\(\s*'([a-z][a-z0-9_]*\.[a-z0-9_.]+)',\s*'([^']*)'", ALLSQL))
OFF = '(운영에서 켠 뒤 보입니다)'
# 절 번호 → 그 기능 스위치(없으면 늘 보임)
SW = {1: 'grw.first_steps', 2: 'grw.fill_helper', 3: None, 4: 'sec2.member_mfa', 5: 'sec2.pwned_check', 6: 'mtr.dormant', 7: 'mtr.appeal',
      8: 'grw.digest', 9: 'lsq.bulk', 10: 'lsq.review_ask', 11: 'bzx.inquiry_photos', 12: 'lsq.return_photos', 13: 'lsq.track', 14: 'lsq.sub_retry', 15: None}

heads = [h for _, h, _ in ROWS]
v1_heads = [s['heading'] for s in sections(V1)]
ok('① 코드 — D304 있음 · USER_MANUAL 새 판만 더함(max+1 · 지금 판 끝에 붙임) · 같은 「### 제목」 건너뜀 · 2만 자 자리 셈 · 고치기 · 지우기 없음',
   NAME and 'v10.622' in SQL and "'USER_MANUAL'" in SQL and 'max(version) + 1' in SQL and "position('### ' || a.heading IN c.body) = 0" in SQL
   and '20000' in SQL and 'v_help_doc_current' in SQL and not re.search(r'(?i)\b(UPDATE|DELETE\s+FROM)\s+public\.help_docs', SQL)
   and not re.search(r'\{\d*,\s*(2[6-9]\d|[3-9]\d\d)\}', SQL), f'{NAME} · {len(SQL)}자')
ok('① 절 15개(10-1 ~ 10-15) · 제목 겹침 없음 · 1판 제목과 겹치지 않음 · 절마다 「- 」로 시작 · 30자 넘음',
   len(ROWS) == 15 and [int(re.match(r'10-(\d+)\.', h).group(1)) if re.match(r'10-(\d+)\.', h) else 0 for h in heads] == list(range(1, 16))
   and len(set(heads)) == 15 and not [h for h in heads if h in v1_heads] and all(b.startswith('- ') and len(b) > 30 for _, _, b in ROWS),
   f'{len(ROWS)} · {heads[:2]}')
ok('① 1판 그대로일 때 새 판 본문 2만 자 안(help_docs CHECK) · 절 목차에 15개 모두 · 1판 절 그대로 앞에',
   V1 and 15000 < len(BODY) <= 20000 and len(SECS) == len(v1_heads) + 15 and [s['heading'] for s in SECS[:len(v1_heads)]] == v1_heads,
   f'1판 {len(V1)} → {len(BODY)}자 · 절 {len(v1_heads)} → {len(SECS)}')
bad_off = []
for o, h, b in ROWS:
    k = SW.get(int(o))
    want = bool(k) and SETTING.get(k) == 'off'
    if (OFF in b) != want or (k and k not in SETTING):
        bad_off.append((o, k, SETTING.get(k)))
ok('① 처음 꺼진 기능 절에만 「(운영에서 켠 뒤 보입니다)」 — 스위치 처음 값(마이그레이션)과 같음 · 켜진 채 나간 것(첫 거래 · 등록 도우미)엔 없음',
   ROWS and not bad_off, f'{bad_off}')
ST = site_text()
quotes = [q for _, _, b in ROWS for q in re.findall(r'「([^」]+)」', b) if q != OFF.strip('()')]
miss_q = sorted({p for q in quotes for p in [x.strip() for x in q.split('›')] if p and p not in ST and p not in V1})
ok('① 따옴표 「」 화면 이름 · 안내 글은 사용자 웹 소스(site/src) · 서버 문구(src) 또는 1판 설명서에 있는 글자만(지어낸 단추 이름 없음)',
   quotes and not miss_q, f'{len(quotes)}개 · 없음 {miss_q[:8]}')
paths = sorted({p for h, b in [(h, b) for _, h, b in ROWS] for p in re.findall(r'`(/(?:my|support|partner)[^`]*)`', h + '\n' + b)})


def route_ok(p):
    parts = [x for x in p.split('/') if x]
    d = os.path.join(K, 'site', 'src', 'app')
    for x in parts:
        if x.startswith('{'):
            cand = [y for y in (os.listdir(d) if os.path.isdir(d) else []) if y.startswith('[')]
            if not cand:
                return False
            d = os.path.join(d, cand[0])
        else:
            d = os.path.join(d, x)
    return os.path.exists(os.path.join(d, 'page.tsx'))


bad_p = [p for p in paths if not route_ok(p)]
ok('① 절의 주소 `/my/…` · `/support/…` · `/partner/…` 는 사용자 웹에 실제 화면(page.tsx)',
   len(paths) >= 10 and not bad_p, f'{len(paths)}개 · 없음 {bad_p}')
D765 = doc('765_')
ok('① docs/765 — D304 · v10.622 · 되돌리기 · 운영 적용 · 절 15개 표',
   D765 and 'D304' in D765 and 'v10.622' in D765 and '되돌리기' in D765 and '운영 적용' in D765 and all(h.split(' ')[0] in D765 for h in heads),
   f'{len(D765)}자')
ok('VERSION v10.622 이상 · 마이그레이션 342개 이상 · D304 포함', VT >= (10, 622) and len(MIGS) >= 342 and NAME, f'{VER} · {len(MIGS)}')

if API and DB and reachable(API) and reachable(DB.replace('postgresql://', 'http://')):
    cur = psql("SELECT version || '|' || char_length(body) FROM v_help_doc_current WHERE code = 'USER_MANUAL'")
    body = psql("SELECT body FROM v_help_doc_current WHERE code = 'USER_MANUAL'")
    have = [h for h in heads if '### ' + h in body]
    ok('② 지금 판 USER_MANUAL 에 절 15개 모두(D304 적용 · 2만 자 안)', len(have) == 15 and '!' not in cur, f'{cur} · {len(have)}/15')
    again = psql_in("BEGIN;\nSELECT max(version) FROM help_docs WHERE code = 'USER_MANUAL';\n" + SQL
                    + "\nSELECT max(version) FROM help_docs WHERE code = 'USER_MANUAL';\nROLLBACK;\n")
    ln = [x for x in again.split('\n') if x.strip().isdigit()]
    ok('② 다시 돌리기 — 같은 SQL 을 한 번 더(ROLLBACK 안) 돌려도 판 그대로', len(ln) == 2 and ln[0] == ln[1] and '!' not in again, again[-160:])
    pub = call('GET', '/site/manual')
    ph = [s.get('heading', '') for s in (pub.get('sections') or [])]
    ok('② 공개 GET /site/manual — 절 목차에 「10-1. 첫 거래 안내 카드」 ~ 「10-15. 파트너센터 하위 메뉴」',
       all(any(x.startswith(h.split(' (')[0]) for x in ph) for h in heads), f"{pub.get('version')} · 절 {len(ph)} · {pub.get('_err', '')}")
else:
    print('  (API · DB 에 닿지 않아 ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
