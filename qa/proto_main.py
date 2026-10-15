"""시안 v10.13 · v10.14 — 새 메인(「hero 페이지」 디자인) 점검. 파일(file://)로 열어 실제로 누릅니다. 결과: proto_main.json

  A. 메인 구성    메인 전용 헤더 · 푸터, 구역 12개 순서, 그림의 문구, 그림 · 아이콘이 전부 뜸
  B. 동작        검색 탭 · 칩 → 검색 팝업 · 안내 카드 넘기기(HERO 광고 포함) · PICK 화살표 · 메뉴 이동 · 로그인/로그아웃
  C. 누르는 것 전부  메인의 링크 · 버튼을 하나씩 눌러 무반응 0 · 오류 0
  D. 다른 화면은 그대로  (v10.14 부터 proto_poll.py 의 H 가 이전 판과 비교합니다)
  E. 390px       가로 넘침 없음

사용:  python3 proto_main.py          BASE=/path/SGB_Prototype_v10_12.html (비교 기준 · 기본 /mnt/user-data/outputs)
"""
import json, os, re, sys
from playwright.sync_api import sync_playwright

# 킷 안(qa/)에서 돌리면 옆의 sgb/ 를 씁니다. 다른 곳이면 KIT=<sgb 경로>
_kit = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sgb')
K = os.environ.get('KIT') or (_kit if os.path.isdir(os.path.join(_kit, 'spec')) else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
P = 'file://' + os.environ.get('PROTO', K + '/spec/proto.html')   # v10.31 PROTO
BASE = os.environ.get('BASE', '/mnt/user-data/outputs/SGB_Prototype_v10_12.html')
OUT = os.path.dirname(os.path.abspath(__file__))
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print('ok  ' if ok else 'FAIL', step, str(detail)[:160], file=sys.stderr)

CLEAN = "document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove())"
txts = lambda pg, sel: pg.eval_on_selector_all(sel, 'e=>e.map(x=>x.textContent.trim())')

def home(pg):
    pg.evaluate("location.hash=''"); pg.evaluate("__VIEW.paint('main1')"); pg.wait_for_timeout(300); pg.evaluate(CLEAN); pg.evaluate("document.querySelectorAll('.spop.on').forEach(e=>e.classList.remove('on'))")   # v10.31 — 앞 단추가 연 검색 팝업을 닫음

with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 900}); errs = []
    pg.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
    pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
    pg.on('dialog', lambda d: d.accept())
    pg.goto(P); pg.wait_for_timeout(1600); pg.evaluate(CLEAN)

    # ── A. 구성 ──
    title = open(os.environ.get('PROTO', K + '/spec/proto.html'), encoding='utf-8').read(3000).split('<title>')[1].split('</title>')[0]
    rec('A-0 파일 제목 v10.13 이후 · 「hero 페이지」 표기', bool(re.search(r'v10\.1[3-9]', title)) and 'hero 페이지' in title, title[:70])
    rec('A-1 첫 화면이 새 메인 — .home 1개 · 메인 전용 헤더 1개 · 공통 헤더 없음', pg.locator('#screen .home').count() == 1
        and pg.locator('#screen .home-hd').count() == 1 and pg.locator('#screen header.hd').count() == 0)
    gw = pg.evaluate("[...document.querySelectorAll('.home-hd .gnb a')].map(a=>[a.textContent.trim(), a.getAttribute('href'), a.getAttribute('data-go')])")
    rec('A-2 헤더 메뉴 — 소개장터 · 안심소개 · 소개창업 · 소개몰 · 소개광장 · 이용안내 (v10.25 — 「소개뱅크몰」→「소개몰」)',
        [g[0] for g in gw] == ['소개장터', '안심소개', '소개창업', '소개몰', '소개광장', '이용안내'], [g[0] for g in gw])
    rec('A-3 헤더 오른쪽 — 검색 · 로그인 · 무료 회원가입', txts(pg, '.home-hdr button.home-pill') == ['로그인', '무료 회원가입'] and pg.locator('.home-hdr .home-icbtn').count() == 1)
    h1 = pg.inner_text('#mh-h1').replace('\n', ' ')
    rec('A-4 히어로 — 「무엇을 찾고 계세요? 소뱅AI가 딱 맞는 소개를 이어드려요.」 · 소뱅AI 연결', h1 == '무엇을 찾고 계세요? 소뱅AI가 딱 맞는 소개를 이어드려요.' and '소뱅AI 연결' in pg.inner_text('.home-aibdg'), h1)
    rec('A-5 검색 탭 7개 — AI 검색 · 상품 · 서비스 · 업체 · 창업 · 동네정보 · 사람/전문가', txts(pg, '.home-stab') == ['AI 검색', '상품', '서비스', '업체', '창업', '동네정보', '사람/전문가'])
    rec('A-6 검색창 — 「소개뱅크에서 무엇이든 물어보세요」 · 예시 문구', pg.inner_text('.home-sblab') == '소개뱅크에서 무엇이든 물어보세요'
        and pg.get_attribute('#mh-q', 'placeholder') == '예) 판교에서 부모님 모실만한 한식당 추천해줘')
    rec('A-7 추천 칩 4개(그림의 문구)', txts(pg, '.home-chip') == ['판교 가족식당 추천해줘', '1천만원대로 시작할 창업아이템 있어?', '음식물처리기 요즘 뭐가 좋아?', '믿을 만한 세무사 소개받고 싶어'])
    rec('A-8 안내 카드 — 「전문가 포트폴리오」 · 2 / 5 (그림과 같은 장)', pg.inner_text('.home-ptag') == '전문가 포트폴리오' and pg.inner_text('.home-pno') == '2 / 5'
        and '인기 포트폴리오를' in pg.inner_text('.home-ps'), pg.inner_text('.home-pno'))
    heads = txts(pg, '.home .home-sh h2') + txts(pg, '.home .home-forme h2') + txts(pg, '.home .home-coreh h2')
    order = pg.evaluate("[...document.querySelectorAll('.home h2')].filter(h=>!h.closest('.home-promo')&&!h.closest('.home-demo')).map(h=>h.textContent.trim())")
    exp = ['오늘의 소개뱅크', '지금, 어떤 소개가 필요하세요?', '오늘의 PICK', '이건 어때? 여러분의 의견을 알려주세요.', '지금 우리동네',
           '믿고 연결받는 안심소개', '최근 뜨는 창업', '나를 위한 소개', '소개뱅크 핵심']
    rec('A-9 구역 순서 = 그림 (9개 제목)', order == exp, order)
    rec('A-10 띠배너는 「이건 어때?」와 「지금 우리동네」 사이', pg.evaluate("""(()=>{const a=document.querySelector('.home-band.poll'),s=document.querySelector('.home-band.strip'),t=document.querySelector('.home-band.town');
        return a.compareDocumentPosition(s)&4 && s.compareDocumentPosition(t)&4})()""") and '지금, 동네 맛집 카페를 만나보세요!' in pg.inner_text('.home-strip'))
    t = pg.inner_text('.home')
    rec('A-11 오늘의 소개뱅크 — 큰 배너 「가을 나들이 맛집 TOP 10」 · 순위 카드 3장(상품 · 요청 · 우리동네)', '가을 나들이 맛집' in t and 'TOP 10' in t
        and txts(pg, '.home-rk h3') == ['인기 급상승 상품', '소개를 기다리는 요청', '판교 · 분당'] and pg.locator('.home-rkl li').count() == 9)
    rec('A-12 어떤 소개가 필요하세요 5장', txts(pg, '.home-nd b') == ['물건이 필요해요', '사람을 찾고 있어요', '업체가 필요해요', '창업을 알아봐요', '동네정보가 궁금해요'])
    pk = txts(pg, '.home-pk .home-pkb b')
    kinds = txts(pg, '.home-pk .home-kind')
    rec('A-13 오늘의 PICK — 그림의 5장 그대로 · 꼬리표 · 종류 · 별점', pk == ['AI 음식물처리기 A1', '김현우 세무사', '무인 스터디카페 창업', '판교 가족식당 추천', '카페에서 중요한 것은?']
        and txts(pg, '.home-pk .home-bdg') == ['오늘 할인 TOP', '본사 검증', '관심 급상승', '내 주변', '1,842명 참여'] and kinds == ['상품', '전문가', '창업', '동네정보', '설문']
        and '238,000원' in t and '32%' in t and '4.8 (532)' in t, f'{pk} {kinds}')
    kpos = pg.evaluate("[...document.querySelectorAll('.home-pk .home-kind')].map(e=>getComputedStyle(e).position+'|'+getComputedStyle(e).backgroundColor)")
    rec('A-13b 종류 글자(상품 · 창업 …)가 사진 아래 제 자리에 — 시안의 다른 꾸밈(.hot)에 끌려가지 않음', all(x == 'static|rgba(0, 0, 0, 0)' for x in kpos), kpos)
    # v10.14 — 「이건 어때?」는 예시 숫자가 아니라 실제 투표입니다(0표에서 시작). 투표 동작은 proto_poll.py 가 봅니다
    rec('A-14 이건 어때? 3장 — 비교해요 · 궁금해요 · 써본 의견이 필요해요 · 참여 수는 실제 표 수(0명에서 시작 · 그림의 3,482명 등은 없음)', txts(pg, '.home-pl > .home-bdg') == ['비교해요', '궁금해요', '써본 의견이 필요해요']
        and txts(pg, '.home-plf > span[data-total]') == ['0명 참여'] * 3 and not any(x in t for x in ('3,482명 참여', '4,219명 참여', '812명 참여'))
        and txts(pg, '.home-pl .home-vbtn') == ['투표하기', '투표하기', '의견 남기기'])
    rec('A-15 지금 우리동네 3장 — 동네픽 · 동네소개 · 동네참여 · 거리', txts(pg, '.home-tw .home-bdg') == ['동네픽', '동네소개', '동네참여']
        and all(x in t for x in ('판교역 300m', '정자동 500m', '분당구 1km')))
    rec('A-16 믿고 연결받는 안심소개 4장', txts(pg, '.home-tr b') == ['전문가 소개', '업체 소개', '물건 소개', '당일연락 소개'] and t.count('소개받기') >= 4)
    rec('A-17 최근 뜨는 창업 4장', txts(pg, '.home-st b') == ['무인카페 창업', '무인 편의점 창업', '반려동물 케어샵', '1인 온라인 스토어'])
    rec('A-18 나를 위한 소개 — 로그인 · 무료 회원가입', txts(pg, '.home-fma button') == ['로그인', '무료 회원가입'])
    rec('A-19 소개뱅크 핵심 4개', txts(pg, '.home-core b') == ['AI로 찾고', '실시간으로 비교하고', '안심하고 소개받고', '좋은 연결로 이어져요'])
    ft = pg.inner_text('.home-ft')
    rec('A-20 메인 전용 푸터 — 로고 · 약관 링크 · 사회관계망 4 · 저작권 · 공통 푸터 없음', pg.locator('#screen .home-ft').count() == 1 and pg.locator('#screen .ft').count() == 0
        and all(x in ft for x in ('이용약관', '개인정보처리방침', '운영정책', '고객센터')) and pg.locator('.home-snsi').count() == 4 and 'All rights reserved' in ft)
    rec('A-21 푸터 법정 표시 — 사업자등록번호 · 통신판매업 신고번호 · 통신판매중개자 고지', all(x in ft for x in ('사업자등록번호', '통신판매업 신고번호', '통신판매중개자이며 거래의 당사자가 아닙니다')))
    rec('A-22 푸터에 예시 안내 — 메인의 사진 · 순위 · 평점 · 인물은 디자인 예시(「이건 어때?」 참여 수는 실제 표 수)', '디자인 예시' in ft and '실제 매물 · 상품 · 후기가 아닙니다' in ft and '목업(예시)' in ft)
    pg.evaluate("""async()=>{const h=document.documentElement.scrollHeight;for(let y=0;y<h;y+=600){scrollTo(0,y);await new Promise(r=>setTimeout(r,50));}scrollTo(0,0);}"""); pg.wait_for_timeout(300)
    bad = pg.eval_on_selector_all('.home img', 'e=>e.filter(i=>!i.complete||i.naturalWidth===0).length')
    n_img = pg.locator('.home img').count()
    n_ic = pg.locator('.home img.home-pic').count()
    empty_ln = pg.eval_on_selector_all('.home svg.home-ln', 'e=>e.filter(s=>!s.innerHTML.trim()).length')
    rec(f'A-23 그림 {n_img}장(그중 아이콘 {n_ic}장) 전부 뜸 · 전부 주신 그림에서 자른 PNG(파일 안에 들어 있음 — 외부 주소 없음)', bad == 0 and n_img >= 55 and n_ic >= 35 and empty_ln == 0
        and pg.eval_on_selector_all('.home img', 'e=>e.every(i=>i.src.startsWith("data:image/png;base64,"))'), f'bad={bad} emptyLine={empty_ln}')
    rec('A-24 새로 그린 아이콘 없음 — svg.home-ic 0개(선으로 된 화살표 · 돋보기 · 핀만 그립니다)', pg.locator('.home svg.home-ic').count() == 0 and pg.locator('.home svg.home-ln').count() >= 10,
        pg.locator('.home svg.home-ln').count())
    # 시안에 넣은 그림 = 실제 웹이 쓰는 파일과 같은 내용인지(한 벌만 관리)
    import base64, hashlib
    D = K + '/site/public/home/d'
    files = {f[:-4]: hashlib.md5(open(os.path.join(D, f), 'rb').read()).hexdigest() for f in os.listdir(D) if f.endswith('.png')}
    srcs = pg.eval_on_selector_all('.home img', 'e=>[...new Set(e.map(i=>i.src))]')
    hs = {hashlib.md5(base64.b64decode(x.split(',', 1)[1])).hexdigest() for x in srcs}
    rec(f'A-25 시안의 그림 {len(hs)}종 = 실제 웹의 public/home/d 파일과 같은 내용', hs <= set(files.values()) and len(hs) >= 50, f'{len(hs)} / {len(files)}')
    rec('A-26 메인에 「예시 내용」 표시 — .home[data-content=sample]', pg.get_attribute('#screen .home', 'data-content') == 'sample')
    pg.screenshot(path=f'{OUT}/proto_main_1280.png', full_page=True)

    # ── B. 동작 ──
    pg.click('[data-mhxtab=biz]'); pg.wait_for_timeout(150)
    rec('B-1 검색 탭 「창업」 → 탭 표시 · 예시 문구 바뀜', pg.inner_text('.home-stab.on') == '창업' and '창업' in pg.get_attribute('#mh-q', 'placeholder')
        and pg.get_attribute('form.home-sb', 'data-scope') == 'biz')
    pg.click('.home-chip >> nth=1'); pg.wait_for_timeout(500)
    rec('B-2 추천 칩 → 검색 팝업이 그 문장으로 열림', pg.evaluate("(document.getElementById('spopq')||{}).value") == '1천만원대로 시작할 창업아이템 있어?')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300); home(pg)
    pg.click('.home-hdr .home-icbtn'); pg.wait_for_timeout(500)
    rec('B-3 헤더 검색 아이콘 → 검색 팝업', pg.evaluate("!!document.getElementById('spopq') && document.getElementById('spopq').offsetParent!==null"))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300); home(pg)
    seen = []
    for _ in range(5):
        seen.append((pg.inner_text('.home-pno'), pg.get_attribute('.home-ps', 'data-slide')))
        pg.click('.home-pnext'); pg.wait_for_timeout(250)
    rec('B-4 안내 카드 「다음」 — 5장을 돌아 처음으로 · 그중 1장은 HERO 광고', [s[0] for s in seen] == ['2 / 5', '3 / 5', '4 / 5', '5 / 5', '1 / 5']
        and seen[-1][1] == 'ad' and pg.inner_text('.home-pno') == '2 / 5', seen)
    for _ in range(4): pg.click('.home-pnext'); pg.wait_for_timeout(200)
    ad_txt = pg.inner_text('.home-ps')
    rec('B-5 광고 장 — 「광고」 표시 · 광고주 · 버튼 · 성향 안내 · data-adbox=HERO', pg.inner_text('.home-ptag') == '광고' and pg.locator('.home-ps [data-adbox=HERO]').count() == 1
        and pg.locator('.home-ps [data-ad=cta]').count() == 1 and '성향' in ad_txt, ad_txt[:120])
    pg.click('.home-ps [data-ad=cta]'); pg.wait_for_timeout(500)
    rec('B-6 광고 버튼 → 반응(이동 또는 안내)', pg.evaluate("__VIEW.state.screen") != 'main1' or pg.evaluate("(document.getElementById('toast')||{}).innerText||''") != '' or pg.locator('[role=dialog],.mdl.on,.modal.on').count() > 0,
        pg.evaluate("__VIEW.state.screen"))
    home(pg)
    over = pg.evaluate("(()=>{const r=document.querySelector('.home-rail');return r.scrollWidth-r.clientWidth})()")
    pg.locator('.home-railnext').scroll_into_view_if_needed(); pg.click('.home-railnext'); pg.wait_for_timeout(700)
    sc_arrow = pg.evaluate("__VIEW.state.screen")
    home(pg); pg.click('.home-band.picks .home-sh a'); pg.wait_for_timeout(700); sc_more = pg.evaluate("__VIEW.state.screen")
    rec('B-7 PICK 화살표 — 5장이 한 화면에 다 보이면 「전체보기」와 같은 곳(통합 검색)으로', over <= 8 and sc_arrow == sc_more and sc_arrow not in ('main1', 'main2'), f'넘침 {over}px → {sc_arrow} / 전체보기 → {sc_more}')
    home(pg)
    # 메뉴 이동 — 관 4곳 + 소개광장 + 이용안내, 다른 화면에서는 공통 헤더
    moved = []
    for i in range(6):
        home(pg)
        name = pg.locator('.home-hd .gnb a').nth(i).inner_text()
        pg.locator('.home-hd .gnb a').nth(i).click(); pg.wait_for_timeout(600); pg.evaluate(CLEAN)
        sc = pg.evaluate("__VIEW.state.screen"); hlt = pg.evaluate("location.hash")
        moved.append((name, sc, hlt, pg.locator('#screen .home-hd').count()))
    rec('B-8 헤더 메뉴 6개 → 각 화면으로 이동(관 3 · 소개몰 · 소개광장 · 이용안내)',
        [m[1] for m in moved[:3]] == ['list', 'listl', 'listb'] and moved[3][2].startswith('#/health') and moved[4][1] == 'cmu' and moved[5][1] == 'guide', moved)
    pg.evaluate("location.hash=''"); pg.evaluate("__VIEW.paint('listl')"); pg.wait_for_timeout(400); pg.evaluate(CLEAN)
    rec('B-9 다른 화면(안심소개)은 공통 헤더 · 푸터 그대로', pg.locator('#screen header.hd').count() == 1 and pg.locator('#screen .home-hd').count() == 0 and pg.locator('#screen .ft').count() == 1)
    pg.click('#screen header.hd a.lg'); pg.wait_for_timeout(500); pg.evaluate(CLEAN)
    rec('B-10 공통 헤더의 로고 → 메인(새 헤더)', pg.locator('#screen .home-hd').count() == 1)
    # 로그인 → 메인
    home(pg)
    pg.click('.home-hdr [data-auth=in]'); pg.wait_for_timeout(500)
    rec('B-11 「로그인」 → 로그인 화면', pg.evaluate("__VIEW.state.screen") == 'login', pg.evaluate("__VIEW.state.screen"))
    logged = pg.evaluate("""(()=>{const b=[...document.querySelectorAll('#screen button, #screen a')].find(x=>/^로그인$|로그인하기|시연 로그인/.test(x.textContent.trim())&&!x.closest('header'));if(b){b.click();return b.textContent.trim()}return null})()""")
    pg.wait_for_timeout(900); pg.evaluate(CLEAN)
    if not pg.evaluate("document.querySelector('#screen .home-hdr [data-auth=out]')"):
        pg.evaluate("location.hash=''"); pg.evaluate("__VIEW.paint('main2')"); pg.wait_for_timeout(400)
    hb = txts(pg, '.home-hdr button.home-pill')
    rec('B-12 로그인한 메인 — 헤더 「나의공간 · 로그아웃 · 관리자 페이지」 · 「성향 분석하고 추천받기」', hb == ['나의공간', '로그아웃', '관리자 페이지'] and txts(pg, '.home-fma button') == ['성향 분석하고 추천받기'], f'{logged} {hb}')
    rec('B-13 로그인하면 바로가기에 「제휴 파트너센터」', '제휴 파트너센터' in txts(pg, '.home-quick a'), txts(pg, '.home-quick a'))
    if hb[:1] == ['나의공간']:
        pg.click('.home-hdr [data-auth=out]'); pg.wait_for_timeout(700); pg.evaluate(CLEAN)
        if pg.locator('#screen .home-hdr').count() == 0: home(pg)
        rec('B-14 「로그아웃」 → 헤더가 로그인 · 무료 회원가입으로', txts(pg, '.home-hdr button.home-pill') == ['로그인', '무료 회원가입'])

    # ── C. 누르는 것 전부 ──
    SEL = "a,button,[data-go],[data-t],[data-act],[data-open],[data-tab],[onclick],summary"
    SIG = """()=>{const a=document.getElementById('app');const h=document.getElementById('hlthost');const t=document.getElementById('toast');
      const x=(a?a.innerHTML:'')+'|'+(h?h.innerHTML:'');let v=0;for(let i=0;i<x.length;i+=7)v=(v*31+x.charCodeAt(i))|0;
      const pop=[...document.body.children].filter(e=>!['app','hlthost','toast','skip'].includes(e.id)&&getComputedStyle(e).display!=='none').map(e=>(e.id||e.className)+':'+(e.innerText||'').length).join(',');   // v10.31 — 검색 팝업(spop)은 body 에 붙음
      return [location.hash,(window.__VIEW&&__VIEW.state.screen)||'',x.length+':'+v,t?t.innerText:'',pop]}"""
    home(pg)
    n = pg.evaluate(f"[...document.querySelectorAll('#screen .home')][0].querySelectorAll('{SEL}').length")
    dead, bad_clicks = [], []
    for i in range(n):
        home(pg); errs.clear()
        d = pg.evaluate(f"""(i)=>{{const e=[...document.querySelector('#screen .home').querySelectorAll('{SEL}')][i]; if(!e||e.offsetParent===null) return null;
            return (e.innerText||e.getAttribute('aria-label')||'').trim().replace(/\\s+/g,' ').slice(0,30)}}""", i)
        if d is None: continue
        pg.evaluate("(()=>{const t=document.getElementById('toast');if(t){t.innerHTML='';t.classList.remove('on')}})()")
        s0 = pg.evaluate(SIG)
        pg.evaluate(f"(i)=>[...document.querySelector('#screen .home').querySelectorAll('{SEL}')][i].click()", i); pg.wait_for_timeout(160)
        s1 = pg.evaluate(SIG)
        if errs: bad_clicks.append((d, errs[:1]))
        if s0 == s1: dead.append(d)
        pg.keyboard.press('Escape')
    rec(f'C-1 메인에서 누를 수 있는 {n}개 — 무반응 0', not dead, dead[:8])
    rec('C-2 누르는 동안 스크립트 오류 0', not bad_clicks, bad_clicks[:3])

    # ── E. 390px ──
    m = b.new_page(viewport={'width': 390, 'height': 844})
    m.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
    m.goto(P); m.wait_for_timeout(1500); m.evaluate(CLEAN)
    sw = m.evaluate("document.documentElement.scrollWidth")
    rec('E-1 390px 가로 넘침 없음', sw <= 390, sw)
    rail = m.evaluate("(()=>{const r=document.querySelector('.home-rail');const b=document.querySelector('.home-railnext');r.scrollLeft=300;return [r.scrollWidth-r.clientWidth, r.scrollLeft, b.offsetParent!==null]})()")
    rec('E-2 390px — PICK 은 손으로 밀어 넘김(카드가 화면 밖에 있고 실제로 밀림 · 화살표는 숨김)', rail[0] > 200 and rail[1] >= 200 and rail[2] is False, rail)
    rec('E-3 390px — 헤더 메뉴 6개가 모두 있음(옆으로 밀어 봄)', m.locator('.home-hd .gnb a').count() == 6)
    m.evaluate("""async()=>{const h=document.documentElement.scrollHeight;for(let y=0;y<h;y+=600){scrollTo(0,y);await new Promise(r=>setTimeout(r,50));}scrollTo(0,0);}"""); m.wait_for_timeout(300)
    m.screenshot(path=f'{OUT}/proto_main_390.png', full_page=True); m.close()

    # ── D. 다른 화면은 그대로 ── v10.14 부터 proto_poll.py 의 H(이전 판과 화면마다 비교)가 맡습니다
    rec('Z 스크립트 오류 0', not errs, errs[:3])
    b.close()

json.dump(R, open(os.path.join(OUT, 'proto_main.json'), 'w'), ensure_ascii=False, indent=1)
real = [r for r in R if not r.get('skip')]
print(f"통과 {sum(r['ok'] for r in real)} / {len(real)}" + (f" · 건너뜀 {len(R) - len(real)}" if len(R) > len(real) else ''))
