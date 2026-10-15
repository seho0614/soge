"""시안(spec/proto.html)에 v10.14 를 넣습니다 — 여러 번 돌려도 같은 결과입니다.

  python3 apply_proto_main.py      (메인 — 투표 카드 · 푸터 사회관계망이 들어 있는 proto_main_src.js)
  python3 apply_proto_v1014.py     (이 파일 — 투표 · 지급 데스크 · 리드 배정 모듈과 기존 화면의 연결 고리)

넣는 것
  1. <style id="px-style">            새 화면의 모양(px-)
  2. 모듈 M_poll (proto_px_src.js)   투표 상태 · 규칙 + 화면 4장(cmupoll · admpoll · admpay · admlasg)
  3. 기존 화면의 연결 고리(한 줄씩 · /*PX:HOOK*/ 표시)
       소개광장 목록(scCmu · scCommunity)   「글 | 이건 어때? 투표」 갈래
       소개광장 검수(scAdmCmu)              「글 검수 | 이건 어때? 투표」 갈래
       정산 승인(scAdmStl)                  「정산 승인 | 지급 데스크」 갈래
       사이트 기본 정보(scAdmLegal)         사회관계망 주소 상자
       파트너사 갈래(ptnNav)                「리드 배정」
  4. 시연 보장 표(MAP) · spec/proto_ids.json 에 새 화면 4장
  5. 판 이름 v10.14
다른 화면의 코드는 건드리지 않습니다.
"""
import json, os, re

_kit = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sgb')
K = os.environ.get('KIT') or (_kit if os.path.isdir(os.path.join(_kit, 'spec')) else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
HERE = os.path.dirname(os.path.abspath(__file__))
P = os.path.join(K, 'spec/proto.html')
s = open(P, encoding='utf-8').read()
n0 = len(s)

def once(a, what):
    assert s.count(a) == 1, (what, s.count(a))

# ── 0. 전에 넣은 것 걷어내기 ──
s = re.sub(r'<style id="px-style">.*?</style>\n?', '', s, flags=re.S)
s = re.sub(r'/\*PX:BEGIN\*/\n.*?/\*PX:END\*/\n', '', s, flags=re.S)
s = ''.join(l for l in s.splitlines(True) if '/*PX:HOOK*/' not in l and '/*PX:INSTALL*/' not in l)   # 줄 단위 — 한 줄이 수 MB 인 곳이 있어 정규식은 쓰지 않습니다

# ── 1. 스타일 ──
CSS = '''
/* ── v10.14 — 투표 목록 · 투표 관리 · 지급 데스크 · 리드 배정 (전부 px- 로 시작) ── */
.px-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;margin:12px 0 16px;align-items:start}
.px-card{--p:0%;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:11px;min-width:0}
.px-card.closed{background:var(--g50)}
.px-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.px-kind{font-size:12px;font-weight:700;color:var(--pp-d);background:var(--pp-l);border-radius:12px;padding:2px 10px}
.px-state{font-size:12px;color:var(--ink3);margin-left:auto}
.px-card h2{font-size:16.5px;line-height:1.4;margin:0}
.px-desc{font-size:13px;color:var(--ink2);margin:0}
.px-img{height:84px;width:auto;max-width:100%;object-fit:contain;align-self:flex-start}
.px-opts{list-style:none;margin:0;padding:0;display:grid;gap:7px}
.px-opts li{--p:0%;position:relative;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--card)}
.px-opts li.on{border-color:var(--pp)}
.px-opts li.res::before{content:"";position:absolute;left:0;top:0;bottom:0;width:var(--p);background:var(--pp-l2)}
.px-opt{position:relative;z-index:1;display:flex;align-items:center;gap:8px;width:100%;border:0;background:none;font:inherit;color:inherit;text-align:left;padding:8px 12px}
button.px-opt{cursor:pointer}
.px-opt i{flex:0 0 auto;width:14px;height:14px;border-radius:50%;border:2px solid var(--pp)}
.px-opts li.on .px-opt i{background:var(--pp);box-shadow:inset 0 0 0 2px var(--card)}
.px-opt img{height:36px;width:auto}
.px-ol{min-width:0;display:flex;flex-direction:column}
.px-ol small{color:var(--ink3);font-size:12px}
.px-opt em{margin-left:auto;font-style:normal;font-weight:700;color:var(--pp-d);white-space:nowrap;font-size:13px;font-variant-numeric:tabular-nums}
.px-foot{display:flex;align-items:center;gap:12px;margin-top:auto;flex-wrap:wrap}
.px-total{margin-left:auto;color:var(--ink3);font-size:13px}
.px-done{font-weight:700;color:var(--pp-d)}
.px-msg{margin:0;font-size:13px;color:#0F6B4F}
.px-msg.err,.px-msg.login{color:#B42318}
.px-msg a{color:var(--pp-d);font-weight:700;text-decoration:underline}
.px-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0}
.px-kpi{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:13px 14px;min-width:0}
.px-kpi span{display:block;font-size:12px;color:var(--ink3)}
.px-kpi b{display:block;font-size:21px;margin-top:2px}
.px-kpi i{font-style:normal;font-size:12px;color:var(--ink2)}
.px-row{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;padding:13px 14px;border:1px solid var(--line);border-radius:10px;background:var(--card);margin-bottom:8px}
.px-row .m{font-weight:800;font-size:15.5px;margin-right:8px}
.px-row .a{display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.px-row .a .inp{flex:0 1 220px;min-width:140px}
.px-bad{color:#B42318;font-size:12.5px;margin-top:4px}
.px-box{padding:14px 16px}
.px-box .sh2{padding:0 0 8px}
.px-box p{margin:6px 0}
.px-form{display:grid;gap:10px;max-width:720px}
.px-form .inp,.px-row .inp{padding:9px 12px;border:1px solid var(--line);border-radius:8px;font:inherit;font-size:14px;background:var(--card);color:var(--ink)}
.px-form textarea{resize:vertical;min-height:84px}
.px-form label{display:grid;gap:4px;font-size:13px;color:var(--ink2)}
.px-form label.chk2{display:inline-flex}
.px-form textarea,.px-form select{padding:9px 12px;border:1px solid var(--line);border-radius:8px;font:inherit;font-size:14px;background:var(--card);color:var(--ink)}
.px-inl{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.px-inl .inp{flex:0 1 160px;min-width:90px}
.px-flash{margin:10px 0;padding:10px 13px;border-radius:9px;font-size:13.5px;background:#ECFDF5;border:1px solid #A7F3D0;color:#0F6B4F}
.px-flash.bad{background:#FEF3F2;border-color:#FECDCA;color:#B42318}
.px-lead{border:1px solid var(--line);border-radius:10px;background:var(--card);padding:14px;margin-bottom:10px}
.px-lead p{margin:6px 0 0;font-size:13.5px}
.px-role{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:0 0 12px;font-size:13px;color:var(--ink2)}
@media (max-width:720px){.px-kpis{grid-template-columns:repeat(2,1fr)}.px-row{grid-template-columns:1fr}.px-row .a{justify-content:flex-start}}
'''
anchor = re.search(r'<style id="mhx-style">.*?</style>\n?', s, flags=re.S)
assert anchor, 'mhx-style 을 찾지 못했습니다 — apply_proto_main.py 를 먼저 돌리십시오'
s = s[:anchor.end()] + '<style id="px-style">' + CSS + '</style>\n' + s[anchor.end():]

# ── 2. 모듈 ──
src = open(os.path.join(HERE, 'proto_px_src.js'), encoding='utf-8').read().rstrip('\n') + '\n'
assert '</script' not in src
a = '\nvar M_router = (function(){'
once(a, 'M_router')
s = s.replace(a, '\n/*PX:BEGIN*/\n' + src + '/*PX:END*/\n' + a.lstrip('\n'), 1)

a = '    View.addScreens(M_ansim.install(View.UI, data, M_router));\n'
once(a, 'M_ansim.install')
s = s.replace(a, a + '    View.addScreens(M_poll.install(View.UI, data, M_router));   /*PX:INSTALL*/ /* v10.14 — 「이건 어때?」 투표 · 사회관계망 주소 · 지급 데스크 · 리드 배정 */\n')

# ── 3. 연결 고리 ──
def hook(after, line, what, before=False):
    global s
    once(after, what)
    s = s.replace(after, (line + after) if before else (after + line), 1)

# 3-1 소개광장 목록 두 장 — 「글 | 이건 어때? 투표」
hook('    \'<div class="tabs">\'+\n    ["전체","소개 후기","업종 이야기","질문","공지"].map((t,i)=>\n',
     '    /*PX:HOOK*/ (window.__PX ? window.__PX.cmuTabs("cmu") : \'\')+\n', 'scCmu', before=True)
hook('    note("warn","<b>"+e(c.note)+"</b>")+\n    tabs("ctab", c.tabs, t)+\n',
     '    /*PX:HOOK*/ (window.__PX ? window.__PX.cmuTabs("cmu") : \'\')+\n', 'scCommunity')
# 3-2 소개광장 검수 — 「글 검수 | 이건 어때? 투표」
hook('    "첫 글과 신고된 글을 봅니다. <b>SB-ADM-CMU-010</b>",\n',
     '    /*PX:HOOK*/ (window.__PX ? window.__PX.admCmuTabs("admcmu") : \'\')+\n', 'scAdmCmu')
# 3-3 정산 승인 — 「정산 승인 | 지급 데스크」
hook('    "신청 → 승인 → 지급 실행. 소개비에서 떼는 금액은 없습니다 (INV-9).",\n',
     '    /*PX:HOOK*/ (window.__PX ? window.__PX.stlTabs("admstl") : \'\')+\n', 'scAdmStl')
# 3-4 사이트 기본 정보 — 사회관계망 주소
hook("    (window.__opsSwitches ? window.__opsSwitches() : '')+\n",
     "    /*PX:HOOK*/ (window.__PX ? window.__PX.snsBox() : '')+\n", 'scAdmLegal')
# 3-5 파트너사 갈래 — 「리드 배정」 (리드 반려 옆)
if '["admlasg","리드 배정"]' not in s:
    a = '["admptnr","리드 반려"],'
    once(a, 'ptnNav')
    s = s.replace(a, a + '["admlasg","리드 배정"],')
# 리드 배정 화면(M_poll)이 같은 갈래 줄을 쓰도록 내놓습니다
a = '/* app.js 가 부팅 때 한 번 부릅니다. */\nfunction install(ui, data){\n  U = ui; D = data;\n  return { screens: SCREENS, meta: METAS, nav: NAVS };\n}\n/* 결과 알림 — 막힌 이유를 그대로 띄웁니다 */'
once(a, 'M_render2.install')
s = s.replace(a, a.replace('  U = ui; D = data;\n', '  U = ui; D = data;\n  window.__ptnNav = ptnNav;   /*PX:HOOK*/ /* v10.14 — 리드 배정 화면이 같은 갈래 줄을 씁니다 */\n'))

# ── 4. 시연 보장 표 · 화면 연결 표 ──
NEW = {
    'cmupoll': ('SB-HOM-CMU-040', '/community/polls', '소개광장 「이건 어때?」 투표', '이건 어때?'),
    'admpoll': ('SB-ADM-CMU-020', '/admin/community/polls', '소개광장 투표 관리', '투표 관리'),
    'admpay':  ('SB-ADM-PAY-010', '/admin/payouts', '지급 데스크', '지급 데스크'),
    'admlasg': ('SB-ADM-PTN-090', '/partners/leads', '리드 배정', '리드 배정'),
}
m = re.search(r'\(function\(\)\{\n  var MAP = \{', s)
assert m
for k, (sid, url, name, _h1) in NEW.items():
    ent = '"%s": {"id": "%s", "url": "%s", "name": "%s"}, ' % (k, sid, url, name)
    if ('"%s": {"id": "%s"' % (k, sid)) not in s:
        at = m.end()
        s = s[:at] + ent + s[at:]
ids_path = os.path.join(K, 'spec/proto_ids.json')
ids = json.load(open(ids_path, encoding='utf-8'))
raw = open(ids_path, encoding='utf-8').read()
for k, (sid, url, name, h1) in NEW.items():
    ids[k] = {'ids': [sid], 'h1': h1, 'mapped': '20261002 v10.14 — 시안 모듈 M_poll 화면(#%s)' % {'cmupoll': '/community/polls', 'admpoll': '/admin/community/polls', 'admpay': '/admin/payouts', 'admlasg': '/admin/partners/leads'}[k]}
indent = 0 if raw.startswith('{\n"') else 1 if raw.startswith('{\n "') else 2 if raw.startswith('{\n  "') else None
out = json.dumps(ids, ensure_ascii=False, indent=indent) + ('\n' if raw.endswith('\n') else '')
if out != raw:
    open(ids_path, 'w', encoding='utf-8').write(out)

# ── 5. 판 이름 ──
m = re.search(r'<title>소개뱅크 시안 v(\d+\.\d+) \(2026-10-\d\d · ', s)
assert m
if m.group(1) == '10.13':
    s = s.replace(m.group(0), '<title>소개뱅크 시안 v10.14 (2026-10-02 · 「이건 어때?」 투표 · 사회관계망 주소 · 지급 데스크 · 리드 배정 화면 · ', 1)
    s = s.replace('SGB_Prototype_v10_13.html', 'SGB_Prototype_v10_14.html')
    m = re.search(r'<title>소개뱅크 시안 v(\d+\.\d+) \(2026-10-\d\d · ', s)
# v10.15 (2026-10-03) — 투표 질문을 확정한 초안으로(실제 웹의 시드와 같은 문구) · 비교해요 두 칸 높이 맞춤
if m.group(1) == '10.14':
    s = s.replace(m.group(0), '<title>소개뱅크 시안 v10.15 (2026-10-03 · 투표 질문 확정 · ', 1)
    s = s.replace('SGB_Prototype_v10_14.html', 'SGB_Prototype_v10_15.html')
    m = re.search(r'<title>소개뱅크 시안 v(\d+\.\d+) \(2026-10-\d\d · ', s)
# v10.16 (2026-10-03) — 화면은 v10.15 와 같습니다. 킷 판 이름만 맞춥니다(AWS 적용 스크립트 · 절차서가 더해진 판)
if m.group(1) == '10.15':
    s = s.replace(m.group(0), '<title>소개뱅크 시안 v10.16 (2026-10-03 · 화면은 v10.15 와 같음 — AWS 적용 준비 판 · ', 1)
    s = s.replace('SGB_Prototype_v10_15.html', 'SGB_Prototype_v10_16.html')
    m = re.search(r'<title>소개뱅크 시안 v(\d+\.\d+) \(2026-10-\d\d · ', s)
# v10.17 (2026-10-06) — 화면은 v10.16 과 같습니다. 킷 판 이름만 맞춥니다(PowerShell 도우미의 빨간 글씨 · 깨진 한글을 고친 판)
if m.group(1) == '10.16':
    s = s.replace(m.group(0), '<title>소개뱅크 시안 v10.17 (2026-10-06 · 화면은 v10.16 과 같음 — PowerShell 도우미 수정 판 · ', 1)
    s = s.replace('SGB_Prototype_v10_16.html', 'SGB_Prototype_v10_17.html')
assert re.search(r'<title>소개뱅크 시안 v10\.17 ', s)

open(P, 'w', encoding='utf-8').write(s)
print(f'proto {n0:,} → {len(s):,} bytes · module {len(src):,} · css {len(CSS):,} · proto_ids {len(ids)}')
