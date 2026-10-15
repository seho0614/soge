"""v10.25 소개몰 — 「제시 디자인 · 시안 · 개발분」 「지금 ↔ 바꿀 모양」 비교 그림. 결과: /home/claude/design_1007/cmp25

  지금         시안 = 킷의 v10.24 시안 · 개발분 = 킷을 띄운 사용자 웹(5174)
  바꿀 모양    시안 = 미리보기 시안(/home/claude/pv1025/proto_v1025.html) · 개발분 = 미리보기 사본(5186 · 새 DB · 이름 바꾼 마이그레이션 D024 까지)
  킷 작업본은 건드리지 않습니다.          사용: python3 shot_mall.py [--compose]
"""
import os, sys
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont

K = '/home/claude/pkg/SGB_DevDocker_Integrated_20261002'
DESIGN = '/home/claude/design_1007/mall_design_from_chat_89332263.jpeg'
P_OLD = 'file://' + K + '/sgb/spec/proto.html'; P_NEW = 'file://' + os.environ.get('PROTO_NEW', '/home/claude/pv1025/proto_v1025.html')
W_OLD = os.environ.get('SITE_OLD', 'http://localhost:5174'); W_NEW = os.environ.get('SITE_NEW', 'http://localhost:5186')
RAW = '/home/claude/design_1007/cmp25/raw'; OUT = '/home/claude/design_1007/cmp25'; os.makedirs(RAW, exist_ok=True)
CLEAN = "document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove())"
F = lambda n: ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-DemiLight.ttc', n)
FULL = """(()=>{const r=document.getElementById('hltroot'); const h=r.scrollHeight; const host=document.getElementById('hlthost'); host.style.position='absolute'; host.style.height=h+'px'; r.style.overflow='visible';
  document.documentElement.style.overflow='auto'; document.body.style.height=h+'px'; return h})()"""


def shoot():
    with sync_playwright() as p:
        b = p.chromium.launch()
        def proto(url, name, w=1500, inner=None, full=True, hh=1000):
            pg = b.new_page(viewport={'width': w, 'height': hh}); pg.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
            pg.goto(url + '#/health'); pg.wait_for_timeout(1800); pg.evaluate(CLEAN)
            if inner: pg.evaluate("(h) => window.__hltMall.go(h)", inner); pg.wait_for_timeout(300)
            if full:
                h = pg.evaluate(FULL); pg.set_viewport_size({'width': w, 'height': min(h, 6000)}); pg.wait_for_timeout(300)
            pg.screenshot(path=f'{RAW}/{name}.png'); pg.close()
        def main_hd(url, name, hash_):
            pg = b.new_page(viewport={'width': 1500, 'height': 420}); pg.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
            pg.goto(url + hash_); pg.wait_for_timeout(1500); pg.evaluate(CLEAN); pg.screenshot(path=f'{RAW}/{name}.png', clip={'x': 0, 'y': 0, 'width': 1500, 'height': 90}); pg.close()
        def web(url, name, w=1500, full=True, clip=None, hh=1000):
            pg = b.new_page(viewport={'width': w, 'height': hh}); pg.goto(url, wait_until='networkidle'); pg.wait_for_timeout(1200); pg.goto(url, wait_until='networkidle'); pg.wait_for_timeout(400)
            pg.screenshot(path=f'{RAW}/{name}.png', full_page=full and not clip, clip=clip); pg.close()
        proto(P_OLD, 'p_old_main'); proto(P_NEW, 'p_new_main')
        proto(P_OLD, 'p_old_prd', inner='#/p/p01'); proto(P_NEW, 'p_new_prd', inner='#/p/p01')
        proto(P_OLD, 'p_old_ing', inner='#/ingredients'); proto(P_NEW, 'p_new_ing', inner='#/ingredients')
        proto(P_NEW, 'p_new_main_390', w=390, full=False, hh=844); proto(P_OLD, 'p_old_main_390', w=390, full=False, hh=844)
        for tag, url in (('old', P_OLD), ('new', P_NEW)):
            main_hd(url, f'p_{tag}_hd_home', '#/'); main_hd(url, f'p_{tag}_hd_money', '#/g/mny'); main_hd(url, f'p_{tag}_hd_cmu', '#/community')
        for tag, url in (('old', W_OLD), ('new', W_NEW)):
            web(url + '/health', f'w_{tag}_main')
            web(url + '/health/p/BIKE-01', f'w_{tag}_prd'); web(url + '/health/ingredients', f'w_{tag}_ing')
            web(url + '/health', f'w_{tag}_main_390', w=390, full=False, hh=844)
            for nm, path in (('home', '/'), ('money', '/money'), ('cmu', '/community')):
                web(url + path, f'w_{tag}_hd_{nm}', clip={'x': 0, 'y': 0, 'width': 1500, 'height': 90})
        b.close()


def col(path, label, tone, H=None, w=1000, top=0):
    im = Image.open(path).convert('RGB')
    if im.size[0] != w: im = im.resize((w, int(im.size[1] * w / im.size[0])), Image.LANCZOS)
    if top: im = im.crop((0, top, w, im.size[1]))
    H = H or im.size[1]
    c = Image.new('RGB', (w, H + 56), '#ffffff'); d = ImageDraw.Draw(c)
    d.rectangle((0, 0, w, 56), fill=tone); d.text((16, 10), label, fill='#ffffff', font=F(26))
    c.paste(im.crop((0, 0, w, min(H, im.size[1]))), (0, 56)); return c

def row(cols, out, gap=14):
    Wt = sum(c.size[0] for c in cols) + gap * (len(cols) - 1); H = max(c.size[1] for c in cols)
    r = Image.new('RGB', (Wt, H), '#8a8a8a'); x = 0
    for c in cols: r.paste(c, (x, 0)); x += c.size[0] + gap
    r.save(f'{OUT}/{out}'); print(out, r.size, os.path.getsize(f'{OUT}/{out}') // 1024, 'KB')

def stack(rows, out, gap=10):
    W = max(r.size[0] for r in rows); H = sum(r.size[1] for r in rows) + gap * (len(rows) - 1)
    s = Image.new('RGB', (W, H), '#8a8a8a'); y = 0
    for r in rows: s.paste(r, (0, y)); y += r.size[1] + gap
    s.save(f'{OUT}/{out}'); print(out, s.size, os.path.getsize(f'{OUT}/{out}') // 1024, 'KB')

DSG = '#7a4b00'; OLD = '#6b7280'; NEW = '#00245a'; WEB = '#0f5132'
def compose():
    L = lambda n: f'{RAW}/{n}.png'
    row([col(DESIGN, '① 제시 디자인(받은 그림 · 1092×2000 JPEG)', DSG), col(L('p_new_main'), '② 시안 — 바꿀 모양(견본 값 · 그림 조각은 임시)', NEW), col(L('w_new_main'), '③ 개발분 — 바꿀 모양(서버 자료만 · 자료 없는 구역은 감춤)', WEB)], '소개몰_비교_A_메인_디자인_시안_개발분.png')
    row([col(L('p_old_main'), '시안 — 지금(v10.24)', OLD), col(L('p_new_main'), '시안 — 바꿀 모양', NEW)], '소개몰_비교_B_메인_시안_지금_바꿀모양.png')
    row([col(L('w_old_main'), '개발분 — 지금(v10.24)', OLD), col(L('w_new_main'), '개발분 — 바꿀 모양', WEB)], '소개몰_비교_C_메인_개발분_지금_바꿀모양.png')
    row([col(DESIGN, '① 제시 디자인 — 윗부분', DSG, H=900, w=1500), col(L('p_new_main'), '② 시안 — 바꿀 모양', NEW, H=900, w=1500)], '소개몰_비교_D1_윗부분_디자인_시안.png')
    row([col(DESIGN, '① 제시 디자인 — 가운데(성분별 최저가 · 오늘의 건강상품)', DSG, H=900, w=1500, top=905), col(L('p_new_main'), '② 시안 — 바꿀 모양', NEW, H=900, w=1500, top=975)], '소개몰_비교_D2_가운데_디자인_시안.png')
    row([col(DESIGN, '① 제시 디자인 — 아랫부분', DSG, H=940, w=1500, top=1810), col(L('p_new_main'), '② 시안 — 바꿀 모양', NEW, H=940, w=1500, top=1900)], '소개몰_비교_D3_아랫부분_디자인_시안.png')
    row([col(L('w_old_prd'), '개발분 상품 상세 — 지금', OLD, H=820), col(L('w_new_prd'), '개발분 상품 상세 — 바꿀 모양(머리줄 · 색만)', WEB, H=820), col(L('p_new_prd'), '시안 상품 상세 — 바꿀 모양(머리줄 · 색만)', NEW, H=820)], '소개몰_비교_E1_하위화면_상품상세.png')
    row([col(L('w_old_ing'), '개발분 성분 목록 — 지금', OLD, H=700), col(L('w_new_ing'), '개발분 성분 목록 — 바꿀 모양', WEB, H=700), col(L('p_new_ing'), '시안 성분 목록 — 바꿀 모양', NEW, H=700)], '소개몰_비교_E2_하위화면_성분목록.png')
    hd = []
    for nm, lab in (('home', '메인'), ('money', '소개장터'), ('cmu', '소개광장')):
        hd.append(row_img([col(L(f'p_old_hd_{nm}'), f'시안 {lab} — 지금', OLD, w=1500), col(L(f'p_new_hd_{nm}'), f'시안 {lab} — 바꿀 모양(「소개몰」)', NEW, w=1500)]))
        hd.append(row_img([col(L(f'w_old_hd_{nm}'), f'개발분 {lab} — 지금', OLD, w=1500), col(L(f'w_new_hd_{nm}'), f'개발분 {lab} — 바꿀 모양(「소개몰」)', WEB, w=1500)]))
    stack(hd, '소개몰_비교_F_메뉴이름_머리줄.png')
    row([col(L('p_old_main_390'), '시안 지금', OLD, w=390), col(L('p_new_main_390'), '시안 바꿀 모양', NEW, w=390), col(L('w_old_main_390'), '개발분 지금', OLD, w=390), col(L('w_new_main_390'), '개발분 바꿀 모양', WEB, w=390)], '소개몰_비교_G_좁은화면.png')

def row_img(cols, gap=14):
    Wt = sum(c.size[0] for c in cols) + gap * (len(cols) - 1); H = max(c.size[1] for c in cols)
    r = Image.new('RGB', (Wt, H), '#8a8a8a'); x = 0
    for c in cols: r.paste(c, (x, 0)); x += c.size[0] + gap
    return r


if __name__ == '__main__':
    if '--compose' not in sys.argv: shoot()
    compose()
