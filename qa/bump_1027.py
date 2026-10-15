"""킷의 판 이름을 v10.27 로 — 시안 3벌 · VERSION · README · 문서의 폴더/파일 이름 줄. 여러 번 돌려도 같습니다."""
import os, re, shutil, glob
K = '/home/claude/pkg/SGB_DevDocker_Integrated_20261002'
DOC76 = '76_결함수정_거래흐름_구독예약_시안결함_v10.27_20261009.md'
src = K + '/sgb/spec/proto.html'
assert re.search(r'<title>소개뱅크 시안 v10\.27 ', open(src, encoding='utf8').read(3000))
for d in (K, K + '/sgb/site/public/proto'):
    for f in glob.glob(d + '/SGB_Prototype_v10_*.html'):
        if not f.endswith('v10_27.html'): os.remove(f)
    shutil.copyfile(src, d + '/SGB_Prototype_v10_27.html')
open(K + '/sgb/VERSION', 'w').write('v10.27\n')
def edit(path, fn):
    s = open(path, encoding='utf8').read(); t = fn(s)
    if t != s: open(path, 'w', encoding='utf8').write(t); print('고침', os.path.relpath(path, K))
def readme(s):
    s = s.replace('v10_26', 'v10_27').replace('같은 파일, 200화면', '같은 파일, 201화면')
    line = ('10/9 **결함 수정판(v10.27)** — 열린 결함 전부: 거래 흐름(받은 문의 · 보낸 문의 · 계약서 요청 · 다음 단계 · 매물 내리기 · G-193) · '
            '**거래 당사자 확인(G-213 · 남의 거래에 대금 신고 · 계약서 조회/발급이 되던 것)** · 가입 약관 동의 기록(G-188) · 나의공간 첫 화면(G-195) · '
            '**구독 요금제 바꾸기 = 다음 결제일부터 예약(G-189 · 10/8 답 ③ · D032)** · 제휴 주문 귀속(G-190) · 소개광장 글 신고(G-191) · 서비스 지역 켜고 끄기(G-192) · '
            '화면 다시 그리기 오류 #418 원인 수정(G-94 · 쪽 105개) · 작은 결함 11건(G-201) · 시안 결함(G-196 ~ G-200) · 기준 데이터 외래 키(G-212 · D031) · 마이그레이션 77 → `sgb/docs/' + DOC76 + '` (v10.27). ')
    if 'sgb/docs/' + DOC76 not in s:
        i = s.index('10/8 **소개몰 상품 자료 · 옵션 · 교환 배송비(v10.26)**'); s = s[:i] + line + '\n\n' + s[i:]
    return s
edit(K + '/README.md', readme)
NOTE = lambda s: s.replace('**10/8 (v10.26 킷)**', '**10/9 (v10.27 킷)**').replace('`…_v10_26`', '`…_v10_27`')
for f in ('60_로컬점검_AWS적용절차_v10.16_20261003.md', '62_결제환불정합_v10.18_20261006.md'):
    edit(K + '/sgb/docs/' + f, lambda s: NOTE(s).replace('v10_26', 'v10_27').replace('(75 — v10.26 킷)', '(76 — v10.27 킷)'))
for f in ('63_급구급매_소개버튼삭제_v10.19_20261006.md', '64_상세화면_소개버튼삭제_v10.20_20261006.md', '67_매물상세_누른매물_실제웹적용_v10.21_20261007.md',
          '68_상세보기_전체목록표_재조사_v10.21_20261007.md', '70_소개창업_축상세4종_언어단추수정_v10.22_20261007.md', '71_소개광장_제시디자인적용_v10.23_20261007.md',
          '72_생활금융상담_업종상세_시험용업체_v10.24_20261007.md', '73_소개몰_시안기준_개발_v10.25_20261008.md', '74_확장점검_연동_버튼_flow_DB연동_v10.25_20261008.md'):
    p = K + '/sgb/docs/' + f
    if os.path.exists(p): edit(p, lambda s: NOTE(s).replace('**10/8 (v10.26 킷)** — ', '**10/9 (v10.27 킷)** — '))
N75 = '> **10/9 (v10.27 킷)** — 이 문서의 내용은 v10.26 때 그대로입니다. 이 킷의 폴더 · 시안 파일 이름은 `…_v10_27` 입니다. v10.27 의 결함 수정은 `' + DOC76 + '`.\n'
p75 = K + '/sgb/docs/75_소개몰_상품자료_옵션_교환배송비_v10.26_20261008.md'
def fn75(s):
    if '(v10.27 킷)' in s: return s
    i = s.find('\n---\n')
    if i < 0: i = s.index('\n') + 1; return s[:i] + '\n' + N75 + s[i:]
    return s[:i] + '\n\n' + N75.rstrip('\n') + s[i:]
edit(p75, fn75)
print('VERSION', open(K + '/sgb/VERSION').read().strip(), '|', sorted(os.path.basename(f) for f in glob.glob(K + '/SGB_Prototype_*.html') + glob.glob(K + '/sgb/site/public/proto/*.html')))
