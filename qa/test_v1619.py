"""v10.619 (docs/762) 시험 공통 도우미 · 시험 규칙 검사 — 새벽 회귀 실패 두 가지가 다시 생기지 않게
  ① (시험 코드) qa_helpers.py — kst_night(21 ~ 08시 · 경계) · drop_accounts_sql(딸린 권한 줄 3개를 accounts 보다 먼저)
  ② (시험 코드) replica 로 accounts 를 지우는 시험은 모두 perm_account_groups · account_roles 도 지움(perm_account_overrides 는 권장)
  ③ (시험 코드) 서버의 밤 막힘 코드(…_NIGHT 응답)를 받는 시험은 밤 갈래(night 변수)가 있음
  ④ (DB 가 있을 때) 주인 없는 권한 줄 0 — perm_account_groups · perm_account_overrides · account_roles 의 account_id 가 모두 accounts 에 있음
  ⑤ 문서 762 · 판
  (읽기만 — 두 번 돌아도 통과)
"""
import datetime, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import qa_helpers as H

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb' if os.path.isdir(KIT + '/sgb') else KIT
DB = os.environ.get('DB') or ''
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


# ── ① 도우미 ─────────────────────────────────────────────
T = datetime.datetime(2026, 11, 22, tzinfo=datetime.timezone.utc)
cases = {20: False, 21: True, 23: True, 0: True, 7: True, 8: False, 12: False}
bad = [h for h, want in cases.items() if H.kst_night(now=T.replace(hour=h)) != want]
ok('① kst_night — 21시부터 밤 · 08시부터 낮(경계 7개)', not bad, str(bad))
sql = H.drop_accounts_sql("email LIKE 't1619_%@x.com'")
pos = [sql.find(f'DELETE FROM {t} ') for t in H.ACCOUNT_CHILDREN] + [sql.find('DELETE FROM accounts ')]
ok('① drop_accounts_sql — replica · 딸린 권한 줄 3개를 accounts 보다 먼저', sql.startswith('SET session_replication_role = replica;') and all(p >= 0 for p in pos) and max(pos[:3]) < pos[3], sql[:90])

# ── ② · ③ 옛 시험 규칙 ─────────────────────────────────────
miss_rm, miss_night = [], []
for fn in sorted(os.listdir(HERE)):
    if not (fn.startswith('test_v') and fn.endswith('.py')) or fn == 'test_v1619.py':
        continue
    t = open(os.path.join(HERE, fn), encoding='utf-8').read()
    if re.search(r'session_replication_role\s*=\s*replica', t) and re.search(r'DELETE FROM accounts\b', t):
        if 'drop_accounts_sql' not in t and not ('perm_account_groups' in t and 'account_roles' in t):
            miss_rm.append(fn)
    if re.search(r"""['"][A-Z0-9]+_NIGHT['"]""", t) and re.search(r"get\('code'\)\s*==\s*['\"][A-Z0-9]+_NIGHT", t):
        if not re.search(r'\bnight\b', t.replace('_NIGHT', '')):
            miss_night.append(fn)
ok('② replica 로 accounts 를 지우는 시험은 권한 줄도 지움', not miss_rm, ' '.join(miss_rm[:8]))
ok('③ 서버 밤 막힘 코드를 받는 시험은 밤 갈래가 있음', not miss_night, ' '.join(miss_night[:8]))

# ── ④ DB ─────────────────────────────────────────────
if DB:
    def psql(q):
        r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', q], capture_output=True, text=True)
        return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()
    q = ' UNION ALL '.join(f"SELECT '{t}', count(*) FROM {t} x WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = x.account_id)" for t in H.ACCOUNT_CHILDREN)
    out = psql(q)
    rows = dict(l.split('|') for l in out.split('\n') if '|' in l)
    if out.startswith('!') and ('connection' in out or 'could not' in out):
        print('  (DB 에 닿지 않음 — ④ 건너뜀)')
    else:
      ok('④ 주인 없는 권한 줄 0(점검판 DB)', '!' not in out and rows and all(v == '0' for v in rows.values()), out.replace('\n', ' · ')[:160])
else:
    print('  (DB 없음 — ④ 건너뜀)')

# ── ⑤ ─────────────────────────────────────────────
d = doc('762_')
ok('⑤ 문서 762 — qa_helpers · kst_night · drop_accounts_sql', all(w in d for w in ('qa_helpers', 'kst_night', 'drop_accounts_sql')), str(len(d)))
VER = rd('VERSION').strip()
ok('⑤ VERSION v10.619 이상', tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 619), VER)

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
