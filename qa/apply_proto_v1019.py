"""시안(spec/proto.html)에 v10.19 를 넣습니다 — 여러 번 돌려도 같은 결과입니다.

  python3 apply_proto_v1019.py     (apply_proto_v1018.py 다음에 — 판 이름이 v10.18 이어야 합니다)

넣는 것 (10/6 사장님 지시 「급구급매 부분에서 소개하기 · 소개받고 싶어요 · 소개받기 버튼 삭제」)
  1. 빠른 메뉴 화면의 위쪽 줄 틀(qmRow) — 「급구 · 급매」(urg)일 때만 세 버튼 칸(.qtabs)을 그리지 않습니다.
     칸이 빠진 자리를 비워 두지 않도록 그 줄은 한 칸짜리(.noq)로 그립니다.
     같은 줄 틀을 쓰는 베스트매칭 · 사고예방 · 성공현황은 그대로입니다(지시 범위 아님).
  2. 판 이름 v10.19
새 화면 · 없앤 화면은 없습니다(화면 수 · 화면 ID 는 그대로). 다른 화면의 코드는 건드리지 않습니다.
"""
import os, re

_kit = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sgb')
K = os.environ.get('KIT') or (_kit if os.path.isdir(os.path.join(_kit, 'spec')) else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
P = os.path.join(K, 'spec/proto.html')
s = open(P, encoding='utf-8').read()
n0 = len(s)

OLD_FN = '''  function qmRow(code, active, title, sub){
    return '<div class="rrow qrow">'+
      '<div class="qtabs">'+ roleTab(code) +'</div>'+
      '<div class="qmain">'+
'''
NEW_FN = '''  function qmRow(code, active, title, sub){
    /*PU:v10.19*/ var noTabs = (active === "urg");   /* 10/6 지시 — 급구 · 급매에서는 소개하기 · 소개받고 싶어요 · 소개받기 버튼을 뺍니다 */
    return '<div class="rrow qrow'+(noTabs ? ' noq' : '')+'">'+
      (noTabs ? '' : '<div class="qtabs">'+ roleTab(code) +'</div>')+
      '<div class="qmain">'+
'''
OLD_CSS = '''  @media (max-width:980px){ .gwl .rrow.qrow{grid-template-columns:1fr} }
'''
NEW_CSS = OLD_CSS + '''  .gwl .rrow.qrow.noq{grid-template-columns:1fr}   /*PU:v10.19 — 세 버튼 칸이 없는 줄(급구 · 급매)은 한 칸*/
'''

# ── 0. 전에 넣은 것 걷어내기 ──
if NEW_FN in s:
    s = s.replace(NEW_FN, OLD_FN, 1)
s = ''.join(l for l in s.splitlines(True) if '/*PU:v10.19 ' not in l)
assert '/*PU:' not in s, '걷어내지 못한 표시가 남았습니다'

# ── 1. 줄 틀 ──
assert s.count(OLD_FN) == 1, ('qmRow', s.count(OLD_FN))
s = s.replace(OLD_FN, NEW_FN, 1)
assert s.count(OLD_CSS) == 1, ('qrow css', s.count(OLD_CSS))
s = s.replace(OLD_CSS, NEW_CSS, 1)

# ── 2. 판 이름 ──
m = re.search(r'<title>소개뱅크 시안 v(\d+\.\d+) \(2026-10-\d\d · ', s)
assert m, '제목을 찾지 못했습니다'
if m.group(1) == '10.18':
    s = s.replace(m.group(0), '<title>소개뱅크 시안 v10.19 (2026-10-06 · 급구 · 급매 화면의 소개 버튼 3종 삭제 · ', 1)
    s = s.replace('SGB_Prototype_v10_18.html', 'SGB_Prototype_v10_19.html')
assert re.search(r'<title>소개뱅크 시안 v10\.19 ', s)

open(P, 'w', encoding='utf-8').write(s)
print(f'proto {n0:,} → {len(s):,} bytes')
