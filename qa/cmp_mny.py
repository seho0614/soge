"""비교 그림 — 받은 그림 ｜ 시안 ｜ 실제 웹 을 나란히(한 장). v10.30
   python3 cmp_mny.py [나올 파일]      shot_mny.py proto · site 를 먼저 돌려 mny_proto.png · mny_site.png 가 있어야 합니다. 받은 그림(sgb/docs/design/money_main_20261009.webp 또는 MNY_SRC=)도 있어야 합니다.
   비교용으로 줄여 붙인 그림입니다(제품에 쓰는 그림이 아님)."""
import os, sys
from PIL import Image, ImageDraw, ImageFont
Q = os.path.dirname(os.path.abspath(__file__))
K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
SRC = os.environ.get('MNY_SRC') or K + '/sgb/docs/design/money_main_20261009.webp'
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(Q, '소개장터_v10.30_비교_그림_시안_실제웹.png')
W = int(os.environ.get('W', 820)); PAD = 26; TOP = 74
cols = [('받은 그림 (2026-10-09)', SRC), ('시안 v10.30  #/g/mny  — 그림의 구역 전부(견본) + 지금 있던 구역', os.path.join(Q, 'mny_proto.png')), ('실제 웹 v10.30  /money  — 서버에 자료가 있는 구역 + 지금 있던 구역', os.path.join(Q, 'mny_site.png'))]
ims = []
for t, p in cols:
    im = Image.open(p).convert('RGB'); ims.append((t, im.resize((W, round(im.height * W / im.width)), Image.LANCZOS)))
H = max(i.height for _, i in ims) + TOP + PAD
sheet = Image.new('RGB', (PAD + (W + PAD) * len(ims), H), '#ffffff'); d = ImageDraw.Draw(sheet)
def font(sz):
    for f in ('/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', '/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf'):
        if os.path.exists(f): return ImageFont.truetype(f, sz)
    return ImageFont.load_default()
F = font(19)
for n, (t, im) in enumerate(ims):
    x = PAD + n * (W + PAD)
    d.rectangle([x, 18, x + W, 58], fill='#00245a'); d.text((x + 14, 26), t, fill='#ffffff', font=F)
    sheet.paste(im, (x, TOP)); d.rectangle([x - 1, TOP - 1, x + W, TOP + im.height], outline='#c9ced6')
sheet.save(OUT, optimize=True); print(OUT, sheet.size, '%.1fMB' % (os.path.getsize(OUT) / 1e6))
