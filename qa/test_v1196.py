"""v10.196 시험 — 운영 화면 「주문 받기 켜짐」 띠(docs/308)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e ADMIN_WEB=http://localhost:15173 \
      -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1196.py

  ① 코드 — 띠(간주 결제 켜짐 + 주문 받기 켜짐 · 설정 못 읽으면 안 띄움 · 첫 화면으로) · 1분마다 · bo-settings 로 바로 · 첫 화면 스위치가 알림 · CSS 는 토큰
  ② (화면) 켜짐이면 첫 화면 · 다른 화면 모두 띠 · 링크 누르면 첫 화면 · 끄고 bo-settings → 띠 없어짐 · 간주 결제 꺼짐이면 띠 없음 · 오류 없음 · 되돌림
"""
import os, re, subprocess

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
AP = rd('web/src/App.tsx'); LW = rd('web/src/app/admin/LaunchWatch.tsx'); CS = rd('web/src/styles/app.css')
ok('① 띠 조건 — 설정을 읽었을 때만 · 주문 받기 off 아님 · 간주 결제 on · 머리줄 아래 · 첫 화면 링크',
   "const orderLive = 'mall.order_open' in settings && (settings['mall.order_open'] ?? 'on') !== 'off' && (settings['assume.payment'] ?? 'on') === 'on';" in AP
   and '<div className="bo-order-live" role="alert" data-order-live-bar="">' in AP and AP.find('</header>') < AP.find('data-order-live-bar') < AP.find('<main className="bo-main"')
   and "첫 화면 「공개 직후 지켜보기」에서 끄기" in AP and "go('home'); }}>첫 화면" in AP, '')
ok('① 다시 읽기 — 1분마다 · bo-settings 사건 · 정리 · 첫 화면 스위치(끄기 · 켜기 칸)가 알림',
   "window.setInterval(load, 60_000);" in AP and "window.addEventListener('bo-settings', load);" in AP and "window.removeEventListener('bo-settings', load);" in AP
   and "const reloadAll = () => { w.reload(); window.dispatchEvent(new Event('bo-settings')); };" in LW
   and LW.count('reloadAll') == 3, '')
blk = CS[CS.find('.bo-order-live {'):][:400]
ok('① CSS — 디자인 토큰만(색 값 직접 없음)', '.bo-order-live {' in CS and 'var(--danger-w)' in blk and 'var(--danger)' in blk and not re.search(r'#[0-9A-Fa-f]{3,6}\b', blk), '')


# ── ② 화면 ────────────────────────────────────────────────────────────
def psql(sql, quiet=False):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode and not quiet: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip() if not r.returncode else ('!' + r.stderr.strip())


if DB and ADMIN_WEB:
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import consent_ok
    from playwright.sync_api import sync_playwright
    sv = lambda k: psql(f"SELECT coalesce((SELECT value FROM site_settings WHERE key = '{k}'), '')")
    st = lambda k, v: psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}'")
    keep = {k: sv(k) for k in ('mall.order_open', 'assume.payment')}
    bar = "() => { const b = document.querySelector('[data-order-live-bar]'); return b ? b.textContent.trim() : null; }"
    try:
        st('assume.payment', 'on'); st('mall.order_open', 'on')
        consent_ok.agree('admin@x.com', PW)
        with sync_playwright() as p:
            b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1400, 'height': 1000}); errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
            pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
            pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
            pg.goto(ADMIN_WEB + '/#/home', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(1000)
            t_home = pg.evaluate(bar)
            pg.goto(ADMIN_WEB + '/#/ops-alerts', wait_until='networkidle', timeout=120000); pg.reload(wait_until='networkidle'); pg.wait_for_timeout(1000)
            t_other = pg.evaluate(bar)
            pg.click('[data-order-live-bar] a'); pg.wait_for_timeout(1000)
            at_home = pg.evaluate("() => location.hash")
            ok('② 켜짐(간주 결제 on) — 첫 화면 · 운영 알림 화면 모두 띠 · 링크 → 첫 화면',
               t_home and '「주문 받기」가 켜져 있습니다' in t_home and t_other and '「주문 받기」가 켜져 있습니다' in t_other and at_home == '#/home',
               f'{(t_home or "")[:40]} · {(t_other or "")[:20]} · {at_home}')
            st('mall.order_open', 'off')
            pg.evaluate("() => window.dispatchEvent(new Event('bo-settings'))"); pg.wait_for_timeout(1500)
            t_off = pg.evaluate(bar)
            st('mall.order_open', 'on'); st('assume.payment', 'off')
            pg.reload(wait_until='networkidle'); pg.wait_for_timeout(1500)
            t_real = pg.evaluate(bar)
            b.close()
        ok('② 끄고 bo-settings → 띠 없어짐 · 간주 결제 꺼짐(실제 결제)이면 주문 받기 켜져도 띠 없음 · 화면 오류 없음',
           t_off is None and t_real is None and not errs, f'{t_off} · {t_real} · {errs[:2]}')
    finally:
        for k, v in keep.items():
            if v:
                st(k, v)
    ok('끝 — 되돌림(주문 받기 · 간주 결제)', all(sv(k) == v for k, v in keep.items() if v), str(keep))
else:
    print('  (DB · ADMIN_WEB 없음 — ② 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
