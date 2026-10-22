"""v10.67 — 운영 화면(web/) 탭마다 찍고, 보이는 글자마다 실제 바탕과 대비를 잽니다(바꾸지 않음). 결과: results_v10_67/<이름>/

  점검판이 떠 있을 때(~/sgb-check.sh 갈래 up) — 점검판 운영 화면 포트 15173 으로 엽니다(vite 가 sgb-web 같은 다른 이름을 막아 localhost 로).
  docker run --rm --network host -v <sgb-infra>:/w -v <sgb-core>:/core:ro -w /w/qa mcr.microsoft.com/playwright/python:v1.49.1-noble \
    sh -c 'pip3 install -q --break-system-packages playwright==1.49.1; python3 measure_admin_v1067.py /core before'

  · 탭 목록은 web/src/lib/adminMenu.ts 의 TABS 에서 읽습니다. 계정은 개발용 admin@x.com(docker-compose.yml 머리말).
  · 글자: 글자 노드가 바로 든 요소마다 계산된 글자색 · 위로 올라가며 처음 칠한 바탕(그라데이션 · 그림이면 「그림 바탕」) · 대비 · 글자 크기
  · 결과: shots/<탭>.png(사진은 Git 밖 ~/outputs/v10.67_admin_shots 로 옮겨 보관) · contrast.json(탭별 4.5 미달 줄 · 글자 크기 · 글꼴 셈)
"""
import json, os, re, sys
from playwright.sync_api import sync_playwright

CORE, NAME = sys.argv[1], sys.argv[2]
BASE = os.environ.get('BASE', 'http://localhost:15173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'results_v10_67', NAME)
os.makedirs(os.path.join(OUT, 'shots'), exist_ok=True)
menu = open(os.path.join(CORE, 'web/src/lib/adminMenu.ts'), encoding='utf-8').read()
body = menu[menu.index('export const TABS'):]; body = body[:body.index('] as const') if '] as const' in body else body.index('];')]
TABS = re.findall(r"\['([\w-]+)',\s*'([^']+)'", body)
SCAN = r"""() => {
  const rgb = s => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(',').map(Number); return {r:v[0], g:v[1], b:v[2], a: v.length > 3 ? v[3] : 1}; };
  const lum = c => { const f = x => { x /= 255; return x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }; return .2126*f(c.r) + .7152*f(c.g) + .0722*f(c.b); };
  const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const hex = c => '#' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('');
  const low = [], sizes = {}, fonts = {};
  for (const el of document.querySelectorAll('body *')) {
    if (!['#text'].some(() => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    sizes[cs.fontSize] = (sizes[cs.fontSize] || 0) + 1;
    const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(); fonts[fam] = (fonts[fam] || 0) + 1;
    const fg = rgb(cs.color); if (!fg) continue;
    let bg = null, kind = 'color', n = el;
    while (n && n.nodeType === 1) {
      const s = getComputedStyle(n);
      if (s.backgroundImage && s.backgroundImage !== 'none') { kind = 'image'; break; }
      const c = rgb(s.backgroundColor); if (c && c.a > .5) { bg = c; break; }
      n = n.parentElement;
    }
    if (!bg && kind === 'color') bg = {r:255, g:255, b:255};
    if (!bg) continue;
    const v = cr(fg, bg);
    if (v < 4.5 && !el.closest('[disabled],:disabled,[aria-disabled="true"]') && !(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'))
      low.push({fg: hex(fg), bg: hex(bg), cr: Math.round(v * 100) / 100, text: [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').slice(0, 30),
                tag: el.tagName.toLowerCase(), cls: (el.className && el.className.baseVal === undefined ? el.className : '').slice(0, 40), size: cs.fontSize});
  }
  return {low, sizes, fonts};
}"""
res = {}
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1440, 'height': 900})
    pg.goto(BASE + '/'); pg.wait_for_selector('input[name=email]', timeout=60000)
    pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', 'sgb-dev-1234'); pg.keyboard.press('Enter')
    pg.wait_for_timeout(2500)
    for k, label in TABS:
        try:
            pg.evaluate("(k)=>{location.hash = '#/' + k}", k); pg.wait_for_timeout(1200)
            pg.add_style_tag(content="*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}")
            pg.screenshot(path=os.path.join(OUT, 'shots', f'{k}.png'), full_page=False)
            res[k] = dict(pg.evaluate(SCAN), label=label)
        except Exception as e:
            res[k] = {'error': str(e)[:200], 'label': label}
    b.close()
json.dump(res, open(os.path.join(OUT, 'contrast.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
low = sum(len(v.get('low', [])) for v in res.values())
print('탭', len(TABS), '· 찍음', sum(1 for v in res.values() if 'low' in v), '· 4.5 미달 글자', low, '· 오류', [k for k, v in res.items() if 'error' in v][:5])
