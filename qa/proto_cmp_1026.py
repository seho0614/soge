"""v10.26 시안 — 손댄 화면의 전(v10.25) · 후(v10.26) 그림.  결과: /home/claude/design_1007/cmp26/시안_v10.26_전후_*.png

  python3 proto_cmp_1026.py
"""
import os, re
from PIL import Image
from playwright.sync_api import sync_playwright
import shot_mall as sm
import shot_mall2 as s2

K = '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb'
OLD = os.environ.get('BASE', '/mnt/user-data/outputs/SGB_Prototype_v10_25.html')
NEW = os.environ.get('PROTO', K + '/spec/proto.html')
OUT = os.environ.get('CMPDIR', '/home/claude/design_1007/cmp26'); RAW = OUT + '/raw'; os.makedirs(RAW, exist_ok=True)
# (번호, 이름, 소개몰 주소 또는 본체 화면 키, 할 일, 높이 한도)
CASES = [
    ('a', '전체제품 카드 — 그림 안 글자 · p10 「한 달 N원 부터」(품절 옵션 뺌)', '#/c/HLT_FOOD', None, 1500),
    ('b', '상품 상세 p10 — 「최대 할인가 … (지금 살 수 있는 옵션 기준)」 · 안내 글 · 교환 배송비 줄', '#/p/p10', None, 2100),
    ('c', '화장품 갈래 — v10.25 는 먹는 분말(p12) · v10.26 은 바르는 크림 견본(p17 · 단품)', '#/c/HLT_COSMETIC', None, 900),
    ('d', '상품 상세 p17(단품) — 옵션 줄 없이 수량 칸 · v10.25 는 없는 상품', '#/p/p17', None, 1700),
    ('e', '검색 자동완성 — 「비타」(v10.25 는 상품 이름이 제안되지 않음)', '#/search', 'type', 700),
    ('f', '교환 신청 — 품목 · 수량 칸 뺌 · 교환 비용 안내(접수 때 결제 · 14일)', '#/my/returns/new?o=H20260908-000041', 'exch', 1900),
    ('g', '교환 접수 뒤 — 교환 배송비 결제 창(시험 결제)', '#/my/returns/new?o=H20260908-000041', 'submit', 1000),
    ('h', '운영 「소개몰 상품」(SB-ADM-HPR-010) — v10.26 새 화면', 'admhpr', None, 1800),
]


def shoot(path, tag):
    with sync_playwright() as p:
        b = p.chromium.launch()
        for no, name, route, act, cap in CASES:
            pg = b.new_page(viewport={'width': 1500, 'height': 1000})
            pg.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
            if not route.startswith('#'):
                pg.goto('file://' + path); pg.wait_for_timeout(1500)
                ok = pg.evaluate("(k) => !!__VIEW.screens[k]", route)
                if ok: pg.evaluate("(k) => __VIEW.paint(k)", route); pg.wait_for_timeout(400)
                pg.evaluate(sm.CLEAN)
                if ok: pg.screenshot(path=f'{RAW}/{tag}_{no}.png', full_page=True)
                pg.close(); continue
            pg.goto('file://' + path + '#/health'); pg.wait_for_timeout(1500); pg.evaluate(sm.CLEAN)
            pg.evaluate("(h) => window.__hltMall.go(h)", route); pg.wait_for_timeout(450); pg.evaluate(sm.CLEAN)
            if act == 'type':
                box = pg.locator('#qInput'); box.click(); box.type('비타', delay=50); pg.wait_for_timeout(400)
            if act in ('exch', 'submit'):
                bt = pg.locator('#hltapp main [data-rkind="EXCHANGE"]')
                if bt.count(): bt.click(); pg.wait_for_timeout(350)
            if act == 'submit':
                pg.locator('#btnReturn').click(); pg.wait_for_timeout(600)
            h = pg.evaluate("document.getElementById('hltroot') ? document.getElementById('hltroot').scrollHeight : 1000")
            pg.set_viewport_size({'width': 1500, 'height': max(1000, min(h, 7000))}); pg.wait_for_timeout(200)
            if 'p17' in route and pg.evaluate("!(window.__hlt.PRODUCTS || []).some(p => p.id === 'p17')"):
                pg.close(); continue
            pg.screenshot(path=f'{RAW}/{tag}_{no}.png'); pg.close()
        b.close()


def tile(no, name, cap):
    cols = []
    for tag, lab, tone in (('v25', '앞 판 v10.25', s2.OLDC), ('v26', 'v10.26 (고친 뒤)', s2.NEWC)):
        pth = f'{RAW}/{tag}_{no}.png'
        if os.path.exists(pth):
            im = Image.open(pth).convert('RGB'); im = im.crop((0, 0, im.size[0], min(im.size[1], cap)))
        else:
            im = Image.new('RGB', (1500, 260), '#f3f3f3')
        cols.append(s2.colim(im, lab if os.path.exists(pth) else lab + ' — 없음', tone, w=1000))
    body = s2.pair(*cols); hd = s2.band(f'{name}', body.size[0], tone='#222222', h=48, size=24)
    c = Image.new('RGB', (body.size[0], hd.size[1] + body.size[1]), '#8a8a8a'); c.paste(hd, (0, 0)); c.paste(body, (0, hd.size[1])); return c


def sheet():
    T = {no: tile(no, name, cap) for no, name, route, act, cap in CASES}
    def save(title, nos, out, scale=0.8):
        tiles = [T[n] for n in nos]
        rows = [s2.note([title, '왼쪽 = 앞 판 시안 v10.25 · 오른쪽 = 고친 시안 v10.26. 손대지 않은 본체 194화면은 점 하나까지 같습니다(proto_pixel).'], tiles[0].size[0]), *tiles]
        W = max(r.size[0] for r in rows); H = sum(r.size[1] for r in rows) + 10 * (len(rows) - 1); s_ = Image.new('RGB', (W, H), '#8a8a8a'); y = 0
        for r in rows: s_.paste(r, (0, y)); y += r.size[1] + 10
        s_ = s_.resize((int(W * scale), int(H * scale)), Image.LANCZOS); s_.save(f'{OUT}/{out}', optimize=True); print(out, s_.size, os.path.getsize(f'{OUT}/{out}') // 1024, 'KB')
    save('시안 v10.26 전후 ① 카드 · 상품 상세 · 화장품', ['a', 'b', 'c', 'd'], '시안_v10.26_전후_1_카드_상세_화장품.png')
    save('시안 v10.26 전후 ② 자동완성 · 교환 신청 · 운영 「소개몰 상품」', ['e', 'f', 'g', 'h'], '시안_v10.26_전후_2_자동완성_교환_운영.png')


if __name__ == '__main__':
    shoot(OLD, 'v25'); shoot(NEW, 'v26'); sheet()
