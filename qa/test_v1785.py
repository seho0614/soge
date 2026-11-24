"""v10.785 (docs/894) 회귀 3차 — 화면 시험 동시 실행(UI_LANE=N)
  ① reg_pool.py --ui-lane N — 화면 시험이 동시에 N개까지만 · 설정 키 잠금(set:…)이 같은 시험끼리는 화면 시험이어도 같이 안 돎 · 모두 끝남 · 결과 줄 이름 순
     (docker 대신 가짜 실행으로 실제로 돌려 동시 수를 셈)
  ② --ui-lane 숫자 없이 = 1(예전 한 줄) · 끄면 화면 시험은 동시 단계에 안 들어감
  ③ run_regression.sh — UI_LANE 숫자 · 0 이면 혼자 단계 · 1 이상이면 동시 단계 · PAR 가 화면 자리보다 작으면 늘림 · bash 문법
  ④ 문서 894 · 판
  (파일만 읽음 · 임시 폴더는 스스로 지움 — 두 번 돌아도 통과)
"""
import os, re, sys, subprocess, tempfile, shutil, threading, time, io, contextlib, importlib.util

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


def load_pool():
    spec = importlib.util.spec_from_file_location('reg_pool_t1785', os.path.join(HERE, 'reg_pool.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def run_pool(plan_rows, args):
    """가짜 실행 — 시험마다 0.3초 · 동시에 돈 화면 시험 수 · 같은 잠금 겹침을 셈"""
    m = load_pool()
    tmp = tempfile.mkdtemp(prefix='t1785_')
    st = {'ui': 0, 'ui_max': 0, 'all': 0, 'all_max': 0, 'lock_clash': 0, 'held': {}}
    mu = threading.Lock()
    kinds = {f: (mode, set() if lk == '-' else set(lk.split(','))) for f, mode, lk in plan_rows}

    def fake(name, env):
        mode, lk = kinds[name]
        with mu:
            st['all'] += 1; st['all_max'] = max(st['all_max'], st['all'])
            if mode == 'UI':
                st['ui'] += 1; st['ui_max'] = max(st['ui_max'], st['ui'])
            for l in lk:
                if st['held'].get(l):
                    st['lock_clash'] += 1
                st['held'][l] = st['held'].get(l, 0) + 1
        time.sleep(0.3)
        with mu:
            st['all'] -= 1
            if mode == 'UI':
                st['ui'] -= 1
            for l in lk:
                st['held'][l] -= 1
        return '결과: 1 / 1', 0.3

    try:
        plan = os.path.join(tmp, '_plan.tsv')
        with open(plan, 'w', encoding='utf-8') as fh:
            fh.write('# 시험\t방식\t까닭\t잠금\n')
            for f, mode, lk in plan_rows:
                fh.write(f'{f}\t{mode}\t-\t{lk}\n')
                open(os.path.join(tmp, f), 'w').write('')
        m.run_one = fake
        m.wait_site = lambda site: None
        os.environ.update(Q=tmp, K=tmp, API='http://127.0.0.1:1', DB='', ADMIN_WEB='', SITE='http://127.0.0.1:1')
        buf, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(err):
            m.main(['reg_pool.py', '--plan', plan, '--dir', tmp] + args)
        return st, buf.getvalue()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


rows = [(f'test_v70{i:02d}.py', 'UI', '-') for i in range(8)] \
     + [('test_v7100.py', 'UI', 'set:mall'), ('test_v7101.py', 'UI', 'set:mall'), ('test_v7102.py', 'LOCK', 'set:mall')] \
     + [(f'test_v72{i:02d}.py', 'PAR', '-') for i in range(6)]
st, out = run_pool(rows, ['--n', '4', '--ui-lane', '2'])
names = [l.split(' | ')[0] for l in out.splitlines() if ' | ' in l]
ok('① --ui-lane 2 — 화면 시험 동시 최대 2 · 실제로 2개가 함께 돎', st['ui_max'] == 2, f"ui_max={st['ui_max']} all_max={st['all_max']}")
ok('① 같은 설정 잠금(set:mall) 시험은 화면 시험이어도 겹치지 않음', st['lock_clash'] == 0, f"clash={st['lock_clash']}")
ok('① 모든 시험(17개)이 끝나고 결과 줄은 이름 순', len(names) == 17 and names == sorted(names), f'{len(names)}')
ok('① 동시 실행 수 n=4 를 넘지 않음', st['all_max'] <= 4, str(st['all_max']))
st1, out1 = run_pool(rows, ['--n', '4', '--ui-lane', '--times', '/nonexistent'])
ok('② 「--ui-lane」 숫자 없이 = 1(화면 시험 한 줄)', st1['ui_max'] == 1, f"ui_max={st1['ui_max']}")
st0, out0 = run_pool(rows, ['--n', '4'])
n0 = [l for l in out0.splitlines() if ' | ' in l]
ok('② --ui-lane 없으면 화면 시험은 동시 단계에 안 들어감(화면 빼고 7개 = LOCK 1 + PAR 6)', st0['ui_max'] == 0 and len(n0) == 7, f'{len(n0)}')

RR = rd(os.path.join(HERE, 'run_regression.sh'))
ok('③ UI_LANE 숫자 아니면 0 · PAR 가 화면 자리 이하면 UI_LANE+1 로',
   "case \"$UI_LANE\" in ''|*[!0-9]*) UI_LANE=0;; esac" in RR and 'PAR=$((UI_LANE + 1))' in RR, '')
ok('③ 0 이면 혼자 단계(ui + 0 < 1) · 1 이상이면 동시 단계 · reg_pool 에 --ui-lane N',
   '($2 == "UI" && ui + 0 < 1)' in RR and '($2 == "UI" && ui + 0 >= 1)' in RR and 'UIARG="--ui-lane $UI_LANE"' in RR, '')
sr = subprocess.run(['bash', '-n', os.path.join(HERE, 'run_regression.sh')], capture_output=True, text=True)
ok('③ run_regression.sh bash 문법', sr.returncode == 0, sr.stderr[:100])

d = os.path.join(K, 'docs')
d894 = next((rd(os.path.join(d, x)) for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith('894_')), '')
ok('④ 문서 894 — 화면 시험 · UI_LANE · 잠금', all(w in d894 for w in ('화면 시험', 'UI_LANE', '잠금')), str(len(d894)))
ok('④ VERSION v10.785 이상', VT >= (10, 785), VER)

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
