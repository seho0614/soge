"""v10.630 (docs/774) 운영 절차서 초안 — precheck [5] · 7절 · 8절 자동
  KIT=<kit> python3 -I test_v1630.py          (서버에서 — 회귀 실행기 HOST 목록 · ~/kits 읽음 · 도구는 ../tools)
  ① (코드) prev_precheck5 · seed_tables · new_settings · sql_strip · [5] 〔채울 것〕 대신 p5_text · 7절 처음 값 줄 · 8절 화면 확인 · 새 스위치 · 문서 774 · 판
  ② (합성) 지난 절차서에서 [5] 줄을 찾음(제목 「→ 지금 판」) · 주석 속 INSERT 는 안 셈 · ON CONFLICT DO NOTHING 표 · 설정 줄(키 · 처음 값 · 설명)
  ③ (진짜 킷 · ~/kits/ops 가장 높은 판 → ~/kits/release 더 높은 판이 있을 때) [5] 에 docs/ · 7절 처음 값 줄 · 8절 1번 화면 확인 · 종료 0
  (임시 폴더는 스스로 지움 — 두 번 돌아도 통과)
"""
import glob, importlib.util, os, re, shutil, subprocess, sys, tempfile

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
OD = rd(TOOL)

# ── ① 코드 ─────────────────────────────────────────────
ok('① 도우미 넷 · [5] 는 p5_text(〔채울 것: 오픈 차단 · 약관 줄〕 없음) · open_blockers · terms 건드리면 ⚠',
   all(f'def {f}(' in OD for f in ('prev_precheck5', 'seed_tables', 'new_settings', 'sql_strip')) and "③ [5] ' + p5_text + ' ④ [6]" in OD
   and '〔채울 것: 오픈 차단 · 약관 줄〕' not in OD and "(open_blockers|terms)\\b', sql_strip(s), re.I)" in OD)
ok('① 7절 처음 값 줄 · 8절 화면 확인 · 새 스위치(꺼진 채) · 처음 값 있는 설정 · 판 문서 「대표」 줄만 〔채울 것〕',
   '처음 값 넣기(ON CONFLICT DO NOTHING)' in OD and '4-1 화면 확인 결과(이상 없음 · 이상 있으면 번호와 화면)를 알려 주십시오.' in OD
   and '새로 생긴 스위치는 **꺼진 채** 올라갑니다' in OD and "w('1. 〔채울 것〕')" not in OD)
ok('① 읽기만 그대로 — 지우는 곳은 임시 폴더 하나', OD.count('shutil.rmtree(') == 1 and 'shutil.rmtree(tmp, ignore_errors=True)' in OD)
d = os.path.join(K, 'docs')
d774 = next((rd(os.path.join(d, x)) for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith('774_')), '')
ok('① 문서 774 — [5] · 7절 · 8절 · prev_precheck5', all(w in d774 for w in ('[5]', '7절', '8절', 'prev_precheck5')), str(len(d774)))
ok('① VERSION v10.630 이상', VT >= (10, 630), VER)

# ── ② 합성 ─────────────────────────────────────────────
spec = importlib.util.spec_from_file_location('opsdraft', TOOL)
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)
tmp = tempfile.mkdtemp(prefix='t1630_')
try:
    open(os.path.join(tmp, '700_운영적용.md'), 'w', encoding='utf-8').write('# 700. 운영 적용 — v10.1 → v10.2 한 번에\n| precheck 기대 줄 | ① x ③ [5] `오픈 차단 9건` · `약관: 게시 3` — 그때 숫자 ④ [6] y |\n')
    open(os.path.join(tmp, '701_운영적용.md'), 'w', encoding='utf-8').write('# 701. 운영 적용 — v10.2 → v10.3 한 번에\n| precheck 기대 줄 | ① x ③ [5] `오픈 차단 11건` · `약관: 게시 11 · 초안 2` ④ [6] y |\n')
    p5 = M.prev_precheck5(tmp, 'v10.3')
    p5b = M.prev_precheck5(tmp, 'v10.9')
finally:
    shutil.rmtree(tmp, ignore_errors=True)
ok('② 지난 절차서 [5] — 제목 「→ v10.3」 문서의 줄 · 없는 판이면 None', p5 == ('701', '`오픈 차단 11건` · `약관: 게시 11 · 초안 2`') and p5b is None, str(p5))
sql = """-- INSERT INTO nope (a) VALUES (1) ON CONFLICT DO NOTHING;
INSERT INTO public.opx_switch_docs (key, cond) VALUES ('a.b', 'x') ON CONFLICT (key) DO NOTHING;
INSERT INTO public.help_docs (code) VALUES ('X');
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('zz.flag', 'off', 'ADMIN', '시험 스위치 — 켜면 ''무엇''이 됨', false, '^(on|off)$', 'off'),
  ('zz.limit', '3', 'ADMIN', '시험 기준 수', false, '^[0-9]$', '3')
ON CONFLICT (key) DO NOTHING;"""
st = M.seed_tables([('D999_t', sql)])
ns = M.new_settings([('D999_t', sql)])
ok('② 처음 값 넣기 표 — 주석 속 INSERT 는 안 셈 · ON CONFLICT 없는 INSERT 는 안 셈', st == [('D999', 'opx_switch_docs'), ('D999', 'site_settings')], str(st))
ok("② 설정 줄 — 키 · 처음 값 · 설명('' → ')", ns == [('D999', 'zz.flag', 'off', "시험 스위치 — 켜면 '무엇'이 됨"), ('D999', 'zz.limit', '3', '시험 기준 수')], str(ns))

# ── ③ 진짜 킷 ─────────────────────────────────────────────
num = lambda z: int(re.search(r'v10_(\d+)\.zip$', z).group(1))
ops = sorted(glob.glob(os.path.expanduser('~/kits/ops/SGB_*_v10_*.zip')), key=num)
rel = sorted(glob.glob(os.path.expanduser('~/kits/release/SGB_*_v10_*.zip')), key=num)
if ops and rel and num(rel[-1]) > num(ops[-1]):
    out = tempfile.mktemp(suffix='.md')
    r = subprocess.run([sys.executable, '-I', TOOL, ops[-1], rel[-1], '--doc', '999', '-o', out], capture_output=True, text=True, timeout=600)
    md = rd(out)
    if os.path.exists(out):
        os.remove(out)
    sec7 = md.split('## 7.', 1)[-1].split('## 8.', 1)[0]
    sec8 = md.split('## 8.', 1)[-1].split('\n', 1)[-1]
    ok('③ 진짜 킷 — 종료 0 · [5] 에 실제 숫자(results · v10.636) · docs/ · 찾지 못함 표시 중 하나', r.returncode == 0 and re.search(r'\[5\] (`[^|]*— (docs/\d+ 적용 때와 같은 숫자|v10\.\d+ 적용 때 실제 숫자\(results/)|〔채울 것: 오픈 차단)', md), (r.stdout + r.stderr).strip()[-160:])
    ok('③ 7절 처음 값 줄(또는 「처음 값 넣기 없음」) · 8절 1번 화면 확인', ('처음 값 넣기' in sec7) and sec8.lstrip().splitlines()[0].startswith('1. 4-1 화면 확인 결과'), sec8.strip()[:80])
else:
    print(f'  (~/kits/ops {len(ops)}개 · ~/kits/release {len(rel)}개 — 더 높은 판이 없어 ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
