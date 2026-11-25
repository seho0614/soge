"""v10.801 (sgb-core docs/917 · 추가 개발 A1) 느린 조회 회귀 감시 — 전체 점검의 ①-3
  API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb python3 plan_guard.py [--base 파일]
  ① 공개 GET 17종(load_probe.py 와 같은 주소)을 3번씩(첫 번 데움 뺌) 재고 중앙값을 기준 파일과 견줌
     · 기준보다 2배 넘게 느리고 200ms 넘으면 「느려짐」(실패) · 기준이 없거나 새 주소면 기준으로 적기만
  ② DB — 한 줄 집합 함수 ROWS · JIT 이 켜지는 대표 조회(매물 카드에 붙는 신뢰 점수 21줄)의 비용이 jit_above_cost 밑인지
  · 점검판만(13000 · 15432) · 읽기만 · 기준 파일 기본 ~/check-results/plan_guard_base.tsv(통과한 점검이 갱신)
"""
import json, os, statistics, subprocess, sys, time, urllib.error, urllib.request

API = os.environ.get('API', ''); DB = os.environ.get('DB', '')
if ':13000' not in API or ':15432' not in DB:
    print('점검판 주소만(13000 · 15432)'); raise SystemExit(2)
args = sys.argv[1:]
BASE = args[args.index('--base') + 1] if '--base' in args else os.path.expanduser('~/check-results/plan_guard_base.tsv')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
URLS = [('매물 최근', '/listings?view=0&limit=20'), ('매물 관 MNY', '/listings?view=0&gwanCode=MNY&limit=20'),
        ('매물 인기', '/listings?view=0&gwanCode=BIZ&sort=POPULAR&limit=20'), ('매물 지역', '/listings?view=0&regionCode=1100000000&limit=20'),
        ('매물 급매', '/listings?view=0&urgent=SELL&limit=20'), ('요청 목록', '/requests?limit=20'), ('관 목록', '/gwans'),
        ('업종 목록', '/categories'), ('공지', '/notices'), ('소개광장 글', '/community/posts'), ('소개몰 상품', '/health/products'),
        ('공개 설정', '/site-settings/public')]


def one(p):
    t = time.perf_counter()
    try:
        urllib.request.urlopen(API + p, timeout=60).read()
    except Exception:
        pass
    return (time.perf_counter() - t) * 1000


def psql(sql):
    return subprocess.run(['psql', DB, '-X', '-q', '-At', '-c', sql], capture_output=True, text=True).stdout.strip()


base = {}
if os.path.exists(BASE):
    for ln in open(BASE, encoding='utf-8'):
        k, _, v = ln.rstrip('\n').partition('\t')
        if v:
            base[k] = float(v)
now, bad = {}, []
for name, p in URLS:
    one(p)
    now[name] = round(statistics.median([one(p) for _ in range(3)]), 1)
    b = base.get(name)
    if b and now[name] > 2 * b and now[name] > 200:
        bad.append(f'{name} {b} → {now[name]}ms')
plan = psql("EXPLAIN (FORMAT JSON) SELECT tr.score FROM (SELECT owner_account_id FROM listings LIMIT 21) l LEFT JOIN v_account_trust tr ON tr.account_id = l.owner_account_id")
try:
    cost = json.loads(plan)[0]['Plan']['Total Cost']
except Exception:
    cost = None
jit_cost = float(psql("SELECT setting FROM pg_settings WHERE name = 'jit_above_cost'") or 100000)
if cost is None or cost >= jit_cost:
    bad.append(f'신뢰 점수 21줄 비용 {cost} ≥ JIT {jit_cost}')
print('plan_guard — ' + ' · '.join(f'{k} {v}ms' for k, v in now.items()))
if bad:
    print('plan_guard 느려짐 — ' + ' / '.join(bad)); raise SystemExit(1)
if '--keep' not in args:
    os.makedirs(os.path.dirname(BASE), exist_ok=True)
    with open(BASE, 'w', encoding='utf-8') as f:
        for k, v in now.items():
            f.write(f'{k}\t{base.get(k, v)}\n')   # 기준은 처음 통과한 값 그대로(조금씩 느려지는 것도 잡게) · 새 주소만 더함
print(f'plan_guard 통과 · 비용 {cost} · 기준 {"새로 적음" if not base else "갱신"} {BASE}')
