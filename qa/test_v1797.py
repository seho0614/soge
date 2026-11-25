"""v10.797 (docs/912) 부하 시험 — 매물 목록 두 단계 조회(번호 먼저 → 카드 정보는 그 쪽에만) · 부하 시드 고침
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb python3 test_v1797.py
  ① (코드) WITH pg(정렬 · 커서 · 쪽 번호 그대로) · 지역 · 급구 보기는 필요할 때만 · 끌어올림 join 한 번 · 바깥 정렬 pg.ord · 건수도 필요할 때만 · seed-load 고침 · 문서 912
  ② (API) 정렬 8종 · 지역 · 급구 · 낱말 · 관련순 · 쪽 번호 — 200 · 1쪽 21 이하 · 커서 2쪽이 1쪽과 겹치지 않음 · 쪽 번호 total
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb' if os.path.isdir(KIT + '/sgb') else KIT
API = os.environ.get('API')
DB = os.environ.get('DB')
ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


def doc(prefix):
    d = os.path.join(K, 'docs')
    return next((open(os.path.join(d, x), encoding='utf-8').read() for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith(prefix)), '')


VER = rd('VERSION').strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=180).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()




def login(e):
    return call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')


RP, SL = rd('src/modules/listing/listing.repository.ts'), rd('scripts/seed-load.js')
ok('① 두 단계 — WITH pg · LIMIT 안쪽 · 바깥 pg.ord · 지역 · 급구 빈 자리(ON false) · 끌어올림 join 1 · 표시는 pg.bx_kind · 건수도 필요할 때만',
   'WITH pg AS (' in RP and 'FROM pg JOIN listings l ON l.id = pg.id ${this.JOINS}' in RP and "ORDER BY pg.ord ${rel ? 'ASC' : 'DESC'}, l.id DESC" in RP
   and "LEFT JOIN (SELECT NULL::text AS sido_code) vr ON false" in RP and RP.count('LEFT JOIN lsx_bump_live bx ON bx.listing_id = l.id') == 1
   and "pg.bx_kind = 'PAID'" in RP and "${p.regionCode ? 'LEFT JOIN v_listing_region vr" in RP, '')
ok('① 부하 시드 — COPY 는 pg-copy-streams 있을 때 · SEED_COPY=1 만 · 딸린 줄 먼저 지움(주인 없는 L 사업자) · 문서 912(28 조건 같음) · 판',
   "require.resolve('pg-copy-streams')" in SL and "process.env.SEED_COPY === '1'" in SL and "biz_reg_no ~ '^L[0-9]{6}$'" in SL
   and '다름 0 / 28' in doc('912_') and VT >= (10, 797), VER)

if API and DB:
    cases = [('최근', 'sort=RECENT'), ('소개비', 'sort=FEE_DESC'), ('인기', 'sort=POPULAR'), ('마감', 'sort=DEADLINE'), ('비율', 'sort=FEE_RATIO'),
             ('금액↑', 'sort=AMOUNT_ASC'), ('금액↓', 'sort=AMOUNT_DESC'), ('관', 'gwanCode=BIZ'), ('지역', 'regionCode=ETC'), ('급구', 'urgent=ANY'),
             ('낱말', 'keyword=' + urllib.parse.quote('카페')), ('관련', 'keyword=' + urllib.parse.quote('카페') + '&sort=RELEVANCE')]
    bad = []
    for name, qs in cases:
        r = call('GET', f'/listings?view=0&limit=5&{qs}')
        if r.get('_err') or not isinstance(r.get('organic'), list) or len(r['organic']) > 5:
            bad.append(f'{name}:{r.get("_err")}'); continue
        if r.get('nextCursor') and name != '관련':   # 관련도순은 키셋이 없음(첫 쪽만 · 옛 동작 그대로)
            r2 = call('GET', f'/listings?view=0&limit=5&{qs}&cursor=' + urllib.parse.quote(r['nextCursor']))
            if r2.get('_err') or {x['id'] for x in r['organic']} & {x['id'] for x in r2.get('organic', [])}:
                bad.append(f'{name}:2쪽')
    pg = call('GET', '/listings?view=0&limit=5&page=2')
    ok('② 정렬 8종 · 관 · 지역 · 급구 · 낱말 · 관련순 200 · 커서 2쪽 안 겹침 · 쪽 번호 total',
       not bad and isinstance(pg.get('total'), int) and pg.get('page') == 2, f'{bad} · total {pg.get("total")}')

# ③ 11/25 묶음 7 전체 점검 고침 — fn_trust_score 예상 줄 수 1(D333) · 카드 21줄에 신뢰 점수를 붙인 조회 비용이 JIT 기준(10만) 아래
MIG3 = rd('prisma/migrations/D333_trust_score_rows/migration.sql')
ok('③ D333 — ALTER FUNCTION fn_trust_score(uuid) ROWS 1 · 문서 912 6절',
   'ALTER FUNCTION public.fn_trust_score(uuid) ROWS 1;' in MIG3 and 'JIT 컴파일' in doc('912_'), '')
if DB:
    rows = psql("SELECT prorows FROM pg_proc WHERE proname = 'fn_trust_score'")
    plan = psql("EXPLAIN (FORMAT JSON) SELECT tr.score FROM (SELECT owner_account_id FROM listings LIMIT 21) l "
                "LEFT JOIN v_account_trust tr ON tr.account_id = l.owner_account_id")
    try:
        cost = json.loads(plan)[0]['Plan']['Total Cost']
    except Exception:
        cost = None
    ok('③ DB — prorows 1 · 신뢰 점수 21줄 조회 비용이 jit_above_cost(100000) 아래',
       rows == '1' and cost is not None and cost < 100000, f'prorows {rows} · 비용 {cost}')
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
