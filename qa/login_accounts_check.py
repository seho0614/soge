#!/usr/bin/env python3
# v10.784 (docs/893) 시험 로그인 계정 대조 — 새로 생기거나 바뀐 시험이 시드에 없는 계정으로 로그인하면 알림
#   python3 qa/login_accounts_check.py <core 작업 트리> <작업 트리 qa> <main qa>
#   까닭(11/25 묶음 2 ~ 5): test_v1774 · 1775 · 1782 가 login('super@x.com')(시드에 없음) → fn_login_fail 이 같은 IP 를 잠금
#   → 뒤 순서 시험 16개가 UNAUTHENTICATED 로 줄줄이 실패. 실패한 로그인 하나가 다른 시험을 망가뜨림.
#   아는 계정 = core scripts/ 시드 · 픽스처(local-setup.sh · seed-* · fixture.sql)에 적힌 메일 주소
#   + 그 시험 파일이 스스로 만드는 계정(로그인 줄 밖에서 같은 주소가 나오면 — INSERT · 가입 호출 등)
#   rc 0 = 모름 0 · rc 1 = 모르는 계정 있음
import os, re, sys, filecmp

core, qa, main_qa = sys.argv[1], sys.argv[2], sys.argv[3]
MAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
CALL = re.compile(r"""(?:\blogin|\.agree|\btoken_of|\bauth_as)\(\s*['"]([^'"]+@[^'"]+)['"]""")

known = set()
sd = os.path.join(core, 'scripts')
for f in sorted(os.listdir(sd)):
    if f == 'local-setup.sh' or f == 'fixture.sql' or f.startswith('seed-'):
        try:
            known |= set(m.lower() for m in MAIL.findall(open(os.path.join(sd, f), encoding='utf-8', errors='ignore').read()))
        except OSError:
            pass

def changed(f):
    m = os.path.join(main_qa, f)
    return not os.path.exists(m) or not filecmp.cmp(m, os.path.join(qa, f), shallow=False)

files = sorted(f for f in os.listdir(qa) if f.endswith('.py') and (f.startswith('test_v') or f.startswith('_')) and changed(f))
bad = []
for f in files:
    src = open(os.path.join(qa, f), encoding='utf-8', errors='ignore').read()
    for ln, line in enumerate(src.splitlines(), 1):
        for e in CALL.findall(line):
            el = e.lower()
            if el in known:
                continue
            others = [l for l in src.splitlines() if el in l.lower() and not CALL.search(l)]
            if others:
                continue  # 시험이 스스로 만드는 계정
            bad.append(f"{f}:{ln}  {e}")

print(f"⑤ 시험 로그인 계정 — 바뀐 · 새 시험 {len(files)}개 · 시드 계정 {len(known)}개 · 모르는 계정 {len(bad)}")
for b in bad[:30]:
    print("   모름 " + b + "  (시드에 없음 · 실패 로그인이 IP 잠금 → 뒤 시험 UNAUTHENTICATED)")
if bad:
    print("   SUPER 시험 계정은 admin@x.com · 회원 buyer@x.com · seller@x.com (비밀번호 sgb-dev-1234)")
sys.exit(1 if bad else 0)
