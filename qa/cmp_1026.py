"""v10.26 반영 전 비교 그림 — 소개몰 「상품 자료」가 닿는 화면만: 시안(기준) ↔ 개발분(지금).  (2026-10-08 · 비교 그림 → 확인 → 반영)

  python3 cmp_1026.py shoot     화면을 뜹니다(읽기만 — 주문 · 신청을 만들지 않음. 개발분 장바구니는 새 시험 계정 cmp26_*@t.local 에만 담음)
  python3 cmp_1026.py sheet     떠 둔 그림을 나란히 붙입니다
결과: /home/claude/design_1007/cmp26   (raw/ = 낱장 · 소개몰_v10.26_반영전_*.png = 붙인 그림)
"""
import json, os, re, sys
from PIL import Image
from playwright.sync_api import sync_playwright
import shot_mall as sm
import shot_mall2 as s2
import flow_lib as fl
OUT = os.environ.get('CMPDIR', '/home/claude/design_1007/cmp26'); RAW = OUT + '/raw'; os.makedirs(RAW, exist_ok=True)
PROTO = 'file://' + os.environ.get('PROTO', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb/spec/proto.html'); SITE = fl.SITE
DELV = os.environ.get('DELV', 'H26100700754')        # buyer@x.com 의 배송 완료 주문(반품 신청이 없는 것 · 받은 지 7일 안) — 신청 화면을 열기만 합니다
# (번호, 이름, 시안 주소, 개발분 주소, 높이 한도)
PAIRS = [
    ('01', '메인 — 성분별 최저가 · 오늘의 건강상품 · 많이 찾는 상품 · 새로 올라온 상품 · 이번 주 특별 할인', '#/', '/health', 3300),
    ('02', '전체제품 — 상품 카드(그림 · 성분|함량 · 정가 · 할인율 · 한 달 단가) · 갈래 단추(화장품)', '#/c/HLT_FOOD', '/health/c/ALL', 1500),
    ('03', '화장품 갈래', '#/c/HLT_COSMETIC', '/health/c/HLT_COSMETIC', 900),
    ('04', '검색 — 자동완성(글자를 치는 중)', '#/search', '/health/search', 800),
    ('05', '검색 결과', '#/search?q=비타민', '/health/search?q=홍삼', 1100),
    ('06', '성분별 — 많이 찾는 성분 · 전체 성분 · 성분군 · 「월 N원 부터」', '#/ingredients', '/health/ingredients', 1700),
    ('07', '성분 상세 — 「최저 월 N원」 · 정렬', '#/i/VITC', '/health/i/GINSENG', 1100),
    ('08', '상품 상세 — 옵션(복용 개월 수) · 정가 · 할인율 · 상세 설명(고시 · 주의사항) · 교환 배송비 줄', '#/p/p01', '/health/p/RED-30', 3000),
    ('09', '상품 상세 — 화장품 견본(p12 저분자 콜라겐 1500)', '#/p/p12', None, 2300),
    ('10', '장바구니 — 옵션 이름 · 판매자별 묶음', '#/cart', '/health/cart', 1300),
    ('11', '취소 · 반품 신청 — 「교환」을 고른 모습(항목 · 수량 고르기 · 교환 비용)', '#/my/returns/new?o=H20260908-000041', f'/my/health/returns/new?o={DELV}', 1900),
]


def shoot():
    meta = {}
    with sync_playwright() as p:
        b = p.chromium.launch()
        # ── 시안 ──
        pg = b.new_page(viewport={'width': 1500, 'height': 1000}); pg.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
        pg.goto(PROTO + '#/health'); pg.wait_for_timeout(1600); pg.evaluate(sm.CLEAN)
        pg.evaluate("window.__hlt.addToCart('p01', 0)"); pg.evaluate("window.__hlt.addToCart('p02', 2)"); pg.evaluate("window.__hlt.addToCart('p05', 1)")
        def pshot(no):
            pg.evaluate(sm.CLEAN); h = pg.evaluate("document.getElementById('hltroot').scrollHeight")
            pg.set_viewport_size({'width': 1500, 'height': max(1000, min(h, 7000))}); pg.wait_for_timeout(200)
            pg.screenshot(path=f'{RAW}/p_{no}.png'); pg.set_viewport_size({'width': 1500, 'height': 1000}); pg.wait_for_timeout(80)
        for no, name, route, path, cap in PAIRS:
            pg.evaluate("(h) => window.__hltMall.go(h)", route); pg.wait_for_timeout(350); note = ''
            if no == '04':       # 검색 칸에 「비타」를 침 — 자동완성 목록이 열림
                box = pg.locator('#hltapp main input[type=text], #hltapp main input[type=search], #hltapp main input:not([type])').first
                box.click(); box.type('비타', delay=60); pg.wait_for_timeout(400)
                note = pg.evaluate("(()=>{const l=[...document.querySelectorAll('#hltapp [role=option], #hltapp .hlt-ac li, #hltapp .hlt-sug li, #hltapp [data-ac]')].map(e=>e.innerText.replace(/\\s+/g,' ').trim());return l.join(' / ')})()")
            if no == '11':       # 신청 종류 「교환」 — 사유는 처음 값(단순 변심)
                bt = pg.locator('#hltapp main button, #hltapp main label', has_text=re.compile(r'^\s*교환\s*$')).first
                if bt.count(): bt.click(); pg.wait_for_timeout(350)
                note = pg.evaluate("(document.querySelector('#hltapp main')||{}).innerText").split('③')[-1][:260].replace('\n', ' ')
            meta[no] = {'name': name, 'proto': route, 'proto_note': note, 'proto_text': pg.evaluate("(document.querySelector('#hltapp main')||{innerText:''}).innerText")[:6000]}
            pshot(no)
        # 운영 — 시안 본체의 「소개몰 정산」(소개몰 관련 운영 화면은 이 하나)
        pg.goto(PROTO); pg.wait_for_timeout(1500); pg.evaluate("__VIEW.paint('admhst')"); pg.wait_for_timeout(500); pg.evaluate(sm.CLEAN)      # 주소(hash)를 바꾸면 메인으로 다시 그려지므로 새로 열어 바로 그림
        pg.screenshot(path=f'{RAW}/p_12.png', full_page=True); meta['12'] = {'name': '운영 화면 — 소개몰 정산(상품 · 재고 관리 화면은 양쪽 다 없음)', 'proto': 'admhst (SB-ADM-HST-010)'}
        pg.close()
        # ── 개발분 ──
        em, pw, tok, aid = fl.signup('cmp26', '비교 그림')
        for code, qty in (('RED-30', 2), ('BELL-30', 1)): fl.call('POST', '/me/health/cart', tok, {'productCode': code, 'qty': qty})
        c1 = b.new_context(viewport={'width': 1500, 'height': 1000}); w1 = fl.site_login(c1, em, pw)           # 장바구니용 새 계정
        c2 = b.new_context(viewport={'width': 1500, 'height': 1000}); w2 = fl.site_login(c2, 'buyer@x.com')     # 반품 신청 화면용(배송 완료 주문)
        for no, name, route, path, cap in PAIRS:
            if not path: continue
            w = w2 if no == '11' else w1
            r = w.goto(SITE + path, wait_until='networkidle'); w.wait_for_timeout(400); note = ''
            if no == '04':
                box = w.locator('main input[type=text], main input[type=search], main input[name=q]').first
                box.click(); box.type('홍', delay=60); w.wait_for_timeout(700)
                note = '목록 없음' if not w.locator('[role=listbox], [role=option]').count() else '목록 있음'
            if no == '11':
                bt = w.locator('main button, main label', has_text=re.compile(r'^\s*교환\s*$')).first
                if bt.count(): bt.click(); w.wait_for_timeout(400)
            meta[no].update({'web': path, 'web_status': r.status if r else None, 'web_note': note, 'web_text': w.inner_text('main')[:6000]})
            w.screenshot(path=f'{RAW}/w_{no}.png', full_page=True)
        c1.close(); c2.close()
        # 운영 화면 — 「소개몰 정산」 탭
        c3 = b.new_context(viewport={'width': 1500, 'height': 1000}); bo = fl.bo_login(c3)
        ok = fl.bo_tab(bo, '소개몰 정산'); bo.wait_for_timeout(800); bo.screenshot(path=f'{RAW}/w_12.png', full_page=True)
        meta['12'].update({'web': '운영 화면 탭 「소개몰 정산」', 'web_status': 200 if ok else None, 'tabs': fl.bo_tab_names(bo)})   # v10.29 — 묶음 단추(data-tabs) × 탭
        c3.close(); b.close()
        # 뒷정리 — 시험 계정의 장바구니를 비움(계정은 남음)
        fl.sql(f"DELETE FROM hlt_cart_items WHERE account_id='{aid}'")
    json.dump(meta, open(f'{RAW}/meta.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    for no in sorted(meta): m = meta[no]; print(no, m['name'][:30], '| 시안', m.get('proto'), '| 개발분', m.get('web'), m.get('web_status'), '|', (m.get('proto_note') or '')[:90], '|', m.get('web_note', ''))


def tile(no, name, route, path, cap):
    cols = []
    for pth, lab, tone, has in ((f'{RAW}/p_{no}.png', f'시안(기준)  {route}', s2.NEWC, True), (f'{RAW}/w_{no}.png', f'개발분(지금 · v10.25)  {re.sub(r"H[0-9]{6,}", "(주문번호)", path or "— 개발분에 없음")}', s2.OLDC, bool(path))):
        if has and os.path.exists(pth):
            im = Image.open(pth).convert('RGB'); im = im.crop((0, 0, im.size[0], min(im.size[1], cap)))
        else: im = Image.new('RGB', (1500, 260), '#f3f3f3')
        cols.append(s2.colim(im, lab, tone, w=1000))
    body = s2.pair(*cols); hd = s2.band(f'{int(no)}. {name}', body.size[0], tone='#222222', h=48, size=24)
    c = Image.new('RGB', (body.size[0], hd.size[1] + body.size[1]), '#8a8a8a'); c.paste(hd, (0, 0)); c.paste(body, (0, hd.size[1])); return c


def sheet():
    T = {no: tile(no, name, route, path, cap) for no, name, route, path, cap in PAIRS}
    T['12'] = tile('12', '운영 화면 — 소개몰 정산 (상품 · 재고를 넣는 화면은 시안 · 개발분 모두 없음 → 제안 그림 ⑤)', 'admhst (SB-ADM-HST-010)', '운영 화면 탭 「소개몰 정산」', 1500)
    def save(title, nos, out, scale=0.8):
        tiles = [T[n] for n in nos]
        rows = [s2.note([title, '왼쪽 = 시안(기준 · 견본 값 16종) · 오른쪽 = 개발분(지금 · 서버 자료 8종 가운데 판매 중 3종). 긴 화면은 위에서부터 한도까지만 붙였습니다.'], tiles[0].size[0]), *tiles]
        W = max(r.size[0] for r in rows); H = sum(r.size[1] for r in rows) + 10 * (len(rows) - 1); s = Image.new('RGB', (W, H), '#8a8a8a'); y = 0
        for r in rows: s.paste(r, (0, y)); y += r.size[1] + 10
        s = s.resize((int(W * scale), int(H * scale)), Image.LANCZOS); s.save(f'{OUT}/{out}', optimize=True); print(out, s.size, os.path.getsize(f'{OUT}/{out}') // 1024, 'KB')
    save('v10.26 반영 전 ① 메인 · 전체제품 · 화장품 갈래', ['01', '02', '03'], '소개몰_v10.26_반영전_1_메인_전체제품_화장품.png')
    save('v10.26 반영 전 ② 검색(자동완성) · 성분별 · 성분 상세', ['04', '05', '06', '07'], '소개몰_v10.26_반영전_2_검색_성분별_성분상세.png')
    save('v10.26 반영 전 ③ 상품 상세(옵션 · 고시) · 화장품 견본', ['08', '09'], '소개몰_v10.26_반영전_3_상품상세_옵션_화장품견본.png')
    save('v10.26 반영 전 ④ 장바구니 · 교환 신청 · 운영 화면', ['10', '11', '12'], '소개몰_v10.26_반영전_4_장바구니_교환_운영.png')


# ── 반영 후(v10.26) — 같은 시안 그림(raw/p_*.png) ↔ 개발분 반영 후(raw/a_*.png). 시안 견본과 같은 상품 코드(p01 …)로 엽니다 ──
AFTER = {'01': '/health', '02': '/health/c/ALL', '03': '/health/c/HLT_COSMETIC', '04': '/health/search', '05': '/health/search?q=비타민',
         '06': '/health/ingredients', '07': '/health/i/VITC', '08': '/health/p/p01', '09': '/health/p/p17', '10': '/health/cart',
         '11': f'/my/health/returns/new?o={DELV}'}


def after():
    meta = json.load(open(f'{RAW}/meta.json', encoding='utf8'))
    with sync_playwright() as p:
        b = p.chromium.launch()
        em, pw, tok, aid = fl.signup('cmp26a', '비교 그림')
        # 시안의 장바구니와 같게 — p01 첫 옵션 · p02 셋째 옵션 · p05 둘째 옵션
        for code, i in (('p01', 0), ('p02', 2), ('p05', 1)):
            opts = (fl.call('GET', f'/health/products/{code}')[1] or {}).get('options') or []
            if len(opts) > i: fl.call('POST', '/me/health/cart', tok, {'productCode': code, 'optionId': opts[i]['id'], 'qty': 1})
        c1 = b.new_context(viewport={'width': 1500, 'height': 1000}); w1 = fl.site_login(c1, em, pw)
        c2 = b.new_context(viewport={'width': 1500, 'height': 1000}); w2 = fl.site_login(c2, 'buyer@x.com')
        for no, path in AFTER.items():
            w = w2 if no == '11' else w1
            r = w.goto(SITE + path, wait_until='networkidle'); w.wait_for_timeout(400); note = ''
            if no == '04':
                box = w.locator('main input[name=q]').first
                box.click(); box.type('비타', delay=60); w.wait_for_timeout(900)
                note = ' / '.join(x.strip().replace('\n', ' ') for x in w.locator('[role=option]').all_inner_texts())
            if no == '11':
                bt = w.locator('main button', has_text=re.compile(r'^\s*교환\s*$')).first
                if bt.count(): bt.click(); w.wait_for_timeout(400)
                note = (w.locator('[data-exchange-box]').inner_text() if w.locator('[data-exchange-box]').count() else '교환 상자 없음').replace('\n', ' ')
            meta.setdefault(no, {}).update({'after': path, 'after_status': r.status if r else None, 'after_note': note, 'after_text': w.inner_text('main')[:6000]})
            w.screenshot(path=f'{RAW}/a_{no}.png', full_page=True)
        c1.close(); c2.close()
        c3 = b.new_context(viewport={'width': 1500, 'height': 1000}); bo = fl.bo_login(c3)
        fl.bo_tab(bo, '소개몰 상품'); bo.wait_for_timeout(900); bo.screenshot(path=f'{RAW}/a_12.png', full_page=True)
        meta.setdefault('12', {}).update({'after': '운영 화면 탭 「소개몰 상품」'})
        c3.close(); b.close()
        fl.sql(f"DELETE FROM hlt_cart_items WHERE account_id='{aid}'")
    json.dump(meta, open(f'{RAW}/meta.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    for no in sorted(AFTER): m = meta[no]; print(no, m.get('after'), m.get('after_status'), '|', (m.get('after_note') or '')[:160])


def tile_after(no, name, cap):
    cols = []
    for pth, lab, tone in ((f'{RAW}/p_{no}.png', '시안(기준)', s2.NEWC), (f'{RAW}/a_{no}.png', f'개발분(v10.26 반영 후)  {re.sub(r"H[0-9]{6,}", "(주문번호)", AFTER.get(no, "운영 화면 「소개몰 상품」"))}', s2.OLDC)):
        if os.path.exists(pth):
            im = Image.open(pth).convert('RGB'); im = im.crop((0, 0, im.size[0], min(im.size[1], cap)))
        else: im = Image.new('RGB', (1500, 260), '#f3f3f3')
        cols.append(s2.colim(im, lab, tone, w=1000))
    body = s2.pair(*cols); hd = s2.band(f'{int(no)}. {name}', body.size[0], tone='#222222', h=48, size=24)
    c = Image.new('RGB', (body.size[0], hd.size[1] + body.size[1]), '#8a8a8a'); c.paste(hd, (0, 0)); c.paste(body, (0, hd.size[1])); return c


def sheet_after():
    T = {no: tile_after(no, name, cap) for no, name, route, path, cap in PAIRS}
    T['12'] = tile_after('12', '운영 화면 — 시안: 소개몰 정산 / 개발분: 새 탭 「소개몰 상품」(시안에는 v10.26 시안에서 추가)', 1500)
    def save(title, nos, out, scale=0.8):
        tiles = [T[n] for n in nos]
        rows = [s2.note([title, '왼쪽 = 시안(기준 · 견본 값) · 오른쪽 = 개발분 반영 후(같은 견본 16종 + 화장품 견본 p17 · 개발 · 시연용 시드). 긴 화면은 위에서부터 한도까지만 붙였습니다.'], tiles[0].size[0]), *tiles]
        W = max(r.size[0] for r in rows); H = sum(r.size[1] for r in rows) + 10 * (len(rows) - 1); s_ = Image.new('RGB', (W, H), '#8a8a8a'); y = 0
        for r in rows: s_.paste(r, (0, y)); y += r.size[1] + 10
        s_ = s_.resize((int(W * scale), int(H * scale)), Image.LANCZOS); s_.save(f'{OUT}/{out}', optimize=True); print(out, s_.size, os.path.getsize(f'{OUT}/{out}') // 1024, 'KB')
    save('v10.26 반영 후 ① 메인 · 전체제품 · 화장품 갈래', ['01', '02', '03'], '소개몰_v10.26_반영후_1_메인_전체제품_화장품.png')
    save('v10.26 반영 후 ② 검색(자동완성) · 성분별 · 성분 상세', ['04', '05', '06', '07'], '소개몰_v10.26_반영후_2_검색_성분별_성분상세.png')
    save('v10.26 반영 후 ③ 상품 상세(옵션 · 고시) · 화장품 견본', ['08', '09'], '소개몰_v10.26_반영후_3_상품상세_옵션_화장품견본.png')
    save('v10.26 반영 후 ④ 장바구니 · 교환 신청 · 운영 화면', ['10', '11', '12'], '소개몰_v10.26_반영후_4_장바구니_교환_운영.png')


if __name__ == '__main__':
    {'shoot': shoot, 'sheet': sheet, 'after': after, 'sheet_after': sheet_after}[sys.argv[1]]()
