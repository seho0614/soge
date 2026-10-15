"""v10.25 소개몰 — 비교 그림 둘째 묶음(10/7 답 4건 반영분). 결과: /home/claude/design_1007/cmp25

  H  바닥 고지            지금 ↔ 바꿀 모양(시안 · 개발분 · 소개몰 / 소개광장)
  I  옛 이름 정리          시안에서 「소개몰」(= 안심소개의 옛 이름) · 「소개머니」 · 「건강몰」이 보이던 자리, 지금 ↔ 바꿀 모양
  J  약관 문구            개발분의 약관 3종에서 바뀌는 줄, 지금 ↔ 바꿀 모양
  K  하위 화면 전체 모음    개발분 22쪽 · 시안 20쪽, 지금 ↔ 바꿀 모양

  지금 = 킷 v10.24(시안 파일 · 5174 · API 3000) · 바꿀 모양 = 미리보기(시안 파일 · 5186 · API 3186 · 새 DB). 킷 작업본은 건드리지 않습니다.
  미리보기 DB(sgb_pv25)에는 주문 화면을 찍으려고 배송지 1건 · 주문 1건을 만듭니다(버리는 DB).
  사용: python3 shot_mall2.py [--compose]
"""
import os, re, sys, json, difflib, urllib.request, urllib.error
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw
import shot_mall as sm

RAW, OUT, F, col, row_img = sm.RAW, sm.OUT, sm.F, sm.col, sm.row_img
P = {'old': sm.P_OLD, 'new': sm.P_NEW}; W = {'old': sm.W_OLD, 'new': sm.W_NEW}
A = {'old': os.environ.get('API_OLD', 'http://localhost:3000/api/v1'), 'new': os.environ.get('API_NEW', 'http://localhost:3186/api/v1')}
OLDC, NEWC, WEBC = sm.OLD, sm.NEW, sm.WEB
META = f'{RAW}/more_meta.json'

# 시안 — 옛 이름이 보이던 본보기 화면(전체는 「소개몰」 12장 · 「소개머니」 7장 · 「건강몰」 3장 — scan 으로 셉니다)
NOID = {'schres': '검색 결과 화면(schres)'}
EX = ['cs', 'reg', 'schres', 'malbrk', 'admsitn', 'integ', 'gwansep', 'admhst', 'invreg']
REPL = [(r'(?<!뱅크)소개몰', '안심소개'), ('소개머니', '소개장터'), ('건강몰', '소개몰'), ('소개뱅크몰', '소개몰')]
P_ROUTES = ['#/', '#/direct', '#/search', '#/cart', '#/order', '#/order/pay', '#/order/done', '#/order/fail', '#/guide', '#/ingredients', '#/concerns', '#/my/addresses',
            '#/my/returns', '#/my/returns/new', '#/my/orders', '#/c/HLT_FOOD', '#/i/VITC', '#/w/IMMUNE', '#/p/p01', '#/nope']

JS_NODES = """(k) => { location.hash = ''; __VIEW.paint(k); document.querySelectorAll('.admask,.adfloat').forEach(e => e.remove());
  const sc = document.getElementById('screen'); const w = document.createTreeWalker(sc, NodeFilter.SHOW_TEXT); const out = []; let n;
  while ((n = w.nextNode())) { if (n.parentElement.closest('header, script, style')) continue; out.push(n.nodeValue) } return out }"""
JS_MARK = """([k, marks, color]) => { location.hash = ''; __VIEW.paint(k); document.querySelectorAll('.admask,.adfloat').forEach(e => e.remove());
  const sc = document.getElementById('screen'); const w = document.createTreeWalker(sc, NodeFilter.SHOW_TEXT); const nodes = []; let n;
  while ((n = w.nextNode())) { if (n.parentElement.closest('header, script, style')) continue; nodes.push(n) }
  let first = null;
  for (const [idx, segs] of marks) { const nd = nodes[idx]; const t = nd.nodeValue; const fr = document.createDocumentFragment(); let last = 0;
    for (const [a, b] of segs) { fr.append(t.slice(last, a)); const mk = document.createElement('mark'); mk.textContent = t.slice(a, b);
      mk.style.cssText = 'background:' + color + ';color:#000;outline:2px solid #e5362f;outline-offset:1px;border-radius:2px'; fr.append(mk); if (!first) first = mk; last = b }
    fr.append(t.slice(last)); nd.replaceWith(fr) }
  if (!first) return null; first.scrollIntoView({ block: 'center' }); const r = first.getBoundingClientRect(); return { y: r.top, x: r.left } }"""


def call(base, m, p, tok=None, body=None):
    r = urllib.request.Request(base + p, method=m, data=json.dumps(body).encode() if body is not None else None,
                               headers={'content-type': 'application/json', **({'authorization': 'Bearer ' + tok} if tok else {})})
    try:
        with urllib.request.urlopen(r) as f: return f.status, json.load(f)
    except urllib.error.HTTPError as e: return e.code, e.read().decode()[:300]


def segs_old(t):
    """옛 글자에서 표시할 구간(옛 소개몰 · 소개머니 · 건강몰) — 「소개뱅크몰」은 메뉴 이름이라 여기서는 표시하지 않습니다"""
    out = []
    for rx, _ in REPL[:3]:
        out += [(m.start(), m.end()) for m in re.finditer(rx, t)]
    return sorted(out)

def to_new(t):
    """옛 글자 → 새 글자, 그리고 새 글자에서 표시할 구간"""
    rx = re.compile('|'.join(f'(?P<g{i}>{r})' for i, (r, _) in enumerate(REPL)))
    out, segs, last = '', [], 0
    for m in rx.finditer(t):
        out += t[last:m.start()]; i = int(m.lastgroup[1:]); rep = REPL[i][1]
        if i < 3: segs.append((len(out), len(out) + len(rep)))
        out += rep; last = m.end()
    return out + t[last:], segs


def order_no(tag):
    """주문 화면을 찍을 주문 번호 — 지금 쪽은 있는 주문을 그대로, 미리보기 쪽(새 DB)은 배송지 · 주문을 하나 만듭니다"""
    base = A[tag]; tok = call(base, 'POST', '/auth/login', body={'email': 'buyer@x.com', 'password': 'sgb-dev-1234'})[1]['accessToken']
    _, o = call(base, 'GET', '/me/health/orders', tok); rows = o if isinstance(o, list) else o.get('items', [])
    if rows: return rows[0].get('orderNo') or rows[0].get('no')
    assert tag == 'new', '킷 DB 에는 주문을 만들지 않습니다'
    _, ad = call(base, 'GET', '/me/health/addresses', tok)
    if not ad:
        st, a1 = call(base, 'POST', '/me/health/addresses', tok, {'label': '집', 'receiver': '시험구매자', 'phone': '010-0000-0000', 'zipcode': '06000', 'addr1': '서울 (시험) 주소'}); assert st < 300, a1
        ad = [a1]
    st, o = call(base, 'POST', '/health/orders', tok, {'addressId': ad[0]['id'], 'items': [{'productCode': 'VITD-90', 'qty': 1}]}); assert st < 300, o
    return o.get('orderNo') or o.get('no')


def shoot():
    meta = {'names': {}, 'title': {}, 'terms': {}, 'web': {}, 'counts': {}}
    with sync_playwright() as p:
        b = p.chromium.launch()
        noweb = lambda pg: pg.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())

        # ── H — 바닥 ──────────────────────────────────────────────────────────────
        for tag in ('old', 'new'):
            pg = b.new_page(viewport={'width': 1500, 'height': 1000}); noweb(pg); pg.goto(P[tag] + '#/health'); pg.wait_for_timeout(1800); pg.evaluate(sm.CLEAN)
            h = pg.evaluate(sm.FULL); pg.set_viewport_size({'width': 1500, 'height': min(h, 6000)}); pg.wait_for_timeout(300)
            pg.screenshot(path=f'{RAW}/h_p_{tag}_mall.png', clip={'x': 0, 'y': max(0, h - 470), 'width': 1500, 'height': 470}); pg.close()
            pg = b.new_page(viewport={'width': 1500, 'height': 1000}); noweb(pg); pg.goto(P[tag] + '#/community'); pg.wait_for_timeout(1500); pg.evaluate(sm.CLEAN)
            pg.screenshot(path=f'{RAW}/h_p_{tag}_cmu_full.png', full_page=True); pg.close()
            for nm, path in (('mall', '/health'), ('guide', '/health/guide'), ('cmu', '/community')):
                pg = b.new_page(viewport={'width': 1500, 'height': 1000}); pg.goto(W[tag] + path, wait_until='networkidle'); pg.wait_for_timeout(800); pg.goto(W[tag] + path, wait_until='networkidle')
                pg.screenshot(path=f'{RAW}/h_w_{tag}_{nm}_full.png', full_page=True); pg.close()

        # ── I — 옛 이름(시안 본체 화면) ────────────────────────────────────────────
        po = b.new_page(viewport={'width': 1500, 'height': 1000}); noweb(po); po.goto(P['old']); po.wait_for_timeout(1500)
        pn = b.new_page(viewport={'width': 1500, 'height': 1000}); noweb(pn); pn.goto(P['new']); pn.wait_for_timeout(1500)
        keys = po.evaluate("Object.keys(__VIEW.screens)"); ids = po.evaluate("(()=>{const m=__VIEW.meta();const o={};Object.keys(m).forEach(k=>o[k]=m[k]&&m[k].id);return o})()")
        cnt = {'옛 소개몰': [], '소개머니': [], '건강몰': []}; left = {'소개머니': [], '건강몰': []}
        for k in keys:
            t = ' '.join(po.evaluate(JS_NODES, k))
            for nm, rx in (('옛 소개몰', REPL[0][0]), ('소개머니', '소개머니'), ('건강몰', '건강몰')):
                if re.search(rx, t): cnt[nm].append(k)
            t2 = ' '.join(pn.evaluate(JS_NODES, k))
            for nm in left:
                if nm in t2: left[nm].append(k)
        meta['counts'] = {'old': cnt, 'new_left': left}
        for k in EX:
            on = po.evaluate(JS_NODES, k); nn = pn.evaluate(JS_NODES, k); m_old, m_new, words = [], [], []
            same = len(on) == len(nn)
            for i, t in enumerate(on):
                so = segs_old(t)
                if not so: continue
                m_old.append([i, so]); words += [t[a:b] for a, b in so]
                if same:
                    t2, sn = to_new(t)
                    if t2 == nn[i]: m_new.append([i, sn])
            r1 = po.evaluate(JS_MARK, [k, m_old, '#ffe14d']); r2 = pn.evaluate(JS_MARK, [k, m_new, '#b7f0c8']) if m_new else None
            meta['names'][k] = {'id': ids.get(k), 'words': sorted(set(words)), 'n': len(words), 'new_marked': sum(len(s) for _, s in m_new), 'same_nodes': same}
            for pg, r, tag in ((po, r1, 'old'), (pn, r2, 'new')):
                if not r: continue
                y = max(0, min(1000 - 230, r['y'] - 105)); pg.screenshot(path=f'{RAW}/i_{tag}_{k}.png', clip={'x': 0, 'y': y, 'width': 1500, 'height': 230})
        po.close(); pn.close()
        # 소개몰 틀 안의 경로 줄 · 창 제목
        for tag in ('old', 'new'):
            pg = b.new_page(viewport={'width': 1500, 'height': 1000}); noweb(pg); pg.goto(P[tag] + '#/health'); pg.wait_for_timeout(1600); pg.evaluate(sm.CLEAN); tl = {}; hit = []
            for h_ in P_ROUTES:
                pg.evaluate("(h) => window.__hltMall.go(h)", h_); pg.wait_for_timeout(120); tl[h_] = pg.evaluate("document.title")
                if '건강몰' in pg.evaluate("document.getElementById('hltapp').innerText + ' ' + document.title"): hit.append(h_)
            meta['title'][tag] = {'titles': tl, 'gm_routes': hit}
            for nm, h_ in (('ing', '#/ingredients'), ('guide', '#/guide')):
                pg.evaluate("(h) => window.__hltMall.go(h)", h_); pg.wait_for_timeout(250)
                pg.evaluate("""() => { const a = document.getElementById('hltapp'); const w = document.createTreeWalker(a, NodeFilter.SHOW_TEXT); const ns = []; let n; while ((n = w.nextNode())) ns.push(n);
                    for (const nd of ns) { const t = nd.nodeValue; const i = t.indexOf('건강몰'); if (i < 0 || nd.parentElement.closest('script,style')) continue;
                      const fr = document.createDocumentFragment(); fr.append(t.slice(0, i)); const mk = document.createElement('mark'); mk.textContent = '건강몰'; mk.style.cssText = 'background:#ffe14d;color:#000;outline:2px solid #e5362f'; fr.append(mk); fr.append(t.slice(i + 3)); nd.replaceWith(fr) } }""")
                pg.screenshot(path=f'{RAW}/i_{tag}_mall_{nm}.png', clip={'x': 0, 'y': 0, 'width': 1500, 'height': 300})
            pg.close()

        # ── J — 약관 ─────────────────────────────────────────────────────────────
        for code in ('HLT_SALE', 'SERVICE', 'THIRDPARTY'):
            d = {t: call(A[t], 'GET', '/terms/doc/' + code)[1] for t in ('old', 'new')}; ol = d['old']['body'].split('\n'); nl = d['new']['body'].split('\n')
            ch = [(tg, i1, i2, j1, j2) for tg, i1, i2, j1, j2 in difflib.SequenceMatcher(None, ol, nl, autojunk=False).get_opcodes() if tg != 'equal']
            meta['terms'][code] = {'title': d['old']['title'], 'ver': [d['old']['version'], d['new']['version']], 'lines': [[ol[i1:i2], nl[j1:j2]] for _, i1, i2, j1, j2 in ch]}
            for tag, lines, idx, colr in (('old', ol, sorted({i for _, i1, i2, _, _ in ch for i in range(i1, i2)}), '#ffe14d'), ('new', nl, sorted({j for _, _, _, j1, j2 in ch for j in range(j1, j2)}), '#b7f0c8')):
                pg = b.new_page(viewport={'width': 1100, 'height': 1000})
                pg.goto(W[tag] + '/terms/' + code, wait_until='networkidle'); pg.wait_for_timeout(1200); pg.goto(W[tag] + '/terms/' + code, wait_until='networkidle')
                r = pg.evaluate("""([idx, colr]) => { const el = document.querySelector('.doc-body'); const lines = el.textContent.split('\\n'); el.textContent = ''; let top = null, bot = null; const ms = [];
                    lines.forEach((l, i) => { if (idx.includes(i)) { const s = document.createElement('span'); s.textContent = l; s.style.cssText = 'background:' + colr + ';outline:2px solid #e5362f;outline-offset:1px'; el.append(s); ms.push(s) } else el.append(l); if (i < lines.length - 1) el.append('\\n') });
                    if (!ms.length) return null; ms[0].scrollIntoView({ block: 'center' }); const a = ms[0].getBoundingClientRect(), z = ms[ms.length - 1].getBoundingClientRect(); return { top: a.top, bot: z.bottom, body: lines.length } }""", [idx, colr])
                if r:
                    y = max(0, r['top'] - 130); hh = min(1000 - y, (r['bot'] - r['top']) + 260); pg.screenshot(path=f'{RAW}/j_{tag}_{code}.png', clip={'x': 0, 'y': y, 'width': 1100, 'height': hh})
                pg.close()

        # ── K — 하위 화면 모음 ─────────────────────────────────────────────────────
        for tag in ('old', 'new'):
            no = order_no(tag); meta['web'][tag] = {'order': no, 'pages': []}
            pages = [('메인', '/health'), ('성분 목록', '/health/ingredients'), ('고민 목록', '/health/concerns'), ('성분별 상품', '/health/i/VIT-D'), ('고민별 상품', '/health/w/IMMUNE'), ('전체 상품', '/health/c/ALL'),
                     ('직판 상품', '/health/direct'), ('검색', '/health/search?q=비타민'), ('상품 상세', '/health/p/VITD-90'), ('이용안내', '/health/guide'),
                     ('장바구니', '/health/cart'), ('주문서', '/health/order'), ('결제', f'/health/order/pay?no={no}'), ('결제 승인(돌아오는 주소)', '/health/order/pay/success'), ('주문 완료', f'/health/order/done?no={no}'),
                     ('결제 실패', f'/health/order/fail?no={no}&code=USER_CANCEL&msg=시험'), ('내 주문', '/my/health/orders'), ('주문 상세', f'/my/health/orders/{no}'), ('배송 조회', f'/my/health/orders/{no}/ship'),
                     ('취소 · 반품 내역', '/my/health/returns'), ('취소 · 반품 신청', f'/my/health/returns/new?o={no}'), ('배송지', '/my/health/addresses')]
            c = b.new_context(viewport={'width': 1500, 'height': 1050}); pg = c.new_page()
            pg.goto(W[tag] + '/login', wait_until='networkidle'); pg.fill('input[name=email]', 'buyer@x.com'); pg.fill('input[name=password]', 'sgb-dev-1234'); pg.click('form.auth button'); pg.wait_for_timeout(2500)
            if tag == 'new':        # 장바구니 · 주문서가 빈 화면이 되지 않게 미리보기 쪽에만 한 개 담습니다(킷 DB 의 장바구니는 건드리지 않음)
                pg.goto(W[tag] + '/health/p/OMG-60', wait_until='networkidle'); btn = pg.locator('main button:has-text("담기")').first
                if btn.count(): btn.click(); pg.wait_for_timeout(900)
            for i, (lab, path) in enumerate(pages):
                r = pg.goto(W[tag] + path, wait_until='networkidle'); pg.wait_for_timeout(350)
                d = pg.evaluate("({ b2: !!document.querySelector('header.b2-hd'), base: !!document.querySelector('header.pc-hd'), cur: (document.querySelector('header nav a[aria-current=page]') || {}).textContent || null, path: location.pathname, h1: (document.querySelector('main h1, h1') || {}).innerText || '' })")   # v10.29 — 공통 머리줄 header.hd → header.pc-hd(오른쪽 .hd-right → .pc-hr)
                pg.screenshot(path=f'{RAW}/k_w_{tag}_{i:02d}.png'); meta['web'][tag]['pages'].append({'label': lab, 'path': path, 'status': r.status if r else None, **d})
            c.close()
            pg = b.new_page(viewport={'width': 1500, 'height': 1050}); noweb(pg); pg.goto(P[tag] + '#/health'); pg.wait_for_timeout(1600); pg.evaluate(sm.CLEAN); rows = []
            for i, h_ in enumerate(P_ROUTES):
                pg.evaluate("(h) => window.__hltMall.go(h)", h_); pg.wait_for_timeout(260); pg.evaluate(sm.CLEAN)
                d = pg.evaluate("(() => { const m = document.querySelector('#hltapp main'); return { screen: m ? m.getAttribute('data-screen') : null, b2: !!document.querySelector('#hltapp header.b2-hd'), title: document.title } })()")
                pg.screenshot(path=f'{RAW}/k_p_{tag}_{i:02d}.png'); rows.append({'route': h_, **d})
            meta.setdefault('proto', {})[tag] = rows; pg.close()
        b.close()
    json.dump(meta, open(META, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


# ── 붙이기 ───────────────────────────────────────────────────────────────────────
def bottom(path, h, w=1500):
    im = Image.open(path).convert('RGB'); return im.crop((0, max(0, im.size[1] - h), im.size[0], im.size[1]))

def colim(im, label, tone, w=1100):
    if im.size[0] != w: im = im.resize((w, int(im.size[1] * w / im.size[0])), Image.LANCZOS)
    c = Image.new('RGB', (w, im.size[1] + 44), '#ffffff'); d = ImageDraw.Draw(c); d.rectangle((0, 0, w, 44), fill=tone); d.text((12, 8), label, fill='#ffffff', font=F(21)); c.paste(im, (0, 44)); return c

def band(text, w, tone='#333333', h=46, size=23):
    c = Image.new('RGB', (w, h), tone); ImageDraw.Draw(c).text((14, 8), text, fill='#ffffff', font=F(size)); return c

def note(lines, w, size=20, pad=12):
    c = Image.new('RGB', (w, pad * 2 + len(lines) * (size + 9)), '#fffbe6'); d = ImageDraw.Draw(c)
    for i, l in enumerate(lines): d.text((14, pad + i * (size + 9)), l, fill='#222222', font=F(size))
    return c

def pair(a, b, gap=12): return row_img([a, b], gap=gap)

def grid(tiles, per, gap=12, bg='#8a8a8a'):
    rows = [row_img(tiles[i:i + per], gap=gap) for i in range(0, len(tiles), per)]; Wd = max(r.size[0] for r in rows); H = sum(r.size[1] for r in rows) + gap * (len(rows) - 1)
    s = Image.new('RGB', (Wd, H), bg); y = 0
    for r in rows: s.paste(r, (0, y)); y += r.size[1] + gap
    return s

def save(rows, out, gap=10):
    Wd = max(r.size[0] for r in rows); H = sum(r.size[1] for r in rows) + gap * (len(rows) - 1); s = Image.new('RGB', (Wd, H), '#8a8a8a'); y = 0
    for r in rows: s.paste(r, (0, y)); y += r.size[1] + gap
    s.save(f'{OUT}/{out}'); print(out, s.size, os.path.getsize(f'{OUT}/{out}') // 1024, 'KB')


def compose():
    meta = json.load(open(META, encoding='utf-8')); L = lambda n: f'{RAW}/{n}.png'
    # H
    rows = [band('시안 · 소개몰 — 바닥', 2212), pair(colim(Image.open(L('h_p_old_mall')), '지금 — 통신판매중개자 고지 하나 · 직판 고지 없음', OLDC), colim(Image.open(L('h_p_new_mall')), '바꿀 모양 — 직판 고지 + 통신판매중개자 고지(옛 바닥은 얇은 줄만)', NEWC)),
            band('개발분 · 소개몰 메인 — 바닥', 2212), pair(colim(bottom(L('h_w_old_mall_full'), 330), '지금 — 통신판매중개자 고지 하나(직판 고지는 설정에만 있고 화면에 안 나옴)', OLDC), colim(bottom(L('h_w_new_mall_full'), 330), '바꿀 모양 — 직판 고지 + 통신판매중개자 고지', WEBC)),
            band('개발분 · 소개몰 하위 쪽(이용안내) — 바닥', 2212), pair(colim(bottom(L('h_w_old_guide_full'), 330), '지금', OLDC), colim(bottom(L('h_w_new_guide_full'), 330), '바꿀 모양 — 메인과 같음', WEBC)),
            band('소개광장 — 바닥(그대로: 통신판매중개자 고지 하나)', 2212), pair(colim(bottom(L('h_w_old_cmu_full'), 300), '개발분 지금', OLDC), colim(bottom(L('h_w_new_cmu_full'), 300), '개발분 바꿀 모양 — 달라지지 않음', WEBC)),
            pair(colim(bottom(L('h_p_old_cmu_full'), 300), '시안 지금', OLDC), colim(bottom(L('h_p_new_cmu_full'), 300), '시안 바꿀 모양 — 달라지지 않음', NEWC))]
    save(rows, '소개몰_비교_H_바닥고지_지금_바꿀모양.png')
    # I
    LAB = {'소개몰': '옛 「소개몰」(= 안심소개의 9/26 이전 이름)', '소개머니': '「소개머니」(= 소개장터의 옛 이름)', '건강몰': '「건강몰」(= 소개몰의 옛 이름)'}
    c = meta['counts']['old']; rows = [note([f'시안 본체 화면에서 옛 이름이 보이던 곳 — 옛 「소개몰」 {len(c["옛 소개몰"])}장 · 「소개머니」 {len(c["소개머니"])}장 · 「건강몰」 {len(c["건강몰"])}장.  바꾼 뒤 남은 곳: 소개머니 {len(meta["counts"]["new_left"]["소개머니"])} · 건강몰 {len(meta["counts"]["new_left"]["건강몰"])}',
                                             '노란 칸 = 지금의 옛 이름 · 초록 칸 = 바꾼 이름.  아래는 본보기 9장 + 소개몰 틀 안의 경로 줄(2장)'], 2212)]
    for k in EX:
        m = meta['names'][k]
        if not os.path.exists(L(f'i_old_{k}')): continue
        w_ = ' · '.join(LAB.get(x, x) for x in m['words'])
        a = colim(Image.open(L(f'i_old_{k}')), f'{m["id"] or NOID.get(k, k)} — 지금: {w_}', OLDC)
        b_ = colim(Image.open(L(f'i_new_{k}')), f'{m["id"] or NOID.get(k, k)} — 바꿀 모양', NEWC) if os.path.exists(L(f'i_new_{k}')) else colim(Image.new('RGB', (1500, 230), '#ffffff'), f'{m["id"]} — 바꿀 모양(표시 못 함)', NEWC)
        rows.append(pair(a, b_))
    to, tn = meta['title']['old'], meta['title']['new']
    rows.append(band(f'소개몰 틀 안 — 경로 줄 · 창 제목의 「건강몰」: 지금 {len(to["gm_routes"])} / {len(P_ROUTES)}곳 → 바꾼 뒤 {len(tn["gm_routes"])}곳', 2212))
    for nm, h_ in (('ing', '#/ingredients'), ('guide', '#/guide')):
        rows.append(pair(colim(Image.open(L(f'i_old_mall_{nm}')), f'지금 — 창 제목 「{to["titles"][h_]}」', OLDC), colim(Image.open(L(f'i_new_mall_{nm}')), f'바꿀 모양 — 창 제목 「{tn["titles"][h_]}」', NEWC)))
    save(rows, '소개몰_비교_I_옛이름정리_지금_바꿀모양.png')
    # J
    rows = [note(['개발분의 약관 3종에서 바뀌는 줄(노란 칸 → 초록 칸). 다른 줄은 한 글자도 바뀌지 않습니다.',
                  '새로 설치한 곳: 판 번호 그대로(1.0)에 고친 글자로 실립니다.   쓰던 곳(이미 공개한 약관이 있는 DB): 새 판(1.1)을 공개하고 옛 판은 보관 처리 → 필수 약관이라 기존 회원에게 다시 동의를 받습니다.'], 2212)]
    for code in ('HLT_SALE', 'SERVICE', 'THIRDPARTY'):
        t = meta['terms'][code]; n = sum(len(a) for a, _ in t['lines'])
        rows.append(band(f'{t["title"]}({code}) — 바뀌는 줄 {n}줄', 2212))
        rows.append(pair(colim(Image.open(L(f'j_old_{code}')), '지금', OLDC), colim(Image.open(L(f'j_new_{code}')), '바꿀 모양', WEBC)))
    save(rows, '소개몰_비교_J_약관문구_지금_바꿀모양.png')
    # K — 개발분
    def tile(a, b_, label, tone, w=560, h=392):
        ims = []
        for pth, t_, tn_ in ((a, '지금', OLDC), (b_, '바꿀 모양', tone)):
            im = Image.open(pth).convert('RGB'); im = im.resize((w, int(im.size[1] * w / im.size[0])), Image.LANCZOS).crop((0, 0, w, h))
            c_ = Image.new('RGB', (w, h + 30), '#ffffff'); d = ImageDraw.Draw(c_); d.rectangle((0, 0, w, 30), fill=tn_); d.text((8, 4), t_, fill='#ffffff', font=F(17)); c_.paste(im, (0, 30)); ims.append(c_)
        pr = row_img(ims, gap=4); c_ = Image.new('RGB', (pr.size[0], pr.size[1] + 36), '#222222'); ImageDraw.Draw(c_).text((8, 5), label, fill='#ffffff', font=F(20)); c_.paste(pr, (0, 36)); return c_
    wp = meta['web']; tiles = []
    for i, pgm in enumerate(wp['new']['pages']):
        o = wp['old']['pages'][i]; path = re.sub(r'H\d{6,}', '(주문번호)', pgm['path'])
        tiles.append(tile(L(f'k_w_old_{i:02d}'), L(f'k_w_new_{i:02d}'), f'{i + 1}. {pgm["label"]}  {path}' + ('' if pgm['status'] == 200 else f'  [{pgm["status"]}]'), WEBC))
    save([note([f'개발분 — 소개몰의 화면 {len(tiles)}쪽(로그인한 구매자). 새 머리줄 · 초록 단추 · 바닥 두 고지만 바뀌고 본문 틀은 그대로입니다.', '지금 쪽은 킷의 개발 DB(주문이 쌓인 것), 바꿀 모양 쪽은 새 DB(주문 1건 · 장바구니 1개를 찍으려고 만듦)라 자료 양이 다릅니다.'], 2260), grid(tiles[:10], 2)], '소개몰_비교_K1_개발분_둘러보기_10쪽.png')
    save([note([f'개발분 — 주문 · 내 주문 쪽 {len(tiles) - 10}쪽(로그인한 구매자)'], 2260), grid(tiles[10:], 2)], '소개몰_비교_K2_개발분_주문_내주문_12쪽.png')
    pp = meta['proto']; tiles = []
    for i, r in enumerate(pp['new']):
        tiles.append(tile(L(f'k_p_old_{i:02d}'), L(f'k_p_new_{i:02d}'), f'{i + 1}. {r["screen"] or "없는 주소"}  {r["route"]}  창 제목 「{pp["old"][i]["title"]}」→「{r["title"]}」', NEWC))
    save([note([f'시안 — 소개몰 틀 안의 화면 {len(tiles)}곳(없는 주소 포함). 메인만 새로 그렸고, 나머지는 머리줄 · 색 · 이름(건강몰 → 소개몰) · 바닥만 바뀝니다.'], 2260), grid(tiles, 2)], '소개몰_비교_K3_시안_화면_20곳.png')


if __name__ == '__main__':
    if '--compose' not in sys.argv: shoot()
    compose()
