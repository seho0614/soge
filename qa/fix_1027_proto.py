"""v10.27 시안 결함 수정 확인 — G-196 ~ G-200 (+ G-189 구독 결제 ③).  결과: fix_1027_proto.json
사용: python3 fix_1027_proto.py      PROTO=/path/proto.html (기본: 킷의 spec/proto.html)
"""
import json, os, re, sys
from datetime import datetime, timedelta
from playwright.sync_api import sync_playwright

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
FILE = os.environ.get('PROTO', K + '/spec/proto.html')
OUT = os.environ.get('OUT', os.path.dirname(os.path.abspath(__file__)))
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print('ok  ' if ok else 'FAIL', step, '|', str(detail)[:200], flush=True)
norm = lambda s: re.sub(r'\s+', ' ', s or '').strip()
CLEAN = "document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove()); const sp=document.getElementById('spop'); if(sp) sp.classList.remove('on')"

with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1400, 'height': 1000}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)[:160]))
    pg.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
    pg.goto('file://' + FILE); pg.wait_for_timeout(1500); pg.evaluate(CLEAN)
    scr = lambda: pg.evaluate("window.__VIEW.state.screen")
    def paint(k): pg.evaluate("(k) => { window.__VIEW.paint(k); }", k); pg.wait_for_timeout(250); pg.evaluate(CLEAN)
    def hash_(h): pg.evaluate("(h) => { location.hash = h }", h); pg.wait_for_timeout(400); pg.evaluate(CLEAN)
    def body(): return norm(pg.inner_text('#app'))

    rec('G-200-d 처음 연 창 제목이 「소개몰」이 아님(소개몰은 닫혀 있음)', '소개몰' != pg.title() and '소개뱅크' in pg.title(), pg.title())

    # G-196 알림
    paint('mylik')
    pg.click('a[data-go="myntf"]'); pg.wait_for_timeout(400)
    rec('G-196-1 나의공간 「설정 · 알림」 → 알림 센터(myntf)', scr() == 'myntf', scr())
    for k_ in ('/my/likes', '/login', '/'):
        hash_(k_); bell = pg.locator('#app .bell[data-go="myntf"]')   # 주소로 엶(같은 주소면 hashchange 가 안 나므로)
        if bell.count(): break
    if bell.count():
        bell.first.click(); pg.wait_for_timeout(400)
        rec('G-196-2 머리줄 종(🔔) → 알림 센터', scr() == 'myntf', scr())
    else:
        rec('G-196-2 머리줄 종(🔔) → 알림 센터', False, '종 없음')

    # G-197 화면 키 링크(#mysub …)
    keys = pg.evaluate("Object.keys(window.__VIEW.screens)")
    tried, bad = 0, []
    for k in keys:
        if k.startswith('health'): continue
        try: paint(k)
        except Exception: continue
        links = pg.evaluate("""() => [...document.querySelectorAll('#app a[href^="#"]:not([data-go])')].map(a => a.getAttribute('href'))
                                     .filter(h => h.length > 1 && !h.startsWith('#/'))""")
        for h in sorted(set(links)):
            paint(k)
            tried += 1
            pg.locator(f'#app a[href="{h}"]:not([data-go])').first.click(); pg.wait_for_timeout(250)
            t = h[1:]
            # 검색 칸(#mh-q)은 커서가 가면 검색 창(spop)이 열립니다 — 그것도 「그 칸으로 감」
            ok = (scr() == t) or pg.evaluate("(t) => (document.activeElement && document.activeElement.id === t) || !!document.querySelector('#spop.on')", t)
            pg.evaluate(CLEAN)
            nf = '페이지를 찾을 수 없습니다' in body()
            if not ok or nf: bad.append((k, h, scr()))
    rec(f'G-197 화면 안 「#화면키」 링크 {tried}곳 — 모두 그 화면(또는 그 칸)으로 · 「페이지를 찾을 수 없습니다」 0', tried >= 5 and not bad, bad[:6])

    # G-198 주소 · 단추
    want = {'/my/payment': 'mypaym', '/my/notifications': 'myntf', '/my/subscription/upgrade': 'mysubup', '/my/business': 'mybiz2',
            '/my/intro': 'introhome', '/my/intro/invite': 'introinv', '/my/intro/activity': 'introact', '/deal/7710/review': 'rvw',
            '/admin/main/banner': 'admmain1', '/admin/main/gwan': 'admmain2', '/admin/main/layout': 'admmain3', '/admin/main/content': 'admmain4',
            '/admin/review/rules': 'admrev3', '/admin/review/audit': 'admrev4', '/admin/site-integrations': 'admsit8',
            '/admin/codes': 'admcod', '/admin/badges': 'admbdg', '/admin/billing': 'admbil', '/terms': 'terms'}   # v10.31 — 시안 키 「terms」(약관) 화면이 생겨 #/terms 는 그 화면(약관 전문 termsv 는 그 안에서)
    miss = []
    for path, k in want.items():
        hash_(path)
        if scr() != k or '페이지를 찾을 수 없습니다' in body(): miss.append((path, scr()))
    rec(f'G-198-1 열 수 없던 화면 {len(want)}개 — 주소로 열림', not miss, miss)
    paint('my')
    menu = pg.evaluate("[...document.querySelectorAll('#app [data-go]')].map(x => x.getAttribute('data-go'))")
    need = ['mypaym', 'myntf', 'mysubup', 'mybiz2', 'introhome']
    rec('G-198-2 나의공간 바로가기에 결제 수단 · 알림 · 한도 안내 · 사업자 전환 · 소개 활동', all(x in menu for x in need), [x for x in need if x not in menu])
    paint('adm')
    more = pg.evaluate("[...document.querySelectorAll('[data-adm-more] [data-go]')].map(x => x.getAttribute('data-go'))")
    rec('G-198-3 운영 대시보드 「다른 운영 화면」 — v10.27 의 10개 그대로(v10.28 에서 소개몰 운영 4개를 더함 · 14개)', more[:10] == ['admmain1', 'admmain2', 'admmain3', 'admmain4', 'admrev3', 'admrev4', 'admsit8', 'admcod', 'admbdg', 'admbil'] and len(more) in (10, 14), more)
    paint('mydeal')
    rec('G-198-4 소개 내역 → 「후기 쓰기 ›」', pg.locator('[data-rvw-link]').count() == 1, '')
    pg.click('[data-rvw-link]'); pg.wait_for_timeout(300)
    rec('G-198-5 후기 쓰기 → 후기 작성 화면', scr() == 'rvw', scr())

    # G-199 글 · 숫자
    paint('my')
    side = pg.evaluate("[...document.querySelectorAll('#app [data-go=\"mylst\"], #app [data-go=\"mylik\"]')].map(x => x.innerText)")
    n = pg.evaluate("({l: window.__VIEW && 0})")
    paint('mylst'); lst_rows = pg.locator('#app .lrow').count()
    paint('mylik'); lik_rows = pg.locator('#app tbody tr').count()
    paint('my'); txt = body()
    ok = (f'내 등록 리스팅 {lst_rows}' in txt or re.search(rf'내 등록 리스팅\s*{lst_rows}\b', txt)) and re.search(rf'관심 목록\s*{lik_rows}\b', txt)
    rec(f'G-199-1 나의공간 메뉴 숫자 = 목록 건수(리스팅 {lst_rows} · 관심 {lik_rows})', bool(ok), [s for s in side][:4])
    paint('adm'); tile = norm(pg.locator('#app .tile[data-go="admstl"]').inner_text())
    pg.evaluate("window.__VIEW.state.astl = 'req'"); paint('admstl'); stl = body()
    m = re.search(r'(\d+)건 · 소개비 합계 ([\d,]+원)', stl)
    rec('G-199-2 운영 대시보드 「정산 승인 대기」 = 정산 승인 화면의 건수 · 합계', bool(m) and m.group(1) in tile and m.group(2) in tile, (tile, m.groups() if m else None))
    paint('login'); lg = body()
    rec('G-199-3 로그인 화면 — 「사업자 회원 전용」 · 「개인 회원 가입은 제공하지 않습니다」 없음 · 개인 회원 가입 안내', '사업자 회원 전용' not in lg and '제공하지 않습니다' not in lg and '개인 회원' in lg, lg[:120])
    paint('join'); jn = body()
    rec('G-199-4 가입 1단계 — 「개인 회원 · 가입할 수 없습니다」 줄 없음', '가입할 수 없습니다. 눌러보면' not in jn, '')
    paint('guide'); gd = body()
    rec('G-199-5 이용안내 — 「약관 6종 미확정」 안내 없음 · 약관 이름이 링크', '확정되지 않았습니다' not in gd and pg.locator('#app [data-term]').count() >= 9, pg.locator('#app [data-term]').count())
    pg.locator('#app [data-term="3"]').click(); pg.wait_for_timeout(300)
    rec('G-199-6 약관 이름을 누르면 약관 전문 화면 · 그 약관이 열림', scr() == 'termsv' and '제3자 제공 동의' in norm(pg.locator('[data-terms-body]').inner_text()), scr())
    # 소개몰 — 견본 주문번호 날짜 · 반품 상태 · 바닥줄 약관
    hash_('/health'); pg.wait_for_timeout(800); pg.evaluate(CLEAN)
    o = pg.evaluate("window.__hlt.S.orders.map(o => [o.no, o.at.getFullYear()*10000 + (o.at.getMonth()+1)*100 + o.at.getDate()])")
    rec('G-199-7 소개몰 견본 주문번호의 날짜 = 주문일', all(x[0][1:9] == str(x[1]) for x in o), o)
    dl = pg.evaluate("""() => [...document.querySelectorAll('#hltapp [data-deal-pid]')].map(a => a.getAttribute('data-deal-pid') + '|' + a.innerText.replace(/\\s+/g,' '))""")
    ok8 = len(dl) >= 1
    for x in dl:
        pid, t = x.split('|', 1)
        nm = pg.evaluate("(id) => { const p = window.__hlt.PRODUCTS.find(p => p.id === id); return [p.name, p.sale.toLocaleString('ko-KR') + '원'] }", pid)
        ok8 = ok8 and nm[0] in t and nm[1] in t
    rec('G-199-8 「이번 주 특별 할인」 카드 = 실제 상품 이름 · 판매가(누르면 그 상품)', ok8, dl[:2])
    sno = o[0][0]
    pg.evaluate("(h) => window.__hltMall.go(h)", f'#/my/returns/new?o={sno}'); pg.wait_for_timeout(500); pg.evaluate(CLEAN)
    pg.evaluate("""() => { const r = window.__hlt.S; r.returns.push({ no:'R-TEST', orderNo:'X', at:new Date(), type:'RETURN', typeLabel:'반품', reasonLabel:'단순 변심', status:'REQUESTED', refund:1000, fee:0, items:[] }); }""")
    pg.evaluate("(h) => window.__hltMall.go(h)", '#/my/returns'); pg.wait_for_timeout(500)
    rt = norm(pg.inner_text('#hltapp'))
    rec('G-200-c 취소 · 반품 내역 상태가 한국어(「접수」) — REQUESTED 가 보이지 않음', 'REQUESTED' not in rt and '접수' in rt, rt[:120])
    pg.evaluate("window.__hlt.S.returns.pop()")
    tv = pg.locator('#hltapp [data-termsv]')
    if tv.count():
        tv.first.click(); pg.wait_for_timeout(700)
        rec('G-199-9 소개몰 바닥줄 약관 → 소개몰이 닫히고 약관 전문', scr() == 'termsv' and not pg.evaluate("window.__hltx.isOpen()"), scr())
    else:
        rec('G-199-9 소개몰 바닥줄 약관 → 약관 전문', False, '링크 없음')

    # G-200 매물 수정 · 가입 단계
    paint('mylst')
    first = pg.locator('#app .lrow').nth(1)
    title_ = norm(first.locator('.lnk').inner_text())
    first.locator('button[data-edit]').click(); pg.wait_for_timeout(300)
    val = pg.locator('#app input').first.input_value() if pg.locator('#app input').count() else ''
    rec('G-200-a 내 등록 리스팅 「수정」 → 그 매물의 수정 화면(제목이 그 매물)', scr() == 'reged' and val == title_, (scr(), title_, val))
    paint('join')
    pg.evaluate("window.__VIEW.state.jstep = 3"); paint('join')
    pg.click('#app .jnav .jb.p'); pg.wait_for_timeout(300)
    s3 = pg.evaluate("window.__VIEW.state.jstep")
    rec('G-200-b1 가입 3단계 — 필수 칸이 비면 「다음」이 넘어가지 않음 · 안내', s3 == 3, s3)
    ins = pg.locator('#app .jp .fl input')
    vals = ['김담당', '010-1234-5678', 'kim@example.com', '개발팀', 'Sgb-pass-1234!', 'Sgb-pass-1234!']
    for i in range(min(ins.count(), len(vals))): ins.nth(i).fill(vals[i])
    pg.click('#app .jnav .jb.p'); pg.wait_for_timeout(300)
    rec('G-200-b2 필수 칸을 채우면 4단계로', pg.evaluate("window.__VIEW.state.jstep") == 4, pg.evaluate("window.__VIEW.state.jstep"))
    pg.locator('#app .ag[data-ag="0"]').click(); pg.wait_for_timeout(200)
    pg.click('#app .jnav .jb.p'); pg.wait_for_timeout(300)
    rec('G-200-b3 필수 약관 하나를 끄면 4단계에서 넘어가지 않음', pg.evaluate("window.__VIEW.state.jstep") == 4, pg.evaluate("window.__VIEW.state.jstep"))

    # G-189 구독 결제 ③ — 올리기 · 내리기는 예약(지금 결제 없음)
    paint('mysub')
    pg.evaluate("window.__VIEW.state.screen")
    pick = pg.locator('#app [data-ps="pick"]')
    if pick.count():
        cur = pg.evaluate("window.__PS.state().demoPlan")
        pg.locator('#app [data-ps-demo]').select_option('STANDARD'); pg.wait_for_timeout(300)
        pg.locator('#app [data-ps="pick"][data-plan="PRO"]').click(); pg.wait_for_timeout(300)
        pn = norm(pg.locator('#app [data-ps-panel]').inner_text())
        rec('G-189-P1 시안 — 스탠다드에서 프로로 「올리기 — 예약」 · 지금 결제 없음 · 차액 없음', '올리기 — 예약' in pn and '지금 결제 없음' in pn and '차액' not in pn, pn[:160])
        pg.locator('#app [data-ps-demo]').select_option('BASIC'); pg.wait_for_timeout(300)
        pg.locator('#app [data-ps="pick"][data-plan="STANDARD"]').click(); pg.wait_for_timeout(300)
        pn = norm(pg.locator('#app [data-ps-panel]').inner_text())
        rec('G-189-P2 시안 — 무료에서 처음 유료는 지금 결제(전액 49,000원)', '구독 시작' in pn and '49,000원' in pn, pn[:160])
    else:
        rec('G-189-P 시안 구독 패널', False, '단추 없음')
    # G-116 (10/8 답 「세 화면에도 단추 삭제」) — 베스트매칭 · 사고예방 · 성공현황 위쪽 줄에 소개 버튼 3종 없음 · 줄은 한 칸 · 제목이 다 보임
    G116R = {}
    for w in (1000, 1280, 1920):
        pg.set_viewport_size({'width': w, 'height': 900})
        for k in ('bst', 'saf', 'win', 'urg'):
            paint(k)
            G116R[(w, k)] = pg.evaluate("""()=>{const r=document.querySelector('#screen .rrow.qrow'); if(!r) return null; const h=r.querySelector('h2'); const hb=h.getBoundingClientRect(); const rb=r.getBoundingClientRect();
              return {tabs: !!r.querySelector('.qtabs'), btn: [...r.querySelectorAll('button,a')].filter(e=>/소개받기|소개하기|소개받고 싶어요/.test(e.textContent)).length,
                      noq: r.classList.contains('noq'), title: h.textContent, inside: hb.left >= rb.left - 1 && hb.right <= rb.right + 1, wide: hb.width > 0}}""")
    pg.set_viewport_size({'width': 1280, 'height': 900})
    NM = {'bst': '베스트매칭', 'saf': '사고예방', 'win': '성공현황', 'urg': '급구, 급매'}
    for k in ('bst', 'saf', 'win'):
        rs = [G116R[(w, k)] for w in (1000, 1280, 1920)]
        rec(f'G-116 {NM[k]} — 너비 1000 · 1280 · 1920 모두 소개 버튼 0개 · 줄 한 칸(noq) · 제목 「{NM[k]}」 다 보임',
            all(r and not r['tabs'] and r['btn'] == 0 and r['noq'] and r['title'] == NM[k] and r['inside'] and r['wide'] for r in rs), rs)
    rec('G-116 급구 · 급매(v10.19)와 같은 처리 — 네 화면 모두 같은 한 칸 줄', all(G116R[(1280, k)] and G116R[(1280, k)]['noq'] and not G116R[(1280, k)]['tabs'] for k in NM), {k: G116R[(1280, k)] for k in NM})
    rec('Z 스크립트 오류 0', not errs, errs[:3])
    b.close()

json.dump(R, open(os.path.join(OUT, 'fix_1027_proto.json'), 'w'), ensure_ascii=False, indent=1)
bad = [r for r in R if not r['ok']]
print(f"통과 {len(R) - len(bad)} / {len(R)}")
sys.exit(1 if bad else 0)
