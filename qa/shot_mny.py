"""소개장터 메인을 1500px · 2배로 찍고, 구역마다 화면에서의 자리(기준 자리)를 같이 적습니다 — v10.29. measure_mny.py 가 이 둘을 읽습니다.

  python3 shot_mny.py site  [주소]   실제 웹   (기본 http://localhost:5174/money)            → mny_site.png  · mny_site.json
  python3 shot_mny.py proto [파일]   시안      (기본 킷의 sgb/spec/proto.html 의 #/g/mny)     → mny_proto.png · mny_proto.json
  폭을 바꿔 찍기: W=390 python3 shot_mny.py site   → mny_site_390.png (기준 자리 파일은 1500 일 때만 씁니다)
"""
import asyncio, json, os, sys
from playwright.async_api import async_playwright
Q = os.path.dirname(os.path.abspath(__file__))
K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
if not os.path.isdir(K + '/sgb'): K = os.path.dirname(Q)
mode = sys.argv[1] if len(sys.argv) > 1 else 'site'
url = sys.argv[2] if len(sys.argv) > 2 else (os.environ.get('SITE', 'http://localhost:5174') + '/money' if mode == 'site' else 'file://' + os.environ.get('PROTO', K + '/sgb/spec/proto.html') + '#/g/mny')
if mode == 'proto' and not url.startswith(('file:', 'http')): url = 'file://' + os.path.abspath(url) + '#/g/mny'
W = int(os.environ.get('W', 1500)); OUT = os.environ.get('OUT', Q)
SEL = {'hd': '.b2-hd', 'hero': '.mny-hero', 'quick': '.mny-quick', 'cat': '.mny-cat', 'side': '.mny-side', 'p1': '.mny-panel:not(.is-req):not(.is-aip)', 'p2': '.mny-panel.is-req', 'p3': '.mny-panel.is-aip',
       'req1': '.mny-reqs .mny-req:nth-of-type(1)', 'req4': '.mny-reqs .mny-req:nth-of-type(4)', 'band': '.mny-band', 'cases': '.mny-cases', 'cta': '.mny-cta', 'old': '.mny-old', 'ft': '.b2-ft'}
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        c = await b.new_context(viewport={'width': W, 'height': 1000}, device_scale_factor=2)
        pg = await c.new_page(); errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
        await pg.goto(url, wait_until='networkidle' if mode == 'site' else 'load')
        await pg.wait_for_selector('.mny', timeout=15000)
        await pg.evaluate('document.fonts.ready'); await pg.wait_for_timeout(500)
        # 시안의 도구 막대 · 떠 있는 단추처럼 화면 위에 겹쳐 뜨는 것은 찍을 때만 감춥니다(자리는 바꾸지 않음)
        if mode == 'proto':                # 화면 위에 떠 있는 광고 카드(오른쪽 아래 · FLOAT — 전부터 있던 것)는 찍을 때만 감춥니다 — 자리를 재는 데 겹칩니다
            await pg.add_style_tag(content='.adfloat{display:none!important}')
        if os.environ.get('TRY_CSS'):      # 치수를 맞춰 볼 때만 — 파일의 스타일을 화면에 덧붙여 찍습니다(검사에는 쓰지 않습니다)
            await pg.add_style_tag(content=open(os.environ['TRY_CSS'], encoding='utf-8').read()); await pg.wait_for_timeout(200)
        a = await pg.evaluate('''(S) => Object.fromEntries(Object.entries(S).map(([k, s]) => { const e = document.querySelector(s); if (!e) return [k, null];
            const b = e.getBoundingClientRect(); const r = (v) => Math.round(v * 100) / 100; return [k, [r(b.left + scrollX), r(b.top + scrollY), r(b.width), r(b.height)]]; }))''', SEL)
        name = 'mny_%s%s' % (mode, '' if W == 1500 else '_%d' % W)
        await pg.screenshot(path=os.path.join(OUT, name + '.png'), full_page=True)
        h = await pg.evaluate('document.documentElement.scrollHeight'); sw = await pg.evaluate('document.documentElement.scrollWidth')
        if W == 1500: json.dump({'mode': mode, 'url': url, 'width': W, 'height': h, 'anchors': a, 'errors': errs}, open(os.path.join(OUT, name + '.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('%s %dpx — 높이 %d · 가로 넘침 %s · 브라우저 오류 %d %s' % (name, W, h, '없음' if sw <= W else '있음(%d)' % sw, len(errs), errs[:3]))
        await b.close()
asyncio.run(main())
