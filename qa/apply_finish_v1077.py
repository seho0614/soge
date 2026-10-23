"""v10.77 — 디자인 마무리 2가지(다시 돌려도 같은 결과)

  python3 -I apply_finish_v1077.py <sgb-core>

  ① 파트너센터 상단바(어두운 초록 #0E2A23) 글자 — 밝은 바탕용 흐린 글자(#646f8c · 대비 3.05) · 초록 글자(#047857 · 2.79)가
     그대로 쓰여 잘 안 보임 → 어두운 바탕 전용 #A7C4BA(8.19) · 「파트너」는 로고 점과 같은 #6EE7B7(10.03).
     실제 웹 site/src/styles/proto-partner.css 와 시안 spec/proto.html(.phd) 를 같은 값으로. 운영 화면 상단바가 #AEB6C2 를 따로 쓰는 것과 같은 방식.
     시안 운영 화면 상단바(.ahd) 로고 · 메뉴도 흐린 글자(남색 위 2.9)로 남아 있어 실제 운영 화면과 같은 메뉴 #AEB6C2(7.34) · 로고 #EDEFF3 로.
  ② 운영 화면 입력 칸 · 고르기 칸 · 글 칸 · 꾸밈 없는 단추 — 브라우저 기본값(13.33px · 시스템 글꼴)이 남은 곳(잰 결과 10곳은 모두 꾸밈 없는 단추)이 본문 글자(14px · 나눔스퀘어 네오)를 따르게.
     따로 크기를 정한 칸(.tbl input 등)은 그대로 — 요소 선택자라 점수가 가장 낮습니다.
"""
import os, sys

CORE = sys.argv[1]
ON_DARK, ON_DARK_PT = '#A7C4BA', '#6EE7B7'
ON_NAVY, ON_NAVY_LOGO = '#AEB6C2', '#EDEFF3'   # 운영 화면 상단바(남색) 메뉴 · 로고 글자 — 실제 운영 화면 .ad-gnb · .ad-lg 와 같은 값
EDITS = {
    'site/src/styles/proto-partner.css': [
        ("  color: var(--sgb-ink-3) !important; text-decoration: none; white-space: nowrap; }\n.pt-plg b { color: var(--sgb-gr-text); font-weight: 900; }",
         f"  color: {ON_DARK} !important; text-decoration: none; white-space: nowrap; }}\n.pt-plg b {{ color: {ON_DARK_PT}; font-weight: 900; }}"),
        (".pt-gnb a { font-size: 13px; font-weight: 700; color: var(--sgb-ink-3) !important;",
         f".pt-gnb a {{ font-size: 13px; font-weight: 700; color: {ON_DARK} !important;"),
        (".pt-phr .pt-ls { color: var(--sgb-ink-3); }",
         f".pt-phr .pt-ls {{ color: {ON_DARK}; }}"),
        ("/* ── 전용 상단바 (시안 .phd) — 사용자 · 운영과 눈으로 구분되게 초록 계열 ── */",
         "/* ── 전용 상단바 (시안 .phd) — 사용자 · 운영과 눈으로 구분되게 초록 계열 ──\n"
         f" * v10.77 — 어두운 바탕이라 글자는 어두운 바탕 전용 {ON_DARK}(대비 8.19) · 「파트너」 {ON_DARK_PT}(10.03). 시트의 흐린 글자 · 초록 글자는 밝은 바탕용 */"),
    ],
    'spec/proto.html': [
        ("  color:var(--sgb-ink-3);text-decoration:none;white-space:nowrap}\n.phd .plg b{color:var(--sgb-gr-text);font-weight:900}",
         f"  color:{ON_DARK};text-decoration:none;white-space:nowrap}}\n.phd .plg b{{color:{ON_DARK_PT};font-weight:900}}"),
        (".phd .pgnb a{font-size:13px;font-weight:700;color:var(--sgb-ink-3);",
         f".phd .pgnb a{{font-size:13px;font-weight:700;color:{ON_DARK};"),
        (".phd .phr .ls{color:var(--sgb-ink-3)}", f".phd .phr .ls{{color:{ON_DARK}}}"),
        (".phd .rsw button{color:var(--sgb-ink-3)}", f".phd .rsw button{{color:{ON_DARK}}}"),
        # 시안 운영 화면 상단바(.ahd · 남색) 로고 · 메뉴 — 실제 운영 화면(.ad-lg · .ad-gnb)은 v10.67 에서 #AEB6C2(7.34) · 시안만 흐린 글자(2.9)로 남음
        ("  color:var(--sgb-ink-3);text-decoration:none;white-space:nowrap}\n.ahd .", f"  color:{ON_NAVY_LOGO};text-decoration:none;white-space:nowrap}}\n.ahd ."),
        (".ahd .agnb a{font-size:13px;font-weight:700;color:var(--sgb-ink-3);", f".ahd .agnb a{{font-size:13px;font-weight:700;color:{ON_NAVY};"),
    ],
    'web/src/styles/tokens.css': [
        ("body {\n  margin: 0;\n  font-family: var(--f);\n  font-size: var(--fs-md);",
         "/* v10.77 — 입력 칸 · 고르기 칸 · 글 칸 · 꾸밈 없는 단추가 브라우저 기본값(13.33px · 시스템 글꼴) 대신 본문 글자(14px = 단추 시트 --sgb-btn-fs)를 따릅니다(따로 정한 칸은 그대로) */\n"
         "input, select, textarea, button { font: inherit; }\n\n"
         "body {\n  margin: 0;\n  font-family: var(--f);\n  font-size: var(--fs-md);"),
    ],
}
for rel, pairs in EDITS.items():
    p = os.path.join(CORE, rel); s = open(p, encoding='utf-8').read(); o = s
    for old, new in pairs:
        if new in s:
            continue                         # 이미 고침
        assert s.count(old) == 1, f'{rel}: {old[:50]!r} ({s.count(old)})'
        s = s.replace(old, new)
    if s != o:
        open(p, 'w', encoding='utf-8').write(s)
    print(('고침 ' if s != o else '그대로 ') + rel)
