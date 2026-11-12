"""v10.192 시험 — 적용이 멈추면 쓰지 않은 새 판 폴더 지우기(docs/301 · 마이그레이션 없음)

  docker run --rm -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core sgb-qa:v1 python3 test_v1192.py

  ① 코드 — lib.sh drop_unused_release · apply.sh NEW_REL 적기 · 바로가기 뒤 비우기 · stop 안 drop_new · 「지워도 됩니다」 없음 · docs/301 · 판
  ② lib.sh 함수를 가짜 판 폴더로 — 새 판 지움 · 지금 판 · 보관 폴더 밖 · 빈 값은 그대로
  ③ apply.sh 의 stop · drop_new 를 그대로 꺼내 11/5 상황으로 — 멈춘 뒤 새 판 없어짐 · 되돌린 상태 아님
"""
import os, re, shutil, subprocess, tempfile

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
D = 'deploy/aws/'
LIB = rd(D + 'lib.sh'); AP = rd(D + 'apply.sh')
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(d for d in os.listdir(MD) if os.path.isdir(os.path.join(MD, d)))
lines = AP.splitlines()
ln_i = next((i for i, l in enumerate(lines) if l.startswith('ln -sfn "$REL" "$APP_LINK"')), -1)
mk_i = next((i for i, l in enumerate(lines) if l == 'mkdir -p "$REL"'), -1)

ok('① lib.sh — drop_unused_release(보관 폴더 안 v*_* · 지금 판 아님 · 지운 경로 출력)',
   'drop_unused_release()' in LIB and 'case "$rel" in "$root"/v*_*)' in LIB and '[ "$rel" != "$cur" ] || return 0' in LIB
   and 'rm -rf "$rel" && echo "$rel"' in LIB, '')

ok('① apply.sh — 새 판 만든 바로 뒤 NEW_REL 적기 · 바로가기 바꾼 바로 뒤 비우기 · stop 안 drop_new · 「지워도 됩니다」 없음',
   mk_i > 0 and lines[mk_i + 1] == 'NEW_REL="$REL"' and ln_i > 0 and lines[ln_i + 1] == 'NEW_REL=""'
   and re.search(r'^stop\(\) \{[^\n]*drop_new;[^\n]*exit 1; \}', AP, re.M) and 'drop_unused_release "$NEW_REL" "$REL_ROOT" "$APP_LINK"' in AP
   and '지워도 됩니다' not in AP and AP.index('drop_new() {') < AP.index('stop() {'), f'mkdir {mk_i + 1}줄 · ln {ln_i + 1}줄')

ok('① 문서 · 판 · 마이그레이션 그대로 — docs/301 · v10.192 이상 · 210',
   any(f.startswith('301_') for f in os.listdir(os.path.join(K, 'docs'))) and len(mig) in (210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 240)
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 192), f"{rd('VERSION').strip()} · {len(mig)}")

# ── ② lib.sh 함수 — 가짜 판 폴더 ─────────────────────────────────────
T = tempfile.mkdtemp()
try:
    R = os.path.join(T, 'r')
    for v in ('v10.188_20261104_060404', 'v10.191_20261105_003425'):
        os.makedirs(os.path.join(R, v))
    os.makedirs(os.path.join(T, 'kit/sgb'))
    os.symlink(os.path.join(R, 'v10.188_20261104_060404'), os.path.join(T, 'app'))
    sh = lambda c: subprocess.run(['bash', '-c', f'info() {{ echo "$*"; }}; . {K}/{D}lib.sh; {c}'], capture_output=True, text=True)
    cur = sh(f'drop_unused_release {R}/v10.188_20261104_060404 {R} {T}/app; echo rc=$?')
    out = sh(f'drop_unused_release {T}/kit {R} {T}/app; echo rc=$?')
    emp = sh(f'drop_unused_release "" {R} {T}/app; echo rc=$?')
    new = sh(f'drop_unused_release {R}/v10.191_20261105_003425 {R} {T}/app; echo rc=$?')
    ok('② 지금 판 · 보관 폴더 밖 · 빈 값은 지우지 않음(rc 0) · 쓰지 않은 새 판만 지우고 경로 출력',
       cur.stdout.strip() == 'rc=0' and out.stdout.strip() == 'rc=0' and emp.stdout.strip() == 'rc=0'
       and os.path.isdir(os.path.join(R, 'v10.188_20261104_060404')) and os.path.isdir(os.path.join(T, 'kit'))
       and new.stdout.strip().endswith('/v10.191_20261105_003425\nrc=0') and not os.path.exists(os.path.join(R, 'v10.191_20261105_003425')),
       new.stdout.strip().replace('\n', ' | ')[-60:])
finally:
    shutil.rmtree(T, ignore_errors=True)

# ── ③ apply.sh 의 stop · drop_new 를 그대로 — 11/5 상황 ──────────────
T = tempfile.mkdtemp()
try:
    R = os.path.join(T, 'r')
    for v in ('v10.188_20261104_060404', 'v10.191_20261105_003425'):
        os.makedirs(os.path.join(R, v))
    os.symlink(os.path.join(R, 'v10.188_20261104_060404'), os.path.join(T, 'app'))
    fns = '\n'.join(l for l in lines if l.startswith(('drop_new() {', 'stop() {')))
    scr = (f'say() {{ echo "$*"; }}; info() {{ echo "$*"; }}; . {K}/{D}lib.sh\n'
           f'REL_ROOT={R}; APP_LINK={T}/app; OUT=/dev/null; NEW_REL={R}/v10.191_20261105_003425\n{fns}\n'
           '( stop "스냅샷 확인이 없어 DB 를 건드리지 않았습니다" "빌드한 새 판 폴더는 지웁니다." ); echo "rc=$?"\n'
           'echo "rb=[$(rolled_back_from "$REL_ROOT" "$APP_LINK")]"; ls "$REL_ROOT" | paste -sd" "')
    r = subprocess.run(['bash', '-c', scr], capture_output=True, text=True)
    o = r.stdout
    ok('③ 스냅샷 물음에서 멈춤 — rc 1 · 「쓰지 않은 새 판 폴더를 지웠습니다 — v10.191_…」 · 새 판 없어짐 · 되돌린 상태 아님 · v10.188 남음',
       '!! 멈춥니다' in o and '쓰지 않은 새 판 폴더를 지웠습니다 — v10.191_20261105_003425' in o and 'rc=1' in o
       and 'rb=[]' in o and o.strip().splitlines()[-1] == 'v10.188_20261104_060404', o.strip().replace('\n', ' | ')[-180:])
    os.makedirs(os.path.join(R, 'v10.191_20261105_003933'))
    os.remove(os.path.join(T, 'app')); os.symlink(os.path.join(R, 'v10.191_20261105_003933'), os.path.join(T, 'app'))
    scr2 = scr.replace(f'NEW_REL={R}/v10.191_20261105_003425', f'NEW_REL={R}/v10.191_20261105_003933')
    o2 = subprocess.run(['bash', '-c', scr2], capture_output=True, text=True).stdout
    ok('③ 바로가기를 바꾼 뒤(지금 판 = 새 판)에는 멈춰도 지우지 않음',
       '지웠습니다' not in o2 and os.path.isdir(os.path.join(R, 'v10.191_20261105_003933')), o2.strip().splitlines()[-1])
finally:
    shutil.rmtree(T, ignore_errors=True)

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
