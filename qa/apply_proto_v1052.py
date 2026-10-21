"""v10.52 — 디자인 통일 1단계를 시안(spec/proto.html)에도 (2026-10-21 대표 「현재는 디자인 기준 시안도 변경」 · docs/105)

  python3 -I apply_proto_v1052.py <sgb-core 폴더>      — 다시 돌려도 같은 결과(이미 들어가 있으면 건너뜀)

  ① 디자인 시트 블록 — 실제 웹 site/src/styles/sgb-tokens.css 를 글자 그대로(v10.30 과 같은 방식)
  ② 옛 이름 → 시트 값 — 실제 웹 tokens.css 와 같은 별칭. 시안은 이름이 조금 다릅니다(--ink2 · --ink3 · --line2).
     · 화면 칸(#screen)에 data-sgb 가 붙은 화면에만 — 시안의 왼쪽 화면 목록 · 바탕 · 소개몰 오버레이는 그대로
     · 색은 **밝은 화면에서만** 바꿉니다. 디자인 시트에는 어두운 값이 없어 어두운 화면은 지금 값 그대로
     · 글꼴(본문 나눔스퀘어 네오 · 제목 페이퍼로지)은 두 화면 모두
     · 모서리는 시안에 토큰이 없어(숫자로 적힘) 3단계(단계 줄이기)에서
  ③ 관 표시 — 화면을 그리는 paint() 가 주소의 관(/g/mny · /g/mal · /g/biz 또는 서브도메인)을 보고 data-sgb-gwan
     · 묶어 둔 화면(실제 웹과 같음): 메인 히어로(main1 · main2) · 소개장터 메인(list) · 소개광장(cmu …) · 소개몰(SB-HLT) · 운영 화면(SB-ADM — 실제 운영 화면 web/ 은 범위 밖)
  ④ B2B → P2P 문구(머리 설명 · 공유 제목 · 메인 제목 · 설명)
"""
import os, re, sys

CORE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../sgb-core')
P = os.path.join(CORE, 'spec/proto.html')
TOK = os.path.join(CORE, 'site/src/styles/sgb-tokens.css')
s = open(P, encoding='utf-8').read()
tok = open(TOK, encoding='utf-8').read().strip()
done = []

# ① 디자인 시트 블록
a = s.find('/**\n * 소개뱅크 공통 디자인 토큰')
b = s.find('[data-sgb-gwan="plaza"]', a)
b = s.find('\n', b)
assert a > 0 and b > a, '디자인 시트 블록을 찾지 못했습니다'
if s[a:b] != tok:
    s = s[:a] + tok + s[b:]; done.append('① 디자인 시트 블록')

# ② 별칭
MARK = '/* ═══ v10.52 (2026-10-21) 디자인 통일 1단계'
COL = ('--pp: var(--sgb-point-text); --pp-d: var(--sgb-point-d); --pp-l: var(--sgb-point-l); --pp-l2: var(--sgb-point-l2);\n'
       '      --ink: var(--sgb-ink); --ink2: var(--sgb-ink-2); --ink3: var(--sgb-ink-3); --line: var(--sgb-line); --line2: var(--sgb-line-soft);\n'
       '      --bg: var(--sgb-bg); --bl: var(--sgb-link); --bl-d: var(--sgb-link-d); --bl-l: var(--sgb-link-l);\n'
       '      --sh: var(--sgb-shadow); --sh2: var(--sgb-shadow-up);')
ALIAS = f"""
  {MARK} — 디자인 시트가 하나뿐인 기준(실제 웹 tokens.css 와 같은 별칭) ═══
     data-sgb 가 붙은 화면 칸에서만 · 색은 밝은 화면만(시트에 어두운 값 없음) · 글꼴은 두 화면 모두. 붙이는 곳은 paint()(qa/apply_proto_v1052.py) */
  @media (prefers-color-scheme: light) {{ :root:not([data-theme="dark"]) #screen[data-sgb] {{
      {COL} }} }}
  :root[data-theme="light"] #screen[data-sgb] {{
      {COL} }}
  #screen[data-sgb] {{ --f: var(--sgb-font-body); font-family: var(--sgb-font-body); }}
  :where(#screen[data-sgb]) :where(h1, h2, h3) {{ font-family: var(--sgb-font-title); }}
"""
if MARK not in s:
    anchor = '\n  *{box-sizing:border-box}\n  html,body{margin:0;padding:0}'
    assert s.count(anchor) == 1, '별칭 자리를 찾지 못했습니다'
    s = s.replace(anchor, ALIAS + anchor); done.append('② 별칭')

# ③ 관 표시
ids = dict(re.findall(r'["\']?(\w+)["\']?\s*:\s*\{\s*["\']?id["\']?\s*:\s*["\'](SB-[^"\']+)["\']', s))
keep = sorted({'main1', 'main2', 'list', 'cmu', 'cmud', 'cmuw', 'cmupoll', 'commu'} |
              {k for k, v in ids.items() if v.startswith(('SB-ADM-', 'SB-HLT-'))})
PMARK = '/* v10.52 디자인 통일 — 화면 칸에 디자인 시트 표시'
PAINT = ('  el.innerHTML = R[key] ? R[key]() : "";\n'
         f'  {PMARK}(qa/apply_proto_v1052.py) · 묶어 둔 화면은 빼고 · 관은 주소로(실제 웹 Chrome.tsx 와 같은 규칙) */\n'
         '  try{\n'
         '    var SGB_KEEP = ' + '{' + ','.join(f'"{k}":1' for k in keep) + '};\n'
         '    if (SGB_KEEP[key]) { el.removeAttribute("data-sgb"); el.removeAttribute("data-sgb-gwan"); }\n'
         '    else {\n'
         '      el.setAttribute("data-sgb", "");\n'
         '      var sgbH = (location.hostname || "").toLowerCase(), sgbP = (location.hash || "").replace(/^#/, "");\n'
         '      var sgbM = sgbH.match(/^(mny|mal|biz)\\./) || sgbP.match(/^\\/g\\/(mny|mal|biz)(\\/|$)/);\n'
         '      var sgbG = sgbM ? { mny: "money", mal: "mall", biz: "biz" }[sgbM[1]] : "";\n'
         '      if (sgbG) el.setAttribute("data-sgb-gwan", sgbG); else el.removeAttribute("data-sgb-gwan");\n'
         '    }\n'
         '  }catch(_){}\n')
if PMARK not in s:
    old = '  el.innerHTML = R[key] ? R[key]() : "";\n'
    assert s.count(old) == 1, 'paint() 자리를 찾지 못했습니다'
    s = s.replace(old, PAINT); done.append(f'③ 관 표시(묶어 둔 화면 {len(keep)}개)')

# ④ P2P 문구(10/13 결정 · 10/21 대표 「P2P 로 수정」) — 머리 설명 · 공유 제목 · 메인 주소의 제목 · 설명
P2P = '개인 · 사업자 누구나 거래처 · 매물 · 창업 자리를 소개하고 소개비를 받는 P2P 소개 플랫폼입니다.'
for o, n in [('사업자끼리 거래처 · 매물 · 창업 자리를 소개하고 소개비를 받는 B2B 플랫폼입니다.', P2P),
             ('소개뱅크 — 사업자끼리 소개하고 소개비를 받습니다', '소개뱅크 — 누구나 소개하고 소개비를 받습니다')]:
    if o in s:
        s = s.replace(o, n); done.append('④ P2P 문구')

open(P, 'w', encoding='utf-8').write(s)
print('바꿈:', ' · '.join(done) if done else '없음(이미 들어가 있음)')
