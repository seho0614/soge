"""ERP e2.1 ~ e2.4 (docs/006 ~ 009) 점검판 DB — 표 구조 · svc 외부 표 · 번호 확인 · 복사 대조
  python3 qa/test_e2_board.py            (점검판 DB 컨테이너 sgb-db 안 sgb · sgb_erp 만 · 확인판 · RDS 아님)
  ① 표 구조 — gen-erp-schema.py 가 만든 E004 표 수 = sgb_erp 표 수(ERP 접두어 · corp_docs) · 지운 외래 키 목록의 표는 외래 키 없음
                · ERP 표끼리 외래 키는 남음 · 다시 만들어도 같음(--check 는 SRC_DB 가 있을 때만)
  ② svc — svc 외부 표 수 = 목록 수 · svc.accounts 읽힘 · svc 쓰기 막힘 · erp_ro 는 소개뱅크 표에 INSERT 권한 없음
  ③ 번호 확인 — erp_ref_ok('account', 있는 번호) 참 · 없는 번호 거짓 · erp_ref_assert 없는 번호 ERP_REF_MISSING
  ④ 복사 — erp-copy.sh board 대조표 다른 표 0 · 계정과목 수 소개뱅크 = ERP · 두 번째는 ERP_COPY_DONE 로 멈춤(--force 없이)
"""
import os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
ENV = {**os.environ, 'DOCKER_HOST': os.environ.get('DOCKER_HOST', f'unix:///run/user/{os.getuid()}/docker.sock')}
RES = []
EDB = os.environ.get('ERP_DBNAME', 'sgb_erp')   # 점검판 ERP DB(시험용 sgb_erp_t 도)


def ok(name, cond, detail=''):
    RES.append(bool(cond)); print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def q(db, sql):
    r = subprocess.run(['docker', 'exec', '-i', 'sgb-db', 'psql', '-U', 'sgb', '-d', db, '-X', '-At', '-F', '\t', '-c', sql],
                       capture_output=True, text=True, env=ENV)
    return (r.stdout.strip() if r.returncode == 0 else 'ERR ' + r.stderr.strip()[:200])


def sh(*cmd):
    r = subprocess.run(list(cmd), capture_output=True, text=True, env=ENV, cwd=ROOT)
    return r.returncode, r.stdout + r.stderr


if subprocess.run(['docker', 'inspect', 'sgb-db'], capture_output=True, env=ENV).returncode:
    print('점검판 DB(sgb-db)가 없음 — 건너뜀'); print('결과: 0 / 0'); sys.exit(0)

RX = "^(acct|hr|hra|hrx|ofc|qlt|lgl|its|prr|sal)_|^corp_doc"
e004 = open(os.path.join(ROOT, 'prisma/migrations/E004_core_tables/migration.sql'), encoding='utf-8').read()
want = sorted(set(__import__('re').findall(r'^CREATE TABLE public\.(\w+)', e004, __import__('re').M)))

# ① 표 구조
have = q(EDB, f"SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename ~ '{RX}'")
src = q('sgb', f"SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename ~ '{RX}'")
ok('① E004 표 수 = sgb_erp = 소개뱅크', str(len(want)) == have == src, f'E004 {len(want)} · erp {have} · sgb {src}')
fk = [ln.split('\t') for ln in open(os.path.join(ROOT, 'docs/e2-fk-dropped.tsv'), encoding='utf-8').read().splitlines()[1:] if ln]
left = q(EDB, "SELECT count(*) FROM pg_constraint c JOIN pg_class r ON r.oid = c.confrelid "
                    f"WHERE c.contype = 'f' AND r.relname !~ '{RX}' AND r.relname !~ '^erp_'")   # erp_ 는 ERP 자기 표(E001 ~ E003)
inner = q(EDB, f"SELECT count(*) FROM pg_constraint WHERE contype = 'f'")
ok('① 소개뱅크 표를 가리키는 외래 키 0 · ERP 표끼리 외래 키는 남음', left == '0' and inner.isdigit() and int(inner) > 0,
   f'지운 {len(fk)} · 남은 소개뱅크 FK {left} · ERP 끼리 {inner}')
if os.environ.get('SRC_DB'):
    rc, out = sh('python3', 'tools/gen-erp-schema.py', '--check')
    ok('① 다시 만들어도 같음(--check)', rc == 0, out.strip().splitlines()[-1] if out.strip() else '')

# ② svc
n_list = len({ln.strip() for ln in open(os.path.join(ROOT, 'tools/svc-tables.txt'), encoding='utf-8') if ln.strip() and not ln.startswith('#')})
g = q(EDB, "SELECT count(*) FROM information_schema.foreign_tables WHERE foreign_table_schema = 'svc'")
a = q(EDB, 'SELECT count(*) FROM svc.accounts')
w = q(EDB, 'INSERT INTO svc.public_holidays SELECT * FROM svc.public_holidays LIMIT 0')
ins = q('sgb', "SELECT has_table_privilege('erp_ro', 'public.accounts', 'INSERT')")
ok('② svc 외부 표 · 읽기 · 쓰기 막힘 · erp_ro INSERT 권한 없음',
   g.isdigit() and int(g) >= n_list and a.isdigit() and w.startswith('ERR') and ins == 'f',
   f'svc {g}(목록 {n_list}+) · accounts {a} · 쓰기 {w[:40]} · INSERT {ins}')

# ③ 번호 확인
acc = q('sgb', 'SELECT id FROM accounts ORDER BY created_at LIMIT 1')
t1 = q(EDB, f"SELECT erp_ref_ok('account', '{acc}'::uuid)")
t2 = q(EDB, "SELECT erp_ref_ok('account', '00000000-0000-0000-0000-000000000000'::uuid)")
t3 = q(EDB, "SELECT erp_ref_assert('account', '00000000-0000-0000-0000-000000000000'::uuid)")
ok('③ 번호 확인 — 있음 참 · 없음 거짓 · assert ERP_REF_MISSING', t1 == 't' and t2 == 'f' and 'ERP_REF_MISSING' in t3, f'{t1} · {t2} · {t3[:60]}')

# ③-2 e2.3 — 함수 · 조회가 svc 로 소개뱅크 표를 읽음(공휴일 · 권한 · 결재 한도 조회)
f1 = q(EDB, "SELECT fn_is_business_day(current_date)")
f2 = q(EDB, f"SELECT fn_has_role('{acc}'::uuid, 'SUPER')")
f3 = q(EDB, "SELECT count(*) FROM v_acct_req_spend")
wr = [ln.split('\t') for ln in open(os.path.join(ROOT, 'docs/e2-svc-refs.tsv'), encoding='utf-8').read().splitlines()[1:] if ln.startswith('write')]
ok('③ svc 읽기 함수 · 조회 동작 · 쓰기 대상은 목록(E3)', f1 in ('t', 'f') and f2 in ('t', 'f') and f3.isdigit(),
   f'영업일 {f1} · 역할 {f2} · 결재 한도 조회 {f3} · 쓰기 {len(wr)}({", ".join(sorted({w[1] for w in wr}))})')

# ④ 복사
rc, out = sh('bash', 'tools/erp-copy.sh', 'board', '--force')
last = [ln for ln in out.splitlines() if ln.startswith(('  ②', '==', '  실패'))]
c1 = q('sgb', "SELECT count(*) FROM acct_accounts"); c2 = q(EDB, "SELECT count(*) FROM acct_accounts")
ok('④ 복사 · 대조 다른 표 0 · 계정과목 수 같음', rc == 0 and '다른 표 0' in out and c1 == c2, f'{" / ".join(last)[:160]} · 계정과목 {c1} = {c2}')
rc2, out2 = sh('bash', 'tools/erp-copy.sh', 'board')
ok('④ 두 번째 복사(--force 없이)는 멈춤', rc2 != 0 and 'ERP_COPY_DONE' in out2, out2.strip().splitlines()[-1][:100] if out2.strip() else '')

print(f'결과: {sum(RES)} / {len(RES)}')
sys.exit(0 if all(RES) else 1)
