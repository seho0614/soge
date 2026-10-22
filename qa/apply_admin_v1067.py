"""v10.67 — 운영 화면(web/) 디자인 기준 ① 기준 파일 · 글꼴 · 색 · 상단바 · 대비(docs/123). 다시 돌려도 같은 결과입니다.

  python3 -I apply_admin_v1067.py <sgb-core 폴더>

  10/22 대표 「추천대로」 — A안(값만 시트로 · 배치 그대로) · 주색 보라 → 남색 · 본문 나눔스퀘어 네오(숫자 IBM Plex Mono 그대로)
  ① web/src/styles/sgb-tokens.css = site/src/styles/sgb-tokens.css 글자 그대로(사본)
  ② 글꼴 — site/public/fonts 의 woff2 5개 · LICENSE → web/src/assets/fonts(Vite 가 /assets/ 로 묶음 · Nginx 그대로) · admin-fonts.css
  ③ tokens.css 옛 이름 → 시트 값(별칭) — 보라 → 남색 · 회색 글자 #6B7280 → #646f8c · 화면 바탕 #E9EAEE → #f5f7fa · 경고 · 광고 · 금액 → 상태 글자색
  ④ 상단바 — 남색 바탕 · 고른 메뉴 주황 + 남색 글자 · 「운영」 주황 · 흐린 글자 #AEB6C2(남색 위 7.5) — 실제 운영 화면과 시안(.ahd) 같이
  ⑤ 직접 적은 글자색 · 흰 글자 바탕 → 시트 상태 색 · 상태 연한 바탕 · 막대는 그대로(#14 ②)
"""
import os, shutil, sys

CORE = sys.argv[1] if len(sys.argv) > 1 else '.'
W = os.path.join(CORE, 'web/src')
n = 0


def edit(rel, pairs, base=W):
    global n
    p = os.path.join(base, rel); s0 = open(p, encoding='utf-8').read(); s = s0
    for o, nw in pairs:
        if nw in s: continue          # 이미 고침(새 문장이 옛 문장을 품는 경우도 있어 새 문장으로만 봄)
        c = s.count(o); assert c >= 1, (rel, o)
        s = s.replace(o, nw); n += c
    if s != s0: open(p, 'w', encoding='utf-8').write(s)


def put(p, data):
    old = open(p, 'rb').read() if os.path.exists(p) else None
    if old != data: open(p, 'wb').write(data)


# ① 기준 파일 사본
put(os.path.join(W, 'styles/sgb-tokens.css'), open(os.path.join(CORE, 'site/src/styles/sgb-tokens.css'), 'rb').read())
# ② 글꼴
FD = os.path.join(W, 'assets/fonts'); os.makedirs(FD, exist_ok=True)
FONTS = [('Paperlogy', 500, 'Paperlogy-5Medium'), ('Paperlogy', 700, 'Paperlogy-7Bold'),
         ('Nanum Square Neo', 400, 'NanumSquareNeo'), ('Nanum Square Neo', 700, 'NanumSquareNeoB'), ('Nanum Square Neo', 800, 'NanumSquareNeoEB')]
for _, _, f in FONTS:
    put(os.path.join(FD, f + '.woff2'), open(os.path.join(CORE, 'site/public/fonts', f + '.woff2'), 'rb').read())
put(os.path.join(FD, 'LICENSE.txt'), open(os.path.join(CORE, 'site/public/fonts/LICENSE.txt'), 'rb').read())
css = ('/**\n * 운영 화면 글꼴 — 디자인 시트(2026-10-09) 02. 폰트: 제목 페이퍼로지 · 본문 나눔스퀘어 네오. v10.67(docs/123)\n'
       ' * · 파일은 사용자 웹(site/public/fonts)과 같은 것 — Vite 가 /assets/ 로 묶습니다(Nginx 의 /assets/ 7일 캐시 · 설정 그대로)\n'
       ' * · 숫자 · 코드는 지금처럼 --m(IBM Plex Mono) — 금액 자릿수 비교용\n'
       ' * · 사용 조건: SIL Open Font License 1.1 — assets/fonts/LICENSE.txt\n */\n'
       + ''.join(f"@font-face {{ font-family: '{fam}'; font-weight: {w}; font-style: normal; font-display: swap; src: url('../assets/fonts/{f}.woff2') format('woff2'); }}\n" for fam, w, f in FONTS))
put(os.path.join(W, 'styles/admin-fonts.css'), css.encode('utf-8'))
edit('main.tsx', [("import './styles/tokens.css';", "import './styles/sgb-tokens.css';   // v10.67 — 디자인 시트(사용자 웹과 같은 파일)\nimport './styles/admin-fonts.css';\nimport './styles/tokens.css';")])

# ③ tokens.css — 이름은 그대로, 값만 시트로
edit('styles/tokens.css', [
    (" * 이름(--accent · --money · --danger …)은 그대로 두고 값만 바꿉니다 — 화면 코드가 이름으로 씁니다.",
     " * 이름(--accent · --money · --danger …)은 그대로 두고 값만 바꿉니다 — 화면 코드가 이름으로 씁니다.\n"
     " * v10.67(docs/123) — 값의 기준은 디자인 시트(sgb-tokens.css · 사용자 웹과 같은 파일). 옛 이름은 시트 값을 가리키는 별칭입니다.\n"
     " *   보라 → 브랜드 남색 · 상단바 남색 + 고른 메뉴 주황 · 글자 · 줄 · 화면 바탕 시트 값 · 경고 · 광고 · 금액은 시트 상태 글자색"),
    ("  --pp:   #7C3AED; --pp-d: #6D28D9; --pp-l: #F5F1FE; --pp-l2: #EDE7FC;",
     "  --pp:   var(--sgb-navy); --pp-d: var(--sgb-point-d); --pp-l: var(--sgb-point-l); --pp-l2: var(--sgb-point-l2);"),
    ("  --bl:   #2563EB; --bl-l: #EFF6FF;", "  --bl:   var(--sgb-link); --bl-l: var(--sgb-link-l);"),
    ("--g500: #6B7280; --g700: #374151;", "--g500: var(--sgb-ink-3); --g700: var(--sgb-ink-2);"),
    ("  --shell: #E9EAEE;", "  --shell: var(--sgb-bg);"),
    ("  --ahd:   #14171C;      /* 운영 상단바 */", "  --ahd:   var(--sgb-navy);     /* 운영 상단바 — v10.67 남색 */"),
    ("  --ahd-on: #4F46E5;     /* 상단바에서 고른 메뉴 */", "  --ahd-on: var(--sgb-orange); /* 상단바에서 고른 메뉴 — v10.67 주황(글자 남색 · 7.39) */"),
    ("  --ink:      #111827;", "  --ink:      var(--sgb-ink);"),
    ("  --ink-2:    #4B5563;", "  --ink-2:    var(--sgb-ink-2);"),
    ("  --ink-3:    #6B7280;", "  --ink-3:    var(--sgb-ink-3);"),
    ("  --line:     #E5E7EB;", "  --line:     var(--sgb-line);"),
    ("  --money:    #0F6B4A;", "  --money:    var(--sgb-gr-text);"),
    ("  --danger:   #B42318;", "  --danger:   var(--sgb-rd-text);"),
    ("  --ad:       #9A5B00;", "  --ad:       var(--sgb-or-text);"),
    ("  --r-sm: 7px;  --r-md: 11px;", "  --r-sm: var(--sgb-r-sm);  --r-md: var(--sgb-r-md);"),
    ('  --f: "Noto Sans KR", Pretendard,', '  --f: var(--sgb-font-body);   /* v10.67 — 전: "Noto Sans KR", Pretendard,'),
    ('"Malgun Gothic", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;\n  --m:',
     '"Malgun Gothic", -apple-system, BlinkMacSystemFont, system-ui, sans-serif */\n  --m:'),
    ("  -webkit-font-smoothing: antialiased;\n  word-break: keep-all;\n}",
     "  -webkit-font-smoothing: antialiased;\n  word-break: keep-all;\n}\n/* v10.67 — 제목은 시트 제목 글꼴(페이퍼로지) */\nh1, h2, h3 { font-family: var(--sgb-font-title); }"),
])

# ④ ⑤ app.css
edit('styles/app.css', [
    (".ad-lg b { color: #A5B4FC; font-weight: 900; }", ".ad-lg b { color: var(--sgb-orange); font-weight: 900; }"),
    (".ad-gnb button:hover { background: #252B34; color: #fff; }", ".ad-gnb button:hover { background: var(--sgb-point-d); color: #fff; }"),
    (".ad-gnb button.on { background: var(--ahd-on); color: #fff; }", ".ad-gnb button.on { background: var(--ahd-on); color: var(--sgb-navy); }"),
    (".ad-role { font-size: 12px; color: #79828F;", ".ad-role { font-size: 12px; color: #AEB6C2;"),
    ("border: 1px solid #39414D; background: transparent;", "border: 1px solid rgba(255, 255, 255, .32); background: transparent;"),
    (".ad-btn:hover { border-color: #A5B4FC; color: #A5B4FC; }", ".ad-btn:hover { border-color: var(--sgb-orange); color: var(--sgb-orange); }"),
    (".st.ok{color:#15803D}", ".st.ok{color:var(--sgb-gr-text)}"),
    (".st.no{color:#B91C1C}", ".st.no{color:var(--sgb-rd-text)}"),
    (".badge-verified { background: #ECFDF5; color: #0F6B4F;", ".badge-verified { background: #ECFDF5; color: var(--sgb-gr-text);"),
    ("background: #ECFDF5; border: 1px solid #A7F3D0; color: #0F6B4F; }", "background: #ECFDF5; border: 1px solid #A7F3D0; color: var(--sgb-gr-text); }"),
    (".ad-chip.ok { background: #ECFDF5; border-color: #A7F3D0; color: #0F6B4F; }", ".ad-chip.ok { background: #ECFDF5; border-color: #A7F3D0; color: var(--sgb-gr-text); }"),
    (".ad-bg.ok { background: #ECFDF5; color: #0F6B4F;", ".ad-bg.ok { background: #ECFDF5; color: var(--sgb-gr-text);"),
    (".ad-bg.no { background: #FEF2F2; color: #B42318;", ".ad-bg.no { background: #FEF2F2; color: var(--sgb-rd-text);"),
    (".ad-bg.wait { background: #FFFBEB; color: #9A5B00;", ".ad-bg.wait { background: #FFFBEB; color: var(--sgb-or-text);"),
    (".ad-bg.hi { background: #12B76A; color: #fff; border-color: #12B76A; }", ".ad-bg.hi { background: var(--sgb-gr-text); color: #fff; border-color: var(--sgb-gr-text); }"),
    (".ad-rc.warn > b { color: var(--ad, #9A5B00); }", ".ad-rc.warn > b { color: var(--ad); }"),
    (".ad-nsteps > li.on { border-color: var(--pp); background: #EEF0FD; }", ".ad-nsteps > li.on { border-color: var(--pp); background: var(--sgb-point-l); }"),
    (".ad-nsteps > li.done .n { background: #ECFDF5; color: #0F6B4F; }", ".ad-nsteps > li.done .n { background: #ECFDF5; color: var(--sgb-gr-text); }"),
    (".ad-kc4 .kv.ok { color: #059669; }", ".ad-kc4 .kv.ok { color: var(--sgb-gr-text); }"),
])
# ⑤ 화면 코드
for rel in ('app/admin/AdBilling.tsx', 'app/admin/Events.tsx', 'app/admin/Collect.tsx', 'app/admin/ReportQueue.tsx'):
    edit(rel, [("color: '#B42318'", "color: 'var(--sgb-rd-text)'")])
edit('app/admin/HealthProducts.tsx', [("background: '#eef2f7'", "background: 'var(--sgb-bg)'")])

# ④ 시안 운영 화면 상단바(.ahd) — 파트너센터 머리줄(.phd)은 그대로
edit('spec/proto.html', [
    (".ahd{background:#14171C;color:#EDEFF3;", ".ahd{background:var(--sgb-navy);color:#EDEFF3;"),
    (".ahd .agnb a.on{background:#4F46E5;color:#fff}", ".ahd .agnb a.on{background:var(--sgb-orange);color:var(--sgb-navy)}"),
    (".ahd .agnb a:hover{background:#252B34;color:#fff}", ".ahd .agnb a:hover{background:#001a42;color:#fff}"),
    (".ahd .alg b{color:var(--sgb-link-d);font-weight:900}", ".ahd .alg b{color:var(--sgb-orange);font-weight:900}"),
    (".ahd .ahr .ls{color:var(--sgb-ink-3)}", ".ahd .ahr .ls{color:#AEB6C2}"),
    (".ahd .rsw button,.phd .rsw button{color:var(--sgb-ink-3)}", ".phd .rsw button{color:var(--sgb-ink-3)}.ahd .rsw button{color:#AEB6C2}"),
    (".ahd .rsw button.on,.phd .rsw button.on{background:#4F46E5;color:#fff}", ".phd .rsw button.on{background:#4F46E5;color:#fff}.ahd .rsw button.on{background:var(--sgb-orange);color:var(--sgb-navy)}"),
    (".ahd .rsw,.phd .rsw{background:transparent;border-color:#39414D}", ".phd .rsw{background:transparent;border-color:#39414D}.ahd .rsw{background:transparent;border-color:rgba(255,255,255,.32)}"),
], base=CORE)
print('바꾼 곳', n)
