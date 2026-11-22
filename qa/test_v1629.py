"""v10.629 (docs/773) 옛 시험 마이그레이션 수 「이 판 이상」(qa_helpers.MigFrom)
  ① MigFrom 판정 — 같음 · 큼 · 작음 · 이름 번호(B < D) · 세 모양((수, 이름) · "수|이름" · 수)
  ② 옛 시험에 마지막 마이그레이션 이름 목록이 남지 않음 · MigFrom 을 쓰는 시험은 모두 qa_helpers 를 읽음 · 문서 773 · 판
  (파일만 읽음 — 두 번 돌아도 통과)
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

from qa_helpers import MigFrom, mig_key
m = MigFrom(152, 'D114_seed_ad_ends_extend')
ok('① (수, 이름) — 같음 · 큼 통과 · 작은 수 · 작은 이름 실패',
   (152, 'D114_seed_ad_ends_extend') in m and (345, 'D307_x') in m and (151, 'D114_seed_ad_ends_extend') not in m and (200, 'D113_x') not in m)
ok('① 이름 번호 — B 묶음 < D 묶음 · 숫자로(D99 < D100)', mig_key('B080_views') < mig_key('D001_x') and mig_key('D99_a') < mig_key('D100_b') and mig_key('이상') == (-1, -1))
ok('① 세 모양 — "수|이름" · 수 · 모양이 다르면 실패', '345|D307_x' in MigFrom(221, 'D183_a') and '220|D183_a' not in MigFrom(221, 'D183_a')
   and 345 in MigFrom(339) and 338 not in MigFrom(339) and 'x' not in MigFrom(1) and None not in MigFrom(1))
last = sorted(re.findall(r"D\d{3}_\w+", ' '.join(sorted(os.listdir(os.path.join(K, 'prisma', 'migrations'))))) if os.path.isdir(os.path.join(K, 'prisma', 'migrations')) else [])
lastname = last[-1] if last else 'D307_job_fail_streak_perm_compare_daily'
LIST = re.compile(r"\(\(\d+, '[A-Z]\d+_\w+'\)(?:,\s*\(\d+, '[A-Z]\d+_\w+'\)){3,}")
bad, noimp = [], []
for f in sorted(glob.glob(os.path.join(HERE, 'test_v1*.py'))):
    t = rd(f); n = os.path.basename(f)
    if LIST.search(t) and lastname in t:
        bad.append(n)
    if 'MigFrom(' in t and n not in ('test_v1629.py',) and 'from qa_helpers import MigFrom' not in t:
        noimp.append(n)
ok('② 옛 시험에 마지막 이름까지 늘린 목록이 남지 않음(새 마이그레이션마다 고치던 것)', not bad, ' '.join(bad[:8]))
uses = [os.path.basename(f) for f in glob.glob(os.path.join(HERE, 'test_v1*.py')) if 'MigFrom(' in rd(f)]
ok('② MigFrom 을 쓰는 시험 50개 이상 · 모두 qa_helpers 를 읽음(-I 로 돌아도 경로를 넣음)', len(uses) >= 50 and not noimp, f'{len(uses)} · {noimp[:5]}')
d773 = doc('773_')
ok('② 문서 773 — MigFrom · 56 · 세 모양', all(w in d773 for w in ('MigFrom', '56', '세 모양')), str(len(d773)))
ok('② VERSION v10.629 이상', VT >= (10, 629), VER)

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)

