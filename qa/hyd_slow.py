"""수화 오류(#418) 재현 — 느린 연결(CDP 대역 제한)에서 같은 주소를 여러 번 엽니다.  사용: python3 hyd_slow.py /money/list [횟수=20] [kbps=400]"""
import sys, os
from playwright.sync_api import sync_playwright
SITE = os.environ.get('SITE', 'http://localhost:5174').rstrip('/')
path = sys.argv[1]; N = int(sys.argv[2]) if len(sys.argv) > 2 else 20; kbps = int(sys.argv[3]) if len(sys.argv) > 3 else 400
with sync_playwright() as p:
    b = p.chromium.launch(); bad = 0; first = ''
    for i in range(N):
        ctx = b.new_context(viewport={'width': 1280, 'height': 900}); pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
        cdp = ctx.new_cdp_session(pg)
        cdp.send('Network.enable'); cdp.send('Emulation.setCPUThrottlingRate', {'rate': int(os.environ.get('CPU', '1'))})
        cdp.send('Network.emulateNetworkConditions', {'offline': False, 'latency': 40, 'downloadThroughput': kbps * 1024 / 8, 'uploadThroughput': 200 * 1024 / 8})
        pg.goto(SITE + path, wait_until='load', timeout=120000); pg.wait_for_timeout(800)
        if errs: bad += 1; first = first or errs[0]
        ctx.close()
    print(f'{path} — 오류 {bad} / {N} (대역 {kbps}kbps) {first[:150]}')
    b.close()
