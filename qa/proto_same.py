"""시안이 앞 판과 같은지 — 제목 · 파일 이름을 빼면 글자 하나 다르지 않아야 합니다(화면 변화가 없는 판에서 씁니다).
   10/6 v10.17: 앞 판 v10.16 (10/3 v10.16 은 v10.15 와 견줬습니다)
사용: python3 proto_same.py     BASE=/path/SGB_Prototype_v10_16.html (기본 /mnt/user-data/outputs)"""
import os, sys
K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
BASE = os.environ.get('BASE', '/mnt/user-data/outputs/SGB_Prototype_v10_16.html')
NEW, OLD = 'v10_17', 'v10_16'
TN = '<title>소개뱅크 시안 v10.17 (2026-10-06 · 화면은 v10.16 과 같음 — PowerShell 도우미 수정 판 · '
TO = '<title>소개뱅크 시안 v10.16 (2026-10-03 · '      # 제목은 판마다 앞에 한 마디씩 덧붙입니다 — 앞 판 제목의 머리만 견줍니다
a = open(BASE, encoding='utf-8').read()
files = [K + '/sgb/spec/proto.html', K + f'/SGB_Prototype_{NEW}.html', K + f'/sgb/site/public/proto/SGB_Prototype_{NEW}.html']
R = []
for f in files:
    b = open(f, encoding='utf-8').read()
    n = b.replace(f'SGB_Prototype_{NEW}.html', f'SGB_Prototype_{OLD}.html').replace(TN, TO)
    R.append((f.replace(K + '/', ''), TN in b, n == a))
    print('ok  ' if (TN in b and n == a) else 'FAIL', f.replace(K + '/', ''), '제목 v10.17' if TN in b else '제목 다름', '· 나머지 v10.16 과 같음' if n == a else '· 내용 다름', file=sys.stderr)
same3 = len({open(f, 'rb').read() for f in files}) == 1
print('ok  ' if same3 else 'FAIL', '세 파일(spec · 최상위 · site/public)이 같은 파일', file=sys.stderr)
ok = sum(1 for _, t, s in R if t and s) + (1 if same3 else 0)
print(f'통과 {ok} / {len(R) + 1}')
