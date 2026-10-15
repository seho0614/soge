"""킷의 판 이름을 v10.30 으로 — 시안 3벌 · VERSION · README · 문서의 폴더/파일 이름 줄. 여러 번 돌려도 같습니다.
   v10.29(시안 디자인 · 기능 반영 + 검색) 킷 위에서 돌립니다 — 그 판은 시안이 v10.28 그대로라 시안 파일 이름이 v10_28 이었습니다."""
import os, re, shutil, glob
K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
DOC78 = '78_시안디자인반영_검색_v10.29_20261009.md'
DOC79 = '79_소개장터메인_제시디자인적용_v10.30_20261009.md'
src = K + '/sgb/spec/proto.html'
assert re.search(r'<title>소개뱅크 시안 v10\.30 ', open(src, encoding='utf8').read(3000)), '시안이 v10.30 이 아닙니다 — apply_proto_v1030.py 를 먼저 돌리십시오'
for d in (K, K + '/sgb/site/public/proto'):
    for f in glob.glob(d + '/SGB_Prototype_v10_*.html'):
        if not f.endswith('v10_30.html'): os.remove(f)
    shutil.copyfile(src, d + '/SGB_Prototype_v10_30.html')
open(K + '/sgb/VERSION', 'w').write('v10.30\n')
def edit(path, fn):
    s = open(path, encoding='utf8').read(); t = fn(s)
    if t != s: open(path, 'w', encoding='utf8').write(t); print('고침', os.path.relpath(path, K))
NAMES = lambda s: s.replace('SGB_Prototype_v10_28', 'SGB_Prototype_v10_30').replace('SGB_DevDocker_Integrated_20261002_v10_29', 'SGB_DevDocker_Integrated_20261002_v10_30').replace('SGB_DevDocker_Integrated_20261002_v10_28', 'SGB_DevDocker_Integrated_20261002_v10_30')
def readme(s):
    s = NAMES(s)
    line = ('10/9 **소개장터 메인을 제시 디자인대로(v10.30)** — 받은 그림(소개장터 메인 화면 · 「전체 페이지 공통 디자인 가이드」)을 코드로 옮겨 시안(`#/g/mny`)과 실제 웹(`/money`)에 넣었습니다. '
            '**v10.29(시안 디자인 · 기능 반영 + 검색) 위에 얹은 판**이라 다른 화면은 v10.29 그대로입니다. '
            '**그림(사진 · 아이콘 · 로고)은 받은 그림에서 자른 그대로**(53장 · 색 · 크기 변경 없음 · `qa/cut_money.py --check`) · '
            '새 머리줄 · 바닥줄은 **소개장터 메인 한 화면만**(두 관 전용 틀 · 색조 `money`) · 글꼴(페이퍼로지 · 나눔스퀘어 네오)과 디자인 시트 토큰(`--sgb-*`)도 소개장터에만 · '
            '지금 있던 퀵메뉴 5 · 「소개상품 찾기」 · 매물 사진 카드 · 쪽 · 정렬은 **디자인 구역 아래(`#mny-list`)** 에 v10.29 부품 그대로 · 맨 위 검색칸은 v10.29 의 검색 팝업 · '
            '실제 웹은 **서버에 자료가 있는 구역만**(키워드 · 업체 추천 · AI 추천 · 띠 광고 · 연결 사례는 시안에 견본으로만) · '
            '분야 14칸 · 분류 목록은 그 낱말로 아래 목록 거르기(`/money?keyword=…#mny-list`) · 맨 위 광고는 「관 랜딩 상단」 칸(GHERO) · 알림 종 = 읽지 않은 알림 수 · **DB · API 변경 없음(마이그레이션 88 그대로)** · '
            '**v10.29 에서 넘어온 통합 검정 걸림을 고침** — `./dev.ps1 check`(`npm run verify`)가 종료 코드 1 이던 것(새 API `GET /search/suggest` 의 화면 연결 · 응답 정의 · CSS 토큰 2개 · 관 코드) · 관 화면의 「검색 조건」 줄 · 빈 목록 안내 모양 '
            '→ `sgb/docs/' + DOC79 + '` (v10.30). ')
    if 'sgb/docs/' + DOC79 not in s:
        i = s.index('10/9 **시안 디자인 · 기능 반영 + 검색 시안대로(v10.29)**'); s = s[:i] + line + '\n\n' + s[i:]
    return s
edit(K + '/README.md', readme)
NOTE = lambda s: NAMES(s).replace('**10/9 (v10.28 킷)**', '**10/9 (v10.30 킷)**').replace('`…_v10_28`', '`…_v10_30`').replace('이름만 `v10_28`', '이름만 `v10_30`').replace('v10_28', 'v10_30')
for f in ('60_로컬점검_AWS적용절차_v10.16_20261003.md', '62_결제환불정합_v10.18_20261006.md'):
    p = K + '/sgb/docs/' + f
    if os.path.exists(p): edit(p, NOTE)
N78 = '> **10/9 (v10.30 킷)** — 이 문서의 내용은 v10.29 때 그대로입니다. 이 킷의 폴더 · 시안 파일 이름은 `…_v10_30` 이고, **소개장터 첫 화면(/money)만** 이 문서와 다릅니다 — 2026-10-09 제시 디자인으로 바꿨습니다(`' + DOC79 + '`). 소개장터의 아래 화면 · 안심소개 · 소개창업 · 그 밖의 화면은 이 문서 그대로입니다.\n'
p78 = K + '/sgb/docs/' + DOC78
def fn78(s):
    if '(v10.30 킷)' in s: return s
    i = s.index('\n') + 1; return s[:i] + '\n' + N78 + s[i:]
if os.path.exists(p78): edit(p78, fn78)
print('VERSION', open(K + '/sgb/VERSION').read().strip(), '|', sorted(os.path.basename(f) for f in glob.glob(K + '/SGB_Prototype_*.html') + glob.glob(K + '/sgb/site/public/proto/*.html')))
