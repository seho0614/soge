"""v10.212 (docs/340) — 약관 화면 옛 판 정리 · 빈칸 수 맞추기 · 운영 상태 한눈에

  ① (코드) 약관 표: 같은 약관은 높은 판이 위 · 더 새 초안이 있는 옛 판은 「고치기」 대신 「2.0 초안 고치기」 · 동네 인증 빈칸에서 〔시행일〕 뺌
     · 운영 상태 한눈에(서비스 · API state · 첫 화면 카드 · 명세) · 문서 340 · 판
  ② (API) 상태 10줄(키 · state 값 · go) · 회원 403 · 동네 인증 준비 상태 빈칸에 〔시행일〕 없음
  ③ (화면) 약관: LOCATION 2.0 초안이 1.0 위 · 1.0 줄 「2.0 초안 고치기」 → 2.0 편집 칸 · 첫 화면 「운영 상태 한눈에」 10줄
"""
import json, os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'
KEYS = ['ai', 'terms', 'outsource', 'holidays', 'plans', 'open-stock', 'mail', 'town', 'town-pick', 'alerts']
V214 = 'terms-upcoming'  # v10.214 에 더해진 줄(test_v1214 가 봄) — 이 시험은 v10.212 의 10줄만 셈


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


TP, TS_, TR = rd('web/src/app/admin/TermsPanel.tsx'), rd('src/modules/community/town-verify.service.ts'), rd('web/src/app/admin/TownReadiness.tsx')
ok('① 약관 표 — 높은 판 위(byCodeNewest) · 더 새 초안이면 옛 판 「고치기」 대신 그 초안 고치기 · 「새 판이 있음」 표시',
   'function byCodeNewest(' in TP and 'function newerDraft(' in TP and '{byCodeNewest(data).map((t) => {' in TP
   and 'data-term-go-draft=' in TP and 'data-term-newer=' in TP and "startEdit(nd, data)" in TP and 'data-term-edit' in TP, '')
ok('① 동네 인증 빈칸 — 〔시행일〕 뺌(약관 표와 같은 셈) · 화면 설명',
   ".filter((h) => h !== '〔시행일〕')" in TS_ and '〔시행일〕은 게시 때 정한 날로 채워져 세지 않음' in TR, '')
SV, C, D, AM, SC = (rd('src/modules/admin/state-check.service.ts'), rd('src/modules/admin/launch-watch.controller.ts'), rd('web/src/app/admin/StateCheck.tsx'),
                    rd('src/app.module.ts'), rd('spec/screens.json'))
ok('① 운영 상태 한눈에 — 10줄 · API state(@ApiOkResponse) · 서비스 등록 · 첫 화면 카드 · 명세',
   all(f"key: '{k}'" in SV for k in KEYS) and 'this.terms.outsourceCheck()' in SV and 'this.town.readiness()' in SV
   and "@Get('state')" in C and 'stateRows() { return this.state.rows(); }' in C and '    StateCheckService,' in AM
   and "useApi<Row[]>('/admin/launch-watch/state'" in D and '<StateCheck onGo={onGo} canGo={canGo} />' in rd('web/src/app/admin/Dashboard.tsx')
   and '"GET /admin/launch-watch/state"' in SC, '')
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('340_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 문서 340 · 판 v10.212 이상', bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 212), f'{DOC} · {rd("VERSION").strip()}')


def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m)
    try:
        raw = urllib.request.urlopen(r, timeout=120).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b'{}')
        except Exception:
            body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return r.stdout.strip() if not r.returncode else ('!' + r.stderr.strip()[:200])


if API and DB:
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import consent_ok
    # 점검판 시드는 LOCATION 을 모두 보관으로 둠 → 이 시험 동안만 2.0 을 초안으로(운영과 같은 모양) · 끝나면 원래 상태
    s20 = psql("SELECT status FROM terms WHERE code = 'LOCATION' AND version = '2.0'")
    try:
        if s20 and not s20.startswith('!') and s20 != 'DRAFT':
            psql("UPDATE terms SET status = 'DRAFT' WHERE code = 'LOCATION' AND version = '2.0'")
        consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
        TA = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
        TB = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW}).get('accessToken')
        st = call('GET', '/admin/launch-watch/state', None, TA)
        mb = call('GET', '/admin/launch-watch/state', None, TB)
        rows = st if isinstance(st, list) else []
        ok('② 상태 10줄 — 키 · state(ok · todo · warn · info) · go · 지금 값 · 회원 403',
           [r.get('key') for r in rows if r.get('key') != V214] == KEYS and all(r.get('state') in ('ok', 'todo', 'warn', 'info') and r.get('go') and r.get('now') for r in rows)
           and mb.get('_err') == 403, f'{[(r.get("key"), r.get("state")) for r in rows]} · {mb.get("_err")}')
        town = next((r for r in rows if r.get('key') == 'town'), {})
        trm = next((r for r in rows if r.get('key') == 'terms'), {})
        ok('② 동네 인증 · 약관 줄 — LOCATION 2.0 초안 빈칸 4(〔시행일〕 뺌) · 약관 줄에 같은 수',
           '2.0 초안(빈칸 4)' in town.get('now', '') and '위치기반서비스 이용약관 2.0 〔미확정〕 4곳' in trm.get('now', ''), f"{town.get('now')} · {trm.get('now', '')[:120]}")
        rdy = call('GET', '/admin/community/town-verify/readiness', None, TA)
        holes = ((rdy.get('terms') or {}).get('draft') or {}).get('holes') or []
        ok('② 준비 상태 빈칸 — 〔시행일〕 없음 · 〔보관 기간〕 있음 · 4개', '〔시행일〕' not in holes and '〔보관 기간〕' in holes and len(holes) == 4, f'{holes}')

        if ADMIN_WEB:
            try:
                from playwright.sync_api import sync_playwright
            except Exception:
                sync_playwright = None
            seen, errs = {}, []
            if sync_playwright:
                try:
                    with sync_playwright() as p:
                        b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 1000})
                        pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                        pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                        pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                        pg.wait_for_selector('[data-state-check]', timeout=30000)
                        seen['state'] = pg.evaluate("() => [...document.querySelectorAll('[data-state-row]')].map(e => e.getAttribute('data-state-row')).join(',')")
                        pg.goto(ADMIN_WEB + '/#/terms', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                        seen['order'] = pg.evaluate("() => [...document.querySelectorAll('[data-term-row^=\"LOCATION:\"]')].map(e => e.getAttribute('data-term-row')).join(',')")
                        old = pg.locator('[data-term-row="LOCATION:1.0"]')
                        seen['oldEdit'] = old.locator('[data-term-edit]').count()
                        seen['newer'] = old.locator('[data-term-newer]').get_attribute('data-term-newer') if old.locator('[data-term-newer]').count() else ''
                        old.locator('[data-term-go-draft="LOCATION:2.0"]').click(); pg.wait_for_timeout(800)
                        ed = pg.locator('[data-term-editor="LOCATION:2.0"]')
                        seen['editor'] = ed.count()
                        seen['ver'] = ed.locator('[data-term-ver]').input_value() if ed.count() else ''
                        seen['body'] = '제1조(목적)' in (ed.locator('[data-term-text]').input_value() if ed.count() else '')
                        b.close()
                except Exception as ex:
                    errs.append(str(ex)[:160])
            ok('③ 첫 화면 「운영 상태 한눈에」 10줄', ','.join(k for k in (seen.get('state') or '').split(',') if k != V214) == ','.join(KEYS) and not errs, f"{seen.get('state')} · {errs[:2]}")
            ok('③ 약관 — 2.0 초안이 1.0 위 · 1.0 줄 「고치기」 없음 · 「새 판 2.0」 표시 · 누르면 2.0 편집 칸(판 2.0 · 새 본문)',
               seen.get('order') == 'LOCATION:2.0,LOCATION:1.0' and seen.get('oldEdit') == 0 and seen.get('newer') == '2.0'
               and seen.get('editor') == 1 and seen.get('ver') == '2.0' and seen.get('body') and not errs, f'{seen} · {errs[:2]}')
    finally:
        if s20 and not s20.startswith('!') and s20 != 'DRAFT':
            psql(f"UPDATE terms SET status = '{s20}' WHERE code = 'LOCATION' AND version = '2.0'")

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
