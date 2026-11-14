"""v10.267 ~ v10.269 (docs/397) — 추천 관계도 세로 가지 · 접속 인증 켜는 순서 · 요금제 금액 시뮬레이션 (+ 입점 약관 빈칸 묶음 docs/398)

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 SITE=http://localhost:15174 python3 test_v1267.py

  ① (코드) 세로 가지(한 사람 한 줄 · 들임 · 휴대폰도 그림 · 300명 넘으면 목록) · 켜는 순서(받아 온 상태로만 · 4단계 · 켜기는 아래 스위치) ·
     요금제 시뮬레이션(계산만 · api 없음 · 부가세) · 문서 397 · 398 · 마이그레이션 243 · 판 v10.269 이상
  ② (API) 접속 인증 개요 · 요금제 목록에 화면이 쓰는 칸이 있음 · 회원 403
  ③ (화면) 사용자 웹 나의공간 추천 관계도 — 세로 가지(줄마다 다른 높이 · 자식은 부모보다 오른쪽) · 휴대폰 폭도 그림 ·
     운영 화면 접속 인증 「켜는 순서」 = API 로 셈한 단계 · 청구 › 요금제 시뮬레이션(100명 · 한 요금제 100% · 10,000원 · 12달 → 1,000,000 | 12,000,000) · 화면 오류 없음
  읽기만 — 바꾸는 설정 없음(두 번 돌아도 통과).
"""
import json, os, re, subprocess, urllib.error, urllib.request
# 혼자 돌려도(새 DB) 시험 회원이 약관 동의 화면으로 가지 않게 · 실패해도 멈추지 않음(consent_ok)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB = os.environ.get('ADMIN_WEB')
SITE = os.environ.get('SITE')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


VER = rd('VERSION').strip()
RT, SA, PP = rd('site/src/components/recommend/RcmTree.tsx'), rd('web/src/app/admin/StaffAccess.tsx'), rd('web/src/app/admin/PlanPanel.tsx')

ok('① v10.267 세로 가지 — 한 사람 한 줄(row) · 들임(IX) · 선은 부모 아래 → 오른쪽 상자 옆 · 휴대폰도 그림(300명 넘을 때만 목록) · 큰 그림 0.6 아래로 안 줄임 · 한국어 글자 없음',
   'data-rcm-layout="vertical"' in RT and 'x: d * IX, y: row * (H + GY)' in RT and 'if (!compact && nodes.length > 300)' in RT and 'window.innerWidth < 640' not in RT
   and 'compact ? 0.2 : 0.6' in RT and '`M${x1},${y1} V${y2} H${x2}`' in RT and not re.search(r'[가-힣]', re.sub(r'/\*[\s\S]*?\*/|//[^\n]*', '', RT)), '')
seg = SA[SA.index('function accessSteps('):] if 'function accessSteps(' in SA else ''
ok('① v10.268 접속 인증 켜는 순서 — 맨 위 상자 · 4단계(허용 IP · 보내는 길 · 운영자 받을 곳 · 켜기) · 받아 온 상태로만(api 없음) · 켜기는 아래 스위치',
   bool(seg) and '<AccessFlow d={d} />' in SA and 'data-ip-flow=' in seg and 'data-ip-flow-step=' in seg and 'api(' not in seg
   and "d.staff.filter((s) => !s.receive).length" in seg and 'data-ip-toggle' in SA, '')
sim = PP[PP.index('function planSim('):] if 'function planSim(' in PP else ''
ok('① v10.269 요금제 시뮬레이션 — 계산만(api 없음) · 지금 금액 불러옴 · 구독자 = 수 × 비율 버림 · 기간(달마다 늚) · 부가세(÷ 1.1) · 비율 합계 경고',
   bool(sim) and '<PlanSim plans={d.plans} />' in PP and 'api(' not in sim and 'Math.floor((n * r.pct) / 100)' in sim and 'Math.floor(month / 1.1)' in sim
   and 'data-plan-sim=' in sim and 'data-plan-sim-pctwarn=' in sim and 'String(p.monthlyPrice)' in sim, '')
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []
D397 = [f for f in docs if f.startswith('397_')]
D398 = [f for f in docs if f.startswith('398_')]
t398 = open(os.path.join(K, 'docs', D398[0]), encoding='utf-8').read() if D398 else ''
mig = [d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isfile(os.path.join(K, 'prisma/migrations', d, 'migration.sql'))] if os.path.isdir(os.path.join(K, 'prisma/migrations')) else []
ok('① 문서 397 · 398(입점 약관 빈칸 10곳 · 「회원(개인 또는 사업자)」 · 법무 물음) · 마이그레이션 없음(243) · 판 v10.269 이상',
   bool(D397) and bool(D398) and '회원(개인 또는 사업자)' in t398 and '제21조' in t398 and len(mig) in (243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253)
   and tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 269), f'{D397} · {D398} · {len(mig)} · {VER}')


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


def steps(d):
    """StaffAccess.tsx accessSteps 와 같은 셈(1단계는 지금 주소에 따라 OK · WARN 이라 따로 봄)"""
    tg = (d.get('telegram') or {}).get('reason') != 'NO_TOKEN'
    sms = (d.get('sms') or {}).get('ready')
    way = sms if d.get('mode') == 'SMS' else tg if d.get('mode') == 'TELEGRAM' else (sms or tg)
    staff = d.get('staff') or []
    s1 = 'NO' if not d.get('allow') else 'OKWARN'
    s2 = 'OK' if way else 'NO'
    s3 = 'OK' if staff and all(s.get('receive') for s in staff) else 'NO'
    s4 = 'OK' if d.get('on') else ('READY' if s1 != 'NO' and s2 == 'OK' and s3 == 'OK' else 'WAIT')
    return [s1, s2, s3, s4]


if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    consent_ok.agree('buyer@x.com', PW)
    TS = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    TB = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW}).get('accessToken')
    ov = call('GET', '/admin/staff-access', None, TS)
    pl = call('GET', '/admin/billing/plans', None, TS)
    plans = pl.get('plans') or []
    ok('② 접속 인증 개요 — 화면이 쓰는 칸(on · mode · sms · telegram · allow · staff[].receive · myIpFull) · 요금제 목록 monthlyPrice · 회원 403',
       all(k in ov for k in ('on', 'mode', 'sms', 'telegram', 'allow', 'staff', 'myIpFull')) and all('receive' in s for s in ov.get('staff') or [])
       and len(plans) >= 2 and all(isinstance(p.get('monthlyPrice'), int) for p in plans)
       and call('GET', '/admin/staff-access', None, TB).get('_err') == 403 and call('GET', '/admin/billing/plans', None, TB).get('_err') == 403,
       f"{steps(ov) if '_err' not in ov else ov} · 요금제 {[(p.get('code'), p.get('monthlyPrice')) for p in plans]}")
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    # ── ③ 사용자 웹 — 세로 가지 ──
    # 혼자 돌면(새 DB) buyer 에게 추천한 분이 없어 관계도가 없음(11/13 처음 돌 때 상자 0) → 2줄(buyer → A → B)이 없을 때만 가입으로 만듦
    if SITE and sync_playwright and TB:
        tr0 = call('GET', '/me/recommend/tree', None, TB)
        if not any((n_.get('gen') or 0) >= 2 for n_ in tr0.get('nodes') or []):
            import time
            stamp = str(int(time.time()))[-7:]
            bcode = subprocess.run(['psql', DB, '-X', '-At', '-c', "SELECT recommend_code FROM accounts WHERE email = 'buyer@x.com'"], capture_output=True, text=True).stdout.strip()
            call('POST', '/auth/signup', {'email': f'rcm67-a-{stamp}@t.local', 'password': 'Sgb-test-1267!', 'name': '세로가나', 'recommendCode': bcode})
            acode = subprocess.run(['psql', DB, '-X', '-At', '-c', f"SELECT recommend_code FROM accounts WHERE email = 'rcm67-a-{stamp}@t.local'"], capture_output=True, text=True).stdout.strip()
            call('POST', '/auth/signup', {'email': f'rcm67-b-{stamp}@t.local', 'password': 'Sgb-test-1267!', 'name': '세로다라', 'recommendCode': acode})
        tr1 = call('GET', '/me/recommend/tree', None, TB)
        ok('③ 준비 — buyer 의 추천 관계도 2줄 이상(없으면 가입으로 만듦)', any((n_.get('gen') or 0) >= 2 for n_ in tr1.get('nodes') or []), f"{tr1.get('total')}")
    if SITE and sync_playwright:
        seen, errs = {}, []
        try:
            with sync_playwright() as p:
                b = p.chromium.launch()
                for w in (1400, 390):
                    pg = b.new_page(viewport={'width': w, 'height': 1000})
                    pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                    pg.goto(SITE + '/login'); pg.fill('input[name=email]', 'buyer@x.com'); pg.fill('input[name=password]', PW)
                    pg.click('form.auth button'); pg.wait_for_timeout(2000)
                    pg.goto(SITE + '/my/recommend', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(800)
                    tr = pg.locator('[data-rcm-tree]').first
                    seen[f'mode{w}'] = tr.get_attribute('data-rcm-tree') if pg.locator('[data-rcm-tree]').count() else None
                    seen[f'layout{w}'] = tr.get_attribute('data-rcm-layout') if pg.locator('[data-rcm-tree]').count() else None
                    if w == 1400:
                        xy = pg.evaluate("""() => [...document.querySelectorAll('[data-rcm-tree] g[data-rcm-node]')].map(g => {
                            const m = /translate\\(([-\\d.]+),([-\\d.]+)\\)/.exec(g.getAttribute('transform') || ''); return m ? [+m[1], +m[2], +g.getAttribute('data-rcm-gen')] : null; })""")
                        xy = [v for v in xy if v]
                        seen['boxes'] = len(xy)
                        seen['rows'] = len({v[1] for v in xy})
                        seen['indent'] = all(v[0] == v[2] * xy[1][0] for v in xy) if len(xy) > 1 and xy[1][0] > 0 else False
                    pg.close()
                b.close()
        except Exception as ex:
            errs.append(str(ex)[:160])
        ok('③ 사용자 웹 나의공간 › 추천 관계도 — 세로 가지(상자마다 다른 줄 · 몇 번째 추천인지만큼 들임) · 휴대폰 폭(390)도 그림 · 화면 오류 없음',
           seen.get('layout1400') == 'vertical' and seen.get('mode1400') == 'graph' and seen.get('boxes', 0) >= 3 and seen.get('rows') == seen.get('boxes')
           and seen.get('indent') is True and seen.get('mode390') == 'graph' and not errs, f'{seen} · {errs[:2]}')
    else:
        print('  (사용자 웹 · playwright 없음 — ③ 사용자 웹 건너뜀)')
    # ── ③ 운영 화면 ──
    if ADMIN_WEB and sync_playwright:
        seen, errs = {}, []
        paid = [p_ for p_ in plans if p_.get('monthlyPrice', 0) > 0]
        try:
            with sync_playwright() as p:
                b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 1000})
                pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                pg.wait_for_selector('[data-state-check]', timeout=30000)
                pg.goto(ADMIN_WEB + '/#/staff-access', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2000)
                seen['flow'] = pg.locator('[data-ip-flow]').first.get_attribute('data-ip-flow') if pg.locator('[data-ip-flow]').count() else None
                seen['flowSteps'] = pg.locator('[data-ip-flow-step]').count()
                pg.goto(ADMIN_WEB + '/#/billing', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                seen['sim0'] = pg.locator('[data-plan-sim]').first.get_attribute('data-plan-sim') if pg.locator('[data-plan-sim]').count() else None
                seen['simPrice'] = {c: pg.locator(f'[data-plan-sim-price="{c}"]').input_value() for c in [p_['code'] for p_ in plans] if pg.locator(f'[data-plan-sim-price="{c}"]').count()}
                if paid and pg.locator('[data-plan-sim]').count():
                    pg.fill('[data-plan-sim-in="n"]', '100'); pg.fill('[data-plan-sim-in="months"]', '12'); pg.fill('[data-plan-sim-in="grow"]', '0')
                    for p_ in plans:
                        pg.fill(f'[data-plan-sim-pct="{p_["code"]}"]', '100' if p_['code'] == paid[0]['code'] else '0')
                    pg.fill(f'[data-plan-sim-price="{paid[0]["code"]}"]', '10000'); pg.wait_for_timeout(300)
                    seen['sim'] = pg.locator('[data-plan-sim]').first.get_attribute('data-plan-sim')
                    seen['warn'] = pg.locator('[data-plan-sim-pctwarn]').count()
                    seen['vat'] = pg.locator('[data-plan-sim-out="vat"]').inner_text()
                b.close()
        except Exception as ex:
            errs.append(str(ex)[:160])
        exp = steps(ov) if '_err' not in ov else None
        got = (seen.get('flow') or '').split('|')
        flow_ok = bool(exp) and len(got) == 4 and got[1:] == exp[1:] and ((got[0] == 'NO') if exp[0] == 'NO' else got[0] in ('OK', 'WARN'))
        ok('③ 운영 화면 권한 계층 › 접속 인증 「켜는 순서」 4줄 = API 로 셈한 단계 · 정산 › 청구 › 요금제 시뮬레이션(금액 = 표 · 100명 · 100% · 10,000원 · 12달 → 1,000,000 | 12,000,000 · 공급가액 909,090) · 화면 오류 없음',
           flow_ok and seen.get('flowSteps') == 4 and all(seen.get('simPrice', {}).get(p_['code']) == str(p_['monthlyPrice']) for p_ in plans)
           and seen.get('sim') == '1000000|12000000' and seen.get('warn') == 0 and '909,090' in seen.get('vat', '') and not errs,
           f'{seen} · 기대 {exp} · {errs[:2]}')
    else:
        print('  (운영 화면 · playwright 없음 — ③ 운영 화면 건너뜀)')
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
