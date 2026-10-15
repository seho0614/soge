"""소개몰 — 「시안(기준) ↔ 개발분(지금)」 나란히 그림 4장. cmp_mall_dump.py 가 떠 둔 그림을 붙입니다. 결과: /home/claude/design_1007/cmp25b"""
import json, os, re
from PIL import Image
import shot_mall2 as s2
import cmp_mall_dump as cd
RAW = cd.RAW; OUT = os.path.dirname(RAW); CAP = int(os.environ.get('CAP', '1500')); DEV = os.environ.get('DEVLABEL', '개발분 — v10.25')
d = json.load(open(f'{RAW}/dump.json', encoding='utf-8'))

def tile(no, name, proute, wpath):
    cols = []
    for pth, lab, tone in ((f'{RAW}/p_{no}_full.png', f'시안(기준)  {proute or "— 시안에 없음"}', s2.NEWC), (f'{RAW}/w_{no}_full.png', f'{DEV}  {re.sub(r"H[0-9]{6,}", "(주문번호)", wpath or "")}', s2.OLDC)):
        if os.path.exists(pth) and (proute or 'w_' in pth):
            im = Image.open(pth).convert('RGB'); im = im.crop((0, 0, im.size[0], min(im.size[1], CAP)))
        else: im = Image.new('RGB', (1500, 300), '#f3f3f3')
        cols.append(s2.colim(im, lab, tone, w=1000))
    body = s2.pair(*cols); hd = s2.band(f'{int(no)}. {name}', body.size[0], tone='#222222', h=48, size=25)
    c = Image.new('RGB', (body.size[0], hd.size[1] + body.size[1]), '#8a8a8a'); c.paste(hd, (0, 0)); c.paste(body, (0, hd.size[1])); return c

PRE = os.environ.get('PREFIX', '소개몰_v10.25_시안_개발분_')      # 반영 전 그림은 「소개몰_시안기준_개발분_…」
T = [tile(no, name, route, path) for no, key, route, name, path in cd.PAIRS]
def sheet(title, tiles, out):
    rows = [s2.note([title, f'왼쪽 = 시안(기준 · 견본 값) · 오른쪽 = {DEV}(서버 자료 · 로그인한 구매자). 긴 화면은 위에서 {CAP}px 까지만 붙였습니다.'], tiles[0].size[0]), *tiles]
    W = max(r.size[0] for r in rows); H = sum(r.size[1] for r in rows) + 10 * (len(rows) - 1); s = Image.new('RGB', (W, H), '#8a8a8a'); y = 0
    for r in rows: s.paste(r, (0, y)); y += r.size[1] + 10
    s = s.resize((int(W * 0.8), int(H * 0.8)), Image.LANCZOS); s.save(f'{OUT}/{out}', optimize=True); print(out, s.size, os.path.getsize(f'{OUT}/{out}') // 1024, 'KB')
sheet('소개몰 — 시안 ↔ 개발분 ① 둘러보기 1 ~ 5', T[0:5], PRE + '1_메인_직판_전체_검색_성분별.png')
sheet('소개몰 — 시안 ↔ 개발분 ② 둘러보기 6 ~ 9 · 이용안내', T[5:9] + [T[20]], PRE + '2_성분상세_고민_상품상세_이용안내.png')
sheet('소개몰 — 시안 ↔ 개발분 ③ 주문 10 ~ 14 · 결제 승인', T[9:14] + [T[21]], PRE + '3_장바구니_주문서_결제_완료_실패.png')
sheet('소개몰 — 시안 ↔ 개발분 ④ 내 주문 15 ~ 20', T[14:20], PRE + '4_내주문_상세_배송_반품_배송지.png')
