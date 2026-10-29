"""v10.152 시험 — 적용 뒤 확인 자동화(postcheck [10]) · 회귀 결과 집계(reg_tally.py) · 운영 적용 절차서 docs/232 — 서버에서 직접(bash · psql)

  KIT=<kit> DB=postgresql://sgb:sgb@localhost:15432/sgb python3 -I test_v1152.py

  ① 코드 — postcheck [10] 항목 · 읽기만(UPDATE · INSERT · DELETE 없음) · 약관 초안은 「게시된 판보다 새 번호」로(만든 시각 칸 없음) · docs/232(17 · 183 · 스냅샷 · 킷 release · 자동 11곳) · docs/226 대신 · 판
  ② (점검판 DB) [10] 블록을 lib.sh 로 그대로 돌림 — 실패 0 · 연동 키 22 · 9줄 · 처리방침 확인 on · 새 초안 없음 → 거래 안에서 새 번호 초안을 넣으면 「확인」에 그 판 · 되돌림
  ③ reg_tally.py — 모두 통과 로그는 0 · 실패 한 줄 · 결과 줄 없음 · 수 모자람은 1
"""
import os, re, subprocess, sys, tempfile

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
DB = os.environ.get('DB')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
PC = rd('deploy/aws/postcheck.sh')
blk = PC[PC.find('[10] 이번 판에서 바뀐 것'):PC.find('적용 후 확인 — 통과')]
ok('① postcheck [10] — 키 칸 · 방식 7개 · 템플릿 · 9줄 · 처리방침 확인 · 오픈일 · 처리방침 판 · 새 초안 · 파일 저장 · 파일 행 지킴',
   blk and "conname = 'ck_integ_secret_name'" in blk and all(k in blk for k in ('identity.provider=STUB', 'alimtalk.provider=NONE', 'esign.provider=STUB', 'safenum.provider=NONE', 'feature.referral_fee=off', 'agent.enabled=off'))
   and 'alimtalk_templates' in blk and '"9/4"' in blk and "agent.require_privacy" in blk and "service.open_date" in blk
   and "ARRAY[1,1]" in blk and "string_to_array(p.version, '.')::int[] < string_to_array(d.version, '.')::int[]" in blk and 'sgb.files_move' in blk, '')
ok('① [10] 은 읽기만 — UPDATE · INSERT · DELETE · ALTER 없음 · 만든 시각 칸(created_at)을 쓰지 않음',
   blk and not re.search(r'\b(UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE)\b', blk) and 'created_at' not in blk, '')
F232 = next((f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('232_')), '')
D232 = rd('docs/' + F232) if F232 else ''
ok('① docs/232 — v10.128 → v10.152 · 17 · 183 · 스냅샷 v10-152 · 킷 ~/kits/release · [10] 자동 11곳 · 하지 말 것',
   'v10.152' in F232 and '`적용됨 166 · 새 킷의 파일 183 · 올릴 것 17 · 바뀐 파일 0`' in D232 and '`적용 17 · 기존 166 · 변경감지 0`' in D232
   and 'sgb-before-v10-152' in D232 and '~/kits/release/' in D232 and '13 · 15 · 16 · 17 · 19 · 22 · 26 · 27 · 28 · 29 · 30 번' in D232
   and '`files-to-s3.sh`' in D232 and '게시하지 말고' in D232, F232)
ok('① docs/226 맨 위 — docs/232 로 대신', 'docs/232(v10.128 → v10.152)로 합니다' in next((rd('docs/' + f) for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('226_')), ''), '')
ok('① 판 v10.152 이상', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 152), rd('VERSION').strip())

# ── ② 점검판 DB 로 [10] 블록 ──────────────────────────────────────────
if DB and blk:
    tmp = tempfile.mkdtemp(prefix='v1152_', dir=os.environ.get('TMPDIR') or None)
    part = os.path.join(tmp, 'pc10.sh')
    start = PC.find('say ""; say "[10]')
    open(part, 'w', encoding='utf-8').write(PC[start:PC.find('\nsay ""\nsay "적용 후 확인')] + '\necho "PASS=$PASS FAIL=$FAIL WARN=$WARN"\n')
    run = lambda: subprocess.run(['bash', '-c', f'. ./lib.sh; PASS=0; FAIL=0; WARN=0; . {part}'], cwd=os.path.join(K, 'deploy/aws'),
                                 env=dict(os.environ, DATABASE_URL=DB), capture_output=True, text=True, timeout=120)
    r = run(); out = r.stdout
    ok('② [10] 블록 — 오류 없이 끝 · 실패 0', r.returncode == 0 and 'FAIL=0' in out and 'ERROR' not in (r.stderr or ''), out.strip().splitlines()[-1] if out.strip() else r.stderr[:160])
    ok('② 연동 키 칸 22 · 9줄 · 처리방침 확인 on · 파일 행 지킴 통과', all(x in out for x in ('통과  연동 키 칸 22개', '통과  오픈 준비 점검 9줄 · 꼭 4', '통과  AI 켜기 전 처리방침 확인 = on', '통과  파일 행 지킴')), '')
    ok('② 새 번호 초안 없음 → 통과', '통과  게시된 판보다 새 번호의 약관 초안 없음' in out, '')
    psql = lambda sql: subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True).stdout.strip()
    # 거래 안에서 처리방침 새 번호(9.9) 법무 검토 판을 넣고 같은 조회를 돌림 → 되돌림(ROLLBACK)
    q = ("SELECT d.code || ' ' || d.version || ' ' || d.status FROM terms d WHERE d.status IN ('DRAFT', 'LEGAL_REVIEW') AND EXISTS (SELECT 1 FROM terms p WHERE p.code = d.code "
         "AND p.status = 'PUBLISHED' AND string_to_array(p.version, '.')::int[] < string_to_array(d.version, '.')::int[])")
    got = subprocess.run(['psql', DB, '-X', '-q', '-At', '-c',
                          "BEGIN; INSERT INTO terms (code, version, title, body, is_required, effective_from, status, display_order) SELECT code, '9.9', title, body, is_required, effective_from, 'LEGAL_REVIEW', display_order FROM terms WHERE code = 'PRIVACY' AND status = 'PUBLISHED' LIMIT 1;",
                          '-c', q + ';', '-c', 'ROLLBACK;'], capture_output=True, text=True).stdout
    ok('② 게시된 판보다 새 번호 초안을 넣으면 그 판이 잡힘 · 되돌림', 'PRIVACY 9.9 LEGAL_REVIEW' in got and psql("SELECT count(*) FROM terms WHERE version = '9.9'") == '0', got.strip()[:80])

# ── ③ reg_tally.py ──────────────────────────────────────────────────
T = os.path.join(HERE, 'reg_tally.py')
def tally(text, *args):
    f = tempfile.NamedTemporaryFile('w', suffix='.log', delete=False, encoding='utf-8', dir=os.environ.get('TMPDIR') or None); f.write(text); f.close()
    r = subprocess.run([sys.executable, '-I', T, f.name, *args], capture_output=True, text=True); os.unlink(f.name); return r
good = 'test_v1.py | 결과: 3 / 3\ntest_v2.py | 결과 — 통과 5 · 실패 0\n'
ok('③ 모두 통과 → 끝 코드 0 · 집계 줄', tally(good, '--expect', '2').returncode == 0 and '모두 통과 2 · 실패 0' in tally(good).stdout, '')
ok('③ 한 줄 실패(12 / 13) → 1 · 그 줄 이름', (r := tally(good + 'test_v3.py | 결과: 12 / 13\n')).returncode == 1 and 'test_v3.py — 12 / 13' in r.stdout, '')
ok('③ 「통과 18 · 실패 1」 모양도 실패로', tally(good + 'test_v4.py | 결과 — 통과 18 · 실패 1\n').returncode == 1, '')
ok('③ 결과 줄 없음(멈춤) → 실패', (r := tally(good + 'test_v5.py | \n')).returncode == 1 and '결과 줄 없음' in r.stdout, '')
ok('③ 시험 수가 기대보다 적으면 실패', (r := tally(good, '--expect', '61')).returncode == 1 and '수가 모자람' in r.stdout, '')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
