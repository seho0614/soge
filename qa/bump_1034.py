"""킷의 판 이름을 v10.34 으로 — VERSION · 시안 세 벌(킷 최상위 · sgb/spec/proto.html · sgb/site/public/proto/) 이름 SGB_Prototype_v10_34.html · 시안 <title> 머리. 여러 번 돌려도 같습니다."""
import os, glob
K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
src = open(K + '/sgb/spec/proto.html', encoding='utf8').read()
old = '<title>소개뱅크 시안 v10.33 (2026-10-11 · '
new = '<title>소개뱅크 시안 v10.34 (2026-10-12 · 시안 내용은 v10.33 과 같음 — v10.34 는 전자세금계산서 연결 자리 · 간주 모드 · 수화 오류 고침 · 개발 DB 새로 · v10.33: '
if old in src: src = src.replace(old, new, 1)
assert '<title>소개뱅크 시안 v10.34 ' in src[:3000]
open(K + '/sgb/spec/proto.html', 'w', encoding='utf8').write(src)
for d in (K, K + '/sgb/site/public/proto'):
    for f in glob.glob(d + '/SGB_Prototype_v10_*.html'):
        if not f.endswith('v10_34.html'): os.remove(f)
    open(d + '/SGB_Prototype_v10_34.html', 'w', encoding='utf8').write(src)
open(K + '/sgb/VERSION', 'w').write('v10.34\n')
print('v10.34 · 시안 세 벌', len(src.encode()), '바이트')
