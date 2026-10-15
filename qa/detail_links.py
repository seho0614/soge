"""「상세 보기」 링크 목록 — 목록의 항목을 누르면 어느 상세로 가는지 전부 눌러 보고 적습니다. (10/6 요청: 「상세 보기 리스트 · 동작 이상 확인 · 같은 것이 계속 나옴 · 링크 확인」)

  python3 detail_links.py proto     시안(파일로 열어 주소(해시)로 이동 — 관(소개장터 · 안심소개 · 소개창업)마다)   → detail_links_proto.json
  python3 detail_links.py site      실제 웹(로그인 5역할 · 목록 쪽의 상세 링크를 전부 열어 봄)                    → detail_links_site.json

적는 것(항목마다): 어느 화면 · 무엇을 눌렀는지 · 간 곳(주소 · 화면) · 상세에 나온 제목 · 눌렀던 항목과 같은 것인지
판정
  같은 것      누른 항목의 이름이 상세 제목과 맞음
  다른 것      상세는 열리지만 누른 항목이 아님(시안: 상세가 한 건으로 고정돼 무엇을 눌러도 같은 화면)
  이름 없음    누른 것이 「보기」 같은 단추라 견줄 이름이 없음 — 같은 줄의 글로 견줌
"""
import json, os, re, sys
from playwright.sync_api import sync_playwright

_kit = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sgb')
K = os.environ.get('KIT') or (_kit if os.path.isdir(os.path.join(_kit, 'spec')) else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
FILE = os.environ.get('PROTO', K + '/spec/proto.html')
SITE = os.environ.get('SITE', 'http://localhost:5174').rstrip('/')
OUT = os.path.dirname(os.path.abspath(__file__))
norm = lambda s: re.sub(r'[\s·,.\-_/()\[\]「」:!?~…]+', '', s or '').lower()

def same(label, title, body=''):
    """누른 항목과 상세가 같은 것을 가리키는가.
       ① 항목의 글에 번호(L-3301 · V-3300 · S-61 같은)가 있으면 — 그 번호가 상세 본문에 있는지
       ② 상세 제목의 앞 6자(공백 · 기호 제외)가 항목의 글에 들어 있는지
       ③ 상세 제목이 「회원 상세」처럼 화면 이름뿐이면 — 항목 글의 첫 낱말(이름)이 상세 본문에 있는지
       견줄 것이 없으면 None"""
    a, t, bd = norm(label), norm(title), norm(body)
    codes = re.findall(r'\b[A-Z]{1,2}-\d{2,}\b', label or '')
    if codes and bd: return any(norm(c) in bd for c in codes)
    generic = (not t) or any(w in (title or '') for w in ('상세', '검수 ·'))
    if not generic and len(t) >= 4 and len(a) >= 4: return t[:6] in a
    first = (label or '').split(' ')[0]
    if bd and len(norm(first)) >= 2 and not any(w in first for w in ('보기', '열기', '상세')): return norm(first) in bd
    return None

# ───────────────────────────── 시안 ─────────────────────────────
def proto():
    src = open(FILE, encoding='utf-8').read()
    names = {}
    for blk in re.findall(r'(?:var NAVNAME\s*=\s*\{|const NAVS\s*=\s*\{)(.*?)\};', src, flags=re.S):
        for k, v in re.findall(r'(\w+)\s*:\s*"([^"]*)"', blk): names[k] = v
    ids = json.load(open(K + '/spec/proto_ids.json', encoding='utf-8'))
    sid = lambda k: (ids.get(k, {}).get('ids') or [''])[0]
    TO_PATH = dict(re.findall(r'(\w+)\s*:\s*"(/[^"]*)"', re.search(r'const TO_PATH\s*=\s*\{(.*?)\n\};', src, flags=re.S).group(1)))
    # 「상세」 = 항목 하나의 화면. ① 이름에 「상세」가 있는 화면 ② 주소가 번호로 끝나는 화면(/l/1042 · /request/2041 · /chat/8821 · /deal/7710 · /my/contracts/1 …) ③ 그 밖에 알려진 것
    DETAIL = {k for k, v in names.items() if '상세' in v} | {k for k, pth in TO_PATH.items() if re.search(r'/\d+$', pth)} | {'cmud', 'admmbrd', 'myctrd', 'ctrd'}
    GW = {'MNY': '소개장터', 'MAL': '안심소개', 'BIZ': '소개창업'}
    IN_GWAN = ['win', 'bst', 'urg', 'saf', 'evt']                    # 관마다 따로 열리는 화면(빠른 메뉴)
    OWN = {'list': 'MNY', 'listl': 'MAL', 'listb': 'BIZ', 'lstm': 'MNY', 'lstl2': 'MAL', 'lstb2': 'BIZ'}   # 그 관의 메인 · 목록
    CAND = """()=>{const D=new Set(%s); const root=document.getElementById('screen')||document.getElementById('app');
      const els=[...root.querySelectorAll('[data-open],[data-brkopen],[data-askitem],[data-go],[data-s],a[href]')].filter(e=>e.offsetParent!==null);
      return els.map((e,i)=>{ const go=e.getAttribute('data-go')||e.getAttribute('data-s')||''; const href=e.getAttribute('href')||'';
        const hit=e.hasAttribute('data-open')||e.hasAttribute('data-brkopen')||e.hasAttribute('data-askitem')||D.has(go)||/\\/l\\/|\\/request\\/\\d|\\/community\\/\\d|\\/contracts\\/\\d|\\/broker\\/\\d|\\/members\\/|\\/services\\/|\\/chat\\/\\d|\\/deal\\/\\d/.test(href);
        if(!hit) return null;
        let own=(e.innerText||'').trim().replace(/\\s+/g,' ');
        if(/^문의 · 대화|잠금 화면 보기/.test(own)) return null;      /* 나의공간 옆 메뉴의 「문의 · 대화」 · 시연용 단추 — 항목의 상세 링크가 아닙니다 */
        const box=e.closest('.pc,.card,.lrow,.mrow,.qrow,tr,li,article,.it,.row,.rec,.cd')||e.parentElement;
        const row=(box?box.innerText:'').trim().replace(/\\s+/g,' ');
        return {i, own:own.slice(0,60), row:row.slice(0,90), go, href, open:e.hasAttribute('data-open')}; }).filter(Boolean)}""" % json.dumps(sorted(DETAIL))
    CLICK = """(i)=>{const root=document.getElementById('screen')||document.getElementById('app');
      const els=[...root.querySelectorAll('[data-open],[data-brkopen],[data-askitem],[data-go],[data-s],a[href]')].filter(e=>e.offsetParent!==null); els[i].click();}"""
    TITLE = """()=>{const sc=document.getElementById('screen'); if(!sc) return '';
      const t=sc.querySelector('.dtt, .dt h2, .rqt, .wrap h1, .wrap h2, main h1, main h2, .body2 h2, h1, h2');
      return t?(t.innerText||'').trim().replace(/\\s+/g,' ').slice(0,60):''}"""
    TABS = """()=>{const root=document.getElementById('screen')||document.getElementById('app');
      return [...root.querySelectorAll('*')].filter(e=>e.offsetParent!==null && (e.hasAttribute('data-xv') || e.getAttributeNames().some(n=>/^data-[a-z]*tab$/.test(n)))).length}"""
    TABCLICK = """(j)=>{const root=document.getElementById('screen')||document.getElementById('app');
      [...root.querySelectorAll('*')].filter(e=>e.offsetParent!==null && (e.hasAttribute('data-xv') || e.getAttributeNames().some(n=>/^data-[a-z]*tab$/.test(n))))[j].click()}"""
    CHECK = """()=>{const sc=document.getElementById('screen')||document.body; const t=sc.innerText||'';
      const bad=[...new Set((t.match(/undefined|NaN|\\[object Object\\]|(^|[\\s:])null($|[\\s,.])/g)||[]).map(x=>x.trim()))];
      return {bad, len:t.replace(/\\s+/g,'').length}}"""
    BACK = """()=>{const sc=document.getElementById('screen'); const e=sc&&sc.querySelector('.bkl,[data-back]'); return e?(e.innerText||'').trim().slice(0,40):''}"""
    BACKCLICK = """()=>{document.getElementById('screen').querySelector('.bkl,[data-back]').click()}"""
    rows = []; errs = []
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 900})
        pg.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
        jserr = []
        pg.on('pageerror', lambda e: (errs.append(str(e)[:160]), jserr.append(str(e)[:120]))); pg.on('dialog', lambda d: d.dismiss())
        pg.goto('file://' + FILE); pg.wait_for_timeout(1600)
        keys = pg.evaluate("Object.keys(__VIEW.screens)")
        GP = {'MNY': 'mny', 'MAL': 'mal', 'BIZ': 'biz'}
        def hash_for(k, g):
            if k in ('list', 'listl', 'listb'): return '#/g/' + GP[OWN[k]]
            if k in ('lstm', 'lstl2', 'lstb2'): return '#/g/' + GP[OWN[k]] + '/list'
            if k in IN_GWAN and g and k in TO_PATH: return '#/g/' + GP[g] + TO_PATH[k]
            return ('#' + TO_PATH[k]) if k in TO_PATH else None
        def open_(k, g):
            """화면 k 를 관 g 의 주소로 엽니다 — 주소가 없거나 그 주소가 다른 화면으로 열리면 그대로 그립니다(그때 관은 기본값 소개장터)."""
            h = None if k in PAINT_ONLY else hash_for(k, g)
            pg.evaluate("location.hash=''"); pg.wait_for_timeout(60)
            if h:
                pg.evaluate("h=>{location.hash=h}", h); pg.wait_for_timeout(260)
                if pg.evaluate("__VIEW.state.screen") != k:
                    pg.evaluate("location.hash=''"); pg.wait_for_timeout(60); pg.evaluate("k=>__VIEW.paint(k)", k); pg.wait_for_timeout(200)
            else:
                pg.evaluate("k=>__VIEW.paint(k)", k); pg.wait_for_timeout(200)
            pg.evaluate("document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove())")
            return pg.evaluate("location.hash")
        PAINT_ONLY = set()      # 주소로 열면 상세 링크가 안 보이는 화면(상태에 따라 단추가 달라지는 운영 목록) — 그대로 그려서 다시 봅니다
        plan = []
        for k in keys:
            if k in OWN: plan.append((k, OWN[k]))
            elif k in IN_GWAN: plan += [(k, g) for g in ('MNY', 'MAL', 'BIZ')]
            else: plan.append((k, None))
        for k, g in plan:
            try: h0 = open_(k, g)
            except Exception as ex: errs.append(f'{k}: {str(ex)[:80]}'); continue
            if pg.evaluate("__VIEW.state.screen") != k: continue
            cands = pg.evaluate(CAND)
            if not cands and g is None and hash_for(k, g):
                PAINT_ONLY.add(k); h0 = open_(k, g); cands = pg.evaluate(CAND)
            # 화면 안의 갈래(탭)를 하나씩 눌러 본 상태에서도 상세 링크를 찾습니다(예: 운영 「회원」은 승인 대기가 아닌 갈래에서만 「상세」가 보임)
            states = [(None, c) for c in cands]
            ntab = pg.evaluate(TABS)
            for j in range(min(ntab, 10)):
                try: open_(k, g); pg.evaluate(TABCLICK, j); pg.wait_for_timeout(200)
                except Exception: continue
                if pg.evaluate("__VIEW.state.screen") != k: continue
                states += [(j, c) for c in pg.evaluate(CAND)]
            seen = set()
            for j, c in states:
                try:
                    open_(k, g)
                    if j is not None: pg.evaluate(TABCLICK, j); pg.wait_for_timeout(200)
                    now = pg.evaluate(CAND); hit = next((x for x in now if x['own'] == c['own'] and x['row'] == c['row']), None)
                    if hit is None: continue             # 갈래를 누른 뒤 목록이 달라져 그 항목이 없으면 건너뜁니다(기본 상태에서 이미 봤습니다)
                    n_err0 = len(jserr)
                    pg.evaluate(CLICK, hit['i']); pg.wait_for_timeout(280)
                except Exception as ex: errs.append(f'{k}#{c["i"]}: {str(ex)[:80]}'); continue
                to = pg.evaluate("__VIEW.state.screen"); h1 = pg.evaluate("location.hash")
                if to == k or to not in DETAIL: continue
                title = pg.evaluate(TITLE); body = pg.evaluate("(document.getElementById('screen')||document.body).innerText.slice(0,6000)")
                label = c['own'] if len(norm(c['own'])) >= 6 else c['row']
                key = (label, to, h1)
                if key in seen: continue                 # 갈래를 바꿔도 같은 항목이면 한 번만
                seen.add(key)
                chk = pg.evaluate(CHECK)                                   # 상세 화면의 오류 점검 — 깨진 글자 · 빈 화면
                n_err = len(jserr) - n_err0
                back = pg.evaluate(BACK); back_to = ''
                if back:
                    try: pg.evaluate(BACKCLICK); pg.wait_for_timeout(260); back_to = pg.evaluate("__VIEW.state.screen")
                    except Exception as ex: back_to = 'ERR ' + str(ex)[:40]
                rows.append({'from': k, 'from_id': sid(k), 'from_name': names.get(k, ''), 'gwan': GW.get(g or '', ''), 'from_hash': h0,
                             'label': label, 'pressed': c['own'] or '(그림 · 줄 전체)', 'to': to, 'to_id': sid(to), 'to_name': names.get(to, ''), 'to_hash': h1,
                             'title': title, 'same': same(label, title, body),
                             'js_errors': n_err, 'bad_text': chk['bad'], 'text_len': chk['len'], 'back_label': back, 'back_to': back_to, 'back_ok': (back_to == k) if back else None})
        # ── 건강몰(소개뱅크몰) — 따로 도는 화면 묶음 ──
        hroutes = dict(re.findall(r'"(SB-HLT-[A-Z]+-\d+)":"(#/[^"]*)"', open(os.path.join(OUT, 'sweep_hlt.py'), encoding='utf-8').read())) if os.path.exists(os.path.join(OUT, 'sweep_hlt.py')) else {'SB-HLT-HUB-010': '#/'}
        GO = """(h)=>{const b=document.createElement('a');b.setAttribute('data-go',h);b.textContent='x';document.getElementById('hltapp').appendChild(b);b.click();}"""
        HC = """()=>[...document.querySelectorAll('#hltapp a,#hltapp [data-go]')].filter(e=>e.offsetParent!==null).map((e,i)=>{
              const go=e.getAttribute('data-go')||e.getAttribute('href')||''; if(!/^#\\/(p|i|w)\\/.+|^#\\/my\\/orders\\/[^/]+$/.test(go)) return null;
              const box=e.closest('.hlt-card,article,li,tr,.card')||e; return {i, go, label:(box.innerText||'').trim().replace(/\\s+/g,' ').slice(0,90)} }).filter(Boolean)"""
        HCL = """(i)=>{[...document.querySelectorAll('#hltapp a,#hltapp [data-go]')].filter(e=>e.offsetParent!==null)[i].click()}"""
        hsc = json.load(open(K + '/spec/screens.json', encoding='utf-8')); hsc = hsc if isinstance(hsc, list) else hsc.get('screens', [])
        hname = {x['id']: x.get('name', '') for x in hsc}
        hword = lambda t: next((w for w in re.sub(r'[^0-9A-Za-z가-힣 ]', ' ', t or '').split() if w), '')     # 상세 제목의 첫 낱말(그림 글자 · 기호 제외)
        def hcheck(src_route, n_err):
            t = pg.evaluate("document.getElementById('hltapp').innerText||''")
            bad = sorted(set(x.strip() for x in re.findall(r'undefined|NaN|\[object Object\]', t)))
            bk = pg.evaluate("(()=>{const e=document.querySelector('#hltapp [data-back]'); return e?(e.innerText||'').trim().slice(0,30):''})()"); to = ''
            if bk:
                try: pg.evaluate("document.querySelector('#hltapp [data-back]').click()"); pg.wait_for_timeout(140); to = str(pg.evaluate("__hltMall.route()"))
                except Exception as ex: to = 'ERR ' + str(ex)[:40]
            return {'js_errors': n_err, 'bad_text': bad, 'text_len': len(re.sub(r'\s+', '', t)), 'back_label': bk, 'back_to': to, 'back_ok': (bool(to) and not to.startswith('ERR')) if bk else None}
        def hopen(h):
            if pg.evaluate("location.hash") != '#/health' or pg.evaluate("!document.getElementById('hltapp')"):
                pg.evaluate("location.hash='#/health'"); pg.wait_for_timeout(500)
            pg.evaluate(GO, h); pg.wait_for_timeout(120)
        for sid_, h in hroutes.items():
            try: hopen(h); cands = pg.evaluate(HC)
            except Exception as ex: errs.append(f'{sid_}: {str(ex)[:80]}'); continue
            seen = set()
            for c in cands:
                if c['go'] in seen: continue           # 같은 화면에서 같은 주소로 가는 것은 한 번만
                seen.add(c['go'])
                try: hopen(h); n_err0 = len(jserr); pg.evaluate(HCL, c['i']); pg.wait_for_timeout(160)
                except Exception as ex: errs.append(f'{sid_}#{c["i"]}: {str(ex)[:80]}'); continue
                at = pg.evaluate("__hltMall.route()")
                title = pg.evaluate("(()=>{const x=document.querySelector('#hltapp h1,#hltapp h2');return x?x.innerText.trim().replace(/\\s+/g,' ').slice(0,60):''})()")
                kind = '상품 상세' if '/p/' in c['go'] else '성분 상세' if '/i/' in c['go'] else '고민 상세' if '/w/' in c['go'] else '주문 상세'
                rows.append({'from': 'health' + h, 'from_id': sid_, 'from_name': hname.get(sid_, ''), 'gwan': '소개뱅크몰', 'from_hash': '#/health → ' + h,
                             'label': c['label'], 'pressed': c['label'][:40], 'to': 'health' + str(at), 'to_id': '', 'to_name': kind, 'to_hash': str(at),
                             'title': title, 'same': (str(at) == c['go']) and (hword(title) in c['label'] if kind != '주문 상세' else c['go'].split('/')[-1] in pg.inner_text('#hltapp')),
                             **hcheck(h, len(jserr) - n_err0)})
        b.close()
    json.dump({'rows': rows, 'errors': errs, 'detail_screens': sorted(DETAIL)}, open(os.path.join(OUT, 'detail_links_proto.json'), 'w'), ensure_ascii=False, indent=1)
    summary(rows, '시안'); print('오류', len(errs), errs[:3])

# ───────────────────────────── 시안: 상세 ↔ 문의방 왕복 ─────────────────────────────
def roundtrip():
    """관마다: 관 메인 → 매물 → 상세 → 「질문하기 · 1:1 문의」 → 문의방 → 「돌아가기」 / 「리스팅 보기」 — 처음의 그 상세로 돌아오는지.
       문의방 주소(#/chat/8821)에는 관이 없어, 돌아올 때 관이 바뀌는지 봅니다."""
    GW = {'mny': '소개장터', 'mal': '안심소개', 'biz': '소개창업'}
    CARD = '#screen [data-open], #screen [data-go="detail"], #screen [data-go="dtlm"], #screen [data-go="dtll"]'
    out = []
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 900})
        pg.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
        pg.goto('file://' + FILE); pg.wait_for_timeout(1600)
        st = lambda: {'screen': pg.evaluate("__VIEW.state.screen"), 'hash': pg.evaluate("location.hash"),
                      'title': pg.evaluate("(()=>{const t=document.querySelector('#screen .dtt, #screen .dt h2, #screen .wrap h1, #screen .wrap h2, #screen h1, #screen h2');return t?(t.innerText||'').trim().replace(/\\s+/g,' ').slice(0,40):''})()")}
        def to_detail(g):
            pg.evaluate("location.hash=''"); pg.wait_for_timeout(80); pg.evaluate("g=>{location.hash='#/g/'+g}", g); pg.wait_for_timeout(350)
            pg.locator(CARD).first.click(); pg.wait_for_timeout(350); return st()
        for g, name in GW.items():
            d = to_detail(g)
            q = pg.locator('#screen [data-go="ask"], #screen [data-s="ask"], #screen [data-askitem]').first
            if not q.count(): out.append({'gwan': name, 'step': '상세 → 문의', 'detail': d, 'ok': None, 'note': '문의 단추 없음'}); continue
            lab = q.inner_text().strip().replace('\n', ' ')[:20]; q.click(); pg.wait_for_timeout(350); a = st()
            bk = pg.locator('#screen .bkl, #screen [data-back]').first; bl = bk.inner_text().strip()[:36] if bk.count() else ''
            if bk.count(): bk.click(); pg.wait_for_timeout(350)
            r = st()
            out.append({'gwan': name, 'step': f'상세 → 「{lab}」 → 문의방 → 「{bl}」', 'detail': d, 'chat': a, 'returned': r,
                        'ok': r['screen'] == d['screen'] and r['hash'] == d['hash'], 'same_screen': r['screen'] == d['screen']})
            d = to_detail(g); pg.locator('#screen [data-go="ask"], #screen [data-s="ask"], #screen [data-askitem]').first.click(); pg.wait_for_timeout(350)
            lk = pg.locator('#screen .askbar [data-open], #screen [data-s="detail"], #screen [data-go="detail"], #screen [data-go="dtlm"], #screen [data-go="dtll"]').first
            if lk.count():
                ll = lk.inner_text().strip()[:20]; lk.click(); pg.wait_for_timeout(350); r = st()
                out.append({'gwan': name, 'step': f'상세 → 문의방 → 「{ll}」', 'detail': d, 'returned': r, 'ok': r['screen'] == d['screen'] and r['hash'] == d['hash'], 'same_screen': r['screen'] == d['screen']})
        b.close()
    json.dump(out, open(os.path.join(OUT, 'detail_links_roundtrip.json'), 'w'), ensure_ascii=False, indent=1)
    for o in out: print(('ok  ' if o['ok'] else 'FAIL'), o['gwan'], o['step'], '|', o['detail']['screen'], o['detail']['hash'], '→', o.get('returned', {}).get('screen'), o.get('returned', {}).get('hash'))

# ───────────────────────────── 실제 웹 ─────────────────────────────
PAT = re.compile(r'^/(money|mall|biz|request|community|health/p|health/i|health/w|my/health/orders|mal/consult|my/deals|deal|partners?/services|listings)/([^/?#]+)$')
SKIP = {'list', 'new', 'best', 'urgent', 'verified', 'event', 'polls', 'write', 'brokers', 'give', 'consult', 'returns', 'cart', 'checkout', 'guide', 'search', 'direct', 'ingredients', 'concerns'}
def site():
    crawl = json.load(open(os.path.join(OUT, 'site_crawl.json'), encoding='utf-8'))['pages']
    roles = ['guest', 'person', 'buyer', 'intro', 'admin']
    routes = sorted({p['url'] for p in crawl if p.get('status') == 200})
    rows = []; errs = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        for role in roles:
            ctx = b.new_context(viewport={'width': 1280, 'height': 900}); pg = ctx.new_page(); cerr = []
            pg.on('pageerror', lambda e: cerr.append(str(e)[:120])); pg.on('console', lambda m: cerr.append(m.text[:120]) if m.type == 'error' else None)
            if role != 'guest':
                pg.goto(SITE + '/login'); __import__('consent_ok').agree(f'{role}@x.com', 'sgb-dev-1234'); pg.fill('input[name=email]', f'{role}@x.com'); pg.fill('input[name=password]', 'sgb-dev-1234')
                pg.click('form.auth button'); pg.wait_for_timeout(1500)
            found = {}                                  # 상세 주소 → [(목록 쪽, 항목 글)]
            for u in routes:
                try: r = pg.goto(SITE + u, wait_until='domcontentloaded'); pg.wait_for_timeout(120)
                except Exception as ex: errs.append(f'{role} {u}: {str(ex)[:60]}'); continue
                if not r or r.status != 200: continue
                links = pg.evaluate("""()=>[...document.querySelectorAll('main a[href]')].map(a=>{const t=a.querySelector('.card-title,h3,h4,strong,b');
                    let label=((t?t.innerText:a.innerText)||'').trim().replace(/\\s+/g,' ');
                    if(label.replace(/\\s/g,'').length<6 || /보기$|상세$|^상세|열기$/.test(label)){ const box=a.closest('article,li,tr,.card,.hlt-card,section>div,section')||(a.parentElement&&a.parentElement.parentElement); if(box) label=(box.innerText||'').trim().replace(/\\s+/g,' '); }
                    return {href:a.getAttribute('href').split('#')[0].split('?')[0], label:label.slice(0,90)}})""")
                for l in links:
                    m = PAT.match(l['href'])
                    if not m or m.group(2) in SKIP or l['href'] == u.split('?')[0]: continue      # 같은 쪽 안의 정렬 · 갈래 링크는 상세 링크가 아닙니다
                    found.setdefault(l['href'], []).append((u, l['label']))
            for href, srcs in sorted(found.items()):
                cerr.clear()
                try: r = pg.goto(SITE + href, wait_until='networkidle'); pg.wait_for_timeout(150)
                except Exception as ex: errs.append(f'{role} {href}: {str(ex)[:60]}'); continue
                st = r.status if r else 0
                chk = pg.evaluate("""()=>{const m=document.querySelector('main')||document.body; const t=m.innerText||'';
                    const bad=[...new Set((t.match(/undefined|NaN|\\[object Object\\]|Application error|Internal Server Error/g)||[]))];
                    const imgs=[...m.querySelectorAll('img')]; const broken=imgs.filter(i=>i.complete && i.naturalWidth===0).map(i=>(i.getAttribute('src')||'').slice(0,60));
                    const empty=[...m.querySelectorAll('dt')].filter(d=>d.nextElementSibling&&d.nextElementSibling.tagName==='DD'&&!(d.nextElementSibling.innerText||'').trim()).map(d=>(d.innerText||'').trim());
                    [...m.querySelectorAll('tr')].forEach(tr=>{const th=tr.querySelector('th'), td=tr.querySelector('td'); if(th&&td&&tr.children.length===2&&!(td.innerText||'').trim()) empty.push((th.innerText||'').trim())});
                    return {bad, len:t.replace(/\\s+/g,'').length, imgs:imgs.length, broken, empty}}""")
                page_err = list(dict.fromkeys(cerr))[:3]
                h1 = pg.evaluate("(()=>{const x=document.querySelector('main h1, main h2');return x?x.innerText.trim().replace(/\\s+/g,' ').slice(0,80):''})()")
                body = pg.evaluate("document.querySelector('main')?document.querySelector('main').innerText.slice(0,4000):''")
                seen = set()
                for u, label in srcs:
                    if (u, label) in seen: continue
                    seen.add((u, label))
                    idv = href.split('/')[-1]
                    ok = same(label, h1, '')
                    w = next((x for x in re.sub(r'[^0-9A-Za-z가-힣 ]', ' ', h1 or '').split() if x), '')       # 상세 제목의 첫 낱말(그림 글자 · 기호 제외)
                    if ok is not True and w and w in label: ok = True                                           # 짧은 이름(눈 · 칼슘 …)
                    if ok is not True and len(norm(label)) >= 6 and norm(label)[:8] in norm(body): ok = True     # 제목이 아니라 본문에 그 이름이 있는 상세
                    if ok is not True and re.fullmatch(r'H\d{6,}[-\d]*', idv) and idv in body: ok = True          # 주문번호로 가는 상세 — 그 번호의 주문이 나오는지
                    rows.append({'role': role, 'from': u, 'label': label, 'to': href, 'kind': '/' + PAT.match(href).group(1) + '/{id}', 'status': st, 'title': h1, 'same': ok,
                                 'page_errors': page_err, 'bad_text': chk['bad'], 'text_len': chk['len'], 'imgs': chk['imgs'], 'broken_imgs': chk['broken'], 'empty_fields': chk['empty']})
            ctx.close()
        b.close()
    json.dump({'rows': rows, 'errors': errs}, open(os.path.join(OUT, 'detail_links_site.json'), 'w'), ensure_ascii=False, indent=1)
    summary(rows, '실제 웹'); print('오류', len(errs), errs[:3])

def summary(rows, what):
    from collections import defaultdict
    g = defaultdict(list)
    for r in rows: g[(r.get('gwan') or r.get('role', ''), r['from'])].append(r)
    n_same = sum(1 for r in rows if r['same'] is True); n_diff = sum(1 for r in rows if r['same'] is False); n_na = sum(1 for r in rows if r['same'] is None)
    fixed = [(k, len({r['label'] for r in v}), len({r.get('to_hash') or r['to'] for r in v})) for k, v in g.items()]
    stuck = [f for f in fixed if f[1] >= 2 and f[2] == 1]
    print(f'{what}: 상세로 가는 링크 {len(rows)}건 · 목록 쪽 {len(g)}곳 — 같은 것 {n_same} · 다른 것 {n_diff} · 견줄 이름 없음 {n_na} · 「서로 다른 항목인데 상세는 한 가지」인 곳 {len(stuck)}')

if __name__ == '__main__':
    {'proto': proto, 'site': site, 'roundtrip': roundtrip}[sys.argv[1] if len(sys.argv) > 1 else 'proto']()
