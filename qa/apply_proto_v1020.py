"""시안(spec/proto.html)에 v10.20 을 넣습니다 — 여러 번 돌려도 같은 결과입니다.

  python3 apply_proto_v1020.py     (apply_proto_v1019.py 다음에 — 판 이름이 v10.19 여야 합니다)

넣는 것 (10/6 사장님 지시 — 소개창업 매물 상세 화면을 보내시며 「소개하기 · 소개받고 싶어요 · 소개받기 3개 버튼 삭제」 · 범위 답 「보내 주신 상세 화면만」)
  1. 상세 화면(scDetail · 화면 키 detail · SB-BIZ-DTL-010) — 검색 아래의 세 버튼과 안내 글(「다양한 상품과 서비스를 소개하고 수익을 만들어보세요!」)을 그리지 않습니다.
     돌아가기 · 검색 · 본문(사진 · 제목 · 소개자 · 실적 · 설명 · 질문하기 · 전화하기)은 그대로입니다.
     소개장터 · 안심소개의 상세(dtlm · dtll)에는 원래 이 버튼이 없습니다 — 이제 세 관의 상세가 같습니다.
  2. 판 이름 v10.20
새 화면 · 없앤 화면은 없습니다(화면 수 · 화면 ID 는 그대로). 다른 화면의 코드는 건드리지 않습니다.
"""
import os, re

_kit = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sgb')
K = os.environ.get('KIT') or (_kit if os.path.isdir(os.path.join(_kit, 'spec')) else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
P = os.path.join(K, 'spec/proto.html')
s = open(P, encoding='utf-8').read()
n0 = len(s)

HEAD = '''  function scDetail(){
    return header({login:true, blueCta:true})+
      '<div class="wrap" style="padding-top:16px">'+ backLink("목록") + search(true, true) +
'''
OLD = HEAD + '''      '<div class="tabs"><button class="tab on" data-go="'+regDest()+'">소개하기</button>'+
      '<button class="tab" data-go="regb">소개받고 싶어요</button>'+
      '<button class="tab" data-go="reql">소개받기</button></div>'+
      '<div class="tabnote">다양한 상품과 서비스를 소개하고 수익을 만들어보세요!</div></div>'+
'''
NEW = HEAD + '''      /*PD:v10.20*/ '</div>'+   /* 10/6 지시 — 상세(소개창업)에서는 소개하기 · 소개받고 싶어요 · 소개받기 버튼과 그 아래 안내 글을 뺍니다 */
'''

# ── 0. 전에 넣은 것 걷어내기 ──
if NEW in s:
    s = s.replace(NEW, OLD, 1)
assert '/*PD:' not in s, '걷어내지 못한 표시가 남았습니다'

# ── 1. 상세 화면 ──
assert s.count(OLD) == 1, ('scDetail', s.count(OLD))
s = s.replace(OLD, NEW, 1)

# ── 2. 판 이름 ──
m = re.search(r'<title>소개뱅크 시안 v(\d+\.\d+) \(2026-10-\d\d · ', s)
assert m, '제목을 찾지 못했습니다'
if m.group(1) == '10.19':
    s = s.replace(m.group(0), '<title>소개뱅크 시안 v10.20 (2026-10-06 · 상세 화면(소개창업)의 소개 버튼 3종 삭제 · ', 1)
    s = s.replace('SGB_Prototype_v10_19.html', 'SGB_Prototype_v10_20.html')
assert re.search(r'<title>소개뱅크 시안 v10\.20 ', s)

open(P, 'w', encoding='utf-8').write(s)
print(f'proto {n0:,} → {len(s):,} bytes')
