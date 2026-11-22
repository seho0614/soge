"""v10.640 (docs/784) 절차서 도구가 판 문서를 빠뜨리지 않음
  ① version_docs — 운영 절차서(NNN_운영적용_v10.X_v10.Y · NNN_운영적용_v10.X에서_v10.Y)만 뺌 ·
     이름에 「운영적용」이 들어간 판 문서(780_운영적용출력보관_v10.636 · 509_운영적용_확인표_v10.374)는 넣음 — 11/22 docs/770 초안에서 v10.636 이 빠졌던 것
  ② v10.617 → v10.637 사이 판 문서 = 761 ~ 769 · 771 ~ 781(780 포함 · 760 · 770 뺌) — 이 저장소 판 docs 로
  ③ .tar.gz 킷을 주면 같은 판 zip 을 알려 주고 멈춤(초안을 쓰지 않음)
  ④ 문서 784 · 판 · 회귀 실행기 HOST 목록(tools 를 읽어 서버에서 돎)
  (파일만 읽음 · 임시 폴더는 스스로 지움 — 두 번 돌아도 통과)
"""
import importlib.util, os, re, subprocess, sys, tempfile, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.join(os.path.dirname(HERE), 'tools', 'ops-doc-draft.py')
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
spec = importlib.util.spec_from_file_location('opsdraft1640', TOOL)
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)

# ── ① 이름 규칙 ──────────────────────────────────────
NAMES = ['760_운영적용_v10.558_v10.617_한번에_20261122.md', '770_운영적용_v10.617_v10.637_한번에_20261122.md',
         '254_운영적용_v10.162에서_v10.164_20261101.md', '780_운영적용출력보관_v10.636_20261122.md',
         '509_운영적용_확인표_v10.374_20261118.md', '781_AI설명서절고르기품질_v10.637_20261122.md', '779_회귀안전장치_v10.635_20261122.md']
tmp = tempfile.mkdtemp(prefix='t1640_')
try:
    for n in NAMES:
        open(os.path.join(tmp, n), 'w', encoding='utf-8').write('# x\n')
    got = [x[0] for x in M.version_docs(tmp, 617, 637, set())]
    got_all = [x[0] for x in M.version_docs(tmp, 100, 700, set())]
finally:
    shutil.rmtree(tmp, ignore_errors=True)
ok('① v10.617 → 637 — 780(이름에 운영적용) · 779 · 781 넣음 · 760 · 770 절차서 뺌', got == ['779', '780', '781'], str(got))
ok('① 509_운영적용_확인표_v10.374 는 판 문서 · 254_운영적용_…에서_… 는 절차서', '509' in got_all and '254' not in got_all, str(got_all))
ok('① OPS_DOC_RE — 절차서 이름만', hasattr(M, 'OPS_DOC_RE') and M.OPS_DOC_RE.match('770_운영적용_v10.617_v10.637_한번에_20261122.md')
   and not M.OPS_DOC_RE.match('780_운영적용출력보관_v10.636_20261122.md'))

# ── ② 실제 판 문서 ───────────────────────────────────
d = os.path.join(K, 'docs')
real = [x[0] for x in M.version_docs(d, 617, 637, set())] if os.path.isdir(d) else []
want = [str(n) for n in list(range(761, 770)) + list(range(771, 782))]
ok('② 실제 docs — v10.617 → 637 사이 761 ~ 769 · 771 ~ 781(780 포함 · 770 뺌)', all(w in real for w in want) and '770' not in real and '760' not in real,
   f'빠짐 {[w for w in want if w not in real]} · 더함 {[r for r in real if r not in want]}')

# ── ③ tar.gz 를 주면 zip 을 알려 줌 ─────────────────────
tmp = tempfile.mkdtemp(prefix='t1640b_')
try:
    tg = os.path.join(tmp, 'SGB_X_v10_617.tar.gz'); zp = os.path.join(tmp, 'SGB_X_v10_617.zip'); out = os.path.join(tmp, 'd.md')
    for f in (tg, zp):
        open(f, 'wb').write(b'x')
    p = subprocess.run([sys.executable, '-I', TOOL, tg, zp, '-o', out], capture_output=True, text=True, timeout=60)
    msg = (p.stdout + p.stderr).strip()
    wrote = os.path.exists(out)
finally:
    shutil.rmtree(tmp, ignore_errors=True)
ok('③ .tar.gz → 「킷 zip 이 아님 — 같은 판 zip 을 쓰십시오: …zip」 · 초안 안 씀', p.returncode != 0 and '같은 판 zip 을 쓰십시오' in msg and msg.endswith('.zip') and not wrote, msg[-160:])

# ── ④ 문서 · 판 ──────────────────────────────────────
d784 = next((rd(os.path.join(d, x)) for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith('784_')), '')
ok('④ 문서 784 — 780 · OPS_DOC_RE · tar.gz', all(w in d784 for w in ('780', 'OPS_DOC_RE', 'tar.gz')), str(len(d784)))
host = re.search(r'^HOST="([^"]*)"', rd(os.path.join(HERE, 'run_regression.sh')), re.M)
ok('④ 회귀 실행기 HOST 목록에 test_v1640(tools 를 읽음 — 컨테이너엔 qa 만 붙음)', bool(host) and 'test_v1640.py' in host.group(1).split())
ok('④ VERSION v10.640 이상', VT >= (10, 640), VER)

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
