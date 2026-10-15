"""메인(/) 수화(hydration) 오류 점검 — 역할별로 여러 번 새로 열어 React #418 이 한 번도 없어야 합니다. 결과: hyd_home.json

v10.13 에서 실측: 메인을 서버 컴포넌트로 그렸을 때 열 때마다 3 ~ 13% 로 #418 이 났습니다(화면을 통째로 다시 그림).
원인 · 조치는 site/src/components/home/HomeView.tsx 머리말과 docs/57 에 있습니다. 드물게 나는 오류라 한두 번 열어서는 안 보입니다 — 그래서 여러 번 엽니다.

사용:  SITE=http://localhost:5174 python3 hyd_home.py        LIVE=http://localhost:5176 (떠 있으면 같이 봅니다)
"""
import json, os, sys, urllib.request
from playwright.sync_api import sync_playwright
SITE = os.environ.get('SITE', 'http://localhost:5174').rstrip('/'); LIVE = os.environ.get('LIVE', 'http://localhost:5176').rstrip('/'); PW = 'sgb-dev-1234'
PLAN = [(SITE, 'guest', None, 120), (SITE, 'person', 'person@x.com', 60), (SITE, 'buyer', 'buyer@x.com', 30), (SITE, 'intro', 'intro@x.com', 30), (SITE, 'admin', 'admin@x.com', 30)]
try:
    urllib.request.urlopen(LIVE + '/', timeout=3); PLAN += [(LIVE, 'guest', None, 60), (LIVE, 'person', 'person@x.com', 30)]
except Exception: pass
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:300]}); print('ok  ' if ok else 'FAIL', step, str(detail)[:160], file=sys.stderr)
with sync_playwright() as p:
    b = p.chromium.launch(); total = 0
    for site, role, email, n in PLAN:
        bad = 0; first = ''; mode = ''
        for rnd in range(n // 6):      # 6번마다 새 브라우저 문맥(쿠키 · 캐시 없음)
            ctx = b.new_context(viewport={'width': 1280, 'height': 900}); pg = ctx.new_page(); errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
            if email:
                pg.goto(site + '/login'); __import__('consent_ok').agree(email, PW); pg.fill('input[name=email]', email); pg.fill('input[name=password]', PW)
                pg.click('form.auth button'); pg.wait_for_timeout(1500)
            for i in range(6):
                errs.clear(); pg.goto(site + '/', wait_until='networkidle'); pg.wait_for_timeout(150); total += 1
                if errs: bad += 1; first = first or errs[0]
            mode = pg.get_attribute('.home', 'data-content') or ''
            ctx.close()
        rec(f'메인 {n}번 열기 — {role} · 내용 {mode} ({site.rsplit(":", 1)[-1]}) · 스크립트 오류(#418 포함) 0', bad == 0, f'오류 {bad} / {n} {first[:120]}')
    b.close()
json.dump(R, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hyd_home.json'), 'w'), ensure_ascii=False, indent=1)
print(f"통과 {sum(r['ok'] for r in R)} / {len(R)} · 메인 {total}번 열기")
