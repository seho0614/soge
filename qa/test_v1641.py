"""v10.641 (docs/785) 미리 검사 소음 줄이기 — verify-docs DB 대조를 버리는 DB 로 · 옛 시험 비교는 숫자를 지우고
  ① pre_check.sh ③ verify-docs 가 ② 의 버리는 DB(자기 네트워크 $NET · $DB · 포트 안 엶)에 붙음 · --network none 아님 · 점검판(15432) · 확인판 · RDS 주소 없음 · rc 한 줄
  ② 버리는 DB 는 끝날 때 지움(trap cleanup) · ③ 이 ② 뒤(wait 다음)
  ③ 「작업 트리에서만 FAIL」은 「시험 | FAIL 확인 이름」만 숫자를 지우고 견줌 — 그 줄을 떼어 실제로 돌려 판 번호 · 보기 값(test_v1122)만 다른 줄은 빠지고 새 실패는 남음
  ④ 문서 785 · 판
  (파일만 읽음 · 임시 폴더는 스스로 지움 — 두 번 돌아도 통과)
"""
import os, re, sys, subprocess, tempfile, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
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
PC = rd(os.path.join(HERE, 'pre_check.sh'))

s3 = PC[PC.find('== ③ verify-docs'):PC.find('== ④')]
ok('① ③ verify-docs 가 버리는 DB 네트워크에 붙음(--network "$NET" · DATABASE_URL …@$DB:5432) · --network none 아님',
   'docker run --rm --network "$NET" -e DATABASE_URL=postgresql://sgb:sgb@$DB:5432/sgb' in s3 and 'verify-docs.js' in s3
   and not re.search(r'--network none[^\n]*\n[^\n]*verify-docs', s3), str(len(s3)))
ok('① 점검판 · 확인판 포트 · RDS 주소를 쓰지 않음', not re.search(r'15432|:3000|5174|rds\.amazonaws', s3), '')
ok('① rc 한 줄 「③ verify-docs rc=… · DB 대조 = 버리는 DB」', '③ verify-docs $(grep -oE' in s3 and 'DB 대조 = 버리는 DB' in s3, '')
ok('② 버리는 DB 는 끝날 때 지움 · 포트 안 엶 · ③ 은 ② 뒤', 'trap cleanup EXIT INT TERM' in PC and 'docker rm -f "$DB"' in PC and not re.search(r'(-p|--publish)\s+\d+:', PC)
   and PC.find('\nwait\n') < PC.find('== ③ verify-docs'), '')

m = re.search(r'(fkey\(\) \{.*?done \| head -30)', PC, re.S)
tmp = tempfile.mkdtemp(prefix='t1641_')
try:
    open(os.path.join(tmp, 'static_main.txt'), 'w', encoding='utf-8').write(
        'test_v1065.py | FAIL VERSION v10.65 이상 — v10.637\ntest_v1122.py | FAIL ① codes 한국어 = DB code_labels — 다름 [\'a.G3\', \'b.BILLED\']\ntest_v1200.py | 결과: 3 / 3\n')
    open(os.path.join(tmp, 'static_new.txt'), 'w', encoding='utf-8').write(
        'test_v1065.py | FAIL VERSION v10.65 이상 — v10.640\ntest_v1122.py | FAIL ① codes 한국어 = DB code_labels — 다름 [\'c.WAIVED\', \'d.REJECTED\']\ntest_v1200.py | FAIL 새로 깨짐 — x\n')
    r = subprocess.run(['bash', '-c', m.group(1)], env=dict(os.environ, OUT=tmp), capture_output=True, text=True, timeout=30) if m else None
    out = r.stdout if r else ''
finally:
    shutil.rmtree(tmp, ignore_errors=True)
ok('③ 「시험 | FAIL 확인 이름」만 숫자를 지우고 견줌 — 판 번호 · 「 — 」 뒤 보기 값(test_v1122)만 다른 줄은 빠지고 새 실패만 남음(실제로 돌림)', m is not None and out.strip() == 'test_v1200.py | FAIL 새로 깨짐 — x', repr(out[:160]))
sr = subprocess.run(['bash', '-n', os.path.join(HERE, 'pre_check.sh')], capture_output=True, text=True)
ok('③ pre_check.sh bash 문법', sr.returncode == 0, sr.stderr[:100])

d = os.path.join(K, 'docs')
d785 = next((rd(os.path.join(d, x)) for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith('785_')), '')
ok('④ 문서 785 — DB 대조 · 버리는 DB · 숫자', all(w in d785 for w in ('DB 대조', '버리는 DB', '숫자')), str(len(d785)))
ok('④ VERSION v10.641 이상', VT >= (10, 641), VER)

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
