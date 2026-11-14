"""v10.270 · v10.271 (docs/402) — 판매수수료율 시뮬레이션 · 운영 화면 추천 관계도 세로 가지 (+ 문서 400 입점 약관 완성본 · 401 처리방침 1.1 완성본)

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1270.py

  ① (코드) 시뮬레이션(계산만 · api 없음 · 판매액 × 요율 ÷ 100 버림 · 결제대행 뺌 · 갈래 요율 읽기) · 소개몰 판매자 탭에 놓임 ·
     운영 관계도 세로 가지(한 사람 한 줄 · 들임) · 문서 400(빈칸 〔 〕% 두 곳 · 〔시행일〕 · 「회원(개인 또는 사업자)」 · 「발행 전 할 일」 없음) ·
     401(5곳 · 법령 근거 빈칸) · 402 · 마이그레이션 243 · 판 v10.271 이상
  ② (API) 갈래 요율 — ADMIN 봄 · 회원 403
  ③ (화면) 소개몰 › 소개몰 판매자 › 시뮬레이션(직영 2명 · 1,000,000원 · 10% / 일반 0명 · 결제 0% → 한 달 200,000 · 1년 2,400,000 · 부가세 20,000) ·
     회원 상세 「추천 관계도」 세로 가지(상자마다 다른 줄 · 들임 40) · 화면 오류 없음
  읽기만 — 관계도가 없으면 가입 2명만 만듦(두 번 돌아도 통과).
"""
import json, os, re, subprocess, time, urllib.error, urllib.request
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


VER = rd('VERSION').strip()
HS, ST, RG = rd('web/src/app/admin/HealthRateSim.tsx'), rd('web/src/app/admin/HealthSellerTab.tsx'), rd('web/src/app/admin/affiliates/RcmGraph.tsx')
ok('① v10.270 수수료율 시뮬레이션 — 계산만(api 없음) · 판매액 × 요율 ÷ 100 버림 · 결제대행 뺌 · 갈래 요율 읽기 · 소개몰 판매자 탭(입점 열기 준비 아래)',
   'function rateSim(' in HS and 'Math.floor((total * r.rate) / 100)' in HS and 'total - fee - pgFee' in HS and "useApi<Rate[]>('/admin/health/commission-rates')" in HS
   and 'api(' not in HS and 'data-hlt-sim=' in HS and '<HealthTenantReady />\n      <HealthRateSim />' in ST, '')
ok('① v10.271 운영 관계도 세로 가지 — 한 사람 한 줄 · 들임(IX) · 선 부모 아래 → 오른쪽 상자 옆 · 0.6 까지만 줄임',
   'data-rcm-layout="vertical"' in RG and 'x: d * IX, y: row * (H + GY)' in RG and '`M${x1},${y1} V${y2} H${x2}`' in RG and 'Math.max(0.6,' in RG and 'GX' not in RG, '')
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []
def doc(n):
    f = [x for x in docs if x.startswith(f'{n}_')]
    return open(os.path.join(K, 'docs', f[0]), encoding='utf-8').read() if f else ''
D400, D401, D402 = doc(400), doc(401), doc(402)
full400 = D400.split('````markdown', 1)[1] if '````markdown' in D400 else ''
full401 = D401.split('````markdown', 1)[1] if '````markdown' in D401 else ''
mig = [d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isfile(os.path.join(K, 'prisma/migrations', d, 'migration.sql'))] if os.path.isdir(os.path.join(K, 'prisma/migrations')) else []
ok('① 문서 400(전문 빈칸 = 〔 〕 · 〔시행일〕 만 · 「회원(개인 또는 사업자)」 · 「발행 전 할 일」 없음) · 401(추천 · 주민등록번호 · 법령 근거 빈칸) · 402 · 마이그레이션 243 · 판 v10.271 이상',
   bool(full400) and sorted(set(re.findall('〔[^〕]*〕', full400))) == ['〔 〕', '〔시행일〕'] and '판매하는 회원(개인 또는 사업자).' in full400 and '발행 전 할 일' not in full400
   and bool(full401) and '### 추천 코드로 가입하실 때' in full401 and '| 주민등록번호 |' in full401 and '〔법령 근거〕' in full401 and '- 1.1 (〔시행일〕)' in full401
   and bool(D402) and len(mig) in (243, 244, 245, 246, 247, 248, 249, 250, 251) and tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 271),
   f"{sorted(set(re.findall('〔[^〕]*〕', full400)))} · {len(mig)} · {VER}")


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        raw = urllib.request.urlopen(r, timeout=120).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b'{}')
        except Exception:
            body = {}
        return {'_err': e.code, 'code': body.get('code')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-c', sql], capture_output=True, text=True)
    return r.stdout.strip()


if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    consent_ok.agree('buyer@x.com', PW)
    TS = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    TB = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW}).get('accessToken')
    rates = call('GET', '/admin/health/commission-rates', None, TS)
    ok('② 갈래 요율 — ADMIN 봄(목록) · 회원 403', isinstance(rates, list) and call('GET', '/admin/health/commission-rates', None, TB).get('_err') == 403,
       f"{rates if not isinstance(rates, list) else len(rates)}")
    # 회원 상세 관계도가 그려지게 — buyer 에게 2줄이 없으면 가입 2명
    tr0 = call('GET', '/me/recommend/tree', None, TB) if TB else {}
    if TB and not any((n_.get('gen') or 0) >= 2 for n_ in tr0.get('nodes') or []):
        stamp = str(int(time.time()))[-7:]
        bcode = psql("SELECT recommend_code FROM accounts WHERE email = 'buyer@x.com'")
        call('POST', '/auth/signup', {'email': f'rcm70-a-{stamp}@t.local', 'password': 'Sgb-test-1270!', 'name': '운영가나', 'recommendCode': bcode})
        acode = psql(f"SELECT recommend_code FROM accounts WHERE email = 'rcm70-a-{stamp}@t.local'")
        call('POST', '/auth/signup', {'email': f'rcm70-b-{stamp}@t.local', 'password': 'Sgb-test-1270!', 'name': '운영다라', 'recommendCode': acode})
    bid = psql("SELECT id FROM accounts WHERE email = 'buyer@x.com'")
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if ADMIN_WEB and sync_playwright:
        seen, errs = {}, []
        try:
            with sync_playwright() as p:
                b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 1000})
                pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                pg.wait_for_selector('[data-state-check]', timeout=30000)
                pg.goto(ADMIN_WEB + '/#/hlt-sellers', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                seen['sim0'] = pg.locator('[data-hlt-sim]').first.get_attribute('data-hlt-sim') if pg.locator('[data-hlt-sim]').count() else None
                if seen['sim0'] is not None:
                    for k, v in (('bn', '2'), ('bs', '1000000'), ('br', '10'), ('gn', '0'), ('gs', '1000000'), ('gr', '10'), ('pg', '0')):
                        pg.fill(f'[data-hlt-sim-in="{k}"]', v)
                    pg.wait_for_timeout(300)
                    seen['sim'] = pg.locator('[data-hlt-sim]').first.get_attribute('data-hlt-sim')
                    seen['vat'] = pg.locator('[data-hlt-sim-out="vat"]').inner_text()
                    seen['rates'] = pg.locator('[data-hlt-sim-rates]').first.get_attribute('data-hlt-sim-rates')
                pg.goto(ADMIN_WEB + '/#/members', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(1500)
                pg.fill('input[aria-label="회원 검색"]', 'buyer@x.com'); pg.locator('form.search-row button[type=submit]').click(); pg.wait_for_timeout(2000)
                pg.locator('[data-member-list] tbody tr button.linkbtn').first.click(); pg.wait_for_timeout(2500)
                pg.click(f'[data-member-rcm="{bid}"]'); pg.wait_for_timeout(2500)
                seen['layout'] = pg.locator('[data-rcm-graph]').first.get_attribute('data-rcm-layout') if pg.locator('[data-rcm-graph]').count() else None
                xy = pg.evaluate("""() => [...document.querySelectorAll('[data-rcm-graph] svg > g > g')].map(g => {
                    const m = /translate\\(([-\\d.]+),([-\\d.]+)\\)/.exec(g.getAttribute('transform') || ''); return m ? [+m[1], +m[2]] : null; }).filter(Boolean)""")
                seen['boxes'] = len(xy)
                seen['rows'] = len({v[1] for v in xy})
                seen['xs'] = sorted({v[0] for v in xy})[:4]
                b.close()
        except Exception as ex:
            errs.append(str(ex)[:160])
        ok('③ 운영 화면 소개몰 › 소개몰 판매자 › 수수료율 시뮬레이션(직영 2명 · 1,000,000원 · 10% → 한 달 200,000 · 1년 2,400,000 · 부가세 20,000) · '
           '회원 상세 「추천 관계도」 세로 가지(상자마다 다른 줄 · 들임 0 · 40 · 80) · 화면 오류 없음',
           seen.get('sim') == '200000|2400000' and '20,000원' in seen.get('vat', '') and seen.get('rates') not in (None, '')
           and seen.get('layout') == 'vertical' and seen.get('boxes', 0) >= 3 and seen.get('rows') == seen.get('boxes') and seen.get('xs', [])[:3] == [0, 40, 80] and not errs,
           f'{seen} · {errs[:2]}')
    else:
        print('  (운영 화면 · playwright 없음 — ③ 건너뜀)')
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
