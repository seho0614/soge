"""킷의 판 이름을 v10.28 로 — 시안 3벌 · VERSION · README · 문서의 폴더/파일 이름 줄. 여러 번 돌려도 같습니다."""
import os, re, shutil, glob
K = '/home/claude/pkg/SGB_DevDocker_Integrated_20261002'
DOC76 = '76_결함수정_거래흐름_구독예약_시안결함_v10.27_20261009.md'
DOC77 = '77_소개몰배송_구매확정_리뷰문의_약관한벌_재동의_개인정산_v10.28_20261009.md'
src = K + '/sgb/spec/proto.html'
assert re.search(r'<title>소개뱅크 시안 v10\.28 ', open(src, encoding='utf8').read(3000))
for d in (K, K + '/sgb/site/public/proto'):
    for f in glob.glob(d + '/SGB_Prototype_v10_*.html'):
        if not f.endswith('v10_28.html'): os.remove(f)
    shutil.copyfile(src, d + '/SGB_Prototype_v10_28.html')
open(K + '/sgb/VERSION', 'w').write('v10.28\n')
def edit(path, fn):
    s = open(path, encoding='utf8').read(); t = fn(s)
    if t != s: open(path, 'w', encoding='utf8').write(t); print('고침', os.path.relpath(path, K))
def readme(s):
    s = s.replace('v10_27', 'v10_28').replace('같은 파일, 201화면', '같은 파일, 204화면')
    line = ('10/9 **소개몰 배송 · 구매확정 · 리뷰 · 문의 · 순위 + 약관 한 벌 · 상담 이메일 · 개인 소개비 정산(v10.28 · 두 묶음 한 판)** — '
            '운영 「소개몰 주문」 발송 처리(택배사 · 송장 · 배송 완료 · G-147 · G-194) · **구매확정(배송 완료 7일 뒤 자동 · 확정 뒤에도 법정 기간 안 반품 · 교환)** · '
            '리뷰(별점 · 글 · 금칙어면 운영 확인 뒤) · 상품 문의(비공개 · 운영자 답변) · 순위(최근 7일 판매 수량 · 하루 1회) · 선택 약관 바꾸기(G-214) · '
            '상담 신청 이메일(암호화 · 연락처를 열 때만) · **개인(본인인증) 소개비 정산 — 받을 계좌는 신청할 때 확인 · 스위치는 꺼 둔 채** · '
            '**약관 글 한 벌(G-217 · 생성기 = DB) · 다음 로그인 때 재동의** · 마이그레이션 86 → `sgb/docs/' + DOC77 + '` (v10.28). ')
    if 'sgb/docs/' + DOC77 not in s:
        i = s.index('10/9 **결함 수정판(v10.27)**'); s = s[:i] + line + '\n\n' + s[i:]
    return s
edit(K + '/README.md', readme)
NOTE = lambda s: s.replace('**10/9 (v10.27 킷)**', '**10/9 (v10.28 킷)**').replace('`…_v10_27`', '`…_v10_28`')
for f in ('60_로컬점검_AWS적용절차_v10.16_20261003.md', '62_결제환불정합_v10.18_20261006.md'):
    edit(K + '/sgb/docs/' + f, lambda s: NOTE(s).replace('v10_27', 'v10_28').replace('(76 — v10.27 킷)', '(77 — v10.28 킷)'))
for f in ('63_급구급매_소개버튼삭제_v10.19_20261006.md', '64_상세화면_소개버튼삭제_v10.20_20261006.md', '67_매물상세_누른매물_실제웹적용_v10.21_20261007.md',
          '68_상세보기_전체목록표_재조사_v10.21_20261007.md', '70_소개창업_축상세4종_언어단추수정_v10.22_20261007.md', '71_소개광장_제시디자인적용_v10.23_20261007.md',
          '72_생활금융상담_업종상세_시험용업체_v10.24_20261007.md', '73_소개몰_시안기준_개발_v10.25_20261008.md', '74_확장점검_연동_버튼_flow_DB연동_v10.25_20261008.md',
          '75_소개몰_상품자료_옵션_교환배송비_v10.26_20261008.md'):
    p = K + '/sgb/docs/' + f
    if os.path.exists(p): edit(p, NOTE)
N76 = '> **10/9 (v10.28 킷)** — 이 문서의 내용은 v10.27 때 그대로입니다. 이 킷의 폴더 · 시안 파일 이름은 `…_v10_28` 입니다. v10.28 의 변경은 `' + DOC77 + '`.\n'
p76 = K + '/sgb/docs/' + DOC76
def fn76(s):
    if '(v10.28 킷)' in s: return s
    i = s.find('\n---\n')
    if i < 0: i = s.index('\n') + 1; return s[:i] + '\n' + N76 + s[i:]
    return s[:i] + '\n\n' + N76.rstrip('\n') + s[i:]
if os.path.exists(p76): edit(p76, fn76)
print('VERSION', open(K + '/sgb/VERSION').read().strip(), '|', sorted(os.path.basename(f) for f in glob.glob(K + '/SGB_Prototype_*.html') + glob.glob(K + '/sgb/site/public/proto/*.html')))
