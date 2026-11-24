"""회귀 시험 동시 실행 (v10.569 · docs/711) — run_regression.sh 가 「혼자」가 아닌 시험을 N개씩 돌릴 때 부름

  python3 reg_pool.py --plan <_plan.tsv> --dir <로그.d> --n 3 [--ui-lane] [--times <지난 시험별 시간 tsv>]
    환경 값: Q(qa 폴더) · K(kit) · API · DB · ADMIN_WEB · SITE — run_regression.sh 의 one() 과 같은 docker 명령으로 돌림
    · 방식 PAR(아무와 동시) · LOCK(잠금 이름이 겹치는 시험과는 같이 안 돎 · 설정 키 앞마디 set:… · 정기 작업 job) 만 돌림
    · --ui-lane: 화면 시험(UI)도 「ui」 잠금 하나로 넣어 한 번에 하나씩(처음은 끔 — 화면 시험은 실행기가 혼자 돌림)
    · v10.785 (docs/894) --ui-lane N: 화면 시험을 동시에 N개까지(「ui」 자리 N개 · 회귀 3차) — 화면 시험끼리도 설정 키 · 정기 작업 잠금은 그대로라
      같은 설정을 만지는 화면 시험은 같이 안 돎 · 「--ui-lane」만 쓰면 1(예전과 같음)
    · 지난 시간(--times)이 있으면 오래 걸린 시험부터 시작(끝이 덜 늘어짐)
    · 시험마다 출력은 <dir>/<시험>.log (예전과 같음) · 시간은 <dir>/_times.tsv 에 덧붙임
    · 다 끝나면 「시험 | 결과: n / m」 줄과 그 아래 FAIL 줄(네 칸 들여쓰기)을 **시험 이름 순서로** 표준 출력 — 실행기가 로그에 덧붙임(reg_tally.py 판정 그대로)
"""
import os, subprocess, sys, threading, time, urllib.request


def opt(argv, k, d=None):
    return argv[argv.index(k) + 1] if k in argv else d


def wait_site(site):
    for _ in range(100):
        try:
            urllib.request.urlopen(site + '/login', timeout=10).read(1)
            return
        except Exception:
            time.sleep(3)


def run_one(name, env):
    """run_regression.sh one() 의 box 갈래와 같은 명령 — 결과(출력 글, 걸린 초)"""
    cmd = ['docker', 'run', '--rm', '--network', 'host', '-v', f"{env['Q']}:/w", '-v', f"{env['K']}:/core:ro", '-w', '/w',
           '-e', 'KIT=/core', '-e', f"API={env['API']}", '-e', f"DB={env['DB']}", '-e', f"ADMIN_WEB={env['ADMIN_WEB']}", '-e', f"SITE={env['SITE']}",
           'sgb-qa:v1', 'timeout', '1800', 'python3', name]
    t0 = time.time()
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, errors='replace', timeout=1900)
        out = (r.stdout or '') + (r.stderr or '')
    except Exception as ex:   # 시간 초과 · docker 없음 — 결과 줄 없음으로 남음(멈춤 판정)
        out = f'(reg_pool) 실행 실패: {ex}'
    return out.rstrip('\n'), time.time() - t0


def summary_lines(name, out):
    res = [l for l in out.splitlines() if l.startswith('결과')]
    fails = ['    ' + l for l in out.splitlines() if l.startswith('FAIL')]
    return [f"{name} | {res[-1] if res else ''}"] + fails


def main(argv):
    plan, d, n = opt(argv, '--plan'), opt(argv, '--dir'), max(1, int(opt(argv, '--n', '3')))
    ui_lane = 0
    if '--ui-lane' in argv:   # v10.785 「--ui-lane」 뒤 숫자가 있으면 그 수 · 없으면 1
        nx = opt(argv, '--ui-lane', '')
        ui_lane = max(1, int(nx)) if nx.isdigit() else 1
    env = {k: os.environ.get(k, '') for k in ('Q', 'K', 'API', 'DB', 'ADMIN_WEB', 'SITE')}
    tasks = []
    for line in open(plan, encoding='utf-8'):
        if line.startswith('#') or not line.strip():
            continue
        f, mode, _why, locks = (line.rstrip('\n').split('\t') + ['-', '-', '-'])[:4]
        lk = set() if locks in ('', '-') else set(locks.split(','))
        if mode in ('PAR', 'LOCK'):
            tasks.append((f, lk))
        elif mode == 'UI' and ui_lane:
            tasks.append((f, lk | {'ui'}))   # 「ui」는 자리 수(ui_lane)만큼 함께 쥘 수 있음
    skip = set(filter(None, os.environ.get('SKIP_TESTS', '').split()))   # 실행기가 HOST 시험을 넘겨 줌(여기서 다시 돌리지 않음)
    tasks = [t for t in tasks if t[0] not in skip and os.path.exists(os.path.join(env['Q'], t[0]))]
    past = {}
    tp = opt(argv, '--times')
    if tp and os.path.exists(tp):
        for line in open(tp, encoding='utf-8'):
            p = line.rstrip('\n').split('\t')
            if len(p) >= 3 and p[2].replace('.', '', 1).isdigit():
                past[p[0]] = float(p[2])
    tasks.sort(key=lambda t: (-past.get(t[0], 60.0), t[0]))

    lock = threading.Lock()
    held, running, results = set(), set(), {}
    ui_held = [0]   # v10.785 「ui」 자리 쓰는 수
    cv = threading.Condition(lock)
    left = list(tasks)
    total = len(tasks)

    def take():
        """잠금이 겹치지 않는 첫 시험 — 없으면 None"""
        for i, (f, lk) in enumerate(left):
            plain = lk - {'ui'}
            if plain & held:
                continue
            if 'ui' in lk and ui_held[0] >= ui_lane:
                continue
            left.pop(i)
            held.update(plain)
            if 'ui' in lk:
                ui_held[0] += 1
            return f, lk
        return None

    def worker():
        while True:
            with cv:
                while True:
                    if not left:
                        return
                    t = take()
                    if t:
                        break
                    cv.wait(5)
                running.add(t[0])
            f, lk = t
            wait_site(env['SITE'])
            out, sec = run_one(f, env)
            with open(os.path.join(d, f + '.log'), 'w', encoding='utf-8') as fh:
                fh.write(out + '\n')
            with cv:
                held.difference_update(lk - {'ui'})
                if 'ui' in lk:
                    ui_held[0] -= 1
                running.discard(f)
                results[f] = out
                with open(os.path.join(d, '_times.tsv'), 'a', encoding='utf-8') as fh:
                    fh.write(f"{f}\tpool\t{sec:.1f}\n")
                done = len(results)
                cv.notify_all()
            ok = any(l.startswith('결과') for l in out.splitlines())
            print(f"  (동시 {done}/{total}) {f} {sec:.0f}초{'' if ok else ' · 결과 줄 없음'}", file=sys.stderr, flush=True)

    ths = [threading.Thread(target=worker, daemon=True) for _ in range(min(n, max(1, total)))]
    for t in ths:
        t.start()
    for t in ths:
        t.join()
    for f in sorted(results):
        for l in summary_lines(f, results[f]):
            print(l, flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
