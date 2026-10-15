"""flow 점검 — 소개몰(쇼핑몰 · 주소 /health/…) 흐름 M1 ~ M7.  (v10.25 · 2026-10-08)   결과: flow_mall.json

  M1 둘러보기 → 상품 상세 → 장바구니          M2 주문서 → 결제 → 주문 완료
  M3 내 주문 → 발송 → 배송 조회 → 배송 완료     M4 반품 신청 → 운영 승인 → 환불
  M5 결제 전 취소                              M6 살 수 없는 것은 막힘
  M7 배송지 관리 (+ 마지막 확인: 시험 주문은 모두 닫힘 · 재고는 처음 값)

  · 구매자는 **새로 만든 계정**(flw_mall_*@t.local)입니다. 본인인증은 주문서가 안내하는 길(/verify · 시험용 PASS)로 화면에서 합니다.
  · 한 흐름의 결과를 다음 흐름이 이어받습니다(M1 의 장바구니 → M2 의 주문 → M3 의 배송 → M4 의 반품).
  · 운영 쪽에 발송 처리 API · 화면이 없어(src 에 hlt_shipments 를 쓰는 곳이 없음) M3 의 발송 · 배송 완료는 DB(hlt_shipments)에 기록을 넣어 만듭니다 — 단계 이름에 적습니다.
  · 주소 검색(Daum 우편번호 · 외부 주소)은 내보내지 않고 막습니다 — 제품이 그때 열어 주는 「직접 입력」 칸으로 넣습니다.
  · M5 는 주문을 만든 뒤 결제 화면의 「← 뒤로」도 눌러 봅니다 — 주문서에 방금 주문한 상품이 다시 나오면 그 주문서로 한 번 더 주문되는지까지 보고,
    그렇게 생긴 주문은 바로 취소 · 승인(API)해 재고를 되돌립니다(v10.25 에서는 다시 나오고 한 번 더 주문됨 — 실패로 남깁니다).
  · M6 은 품절을 만들려고 한 상품의 남은 재고를 **결제 대기 주문으로 잠깐 모두 잡습니다**(끝나면 바로 취소 · 승인해 되돌림).
  · 새 계정을 만들지 못하면 그 사실을 M1 의 첫 단계에 실패로 남기고 buyer@x.com 으로 갑니다(끝에 넣은 배송지를 지우고 기본 배송지를 처음 것으로).
  · 단계 이름의 「집」 「회사」 「부모님」 배송지는 실제로는 뒤에 이번 실행의 표식(TAG)이 붙습니다 — 다른 시험의 자료와 섞이지 않게.

사용:  cd /home/claude/qa && python3 flow_mall.py        (P1 · P2 · P3 = 쓸 상품 코드 · 없으면 판매 중인 것에서 고름)
"""
from flow_lib import *
from playwright.sync_api import sync_playwright

RT = 6000                      # 고객 사정 반품의 왕복 배송비(health-policy.ts)
TAG = uuid.uuid4().hex[:5].upper()
S = {'orders': [], 'notes': [], 'dlg': []}      # 흐름 사이에 이어받는 값
EXT = []                       # 막은 외부 요청
norm = lambda s: re.sub(r'\s+', ' ', s or '').strip()
won = lambda n: f'{int(n):,}원'
stock = lambda code: int(q(f"select stock from hlt_products where code='{code}'") or -1)
DT = r'\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}'


def text(pg, sel='body'):
    """글자 읽기 — 그 칸이 없으면 기다리지 않고 빈 글(flow_lib 의 text 는 없는 칸을 30초 기다립니다)"""
    try:
        l = pg.locator(sel); return l.first.inner_text() if l.count() else ''
    except Exception: return ''


class Skip(Exception):
    pass


class Run:
    """한 흐름 — 단계를 차례로 돌리고, 더 갈 수 없는 실패 뒤의 단계는 건너뜀(skip)으로 남깁니다"""
    def __init__(self, name=None, who='', flow=None):
        self.F = flow or Flow(name, who); self.steps = []
    def add(self, name, how, fatal=True):
        def deco(fn): self.steps.append((name, how, fn, fatal)); return fn
        return deco
    def go(self, need=(), why=''):
        dead = why if any(k not in S for k in need) else None
        for name, how, fn, fatal in self.steps:
            if dead: self.F.step(name, how, False, f'하지 못함 — {dead}', skip=True); continue
            try:
                r = fn(); ok, detail = r if isinstance(r, tuple) else (r, '')
            except Skip as e:
                self.F.step(name, how, False, str(e), skip=True); continue
            except Exception as e:
                ok, detail = False, '시험 실행 중 오류 — ' + norm(repr(e))[:250]
            self.F.step(name, how, ok, detail)
            if not ok and fatal: dead = f'앞 단계({len(self.F.d["steps"])}번)가 실패해 이어 갈 수 없음'


class Watch:
    def __init__(self, pg): self.errs, self.apis = watch(pg); self.allow = []
    def take(self):
        bad = [a for a in self.apis if not any(x in a for x in self.allow)]; meant = [a for a in self.apis if a not in bad]; e = list(self.errs)
        self.errs.clear(); self.apis.clear(); self.allow.clear()
        return e, bad, meant


def guard(ctx):
    """실제 외부 주소로는 내보내지 않습니다(주소 검색의 Daum 스크립트 등) — 막고 적어 둡니다"""
    ctx.route(re.compile(r'^https?://(?!localhost[:/]|127\.0\.0\.1[:/])'), lambda r: (EXT.append(r.request.url[:80]), r.abort()))


def until(fn, timeout=15, every=0.4):
    t = time.time(); v = None
    while True:
        try: v = fn()
        except Exception: v = None
        if v or time.time() - t > timeout: return v
        time.sleep(every)


def reload_until(pg, path, cond, timeout=85, every=5):
    """사용자 웹은 상품 자료를 30 ~ 60초 기억해 둡니다 — 새 값이 보일 때까지 다시 엽니다"""
    t = time.time(); v = None
    while True:
        goto(pg, path)
        try: v = cond()
        except Exception: v = None
        if v or time.time() - t > timeout: return v
        time.sleep(every)


def click_to(pg, loc, url_re, timeout=25000):
    loc.click(); pg.wait_for_url(re.compile(url_re), timeout=timeout)
    try: pg.wait_for_load_state('networkidle', timeout=10000)
    except Exception: pass


# ── 화면에서 값 읽기 ──
JS_SUMS = "() => Object.fromEntries([...document.querySelectorAll('main .hlt-box .hlt-sum')].map(e => [e.children[0].textContent.trim(), e.children[1].textContent.trim()]))"
JS_CART = """() => { const q = s => [...document.querySelectorAll(s)]; const a = document.querySelector('main a.cta-primary, main button.cta-primary');
  return { lines: q('main .hlt-ci').map(e => ({ name: (e.querySelector('.bd b') || {}).textContent || '', qty: Number((e.querySelector('.hlt-qty input') || {}).value), amount: (e.querySelector('.hlt-ci-act b.money') || {}).textContent || '', txt: e.innerText.replace(/\\s+/g, ' ').trim() })),
    sums: Object.fromEntries(q('main .hlt-box .hlt-sum').map(e => [e.children[0].textContent.trim(), e.children[1].textContent.trim()])),
    err: q('main p.form-error').map(e => e.textContent.trim()), empty: !!document.querySelector('main .hlt-empty'),
    order: a ? [a.tagName, a.textContent.trim(), !!a.disabled] : null } }"""
JS_ORDER = """() => { const q = s => [...document.querySelectorAll(s)]; const b = document.querySelector('main button.cta-primary');
  return { items: q('main .hlt-ci').map(e => e.innerText.replace(/\\s+/g, ' ').trim()),
    sums: Object.fromEntries(q('main .hlt-box .hlt-sum').map(e => [e.children[0].textContent.trim(), e.children[1].textContent.trim()])),
    picked: ((document.querySelector('main [data-addr-picked]') || {}).innerText || '').replace(/\\s+/g, ' ').trim(),
    noaddr: q('main .notice').some(e => e.textContent.includes('배송지가 없습니다')),
    chk: q('main label.hlt-chk input[type=checkbox]').map(e => e.checked),
    btn: b ? [b.textContent.trim(), b.disabled] : null, note: ((document.querySelector('main .cta-note') || {}).textContent || '').trim() } }"""
JS_ROW = """(no) => { const r = [...document.querySelectorAll('main .hlt-ord')].find(e => e.textContent.includes(no)); if (!r) return null;
  return { state: (r.querySelector('.hlt-ord-h .state') || {}).textContent || '', name: ((r.querySelector('[data-first-item]') || {}).textContent || '').trim(),
    total: (r.querySelector('.hlt-sum .money') || {}).textContent || '', hint: (r.querySelector('p.hint') || {}).textContent || '',
    head: r.querySelector('.hlt-ord-h').innerText.replace(/\\s+/g, ' ').trim(), btns: [...r.querySelectorAll('.hlt-btns a')].map(a => a.textContent.trim()),
    tbl: Object.fromEntries([...r.querySelectorAll('tr')].map(tr => [tr.children[0].textContent.trim(), tr.children[1].textContent.trim()])) } }"""
JS_DETAIL = """() => { const q = s => [...document.querySelectorAll(s)]; const m = document.querySelector('main');
  return { state: (m.querySelector('.page-head .state') || {}).textContent || '', on: (m.querySelector('ol.hlt-steps li.on') || {}).textContent || '',
    steps: q('main ol.hlt-steps li').map(e => e.textContent), tbl: Object.fromEntries(q('main tr').map(tr => [tr.children[0].textContent.trim(), tr.children[1].textContent.trim()])),
    btns: q('main .hlt > .hlt-btns a').map(a => a.textContent.trim()), txt: m.innerText.replace(/\\s+/g, ' ') } }"""
JS_SHIP = """() => { const q = s => [...document.querySelectorAll(s)]; const m = document.querySelector('main');
  return { tbl: Object.fromEntries(q('main tr').map(tr => [tr.children[0].textContent.trim(), tr.children[1].textContent.trim()])),
    tl: q('main ul.hlt-tl li').map(li => [(li.querySelector('b') || {}).textContent || '', (li.querySelector('.hint') || {}).textContent || '']),
    btns: q('main .hlt > .hlt-btns a').map(a => a.textContent.trim()), txt: m.innerText.replace(/\\s+/g, ' ') } }"""
JS_REFUND = """() => { const t = document.querySelector('main [data-refund-table]'); if (!t) return null; const e = t.querySelector('[data-refund-estimate]');
  return { rows: Object.fromEntries([...t.querySelectorAll('.hlt-sum')].map(e => [e.children[0].textContent.trim(), e.children[1].textContent.trim()])),
    hint: ((t.querySelector('[data-fault-box]') || {}).textContent || '') + ' ' + ((t.querySelector('p.hint') || {}).textContent || ''),  /* v10.32 — 시안 고객 귀책 강조 상자 */ est: e ? e.getAttribute('data-refund-estimate') : null, paid: t.dataset.paid } }"""
JS_ADDR = """() => [...document.querySelectorAll('main .rows .hlt-box')].map(e => ({ label: (e.querySelector('.hlt-ord-h b') || {}).textContent || '', def: !!e.querySelector('.hlt-ord-h .hlt-bdg'),
    txt: e.innerText.replace(/\\s+/g, ' ').trim(), btns: [...e.querySelectorAll('.hlt-btns button')].map(b => b.textContent.trim()) }))"""
JS_PD = """() => { const m = document.querySelector('main'); const b = m.querySelector('.hlt-pd26 > div:nth-child(2)'); if (!b) return { none: true, txt: m.innerText.replace(/\\s+/g, ' ').slice(0, 200) };
  const o = b.querySelector('[data-options]'); const sold = o ? o.querySelector('[data-buynow][disabled]') : null;
  /* v10.26 — 시안의 상품 상세(.hlt-pd26): 값 = .hlt-p26 .now · 남은 수량 · 단추는 옵션 칸([data-options]) 안 · 품절이면 단추가 잠기고 「품절」 */
  return { h1: (b.querySelector('h1') || {}).textContent || '', price: (b.querySelector('.hlt-p26 .now') || {}).textContent || '', hint: o ? o.innerText.replace(/\\s+/g, ' ') : '',
    buy: !!(o && o.querySelector('[data-addcart-main]:not([disabled])')), btns: o ? [...o.querySelectorAll(':scope > .hlt-btns button')].map(x => x.textContent.trim()) : [], soldBtn: sold ? sold.textContent.trim() : null,
    badge: [...b.querySelectorAll('.hlt-bdg')].map(x => x.textContent.trim()),
    ship: Object.fromEntries([...m.querySelectorAll('[data-ship-block] tr')].map(tr => [tr.querySelector('th').textContent.trim(), tr.querySelector('td').textContent.trim()])) } }"""


def cart_db(aid, code):
    return q(f"select ci.qty from hlt_cart_items ci join hlt_products p on p.id=ci.product_id where ci.account_id='{aid}' and p.code='{code}'")


def order_db(no):
    r = rows(f"select o.id, o.status, o.total, o.goods_amount, o.ship_fee, (o.paid_at is not null), (o.shipped_at is not null), (o.delivered_at is not null), (o.restocked_at is not null), coalesce(o.restock_skipped,'-'), "
             f"(select coalesce(string_agg(p.code||'×'||i.qty||'@'||i.unit_price, ',' order by p.code),'') from hlt_order_items i join hlt_products p on p.id=i.product_id where i.order_id=o.id), "
             f"(select coalesce(string_agg(x.state||':'||x.amount||':'||(case when x.stub then 't' else 'f' end)||':'||coalesce(x.canceled_amount::text,'-'), ',' order by x.created_at),'') from hlt_payments x where x.order_id=o.id) "
             f"from hlt_orders o where o.order_no='{no}'")
    if not r: return {}
    k = ('id', 'status', 'total', 'goods', 'ship', 'paid', 'shipped', 'delivered', 'restocked', 'skipped', 'items', 'pays')
    return dict(zip(k, r[0] + [''] * (len(k) - len(r[0]))))


def main():
    # ── 준비 — 쓸 상품 고르기(판매 중 · 재고 있음) ──
    _, plist = call('GET', '/health/products'); plist = [p for p in (plist or []) if not p['soldOut']]
    blocked = {r[0] for r in rows("select p.code from hlt_products p join withdrawal_rules w on w.code=p.withdrawal_code where coalesce(w.blocked_if,'')<>''")}
    def pick(pref, cond, used):
        c = [p for p in plist if cond(p)]
        return next((p for p in c if p['code'] == pref), None) or next((p for p in c if p['code'] not in used), None) or (c[0] if c else None)
    P1 = pick(os.environ.get('P1', 'RED-30'), lambda p: p['code'] in blocked and p['stock'] >= 3, [])
    P2 = pick(os.environ.get('P2', 'BELL-30'), lambda p: p['stock'] >= 1 and (not P1 or p['code'] != P1['code']), [P1['code']] if P1 else [])
    P3 = pick(os.environ.get('P3', 'BIKE-01'), lambda p: 2 <= p['stock'] <= 98 and p['code'] not in {x['code'] for x in (P1, P2) if x}, [])
    P3 = P3 or pick('', lambda p: 2 <= p['stock'] <= 98, [])
    assert P1 and P2 and P3, ('소개몰에 판매 중인 상품이 모자랍니다', plist)
    T0 = q('select now()'); STOCK0 = {p['code']: stock(p['code']) for p in (P1, P2, P3)}
    QTY = 2                                    # M2 에서 주문할 수량
    kw = P1['name'].split()[0]                 # 검색어 — 상품 이름의 첫 낱말
    blk = q(f"select w.blocked_if from hlt_products p join withdrawal_rules w on w.code=p.withdrawal_code where p.code='{P1['code']}'")
    _, cats = call('GET', '/health/categories'); cats = cats or []
    LOCK = next((c for c in cats if c['state'] == 'LOCKED'), None); NOTS = next((c for c in cats if c['state'] == 'NOT_SOLD'), None)
    opens = [c for c in cats if c['state'] == 'OPEN' and c['productCount'] > 0]
    lockprod = q(f"select p.code from hlt_products p join categories c on c.id=p.category_id where c.code='{LOCK['code']}' order by p.stock desc, p.code limit 1") if LOCK else ''
    notprod = q(f"select p.code from hlt_products p join categories c on c.id=p.category_id where c.code='{NOTS['code']}' order by p.stock desc, p.code limit 1") if NOTS else ''

    # ── 준비 — 새 구매자 계정 ──
    em, pw, tok, aid = signup('flw_mall', f'몰흐름{TAG}')
    new_ok = bool(tok and aid)
    if not new_ok:      # 새 계정을 만들지 못하면 그 사실을 남기고 buyer@x.com 으로 갑니다
        em, pw = 'buyer@x.com', DEV_PW; tok = login(em); aid = q("select id from accounts where email='buyer@x.com'")
    S.update(em=em, pw=pw, tok=tok, aid=aid)
    WHO = f"구매자 {em}({'새로 만든 계정' if new_ok else '새 계정을 만들지 못해 기존 계정'}) · 운영자 admin@x.com"
    ADM = login('admin@x.com')
    ADDR0 = q(f"select id from hlt_addresses where account_id='{aid}' and is_default and deleted_at is null")      # 새 계정이면 없음
    L_HOME, L_WORK, L_FAM = f'집{TAG}', f'회사{TAG}', f'부모님{TAG}'

    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1400, 'height': 1000}); guard(ctx)

        def bo_open():
            c = b.new_context(viewport={'width': 1500, 'height': 1000}); guard(c)
            bp = bo_login(c, 'admin@x.com'); dl = []; bp.on('dialog', lambda d: (dl.append(d.message), d.accept()))
            until(lambda: bp.locator('.bo-head nav button').count() > 5, 15)
            S.update(bo=bp, boctx=c, bodlg=dl, wbo=Watch(bp))
            return bo_tab(bp, '소개몰 정산')

        def bo_filter(bp, label):
            bar = bp.locator('.bo-main .acts').first.locator('button')
            for i in range(bar.count()):
                if bar.nth(i).inner_text().strip() == label: bar.nth(i).click(); bp.wait_for_timeout(1500); return True
            return False

        def watch_step(R, bo=False):
            @R.add('이 흐름에서 연 화면들 — 쪽 오류(스크립트) 0 · 실패한 API 응답 0(일부러 낸 거절은 빼고 셈)', '운영 화면' if bo == 'only' else '화면', fatal=False)
            def _():
                ws = [('사용자 웹', S.get('w'))] + ([('운영 화면', S.get('wbo'))] if bo else [])
                out = []; bad_all = []
                for nm, w in ws:
                    if not w: continue
                    e, bad, meant = w.take(); bad_all += e + bad
                    out.append(f"{nm}: 쪽 오류 {len(e)} · 실패 응답 {len(bad)}" + (f" · 일부러 낸 거절 {len(meant)}건({meant[0]})" if meant else '') + (f" → {(e + bad)[:3]}" if e or bad else ''))
                return not bad_all, ' / '.join(out)

        def fill_address(pg, label, n, default=False):
            f = pg.locator('main form.hlt-form'); zp = f.locator('input.addr-zip'); msg = ''
            f.locator('input[name=label]').fill(label); f.locator('input[name=receiver]').fill('흐름시험'); f.locator('input[name=phone]').fill(f'010-5550-{1000 + n}')
            if zp.get_attribute('readonly') is not None:      # 주소 검색(외부 Daum) → 막힘 → 「직접 입력하실 수 있습니다」 → 칸이 열림
                f.locator('.addr button', has_text='주소 검색').click()
                until(lambda: zp.get_attribute('readonly') is None, 20)
            msg = norm(text(pg, 'main form.hlt-form .addr .form-error'))
            zp.fill('04524'); f.locator('input.addr-road').fill(f'서울 중구 흐름시험로 {n}'); f.locator('input.addr-detail').fill(f'{label} {n}호')
            if default: f.locator('input[name=makeDefault]').check()
            return msg

        def addr_db(label):
            r = rows(f"select id, is_default, (deleted_at is not null), receiver, zipcode, addr1, coalesce(addr2,'') from hlt_addresses where account_id='{aid}' and label='{label}'")
            return dict(zip(('id', 'def', 'del', 'receiver', 'zip', 'addr1', 'addr2'), r[0])) if r else {}

        def agree_and_pay(pg):
            """주문서에서 동의 두 개를 켜고 결제 단추를 눌러 결제 화면까지 — 주문 번호를 돌려줍니다"""
            for c in pg.locator('main label.hlt-chk input[type=checkbox]').all(): c.check()
            until(lambda: not pg.locator('main button.cta-primary').is_disabled(), 10)
            click_to(pg, pg.locator('main button.cta-primary'), r'/health/order/pay\?no=')
            m = re.search(r'[?&]no=([^&]+)', pg.url); return m.group(1) if m else ''

        # ═══════════════════════════════════════════════════════════════════════════════
        R = Run('M1 둘러보기 → 상품 상세 → 장바구니', WHO)

        @R.add('새 구매자 계정을 만듦(가입 API · flw_mall_*@t.local) — 본인인증은 아직 하지 않은 상태', 'API')
        def _():
            return new_ok, f"{em} · 계정 {aid[:8]}…" if new_ok else '가입 응답에 토큰이 없음 — buyer@x.com 으로 진행'

        @R.add('사용자 웹 로그인 화면에 이메일 · 비밀번호를 넣고 로그인 → 장바구니 주소가 로그인 화면으로 튕기지 않고 「장바구니가 비어 있습니다」', '화면')
        def _():
            pg = site_login(ctx, em, pw); S['pg'] = pg; S['w'] = Watch(pg); pg.on('dialog', lambda d: (S['dlg'].append(d.message), d.accept()))
            st = goto(pg, '/health/cart'); t = norm(text(pg, 'main'))
            return st == 200 and '/login' not in pg.url and ('장바구니가 비어 있습니다' in t or not new_ok), f'{pg.url.replace(SITE, "")} · {t[:60]}'

        @R.add('시험 전 재고를 적어 둠 — 이 점검이 건드리는 상품 3종', 'DB', fatal=False)
        def _():
            return all(v >= 0 for v in STOCK0.values()), ' · '.join(f"{x['name']}({x['code']}) {STOCK0[x['code']]}개" for x in (P1, P2, P3))

        @R.add("소개몰 메인(/health)을 엶 — 사진 띠의 검색 칸 · 「새로 올라온 상품」 카드가 서버의 판매 중 상품 앞 4개와 같음(v10.26 — 예전 「소개몰 상품」 구역은 시안대로 바뀜)", '화면')
        def _():
            pg = S['pg']; st = goto(pg, '/health')
            d = pg.evaluate("""() => { const h = document.querySelector('[data-shop-hero]');
                return { inp: !!(h && h.querySelector('form[action="/health/search"] input[name=q]')), h1: h ? h.querySelector('h1').innerText.replace(/\\s+/g, ' ') : '',
                         fresh: [...document.querySelectorAll('[data-shop-new] [data-product]')].map(a => a.getAttribute('data-product')) } }""")
            want = [x['code'] for x in (call('GET', '/health/products')[1] or []) if not x['soldOut']][:4]
            return st == 200 and d['inp'] and '소개몰' in d['h1'] and d['fresh'] == want and len(want) > 0, f"{d['h1']} · 새로 올라온 상품 {d['fresh']}"

        @R.add(f"검색 칸에 「{kw}」(상품 이름 일부)를 넣고 Enter → 검색 결과 화면(/health/search)에 「{P1['name']}」 · 값 · 「담기」", '화면')
        def _():
            pg = S['pg']; pg.fill('[data-shop-hero] input[name=q]', kw); pg.press('[data-shop-hero] input[name=q]', 'Enter')
            pg.wait_for_url(re.compile(r'/health/search\?q='), timeout=25000); pg.wait_for_load_state('networkidle')
            cards = [norm(x) for x in pg.locator('main .hlt-card').all_inner_texts()]; mine = next((c for c in cards if P1['name'] in c), '')
            return bool(mine) and won(P1['price']) in mine and pg.locator('main .hlt-card', has_text=P1['name']).locator('[data-cardadd]').count() == 1 and all(kw in c for c in cards), f"결과 {len(cards)}개 · {mine[:80]}"

        @R.add(f"검색 결과에서 「{P1['name']}」 카드를 누름 → 상품 상세: 이름 · 값 {won(P1['price'])} · 「남은 수량 N개」가 DB 재고와 같음 · 「배송비 무료」", '화면')
        def _():
            pg = S['pg']; click_to(pg, pg.locator('main .hlt-card', has_text=P1['name']).locator('a.hlt-card-link'), r'/health/p/' + re.escape(P1['code']) + '$')
            path = '/health/p/' + P1['code']
            def cond():
                d = pg.evaluate(JS_PD); m = re.search(r'남은 수량 (\d+)개', d.get('hint', '')); return d if m and int(m.group(1)) == stock(P1['code']) else None
            d = until(cond, 5) or reload_until(pg, path, cond, 70) or pg.evaluate(JS_PD); S['pd'] = d
            return d.get('h1') == P1['name'] and d.get('price') == won(P1['price']) and f"남은 수량 {stock(P1['code'])}개" in d.get('hint', '') and d.get('btns') == ['장바구니', '바로구매'], \
                f"{d.get('h1')} · {d.get('price')} · {d.get('hint')} · 단추 {d.get('btns')}"

        @R.add(f"상세의 「배송 · 교환 · 반품」 표 — 배송비 「전 상품 무료」 · 반품 배송비 「왕복 6,000원 …」 · 청약철회 7일 · 철회 제한 「{blk}」", '화면', fatal=False)
        def _():
            s = (S.get('pd') or {}).get('ship', {})
            return s.get('배송비') == '전 상품 무료' and '왕복 6,000원' in s.get('반품 배송비', '') and '7일' in s.get('청약철회', '') and bool(blk) and s.get('철회 제한') == blk, \
                f"배송비 {s.get('배송비')} · 반품 배송비 {s.get('반품 배송비')} · 철회 제한 {s.get('철회 제한')}"

        @R.add('상세의 「장바구니」(담기) 단추를 누름 → 「… 을(를) 장바구니에 담았습니다.」 안내와 「장바구니 보기」', '화면')
        def _():
            pg = S['pg']; pg.locator('main [data-options] > .hlt-btns button', has_text='장바구니').click()
            t = until(lambda: norm(text(pg, 'main [data-options] .ok-note')), 20) or norm(text(pg, 'main [data-options]'))
            return P1['name'] in t and '장바구니에 담았습니다' in t and '장바구니 보기' in t, t[:120]

        @R.add('장바구니 기록(hlt_cart_items) — 내 계정 · 그 상품 · 수량 1 · 다른 줄 없음', 'DB', fatal=False)
        def _():
            r = rows(f"select p.code, ci.qty from hlt_cart_items ci join hlt_products p on p.id=ci.product_id where ci.account_id='{aid}'")
            return r == [[P1['code'], '1']], r

        @R.add(f"안내의 「장바구니 보기」를 누름 → 장바구니에 그 상품 1개 · 상품 금액 {won(P1['price'])} · 배송비 「무료」 · 결제 예정 금액 {won(P1['price'])}", '화면')
        def _():
            pg = S['pg']; click_to(pg, pg.locator('main [data-options] .ok-note a'), r'/health/cart$'); c = until(lambda: (lambda x: x if x['lines'] else None)(pg.evaluate(JS_CART)), 15) or pg.evaluate(JS_CART)
            ln = c['lines'][0] if c['lines'] else {}
            return len(c['lines']) == 1 and ln.get('name') == P1['name'] and ln.get('qty') == 1 and ln.get('amount') == won(P1['price']) and c['sums'].get('상품 금액') == won(P1['price']) \
                and c['sums'].get('배송비') == '무료' and c['sums'].get('결제 예정 금액') == won(P1['price']) and c['order'] == ['A', '주문하기', False], f"{ln.get('txt', '')[:70]} · {c['sums']}"

        def qty_step(label, btn, want):
            @R.add(f"수량 「{label}」 단추를 누름 → 수량 {want} · 줄 금액 · 상품 금액 · 결제 예정 금액이 모두 단가 × {want} = {won(P1['price'] * want)} · 배송비 「무료」", '화면')
            def _():
                pg = S['pg']; pg.get_by_role('button', name=f"{P1['name']} 수량 {btn}").click()
                c = until(lambda: (lambda x: x if x['lines'] and x['lines'][0]['qty'] == want else None)(pg.evaluate(JS_CART)), 20) or pg.evaluate(JS_CART)
                ln = c['lines'][0] if c['lines'] else {}; tot = won(P1['price'] * want)
                return ln.get('qty') == want and ln.get('amount') == tot and c['sums'].get('상품 금액') == tot and c['sums'].get('결제 예정 금액') == tot and c['sums'].get('배송비') == '무료' and not c['err'], \
                    f"수량 {ln.get('qty')} · 줄 {ln.get('amount')} · {c['sums']}" + (f" · 안내 {c['err']}" if c['err'] else '')

        def cartdb_step(want):
            @R.add(f"장바구니 기록 — 수량 {want} · 서버가 셈한 합계(v_hlt_cart) 상품 금액 {P1['price'] * want:,} · 배송비 0 · 합계 {P1['price'] * want:,}", 'DB', fatal=False)
            def _():
                v = rows(f"select goods, ship_fee, total from v_hlt_cart where account_id='{aid}'")
                return cart_db(aid, P1['code']) == str(want) and v == [[str(P1['price'] * want), '0', str(P1['price'] * want)]], f"qty {cart_db(aid, P1['code'])} · v_hlt_cart {v}"

        qty_step('+', '늘리기', 2); cartdb_step(2)
        qty_step('+', '늘리기', 3); qty_step('−', '줄이기', 2); cartdb_step(2)

        @R.add('(이어받을 것 확인) 장바구니에 그 상품이 2개 담긴 채로 다음 흐름으로', 'DB')
        def _():
            ok = cart_db(aid, P1['code']) == str(QTY)
            if ok: S['cart_ok'] = True
            return ok, f"{P1['code']} × {cart_db(aid, P1['code'])}"
        watch_step(R); R.go()

        # ═══════════════════════════════════════════════════════════════════════════════
        TOTAL = P1['price'] * QTY
        R = Run('M2 주문서 → 결제 → 주문 완료', WHO)

        @R.add('장바구니의 「주문하기」를 누름 → 주문서 화면 — 새 계정이라 「주문하시려면 본인인증이 필요합니다」 안내와 「본인인증하기」가 먼저 나옴', '화면')
        def _():
            pg = S['pg']
            if '/health/cart' not in pg.url: goto(pg, '/health/cart')
            click_to(pg, pg.locator('main a.cta-primary', has_text='주문하기'), r'/health/order$'); t = norm(text(pg, 'main'))
            S['need_verify'] = '본인인증이 필요합니다' in t
            if not new_ok: return '/health/order' in pg.url, '기존 계정(buyer@x.com)은 이미 인증됨 — ' + t[:60]
            return S['need_verify'] and pg.locator('main a.cta-primary', has_text='본인인증하기').count() == 1 and pg.locator('main label.hlt-chk').count() == 0, t[:110]

        @R.add('「본인인증하기」 → 인증 화면(/verify) → 「PASS 로 본인인증」(시험용 stub — 실제 확인 없음)을 누름 → 1번 칸이 「완료」', '화면')
        def _():
            pg = S['pg']
            if not S.get('need_verify'): raise Skip('이미 본인인증이 된 계정이라 이 단계가 나오지 않음')
            click_to(pg, pg.locator('main a.cta-primary', has_text='본인인증하기'), r'/verify(\?|$)')      # v10.27 (G-201) — 인증 뒤 돌아올 곳(?next=)이 붙음
            pg.locator('button', has_text='PASS 로 본인인증').click()
            ok = until(lambda: pg.locator('ol.steps li').first.get_attribute('class') == 'done', 25); t = norm(pg.locator('ol.steps li').first.inner_text())
            links = pg.evaluate("[...document.querySelectorAll('.auth-wrap a')].map(a => [a.textContent.trim(), a.getAttribute('href')])"); S['verify_links'] = links
            if not any('/health' in (h or '') for _, h in links): S['notes'].append(f'인증 화면(/verify)에는 주문서 · 장바구니로 돌아가는 단추가 없음 — 링크 {links}')
            return bool(ok) and '완료' in t, f"{t[:60]} · 이 화면의 링크 {links}"

        @R.add('계정 기록 — 본인인증 시각(accounts.identity_verified_at)이 들어감', 'DB', fatal=False)
        def _():
            if not S.get('need_verify'): raise Skip('이미 본인인증이 된 계정')
            v = q(f"select identity_verified_at from accounts where id='{aid}'"); return bool(v), v

        @R.add(f"장바구니를 다시 열어 「주문하기」 → 주문서: 주문 상품 「{P1['name']} … × {QTY}개」 · 총 결제 금액 {won(TOTAL)} · 배송비 「무료」 · 「배송지가 없습니다. 먼저 등록하십시오」 · 결제 단추 꺼짐(「배송지를 등록해 주십시오」)", '화면')
        def _():
            pg = S['pg']
            if S.get('need_verify'):
                goto(pg, '/health/cart'); click_to(pg, pg.locator('main a.cta-primary', has_text='주문하기'), r'/health/order$')
            o = until(lambda: (lambda x: x if x['items'] else None)(pg.evaluate(JS_ORDER)), 15) or pg.evaluate(JS_ORDER); it = o['items'][0] if o['items'] else ''
            base = len(o['items']) == 1 and P1['name'] in it and f"× {QTY}개" in it and o['sums'].get('총 결제 금액') == won(TOTAL) and o['sums'].get('배송비') == '무료' and o['btn'] and o['btn'][1] is True
            if not new_ok: return base, f"{it[:60]} · {o['sums']} · 배송지 {o['picked'][:40]}"
            return base and o['noaddr'] and '배송지를 등록해 주십시오' in o['note'], f"{it[:70]} · {o['sums']} · 단추 {o['btn']} · {o['note']}"

        @R.add('주문서의 「배송지 등록」 → 배송지 화면(「주문서로 돌아가기」 있음) → 「주소 검색」: 외부 주소 검색(Daum 우편번호)은 시험에서 막아 둠 → 「… 아래에 직접 입력하실 수 있습니다」 안내와 함께 주소 칸이 열림', '화면')
        def _():
            pg = S['pg']; click_to(pg, pg.locator('main a[href^="/my/health/addresses"]').first, r'/my/health/addresses\?next=')
            back = pg.locator('main .page-head a', has_text='주문서로 돌아가기').count(); msg = fill_address(pg, L_HOME, 1)
            ro = pg.locator('main form.hlt-form input.addr-zip').get_attribute('readonly')
            return back == 1 and ro is None and '직접 입력하실 수 있습니다' in msg and pg.locator('main form.hlt-form button.cta-primary').inner_text().strip() == '저장하고 주문서로', f"안내: {msg} · 막은 외부 요청 {len(EXT)}건({EXT[-1] if EXT else '-'})"

        @R.add(f"배송지명 「집」(뒤에 이번 실행의 표식이 붙음) · 받는 분 · 연락처 · 우편번호 · 도로명 · 상세주소를 넣고 「저장하고 주문서로」 → 주문서로 돌아오고 그 배송지가 골라져 있음(「기본」)", '화면')
        def _():
            pg = S['pg']; click_to(pg, pg.locator('main form.hlt-form button.cta-primary'), r'/health/order$')
            o = until(lambda: (lambda x: x if x['picked'] else None)(pg.evaluate(JS_ORDER)), 15) or pg.evaluate(JS_ORDER)
            if L_HOME not in o['picked'] and pg.locator('main [data-addr-change]').count():      # 기존 계정으로 진행할 때 — 「변경」을 눌러 방금 넣은 배송지를 고름
                pg.click('main [data-addr-change]'); pg.locator('main label.hlt-radio', has_text=L_HOME).click(); pg.wait_for_timeout(400); o = pg.evaluate(JS_ORDER)
            return L_HOME in o['picked'] and '흐름시험' in o['picked'] and '(04524)' in o['picked'] and (not new_ok or '기본' in o['picked']), o['picked'][:120]

        @R.add(f"배송지 기록(hlt_addresses) — 내 계정 · 「집」 · 받는 분 · 우편번호 · 주소 · 첫 배송지라 기본 배송지", 'DB')
        def _():
            a = addr_db(L_HOME)
            ok = bool(a) and a['receiver'] == '흐름시험' and a['zip'] == '04524' and a['addr1'] == '서울 중구 흐름시험로 1' and a['addr2'] == f'{L_HOME} 1호' and a['del'] == 'f' and (a['def'] == 't' or not new_ok)
            if ok: S['addr_id'] = a['id']
            return ok, {k: v for k, v in a.items() if k != 'id'}

        @R.add('동의 두 개를 켜기 전 — 결제 단추가 꺼져 있고 「필수 동의 두 가지에 체크해 주십시오」 · 하나만 켜도 그대로 꺼져 있음', '화면', fatal=False)
        def _():
            pg = S['pg']; o0 = pg.evaluate(JS_ORDER); boxes = pg.locator('main label.hlt-chk input[type=checkbox]')
            boxes.nth(0).check(); pg.wait_for_timeout(300); o1 = pg.evaluate(JS_ORDER); boxes.nth(0).uncheck(); boxes.nth(1).check(); pg.wait_for_timeout(300); o2 = pg.evaluate(JS_ORDER); boxes.nth(1).uncheck(); pg.wait_for_timeout(200)
            return o0['chk'] == [False, False] and all(x['btn'] and x['btn'][1] is True and '필수 동의 두 가지' in x['note'] for x in (o0, o1, o2)) and o1['chk'] == [True, False] and o2['chk'] == [False, True], \
                f"안 켬 {o0['btn']} · 첫째만 {o1['btn']} · 둘째만 {o2['btn']} · {o0['note']}"

        @R.add(f"동의 두 개를 모두 켬 → 결제 단추가 켜지고 「{won(TOTAL)} 결제하기」", '화면')
        def _():
            pg = S['pg']
            for c in pg.locator('main label.hlt-chk input[type=checkbox]').all(): c.check()
            pg.wait_for_timeout(300); o = pg.evaluate(JS_ORDER)
            return o['chk'] == [True, True] and o['btn'] == [f'{won(TOTAL)} 결제하기', False] and not o['note'], f"{o['btn']} · 결제수단 카드(처음 값)"

        @R.add('결제 단추를 누름 → 주문이 만들어지고 결제 화면(/health/order/pay?no=주문번호): 주문 번호 · 결제 금액 · 「결제 연동 키가 없는 환경 — 시험 결제(스텁)」 안내', '화면')
        def _():
            pg = S['pg']; click_to(pg, pg.locator('main button.cta-primary'), r'/health/order/pay\?no=')
            m = re.search(r'[?&]no=([^&]+)', pg.url); no = m.group(1) if m else ''
            if no: S['no'] = no; S['orders'].append(no)
            t = norm(text(pg, 'main')); btn = norm(pg.locator('main button.cta-primary').inner_text()); s = pg.evaluate(JS_SUMS)
            return bool(no) and f'주문번호 {no}' in t and s.get('결제 금액') == won(TOTAL) and s.get('배송비') == '무료' and btn == f'시험 결제(스텁) · {won(TOTAL)}' and '실제 돈은 오가지 않습니다' in t, f"주문 {no} · {s} · 단추 「{btn}」"

        @R.add(f"주문 기록 — hlt_orders 결제 대기(PENDING) · 합계 {TOTAL:,} · 배송비 0 · 내 배송지 / hlt_order_items {P1['code']} × {QTY} @ {P1['price']:,} / 재고 {QTY}개 줄어듦 / 장바구니 비워짐", 'DB')
        def _():
            o = order_db(S['no']); adr = q(f"select address_id from hlt_orders where order_no='{S['no']}'"); S['stock_after_order'] = stock(P1['code'])
            n_cart = q(f"select count(*) from hlt_cart_items where account_id='{aid}'")
            ok = o.get('status') == 'PENDING' and o.get('total') == str(TOTAL) and o.get('ship') == '0' and adr == S.get('addr_id') and o.get('items') == f"{P1['code']}×{QTY}@{P1['price']}" and n_cart == '0' \
                and q(f"select account_id from hlt_orders where order_no='{S['no']}'") == aid
            return ok, f"{o.get('status')} · 합계 {o.get('total')} · 품목 {o.get('items')} · 결제 건 「{o.get('pays')}」 · 재고 {S['stock_after_order']}(처음 {STOCK0[P1['code']]}) · 장바구니 {n_cart}줄"

        @R.add(f"재고가 주문 수량만큼 줄었음 — 처음 값 − {QTY}", 'DB', fatal=False)
        def _():
            d = others_delta(P1['code']); now_ = stock(P1['code'])
            return now_ == STOCK0[P1['code']] - QTY + d, f"처음 {STOCK0[P1['code']]} → 지금 {now_}" + (f" (같은 시간에 다른 계정 주문이 준 변화 {d:+d} 반영)" if d else '')

        @R.add(f"「시험 결제(스텁) · {won(TOTAL)}」를 누름 → 승인 → 주문 완료 화면: 「결제가 완료되었습니다」 · 주문 번호 · 「결제 완료」 · 「시험 결제」 표시 · 결제 금액", '화면')
        def _():
            pg = S['pg']; click_to(pg, pg.locator('main button.cta-primary'), r'/health/order/done\?', 40000); t = norm(text(pg, 'main')); s = pg.evaluate(JS_SUMS)
            st = norm(text(pg, 'main .hlt-ord-h'))
            return '결제가 완료되었습니다' in t and f"주문번호 {S['no']}" in st and '결제 완료' in st and '시험 결제' in t and '실제 돈은 오가지 않았습니다' in t and s.get('결제 금액') == won(TOTAL) and f"{P1['name']} × {QTY}" in t, f"{st} · {s} · {t[t.find('결제수단'):t.find('결제수단') + 60]}"

        @R.add(f"결제 뒤 기록 — hlt_orders 결제 완료(PAID · 결제 시각) / hlt_payments 승인(PAID · {TOTAL:,} · 시험 결제 stub) 1건 / hlt_order_items 그대로 / 재고는 더 줄지 않음 / 장바구니 비어 있음", 'DB')
        def _():
            o = order_db(S['no']); n_cart = q(f"select count(*) from hlt_cart_items where account_id='{aid}'")
            key = q(f"select count(*) from hlt_payments where order_id='{o.get('id')}' and state='PAID' and payment_key like 'stub_%' and approved_at is not null")
            ok = o.get('status') == 'PAID' and o.get('paid') == 't' and o.get('pays') == f'PAID:{TOTAL}:t:-' and key == '1' and o.get('items') == f"{P1['code']}×{QTY}@{P1['price']}" and n_cart == '0'
            if ok: S['paid'] = True
            d = others_delta(P1['code']); now_ = stock(P1['code'])
            return ok and now_ == STOCK0[P1['code']] - QTY + d, f"{o.get('status')} · 결제 건 {o.get('pays')} · 품목 {o.get('items')} · 재고 {now_} · 장바구니 {n_cart}줄"
        watch_step(R); R.go(need=('pg', 'cart_ok'), why='M1 에서 장바구니에 상품이 담기지 않음')

        # ═══════════════════════════════════════════════════════════════════════════════
        R = Run('M3 내 주문 → 발송 → 배송 조회 → 배송 완료', WHO)
        CARRIER, TRACK = 'CJ대한통운', '6' + str(int(TAG, 16) % 10**11).zfill(11)      # v10.28 — 운영 발송 처리 API(택배사 목록 · 송장 10 ~ 14자리 숫자)
        ship_at = lambda state: q(f"select to_char(happened_at at time zone 'Asia/Seoul','YYYY.MM.DD HH24:MI') from hlt_shipments s join hlt_orders o on o.id=s.order_id where o.order_no='{S['no']}' and s.state='{state}' order by happened_at desc limit 1")

        @R.add('주문 완료 화면의 「주문 상세」를 누름 → 주문 상세: 「결제 완료」 · 단계 표(결제 대기 → 결제 완료 → 상품 준비중 → 배송중 → 배송 완료 → 구매확정 · v10.28)에서 지금 칸이 「결제 완료」 · 주문 · 결제 시각 있음 · 발송 · 배송 완료는 「-」 · 단추 「주문취소」', '화면')
        def _():
            pg = S['pg']; click_to(pg, pg.locator('main .hlt-btns a', has_text='주문 상세'), r'/my/health/orders/' + re.escape(S['no']) + '$'); d = pg.evaluate(JS_DETAIL); tb = d['tbl']
            return d['state'] == '결제 완료' and d['on'] == '결제 완료' and d['steps'] == ['결제 대기', '결제 완료', '상품 준비중', '배송중', '배송 완료', '구매확정'] and re.fullmatch(DT, tb.get('주문', '')) is not None and re.fullmatch(DT, tb.get('결제', '')) is not None \
                and tb.get('발송') == '-' and tb.get('배송 완료') == '-' and d['btns'] == ['주문취소'], f"{d['state']} · 지금 칸 {d['on']} · 주문 {tb.get('주문')} · 결제 {tb.get('결제')} · 발송 {tb.get('발송')} · 단추 {d['btns']}"

        @R.add(f"위 메뉴의 「내 주문」을 누름 → 목록(/my/health/orders)에 그 주문: 「결제 완료」 · 「{P1['name']}」 · {won(TOTAL)} · 단추 「주문취소 · 상세보기」(배송조회는 아직 없음)", '화면')
        def _():
            pg = S['pg']; click_to(pg, pg.locator('main nav.hlt-lnav a', has_text='내 주문'), r'/my/health/orders$'); r = pg.evaluate(JS_ROW, S['no']) or {}
            return r.get('state') == '결제 완료' and P1['name'] in r.get('name', '') and r.get('total') == won(TOTAL) and r.get('btns') == ['주문취소', '상세보기'], f"{r.get('head')} · {r.get('name')} · {r.get('total')} · {r.get('btns')}"

        @R.add('발송 전에 배송 조회 주소(…/ship)를 바로 엶(결제 완료 주문에는 「배송조회」 단추가 없음) → 택배사 · 송장번호 「발송 전」 · 「아직 발송 전입니다 …」', '화면', fatal=False)
        def _():
            pg = S['pg']; st = goto(pg, f"/my/health/orders/{S['no']}/ship"); d = pg.evaluate(JS_SHIP)
            return st == 200 and d['tbl'].get('택배사') == '발송 전' and d['tbl'].get('송장번호') == '발송 전' and d['tbl'].get('주문 상태') == '결제 완료' and '아직 발송 전입니다' in d['txt'] and not d['tl'], f"{d['tbl']}"

        @R.add(f"운영자가 발송 처리(v10.28 운영 「소개몰 주문」 · POST /admin/health/orders/…/ship) — 택배사 「{CARRIER}」 · 송장번호 → 「집화」 기록", 'API')
        def _():
            st, j = call('POST', f"/admin/health/orders/{S['no']}/ship", ADM, {'carrier': CARRIER, 'trackingNo': TRACK})
            return st < 300, f'{st} · {str(j)[:120]}'

        @R.add('발송 처리로 배송 기록이 들어가자 DB 트리거가 주문을 「배송중」(SHIPPED)으로 바꾸고 발송 시각을 적음', 'DB')
        def _():
            o = order_db(S['no']); return o.get('status') == 'SHIPPED' and o.get('shipped') == 't' and o.get('delivered') == 'f', f"{o.get('status')} · 발송 시각 {'있음' if o.get('shipped') == 't' else '없음'}"

        @R.add('내 주문 목록을 다시 엶 → 그 주문이 「배송중」 · 「발송 2026.MM.DD」 · 단추 「배송조회 · 반품신청 · 상세보기」', '화면')
        def _():
            pg = S['pg']; goto(pg, '/my/health/orders'); r = pg.evaluate(JS_ROW, S['no']) or {}
            return r.get('state') == '배송중' and re.fullmatch(r'발송 \d{4}\.\d{2}\.\d{2}', r.get('hint', '')) is not None and r.get('btns') == ['배송조회', '반품신청', '상세보기'], f"{r.get('state')} · {r.get('hint')} · {r.get('btns')}"

        @R.add(f"그 주문의 「배송조회」를 누름 → 배송 조회 화면: 주문 상태 「배송중」 · 택배사 「{CARRIER}」 · 송장번호 · 배송 추적 맨 위 「집화 처리」와 시각(DB 기록 시각과 같음 · 한국 시각)", '화면')
        def _():
            pg = S['pg']; row = pg.locator('main .hlt-ord', has_text=S['no']); click_to(pg, row.locator('.hlt-btns a', has_text='배송조회'), r'/my/health/orders/' + re.escape(S['no']) + '/ship$')
            d = pg.evaluate(JS_SHIP); at = ship_at('PICKED')
            return d['tbl'].get('주문 상태') == '배송중' and d['tbl'].get('택배사') == CARRIER and d['tbl'].get('송장번호') == TRACK and d['tl'][:1] == [['집화 처리', at]] and len(d['tl']) == 1 and '반품신청' in d['btns'], f"{d['tbl']} · 추적 {d['tl']} · DB {at}"

        @R.add('운영자가 「배송중」(IN_TRANSIT · 운영 「소개몰 주문」 · …/advance)을 더하고 배송 조회를 새로 고침 → 추적 맨 위가 「배송중」 + 시각 · 아래에 「집화 처리」 · 주문 상태는 그대로 「배송중」', '화면', fatal=False)
        def _():
            pg = S['pg']; st_, j_ = call('POST', f"/admin/health/orders/{S['no']}/advance", ADM, {'state': 'IN_TRANSIT'}); rc, er = (0, '') if st_ < 300 else (1, f'{st_} {str(j_)[:80]} · ')
            goto(pg, f"/my/health/orders/{S['no']}/ship"); d = pg.evaluate(JS_SHIP); at = ship_at('IN_TRANSIT')
            return rc == 0 and [x[0] for x in d['tl']] == ['배송중', '집화 처리'] and d['tl'][0][1] == at and d['tbl'].get('주문 상태') == '배송중' and order_db(S['no']).get('status') == 'SHIPPED', f"{er or ''}추적 {d['tl']} · 주문 {order_db(S['no']).get('status')}"

        @R.add('운영자가 「배송 완료로」(DELIVERED · …/advance) — 택배가 도착한 것처럼', 'API')
        def _():
            st_, j_ = call('POST', f"/admin/health/orders/{S['no']}/advance", ADM, {'state': 'DELIVERED'}); rc, er = (0, '') if st_ < 300 else (1, f'{st_} {str(j_)[:80]}')
            return rc == 0, er or 'DELIVERED'

        @R.add('DB 트리거가 주문을 「배송 완료」(DELIVERED)로 바꾸고 배송 완료 시각을 적음 · 배송 기록 3줄(집화 → 배송중 → 배송 완료)', 'DB')
        def _():
            o = order_db(S['no']); n = rows(f"select s.state from hlt_shipments s where s.order_id='{o.get('id')}' order by happened_at")
            ok = o.get('status') == 'DELIVERED' and o.get('delivered') == 't' and [x[0] for x in n] == ['PICKED', 'IN_TRANSIT', 'DELIVERED']
            if ok: S['delivered'] = True
            return ok, f"{o.get('status')} · 기록 {[x[0] for x in n]}"

        @R.add('배송 조회를 새로 고침 → 주문 상태 「배송 완료」 · 추적 맨 위 「배송 완료」와 시각(DB 와 같음) · 모두 3줄', '화면')
        def _():
            pg = S['pg']; goto(pg, f"/my/health/orders/{S['no']}/ship"); d = pg.evaluate(JS_SHIP); at = ship_at('DELIVERED')
            return d['tbl'].get('주문 상태') == '배송 완료' and [x[0] for x in d['tl']] == ['배송 완료', '배송중', '집화 처리'] and d['tl'][0][1] == at and all(re.fullmatch(DT, x[1]) for x in d['tl']), f"{d['tbl'].get('주문 상태')} · 추적 {d['tl']}"

        @R.add('배송 조회의 「주문 상세」를 누름 → 주문 상세가 「배송 완료」: 단계 표의 지금 칸 「배송 완료」 · 발송 · 배송 완료 시각이 채워짐 · 단추 「배송조회 · 반품신청」', '화면')
        def _():
            pg = S['pg']; click_to(pg, pg.locator('main .hlt > .hlt-btns a', has_text='주문 상세'), r'/my/health/orders/' + re.escape(S['no']) + '$'); d = pg.evaluate(JS_DETAIL); tb = d['tbl']
            return d['state'] == '배송 완료' and d['on'] == '배송 완료' and tb.get('발송') == ship_at('PICKED') and tb.get('배송 완료') == ship_at('DELIVERED') and d['btns'] == ['배송조회', '반품신청'], \
                f"{d['state']} · 지금 칸 {d['on']} · 발송 {tb.get('발송')} · 배송 완료 {tb.get('배송 완료')} · 단추 {d['btns']}"
        watch_step(R); R.go(need=('pg', 'no', 'paid'), why='M2 에서 결제된 주문이 만들어지지 않음')

        # ═══════════════════════════════════════════════════════════════════════════════
        REFUND = TOTAL - RT
        R = Run('M4 반품 신청 → 운영 승인 → 환불', WHO)

        @R.add('주문 상세의 「반품신청」을 누름 → 취소 · 반품 신청 화면(/my/health/returns/new?o=주문번호): 대상 주문 「배송 완료」 · 「받으신 날부터 7일 안이라 이유를 묻지 않습니다 … (신청 마감 날짜)」 · 신청 종류 「반품 · 교환」', '화면')
        def _():
            pg = S['pg']
            if not re.search(r'/my/health/orders/' + re.escape(S['no']) + '$', pg.url): goto(pg, f"/my/health/orders/{S['no']}")
            click_to(pg, pg.locator('main .hlt > .hlt-btns a', has_text='반품신청'), r'/my/health/returns/new\?o=' + re.escape(S['no'])); t = norm(text(pg, 'main'))
            kinds = [norm(x) for x in pg.locator('main form.hlt-form [aria-label="신청 종류"] button').all_inner_texts()]; m = re.search(r'받으신 날부터 7일 안이라 이유를 묻지 않습니다[^)]*\)\.? \(신청 마감 (\d{4}\.\d{2}\.\d{2})\)', t)
            # v10.31 (w3 시안 반품 신청 — 단계 줄 「항목 선택 → 사유 → 환불 확인 → 접수」) — 「① 항목 선택 (주문 전체 · 배송 완료)」 · 품목 「이름 N개」
            return ('대상 주문 · 배송 완료' in t or '(주문 전체 · 배송 완료)' in t) and m is not None and kinds == ['반품', '교환'] and (f"{P1['name']} × {QTY}" in t or f"{P1['name']} {QTY}개" in t), f"신청 종류 {kinds} · 신청 마감 {m.group(1) if m else '안 보임'} · 철회 제한 안내 {'있음' if '철회 제한' in t else '없음'}"

        @R.add(f"신청 종류 「반품」 · 사유 「단순 변심」(고객 사정)을 고름 → 환불 예상 표: 결제 금액 {won(TOTAL)} · 반품 배송비 (왕복) {won(RT)} · 환불 예정액 {won(REFUND)}(= 결제 금액 − 6,000원) · 「고객 사정이라 왕복 배송비 6,000원이 환불액에서 빠집니다」", '화면')
        def _():
            pg = S['pg']; pg.locator('main form.hlt-form [aria-label="신청 종류"] button', has_text='반품').click(); pg.select_option('main form.hlt-form select', 'CHANGE_MIND'); pg.wait_for_timeout(300)
            r = pg.evaluate(JS_REFUND) or {'rows': {}, 'hint': '', 'est': None}; em_ = norm(text(pg, 'main form.hlt-form label.fld em'))
            # v10.32 — 시안 「고객 귀책이라 6,000원이 환불액에서 빠집니다」(강조 상자) · 전 「고객 사정이라 왕복 배송비 …」
            return r['rows'] == {'결제 금액': won(TOTAL), '반품 배송비 (왕복)': won(RT), '환불 예정액': won(REFUND)} and r['est'] == str(REFUND) and f'{won(RT)}이 환불액에서 빠집니다' in r['hint'] and f'왕복 배송비 {won(RT)}을 뺀 금액을 환불합니다' in em_, f"{r['rows']} · {r['hint']}"

        @R.add(f"사유를 「파손 · 불량」(판매자 사유)으로 바꾸면 반품 배송비 0원 · 환불 예정액 {won(TOTAL)}(전액) → 다시 「단순 변심」으로 되돌림", '화면', fatal=False)
        def _():
            pg = S['pg']; pg.select_option('main form.hlt-form select', 'DEFECT'); pg.wait_for_timeout(300); r = pg.evaluate(JS_REFUND) or {'rows': {}, 'hint': ''}
            pg.select_option('main form.hlt-form select', 'CHANGE_MIND'); pg.wait_for_timeout(300); r2 = pg.evaluate(JS_REFUND) or {'rows': {}}
            return r['rows'] == {'결제 금액': won(TOTAL), '반품 배송비 (왕복)': '0원', '환불 예정액': won(TOTAL)} and '판매자 사유라 반품 배송비가 들지 않습니다' in r['hint'] and r2['rows'].get('환불 예정액') == won(REFUND), f"파손 · 불량: {r['rows']} → 단순 변심: {r2['rows'].get('환불 예정액')}"

        @R.add('「포장을 여셨나요?」에 「열지 않았습니다」 · 상세 사유를 적고 「반품 접수」를 누름 → 「반품 신청을 접수했습니다. 3영업일 안에 알려 드립니다.」', '화면')
        def _():
            pg = S['pg']; pg.locator('main form.hlt-form [aria-label="개봉 여부"] button', has_text='열지 않았습니다').click(); pg.fill('main form.hlt-form textarea', f'flow 점검 {TAG} — 단순 변심 반품')
            btn = norm(pg.locator('main form.hlt-form button.cta-primary').inner_text()); pg.locator('main form.hlt-form button.cta-primary').click()
            t = until(lambda: norm(text(pg, 'main .ok-note')), 20) or norm(text(pg, 'main form.hlt-form'))[-150:]
            return btn == '반품 접수' and '반품 신청을 접수했습니다' in t, f'단추 「{btn}」 → {t[:90]}'

        @R.add('반품 신청 기록(hlt_returns) — 그 주문 · 반품(RETURN) · 단순 변심(CHANGE_MIND) · 접수(REQUESTED) · 고객이 「열지 않음」으로 적음 / 주문은 아직 「배송 완료」 · 재고도 아직 그대로', 'DB')
        def _():
            o = order_db(S['no']); r = rows(f"select id, kind, reason, state, customer_opened, coalesce(detail,''), ship_deduction from hlt_returns where order_id='{o.get('id')}'")
            ok = len(r) == 1 and r[0][1:5] == ['RETURN', 'CHANGE_MIND', 'REQUESTED', 'f'] and TAG in r[0][5] and r[0][6] == '0' and o.get('status') == 'DELIVERED' and o.get('restocked') == 'f'
            if ok: S['rid'] = r[0][0]
            return ok, f"{[x[1:5] for x in r]} · 주문 {o.get('status')} · 재고 {stock(P1['code'])}"

        @R.add(f"접수 안내의 「취소 · 반품 내역」을 누름 → 구매자의 반품 내역(/my/health/returns)에 그 신청: 「반품」 「접수」 · 사유 「단순 변심」 · 비용 부담 「고객 부담 (왕복 배송비 {won(RT)} — 환불액에서 뺍니다)」 · 환불 금액 「확정 전」", '화면', fatal=False)
        def _():
            pg = S['pg']; click_to(pg, pg.locator('main .result .hlt-btns a', has_text='취소 · 반품 내역'), r'/my/health/returns$'); r = pg.evaluate(JS_ROW, S['no']) or {}; tb = r.get('tbl', {})
            return '반품' in r.get('head', '') and r.get('state') == '접수' and tb.get('사유') == '단순 변심' and tb.get('비용 부담') == f'고객 부담 (왕복 배송비 {won(RT)} — 환불액에서 뺍니다)' and tb.get('환불 금액') == '확정 전', f"{r.get('head')} · {tb}"

        @R.add(f"운영자(admin@x.com)로 운영 화면에 로그인 → 「소개몰 정산」 탭의 「취소 · 반품 처리」 목록에 그 신청: 주문 번호 · 반품 · 단순 변심 · 배송 완료 · 「고객: 열지 않았다고 적음」 · 「승인하면 왕복 배송비 6,000원을 빼고 {REFUND:,}원을 환불합니다」 · 개봉 여부를 고르기 전에는 「승인」이 잠겨 있음", '운영 화면')
        def _():
            tab = bo_open(); bp = S['bo']; row = bp.locator(f'tr[data-return="{S["rid"]}"]'); until(lambda: row.count() == 1, 20)
            t = norm(row.inner_text()) if row.count() else ''; pv = norm(row.locator('[data-deduct-preview]').inner_text()) if row.count() and row.locator('[data-deduct-preview]').count() else ''
            dis = row.locator('button', has_text='승인').is_disabled() if row.count() else None
            return tab and row.count() == 1 and S['no'] in t and '반품' in t and '단순 변심' in t and '배송 완료' in t and '열지 않았다고 적음' in t and '시험 결제' in t and f'왕복 배송비 6,000원을 빼고 {REFUND:,}원을 환불합니다' in pv and dis is True, \
                f"탭 {'열림' if tab else '못 찾음'} · {t[:110]} · 미리 보기: {pv[-40:]} · 승인 단추 {'잠김' if dis else '열림'}"

        @R.add(f"그 줄에서 「미개봉 — 재고로 되돌림」을 고르고 「승인」을 누름 → 확인 창(「… 반품 을(를) 승인합니다 · 재고가 되돌아갑니다 · 왕복 배송비 6,000원을 빼고 {REFUND:,}원을 환불합니다(시험 결제)」)을 수락 → 「승인하고 왕복 배송비 6,000원을 빼고 {REFUND:,}원을 환불했습니다 … 재고를 되돌렸습니다.」", '운영 화면')
        def _():
            bp = S['bo']; row = bp.locator(f'tr[data-return="{S["rid"]}"]'); S['s_before_dec'] = stock(P1['code'])
            row.get_by_label('미개봉 — 재고로 되돌림').check(); row.locator('button', has_text='승인').click()
            st = until(lambda: (lambda v: v if v != 'REQUESTED' else None)(q(f"select state from hlt_returns where id='{S['rid']}'")), 30)
            msg = until(lambda: norm(text(bp, '.bo-main p.form-ok') or text(bp, '.bo-main .flash-err')), 10) or ''; dl = norm(S['bodlg'][-1]) if S['bodlg'] else ''
            return st == 'REFUNDED' and f"{S['no']} 반품 을(를) 승인합니다" in dl and '재고가 되돌아갑니다' in dl and f'왕복 배송비 6,000원을 빼고 {REFUND:,}원을 환불합니다(시험 결제)' in dl \
                and f'왕복 배송비 6,000원을 빼고 {REFUND:,}원을 환불했습니다' in msg and '재고를 되돌렸습니다' in msg, f"확인 창: {dl[:120]} → 안내: {msg[:110]}"

        @R.add(f"승인 뒤 기록 — hlt_returns 환불 완료(REFUNDED) · 환불 금액 {REFUND:,} · 뺀 배송비 {RT:,} · 판정 미개봉 / hlt_orders 반품 완료(RETURNED) · 재고 되돌림 시각 / hlt_payments 취소(CANCELED) · 취소 금액 {REFUND:,} / 재고 +{QTY}", 'DB')
        def _():
            o = order_db(S['no']); r = rows(f"select state, refund_amount, ship_deduction, opened, (refunded_at is not null), (select email from accounts where id=decided_by) from hlt_returns where id='{S['rid']}'")
            now_ = stock(P1['code'])
            ok = r == [['REFUNDED', str(REFUND), str(RT), 'f', 't', 'admin@x.com']] and o.get('status') == 'RETURNED' and o.get('restocked') == 't' and o.get('skipped') == '-' and o.get('pays') == f'CANCELED:{TOTAL}:t:{REFUND}' and now_ == S.get('s_before_dec', -9) + QTY
            if ok: S['refunded'] = True
            return ok, f"{r} · 주문 {o.get('status')} · 결제 건 {o.get('pays')} · 재고 {S.get('s_before_dec')} → {now_}"

        @R.add(f"운영 화면의 「환불 완료」 보기 → 그 신청: 「환불 완료」 · 「판정: 미개봉」 · 「환불 {REFUND:,}원 (왕복 배송비 6,000원 차감)」 · 주문 상태 「반품 완료」 · 「재고 복구」 날짜", '운영 화면', fatal=False)
        def _():
            bp = S['bo']; f = bo_filter(bp, '환불 완료'); row = bp.locator(f'tr[data-return="{S["rid"]}"]'); until(lambda: row.count() == 1, 15); t = norm(row.inner_text()) if row.count() else ''
            return f and '환불 완료' in t and '판정: 미개봉' in t and f'환불 {REFUND:,}원 (왕복 배송비 6,000원 차감)' in t and '반품 완료' in t and '재고 복구' in t, t[-150:]

        @R.add(f"구매자의 「취소 · 반품 내역」을 다시 엶 → 그 신청이 「환불 완료」 · 환불 금액 「{won(REFUND)} (왕복 배송비 {won(RT)} 차감) · 날짜 환불」", '화면', fatal=False)
        def _():
            pg = S['pg']; goto(pg, '/my/health/returns'); r = pg.evaluate(JS_ROW, S['no']) or {}; v = r.get('tbl', {}).get('환불 금액', '')
            return r.get('state') == '환불 완료' and re.fullmatch(re.escape(f'{won(REFUND)} (왕복 배송비 {won(RT)} 차감) · ') + r'\d{4}\.\d{2}\.\d{2} 환불', v) is not None, f"{r.get('head')} · 환불 금액 {v}"

        @R.add('반품 내역의 주문 번호를 누름 → 주문 상세가 「반품 완료」(「반품 완료 된 주문입니다」) · 「취소 · 반품」 칸에 「반품 · 단순 변심 · 환불 완료」 · 더 누를 단추 없음 / 내 주문 목록에서도 「반품 완료」 · 단추는 「상세보기」만', '화면', fatal=False)
        def _():
            pg = S['pg']; click_to(pg, pg.locator('main .hlt-ord', has_text=S['no']).locator('a', has_text=S['no']), r'/my/health/orders/' + re.escape(S['no']) + '$'); d = pg.evaluate(JS_DETAIL)
            goto(pg, '/my/health/orders'); r = pg.evaluate(JS_ROW, S['no']) or {}
            return d['state'] == '반품 완료' and '반품 완료 된 주문입니다' in d['txt'] and re.search(r'반품 · 단순 변심 ?환불 완료', d['txt']) is not None and d['btns'] == [] and r.get('state') == '반품 완료' and r.get('btns') == ['상세보기'], \
                f"상세 {d['state']} · 단추 {d['btns']} / 목록 {r.get('state')} · {r.get('btns')}"
        watch_step(R, bo=True); R.go(need=('pg', 'no', 'delivered'), why='M3 에서 배송 완료까지 가지 못함')
        if S.get('boctx'): S['boctx'].close(); S.pop('wbo', None)

        # ═══════════════════════════════════════════════════════════════════════════════
        R = Run('M5 결제 전 취소', WHO)

        @R.add(f"전체제품에서 「{P2['name']}」 카드를 눌러 상세로 → 「바로구매」 → 주문서(주문 상품 1개 · {won(P2['price'])} · M2 에서 넣은 배송지가 골라져 있음)", '화면')
        def _():
            # v10.26 — 메인의 「소개몰 상품」 구역이 시안대로 바뀌어(새로 올라온 상품 4개 · 특별 할인) 그 상품이 메인에 없을 수 있음 → 갈래 목록에서 엶
            pg = S['pg']; S['s5'] = stock(P2['code']); goto(pg, '/health/c/' + (P2.get('categoryCode') or 'ALL'))
            click_to(pg, pg.locator(f'main .hlt-card[data-product="{P2["code"]}"] a.hlt-card-link').first, r'/health/p/' + re.escape(P2['code']) + '$')
            click_to(pg, pg.locator('main [data-options] > .hlt-btns button', has_text='바로구매'), r'/health/order$')
            o = until(lambda: (lambda x: x if x['items'] else None)(pg.evaluate(JS_ORDER)), 15) or pg.evaluate(JS_ORDER); it = o['items'][0] if o['items'] else ''
            return len(o['items']) == 1 and P2['name'] in it and '× 1개' in it and o['sums'].get('총 결제 금액') == won(P2['price']) and L_HOME in o['picked'], f"{it[:60]} · {o['sums']} · 배송지 {o['picked'][:30]}"

        @R.add(f"동의 두 개를 켜고 「{won(P2['price'])} 결제하기」를 누름 → 결제 화면까지만 가고 **결제하지 않음**(결제 대기 주문)", '화면')
        def _():
            pg = S['pg']; no = agree_and_pay(pg)
            if no: S['no5'] = no; S['orders'].append(no)
            return bool(no) and '시험 결제(스텁)' in norm(pg.locator('main button.cta-primary').inner_text()), f'주문 {no}'

        @R.add(f"주문 기록 — 결제 대기(PENDING) · {P2['code']} × 1 · 결제 건 없음 · 재고 1개 줄어듦", 'DB')
        def _():
            o = order_db(S['no5']); now_ = stock(P2['code'])
            return o.get('status') == 'PENDING' and o.get('items') == f"{P2['code']}×1@{P2['price']}" and o.get('pays') == '' and now_ == S['s5'] - 1, f"{o.get('status')} · {o.get('items')} · 결제 건 「{o.get('pays')}」 · 재고 {S['s5']} → {now_}"

        @R.add('결제 화면의 「← 뒤로」를 누름 → 주문서로 가는데, 주문은 이미 만들어졌으므로 방금 주문한 상품이 주문서에 다시 나오지 않아야 함(「주문할 상품이 없습니다」)', '화면', fatal=False)
        def _():
            pg = S['pg']; S['pay_links'] = pg.evaluate("[...document.querySelectorAll('main a')].map(a => a.getAttribute('href'))")
            click_to(pg, pg.locator('main [data-back]'), r'/health/order$'); pg.wait_for_timeout(2500); o = pg.evaluate(JS_ORDER); t = norm(text(pg, 'main')); n_cart = q(f"select count(*) from hlt_cart_items where account_id='{aid}'")
            S['stale'] = bool(o['items'])
            if o['items']: S['notes'].append(f"「바로구매」로 들어온 주문서에서 주문을 만든 뒤 결제 화면의 「← 뒤로」를 누르면, 장바구니는 비었는데(DB {n_cart}줄) 주문서에 방금 주문한 상품이 그대로 다시 나옴 — {o['items'][0][:50]} · 단추 {o['btn']}")
            return not o['items'] and '주문할 상품이 없습니다' in t, (f"주문서에 다시 보임: {o['items'][0][:60]} · 단추 {o['btn']} · 장바구니 기록은 {n_cart}줄" if o['items'] else t[-40:])

        @R.add('(위에서 상품이 다시 보였을 때만) 그 주문서에서 동의 두 개를 켜고 결제 단추를 다시 누름 → 같은 상품의 주문이 하나 더 만들어지지 않아야 함', '화면', fatal=False)
        def _():
            pg = S['pg']
            if not S.get('stale'): raise Skip('주문서에 상품이 다시 보이지 않아 해당 없음')
            for c in pg.locator('main label.hlt-chk input[type=checkbox]').all(): c.check()
            until(lambda: not pg.locator('main button.cta-primary').is_disabled(), 10); S['w'].allow.append('POST /health/orders')
            try: click_to(pg, pg.locator('main button.cta-primary'), r'/health/order/(pay|fail)\?', 30000)
            except Exception: pass
            pg.wait_for_timeout(500); dup = [r[0] for r in rows(f"select o.order_no from hlt_orders o where o.account_id='{aid}' and o.created_at > (select created_at from hlt_orders where order_no='{S['no5']}') order by o.created_at")]
            for x in dup:
                if x not in S['orders']: S['orders'].append(x)
            S['dup5'] = dup; now_ = stock(P2['code'])
            if dup: S['notes'].append(f"그 주문서에서 결제 단추를 다시 누르면 같은 상품의 주문이 하나 더 만들어짐({S['no5']} 뒤에 {dup}) — 재고도 한 번 더 줄어듦")
            return not dup, (f"주문이 하나 더 만들어짐 — {dup} · 지금 화면 {pg.url.replace(SITE, '')[:60]} · 재고 {S['s5']} → {now_}(주문 1건이면 {S['s5'] - 1})" if dup else f"새 주문 없음 · {pg.url.replace(SITE, '')[:60]}")

        @R.add('(뒷정리) 위에서 한 번 더 만들어진 주문을 취소 신청 → 운영 승인(API)으로 닫음 → 재고가 주문 1건만큼만 줄어든 값으로 돌아옴', 'API', fatal=False)
        def _():
            if not S.get('dup5'): raise Skip('한 번 더 만들어진 주문이 없어 할 일 없음')
            out = []; ok = True
            for no in S['dup5']:
                st, r = call('POST', '/me/health/returns', S['tok'], {'orderNo': no, 'kind': 'CANCEL', 'reason': 'CHANGE_MIND'}); st2, j = call('POST', f"/admin/health/returns/{(r or {}).get('id')}/decide", ADM, {'state': 'APPROVED'})
                ok = ok and (j or {}).get('orderStatus') == 'CANCELED'; out.append(f"{no}: 신청 {st} · 승인 {st2} {(j or {}).get('orderStatus')}")
            call('PATCH', f"/me/health/cart/{P2['code']}", S['tok'], {'qty': 0}); now_ = stock(P2['code'])
            return ok and now_ == S['s5'] - 1, ' / '.join(out) + f" · 재고 {now_}(주문 전 {S['s5']})"

        @R.add('결제하지 않은 채 「내 주문」을 엶(결제 화면 본문에 내 주문으로 가는 단추가 없어 주소로) → 그 주문이 「결제 대기」 · 단추 「결제하기 · 주문취소 · 상세보기」', '화면')
        def _():
            pg = S['pg']; links = S.get('pay_links') or []
            if not any('/my/health/orders' in (h or '') for h in links): S['notes'].append(f'결제 화면(/health/order/pay)의 본문에 있는 링크는 「← 뒤로」(주문서)뿐 — 내 주문 · 주문 상세로 가는 단추 없음(링크 {links})')
            goto(pg, '/my/health/orders'); r = pg.evaluate(JS_ROW, S['no5']) or {}
            return r.get('state') == '결제 대기' and r.get('btns') == ['결제하기', '주문취소', '상세보기'] and P2['name'] in r.get('name', ''), f"결제 화면 본문의 링크 {links} · {r.get('head')} · {r.get('btns')}"

        @R.add('그 주문의 「주문취소」를 누름 → 「주문 취소」 화면: 대상 주문 「결제 대기」 · 「발송 전이라 주문 취소로 접수합니다」 · 「발송 전 취소는 비용이 들지 않습니다」', '화면')
        def _():
            pg = S['pg']; click_to(pg, pg.locator('main .hlt-ord', has_text=S['no5']).locator('.hlt-btns a', has_text='주문취소'), r'/my/health/returns/new\?o=' + re.escape(S['no5']))
            t = norm(text(pg, 'main')); h1 = norm(text(pg, 'main .page-head h1')); r = pg.evaluate(JS_REFUND)
            if r: S['notes'].append(f"결제하지 않은(결제 대기) 주문의 취소 화면에도 「환불 예상」 표가 나옴 — {r['rows']} (낸 돈이 없는데 「결제 금액」 「환불 예정액」으로 주문 금액이 적힘)")
            # v10.31 (w3 시안 「① 항목 선택 (주문 전체 · 상태)」)
            return h1 == '주문 취소' and ('대상 주문 · 결제 대기' in t or '(주문 전체 · 결제 대기)' in t) and '발송 전이라 주문 취소로 접수합니다' in t and '발송 전 취소는 비용이 들지 않습니다' in t, f"{h1} · 환불 예상 표 {r['rows'] if r else '없음'}"

        @R.add('사유 「단순 변심」으로 「주문 취소 접수」를 누름 → 「주문 취소 신청을 접수했습니다. 3영업일 안에 알려 드립니다.」', '화면')
        def _():
            pg = S['pg']; pg.select_option('main form.hlt-form select', 'CHANGE_MIND'); btn = norm(pg.locator('main form.hlt-form button.cta-primary').inner_text()); pg.locator('main form.hlt-form button.cta-primary').click()
            t = until(lambda: norm(text(pg, 'main .ok-note')), 20) or norm(text(pg, 'main form.hlt-form'))[-150:]
            return btn == '주문 취소 접수' and '주문 취소 신청을 접수했습니다' in t, f'단추 「{btn}」 → {t[:80]}'

        @R.add('취소 신청 기록(hlt_returns) — 취소(CANCEL) · 접수(REQUESTED) / 접수만으로는 주문이 닫히지 않음: 주문은 아직 결제 대기 · 재고도 아직 잡힌 채(운영 승인 때 닫히는 설계 — 시안의 재고 흐름과 같음)', 'DB')
        def _():
            o = order_db(S['no5']); r = rows(f"select id, kind, reason, state from hlt_returns where order_id='{o.get('id')}'"); now_ = stock(P2['code'])
            ok = len(r) == 1 and r[0][1:] == ['CANCEL', 'CHANGE_MIND', 'REQUESTED'] and o.get('status') == 'PENDING' and now_ == S['s5'] - 1
            if ok: S['rid5'] = r[0][0]
            return ok, f"{[x[1:] for x in r]} · 주문 {o.get('status')} · 재고 {now_}(주문 전 {S['s5']})"

        @R.add('접수 뒤 구매자의 내 주문 — 그 주문은 운영 승인 전이라 아직 「결제 대기」 · 「주문취소」를 다시 누르면 「이미 접수된 주문 취소 신청이 있습니다 …」', '화면', fatal=False)
        def _():
            pg = S['pg']; goto(pg, '/my/health/orders'); r = pg.evaluate(JS_ROW, S['no5']) or {}
            if '결제하기' in r.get('btns', []): S['notes'].append(f"취소 신청을 접수한 뒤에도(운영 승인 전) 내 주문의 그 줄에 「결제하기」 단추가 그대로 보임 — 단추 {r.get('btns')}")
            goto(pg, f"/my/health/returns/new?o={S['no5']}"); t = norm(text(pg, 'main .hlt-fail'))
            return r.get('state') == '결제 대기' and '이미 접수된 주문 취소 신청이 있습니다' in t and pg.locator('main form.hlt-form').count() == 0, f"{r.get('state')} · {r.get('btns')} · {t[:60]}"

        @R.add('운영 화면 「소개몰 정산」 → 그 취소 신청(주문 번호 · 취소 · 결제 대기)의 「승인」을 누름 → 확인 창(「… 취소 을(를) 승인합니다 · 주문이 닫히고 재고가 되돌아갑니다」) 수락 → 「승인했습니다. 결제 전 주문이라 환불할 것이 없습니다. 재고를 되돌렸습니다.」', '운영 화면')
        def _():
            tab = bo_open(); bp = S['bo']; row = bp.locator(f'tr[data-return="{S["rid5"]}"]'); until(lambda: row.count() == 1, 20); t = norm(row.inner_text()) if row.count() else ''
            row.locator('button', has_text='승인').click()
            st = until(lambda: (lambda v: v if v != 'REQUESTED' else None)(q(f"select state from hlt_returns where id='{S['rid5']}'")), 30)
            msg = until(lambda: norm(text(bp, '.bo-main p.form-ok') or text(bp, '.bo-main .flash-err')), 10) or ''; dl = norm(S['bodlg'][-1]) if S['bodlg'] else ''
            return tab and S['no5'] in t and '취소' in t and '결제 대기' in t and st == 'APPROVED' and f"{S['no5']} 취소 을(를) 승인합니다" in dl and '재고가 되돌아갑니다' in dl and '환불' not in dl \
                and '결제 전 주문이라 환불할 것이 없습니다' in msg and '재고를 되돌렸습니다' in msg, f"{t[:70]} · 확인 창: {dl[:70]} → 안내: {msg[:80]}"

        @R.add('승인 뒤 기록 — hlt_orders 취소 완료(CANCELED) · 재고 되돌림 시각 / hlt_returns 승인(APPROVED · 결제 전이라 환불 없음) / 재고가 주문 전 값으로 돌아옴', 'DB')
        def _():
            o = order_db(S['no5']); r = rows(f"select state, coalesce(refund_amount::text,'-'), ship_deduction from hlt_returns where id='{S['rid5']}'"); now_ = stock(P2['code'])
            return o.get('status') == 'CANCELED' and o.get('restocked') == 't' and o.get('pays') == '' and r == [['APPROVED', '-', '0']] and now_ == S['s5'], f"주문 {o.get('status')} · 신청 {r} · 재고 {now_}(주문 전 {S['s5']})"

        @R.add('구매자 화면 — 내 주문에서 그 주문이 「취소 완료」 · 단추는 「상세보기」만 / 취소 · 반품 내역에는 「주문 취소」 「승인」', '화면', fatal=False)
        def _():
            pg = S['pg']; goto(pg, '/my/health/orders'); r = pg.evaluate(JS_ROW, S['no5']) or {}; goto(pg, '/my/health/returns'); x = pg.evaluate(JS_ROW, S['no5']) or {}
            if x.get('tbl', {}).get('환불 금액') == '확정 전': S['notes'].append('결제 전 취소가 승인된 뒤에도 구매자의 취소 · 반품 내역에는 환불 금액이 「확정 전」으로 남음(환불할 돈이 없는 건)')
            return r.get('state') == '취소 완료' and r.get('btns') == ['상세보기'] and '주문 취소' in x.get('head', '') and x.get('state') == '승인', f"내 주문 {r.get('state')} · {r.get('btns')} / 내역 {x.get('head')} · 환불 금액 {x.get('tbl', {}).get('환불 금액')}"
        watch_step(R, bo=True); R.go(need=('pg', 'addr_id'), why='M2 에서 배송지를 넣지 못함(로그인 · 주문서 단계가 막힘)')
        if S.get('boctx'): S['boctx'].close(); S.pop('wbo', None)

        # ═══════════════════════════════════════════════════════════════════════════════
        R = Run('M6 살 수 없는 것은 막힘', WHO)
        lk = LOCK or {'code': 'HLT_FUNC', 'name': '건강기능식품', 'note': ''}; ns = NOTS or {'code': 'HLT_MEDDEV', 'name': '의료기기', 'note': ''}
        p3 = '/health/p/' + P3['code']

        @R.add(f"메인의 「전체제품」을 누름 → 갈래 단추: 열린 갈래는 링크 · 「{lk['name']} 🔒」는 링크가 아닌 글자(누를 수 없음 표시 · 풍선 글 「준비 중」)라 눌러도 화면이 바뀌지 않음 · 「{ns['name']}」 단추는 없음", '화면', fatal=False)
        def _():
            pg = S['pg']; goto(pg, '/health'); click_to(pg, pg.locator('nav.shop-lnav a', has_text='전체제품'), r'/health/c/(?!ALL)')
            chips = pg.evaluate("[...document.querySelectorAll('main [data-sale-cats] > *')].map(e => [e.tagName, e.textContent.trim(), e.getAttribute('aria-disabled'), e.getAttribute('title') || '', e.getAttribute('href')])")
            lock = [c for c in chips if '🔒' in c[1]]; u0 = pg.url
            if lock: pg.locator('main [data-sale-cats] .hlt-chip.lock').first.click(); pg.wait_for_timeout(1200)
            return bool(LOCK) and [c[1] for c in lock] == [lk['name'] + ' 🔒'] and lock[0][0] == 'SPAN' and lock[0][2] == 'true' and '준비 중' in lock[0][3] and lock[0][4] is None and pg.url == u0 \
                and [c[1] for c in chips if c[0] == 'A'] == [c['name'] for c in opens] and not any(ns['name'] in c[1] for c in chips), f"{[(c[0], c[1]) for c in chips]} · 누른 뒤 주소 {'그대로' if pg.url == u0 else pg.url}"

        @R.add(f"잠긴 갈래 주소(/health/c/{lk['code']})로 바로 가면 「🔒 {lk['name']}은 준비 중입니다 …」 안내와 「열린 품목 보기」 · 상품 카드 0 / 팔지 않는 갈래(/health/c/{ns['code']})는 「… 현재 판매하지 않습니다」 · 상품 카드 0", '화면', fatal=False)
        def _():
            pg = S['pg']; goto(pg, '/health/c/' + lk['code']); a = norm(text(pg, 'main [data-closed="LOCKED"]')); n1 = pg.locator('main .hlt-card').count(); go1 = pg.locator('main [data-closed] a', has_text='열린 품목 보기').count()
            goto(pg, '/health/c/' + ns['code']); b_ = norm(text(pg, 'main [data-closed="NOT_SOLD"]')); n2 = pg.locator('main .hlt-card').count()
            return a.startswith('🔒') and (lk.get('note') or '준비 중')[:18] in a and n1 == 0 and go1 == 1 and '판매하지 않습니다' in b_ and n2 == 0, f"{a[:50]} (카드 {n1}) / {b_[:40]} (카드 {n2})"

        @R.add(f"잠긴 갈래의 상품({lockprod}) 상세 주소를 바로 열면 「판매 중인 상품이 아닙니다.」 — 담는 단추 없음", '화면', fatal=False)
        def _():
            if not lockprod: raise Skip('잠긴 갈래에 등록된 상품이 없음')
            pg = S['pg']; goto(pg, '/health/p/' + lockprod); t = norm(text(pg, 'main')); return '판매 중인 상품이 아닙니다' in t and pg.locator('main [data-options]').count() == 0 and pg.locator('main button', has_text='담기').count() == 0, t[:80]

        @R.add(f"화면에 단추가 없어 API 로 직접 — 잠긴 갈래 상품({lockprod}) · 의료기기 상품({notprod})을 담기 요청 → 둘 다 거절(409 「판매 중인 상품이 아닙니다」) · 주문 요청도 거절(422)", 'API', fatal=False)
        def _():
            out = []; ok = True
            for c in [x for x in (lockprod, notprod) if x]:
                st, j = call('POST', '/me/health/cart', S['tok'], {'productCode': c, 'qty': 1}); st2, j2 = call('POST', '/health/orders', S['tok'], {'addressId': S['addr_id'], 'items': [{'productCode': c, 'qty': 1}]})
                ok = ok and st == 409 and (j or {}).get('code') == 'NOT_ON_SALE' and st2 == 422 and (j2 or {}).get('code') == 'NOT_ON_SALE'; out.append(f"{c}: 담기 {st} {(j or {}).get('message')} · 주문 {st2} {(j2 or {}).get('code')}")
            return ok and bool(out) and q(f"select count(*) from hlt_cart_items where account_id='{aid}'") == '0', ' / '.join(out)

        @R.add(f"「{P3['name']}」 상세 — 수량 칸에 재고보다 큰 수를 넣으면 남은 수량(N)으로 고정됨 → 그대로 「장바구니」(N개 담김)", '화면')
        def _():
            pg = S['pg']; N = stock(P3['code']); S['n6'] = N
            def cond():
                d = pg.evaluate(JS_PD); return d if f'남은 수량 {N}개' in d.get('hint', '') else None
            d = reload_until(pg, p3, cond, 80) or pg.evaluate(JS_PD); inp = pg.locator('main [data-options] .hlt-qty input'); inp.fill(str(N + 5)); pg.wait_for_timeout(300); v = inp.input_value()
            pg.locator('main [data-options] > .hlt-btns button', has_text='장바구니').click(); t = until(lambda: norm(text(pg, 'main [data-options] .ok-note') or text(pg, 'main [data-options] .form-error')), 20) or ''
            return f'남은 수량 {N}개' in d.get('hint', '') and v == str(N) and '장바구니에 담았습니다' in t and cart_db(aid, P3['code']) == str(N), f"{d.get('hint')} · {N + 5} 넣음 → 칸 값 {v} · {t[:50]} · 장바구니 기록 {cart_db(aid, P3['code'])}개"

        @R.add('장바구니에서 수량 「+」를 누름(재고보다 1개 많게) → 「남은 수량이 N개입니다 — 상품 이름」 안내가 뜨고 수량은 N 그대로 · 장바구니 기록도 N', '화면')
        def _():
            pg = S['pg']; N = S['n6']; S['w'].allow.append('422 PATCH /me/health/cart'); click_to(pg, pg.locator('main [data-options] .ok-note a'), r'/health/cart$')
            until(lambda: pg.evaluate(JS_CART)['lines'], 15); pg.get_by_role('button', name=f"{P3['name']} 수량 늘리기").click()
            c = until(lambda: (lambda x: x if x['err'] else None)(pg.evaluate(JS_CART)), 20) or pg.evaluate(JS_CART); ln = c['lines'][0] if c['lines'] else {}
            return any(f'남은 수량이 {N}개입니다' in e and P3['name'] in e for e in c['err']) and ln.get('qty') == N and cart_db(aid, P3['code']) == str(N), f"안내 {c['err']} · 수량 {ln.get('qty')} · 기록 {cart_db(aid, P3['code'])}"

        @R.add('「주문하기」 → 주문서(N개 · 아직은 살 수 있는 수량) → 동의 두 개를 켬 → 결제 단추 켜짐', '화면')
        def _():
            pg = S['pg']; N = S['n6']; click_to(pg, pg.locator('main a.cta-primary', has_text='주문하기'), r'/health/order$'); until(lambda: pg.evaluate(JS_ORDER)['items'], 15)
            for c in pg.locator('main label.hlt-chk input[type=checkbox]').all(): c.check()
            pg.wait_for_timeout(300); o = pg.evaluate(JS_ORDER)
            return o['btn'] == [f"{won(P3['price'] * N)} 결제하기", False] and f'× {N}개' in (o['items'] or [''])[0], f"{(o['items'] or [''])[0][:60]} · {o['btn']}"

        # v10.26 (G-182) — 전에는 **같은 계정**으로 1개를 따로 주문해 이 상황을 만들었습니다. 그 주문이 내 장바구니의 그 줄을 비우므로, 이제는 열어 둔 주문서가
        #   「장바구니와 다른 예전 주문서」가 되어 서버가 CART_CHANGED 로 거절합니다(맞는 동작). 「다른 손님이 먼저 사 간」 상황 그대로 **둘째 계정**이 사 가게 합니다 — 내 장바구니는 그대로입니다.
        @R.add('(준비) 주문서를 열어 둔 사이 재고가 1개 줄어든 상황을 만듦 — 다른 손님(둘째 계정)이 1개를 먼저 주문함(API) · 내 장바구니는 그대로', 'API')
        def _():
            em2, pw2, tok2, aid2 = signup('flw_mall2', '흐름몰둘'); call('POST', '/verifications/identity', tok2, {'provider': 'PASS'})
            st0, a2 = call('POST', '/me/health/addresses', tok2, {'receiver': '둘째손님', 'phone': '010-2222-3333', 'zipcode': '06000', 'addr1': '서울 강남구 테헤란로 2'})
            addr2 = (a2 or {}).get('id') or q(f"select id from hlt_addresses where account_id='{aid2}' limit 1")
            st, j = call('POST', '/health/orders', tok2, {'addressId': addr2, 'items': [{'productCode': P3['code'], 'qty': 1}]}); no = (j or {}).get('orderNo')
            if no: S['no6a'] = no; S['tok6a'] = tok2      # 다른 계정의 주문 — 내 주문 목록(S['orders'])에는 넣지 않습니다
            return st == 201 and bool(no) and stock(P3['code']) == S['n6'] - 1 and cart_db(aid, P3['code']) == str(S['n6']), f"{st} · 둘째 계정 주문 {no} · 재고 {S['n6']} → {stock(P3['code'])} · 내 장바구니 {cart_db(aid, P3['code'])}개 그대로"

        @R.add('열어 둔 주문서의 결제 단추를 누름(재고보다 1개 많은 주문) → 주문이 거절되고 「주문을 마치지 못했습니다」 화면: 「재고가 부족합니다 — 상품 이름 (남은 수량 N−1)」 · 오류코드 · 단추 「다시 시도 · 주문 내역」', '화면')
        def _():
            pg = S['pg']; N = S['n6']; S['w'].allow.append('422 POST /health/orders'); click_to(pg, pg.locator('main button.cta-primary'), r'/health/order/(fail|pay)\?')
            t = norm(text(pg, 'main')); msg = norm(text(pg, 'main .hlt-fail b')); btns = [norm(x) for x in pg.locator('main .hlt > .hlt-btns a').all_inner_texts()]; code = re.search(r'오류코드 (\S+)', t)
            if '/health/order/pay' in pg.url:
                m = re.search(r'[?&]no=([^&]+)', pg.url); S['orders'].append(m.group(1) if m else '')
            return '/health/order/fail' in pg.url and '주문을 마치지 못했습니다' in t and '재고가 부족합니다' in msg and P3['name'] in msg and f'남은 수량 {N - 1}' in msg and btns == ['다시 시도', '주문 내역'], \
                f"{msg} · 오류코드 {code.group(1) if code else '?'} · 단추 {btns}"

        @R.add('거절된 주문은 기록에 남지 않음 — 이 상품의 내 주문 0건(둘째 계정의 (준비) 주문만 결제 대기) · 품목 없는 주문 0 · 재고는 N−1 그대로', 'DB', fatal=False)
        def _():
            n = rows(f"select o.order_no, o.status, i.qty from hlt_orders o join hlt_order_items i on i.order_id=o.id join hlt_products p on p.id=i.product_id where o.account_id='{aid}' and p.code='{P3['code']}' and o.created_at >= '{T0}'")
            empty = q(f"select count(*) from hlt_orders o where o.account_id='{aid}' and not exists (select 1 from hlt_order_items i where i.order_id=o.id)")
            return n == [] and order_db(S['no6a']).get('status') == 'PENDING' and empty == '0' and stock(P3['code']) == S['n6'] - 1, f"내 주문 {n} · 둘째 계정 주문 {S['no6a']} {order_db(S['no6a']).get('status')} · 품목 없는 주문 {empty} · 재고 {stock(P3['code'])}"

        @R.add('실패 화면의 「다시 시도」를 누름 → 장바구니로 돌아옴', '화면', fatal=False)
        def _():
            pg = S['pg']; click_to(pg, pg.locator('main .hlt > .hlt-btns a', has_text='다시 시도'), r'/health/cart$'); c = until(lambda: (lambda x: x if x['lines'] or x['empty'] else None)(pg.evaluate(JS_CART)), 15) or pg.evaluate(JS_CART)
            return '/health/cart' in pg.url and (c['empty'] or bool(c['lines'])), '장바구니가 비어 있음' if c['empty'] else f"{[(l['name'], l['qty']) for l in c['lines']]} · {c['err']}"

        @R.add(f"(품절 만들기) 「{P3['name']}」 상세에서 남은 수량 전부(N−1개)를 넣고 「바로구매」 → 주문서 → 동의 → 결제 단추 → 결제 화면에서 멈춤 — 결제 대기 주문이 재고를 모두 잡음", '화면')
        def _():
            pg = S['pg']; N = S['n6']; call('PATCH', f"/me/health/cart/{P3['code']}", S['tok'], {'qty': 0}); goto(pg, p3)
            inp = pg.locator('main [data-options] .hlt-qty input'); inp.fill(str(N - 1)); pg.wait_for_timeout(300); v = inp.input_value()
            click_to(pg, pg.locator('main [data-options] > .hlt-btns button', has_text='바로구매'), r'/health/order$'); until(lambda: pg.evaluate(JS_ORDER)['items'], 15); it = (pg.evaluate(JS_ORDER)['items'] or [''])[0]
            no = agree_and_pay(pg)
            if no: S['no6b'] = no; S['orders'].append(no)
            return v == str(N - 1) and f'× {N - 1}개' in it and bool(no), f"수량 칸 {v} · {it[:50]} · 주문 {no}"

        @R.add('재고 기록 — 그 상품의 재고가 0 · 결제 대기 주문 2건(둘째 계정 1개 + 내 N−1개)이 잡고 있음', 'DB')
        def _():
            a, b_ = order_db(S['no6a']), order_db(S['no6b']); now_ = stock(P3['code'])
            ok = now_ == 0 and a.get('status') == 'PENDING' and b_.get('status') == 'PENDING' and b_.get('items') == f"{P3['code']}×{S['n6'] - 1}@{P3['price']}"
            if ok: S['soldout'] = True
            return ok, f"재고 {now_} · {S['no6a']} {a.get('items')} · {S['no6b']} {b_.get('items')}"

        @R.add('품절된 상품의 상세를 다시 엶(사용자 웹이 상품 자료를 30초쯤 기억해 두어 새 값이 보일 때까지 다시 엶) → 「품절」 표시 · 「지금은 품절입니다.」 · 「품절」 단추는 눌리지 않음 · 「장바구니」 「바로구매」 없음', '화면', fatal=False)
        def _():
            pg = S['pg']; t = time.time()
            def cond():
                d = pg.evaluate(JS_PD); return d if d.get('soldBtn') else None
            d = reload_until(pg, p3, cond, 90) or pg.evaluate(JS_PD)
            return d.get('soldBtn') == '품절' and '지금은 품절입니다' in d.get('hint', '') and '품절' in d.get('badge', []) and d.get('buy') is False, f"{d.get('hint')} · 배지 {d.get('badge')} · 단추 {d.get('soldBtn')} · 담는 칸 {'없음' if not d.get('buy') else '있음'} · {int(time.time() - t)}초 뒤 보임"

        @R.add('갈래 목록의 그 상품 카드 — 「품절」 표시 · 「품절 — 입고되면 다시 담으실 수 있습니다」 · 「담기」 단추 없음', '화면', fatal=False)
        def _():
            pg = S['pg']; path = '/health/c/' + (P3.get('categoryCode') or 'ALL')
            def cond():
                c = pg.locator('main .hlt-card', has_text=P3['name']); return c.count() == 1 and c.locator('.hlt-soldveil').count() == 1      # v10.26 — 시안 카드의 품절 가림막
            reload_until(pg, path, cond, 90); c = pg.locator('main .hlt-card', has_text=P3['name']); t = norm(c.inner_text()) if c.count() == 1 else ''
            return c.count() == 1 and '품절' in t and '입고되면 다시 담으실 수 있습니다' in t and c.locator('button').count() == 0, t[:110]

        @R.add('화면에 단추가 없어 API 로 직접 — 품절 상품을 담기 요청 → 거절(422 「남은 수량이 0개입니다 — 상품 이름」) · 장바구니에 들어가지 않음', 'API', fatal=False)
        def _():
            st, j = call('POST', '/me/health/cart', S['tok'], {'productCode': P3['code'], 'qty': 1}); j = j or {}
            return st == 422 and '남은 수량이 0개입니다' in j.get('message', '') and cart_db(aid, P3['code']) == '', f"{st} {j.get('code')} {j.get('message')}"

        @R.add('(뒷정리) 재고를 잡고 있던 결제 대기 주문 2건을 취소 신청(구매자 API) → 운영 승인(API · POST /admin/health/returns/{id}/decide) — 화면으로 하는 취소 · 승인은 M5 에서 봄', 'API')
        def _():
            out = []; ok = True
            for no in (S.get('no6a'), S.get('no6b')):
                if not no: continue
                st, r = call('POST', '/me/health/returns', S.get('tok6a') if no == S.get('no6a') else S['tok'], {'orderNo': no, 'kind': 'CANCEL', 'reason': 'CHANGE_MIND'}); st2, j = call('POST', f"/admin/health/returns/{(r or {}).get('id')}/decide", ADM, {'state': 'APPROVED'})
                ok = ok and st == 201 and st2 in (200, 201) and (j or {}).get('orderStatus') == 'CANCELED'; out.append(f"{no}: 신청 {st} · 승인 {st2} {(j or {}).get('orderStatus')}")
            return ok and len(out) == 2, ' / '.join(out)

        @R.add('취소 뒤 기록 — 두 주문 모두 취소 완료(CANCELED) · 재고 되돌림 시각 · 재고가 M6 시작 값(N)으로 돌아옴', 'DB')
        def _():
            a, b_ = order_db(S['no6a']), order_db(S['no6b']); now_ = stock(P3['code'])
            return a.get('status') == 'CANCELED' and b_.get('status') == 'CANCELED' and a.get('restocked') == 't' and b_.get('restocked') == 't' and now_ == S['n6'], f"{a.get('status')} · {b_.get('status')} · 재고 {now_}(시작 {S['n6']})"

        @R.add('재고가 돌아온 뒤 상세를 다시 엶 → 「남은 수량 N개」 · 「장바구니」 「바로구매」가 다시 나옴(품절 풀림)', '화면', fatal=False)
        def _():
            pg = S['pg']; N = S['n6']
            def cond():
                d = pg.evaluate(JS_PD); return d if f'남은 수량 {N}개' in d.get('hint', '') else None
            d = reload_until(pg, p3, cond, 90) or pg.evaluate(JS_PD)
            return f'남은 수량 {N}개' in d.get('hint', '') and d.get('btns') == ['장바구니', '바로구매'] and not d.get('soldBtn'), f"{d.get('hint')} · 단추 {d.get('btns')}"
        watch_step(R); R.go(need=('pg', 'addr_id'), why='M2 에서 배송지를 넣지 못함(로그인 · 주문서 단계가 막힘)')

        # ═══════════════════════════════════════════════════════════════════════════════
        R = Run('M7 배송지 관리', WHO); R7 = R
        addrs = lambda: S['pg'].evaluate(JS_ADDR)
        def find(label): return next((a for a in addrs() if a['label'] == label), None)

        @R.add(f"위 메뉴의 「배송지 관리」를 누름 → /my/health/addresses 목록에 M2 에서 넣은 「집」이 「기본」 · 새 배송지 폼과 「기본 배송지로 설정」 칸", '화면')
        def _():
            pg = S['pg']; goto(pg, '/my/health/orders'); click_to(pg, pg.locator('main nav.hlt-lnav a', has_text='배송지 관리'), r'/my/health/addresses$'); a = find(L_HOME) or {}
            return a.get('def') is True and pg.locator('main form.hlt-form input[name=makeDefault]').count() == 1 and norm(pg.locator('main form.hlt-form button.cta-primary').inner_text()) == '배송지 저장', f"{a.get('txt', '')[:80]}"

        @R.add(f"새 배송지 「회사」를 넣고(주소 검색은 막아 둠 → 직접 입력 · 「기본 배송지로 설정」은 켜지 않음) 「배송지 저장」 → 「배송지를 저장했습니다.」 · 목록에 추가되고 기본은 그대로 「집」", '화면')
        def _():
            pg = S['pg']; n0 = len(addrs()); fill_address(pg, L_WORK, 2); pg.locator('main form.hlt-form button.cta-primary').click()
            until(lambda: find(L_WORK), 20); t = norm(text(pg, 'main form.hlt-form .ok-note')); w, h = find(L_WORK) or {}, find(L_HOME) or {}
            return '배송지를 저장했습니다' in t and len(addrs()) == n0 + 1 and w.get('def') is False and w.get('btns') == ['기본으로', '삭제'] and h.get('def') is True, f"{t} · {w.get('txt', '')[:60]}"

        @R.add(f"배송지 기록 — 「회사」 행이 생김 · 기본 아님", 'DB', fatal=False)
        def _():
            a = addr_db(L_WORK); return bool(a) and a['def'] == 'f' and a['del'] == 'f' and a['addr1'] == '서울 중구 흐름시험로 2', {k: v for k, v in a.items() if k != 'id'}

        @R.add(f"「회사」의 「기본으로」를 누름 → 「기본」 표시가 「회사」로 옮겨 가고 「집」에는 「기본으로」 단추가 생김", '화면')
        def _():
            pg = S['pg']; pg.locator('main .rows .hlt-box', has_text=L_WORK).locator('button', has_text='기본으로').click(); until(lambda: (find(L_WORK) or {}).get('def'), 20)
            w, h = find(L_WORK) or {}, find(L_HOME) or {}
            return w.get('def') is True and w.get('btns') == ['삭제'] and h.get('def') is False and h.get('btns') == ['기본으로', '삭제'] and addrs()[0]['label'] == L_WORK, f"{L_WORK}: 기본 {w.get('def')} · {L_HOME}: 기본 {h.get('def')} · 맨 위 {addrs()[0]['label']}"

        @R.add(f"배송지 기록 — 기본 배송지가 「회사」 하나뿐(「집」은 기본에서 내려감)", 'DB', fatal=False)
        def _():
            d = rows(f"select label from hlt_addresses where account_id='{aid}' and is_default"); return d == [[L_WORK]] and addr_db(L_HOME).get('def') == 'f', d

        @R.add(f"「기본 배송지로 설정」을 켜고 새 배송지 「부모님」을 저장 → 저장과 함께 「부모님」이 「기본」이 됨", '화면')
        def _():
            pg = S['pg']; fill_address(pg, L_FAM, 3, default=True); pg.locator('main form.hlt-form button.cta-primary').click(); until(lambda: (find(L_FAM) or {}).get('def'), 20)
            f, w = find(L_FAM) or {}, find(L_WORK) or {}
            return f.get('def') is True and w.get('def') is False and len([a for a in addrs() if a['def']]) == 1, f"{L_FAM}: 기본 {f.get('def')} · {L_WORK}: 기본 {w.get('def')} · 모두 {len(addrs())}곳"

        @R.add(f"배송지 기록 — 「부모님」 행이 생기고 기본 배송지는 그것 하나", 'DB', fatal=False)
        def _():
            d = rows(f"select label from hlt_addresses where account_id='{aid}' and is_default"); return d == [[L_FAM]] and addr_db(L_FAM).get('addr1') == '서울 중구 흐름시험로 3', d

        @R.add(f"기본 배송지 「부모님」의 「삭제」를 누름 → 확인 창(「'부모님…' 배송지를 지웁니다.」) 수락 → 목록에서 사라지고 가장 최근 배송지(「회사」)가 「기본」이 됨", '화면')
        def _():
            pg = S['pg']; S['dlg'].clear(); pg.locator('main .rows .hlt-box', has_text=L_FAM).locator('button', has_text='삭제').click(); until(lambda: not find(L_FAM), 20)
            dl = S['dlg'][-1] if S['dlg'] else ''; w = find(L_WORK) or {}
            return find(L_FAM) is None and dl == f"'{L_FAM}' 배송지를 지웁니다." and w.get('def') is True and len(addrs()) == 2, f"확인 창 「{dl}」 · 남은 곳 {[(a['label'], '기본' if a['def'] else '') for a in addrs()]}"

        @R.add(f"배송지 기록 — 주문에 쓰인 적 없는 「부모님」은 행째 지워짐(개인정보를 남기지 않음) · 기본 배송지는 「회사」 하나", 'DB', fatal=False)
        def _():
            d = rows(f"select label from hlt_addresses where account_id='{aid}' and is_default"); return addr_db(L_FAM) == {} and d == [[L_WORK]], f"{L_FAM} 행 {'없음' if not addr_db(L_FAM) else '남음'} · 기본 {d}"

        @R.add(f"주문에 쓰였던 「집」(그 주문들은 모두 취소 · 반품으로 끝남)의 「삭제」 → 목록에서 사라짐", '화면')
        def _():
            pg = S['pg']; pg.locator('main .rows .hlt-box', has_text=L_HOME).locator('button', has_text='삭제').click(); until(lambda: not find(L_HOME) or norm(text(pg, 'main .rows .form-error')), 20)
            er = norm(text(pg, 'main .rows .form-error')); return find(L_HOME) is None and not er, er or f"남은 곳 {[a['label'] for a in addrs()]}"

        @R.add(f"배송지 기록 — 「집」은 지난 주문이 가리키고 있어 행은 남기고 감춤(deleted_at)으로 처리 · 그 주문들의 배송지 연결은 그대로", 'DB', fatal=False)
        def _():
            a = addr_db(L_HOME); n = q(f"select count(*) from hlt_orders where address_id='{a.get('id')}'") if a else '0'
            return bool(a) and a['del'] == 't' and a['def'] == 'f' and int(n) >= 1, f"감춤 {a.get('del')} · 기본 {a.get('def')} · 이 배송지를 가리키는 주문 {n}건"

        @R.add(f"마지막 「회사」도 삭제 → 「등록된 배송지가 없습니다 …」", '화면', fatal=False)
        def _():
            pg = S['pg']; pg.locator('main .rows .hlt-box', has_text=L_WORK).locator('button', has_text='삭제').click(); until(lambda: pg.locator('main p.empty').count() == 1, 20); t = norm(text(pg, 'main p.empty'))
            return (('등록된 배송지가 없습니다' in t) if new_ok else find(L_WORK) is None), t[:60] or f"남은 곳 {[a['label'] for a in addrs()]}"

        @R.add('배송지 기록 — 이 점검이 넣은 배송지 가운데 살아 있는(감추지 않은) 것이 0', 'DB', fatal=False)
        def _():
            n = rows(f"select label, is_default, (deleted_at is not null) from hlt_addresses where account_id='{aid}' and label in ('{L_HOME}','{L_WORK}','{L_FAM}')"); return [x for x in n if x[2] == 'f'] == [], n
        watch_step(R); R.go(need=('pg',), why='M1 에서 로그인하지 못함')

        # ── 마지막 확인(M7 의 끝에 이어 적음) — 시험 주문은 모두 닫힘 · 재고는 처음 값 ──
        R = Run(flow=R7.F)
        mine = lambda: rows(f"select o.order_no, o.status, (o.restocked_at is not null) from hlt_orders o where " + (f"o.account_id='{aid}'" if new_ok else "o.order_no in ('" + "','".join([x for x in S['orders'] if x] or ['-']) + "')") + " order by o.created_at")

        @R.add('【마지막 확인】 (뒷정리) 흐름이 중간에 멈춰 닫히지 않은 시험 주문이 있으면 취소 · 반품 신청 → 운영 승인(API)으로 닫음 · 장바구니도 비움', 'API', fatal=False)
        def _():
            out = []
            for no, st_, _r in mine():
                if st_ in ('CANCELED', 'RETURNED'): continue
                oid = order_db(no).get('id'); rid = q(f"select id from hlt_returns where order_id='{oid}' and state='REQUESTED' order by created_at desc limit 1")
                kind = 'CANCEL' if st_ in ('PENDING', 'PAID', 'PREPARING') else 'RETURN'
                if not rid: rid = (call('POST', '/me/health/returns', S['tok'], {'orderNo': no, 'kind': kind, 'reason': 'CHANGE_MIND' if kind == 'CANCEL' else 'DEFECT', **({'opened': False} if kind == 'RETURN' else {})})[1] or {}).get('id')
                kind = q(f"select kind from hlt_returns where id='{rid}'") or kind
                st2, j = call('POST', f'/admin/health/returns/{rid}/decide', ADM, {'state': 'APPROVED', **({'opened': False} if kind == 'RETURN' else {})}); out.append(f"{no}({st_}) → {st2} {(j or {}).get('orderStatus')}")
            for c in (P1, P2, P3): call('PATCH', f"/me/health/cart/{c['code']}", S['tok'], {'qty': 0})
            # 둘째 계정(M6 의 「다른 손님」)의 주문이 닫히지 않은 채 남았으면 그것도 닫습니다
            if S.get('no6a') and order_db(S['no6a']).get('status') in ('PENDING', 'PAID', 'PREPARING'):
                oid6 = order_db(S['no6a']).get('id'); rid6 = q(f"select id from hlt_returns where order_id='{oid6}' and state='REQUESTED' order by created_at desc limit 1") \
                    or (call('POST', '/me/health/returns', S['tok6a'], {'orderNo': S['no6a'], 'kind': 'CANCEL', 'reason': 'CHANGE_MIND'})[1] or {}).get('id')
                st6, j6 = call('POST', f'/admin/health/returns/{rid6}/decide', ADM, {'state': 'APPROVED'}); out.append(f"{S['no6a']}(둘째 계정) → {st6} {(j6 or {}).get('orderStatus')}")
            if not new_ok and ADDR0:      # 기존 계정으로 진행했을 때 — 넣었던 배송지를 지우고 기본 배송지를 처음 것으로 되돌림
                for lb in (L_HOME, L_WORK, L_FAM):
                    a_ = addr_db(lb)
                    if a_ and a_['del'] == 'f': call('DELETE', f"/me/health/addresses/{a_['id']}", S['tok'])
                call('PATCH', f'/me/health/addresses/{ADDR0}/default', S['tok'])
            left = [x for x in mine() if x[1] not in ('CANCELED', 'RETURNED')] + ([S['no6a']] if S.get('no6a') and order_db(S['no6a']).get('status') not in ('CANCELED', 'RETURNED') else [])
            return not left, ('닫은 주문: ' + ' / '.join(out)) if out else '닫히지 않은 채 남은 주문 없음(할 일 없음)'

        @R.add('【마지막 확인】 이 점검이 만든 시험 주문이 모두 취소 완료 · 반품 완료 상태 — 결제된 채(PAID) · 결제 대기로 남은 것 없음 · 받은 돈은 환불(결제 취소)됨', 'DB', fatal=False)
        def _():
            m = mine(); nos = "','".join(x[0] for x in m) or '-'
            pays = rows(f"select p.state, count(*) from hlt_payments p join hlt_orders o on o.id=p.order_id where o.order_no in ('{nos}') group by 1 order by 1")
            rets = rows(f"select r.kind||'/'||r.state, count(*) from hlt_returns r join hlt_orders o on o.id=r.order_id where o.order_no in ('{nos}') group by 1 order by 1")
            ok = len(m) >= 1 and all(x[1] in ('CANCELED', 'RETURNED') and x[2] == 't' for x in m) and not any(p_[0] in ('PAID', 'READY') for p_ in pays) and set(x for x in S['orders'] if x) <= {x[0] for x in m}
            return ok, f"주문 {len(m)}건 {[(x[0], x[1]) for x in m]} · 결제 건 {pays} · 신청 {rets}"

        @R.add('【마지막 확인】 건드린 상품 3종의 재고가 처음 값과 같음(같은 시간에 다른 계정의 주문이 있었으면 그만큼은 빼고 셈) · 내 장바구니 비어 있음', 'DB', fatal=False)
        def _():
            out = []; ok = True
            for x in (P1, P2, P3):
                d = others_delta(x['code']); now_ = stock(x['code']); ok = ok and now_ == STOCK0[x['code']] + d
                out.append(f"{x['name']} 처음 {STOCK0[x['code']]} → 끝 {now_}" + (f"(다른 계정 주문분 {d:+d})" if d else ''))
            n_cart = q(f"select count(*) from hlt_cart_items where account_id='{aid}'" + ('' if new_ok else f" and product_id in (select id from hlt_products where code in ('{P1['code']}','{P2['code']}','{P3['code']}'))"))
            return ok and n_cart == '0', ' · '.join(out) + f' · 장바구니 {n_cart}줄'
        R.go()
        b.close()


def others_delta(code):
    """내 계정이 아닌 주문이 이 점검이 도는 동안 그 상품 재고에 준 변화(새 주문 −, 취소 · 반품으로 되돌림 +) — 공용 DB 라 다른 시험이 같이 돕니다"""
    t0, aid = S.get('t0'), S.get('aid')
    v = q(f"select coalesce(sum((case when o.created_at >= '{t0}' then -i.qty else 0 end) + (case when o.restocked_at >= '{t0}' then i.qty else 0 end)),0) "
          f"from hlt_order_items i join hlt_orders o on o.id=i.order_id join hlt_products p on p.id=i.product_id "
          f"where p.code='{code}' and o.account_id <> '{aid}' and (o.created_at >= '{t0}' or o.restocked_at >= '{t0}')")
    return int(v or 0)


if __name__ == '__main__':
    S['t0'] = q('select now()')
    try: main()
    except Exception as ex:
        import traceback; traceback.print_exc()
        Flow('실행 중 오류', '').step('시험 도구가 끝까지 돌지 못함', 'API', False, repr(ex)[:300])
    if S['notes']: print('\n[눈에 띈 것]\n · ' + '\n · '.join(dict.fromkeys(S['notes'])), file=sys.stderr)
    if EXT: print(f'[막은 외부 요청 {len(EXT)}건] {sorted(set(EXT))[:3]}', file=sys.stderr)
    finish('mall')
