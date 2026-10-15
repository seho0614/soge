"""킷의 판 이름을 v10.39 로 — VERSION · 시안 세 벌(킷 최상위 · sgb/spec/proto.html · sgb/site/public/proto/) 이름 SGB_Prototype_v10_39.html · 시안 <title> 머리. 여러 번 돌려도 같습니다."""
import os, glob
K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
src = open(K + '/sgb/spec/proto.html', encoding='utf8').read()
old = '<title>소개뱅크 시안 v10.38 (2026-10-13 · '
new = '<title>소개뱅크 시안 v10.39 (2026-10-13 · 리팩토링 — 코드 구조만 · 시안 글 그대로) · '
if old in src: src = src.replace(old, new, 1)
assert '<title>소개뱅크 시안 v10.39 ' in src[:3000]
open(K + '/sgb/spec/proto.html', 'w', encoding='utf8').write(src)
for d in (K, K + '/sgb/site/public/proto'):
    for f in glob.glob(d + '/SGB_Prototype_v10_*.html'):
        if not f.endswith('v10_39.html'): os.remove(f)
    open(d + '/SGB_Prototype_v10_39.html', 'w', encoding='utf8').write(src)
open(K + '/sgb/VERSION', 'w').write('v10.39\n')
print('v10.39 · 시안 세 벌', len(src.encode()), '바이트')
