"""v10.91 시험 — apply.sh 가 새 판이 뜬 뒤 옛 판을 정리(prune_releases · docs/146)

  KIT=… python3 -I test_v1091.py

  ① apply.sh — 6단계(기동 확인) 통과 줄 바로 뒤에서만 부름 · 되돌리기 갈래에서는 안 부름 · 끄기 설명
  ② 가짜 판 보관 폴더 — 지금 · 직전 판 남김 · 나머지 v*_* · prev_* 지움 · 바로가기 · 파일 · 다른 이름 폴더는 그대로
  ③ 직전 판이 없을 때 · KEEP_OLD_RELEASES=1 · 지금 판이 보관 폴더 밖이면 아무것도 안 지움
"""
import os, re, subprocess, tempfile

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


A = rd('deploy/aws/apply.sh')
LIB = os.path.join(K, 'deploy/aws/lib.sh')
ok('① 문법(bash -n) apply.sh · lib.sh', all(subprocess.run(['bash', '-n', os.path.join(K, f)]).returncode == 0 for f in ('deploy/aws/apply.sh', 'deploy/aws/lib.sh')), '')
i_ok = A.find('ok "API · 사용자 웹이 떴습니다 (새 프로세스 · 재시작 0회)"')
i_pr = A.find('prune_releases "$REL_ROOT" "$REL" "$PREV"')
i_else = A.find('else', i_ok)
ok('① 기동 확인 통과 바로 뒤 · 되돌리기(else) 앞에서만 부름', 0 < i_ok < i_pr < i_else and A.count('prune_releases') == 1, f'{i_ok} {i_pr} {i_else}')
ok('① 끄기 설명(KEEP_OLD_RELEASES=1)', 'KEEP_OLD_RELEASES=1' in A and 'KEEP_OLD_RELEASES' in rd('deploy/aws/lib.sh'), '')


def run(setup, cur, prev, env=None):
    T = tempfile.mkdtemp()
    root = os.path.join(T, 'sgb-releases')
    os.makedirs(root)
    for n in setup:
        p = os.path.join(root, n)
        if n.endswith('.txt'):
            open(p, 'w').write('x')
        elif n.startswith('link_'):
            os.symlink(os.path.join(root, setup[0]), p)
        else:
            os.makedirs(os.path.join(p, 'node_modules'))
            open(os.path.join(p, 'node_modules', 'f'), 'w').write('x' * 2048)
    c = os.path.join(root, cur) if cur and not cur.startswith('/') else cur
    pv = os.path.join(root, prev) if prev else ''
    sh = f'. "{LIB}"; prune_releases "{root}" "{c}" "{pv}"'
    r = subprocess.run(['bash', '-c', sh], capture_output=True, text=True, env=dict(os.environ, **(env or {})))
    return sorted(os.listdir(root)), r.stdout + r.stderr


S = ['v10.35_20261012_051904', 'v10.35_20261012_053006', 'prev_20261012_053006', 'v10.85_20261024_033114',
     'v10.89_20261024_053820', 'v10.90_20261024_065348', 'notes.txt', 'backup', 'link_v1']
left, out = run(S, 'v10.90_20261024_065348', 'v10.89_20261024_053820')
ok('② 지금 · 직전 판 남김 · 옛 판 4개 지움', {'v10.89_20261024_053820', 'v10.90_20261024_065348'} <= set(left)
   and not {'v10.35_20261012_051904', 'v10.35_20261012_053006', 'prev_20261012_053006', 'v10.85_20261024_033114'} & set(left), ' '.join(left))
ok('② 파일 · 다른 이름 폴더 · 바로가기는 그대로', {'notes.txt', 'backup', 'link_v1'} <= set(left), '')
ok('② 출력 — 「옛 판 4개 정리」 · 남긴 판 이름', '옛 판 4개 정리' in out and 'v10.90_20261024_065348' in out and 'v10.89_20261024_053820' in out, out.strip()[:200])
left, out = run(S[:6], 'v10.90_20261024_065348', '')
ok('③ 직전 판이 없으면 지금 판만 남김', left == ['v10.90_20261024_065348'], ' '.join(left))
left, out = run(S[:6], 'v10.90_20261024_065348', 'v10.89_20261024_053820', {'KEEP_OLD_RELEASES': '1'})
ok('③ KEEP_OLD_RELEASES=1 — 아무것도 안 지움', len(left) == 6 and '건너뜀' in out, out.strip())
left, out = run(S[:6], '/tmp', 'v10.89_20261024_053820')
ok('③ 지금 판이 보관 폴더 밖이면 아무것도 안 지움', len(left) == 6, ' '.join(left))
left, out = run(['v10.90_20261024_065348'], 'v10.90_20261024_065348', '')
ok('③ 정리할 것 없음 — 안내만', left == ['v10.90_20261024_065348'] and '정리할 옛 판 없음' in out, out.strip())

_v = tuple(int(x) for x in re.findall(r'\d+', rd('VERSION')))
ok('VERSION v10.91 이상', _v >= (10, 91), '.'.join(map(str, _v)))
bad = [x for x in RES if not x[0]]
print(f'\n결과 — 통과 {len(RES) - len(bad)} · 실패 {len(bad)}')
raise SystemExit(1 if bad else 0)
