"""v10.55 — 글자 대비 4.5 미달 고침(docs/108). 실제 웹 CSS 와 시안(spec/proto.html)에 같은 고침을 넣습니다.

  python3 -I apply_contrast_v1055.py <sgb-core 폴더>

  다시 돌려도 같은 결과입니다(이미 고친 곳은 건너뜀). 시안에 없는 규칙(맛집 · 새 상품 규격 등)은 실제 웹에만 들어갑니다.
"""
import os, sys

CORE = sys.argv[1] if len(sys.argv) > 1 else '.'
ST = 'site/src/styles/'
NOTE = '\n/* 2026-10-21 v10.55(docs/108) — 관 글자색(point-text)은 흰 바탕과 관 연한 바탕(point-l) 둘 다에서 대비 4.5 이상. 소개장터 #b85e00 → #ad5800 · 소개몰 #12883e → #117f3a · 소개광장 #d24502 → #c44002 */'

PAIRS = [
    # 디자인 시트 — 관 글자색 (시안에는 글자 그대로 옮긴 사본이 있음)
    ('sgb-tokens.css', '--sgb-point-text: #b85e00;', '--sgb-point-text: #ad5800;'),
    ('sgb-tokens.css', '--sgb-point-text: #12883e;', '--sgb-point-text: #117f3a;'),
    ('sgb-tokens.css', '--sgb-point-text: #d24502;', '--sgb-point-text: #c44002;'),
    ('sgb-tokens.css', '소개장터 메인은 MoneyView 가 따로 붙입니다 */', '소개장터 메인은 MoneyView 가 따로 붙입니다 */' + NOTE),
    # 소개광장 — 분류 배지 글자(바탕은 그대로)
    ('plaza.css', '시트 point-text #d24502(대비 4.5)', '시트 point-text #c44002(흰 바탕 5.15 · 연한 바탕 4.62 · v10.55)'),
    ('plaza.css', ' *   배지 — 소개 후기 #FEF3E0/#F78013 ·', ' *   배지 — 소개 후기 #FEF3E0/#a83701(v10.55 · 전 #F78013 대비 2.37) ·'),
    ('plaza.css', '.plz-bd-review { background-color: #FEF3E0; color: #F78013; }', '.plz-bd-review { background-color: #FEF3E0; color: #a83701; }   /* v10.55 대비 2.37 → 5.95 */'),
    ('plaza.css', '.plz-bd-food   { background-color: #E8F6EE; color: #13804A; }', '.plz-bd-food   { background-color: #E8F6EE; color: #0e6e32; }'),
    ('food.css', '.fd-badge.pick { background: #E8F6EE; color: #13804A; }', '.fd-badge.pick { background: #E8F6EE; color: #0e6e32; }   /* v10.55 대비 4.5 이상 */'),
    ('food.css', '.fd-badge.ad { background: #FFF3E0; color: #C25E00; }', '.fd-badge.ad { background: #FFF3E0; color: #a83701; }'),
    # 소개몰 — 흐린 글자 → 시트 흐린 글자 · 바닥 꼬리표
    ('shop.css', '.shop-lowc .was { margin-top: 8px; font-size: 16.5px; letter-spacing: -.5px; color: #A4A9B3; white-space: nowrap; }',
     '.shop-lowc .was { margin-top: 8px; font-size: 16.5px; letter-spacing: -.5px; color: var(--sgb-ink-3); white-space: nowrap; }'),
    ('shop.css', 'letter-spacing: -.6px; color: #9A9FAA;', 'letter-spacing: -.6px; color: var(--sgb-ink-3);'),
    ('shop.css', '.shop-dealc .pr s { margin-left: 6px; font-size: 17px; color: #9A9FAA; }', '.shop-dealc .pr s { margin-left: 6px; font-size: 17px; color: var(--sgb-ink-3); }'),
    ('shop.css', '#EEF0F3 10px 20px); color: #9A9FAA;', '#EEF0F3 10px 20px); color: var(--sgb-ink-2);'),
    ('shop.css', '.shop-newc .spec { display: block; font-size: 12px; color: #888; margin-top: 2px; }', '.shop-newc .spec { display: block; font-size: 12px; color: var(--sgb-ink-3); margin-top: 2px; }'),
    ('shop.css', 'background: #e9f7ee; color: #12883e;', 'background: #e9f7ee; color: #117f3a;'),
    # 소개장터 메인 — 주황 꼬리표(소개광장 「후기」 배지와 같은 2.37) → 소개장터 관 글자색
    ('money.css', '.mny-tag.is-orange { background: #fef3e0; color: #f78013; }', '.mny-tag.is-orange { background: #fef3e0; color: #ad5800; }   /* v10.55 대비 2.37 → 4.58 */'),
    # 두 관 · 소개장터 머리줄 — 알림 숫자 바탕(흰 글자 3.93 → 5.02)
    ('b2.css', 'background: #ff1022; color: #fff; font-size: 11.5px;', 'background: #e0001b; color: #fff; font-size: 11.5px;'),
    ('money.css', 'background: #ff1022; color: #fff; font-size: 11.5px;', 'background: #e0001b; color: #fff; font-size: 11.5px;'),
]


def apply(path, pairs):
    s = open(path, encoding='utf-8').read()
    n0 = 0
    for o, n in pairs:
        if n in s or o not in s:
            continue
        assert s.count(o) == 1, (path, o)
        s = s.replace(o, n); n0 += 1
    open(path, 'w', encoding='utf-8').write(s)
    return n0


done = {}
for f in sorted({p[0] for p in PAIRS}):
    done[f] = apply(os.path.join(CORE, ST, f), [(o, n) for g, o, n in PAIRS if g == f])
pr = apply(os.path.join(CORE, 'spec/proto.html'), [(o, n) for g, o, n in PAIRS])
print('실제 웹', done, '· 시안', pr)
