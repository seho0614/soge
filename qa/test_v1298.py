"""v10.298 (docs/417) — 운영 절차서 초안 도구(sgb-infra tools/ops-doc-draft.py)

  KIT=<kit> python3 -I test_v1298.py        (서버에서 — 회귀 실행기 HOST 목록 · tools/ 는 qa/ 옆)

  ① (코드) 도구 · 실행 권한 · 읽기만(네트워크 · psql · ssh · 지우기는 임시 폴더만) · README 줄 · docs/417 · 판 v10.298 · 회귀 실행기 HOST
  ② (가짜 킷) 마이그레이션 있는 판 — precheck 기대 줄 · 스냅샷 꼭 · 적용 스크립트 그대로 · 판 문서 2개(운영 적용 문서 · 범위 밖 · --no 뺌) ·
     「바뀐 것」 표 · 「운영 적용」 줄 · sha256(zip · tar.gz) · 커밋 · 명령 블록 · 채울 곳 · 스스로 sha 대조 「맞음」 · 종료 0
  ③ (가짜 킷) 마이그레이션 없음 · deploy 바뀜 — 스냅샷 skip · 「⚠ 바뀜」 + 바뀐 파일 이름 · tar.gz 없음
  ④ 옛 마이그레이션이 바뀜 → ⛔ · 종료 2 / 판이 거꾸로 → 멈춤 / zip 밖 경로(../) → 멈춤 / zip 아님 → 멈춤
  가짜 킷은 임시 폴더에 만들고 지움(DB · API 안 씀 · 두 번 돌아도 같음).
"""
import hashlib, os, re, shutil, subprocess, sys, tempfile, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
TOOL = os.path.normpath(os.path.join(HERE, '..', 'tools', 'ops-doc-draft.py'))
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(p):
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


VER = rd(os.path.join(K, 'VERSION')).strip()
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []
D417 = next((rd(os.path.join(K, 'docs', x)) for x in docs if x.startswith('417_')), '')
SRC = rd(TOOL)
README = rd(os.path.join(HERE, '..', 'tools', 'README.md'))
RUNNER = rd(os.path.join(HERE, 'run_regression.sh'))
host = re.search(r'^HOST="([^"]*)"', RUNNER, re.M)

# ① 코드
ok('① 도구 — tools/ops-doc-draft.py · 실행 권한 · 킷 두 개 · -o · --no · --doc · 〔채울 것〕 · 스스로 sha 대조 · 종료 코드(0 · 2 · 3)',
   bool(SRC) and os.access(TOOL, os.X_OK) and "ap.add_argument('old'); ap.add_argument('new')" in SRC and "'--no'" in SRC and "'--doc'" in SRC
   and '〔채울 것' in SRC and "re.findall(r'\\b[0-9a-f]{64}\\b', text)" in SRC and 'return 3 if bad else (2 if chg_m or gone_m else 0)' in SRC, TOOL)
BAD = re.compile(r'\b(import (socket|requests|urllib|http)|psycopg|subprocess|ssh |os\.remove|os\.unlink)\b')
ok('① 읽기만 — 네트워크 · DB · 다른 명령 부르지 않음 · 지우는 것은 임시 폴더(rmtree tmp) 하나 · zip 밖 경로 막음',
   bool(SRC) and not BAD.search(SRC) and SRC.count('shutil.rmtree(') == 1 and 'shutil.rmtree(tmp, ignore_errors=True)' in SRC
   and "'..' in n.split('/')" in SRC, '')
ok('① README · docs/417 · 회귀 실행기 HOST 에 test_v1298 · 판 v10.298 이상',
   '`ops-doc-draft.py`' in README and 'docs/417' in README and bool(D417) and 'ops-doc-draft.py' in D417 and '〔채울 것' in D417
   and bool(host) and 'test_v1298.py' in host.group(1).split()
   and tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 298), VER)

tmp = tempfile.mkdtemp(prefix='v1298_')


def kit(name, ver, migs, deploy='echo apply', docs=None, tar=True, extra=None, commits='core aaa1111 infra bbb2222 adx ccc3333 made 1114-0000'):
    root = os.path.join(tmp, 'src', name)
    shutil.rmtree(root, ignore_errors=True)
    w = lambda rel, s: (os.makedirs(os.path.dirname(os.path.join(root, rel)), exist_ok=True), open(os.path.join(root, rel), 'w', encoding='utf-8').write(s))
    w('KIT_COMMITS.txt', commits + '\n')
    w('sgb/VERSION', ver + '\n')
    w('sgb/deploy/aws/apply.sh', deploy + '\n')
    w('sgb/package.json', '{"name":"sgb"}\n')
    w('sgb/src/app.module.ts', f'// {ver}\n')
    w('qa/test_x.py', f'# {ver}\n')
    for m, body in migs.items():
        w(f'sgb/prisma/migrations/{m}/migration.sql', body)
    for f, body in (docs or {}).items():
        w(f'sgb/docs/{f}', body)
    for rel, body in (extra or {}).items():
        w(rel, body)
    z = os.path.join(tmp, name + '.zip')
    with zipfile.ZipFile(z, 'w') as zf:
        for dp, _, fs in os.walk(root):
            for f in fs:
                p = os.path.join(dp, f)
                zf.write(p, os.path.join(name, os.path.relpath(p, root)))
    if tar:
        open(os.path.join(tmp, name + '.tar.gz'), 'wb').write(b'tar-' + ver.encode())
    return z


def run(*args):
    p = subprocess.run([sys.executable, '-I', TOOL, *args], capture_output=True, text=True, timeout=120)
    return p.returncode, p.stdout, p.stderr


sha = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()
try:
    M = {'D001_a': 'SELECT 1;\n', 'D002_b': 'SELECT 2;\n'}
    DOC_A = '# 500. 가\n\n## 1. 바뀐 것 (정확한 위치)\n\n| 판 | 곳 | 내용 |\n|---|---|---|\n| v10.101 | 운영 화면 **가** › **나** | 새 상자 ㄱ |\n\n## 2. API\n\n없음\n\n## 5. 운영 적용\n\n- 마이그레이션 1개 — 스냅샷 필요\n- 적용 뒤 확인: 가 › 나 › 「ㄱ」\n'
    DOC_B = '# 502. 다\n\n## 1. 바뀐 것\n\n| 판 | 곳 | 내용 |\n|---|---|---|\n| v10.103 | 사용자 웹 **다** | 글자 ㄷ |\n'
    DOCS = {'500_가_v10.101-102_20261114.md': DOC_A, '501_운영적용_v10.100에서_v10.102_20261114.md': '# 501\n\n## 1. 바뀐 것\n\n| x | 운영적용 문서 |\n',
            '502_다_v10.103_20261114.md': DOC_B, '499_옛것_v10.099_20261113.md': '# 499\n\n## 1. 바뀐 것\n\n| 옛 판 |\n',
            '503_뺄것_v10.102_20261114.md': '# 503\n\n## 1. 바뀐 것\n\n| 뺄 문서 |\n', '504_판없음_20261114.md': '# 504\n'}
    o1 = kit('SGB_T_v10_100', 'v10.100', M)
    n1 = kit('SGB_T_v10_103', 'v10.103', {**M, 'D003_c': 'CREATE TABLE IF NOT EXISTS c (id int);\n'}, docs=DOCS)
    out1 = os.path.join(tmp, 'd1.md')
    rc, so, se = run(o1, n1, '-o', out1, '--no', '503', '--doc', '900')
    d = rd(out1)
    zs, ts = sha(n1), sha(n1[:-4] + '.tar.gz')
    ok('② 마이그레이션 있음 — 종료 0 · 제목 · precheck 기대 줄 ① · 올릴 것 이름 · apply 줄 · 스냅샷 꼭 · 적용 스크립트 그대로',
       rc == 0 and d.startswith('# 900. 운영 적용 — v10.100 → v10.103 한 번에') and '`적용됨 2 · 새 킷의 파일 3 · 올릴 것 1 · 바뀐 파일 0`' in d
       and '올릴 것 이름 D003' in d and '`적용 1 · 기존 2 · 변경감지 0` → `3 / 3`' in d and '마이그레이션 1개(2 → 3) — RDS 스냅샷 꼭 만듭니다.' in d
       and '`sgb-before-v10-103-<적용하는 날 YYYYMMDD>` (**꼭 만듦**)' in d and '**바뀌지 않음** — `deploy/` 전체' in d and '⛔' not in d, f'rc {rc} · {se.strip()[-200:]}')
    ok('② 판 문서 — 500(v10.101 ~ 102) · 502(v10.103) 만 · 운영 적용 문서 · 범위 밖(499) · --no(503) · 판 없는 문서 뺌 · 「바뀐 것」 표 · 「운영 적용」 줄 · 쓰지 않는 문서 머리말',
       '### docs/500 — v10.101 ~ 102' in d and '### docs/502 — v10.103' in d and '| v10.101 | 운영 화면 **가** › **나** | 새 상자 ㄱ |' in d
       and '| v10.103 | 사용자 웹 **다** | 글자 ㄷ |' in d and '운영적용 문서' not in d and '| 옛 판 |' not in d and '| 뺄 문서 |' not in d and 'docs/504' not in d
       and '- docs/500 (v10.101 ~ 102):' in d and '  - 적용 뒤 확인: 가 › 나 › 「ㄱ」' in d and '**docs/503 는 쓰지 않습니다.**' in d
       and '## 2. API' not in d, '')
    ok('② 킷 값 — zip · tar.gz sha256 · 커밋 줄 · scp · certutil 기대값 · precheck · apply · 정리 블록 · 두 킷 차이(서비스 바뀜 2 · 새 마이그레이션 1 · 점검 도구 1)',
       f'zip `{zs}` · tar.gz `{ts}`' in d and f'#  기대: {zs}' in d and 'core aaa1111 infra bbb2222 adx ccc3333' in d
       and 'scp sgb-dev:~/kits/release/SGB_T_v10_103.zip C:\\sgb\\' in d and 'bash ~/SGB_T_v10_103/sgb/deploy/aws/precheck.sh' in d
       and 'bash ~/SGB_T_v10_103/sgb/deploy/aws/apply.sh' in d and 'rm -rf ~/SGB_T_v10_103 ~/SGB_T_v10_103.zip' in d
       and '| 서비스 쪽(`sgb/` · 문서 뺌) | 바뀜 2 · 새것 0 · 없어짐 0 · 새 마이그레이션 1 |' in d and '| 점검 도구(qa · docker 등 · 운영에 안 감) | 바뀜 1 |' in d
       and set(re.findall(r'\b[0-9a-f]{64}\b', d)) == {zs, ts}, '')
    ok('② 알림 줄 — 채울 곳 수 · sha 대조 「맞음」 · 스냅샷 「필요」 · 판 문서 2개 · 임시 폴더 지움',
       f"채울 곳 {d.count('〔채울 것')}" in se and 'sha 대조 맞음' in se and '스냅샷 필요' in se and '판 문서 2개' in se
       and not [x for x in os.listdir(tempfile.gettempdir()) if x.startswith('opsdraft_')], se.strip()[-160:])
    # 표준 출력으로도
    rc_b, so_b, _ = run(o1, n1, '--no', '503', '--doc', '900')
    ok('② -o 없으면 표준 출력 · 같은 내용(두 번 돌려도 같음)', rc_b == 0 and so_b == d, f'{len(so_b)} / {len(d)}')

    # ③ 마이그레이션 없음 · deploy 바뀜 · tar 없음
    n2 = kit('SGB_T_v10_101', 'v10.101', M, deploy='echo apply v2', tar=False, extra={'sgb/.env.example': 'X=1\n'})
    rc, so, se = run(o1, n2)
    ok('③ 마이그레이션 없음 · deploy 바뀜 — 스냅샷 skip · 「⚠ 바뀜」 + `sgb/deploy/aws/apply.sh` · `.env.example` · tar.gz 없음 · 판 문서 없음 안내',
       rc == 0 and '마이그레이션 0개(2 → 2) — 스냅샷은 skip 가능' in so and '`skip`' in so and '⚠ **바뀜** — `sgb/.env.example` · `sgb/deploy/aws/apply.sh`' in so
       and 'tar.gz 없음' in so and '판 문서를 찾지 못함' in so and '스냅샷 skip 가능' in se and '적용 스크립트 바뀜 2' in se and 'DB 까지 되돌려야 함' not in so, se.strip()[-160:])

    # ④ 멈추는 경우
    n3 = kit('SGB_T_v10_102', 'v10.102', {'D001_a': 'SELECT 1; -- 고침\n', 'D002_b': 'SELECT 2;\n'})
    rc3, so3, _ = run(o1, n3)
    rc4, _, se4 = run(n1, o1)
    bz = os.path.join(tmp, 'bad.zip')
    with zipfile.ZipFile(bz, 'w') as zf:
        zf.writestr('SGB_T/sgb/VERSION', 'v10.200\n'); zf.writestr('../evil.txt', 'x')
    rc5, _, se5 = run(o1, bz)
    rc6, _, se6 = run(o1, os.path.join(tmp, 'none.tar.gz'))
    ok('④ 옛 마이그레이션 바뀜 → ⛔ · 종료 2 / 판 거꾸로 → 멈춤 / zip 밖 경로 → 멈춤 / zip 아님 → 멈춤',
       rc3 == 2 and "⛔ 멈출 것 | 옛 마이그레이션이 바뀜 ['D001_a']" in so3 and '바뀐 파일 1' in so3
       and rc4 != 0 and '보다 높지 않음' in se4 and rc5 != 0 and '이상한 경로' in se5 and not os.path.exists(os.path.join(tmp, 'evil.txt'))
       and rc6 != 0 and 'zip 이 아님' in se6, f'{rc3} · {rc4} · {rc5} · {rc6}')
finally:
    shutil.rmtree(tmp, ignore_errors=True)

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
