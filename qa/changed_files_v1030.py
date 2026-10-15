"""v10.29 묶음(시안 디자인 · 기능 반영 + 검색)과 지금 킷(v10.30)의 차이 — 바뀐 파일 목록(changed_files_v1030.json). 엑셀 · 문서 79 가 씁니다.
   BASE=/path/SGB_DevDocker_Integrated_20261002_v10_29 (풀어 놓은 폴더)"""
import filecmp, json, os, sys
K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
B = os.environ.get('BASE', '/home/claude/w/v30/other/SGB_DevDocker_Integrated_20261002_v10_29')
SKIP = {'node_modules', '.next', 'dist', '__pycache__', 'uploads', '.git'}
WHY = {
 'README.md': '판 이름 v10.30 · 이번 판 한 줄 · 폴더 · 시안 파일 이름',
 'SGB_Prototype_v10_30.html': '시안 v10.30(spec/proto.html 과 같은 파일)',
 'SGB_Prototype_v10_28.html': '시안 파일 이름이 v10_30 으로(v10.29 는 시안을 바꾸지 않아 v10_28 이름이었습니다)',
 'sgb/VERSION': 'v10.30',
 'sgb/spec/proto.html': '시안 — 소개장터 메인(#/g/mny)을 제시 디자인대로 · 머리줄 · 바닥줄 함수에 소개장터 갈래 · 그림 53장 · 글꼴 · 스타일',
 'sgb/spec/screens.json': '[v10.29 에서 넘어온 것] 검색 팝업 화면(SB-HOM-SCH-020)에 새 API GET /search/suggest 연결 — 연결이 없어 통합 검정이 멈췄습니다',
 'sgb/site/public/proto/SGB_Prototype_v10_30.html': '시안(실제 웹에서 여는 것 · 같은 파일)',
 'sgb/site/public/proto/SGB_Prototype_v10_28.html': '시안 파일 이름이 v10_30 으로',
 'sgb/docs/79_소개장터메인_제시디자인적용_v10.30_20261009.md': '이번 판 문서',
 'sgb/docs/78_시안디자인반영_검색_v10.29_20261009.md': '맨 위에 「v10.30 킷」 한 줄(내용은 그대로)',
 'sgb/docs/78_시안반영_대조표_v10.29_20261009.html': '묶음에서 뺌(5.9MB · 묶음 크기 한도) — v10.29 묶음에 그대로 있습니다',
 'sgb/docs/00_묶음에서_뺀_문서.txt': '이번 판에서 뺀 것을 더함',
 'sgb/site/src/app/[gwan]/page.tsx': '소개장터(MNY)는 새 메인(MoneyMain)을 씀 — 안심소개 · 소개창업은 v10.29 그대로',
 'sgb/site/src/app/layout.tsx': '스타일 3개(sgb-tokens · money-fonts · money) 불러오기',
 'sgb/site/src/app/cart-count/route.ts': '?bell=1 이면 읽지 않은 알림 수(GET /me/summary) — 기본 모양은 그대로',
 'sgb/site/src/components/Chrome.tsx': '/money 한 화면만 두 관 전용 틀(색조 money · main-mny)',
 'sgb/site/src/components/b2/Frame.tsx': '소개장터에서는 그 디자인의 로고 · 사회관계망 아이콘 · 알림 종',
 'sgb/site/src/components/b2/AuthArea.tsx': '소개장터에서는 장바구니 자리에 알림 종(읽지 않은 알림 수)',
 'sgb/site/src/components/b2/TonePic.tsx': '(새) 주소를 보고 그림 고르기',
 'sgb/site/src/components/money/MoneyMain.tsx': '(새) 소개장터 메인 — 조회(서버): 요청 · 광고 · 분류 · 매물 · 관 중지 판정',
 'sgb/site/src/components/money/MoneyView.tsx': '(새) 소개장터 메인 — 화면(클라이언트 컴포넌트): 디자인 구역 + 지금 있던 구역(v10.29 관 화면 부품)',
 'sgb/site/src/components/money/MoneySearch.tsx': '(새) 맨 위 검색칸 — v10.29 검색 팝업을 엶',
 'sgb/site/src/components/money/MoneySide.tsx': '(새) 왼쪽 분류 목록(접기 · 펴기 · 지금 고른 줄 표시)',
 'sgb/site/src/components/money/MoneyAd.tsx': '(새) 맨 위 광고 칸(GHERO · 노출 · 클릭 기록)',
 'sgb/site/src/components/money/menu.ts': '(새) 분야 14칸 · 분류 목록의 이름과 거르는 낱말',
 'sgb/site/src/components/money/pics.tsx': '(새) 그림 29장의 화면 크기 표',
 'sgb/site/src/styles/sgb-tokens.css': '(새) 디자인 시트 토큰(--sgb-*)',
 'sgb/site/src/styles/money.css': '(새) 소개장터 메인의 모양(시안과 같은 파일)',
 'sgb/site/src/styles/money-fonts.css': '(새) 글꼴 선언 5개',
 'sgb/site/src/styles/proto-gwan.css': '[v10.29 에서 넘어온 것] 끝에 덧붙임 — 빠진 토큰 2개(--gridln · --axis) · 빠진 모양 3가지(검색 조건 줄 · 빈 목록 안내 · 관 중지 안내). 값은 시안 그대로',
 'sgb/site/public/fonts/LICENSE.txt': '(새) 글꼴 사용 조건',
 'sgb/src/modules/search/search.service.ts': '[v10.29 에서 넘어온 것] 검색 추천 칩의 관 목록을 SQL 에 박지 않고 상수로(고르는 관은 그대로 — 소개장터 · 안심소개 · 소개창업)',
 'sgb/src/modules/search/search.controller.ts': '[v10.29 에서 넘어온 것] GET /search/suggest 에 응답 정의(문서용) — 응답은 그대로',
 'sgb/src/modules/search/search.dto.ts': '[v10.29 에서 넘어온 것] 응답 모양 SearchSuggestDto(문서용)',
 'sgb/docs/01_화면정의서.md': '다시 만듦 — 검색 팝업 화면에 GET /search/suggest',
 'sgb/docs/06_openapi.json': '다시 만듦 — GET /search/suggest 가 들어감(413 → 414경로 · v10.29 문서에 빠져 있던 것)',
 'sgb/docs/_swagger_from_code.json': '다시 만듦 — 같음',
 'sgb/docs/07_API스키마리스트.md': '다시 만듦 — 466 → 467 오퍼레이션',
 'sgb/docs/08_필수API_개발절차.md': '다시 만듦 — 467 · 오픈 필수 99',
 'sgb/docs/소개뱅크_로컬확인.html': '다시 만듦 — 화면 구현 148 / 212 · API 467 · 약관 수는 새로 만든 검정 DB 기준',
 'sgb/docs/design/money_main_20261009.webp': '받은 그림 원본(작업본에만 — 묶음에서는 뺌 · 따로 드림)',
 'qa/g137/': '지난 판(v10.27)의 그림 폴더 — 묶음에서 뺌(묶음 크기 한도 · v10.29 묶음에 그대로 있습니다)',
}
out = []
def walk(rel=''):
    a = set(os.listdir(os.path.join(B, rel))) if os.path.isdir(os.path.join(B, rel)) else set()
    b = set(os.listdir(os.path.join(K, rel))) if os.path.isdir(os.path.join(K, rel)) else set()
    for n in sorted(a | b):
        if n in SKIP or n in ('.env', 'tsconfig.tsbuildinfo', 'next-env.d.ts') or n.endswith('.bak'): continue
        r = os.path.join(rel, n) if rel else n; pa, pb = os.path.join(B, r), os.path.join(K, r)
        if os.path.isdir(pa) or os.path.isdir(pb):
            if r.startswith('qa/results_v10_'):
                if not os.path.exists(pa): out.append(['새 폴더', r + '/', '이번 판의 검정 결과'])
                elif not os.path.exists(pb): out.append(['뺌', r + '/', '지난 판(v10.29)의 검정 결과 — 묶음에서 뺌(10/9 「필수 문서만」 · v10.29 묶음에 그대로 있습니다)'])
                continue
            if not os.path.exists(pb) and os.path.isdir(pa): out.append(['뺌', r + '/', WHY.get(r + '/', '')]); continue
            walk(r); continue
        if not os.path.exists(pa): out.append(['새 파일', r, WHY.get(r, '')])
        elif not os.path.exists(pb): out.append(['없어짐', r, WHY.get(r, '')])
        elif not filecmp.cmp(pa, pb, shallow=False): out.append(['바뀜', r, WHY.get(r, '')])
walk()
def desc(c):
    k, r, w = c
    if w: return c
    if r.startswith('sgb/site/public/money/'): w = '(새) 받은 그림에서 자른 PNG — 실제 웹이 쓰는 29장'
    elif r.startswith('sgb/site/public/fonts/'): w = '(새) 글꼴 woff2'
    elif r.startswith('qa/g137/'): w = '지난 판(v10.27)의 그림 — 묶음에서 뺌(묶음 크기 한도)'
    elif r.startswith('qa/'): w = '검정 도구' + (' (새)' if k == '새 파일' else ' — v10.30 에 맞춤')
    elif r.startswith('sgb/docs/matrix/') or r.endswith('39_통합매트릭스.md'): w = '매트릭스 다시 만듦(npm run matrix) — 소개장터 메인의 파일 · 검색 팝업 API 연결'
    elif r.startswith('sgb/docs/'): w = '판 이름 줄(v10.30 킷) · 폴더 · 시안 파일 이름' if k == '바뀜' else ''
    return [k, r, w]
out = [desc(c) for c in out]
json.dump(out, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'changed_files_v1030.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
by = {}
for c in out: by[c[0]] = by.get(c[0], 0) + 1
print('바뀐 파일', len(out), by)
if '-v' in sys.argv:
    for c in out: print(' ', c[0], c[1], '—', c[2])
