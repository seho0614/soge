"""v10.628 (docs/772) 미리 검사 · 전체 점검 스크립트(qa/pre_check.sh · qa/full_check.sh)
  ① 실행 권한 · bash -n · 점검판 · 확인판 포트 · RDS · 운영 주소 없음 · 버리는 DB 포트 안 엶 · trap 으로 지움 · 시험은 --network none · 닿지 않는 주소
  ② 전체 점검 순서 realcheck → 기능 → 새 시험 → 회귀 → main down · realcheck 실패면 멈춤 · 기대 수는 판정 줄 수 · summary.txt · 문서 772 · 판
  (파일만 읽음 · bash -n 만 부름 — 두 번 돌아도 통과)
"""
import os, re, subprocess, sys, glob

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
KIT = os.environ.get("KIT", "/home/claude/pkg/SGB_DevDocker_Integrated_20261002")
K = KIT + "/sgb" if os.path.isdir(KIT + "/sgb") else KIT
RES = []


def ok(name, cond, detail=""):
    RES.append((bool(cond), name, detail))
    print(("ok  " if cond else "FAIL") + f" {name} — {detail}", flush=True)


def rd(p):
    return open(p, encoding="utf-8-sig").read() if os.path.exists(p) else ""


def doc(prefix):
    d = os.path.join(K, "docs")
    return next((rd(os.path.join(d, x)) for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith(prefix)), "")


VER = rd(os.path.join(K, "VERSION")).strip()
VT = tuple(int(x) for x in re.findall(r"\d+", VER))

PC, FC = os.path.join(HERE, 'pre_check.sh'), os.path.join(HERE, 'full_check.sh')
P, F = rd(PC), rd(FC)
syn = all(subprocess.run(['bash', '-n', x], capture_output=True).returncode == 0 for x in (PC, FC)) if P and F else False
ok('① 두 스크립트 — 있음 · 실행 권한 · 문법', bool(P and F) and os.access(PC, os.X_OK) and os.access(FC, os.X_OK) and syn)
ok('① pre_check — 확인판 포트(3000 · 5174) · 점검판 DB(15432) · RDS · 운영 주소 없음 · 버리는 DB 포트 안 엶 · 자기 네트워크 · trap 으로 지움',
   not re.search(r'rds\.amazonaws|3\.37\.95\.217|:3000\b|:5174\b|15432|sogaebank\.com', P) and not re.search(r'docker run -d[^\n]*\s(-p|--publish)\s[^\n]*postgres:16', P) and 'postgres:16' in P
   and 'trap cleanup EXIT INT TERM' in P and 'docker network rm "$NET"' in P and 'docker rm -f "$DB"' in P and '--network "$NET"' in P and 'rm -rf -- "${VD:?}"' in P)
ok('① pre_check — 형 검사 3 · 마이그레이션 두 번 · INV-9 · INV-11 · 255 · verify-docs · check-acl · getter · 옛 시험 비교(--network none · 127.0.0.1:1) · MT_SQL',
   P.count('--noEmit') == 3 and P.count('mig |') + P.count('mig|') >= 2 and 'v_inv9_violations' in P and 'v_inv11_violations' in P and '2[6-9][0-9]' in P
   and 'verify-docs.js' in P and 'check-acl.js' in P and 'get [a-zA-Z_]+' in P and 'API=http://127.0.0.1:1/x' in P and P.count('--network none') >= 5 and 'MT_SQL' in P)
order = [F.find(x) for x in ('~/sgb-check.sh "$B" realcheck fresh', 'bash "$Q/func_check.sh"', 'for t in ${NEW:-}', 'for t in ${HOSTNEW:-}', 'bash "$Q/run_regression.sh"')] + [F.rfind('main down >/dev/null 2>&1; say "⑤')]
ok('② full_check — 순서 realcheck → 기능 점검 → 새 시험 → 서버 시험 → 회귀 → main down', all(x > 0 for x in order) and order == sorted(order), str(order))
ok('② full_check — realcheck 실패면 점검판 내리고 멈춤 · 기대 수는 reg_classify 판정 줄 수 · summary.txt · 점검판 주소만',
   'grep -q "진짜 이미지 확인 — 전체 통과"' in F and 'exit 1' in F and 'R.classify(' in F and 'summary.txt' in F
   and not re.search(r'rds\.amazonaws|3\.37\.95\.217|:3000\b|:5174\b|sogaebank\.com', F) and 'localhost:13000' in F)
d772 = doc('772_')
ok('② 문서 772 — pre_check.sh · full_check.sh · MT_SQL · summary.txt', all(w in d772 for w in ('pre_check.sh', 'full_check.sh', 'MT_SQL', 'summary.txt')), str(len(d772)))
ok('② VERSION v10.628 이상', VT >= (10, 628), VER)

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)

