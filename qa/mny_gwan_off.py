"""한 번만 해 보는 확인 — 소개장터 관을 「중지」로 바꿨을 때 /money 가 v10.29 의 중지 안내 화면으로 나오는지. 끝나면 되돌립니다."""
import json, os, subprocess, sys, time, signal
sys.path.insert(0, '/home/claude/qa')
from detail_fixture import call, login
from playwright.sync_api import sync_playwright
SP = sys.argv[1]
K = '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb/site'
def restart():
    out = subprocess.run("ps -eo pid,args | grep -E '[n]ext-server|[n]ext start'", shell=True, capture_output=True, text=True).stdout
    for ln in out.strip().split('\n'):
        if ln.strip(): os.kill(int(ln.split()[0]), signal.SIGTERM)
    time.sleep(1.5); subprocess.run(['rm', '-rf', K + '/.next/cache/fetch-cache'])
    env = {**os.environ, 'API_BASE': 'http://localhost:3000/api/v1', 'API_ORIGIN': 'http://localhost:3000'}
    subprocess.Popen('nohup npx next start -p 5174 > /tmp/site.log 2>&1 &', shell=True, cwd=K, env=env)
    for _ in range(40):
        if subprocess.run('curl -s -o /dev/null -m 2 http://localhost:5174/', shell=True).returncode == 0: break
        time.sleep(1)
adm = login('admin@x.com')
st, j = call('PATCH', '/admin/gwans/MNY', adm, {'isActive': False}); print('끔', st, (j or {}).get('isActive') if isinstance(j, dict) else j)
try:
    restart()
    print('GET /gwans MNY:', [(g['code'], g.get('isActive')) for g in call('GET', '/gwans')[1] if g['code'] == 'MNY'])
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 900}); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
        r = pg.goto('http://localhost:5174/money', wait_until='networkidle'); pg.wait_for_timeout(500)
        print(json.dumps(pg.evaluate("""() => ({ status: 0, mny: document.querySelectorAll('.mny').length, gw: document.querySelectorAll('.gw[data-gw=MNY]').length, off: (document.querySelector('.mny-off') || {}).textContent || '', parts: document.querySelectorAll('.mny-hero, .mny-quick, .mny-cat, .mny-old, .mny-cta').length, nav: [...document.querySelectorAll('header.b2-hd .b2-nav a')].map(a => a.textContent.trim()),
            hd: [document.querySelectorAll('header.b2-hd').length, document.querySelectorAll('header.pc-hd').length], main: document.querySelector('main').className, sw: document.documentElement.scrollWidth, end: document.querySelectorAll('i[data-root-end]').length })"""), ensure_ascii=False), r.status, errs)
        pg.screenshot(path=SP + '/off.png'); b.close()
finally:
    # 개발 DB 의 관은 「연 날짜」가 비어 있어 관리자 API 로는 다시 못 켭니다(fn_open_phase 로만 열림 · 422). 시험이라 DB 에서 is_active 만 되돌립니다
    print('켬', subprocess.run(['su', 'postgres', '-c', "psql -d sgb -Atc \"UPDATE gwans SET is_active = true WHERE code='MNY' RETURNING code, is_active\""], capture_output=True, text=True).stdout.strip())
    restart()
    print('GET /gwans MNY:', [(g['code'], g.get('isActive')) for g in call('GET', '/gwans')[1] if g['code'] == 'MNY'], subprocess.run("curl -s -o /dev/null -w '%{http_code}' http://localhost:5174/money", shell=True, capture_output=True, text=True).stdout)
