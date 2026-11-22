"""v10.636 (docs/780) 운영 적용 화면 출력 보관 → 절차서 [5] · postcheck 기대 숫자를 실제로
  KIT=<kit> python3 -I test_v1636.py          (서버에서 — 회귀 실행기 HOST 목록 · ~/kits/ops/results 읽음)
  ① (코드) ops-result-save.py(판 모양 · 결과 줄 · 비밀 값 줄 막음 · 덮어쓰지 않음) · ops-doc-draft parse_ops_log · ops_result · --results · 문서 780 · 판
  ② (합성) 출력 글 → 오픈 차단 · 약관 · precheck · postcheck · [11] 숫자 · 저장 도구가 결과 줄 없는 글 · 비밀 값 줄을 막음(임시 HOME)
  ③ (진짜 · ~/kits/ops/results 에 지금 운영 판 파일이 있으면) 숫자를 읽음
  (임시 폴더는 스스로 지움 — 두 번 돌아도 통과)
"""
import glob, importlib.util, os, re, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.join(os.path.dirname(HERE), 'tools')
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
SV, OD = rd(os.path.join(TOOLS, 'ops-result-save.py')), rd(os.path.join(TOOLS, 'ops-doc-draft.py'))

# ── ① 코드 ─────────────────────────────────────────────
ok('① ops-result-save.py — 실행 권한 · 판 모양 · 결과 줄 · 비밀 값 줄 막음 · 덮어쓰지 않음(--force) · ~/kits/ops/results/<판>_apply.txt',
   bool(SV) and os.access(os.path.join(TOOLS, 'ops-result-save.py'), os.X_OK) and r"re.fullmatch(r'v10\.\d+', args[0])" in SV
   and '적용 전 점검 — 통과|적용 후 확인 — 통과' in SV and 'SECRET = re.compile(' in SV and "if os.path.exists(f) and not force:" in SV and "f'{args[0]}_apply.txt'" in SV)
ok('① ops-doc-draft — parse_ops_log · ops_result · --results · 실제 숫자가 있으면 [5] · postcheck 기대에 씀 · 읽기만 그대로',
   'def parse_ops_log(' in OD and 'def ops_result(' in OD and "ap.add_argument('--results'" in OD and '적용 때 실제 숫자(results/' in OD
   and "pcb = res[1]['post']" in OD and OD.count('shutil.rmtree(') == 1)
d = os.path.join(K, 'docs')
d780 = next((rd(os.path.join(d, x)) for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith('780_')), '')
ok('① 문서 780 — ops-result-save.py · results · [5] · postcheck', all(w in d780 for w in ('ops-result-save.py', 'results', '[5]', 'postcheck')), str(len(d780)))
ok('① VERSION v10.636 이상', VT >= (10, 636), VER)

# ── ② 합성 ─────────────────────────────────────────────
spec = importlib.util.spec_from_file_location('opsdraft', os.path.join(TOOLS, 'ops-doc-draft.py'))
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)
LOG = """[5] DB
        오픈 차단 9건 [ASSUME:4 INTEGRATION:5]
        약관: 게시 12(시행 중 4 · 새 판 시행 예정 0 · 첫 판 시행일 전 8) · 초안 1
적용 전 점검 — 통과 21 · 실패 0 · 확인 0
[11] 적용 전과 비교
        precheck 2026-11-23 02:01(v10.635) 와 비교 — 같음 12개 · 바뀜 1개
적용 후 확인 — 통과 55 · 실패 0 · 확인 4
"""
r = M.parse_ops_log(LOG)
ok('② 출력 글 → 오픈 차단 · 약관 · precheck · postcheck · [11]',
   r == {'open': '오픈 차단 9건 [ASSUME:4 INTEGRATION:5]', 'terms': '약관: 게시 12(시행 중 4 · 새 판 시행 예정 0 · 첫 판 시행일 전 8) · 초안 1',
         'cmp': '같음 12개 · 바뀜 1개', 'pre': (21, 0, 0), 'post': (55, 0, 4)}, str(r))
home = tempfile.mkdtemp(prefix='t1636_')
try:
    env = dict(os.environ, HOME=home)
    run = lambda ver, txt, *x: subprocess.run([sys.executable, '-I', os.path.join(TOOLS, 'ops-result-save.py'), ver, '-', *x], input=txt, capture_output=True, text=True, env=env)
    a1 = run('v10.999', LOG); a2 = run('v10.999', LOG); a3 = run('v10.998', 'hello'); a4 = run('v10.997', LOG + 'JWT_SECRET=abcdefghijkl\n'); a5 = run('x', LOG)
    saved = os.path.join(home, 'kits', 'ops', 'results', 'v10.999_apply.txt')
    got = M.ops_result(os.path.join(home, 'kits', 'ops', 'results'), 'v10.999')
    ok('② 저장 0 · 같은 판 두 번째는 덮어쓰지 않음 5 · 결과 줄 없음 3 · 비밀 값 줄 4 · 판 모양 틀림 2 · 저장한 파일을 절차서 도구가 읽음',
       (a1.returncode, a2.returncode, a3.returncode, a4.returncode, a5.returncode) == (0, 5, 3, 4, 2) and os.path.isfile(saved)
       and got and got[0] == 'v10.999_apply.txt' and got[1]['post'] == (55, 0, 4)
       and not os.path.exists(os.path.join(home, 'kits', 'ops', 'results', 'v10.997_apply.txt')),
       f'{(a1.returncode, a2.returncode, a3.returncode, a4.returncode, a5.returncode)} {got}')
finally:
    shutil.rmtree(home, ignore_errors=True)

# ── ③ 진짜 ─────────────────────────────────────────────
num = lambda z: int(re.search(r'v10_(\d+)\.zip$', z).group(1))
ops = sorted(glob.glob(os.path.expanduser('~/kits/ops/SGB_*_v10_*.zip')), key=num)
vo = f'v10.{num(ops[-1])}' if ops else ''
real = M.ops_result(os.path.expanduser('~/kits/ops/results'), vo) if vo else None
if real:
    ok(f'③ 지금 운영 판({vo}) 출력 — 오픈 차단 · postcheck 숫자 읽음', bool(real[1].get('open')) and bool(real[1].get('post')), str(real[1])[:160])
else:
    print(f'  (~/kits/ops/results/{vo}_apply.txt 없음 — ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
