"""시안(spec/proto.html)에 v10.18 을 넣습니다 — 여러 번 돌려도 같은 결과입니다.

  python3 apply_proto_v1018.py     (apply_proto_v1014.py 다음에 — 판 이름이 v10.17 이어야 합니다)

넣는 것 (서버 D022 — 결제 · 환불의 실제 결과를 그대로 보여 주기)
  1. 모듈 M_bill (proto_pb_src.js)
       마이 「구독 · 소개코드」 위쪽 「내 구독」 — 자동 갱신 해지 · 해지 철회 · 환불(환불 완료 · 환불 결과 확인 중 · 환불 실패)
       운영 「청구 현황」 위쪽 「결제 · 환불 확인 필요」
  2. 기존 화면의 연결 고리 두 줄(/*PB:HOOK*/ 표시) — scMySub · scAdmBil
  3. 판 이름 v10.18
새 화면은 없습니다(화면 수 · 화면 ID 는 그대로). 다른 화면의 코드는 건드리지 않습니다.
"""
import os, re

_kit = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sgb')
K = os.environ.get('KIT') or (_kit if os.path.isdir(os.path.join(_kit, 'spec')) else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
HERE = os.path.dirname(os.path.abspath(__file__))
P = os.path.join(K, 'spec/proto.html')
s = open(P, encoding='utf-8').read()
n0 = len(s)

def once(a, what):
    assert s.count(a) == 1, (what, s.count(a))

# ── 0. 전에 넣은 것 걷어내기 ──
s = re.sub(r'/\*PB:BEGIN\*/\n.*?/\*PB:END\*/\n', '', s, flags=re.S)
s = ''.join(l for l in s.splitlines(True) if '/*PB:HOOK*/' not in l and '/*PB:INSTALL*/' not in l)

# ── 1. 모듈 ──
src = open(os.path.join(HERE, 'proto_pb_src.js'), encoding='utf-8').read()
assert '</script' not in src
a = '\nvar M_router = (function(){'
once(a, 'M_router')
s = s.replace(a, '\n/*PB:BEGIN*/\n' + src + '/*PB:END*/\n' + a.lstrip('\n'), 1)
a = '    View.addScreens(M_ansim.install(View.UI, data, M_router));\n'
once(a, 'M_ansim.install')
s = s.replace(a, a + '    M_bill.install(View.UI, data);   /*PB:INSTALL*/ /* v10.18 — 내 구독(해지 · 환불 상태) · 결제 · 환불 확인 필요 */\n')

# ── 2. 연결 고리 ──
a = '''    '<div class="subnow"><div><span class="ls">현재 요금제</span><b>'+e(cur.name)+' · '+won(cur.price)+'/월</b>'+\n'''
once(a, 'scMySub')
s = s.replace(a, "    /*PB:HOOK*/ (window.__PB ? window.__PB.myBox() : '')+\n" + a, 1)
a = '''    '<h2 class="s2">청구 정책</h2>'+\n    '<table class="tb"><thead><tr><th>항목</th><th>현재</th><th>동작</th><th>허용</th><th>설명</th></tr></thead><tbody>'+\n'''
once(a, 'scAdmBil')
s = s.replace(a, "    /*PB:HOOK*/ (window.__PB ? window.__PB.admBox() : '')+\n" + a, 1)

# ── 3. 판 이름 ──
m = re.search(r'<title>소개뱅크 시안 v(\d+\.\d+) \(2026-10-\d\d · ', s)
assert m, '제목을 찾지 못했습니다'
if m.group(1) == '10.17':
    s = s.replace(m.group(0), '<title>소개뱅크 시안 v10.18 (2026-10-06 · 내 구독(해지 · 환불 상태) · 결제 · 환불 확인 필요 · ', 1)
    s = s.replace('SGB_Prototype_v10_17.html', 'SGB_Prototype_v10_18.html')
assert re.search(r'<title>소개뱅크 시안 v10\.18 ', s)

open(P, 'w', encoding='utf-8').write(s)
print(f'proto {n0:,} → {len(s):,} bytes · module {len(src):,}')
