"""버튼 체크 — 운영 화면(BO)의 단추를 상태(탭 › 하위 탭)마다 하나씩 눌러 반응을 기록합니다.  (v10.25 점검 보강 · 2026-10-08)

  · 상태 = 계정 × 위 탭 × 하위 탭(2단계까지). 탭은 **순서 번호**로 누릅니다(글자로 찾으면 「광고」가 「광고 과금」에, 「감사」가 「표본 감사」에 걸립니다 — G-170).
  · 상태마다 본문(.bo-main)의 단추를 누르기 전마다 쪽을 새로 열고 그 상태로 다시 들어갑니다.
  · GET 이 아닌 요청은 서버에 닿기 전에 막고 422 를 돌려줍니다(자료를 바꾸지 않음) → 「요청 METHOD 경로 [막음]」으로 기록.
  · 같은 모양 단추가 줄마다 되풀이되면 상태마다 3개까지만 누릅니다. 하위 탭 단추는 상태 전환 자체로 확인하므로 누르는 목록에서 뺍니다.

사용:  python3 btn_bo.py <email> [shard/of]     결과: btn_bo_<이름>[_shard].json
"""
import json, os, re, sys, time
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flow_lib import bo_tab   # v10.29 — 묶음 단추 → 묶음 안 탭(.ad-snb)
HERE = os.path.dirname(os.path.abspath(__file__))
QA = os.environ.get('QA', '/home/claude/qa'); sys.path.append(QA)   # v10.31 (w6 사본) — btn_site.py · consent_ok 는 원래 qa 폴더
src = open(f'{HERE}/btn_site.py' if os.path.exists(f'{HERE}/btn_site.py') else f'{QA}/btn_site.py', encoding='utf8').read()
def _const(name):
    m = re.search(name + r' = r"""(.*?)"""', src, re.S); return m.group(1)
ENUM, WATCH, AFTER = _const('ENUM'), _const('WATCH'), _const('AFTER')
BASE = os.environ.get('BO', 'http://127.0.0.1:5173')
email = sys.argv[1] if len(sys.argv) > 1 else 'admin@x.com'
shard = sys.argv[2] if len(sys.argv) > 2 else '0/1'
SI, SN = map(int, shard.split('/'))
pwd = 'sgb-dev-1234' if email.endswith('x.com') else 'sgb-test-1234'
name = email.split('@')[0] + (f'_{SI}' if SN > 1 else '')
REP = 3
BLOCK = json.dumps({'statusCode': 422, 'code': 'BTN_CHECK', 'message': '단추 점검 — 이 요청은 서버로 보내지 않았습니다.'}, ensure_ascii=False)
norm_api = lambda p: re.sub(r'/[0-9a-f]{8}-[0-9a-f-]{27,}|/\d+(?=/|$)|/H\d{8,}', '/{}', re.sub(r'^/api/v1', '', p))
# v10.29 — 상단은 묶음 단추(data-tabs="|탭|탭|"). 탭 목록 = 묶음마다 data-tabs 를 펼친 것(묶음 × .ad-snb 탭)
TABS = "[...document.querySelectorAll('.bo-head nav button')].flatMap(b=>(b.getAttribute('data-tabs')||'').split('|').filter(Boolean))"
# v10.31 — 하위 탭 줄의 「다른 탭으로 옮기는 단추」(data-out)는 상태가 아니라 이동이라 빼고 셉니다
SUBS = lambda n: f"(document.querySelectorAll('.bo-main .subtabs')[{n}] ? [...document.querySelectorAll('.bo-main .subtabs')[{n}].querySelectorAll('button:not([data-out])')].map(b=>b.innerText.trim()) : [])"

out = {'user': email, 'shard': shard, 'states': [], 'at': time.strftime('%F %T')}
with sync_playwright() as pw:
    br = pw.chromium.launch(); ctx = br.new_context(viewport={'width': 1440, 'height': 900}); pg = ctx.new_page()
    state = {'reqs': [], 'dialogs': [], 'errs': [], 'pops': 0, 'arm': False, 'dl': 0}
    def on_route(route):
        req = route.request
        if req.method in ('GET', 'HEAD', 'OPTIONS') or not state['arm']: return route.continue_()
        # 운영 화면은 로그인 토큰을 머리말(Authorization)로 보냅니다 — 빠져 있으면 서버가 403 으로 거절할 요청입니다(G-178)
        state['reqs'].append(f"{req.method} {norm_api(urlparse(req.url).path)}" + ('' if req.headers.get('authorization') or '/auth/' in req.url else ' [토큰 없음]') + ' [막음]')
        route.fulfill(status=422, content_type='application/json', body=BLOCK)
    ctx.route('**/api/**', on_route)
    pg.on('request', lambda req: state['reqs'].append(f"GET {norm_api(urlparse(req.url).path)}") if state['arm'] and req.method == 'GET' and '/api/' in req.url else None)
    def on_dialog(d):
        state['dialogs'].append(f"{d.type}: {d.message[:60]}")
        try: d.accept('단추 점검') if d.type == 'prompt' else d.accept()
        except Exception: pass
    pg.on('dialog', on_dialog)
    pg.on('pageerror', lambda e: state['errs'].append(str(e)[:140]))
    pg.on('download', lambda d: state.__setitem__('dl', state['dl'] + 1))
    ctx.on('page', lambda p: (state.__setitem__('pops', state['pops'] + 1), p.close()) if p != pg else None)

    pg.goto(BASE); pg.wait_for_timeout(800)
    __import__('consent_ok').agree(email, pwd); pg.fill('input[name=email]', email); pg.fill('input[name=password]', pwd); pg.click('form button[type=submit]'); pg.wait_for_timeout(1500)
    tabs = pg.evaluate(TABS)
    out['tabs'] = tabs
    if not tabs:
        out['alert'] = pg.evaluate("document.querySelector('[role=alert]')?.innerText||''")

    def nav(path, fresh=True):
        """path = (탭 번호, 하위 번호 | None, 둘째 하위 번호 | None)"""
        state['arm'] = False
        if fresh:
            if os.environ.get('BO_DEBUG'): print('  ss before reload', pg.evaluate("Object.keys(sessionStorage)"), file=sys.stderr, flush=True)
            pg.reload()
            try: pg.wait_for_selector('.bo-head nav button', timeout=15000)
            except Exception:
                print('  (새로 고침 뒤 탭이 안 보임)', pg.url, repr(pg.inner_text('body')[:160]), state['errs'][-2:], file=sys.stderr, flush=True)
                if pg.locator('input[name=email]').count():       # 로그인이 풀렸으면 다시 로그인
                    __import__('consent_ok').agree(email, pwd); pg.fill('input[name=email]', email); pg.fill('input[name=password]', pwd); pg.click('form button[type=submit]')
                pg.wait_for_selector('.bo-head nav button', timeout=15000)
            pg.wait_for_timeout(300)
        if not bo_tab(pg, tabs[path[0]]): print('  (탭을 못 찾음)', tabs[path[0]], file=sys.stderr, flush=True)   # v10.29
        if path[1] is not None:
            pg.locator('.bo-main .subtabs').first.locator('button:not([data-out])').nth(path[1]).click(); pg.wait_for_timeout(600)
        if path[2] is not None:
            pg.locator('.bo-main .subtabs').nth(1).locator('button:not([data-out])').nth(path[2]).click(); pg.wait_for_timeout(600)
        try: pg.wait_for_load_state('networkidle', timeout=5000)
        except Exception: pass

    # 1) 상태 목록
    paths = []
    for ti, t in enumerate(tabs):
        if ti % SN != SI: continue
        nav((ti, None, None), fresh=False)
        subs = pg.evaluate(SUBS(0))
        paths.append(((ti, None, None), t))
        for si, sname in enumerate(subs):
            if si == 0: continue                     # 첫 하위 탭은 탭을 열면 이미 보이는 상태
            nav((ti, si, None), fresh=False)
            paths.append(((ti, si, None), f'{t} › {sname}'))
            subs2 = pg.evaluate(SUBS(1))
            for s2i, s2 in enumerate(subs2):
                if s2i == 0: continue
                paths.append(((ti, si, s2i), f'{t} › {sname} › {s2}'))
        if subs:                                      # 첫 하위 탭 아래의 둘째 하위 탭
            nav((ti, 0, None), fresh=False)
            for s2i, s2 in enumerate(pg.evaluate(SUBS(1))):
                if s2i == 0: continue
                paths.append(((ti, 0, s2i), f'{t} › {subs[0]} › {s2}'))
    print(name, '상태', len(paths), file=sys.stderr, flush=True)

    # 2) 상태마다 단추를 하나씩
    for path, label in paths:
        nav(path)
        try: items = [x for x in pg.evaluate(ENUM)]
        except Exception: items = []
        main_ids = set(pg.evaluate("[...document.querySelectorAll('.bo-main [data-bc]')].map(e=>+e.getAttribute('data-bc'))"))
        sub_ids = set(pg.evaluate("[...document.querySelectorAll('.bo-main .subtabs [data-bc], .bo-main .ad-snb [data-bc]')].map(e=>+e.getAttribute('data-bc'))"))   # v10.29 — 묶음 안 탭 줄(.ad-snb)도 상태 전환이라 누르는 목록에서 뺌
        head_ids = set(pg.evaluate("[...document.querySelectorAll('.bo-head [data-bc]')].filter(e=>!e.closest('nav')).map(e=>+e.getAttribute('data-bc'))"))
        rec = {'state': label, 'path': path, 'n_main': len(main_ids - sub_ids), 'n_subtab': len(sub_ids), 'buttons': [],
               'len': pg.evaluate("(document.querySelector('.bo-main')||{innerText:''}).innerText.length")}
        sig_count = {}; dirty = False
        for it in items:
            i = it['i']
            if i in sub_ids: continue
            if i in head_ids:
                if out['states']: continue               # 머리줄의 탭 아닌 단추(로그아웃 등)는 계정마다 한 번
            elif i not in main_ids: continue
            row = {k: it[k] for k in ('tag', 'type', 'text', 'cls', 'disabled', 'handler', 'inForm', 'title')}
            row['region'] = '머리줄' if i in head_ids else '본문'
            sig = (it['tag'], it['cls'], re.sub(r'\d+', '#', it['text']))
            sig_count[sig] = sig_count.get(sig, 0) + 1
            if it['disabled']: row['result'] = '꺼짐'; rec['buttons'].append(row); continue
            if sig_count[sig] > REP: row['result'] = '같은 단추(대표만)'; rec['buttons'].append(row); continue
            idx = i
            if dirty:
                nav(path)
                try: now = pg.evaluate(ENUM)
                except Exception: now = []
                cand = [x for x in now if x['i'] == i and x['text'] == it['text'] and x['tag'] == it['tag']] or \
                       [x for x in now if x['text'] == it['text'] and x['tag'] == it['tag'] and x['cls'] == it['cls']]
                if not cand: row['result'] = '다시 열었더니 없음'; rec['buttons'].append(row); continue
                idx = cand[0]['i']
            # v10.41 — 접힌 칸(<details>) 안의 단추는 사람이 하듯 그 칸을 먼저 펼친 뒤 누릅니다(위험감지 경보 「조치 완료 · 오탐」 — 열린 경보가 생기면 나타남)
            try: pg.evaluate("i => { let e = document.querySelector(`[data-bc='${i}']`); while (e && (e = e.closest('details:not([open])'))) { e.open = true; e = e.parentElement; } }", str(idx))
            except Exception: pass
            state['reqs'].clear(); state['dialogs'].clear(); state['errs'].clear(); state['pops'] = 0; state['dl'] = 0
            before = pg.url
            try: pg.evaluate(WATCH)
            except Exception: pass
            state['arm'] = True; click_err = ''
            try: pg.locator(f'[data-bc="{idx}"]').first.click(timeout=2500)
            except Exception as ex: click_err = str(ex).split('\n')[0][:90]
            pg.wait_for_timeout(600)
            try: pg.wait_for_load_state('networkidle', timeout=4000)
            except Exception: pass
            try: a = pg.evaluate(AFTER, str(idx))
            except Exception: a = {'m': 0, 'gone': True}
            state['arm'] = False
            react = []
            if pg.url != before: react.append('주소 → ' + urlparse(pg.url).path)
            if state['dialogs']: react.append('안내창 ' + state['dialogs'][0])
            blocked = [x for x in state['reqs'] if x.endswith('[막음]')]; gets = [x for x in state['reqs'] if not x.endswith('[막음]')]
            if blocked: react.append('요청 ' + blocked[0])
            if gets: react.append('조회 ' + gets[0])
            if state['pops'] or a.get('open'): react.append('새 창')
            if state['dl']: react.append('내려받기')
            if a.get('clip'): react.append('복사')
            if a.get('m'): react.append(f"화면 바뀜({a['m']})")
            if a.get('invalid') and not blocked: react.append('입력 검사(필수 항목)')
            if a.get('scrolled'): react.append('스크롤')
            if a.get('store'): react.append('저장소 바뀜')
            if a.get('focus') and not react: react.append('포커스 이동')
            row['react'] = react; row['requests'] = state['reqs'][:6]; row['errors'] = state['errs'][:2]
            if any('[토큰 없음]' in x for x in state['reqs']): row['result'] = '요청에 로그인 토큰이 없음'
            elif click_err: row['result'] = '누를 수 없음'; row['why'] = click_err
            elif react: row['result'] = '반응 있음'
            elif it['handler'] and '처리기 없음' not in it['handler']: row['result'] = '무반응(처리기 있음)'
            else: row['result'] = '죽은 단추'
            rec['buttons'].append(row); dirty = True
        out['states'].append(rec)
        c = {}
        for b in rec['buttons']: c[b['result']] = c.get(b['result'], 0) + 1
        bad = [b['text'] for b in rec['buttons'] if b['result'] in ('죽은 단추', '무반응(처리기 있음)', '누를 수 없음', '요청에 로그인 토큰이 없음')]
        print(('!!' if bad else '  '), name, label, c, bad[:4], file=sys.stderr, flush=True)
        json.dump(out, open(f'{HERE}/btn_bo_{name}.json', 'w'), ensure_ascii=False)
    br.close()
tot = {}
for s in out['states']:
    for b in s['buttons']: tot[b['result']] = tot.get(b['result'], 0) + 1
out['total'] = tot
json.dump(out, open(f'{HERE}/btn_bo_{name}.json', 'w'), ensure_ascii=False)
print(name, '상태', len(out['states']), '단추', sum(tot.values()), tot)
