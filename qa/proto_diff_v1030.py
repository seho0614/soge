"""시안이 앞 판과 「바뀌어야 할 화면만」 다른지 — 화면마다 그려서 견줍니다. 결과: proto_diff.json
   10/9 v10.30: 앞 판 v10.28 과 견줘 — 새 화면 0장 · 바뀌어야 할 1장(소개장터 메인 list · v1030_changes.CHANGED) · 나머지는 글자 하나 같음. v10.28 의 비교는 proto_diff_v1028.py · qa/results_v10_28/proto_diff.json
   10/9 v10.28: 앞 판 v10.27 과 견줘 — 새 화면 3장(admhor · admhrv · trmagr) · 바뀌어야 할 9장(v1028_changes.CHANGED · 이용안내 · 약관 전문은 G-218) · 나머지는 글자 하나 같음. v10.27 의 비교는 qa/results_v10_27/proto_diff.json
   10/9 v10.27: 앞 판 v10.26 과 견줘 — 새 화면 1장(약관 전문 termsv) · 바뀌어야 할 26장(아래 CHANGED) · 나머지 169장은 글자 하나 같음
   (머리줄 종 · 「설정 · 알림」의 연결은 모든 화면에 있어 그 한 줄만 맞춰 견줌). v10.26 의 비교는 proto_diff_v1026.py
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
BASE = os.environ.get('BASE', '/mnt/user-data/outputs/SGB_Prototype_v10_28.html')
if not os.path.exists(BASE): BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_proto_v1028_base.html')
NEW = 'v10_30'
from v1030_changes import NEW as ADDED      # v10.30 — 새 화면 없음 ·  (앞 판의 주석:)      # 약관 전문 + G-130 새 화면 7장
# v10.27 — 바뀌어야 할 26장: 나의공간 왼쪽 메뉴(숫자 = 목록 건수 · 결제 수단 · 알림 · 한도 안내 · 사업자 전환 · 소개 활동 · G-198/G-199)를 쓰는 화면 전부
#   + 운영 대시보드(정산 합계 · 다른 운영 화면) · 이용안내(약관 링크 · 안내) · 가입 · 로그인(개인 회원 안내 · 단계 확인) · 소개 내역(후기 쓰기) · 내 리스팅(수정) · 구독(결제 패널 ③)
from v1030_changes import CHANGED      # v10.30 — 1장(list) · (앞 판의 주석:)     # v10.28 — 9장(v1028_changes.py) · v10.27 — 26장 + G-116 세 화면(bst · saf · win) = 29장
FILES = [K + '/sgb/spec/proto.html', K + f'/SGB_Prototype_{NEW}.html', K + f'/sgb/site/public/proto/SGB_Prototype_{NEW}.html']
OUT = os.path.dirname(os.path.abspath(__file__))
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print('ok  ' if ok else 'FAIL', step, '' if ok else str(detail)[:240], file=sys.stderr)

GET = """(k)=>{location.hash=''; __VIEW.paint(k); document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove());
    let h=document.getElementById('screen').innerHTML;
    h=h.replace(/data-adbox="HERO"[\\s\\S]*?<\\/div><\\/div>/g,'AD').replace(/\\d{1,2}:\\d{2}(:\\d{2})?/g,'T').replace(/SGB_Prototype_v10_[0-9]+\\.html/g,'PROTO').replace(/방문자 키: v-[a-z0-9]+/g,'방문자 키')
     /* v10.27 — 머리줄 종 · 나의공간 「설정 · 알림」은 모든 화면에 있어 그 한 줄만 같게 맞춰 견줍니다(G-196 — 고친 것은 fix_1027_proto 가 봄) */
     .replace(/<span class="bell"[^>]*>/g,'<span class="bell">').replace(/<a href="#" data-(t="알림 정책\(G-03\)이 확정되면 붙입니다\."|go="myntf")>설정 · 알림/g,'<a>설정 · 알림');
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
rec('제목 v10.30 — 앞 판들의 설명은 뒤에 그대로 남음', title.startswith('소개뱅크 시안 v10.30 (2026-10-09 · ') and 'v10.28: ' in title and 'v10.27: ' in title and 'v10.26: ' in title and 'v10.25: ' in title, title[:80])
with sync_playwright() as pw:
    old, e1 = shots(pw, BASE)
    new, e2 = shots(pw, FILES[0])
rec(f'화면 {len(old)}장 → {len(new)}장 — 새 화면 {ADDED} · 없어진 화면 0', set(new) == set(old) | set(ADDED), (len(old), len(new), sorted(set(new) ^ set(old))[:5]))
B64 = re.compile(r'data:image/[a-z]+;base64,[A-Za-z0-9+/=]+')
img = lambda t: B64.sub('IMG', t)
diff = sorted(k for k in old if img(old[k]) != img(new.get(k, '')))
rec(f'앞 판에 있던 {len(old)}장 중 바뀌어야 할 {len(CHANGED)}장만 다르고 나머지는 글자 하나 같음(소개몰의 고친 곳은 겹쳐 뜨는 틀)', set(diff) == CHANGED, (sorted(set(diff) - CHANGED), sorted(CHANGED - set(diff))))
h = new.get('termsv', '')
rec('v10.27 의 「약관 전문」 — 발행 약관 9종 고르기 · 조항 목록(그대로)', '약관 전문' in h and h.count('data-termpick') == 9 and '제1조' in h, h[:120])
h = new.get('admhor', '') + new.get('admhrv', '') + new.get('trmagr', '')
rec('v10.28 새 화면 3장 — 소개몰 주문(SB-ADM-HOR-010) · 리뷰 · 문의(SB-ADM-HRV-010) · 약관 동의 · 재동의(SB-HOM-ETC-022)', all(x in h for x in ('SB-ADM-HOR-010', 'SB-ADM-HRV-010', 'SB-HOM-ETC-022')), '')
left = sorted(k for k in new if re.search(r'소개뱅크몰|소개머니|건강몰', img(new[k])))
rec('새 판의 화면 글자에 옛 이름(소개뱅크몰 · 소개머니 · 건강몰)이 남지 않음', not left, left[:8])
rec('두 관 전용 머리줄 · 바닥줄이 본체에서는 소개광장 5장(v10.23) + 소개장터 메인(list · v10.30 — 10/9 제시 디자인) = 6장에만(소개몰은 겹쳐 뜨는 틀)', sorted(k for k in new if 'class="b2-hd"' in new[k]) == ['cmu', 'cmud', 'cmupoll', 'cmuw', 'commu', 'list'], sorted(k for k in new if 'class="b2-hd"' in new[k]))
rec('두 판 모두 그리는 중 오류 0', not e1 and not e2, (e1[:2], e2[:2]))
raw = diff
ok = sum(1 for r in R if r['ok'])
json.dump({'items': R, 'pass': ok, 'total': len(R), 'changed': diff, 'added': ADDED, 'name_only': []}, open(os.path.join(OUT, 'proto_diff.json'), 'w'), ensure_ascii=False, indent=1)
print(f'통과 {ok} / {len(R)}')
