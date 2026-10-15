"""킷의 판 이름을 v10.36 로 — VERSION · 시안 세 벌(킷 최상위 · sgb/spec/proto.html · sgb/site/public/proto/) 이름 SGB_Prototype_v10_36.html · 시안 <title> 머리. 여러 번 돌려도 같습니다."""
import os, glob
K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
src = open(K + '/sgb/spec/proto.html', encoding='utf8').read()
old = '<title>소개뱅크 시안 v10.35 (2026-10-12 · '
new = '<title>소개뱅크 시안 v10.36 (2026-10-12 · 시안 내용은 v10.33 과 같음 — v10.36 은 소개장터 개인 등록 허용 · 로그인 후 첫 화면 저장 결함 · v10.35 (2026-10-12 · '
if old in src: src = src.replace(old, new, 1)
assert '<title>소개뱅크 시안 v10.36 ' in src[:3000]
open(K + '/sgb/spec/proto.html', 'w', encoding='utf8').write(src)
for d in (K, K + '/sgb/site/public/proto'):
    for f in glob.glob(d + '/SGB_Prototype_v10_*.html'):
        if not f.endswith('v10_36.html'): os.remove(f)
    open(d + '/SGB_Prototype_v10_36.html', 'w', encoding='utf8').write(src)
open(K + '/sgb/VERSION', 'w').write('v10.36\n')
print('v10.36 · 시안 세 벌', len(src.encode()), '바이트')
