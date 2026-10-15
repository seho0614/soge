"""킷의 판 이름을 v10.25 로 — 시안 3벌 · VERSION · README · 문서의 폴더/파일 이름. 여러 번 돌려도 같습니다."""
import os, re, shutil, glob
K='/home/claude/pkg/SGB_DevDocker_Integrated_20261002'
DOC73='73_소개몰_시안기준_개발_v10.25_20261008.md'
# 1. 시안 3벌
src=K+'/sgb/spec/proto.html'
assert re.search(r'<title>소개뱅크 시안 v10\.25 ', open(src,encoding='utf8').read(3000))
for d in (K, K+'/sgb/site/public/proto'):
    for f in glob.glob(d+'/SGB_Prototype_v10_*.html'):
        if not f.endswith('v10_25.html'): os.remove(f)
    shutil.copyfile(src, d+'/SGB_Prototype_v10_25.html')
# 2. VERSION
open(K+'/sgb/VERSION','w').write('v10.25\n')
def edit(path, fn):
    s=open(path,encoding='utf8').read(); t=fn(s)
    if t!=s: open(path,'w',encoding='utf8').write(t); print('고침', os.path.relpath(path,K))
# 3. README
def readme(s):
    s=s.replace('v10_24','v10_25')
    line=('10/8 **소개몰(쇼핑몰)을 시안 기준으로** — 메뉴 이름 「소개몰」 · 메인을 제시 디자인대로(사진 띠 · 성분/고민 타일 · 성분별 최저가 — 순위 · 특별 할인처럼 자료가 없는 구역은 실제 웹에서 그리지 않음) · '
          '**배송비 전 상품 무료 · 의료기기 미판매 · 건강기능식품 잠금**(D025) · 약관 3종 이름 정리와 배송 조항(D024) · 하위 20쪽을 시안의 구성으로(「← 뒤로」 · 갈래 단추 · 성분 찾기 · 환불 예상 표 …) · '
          '한글 「없는 주소」 화면 · 서버: `GET /health/categories` · 시안: 남기기로 한 개발분 10건과 개발분 값 3건을 시안에도, 소개몰 안의 머리줄 · 바닥줄 단추를 본체 화면으로 이음 → `sgb/docs/'+DOC73+'` (v10.25). ')
    if 'sgb/docs/'+DOC73 not in s:
        i=s.index('10/7 **안심소개 「생활 · 금융 상담」'); s=s[:i]+line+s[i:]
    return s
edit(K+'/README.md', readme)
# 4. 문서의 이름 줄 — 명령 · 주소에 폴더 이름이 들어 있는 문서
for f in ('60_로컬점검_AWS적용절차_v10.16_20261003.md','62_결제환불정합_v10.18_20261006.md'):
    edit(K+'/sgb/docs/'+f, lambda s: s.replace('v10_24','v10_25').replace('**10/7 (v10.24 킷)**','**10/8 (v10.25 킷)**').replace('(68 — v10.24 킷)','(70 — v10.25 킷)'))
for f in ('63_급구급매_소개버튼삭제_v10.19_20261006.md','64_상세화면_소개버튼삭제_v10.20_20261006.md','67_매물상세_누른매물_실제웹적용_v10.21_20261007.md','68_상세보기_전체목록표_재조사_v10.21_20261007.md',
          '70_소개창업_축상세4종_언어단추수정_v10.22_20261007.md','71_소개광장_제시디자인적용_v10.23_20261007.md'):
    edit(K+'/sgb/docs/'+f, lambda s: s.replace('**10/7 (v10.24 킷)**','**10/8 (v10.25 킷)**').replace('`…_v10_24`','`…_v10_25`'))
NOTE72='> **10/8 (v10.25 킷)** — 이 문서의 내용은 v10.24 때 그대로입니다. 이 킷의 폴더 · 시안 파일 이름은 `…_v10_25` 입니다(명령 · 주소의 파일 이름은 그 이름으로 바꿔 쓰십시오). v10.25 에서 바뀐 것은 소개몰입니다 — `'+DOC73+'`.\n'
def fn72(s):
    if '(v10.25 킷)' in s: return s
    i=s.index('\n---\n'); return s[:i]+'\n'+NOTE72.rstrip('\n')+s[i:]
edit(K+'/sgb/docs/72_생활금융상담_업종상세_시험용업체_v10.24_20261007.md', fn72)
print('VERSION', open(K+'/sgb/VERSION').read().strip(), '|', sorted(os.path.basename(f) for f in glob.glob(K+'/SGB_Prototype_*.html')+glob.glob(K+'/sgb/site/public/proto/*.html')))
