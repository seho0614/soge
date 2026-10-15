"""킷의 판 이름을 v10.31 로 — 시안 3벌(킷 최상위 · sgb/spec/proto.html · sgb/site/public/proto/) · VERSION · README 의 판 줄 · 문서의 폴더/파일 이름 줄. 여러 번 돌려도 같습니다.
   시안은 따로 끝낸 판(/home/claude/work/v3/proto/SGB_Prototype_v10_31.html — sweep 무반응 0 · srv_proto 33/33)을 그대로 넣습니다. (bump_1030.py 방식)"""
import os, re, shutil, glob
K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
SRC = os.environ.get('PROTO_SRC', '/home/claude/work/v3/proto/SGB_Prototype_v10_31.html')
assert re.search(r'<title>소개뱅크 시안 v10\.31 ', open(SRC, encoding='utf8').read(3000)), '시안이 v10.31 이 아닙니다'
shutil.copyfile(SRC, K + '/sgb/spec/proto.html')
for d in (K, K + '/sgb/site/public/proto'):
    for f in glob.glob(d + '/SGB_Prototype_v10_*.html'):
        if not f.endswith('v10_31.html'): os.remove(f)
    shutil.copyfile(SRC, d + '/SGB_Prototype_v10_31.html')
open(K + '/sgb/VERSION', 'w').write('v10.31\n')
def edit(path, fn):
    s = open(path, encoding='utf8').read(); t = fn(s)
    if t != s: open(path, 'w', encoding='utf8').write(t); print('고침', os.path.relpath(path, K))
NAMES = lambda s: s.replace('SGB_Prototype_v10_30', 'SGB_Prototype_v10_31').replace('SGB_DevDocker_Integrated_20261002_v10_30', 'SGB_DevDocker_Integrated_20261002_v10_31')
def readme(s):
    s = NAMES(s)
    line = ('10/10 **시안 기준 반영(v10.31)** — 「시안과 개발 다른 점을 찾아 비교, 다른 것은 시안을 기준으로 개발 · 기능 반영, 검색은 시안과 동일하게」. '
            '여섯 묶음(메인 · 검색 · 소개받기 · 소개광장 · 공통 틀 / 소개장터 · 안심소개 · 소개창업 / 나의공간 · 소개몰 / 파트너센터 · 제휴 영업 / 운영 화면)을 시안대로 맞추고, '
            '시안에 있는데 서버 자료가 없던 구역은 서버(DB · API)까지 만들었습니다(마이그레이션 D044 ~ D090) · 리드 이용료 선불 충전(D070) · '
            '시안 v10.31(시안 스스로 동작하지 않던 곳 · 시연 단추 고침) · 전수 검정과 확장 점검(버튼 · flow · 연동 · 모든 페이지) '
            '→ `qa/results_v10_31/` · `sgb/docs/SGB_Matrix_Verification_20261010_v10_31.xlsx`. ')
    if '시안 기준 반영(v10.31)' not in s:
        i = s.index('10/9 **소개장터 메인을 제시 디자인대로(v10.30)**'); s = s[:i] + line + '\n\n' + s[i:]
    return s
edit(K + '/README.md', readme)
NOTE = lambda s: NAMES(s).replace('**10/9 (v10.30 킷)**', '**10/10 (v10.31 킷)**').replace('`…_v10_30`', '`…_v10_31`').replace('이름만 `v10_30`', '이름만 `v10_31`').replace('v10_30', 'v10_31')
for f in ('60_로컬점검_AWS적용절차_v10.16_20261003.md', '62_결제환불정합_v10.18_20261006.md'):
    p = K + '/sgb/docs/' + f
    if os.path.exists(p): edit(p, NOTE)
print('VERSION', open(K + '/sgb/VERSION').read().strip(), '|', sorted(os.path.relpath(f, K) for f in glob.glob(K + '/SGB_Prototype_*.html') + glob.glob(K + '/sgb/site/public/proto/*.html')),
      '| spec/proto.html = 시안 v10.31:', open(K + '/sgb/spec/proto.html', 'rb').read() == open(SRC, 'rb').read())
