"""v10.621 (docs/764) 운영 절차서 초안 도구 자동 채움 — 2절 결론 · 3-0 판 보관 · apply 옛 판 정리 줄 · 4-1 화면 확인표 · 서버에서(HOST)
  KIT=<kit> python3 test_v1621.py          (도구는 ../tools)
  ① (코드) ops-doc-draft.py — menu_map(node 로 adminMenu.ts) · menu_rows · prev_ops · 「바뀐 것」 없으면 「결론」 · 문서 764 · 판
  ② (실행 · 합성) menu_rows — 새 탭은 묶음 · 하위 묶음별 한 줄 · 옮긴 탭 · 이름 바뀐 탭 · 이름 바뀐 묶음
  ③ (실행 · ~/kits/ops 에 운영 킷 zip 이 2개 이상일 때) 가장 높은 두 판으로 초안 → 3-0 「ls ~/sgb-releases」 줄이 그 전 판 · 4-1 표 줄 있음 · sha 대조 맞음
  (읽기만 — 임시 폴더는 지움 · 두 번 돌아도 통과)
"""
import glob, importlib.util, os, re, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.join(os.path.dirname(HERE), 'tools')
TOOL = os.path.join(TOOLS, 'ops-doc-draft.py')
KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb' if os.path.isdir(KIT + '/sgb') else KIT
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(p):
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


OD = rd(TOOL)
ok('① 도구 — menu_map · menu_rows · prev_ops · 결론 대신 · 4-1 표 머리',
   all(w in OD for w in ('def menu_map(', 'def menu_rows(', 'def prev_ops(', "section(md, '바뀐 것') or section(md, '결론')", "'| # | 정확한 위치 | 할 일 | 맞으면 |'", "'--experimental-strip-types'")), str(len(OD)))
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []
D = next((rd(os.path.join(K, 'docs', x)) for x in docs if x.startswith('764_')), '')
ok('① 문서 764 — ops-doc-draft · 4-1 · 결론', all(w in D for w in ('ops-doc-draft', '4-1', '결론')), str(len(D)))
VER = rd(os.path.join(K, 'VERSION')).strip()
ok('① VERSION v10.621 이상', tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 621), VER)

# ── ② 합성 ─────────────────────────────────────────────
spec = importlib.util.spec_from_file_location('opsdraft', TOOL)
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)
om = {'groups': {'a': {'label': '권한 계층', 'nav': '회원'}, 'b': {'label': '사무', 'nav': '운영'}},
      'tabs': {'t1': {'group': 'b', 'label': '권한 관리', 'section': None}, 't2': {'group': 'a', 'label': '옛 이름', 'section': None}}}
nm = {'groups': {'a': {'label': '직원 · 권한', 'nav': '회원'}, 'b': {'label': '사무', 'nav': '운영'}},
      'tabs': {'t1': {'group': 'a', 'label': '업무별 권한', 'section': None}, 't2': {'group': 'a', 'label': '새 이름', 'section': None},
               'n1': {'group': 'b', 'label': '새 탭 하나', 'section': '인사'}, 'n2': {'group': 'b', 'label': '새 탭 둘', 'section': '인사'}}}
rows = M.menu_rows(om, nm)
txt = '\n'.join(' | '.join(r) for r in rows)
ok('② 이름 바뀐 묶음 · 옮긴 탭 · 이름 바뀐 탭 · 새 탭 묶음별 한 줄',
   len(rows) == 4 and '옛 이름 「권한 계층」' in txt and '옛 위치 사무 › 「권한 관리」' in txt and '옛 이름 「옛 이름」' in txt
   and '하위 묶음 **인사** › 새 탭 2개' in txt and '「새 탭 하나」 · 「새 탭 둘」' in txt, txt.replace('\n', ' ∥ ')[:200])

# ── ③ 진짜 킷 ─────────────────────────────────────────────
zips = sorted(glob.glob(os.path.expanduser('~/kits/ops/SGB_*_v10_*.zip')), key=lambda z: int(re.search(r'v10_(\d+)\.zip$', z).group(1)))
if len(zips) >= 3:
    old, new = zips[-2], zips[-1]
    out = tempfile.mktemp(suffix='.md')
    r = subprocess.run([sys.executable, '-I', TOOL, old, new, '--doc', '999', '-o', out], capture_output=True, text=True, timeout=600)
    md = rd(out)
    if os.path.exists(out):
        os.remove(out)
    vprev = re.search(r'v10_(\d+)\.zip$', zips[-3]).group(1)
    vo = re.search(r'v10_(\d+)\.zip$', old).group(1)
    ok('③ 진짜 킷 초안 — 종료 0 · sha 대조 맞음', r.returncode == 0 and 'sha 대조 맞음' in (r.stdout + r.stderr), (r.stdout + r.stderr).strip()[-160:])
    ok('③ 3-0 판 보관 줄 = 그 전 운영 판 · 지금 운영 판', f'ls ~/sgb-releases          # v10.{vprev}_… · v10.{vo}_…' in md, f'v10.{vprev} · v10.{vo}')
    ok('③ 4-1 표 — 메뉴에서 만든 줄 1개 이상', md.count('| 운영 화면 왼쪽 메뉴 › ') >= 1, str(md.count('| 운영 화면 왼쪽 메뉴 › ')))
else:
    print(f'  (~/kits/ops 운영 킷 {len(zips)}개 — ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
