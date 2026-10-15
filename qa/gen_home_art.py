"""새 메인(hero 페이지 · v10.13) — 실제 데이터 판의 분류 그림(t-*.svg) 생성.

  python3 gen_home_art.py            → sgb/site/public/home/*.svg  (+ 킷 목업 사진 5장 *.jpg)
  시안(spec/proto.html)에는 apply_proto_main.py 가 같은 파일을 data URI 로 넣습니다.

그림은 장식 · 분류 표시용입니다. 특정 매물 · 상품 · 사람의 실제 사진이 아닙니다.
"""
import os, random, re, base64

# 킷 안(qa/)에서 돌리면 옆의 sgb/ 를 씁니다. 다른 곳이면 KIT=<sgb 경로>
_kit = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sgb')
K = os.environ.get('KIT') or (_kit if os.path.isdir(os.path.join(_kit, 'spec')) else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
OUT = os.path.join(K, 'site/public/home')
os.makedirs(OUT, exist_ok=True)


def svg(name, w, h, body, defs=''):
    s = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" '
         f'preserveAspectRatio="xMidYMid slice">' + (f'<defs>{defs}</defs>' if defs else '') + body + '</svg>')
    s = re.sub(r'\s*\n\s*', '', s)
    open(os.path.join(OUT, name + '.svg'), 'w', encoding='utf-8').write(s)
    return s


def lg(i, stops, x1=0, y1=0, x2=0, y2=1):
    return (f'<linearGradient id="{i}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}">' +
            ''.join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops) + '</linearGradient>')


def rg(i, stops, cx=.5, cy=.5, r=.5):
    return (f'<radialGradient id="{i}" cx="{cx}" cy="{cy}" r="{r}">' +
            ''.join(f'<stop offset="{o}" stop-color="{c}"' + (f' stop-opacity="{a}"' if a is not None else '') + '/>'
                    for o, c, a in stops) + '</radialGradient>')


def blobs(rnd, n, x0, x1, y0, y1, r0, r1, cols, op=1.0):
    out = []
    for _ in range(n):
        out.append(f'<circle cx="{rnd.uniform(x0, x1):.0f}" cy="{rnd.uniform(y0, y1):.0f}" r="{rnd.uniform(r0, r1):.0f}" '
                   f'fill="{rnd.choice(cols)}"' + (f' opacity="{op}"' if op < 1 else '') + '/>')
    return ''.join(out)


AUT = ['#E58A1F', '#F2A93B', '#D9661F', '#F4C24D', '#C9772A', '#E8B04A']
GRN = ['#8FA34E', '#7C9442', '#A3B560', '#6E8A3A']


def leaf(x, y, s, rot, col):
    return (f'<path transform="translate({x} {y}) rotate({rot}) scale({s})" fill="{col}" '
            'd="M0-10 3-4 9-6 6 0 10 3 4 4 5 10 0 7-5 10-4 4-10 3-6 0-9-6-3-4z"/>')


# ── 1. 가을 테라스 (오늘의 소개뱅크 큰 배너) ─────────────────────────────
def scene_autumn():
    r = random.Random(7)
    sky = lg('a', [(0, '#FBE7CB'), (.5, '#F6E6D2'), (1, '#E6E3E0')])
    wat = lg('b', [(0, '#D7E6EC'), (1, '#BFD6DF')])
    flr = lg('c', [(0, '#B98452'), (1, '#8E5F36')])
    sun = rg('d', [(0, '#FFF8E2', .95), (1, '#FFF8E2', 0)], .5, .5, .5)
    b = f'<rect width="900" height="400" fill="url(#a)"/><circle cx="560" cy="120" r="230" fill="url(#d)"/>'
    b += '<path d="M240 250 380 150 470 205 560 120 700 230 900 190V270H240z" fill="#D9CDE2" opacity=".75"/>'
    b += '<path d="M330 262 450 198 540 236 640 176 900 250V280H330z" fill="#C5C0DA" opacity=".8"/>'
    for x, w, h in [(402, 22, 70), (430, 16, 96), (452, 26, 58), (486, 14, 128), (506, 24, 80), (540, 18, 104),
                    (566, 28, 64), (604, 15, 150), (626, 22, 88), (656, 20, 62), (682, 26, 76)]:
        b += f'<rect x="{x}" y="{262 - h}" width="{w}" height="{h}" rx="2" fill="#CFCDE0" opacity=".9"/>'
        b += f'<rect x="{x + 3}" y="{268 - h}" width="{max(3, w - 12)}" height="{h - 10}" fill="#E3E1EE" opacity=".6"/>'
    b += '<rect y="258" width="900" height="50" fill="url(#b)"/>'
    b += '<path d="M0 266c120-10 250 6 380 0s300-8 520 2v10H0z" fill="#fff" opacity=".35"/>'
    b += blobs(r, 26, 300, 900, 262, 300, 16, 34, AUT + GRN)
    b += '<path d="M0 400V316l900-22V400z" fill="url(#c)"/>'
    for i in range(9):
        b += f'<path d="M{i * 110 - 30} 400 {i * 100 + 40} 300" stroke="#7A5230" stroke-width="2" opacity=".35"/>'
    b += '<path d="M330 300 900 286" stroke="#4A3524" stroke-width="5"/><path d="M330 318 900 306" stroke="#4A3524" stroke-width="3"/>'
    for x in range(350, 900, 46):
        b += f'<rect x="{x}" y="{300 - (x - 330) * .025:.0f}" width="4" height="34" fill="#4A3524"/>'
    for x, y, s in [(520, 348, 1.0), (640, 362, 1.15), (772, 352, 1.05), (860, 378, 1.25)]:
        b += (f'<g transform="translate({x} {y}) scale({s})"><ellipse cx="0" cy="0" rx="46" ry="13" fill="#FFF8EE"/>'
              '<path d="M-44 2c0 16 88 16 88 0v14c0 14-88 14-88 0z" fill="#EFE3D2"/>'
              '<rect x="-3" y="14" width="6" height="26" fill="#5A3D25"/>'
              '<circle cx="-14" cy="-3" r="5" fill="#fff"/><circle cx="12" cy="-2" r="6" fill="#fff"/>'
              '<rect x="-60" y="2" width="12" height="30" rx="3" fill="#6B4A2F"/><rect x="50" y="2" width="12" height="30" rx="3" fill="#6B4A2F"/></g>')
    b += '<path d="M770 400c4-120-6-230 4-330l22 4c-8 100 6 210 6 326z" fill="#5E4129"/>'
    b += '<path d="M780 190c-30-30-70-36-110-30M792 150c30-34 60-40 100-36" stroke="#5E4129" stroke-width="9" fill="none" stroke-linecap="round"/>'
    b += '<path d="M610 0H900V26L610 14z" fill="#4A3524"/>'
    b += blobs(r, 70, 600, 910, -20, 190, 20, 44, AUT + ['#8FA34E', '#A3B560'])
    b += blobs(r, 22, 610, 900, 10, 170, 8, 16, ['#FBD77A', '#F7C65B'], .9)
    for _ in range(12):
        b += leaf(r.uniform(330, 880), r.uniform(190, 380), r.uniform(.5, 1.0), r.uniform(0, 360), r.choice(AUT))
    return svg('scene-autumn', 900, 400, b, sky + wat + flr + sun)


# ── 2. 음식 (맛집 · 가족식당) ───────────────────────────────────────────
def food(name, seed, w=400, h=260, two=False):
    r = random.Random(seed)
    d = lg('a', [(0, '#D7A877'), (1, '#A8754A')]) + rg('b', [(0, '#F3A23C', 1), (1, '#D9661F', 1)])
    b = f'<rect width="{w}" height="{h}" fill="url(#a)"/>'
    for i in range(6):
        b += f'<rect y="{i * h / 6:.0f}" width="{w}" height="2" fill="#8E5F36" opacity=".25"/>'

    def bowl(cx, cy, R):
        s = f'<ellipse cx="{cx}" cy="{cy + R * .16:.0f}" rx="{R * 1.08:.0f}" ry="{R * .5:.0f}" fill="#000" opacity=".16"/>'
        s += f'<ellipse cx="{cx}" cy="{cy}" rx="{R}" ry="{R * .62:.0f}" fill="#F7F3EC"/>'
        s += f'<ellipse cx="{cx}" cy="{cy - 3}" rx="{R * .86:.0f}" ry="{R * .5:.0f}" fill="url(#b)"/>'
        cols = ['#F7D24B', '#fff', '#7FB24A', '#C6362B', '#8A4B2A', '#F4B63F', '#5D9A3C', '#E9E0D0']
        for _ in range(16):
            a, q = r.uniform(0, 6.28), r.uniform(0, .72)
            import math
            x, y = cx + math.cos(a) * R * .8 * q, cy - 3 + math.sin(a) * R * .44 * q
            rr = r.uniform(R * .07, R * .17)
            s += f'<ellipse cx="{x:.0f}" cy="{y:.0f}" rx="{rr:.0f}" ry="{rr * .72:.0f}" fill="{r.choice(cols)}"/>'
        s += f'<ellipse cx="{cx - R * .3:.0f}" cy="{cy - R * .22:.0f}" rx="{R * .3:.0f}" ry="{R * .08:.0f}" fill="#fff" opacity=".35"/>'
        return s
    if two:
        b += bowl(w * .30, h * .56, h * .36) + bowl(w * .74, h * .44, h * .30)
        b += f'<rect x="{w * .48:.0f}" y="{h * .72:.0f}" width="{w * .2:.0f}" height="8" rx="4" fill="#5A3D25" transform="rotate(-18 {w * .58:.0f} {h * .74:.0f})"/>'
    else:
        b += bowl(w * .5, h * .54, h * .42)
        b += f'<circle cx="{w * .1:.0f}" cy="{h * .2:.0f}" r="{h * .14:.0f}" fill="#F7F3EC"/><circle cx="{w * .1:.0f}" cy="{h * .2:.0f}" r="{h * .09:.0f}" fill="#7FB24A"/>'
        b += f'<circle cx="{w * .92:.0f}" cy="{h * .84:.0f}" r="{h * .13:.0f}" fill="#F7F3EC"/><circle cx="{w * .92:.0f}" cy="{h * .84:.0f}" r="{h * .08:.0f}" fill="#C6362B"/>'
    return svg(name, w, h, b, d)


# ── 3. 전문가 (얼굴 없는 인물 그림) ───────────────────────────────────────
def avatar():
    d = lg('a', [(0, '#EEF1F6'), (1, '#DDE3EC')]) + lg('b', [(0, '#2B3550'), (1, '#1A2238')])
    b = '<rect width="400" height="260" fill="url(#a)"/><rect x="0" y="0" width="120" height="260" fill="#E6EAF1"/>'
    b += '<rect x="300" y="30" width="70" height="120" rx="6" fill="#fff" opacity=".7"/>'
    b += '<path d="M92 260c6-66 50-92 108-92s102 26 108 92z" fill="url(#b)"/>'
    b += '<path d="M168 170 200 214 232 170 216 160H184z" fill="#fff"/>'
    b += '<path d="M194 186h12l6 50-12 14-12-14z" fill="#8A2D3C"/>'
    b += '<rect x="184" y="132" width="32" height="40" rx="12" fill="#E7B48F"/>'
    b += '<ellipse cx="200" cy="104" rx="42" ry="48" fill="#F0C4A0"/>'
    b += '<path d="M156 100c-4-44 24-62 48-62s48 14 42 60c-8-22-22-32-42-32s-38 10-48 34z" fill="#23262E"/>'
    b += '<path d="M184 124c8 8 24 8 32 0" stroke="#B9785A" stroke-width="3" fill="none" stroke-linecap="round"/>'
    b += '<path d="M168 170 150 196 200 214zM232 170 250 196 200 214z" fill="#232B44"/>'
    return svg('pro', 400, 260, b, d)


# ── 4. 가전 (음식물처리기 · 공기청정기) ───────────────────────────────────
def appliance(name='appliance', w=400, h=260):
    d = lg('a', [(0, '#F5F3EF'), (1, '#ECE8E2')]) + lg('b', [(0, '#FFFFFF'), (1, '#E9EBEF')])
    b = f'<rect width="{w}" height="{h}" fill="url(#a)"/><rect y="{h * .78:.0f}" width="{w}" height="{h * .22:.0f}" fill="#E3D9CB"/>'
    b += f'<rect x="{w * .26:.0f}" y="{h * .16:.0f}" width="{w * .34:.0f}" height="{h * .68:.0f}" rx="18" fill="url(#b)" stroke="#D9DCE2" stroke-width="2"/>'
    for i in range(5):
        for j in range(5):
            b += f'<circle cx="{w * .33 + j * w * .05:.0f}" cy="{h * .30 + i * h * .07:.0f}" r="3" fill="#C9CED6"/>'
    b += f'<circle cx="{w * .55:.0f}" cy="{h * .24:.0f}" r="7" fill="#2B3550"/><circle cx="{w * .55:.0f}" cy="{h * .72:.0f}" r="7" fill="#2B3550"/>'
    b += f'<rect x="{w * .72:.0f}" y="{h * .62:.0f}" width="{w * .12:.0f}" height="{h * .2:.0f}" rx="6" fill="#D9A679"/>'
    b += (f'<path d="M{w * .78:.0f} {h * .62:.0f}c-30-30-34-60-10-84 6 30 16 50 10 84zM{w * .78:.0f} {h * .62:.0f}c22-34 34-52 16-86-14 26-20 52-16 86z'
          f'M{w * .78:.0f} {h * .62:.0f}c-2-40 0-70 2-100 12 34 8 66-2 100z" fill="#4E9A51"/>')
    return svg(name, w, h, b, d)


def clipboard():
    d = lg('a', [(0, '#F4EDE2'), (1, '#E8DDCD')])
    b = '<rect width="400" height="260" fill="url(#a)"/>'
    b += '<g transform="rotate(-14 200 130)"><rect x="110" y="20" width="190" height="240" rx="10" fill="#C89A6A"/>'
    b += '<rect x="122" y="36" width="166" height="216" rx="4" fill="#fff"/><rect x="170" y="10" width="70" height="26" rx="8" fill="#6B7280"/>'
    for i in range(7):
        y = 60 + i * 26
        b += f'<rect x="136" y="{y}" width="14" height="14" rx="3" fill="{"#2F7BF6" if i % 2 == 0 else "#fff"}" stroke="#2F7BF6" stroke-width="2"/>'
        b += f'<rect x="160" y="{y + 3}" width="{[110, 90, 100, 76, 112, 84, 96][i]}" height="7" rx="3" fill="#D5DAE2"/>'
    b += '</g><g transform="rotate(34 300 150)"><rect x="296" y="60" width="12" height="150" rx="4" fill="#2B3550"/><path d="M296 210h12l-6 18z" fill="#E7B48F"/></g>'
    return svg('survey', 400, 260, b, d)


def street():
    r = random.Random(3)
    d = lg('a', [(0, '#F9E7CC'), (1, '#F2D7B0')])
    b = '<rect width="400" height="220" fill="url(#a)"/><rect y="176" width="400" height="44" fill="#CDB89C"/>'
    x = 0
    for w, hh, col in [(92, 150, '#B5643C'), (78, 128, '#8A5A3C'), (100, 162, '#C9773F'), (70, 120, '#9B6B45'), (90, 146, '#B87545')]:
        b += f'<rect x="{x}" y="{176 - hh}" width="{w}" height="{hh}" fill="{col}"/>'
        b += f'<rect x="{x + 8}" y="{176 - 62}" width="{w - 16}" height="54" fill="#3B2A22"/><rect x="{x + 12}" y="{176 - 58}" width="{w - 24}" height="34" fill="#F6D58A" opacity=".9"/>'
        b += f'<path d="M{x + 2} {176 - 64}h{w - 4}l6 16H{x - 4}z" fill="{r.choice(["#D8432F", "#2F6FB0", "#3E8E5A", "#E0902A"])}"/>'
        for k in range(2):
            b += f'<rect x="{x + 14 + k * (w - 44)}" y="{176 - hh + 16}" width="16" height="22" rx="2" fill="#F6E3B4" opacity=".85"/>'
        x += w - 6
    b += blobs(r, 10, 300, 400, 10, 70, 14, 26, AUT)
    for px in (120, 150, 262):
        b += f'<circle cx="{px}" cy="168" r="6" fill="#2B3550"/><rect x="{px - 5}" y="174" width="10" height="24" rx="4" fill="#2B3550"/>'
    return svg('street', 400, 220, b, d)


def park():
    r = random.Random(11)
    d = lg('a', [(0, '#E4F3F1'), (1, '#D6EBD2')])
    b = '<rect width="400" height="220" fill="url(#a)"/><path d="M0 220V150c80-24 180-16 400-34V220z" fill="#A9D08E"/>'
    b += '<path d="M150 220c20-40 80-66 250-74v16c-120 8-160 30-170 58z" fill="#EADFC8"/>'
    for x in (40, 110, 300, 360):
        b += f'<rect x="{x - 4}" y="96" width="8" height="70" fill="#6B4A2F"/>'
    b += blobs(r, 34, 10, 400, 30, 120, 18, 36, ['#5E9E4B', '#79B45E', '#4F8A3F', '#93C572', '#3F7A36'])
    b += blobs(r, 8, 10, 400, 30, 110, 8, 14, ['#C9E6A8'], .8)
    return svg('park', 400, 220, b, d)


def dog():
    d = lg('a', [(0, '#F3F4F6'), (1, '#E5E7EB')])
    b = '<rect width="400" height="220" fill="url(#a)"/><rect y="170" width="400" height="50" fill="#DCCBB5"/>'
    b += '<path d="M130 220c0-50 30-76 70-76s70 26 70 76z" fill="#D9A566"/>'
    b += '<path d="M150 70c-26-10-40 14-30 54 14-10 26-22 30-54zM250 70c26-10 40 14 30 54-14-10-26-22-30-54z" fill="#A9743D"/>'
    b += '<ellipse cx="200" cy="108" rx="58" ry="54" fill="#E6B877"/><ellipse cx="200" cy="130" rx="30" ry="24" fill="#F6E3C5"/>'
    b += '<circle cx="178" cy="98" r="6" fill="#23262E"/><circle cx="222" cy="98" r="6" fill="#23262E"/><ellipse cx="200" cy="120" rx="9" ry="6" fill="#23262E"/>'
    b += '<path d="M190 134c6 6 14 6 20 0" stroke="#23262E" stroke-width="3" fill="none" stroke-linecap="round"/>'
    b += '<rect x="158" y="150" width="84" height="12" rx="6" fill="#2F7BF6"/><circle cx="200" cy="166" r="7" fill="#F4C24D"/>'
    return svg('pet', 400, 220, b, d)


def phone():
    d = lg('a', [(0, '#FBF6EE'), (1, '#F1E8DA')])
    b = '<rect width="400" height="220" fill="url(#a)"/>'
    b += '<g transform="rotate(14 230 110)"><rect x="170" y="6" width="120" height="216" rx="18" fill="#1F2937"/><rect x="178" y="16" width="104" height="196" rx="10" fill="#fff"/>'
    b += '<rect x="178" y="16" width="104" height="52" rx="10" fill="#4C8DF6"/><rect x="190" y="30" width="56" height="8" rx="4" fill="#fff"/><rect x="190" y="46" width="36" height="6" rx="3" fill="#CFE0FF"/>'
    for i in range(4):
        b += f'<rect x="{188 + (i % 2) * 46}" y="{78 + (i // 2) * 62}" width="38" height="38" rx="6" fill="{["#FDE2B8", "#D8ECFF", "#E3F6E0", "#FBDCE4"][i]}"/><rect x="{188 + (i % 2) * 46}" y="{120 + (i // 2) * 62}" width="30" height="5" rx="2" fill="#D5DAE2"/>'
    b += '</g><path d="M120 220c20-50 60-70 110-60l40 60z" fill="#F0C4A0"/>'
    return svg('store-phone', 400, 220, b, d)


def robot(name, top, body, lid):
    d = rg('a', [(0, top, 1), (1, body, 1)], .4, .3, .8)
    b = '<ellipse cx="100" cy="92" rx="84" ry="14" fill="#000" opacity=".14"/>'
    b += f'<path d="M16 62c0 26 168 26 168 0v16c0 26-168 26-168 0z" fill="{body}"/>'
    b += f'<ellipse cx="100" cy="62" rx="84" ry="30" fill="url(#a)"/><ellipse cx="100" cy="56" rx="30" ry="10" fill="{lid}"/>'
    b += f'<rect x="76" y="82" width="48" height="10" rx="5" fill="#111827"/><circle cx="100" cy="56" r="4" fill="{body}"/>'
    return svg(name, 200, 120, b, d)


def bags():
    d = lg('a', [(0, '#8B6CFF'), (1, '#5B3DF5')]) + lg('b', [(0, '#FFC247'), (1, '#F59E0B')])
    b = '<ellipse cx="104" cy="186" rx="84" ry="10" fill="#000" opacity=".1"/>'
    b += '<path d="M48 64c0-40 56-40 56 0" stroke="#5B3DF5" stroke-width="8" fill="none"/><path d="M26 62h100l10 120H16z" fill="url(#a)"/><path d="M26 62h100l2 18H24z" fill="#fff" opacity=".18"/>'
    b += '<path d="M118 102c0-32 44-32 44 0" stroke="#D98200" stroke-width="7" fill="none"/><path d="M98 100h84l8 84H90z" fill="url(#b)"/><path d="M98 100h84l2 14H96z" fill="#fff" opacity=".22"/>'
    return svg('bags', 200, 200, b, d)


def purifier():
    d = lg('a', [(0, '#FFFFFF'), (1, '#E7EAEE')])
    b = '<ellipse cx="80" cy="206" rx="52" ry="8" fill="#000" opacity=".1"/>'
    b += '<rect x="32" y="20" width="96" height="184" rx="12" fill="url(#a)" stroke="#D5D9E0" stroke-width="2"/><rect x="32" y="20" width="96" height="26" rx="12" fill="#F3F4F6"/>'
    b += '<circle cx="80" cy="33" r="5" fill="#9CA3AF"/>'
    for i in range(9):
        b += f'<rect x="46" y="{96 + i * 11}" width="68" height="4" rx="2" fill="#C9CED6"/>'
    b += '<rect x="44" y="196" width="14" height="10" rx="3" fill="#9CA3AF"/><rect x="102" y="196" width="14" height="10" rx="3" fill="#9CA3AF"/>'
    return svg('purifier', 160, 220, b, d)


def airfryer():
    d = lg('a', [(0, '#3A3F4B'), (1, '#14171D')])
    b = '<ellipse cx="62" cy="112" rx="48" ry="6" fill="#000" opacity=".12"/><rect x="18" y="14" width="88" height="98" rx="20" fill="url(#a)"/>'
    b += '<rect x="30" y="52" width="64" height="46" rx="8" fill="#0B0D11"/><rect x="36" y="58" width="52" height="30" rx="5" fill="#E58A1F"/><circle cx="52" cy="72" r="6" fill="#F4C24D"/><circle cx="70" cy="76" r="7" fill="#C6362B"/>'
    b += '<rect x="46" y="26" width="32" height="10" rx="5" fill="#5B6270"/><rect x="50" y="98" width="24" height="8" rx="4" fill="#5B6270"/>'
    b += '<path d="M118 108V70c8-10 10-22 4-34M118 70c-10-8-14-20-10-30" stroke="#4E9A51" stroke-width="6" fill="none" stroke-linecap="round"/><rect x="108" y="96" width="20" height="16" rx="4" fill="#D9A679"/>'
    return svg('airfryer', 140, 120, b, d)


def doc():
    d = lg('a', [(0, '#DCEBFF'), (1, '#A9CBFF')]) + lg('b', [(0, '#5FA2FF'), (1, '#2F7BF6')])
    b = '<path d="M26 12h46l24 24v70a6 6 0 0 1-6 6H26a6 6 0 0 1-6-6V18a6 6 0 0 1 6-6z" fill="url(#a)"/><path d="M72 12v18a6 6 0 0 0 6 6h18z" fill="#7FB0FF"/>'
    for i, w in enumerate([44, 52, 36, 48]):
        b += f'<rect x="32" y="{50 + i * 13}" width="{w}" height="6" rx="3" fill="#fff" opacity=".9"/>'
    b += '<g transform="rotate(40 92 86)"><rect x="86" y="50" width="13" height="56" rx="4" fill="url(#b)"/><path d="M86 106h13l-6.500 14z" fill="#1E4FB8"/></g>'
    return svg('doc', 120, 124, b, d)


def pin():
    d = lg('a', [(0, '#5FA2FF'), (1, '#2460E8')])
    b = '<ellipse cx="60" cy="110" rx="26" ry="6" fill="#2460E8" opacity=".2"/><path d="M60 8c-24 0-40 18-40 40 0 28 40 58 40 58s40-30 40-58c0-22-16-40-40-40z" fill="url(#a)"/>'
    b += '<circle cx="60" cy="46" r="16" fill="#fff"/><path d="M32 30c6-10 16-16 28-16" stroke="#fff" stroke-width="5" opacity=".45" fill="none" stroke-linecap="round"/>'
    return svg('pin', 120, 120, b, d)


def coffee():
    r = random.Random(5)
    b = ''
    for x, y, s, a in [(40, 30, 2.2, 20), (100, 96, 1.8, 140), (300, 26, 1.9, 70), (336, 92, 1.6, 200), (16, 100, 1.4, 300)]:
        b += leaf(x, y, s, a, r.choice(['#E8742A', '#F2A93B', '#D9561F']))
    b += '<ellipse cx="170" cy="96" rx="72" ry="14" fill="#fff"/><ellipse cx="170" cy="94" rx="60" ry="9" fill="#F1E7DA"/>'
    b += '<path d="M128 40h84v30c0 22-18 34-42 34s-42-12-42-34z" fill="#fff"/><ellipse cx="170" cy="40" rx="42" ry="10" fill="#6B3F22"/><ellipse cx="162" cy="38" rx="20" ry="4" fill="#8A5A36"/>'
    b += '<path d="M212 50c22-4 26 26 0 26" stroke="#fff" stroke-width="8" fill="none"/>'
    b += '<path d="M236 104c-6-30 20-48 50-44 24 4 40 22 34 44z" fill="#E0962F"/><path d="M252 104c2-22 10-34 24-42M276 104c0-22 4-36 12-44M298 104c-2-20 0-30 6-38" stroke="#B86F1B" stroke-width="5" fill="none"/>'
    return svg('coffee', 360, 120, b)


def cafe_front():
    r = random.Random(9)
    b = '<rect x="30" y="34" width="150" height="86" fill="#C98A52"/><rect x="42" y="64" width="54" height="56" fill="#5A3D25"/><rect x="48" y="70" width="42" height="34" fill="#F6D58A"/>'
    b += '<rect x="108" y="64" width="62" height="40" fill="#F6E3B4"/>'
    for i in range(8):
        b += f'<path d="M{24 + i * 20} 34h20l-4 22h-20z" fill="{"#D8432F" if i % 2 == 0 else "#FFF4E4"}"/>'
    b += '<rect x="24" y="24" width="162" height="12" rx="3" fill="#7A4B2A"/>'
    b += blobs(r, 9, 150, 200, 0, 40, 10, 18, AUT)
    b += '<circle cx="120" cy="112" r="8" fill="#F2A93B"/><circle cx="140" cy="114" r="6" fill="#D8432F"/><circle cx="156" cy="112" r="7" fill="#8FA34E"/>'
    return svg('cafe-front', 200, 120, b)


# ── 실제 데이터 카드용 분류 그림 (특정 매물 · 상품의 사진이 아닙니다) ───────────
def thumb(name, c1, c2, art):
    d = lg('a', [(0, c1), (1, c2)], 0, 0, 1, 1)
    # 그림은 가운데에 작게 둡니다 — 카드마다 잘리는 비율이 달라도(16:10 · 3:1) 그림이 잘리지 않게
    b = (f'<rect width="400" height="260" fill="url(#a)"/><circle cx="330" cy="40" r="90" fill="#fff" opacity=".28"/>'
         f'<circle cx="50" cy="240" r="70" fill="#fff" opacity=".2"/><g transform="translate(200 132) scale(.58) translate(-200 -134)">{art}</g>')
    return svg(name, 400, 260, b, d)


def thumbs():
    thumb('t-product', '#EEE9FF', '#DCD3FF',
          '<rect x="150" y="70" width="100" height="140" rx="16" fill="#fff"/><rect x="166" y="46" width="68" height="30" rx="8" fill="#5B3DF5"/>'
          '<rect x="164" y="112" width="72" height="58" rx="8" fill="#EEE9FF"/><path d="M186 141h28M200 127v28" stroke="#5B3DF5" stroke-width="8" stroke-linecap="round"/>')
    thumb('t-device', '#E3F1FF', '#CFE3FF',
          '<rect x="110" y="70" width="180" height="120" rx="16" fill="#fff"/><rect x="128" y="88" width="144" height="60" rx="8" fill="#12203A"/>'
          '<path d="M140 120h24l10-18 16 36 12-24 8 6h40" stroke="#5CE0B8" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
          '<circle cx="150" cy="168" r="8" fill="#2F7BF6"/><rect x="170" y="162" width="90" height="12" rx="6" fill="#D5DAE2"/>')
    thumb('t-fitness', '#E6F7EF', '#CDEFDD',
          '<rect x="120" y="120" width="160" height="20" rx="10" fill="#374151"/><rect x="96" y="92" width="30" height="76" rx="10" fill="#0F8A5F"/><rect x="274" y="92" width="30" height="76" rx="10" fill="#0F8A5F"/>'
          '<rect x="76" y="106" width="22" height="48" rx="8" fill="#34B585"/><rect x="302" y="106" width="22" height="48" rx="8" fill="#34B585"/>')
    thumb('t-building', '#E9EEFF', '#D5DEFF',
          '<rect x="130" y="60" width="96" height="160" rx="6" fill="#4C6FE8"/><rect x="226" y="110" width="60" height="110" rx="6" fill="#7F9BFF"/>' +
          ''.join(f'<rect x="{144 + (i % 3) * 26}" y="{76 + (i // 3) * 30}" width="16" height="18" rx="3" fill="#DCE5FF"/>' for i in range(12)) +
          ''.join(f'<rect x="{238 + (i % 2) * 22}" y="{124 + (i // 2) * 28}" width="14" height="16" rx="3" fill="#EEF2FF"/>' for i in range(6)) +
          '<rect x="100" y="218" width="200" height="8" rx="4" fill="#3B55B8"/>')
    thumb('t-machine', '#FFF1DE', '#FFE2BD',
          '<circle cx="200" cy="130" r="56" fill="#F59E0B"/><circle cx="200" cy="130" r="24" fill="#FFF7E8"/>' +
          ''.join(f'<rect x="188" y="52" width="24" height="34" rx="6" fill="#F59E0B" transform="rotate({a} 200 130)"/>' for a in range(0, 360, 45)))
    thumb('t-store', '#FFEFE3', '#FFDCC4',
          '<rect x="110" y="110" width="180" height="110" rx="6" fill="#fff"/><rect x="130" y="150" width="50" height="70" fill="#C2560C"/><rect x="196" y="140" width="76" height="44" rx="4" fill="#FFE7D1"/>' +
          ''.join(f'<path d="M{100 + i * 40} 80h40l-6 34h-40z" fill="{"#EA6A1C" if i % 2 == 0 else "#FFF4EA"}"/>' for i in range(5)) +
          '<rect x="96" y="70" width="208" height="14" rx="5" fill="#9A4208"/>')
    thumb('t-people', '#EEE9FF', '#E2DAFF',
          '<circle cx="170" cy="104" r="30" fill="#5B3DF5"/><path d="M116 200c0-36 24-56 54-56s54 20 54 56z" fill="#5B3DF5"/>'
          '<circle cx="248" cy="116" r="24" fill="#9C8BFF"/><path d="M206 200c0-30 18-46 42-46s42 16 42 46z" fill="#9C8BFF"/>')
    thumb('t-request', '#E3F1FF', '#D2E6FF',
          '<path d="M110 76h180a12 12 0 0 1 12 12v84a12 12 0 0 1-12 12H190l-40 34v-34h-40a12 12 0 0 1-12-12V88a12 12 0 0 1 12-12z" fill="#fff"/>'
          '<rect x="128" y="104" width="144" height="12" rx="6" fill="#2F7BF6"/><rect x="128" y="128" width="104" height="10" rx="5" fill="#BBD4FF"/><rect x="128" y="148" width="124" height="10" rx="5" fill="#BBD4FF"/>')
    thumb('t-solar', '#FFF6D9', '#FFE9A8',
          '<circle cx="300" cy="70" r="30" fill="#F59E0B"/><path d="M90 210 150 110h160l-40 100z" fill="#1E4FB8"/>' +
          ''.join(f'<path d="M{118 + i * 42} 200 {166 + i * 40} 120" stroke="#9CC0FF" stroke-width="3"/>' for i in range(4)) +
          '<path d="M118 165h170M134 138h168" stroke="#9CC0FF" stroke-width="3"/>')
    thumb('t-car', '#E8EEF5', '#D6E0EC',
          '<path d="M96 170c0-20 16-26 30-28l24-34c6-8 14-10 22-10h66c10 0 18 4 24 12l22 30c20 2 30 10 30 30v14H96z" fill="#374151"/>'
          '<path d="M160 138l18-26h58l20 26z" fill="#BBD4FF"/><circle cx="146" cy="186" r="20" fill="#111827"/><circle cx="264" cy="186" r="20" fill="#111827"/><circle cx="146" cy="186" r="8" fill="#9CA3AF"/><circle cx="264" cy="186" r="8" fill="#9CA3AF"/>')


# ── 킷의 목업 사진(시안에 들어 있는 것) 꺼내기 ──────────────────────────────
def photos():
    s = open(os.path.join(K, 'spec/proto.html'), encoding='utf-8').read()
    out = {}
    for k in ('cafe', 'int', 'shop', 'car', 'mac'):
        m = re.search(r"\b" + k + r":'data:image/jpeg;base64,([A-Za-z0-9+/=]+)'", s)
        if not m: continue
        raw = base64.b64decode(m.group(1))
        open(os.path.join(OUT, f'photo-{k}.jpg'), 'wb').write(raw); out[k] = len(raw)
    return out


if __name__ == '__main__':
    # v10.13 — 사장님 결정으로 메인의 사진 · 아이콘 · 로고는 주신 그림에서 잘라 씁니다(crop_design.py).
    # 여기서는 **실제 데이터 판(HOME_CONTENT=live)** 의 분류 그림(t-*.svg)만 만듭니다 — 실제 매물 · 상품에는 그림 속 사진을 붙일 수 없기 때문입니다.
    thumbs()
    fs = sorted(f for f in os.listdir(OUT) if f.endswith('.svg'))
    print(len(fs), 'files', ' '.join(fs))
