"""시안 — 「눌러서 반응은 있지만 기능이 시연되지 않는 부분」을 가려 냅니다.  (v10.25 점검 보강 · 2026-10-08)

전수 누르기(sweep_proto.py · sweep_hlt_after.py)의 기록을 다시 읽어 갈래를 나눕니다. 시안에는 「눌러도 변화가 없으면 안내 글을 띄우는」 시연 보장 장치가 있어
무반응은 0 이 되지만, 그 안내만 뜬 단추는 **그 기능이 시안에서 시연되지 않는다**는 뜻입니다.

  실제 시연        화면이 바뀜(다른 화면 · 같은 화면의 내용) · 시안이 스스로 띄우는 안내 글 · 확인 창
  안내로 대신      「시연: «…» — 실제 동작은 구현 화면 … 에서 확인하십시오.」만 뜸 (그 단추의 동작이 시안에 없음)
  표시만 바뀜      「«…» 선택 — 시안은 표시만 바꿉니다.」 (탭 · 칩의 선택 표시만 · 목록은 그대로)
  없는 주소        누르면 「페이지를 찾을 수 없습니다」 화면이 됨 (끊긴 링크)
  가는 길 없는 화면  어느 화면의 어느 단추를 눌러도 도착하지 않는 화면

사용:  python3 proto_demo.py     결과: proto_demo.json · 마지막 줄 요약
"""
import json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sw = json.load(open(f'{HERE}/proto_sweep.json'))
try: hlt = json.load(open(f'{HERE}/hlt_sweep_after.json'))
except Exception: hlt = []
keys = [s['key'] for s in sw['screens']]

def kind(c):
    r = c['res']; m = c.get('msg') or ''
    if c.get('nf'): return '없는 주소'
    if r == 'TOAST':
        if m.startswith('시연:'): return '안내로 대신'
        if '시안은 표시만' in m: return '표시만 바뀜'
        return '실제 시연(안내 글)'
    if r in ('NAV', 'NAV-OUT', 'NAV-IN'): return '실제 시연(화면 이동)'
    if r in ('DOM', 'MODAL'): return '실제 시연(내용 바뀜)'
    if r == 'DIALOG': return '실제 시연(확인 창)'
    if r == 'INPUT': return '입력'
    if r == 'DISABLED': return '꺼짐'
    if r == 'EXTERNAL': return '바깥 주소'
    if r == 'NONE': return '무반응'
    if r in ('ERROR', 'EXC'): return '오류'
    return r

# 「없는 주소」 다시 확인 — 전수 누르기가 표식한 주소(hash)를 하나씩 직접 넣어 봅니다. 소개몰 틀이 위에 뜬 경우(뒤의 본체만 「찾을 수 없습니다」)는 없는 주소가 아닙니다
from playwright.sync_api import sync_playwright as _spw
_PROTO = os.path.abspath(os.environ.get('PROTO', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb/spec/proto.html'))
_hashes = sorted({c.get('hash') for s in sw['screens'] for c in s.get('clicks', []) if c.get('nf') and c.get('hash')})
_real = set()
with _spw() as _pw:
    _b = _pw.chromium.launch(); _pg = _b.new_page()
    _pg.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
    _pg.goto('file://' + _PROTO); _pg.wait_for_timeout(1200)
    for _h in _hashes:
        _pg.evaluate("location.hash = '#/'"); _pg.wait_for_timeout(150)
        _pg.evaluate(f"location.hash = {json.dumps(_h)}"); _pg.wait_for_timeout(450)
        if _pg.evaluate("(()=>{const a=document.getElementById('app'),h=document.getElementById('hlthost');const mall=!!h && getComputedStyle(h).display!=='none' && h.getClientRects().length>0 && h.innerText.length>50;return !mall && !!a && a.innerText.indexOf('페이지를 찾을 수 없습니다')>=0})()"):
            _real.add(_h)
    _b.close()
for s in sw['screens']:
    for c in s.get('clicks', []):
        if c.get('nf') and c.get('hash') not in _real: c.pop('nf')
rows = []; per = []; reached = set(); tot = {}
for s in sw['screens']:
    c_ = {}
    for c in s.get('clicks', []):
        k = kind(c); c_[k] = c_.get(k, 0) + 1; tot[k] = tot.get(k, 0) + 1
        if c['res'] == 'NAV' and not c.get('nf'):
            dest = (c.get('msg') or '').split('→')[-1].split('#')[0]
            if dest in keys and dest != s['key']: reached.add(dest)
        if k in ('없는 주소', '안내로 대신', '표시만 바뀜', '무반응', '오류'):
            rows.append({'where': '본체', 'screen': s['key'], 'title': s.get('title', ''), 'text': c.get('text', ''), 'kind': k,
                         'detail': (c.get('hash') or '') if k == '없는 주소' else (c.get('msg') or '')[:110]})
    per.append({'where': '본체', 'screen': s['key'], 'title': s.get('title', ''), 'n': len(s.get('clicks', [])), **c_})
for s in hlt:
    c_ = {}
    for c in s.get('clicks', []):
        k = kind(c); c_[k] = c_.get(k, 0) + 1; tot[k] = tot.get(k, 0) + 1
        if k in ('없는 주소', '안내로 대신', '표시만 바뀜', '무반응', '오류'):
            rows.append({'where': '소개몰', 'screen': s.get('id', ''), 'title': (s.get('h1') or '').replace('\n', ' ')[:40], 'text': c.get('text', ''), 'kind': k, 'detail': (c.get('msg') or '')[:110]})
    per.append({'where': '소개몰', 'screen': s.get('id', ''), 'title': (s.get('h1') or '').replace('\n', ' ')[:40], 'n': len(s.get('clicks', [])), **c_})

# 가는 길 없는 화면 — 단추로는 도착하지 않는 화면(주소로 바로 여는 길이 있는지도 같이)
proto = open(os.environ.get('PROTO', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb/spec/proto.html'), encoding='utf8').read()
orph = []
for s in sw['screens']:
    k = s['key']
    if k in reached: continue
    # 단추의 data-go · go('k') 로 가리키는 곳이 소스에 있는지(가려진 조건부 단추 · 소개몰 틀에서 나오는 길)
    refs = (len(re.findall(r'data-go="' + re.escape(k) + r'"', proto)) + len(re.findall(r"go\(['\"]" + re.escape(k) + r"['\"]\)", proto))
            + len(re.findall(r'data-s="' + re.escape(k) + r'"', proto)) + len(re.findall(r'go:\s*"' + re.escape(k) + r'"', proto)))
    m = re.search(r'"' + re.escape(k) + r'": \{"id": "([^"]+)", "url": "([^"]+)"', proto)
    orph.append({'screen': k, 'title': s.get('title', '').replace('\n', ' '), 'refs_in_source': refs, 'id': m.group(1) if m else '', 'url': m.group(2) if m else ''})
# 주소로는 열리는가 — 시안의 주소 칸(hash)에 그 화면의 주소를 넣어 봄(주소에 {id} 같은 자리가 있으면 견본 값 1 을 넣음)
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b = pw.chromium.launch(); pg = b.new_page()
    pg.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
    pg.goto('file://' + os.path.abspath(os.environ.get('PROTO', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb/spec/proto.html'))); pg.wait_for_timeout(1200)
    # 시안의 주소 표(re → screen)에서 그 화면으로 가는 주소를 찾습니다. 없으면 화면 등록부의 url 로 해 봅니다
    routes = {}
    for m in re.finditer(r'\{\s*re:/\^(.*?)\$/[a-z]*,\s*screen:"([A-Za-z0-9_]+)"', proto):
        path = m.group(1).replace('\\/', '/').replace('/?', '')
        path = re.sub(r'\((?:\?:)?[^)]*\)\??', '1', path)
        routes.setdefault(m.group(2), []).append(path)
    for o in orph:
        cands = routes.get(o['screen'], []) + ([re.sub(r'\{[^}]+\}', '1', o['url'].split('#')[0])] if o['url'].startswith('/') else [])
        o['address_tried'] = cands[:3]; o['by_address'] = False if cands else None
        for u in cands[:3]:
            try:
                pg.evaluate("location.hash = '#/'"); pg.wait_for_timeout(120)
                pg.evaluate(f"location.hash = {json.dumps('#' + u)}"); pg.wait_for_timeout(260)
                if pg.evaluate('__VIEW.state.screen') == o['screen'] and '페이지를 찾을 수 없습니다' not in pg.evaluate("document.getElementById('app').innerText"):
                    o['by_address'] = True; o['address'] = u; break
            except Exception:
                pass
    b.close()
dead_end = [o for o in orph if not o['refs_in_source']]

out = {'total': tot, 'per_screen': per, 'rows': rows, 'no_way_in': orph, 'no_way_in_strict': dead_end,
       'screens': len(sw['screens']), 'hlt_screens': len(hlt)}
json.dump(out, open(f'{HERE}/proto_demo.json', 'w'), ensure_ascii=False, indent=1)
n = sum(tot.values())
print(f"화면 {len(sw['screens'])}+{len(hlt)} · 누른 것 {n} · " + ' · '.join(f'{k} {v}' for k, v in sorted(tot.items(), key=lambda x: -x[1]))
      + f" · 다른 화면의 단추로는 닿지 않는 화면 {len(dead_end)}(그중 주소로는 열리는 것 {sum(1 for o in dead_end if o.get('by_address'))} · 주소로도 안 열리는 것 {sum(1 for o in dead_end if o.get('by_address') is False)})")
