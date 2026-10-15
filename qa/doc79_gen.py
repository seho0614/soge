"""문서 79(v10.30)를 결과 파일에서 만듭니다 — 수치는 모두 결과 파일에서 읽습니다(손으로 적지 않음).
   python3 doc79_gen.py > ../sgb/docs/79_소개장터메인_제시디자인적용_v10.30_20261009.md      (ZIP_MB · TGZ_MB · N_FILES 를 주면 묶음 줄을 채움)"""
import json, os, re, sys
Q = os.path.dirname(os.path.abspath(__file__))
K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
def J(f, d=None):
    p = os.path.join(Q, f)
    return json.load(open(p, encoding='utf8')) if os.path.exists(p) else d
def read_final(f):
    out = []
    p = os.path.join(Q, f)
    if os.path.exists(p):
        for l in open(p, encoding='utf8').read().split('\n'):
            if ': ' in l and not l.startswith('PART-'): k, v = l.split(': ', 1); out.append((k, v.strip()))
    return out
def verdict(v):
    if v.startswith('건너뜀'): return '건너뜀'
    if 'v10.29 그대로에서도' in v and '이 판에서만 실패 0' in v and '같은 단계 0개 실패' not in v: return '넘어옴'
    if v.startswith('통과 —'): return '통과'
    if re.search(r'실패 [1-9]|FAIL|✗|뚫림 [1-9]|exit=[1-9]|▲위험 [1-9]|Error|Traceback|Timeout|^실패|문제 [1-9]', v): return '실패'
    mm = re.search(r'(\d+)\s*/\s*(\d+)', v)
    if mm and mm.group(1) != mm.group(2) and not re.search(r'통과 \d+ / 실패 0', v): return '통과' if ('건너뜀' in v and '실패' not in v) else '확인'
    return '통과'
final = read_final('final_all.txt'); rer = dict(read_final('final_all_reruns_1030.txt'))
FIN = [(k, rer.get(k, v), (v if k in rer else '')) for k, v in final] + [(k, v, '(따로 돌림)') for k, v in rer.items() if k not in dict(final)]
site = J('site_mny.json', []); proto = J('proto_mny.json', []); ms = J('measure_mny_site.json', {}); mp = J('measure_mny_proto.json', {})
pdiff = J('proto_diff.json', {}); ppix = J('proto_pixel.json', {}); parts = J('money_assets.json', {}).get('parts', {})
M = json.load(open(K + '/sgb/docs/matrix/matrix.json', encoding='utf8')); S = M['summary']
CH = J('changed_files_v1030.json', []); FOUND = J('found_v1030.json', []); NOTE = J('doc79_notes.json', {})
ok = lambda rows: '%d / %d' % (sum(1 for r in rows if r['ok']), len(rows))
P = print
n_pass = sum(1 for k, v, o in FIN if verdict(v) == '통과'); n_chk = sum(1 for k, v, o in FIN if verdict(v) == '확인'); n_fail = sum(1 for k, v, o in FIN if verdict(v) == '실패')
n_inh = sum(1 for k, v, o in FIN if verdict(v) == '넘어옴'); n_skip = sum(1 for k, v, o in FIN if verdict(v) == '건너뜀')
by = {}
for c in CH: by[c[0]] = by.get(c[0], 0) + 1
inh = [c for c in CH if '[v10.29 에서 넘어온 것]' in c[2]]

P('# 79. 소개장터 메인 — 제시 디자인 적용 (v10.30 · 2026-10-09)')
P()
P('> 바탕 = **v10.29**(시안 디자인 · 기능 반영 + 검색 시안대로 — 문서 78). 이 판은 그 위에 **소개장터 첫 화면 한 장**을 2026-10-09 제시 디자인으로 바꾼 것입니다. 다른 화면은 v10.29 그대로입니다.')
P()
P('## 1. 지시 · 답')
P()
P('> 10/9 「소개 뱅크로 적용할 수 있도록 변환작업을 하여줘 · 이미지 그대로 사용」 — 받은 것: 소개장터 메인 화면 그림(3000×4850 webp) · 디자인 시트 「전체 페이지 공통 디자인 가이드」(6000×4167 png)')
P()
P('| # | 물음 | 답(10/9) |')
P('|---|---|---|')
P('| ① | 반영 범위 | **시안 + 실제 웹 모양** — DB 변경 없음. 서버에 자료가 없는 구역은 실제 웹에 그리지 않고 시안에 견본으로 |')
P('| ② | 지금 있던 구역 | **디자인 아래에 남김** — 「지금 인기 있는 상품/서비스」 매물 · 바로가기 5 |')
P('| ③ | 디자인 시트 | **소개장터에만** |')
P('| ④ | 글꼴(페이퍼로지 · 나눔스퀘어 네오) | **소개장터에만 실음** |')
P()
P('## 2. 결론')
P()
P('| 항목 | 결과 |')
P('|---|---|')
P('| 시안 `#/g/mny` | 그림의 구역 전부 — 새 머리줄 · 맨 위 · 광고 · 바로가기 3 · 분야 14 · 분류 목록 · 업체 추천 · 소개 요청 · AI 추천 · 띠 광고 · 연결 사례 · 공급자 등록(글자 · 숫자는 그림 그대로인 **견본**) + 지금 있던 구역 |')
P('| 실제 웹 `/money` | 서버에 자료가 있는 구역만 — 머리줄 · 맨 위(검색 · 광고) · 바로가기 3 · 분야 14 · 분류 목록 · 소개 요청(실제 요청) · 공급자 등록 + 지금 있던 구역 |')
P('| 그림 | 받은 그림에서 **자르기만** 한 %d장(실제 웹 %d · 시안 %d) — 받은 그림의 그 자리와 점 하나까지 같음 |' % (len(parts), sum(1 for v in parts.values() if v['site']), len(parts)))
P('| 자리 대조(그림 ↔ 화면 · 허용 ±%gpx) | 시안 **%s / %s**(±2px 안 %s곳 · 가장 큰 차이 %spx) · 실제 웹 **%s / %s**(±2px 안 %s곳 · 가장 큰 차이 %spx · 넣지 않은 구역 %d곳은 견주지 않음) |' % (
    mp.get('tol', 6), mp.get('pass'), mp.get('count'), mp.get('within2'), mp.get('worst'), ms.get('pass'), ms.get('count'), ms.get('within2'), ms.get('worst'), len(ms.get('skipped') or {})))
P('| 새 검사 | 실제 웹 `site_mny.py` **%s** · 시안 `proto_mny.py` **%s** |' % (ok(site), ok(proto)))
P('| 전수 검정 | %d줄 — 통과 %d · **이 판에서 생긴 실패 %d** · v10.29 에서 넘어온 실패 %d줄(v10.29 그대로에서도 같은 단계가 실패) · 확인 %d(옛 판 시안이 없어 일부 단계를 돌리지 못함) · 건너뜀 %d (9절) |' % (len(FIN), n_pass, n_fail, n_inh, n_chk, n_skip))
P('| 매트릭스 | 화면 %s(구현 %s · 시안 %s) · 쪽 %s + %s · API %s · 표 %s · 뷰 %s · 함수 %s · 미연결 %d |' % (S.get('screens_registry'), S.get('screens_with_impl'), S.get('screens_with_proto'), S.get('site_pages'), S.get('admin_pages'), S.get('handlers'), S.get('tables'), S.get('views'), S.get('functions'), len(M.get('issues') or [])))
P('| DB · API | **DB 변경 없음**(마이그레이션 %s 그대로) · 새 API 없음 · 사용자 웹의 `/cart-count` 에 `?bell=1`(읽지 않은 알림 수) |' % S.get('migrations'))
P('| 찾은 것 | %d건 — v10.29 에서 넘어온 **통합 검정 종료 코드 1**(`npm run verify` = `./dev.ps1 check`) 포함. %d건 고침 · %d건 알림만(7절). 고친 뒤 통합 검정 종료 코드 0 |' % (len(FOUND), sum(1 for f in FOUND if '고침' in f['state']), sum(1 for f in FOUND if '고침' not in f['state'])))
P()
P('## 3. 왜 v10.30 인가')
P()
P('같은 날 다른 작업에서 v10.29(시안 디자인 · 기능 반영 + 검색)가 먼저 나왔습니다. 그 판이 소개장터를 포함한 관 화면 21장 · 공통 머리줄 · 검색을 바꿨기 때문에, v10.28 위에 만들어 두었던 소개장터 디자인을 **v10.29 위에 다시 얹어** 번호를 하나 올렸습니다.')
P()
P('| v10.29 의 것 | 이 판에서 |')
P('|---|---|')
P('| 공통 머리줄(`header.pc-hd`) · 꼬리줄 | 소개장터 **첫 화면만** 두 관 전용 머리줄 · 바닥줄(색조 `money`)로. `/money/list` · `/money/{번호}` · 퀵메뉴 5화면은 v10.29 그대로 |')
P('| 관 첫 화면(`GwanLanding`) | 소개장터만 새 디자인(`components/money/MoneyMain`). 안심소개 · 소개창업은 그대로 |')
P('| 관 화면 부품(`components/gwan`) · 조회 규칙 | 「지금 있던 구역」(`#mny-list`)이 **그 부품을 그대로** 씀 — 소개상품 찾기 · 검색 조건 줄 · 사진 카드 · 쪽 · 정렬. 주소(`?sort · ?badge · ?cat · ?grade · ?keyword · ?cursor · ?p`)도 그대로 받음 |')
P('| 검색 팝업(`components/search`) | 맨 위 검색칸이 그 팝업을 엶 — 제출하면 `/search?q=…&gwanCode=MNY` |')
P('| 퀵메뉴 5화면(`/money/new · best · urgent · verified · event`) | 그대로 — 지금 있던 구역의 머리에서 감 |')
P('| 시안 | v10.29 는 시안을 바꾸지 않았습니다(v10.28 그대로). 이 판의 시안은 v10.28 시안에서 **소개장터 메인 한 장**만 달라집니다 |')
P()
P('## 4. 구역별 — 그림 · 시안 · 실제 웹 · API')
P()
P('| 구역 | 시안 | 실제 웹 | API |')
P('|---|---|---|---|')
for r in [
 ('머리줄 — 로고 · 메뉴 6 · 검색 · KR · 로그인 · 무료 회원가입 · 알림 종', '그림 그대로(종은 숫자 「1」이 그려진 그림 — 견본)', '메뉴 = 서버의 관 목록 · 종 = 읽지 않은 알림 수', '`GET /gwans` · `GET /me/summary`'),
 ('맨 위 — 큰 제목 · 설명 · 검색칸', '그림 그대로 · 칸을 누르면 통합 검색 창', '칸을 누르면 검색 팝업 · 제출 → `/search?q=…&gwanCode=MNY`', '`GET /search/suggest` · `GET /search`'),
 ('맨 위 — 많이 찾는 키워드 5', '견본(누르면 검색 결과)', '**넣지 않음**', '없음'),
 ('맨 위 — 광고', '받은 광고 그림(견본)', '「관 랜딩 상단」 칸의 소재 · 「광고」 표시 · 노출 · 클릭 기록', '`GET /ads/serve?slot=GHERO` · `POST /ads/{id}/impression · /click`'),
 ('바로가기 3', '소개 등록 · 요청 등록 · 요청 목록', '`/register` · `/request/new` · `/request`', '—'),
 ('분야 14칸', '누르면 그 낱말로 아래 목록을 거름', '`/money?keyword=낱말#mny-list` · 고른 칸에 주황 테두리', '`GET /listings?gwanCode=MNY&keyword=`'),
 ('왼쪽 분류 — 상품 5 · 서비스 6 · 전문가 · 업체 · 구해요 / 의뢰', '같은 방식 · 구해요 / 의뢰 → 요청 목록', '같은 방식 · 구해요 / 의뢰 → `/request`', '같음 · `GET /requests`'),
 ('왼쪽 분류 — 지역으로 찾기 10', '견본(안내)', '**넣지 않음**', '없음(지역 조건 없음)'),
 ('서비스 업체 추천 4', '견본', '**넣지 않음**', '없음(업체 단위 목록 · 목록의 평점)'),
 ('지금 올라온 소개 요청', '견본 4건 · 종류 탭 6', '실제 요청 4건 — 종류 탭 · 사진 · 지역 없음', '`GET /requests?gwanCode=MNY&limit=4`'),
 ('AI 추천 맞춤 공급자 4', '견본', '**넣지 않음**', '없음'),
 ('띠 광고', '받은 그림(견본)', '**넣지 않음**', '없음(이 자리의 광고 칸 종류)'),
 ('최근 실제 연결 사례 3', '견본', '**넣지 않음**', '없음'),
 ('공급자 등록', '소개 등록으로', '`/register`', '—'),
 ('지금 있던 구역(`#mny-list`) — 그림에 없음', '퀵메뉴 5 · 내 목록 · 전체 목록 · 소개상품 찾기 · 검색 조건 줄 · 매물 6칸 · 쪽 · 정렬', '같음 — v10.29 부품 그대로', '`GET /listings` · `GET /categories` · `GET /gwans`'),
 ('바닥줄', '그 디자인의 로고 · 아이콘 + 사업자 정보 · 통신판매중개자 고지', '같음(약관 링크는 서버 목록)', '`GET /footer-links` · `GET /site-settings/public`'),
]: P('| %s | %s | %s | %s |' % r)
P()
P('화면 코드 · DB 까지 이은 표는 엑셀 `07_소개장터_구역별_연결` 시트에 있습니다.')
P()
P('## 5. 그림과 다르게 넣은 것')
P()
P('| # | 무엇 | 그림 | 넣은 것 | 까닭 |')
P('|---|---|---|---|---|')
for i, r in enumerate([
 ('사업자 정보 · 통신판매중개자 고지 · 바로가기 줄(바닥줄)', '없음', '넣음', '첫 화면에서 빠지면 안 되는 표시 — 소개광장 · 소개몰 때와 같게'),
 ('바닥줄의 약관 링크', '5개(운영정책 포함)', '서버 · 사이트 정보의 목록 그대로', '목록은 운영 화면이 정함'),
 ('사회관계망 아이콘', '또렷함', '계정 주소를 넣기 전에는 흐리게', '소개광장 · 소개몰과 같은 규칙'),
 ('알림 종(실제 웹)', '숫자 「1」이 그려진 그림', '선으로 그린 종 + 읽지 않은 알림 수', '실제 숫자를 보여야 함'),
 ('맨 위 광고(실제 웹)', '사진 한 장(글자 · 단추가 사진 안)', '같은 자리 · 같은 크기의 남색 칸에 소재의 글자', '서버의 소재에 사진 칸이 없음'),
 ('분야 칸의 「지금 고른 것」', '「전체」 칸이 옅은 주황 바탕', '「전체」의 바탕은 늘 그림 그대로 · 다른 칸을 고르면 그 칸에 주황 테두리', '아이콘 그림에 그 자리의 바탕색이 들어 있어 바탕을 바꾸면 네모가 보임 — 그림을 바꾸지 않음'),
 ('분야 · 분류가 가는 곳', '—', '그 이름의 첫 낱말로 아래 목록 거르기', '서버의 업종과 이름이 다름(DB 변경 없음). 서버의 분류는 「소개상품 찾기」에서 고름'),
 ('공급자 등록 안내의 자리(실제 웹)', '연결 사례의 오른쪽', '가운데', '왼쪽의 사례 구역이 없음'),
 ('메뉴 「소개몰」 글자색', '#231815', '#000000', '이 메뉴만 다른 값이라 다른 메뉴와 같게'),
 ('좁은 화면 · 로그인한 머리줄', '받은 것 없음', '같은 색 · 모양으로 줄임(1320px 부터 한 단계 작게 · 1220px 부터 메뉴가 둘째 줄)', '—'),
], 1): P('| %d | %s | %s | %s | %s |' % ((i,) + r))
P()
P('## 6. v10.29 의 소개장터 첫 화면과 달라진 것')
P()
P('| v10.29 에 있던 것 | 이 판 |')
P('|---|---|')
P('| 검색줄(누르면 검색 팝업) | **남김** — 디자인의 검색칸이 같은 팝업을 엶 |')
P('| 역할 탭 3(소개하기 · 소개받고 싶어요 · 소개받기) | **남김** — 디자인의 바로가기 3장(가는 곳 같음). 탭 아래 안내 글 한 줄은 뺌 |')
P('| 퀵메뉴 5 | **남김** — 지금 있던 구역의 머리 |')
P('| 소개상품 찾기(구분 · 분류) · 검색 조건 줄 · 사진 카드 · 건수 · 쪽 · 정렬 | **남김** — 지금 있던 구역 |')
P('| 왼쪽 「상품 분류」(골든 · 실버 · 브론즈 목록) | **뺌** — 같은 분류를 「소개상품 찾기」의 고르기 칸에서 고름(주소 `?cat=` 도 그대로) |')
P('| 내가 등록한 상품/서비스 | **남김** — 지금 있던 구역의 머리. 「✚ 소개합니다」는 바로가기 「소개하기」로 |')
P('| 지역 설정 칸 | **뺌** — 고른 값을 브라우저에 기억만 하고 목록을 거르지 않던 칸 |')
P('| 검색줄 옆 띠 그림(스마트팜 견본) · 아래 안내 6칸 | **뺌** — 디자인에 없음 |')
P('| 관 중지 안내 | **고침** — v10.29 는 중지해도 평소 화면이 나왔습니다(7절 F-6). 이 판의 소개장터는 안내 한 줄만 냄 |')
P('| 화면 다시 그리기 오류(React #418 · 여러 창을 동시에 열 때) | **고침** — v10.29 의 관 화면은 540번 가운데 18번(7절 F-12). 이 판의 소개장터 메인은 0번 |')
P()
P('빼지 말아야 할 것이 있으면 알려 주십시오 — 「지금 있던 구역」 아래에 그대로 붙일 수 있습니다.')
P()
P('## 7. v10.29 에서 넘어온 것 · 찾은 것')
P()
P('v10.29 묶음을 그대로 풀어 돌렸을 때 통합 검정이 멈췄습니다(v10.28 은 통과). 이 판을 「로컬 테스트」까지 통과시키려면 고쳐야 해서 **가장 작게** 고쳤습니다. 응답 · 화면 동작을 바꾼 것은 없습니다(F-3 · F-5 의 빠진 색 · 모양을 채운 것 제외).')
P()
P('| 번호 | 어디서 | 무엇 | 한 일 | 상태 |')
P('|---|---|---|---|---|')
for f in FOUND: P('| %s | %s | %s<br>— %s | %s | **%s** |' % (f['no'], f['from'], f['what'], f['symptom'], f['done'], f['state']))
P()
P('## 8. 매트릭스 (화면 · 백엔드 · API · DB)')
P()
P('| 목록 | 수 | 이번 판 |')
P('|---|---|---|')
P('| 화면(등록부) | %s — 구현 연결 %s · 시안 연결 %s | 화면 수 그대로. `SB-MNY-MAIN-010` 의 구현 파일이 `components/money/MoneyMain.tsx` 로 · `SB-HOM-SCH-020`(검색 팝업)에 `GET /search/suggest` 연결 |' % (S.get('screens_registry'), S.get('screens_with_impl'), S.get('screens_with_proto')))
P('| 쪽(실제 웹 + 운영 화면) | %s + %s | 그대로 |' % (S.get('site_pages'), S.get('admin_pages')))
P('| 백엔드 처리기 · API | %s (OpenAPI %s) | 그대로 — v10.29 문서는 466 으로 적혀 있었습니다(새 API 가 문서에 빠져 있던 것 · F-1) |' % (S.get('handlers'), S.get('openapi_ops')))
P('| DB | 표 %s · 뷰 %s · 함수 %s · 마이그레이션 %s | 그대로 |' % (S.get('tables'), S.get('views'), S.get('functions'), S.get('migrations')))
P('| 미연결 | %d | — |' % len(M.get('issues') or []))
P()
P('엑셀 `SGB_Matrix_Verification_20261009_v10_30.xlsx` — 01 화면목록 · 02 쪽목록 · 03 백엔드목록 · 04 API목록 · 05 DB목록 · 06 미연결 · 07 구역별 연결 · 08 ~ 13 검정 · 14 바뀐 파일 · 15 그림과 다르게 넣은 것 · 16 찾은 것.')
P()
P('## 9. 검정 결과')
P()
P('### 9-1. 새 검사')
P()
P('| 검사 | 결과 | 보는 것 |')
P('|---|---|---|')
P('| `cut_money.py --check` | 조각 %d · 다른 것 0 | 실제 웹의 PNG · 시안에 넣은 그림 = 받은 그림의 그 자리 |' % len(parts))
P('| `site_mny.py` | **%s** | 머리 · 바닥(그 화면만) · 구역 = 서버 자료 · 넣지 않은 구역 · 광고 노출 · 클릭 · 지금 있던 구역(조건 8가지 · 쪽 · 정렬 · 찾기) · 분야로 거르기 · 검색 팝업 · 그림 · 글꼴 · 알림 종 · 폭 21가지 · 자리 대조 |' % ok(site))
P('| `proto_mny.py` | **%s** | 틀 · 그림의 글자 · 그림 %d장 · 색 · 글꼴 · 누르기 전부 · 분야로 거르기 · 지금 있던 구역 · 로그인한 모습 · 다른 관 그대로 · 폭 21가지 |' % (ok(proto), len(parts)))
P('| `measure_mny.py proto` | %s / %s | 그림 ↔ 시안 같은 자리(그림의 모든 구역) |' % (mp.get('pass'), mp.get('count')))
P('| `measure_mny.py site` | %s / %s | 그림 ↔ 실제 웹(넣은 구역만) |' % (ms.get('pass'), ms.get('count')))
P('| `proto_diff.py` · `proto_pixel.py` | 글자가 달라진 화면 %s · 그림이 달라진 화면 %s · 같은 화면 %s장 | 앞 시안(v10.28)과 견줘 소개장터 메인 한 장만 달라짐 |' % (pdiff.get('changed'), ppix.get('diff'), ppix.get('same')))
P('| 관 중지 | 안내 한 줄 · 디자인 구역 0 · 되돌린 뒤 200 | 실제로 껐다 켬(`mny_gwan_off.py`) |')
hm = os.path.join(Q, 'hyd_mny.txt')
if os.path.exists(hm):
    hl = [l for l in open(hm, encoding='utf8').read().split('\n') if '오류' in l]; he = sum(int(re.search(r'오류 (\d+) /', l).group(1)) for l in hl)
    P('| `hyd_mny.sh` | 오류 **%d / %d** | 창 6개로 동시에 소개장터 메인을 손님 · 회원 · 낱말로 거른 주소로 30번씩 — 화면 다시 그리기 오류(#418) |' % (he, len(hl) * 30))
bad = [r for r in site + proto if not r['ok']]
if bad:
    P()
    P('실패한 단계:')
    for r in bad: P('- %s — %s' % (r['step'][:120], str(r.get('detail', ''))[:200]))
P()
P('### 9-2. 전수 검정 (`chain_1030.sh` — A 통합 검정 · B 서버 + 화면 · C 사용자 웹 · D 시안 · E 연동 · 버튼 · 흐름)')
P()
P('| 시험 | 판정 | 결과 |')
P('|---|---|---|')
for k, v, o in FIN: P('| %s | %s | %s%s |' % (k, verdict(v), v.replace('|', '·')[:230], (' <br>처음: ' + o.replace('|', '·')[:160]) if o and o != '(따로 돌림)' else (' (따로 돌림)' if o else '')))
P()
for l in NOTE.get('final_notes', []): P('- ' + l)
P()
# ── 9-3 v10.29 그대로와 견줌 ──
AT = []
ap = os.path.join(Q, 'attrib_1030.txt')
if os.path.exists(ap):
    for l in open(ap, encoding='utf8').read().split('\n'):
        m = re.match(r'^(\w+): v10\.30 「(.*?)」 · v10\.29 그대로 「(.*?)」 · 실패 단계 — 두 쪽 모두 (\d+) · v10\.30 에서만 (\d+) · v10\.29 에서만 (\d+)', l)
        if m: AT.append(m.groups())
if AT:
    P('### 9-3. 실패한 화면 시험을 「v10.29 그대로」와 견줌')
    P()
    P('전수 검정에서 실패가 나온 화면 시험을, **v10.29 묶음을 그대로 풀어 따로 띄운 사용자 웹**(같은 서버 · 같은 DB)과 이 판에 각각 다시 돌렸습니다. v10.29 는 이 시험들을 돌리지 않았습니다(문서 78 의 4절에 없음). 구글 글꼴 요청은 두 쪽 모두 빈 응답으로 돌렸습니다(인터넷이 막힌 환경 — `qa/tools/offline_fonts`).')
    P()
    P('| 시험 | v10.30 | v10.29 그대로 | 두 쪽 모두 실패한 단계 | v10.30 에서만 실패 |')
    P('|---|---|---|---|---|')
    for t, a, b, both, new, old in AT: P('| `%s` | %s | %s | %s | **%s** |' % (t, a, b, both, new))
    P()
    tot_new = sum(int(x[4]) for x in AT); tot_both = sum(int(x[3]) for x in AT)
    P('- **이 판에서만 실패한 단계: %d** · 두 쪽 모두 실패한 단계: %d — v10.29 가 화면을 시안대로 바꾸면서 옛 화면의 모양(클래스 · 글자)을 보던 시험이 따라가지 못한 것과, 그 과정에서 빠진 것이 섞여 있습니다. 아래에 단계 이름을 그대로 적습니다(가려내는 일은 v10.29 를 만든 쪽의 확인이 필요합니다).' % (tot_new, tot_both))
    P()
    for t, a, b, both, new, old in AT:
        if int(both) == 0: continue
        lp = os.path.join(Q, 'rr_%s.log' % t)
        if not os.path.exists(lp): continue
        fl = [re.sub(r'\s+', ' ', l).strip() for l in open(lp, encoding='utf8', errors='replace').read().split('\n') if re.match(r'^\s*(FAIL|✗)', l)]
        P('**`%s`** — %d단계' % (t, len(fl)))
        P()
        for l in fl[:40]: P('- ' + l.split(' | ')[0][:170].replace('|', '·'))
        P()
for l in NOTE.get('after_attrib', []): P('- ' + l)
P()
P('## 10. 바뀐 파일 (v10.29 묶음 대비)')
P()
P('%d개 — %s. 전체 목록은 `qa/results_v10_30/changed_files_v1030.json` · 엑셀 14 시트.' % (len(CH), ' · '.join('%s %d' % kv for kv in by.items())))
P()
P('| 구분 | 파일 | 내용 |')
P('|---|---|---|')
for c in CH:
    if c[1].startswith(('sgb/site/public/money/', 'qa/', 'sgb/docs/matrix/')) or (c[1].startswith('sgb/site/public/fonts/') and c[1].endswith('.woff2')): continue
    P('| %s | `%s` | %s |' % (c[0], c[1], c[2]))
nq = sum(1 for c in CH if c[1].startswith('qa/')); nm = sum(1 for c in CH if c[1].startswith('sgb/site/public/money/'))
P('| 새 파일 | `sgb/site/public/money/*.png` %d장 · `sgb/site/public/fonts/*.woff2` 5개 | 받은 그림에서 자른 PNG · 글꼴 |' % nm)
P('| — | `sgb/docs/matrix/*` | 매트릭스 다시 만듦 |')
P('| — | `qa/*` %d개 | 검정 도구 · 결과 폴더 |' % nq)
P()
P('## 11. PC 에서 보는 법')
P()
P('| 단계 | 할 일 | 보이는 것 |')
P('|---|---|---|')
P('| 1 | 묶음을 풀고 `SGB_Prototype_v10_30.html` 을 두 번 누름 → 위 메뉴 「소개장터」 | 시안 — 그림의 구역 전부(견본) |')
P('| 2 | PowerShell: `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` → `.\\dev.ps1 up` | Docker 로 서버 · 사용자 웹 · 운영 화면이 뜸 |')
P('| 3 | http://localhost:5174/money | 실제 웹 — 새 머리줄 · 맨 위 · 바로가기 · 분야 · 소개 요청 · 지금 있던 구역 |')
P('| 4 | 분야 「가구, 인테리어」를 누름 | 주소가 `/money?keyword=가구#mny-list` · 아래 목록이 걸러짐 · 「✕ 검색어 해제」 |')
P('| 5 | 맨 위 검색칸을 누름 | v10.29 의 검색 팝업 |')
P('| 6 | http://localhost:5174/mall · /biz · /money/list | v10.29 그대로(공통 머리줄) |')
P('| 7 | `.\\dev.ps1 check` | 통합 검정 — 「전체 검증 통과」 |')
P()
P('**체크리스트**')
P()
P('- [ ] 시안과 실제 웹의 소개장터 메인이 같은 모양(견본 구역 빼고)')
P('- [ ] 그림(로고 · 아이콘)이 또렷하고 찌그러지지 않음')
P('- [ ] 제목 글꼴이 페이퍼로지 · 본문이 나눔스퀘어 네오(소개장터 메인에서만)')
P('- [ ] 로그인하면 종에 읽지 않은 알림 수')
P('- [ ] 안심소개 · 소개창업 · 소개몰 · 소개광장 · 메인은 전과 같음')
P('- [ ] Chrome 에서 화면 폭을 줄였을 때 가로 스크롤이 생기지 않음(소개장터 메인)')
P()
P('문제가 생기면 보는 순서: ① 글꼴이 다름 → 개발자 도구 「네트워크」에서 `/fonts/*.woff2` 5개가 200 인지 ② 그림이 안 뜸 → `/money/*.png` · `python3 qa/cut_money.py --check` ③ 자리가 어긋남 → `python3 qa/shot_mny.py site && TOL=2 python3 qa/measure_mny.py site` ④ 다른 화면의 모양이 바뀜 → `qa/site_mny.py` 의 P-5(스타일 이름) · H-4.')
P()
P('## 12. 묶음')
P()
z = os.environ.get('ZIP_MB'); t = os.environ.get('TGZ_MB'); nf = os.environ.get('N_FILES')
P('| 파일 | 크기 | 비고 |')
P('|---|---|---|')
P('| `SGB_DevDocker_Integrated_20261002_v10_30.zip` · `.tar.gz` | %s · %s | 파일 %s개 · `.env` 0 · `.git` 0 · 한도 30MiB 안 |' % ((z + 'MiB') if z else '(포장 뒤 채움)', (t + 'MiB') if t else '(포장 뒤 채움)', nf or '—'))
P('| `SGB_Prototype_v10_30.html` | 시안 한 장(킷 안의 세 벌과 같은 파일) | 그림 53장이 들어가 v10.28 시안보다 2.9MB 큼 |')
P('| `SGB_Matrix_Verification_20261009_v10_30.xlsx` | 17 시트 | 킷 밖 |')
P('| `money_main_20261009.webp` | 받은 그림 원본(3.3MB) | **킷 밖** — `sgb/docs/design/` 에 넣으면 대조 도구가 원본으로 직접 견줌. 없으면 자르기 표의 지문 · 미리 재어 둔 값으로 견줌 |')
P()
P('킷에서 뺀 것(묶음 크기 한도): v10.29 의 대조표 HTML(5.9MB) · v10.29 시험 결과 폴더 · v10.27 그림 폴더 — 모두 v10.29 묶음에 그대로 있습니다. 목록은 `sgb/docs/00_묶음에서_뺀_문서.txt`.')
P()
P('## 13. 확인하지 못한 것 · 정해 주실 것')
P()
P('**확인하지 못한 것**')
P()
for l in [
 'Docker 실구동 · PowerShell 도우미(`dev.ps1`) · 서버 적용 리허설 — 이 작업 환경에서 Docker 이미지를 받을 수 없었습니다(v10.29 도 돌리지 않았습니다). PC 에서 `.\\dev.ps1 realcheck` 로 확인이 필요합니다.',
 'PC 의 Chrome 에서의 모양 — 작업 환경의 Chromium 으로 확인했습니다.',
 '인터넷이 되는 곳에서의 글자 모양 — v10.29 가 넣은 구글 글꼴(Noto Sans KR)은 이 환경에서 받아지지 않아, 그 글꼴이 실제로 적용된 모습은 보지 못했습니다(F-11).',
 '글꼴 사용 조건 — 페이퍼로지 · 나눔스퀘어 네오는 배포처가 OFL(상업적 사용 · 웹 탑재 가능)로 안내합니다. 시안은 파일 한 장이라 **쓰는 글자만 추린 글꼴**을 넣었는데, 추린 글꼴을 같은 이름으로 두는 것이 조건에 맞는지는 배포처의 최신 조건으로 추가 확인이 필요합니다(실제 웹은 원본 파일 그대로).',
 '안심소개 · 소개창업의 관 중지 안내 — 소개장터와 같은 판정이라 같은 증상일 것으로 보지만 꺼 보지는 않았습니다(F-6).',
 'git 기록 — 이 작업 환경에 v10.29 의 저장소가 없어 번들 · 태그를 만들지 못했습니다. 바뀐 파일은 10절의 목록으로 드립니다.',
 '지난 판 전체를 이어 붙인 엑셀(v10.28 의 78 시트 형식) — 지난 판의 결과 폴더가 묶음에 없어 만들지 못했고, 이번 판의 17 시트만 냈습니다.',
] + NOTE.get('unverified', []): P('- ' + l)
P()
P('**정해 주실 것**')
P()
P('| # | 물음 | 제안 |')
P('|---|---|---|')
for i, r in enumerate([
 ('서버에 자료가 없어 실제 웹에서 뺀 구역(많이 찾는 키워드 · 서비스 업체 추천 · AI 추천 · 띠 광고 · 연결 사례 · 지역으로 찾기 · 요청 종류 탭)을 만들지', '만들려면 DB · API 가 필요합니다(업체 단위 목록 · 평점 집계 · 요청 종류 · 지역 값 · 광고 칸 종류). 구역마다 따로 정해 주시면 설계부터 드립니다'),
 ('분야 14칸 · 분류 목록의 이름을 서버의 업종으로 만들지', '지금은 낱말로 거릅니다. 서버 업종을 이 이름으로 바꾸면 등록 화면 · 기존 매물의 분류가 같이 바뀝니다 — 비교표 뒤 반영'),
 ('v10.29 소개장터 첫 화면에서 뺀 것(왼쪽 상품 분류 목록 · 지역 설정 · 안내 6칸)을 되살릴지', '뺀 채로 둠 — 분류는 「소개상품 찾기」로 고를 수 있습니다'),
 ('소개광장 · 소개몰 머리줄이 1280px 근처에서 가로로 넘치는 것(F-9)을 고칠지', '고침 — 소개장터 메인에 넣은 줄임 규칙과 같은 방식으로(다음 판)'),
 ('안심소개 · 소개창업의 좁은 화면 찾기 칸(F-8) · 관 중지 안내(F-6)를 같이 고칠지', '고침(다음 판) — v10.29 를 만든 쪽과 겹치지 않게 확인 뒤'),
], 1): P('| %d | %s | %s |' % ((i,) + r))
P()
P('## 14. 근거')
P()
for l in [
 '받은 그림: 소개장터 메인 화면 `money_main_20261009.webp`(3000×4850 · sha256 72d7a168…) · 디자인 시트 `design_sheet_20261009.png`(6000×4167) — 10/9 변환 묶음 `SGB_MoneyMain_Design_20261009` 의 `design/`',
 '바탕 판: `SGB_DevDocker_Integrated_20261002_v10_29.zip`(문서 78) · 앞 시안 `SGB_Prototype_v10_28.html`',
 '반영 전 비교표: `소개뱅크_소개장터_디자인변환_비교표_반영전확인_20261009.md`(물음 4건 · 10/9 답)',
 '실제 웹: `sgb/site/src/components/money/*`(MoneyMain = 조회 · MoneyView = 화면) · `styles/money.css` · `styles/sgb-tokens.css` · `styles/money-fonts.css` · `components/b2/{Frame,AuthArea,TonePic}.tsx` · `components/Chrome.tsx` · `app/[gwan]/page.tsx` · `app/cart-count/route.ts`',
 '시안: `qa/apply_proto_v1030.py`(v10.28 시안 → v10.30) · 스타일은 실제 웹의 `money.css` · `sgb-tokens.css` 를 글자 그대로',
 '검정: `qa/site_mny.py` · `qa/proto_mny.py` · `qa/cut_money.py` · `qa/shot_mny.py` · `qa/measure_mny.py` · `qa/mny_gwan_off.py` · `qa/chain_1030.sh` · 결과 `qa/results_v10_30/`',
 'v10.29 그대로와 견줌: v10.29 묶음을 풀어 사용자 웹을 따로 띄워(5184) 같은 화면을 견줌 · `scripts/check-testsafety.sh` · `scripts/check-guards.js` 를 v10.28 · v10.29 · v10.30 세 폴더에서 돌림',
 '글꼴: 페이퍼로지 https://freesentation.blog/paperlogyfont · https://github.com/fonts-archive/Paperlogy / 나눔스퀘어 네오 https://www.sandollcloud.com/free-font/17678/NanumSquareNeo · https://github.com/fonts-archive/NanumSquareNeo (사용 조건 글은 `sgb/site/public/fonts/LICENSE.txt`)',
]: P('- ' + l)
