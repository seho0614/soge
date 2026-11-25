#!/usr/bin/env python3
"""e2.1 (docs/006) 소개뱅크 → ERP 표 구조 뽑기 — 소개뱅크 마이그레이션을 모두 넣은 **버리는 DB** 에서 ERP 표만 골라
ERP 마이그레이션 두 개를 만듭니다(다시 돌리면 같은 결과).

  SRC_DB=postgresql://…/sgb_gen python3 tools/gen-erp-schema.py [--out prisma/migrations] [--check]

  E004_core_tables/migration.sql  표 · 순번 · 기본값 · 색인 · 제약 · 트리거 · 함수 · 조회(ERP 표만 쓰는 것)
  E005_core_seed/migration.sql    소개뱅크 마이그레이션이 넣어 둔 처음 자료(계정과목 · 양식 등) — 회원 자료 아님
  docs/e2-fk-dropped.tsv          지운 외래 키(소개뱅크 표를 가리키던 것 — 번호 칸만 남김 · e2.3 에서 코드로 확인)
  docs/e2-svc-refs.tsv            함수 · 조회 안에서 소개뱅크 표를 읽는 곳(e2.3 에서 svc. 로 바꿀 목록)

  - 운영 · 확인판 · RDS 에는 쓰지 않음: SRC_DB 가 데이터베이스 sgb 이거나 5432(확인판) · rds 주소면 멈춤
  - 읽기만(SELECT · pg_dump -s · --data-only)
  - --check : 파일을 쓰지 않고 지금 파일과 같은지만 비교(같으면 0 · 다르면 1)
"""
import os, re, subprocess, sys

PREFIXES = ('acct', 'hr', 'hra', 'hrx', 'ofc', 'qlt', 'lgl', 'its', 'prr', 'sal')
# 설계서 4-2 — 회사 문서는 ERP 로 옮김(접두어가 다른 표)
EXTRA = ('corp_docs', 'corp_doc_versions')

SRC = os.environ.get('SRC_DB', '')
args = sys.argv[1:]
OUT = args[args.index('--out') + 1] if '--out' in args else os.path.join(os.path.dirname(__file__), '..', 'prisma', 'migrations')
DOCS = os.path.join(os.path.dirname(__file__), '..', 'docs')
CHECK = '--check' in args

if not SRC or re.search(r'/sgb(\?|$)', SRC) or ':5432/' in SRC or 'rds.amazonaws.com' in SRC:
    print('SRC_DB 는 버리는 DB(예: …:15432/sgb_gen)로 주십시오 — sgb · 확인판 · RDS 는 쓰지 않습니다'); sys.exit(2)


def psql(sql):
    r = subprocess.run(['psql', SRC, '-X', '-q', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-c', sql],
                       capture_output=True, text=True)
    if r.returncode:
        print(r.stderr.strip()[:400]); sys.exit(1)
    return [ln.split('\t') for ln in r.stdout.splitlines() if ln]


def unhex(h):
    return bytes.fromhex(h).decode('utf-8')


def dump(extra):
    r = subprocess.run(['pg_dump', SRC, '--no-owner', '--no-privileges', '--no-comments', '-n', 'public'] + extra,
                       capture_output=True, text=True)
    if r.returncode:
        print(r.stderr.strip()[:400]); sys.exit(1)
    return r.stdout


rx = '^(' + '|'.join(PREFIXES) + ')_'
tables = sorted(t for (t,) in psql(
    f"SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
    f"WHERE n.nspname = 'public' AND c.relkind IN ('r','p') "
    f"AND (c.relname ~ '{rx}' OR c.relname IN ({','.join(repr(e) for e in EXTRA)}))"))
TS = set(tables)
core_tables = {t for (t,) in psql(
    "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
    "WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')")} - TS

# ---------- 표 구조 ----------
tflags = sum((['-t', f'public.{t}'] for t in tables), [])
ddl = dump(['-s'] + tflags)
ddl = '\n'.join(ln for ln in ddl.splitlines()
                if not ln.startswith(('--', 'SET ', 'SELECT pg_catalog.set_config', '\\restrict', '\\unrestrict')))

# 외래 키: 소개뱅크 표를 가리키면 지움(목록에 적음) · ERP 표끼리는 그대로
fk_dropped = []
def fk_sub(m):
    tbl, con, cols, ref = m.group(1), m.group(2), m.group(3), m.group(4)
    if ref in TS:
        return m.group(0)
    fk_dropped.append((tbl, con, cols, ref))
    return ''
ddl = re.sub(r'ALTER TABLE ONLY public\.(\w+)\s+ADD CONSTRAINT (\w+) FOREIGN KEY \(([^)]*)\) REFERENCES public\.(\w+)\([^;]*;\n?',
             fk_sub, ddl)

# ---------- 함수 ----------
funcs = {}
for oid, name, body in psql(
        "SELECT p.oid, p.proname, encode(convert_to(pg_get_functiondef(p.oid), 'UTF8'), 'hex') "
        "FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
        "WHERE n.nspname = 'public' AND p.prokind = 'f' "
        "AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')"):
    funcs[oid] = (name, unhex(body))

def refs_in(text):
    return {w for w in re.findall(r'\b([a-z_][a-z0-9_]*)\b', text.lower())}

need, todo = set(), [ddl]
# ERP 표를 쓰는 함수 + 트리거 · 기본값 · 제약이 부르는 함수(닫힘)
for oid, (n, b) in funcs.items():
    if refs_in(b) & TS:
        need.add(oid); todo.append(b)
names = {}
for oid, (n, _) in funcs.items():
    names.setdefault(n, set()).add(oid)
while todo:
    words = refs_in(todo.pop())
    for w in words & set(names):
        for oid in names[w] - need:
            need.add(oid); todo.append(funcs[oid][1])

# 소개뱅크 표만 쓰는 함수가 ERP 표를 건드리면(소개뱅크 → ERP 쓰기) — 옮기지 않고 목록에만

# e2.3 (docs/008) 소개뱅크 표 이름을 svc. 로 — 읽기(FROM · JOIN)만 바꿈 · 쓰기(INSERT INTO · UPDATE · DELETE FROM)는 그대로 두고 목록에 'write'
#   (svc 는 읽기 전용 · 쓰기는 E3 알림 outbox · 내부 API 로 옮길 대상)
def to_svc(body, core):
    writes = set()
    for t in core:
        for m in re.finditer(r'(?i)\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:public\.)?' + re.escape(t) + r'\b', body):
            writes.add(t)
        body = re.sub(r'(?i)(?<!DELETE )\b(FROM|JOIN)(\s+)(?:public\.)?' + re.escape(t) + r'\b(?!\s*\()', lambda m: f'{m.group(1)}{m.group(2)}svc.{t}', body)
    return body, writes

svc_refs = []
fn_sql = []
for oid in sorted(need, key=lambda o: (funcs[o][0], o)):
    n, b = funcs[oid]
    core = sorted(refs_in(b) & core_tables)
    b, w = to_svc(b, core)
    for t in core:
        svc_refs.append(('write' if t in w else 'function', n, t))
    fn_sql.append(b.rstrip().rstrip(';') + ';')

# ---------- 조회(view) ----------
views = psql(
    "SELECT DISTINCT v.relname, encode(convert_to(pg_get_viewdef(v.oid, true), 'UTF8'), 'hex') FROM pg_class v "
    "JOIN pg_namespace n ON n.oid = v.relnamespace "
    "JOIN pg_depend d ON d.classid = 'pg_rewrite'::regclass "
    "JOIN pg_rewrite rw ON rw.oid = d.objid AND rw.ev_class = v.oid "
    "JOIN pg_class t ON t.oid = d.refobjid "
    f"WHERE n.nspname = 'public' AND v.relkind = 'v' AND (t.relname ~ '{rx}' OR t.relname IN ({','.join(repr(e) for e in EXTRA)}))")
view_sql = []
svc_view_sql = []   # svc 를 읽는 조회 — 마이그레이션이 아니라 tools/erp-svc.sh 가 svc 를 만든 뒤 prisma/svc-views.sql 로
for vname, vdef in sorted(views):
    vdef = unhex(vdef)
    core = sorted(refs_in(vdef) & core_tables - {vname})
    vdef, w = to_svc(vdef, core)
    for t in core:
        svc_refs.append(('view', vname, t))
    # 조회는 서로를 부를 수 있어 모두 뒤에 · 소개뱅크 표는 svc. 로(e2.3) — svc 는 E004 뒤 tools/erp-svc.sh 가 만들므로 조회는 E007 로 따로 냄
    (svc_view_sql if core else view_sql).append(f'CREATE OR REPLACE VIEW public.{vname} AS\n{vdef.rstrip().rstrip(";")};')

# ---------- 처음 자료 ----------
seed = dump(['--data-only', '--inserts', '--column-inserts'] + tflags)
# 값 안에 줄바꿈이 있는 INSERT 가 있어 줄 단위로 고르지 않고 머리 · 설정 줄만 뺌(11/25 E005 문법 오류)
seed = '\n'.join(ln for ln in seed.splitlines()
                 if not ln.startswith(('--', 'SET ', 'SELECT pg_catalog.set_config', '\\restrict', '\\unrestrict'))).strip()

exts = sorted({e for (e,) in psql("SELECT extname FROM pg_extension WHERE extname <> 'plpgsql'")}
              & ({'citext', 'pgcrypto', 'btree_gist', 'pg_trgm'} | ({'pg_bigm'} if 'gin_bigm_ops' in ddl else set())))

head = f"""-- E004 소개뱅크 → ERP 표 구조 (tools/gen-erp-schema.py 가 만듦 · 손으로 고치지 않음 · docs/006)
-- 표 {len(tables)} · 함수 {len(fn_sql)} · 조회 {len(view_sql)} · 지운 외래 키 {len(fk_dropped)}(docs/e2-fk-dropped.tsv)
SET check_function_bodies = off;
SET search_path = public;
""" + ''.join(f'CREATE EXTENSION IF NOT EXISTS {e};\n' for e in exts)
e004 = head + '\n-- ===== 함수 =====\n' + '\n\n'.join(fn_sql) + '\n\n-- ===== 표 =====\n' + ddl.strip() + \
       '\n\n-- ===== 조회 =====\n' + '\n\n'.join(view_sql) + '\n'
e005 = ('-- E005 소개뱅크 마이그레이션이 넣은 처음 자료(tools/gen-erp-schema.py · 회원 자료 아님 · docs/006)\n'
        '-- 트리거(쌓기만 · 소개뱅크 표 확인)를 건너뛰려고 replica — RDS 는 마스터 사용자로(확인 필요)\n'
        "SET session_replication_role = replica;\nSET search_path = public;\n" + seed + '\nSET session_replication_role = origin;\n')
fk_tsv = 'table\tconstraint\tcolumns\treferences\n' + ''.join('\t'.join(r) + '\n' for r in sorted(fk_dropped))
svc_tsv = 'kind\tname\tcore_table\n' + ''.join('\t'.join(r) + '\n' for r in sorted(set(svc_refs)))

files = {os.path.join(OUT, 'E004_core_tables', 'migration.sql'): e004,
         os.path.join(OUT, 'E005_core_seed', 'migration.sql'): e005,
         os.path.join(OUT, '..', 'svc-views.sql'): '-- svc 를 읽는 조회(tools/gen-erp-schema.py 가 만듦 · tools/erp-svc.sh 가 svc 를 가져온 뒤 실행 · docs/008)\nSET search_path = public;\n' + '\n\n'.join(svc_view_sql) + '\n',
         os.path.join(DOCS, 'e2-fk-dropped.tsv'): fk_tsv,
         os.path.join(DOCS, 'e2-svc-refs.tsv'): svc_tsv}
diff = 0
for p, body in files.items():
    old = open(p, encoding='utf-8').read() if os.path.exists(p) else None
    if CHECK:
        if old != body:
            diff += 1; print(f'다름  {p}')
        continue
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w', encoding='utf-8') as f:
        f.write(body)
print(f'== 표 {len(tables)} · 함수 {len(fn_sql)} · 조회 {len(view_sql)} + svc 조회 {len(svc_view_sql)} · 지운 외래 키 {len(fk_dropped)} · '
      f'소개뱅크 표 읽는 곳 {len(set(svc_refs))} · 처음 자료 {seed.count("INSERT INTO")}줄')
sys.exit(1 if diff else 0)
