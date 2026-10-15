"""목록 화면의 수화(hydration) 오류율 — 역할로 로그인해 같은 주소를 여러 번 새로 엽니다. (메인은 hyd_home.py)
   사용: python3 hyd_pages.py person:/money?sort=RECENT intro:/mall/list [횟수=60]"""
import json, os, sys
from playwright.sync_api import sync_playwright
SITE = os.environ.get('SITE', 'http://localhost:5174').rstrip('/'); PW = 'sgb-dev-1234'
args = [a for a in sys.argv[1:] if ':' in a]; N = int(next((a for a in sys.argv[1:] if a.isdigit()), 60))
R = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for a in args:
        role, path = a.split(':', 1); bad = 0; first = ''
        for rnd in range(N // 6):
            ctx = b.new_context(viewport={'width': 1280, 'height': 900}); pg = ctx.new_page(); errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)[:160]))
            if role != 'guest':
                pg.goto(SITE + '/login'); __import__('consent_ok').agree(f'{role}@x.com', PW); pg.fill('input[name=email]', f'{role}@x.com'); pg.fill('input[name=password]', PW)
                pg.click('form.auth button'); pg.wait_for_timeout(1500)
            for i in range(6):
                errs.clear(); pg.goto(SITE + path, wait_until='networkidle'); pg.wait_for_timeout(150)
                if errs: bad += 1; first = first or errs[0]
            ctx.close()
        R.append({'role': role, 'path': path, 'n': N, 'errors': bad, 'first': first})
        print(f'{role} {path} — 오류 {bad} / {N} {first[:90]}', flush=True)
    b.close()
json.dump(R, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hyd_pages.json'), 'w'), ensure_ascii=False, indent=1)
