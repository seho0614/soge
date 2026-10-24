"""v10.83 시험 — 검색 정리(D111 · docs/137)

  KIT=… [DB=postgresql://sgb:sgb@localhost:15432/sgb] [API=http://localhost:13000/api/v1] python3 -I test_v1083.py

  ① 마이그레이션 — 숨김 칸 · fn_search_alts · fn_search_expand · fn_search_match/head/rank 가 | 대안을 읽음 · 관(GWAN)은 넓히지 않음 · 마지막 D111 · 149
  ② 서버 · 화면 — 넓히기는 검색 한 번에 한 번(공용 도우미) · 통합 검색 두 탭 낱말별 · limit · 추천 검색어 숨기기 · 두 글자 안내 · open-prep
  ③ (DB) 거래 안에서 — 대안 없는 검색어는 전과 같음 · 동의어 · 오타 · 관 제외 · 앞 거르기 · 관련순
  ④ (API) 점검판 — 띄어쓰기 · 낱말 순서 · 동의어(운영 API 로 넣고 지움) · limit · 추천 검색어 숨기기
"""
import glob, json, os, re, subprocess, urllib.parse, urllib.request, uuid

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
DB = os.environ.get('DB'); API = os.environ.get('API')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


rd = lambda rel: open(os.path.join(K, rel), encoding='utf-8').read() if os.path.exists(os.path.join(K, rel)) else ''
M = rd('prisma/migrations/D111_search_synonym_expand/migration.sql')
ok('① 추천 검색어 숨김 칸', 'ALTER TABLE public.search_term_stats ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;' in M, '')
ok('① 넓히기 함수 — 원래 말 맨 앞 · 관 제외 · 최대 8 · 띄어쓰기 · | 든 말 제외', 'CREATE OR REPLACE FUNCTION public.fn_search_alts(p_word text)' in M and M.count("kind <> 'GWAN'") >= 3
   and 'LIMIT 8' in M and "position('|' in a) = 0 AND position(' ' in a) = 0" in M and 'CREATE OR REPLACE FUNCTION public.fn_search_expand(p_kw text)' in M and "replace(p_kw, '|', ' ')" in M, '')
ok('① 판정 · 앞 거르기 · 관련순이 | 를 읽음(같은 이름 · 같은 인자 · IMMUTABLE)', M.count('LANGUAGE sql IMMUTABLE') == 3 and "string_to_array(btrim(w.t), '|')" in M
   and "THEN ''   -- D111" in M and "string_to_array(split_part(btrim(p_kw), ' ', 1), '|')" in M, '')
ok('① 자료를 지우지 않음', not re.search(r'\b(DELETE FROM|TRUNCATE|DROP TABLE)\b', M), '')
mig = sorted(os.path.basename(os.path.dirname(p)) for p in glob.glob(os.path.join(K, 'prisma/migrations/*/migration.sql')))
ok('① 마이그레이션 149 · 마지막 D111(v10.84 부터 D112 · 150 — test_v1084)', (len(mig), mig[-1] if mig else '') in ((149, 'D111_search_synonym_expand'), (150, 'D112_search_synonym_seed'), (151, 'D113_job_stale_weekly')), f'{len(mig)} · {mig[-1] if mig else ""}')

H = rd('src/core/search-expand.ts')
ok('② 공용 도우미 — 한 번 부름 · | 를 띄어쓰기로', 'SELECT fn_search_expand($1) AS k' in H and ".replace(/\\|/g, ' ')" in H, '')
uses = {f: rd(f) for f in ('src/modules/listing/listing.service.ts', 'src/engines/exposure/exposure.engine.ts', 'src/modules/public/public.service.ts',
                          'src/modules/community/community.service.ts', 'src/modules/health/health-catalog.service.ts')}   # v10.86 — 소개몰 검색은 health-catalog 로 옮김
ok('② 넓히기를 쓰는 검색 5곳(관 목록 · 노출 엔진 · 통합 검색 · 소개광장 · 소개몰)', all('expandKeyword(this.db' in v for v in uses.values()), [k for k, v in uses.items() if 'expandKeyword(this.db' not in v])
P = uses['src/modules/public/public.service.ts']
ok('② 통합 검색 API — 매물 · 요청 모두 낱말별(fn_search_match · 제목 + 업종)', 'fn_search_match(l.title, c.name, $1)' in P and 'fn_search_match(r.title, c.name, $1)' in P
   and 'lower(l.title) LIKE fn_search_like($1)' not in P and 'lower(r.title) LIKE fn_search_like($1)' not in P, '')
ok('② 통합 검색 표(match=TITLE)도 낱말별', 'NOT $12::boolean OR fn_search_match(l.title, cat.name, $3)' in rd('src/modules/listing/listing.repository.ts'), '')
ok('② limit — 1 ~ 50 정수만 · 아니면 20', 'Number.isInteger(n) && n >= 1 ? Math.min(n, 50) : 20' in rd('src/modules/public/public.controller.ts'), '')
S = rd('src/modules/search/search.service.ts'); A = rd('src/modules/search/search-admin.controller.ts'); W = rd('web/src/app/admin/AiLearn.tsx')
ok('② 추천 검색어 — 숨긴 말 빼기 · 운영 API · 화면 단추', 'AND NOT s.hidden' in S and "@Post('search/terms/hide')" in A and "@Audit('SEARCH_TERM_HIDE', 'SEARCH_TERM')" in A
   and 'data-search-top' in W and "hideTerm(t, true)" in W and "hideTerm(t, false)" in W, '')
ok('② 두 글자 안내 — 통합 검색 · 소개몰 화면', 'data-search-short' in rd('site/src/app/search/page.tsx') and "q && !short ? await Promise.all([" in rd('site/src/app/search/page.tsx')
   and '두 글자 이상 입력해 주세요.' in rd('site/src/app/health/search/page.tsx'), '')
ok('② 오픈 직전 정리 — 추천 검색어 숨김(지우지 않음)', 's AS (UPDATE search_term_stats SET hidden = true WHERE NOT hidden RETURNING 1)' in rd('deploy/aws/open-prep.sh'), '')
ok('② 명세 — 화면 연결 · 응답 표본', '"POST /admin/search/terms/hide"' in rd('spec/screens.json') and '"post /api/v1/admin/search/terms/hide"' in rd('spec/response_samples.json'), '')

def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return r.returncode, r.stdout.strip(), r.stderr.strip()

if DB:
    rc, out, err = psql("""BEGIN;
      SELECT fn_search_match('해운대 고깃집 양도', '', '고깃 집')::text, fn_search_match('해운대 고깃집 양도', '', '양도 고깃집')::text,
             fn_search_match('해운대 고깃집 양도', '', '고깃집 서울')::text, fn_search_match('해운대 고깃집 양도', '', '')::text,
             fn_search_match('카페 양도', '', '커피숍|카페 양도')::text, fn_search_head('커피숍|카페 양도'), fn_search_head('고깃집 양도'),
             fn_search_rank('해운대 고깃집', '없음|고깃집')::text;
      INSERT INTO search_synonyms(term, canonical, kind, weight) VALUES ('점검커피숍', '점검카페', 'ITEM', 5), ('점검관말', '점검관이름', 'GWAN', 5);
      SELECT fn_search_expand('점검커피숍 점검낱말'), fn_search_expand('점검카페'), fn_search_expand('점검관말'), coalesce(fn_search_expand('  '), 'NULL'), fn_search_expand('a|b 가');
      ROLLBACK;""")
    L = out.split('\n')
    ok('③ 대안 없는 검색어 — 띄어쓰기 · 순서는 맞음 · 없는 낱말이면 안 맞음 · 빈 검색어는 모두(전과 같음)', rc == 0 and L[0] == 'true|true|false|true|true||고깃집|5', (out or err)[:200])
    ok('③ 동의어 넓히기 — 치는 말 → 우리 말 · 우리 말 → 치는 말 · 관(GWAN) 안 넓힘 · 빈 → NULL · 사람이 친 | 는 띄어쓰기', rc == 0 and len(L) >= 2
       and L[1] == '점검커피숍|점검카페 점검낱말|점검카페|점검커피숍|점검관말|NULL|a b 가', (out or err)[:200])
    rc, out, err = psql("SELECT count(*) FROM listings WHERE status='PUBLISHED' AND fn_search_match(title, body, '고깃 집')")
    ok('③ 실제 매물 — 「고깃 집」', rc == 0 and out.isdigit() and int(out) >= 1, out or err)
else:
    print('     (DB 없음 — ③ 건너뜀)')

if API and DB:
    def call(m_, p, tok=None, body=None):
        h = {'content-type': 'application/json'}
        if tok: h['authorization'] = 'Bearer ' + tok
        req = urllib.request.Request(API + p, method=m_, data=json.dumps(body).encode() if body is not None else None, headers=h)
        try: r = urllib.request.urlopen(req, timeout=30); st, raw = r.status, r.read()
        except urllib.error.HTTPError as ex: st, raw = ex.code, ex.read()
        try: js = json.loads(raw) if raw else None
        except Exception: js = None
        return st, js
    G = lambda p, **kw: call('GET', p + '?' + urllib.parse.urlencode(kw))
    t = psql("SELECT title FROM listings WHERE status='PUBLISHED' AND title ~ '고깃집' LIMIT 1")[1]
    if t:
        res = {qq: G('/search', q=qq)[1] for qq in ('고깃 집', '양도 고깃집')}
        ok('④ 통합 검색 API — 「고깃 집」 · 「양도 고깃집」 → 찾음', all(any(x['title'] == t for x in (v or {}).get('listings', [])) for v in res.values()), {k: len((v or {}).get('listings', [])) for k, v in res.items()})
        st, js = G('/listings', keyword='양도 고깃집', match='TITLE', sort='RELEVANCE', limit='20')
        ok('④ 통합 검색 표(match=TITLE) — 「양도 고깃집」', any(x['title'] == t for x in (js or {}).get('organic', [])), st)
    rq = psql("SELECT title FROM requests WHERE status='PUBLISHED' AND title ~ '강남' AND title ~ '상가' LIMIT 1")[1]
    if rq:
        st, js = G('/search', q='상가 강남')
        ok('④ 소개받기 요청 — 「상가 강남」', any(x['title'] == rq for x in (js or {}).get('requests', [])), st)
    st = [G('/search', q='소개', limit=v)[0] for v in ('abc', '-1', '1.5', '0', '100000')]
    ok('④ limit 이상한 값 → 500 아님', all(x == 200 for x in st), st)
    ADM = call('POST', '/auth/login', body={'email': 'admin@x.com', 'password': 'sgb-dev-1234'})[1]['accessToken']
    if t:
        typo = '고깃집점검' + uuid.uuid4().hex[:4]   # 사전에 없는 시험용 말(v10.84 부터 「고기집」은 기본 사전에 있음 · D112)
        s0 = G('/search', q=typo)[1]
        sa, ja = call('POST', '/admin/search/synonyms', ADM, {'term': typo, 'canonical': '고깃집', 'kind': 'ITEM', 'weight': 5})
        s1 = G('/search', q=typo)[1]
        sid = (ja or {}).get('id')
        if sid: call('DELETE', f'/admin/search/synonyms/{sid}', ADM)
        s2 = G('/search', q=typo)[1]
        ok('④ 동의어를 넣으면 다음 검색부터 적용 · 지우면 원래대로', not any(x['title'] == t for x in (s0 or {}).get('listings', []))
           and any(x['title'] == t for x in (s1 or {}).get('listings', [])) and not any(x['title'] == t for x in (s2 or {}).get('listings', [])), f'넣기 {sa}')
    term = psql("SELECT term FROM search_term_stats WHERE hits > zero_hits AND NOT hidden AND length(term) BETWEEN 2 AND 20 ORDER BY hits DESC LIMIT 1")[1]
    if term:
        before = term in (G('/search/suggest', q=term[:2])[1] or {}).get('keywords', [])
        sh, jh = call('POST', '/admin/search/terms/hide', ADM, {'term': term, 'hidden': True})
        hidden = term in (G('/search/suggest', q=term[:2])[1] or {}).get('keywords', [])
        call('POST', '/admin/search/terms/hide', ADM, {'term': term, 'hidden': False})
        back = term in (G('/search/suggest', q=term[:2])[1] or {}).get('keywords', [])
        s404 = call('POST', '/admin/search/terms/hide', ADM, {'term': 'zz' + uuid.uuid4().hex[:6], 'hidden': True})[0]
        ok('④ 추천 검색어 숨기기 → 팝업에서 빠짐 · 다시 보이기 → 돌아옴 · 없는 말 404', before and not hidden and back and sh in (200, 201) and s404 == 404, f'{term} {before} {hidden} {back} {s404}')
else:
    print('     (API · DB 없음 — ④ 건너뜀)')

ok('VERSION v10.83 이상', re.match(r'v10\.(8[3-9]|9\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
