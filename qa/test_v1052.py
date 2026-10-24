"""v10.52 시험 — 디자인 통일 1단계(2026-10-21 결정 · docs/105)

  KIT=… python3 -I test_v1052.py

  ① 기준 — 옛 이름(tokens.css)이 디자인 시트(sgb-tokens.css)를 가리킴 · 금액 · 경고 · 광고 색은 그대로
  ② 관 색 — 관 5개마다 point · on-point · point-text · point-d · point-l · l2 · 글자 대비(WCAG) 4.5 이상
  ③ 묶어 둔 화면 — 메인 · 소개광장 · 소개몰 · 소개장터 메인 · 생활금융 상담은 바뀐 옛 이름을 모두 전 값으로
  ④ 글꼴 · 관 표시 — 본문 · 제목 글꼴 · Chrome.tsx 주소 → 관 · 일반 화면에만
  ⑤ 시안 — 디자인 시트 블록이 실제 웹과 글자 그대로 · 별칭(밝은 화면만) · paint() 관 표시 · 묶어 둔 화면 · P2P 설명
  ⑥ 기록 — VERSION · docs/105
"""
import os, re

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
ST = 'site/src/styles/'
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


def lum(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def cr(a, b):
    x, y = sorted([lum(a), lum(b)], reverse=True)
    return (x + 0.05) / (y + 0.05)


TK, SG, PC, SC = rd(ST + 'tokens.css'), rd(ST + 'sgb-tokens.css'), rd(ST + 'proto-common.css'), rd(ST + 'site.css')
root = dict(re.findall(r'(--sgb-[\w-]+):\s*([^;]+);', SG[:SG.find('[data-sgb-gwan=')]))
val = lambda v: root.get(v[4:-1], v) if v.startswith('var(') else v

# ① 기준
alias = TK[TK.find('2026-10-21 디자인 통일 1단계'):]
want = {'--ink': '--sgb-ink', '--ink-2': '--sgb-ink-2', '--ink-3': '--sgb-ink-3', '--line': '--sgb-line', '--line-2': '--sgb-line-soft',
        '--surface': '--sgb-bg', '--bg': '--sgb-bg', '--accent': '--sgb-link', '--bl': '--sgb-link', '--r-sm': '--sgb-r-sm', '--r-md': '--sgb-r-sm',
        '--r-lg': '--sgb-r-md', '--r-xl': '--sgb-r-md', '--fs-xl': '--sgb-fs-title-2', '--f': '--sgb-font-body', '--pp': '--sgb-point-text'}
miss = [k for k, v in want.items() if not re.search(rf'{re.escape(k)}:\s*var\({re.escape(v)}\);', alias)]
ok('옛 이름 16개가 디자인 시트를 가리킴', not miss, str(miss))
ok('--pp 계열은 :root 와 main[data-sgb-gwan] 에서 풀림(관마다 색)', ':root, main[data-sgb-gwan] {' in alias, '')
kept = [k for k in ('--money', '--danger', '--ad', '--or', '--g400', '--sp-4') if re.search(rf'\n\s*{k}:\s*var\(--sgb', alias)]
ok('금액 · 경고 · 광고 · 주황 · 회색 · 간격은 그대로', not kept, str(kept))
ok('흐린 글자 #6b7694(v10.63 부터 #646f8c) — 흰 바탕 대비 4.5 이상', root.get('--sgb-ink-3') in ('#6b7694', '#646f8c') and cr('#6b7694', '#ffffff') >= 4.5, f"{cr('#6b7694', '#ffffff'):.2f}")
ok('시트 글자 단계 8개(30 · 24 · 20 · 18 · 16 · 14 · 13 · 12)', sorted({int(root[k][:-2]) for k in root if re.match(r'--sgb-fs-', k)}) == [12, 13, 14, 16, 18, 20, 24, 30], '')

# ② 관 색
GW = {'money': '#ffa03e', 'mall': '#0f766e', 'biz': '#6d28d9', 'shop': '#16a34a', 'plaza': '#fd580a'}
bad = []
for g, base in GW.items():
    m = re.search(rf'\[data-sgb-gwan="{g}"\]\s*\{{([^}}]+)\}}', SG)
    if not m:
        bad.append(f'{g}:없음'); continue
    d = {k: val(v.strip()) for k, v in re.findall(r'(--sgb-[\w-]+):\s*([^;]+);', m.group(1))}
    if not all(k in d for k in ('--sgb-point', '--sgb-on-point', '--sgb-point-text', '--sgb-point-d', '--sgb-point-l', '--sgb-point-l2')):
        bad.append(f'{g}:칸 빠짐'); continue
    pt = d['--sgb-point'].lower()
    if pt != base: bad.append(f'{g}:시트색 {pt}')
    if cr(pt, d['--sgb-on-point']) < 4.5: bad.append(f'{g}:단추 글자 {cr(pt, d["--sgb-on-point"]):.2f}')
    if cr(d['--sgb-point-text'], '#ffffff') < 4.5: bad.append(f'{g}:흰 바탕 글자 {cr(d["--sgb-point-text"], "#ffffff"):.2f}')
    if cr(d['--sgb-point-d'], '#ffffff') < cr(d['--sgb-point-text'], '#ffffff'): bad.append(f'{g}:진한 칸이 더 옅음')
ok('관 5개 — 시트 색 그대로 · 단추 글자 · 흰 바탕 글자 대비 4.5 이상 · 진한 칸이 더 진함', not bad, str(bad))
ok('주황 · 초록 관(소개장터 · 소개몰 · 소개광장)은 남색 단추 글자(결정 ③)',
   all(re.search(rf'\[data-sgb-gwan="{g}"\][^}}]*--sgb-on-point: var\(--sgb-navy\)', SG) for g in ('money', 'shop', 'plaza')), '')

# ③ 묶어 둔 화면
B2 = re.match(r'v10\.(5[4-9]|[6-9]\d)', rd('VERSION').strip()) is not None    # v10.54 2단계 B 에서 묶음을 풂 — 아래 넷은 test_v1054 가 봄
bind = PC[PC.find('.main-home, .main-b2, .b2-hd, .b2-ft, .mal.mal-narrow {'):]
bind = bind[:bind.find('}')]
lost = [k for k in want if k not in ('--fs-xl',) and not re.search(rf'(?<![\w-]){re.escape(k)}:\s*[^v;][^;]*;', bind)]
ok('묶어 둔 화면은 바뀐 옛 이름 모두 전 값', B2 or not lost, str(lost))
ok('묶어 둔 화면은 제목 글꼴 막음 · 생활금융 상담은 전 본문 글꼴', B2 or ':where(.main-home, .main-b2, .b2-hd, .b2-ft, .mal.mal-narrow) :where(h1, h2, h3) { font-family: inherit; }' in PC and '.main-home, .mal.mal-narrow { font-family: var(--f); }' in PC, '')

# ④ 글꼴 · 관 표시
ok('제목 h1 ~ h3 은 시트 제목 글꼴(:where · 점수 0)', ':where(h1, h2, h3) { font-family: var(--sgb-font-title); }' in SC, '')
FN = rd(ST + 'money-fonts.css')
ok('글꼴 파일 5개 선언 그대로', len(re.findall(r'@font-face', FN)) == 5 and all(os.path.exists(os.path.join(K, 'site/public/fonts', f)) for f in ('NanumSquareNeo.woff2', 'Paperlogy-7Bold.woff2')), '')
CH = rd('site/src/components/Chrome.tsx')
pairs = dict(re.findall(r"\['(/\w+)', '(\w+)'\]", CH[CH.find('const SGB_GWAN'):CH.find('export const sgbGwanOf')]))
ok('주소 → 관 6개(소개장터 · 안심소개 둘 · 소개창업 · 소개몰 · 소개광장)', pairs == {'/money': 'money', '/mall': 'mall', '/mal': 'mall', '/biz': 'biz', '/health': 'shop', '/community': 'plaza'}, str(pairs))
ok('관 표시는 일반 화면(base)에만', B2 or "data-sgb-gwan={s === 'base' ? sgbGwanOf(p) : undefined}" in CH, '')
ok('Chrome.tsx — sgbGwanOf 앞에 정의 · usePathname 그대로', CH.find('export const sgbGwanOf') < CH.find('export function MainWrap') and "import { usePathname } from 'next/navigation';" in CH, '')

# ⑤ 시안
PR = rd('spec/proto.html')
ok('시안 디자인 시트 블록 = 실제 웹 sgb-tokens.css 글자 그대로', SG.strip() and SG.strip() in PR, '')
al = PR[PR.find('v10.52 (2026-10-21) 디자인 통일 1단계'):PR.find('*{box-sizing:border-box}')]
ok('시안 별칭 — 밝은 화면에만(어두운 화면 그대로)', '@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) #screen[data-sgb] {' in al and ':root[data-theme="light"] #screen[data-sgb] {' in al
   and al.count('--pp: var(--sgb-point-text);') == 2 and al.count('--ink3: var(--sgb-ink-3);') == 2, '')
ok('시안 글꼴 — 본문 · 제목(두 화면 모두)', '#screen[data-sgb] { --f: var(--sgb-font-body); font-family: var(--sgb-font-body); }' in al and ':where(#screen[data-sgb]) :where(h1, h2, h3) { font-family: var(--sgb-font-title); }' in al, '')
pm = PR[PR.find('v10.52 디자인 통일 — 화면 칸에 디자인 시트 표시'):]
pm = pm[:pm.find('}catch(_){}')]
km = re.search(r'var SGB_KEEP = \{([^}]*)\}', pm)
keep = set(re.findall(r'"(\w+)":1', km.group(1))) if km else set()
ok('시안 묶어 둔 화면 — 메인 히어로 · 소개장터 메인 · 소개광장 · 운영 화면', B2 or {'main1', 'main2', 'list', 'cmu', 'commu', 'adm'} <= keep, f'{len(keep)}개')
ok('시안 관 화면은 묶지 않음(안심소개 · 소개창업 · 상세 · 로그인 · 나의공간)', not ({'listl', 'listb', 'detail', 'login', 'my', 'win'} & keep), '')
ok('시안 주소 → 관(mny · mal · biz)', '{ mny: "money", mal: "mall", biz: "biz" }' in pm and 'el.setAttribute("data-sgb", "");' in pm, '')
ok('시안 · 실제 웹 설명 P2P(B2B 아님)', '<meta name="description" content="개인 · 사업자 누구나 거래처 · 매물 · 창업 자리를 소개하고 소개비를 받는 P2P 소개 플랫폼입니다.">' in PR and 'B2B 플랫폼' not in PR and '사업자끼리 소개하고' not in PR and 'P2P 소개 플랫폼' in (rd('site/src/app/layout.tsx') + rd('site/src/i18n/messages/ko.json')) and "B2B 소개 플랫폼'" not in rd('site/src/app/layout.tsx'), '')   # v10.95 — 설명은 사전(ko.json)

# ⑥ 기록
ok('VERSION v10.52 이상', re.match(r'v10\.(5[2-9]|[6-9]\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
doc = rd('docs/105_디자인통일_1단계_v10.52_20261021.md')
ok('작업 문서 docs/105', all(h in doc for h in ('## 1. 결론', '## 3. 바뀐 파일', '## 5. 집 PC 확인', '## 6. 운영 적용')), '')
ok('DB 변경 없음(마이그레이션 142 그대로 · v10.65 D105 부터 143 — test_v1065 · v10.69 D106 부터 144 — test_v1069)', len([d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d))]) in (142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154), '')   # v10.95 — v10.89(151)부터 빠져 있던 것 더함

n_ok = sum(1 for r in RES if r[0])
print(f'통과 {n_ok} / {len(RES)}')
raise SystemExit(0 if n_ok == len(RES) else 1)
