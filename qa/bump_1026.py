"""킷의 판 이름을 v10.26 으로 — 시안 3벌 · VERSION · README · 문서의 폴더/파일 이름 줄. 여러 번 돌려도 같습니다."""
import os, re, shutil, glob
K = '/home/claude/pkg/SGB_DevDocker_Integrated_20261002'
DOC75 = '75_소개몰_상품자료_옵션_교환배송비_v10.26_20261008.md'
# 1. 시안 3벌
src = K + '/sgb/spec/proto.html'
assert re.search(r'<title>소개뱅크 시안 v10\.26 ', open(src, encoding='utf8').read(3000))
for d in (K, K + '/sgb/site/public/proto'):
    for f in glob.glob(d + '/SGB_Prototype_v10_*.html'):
        if not f.endswith('v10_26.html'): os.remove(f)
    shutil.copyfile(src, d + '/SGB_Prototype_v10_26.html')
# 2. VERSION
open(K + '/sgb/VERSION', 'w').write('v10.26\n')
def edit(path, fn):
    s = open(path, encoding='utf8').read(); t = fn(s)
    if t != s: open(path, 'w', encoding='utf8').write(t); print('고침', os.path.relpath(path, K))
# 3. README
def readme(s):
    s = s.replace('v10_25', 'v10_26').replace('같은 파일, 196화면', '같은 파일, 200화면').replace('같은 파일, 197화면', '같은 파일, 200화면')
    line = ('10/8 **소개몰 상품 자료 · 옵션 · 교환 배송비(v10.26)** — 상품 옵션(복용 개월 수 · 단품) · 옵션별 재고 · 「한 달 N원 부터」(살 수 있는 옵션만) · 성분군 · 화장품 갈래 · '
            '견본 17종(개발 · 시연용 시드 — 서버 적용 스크립트는 돌리지 않음) · 운영 화면 「소개몰 상품」(상품 · 옵션 · 재고 · 그림 · 고시 · 변경 기록) · 검색 자동완성 · '
            '장바구니 가격 변경 확인 · **교환 배송비 왕복 6,000원을 신청 때 결제**(반려 · 회사 사정이면 환불 · 재고가 없어 반품으로 바꾸면 전액 환불) · 판매 약관 1.2(D028) · '
            '금칙어 같은 줄 정리(G-203 · D029) · 확장 점검 결함 10건 수정(D026) → `sgb/docs/' + DOC75 + '` (v10.26). ')
    if 'sgb/docs/' + DOC75 not in s:
        i = s.index('10/8 **확장 점검(제품 코드는 v10.25 그대로)**'); s = s[:i] + line + '\n\n' + s[i:]
    return s
edit(K + '/README.md', readme)
# 4. 문서의 이름 줄
NOTE = lambda s: s.replace('**10/8 (v10.25 킷)**', '**10/8 (v10.26 킷)**').replace('`…_v10_25`', '`…_v10_26`')
for f in ('60_로컬점검_AWS적용절차_v10.16_20261003.md', '62_결제환불정합_v10.18_20261006.md'):
    edit(K + '/sgb/docs/' + f, lambda s: NOTE(s).replace('v10_25', 'v10_26').replace('(70 — v10.25 킷)', '(75 — v10.26 킷)'))
for f in ('63_급구급매_소개버튼삭제_v10.19_20261006.md', '64_상세화면_소개버튼삭제_v10.20_20261006.md', '67_매물상세_누른매물_실제웹적용_v10.21_20261007.md',
          '68_상세보기_전체목록표_재조사_v10.21_20261007.md', '70_소개창업_축상세4종_언어단추수정_v10.22_20261007.md', '71_소개광장_제시디자인적용_v10.23_20261007.md',
          '72_생활금융상담_업종상세_시험용업체_v10.24_20261007.md'):
    edit(K + '/sgb/docs/' + f, NOTE)
N73 = '> **10/8 (v10.26 킷)** — 이 문서의 내용은 v10.25 때 그대로입니다. 이 킷의 폴더 · 시안 파일 이름은 `…_v10_26` 입니다. 소개몰은 v10.26 에서 상품 자료 · 옵션 · 교환 배송비가 더해졌습니다 — `' + DOC75 + '`.\n'
for f in ('73_소개몰_시안기준_개발_v10.25_20261008.md', '74_확장점검_연동_버튼_flow_DB연동_v10.25_20261008.md'):
    def fn(s, f=f):
        if '(v10.26 킷)' in s: return s
        i = s.find('\n---\n')
        if i < 0: i = s.index('\n') + 1; return s[:i] + '\n' + N73 + s[i:]      # 구분선이 없는 문서 — 제목 줄 바로 아래
        return s[:i] + '\n\n' + N73.rstrip('\n') + s[i:]
    edit(K + '/sgb/docs/' + f, fn)
print('VERSION', open(K + '/sgb/VERSION').read().strip(), '|', sorted(os.path.basename(f) for f in glob.glob(K + '/SGB_Prototype_*.html') + glob.glob(K + '/sgb/site/public/proto/*.html')))
