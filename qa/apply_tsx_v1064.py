"""v10.64 — 디자인 통일 5단계 ② 화면 코드(.tsx) 안 숫자 색(docs/120). 다시 돌려도 같은 결과입니다.

  python3 -I apply_tsx_v1064.py <sgb-core 폴더>

  10/22 대표 「추천대로」(#14 ③ 그림 부품 색은 그대로)
  바꾸는 것 — 글자 · 바탕으로 쓰여 대비가 중요한 곳만(10곳)
    · 오류 · 주의 글자 4곳 — #B42318 → 빨강 글자(--sgb-rd-text) · #B45309 → 주황 글자(--sgb-or-text)
    · 파트너센터 첫 화면 KPI 아이콘 칸 6곳 — 흰 아이콘 · ₩ 글자가 올라가는 바탕(대비 2.5 ~ 4.1) → 시트 색(흰 글자 4.6 이상)
  그대로 — 그림 부품(ProductArt · CategoryArt · GwParts 그림 · 날씨 아이콘) · 로고(SiteHeader · ShopMain) · 지도 선(카카오맵은 CSS 변수를 못 읽음)
           · 아이콘 선(stroke) · 소개장터 등록 현황 카드의 연한 장식 바탕 · 시안 화면 코드 안 색(바탕을 알 수 없는 곳이 많음 — 따로 확인)
"""
import os, sys

CORE = sys.argv[1] if len(sys.argv) > 1 else '.'
SRC = os.path.join(CORE, 'site/src')
EDITS = {
    'components/my/IntroAnswer.tsx': [("style={{ color: '#B42318' }}", "style={{ color: 'var(--sgb-rd-text)' }}")],
    'app/my/account/page.tsx': [("<td style={{ color: '#B42318' }}>", "<td style={{ color: 'var(--sgb-rd-text)' }}>")],
    'components/auth/SignupWizard.tsx': [("style={{ color: '#B45309' }}>영문", "style={{ color: 'var(--sgb-or-text)' }}>영문"),
                                         ("style={{ color: '#B45309' }}>위 비밀번호", "style={{ color: 'var(--sgb-or-text)' }}>위 비밀번호")],
    'app/partners/page.tsx': [("{kpi('#12B886',", "{kpi('var(--sgb-mall)',"),          # 청록 — 흰 글자 5.47
                              ("{kpi('#3B6EF6',", "{kpi('var(--sgb-link)',"),          # 파랑 — 4.65 (2곳)
                              ("{kpi('#B15DE0',", "{kpi('var(--sgb-biz)',"),           # 보라 — 7.10
                              ("{kpi('#5B6EF6',", "{kpi('var(--sgb-navy)',"),          # 남색 — 15.0
                              ("style={{ background: '#D4A017' }}", "style={{ background: 'var(--sgb-or-text)' }}")],   # 금색 → 진한 주황 5.18
}
n = 0
for rel, pairs in EDITS.items():
    p = os.path.join(SRC, rel); s0 = open(p, encoding='utf-8').read(); s = s0
    for o, nw in pairs:
        if nw in s and o not in s: continue
        c = s.count(o); assert c >= 1, (rel, o)
        s = s.replace(o, nw); n += c
    if s != s0: open(p, 'w', encoding='utf-8').write(s)
print('바꾼 곳', n)
