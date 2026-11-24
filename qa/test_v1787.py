"""v10.787 (docs/896) 큰 운영 반영 리허설 측정 — 시간 · 잠금 · 되돌리기
  서버(HOST) 시험 — sgb-infra tools/ 를 읽으므로 run_regression.sh HOST 목록에 있음
  ① tools/mig-measure.sh — 버리는 DB(자체 네트워크 · 포트 안 엶 · 끝나면 지움) · 운영 RDS 주소 없음 · 부하 시드 · ANALYZE · bash 문법
  ② tools/mig-measure.js — migrate.js 와 같은 체크섬 · schema_migrations 줄 · COMMIT 앞 잠금 · 전부터 있던 표만 · 되돌리기 위험 글자를 실제로 맞춰 봄
  ③ seed-load.js — 상담 축 업종 빼기 · 부동산 소개비 비움 · 규칙에 걸리면 한 줄씩 건너뜀
  ④ 문서 896(첫 측정 값) · 판
  (파일만 읽음 — 두 번 돌아도 통과)
"""
import os, re, sys, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.join(HERE, '..', 'tools')
KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb' if os.path.isdir(KIT + '/sgb') else KIT
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(p):
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


VER = rd(os.path.join(K, 'VERSION')).strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))
SH, JS, MIG = rd(os.path.join(TOOLS, 'mig-measure.sh')), rd(os.path.join(TOOLS, 'mig-measure.js')), rd(os.path.join(K, 'scripts/migrate.js'))
SEED = rd(os.path.join(K, 'scripts/seed-load.js'))

ok('① 버리는 DB — 자체 네트워크 · 포트 안 엶 · 끝나면 지움(trap) · RDS · 점검판 · 확인판 주소 없음',
   'docker network create "$NET"' in SH and 'trap cleanup EXIT INT TERM' in SH and 'docker rm -f "$DB"' in SH
   and not re.search(r'(-p|--publish)\s+\d+:', SH) and not re.search(r'rds\.amazonaws|15432|:3000\b|5174', SH), str(len(SH)))
ok('① 부하 시드(--rows · 새 킷 seed-load.js) · ANALYZE · 결과 줄(total_ms · access_exclusive_ms · slow · big_lock · rollback)',
   '--rows)' in SH and 'run "$N"' in SH and 'seed-load.js' in SH and 'psql -U sgb -q -c "ANALYZE"' in SH
   and all(k in SH for k in ('total_ms=', 'access_exclusive_ms=', 'slow=', 'big_lock=', 'rollback=')), '')
sr = subprocess.run(['bash', '-n', os.path.join(TOOLS, 'mig-measure.sh')], capture_output=True, text=True)
ok('① mig-measure.sh bash 문법', sr.returncode == 0, sr.stderr[:100])

ok('② migrate.js 와 같은 체크섬 · 같은 schema_migrations 줄 · 파일 하나 = 한 트랜잭션',
   ".digest('hex').slice(0, 16)" in JS and ".digest('hex').slice(0, 16)" in MIG
   and "INSERT INTO schema_migrations(name,checksum,duration_ms) VALUES ($1,$2,$3)" in JS and "INSERT INTO schema_migrations(name,checksum,duration_ms) VALUES ($1,$2,$3)" in MIG
   and "await c.query('BEGIN')" in JS and "await c.query('COMMIT')" in JS, '')
ok('② COMMIT 앞 이 연결 잠금(pg_backend_pid · granted) · 전부터 있던 public 표만(before) · schema_migrations 뺌',
   'l.pid = pg_backend_pid() AND l.granted' in JS and 'before.has(r.o)' in JS and "c.relname <> 'schema_migrations'" in JS
   and JS.find("pg_locks") < JS.find("await c.query('COMMIT')"), '')
# 되돌리기 위험 글자 — JS 정규식을 꺼내 실제 SQL 보기에 맞춰 봄
pats = dict((k, re.compile(p.replace('(?!\\s+IF\\s+EXISTS\\s+(?:public\\.)?_)', ''), re.I)) for k, p in re.findall(r"\['([^']+)', /(.+?)/i\]", JS))
samples = {
    'DROP COLUMN': 'ALTER TABLE public.a DROP COLUMN b;', 'RENAME': 'ALTER TABLE a RENAME COLUMN b TO c;',
    'NOT NULL 더함': 'ALTER TABLE a ALTER COLUMN b SET NOT NULL;', '형 바꿈': 'ALTER TABLE a ALTER COLUMN b TYPE bigint;', 'DROP TABLE': 'DROP TABLE public.x;',
}
hit = {k: bool(pats.get(k) and pats[k].search(v)) for k, v in samples.items()}
safe = 'ALTER TABLE a ADD COLUMN IF NOT EXISTS b text; CREATE INDEX i ON a(b); ALTER TABLE a ALTER COLUMN b SET DEFAULT 1;'
ok('② 되돌리기 위험 다섯 가지를 잡고 · 칸 더하기 · 색인 · 기본값은 위험 아님(실제로 맞춰 봄)',
   len(pats) == 5 and all(hit.values()) and not any(p.search(safe) for p in pats.values()) and 'strip(buf' in JS, f'{hit}')

ok('③ seed-load — 상담 축 업종 빼기(INV-AX2) · 부동산 희망 소개비 비움(A-07) · 규칙에 걸리면 한 줄씩 건너뛰고 까닭 셈',
   "c.axis IS DISTINCT FROM 'CONSULT'" in SEED and "g === 'MAL' ? null :" in SEED and 'skipped[code]' in SEED and '건너뜀 ${sk}' in SEED, '')

d = os.path.join(K, 'docs')
d896 = next((rd(os.path.join(d, x)) for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith('896_')), '')
ok('④ 문서 896 — 첫 측정(0.26초 · 큰 표 잠금 없음 · 킷만 되돌려도 됨)', all(w in d896 for w in ('0.26초', '큰 표 잠금', '킷만 되돌려도 됨', 'mig-measure.sh')), str(len(d896)))
ok('④ VERSION v10.787 이상', VT >= (10, 787), VER)

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
