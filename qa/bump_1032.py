"""킷의 시안 이름을 v10.32 로 — 시안 내용은 v10.31 과 같고 <title> 머리만 「v10.32 … 시안 내용은 v10.31 과 같음」으로 바꿉니다.
   (판 이름 = VERSION 규칙 · link_check B-1 이 VERSION 으로 시안 주소를 찾음) 세 벌: 킷 최상위 · sgb/spec/proto.html · sgb/site/public/proto/. 여러 번 돌려도 같습니다."""
import os, glob, re
K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
src = open(K + '/sgb/spec/proto.html', encoding='utf8').read()
old = '<title>소개뱅크 시안 v10.31 ('
new = '<title>소개뱅크 시안 v10.32 (2026-10-11 · 시안 내용은 v10.31 과 같음 — v10.32 는 개발을 시안대로 맞춘 판 · v10.31: '
if old in src:
    src = src.replace(old + '2026-10-10 · ', new, 1) if (old + '2026-10-10 · ') in src else src.replace(old, new, 1)
assert '<title>소개뱅크 시안 v10.32 ' in src[:3000]
open(K + '/sgb/spec/proto.html', 'w', encoding='utf8').write(src)
for d in (K, K + '/sgb/site/public/proto'):
    for f in glob.glob(d + '/SGB_Prototype_v10_*.html'):
        if not f.endswith('v10_32.html'): os.remove(f)
    open(d + '/SGB_Prototype_v10_32.html', 'w', encoding='utf8').write(src)
print('시안 v10.32 세 벌 ·', len(src.encode()), '바이트')
