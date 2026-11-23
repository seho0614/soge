"""v10.645 (docs/789) 운영 절차서 도구 — 「판 보관 폴더」 기대 줄을 지난 적용 출력의 실제 폴더 이름으로
  ① kept_releases — <vo>_apply.txt 의 「옛 판 1개 정리 … (남김: <vo 폴더> · <그 전 폴더>)」 → (그 전, vo) · 파일 없으면 None · 다른 판 줄은 안 씀
  ② 초안 세 곳(precheck [4] · apply 옛 판 정리 · 3-0 ls)이 pv_dir · ov_dir 를 씀 · 지난 출력이 없으면 킷 폴더로 짐작(prev_ops)하고 그렇다고 적음
  ③ 11/23 실제 — v10.617_apply.txt 모양이면 v10.558_20261121_062854 (docs/770 의 v10.567 이 아님)
  ④ 문서 789 · 판 · 회귀 실행기 HOST 목록(tools 를 읽음)
  (파일만 읽음 · 임시 폴더는 스스로 지움 — 두 번 돌아도 통과)
"""
import importlib.util, os, re, sys, tempfile, shutil

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
spec = importlib.util.spec_from_file_location('opsdraft1645', TOOL)
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)
SRC = rd(TOOL)

tmp = tempfile.mkdtemp(prefix='t1645_')
try:
    open(os.path.join(tmp, 'v10.617_apply.txt'), 'w', encoding='utf-8').write(
        '        판 보관 폴더: v10.456_20261120_035610 v10.558_20261121_062854\n'
        '        옛 판 1개 정리 · 약 1017MB — v10.456_20261120_035610 (남김: v10.617_20261122_020427 · v10.558_20261121_062854)\n'
        '적용 후 확인 — 통과 54 · 실패 0 · 확인 5\n')
    open(os.path.join(tmp, 'v10.700_apply.txt'), 'w', encoding='utf-8').write('남김: v10.699_20261201_000000 · v10.698_20261130_000000\n')
    k617 = M.kept_releases(tmp, 'v10.617')
    k700 = M.kept_releases(tmp, 'v10.700')
    k999 = M.kept_releases(tmp, 'v10.999')
finally:
    shutil.rmtree(tmp, ignore_errors=True)
ok('① 「남김:」 → (그 전, vo) 실제 폴더 이름', k617 == ('v10.558_20261121_062854', 'v10.617_20261122_020427'), str(k617))
ok('① 파일 없음 · 다른 판 줄이면 None', k999 is None and k700 is None, f'{k999} {k700}')
ok('② 초안 세 곳이 pv_dir · ov_dir — precheck [4] · apply 옛 판 정리 · 3-0 ls',
   "`판 보관 폴더: {pv_dir} {ov_dir}`" in SRC and "옛 판 1개 정리 … {pv_dir} (남김: {nv}_… · {ov_dir})" in SRC and "ls ~/sgb-releases          # {pv_dir} · {ov_dir}" in SRC, '')
ok('② 지난 출력이 없으면 킷 폴더로 짐작 · 그렇다고 적음', "kp[0] if kp else (f'{_pv}_…' if _pv else None)" in SRC and '킷 폴더로 짐작 — 지난 적용 출력이 없음' in SRC, '')
ok('③ 11/23 — v10.558 (docs/770 에 적힌 v10.567 이 아님)', k617 and k617[0].startswith('v10.558_') and not k617[0].startswith('v10.567'), str(k617))

d = os.path.join(K, 'docs')
d789 = next((rd(os.path.join(d, x)) for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith('789_')), '')
ok('④ 문서 789 — 판 보관 폴더 · 남김 · v10.558', all(w in d789 for w in ('판 보관 폴더', '남김', 'v10.558')), str(len(d789)))
host = re.search(r'^HOST="([^"]*)"', rd(os.path.join(HERE, 'run_regression.sh')), re.M)
ok('④ 회귀 실행기 HOST 목록에 test_v1645(tools 를 읽음)', bool(host) and 'test_v1645.py' in host.group(1).split())
ok('④ VERSION v10.645 이상', VT >= (10, 645), VER)

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
