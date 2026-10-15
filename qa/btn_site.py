"""버튼 체크 — 사용자 웹(실제 웹)의 단추를 하나씩 눌러 반응을 기록합니다.  (v10.25 점검 보강 · 2026-10-08)

무엇을 보나
  · 쪽마다 화면에 보이는 「누르는 것」 — button · input[type=submit|button] · [role=button] · [role=tab] · 주소 없는 a · summary
  · 하나씩 누르고(누르기 전마다 쪽을 새로 엶) 반응을 기록: 주소 바뀜 · 화면(DOM) 바뀜 · 요청 나감 · 안내창(confirm/alert) · 새 창 · 클립보드 · 입력 검사(필수 항목)
  · 아무 반응이 없으면 「무반응」 — 처리기(React onClick · form onSubmit/action)도 없으면 「죽은 단추」

안전 장치 (자료를 바꾸지 않음)
  · GET 이 아닌 요청(POST · PATCH · PUT · DELETE)은 **서버에 닿기 전에 막고** 422 를 돌려줍니다 → 「요청 나감: METHOD 경로」로만 기록
    (로그인 · 가입 폼의 서버 액션도 같은 방식 — 빈 폼은 브라우저의 필수 항목 검사에서 멈춥니다)
  · 그래서 「눌렀을 때 서버가 실제로 처리하는지」는 이 점검이 아니라 기능 검증 · flow 점검이 봅니다. 여기서는 단추 ↔ 처리기 ↔ API 주소 연결을 봅니다.

같은 단추가 줄마다 되풀이되면(목록의 「찜」 등) 쪽마다 같은 모양 3개까지만 누르고 나머지는 「같은 단추(대표만)」로 셉니다.
머리줄 · 바닥줄의 단추는 역할 × 틀 종류마다 한 번만 누릅니다(쪽마다 같으므로).

사용:  python3 btn_site.py <role> [--only /path,/path]     결과: btn_site_<role>.json
"""
import json, os, re, subprocess, sys, time
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

BASE = os.environ.get('SITE', 'http://localhost:5174')
DB = 'postgresql://sgb:sgb@localhost:5432/sgb'
HERE = os.path.dirname(os.path.abspath(__file__))
ROLES = {'guest': None, 'person': 'person@x.com', 'buyer': 'buyer@x.com', 'intro': 'intro@x.com', 'admin': 'admin@x.com'}
role = sys.argv[1] if len(sys.argv) > 1 else 'guest'
ONLY = None
if '--only' in sys.argv: ONLY = sys.argv[sys.argv.index('--only') + 1].split(',')
REP = 3      # 같은 모양 단추는 쪽마다 이만큼만 누름

def q(sql):
    return subprocess.run(['psql', DB, '-tAc', sql], capture_output=True, text=True).stdout.strip().split('\n')[0]

P = {
 'listing': q("select id from listings where status='PUBLISHED' and gwan_code='MNY' order by created_at desc limit 1"),
 'mal': q("select id from listings where status='PUBLISHED' and gwan_code='MAL' order by created_at desc limit 1"),
 'biz': q("select id from listings where status='PUBLISHED' and gwan_code='BIZ' order by created_at desc limit 1"),
 'request': q("select id from requests where status='PUBLISHED' limit 1"),
 'deal': q("select id from deals limit 1"),
 'contract': q("select id from deal_contracts limit 1") or q("select id from deals limit 1"),
 'svc': q("select id from partner_services limit 1"),
 'post': q("select id from posts order by (state='APPROVED') desc, created_at desc limit 1") or '00000000-0000-4000-a000-000000000000',
 'hprod': q("select code from hlt_products where status='ON_SALE' order by code limit 1"),
 'horder': q("select o.order_no from hlt_orders o join accounts a on a.id=o.account_id where a.email='buyer@x.com' order by o.created_at desc limit 1") or 'H00000000000',
 'mylisting': q("select l.id from listings l join accounts a on a.id=l.owner_account_id where a.email='intro@x.com' order by l.created_at desc limit 1") or q("select id from listings limit 1"),
}
ROUTES = json.load(open(f'{HERE}/site_routes.json')) + ['/biz', '/health', '/mall/{malId}', '/biz/{bizId}']
def fill(r):
    m = {'/{gwan}/{id}': f"/money/{P['listing']}", '/{gwan}': '/money', '/listings/{id}/edit': f"/listings/{P['mylisting']}/edit",
         '/request/{id}': f"/request/{P['request']}", '/deal/{id}/review': f"/deal/{P['deal']}/review", '/deal/{id}/contract': f"/deal/{P['deal']}/contract",
         '/deal/{id}/payment': f"/deal/{P['deal']}/payment", '/deal/{id}/confirm': f"/deal/{P['deal']}/confirm", '/chat/{id}': f"/chat/{P['listing']}",
         '/my/contracts/{id}': f"/my/contracts/{P['contract']}", '/partner/services/{id}': f"/partner/services/{P['svc']}",
         '/terms/{code}': '/terms/SERVICE', '/community/{id}': f"/community/{P['post']}", '/health/c/{code}': '/health/c/ALL', '/health/i/{code}': '/health/i/VIT-D',
         '/health/p/{code}': f"/health/p/{P['hprod']}", '/health/w/{code}': '/health/w/IMMUNE',
         '/my/health/orders/{no}': f"/my/health/orders/{P['horder']}", '/my/health/orders/{no}/ship': f"/my/health/orders/{P['horder']}/ship", '/i/{token}': '/i/invalid-token-check',
         '/report/{targetType}/{targetId}': f"/report/LISTING/{P['listing']}", '/mall/{malId}': f"/mall/{P['mal']}", '/biz/{bizId}': f"/biz/{P['biz']}"}
    return m.get(r, r)

# 화면에 보이는 「누르는 것」을 문서 순서대로 — 번호(data-bc)를 달아 둡니다
ENUM = r"""
() => {
  const sel = 'button, input[type=submit], input[type=button], [role=button], [role=tab], a:not([href]), a[href="#"], summary';
  const vis = e => { if (!e.getClientRects().length) return false; const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none' && s.pointerEvents !== 'none' || e.disabled; };
  const rp = e => { for (const k in e) if (k.startsWith('__reactProps$')) return e[k]; return null; };
  const handler = e => {
    let n = e, d = 0;
    while (n && n !== document.body && d < 6) {
      const p = rp(n);
      if (p && (p.onClick || p.onMouseDown || p.onPointerDown || p.onChange && n === e)) return d === 0 ? 'onClick' : 'onClick(위 ' + d + '단)';
      if (n.onclick) return 'onclick';
      n = n.parentElement; d++;
    }
    const f = e.closest('form');
    if (f && (e.type === 'submit' || (e.tagName === 'BUTTON' && !e.getAttribute('type')))) {
      const p = rp(f); if (p && (p.onSubmit || p.action)) return 'form ' + (p.onSubmit ? 'onSubmit' : 'action');
      if (f.getAttribute('action')) return 'form action';
      return 'form(처리기 없음)';
    }
    if (e.tagName === 'SUMMARY') return 'details';
    if (e.tagName === 'LABEL') return 'label';
    return '';
  };
  const region = e => e.closest('header, [role=banner]') ? '머리줄' : e.closest('footer, [role=contentinfo]') ? '바닥줄' : e.closest('dialog, [role=dialog], .modal') ? '창' : '본문';
  const out = []; let i = 0;
  for (const e of document.querySelectorAll(sel)) {
    if (!vis(e)) continue;
    const t = (e.innerText || e.value || e.getAttribute('aria-label') || e.title || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    e.setAttribute('data-bc', String(i));
    const cls = (typeof e.className === 'string' ? e.className : '').split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    out.push({ i: i++, tag: e.tagName.toLowerCase(), type: e.getAttribute('type') || '', text: t, cls,
      disabled: !!(e.disabled || e.getAttribute('aria-disabled') === 'true'), region: region(e), handler: handler(e),
      inForm: !!e.closest('form'), title: (e.title || e.getAttribute('aria-label') || '').slice(0, 60) });
  }
  return out;
}
"""
# 누르기 직전에 심는 관찰 도구
WATCH = r"""
() => {
  window.__bc = { m: 0, clip: 0, open: 0, scroll: [scrollX, scrollY], focus: document.activeElement && document.activeElement.tagName, ls: JSON.stringify(Object.entries(localStorage)).length, ss: JSON.stringify(Object.entries(sessionStorage)).length };
  new MutationObserver(l => { window.__bc.m += l.filter(x => !(x.type === 'attributes' && x.attributeName === 'data-bc')).length; }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  try { const w = navigator.clipboard && navigator.clipboard.writeText; if (w) navigator.clipboard.writeText = function () { window.__bc.clip++; return Promise.resolve(); }; } catch (e) {}
  const ec = document.execCommand; document.execCommand = function (c) { if (c === 'copy') window.__bc.clip++; return ec.apply(document, arguments); };
  const wo = window.open; window.open = function () { window.__bc.open++; return null; };
  const pr = window.print; window.print = function () { window.__bc.open++; };
}
"""
AFTER = r"""
(i) => {
  const b = window.__bc || {}; const e = document.querySelector('[data-bc="' + i + '"]');
  const f = e && e.closest('form');
  return { m: b.m || 0, clip: b.clip || 0, open: b.open || 0,
    scrolled: !!b.scroll && (Math.abs(scrollX - b.scroll[0]) + Math.abs(scrollY - b.scroll[1]) > 4),
    focus: (document.activeElement && document.activeElement.tagName) !== b.focus,
    store: JSON.stringify(Object.entries(localStorage)).length !== b.ls || JSON.stringify(Object.entries(sessionStorage)).length !== b.ss,
    invalid: !!(f && !f.checkValidity()), gone: !e };
}
"""
BLOCK = json.dumps({'statusCode': 422, 'code': 'BTN_CHECK', 'message': '단추 점검 — 이 요청은 서버로 보내지 않았습니다.'}, ensure_ascii=False)
norm_api = lambda p: re.sub(r'/[0-9a-f]{8}-[0-9a-f-]{27,}|/\d+(?=/|$)|/H\d{8,}|/[A-Z]{2,}-[A-Z0-9-]+(?=/|$)', '/{}', re.sub(r'^/api/v1', '', p))

out = {'role': role, 'base': BASE, 'pages': [], 'at': time.strftime('%F %T')}
# 준비 — 장바구니가 비어 있으면 장바구니 쪽의 단추(수량 · 삭제 · 주문)가 나오지 않습니다. 한 개 담아 두고 끝에 뺍니다(원래 담겨 있었으면 그대로 둠)
import urllib.request, urllib.error, uuid
API = os.environ.get('API', 'http://localhost:3000/api/v1')
def call(m, path, tok=None, body=None):
    h = {'content-type': 'application/json', 'Idempotency-Key': uuid.uuid4().hex}
    if tok: h['authorization'] = 'Bearer ' + tok
    req = urllib.request.Request(API + path, method=m, data=json.dumps(body).encode() if body is not None else None, headers=h)
    try: r = urllib.request.urlopen(req, timeout=30); st = r.status; raw = r.read()
    except urllib.error.HTTPError as e: st = e.code; raw = e.read()
    try: return st, json.loads(raw) if raw else None
    except Exception: return st, None
TOK = None; CART_ADDED = False
if ROLES[role]:
    TOK = (call('POST', '/auth/login', body={'email': ROLES[role], 'password': 'sgb-dev-1234'})[1] or {}).get('accessToken')
    st, cart = call('GET', '/me/health/cart', TOK)
    had = json.dumps(cart, ensure_ascii=False).find(P['hprod']) >= 0 if cart else False
    if TOK and not had:
        st, _ = call('POST', '/me/health/cart', TOK, {'productCode': P['hprod'], 'qty': 1}); CART_ADDED = st < 300
    out['prep'] = {'cart_had': had, 'cart_added': CART_ADDED, 'product': P['hprod']}
seen_chrome = set()      # 머리줄 · 바닥줄 단추는 (틀, 글자)마다 한 번
with sync_playwright() as pw:
    br = pw.chromium.launch()
    ctx = br.new_context(viewport={'width': 1280, 'height': 900})
    pg = ctx.new_page()
    email = ROLES[role]
    if email:
        pg.goto(BASE + '/login'); __import__('consent_ok').agree(email, 'sgb-dev-1234'); pg.fill('input[name=email]', email); pg.fill('input[name=password]', 'sgb-dev-1234')
        pg.click('form.auth button'); pg.wait_for_timeout(2500)
    state = {'reqs': [], 'dialogs': [], 'errs': [], 'pops': 0, 'arm': False}
    def on_route(route):
        req = route.request
        if req.method in ('GET', 'HEAD', 'OPTIONS'): return route.continue_()
        u = urlparse(req.url)
        if not state['arm']: return route.continue_()        # 쪽을 여는 동안 쪽이 스스로 보내는 것(광고 노출 기록 등)은 그대로
        state['reqs'].append(f"{req.method} {norm_api(u.path) if '/api/' in u.path else u.path + (' (서버 액션)' if req.headers.get('next-action') else '')} [막음]")
        route.fulfill(status=422, content_type='application/json', body=BLOCK)
    ctx.route('**/*', on_route)
    def on_req(req):
        if state['arm'] and req.method == 'GET' and '/api/' in req.url:
            state['reqs'].append(f"GET {norm_api(urlparse(req.url).path)}")
    pg.on('request', on_req)
    def on_dialog(d):
        state['dialogs'].append(f"{d.type}: {d.message[:60]}")
        try: d.accept()
        except Exception: pass
    pg.on('dialog', on_dialog)
    pg.on('pageerror', lambda e: state['errs'].append(str(e)[:140]))
    ctx.on('page', lambda p: (state.__setitem__('pops', state['pops'] + 1), p.close()) if p != pg else None)

    def load(url):
        state['arm'] = False
        try:
            r = pg.goto(BASE + url, wait_until='networkidle', timeout=30000); st = r.status if r else 0
        except Exception as ex:
            st = -1
        pg.wait_for_timeout(250)
        return st

    for r in ROUTES:
        url = fill(r)
        if ONLY and url not in ONLY and r not in ONLY: continue
        st = load(url)
        final = urlparse(pg.url).path
        try: items = pg.evaluate(ENUM)
        except Exception as ex: items = []
        shell = pg.evaluate("(document.querySelector('header')||{}).className||''")
        rec = {'route': r, 'url': url, 'status': st, 'final': final, 'shell': shell, 'n': len(items), 'buttons': []}
        sig_count = {}
        dirty = False
        for it in items:
            row = dict(it); row.pop('i')
            sig = (it['region'], it['tag'], it['cls'], it['text'] if it['region'] != '본문' or not re.search(r'\d', it['text']) else re.sub(r'\d+', '#', it['text']))
            if it['region'] in ('머리줄', '바닥줄'):
                key = (shell, it['region'], it['text'], it['cls'])
                if key in seen_chrome:
                    row['result'] = '같은 틀에서 확인함'; rec['buttons'].append(row); continue
                seen_chrome.add(key)
            sig_count[sig] = sig_count.get(sig, 0) + 1
            if it['disabled']:
                row['result'] = '꺼짐'; rec['buttons'].append(row); continue
            if sig_count[sig] > REP:
                row['result'] = '같은 단추(대표만)'; rec['buttons'].append(row); continue
            if dirty:
                # v10.31 — 관 화면의 떠 있는 광고(GwFloatAd)는 ✕ 를 누르면 그 세션 동안 숨습니다(제품 규칙). 앞 단추가 ✕ 였으면 다시 열어도 광고 단추가 없으므로 그 표시를 지우고 엽니다
                try: pg.evaluate("try { sessionStorage.removeItem('gw.floatClosed') } catch (e) {}")
                except Exception: pass
                load(url)
                try: now = pg.evaluate(ENUM)
                except Exception: now = []
                cand = [x for x in now if x['i'] == it['i'] and x['text'] == it['text'] and x['tag'] == it['tag']]
                if not cand:      # 순서가 달라졌으면 글자 · 자리로 다시 찾음
                    cand = [x for x in now if x['text'] == it['text'] and x['tag'] == it['tag'] and x['region'] == it['region']]
                # v10.30 — 광고 칸(소개장터 메인 맨 위 · GHERO)은 열 때마다 소재를 무작위로 고릅니다. 다른 소재가 나오면 그 단추(소재의 글자)가 없으므로 몇 번 더 엽니다
                tries = 0
                while not cand and tries < 6:
                    tries += 1; load(url)
                    try: now = pg.evaluate(ENUM)
                    except Exception: now = []
                    cand = [x for x in now if x['text'] == it['text'] and x['tag'] == it['tag'] and x['region'] == it['region']]
                if not cand:
                    row['result'] = '다시 열었더니 없음'; rec['buttons'].append(row); dirty = True; continue
                idx = cand[0]['i']
            else:
                idx = it['i']
            state['reqs'].clear(); state['dialogs'].clear(); state['errs'].clear(); state['pops'] = 0
            # v10.31 — 접힌 <details> 안의 단추(예: 파트너 정산 「계좌 변경 · 인증」)는 사람이 먼저 펼치고 누릅니다 — 펼친 뒤 누름
            try: pg.evaluate(f"(() => {{ let d = document.querySelector('[data-bc=\"{idx}\"]'); d = d && d.closest('details:not([open])'); while (d) {{ d.open = true; d = d.parentElement && d.parentElement.closest('details:not([open])'); }} }})()")
            except Exception: pass
            before = pg.url
            try: pg.evaluate(WATCH)
            except Exception: pass
            state['arm'] = True
            click_err = ''
            try:
                pg.locator(f'[data-bc="{idx}"]').first.click(timeout=2500)
            except Exception as ex:
                click_err = str(ex).split('\n')[0][:90]
            pg.wait_for_timeout(650)
            try: pg.wait_for_load_state('networkidle', timeout=4000)
            except Exception: pass
            after_url = pg.url
            try: a = pg.evaluate(AFTER, str(idx))
            except Exception: a = {'m': 0, 'gone': True}
            state['arm'] = False
            react = []
            if after_url != before: react.append('주소 → ' + urlparse(after_url).path + (('?' + urlparse(after_url).query[:30]) if urlparse(after_url).query else ''))
            if state['dialogs']: react.append('안내창 ' + state['dialogs'][0])
            blocked = [x for x in state['reqs'] if x.endswith('[막음]')]
            gets = [x for x in state['reqs'] if not x.endswith('[막음]')]
            if blocked: react.append('요청 ' + blocked[0])
            if gets: react.append('조회 ' + gets[0])
            if state['pops'] or a.get('open'): react.append('새 창')
            if a.get('clip'): react.append('복사')
            if a.get('m'): react.append(f"화면 바뀜({a['m']})")
            if a.get('invalid') and not blocked: react.append('입력 검사(필수 항목)')
            if a.get('scrolled'): react.append('스크롤')
            if a.get('store'): react.append('저장소 바뀜')
            if a.get('focus') and not react: react.append('포커스 이동')
            row['react'] = react; row['requests'] = state['reqs'][:6]; row['errors'] = state['errs'][:2]
            if click_err: row['result'] = '누를 수 없음'; row['why'] = click_err
            elif react: row['result'] = '반응 있음'
            elif it['handler'] and '처리기 없음' not in it['handler']: row['result'] = '무반응(처리기 있음)'
            else: row['result'] = '죽은 단추'
            rec['buttons'].append(row)
            dirty = bool(react) or bool(click_err)
        out['pages'].append(rec)
        c = {}
        for b in rec['buttons']: c[b['result']] = c.get(b['result'], 0) + 1
        bad = [b['text'] for b in rec['buttons'] if b['result'] in ('죽은 단추', '무반응(처리기 있음)', '누를 수 없음')]
        print(('!!' if bad else '  '), role, url, st, len(items), c, bad[:4], file=sys.stderr, flush=True)
        json.dump(out, open(f'{HERE}/btn_site_{role}.json', 'w'), ensure_ascii=False)
    br.close()
if CART_ADDED:
    st, _ = call('PATCH', f"/me/health/cart/{P['hprod']}", TOK, {'qty': 0}); out['prep']['cart_removed'] = st
tot = {}
for p in out['pages']:
    for b in p['buttons']: tot[b['result']] = tot.get(b['result'], 0) + 1
out['total'] = tot
json.dump(out, open(f'{HERE}/btn_site_{role}.json', 'w'), ensure_ascii=False)
print(role, '쪽', len(out['pages']), '단추', sum(tot.values()), tot)
