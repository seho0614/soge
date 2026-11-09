"""v10.221 (docs/356) — 외부 묶음(npm 패키지) 약점 검사 · 서버에서(run_regression.sh HOST)

  킷의 scripts/deps-audit.js 로 API · 사용자 웹 · 운영 화면의 서비스 묶음(잠금 파일)을 공개 약점 목록과 대조합니다.
  아주 심각 0 이어야 통과 · 심각 이하 · 예외는 줄만 보여 줌 · 공개 목록에 닿지 못하면 실패(검사 못 함은 통과가 아님).
  npm 이 서버에 있어야 함(개발 서버 /usr/bin/npm) · 자료를 만들지 않음
"""
import os, subprocess

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


S = os.path.join(K, 'scripts/deps-audit.js')
if not os.path.exists(S):
    ok('외부 묶음 검사 — scripts/deps-audit.js 필요', False, S)
else:
    r = subprocess.run(['node', S, K], capture_output=True, text=True, timeout=600)
    out = (r.stdout or '') + (r.stderr or '')
    print(out.strip())
    lines = {l.split(' | ')[0]: l for l in out.splitlines() if ' | ' in l}
    ok('외부 묶음 검사 — API · 사용자 웹 · 운영 화면 모두 검사함(검사 못 한 곳 없음)',
       r.returncode != 2 and all(k in lines and '검사 못 함' not in lines[k] and '잠금 파일 없음' not in lines[k] for k in ('API', '사용자 웹', '운영 화면')),
       f'rc={r.returncode}')
    ok('외부 묶음 검사 — 아주 심각 0(예외 빼고)', r.returncode == 0 and '아주 심각 없음 — 통과' in out, lines.get('외부 묶음 검사', '')[:120])

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
