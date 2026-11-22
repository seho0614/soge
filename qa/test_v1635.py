"""v10.635 (docs/779) 회귀 안전장치 — 빠지는 시험 없음 · 같은 먼 해를 쓰는 시험은 동시에 안 돎
  ① 회귀 대상은 판 번호 1090 이상 모든 test_v<번호>*.py(이름 규칙 구멍 · v2xxx 도) · 지금 qa 폴더의 그런 파일 = 회귀 판정 줄 수 · HOST 목록 파일이 모두 있음
  ② 먼 해 찾기 — YR = 2096 · '2099-03-01' 은 잡고 2026-11 · 2049 는 안 잡음 · 같은 해를 쓰는 시험 둘은 잠금 year:NNNN 이 같음(동시에 안 돎)
  ③ test_v1420 · test_v1421 은 늘 혼자 · 문서 779 · 판
  (파일만 읽음 · 임시 폴더는 스스로 지움 — 두 번 돌아도 통과)
"""
import os, re, sys, tempfile, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb' if os.path.isdir(KIT + '/sgb') else KIT
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(p):
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


VER = rd(os.path.join(K, 'VERSION')).strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))
try:
    import reg_classify as RC
except Exception as e:
    RC = None
    print('reg_classify 못 읽음', e)

# ── ① 빠지는 시험 없음 ─────────────────────────────────
files = sorted(x for x in os.listdir(HERE) if (m := re.match(r'^test_v(\d{4,})\S*\.py$', x)) and int(m.group(1)) >= 1090)
rows = RC.classify(HERE, K) if RC else []
got = sorted(r[0] for r in rows)
ok('① 회귀 대상 = 판 번호 1090 이상 모든 시험(이름 규칙 아님)', RC is not None and hasattr(RC, 'is_reg_test') and got == files and len(files) > 500,
   f'{len(got)} / {len(files)} · 빠짐 {sorted(set(files) - set(got))[:5]}')
ok('① is_reg_test — test_v1600 · test_v2001_x 잡음 · test_v1089 · test_x 안 잡음',
   RC is not None and RC.is_reg_test('test_v1600.py') and RC.is_reg_test('test_v2001_x.py') and not RC.is_reg_test('test_v1089.py') and not RC.is_reg_test('test_x.py'))
host = re.search(r'^HOST="([^"]*)"', rd(os.path.join(HERE, 'run_regression.sh')), re.M)
hl = host.group(1).split() if host else []
ok('① 회귀 실행기 HOST 목록 파일이 모두 있음', bool(hl) and all(os.path.exists(os.path.join(HERE, x)) for x in hl), ' '.join(x for x in hl if not os.path.exists(os.path.join(HERE, x))))

# ── ② 먼 해 잠금 ─────────────────────────────────────
ok('② 먼 해 찾기 — YR = 2096 · \'2099-03-01\' 잡음 · 2026-11 · 2049 안 잡음',
   RC is not None and RC.fixed_years("YR = 2096; x = f'{YR}-01-01'") == ['2096'] and RC.fixed_years("psql(\"... '2099-03-01' ...\")") == ['2099']
   and RC.fixed_years("d = '2026-11-22'; y = 2049") == [] and RC.fixed_years("YEAR = 2049") == [])
tmp = tempfile.mkdtemp(prefix='t1635_')
try:
    body = "import os\nYR = 2097\ndef psql(s): return s\npsql(f\"INSERT INTO acct_payroll_runs (ym) VALUES ('{YR}-03')\")\nprint('결과: 1 / 1')\n"
    for n in ('test_v9001.py', 'test_v9002.py'):
        open(os.path.join(tmp, n), 'w', encoding='utf-8').write(body)
    open(os.path.join(tmp, 'test_v9003.py'), 'w', encoding='utf-8').write("print('결과: 1 / 1')\n")
    rr = {r[0]: (r[2], r[3]) for r in RC.classify(tmp, K)} if RC else {}
finally:
    shutil.rmtree(tmp, ignore_errors=True)
ok('② 같은 먼 해(2097)를 쓰는 시험 둘 → LOCK · year:2097 같음 · 상관없는 시험은 PAR',
   rr.get('test_v9001.py') == ('LOCK', ['year:2097']) and rr.get('test_v9002.py') == ('LOCK', ['year:2097']) and rr.get('test_v9003.py', ('',))[0] == 'PAR', str(rr))

# ── ③ 늘 혼자 · 문서 · 판 ─────────────────────────────
force = rd(os.path.join(HERE, 'reg_solo_force.txt'))
ok('③ test_v1420 · test_v1421 늘 혼자(reg_solo_force.txt)', re.search(r'^test_v1420\.py\b', force, re.M) and re.search(r'^test_v1421\.py\b', force, re.M))
d = os.path.join(K, 'docs')
d779 = next((rd(os.path.join(d, x)) for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith('779_')), '')
ok('③ 문서 779 — 1090 · year · UI_LANE', all(w in d779 for w in ('1090', 'year:', 'UI_LANE')), str(len(d779)))
ok('③ VERSION v10.635 이상', VT >= (10, 635), VER)

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
