"""시안이 앞 판과 「바뀌어야 할 화면만」 다른지 — 화면마다 그려서 견줍니다. 결과: proto_diff.json
   10/8 v10.25: 앞 판 v10.24 와 견줘
     · 새 화면 0장 · 없어진 화면 0장(본체 194장 그대로 — 소개몰의 21장은 겹쳐 뜨는 틀이라 여기 들지 않고 proto_mall.py 가 봅니다)
     · 이름만 바뀐 화면 — 「소개뱅크몰」→「소개몰」 · 옛 뜻의 「소개몰」→「안심소개」 · 「소개머니」→「소개장터」 · 「건강몰」→「소개몰」(10/7 결정 — 약관까지 같이 고침).
       머리줄 메뉴에 이름이 있어 본체의 절반쯤이 걸립니다. 그래서 **앞 판의 글자에 같은 이름 규칙을 입힌 뒤** 견줍니다.
     · 이름 말고 달라지는 화면 5장 — 소개광장(cmu · cmud · cmupoll · cmuw · commu): 바닥 고지 문단에 표식(data-notice="inter")이 붙음. 보이는 글자 · 모양은 같음
   나머지는 글자 하나 같아야 합니다. 모양(스타일)은 proto_pixel.py 가 그림으로 견줍니다.
   (v10.24 의 비교 — 앞 판 v10.23 과 — 는 qa/results_v10_24/proto_diff.json 에 남아 있습니다.)

사용: python3 proto_diff.py     BASE=/path/SGB_Prototype_v10_24.html (기본 /mnt/user-data/outputs · 없으면 qa/_proto_v1024_base.html)
"""
import json, os, re, sys
from playwright.sync_api import sync_playwright

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
if not os.path.isdir(K + '/sgb'): K = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.environ.get('BASE', '/mnt/user-data/outputs/SGB_Prototype_v10_24.html')
if not os.path.exists(BASE): BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_proto_v1024_base.html')
NEW = 'v10_25'
ADDED = []
CHANGED = {'cmu', 'cmud', 'cmupoll', 'cmuw', 'commu'}
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
rec('제목 v10.25 — 앞 판들의 설명은 뒤에 그대로 남음', title.startswith('소개뱅크 시안 v10.25 (2026-10-08 · ') and 'v10.24: ' in title and 'v10.23: ' in title, title[:80])
with sync_playwright() as pw:
    old, e1 = shots(pw, BASE)
    new, e2 = shots(pw, FILES[0])
rec(f'화면 {len(old)}장 → {len(new)}장 — 새 화면 0 · 없어진 화면 0', set(new) == set(old), (len(old), len(new), sorted(set(new) ^ set(old))[:5]))
# 이름 규칙 — apply_proto_v1025.py 의 0) 과 같은 순서. 그림 조각(base64) 안의 글자는 건드리지 않습니다
B64 = re.compile(r'data:image/[a-z]+;base64,[A-Za-z0-9+/=]+')
def names(t):
    t = B64.sub('IMG', t).replace('(그림은 「소개몰」)', '\x00K')
    t = re.sub(r'(?<!뱅크)소개몰', '안심소개', t).replace('소개머니', '소개장터').replace('건강몰', '소개몰').replace('소개뱅크몰', '소개몰')
    return t.replace('\x00K', '(그림은 「소개몰」)')
img = lambda t: B64.sub('IMG', t)
raw = sorted(k for k in old if old[k] != new.get(k))
diff = sorted(k for k in old if names(old[k]) != img(new.get(k, '')))
rec(f'앞 판의 글자에 이름 규칙 4가지를 입히면 — 다른 화면은 정해 둔 {len(CHANGED)}장뿐(소개광장) · 나머지 {len(old) - len(CHANGED)}장은 글자 하나 같음 (이름까지 치면 {len(raw)}장이 다름 — 머리줄 메뉴의 이름 때문)',
    set(diff) == CHANGED, (sorted(set(diff) - CHANGED)[:8], sorted(CHANGED - set(diff))))
strip = lambda h: h.replace(' data-notice="inter"', '')
rec('소개광장 5장은 바닥 고지 문단의 표식(data-notice="inter")만 다름 — 그 표식을 빼면 글자 하나 같음', all(names(old[k]) == strip(img(new[k])) for k in CHANGED), [k for k in CHANGED if names(old[k]) != strip(img(new[k]))])
left = sorted(k for k in new if re.search(r'소개뱅크몰|소개머니|건강몰', img(new[k])))
rec('새 판의 화면 글자에 옛 이름(소개뱅크몰 · 소개머니 · 건강몰)이 남지 않음', not left, left[:8])
rec('소개광장 5장(v10.23)은 그대로 — 두 관 전용 머리줄 · 바닥줄이 본체에서는 그 5장에만(소개몰은 겹쳐 뜨는 틀)', sorted(k for k in new if 'class="b2-hd"' in new[k]) == ['cmu', 'cmud', 'cmupoll', 'cmuw', 'commu'], sorted(k for k in new if 'class="b2-hd"' in new[k]))
rec('두 판 모두 그리는 중 오류 0', not e1 and not e2, (e1[:2], e2[:2]))
ok = sum(1 for r in R if r['ok'])
json.dump({'items': R, 'pass': ok, 'total': len(R), 'changed': diff, 'added': ADDED, 'name_only': [k for k in raw if k not in diff]}, open(os.path.join(OUT, 'proto_diff.json'), 'w'), ensure_ascii=False, indent=1)
print(f'통과 {ok} / {len(R)}')
