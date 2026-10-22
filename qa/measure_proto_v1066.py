"""v10.66 — 디자인 통일 6단계 ① 시안 화면 코드 안 글자색의 실제 바탕을 화면에서 잽니다(바꾸지 않음). 결과: results_v10_66/proto_contrast.json

  docker run --rm -v <sgb-infra 폴더>:/w -v <sgb-core 폴더>:/core -w /w/qa mcr.microsoft.com/playwright/python:v1.49.1-noble python3 measure_proto_v1066.py /core/spec/proto.html

  시안의 화면(__VIEW.screens)을 하나씩 그려, style 속성에 직접 적힌 글자색 가운데 흰 바탕 대비 4.5 미달인 요소를 모두(흰 글자 · 4.5 이상 빼고 · 보이지 않아도) 골라
  · 실제 글자색(계산된 값) · 위로 올라가며 처음 만나는 칠한 바탕(그라데이션 · 그림이면 「그림 바탕」) · 그 바탕과의 대비를 적습니다.
  화면마다 문서 순서대로 적습니다(시안 소스의 순서와 같음 — 고침 스크립트가 이 순서로 맞춥니다).
"""
import json, os, sys
from playwright.sync_api import sync_playwright

PROTO = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'results_v10_66')
os.makedirs(OUT, exist_ok=True)
STYLE = "*,*::before,*::after{animation:none!important;transition:none!important} .admask,.adfloat{display:none!important}"
SCAN = r"""() => {
  const rgb = s => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(',').map(Number); return {r:v[0], g:v[1], b:v[2], a: v.length > 3 ? v[3] : 1}; };
  const lum = c => { const f = x => { x /= 255; return x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }; return .2126*f(c.r) + .7152*f(c.g) + .0722*f(c.b); };
  const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const hex = c => '#' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('');
  const out = [];
  for (const el of document.querySelectorAll('[style*="color"]')) {
    const st = el.getAttribute('style') || '';
    if (!/(^|;|\s)color\s*:\s*#/i.test(st)) continue;
    const cs = getComputedStyle(el);
    const txt = (el.innerText || '').trim();
    const dm = st.match(/(?:^|;|\s)color\s*:\s*(#[0-9a-fA-F]{3,6})/i); if (!dm) continue;
    let dh = dm[1].slice(1); if (dh.length === 3) dh = dh.replace(/./g, c => c + c);
    const dc = {r: parseInt(dh.slice(0, 2), 16), g: parseInt(dh.slice(2, 4), 16), b: parseInt(dh.slice(4, 6), 16)};
    if (cr(dc, {r:255, g:255, b:255}) >= 4.5 || /^#f{3}(f{3})?$/i.test(dm[1])) continue;   // 적힌 색이 흰 바탕에서 4.5 미달 · 흰 글자 빼고
    const fg = rgb(cs.color); if (!fg) continue;
    let bg = null, kind = 'color', n = el;
    while (n && n.nodeType === 1) {
      const s = getComputedStyle(n);
      if (s.backgroundImage && s.backgroundImage !== 'none') { kind = 'image'; break; }
      const c = rgb(s.backgroundColor); if (c && c.a > .5) { bg = c; break; }
      n = n.parentElement;
    }
    if (!bg && kind === 'color') bg = {r:255, g:255, b:255};
    out.push({style: st, fg: hex(fg), bg: bg ? hex(bg) : null, kind, cr: bg ? Math.round(cr(fg, bg) * 100) / 100 : null,
              text: txt.slice(0, 40), size: cs.fontSize, weight: cs.fontWeight, declared: '#' + dh.toUpperCase()});
  }
  return out;
}"""
rows = {}
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 900})
    pg.goto('file://' + os.path.abspath(PROTO)); pg.wait_for_timeout(1600); pg.add_style_tag(content=STYLE)
    keys = pg.evaluate("Object.keys(__VIEW.screens)")
    for k in keys:
        try:
            pg.evaluate("(k)=>{location.hash=''; __VIEW.paint(k)}", k); pg.wait_for_timeout(60)
            found = pg.evaluate(SCAN)
        except Exception as e:
            print('건너뜀', k, str(e)[:120], file=sys.stderr); continue
        if found: rows[k] = found
    b.close()
json.dump({'screens': len(keys), 'rows': rows}, open(os.path.join(OUT, 'proto_contrast.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
al = [f for v in rows.values() for f in v]
print('화면', len(keys), '· 글자가 있는 화면', list(rows), '· 요소', len(al), '· 4.5 미달', sum(1 for f in al if f['kind'] == 'color' and f['cr'] < 4.5), '· 그림 바탕', sum(1 for f in al if f['kind'] == 'image'))
