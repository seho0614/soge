"""v10.639 (docs/783) 줄인 점검 ONLY= — 세션 임시 스크립트 대신 저장소 스크립트로
  ① run_regression.sh — ONLY 를 받아 그 시험만(번호 1090 아래도) · .py 없어도 됨 · 중복 하나로 · PAR=1 · 기대 수 = 고른 수 · HOST 목록에 있으면 서버에서 ·
     AI MOCK 다시 띄우기 줄은 ONLY 와 상관없이 늘 돎 · 줄인 점검은 시간 기록(~/reg_times.tsv · reg_last_times.tsv)을 남기지 않음
  ② 없는 시험 이름이면 도커 · 점검판을 부르기 전에 멈춤(종료 2 · 로그에 「없는 시험」) — 실제로 돌려 확인(임시 로그 · 점검판 안 씀)
  ③ full_check.sh — ONLY 면 ② 기능 점검 · ③ 새 시험 건너뜀 · run_regression 에 ONLY 넘김 · 기대 수 = 고른 수(중복 뺌) · 결과 폴더 mini_ · realcheck · main down 그대로
  ④ 문서 783 · 판
  (파일만 읽음 · 임시 폴더는 스스로 지움 — 두 번 돌아도 통과)
"""
import os, re, sys, subprocess, tempfile, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
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
RR = rd(os.path.join(HERE, 'run_regression.sh'))
FC = rd(os.path.join(HERE, 'full_check.sh'))

# ── ① run_regression.sh ───────────────────────────────
blk = RR[RR.find('ONLY_FILES=""'):RR.find('head -1 "$K/KIT_COMMITS.txt"')]
ok('① ONLY 받기 — .py 붙임 · 없으면 종료 2 · 중복 하나로(sort -u) · PAR=1 · 기대 수 = 고른 수',
   'if [ -n "${ONLY:-}" ]' in blk and 't=${t%.py}.py' in blk and 'exit 2' in blk and 'sort -u' in blk and 'PAR=1' in blk and 'EXPECT=${EXPECT:-' in blk, str(len(blk)))
ok('① ONLY 검사는 AI MOCK 다시 띄우기 · 도커보다 앞', 0 < RR.find('ONLY_FILES=""') < RR.find('AGENT_PROVIDER=MOCK') and 'docker' not in blk, '')
ok('① AI MOCK 다시 띄우기 줄은 조건 없이 그대로(11/22 임시 스크립트가 빠뜨린 것)',
   re.search(r'^\(cd "\$K" && AGENT_PROVIDER=MOCK docker compose', RR, re.M) is not None, '')
ok('① 고른 시험만 — ALL 을 바꿈 · HOST 목록 중 고른 것만 서버에서',
   '[ -n "$ONLY_FILES" ] && ALL=$ONLY_FILES' in RR and re.search(r'for f in \$HOST; do \[ -n "\$ONLY_FILES" \] && ! echo " \$ONLY_FILES " \| grep -q " \$f " && continue;', RR) is not None, '')
tail = RR[RR.find('NT=$(grep -c'):]
ok('① 줄인 점검은 시간 기록을 남기지 않음(reg_times · reg_last_times 를 if [ -z "$ONLY_FILES" ] 안에)',
   tail.find('if [ -z "$ONLY_FILES" ]') < tail.find('>> "$HIST"') < tail.find('reg_last_times.tsv') < tail.find('\nfi\n'), '')

# ── ② 없는 이름이면 멈춤(실제로 돌림) ──────────────────
tmp = tempfile.mkdtemp(prefix='t1639_')
try:
    log = os.path.join(tmp, 'r.log')
    env = dict(os.environ, ONLY='test_v9999_none', HOME=tmp)
    p = subprocess.run(['bash', os.path.join(HERE, 'run_regression.sh'), log], env=env, capture_output=True, text=True, timeout=60)
    lg = rd(log)
finally:
    shutil.rmtree(tmp, ignore_errors=True)
ok('② 없는 시험 이름 → 종료 2 · 로그 「없는 시험: test_v9999_none.py」 · 도커 안 부름', p.returncode == 2 and '없는 시험: test_v9999_none.py' in lg and 'KIT_COMMITS' not in p.stdout,
   f'rc={p.returncode} {lg[:120]!r}')

# ── ③ full_check.sh ──────────────────────────────────
mid = FC[FC.find('if [ -z "$ONLY" ]; then'):FC.find('if [ -n "$ONLY" ]; then EXP=')]
ok('③ ONLY 면 기능 점검 · 새 시험(NEW · HOSTNEW) 건너뜀', 'func_check.sh' in mid and 'for t in ${NEW:-}' in mid and 'for t in ${HOSTNEW:-}' in mid and '건너뜀(줄인 점검 ONLY' in mid, str(len(mid)))
ok('③ run_regression 에 ONLY 넘김 · 기대 수 = 고른 수(중복 뺌)',
   'ONLY="$ONLY" PAR=' in FC and re.search(r'EXP=\$\(echo \$ONLY \| tr " " "\\n" \| sed "s/\\\.py\$//" \| sort -u \| grep -c \.\)', FC) is not None, '')
ok('③ realcheck · main down 그대로 · 결과 폴더 mini_ / full_', 'realcheck fresh' in FC and '~/sgb-check.sh main down' in FC and 'echo mini || echo full' in FC, '')
sh = subprocess.run(['bash', '-n', os.path.join(HERE, 'full_check.sh')], capture_output=True, text=True)
sr = subprocess.run(['bash', '-n', os.path.join(HERE, 'run_regression.sh')], capture_output=True, text=True)
ok('③ 두 스크립트 bash 문법', sh.returncode == 0 and sr.returncode == 0, sh.stderr[:100] + sr.stderr[:100])

# ── ④ 문서 · 판 ──────────────────────────────────────
d = os.path.join(K, 'docs')
d783 = next((rd(os.path.join(d, x)) for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith('783_')), '')
ok('④ 문서 783 — ONLY · MOCK · mini_', all(w in d783 for w in ('ONLY=', 'MOCK', 'mini_')), str(len(d783)))
ok('④ VERSION v10.639 이상', VT >= (10, 639), VER)

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
