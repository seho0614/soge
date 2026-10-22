"""v10.66 — 디자인 통일 6단계 ① 시안 파트너센터 대시보드(p2dsh) 화면 코드 안 글자색(docs/122). 다시 돌려도 같은 결과입니다.

  python3 -I apply_proto_v1066.py <sgb-core 폴더>

  10/22 대표 「추천대로」 — 화면에서 잰 실제 바탕 기준(measure_proto_v1066.py · results_v10_66/proto_contrast.json)
  바꾸는 것 — 흰 · 밝은 바탕 위 대비 4.5 미달 글자 39곳 · 흰 글자가 올라간 밝은 꼬리표 바탕
    · 회색 #6E7A96 (17) · 연회색 #9AA5BE (8) → 흐린 글자 var(--sgb-ink-3) #646f8c   (#14 ①)
    · 초록 #12B886 글자 (13) → 초록 글자 var(--sgb-gr-text) #047857                    (#14 ②)
    · 금색 #B8860B 「골드 파트너」 (1) → 같은 금색 계열로 진하게 #986f09(4.55)
    · 흰 글자 꼬리표 바탕 — #12B886 → var(--sgb-mall)(5.47) · #F04438 → var(--sgb-rd-text)(6.5) — 시안 4곳 · 실제 웹 partners.css .tag.high · .tag.hot
  그대로 — 남색 띠(#101E3E) 위 밝은 글자 18곳(대비 5.2 ~ 10.7 · 띠 위 ✔ 는 style 이 「color:#12B886;」 하나뿐) · 막대(width % 칸) 바탕
"""
import os, re, sys

CORE = sys.argv[1] if len(sys.argv) > 1 else '.'
PROTO = os.path.join(CORE, 'spec/proto.html')
CSS = os.path.join(CORE, 'site/src/styles/partners.css')
ANCHOR = 'var html = "<div style=\\"width: 1440px; height: 1560px;'      # 시안 p2dsh 화면 문자열(한 줄)
TEXT = {'#6E7A96': 'var(--sgb-ink-3)', '#9AA5BE': 'var(--sgb-ink-3)', '#12B886': 'var(--sgb-gr-text)', '#B8860B': '#986f09'}
BADGE = {'#12B886': 'var(--sgb-mall)', '#F04438': 'var(--sgb-rd-text)'}
KEEP = {'color:#12B886;'}                                                 # 남색 띠 위 ✔

def fix_style(m):
    st = m.group(1)
    if st in KEEP: return m.group(0)
    st2 = re.sub(r'((?:^|;)\s*color\s*:\s*)(#[0-9A-Fa-f]{6})\b', lambda c: c.group(1) + TEXT.get(c.group(2).upper(), c.group(2)), st)
    if re.search(r'(?:^|;)\s*color\s*:\s*#fff(?:fff)?\b', st2, re.I):    # 흰 글자 꼬리표만 — 막대 바탕은 그대로
        st2 = re.sub(r'(background\s*:\s*)(#[0-9A-Fa-f]{6})\b', lambda c: c.group(1) + BADGE.get(c.group(2).upper(), c.group(2)), st2)
    return 'style=\\"' + st2 + '\\"'

s0 = open(PROTO, encoding='utf-8').read()
i = s0.index(ANCHOR); assert s0.count(ANCHOR) == 1
j = s0.index('\n', i)
seg = re.sub(r'style=\\"([^"\\]*)\\"', fix_style, s0[i:j])
s = s0[:i] + seg + s0[j:]
if s != s0: open(PROTO, 'w', encoding='utf-8').write(s)

c0 = open(CSS, encoding='utf-8').read(); c = c0
for o, nw in [('.p2pc .tag.hot { background: #F04438; }', '.p2pc .tag.hot { background: var(--sgb-rd-text); }'),
              ('.p2pc .tag.high { background: #12B886; }', '.p2pc .tag.high { background: var(--sgb-mall); }')]:
    if nw in c and o not in c: continue
    assert c.count(o) == 1, o; c = c.replace(o, nw)
if c != c0: open(CSS, 'w', encoding='utf-8').write(c)
print('시안', len(s0) - len(s), '글자 차이 ·', '바뀜' if s != s0 else '그대로', '· partners.css', '바뀜' if c != c0 else '그대로')
