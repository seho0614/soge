"""v10.25 소개몰(쇼핑몰) — 시안 점검. 결과: proto_mall.json

  N. 이름       머리줄 메뉴 「소개몰」 · 화면에 보이는 글자에 「소개뱅크몰」이 남지 않음
  H. 머리 · 바닥 소개몰은 두 관 전용 머리줄 · 바닥줄(회원가입 초록) · 소개광장은 주황 그대로 · 다른 관은 그대로
  M. 메인       사진 띠 · 성분 10 · 고민 10 · 성분별 최저가 8 · 오늘의 건강상품(큰 띠 + 순위 5 · 탭 3) · 많이 찾는 6 · 새로 올라온 4 · 특별 할인 6 · 아래 띠 — 그림의 값
  L. 누르기     타일 · 카드 · 전체보기 · 검색 · 탭이 모두 반응(무반응 0) · 간 곳이 누른 것과 맞음
  P. 그림       넣은 조각이 받은 그림에서 손실 없이 자른 파일과 바이트까지 같음
  S. 하위 화면  소개몰의 다른 화면도 새 머리줄 · 본문은 그대로
  Z. 좁은 화면 · 스크립트 오류

사용:  python3 proto_mall.py     PROTO=/path/proto.html (기본: 킷의 spec/proto.html)
"""
import base64, json, os, re, sys
from playwright.sync_api import sync_playwright

# v10.27 (G-199) — 시안의 견본 주문번호는 주문일(7일 · 12일 전)을 따릅니다(전: H20260908-000041 고정)
from datetime import datetime as _dt, timedelta as _td
SNO41 = 'H' + (_dt.now() - _td(days=7)).strftime('%Y%m%d') + '-000041'
SNO18 = 'H' + (_dt.now() - _td(days=12)).strftime('%Y%m%d') + '-000018'

_kit = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sgb')
K = os.environ.get('KIT') or (_kit if os.path.isdir(os.path.join(_kit, 'spec')) else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
FILE = os.environ.get('PROTO', K + '/spec/proto.html')
OUT = os.path.dirname(os.path.abspath(__file__))
CUT = os.environ.get('CUT', os.path.join(OUT, 'mall_cut'))
SHOT = os.environ.get('SHOT', '')
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print('ok  ' if ok else 'FAIL', step, '' if ok else str(detail)[:260], file=sys.stderr)
norm = lambda s: re.sub(r'\s+', ' ', s or '').strip()
GREEN = 'rgb(23, 163, 74)'; NAVY = 'rgb(0, 36, 90)'
CLEAN = "document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove())"
MALL = """() => { const app = document.getElementById('hltapp'), host = document.getElementById('hlthost'); const q = s => app.querySelector(s), qa = s => [...app.querySelectorAll(s)];
  const t = e => e ? (e.innerText || '').replace(/\\s+/g, ' ').trim() : ''; const cs = e => e ? getComputedStyle(e) : {};
  const main = q('main'); const cur = q('header.b2-hd nav a[aria-current=page]');
  return { open: host.classList.contains('on'), screen: main ? main.getAttribute('data-screen') : null, mainCls: main ? main.className : null, route: window.__hltMall && window.__hltMall.route ? window.__hltMall.route() : null,
    b2: !!q('header.b2-hd'), oldhd: !!q('header.hd'), ft: !!q('footer.b2-ft'), hltft: !!q('footer.hlt-ft'), cur: cur ? cur.textContent.trim() : null, join: cs(q('header.b2-hd .b2-join')).backgroundColor || null,
    nav: qa('header.b2-hd nav a').map(a => a.textContent.trim()), h1: t(q('.shop-hero h1')), find: !!q('.shop-find input[name=q]'),
    ing: qa('[data-shop-ing] .shop-tile').map(a => [t(a), a.getAttribute('data-go')]), con: qa('[data-shop-con] .shop-tile').map(a => [t(a), a.getAttribute('data-go')]),
    low: qa('[data-shop-low] .shop-lowc').map(t), tabs: qa('.shop-tabs button').map(b => [t(b), b.getAttribute('aria-selected')]), rank: qa('.shop-rank li').map(t), basis: t(q('[data-basis]')),
    promo: t(q('[data-shop-promo]')), many: qa('[data-shop-many] .shop-many a').map(t), neu: qa('[data-shop-new] .shop-newc').map(t), deal: qa('[data-shop-deal] .shop-dealc').map(t), band: t(q('[data-shop-band]')),
    titles: qa('.shop-sec h2').map(t), tcol: cs(q('.shop-sec h2')).color || null, lnav: qa('.shop-lnav a').map(a => [t(a), a.getAttribute('data-go')]),
    pics: qa('.shop-pic img').length, broken: qa('.shop-pic img').filter(i => !i.naturalWidth).length, txt: t(app), sw: document.documentElement.scrollWidth, iw: innerWidth } }"""


def main():
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 1000}); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)[:160]))
        pg.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
        def go(h, w=900):
            pg.goto('file://' + FILE + h); pg.wait_for_timeout(w); pg.evaluate(CLEAN)
            pg.evaluate("document.querySelectorAll('.spop.on').forEach(e=>e.classList.remove('on'))")   # v10.31 — 돋보기는 검색 팝업(#spop)을 엶 · 주소만 바뀌면 열린 채로 남음
        def shot(n):
            if SHOT: os.makedirs(SHOT, exist_ok=True); pg.screenshot(path=f'{SHOT}/{n}.png', full_page=False)
        def home(w=250):       # 소개몰은 겹쳐 뜨는 틀이라 안에서 옮겨 다녀도 주소(#/health)는 그대로입니다 — 메인으로 되돌릴 때는 틀에 직접 말합니다
            if pg.evaluate("location.hash") != '#/health': go('#/health', 700)
            pg.evaluate("window.__hltMall.home()"); pg.wait_for_timeout(w); pg.evaluate(CLEAN)
        go('#/', 1500)
        # ── N ──
        nav = [norm(x) for x in pg.locator('#screen header nav a, #screen header .gnb a').all_inner_texts()]
        rec('N-1 메인의 머리줄 메뉴에 「소개몰」이 있고 「소개뱅크몰」은 없음', '소개몰' in nav and '소개뱅크몰' not in nav, nav)
        left = pg.evaluate("""() => { const out = []; for (const k of Object.keys(__VIEW.screens)) { location.hash = ''; __VIEW.paint(k); if ((document.getElementById('screen').innerText || '').includes('소개뱅크몰')) out.push(k); } return out }""")
        rec('N-2 시안의 모든 화면(본체)에 보이는 글자로 「소개뱅크몰」이 남지 않음', not left, (len(left), left[:8]))
        # N-3 — 옛 이름 정리(10/7 답 「약관까지 같이 고침」): 소개머니(→ 소개장터) · 건강몰(→ 소개몰) · 옛 뜻의 소개몰(= 안심소개 → 안심소개)
        old = pg.evaluate("""() => { const out = {money: [], gm: [], mal: []}; const OLD = /(부동산|장비|양도인|매도인|축A|2축|고정자산|급매|공인중개|등기|검수자|업체가)/;
            for (const k of Object.keys(__VIEW.screens)) { location.hash = ''; __VIEW.paint(k); const sc = document.getElementById('screen'); const c = sc.cloneNode(true); c.querySelectorAll('header').forEach(h => h.remove());
              const t = c.innerText || c.textContent || ''; if (t.includes('소개머니')) out.money.push(k); if (t.includes('건강몰')) out.gm.push(k);
              for (const m of t.matchAll(/[^.\\n]{0,24}소개몰[^.\\n]{0,24}/g)) if (OLD.test(m[0])) { out.mal.push(k + ': ' + m[0].trim().slice(0, 50)); break; } }
            return out }""")
        rec('N-3 본체 화면의 보이는 글자에 옛 이름이 남지 않음 — 「소개머니」 0 · 「건강몰」 0 · 안심소개를 뜻하던 「소개몰」(부동산 · 장비 · 양도인 … 과 함께 쓰인 것) 0', not old['money'] and not old['gm'] and not old['mal'], {k: (len(v), v[:4]) for k, v in old.items()})

        # ── H · M ── 소개몰 메인
        go('#/health', 1600); m = pg.evaluate(MALL)
        rec('H-1 소개몰이 열림 · 두 관 전용 머리줄 · 바닥줄(옛 머리줄 없음) · 지금 메뉴 표시가 「소개몰」', m['open'] and m['b2'] and not m['oldhd'] and m['ft'] and m['cur'] == '소개몰' and '소개뱅크몰' not in m['nav'], {k: m[k] for k in ('open', 'b2', 'oldhd', 'ft', 'cur', 'nav')})
        rec('H-2 회원가입 단추가 그림대로 초록(#17A34A)', m['join'] == GREEN, m['join'])
        nt = pg.evaluate("[...document.querySelectorAll('#hltapp footer.b2-ft [data-notice]')].map(e => [e.getAttribute('data-notice'), (e.innerText || '').replace(/\\s+/g, ' ').trim()])")
        rec('H-3b 소개몰의 바닥 고지 — 두 고지를 같이(10/7 답): 「소개몰 직판 상품 … 소개뱅크가 직접 판매」 + 「… 통신판매중개자이며 당사자가 아닙니다」',
            [x[0] for x in nt] == ['direct', 'inter'] and '직접 판매' in nt[0][1] and '소개몰' in nt[0][1] and '통신판매중개자' in nt[1][1] and '직접 판매' not in nt[1][1], nt)
        rec('H-3 소개몰의 고지(이용안내 · 청약철회 · 판매자 정보)가 바닥에 남아 있음', m['hltft'] and '청약철회' in m['txt'] and '사업자등록번호' in m['txt'], m['hltft'])
        # H-3d — 바닥이 두 겹으로 쌓이지 않음: 통신판매중개자 고지 · 사업자등록번호가 한 번씩만(전에는 소개몰의 옛 바닥 + 새 바닥줄이 같이 나와 고지가 두 번 · 사업자 정보가 두 번 · 호스팅 표기가 서로 달랐음)
        dup = pg.evaluate("""() => { const a = document.getElementById('hltapp'); const t = [...a.querySelectorAll('footer')].map(f => f.innerText).join(' ');
            return { inter: (t.match(/통신판매중개자/g) || []).length, biz: (t.match(/429-88-01533/g) || []).length, blank: t.includes('[\u3000'), host: /호스팅 Amazon Web Services/.test(t),
                     guide: !!a.querySelector('footer [data-go="#/guide"]'), adm: !!a.querySelector('footer .hlt-admin-link a') } }""")
        rec('H-3d 소개몰 바닥이 두 겹으로 겹치지 않음 — 통신판매중개자 고지 1번 · 사업자등록번호 1번 · 빈칸 표기(호스팅 제공자 [ ]) 없음 · 「이용안내 · 청약철회」 「관리자 · 수집관리 시안 열기」는 그대로',
            dup == {'inter': 1, 'biz': 1, 'blank': False, 'host': True, 'guide': True, 'adm': True}, dup)
        rec('M-1 사진 띠 — 「믿을 수 있는 건강 상품, 소개몰에서 만나보세요.」 · 검색 칸이 실제 입력칸 · 화면 폭 전체', '믿을 수 있는 건강 상품' in m['h1'] and '소개몰에서 만나보세요' in m['h1'] and m['find'] and m['mainCls'] == 'shop' and m['screen'] == 'SB-HLT-HUB-010', (m['h1'], m['mainCls']))
        rec('M-2 성분으로 찾기 10 — 비타민 · 유산균 · 오메가 3 · 루테인 · 마그네슘 · 콜라겐 · 홍삼 · 밀크씨슬 · 단백질 · 칼슘', [x[0] for x in m['ing']] == ['비타민', '유산균', '오메가 3', '루테인', '마그네슘', '콜라겐', '홍삼', '밀크씨슬', '단백질', '칼슘'], m['ing'])
        rec('M-3 고민으로 찾기 10 — 면역력 · 눈건강 · 혈행,혈압 · 장 건강 · 간 건강 · 뼈, 관절 · 피부, 미용 · 다이어트 · 남성 건강 · 여성 건강', [x[0] for x in m['con']] == ['면역력', '눈건강', '혈행,혈압', '장 건강', '간 건강', '뼈, 관절', '피부, 미용', '다이어트', '남성 건강', '여성 건강'], m['con'])
        # v10.27 (10/8 「실제상품값으로」) — 카드 값은 그 성분의 판매 중인 실제 상품(한 달 단가가 가장 낮은 것). 값이 맞는지는 R-1 이 상품 자료와 대조
        rec('M-4 성분별 최저가 8장 — 첫 장 「비타민C · N원 / 30일 · 정상가 · 성분 함량」 · 끝 장 밀크씨슬', len(m['low']) == 8 and all(w in m['low'][0] for w in ('비타민C', '원 / 30일', '정상가')) and '밀크씨슬' in m['low'][7] and '원 / 30일' in m['low'][7], m['low'][:1])
        rec('M-5 오늘의 건강상품 — 큰 띠(비타민C 특가전 · 「견본 문구」 표시) + 탭 3개(실시간 인기가 켜짐) + 순위 5줄(1위 = 비타민C 의 실제 상품 메가바이탈 비타민C 3000 · 14,700원 · 60%) + 산출 근거 한 줄',
            '비타민C 특가전' in m['promo'] and '견본 문구' in m['promo'] and [x[0] for x in m['tabs']] == ['실시간 인기', '새로 올라온 상품', '많이 찾는 상품'] and m['tabs'][0][1] == 'true'
            and len(m['rank']) == 5 and all(w in m['rank'][0] for w in ('1', '메가바이탈 비타민C 3000', '14,700원', '60%')) and '근거' in m['basis'], (m['tabs'], m['rank'][:1], m['basis']))
        rec('M-6 많이 찾는 상품 6 · 새로 올라온 상품 4(별점) · 이번 주 특별 할인 6(할인가 · 정상가 · 할인율 · 별점)', len(m['many']) == 6 and len(m['neu']) == 4 and '(' in m['neu'][0] and len(m['deal']) == 6
            # v10.27 (10/8 「실제 상품값으로」) — 특별 할인 카드는 그 성분의 실제 상품(비타민C → 메가바이탈 비타민C 3000 · 14,700원 · 정가 36,750원 · 60% · 4.7 · 495)
            and all(w in m['deal'][0] for w in ('비타민C 3,000mg', '메가바이탈 비타민C 3000', '14,700원', '36,750원', '60%', '4.7', '495')), (m['many'][:1], m['neu'][:1], m['deal'][:1]))
        import re as _re
        bad = []
        for d in m['deal']:
            mm = _re.search(r'([\d,]+)원 ?([\d,]+)원 ?(\d+)%', d)
            if not mm or round((1 - int(mm.group(1).replace(',', '')) / int(mm.group(2).replace(',', ''))) * 100) != int(mm.group(3)): bad.append(d[:50])
        rec('M-7 특별 할인 6장의 할인율이 두 값에서 계산한 값과 같음(그림의 콜라겐 카드는 28,000원 · 40% 로 맞지 않아 정상가를 38,000원으로 넣음)', len(m['deal']) == 6 and not bad, bad)
        rec('M-8 구역 제목 8개 · 남색(#00245A) · 아래 띠 「건강한 선택, 소개몰과 함께하세요」', m['titles'] == ['성분으로 찾기', '고민으로 찾기', '성분별 최저가', '오늘의 건강상품', '많이 찾는 상품', '새로 올라온 상품', '이번 주 특별 할인', '도매 · 납품 매물'] and m['tcol'] == NAVY and '소개몰과 함께하세요' in m['band'], (m['titles'], m['tcol']))
        rec('M-9 그림 조각이 모두 뜸(깨진 그림 0) · 가로 넘침 없음', m['pics'] >= 50 and m['broken'] == 0 and m['sw'] <= m['iw'], (m['pics'], m['broken'], m['sw'], m['iw']))
        rec('M-10 작은 메뉴 줄 — 직판관 · 전체제품 · 이용안내(청약철회) · 내 주문 · 장바구니', {'#/direct', '#/guide', '#/my/orders', '#/cart'} <= {x[1] for x in m['lnav']}, m['lnav'])
        shot('proto_mall_main')

        # ── L ── 누르기
        pg.locator('#hltapp .shop-tabs button', has_text='많이 찾는 상품').click(); pg.wait_for_timeout(200); m2 = pg.evaluate(MALL)
        rec('L-1 순위 탭 「많이 찾는 상품」 → 그 탭이 켜지고 순위가 바뀜(2위 = 유산균의 실제 상품)', m2['tabs'][2][1] == 'true' and m2['tabs'][0][1] == 'false' and '유산균' in m2['rank'][1] and m2['screen'] == 'SB-HLT-HUB-010', (m2['tabs'], m2['rank'][:2]))
        # v10.27 R-1 — 메인 카드(최저가 · 순위 · 많이 찾는 · 새로 올라온 · 특별 할인)의 이름 · 값이 그 상품 자료와 같고, 누르면 그 상품
        chk = pg.evaluate("""() => { const H = window.__hlt, P = id => H.PRODUCTS.find(p => p.id === id), bad = [], n = {};
          for (const k of ['low','rank','many','new','deal']) for (const a of document.querySelectorAll('#hltapp [data-' + k + '-pid]')) {
            const p = P(a.getAttribute('data-' + k + '-pid')), t = a.innerText.replace(/\\s+/g, ' '); n[k] = (n[k] || 0) + 1;
            const want = k === 'low' ? [p.ingName, p.list.toLocaleString('ko-KR') + '원'] : [p.name || '', p.sale.toLocaleString('ko-KR') + '원'];
            if (!want.every(w => t.includes(w)) || a.getAttribute('data-go') !== '#/p/' + p.id) bad.push(k + ':' + p.id + ' ' + t.slice(0, 60)); }
          return { n, bad }; }""")
        rec('R-1 메인 카드 = 판매 중인 실제 상품(이름 · 값 · 누르면 그 상품) — 최저가 · 순위 · 많이 찾는 · 새로 올라온 · 특별 할인', not chk['bad'] and all(chk['n'].get(k, 0) >= 3 for k in ('low', 'rank', 'many', 'deal')), chk)
        dead = []; went = []
        n_all = pg.locator('#hltapp main.shop [data-go]').count()
        for i in range(n_all):
            home(120)
            el = pg.locator('#hltapp main.shop [data-go]').nth(i); want = el.get_attribute('data-go'); lab = norm(el.inner_text())[:20]
            el.click(); pg.wait_for_timeout(120 if want.startswith('#') else 450); a = pg.evaluate(MALL)
            if not want.startswith('#'):      # 본체의 화면 열쇠(도매 · 납품 매물 → 전체 목록) — 소개몰이 닫히고 본체의 그 화면이 떠야 합니다
                scr = pg.evaluate("__VIEW.state.screen")
                (went if (not a['open'] and scr == want) else dead).append((lab, want, a['open'], scr)); continue
            if a['route'] != want or a['screen'] in (None, 'SB-HLT-HUB-010') or any(w in a['txt'] for w in ('없는 주소입니다', '없는 성분입니다', '없는 고민입니다', '없는 카테고리입니다', '없는 상품입니다')): dead.append((lab, want, a['route'], a['screen']))
            else: went.append((lab, want, a['screen']))
        rec(f'L-2 메인에서 누를 수 있는 것 {n_all}개를 하나씩 — 모두 제 곳으로 감(무반응 0 · 없는 주소 0)', n_all >= 50 and not dead, dead[:4])
        home(); pg.fill('#hltapp .shop-find input', '루테인'); pg.press('#hltapp .shop-find input', 'Enter'); pg.wait_for_timeout(250); a = pg.evaluate(MALL)
        rec('L-3 사진 띠의 검색 「루테인」 → 검색 화면(SB-HLT-CAT-020) · 결과에 루테인', a['screen'] == 'SB-HLT-CAT-020' and '루테인' in a['txt'], (a['screen'], a['route']))
        home(); pg.locator('#hltapp header.b2-hd nav a', has_text='소개광장').click(); pg.wait_for_timeout(500)
        st = pg.evaluate("({ hash: location.hash, open: document.getElementById('hlthost').classList.contains('on'), plz: !!document.querySelector('#screen .plz') })")
        rec('L-4 소개몰 머리줄의 「소개광장」 → 소개몰이 닫히고 소개광장으로', st['hash'] == '#/community' and not st['open'] and st['plz'], st)
        nt2 = pg.evaluate("[...document.querySelectorAll('#screen footer.b2-ft [data-notice]')].map(e => e.getAttribute('data-notice'))")
        rec('L-4b 소개광장의 바닥 고지는 통신판매중개자 고지 하나 그대로(직판 고지는 소개몰에서만)', nt2 == ['inter'], nt2)
        jc = pg.evaluate("getComputedStyle(document.querySelector('#screen header.b2-hd .b2-join')).backgroundColor")
        pg.locator('#screen header.b2-hd nav a', has_text='소개몰').click(); pg.wait_for_timeout(600); a = pg.evaluate(MALL)
        rec('L-5 소개광장의 회원가입은 주황(#F5A008) 그대로 · 그 머리줄의 「소개몰」 → 소개몰 메인', jc == 'rgb(245, 160, 8)' and a['open'] and a['screen'] == 'SB-HLT-HUB-010', (jc, a['open'], a['screen']))

        # ── P ── 그림
        art = pg.evaluate("window.__SHOP_ART || {}"); man = json.load(open(os.path.join(OUT, 'mall_assets.json'), encoding='utf-8'))['parts']; badp = []
        for n, a in man.items():
            f = os.path.join(CUT, a['file'])
            if n not in art or not os.path.exists(f) or base64.b64decode(art[n].split(',', 1)[1]) != open(f, 'rb').read(): badp.append(n)
        rec(f'P-1 넣은 그림 조각 {len(man)}개 — 받은 그림에서 손실 없이 자른 파일과 바이트까지 같음', len(art) == len(man) == 53 and not badp, badp[:5])

        # ── S ── 하위 화면
        bads = []
        for h_, key in (('#/ingredients', 'SB-HLT-CAT-030'), ('#/concerns', 'SB-HLT-CAT-050'), ('#/direct', 'SB-HLT-HUB-020'), ('#/i/VITC', 'SB-HLT-CAT-040'), ('#/w/IMMUNE', 'SB-HLT-CAT-060'), ('#/p/p01', 'SB-HLT-PRD-010'), ('#/cart', 'SB-HLT-CRT-010'), ('#/guide', 'SB-HLT-ETC-010')):
            home(100); pg.evaluate("(h) => window.__hltMall.go(h)", h_); pg.wait_for_timeout(150); a = pg.evaluate(MALL)
            if a['screen'] != key or not a['b2'] or a['oldhd'] or a['mainCls'] != 'hlt-wrap' or a['cur'] != '소개몰' or '소개뱅크몰' in a['txt']: bads.append((h_, a['screen'], a['b2'], a['mainCls'], a['cur']))
            if SHOT and h_ in ('#/p/p01', '#/ingredients'): shot('proto_mall_' + h_.strip('#/').replace('/', '_'))
        rec('S-1 소개몰의 다른 화면 8곳 — 새 머리줄 · 본문 틀은 그대로(1200px) · 글자에 「소개뱅크몰」 없음', not bads, bads[:3])
        gm = []
        for h_ in ('#/', '#/direct', '#/search', '#/cart', '#/order', '#/order/pay', '#/order/done', '#/order/fail', '#/guide', '#/ingredients', '#/concerns', '#/my/addresses', '#/my/returns', '#/my/returns/new', '#/my/orders', '#/c/HLT_FOOD', '#/i/VITC', '#/w/IMMUNE', '#/p/p01', '#/nope'):
            pg.evaluate("(h) => window.__hltMall.go(h)", h_); pg.wait_for_timeout(80)
            t_ = pg.evaluate("document.getElementById('hltapp').innerText + ' ' + document.title")
            if '건강몰' in t_ or '소개뱅크몰' in t_: gm.append((h_, t_[max(0, t_.find('건강몰') - 12):t_.find('건강몰') + 16].replace('\n', ' ')))
        rec('S-2 소개몰의 화면 20곳(없는 주소 포함) — 글자 · 창 제목에 옛 이름 「건강몰」 · 「소개뱅크몰」이 남지 않음(전에는 경로 줄 · 창 제목이 「건강몰」)', not gm, gm[:4])

        # S-3 — 없는 주소 화면에도 바닥줄(사업자 정보 · 두 고지)이 그대로 — 소개몰의 옛 바닥을 얇게 줄였기 때문에 새 바닥줄이 빠지면 법정 표시가 없어집니다
        pg.evaluate("(h) => window.__hltMall.go(h)", '#/nope'); pg.wait_for_timeout(150)
        nf = pg.evaluate("""() => { const a = document.getElementById('hltapp'); const t = [...a.querySelectorAll('footer')].map(f => f.innerText).join(' ');
            return { nt: [...a.querySelectorAll('footer.b2-ft [data-notice]')].map(e => e.getAttribute('data-notice')), biz: (t.match(/429-88-01533/g) || []).length, home: !!a.querySelector('main [data-go="#/"]') } }""")
        rec('S-3 없는 주소 화면 — 바닥줄의 두 고지 · 사업자등록번호 1번 · 「소개몰 홈」 단추', nf == {'nt': ['direct', 'inter'], 'biz': 1, 'home': True}, nf)
        home(150); tt = pg.evaluate("document.title")
        rec('S-4 소개몰 메인의 창 제목이 「소개몰」 한 번(「소개몰 · 소개몰」처럼 겹치지 않음)', tt == '소개몰', tt)

        # S-5 — 소개몰 화면의 글자에 「undefined」 · 「NaN」이 없음(전에는 장바구니 · 주문서 · 내 주문 · 취소/반품의 작은 상품 그림 자리에 「undefined」가 글자로 찍혔음 — 상품에 그림 글자 값이 없는데 그대로 이어 붙임)
        pg.evaluate("window.__hlt.addToCart('p01', 0)"); ud = []; ths = {}
        for h_ in ('#/', '#/direct', '#/search', '#/cart', '#/order', '#/order/pay', '#/order/done', '#/order/fail', '#/guide', '#/ingredients', '#/concerns', '#/my/addresses', '#/my/returns', '#/my/returns/new', '#/my/orders', ('#/my/orders/' + SNO41 + ''), '#/c/HLT_FOOD', '#/i/VITC', '#/w/IMMUNE', '#/p/p01'):
            pg.evaluate("(h) => window.__hltMall.go(h)", h_); pg.wait_for_timeout(90); t_ = pg.evaluate("document.querySelector('#hltapp main').innerText")
            if re.search(r'undefined|NaN|\[object', t_): ud.append(h_)
            if h_ in ('#/cart', '#/order', '#/my/orders', '#/my/returns/new'):
                ths[h_] = pg.evaluate("(() => { const a = [...document.querySelectorAll('#hltapp main .hlt-ci .th')]; return [a.length, a.filter(e => e.querySelector('svg')).length] })()")
        rec('S-5 소개몰 화면 20곳의 글자에 「undefined」 · 「NaN」 없음 · 장바구니 · 주문서 · 내 주문 · 취소/반품의 작은 상품 그림이 실제 그림', not ud and all(v[0] >= 1 and v[0] == v[1] for v in ths.values()) and len(ths) == 4, (ud, ths))

        # ── X ── 10/8 확정 — 남기기로 한 10건 · 개발분 값 3건을 시안에도 / 머리줄 단추가 본체 화면으로(전에는 소개몰의 「없는 주소」)
        ST = "({hash: location.hash, open: document.getElementById('hlthost').classList.contains('on'), scr: __VIEW.state.screen, pop: !!document.querySelector('#spop.on')})"
        hdr = {}; ref = {}      # 기준 — 같은 단추를 소개광장(같은 머리줄)에서 눌렀을 때 가는 화면
        for k_, sel in (('join', 'header.b2-hd [data-go=join]'), ('src', 'header.b2-hd [data-go=src]'), ('guide', 'header.b2-hd nav [data-go=guide]')):
            go('#/', 300); go('#/community', 600); pg.click('#screen ' + sel); pg.wait_for_timeout(450); ref[k_] = pg.evaluate(ST)['scr'] if k_ != 'src' else ('검색 팝업' if pg.evaluate(ST)['pop'] else pg.evaluate(ST)['scr'])   # v10.31 시안 — 돋보기 = 검색 팝업
            go('#/', 300); go('#/health', 800); pg.click('#hltapp ' + sel); pg.wait_for_timeout(450); hdr[k_] = pg.evaluate(ST)
        rec('H-5 소개몰 안에서 머리줄의 「무료 회원가입」 · 돋보기 · 「이용안내」 → 소개몰이 닫히고 본체의 그 화면으로 — 소개광장에서 누를 때와 같은 화면(전에는 소개몰의 「없는 주소입니다」 · 소개몰 이용안내)',
            all(not v['open'] and ((v['pop'] or v['scr'] == 'src') if ref[k_] == '검색 팝업' else (v['scr'] == ref[k_] and ref[k_] not in ('cmu', 'main1'))) for k_, v in hdr.items()), (ref, hdr))
        # H-6 — 소개몰 안의 머리줄 · 바닥줄(본체 것)에서 누를 수 있는 것 전부. 고치기 전(10/8 실측): 이용안내 → 소개몰 이용안내 · 검색/회원가입/약관/고객센터/소개받기/파트너센터/나의공간 → 소개몰의 「없는 주소입니다」 ·
        #        언어 단추 · 장바구니 → 무반응(「시연: …」 안내만) · 사회관계망 단추 → 엉뚱한 안내
        go('#/', 300); go('#/health', 800)
        keys = pg.evaluate("[...new Set([...document.querySelectorAll('#hltapp header.b2-hd [data-go], #hltapp footer.b2-ft [data-go]')].map(e => e.getAttribute('data-go')))]")
        badk = []
        for k_ in keys:
            go('#/', 250); go('#/health', 700); pg.locator(f'#hltapp header.b2-hd [data-go="{k_}"], #hltapp footer.b2-ft [data-go="{k_}"]').first.click(); pg.wait_for_timeout(420); v = pg.evaluate(ST)
            if v['open'] or v['scr'] in ('main1', None) or v['hash'] == '#/health': badk.append((k_, v))
        rec(f'H-6 소개몰 안의 머리줄 · 바닥줄에서 본체 화면으로 가는 단추 {len(keys)}종(이용안내 · 검색 · 회원가입 · 약관 · 고객센터 · 소개받기 · 파트너센터 · 나의공간 …) — 모두 소개몰이 닫히고 본체의 그 화면으로', len(keys) >= 6 and not badk, badk[:3])
        go('#/', 250); go('#/health', 700); pg.click('#hltapp header.b2-hd .b2-cart'); pg.wait_for_timeout(300)
        ct = pg.evaluate("({open: document.getElementById('hlthost').classList.contains('on'), route: window.__hltMall.route(), scr: (document.querySelector('#hltapp main') || {getAttribute(){}}).getAttribute('data-screen'), pend: window.__hltPending || null})")
        rec('H-6b 소개몰 안에서 머리줄의 장바구니 → 소개몰의 장바구니(전에는 무반응) · 「열고 나서 갈 곳」을 남기지 않음', ct == {'open': True, 'route': '#/cart', 'scr': 'SB-HLT-CRT-010', 'pend': None}, ct)
        pg.evaluate("window.__hltMall.home()"); pg.wait_for_timeout(200); pg.click('#hltapp header.b2-hd [data-lang-toggle]'); pg.wait_for_timeout(300)
        l1 = pg.evaluate("document.querySelectorAll('#hltapp header.b2-hd .lgm [data-lang]').length")
        if l1: pg.click('#hltapp header.b2-hd .lgm [data-lang=ja]'); pg.wait_for_timeout(300)
        l2 = pg.evaluate("({code: (document.querySelector('#hltapp header.b2-hd [data-lang-toggle]') || {}).innerText, menu: !!document.querySelector('#hltapp header.b2-hd .lgm'), open: document.getElementById('hlthost').classList.contains('on')})")
        if l1: pg.click('#hltapp header.b2-hd [data-lang-toggle]'); pg.wait_for_timeout(250); pg.click('#hltapp header.b2-hd .lgm [data-lang=ko]'); pg.wait_for_timeout(250)
        rec('H-6c 소개몰 안에서 언어 단추 → 고르는 칸이 열리고, 고르면 머리줄의 표시가 바뀜(KR → JP) · 소개몰은 열린 채(전에는 무반응)', l1 >= 2 and l2['code'].strip().startswith('JP') and not l2['menu'] and l2['open'], (l1, l2))
        pg.click('#hltapp footer.b2-ft [data-sns=facebook]'); pg.wait_for_timeout(250); tz = pg.evaluate("document.getElementById('hlttoast').innerText.trim()")
        rec('H-6d 소개몰 안에서 바닥줄의 사회관계망 단추 → 「… 계정은 준비 중입니다.」가 소개몰 화면에 보임(본체 알림은 소개몰 뒤에 가려 안 보였음)', tz == '페이스북 계정은 준비 중입니다.', tz)
        go('#/', 300); go('#/health', 800)
        TXT = "document.querySelector('#hltapp main').innerText"
        def at(h_, w=160):
            pg.evaluate("(h) => window.__hltMall.go(h)", h_); pg.wait_for_timeout(w); return pg.evaluate(TXT)
        pg.evaluate("window.__hlt.addToCart('p01', 0)")
        allr = ['#/', '#/direct', '#/search', '#/cart', '#/order', '#/guide', '#/ingredients', '#/concerns', '#/my/addresses', '#/my/returns', '#/my/returns/new', '#/my/orders', ('#/my/orders/' + SNO41 + ''), ('#/my/orders/' + SNO41 + '/track'), '#/c/HLT_FOOD', '#/i/VITC', '#/w/IMMUNE', '#/p/p01']
        tmp = [(h_, w_) for h_ in allr for w_ in ('02-0000-0000', '회신 대기', '주식회사 한국바이오헬스케어 ·', '디지털로9길 65 307호') if w_ in at(h_, 90)]
        t_ = at('#/p/p01')
        rec('X-1 개발분 값 3건 — 화면 18곳에 임시 전화(02-0000-0000) · 「회신 대기」 · 옛 상호/주소 표기 없음 · 상품 상세의 판매자 정보가 「(주)한국바이오헬스케어 소개뱅크 사업부」 · 1688-2887 · (가산동, 백상스타타워1차)',
            not tmp and '(주)한국바이오헬스케어 소개뱅크 사업부' in t_ and '1688-2887' in t_ and '(가산동, 백상스타타워1차) 307호' in t_, tmp[:4])
        rec('X-2 상품 상세 — 「철회 제한」 줄(포장을 개봉했거나 …) · 「건강기능식품은 … 의약품이 아닙니다」 고지', '철회 제한' in t_ and '포장을 개봉했거나 밀봉이 훼손된 경우' in t_ and '의약품이 아닙니다' in t_, t_[t_.find('배송 · 교환'):][:260])
        g_ = at('#/guide')
        rec('X-3 이용안내 — 철회 제한(확정 문구) · 환불 「영업일 3일」 · 배송 「영업일 2일」 「배송비는 받지 않습니다」 · 판매자 정보 · 판매 약관 전문(제1조 ~ 제9조 · 「소개장터 · 안심소개 · 소개창업 회사는 중개만」)',
            '개봉한 식품 · 건강기능식품' in g_ and '영업일 3일' in g_ and '영업일 2일' in g_ and '배송비는 받지 않습니다' in g_ and '판매자 정보' in g_ and '제1조 (판매자)' in g_ and '제9조 (분쟁)' in g_ and '소개장터 · 안심소개 · 소개창업 회사는 중개만' in g_ and '3만원' not in g_, [w_ for w_ in ('개봉한 식품', '영업일 3일', '영업일 2일', '배송비는 받지 않습니다', '판매자 정보', '제1조 (판매자)', '제9조 (분쟁)') if w_ not in g_])
        at('#/direct'); cards = pg.evaluate("[...document.querySelectorAll('#hltapp main .hlt-card')].map(c => (c.querySelector('[data-wd]') || {}).textContent || '')")
        rec('X-4 상품 카드마다 청약철회 문구(「개봉 시 청약철회 제한」 등) — 직판관', len(cards) >= 3 and all('청약철회' in c_ for c_ in cards), cards[:3])
        c_ = at('#/cart'); o_ = at('#/order')
        rec('X-5 장바구니 · 주문서 — 상품 줄에 「청약철회 제한: …」 · 주문서 동의 ① 「주문 내용과 청약철회 조건을 확인했으며 구매에 동의합니다」', '청약철회 제한:' in c_ and '청약철회 제한:' in o_ and '주문 내용과 청약철회 조건을 확인했으며 구매에 동의합니다' in o_, (c_[:120], o_[-300:]))
        k1 = at('#/concerns'); k2 = at('#/w/IMMUNE')
        rec('X-6 고민별 · 고민 상세 — 「건강기능식품은 … 의약품이 아닙니다」 고지', '의약품이 아니' in k1 and '의약품이 아닙니다' in k2, (k1[-120:], k2[-120:]))
        at('#/c/HLT_FOOD'); ln = pg.evaluate("(() => { const a = document.querySelector('#hltapp main [data-notsold-link]'); return a ? [a.closest('p').innerText, a.getAttribute('data-go')] : null })()")
        rec('X-7 전체제품 — 「의약품 · 의료 서비스 · 의료기기는 팔지 않습니다 — 취급하지 않는 것」 → 이용안내', bool(ln) and '팔지 않습니다' in ln[0] and ln[1] == '#/guide', ln)
        r_ = at(('#/my/returns/new?o=' + SNO41 + ''))
        kinds = pg.evaluate("[...document.querySelectorAll('#hltapp main [data-rkind]')].map(b => [b.textContent.trim(), b.classList.contains('on')])")
        pg.click('#hltapp main [data-rkind=EXCHANGE]'); pg.wait_for_timeout(120); kinds2 = pg.evaluate("[...document.querySelectorAll('#hltapp main [data-rkind]')].map(b => [b.textContent.trim(), b.classList.contains('on')])")
        pg.click('#hltapp main [data-ropen="1"]'); pg.wait_for_timeout(120); op = pg.evaluate("[...document.querySelectorAll('#hltapp main [data-ropen]')].map(b => [b.textContent.trim(), b.classList.contains('on')])")
        rec('X-8 반품 신청 — 신청 종류(반품 · 교환) · 「포장을 여셨나요?」(열지 않았습니다 · 열었습니다)를 누르면 고른 것이 바뀜 · 신청 마감일',
            kinds == [['반품', True], ['교환', False]] and kinds2 == [['반품', False], ['교환', True]] and op == [['열지 않았습니다', False], ['열었습니다', True]] and '포장을 여셨나요' in r_ and re.search(r'신청 마감 \d{4}\.\d{2}\.\d{2}', r_) is not None, (kinds, kinds2, op, r_[:160]))
        m1 = at('#/my/orders'); m2_ = at(('#/my/orders/' + SNO41 + '')); m3 = at(('#/my/orders/' + SNO41 + '/track'))
        rec('X-9 내 주문 · 주문 상세 · 배송 조회 — 발송 · 배송 완료 날짜 / 단계별 시각(주문 · 결제 · 발송 · 배송 완료)', re.search(r'발송 \d{4}\.\d{2}\.\d{2} · 배송 완료 \d{4}\.\d{2}\.\d{2}', m1) is not None and all(w_ in m2_ for w_ in ('주문\t', '결제\t', '발송\t', '배송 완료\t')) and re.search(r'배송 완료 \d{4}\.\d{2}\.\d{2}', m3) is not None, (m1[:200], m2_[:260], m3[-160:]))
        mn = {}
        for h_ in ('#/my/orders', ('#/my/orders/' + SNO41 + ''), ('#/my/orders/' + SNO41 + '/track'), ('#/my/returns/new?o=' + SNO41 + ''), '#/my/returns', '#/my/addresses'):
            at(h_, 120); mn[h_] = pg.evaluate("(() => { const n = document.querySelector('#hltapp main nav.hlt-mynav'); return [n ? [...n.querySelectorAll('[data-go]')].map(a => a.textContent.trim()) : null, !!document.querySelector('#hltapp main [data-back]')] })()")
        rec('X-10 내 주문 쪽 6화면 — 메뉴 줄(나의공간 · 내 주문 · 취소 · 반품 내역 · 배송지 관리 · 소개몰 가기) · 「← 뒤로」 없음(개발분과 같게)', all(v == [['나의공간', '내 주문', '취소 · 반품 내역', '배송지 관리', '소개몰 가기'], False] for v in mn.values()), mn)
        at('#/my/orders'); pg.click('#hltapp main nav.hlt-mynav [data-go=my]'); pg.wait_for_timeout(450); stm = pg.evaluate(ST)
        rec('X-10b 메뉴 줄의 「나의공간」 → 소개몰이 닫히고 본체의 나의공간으로', not stm['open'] and stm['scr'] in ('my', 'login'), stm)
        go('#/', 300); go('#/health', 800); home(200)
        ws = pg.evaluate("(() => { const s = document.querySelector('#hltapp main [data-shop-wholesale]'); return s ? { h: s.querySelector('h2').textContent.trim(), n: s.querySelectorAll('[data-go]').length, all: (s.querySelector('.shop-all') || {getAttribute(){}}).getAttribute('data-go') } : null })()")
        if ws: pg.click('#hltapp main [data-shop-wholesale] .shop-all'); pg.wait_for_timeout(450)
        stw = pg.evaluate(ST)
        rec('X-11 메인 — 「도매 · 납품 매물」 구역(매물 4 · 전체보기) → 본체의 전체 목록으로', bool(ws) and ws['h'].startswith('도매 · 납품 매물') and ws['n'] >= 5 and not stw['open'] and stw['scr'] == 'lsth', (ws, stw))
        go('#/', 300); go('#/health', 800); pg.evaluate("window.__hlt.addToCart('p01', 0)")
        for sel in ('#agree1', '#agree2'):
            at('#/order', 150) if sel == '#agree1' else None; pg.check('#hltapp main ' + sel)
        pg.locator('#hltapp main #btnPay').click(timeout=4000); pg.wait_for_timeout(300); pg.locator('#hltapp main button', has_text='결제 성공').first.click(timeout=4000); pg.wait_for_timeout(900)
        dn = pg.evaluate(TXT)
        rec('X-12 주문 완료 — 청약철회 안내(「받으신 날부터 7일 안」 · 「개봉하면 반품이 어렵습니다」)가 있음', '받으신 날부터 7일 안' in dn and '개봉하면 반품이 어렵습니다' in dn, dn[-260:])

        # X-13 — 시안 안의 자가 점검(window.__hltcheck)이 지금의 틀(두 관 전용 머리줄 · 바닥줄)을 봄. v10.24 에서는 13항목 가운데 6항목이 늘 실패(옛 머리줄 .hlt-hd 를 찾음 · G-167)
        go('#/', 300); go('#/health', 800)
        hc = pg.evaluate("""() => { const out = {}; for (const k of window.__hlt.ROUTES) { window.__hltMall.go(window.__hlt.TO_PATH[k]); const r = window.__hltcheck(); out[k] = [r.items.length, r.items.filter(i => !i.ok).map(i => i.name + (i.detail ? ' (' + i.detail + ')' : ''))]; } return out }""")
        badc = {k_: v[1] for k_, v in hc.items() if v[1] or v[0] < 12}
        pg.evaluate("window.__hltMall.go('#/p/p01')"); pdp = pg.evaluate("window.__hltcheckPdp().filter(i => !i.ok).map(i => i.name)")
        rec(f'X-13 시안 안의 자가 점검 — 소개몰 {len(hc)}화면 × 공통 규칙 12가지 이상(머리줄 · 지금 메뉴 표시 · 바닥줄 · 법정 고지 · 임시 값 없음 · 입력 이름 · 중복 id · 없는 링크 · 그림 설명 …) 모두 통과 · 상품 상세의 법정 블록 통과',
            len(hc) == 22 and      # v10.27 G-130 — 택배사 조회(SB-HLT-MYO-040) 더함
            not badc and not pdp, (list(badc.items())[:3], pdp))

        # ── Z ──
        p2 = b.new_page(viewport={'width': 390, 'height': 844}); p2.on('pageerror', lambda e: errs.append('390: ' + str(e)[:140]))
        p2.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
        p2.goto('file://' + FILE + '#/health'); p2.wait_for_timeout(1500); p2.evaluate(CLEAN)
        o = p2.evaluate("(() => { const r = document.getElementById('hltroot'); return { sw: r.scrollWidth, cw: r.clientWidth } })()")
        rec('Z-1 390px — 소개몰 메인에 가로 넘침 없음', o['sw'] <= o['cw'] + 1, o)
        if SHOT: p2.screenshot(path=f'{SHOT}/proto_mall_main_390.png')
        rec('Z-0 스크립트 오류 0', not errs, errs[:3])
        b.close()


if __name__ == '__main__':
    try: main()
    except Exception as ex:
        import traceback; traceback.print_exc(); rec('실행 중 오류', False, repr(ex)[:300])
    ok = sum(1 for r in R if r['ok'])
    json.dump({'items': R, 'pass': ok, 'total': len(R)}, open(os.path.join(OUT, 'proto_mall.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'통과 {ok} / {len(R)}')
