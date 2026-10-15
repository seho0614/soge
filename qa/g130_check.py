"""G-130 시안 확인 — 「상세 · 보기」 단추가 화면을 여는지 · 새 화면 8장이 오류 없이 그려지는지. 사용: python3 g130_check.py [시안 파일] [그림 접두사]"""
import sys, json, os
from playwright.sync_api import sync_playwright
P = sys.argv[1] if len(sys.argv) > 1 else __import__('os').environ.get('PROTO', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb/spec/proto.html')   # v10.31 PROTO
TAG = sys.argv[2] if len(sys.argv) > 2 else ''
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'g130')
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:300]}); print('ok  ' if ok else 'FAIL', step, '' if ok else str(detail)[:240])
CLEAN = "document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove())"
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 900}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)[:160]))
    pg.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
    pg.goto('file://' + P); pg.wait_for_timeout(1500)
    def paint(k):
        pg.evaluate("location.hash=''"); pg.wait_for_timeout(200)      # 주소가 바뀐 뒤의 다시 그리기가 끝난 다음에 그림
        pg.evaluate("k=>__VIEW.paint(k)", k); pg.wait_for_timeout(300); pg.evaluate(CLEAN)
    def toast(): return pg.evaluate("(document.getElementById('toast')||{}).className||''").find('on') >= 0
    def cur(): return pg.evaluate("__VIEW.state.screen")
    def shot(name):
        if TAG: pg.screenshot(path=os.path.join(OUT, f'{TAG}_{name}.png'))
    # 1 사고예방 → 가이드
    paint('saf'); shot('saf')
    pg.locator('#screen button.hotb').click(); pg.wait_for_timeout(500)
    rec('G130-1 사고예방 「사기 예방 가이드 더보기 ›」 → 사기 예방 가이드(safgd)', cur() == 'safgd' and pg.locator('[data-sgd-page]').count() == 1, cur()); shot('safgd')
    n = pg.locator('[data-sgd-sec]').count()
    rec('G130-1b 가이드 — 유형 5종 · 거래 전 확인 · 소개뱅크가 하는 일 · 신고 단계', n == 5 and '소개뱅크 계좌로 보내라는 요구는 사기' in pg.inner_text('#screen'), n)
    pg.locator('[data-sgdpick="c2"]').click(); pg.wait_for_timeout(300)
    rec('G130-1c 가이드 유형 칩 「대금사기」 → 그 유형만', pg.locator('[data-sgd-sec]').count() == 1 and pg.locator('[data-sgd-sec="c2"]').count() == 1, pg.locator('[data-sgd-sec]').count())
    paint('saf'); pg.evaluate("document.querySelector('#screen button.gd2.c4').click()"); pg.wait_for_timeout(500)
    rec('G130-1d 사고 유형 카드(개인정보/보이스피싱) → 가이드의 그 유형', cur() == 'safgd' and pg.locator('[data-sgd-sec="c4"]').count() == 1 and pg.locator('[data-sgd-sec]').count() == 1, cur())
    # 2 정책 상세 → 공고 원문(누른 공고)
    pg.evaluate("location.hash='#/biz/policy/9302'") ; pg.wait_for_timeout(600)
    if cur() != 'bpol':
        pg.goto('file://' + P + '#/policy/9302'); pg.wait_for_timeout(1200)
    t0 = pg.inner_text('#screen h2.dtt') if pg.locator('#screen h2.dtt').count() else ''
    pg.locator('#screen [data-axsrc]').click(); pg.wait_for_timeout(700); pg.evaluate(CLEAN)
    rec('G130-2 정책 상세 「원문 공고 보기」 → 그 공고의 원문(bpolsrc · 같은 제목)', cur() == 'bpolsrc' and pg.locator('[data-bpolsrc]').count() == 1 and t0 and t0 in pg.inner_text('#screen'), (cur(), t0)); shot('bpolsrc')
    # 3 파트너 알림 보기
    paint('ptnnoti'); pg.evaluate("__VIEW.state.ntab='alarm'"); paint('ptnnoti')
    btns = pg.locator('#screen .lact button'); res = []
    for i in range(btns.count()):
        paint('ptnnoti'); pg.evaluate("__VIEW.state.ntab='alarm'"); paint('ptnnoti')
        b2 = pg.locator('#screen .lact button').nth(i); b2.click(); pg.wait_for_timeout(400)
        res.append((cur(), pg.evaluate("__VIEW.state.ntab")))
    want = [('ptnlead', 'alarm'), ('ptnsvc', 'alarm'), ('ptncash', 'alarm'), ('ptnstl', 'alarm'), ('ptnnoti', 'notice')]
    rec('G130-3 파트너 알림 「보기」 5건 → 리드 · 검수 · 리드 이용료 · 정산 화면 · 공지는 공지 탭', res == want, res)
    # 4 감사 기록 · 5 대상 보기 · 6 양식 전문 · 7 파트너사 상세
    for src, sel, dst, nm in [('admaud', 'button[data-go="admaudl"]', 'admaudl', '감사 「기록 보기」 → 감사 기록'), ('admseg', 'button[data-go="admsegp"]', 'admsegp', '성향 학습 「대상 보기」 → 옮길 대상 미리보기'),
                              ('myctrd', 'button[data-go="ctrform"]', 'ctrform', '계약서 · 체결 「양식 전문 보기」 → 계약서 양식 전문')]:
        paint(src); pg.locator('#screen ' + sel).click(); pg.wait_for_timeout(500); pg.evaluate(CLEAN)
        rec('G130-4 ' + nm, cur() == dst, cur()); shot(dst)
    txt = pg.inner_text('#screen') if cur() == 'ctrform' else ''
    rec('G130-4b 양식 전문 = DB 의 INTRO_STD 1.0 글(제1조 ~ 제8조 · 표)', all(f'제{i}조' in txt for i in range(1, 9)) and '변호사법 109조' in txt and pg.locator('#screen .ctf table').count() == 2, len(txt))
    paint('admptn'); det = pg.locator('#screen button[data-go="admptnd"]'); ids = []
    for i in range(det.count()):
        paint('admptn'); d2 = pg.locator('#screen button[data-go="admptnd"]').nth(i); want_id = d2.get_attribute('data-ptnid'); d2.click(); pg.wait_for_timeout(400); pg.evaluate(CLEAN)
        ids.append((want_id, pg.get_attribute('[data-ptn-detail]', 'data-ptn-detail') if pg.locator('[data-ptn-detail]').count() else None))
        if i == 2: shot('admptnd')
    rec(f'G130-5 파트너사 목록 「상세」 {len(ids)}건 → 누른 파트너사의 상세', len(ids) == 6 and all(a == b for a, b in ids), ids)
    # 8 광고 → 랜딩
    paint('airec'); cta = pg.locator('#screen [data-ad="cta"]')
    hit = None
    for i in range(cta.count()):
        paint('airec'); c = pg.locator('#screen [data-ad="cta"]').nth(i)
        aid = c.get_attribute('data-adid'); c.click(); pg.wait_for_timeout(400)
        if cur() == 'adland': hit = aid; break
    rec('G130-6 AI 추천 결과 광고(랜딩 주소 없는 소재) → 광고주 랜딩 미리보기', hit is not None and pg.locator(f'[data-adland="{hit}"]').count() == 1, (hit, cur())); shot('adland')
    # 9 소개몰(겹쳐 뜨는 틀 — 안의 주소는 __hltMall 이 다룸)
    pg.goto('file://' + P + '#/health'); pg.wait_for_timeout(1500); pg.evaluate(CLEAN)
    def mgo(h): pg.evaluate("h=>window.__hltMall.go(h)", h); pg.wait_for_timeout(600); pg.evaluate(CLEAN)
    route = lambda: pg.evaluate("JSON.stringify(window.__hltMall.route())")
    NO = pg.evaluate("(window.__hlt.S.orders.filter(o=>o.status==='DELIVERED')[0]||window.__hlt.S.orders[0]).no")
    mgo('/my/orders/' + NO + '/track')
    pg.locator('#hltapp #btnCarrier').click(); pg.wait_for_timeout(600)
    rec('G130-7 소개몰 배송 조회 「택배사에서 보기」 → 택배사 조회 미리보기(SB-HLT-MYO-040)', route().endswith('/track/carrier"') and pg.locator('#hltapp [data-carrier]').count() == 1, route()); shot('carrier')
    pg.locator('#hltapp [data-carrier] button[data-go$="/track"]').click(); pg.wait_for_timeout(500)
    rec('G130-7b 택배사 조회 「← 배송 조회」 → 배송 조회로', route().endswith('/track"'), route())
    mgo('/my/orders/' + NO)
    selfb = pg.evaluate("[...document.querySelectorAll('#hltapp button')].filter(b=>b.textContent.trim()==='상세보기').length")
    rec('G130-8 소개몰 주문 상세 안에 자기 자신으로 가는 「상세보기」 없음', selfb == 0 and route().endswith(NO + '"') and pg.locator('#hltapp .hlt-btns').count() >= 1, (selfb, route()))
    mgo('/my/orders')
    lst = pg.evaluate("[...document.querySelectorAll('#hltapp button')].filter(b=>b.textContent.trim()==='상세보기').length")
    rec('G130-8b 주문 내역(목록)에는 「상세보기」 그대로', lst >= 1, lst)
    mgo('/p/p01')
    pg.evaluate("document.getElementById('toast') && document.getElementById('toast').classList.remove('on'); var h=document.getElementById('hlttoast'); if(h) h.innerHTML=''")
    pg.locator('#hltapp [data-tab="detail"]').click(); pg.wait_for_timeout(500)
    shown = pg.evaluate("[...document.querySelectorAll('#toast.on, #hlttoast .hlt-toast')].map(x=>x.innerText).join(' | ')")
    rec('G130-9 소개몰 상품의 이미 열린 「상세 설명」 탭을 다시 누르면 「지금 보고 있는 «상세 설명»입니다」(「시안은 표시만 바꿉니다」가 아님)', '지금 보고 있는' in shown and '시안은 표시만' not in shown, shown)
    dev = {}
    for k in ('bpolsrc', 'adland', 'admsegp', 'safgd', 'ctrform', 'admptnd', 'admaudl'):
        if k == 'adland': pg.evaluate("__VIEW.state.adCr={id:'AD-110',adv:'시험 광고주',cat:'부동산',t:'제목',b:'본문',cta:'매물 보기'}")
        paint(k); dev[k] = pg.locator('#screen [data-devstate="개발중"]').count()
    rec('G130-10 시안에만 있는 화면(공고 원문 · 광고주 랜딩 · 옮길 대상)은 「개발중」 표시 · 실제 웹에 있는(또는 반영하는) 화면은 표시 없음',
        all(dev[k] == 1 for k in ('bpolsrc', 'adland', 'admsegp')) and all(dev[k] == 0 for k in ('safgd', 'ctrform', 'admptnd', 'admaudl')), dev)
    rec('Z 스크립트 오류 0', not errs, errs[:3])
    b.close()
json.dump(R, open(os.path.join(OUT, 'g130_check.json'), 'w'), ensure_ascii=False, indent=1)
print(f"통과 {sum(r['ok'] for r in R)} / {len(R)}")
