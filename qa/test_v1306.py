"""v10.306 (docs/428) — 절차서 postcheck 기대값을 리허설로 셈 시험 · 서버에서(HOST · 도커)
  KIT=<kit> python3 test_v1306.py          (Q = 이 qa 폴더 · 도구는 ../tools)

  ① (코드) postcheck.sh POSTCHECK_DB_ONLY(DATABASE_URL · APP_DIR · [1] · [2] · [4] ~ [8] · 파일 백업 · [11] 건너뜀 · 보통 실행은 그대로) ·
     mig-rehearsal.sh(새 킷에 DB 방식이 있으면 ② 뒤 · ③ 뒤 · pc_before · pc_after · pc_new_warn …) · ops-doc-draft.py --postcheck-base · 문서 428 · 판 v10.306
  ② (실행) DB 방식에 DATABASE_URL 없으면 종료 2
  ③ (실행 · 진짜 release 킷 + 이 킷 postcheck + 처리방침 새 초안을 넣는 마이그레이션) 리허설 → 「확인」 하나 생김(pc_new_warn) ·
     초안 도구 --postcheck-base 54/0/5 → 「통과 53 · 실패 0 · 확인 6」 · 생긴 줄 · 형식 틀리면 멈춤 · 옛 postcheck 킷이면 pc_skip · 남은 컨테이너 없음
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


PC = rd(os.path.join(K, 'deploy/aws/postcheck.sh'))
MR, OD = rd(os.path.join(TOOLS, 'mig-rehearsal.sh')), rd(os.path.join(TOOLS, 'ops-doc-draft.py'))
VER = rd(os.path.join(K, 'VERSION')).strip()
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []
D428 = next((rd(os.path.join(K, 'docs', x)) for x in docs if x.startswith('428_')), '')
ok('① postcheck.sh — POSTCHECK_DB_ONLY · DATABASE_URL · APP_DIR · 건너뛰는 곳 3 · 보통 실행 그대로(.env · 결과 파일)',
   'DBO="${POSTCHECK_DB_ONLY:-0}"' in PC and PC.count('if [ "$DBO" != "1" ]; then') == 3 and 'APP="$APP_DIR"; OUT=""; SKIP_EGRESS_CHECK=1' in PC
   and 'load_env "$APP/.env" ||' in PC and 'OUT="$DATA_DIR/logs/postcheck_$(date +%Y%m%d_%H%M%S).txt"' in PC
   and PC.find('if [ "$DBO" != "1" ]; then') < PC.find('say ""; say "[1] 프로세스 (pm2)"') and PC.find('say ""; say "[3] DB"') < PC.find('say ""; say "[4] 사용자 웹"'), '')
ok('① 리허설 · 초안 도구 — DB 방식 있으면 ② 뒤 · ③ 뒤 · pc_ 줄 · pc_skip · --postcheck-base · 문서 428 · 판 v10.306',
   "grep -q 'POSTCHECK_DB_ONLY' \"$N/deploy/aws/postcheck.sh\"" in MR and '[ "$PCDB" = 1 ] && PCB=$(pcdb "$O")' in MR and '[ "$PCDB" = 1 ] && PCA=$(pcdb "$N")' in MR
   and 'r "pc_before=$(pcsum "$PCB")"' in MR and 'pc_skip=' in MR and "ap.add_argument('--postcheck-base'" in OD and 'def postcheck_expect(reh, base):' in OD
   and 'POSTCHECK_DB_ONLY' in D428 and '--postcheck-base' in D428 and tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 306), VER)

e = subprocess.run(['bash', os.path.join(K, 'deploy/aws/postcheck.sh')], capture_output=True, text=True, env={**os.environ, 'POSTCHECK_DB_ONLY': '1', 'DATABASE_URL': '', 'APP_DIR': K})
ok('② DB 방식에 DATABASE_URL 없으면 종료 2 · 안내', e.returncode == 2 and 'DATABASE_URL' in e.stdout, f'{e.returncode} {e.stdout.strip()[:80]}')


def leftovers():
    ps = subprocess.run(['docker', 'ps', '-a', '--format', '{{.Names}}'], capture_output=True, text=True).stdout.split()
    nets = subprocess.run(['docker', 'network', 'ls', '--format', '{{.Name}}'], capture_output=True, text=True).stdout.split()
    return [x for x in ps + nets if x.startswith('sgb-mreh-')]


tmp = tempfile.mkdtemp(prefix='t1306_')
try:
    rel = sorted([x for x in os.listdir(os.path.expanduser('~/kits/release')) if re.fullmatch(r'SGB_DevDocker_Integrated_\d+_v10_\d+\.zip', x)],
                 key=lambda x: int(re.search(r'_v10_(\d+)\.zip$', x).group(1))) if os.path.isdir(os.path.expanduser('~/kits/release')) else []
    if not rel or not PC:
        ok('③ release 킷 · 이 킷 postcheck — 없음(건너뛸 수 없음)', False, f'{rel[-1:]} · postcheck {bool(PC)}')
    else:
        base = os.path.join(os.path.expanduser('~/kits/release'), rel[-1])
        bv = int(re.search(r'_v10_(\d+)\.zip$', rel[-1]).group(1))

        def newkit(tag, pc_body):
            nv = bv + 1
            name = f'SGB_DevDocker_Integrated_20261002_v10_{nv}'
            z = os.path.join(tmp, f'{tag}.zip')
            with zipfile.ZipFile(base) as src, zipfile.ZipFile(z, 'w') as dst:
                for it in src.infolist():
                    parts = it.filename.split('/', 1)
                    if len(parts) < 2 or it.is_dir() or not re.match(r'sgb/(prisma/|scripts/|deploy/|VERSION$)', parts[1]):
                        continue
                    data = src.read(it)
                    if parts[1] == 'sgb/VERSION':
                        data = f'v10.{nv}\n'.encode()
                    if parts[1] == 'sgb/deploy/aws/postcheck.sh' and pc_body is not None:
                        data = pc_body.encode()
                    dst.writestr(f'{name}/{parts[1]}', data)
                dst.writestr(f'{name}/sgb/prisma/migrations/D999_t1306/migration.sql',
                             "INSERT INTO terms (code, version, title, body, status, effective_from, is_required, display_order) "
                             "SELECT code, '9.9', title, body, 'DRAFT', 'infinity', is_required, display_order FROM terms "
                             "WHERE code = 'PRIVACY' AND status = 'PUBLISHED' AND NOT EXISTS (SELECT 1 FROM terms WHERE code = 'PRIVACY' AND version = '9.9') LIMIT 1;\n")
            return z

        good = newkit('good', PC)
        old = newkit('old', None)   # release 킷 postcheck 그대로(DB 방식이 없던 판이면 pc_skip)
        r1 = subprocess.run(['bash', os.path.join(TOOLS, 'mig-rehearsal.sh'), base, good, '-o', os.path.join(tmp, 'r1.txt')], capture_output=True, text=True, timeout=900)
        t1 = rd(os.path.join(tmp, 'r1.txt'))
        kv = [l.split('=', 1) for l in t1.splitlines() if '=' in l and not l.startswith('#')]
        get = lambda k: [v for k_, v in kv if k_ == k]
        pb, pa, nw = (get('pc_before') or [''])[0], (get('pc_after') or [''])[0], get('pc_new_warn')
        ok('③ 리허설 — 적용 1 · 통과 · pc_before → pc_after 확인 +1 · 생긴 확인 줄 「게시된 판보다 새 번호의 약관 초안: PRIVACY 9.9 DRAFT」',
           r1.returncode == 0 and 'result=통과' in t1 and re.search(r'확인 (\d+)', pa) and re.search(r'확인 (\d+)', pb)
           and int(re.search(r'확인 (\d+)', pa).group(1)) == int(re.search(r'확인 (\d+)', pb).group(1)) + 1
           and nw == ['게시된 판보다 새 번호의 약관 초안: PRIVACY 9.9 DRAFT'], f'{r1.returncode} · {pb} → {pa} · {nw} · {r1.stderr.strip()[-120:]}')
        d1 = subprocess.run([sys.executable, '-I', os.path.join(TOOLS, 'ops-doc-draft.py'), base, good, '--rehearsal', os.path.join(tmp, 'r1.txt'),
                             '--postcheck-base', '54/0/5', '--doc', '999', '-o', os.path.join(tmp, 'd1.md')], capture_output=True, text=True, timeout=600)
        md = rd(os.path.join(tmp, 'd1.md'))
        line = next((l for l in md.splitlines() if l.startswith('| postcheck 기대 |')), '')
        d2 = subprocess.run([sys.executable, '-I', os.path.join(TOOLS, 'ops-doc-draft.py'), base, good, '--rehearsal', os.path.join(tmp, 'r1.txt'),
                             '--postcheck-base', '54-0-5', '-o', os.path.join(tmp, 'd2.md')], capture_output=True, text=True, timeout=600)
        ok('③ 초안 도구 --postcheck-base 54/0/5 → 「통과 53 · 실패 0 · 확인 6」 · 생긴 줄 · 리허설 차이 · 형식 틀리면 멈춤',
           d1.returncode == 0 and '**통과 53 · 실패 0 · 확인 6**' in line and '확인 생김 「게시된 판보다 새 번호의 약관 초안: PRIVACY 9.9 DRAFT」' in line
           and '-1 · +0 · +1' in line and d2.returncode != 0 and '--postcheck-base' in (d2.stderr + d2.stdout), f'{d1.returncode} · {line[:200]} · {d2.returncode}')
        r2 = subprocess.run(['bash', os.path.join(TOOLS, 'mig-rehearsal.sh'), base, old, '-o', os.path.join(tmp, 'r2.txt')], capture_output=True, text=True, timeout=900)
        t2 = rd(os.path.join(tmp, 'r2.txt'))
        old_has = 'POSTCHECK_DB_ONLY' in zipfile.ZipFile(base).read(next(n for n in zipfile.ZipFile(base).namelist() if n.endswith('sgb/deploy/aws/postcheck.sh'))).decode('utf-8', 'ignore')
        lo = leftovers()
        ok('③ release 킷 postcheck 그대로인 새 킷 — DB 방식이 없던 판이면 pc_skip(있으면 pc_before) · 리허설은 통과 · 남은 컨테이너 · 네트워크 없음',
           r2.returncode == 0 and 'result=통과' in t2 and (('pc_before=' in t2) if old_has else ('pc_skip=' in t2 and 'pc_before=' not in t2)) and not lo,
           f'{r2.returncode} · 옛 킷 DB 방식 {old_has} · {[l for l in t2.splitlines() if l.startswith("pc_")][:2]} · {lo}')
finally:
    shutil.rmtree(tmp, ignore_errors=True)
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
