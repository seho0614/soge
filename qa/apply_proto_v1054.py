"""v10.54 — 디자인 통일 2단계 B 를 시안(spec/proto.html)에도 (2026-10-21 · docs/107)

  python3 -I apply_proto_v1054.py <sgb-core 폴더>      — 다시 돌려도 같은 결과(이미 들어가 있으면 건너뜀)

  ① 시안에 글자 그대로 들어 있는 실제 웹 CSS(b2 · plaza · shop · money)에 실제 웹과 같은 고침을 그대로
     · 실제 웹에서 고친 줄 묶음(전 → 후)을 아래 PAIRS 에 담았습니다. 시안에 없는 줄(.plz .cmu-opt — 실제 웹에만 있는 v10.31 부품)은 건너뜀
     · 시안에만 있는 .plz 글꼴 줄(Pretendard)도 시트 본문 글꼴로
  ② 묶어 둔 화면 풀기 — SGB_KEEP 에는 메인 히어로(main1 · main2)와 운영 화면(SB-ADM)만 남김(10/21 대표 「메인은 이번엔 빼기」)
  ③ 관 표시 — 소개광장(cmu · cmud · cmuw · cmupoll · commu) → plaza · 소개몰(SB-HLT-*) → shop · 소개장터 메인(list) → money
     (실제 웹 Chrome.tsx 와 같은 규칙 · 주소의 관(/g/mny · /g/mal · /g/biz)이 있으면 그것이 먼저)
"""
import json, os, re, sys

CORE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../sgb-core')
P = os.path.join(CORE, 'spec/proto.html')
s = open(P, encoding='utf-8').read()
done, skip = [], []

# ① CSS — [파일, 전, 후] (실제 웹 site/src/styles 의 v10.53 → v10.54 차이)
PAIRS = json.loads(r"""
[
 [
  "b2.css",
  ".b2-hd, .b2-ft, .main-b2 {\n  --b2-navy: #00245A; --b2-orange: #F5A008; --b2-ink: #000; --b2-dim: #838CA5; --b2-line: #DBDBDB; --b2-w: 1380px;\n",
  "/* 2026-10-21 디자인 통일 2단계 B(docs/107) — 디자인 시트 값 이름으로. 남색 · 주황 · 글자 · 줄은 시트와 같은 값, 흐린 글자는 #838CA5 → 시트 #6b7694(대비 4.5) · 글꼴은 나눔스퀘어 네오 */\n.b2-hd, .b2-ft, .main-b2 {\n  --b2-navy: #00245A; --b2-orange: #F5A008; --b2-ink: #000; --b2-dim: #838CA5; --b2-line: #DBDBDB; --b2-w: 1380px;\n"
 ],
 [
  "b2.css",
  "  --b2-navy: #00245A; --b2-orange: #F5A008; --b2-ink: #000; --b2-dim: #838CA5; --b2-line: #DBDBDB; --b2-w: 1380px;\n  font-family: Pretendard, \"Noto Sans KR\", \"Noto Sans CJK KR\", \"Apple SD Gothic Neo\", \"Malgun Gothic\", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;\n",
  "  --b2-navy: var(--sgb-navy); --b2-orange: var(--sgb-accent); --b2-ink: var(--sgb-ink); --b2-dim: var(--sgb-ink-3); --b2-line: var(--sgb-line); --b2-w: 1380px;\n  font-family: var(--sgb-font-body);\n"
 ],
 [
  "plaza.css",
  " * 글꼴은 그림만으로 이름을 알 수 없어 지금 글꼴(Pretendard → 없으면 기기 글꼴)에 굵기 · 크기만 맞췄습니다.\n",
  " * 글꼴은 그림만으로 이름을 알 수 없어 굵기 · 크기만 맞췄습니다. 2026-10-21 2단계 B 부터 글꼴은 디자인 시트(나눔스퀘어 네오 · 제목 페이퍼로지).\n"
 ],
 [
  "plaza.css",
  ".plz {\n  --plz-navy: #00245A; --plz-orange: #F5A008; --plz-line: #DBDBDB; --plz-dim: #838CA5;\n",
  "/* 2026-10-21 디자인 통일 2단계 B(docs/107 · 대표 「시트 관 색」) — 제목은 브랜드 남색 그대로, 탭 · 단추 · 링크 · 강조는 소개광장 관 색으로.\n *   --plz-pt  흰 바탕 위 글자 · 테두리 · 흰 글자 단추 바탕 = 시트 point-text #d24502(대비 4.5)\n *   --plz-orange  큰 단추(글쓰기) · 고른 쪽 번호 바탕 = 시트 소개광장 색 #fd580a · 그 위 글자는 남색(--sgb-on-point · 10/21 결정 ③)\n *   흐린 글자 #838CA5 → 시트 #6b7694 · 분류 배지 색은 그대로 */\n.plz {\n  --plz-navy: #00245A; --plz-orange: #F5A008; --plz-line: #DBDBDB; --plz-dim: #838CA5;\n"
 ],
 [
  "plaza.css",
  "  --plz-navy: #00245A; --plz-orange: #F5A008; --plz-line: #DBDBDB; --plz-dim: #838CA5;\n  /* 이 화면 안에서는 공용 부품(.btn-primary · .notice · 투표 카드)의 강조색도 남색으로 — 부품을 따로 만들지 않고 색만 바꿉니다 */\n  --accent: #00245A; --accent-w: #EEF2F8; --line: #DBDBDB;\n  background: #fff; color: #000;\n",
  "  --plz-navy: var(--sgb-navy); --plz-pt: var(--sgb-point-text); --plz-orange: var(--sgb-point); --plz-line: var(--sgb-line); --plz-dim: var(--sgb-ink-3);\n  /* 이 화면 안에서는 공용 부품(.btn-primary · .notice · 투표 카드)의 강조색도 관 색으로 — 부품을 따로 만들지 않고 색만 바꿉니다 */\n  --accent: var(--sgb-point-text); --accent-w: var(--sgb-point-l); --line: var(--sgb-line);\n  background: #fff; color: var(--sgb-ink);\n"
 ],
 [
  "plaza.css",
  ".plz-find:focus-within { box-shadow: 0 0 0 2px var(--plz-navy); }\n.plz-find button { flex: none; width: 48px; height: 48px; border-radius: 50%; border: 0; background: var(--plz-navy); color: #fff; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }\n",
  ".plz-find:focus-within { box-shadow: 0 0 0 2px var(--plz-pt); }\n.plz-find button { flex: none; width: 48px; height: 48px; border-radius: 50%; border: 0; background: var(--plz-pt); color: #fff; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }\n"
 ],
 [
  "plaza.css",
  ".plz-body .page-head a { color: var(--plz-navy); }\n",
  ".plz-body .page-head a { color: var(--plz-pt); }\n"
 ],
 [
  "plaza.css",
  "  border: 1px solid var(--plz-line); border-radius: 10px; background-color: #fff; color: var(--plz-navy); font-size: 18px; font-weight: 800; letter-spacing: -.4px; text-decoration: none; white-space: nowrap; }\n.plz-tabs a:hover { border-color: var(--plz-navy); }\n.plz-tabs a[aria-current=page] { background-color: var(--plz-navy); border-color: var(--plz-navy); color: #fff; }\n",
  "  border: 1px solid var(--plz-line); border-radius: 10px; background-color: #fff; color: var(--plz-pt); font-size: 18px; font-weight: 800; letter-spacing: -.4px; text-decoration: none; white-space: nowrap; }\n.plz-tabs a:hover { border-color: var(--plz-pt); }\n.plz-tabs a[aria-current=page] { background-color: var(--plz-pt); border-color: var(--plz-pt); color: #fff; }\n"
 ],
 [
  "plaza.css",
  ".plz-found b { color: var(--plz-navy); }\n.plz-found a, .plz-empty a, .plz-err a { color: var(--plz-navy); text-decoration: underline; margin-left: 8px; }\n",
  ".plz-found b { color: var(--plz-pt); }\n.plz-found a, .plz-empty a, .plz-err a { color: var(--plz-pt); text-decoration: underline; margin-left: 8px; }\n"
 ],
 [
  "plaza.css",
  ".plz-tbl td a { color: #000; text-decoration: none; }\n.plz-tbl td a:hover { color: var(--plz-navy); text-decoration: underline; }\n",
  ".plz-tbl td a { color: var(--sgb-ink); text-decoration: none; }\n.plz-tbl td a:hover { color: var(--plz-pt); text-decoration: underline; }\n"
 ],
 [
  "plaza.css",
  ".plz-pin { display: inline-block; margin-right: 8px; padding: 1px 8px; border-radius: 4px; background: var(--plz-navy); color: #fff; font-size: 12.5px; font-weight: 700; vertical-align: 2px; }\n.plz-cc { margin-left: 6px; color: var(--plz-orange); font-size: 15px; font-weight: 700; }\n",
  ".plz-pin { display: inline-block; margin-right: 8px; padding: 1px 8px; border-radius: 4px; background: var(--plz-pt); color: #fff; font-size: 12.5px; font-weight: 700; vertical-align: 2px; }\n.plz-cc { margin-left: 6px; color: var(--plz-pt); font-size: 15px; font-weight: 700; }\n"
 ],
 [
  "plaza.css",
  ".plz-pager a:hover { border-color: var(--plz-navy); }\n.plz-pager [aria-current=page] { background-color: var(--plz-orange); border-color: var(--plz-orange); font-weight: 600; }\n",
  ".plz-pager a:hover { border-color: var(--plz-pt); }\n.plz-pager [aria-current=page] { background-color: var(--plz-orange); border-color: var(--plz-orange); color: var(--sgb-on-point); font-weight: 600; }\n"
 ],
 [
  "plaza.css",
  ".plz-write { position: absolute; right: 0; top: 0; width: 184px; height: 52px; display: inline-flex; align-items: center; justify-content: center; border-radius: 10px; background-color: var(--plz-orange); color: #fff; font-size: 22px; font-weight: 800; letter-spacing: -.5px; text-decoration: none; }\n",
  ".plz-write { position: absolute; right: 0; top: 0; width: 184px; height: 52px; display: inline-flex; align-items: center; justify-content: center; border-radius: 10px; background-color: var(--plz-orange); color: var(--sgb-on-point); font-size: 22px; font-weight: 800; letter-spacing: -.5px; text-decoration: none; }\n"
 ],
 [
  "plaza.css",
  ".plz-back { display: inline-flex; align-items: center; justify-content: center; height: 44px; padding: 0 26px; border: 1px solid var(--plz-navy); border-radius: 10px; color: var(--plz-navy); font-size: 17px; font-weight: 800; text-decoration: none; background: #fff; }\n",
  ".plz-back { display: inline-flex; align-items: center; justify-content: center; height: 44px; padding: 0 26px; border: 1px solid var(--plz-pt); border-radius: 10px; color: var(--plz-pt); font-size: 17px; font-weight: 800; text-decoration: none; background: #fff; }\n"
 ],
 [
  "plaza.css",
  ".plz .btn-sm.p2primary { background: var(--plz-navy); border-color: var(--plz-navy); color: #fff; }\n.plz form.cmu-editor .btn-sm.p2primary { background: var(--plz-orange); border-color: var(--plz-orange); font-weight: 800; padding: 8px 26px; font-size: 16px; }\n.plz .cmu-boards .opt.on { border-color: var(--plz-navy); }\n.plz .btn-primary { background: var(--plz-navy); border-color: var(--plz-navy); }\n",
  ".plz .btn-sm.p2primary { background: var(--plz-pt); border-color: var(--plz-pt); color: #fff; }\n.plz form.cmu-editor .btn-sm.p2primary { background: var(--plz-orange); border-color: var(--plz-orange); color: var(--sgb-on-point); font-weight: 800; padding: 8px 26px; font-size: 16px; }\n.plz .cmu-boards .opt.on { border-color: var(--plz-pt); }\n.plz .btn-primary { background: var(--plz-pt); border-color: var(--plz-pt); }\n"
 ],
 [
  "plaza.css",
  ".plz .cmu-opt.on { border-color: var(--plz-navy); background: #EEF2F8; color: var(--plz-navy); }\n",
  ".plz .cmu-opt.on { border-color: var(--plz-pt); background: var(--sgb-point-l); color: var(--plz-pt); }\n"
 ],
 [
  "shop.css",
  ".shop, .shop-sub {\n  --shop-navy: #00245A; --shop-green: #17A34A; --shop-orange: #F5A008; --shop-red: #E5362F; --shop-dim: #8A8F9C; --shop-ink: #111;\n",
  "/* 2026-10-21 디자인 통일 2단계 B(docs/107) — 디자인 시트 값 이름으로. 초록은 소개몰 관 색(<main data-sgb-gwan=\"shop\">)의 글자 · 단추용 #12883e(흰 글자 대비 4.5 이상) ·\n * 흐린 글자 #8A8F9C → 시트 #6b7694 · 글꼴은 나눔스퀘어 네오. 할인 빨강 · 구역 바탕(크림 · 회색) · 사진 띠의 밝은 초록 #22C55E(어두운 바탕 위)는 그대로 */\n.shop, .shop-sub {\n  --shop-navy: #00245A; --shop-green: #17A34A; --shop-orange: #F5A008; --shop-red: #E5362F; --shop-dim: #8A8F9C; --shop-ink: #111;\n"
 ],
 [
  "shop.css",
  "  --shop-navy: #00245A; --shop-green: #17A34A; --shop-orange: #F5A008; --shop-red: #E5362F; --shop-dim: #8A8F9C; --shop-ink: #111;\n  font-family: Pretendard, \"Noto Sans KR\", \"Noto Sans CJK KR\", \"Apple SD Gothic Neo\", \"Malgun Gothic\", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;\n",
  "  --shop-navy: var(--sgb-navy); --shop-green: var(--sgb-point-text); --shop-orange: var(--sgb-accent); --shop-red: #E5362F; --shop-dim: var(--sgb-ink-3); --shop-ink: var(--sgb-ink);\n  font-family: var(--sgb-font-body);\n"
 ],
 [
  "shop.css",
  ".shop-tile .ini { width: 44px; height: 44px; border-radius: 50%; background: #EAF6EE; color: var(--shop-green); display: inline-flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 900; }\n",
  ".shop-tile .ini { width: 44px; height: 44px; border-radius: 50%; background: var(--sgb-point-l); color: var(--shop-green); display: inline-flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 900; }\n"
 ],
 [
  "shop.css",
  ".shop-prodc .bdg { padding: 1px 8px; border-radius: 5px; background: #EAF6EE; color: var(--shop-green); font-weight: 800; font-size: 12.5px; }\n",
  ".shop-prodc .bdg { padding: 1px 8px; border-radius: 5px; background: var(--sgb-point-l); color: var(--shop-green); font-weight: 800; font-size: 12.5px; }\n"
 ],
 [
  "shop.css",
  "  --accent: #17A34A; --accent-w: #EAF6EE; }\n",
  "  --accent: var(--sgb-point-text); --accent-w: var(--sgb-point-l); }\n"
 ],
 [
  "shop.css",
  ".b2-ntag { display: inline-block; margin-right: 6px; padding: 1px 8px; border-radius: 5px; background: #EAF6EE; color: #17A34A; font-size: 12px; font-weight: 800; letter-spacing: -.2px; white-space: nowrap; vertical-align: 1px; }\n",
  ".b2-ntag { display: inline-block; margin-right: 6px; padding: 1px 8px; border-radius: 5px; background: #e9f7ee; color: #12883e; font-size: 12px; font-weight: 800; letter-spacing: -.2px; white-space: nowrap; vertical-align: 1px; }\n"
 ],
 [
  "shop.css",
  "\n/* 두 관 전용 머리줄 — 소개몰에서는 그림대로 「무료 회원가입」이 초록입니다(소개광장은 주황 그대로) */\n",
  "/* 2026-10-21 2단계 B — 바닥줄은 <main> 밖이라 관 표시가 닿지 않아, 시트의 소개몰 값(point-l · point-text)을 글자로 적었습니다 */\n\n/* 두 관 전용 머리줄 — 소개몰에서는 그림대로 「무료 회원가입」이 초록입니다(소개광장은 주황 그대로) */\n"
 ],
 [
  "shop.css",
  "[data-b2-tone=shop] .b2-join { background: #17A34A; }\n",
  "[data-b2-tone=shop] .b2-join { background: var(--sgb-point-text); }   /* 머리줄의 B2Tone 에 data-sgb-gwan=\"shop\" (Chrome.tsx) */\n"
 ],
 [
  "money.css",
  "[data-b2-tone=money] .b2-hd { --b2-orange: #ffa03e; font-family: var(--sgb-font-body); }\n",
  "[data-b2-tone=money] .b2-hd { --b2-orange: var(--sgb-orange); font-family: var(--sgb-font-body); }\n"
 ],
 [
  "money.css",
  ".mny-old-b { margin-top: 16px; font-family: Pretendard, \"Noto Sans KR\", \"Noto Sans CJK KR\", \"Apple SD Gothic Neo\", \"Malgun Gothic\", -apple-system, BlinkMacSystemFont, system-ui, sans-serif; font-weight: 400; }\n",
  ".mny-old-b { margin-top: 16px; font-family: var(--sgb-font-body); font-weight: 400; }\n"
 ]
]
""")
for f, o, n in PAIRS:
    if n in s:
        continue                                   # 이미 고침(고친 글이 전 글을 품는 묶음도 두 번 넣지 않게)
    c = s.count(o)
    if c == 0:
        if n.splitlines()[0] not in s:             # 고친 첫 줄이 이미 있으면 들어가 있는 것
            skip.append(f + ' ' + o.strip().splitlines()[0][:40])
        continue
    assert c == 1, f'{f}: 같은 줄이 {c}곳 — {o[:60]!r}'
    s = s.replace(o, n); done.append(f)
FONT = '.plz { font-family: Pretendard, "Noto Sans KR", "Noto Sans CJK KR", "Apple SD Gothic Neo", "Malgun Gothic", -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }'
if FONT in s:
    s = s.replace(FONT, '.plz { font-family: var(--sgb-font-body); }   /* 2026-10-21 2단계 B — 시트 본문 글꼴 */'); done.append('시안 .plz 글꼴')

# ② · ③ paint()
ids = dict(re.findall(r'["\']?(\w+)["\']?\s*:\s*\{\s*["\']?id["\']?\s*:\s*["\'](SB-[^"\']+)["\']', s))
keep = sorted({'main1', 'main2'} | {k for k, v in ids.items() if v.startswith('SB-ADM-')})
gw = {k: 'plaza' for k in ('cmu', 'cmud', 'cmuw', 'cmupoll', 'commu')}
gw.update({k: 'shop' for k, v in ids.items() if v.startswith('SB-HLT-')})
gw['list'] = 'money'
m = re.search(r'    var SGB_KEEP = \{[^}]*\};\n', s)
assert m, 'SGB_KEEP 를 찾지 못했습니다(apply_proto_v1052.py 를 먼저)'
KEEP = '    var SGB_KEEP = {' + ','.join(f'"{k}":1' for k in keep) + '};\n'
GW = '    var SGB_G = {' + ','.join(f'"{k}":"{v}"' for k, v in sorted(gw.items())) + '};   /* v10.54 2단계 B — 두 관 · 소개장터 메인의 관 */\n'
if 'var SGB_G = ' not in s:
    s = s[:m.start()] + KEEP + GW + s[m.end():]; done.append(f'② 묶음 풀기(남은 화면 {len(keep)}개) · ③ 관 표시 {len(gw)}개')
    old = '      var sgbG = sgbM ? { mny: "money", mal: "mall", biz: "biz" }[sgbM[1]] : "";\n'
    assert s.count(old) == 1, '관 표시 줄을 찾지 못했습니다'
    s = s.replace(old, '      var sgbG = sgbM ? { mny: "money", mal: "mall", biz: "biz" }[sgbM[1]] : (SGB_G[key] || "");\n')

open(P, 'w', encoding='utf-8').write(s)
print('바꿈:', ' · '.join(done) if done else '없음(이미 들어가 있음)')
if skip: print('시안에 없어 건너뜀:', ' · '.join(skip))
