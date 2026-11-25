"""v10.797 (sgb-core docs/912) 부하 시험 — 점검판 공개 API 응답 시간 재기(손님이 많이 부르는 GET)
  API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb python3 load_probe.py [이름표] [-n 7]
  · 주소마다 n 번(첫 번은 데움 · 뺌) · 중앙값 · 가장 느린 값(ms) · 상태 · 매물 수(listings)를 한 줄씩
  · 결과는 표준 출력 + qa/out/load_probe_<이름표>.tsv — 시드 전(base)과 10만 건 뒤(100k)를 나란히 봄
  · 읽기만(GET · view=0) · 점검판 주소만(확인판 · RDS · 운영 아님) · API 나 DB 가 비면 멈춤
"""
import json, os, statistics, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

API = os.environ.get('API'); DB = os.environ.get('DB')
if not API or not DB or not any(p in API for p in (':13000', ':13100')):
    print('API · DB 를 점검판 주소로 주십시오(13000)'); raise SystemExit(2)
args = [a for a in sys.argv[1:]]
N = 7
if '-n' in args:
    i = args.index('-n'); N = max(3, int(args[i + 1])); del args[i:i + 2]
TAG = (args[0] if args else 'base').strip()[:20] or 'base'
HERE = os.path.dirname(os.path.abspath(__file__))


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-c', sql], capture_output=True, text=True)
    return r.stdout.strip()


cat = psql("SELECT id FROM categories WHERE gwan_code = 'MNY' ORDER BY id LIMIT 1")
try:
    _rg = json.loads(urllib.request.urlopen(API + '/market/regions', timeout=30).read() or b'[]')
    _rg = _rg.get('items', _rg) if isinstance(_rg, dict) else _rg
    REG = next((str(x.get('code')) for x in _rg if isinstance(x, dict) and x.get('code') and str(x.get('code')).upper() != 'ETC'), 'ETC')
except Exception:
    REG = 'ETC'
URLS = [
    ('매물 최근', '/listings?view=0&limit=20'),
    ('매물 관 MNY', '/listings?view=0&gwanCode=MNY&limit=20'),
    ('매물 관 BIZ 인기', '/listings?view=0&gwanCode=BIZ&sort=POPULAR&limit=20'),
    ('매물 업종', f'/listings?view=0&categoryId={cat}&limit=20' if cat else '/listings?view=0&limit=20'),
    ('매물 지역 첫 곳', f'/listings?view=0&regionCode={urllib.parse.quote(REG)}&limit=20'),
    ('매물 낱말', '/listings?view=0&keyword=' + urllib.parse.quote('카페') + '&limit=20'),
    ('매물 낱말 제목만', '/listings?view=0&keyword=' + urllib.parse.quote('매장') + '&match=TITLE&limit=20'),
    ('매물 급매', '/listings?view=0&urgent=SELL&limit=20'),
    ('요청 목록', '/requests?limit=20'),
    ('검색 제안', '/search/suggest?q=' + urllib.parse.quote('카페')),
    ('관 목록', '/gwans'),
    ('업종 목록', '/categories'),
    ('공지', '/notices'),
    ('소개광장 글', '/community/posts'),
    ('소개몰 상품', '/health/products'),
    ('메인 구역', '/main/sections'),
    ('공개 설정', '/site-settings/public'),
]


def one(path):
    t = time.perf_counter()
    try:
        r = urllib.request.urlopen(API + path, timeout=60); r.read(); st = r.status
    except urllib.error.HTTPError as e:
        st = e.code
    except Exception:
        st = 0
    return (time.perf_counter() - t) * 1000, st


n_list = psql('SELECT count(*) FROM listings')
rows = []
for name, path in URLS:
    one(path)
    ts, sts = [], set()
    for _ in range(N - 1):
        ms, st = one(path); ts.append(ms); sts.add(st)
    rows.append((name, path, round(statistics.median(ts), 1), round(max(ts), 1), ','.join(str(s) for s in sorted(sts))))
os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
with open(os.path.join(HERE, 'out', f'load_probe_{TAG}.tsv'), 'w', encoding='utf-8') as f:
    f.write(f'# {TAG} · 매물 {n_list} · {time.strftime("%Y-%m-%d %H:%M")} · n={N}\n')
    for r in rows:
        f.write('\t'.join(str(x) for x in r) + '\n')
print(f'== 부하 재기 {TAG} · 매물 {n_list}건 · 주소마다 {N - 1}번(데움 뺌)')
for r in rows:
    print(f'{r[0]:<14} 중앙 {r[2]:>8} ms · 최대 {r[3]:>8} ms · 상태 {r[4]}')
