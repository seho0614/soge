"""시안(spec/proto.html)의 메인에 「hero 페이지」 디자인(v10.13)을 넣습니다 — 여러 번 돌려도 같은 결과입니다.

  python3 apply_proto_main.py            (먼저 python3 crop_design.py 로 그림을 잘라 두십시오)

넣는 것
  1. <style id="mhx-style">  실제 웹의 site/src/styles/home.css 그대로 + 시안에서만 필요한 몇 줄
  2. 메인 코드(proto_main_src.js) — 그림은 주신 디자인에서 잘라 낸 site/public/home/d/*.png (crop_design.py), 크기 표는 Icons.tsx 의 PIC
  3. scMain1 · scMain2 가 새 메인(mainPageX)을 그리게 함 — 예전 메인은 MH_USE_V2 로 되돌릴 수 있게 남김
다른 화면의 코드는 건드리지 않습니다.
"""
import base64, json, os, re, sys

# 킷 안(qa/)에서 돌리면 옆의 sgb/ 를 씁니다. 다른 곳이면 KIT=<sgb 경로>
_kit = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sgb')
K = os.environ.get('KIT') or (_kit if os.path.isdir(os.path.join(_kit, 'spec')) else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
HERE = os.path.dirname(os.path.abspath(__file__))
P = os.path.join(K, 'spec/proto.html')
s = open(P, encoding='utf-8').read()
n0 = len(s)

# ── 0. 전에 넣은 것 걷어내기 ──
s = re.sub(r'<style id="mhx-style">.*?</style>\n?', '', s, flags=re.S)
s = re.sub(r'  /\*MHX:BEGIN\*/.*?/\*MHX:END\*/\n', '', s, flags=re.S)
s = re.sub(r'    /\*MHX:SC\*/[^\n]*\n', '', s)

# ── 1. 스타일 ──
css = open(os.path.join(K, 'site/src/styles/home.css'), encoding='utf-8').read()
css = re.sub(r'/\* 메인만 본문 틀을 넓힙니다.*?\n\.main\.main-home \{[^}]*\}\n', '', css, flags=re.S)
assert '.main-home' not in css
PROTO_ONLY = '''
/* ── 시안에서만 필요한 것 ─────────────────────────────────────────────── */
.home { position: relative; }
.home-hd { position: relative; }                               /* 시안의 #screen 은 가로 넘침을 자르므로(overflow-x) 붙어 있는 머리(sticky)를 쓰지 않습니다 */
.home-hd .gnb { display: flex; flex: 0 1 auto; gap: 28px; min-width: 0; overflow: visible; white-space: nowrap; }
.home-hd .gnb a { font-size: 15px; font-weight: 600; color: #3C4658; }
.home-hd .gnb a:hover { color: var(--hv); }
.home-user { font-size: 14px; color: var(--hk2); white-space: nowrap; }
button.home-pill, button.home-icbtn, button.home-chip, button.home-snsi, button.home-pnext, button.home-railnext { cursor: pointer; font-family: inherit; }
button.home-pill { border: 1px solid var(--hline); background: #fff; color: var(--hk); }
button.home-pill.p { background: var(--hv); color: #fff; border-color: var(--hv); }
button.home-icbtn { border: 0; background: #F1F2F8; color: var(--hk); }
button.home-chip { border: 0; background: #fff; color: var(--hk); }
button.home-snsi { border: 0; background: none; padding: 0; }
.home-sbin input.si { width: 100%; border: 0; outline: 0; background: transparent; font: inherit; font-size: 15px; color: var(--hk); padding: 2px 0; }
.home .home-sb .sug { top: calc(100% + 6px); left: 20px; right: 20px; text-align: left; }
.home-sb { position: relative; }
/* HERO 광고(__AD.heroSlot)를 안내 카드 안에 맞춥니다 — 「광고」 표시는 카드 위 꼬리표가 합니다 */
.home-padw .adhero { position: static; display: block; background: none !important; color: var(--hk); padding: 0; margin: 16px 0 0; min-height: 0; height: auto; max-height: none; border-radius: 0; box-shadow: none; overflow: visible; }
.home-padw .adhero .adlab, .home-padw .adhero .adpic, .home-padw .adhero .adpg, .home-padw .adhero [data-adpg] { display: none !important; }
.home-padw .adhero .adin { display: block; padding: 0 !important; }
.home-padw .adhero .adadv { display: block; font-size: 13px; font-weight: 700; color: var(--hk3); background: none; padding: 0; }
.home-padw .adhero h3 { margin: 8px 0 8px; font-size: 21px; line-height: 1.36; font-weight: 800; color: var(--hk); letter-spacing: -.03em; display: block; -webkit-line-clamp: unset; overflow: visible; }
.home-padw .adhero p { margin: 0 0 14px; font-size: 14.5px; line-height: 1.55; color: var(--hk2); opacity: 1; display: block; -webkit-line-clamp: unset; overflow: visible; }
.home-padw .adhero .adcta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0; }
.home-padw .adhero .adcta .bp { background: #fff; color: var(--hv); font-weight: 800; font-size: 15px; border-radius: 24px; padding: 11px 22px; box-shadow: 0 8px 18px rgba(64, 48, 160, .12); }
.home-padw .adhero .adcta .ls { font-size: 11px; color: #A7A3BD; }
.home-padw .adhero .adwhy { margin: 12px 0 0 !important; padding: 0; border: 0; font-size: 12.5px; line-height: 1.5; color: var(--hk3); background: none; }
.home-padw .adhero .adwhy b { color: var(--hk2); }
.home-padw .adhero .adlk { color: var(--hv); text-decoration: underline; font-size: 12.5px; }
.home-ps.ad .home-ptag { background: #FBF6E6; color: #8A6A00; }
.home-demo { max-width: 1248px; margin: 0 auto; padding: 8px 28px 18px; }
@media (max-width: 720px) { .home-hd .gnb { order: 3; width: 100%; overflow-x: auto; gap: 18px; padding: 2px 0 4px; scrollbar-width: none; } .home-user { display: none; } .home-demo { padding: 8px 16px 14px; } }
'''
css = css.replace('</', '<\\/') + PROTO_ONLY
anchor = re.search(r'<style id="mh-style">.*?</style>\n?', s, flags=re.S)
assert anchor, 'mh-style 을 찾지 못했습니다'
s = s[:anchor.end()] + '<style id="mhx-style">\n' + css + '</style>\n' + s[anchor.end():]

# ── 2. 메인 코드 ──
src = open(os.path.join(HERE, 'proto_main_src.js'), encoding='utf-8').read()
icons = open(os.path.join(K, 'site/src/components/home/Icons.tsx'), encoding='utf-8').read()
def obj(name, typ):
    m = re.search(r'export const ' + name + r': Record<string, ' + re.escape(typ) + r'> = (\{.*?\n\});', icons, flags=re.S)
    assert m, name
    return m.group(1)
# 그림 — 주신 디자인에서 잘라 낸 PNG (crop_design.py). 파일 안에 넣습니다
art = {}
D = os.path.join(K, 'site/public/home/d')
for f in sorted(os.listdir(D)):
    if f.endswith('.png'):
        art[f[:-4]] = 'data:image/png;base64,' + base64.b64encode(open(os.path.join(D, f), 'rb').read()).decode()
assert len(art) >= 55, len(art)
src = src.replace('/*MHX_LINE*/{}', obj('LINE', 'string')).replace('/*MHX_PIC*/{}', obj('PIC', '[number, number]')).replace('/*MHX_ART*/{}', json.dumps(art, ensure_ascii=False))
assert '/*MHX_' not in src
block = '  /*MHX:BEGIN*/\n' + src.rstrip('\n') + '\n  /*MHX:END*/\n'
a = '  function mainBody(){\n    if(MH_USE_V1) return mainBodyV1();'
assert s.count(a) == 1, s.count(a)
s = s.replace(a, block + a)

# ── 3. 메인 화면이 새 메인을 그리게 ──
for fn in ('scMain1', 'scMain2'):
    a = f'  function {fn}(){{\n'
    assert s.count(a) == 1, (fn, s.count(a))
    s = s.replace(a, a + '    /*MHX:SC*/ if(!MH_USE_V2) return mainPageX();   /* v10.13 — 「hero 페이지」 디자인. 메인만 머리 · 바닥이 다릅니다 */\n')

# 화면 설명(메타) — 메인 두 장
NOTE = {'main1': '비로그인 진입. v10.13 「hero 페이지」 디자인 — 메인 전용 헤더 · 히어로(검색 탭 · 안내/HERO 광고) · 오늘의 소개뱅크 · 관 5카드 · 오늘의 PICK · 이건 어때? · 띠배너 · 우리동네 · 안심소개 · 창업 · 나를 위한 소개 · 핵심 · 메인 전용 푸터. 사진 · 아이콘 · 로고는 주신 그림에서 잘라 낸 것, 내용은 그림의 예시.',
        'main2': '로그인 상태. 비로그인 메인과 같은 디자인 — 헤더 오른쪽(나의공간 · 로그아웃 · 관리자 페이지)과 「나를 위한 소개」 버튼만 다름.'}
NOTE['main1'] += ' ★ v10.14 — 「이건 어때?」 3장은 실제 투표(고르고 투표 · 참여 수 = 넣은 표 수), 푸터 사회관계망 아이콘은 운영이 넣은 주소로 연결.'
NOTE['main2'] += ' v10.14 — 회원은 계정당 1표(비로그인 방문자와 따로 셉니다).'
for k, v in NOTE.items():
    m = re.search(r'("' + k + r'": \{"id": "SB-HOM-MAIN-01[01]", "url": "[^"]*", "chip": "[^"]*", "note": ")([^"]*)("\})', s)
    assert m, k
    s = s[:m.start(2)] + v + s[m.end(2):]

# ── 4. 판 이름 ──
m = re.search(r'<title>소개뱅크 시안 v(\d+\.\d+) \(2026-10-\d\d · ', s)
assert m
ver = os.environ.get('PROTO_VER') or m.group(1)   # v10.14 부터 판 이름은 apply_proto_v1014.py 가 올립니다 — 여기서는 지금 판을 그대로 둡니다
if m.group(1) != ver:
    s = s.replace(m.group(0), f'<title>소개뱅크 시안 v{ver} (2026-10-02 · 메인 「hero 페이지」 디자인(메인 전용 헤더·푸터) · ', 1)
    old = 'SGB_Prototype_v' + m.group(1).replace('.', '_') + '.html'
    s = s.replace(old, 'SGB_Prototype_v' + ver.replace('.', '_') + '.html')

open(P, 'w', encoding='utf-8').write(s)
print(f'proto {n0:,} → {len(s):,} bytes · css {len(css):,} · art {len(art)} · title v{ver}')
