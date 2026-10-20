"""v10.47 시험 — 소개광장 › 우리동네 맛집(지도 기반) · docs/98

  KIT=… python3 test_v1047.py

  ① D100 — posts.board FOOD · 게시판 바꾸기 잠금 · town_places · town_food_posts · v_town_places · map.food_geolocation off
  ①-2 D101 — 위치기반 약관 폐기 재판단 · location_column_allow 8칸 · 마이그레이션 139
  ② 쓰는 이름이 모두 import · 선언됨
  ③ 등록 — app.module · 화면 목록(screens.json) · 공개 라우트는 community 아래
  ④ 기존 기능에 영향 없음 — 지도 off 면 탭 없음 · 「전체」 목록에 맛집 글이 섞이지 않음 · 게시판 목록 그대로 · 글 고치기 그대로
  ⑤ 보안 · 결정 — 이용자 위치를 서버로 받지 않음 · 화면이 보낸 가게 정보를 믿지 않음 · 카카오 자료는 최소 칸만 · 광고 · 협찬 표시
"""
import json, os, re

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
I = os.path.dirname(os.path.abspath(__file__)) + '/..'
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel, base=None):
    p = os.path.join(base or K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


def strip(s):
    s = re.sub(r'/\*[\s\S]*?\*/|(?<![:\w])//[^\n]*', '', s)   # https:// 같은 글자 속 // 는 주석이 아님
    return s


GLOBALS = {'Promise', 'Number', 'String', 'Date', 'Error', 'Set', 'Map', 'Object', 'JSON', 'Math', 'Array', 'Boolean', 'RegExp',
           'Record', 'NonNullable', 'Partial', 'Buffer', 'BigInt', 'Intl', 'Symbol', 'Infinity', 'NaN', 'Awaited', 'ReturnType',
           'React', 'HTMLDivElement', 'HTMLElement', 'HTMLInputElement', 'IntersectionObserver', 'AbortSignal', 'URLSearchParams',
           'Readonly', 'Pick', 'Omit', 'Exclude'}


def undefined_names(s):
    code = strip(s)
    code = re.sub(r"`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"", '""', code)
    code = re.sub(r'>[^<>{}]*<', '><', code)      # JSX 글자(한글 문장 속 낱말)
    code = re.sub(r'([(,=:!&|?]\s*)/(?:\\.|[^/\n\\])+/[gimsuy]*', r'\1""', code)   # 정규식 글자(/^Bearer\s+/i 등)
    imp = set()
    for m in re.finditer(r'import (?:type )?\{([^}]*)\}', s):
        imp |= {x.strip().replace('type ', '').split(' as ')[-1] for x in m.group(1).split(',') if x.strip()}
    imp |= set(re.findall(r'import (\w+)(?:\s*,|\s+from)', s))
    decl = set(re.findall(r'(?:class|interface|const|let|function|type|enum)\s+(\w+)', code))
    used = set(re.findall(r'(?<![.\w])([A-Z][a-z][A-Za-z0-9_]*)\b(?!\s*:)', code))
    return sorted(used - imp - decl - GLOBALS)



# ① D100 ---------------------------------------------------------------------
M = rd('prisma/migrations/D100_town_food/migration.sql')
ok('D100 있음', bool(M), '')
ok('posts.board 에 FOOD', "CHECK (board IN ('REVIEW','TRADE','QNA','NOTICE','FOOD'))" in M, '')
ok('게시판 바꾸기 잠금 트리거', 'CREATE TRIGGER trg_post_board_lock BEFORE UPDATE OF board ON public.posts' in M, '')
for t in ('town_places', 'town_food_posts'):
    ok(f'표 {t}', f'CREATE TABLE IF NOT EXISTS public.{t}' in M, '')
ok('가게는 카카오 ID 하나에 한 줄', 'CONSTRAINT uq_town_places_kakao UNIQUE (kakao_place_id)' in M, '')
ok('장소 주소는 place.map.kakao.com 만', "place_url ~ '^https://place\\.map\\.kakao\\.com/'" in M, '')
ok('숨길 때 사유 필수(CHECK)', 'CHECK (NOT is_hidden OR hidden_reason IS NOT NULL)' in M, '')
ok('맛집 글만 가게에 붙음(트리거)', 'TOWN_FOOD_POST:' in M, '')
ok('공개 보기 v_town_places — 공개 글 · 숨기지 않은 가게만', "p.state = 'PUBLISHED'" in M and 'WHERE NOT tp.is_hidden' in M, '')
vt = M[M.index('CREATE OR REPLACE VIEW public.v_town_places'):M.index("COMMENT ON VIEW public.v_town_places")]
ok('공개 보기에 작성자 · 연락처 칸 없음', not re.search(r'\b(author_id|email|phone|created_by)\b\s*(,|$)', vt.split('FROM')[0]), '')
ok('「현재 위치로」 처음 off', re.search(r"\('map\.food_geolocation', 'off'", M) is not None, '')
ok('자료를 지우지 않음(DROP TABLE · DELETE · TRUNCATE 없음)', not re.search(r'\b(DROP TABLE|DROP COLUMN|DELETE FROM|TRUNCATE)\b', strip(M)), '')
migs = sorted(d for d in os.listdir(os.path.join(K, 'prisma/migrations'))
              if os.path.exists(os.path.join(K, 'prisma/migrations', d, 'migration.sql')))
ok('마이그레이션 139 이상 · D100 · D101 있음', len(migs) >= 139 and 'D100_town_food' in migs and 'D101_location_column_allow' in migs, f'{len(migs)} · {migs[-1]}')

# ①-2 D101 — 위치기반 약관 폐기 재판단(2026-10-19 대표 A안) ---------------------------
L = rd('prisma/migrations/D101_location_column_allow/migration.sql')
ok('D101 있음', bool(L), '')
allow = re.findall(r"\('(\w+)',\s*'(lat|lng)'", L)
ok('허용 좌표 칸은 정확히 8개(매물 · 시군구 · 가게 · 가게 보기)', sorted(set(allow)) == sorted({(t, c) for t in ('listing_geo', 'geo_region', 'town_places', 'v_town_places') for c in ('lat', 'lng')}) and len(allow) == 8, str(len(allow)))
ok('검정 보기 2개 모두 허용 목록만 뺌(나머지 조건 그대로)', L.count('NOT EXISTS (SELECT 1 FROM public.location_column_allow a') == 2
   and "'^(lat|lng|lon|latitude|longitude|geohash)$'" in L and "geo_?(lat|lng|point)" in L and "('point', 'geography', 'geometry')" in L, '')
ok('폐기 스위치는 건드리지 않음(legal.location_waived)', "key = 'legal.location_waived'\n" not in L and "SET value = 'off'" not in L, '')
ok('근거 문구 길이 10~200(value_pattern)', all(10 <= len(v) <= 200 for v in re.findall(r"SET value = '([^']+)'", L)), '')
ok('D101 자료를 지우지 않음', not re.search(r'\b(DROP TABLE|DROP COLUMN|DELETE FROM|TRUNCATE)\b', strip(L)), '')
VI = rd('scripts/verify-invariants.sh')
ok('불변식 LOC-1 · LOC-2', 'LOC-1' in VI and 'LOC-2' in VI, '')

# ② 쓰는 이름 -----------------------------------------------------------------
TS = ['src/modules/community/town-food.service.ts', 'src/modules/community/town-food.controller.ts',
      'src/modules/community/community.service.ts', 'src/common/geo/kakao-local.provider.ts', 'src/app.module.ts',
      'site/src/components/community/FoodTab.tsx', 'site/src/components/community/FoodMap.tsx',
      'site/src/components/community/FoodWriteForm.tsx', 'site/src/components/community/Plaza.tsx',
      'site/src/components/community/PostEditor.tsx', 'site/src/components/community/types.ts',
      'site/src/app/community/food/page.tsx', 'site/src/app/community/food/[id]/page.tsx', 'site/src/app/community/food/write/page.tsx',
      'web/src/app/admin/FoodPlaces.tsx', 'web/src/app/admin/Community.tsx']
for f in TS:
    s = rd(f)
    ok(f'파일 있음 {f}', bool(s), '')
    miss = undefined_names(s)
    ok(f'쓰는 이름이 모두 import · 선언됨 — {os.path.basename(f)}', not miss, ' · '.join(miss))

# ③ 등록 -----------------------------------------------------------------------
am = rd('src/app.module.ts')
for c in ('TownFoodController', 'TownFoodAdminController', 'TownFoodService'):
    ok(f'app.module 에 {c}', re.search(r'\n\s+' + c + r',', am) is not None and c in am.split('@Module')[0], '')
sc = json.loads(rd('spec/screens.json') or '{}')
apis = {(s['id'], a) for s in sc.get('screens', []) for a in s.get('apis', [])}
NEED = [('SB-HOM-CMU-050', 'GET /community/food'), ('SB-HOM-CMU-050', 'GET /community/food/places'),
        ('SB-HOM-CMU-051', 'GET /community/food/places/{id}'), ('SB-HOM-CMU-052', 'GET /me/community/food/search'),
        ('SB-HOM-CMU-052', 'POST /me/community/food'), ('SB-ADM-CMU-010', 'GET /admin/community/food/places'),
        ('SB-ADM-CMU-010', 'PATCH /admin/community/food/places/{id}')]
miss = [f'{a} ({i})' for i, a in NEED if (i, a) not in apis]
ok('화면 목록에 새 API 7개', not miss, ' · '.join(miss))
ids = [s['id'] for s in sc.get('screens', [])]
ok('화면 id 겹침 없음', len(ids) == len(set(ids)), '')
tc = rd('src/modules/community/town-food.controller.ts')
routes = re.findall(r"@(Get|Post|Put|Patch|Delete)\('([^']+)'\)", tc)
ok('컨트롤러 라우트 7개', len(routes) == 7, ' · '.join(f'{m} {p}' for m, p in routes))
ok('응답 스키마 — 라우트마다 @ApiOkResponse', tc.count('@ApiOkResponse(') == 7, str(tc.count('@ApiOkResponse(')))
pub = [p for m, p in routes if not p.startswith('me/')]
ok('공개 라우트는 community 아래(ACL 공개 목록)', all(p.startswith('community/') for p in pub[:3]) and "'community'" in rd('scripts/check-acl.js'), ' · '.join(pub))
ok('쓰기 · 찾기는 로그인(@Roles)', tc.count("@Roles('MEMBER', 'ADMIN', 'SUPER')") == 2, '')
ok('운영 API 는 ADMIN · SUPER', "@Controller('api/v1/admin')\n@Roles('ADMIN', 'SUPER')\nexport class TownFoodAdminController" in tc, '')
ok('불리언 입력은 @StrictBoolean', tc.count('@StrictBoolean()') == 2 and '@IsBoolean' not in tc, '')
inv = rd('scripts/verify-invariants.sh')
ok('불변식 FOOD-1 ~ 4', all(f'"FOOD-{i} ' in inv for i in range(1, 5)), '')
ver = tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))[:2] or [0, 0])
ok('VERSION v10.47 이상', ver >= (10, 47), rd('VERSION').strip())   # v10.48 부터 다음 판에서도 그대로 돌게(v1046 과 같은 방식)
ok('판 문서 docs/98', any(n.startswith('98_') for n in os.listdir(os.path.join(K, 'docs'))), '')
ok('final_parts 에 test_v1047', 'test_v1047' in rd('qa/final_parts.sh', I), '')

# ④ 기존 기능에 영향 없음 ---------------------------------------------------------
cs = rd('src/modules/community/community.service.ts')
ok('「전체」 목록 · 메인에 맛집 글이 섞이지 않음(3곳)', cs.count("(($1::text IS NULL AND p.board <> 'FOOD') OR p.board = $1)") == 3
   and 'WHERE ($1::text IS NULL OR p.board = $1)' not in cs, '')
ok('게시판 목록(BOARDS) 그대로', "const BOARDS = ['REVIEW', 'TRADE', 'QNA', 'NOTICE'];" in cs, '')
cd = rd('src/modules/community/community.dto.ts')
ok('글쓰기 DTO 그대로(FOOD 를 받지 않음)', "@IsIn(['REVIEW', 'TRADE', 'QNA'])" in cd and 'FOOD' not in cd, '')
ft = rd('site/src/components/community/FoodTab.tsx')
ok('탭 — 지도 off 면 그리지 않음', 'if (!m?.enabled) return null;' in ft, '')
pl = rd('site/src/components/community/Plaza.tsx')
ok('기존 탭 6개 그대로 + 맛집 탭은 맨 뒤', "{ v: 'NOTICE', t: '공지' }," in pl and pl.index('data-polls-tab') < pl.index('<FoodTab cur={cur} />'), '')
pe = rd('site/src/components/community/PostEditor.tsx')
ok('글 고치기 — 다른 게시판은 전처럼 board 를 보냄', "{ title: t, body: b, board })" in pe and "edit.board === 'FOOD' ? { title: t, body: b }" in pe, '')
fs = rd('src/modules/community/town-food.service.ts')
ok('쓰기 · 찾기 — 지도 off 면 422 MAP_DISABLED', fs.count('await this.mustEnabled();') == 2, '')
ok('지도 · 목록 — 지도 off 면 빈 목록', "if (!(await this.geo.enabled())) return { enabled: false, items: [], truncated: false };" in fs, '')
fd = rd('web/src/app/admin/FoodPlaces.tsx')
ok('운영 — 지도 off · 가게 없음이면 구역을 그리지 않음', 'if (on === null || (!on && rows.length === 0 && !kw)) return null;' in fd, '')
css = rd('site/src/styles/food.css')
cls = set()
for f in ('site/src/components/community/FoodMap.tsx', 'site/src/components/community/FoodWriteForm.tsx',
          'site/src/app/community/food/page.tsx', 'site/src/app/community/food/[id]/page.tsx'):
    for m in re.findall(r'className=\{?[`"]([^`"]+)', rd(f)):
        cls |= {c for c in m.split() if c.startswith('fd-')}
ok('새 클래스 fd- 는 모두 food.css 에', cls and all(('.' + c) in css for c in cls), ' · '.join(sorted(cls)))
ok('맛집 배지 색 .plz-bd-food', '.plz-bd-food' in rd('site/src/styles/plaza.css'), '')

# ⑤ 보안 · 결정 ---------------------------------------------------------------------
pq = re.search(r'async places\(q:[\s\S]*?\n  \}\n', fs).group(0)
ok('서버는 이용자 위치를 받지 않음(지도 네 모서리만)', 'swLat' in pq and 'geolocation' not in pq and 'userLat' not in pq, '')
fm = rd('site/src/components/community/FoodMap.tsx')
here = re.search(r'function here\(\)[\s\S]*?\n  \}\n', fm).group(0)
ok('「현재 위치로」 — 지도만 옮김(fetch 없음)', 'getCurrentPosition' in here and 'fetch' not in here and 'moveTo' in here, '')
ok('「현재 위치로」 단추는 설정이 켜졌을 때만', '{geolocation && <button' in fm, '')
wr = re.search(r'async write\(dto[\s\S]*?\n  \}\n', fs).group(0)
ok('쓰기 — 화면이 보낸 가게 정보를 믿지 않음(서버가 찾은 결과 · 등록된 가게만)', 'this.picks.get(me)' in wr and 'PLACE_NOT_PICKED' in wr
   and not re.search(r'dto\.(name|lat|lng|road|address)', wr), '')
ok('찾기 — 음식점 · 카페만 · 1분 30회', "new Set(['FD6', 'CE7'])" in fs and 'SEARCH_PER_MIN = 30' in fs, '')
ok('카카오 자료는 최소 칸만 저장', re.search(r'INSERT INTO town_places \(kakao_place_id, name, category, phone, road, jibun, sido, sigungu, dong, lat, lng, place_url, created_by\)', fs) is not None, '')
ok('글 작성자는 첫 글자만(publicAuthor)', 'author: publicAuthor(r._name, r._staff)' in fs, '')
fw = rd('site/src/components/community/FoodWriteForm.tsx')
ok('광고 · 협찬 체크', 'sponsored' in fw and '광고 · 협찬입니다' in fw, '')
ok('운영 숨기기 — 사유 필수', "PolicyViolation('HIDE_REASON'" in fs, '')
fp = rd('site/src/app/community/food/[id]/page.tsx')
ok('가게 화면은 개인 응답(apiGetPersonal — 내 검수 중 글)', 'apiGetPersonal<Place>' in fp, '')
ok('카카오맵 링크는 새 창 · noopener', 'target="_blank" rel="noopener noreferrer"' in fp, '')

# ⑥ 개발 서버(ts-node · strict 끔)에서 뜨는가 — 2026-10-19 realcheck 에서 API 가 TS2339 로 뜨지 않았음
#    strict 를 끄면 `if (r.ok)` 뒤에도 실패 쪽(kind)이 좁혀지지 않습니다 → 실패 칸은 `r as GeoFail` 로만 꺼냄
for f in ('src/common/geo/geo.service.ts', 'src/modules/community/town-food.service.ts'):
    t = strip(rd(f))
    ok(f'ts-node 에서 뜸 — 성공 · 실패 결과의 kind 를 좁히지 않고 읽지 않음({f.split("/")[-1]})',
       not re.search(r'\br\.kind\b', t) and 'as GeoFail' in t, '')
ok('GeoFail 형식을 내보냄', 'export type GeoFail' in rd('src/common/geo/kakao-local.provider.ts'), '')

# ⑦ DTO 선언 순서 — ts-node(strict 끔)는 `x?: Dto | null` 을 design:type 으로 바로 참조 → 뒤에 선언된 클래스면 ReferenceError(2026-10-19)
fwd = []
for f in ('src/modules/listing/listing.dto.ts', 'src/modules/geo/geo.controller.ts', 'src/modules/community/town-food.controller.ts'):
    t = rd(f)
    decl = {m.group(1): m.start() for m in re.finditer(r'^(?:export\s+)?class\s+(\w+)', t, re.M)}
    for m in re.finditer(r'^\s+\w+[!?]?:\s*([A-Z]\w+)\s*(?:\|\s*(?:null|undefined)\s*)*;', t, re.M):
        if m.group(1) in decl and decl[m.group(1)] > m.start():
            fwd.append(f.split('/')[-1] + ':' + m.group(1))
ok('DTO 형식은 쓰기 전에 선언(ts-node 에서 뜸)', not fwd, ' · '.join(fwd))

n_ok = sum(1 for r in RES if r[0])
print(f'통과 {n_ok} / {len(RES)}')
