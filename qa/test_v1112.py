"""v10.112 시험 — 운영 화면 로그인 디자인(가운데 카드 · 대표 2026-10-26)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e ADMIN_WEB=http://localhost:15173 \
      -e SGB_QA_OUT=/w/out sgb-qa:v1 python3 test_v1112.py

  ① 코드 — 동작 그대로(로그인 API · 운영 역할 검사 · 칸 이름) · 가운데 카드 · 「사용자 웹으로 가기」 · 디자인 시트 값만(색 · 모서리 · 그림자 · 글꼴)
  ② (브라우저) PC · 휴대폰 — 가로 넘침 없음 · 칸이 카드 안 · 운영 권한 없는 계정은 안내 · 최고 관리자는 들어감
"""
import os, re

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


L = rd('web/src/components/Login.tsx')
CSS = rd('web/src/styles/app.css')
blk = CSS[CSS.find('v10.112 운영 로그인'):] if 'v10.112 운영 로그인' in CSS else ''
ok('① 동작 그대로 — /auth/login · 운영 역할(ADMIN · SUPER · REVIEWER · PAYOUT) 검사 · 칸 이름 email · password · submit',
   "api<{ accessToken: string; refreshToken?: string }>('/auth/login'" in L and "const OPS = ['ADMIN', 'SUPER', 'REVIEWER', 'PAYOUT'];" in L
   and 'name="email"' in L and 'name="password"' in L and 'type="submit"' in L and '운영 권한이 없는 계정입니다.' in L, '')
ok('① 가운데 카드 · 「사용자 웹으로 가기」(siteUrl) · 오류는 role=alert', 'className="bo-login-card"' in L and 'data-bo-login-site' in L
   and "import { siteUrl } from '../lib/siteUrl';" in L and 'role="alert"' in L, '')
ok('① 디자인 시트 값만 — 색 #… 직접 쓰지 않음 · 모서리 · 그림자 · 글꼴 토큰 · 휴대폰 넘침 막음',
   blk and not re.search(r'#[0-9a-fA-F]{3,8}\b', blk) and 'var(--sgb-r-lg)' in blk and 'var(--sgb-shadow-up)' in blk and 'var(--sgb-font-title)' in blk
   and 'grid-template-columns: minmax(0, 380px)' in blk and 'min-width: 0' in blk, '')

if ADMIN_WEB:
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if not sync_playwright:
        ok('② 화면 시험은 시험 이미지(sgb-qa:v1 · playwright)에서', False, 'playwright 없음')
    else:
        out = os.environ.get('SGB_QA_OUT', '.')
        with sync_playwright() as p:
            b = p.chromium.launch()
            for name, vp in (('PC', {'width': 1440, 'height': 900}), ('휴대폰', {'width': 390, 'height': 844})):
                pg = b.new_page(viewport=vp); pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(1000)
                card = pg.locator('.bo-login-card').bounding_box()
                inner = [pg.locator(s).bounding_box() for s in ('input[name=email]', 'input[name=password]', 'button[type=submit]')]
                sw = pg.evaluate('document.documentElement.scrollWidth')
                ok(f'② {name} — 가로 넘침 없음 · 칸 · 단추가 카드 안 · 카드가 가운데',
                   sw <= vp['width'] and card and all(x and x['x'] >= card['x'] and x['x'] + x['width'] <= card['x'] + card['width'] + 0.5 for x in inner)
                   and abs((card['x'] + card['width'] / 2) - vp['width'] / 2) < 2, f"scrollWidth {sw} · card {card and round(card['width'])}")
                pg.screenshot(path=f'{out}/v1112_login_{"pc" if name == "PC" else "mobile"}.png')
                if name == 'PC':
                    ok('② 「사용자 웹으로 가기」 주소가 있음', bool(pg.locator('[data-bo-login-site]').get_attribute('href')), pg.locator('[data-bo-login-site]').get_attribute('href'))
                    pg.fill('input[name=email]', 'seller@x.com'); pg.fill('input[name=password]', 'sgb-dev-1234'); pg.click('button[type=submit]'); pg.wait_for_timeout(1500)
                    ok('② 운영 권한 없는 계정 — 안내 · 로그인 화면 그대로', '운영 권한이 없는 계정입니다' in pg.locator('.bo-login-err').inner_text() and pg.locator('.bo-head').count() == 0, '')
                    pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', 'sgb-dev-1234'); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                    ok('② 최고 관리자 — 운영 화면으로 들어감', pg.locator('.bo-head').count() == 1 and pg.locator('[data-bo-login]').count() == 0, '')
            b.close()

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
