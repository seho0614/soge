"""v10.82 시험 — 오픈 직전 정리 스크립트(deploy/aws/open-prep.sh · docs/136)

  KIT=… python3 -I test_v1082.py
"""
import os, re, subprocess

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


rd = lambda rel: open(os.path.join(K, rel), encoding='utf-8').read() if os.path.exists(os.path.join(K, rel)) else ''
S = rd('deploy/aws/open-prep.sh')
sql = S[S.find("<<'SQL'"):S.find('\nSQL\n')]
ok('기본은 읽기만(check) · apply 는 소문자 yes 를 받아야', 'MODE="${1:-check}"' in S and '[ "$yn" = "yes" ] || { say "  멈춤' in S
   and S.find('if [ "$MODE" = check ]') < S.find('read -r yn'), '')
ok('시험 자료는 @t.local 계정과 그 계정의 것만', "CREATE TEMP TABLE t_acc ON COMMIT DROP AS SELECT id FROM accounts WHERE email LIKE '%@t.local';" in sql
   and sql.count('IN (SELECT id FROM t_acc)') == 5, sql.count('IN (SELECT id FROM t_acc)'))
ok('지우는 문장 없음 · 한 거래', not re.search(r'\b(DELETE|TRUNCATE|DROP TABLE)\b', sql) and 'BEGIN;' in sql and sql.rstrip().endswith('COMMIT;'), '')
ok('정지 · 보관 · 감춤만', "SET status = 'SUSPENDED'" in sql and sql.count("SET status = 'ARCHIVED'") == 2 and "hidden_reason = '오픈 전 시험 글 정리'" in sql
   and "UPDATE post_comments SET state = 'HIDDEN'" in sql, '')
ok('다시 돌려도 같은 결과(이미 바뀐 것은 건너뜀)', "AND status = 'ACTIVE'" in sql and sql.count("AND status <> 'ARCHIVED'") == 2 and "state IN ('PUBLISHED','PENDING')" in sql, '')
ok('메인 내용 모드 · 오픈 차단을 봄', 'HOME_CONTENT' in S and 'v_open_blockers' in S, '')
ok('.env 는 앱 폴더 것을 load_env 로(값을 화면에 내지 않음 · HOME_CONTENT 만)', 'load_env "$APP_LINK/.env"' in S and 'DATABASE_URL' not in S.split('say')[-1], '')
r = subprocess.run(['bash', '-n', os.path.join(K, 'deploy/aws/open-prep.sh')], capture_output=True, text=True)
ok('셸 문법', r.returncode == 0, r.stderr[:100])
ok('실행 권한', os.access(os.path.join(K, 'deploy/aws/open-prep.sh'), os.X_OK), '')
ok('작업 문서 docs/136 — 리허설 · 체크리스트', '## 3. 오픈 직전 체크리스트' in rd('docs/136_오픈직전정리_open-prep_v10.82_20261023.md'), '')
ok('VERSION v10.82 이상', re.match(r'v10\.(8[2-9]|9\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
