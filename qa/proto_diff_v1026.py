"""시안이 앞 판과 「바뀌어야 할 화면만」 다른지 — 화면마다 그려서 견줍니다. 결과: proto_diff.json
   10/8 v10.26: 앞 판 v10.25 와 견줘
     · 새 화면 1장 — 운영 「소개몰 상품」(admhpr · SB-ADM-HPR-010) · 없어진 화면 0장
     · 본체의 나머지 194장은 글자 하나 같아야 합니다(소개몰의 고친 곳은 겹쳐 뜨는 틀이라 여기 들지 않고 proto_mall.py · proto_opt.py 가 봅니다)
   모양(스타일)은 proto_pixel.py 가 그림으로 견줍니다. (v10.25 의 비교 — 앞 판 v10.24 와 — 는 proto_diff_v1025.py · qa/results_v10_25/proto_diff.json)

사용: python3 proto_diff.py     BASE=/path/SGB_Prototype_v10_25.html (기본 /mnt/user-data/outputs)
"""
import json, os, re, sys
from playwright.sync_api import sync_playwright

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
if not os.path.isdir(K + '/sgb'): K = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.environ.get('BASE', '/mnt/user-data/outputs/SGB_Prototype_v10_25.html')
if not os.path.exists(BASE): BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_proto_v1025_base.html')
NEW = 'v10_26'
ADDED = ['admhpr']
CHANGED = set()
FILES = [K + '/sgb/spec/proto.html', K + f'/SGB_Prototype_{NEW}.html', K + f'/sgb/site/public/proto/SGB_Prototype_{NEW}.html']
OUT = os.path.dirname(os.path.abspath(__file__))
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print('ok  ' if ok else 'FAIL', step, '' if ok else str(detail)[:240], file=sys.stderr)

GET = """(k)=>{location.hash=''; __VIEW.paint(k); document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove());
    let h=document.getElementById('screen').innerHTML;
    h=h.replace(/data-adbox="HERO"[\\s\\S]*?<\\/div><\\/div>/g,'AD').replace(/\\d{1,2}:\\d{2}(:\\d{2})?/g,'T').replace(/SGB_Prototype_v10_[0-9]+\\.html/g,'PROTO').replace(/방문자 키: v-[a-z0-9]+/g,'방문자 키');
    return h}"""

def shots(pw, path):
    b = pw.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 900}); errs = []
    pg.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
    pg.on('pageerror', lambda e: errs.append(str(e)[:160]))
    pg.goto('file://' + path); pg.wait_for_timeout(1600)
    keys = pg.evaluate("Object.keys(__VIEW.screens)")
    out = {}
    for k in keys:
        try: out[k] = pg.evaluate(GET, k)
        except Exception as ex: out[k] = 'ERR ' + str(ex)[:80]
    b.close()
    return out, errs

same3 = len({open(f, 'rb').read() for f in FILES}) == 1
rec('세 파일(spec · 최상위 · site/public)이 같은 파일', same3)
title = open(FILES[0], encoding='utf-8').read(3000).split('<title>')[1].split('</title>')[0]
rec('제목 v10.26 — 앞 판들의 설명은 뒤에 그대로 남음', title.startswith('소개뱅크 시안 v10.26 (2026-10-08 · ') and 'v10.25: ' in title and 'v10.24: ' in title, title[:80])
with sync_playwright() as pw:
    old, e1 = shots(pw, BASE)
    new, e2 = shots(pw, FILES[0])
rec(f'화면 {len(old)}장 → {len(new)}장 — 새 화면 {ADDED} · 없어진 화면 0', set(new) == set(old) | set(ADDED), (len(old), len(new), sorted(set(new) ^ set(old))[:5]))
B64 = re.compile(r'data:image/[a-z]+;base64,[A-Za-z0-9+/=]+')
img = lambda t: B64.sub('IMG', t)
diff = sorted(k for k in old if img(old[k]) != img(new.get(k, '')))
rec(f'앞 판에 있던 {len(old)}장은 모두 글자 하나 같음(소개몰의 고친 곳은 겹쳐 뜨는 틀)', set(diff) == CHANGED, diff[:8])
h = new.get('admhpr', '')
rec('새 화면 「소개몰 상품」 — 상품 · 옵션/재고 · 변경 기록 · 성분/고민 · 갈래/판매 범위', all(w in h for w in ('소개몰 상품', '옵션 · 재고', '변경 기록', '성분 · 고민', '갈래 · 판매 범위', 'SB-ADM-HPR-010')), h[:120])
left = sorted(k for k in new if re.search(r'소개뱅크몰|소개머니|건강몰', img(new[k])))
rec('새 판의 화면 글자에 옛 이름(소개뱅크몰 · 소개머니 · 건강몰)이 남지 않음', not left, left[:8])
rec('소개광장 5장(v10.23)은 그대로 — 두 관 전용 머리줄 · 바닥줄이 본체에서는 그 5장에만(소개몰은 겹쳐 뜨는 틀)', sorted(k for k in new if 'class="b2-hd"' in new[k]) == ['cmu', 'cmud', 'cmupoll', 'cmuw', 'commu'], sorted(k for k in new if 'class="b2-hd"' in new[k]))
rec('두 판 모두 그리는 중 오류 0', not e1 and not e2, (e1[:2], e2[:2]))
raw = diff
ok = sum(1 for r in R if r['ok'])
json.dump({'items': R, 'pass': ok, 'total': len(R), 'changed': diff, 'added': ADDED, 'name_only': []}, open(os.path.join(OUT, 'proto_diff.json'), 'w'), ensure_ascii=False, indent=1)
print(f'통과 {ok} / {len(R)}')
