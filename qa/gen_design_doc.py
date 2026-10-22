"""디자인 기준 문서(sgb-docs/design/디자인기준.md)를 기준 파일에서 만듭니다. 다시 돌려도 같은 결과입니다(날짜 · 커밋은 인자로).

  python3 -I gen_design_doc.py <sgb-core 폴더> <sgb-docs 폴더>

  값은 손으로 옮겨 적지 않습니다 — site/src/styles/sgb-tokens.css · sgb-buttons.css 에서 읽고, 대비는 여기서 계산합니다.
  기준 파일 값이 바뀌면 이 스크립트를 다시 돌려 문서를 맞춥니다(돌린 뒤 git diff 가 비어 있으면 문서와 기준 파일이 같음).
"""
import os, re, sys

CORE, DOCS = sys.argv[1], sys.argv[2]
T = open(os.path.join(CORE, 'site/src/styles/sgb-tokens.css'), encoding='utf-8').read()
B = open(os.path.join(CORE, 'site/src/styles/sgb-buttons.css'), encoding='utf-8').read()
VER = open(os.path.join(CORE, 'VERSION'), encoding='utf-8').read().strip()
root = T[T.index(':root {'):T.index('\n}', T.index(':root {'))]
V = dict(re.findall(r'--sgb-([\w-]+):\s*([^;]+);', root))
BV = dict(re.findall(r'--sgb-([\w-]+):\s*([^;]+);', B))
GW = {g: dict(re.findall(r'--sgb-([\w-]+):\s*([^;]+);', body)) for g, body in re.findall(r'\[data-sgb-gwan="(\w+)"\]\s*\{([^}]*)\}', T)}


def res(v, d=V, depth=0):
    m = re.fullmatch(r'var\(--sgb-([\w-]+)\)', v.strip())
    return res(d.get(m.group(1), V.get(m.group(1), v)), d, depth + 1) if m and depth < 5 else v.strip()


def L(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= .03928 else ((x + .055) / 1.055) ** 2.4 for x in c]
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]


cr = lambda a, b: (max(L(a), L(b)) + .05) / (min(L(a), L(b)) + .05)
f2 = lambda x: f'{x:.2f}'
out = []
w = out.append
w(f'# 소개뱅크 디자인 기준 ({VER})\n')
w('> 이 문서는 `sgb-infra/qa/gen_design_doc.py` 가 기준 파일(`sgb-core/site/src/styles/sgb-tokens.css` · `sgb-buttons.css`)에서 만듭니다. **손으로 고치지 마십시오** — 값을 바꾸려면 기준 파일을 고치고 스크립트를 다시 돌립니다.')
w('> 결정 기록: `decisions/design-standard.md`(#1 ~ #15) · 원본 시트: `design/SGB_DesignGuide_v1.html`(2026-10-09 「소개뱅크 전체 페이지 공통 디자인 가이드」)\n')
w('## 0. 원칙\n')
w('1. **디자인 값(색 · 글자 · 모서리 · 그림자 · 화면 폭 · 단추)은 디자인 시트가 기준**입니다. 화면 구성 · 기능 · 문구는 시안이 기준입니다(project-rules 2절).')
w('2. 새 CSS · 화면 코드는 **숫자를 직접 쓰지 않고 아래 이름(`var(--sgb-…)`)** 을 씁니다. 옛 이름(시안 토큰 `--ink` · `--accent` …)은 이 값을 가리키는 별칭으로만 남아 있습니다.')
w('3. **글자와 바탕의 대비는 4.5 이상**(웹 접근성 기준). 흰 바탕 · 화면 바탕 · 관 연한 바탕 모두에서 봅니다.')
w('4. 그림 부품(상품 · 분야 그림 · 날씨 아이콘) · 로고 · 지도 · 아이콘 선 · 막대는 이 기준 밖입니다(#14 ③).')
w('5. 실제 웹과 시안(`spec/proto.html`)은 **같은 고침 스크립트**로 함께 고칩니다. 시안 안 시트 사본은 `sgb-tokens.css` 와 글자 그대로 같아야 합니다.\n')

w('## 1. 색\n')
w('### 1-1. 브랜드 · 글자 · 바탕\n')
w('| 이름 | 값 | 흰 바탕 대비 | 쓰는 곳 |')
w('|---|---|---|---|')
USE = {'navy': '브랜드 남색 · 제목 · 주요 단추(공통)', 'orange': '브랜드 주황', 'ink': '본문 글자', 'ink-2': '설명 글자', 'ink-3': '흐린 글자(유일한 회색 글자)',
       'ph': '입력 칸 안내 글자(글자로 쓰지 않음)', 'sys': '테두리 · 시스템(글자로 쓰지 않음)', 'bg': '화면 바탕', 'line': '카드 · 탭 테두리', 'line-soft': '알약 단추 테두리',
       'accent': '강조 주황(제목 강조 · 검색 단추 · 별)', 'action': '실행 단추 주황', 'link': '파란 줄 단추 · 링크', 'link-d': '링크 누름', 'alert': '건수 강조(점 · 바탕)',
       'cream': '옅은 주황 바탕', 'tile': '분야 칸 바탕'}
for k, u in USE.items():
    h = res(V[k]); w(f'| `--sgb-{k}` | `{h}` | {f2(cr(h, "#ffffff"))} | {u} |')
w('\n### 1-2. 상태 색 (글자용 진한 값)\n')
w('| 이름 | 값 | 흰 바탕 | 화면 바탕 | 쓰는 곳 |')
w('|---|---|---|---|---|')
for k, u in (('or-text', '주의 · 대기'), ('gr-text', '완료 · 증가'), ('rd-text', '오류 · 반려')):
    h = res(V[k]); w(f'| `--sgb-{k}` | `{h}` | {f2(cr(h, "#ffffff"))} | {f2(cr(h, res(V["bg"])))} | {u} 글자 · 흰 글자 꼬리표 바탕 |')
w('\n점 · 막대 · 연한 바탕은 밝은 상태 색 그대로 둡니다(#14 ②).\n')
w('### 1-3. 관 색\n')
w('화면 맨 바깥 요소에 `data-sgb-gwan="…"` 가 붙으면 아래 값으로 바뀝니다(`components/Chrome.tsx`). 관 글자색은 흰 바탕과 관 연한 바탕 **둘 다** 4.5 이상(#10).\n')
w('| 관 | data-sgb-gwan | point(바탕용) | on-point(그 위 글자) | 대비 | point-text(글자) | 흰 바탕 | 연한 바탕 |')
w('|---|---|---|---|---|---|---|---|')
NAME = {'money': '소개장터', 'mall': '안심소개', 'biz': '소개창업', 'shop': '소개몰', 'plaza': '소개광장'}
for g, nm in NAME.items():
    d = dict(V, **GW[g]); p, op, pt, pl = (res(d[k], d) for k in ('point', 'on-point', 'point-text', 'point-l'))
    w(f'| {nm} | `{g}` | `{p}` | `{op}` | {f2(cr(p, op))} | `{pt}` | {f2(cr(pt, "#ffffff"))} | {f2(cr(pt, pl))} |')
p, op, pt, pl = (res(V[k]) for k in ('point', 'on-point', 'point-text', 'point-l'))
w(f'| 공통(관 없음) | — | `{p}` | `{op}` | {f2(cr(p, op))} | `{pt}` | {f2(cr(pt, "#ffffff"))} | {f2(cr(pt, pl))} |')
w('\n주황 · 초록 관(소개장터 · 소개몰 · 소개광장)은 흰 글자가 읽히지 않아(2.0 ~ 3.3) 바탕 위 글자가 **남색**입니다(#4).\n')

w('## 2. 글자\n')
w(f'- 제목 글꼴: {V["font-title"].split(",")[0]} · 본문 글꼴: {V["font-body"].split(",")[0]} (사이트 전체 · #3)')
w('- 크기는 **8단계**만 씁니다. 12px 아래는 알림 숫자(11px)만, 30px 위 큰 제목은 그대로(#12).\n')
w('| 이름 | 크기 | 쓰는 곳 |')
w('|---|---|---|')
for k, u in (('fs-title-1', '큰 제목(ExtraBold 800)'), ('fs-title-2', '제목 2'), ('fs-money', '금액'), ('fs-title-3', '제목 3 · 카드 제목'),
             ('fs-body-1', '본문 1'), ('fs-body-2', '본문 2 · 단추'), ('fs-cap', '설명 · 작은 단추'), ('fs-micro', '꼬리표 · 각주(가장 작은 글자)')):
    w(f'| `--sgb-{k}` | {V[k]} | {u} |')
w(f'\n굵기: 제목 `--sgb-fw-title` {V["fw-title"]} · 굵게 `--sgb-fw-bold` {V["fw-bold"]} · 보통 `--sgb-fw-regular` {V["fw-regular"]}\n')

w('## 3. 모서리 · 그림자 · 여백\n')
w('| 이름 | 값 | 쓰는 곳 |')
w('|---|---|---|')
for k, u in (('r-sm', '작게 — 단추 · 꼬리표 · 입력 칸'), ('r-md', '기본 — 카드'), ('r-lg', '크게 — 배너 · 큰 칸'), ('r-pill', '알약 — 칩 · 탭 · 검색 단추'),
             ('shadow', '바닥에 붙은 카드'), ('shadow-up', '떠 있는 것(팝업 · 메뉴 · 고른 카드)'), ('gap-x', '가로 여백'), ('gap-y', '세로 여백')):
    w(f'| `--sgb-{k}` | `{V[k]}` | {u} |')
w('\n선 · 점 · 막대 끝(4px 이하)은 모서리 단계 밖입니다.\n')

w('## 4. 화면 폭\n')
w('CSS 변수는 `@media` 안에 쓸 수 없어 **숫자로 씁니다.** 새 CSS 는 아래 세 값만 씁니다(#13 · 넓은 PC 예외 7곳은 그대로).\n')
w('| 이름 | 값 | 뜻 |')
w('|---|---|---|')
for k, u in (('bp-phone', '휴대전화'), ('bp-tablet', '태블릿 · 좁은 PC'), ('bp-desk', '넓은 PC(본문 최대 폭)')):
    w(f'| `--sgb-{k}` | {V[k]} | {u} |')

w('\n## 5. 단추 3종\n')
w(f'모양은 하나 — 높이 {BV["btn-h"]} · 모서리 `{BV["btn-r"]}` · {BV["btn-fs"]} 굵게, 작은 단추 {BV["btn-h-sm"]} · {BV["btn-fs-sm"]}. **색만 관을 따릅니다**(#13 · `sgb-buttons.css`).\n')
w('| 종류 | 이름(새 화면) | 바탕 | 글자 | 테두리 |')
w('|---|---|---|---|---|')
w(f'| 주요 | `sgb-btn sgb-btn--pri` | `{BV["btn-bg"]}` | `{BV["btn-fg"]}` | 바탕과 같음 |')
w(f'| 보조 | `sgb-btn sgb-btn--sec` | `{BV["btn2-bg"]}` | `{BV["btn2-fg"]}` | `{BV["btn2-line"]}` |')
w(f'| 줄 | `sgb-btn sgb-btn--line` | `{BV["btn3-bg"]}` | `{BV["btn3-fg"]}` | 글자와 같음 |')
w('\n작게: `sgb-btn--sm` 을 더함. 옛 꾸밈 이름(.pri · .ghost · .p2primary · .sm · .lg)과 상태(.on · .off · .danger · :disabled)는 구분해서 고칩니다. 칩 · 탭 · 검색 단추는 알약, 메인 동그란 검색 단추 · 소개장터 검색칸은 그대로입니다.\n')

w('## 6. 고칠 때 순서 · 시험\n')
w('1. feature/ 갈래 → 고침 스크립트(`sgb-infra/qa/apply_*_v10xx.py`, 실제 웹과 시안을 같이 · **두 번 돌려 같은 결과**)')
w('2. 정적 시험 `python3 -I sgb-infra/qa/test_v10xx.py` (KIT=…)')
w('3. 시안 글자색은 화면에서 실제 바탕을 재서 확인 — `measure_proto_v1066.py`(Playwright 도커 이미지)')
w('4. `~/sgb-check.sh 갈래` realcheck → 통과한 것만 PR(summary.txt 첨부) → 병합 뒤 화면 확인')
w('5. 새 kit 에서 다시 맞출 때 고침 스크립트 순서: main_v1056 → shape_v1057 → font_v1058(1 · 2 · 3) → bp_v1061 → btn_v1062 → text_v1063 → tsx_v1064 → proto_v1066\n')
w('## 7. 범위 밖 · 남은 것\n')
w('- 운영 화면(`web/` · admin) — 이 기준을 아직 적용하지 않음(따로 정할 일)')
w('- Tailwind — 보류(2026-10-22 · `decisions/tailwind-adoption.md`)')
w('- 메인 새 그림(10/4) 반영 — `decisions/main-hero-design.md` 미정 #1')
os.makedirs(os.path.join(DOCS, 'design'), exist_ok=True)
p = os.path.join(DOCS, 'design/디자인기준.md'); s = '\n'.join(out) + '\n'
old = open(p, encoding='utf-8').read() if os.path.exists(p) else None
if s != old: open(p, 'w', encoding='utf-8').write(s)
print('디자인기준.md', '바뀜' if s != old else '그대로', len(s), '자')
