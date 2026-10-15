"""킷의 판 이름을 v10.33 으로 — VERSION · 시안 세 벌(킷 최상위 · sgb/spec/proto.html · sgb/site/public/proto/) 이름 SGB_Prototype_v10_33.html · 시안 <title> 머리. 여러 번 돌려도 같습니다."""
import os, glob
K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
src = open(K + '/sgb/spec/proto.html', encoding='utf8').read()
old = '<title>소개뱅크 시안 v10.32 (2026-10-11 · '
new = '<title>소개뱅크 시안 v10.33 (2026-10-11 · 법률 · 세무 정액 노출 — 월 노출료 부가세 별도 · 기간 연장 신청 · 연장 입금 확인 · 입금 확인마다 세금계산서 · v10.32: '
if old in src: src = src.replace(old, new, 1)
assert '<title>소개뱅크 시안 v10.33 ' in src[:3000]
open(K + '/sgb/spec/proto.html', 'w', encoding='utf8').write(src)
for d in (K, K + '/sgb/site/public/proto'):
    for f in glob.glob(d + '/SGB_Prototype_v10_*.html'):
        if not f.endswith('v10_33.html'): os.remove(f)
    open(d + '/SGB_Prototype_v10_33.html', 'w', encoding='utf8').write(src)
open(K + '/sgb/VERSION', 'w').write('v10.33\n')
print('v10.33 · 시안 세 벌', len(src.encode()), '바이트')
