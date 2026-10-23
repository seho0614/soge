"""v10.81 시험 — 머리줄 메뉴 잘림 고침(F-9 · docs/135)

  KIT=… python3 -I test_v1081.py
"""
import os, re

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


rd = lambda rel: open(os.path.join(K, rel), encoding='utf-8').read() if os.path.exists(os.path.join(K, rel)) else ''
C = rd('site/src/styles/proto-common.css')
blk = C[C.find('@media (max-width: 1240px) {'):]; blk = blk[:blk.find('\n}') + 2]
ok('둘째 줄로 내리는 폭 1240px(시트 3단계)', '@media (max-width: 1240px) {' in C and '.pc-gnb { order: 3; flex: 1 0 100%; overflow-x: auto;' in blk, '')
ok('그 블록 옆 여백 20px(메뉴가 로고와 같은 줄에서 시작)', '.pc-hdin { flex-wrap: wrap; height: auto; padding: 10px 20px 0;' in blk, '')
ok('오른쪽 글자 링크 · m-only 는 900px 그대로', '@media (max-width: 900px) {\n  .pc-hr .sep, .pc-hr a.txt, .pc-hr .who { display: none; }' in C and '.pc-gnb .m-only { display: inline;' in C, '')
ok('넓은 화면 한 줄 메뉴는 그대로', '.pc-gnb { display: flex; gap: 30px; flex: 1; min-width: 0; overflow: hidden; }' in C, '')
ok('작업 문서 docs/135', os.path.exists(os.path.join(K, 'docs/135_머리줄메뉴_잘림_F9_v10.81_20261023.md')), '')
ok('VERSION v10.81 이상', re.match(r'v10\.(8[1-9]|9\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
