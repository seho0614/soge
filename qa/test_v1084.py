"""v10.84 시험 — 동의어 사전 기본값 31개(D112 · docs/138)

  KIT=… [DB=postgresql://sgb:sgb@localhost:15432/sgb] [API=http://localhost:13000/api/v1] python3 -I test_v1084.py
"""
import glob, json, os, re, subprocess, urllib.parse, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
DB = os.environ.get('DB'); API = os.environ.get('API')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


rd = lambda rel: open(os.path.join(K, rel), encoding='utf-8').read() if os.path.exists(os.path.join(K, rel)) else ''
M = rd('prisma/migrations/D112_search_synonym_seed/migration.sql')
rows = re.findall(r"^\s*\('([^']+)', '([^']+)', '([A-Z]+)', (\d+)\)", M, re.M)
ok('31개 · 넣기만(이미 있으면 건너뜀)', len(rows) == 31 and 'ON CONFLICT (term, kind) DO NOTHING;' in M and not re.search(r'\b(DELETE|UPDATE|TRUNCATE|DROP)\b', M), len(rows))
ok('관(GWAN) 종류 없음 · 자기 자신 없음 · 띄어쓰기 없음', all(k != 'GWAN' and t != c and ' ' not in t + c for t, c, k, w in rows), '')
BLOCK = ('다단계', '대부', '도박', '사행', '의료', '의약', '법률', '인력공급', '대출')
ok('제한업종 낱말 없음', not [r for r in rows if any(b in r[0] + r[1] for b in BLOCK)], '')
ok('겹치는 치는 말 없음', len({(t, k) for t, c, k, w in rows}) == 31, '')
seeds = ''.join(open(f, encoding='utf-8').read() for f in glob.glob(os.path.join(K, 'prisma/migrations/C92*/migration.sql')))
ok('기존 사전(C920 ~)과 같은 치는 말 · 종류 없음', not [t for t, c, k, w in rows if re.search(rf"\('{re.escape(t)}',\s*'[^']+',\s*'{k}'", seeds)], '')
mig = sorted(os.path.basename(os.path.dirname(p)) for p in glob.glob(os.path.join(K, 'prisma/migrations/*/migration.sql')))
ok('마이그레이션 150 · 마지막 D112(v10.89 부터 D113 · 151 — test_v1089)', (len(mig), mig[-1] if mig else '') in ((150, 'D112_search_synonym_seed'), (151, 'D113_job_stale_weekly'), (152, 'D114_seed_ad_ends_extend')), f'{len(mig)} · {mig[-1] if mig else ""}')

def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return r.returncode, r.stdout.strip(), r.stderr.strip()

if DB:
    rc, n, err = psql("SELECT count(*) FROM search_synonyms WHERE (term, kind) IN (" + ','.join(f"('{t}','{k}')" for t, c, k, w in rows) + ")")
    ok('③ DB 에 31개가 있음', rc == 0 and n == '31', n or err)
    rc, out, err = psql("SELECT fn_search_expand('식당 양도') UNION ALL SELECT fn_search_expand('음식점') UNION ALL "
                        "SELECT fn_search_match('강남 음식점 넘김', '', fn_search_expand('식당 매도'))::text UNION ALL "
                        "SELECT fn_search_match('강남 음식점', '', fn_search_expand('식당 매도'))::text")
    L = out.split('\n') if rc == 0 else []
    ok('③ 넓히기 — 식당 ↔ 음식점 · 양도 ↔ 매도 · 넘김 · 두 낱말 모두 있어야 맞음', len(L) == 4 and L[0].startswith('식당|음식점 양도|') and '매도' in L[0].split(' ')[1]
       and '넘김' in L[0].split(' ')[1] and L[1].startswith('음식점|') and '식당' in L[1] and L[2:] == ['true', 'false'], out[:200] or err)
if API and DB:
    t = psql("SELECT title FROM listings WHERE status='PUBLISHED' AND title ~ '고깃집' LIMIT 1")[1]
    if t:
        r = urllib.request.urlopen(API + '/search?' + urllib.parse.urlencode({'q': '고기집'}), timeout=30)
        js = json.loads(r.read())
        ok('④ 통합 검색 「고기집」(오타) → 「고깃집」 매물을 찾음', any(x['title'] == t for x in js.get('listings', [])), [x['title'] for x in js.get('listings', [])][:3])
ok('VERSION v10.84 이상', re.match(r'v10\.(8[4-9]|9\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
