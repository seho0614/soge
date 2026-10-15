"""시안의 「모양」이 앞 판과 어디가 다른지 — 화면마다 그림으로 찍어 견줍니다. 결과: proto_pixel.json

   v10.25 는 본체(194장)의 모양을 바꾸지 않았습니다 — 바뀐 것은 이름 4가지(소개뱅크몰 → 소개몰 · 옛 뜻의 소개몰 → 안심소개 · 소개머니 → 소개장터 · 건강몰 → 소개몰)와
   소개몰(겹쳐 뜨는 틀 · 21장 — proto_mall.py 가 따로 봅니다)입니다. 머리줄 메뉴에 이름이 있어 그대로 찍으면 절반쯤이 달라 보이므로,
   **앞 판의 화면 글자에 같은 이름 규칙을 입힌 뒤** 찍어 견줍니다. 그러면
     · 달라져야 하는 화면 0장 — 194장 모두 **점 하나 같아야** 합니다(새 스타일 · 새 머리줄이 본체에 닿지 않음)
   (v10.24 의 비교는 qa/results_v10_24/proto_pixel.json 에 남아 있습니다.)

사용: python3 proto_pixel.py     BASE=/path/SGB_Prototype_v10_24.html (기본 /mnt/user-data/outputs · 없으면 qa/_proto_v1024_base.html) · PROTO=/path/proto.html
"""
import io, json, os, sys
from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
if not os.path.isdir(K + '/sgb'): K = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.environ.get('BASE', '/mnt/user-data/outputs/SGB_Prototype_v10_25.html')      # v10.26 — 앞 판 v10.25 와(v10.25 의 비교는 proto_pixel_v1025.py)
if not os.path.exists(BASE): BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_proto_v1025_base.html')
ADDED = {'admhpr'}      # v10.26 새 화면 — 운영 「소개몰 상품」(앞 판에 없어 견주지 않음)
FILE = os.environ.get('PROTO', K + '/sgb/spec/proto.html')
OUT = os.path.dirname(os.path.abspath(__file__))
WANT = set()          # 달라져야 하는 화면 — 없음(이름 규칙을 입힌 뒤)
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:400]})
    print('ok  ' if ok else 'FAIL', step, '' if ok else str(detail)[:300], file=sys.stderr)

STYLE = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important} .admask,.adfloat{display:none!important} html{scroll-behavior:auto!important}"
PAINT = """(k)=>{location.hash=''; __VIEW.paint(k); document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove());
    const t=document.getElementById('toast'); if(t){t.classList.remove('on'); t.innerHTML=''}
    /* 판마다 · 열 때마다 달라지는 글자(시안 파일 이름 · 방문자 키 · 시각)는 같은 글자로 바꿔 놓고 찍습니다 — proto_diff.py 의 글자 비교와 같은 규칙 */
    const w=document.createTreeWalker(document.getElementById('screen'), NodeFilter.SHOW_TEXT); let n;
    const NM = (v) => v.replace('(그림은 「소개몰」)', '\u0000K').replace(/(?<!뱅크)소개몰/g, '안심소개').replace(/소개머니/g, '소개장터').replace(/건강몰/g, '소개몰').replace(/소개뱅크몰/g, '소개몰').replace('\u0000K', '(그림은 「소개몰」)');
    if (window.__NAMEMAP) { document.querySelectorAll('#screen [placeholder], #screen input[value], #screen option').forEach(e => { if (e.hasAttribute('placeholder')) e.setAttribute('placeholder', NM(e.getAttribute('placeholder'))); if (e.tagName === 'INPUT' && e.value) e.value = NM(e.value); }); }
    while((n=w.nextNode())){ const v=window.__NAMEMAP ? NM(n.nodeValue) : n.nodeValue, x=v.replace(/SGB_Prototype_v10_[0-9]+\.html/g,'SGB_Prototype_v10_NN.html').replace(/v-[a-z0-9]{6,}/g,'v-000000').replace(/\d{1,2}:\d{2}(:\d{2})?/g,'00:00'); if(x!==n.nodeValue) n.nodeValue=x; }
    const l=document.querySelector('#screen .lang'); const r=l&&l.offsetParent!==null?l.getBoundingClientRect():null;
    return r?{x:Math.round(r.left), w:Math.round(r.width)}:null}"""

def open_(b, path):
    pg = b.new_page(viewport={'width': 1280, 'height': 900})
    pg.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
    pg.goto('file://' + path); pg.wait_for_timeout(1600); pg.add_style_tag(content=STYLE)
    return pg

def shot(pg, k):
    lang = pg.evaluate(PAINT, k); pg.wait_for_timeout(50)
    return Image.open(io.BytesIO(pg.screenshot(full_page=True))).convert('RGB'), lang

def bbox(a, c):
    if a.size != c.size: return ('size', a.size, c.size)
    return ImageChops.difference(a, c).getbbox()

def main():
    with sync_playwright() as p:
        b = p.chromium.launch(); old = open_(b, BASE); new = open_(b, FILE)
        # v10.26 — 앞 판(v10.25)은 이미 새 이름이라 이름 규칙을 입히지 않습니다
        k_old = old.evaluate("Object.keys(__VIEW.screens)"); k_new = new.evaluate("Object.keys(__VIEW.screens)")
        res = {}
        for k in k_old:
            if k not in k_new: res[k] = {'kind': '없어짐'}; continue
            try:
                a, la = shot(old, k); c, lc = shot(new, k); bb = bbox(a, c)
                if bb is not None:                       # 한 번 더 — 광고 넘김처럼 때에 따라 달라지는 것을 거릅니다
                    a, la = shot(old, k); c, lc = shot(new, k); bb = bbox(a, c)
            except Exception as ex:
                res[k] = {'kind': '오류', 'detail': repr(ex)[:120]}; continue
            if bb is None: res[k] = {'kind': '같음'}
            elif bb[0] == 'size': res[k] = {'kind': '크기 다름', 'detail': [list(bb[1]), list(bb[2])]}
            else: res[k] = {'kind': '다름', 'bbox': list(bb)}
            if bb is not None and k not in WANT:
                a.crop((0, 0, 1280, min(a.size[1], 1000))).save(os.path.join(OUT, f'proto_pixel_{k}_old.png')); c.crop((0, 0, 1280, min(c.size[1], 1000))).save(os.path.join(OUT, f'proto_pixel_{k}_new.png'))
        b.close()
    kinds = {}
    for k, v in res.items(): kinds.setdefault(v['kind'], []).append(k)
    same = kinds.get('같음', []); diff = sorted(kinds.get('다름', []) + kinds.get('크기 다름', [])); bad = kinds.get('오류', []) + kinds.get('없어짐', [])
    rec(f'화면 {len(k_old)}장을 두 판에서 그림으로 찍어 견줌 — 오류 0 · 없어진 화면 0 · 새 화면 {sorted(ADDED)}', len(res) == len(k_old) and not bad and set(k_new) == set(k_old) | ADDED, bad[:5] or sorted(set(k_new) ^ set(k_old)))
    rec(f'앞 판에 있던 본체 {len(k_old)}장 모두 점 하나 같음(소개몰 고침 · 새 운영 화면이 본체 화면에 닿지 않음)', len(same) == len(k_old) and not diff, {k: res[k] for k in diff[:8]})
    ok = sum(1 for r in R if r['ok'])
    json.dump({'items': R, 'pass': ok, 'total': len(R), 'same': len(same), 'diff': diff, 'screens': res}, open(os.path.join(OUT, 'proto_pixel.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'통과 {ok} / {len(R)}')


if __name__ == '__main__':
    try: main()
    except Exception as ex:
        import traceback; traceback.print_exc(); rec('실행 중 오류', False, repr(ex)[:300]); print(f'통과 0 / {len(R)}')
