"""v10.186 시험 — 적용 안전장치 · 디스크 정리(docs/292 · 마이그레이션 없음)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1186.py

  ① 코드 — 되돌린 상태면 apply 멈춤 · precheck 확인 줄 · 가장 큰 판 남김 · rollback 물음(자동 복귀는 묻지 않음) · cleanup.sh 기본 읽기만 · du 1시간 · 따로 돌림 · 화면 표 · docs/292 · 판
  ② lib.sh 함수를 가짜 판 폴더로 — 11/4 상황(v10.185 지금 · v10.173 직전)에서 v10.181 남음 · 되돌린 상태 알아챔 · 보통 적용은 2개만 남음
  ③ cleanup.sh 를 가짜 집 폴더로 — 읽기만은 아무것도 안 지움 · --apply 는 목록의 것만(새 킷 · 올린 파일 · 백업 남음)
  ④ (API) 운영 화면 지켜보기에 많이 차지하는 폴더(server.top) · 회원 403
"""
import json, os, re, shutil, subprocess, tempfile, time, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
D = 'deploy/aws/'
LIB = rd(D + 'lib.sh'); AP = rd(D + 'apply.sh'); PC = rd(D + 'precheck.sh'); RB = rd(D + 'rollback.sh'); CL = rd(D + 'cleanup.sh')
H = rd('src/common/server-health.ts'); LWT = rd('web/src/app/admin/LaunchWatch.tsx')
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(d for d in os.listdir(MD) if os.path.isdir(os.path.join(MD, d)))

ok('① 적용 스크립트 — 되돌린 상태면 apply 멈춤(ALLOW_FROM_ROLLBACK) · precheck 확인 줄 · 가장 큰 판 남김 · rollback yes 물음 · 자동 복귀는 ROLLBACK_YES',
   'newest_release()' in LIB and 'rolled_back_from()' in LIB and 'best=$(newest_release "$root" "$cur")' in LIB
   and 'RB=$(rolled_back_from "$REL_ROOT" "$APP_LINK")' in AP and 'ALLOW_FROM_ROLLBACK' in AP and 'ROLLBACK_YES=1 bash "$HERE/rollback.sh"' in AP
   and 'rolled_back_from' in PC and '[ -t 0 ] && [ "${ROLLBACK_YES:-0}" != "1" ]' in RB and '정말 되돌립니까' in RB, '')

ok('① cleanup.sh — 기본 읽기만 · --apply 는 yes 뒤 · 지금 판 이하 킷만 · 올린 파일 · 백업 · .env 는 지우지 않음',
   'MODE="${1:-list}"' in CL and '[ "$yn" = "yes" ] || { say "지우지 않았습니다."; exit 1; }' in CL
   and 'sort -V | tail -1)" = "$CURVER"' in CL and not re.search(r'rm -rf[^\n]*(uploads|backup|\.env)', CL), '')

ok('① 많이 차지하는 폴더 — du -skx · 1시간 · 30초 · 따로 돌림(execFile) · 화면 표 · 새 패키지 없음',
   "execFile('du', ['-skx'" in H and '60 * 60_000' in H and 'timeout: 30_000' in H and 'spawnSync' not in H and 'execSync' not in H
   and 'data-disk-top' in LWT and 'cleanup.sh' in LWT and not re.search(r"from '(?!node:|\.)", H), '')

ok('① 문서 · 판 · 마이그레이션 그대로 — docs/292 · v10.186 이상 · 209(v10.189 부터 D172 · 210)',
   any(f.startswith('292_') for f in os.listdir(os.path.join(K, 'docs'))) and len(mig) in (209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 240, 241)
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 186), f"{rd('VERSION').strip()} · {len(mig)}")

# ── ② lib.sh 함수 — 가짜 판 폴더 ─────────────────────────────────────
T = tempfile.mkdtemp()
try:
    R = os.path.join(T, 'r')
    for v in ('v10.9_20261001_000000', 'v10.173_20261101_130205', 'v10.181_20261103_064252', 'v10.185_20261103_152252'):
        os.makedirs(os.path.join(R, v))
    os.symlink(os.path.join(R, 'v10.173_20261101_130205'), os.path.join(T, 'app'))
    sh = lambda c: subprocess.run(['bash', '-c', f'info() {{ echo "$*"; }}; . {K}/{D}lib.sh; {c}'], capture_output=True, text=True).stdout.strip()
    rb = sh(f'rolled_back_from {R} {T}/app')
    pr = sh(f'prune_releases {R} {R}/v10.185_20261103_152252 {R}/v10.173_20261101_130205; ls {R} | paste -sd" "')
    ok('② 11/4 상황 — 되돌린 상태 알아챔(가장 큰 판 v10.185) · 정리 뒤 v10.181 남음 · v10.9 만 지움',
       rb.endswith('/v10.185_20261103_152252') and pr.endswith('v10.173_20261101_130205 v10.181_20261103_064252 v10.185_20261103_152252')
       and 'v10.9_' not in pr.splitlines()[-1], f'{rb[-26:]} · {pr.splitlines()[-1]}')
    os.makedirs(os.path.join(R, 'v10.186_20261105_010000'))
    os.remove(os.path.join(T, 'app')); os.symlink(os.path.join(R, 'v10.186_20261105_010000'), os.path.join(T, 'app'))
    rb2 = sh(f'rolled_back_from {R} {T}/app')
    pr2 = sh(f'prune_releases {R} {R}/v10.186_20261105_010000 {R}/v10.185_20261103_152252; ls {R} | paste -sd" "')
    ok('② 보통 적용 — 되돌린 상태 아님 · 지금 · 직전 2개만 남음', rb2 == '' and pr2.splitlines()[-1] == 'v10.185_20261103_152252 v10.186_20261105_010000',
       f'[{rb2}] · {pr2.splitlines()[-1]}')
finally:
    shutil.rmtree(T, ignore_errors=True)

# ── ③ cleanup.sh — 가짜 집 폴더 ──────────────────────────────────────
T = tempfile.mkdtemp()
try:
    HM = os.path.join(T, 'home')
    for d in ('sgb', 'sgb-data/logs', 'sgb-data/uploads', 'sgb-data/backup/uploads', '.npm/_cacache', '.pm2/logs',
              'SGB_DevDocker_Integrated_20261002_v10_185', 'SGB_DevDocker_Integrated_20261002_v10_187'):
        os.makedirs(os.path.join(HM, d))
    w = lambda p, n=10: open(os.path.join(HM, p), 'wb').write(b'0' * n)
    w('sgb/VERSION'); open(os.path.join(HM, 'sgb/VERSION'), 'w').write('v10.186\n'); open(os.path.join(HM, 'sgb/.env'), 'w').write('X=1\n')
    w('SGB_DevDocker_Integrated_20261002_v10_181.zip'); w('sgb-data/uploads/a.jpg'); w('sgb-data/backup/uploads/uploads_20261103.tar.gz')
    w('.npm/_cacache/x', 1000); w('.pm2/logs/sgb-out.log', 60 * 1024 * 1024); w('.pm2/logs/sgb-error.log', 100)
    w('sgb-data/logs/apply_old.txt'); w('sgb-data/logs/precheck_new.txt')
    old = time.time() - 40 * 86400; os.utime(os.path.join(HM, 'sgb-data/logs/apply_old.txt'), (old, old))
    env = dict(os.environ, HOME=HM, CLEANUP_YES='1')
    snap = lambda: sorted(os.path.relpath(os.path.join(a, f), HM) for a, ds, fs in os.walk(HM) for f in fs + ds)
    before = snap()
    l = subprocess.run(['bash', f'{K}/{D}cleanup.sh'], capture_output=True, text=True, env=env)
    after_list = [p for p in snap() if not p.startswith('sgb-data/logs/cleanup_')]
    ok('③ 읽기만(기본) — 아무것도 안 지움 · 5건 보임 · 새 킷(v10.187)은 남김 표시',
       l.returncode == 0 and after_list == before and '· 5건' in l.stdout and '남김(지금보다 새 판' in l.stdout, l.stdout[-160:].replace('\n', ' | '))
    a = subprocess.run(['bash', f'{K}/{D}cleanup.sh', '--apply'], capture_output=True, text=True, env=env)
    left = snap()
    ok('③ --apply — 옛 킷 2 · 30일 넘은 기록 · npm 캐시 지움 · 큰 pm2 로그 비움 · 새 킷 · 올린 파일 · 백업 · .env · 새 기록 · 작은 로그 남음',
       a.returncode == 0 and not any(p.startswith(('SGB_DevDocker_Integrated_20261002_v10_181', 'SGB_DevDocker_Integrated_20261002_v10_185', '.npm/_cacache')) for p in left)
       and 'sgb-data/logs/apply_old.txt' not in left and os.path.getsize(os.path.join(HM, '.pm2/logs/sgb-out.log')) == 0
       and all(p in left for p in ('SGB_DevDocker_Integrated_20261002_v10_187', 'sgb-data/uploads/a.jpg', 'sgb-data/backup/uploads/uploads_20261103.tar.gz',
                                     'sgb/.env', 'sgb-data/logs/precheck_new.txt', '.pm2/logs/sgb-error.log')),
       a.stdout[-200:].replace('\n', ' | '))
finally:
    shutil.rmtree(T, ignore_errors=True)


# ── ④ API ─────────────────────────────────────────────────────────────
def call(method, path, tok=None, body=None):
    hd = {'content-type': 'application/json'}
    if tok: hd['authorization'] = f'Bearer {tok}'
    r = urllib.request.Request(API + path, method=method, headers=hd, data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(r, timeout=120) as x:
            b = x.read(); s = x.status
    except urllib.error.HTTPError as e:
        b = e.read(); s = e.code
    try: return s, json.loads(b or b'{}')
    except Exception: return s, {}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip(), r.stderr.strip())


if API and DB:
    psql('DELETE FROM auth_throttle')
    TA = call('POST', '/auth/login', None, {'email': 'admin@x.com', 'password': PW})[1].get('accessToken')
    TB = call('POST', '/auth/login', None, {'email': 'buyer@x.com', 'password': PW})[1].get('accessToken')
    call('POST', '/admin/jobs', TA, {'job': 'launch_watch'})
    top = None
    for _ in range(30):   # du 는 따로 돌아 끝난 뒤 다음 읽기부터 보임
        w, jw = call('GET', '/admin/launch-watch', TA)
        top = (jw.get('server') or {}).get('top')
        if top and top.get('items'): break
        time.sleep(3)
    it = (top or {}).get('items') or []
    wb, _ = call('GET', '/admin/launch-watch', TB)
    ok('④ 지켜보기 — 많이 차지하는 폴더 1 ~ 5개(경로 · GB 큰 순 · 줄이는 길 칸) · 잰 시각 · 회원 403',
       1 <= len(it) <= 5 and all(isinstance(x.get('GB'), (int, float)) and x.get('path', '').startswith('/') and 'hint' in x for x in it)
       and [x['GB'] for x in it] == sorted((x['GB'] for x in it), reverse=True) and bool((top or {}).get('at')) and wb == 403,
       f"{[(x['path'], x['GB']) for x in it]} · {wb}")
else:
    print('  (API · DB 없음 — ④ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
