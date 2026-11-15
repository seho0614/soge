"""v10.303 (docs/424) — 점검(realcheck)에 마이그레이션 리허설 넣기 시험 · 서버에서(HOST · 도커)
  KIT=<kit> python3 test_v1303.py          (Q = 이 qa 폴더 · 도구는 ../tools)

  ① (코드) tools/reh-check.sh(실행 권한 · 운영 킷 ~/kits/ops · SGB_OPS_KITS · 판 번호 큰 것 · mig-rehearsal.sh 그대로 · 종료 0/1/2 · 한 줄) ·
     qa/sgb-check.sh(realcheck 때만 · SGB_NO_REH · 킷의 tools/reh-check.sh · summary 끝에 한 줄 · 실패면 RC=1) · ~/sgb-check.sh 와 같음 ·
     옛 킷 정리 고리에 ~/kits/ops 없음 · README · 회귀 HOST · 문서 424 · 판 v10.303
  ② (실행) 운영 킷 폴더 비었음 → 「건너뜀」 0 · 쓰는 법 2
  ③ (실행 · 진짜 release 킷 + 그 킷에 마이그레이션 하나 더한 새 킷) 다시 돌려도 되는 것 → 「통과」 0 · rehearsal.txt result=통과 ·
     다시 돌리면 오류 나는 것 → 「[실패]」 1 · 같은 판 → 「못 함」 0 · 남은 컨테이너 · 네트워크 없음
"""
import os, re, shutil, subprocess, sys, tempfile, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.join(os.path.dirname(HERE), 'tools')
KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(p):
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


RC_SH = os.path.join(TOOLS, 'reh-check.sh')
RCS, SG = rd(RC_SH), rd(os.path.join(HERE, 'sgb-check.sh'))
HOME_SG = rd(os.path.expanduser('~/sgb-check.sh'))
RDM, RR = rd(os.path.join(TOOLS, 'README.md')), rd(os.path.join(HERE, 'run_regression.sh'))
VER = rd(os.path.join(K, 'VERSION')).strip()
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []
D424 = next((rd(os.path.join(K, 'docs', x)) for x in docs if x.startswith('424_')), '')
keep = SG[SG.find('# kits-keep-begin'):SG.find('# kits-keep-end')]
ok('① reh-check.sh — 실행 권한 · ~/kits/ops · SGB_OPS_KITS · 판 번호 큰 것(sort -V) · mig-rehearsal.sh · rehearsal.txt · 종료 0 · 1 · 2 · 건너뜀 · 못 함 · [실패]',
   os.access(RC_SH, os.X_OK) and 'D="${SGB_OPS_KITS:-$HOME/kits/ops}"' in RCS and 'sort -V | tail -1' in RCS and 'bash "$H/mig-rehearsal.sh" "$OPSK" "$NEW" -o "$OUT/rehearsal.txt"' in RCS
   and '건너뜀 — 운영 킷 없음' in RCS and '[실패] 리허설(운영 킷 → 새 킷)' in RCS and '못 함 —' in RCS and 'exit 2; }' in RCS and 'rds.' not in RCS and 'amazonaws' not in RCS, '')
ok('① sgb-check.sh — realcheck 때만 · SGB_NO_REH · 킷의 tools/reh-check.sh · summary 끝 · 실패면 RC=1 · ~/sgb-check.sh 와 같음 · 옛 킷 정리에 ops 없음 · README · 회귀 HOST · 문서 424 · 판 v10.303',
   '[ "$MODE" = realcheck ] && [ "${SGB_NO_REH:-0}" != 1 ] && [ -f tools/reh-check.sh ]' in SG and 'echo "$REH" >> "$RES/summary.txt"' in SG
   and '[ "$REHRC" = 1 ] && [ "$RC" = 0 ] && RC=1' in SG and SG.find('tools/reh-check.sh') < SG.find('bash dev.sh "$MODE"') and HOME_SG == SG
   and 'kits/ops' not in keep and 'for kd in ~/kits/out ~/kits/release' in keep and 'reh-check.sh' in RDM and 'test_v1303.py' in RR
   and 'reh-check.sh' in D424 and '~/kits/ops' in D424 and tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 303),
   f'{VER} · 집 사본 같음 {HOME_SG == SG}')


def run(args, env=None):
    p = subprocess.run(['bash', RC_SH, *args], capture_output=True, text=True, timeout=900, env={**os.environ, **(env or {})})
    return p.returncode, p.stdout.strip(), p.stderr.strip()


def leftovers():
    ps = subprocess.run(['docker', 'ps', '-a', '--format', '{{.Names}}'], capture_output=True, text=True).stdout.split()
    nets = subprocess.run(['docker', 'network', 'ls', '--format', '{{.Name}}'], capture_output=True, text=True).stdout.split()
    return [x for x in ps + nets if x.startswith('sgb-mreh-')]


tmp = tempfile.mkdtemp(prefix='t1303_')
try:
    empty = os.path.join(tmp, 'ops-empty'); os.makedirs(empty)
    c0, o0, _ = run(['/nonexistent.zip', os.path.join(tmp, 'o0')], {'SGB_OPS_KITS': empty})
    c1, o1, e1 = run([])
    ok('② 운영 킷 없음 → 「건너뜀」 종료 0 · 인자 없음 → 쓰는 법 종료 2', c0 == 0 and '건너뜀 — 운영 킷 없음' in o0 and c1 == 2 and '쓰는 법' in e1, f'{c0} {o0[:60]} · {c1}')

    rel = sorted([x for x in os.listdir(os.path.expanduser('~/kits/release')) if re.fullmatch(r'SGB_DevDocker_Integrated_\d+_v10_\d+\.zip', x)],
                 key=lambda x: int(re.search(r'_v10_(\d+)\.zip$', x).group(1))) if os.path.isdir(os.path.expanduser('~/kits/release')) else []
    if not rel:
        ok('③ release 킷 — 없음(건너뛸 수 없음)', False, '~/kits/release 에 킷이 없음')
    else:
        base = os.path.join(os.path.expanduser('~/kits/release'), rel[-1])
        bv = int(re.search(r'_v10_(\d+)\.zip$', rel[-1]).group(1))
        ops = os.path.join(tmp, 'ops'); os.makedirs(ops)
        shutil.copy(base, ops)

        def newkit(tag, body):
            nv = bv + 1
            name = f'SGB_DevDocker_Integrated_20261002_v10_{nv}'
            z = os.path.join(tmp, f'{tag}.zip')
            with zipfile.ZipFile(base) as src, zipfile.ZipFile(z, 'w') as dst:
                for it in src.infolist():
                    parts = it.filename.split('/', 1)
                    if len(parts) < 2 or not re.match(r'sgb/(prisma/|scripts/|deploy/|VERSION$)', parts[1]):
                        continue
                    data = src.read(it) if not it.is_dir() else b''
                    if parts[1] == 'sgb/VERSION':
                        data = f'v10.{nv}\n'.encode()
                    if not it.is_dir():
                        dst.writestr(f'{name}/{parts[1]}', data)
                dst.writestr(f'{name}/sgb/prisma/migrations/D999_t1303_{tag}/migration.sql', body)
            return z

        good = newkit('good', 'CREATE TABLE IF NOT EXISTS public.t1303_good (x int);\n')
        bad = newkit('bad', 'CREATE TABLE public.t1303_bad (x int);\n')
        c2, o2, _ = run([good, os.path.join(tmp, 'o2')], {'SGB_OPS_KITS': ops})
        r2 = rd(os.path.join(tmp, 'o2', 'rehearsal.txt'))
        ok('③ 다시 돌려도 되는 마이그레이션 → 「리허설(운영 킷 → 새 킷): … 적용 1 … 통과」 종료 0 · rehearsal.txt result=통과',
           c2 == 0 and o2.startswith('리허설(운영 킷 → 새 킷): v10.') and '적용 1 ·' in o2 and o2.endswith('통과') and 'result=통과' in r2, f'{c2} · {o2[:140]}')
        c3, o3, _ = run([bad, os.path.join(tmp, 'o3')], {'SGB_OPS_KITS': ops})
        c4, o4, _ = run([base, os.path.join(tmp, 'o4')], {'SGB_OPS_KITS': ops})
        lo = leftovers()
        ok('③ 다시 돌리면 오류 → 「[실패] 리허설 …」 종료 1 · 같은 판 → 「못 함」 종료 0 · 남은 컨테이너 · 네트워크 없음',
           c3 == 1 and o3.startswith('[실패] 리허설(운영 킷 → 새 킷):') and '다시 돌리면 오류' in o3 and c4 == 0 and '못 함 —' in o4 and not lo,
           f'{c3} {o3[:120]} · {c4} {o4[:80]} · {lo}')
finally:
    shutil.rmtree(tmp, ignore_errors=True)
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
