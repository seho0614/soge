"""v10.23 시안 — 소개광장을 제시 디자인(2026-10-07)대로. 결과: proto_cmu.json · proto_cmu_*.png

  A. 두 관 전용 머리줄 · 바닥줄   소개광장 화면 5장에만(cmu · commu · cmud · cmuw · cmupoll) — 그 밖의 화면은 지금 그대로
  B. 목록 1쪽 = 제시 디자인        줄 10개의 제목 · 분류 · 작성자 · 작성일 · 조회가 그림과 같음
  C. 색 · 치수                    남색 #00245A · 주황 #F5A008 · 탭 150×44 · 줄 44px · 쪽 번호 38px · 글쓰기 184×52 · 배지 3색
  D. 탭 · 검색 · 쪽 넘김          주소에 값이 실리고 새로 열어도 같은 화면 · 서로의 값을 잃지 않음
  E. 하위 화면                    글 상세(누른 글) · 글쓰기 · 투표 — 같은 머리줄 · 같은 색
  P. 사진                         시안에 넣은 그림 = 실제 웹의 PNG 파일과 바이트가 같음 = 받은 디자인의 그 자리와 점 하나 같음
  M. 좁은 화면(390px) · 화면 오류

사용: python3 proto_cmu.py     PROTO=/path/proto.html (기본: 킷의 spec/proto.html)
"""
# v10.25 — 소개몰(겹쳐 뜨는 틀)도 같은 머리줄 · 바닥줄을 그려 문서 안에 두 벌이 있습니다. 소개광장의 것만 보도록 고르는 말을 본체(#screen) 안으로 좁혔습니다
import base64, io, json, os, re, sys
from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
if not os.path.isdir(K + '/sgb'): K = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILE = os.environ.get('PROTO', K + '/sgb/spec/proto.html')
OUT = os.path.dirname(os.path.abspath(__file__))
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:400]})
    print('ok  ' if ok else 'FAIL', step, '' if ok else str(detail)[:300], file=sys.stderr)

NAVY = 'rgb(0, 36, 90)'; ORANGE = 'rgb(245, 160, 8)'
BADGE = {'소개 후기': ('rgb(254, 243, 224)', 'rgb(247, 128, 19)'), '질문': ('rgb(235, 243, 255)', 'rgb(19, 98, 244)'), '업종 이야기': ('rgb(241, 238, 254)', 'rgb(105, 62, 221)')}
PLZ = ['cmu', 'commu', 'cmud', 'cmuw', 'cmupoll']
# 제시 디자인(docs/design/plaza_design_20261007.png)의 목록 1쪽 — 그림에서 읽은 그대로
DESIGN = [
    ('식자재 공급처 소개하고 540만원 받은 이야기', '소개 후기', '김OO', '2026.09.15', '1,204'),
    ('무인 카페 권리금 시세가 궁금해요', '질문', '이OO', '2026.09.15', '842'),
    ('좋은 세무사 소개 부탁드립니다', '질문', '박OO', '2026.09.14', '621'),
    ('부산에서 믿을 수 있는 업체 추천해요', '업종 이야기', '최OO', '2026.09.14', '509'),
    ('실제로 연결까지 된 병원 사례 공유합니다', '소개 후기', '정OO', '2026.09.13', '1,087'),
    ('요즘 프랜차이즈 창업 어떤가요 ?', '업종 이야기', '한OO', '2026.09.13', '432'),
    ('카페 장비 납품 가능한 업체 있을까요 ?', '질문', '송OO', '2026.09.13', '389'),
    ('소개로 만난 파트너와 1년 째 거래 중입니다.', '소개 후기', '윤OO', '2026.09.13', '954'),
    ('소상공인 정책자금 경험 있으신 분 ?', '질문', '임OO', '2026.09.13', '276'),
    ('지역별 배달 업체 비교 정리해봤어요', '업종 이야기', '조OO', '2026.09.13', '318'),
]
CSS = "([sel, prop]) => { const e = document.querySelector(sel); return e ? getComputedStyle(e)[prop] : null }"
def css(pg, sel, prop): return pg.evaluate(CSS, [sel, prop])
BOX = "(sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }"
TXT = "(sel) => [...document.querySelectorAll(sel)].map(e => e.textContent.trim())"
HREF = "(sel) => [...document.querySelectorAll(sel)].map(e => e.getAttribute('href'))"
ROWS = """() => [...document.querySelectorAll('table.plz-tbl tbody tr')].map(tr => { const td = [...tr.children]; const a = td[0].querySelector('a'); const bd = td[1].querySelector('.plz-bd');
  return [a ? a.textContent.trim() : '', bd ? bd.textContent.trim() : '', td[2].textContent.trim(), td[3].textContent.trim(), td[4].textContent.trim(), a ? a.getAttribute('href') : '', Math.round(tr.getBoundingClientRect().height)] })"""
SCR = "() => __VIEW.state.screen"
TOAST = "() => { const e = document.getElementById('toast'); return e && e.classList.contains('on') ? e.textContent.trim() : '' }"


def main(p):
    b = p.chromium.launch(); errs = []
    ctx = b.new_context(viewport={'width': 1500, 'height': 1000}); pg = ctx.new_page()
    pg.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)[:160]))
    def open_(h):
        pg.goto('file://' + FILE + h); pg.wait_for_timeout(700)
        pg.evaluate("() => { document.querySelectorAll('.admask,.adfloat').forEach(e => e.remove()); const t = document.getElementById('toast'); t && t.classList.remove('on'); document.querySelectorAll('.spop.on').forEach(e => e.classList.remove('on')) }")   # v10.31 — 돋보기가 연 검색 팝업은 주소만 바뀌면 열린 채로 남음
    open_('#/community'); pg.wait_for_timeout(600)

    # ── A ── 머리줄 · 바닥줄
    has = pg.evaluate("""() => { const out = {}; for (const k of Object.keys(__VIEW.screens)) { try { __VIEW.paint(k); out[k] = [document.querySelectorAll('#screen header.b2-hd').length, document.querySelectorAll('#screen footer.b2-ft').length, document.querySelectorAll('#screen header.hd').length] } catch (e) { out[k] = ['ERR', String(e).slice(0, 60)] } } return out }""")
    new = sorted(k for k, v in has.items() if v[0] == 1)
    # v10.30 — 소개장터 메인(list)도 두 관 전용 머리줄 · 바닥줄을 씁니다(10/9 제시 디자인 · 색조 money — proto_mny.py 가 봄)
    rec(f'A-1 새 머리줄 · 바닥줄은 소개광장 화면 5장 + 소개장터 메인(list)에만 — 전체 {len(has)}장 가운데 {PLZ}', new == sorted(PLZ + ["list"]) and all(has[k][:2] == [1, 1] and has[k][2] == 0 for k in PLZ) and not [k for k, v in has.items() if v[0] == 'ERR'], (new, [k for k, v in has.items() if v[0] == 'ERR'][:3]))
    open_('#/community')
    rec('A-2 #/community — 화면 cmu · 옛 머리줄(header.hd) 없음 · 화면 번호 SB-HOM-CMU-010 이 화면에 있음', pg.evaluate(SCR) == 'cmu' and pg.locator('#screen header.hd').count() == 0 and 'SB-HOM-CMU-010' in pg.inner_text('#screen'), pg.evaluate(SCR))
    lg = pg.evaluate("() => { const i = document.querySelector('#screen header.b2-hd .b2-logo img'); return i ? [i.naturalWidth, i.naturalHeight, i.alt, i.src.slice(0, 22)] : null }")
    rec('A-3 로고 — 받은 그림에서 자른 PNG(866×210) · 파일 안에 그대로 들어 있음(data:image/png)', lg == [866, 210, '소개뱅크', 'data:image/png;base64,'], lg)
    nav = pg.evaluate("() => [...document.querySelectorAll('#screen header.b2-hd .b2-nav a')].map(e => [e.textContent.trim(), e.getAttribute('aria-current') || ''])")
    rec('A-4 메뉴 — 소개장터 · 안심소개 · 소개창업 · 소개몰 · 소개광장 · 이용안내 (v10.25 — 「소개뱅크몰」→「소개몰」) · 「소개광장」에 지금 화면 표시', [n[0] for n in nav] == ['소개장터', '안심소개', '소개창업', '소개몰', '소개광장', '이용안내'] and [n[0] for n in nav if n[1] == 'page'] == ['소개광장'], nav)
    cur = pg.evaluate("() => { const e = document.querySelector('#screen header.b2-hd .b2-nav a[aria-current=page]'); return e ? [getComputedStyle(e).color, getComputedStyle(e, '::after').backgroundColor] : null }")
    rec('A-5 지금 화면 표시 — 남색 글자 · 주황 밑줄', cur == [NAVY, ORANGE], cur)
    rec('A-6 「무료 회원가입」 주황 바탕 · 흰 글자 · 알약 / 머리줄 높이 75px(±3)', css(pg, '#screen header.b2-hd .b2-join', 'backgroundColor') == ORANGE and css(pg, '#screen header.b2-hd .b2-join', 'color') == 'rgb(255, 255, 255)' and float(css(pg, '#screen header.b2-hd .b2-join', 'borderTopLeftRadius').replace('px', '')) >= 20 and abs(pg.evaluate(BOX, 'header.b2-hd')[3] - 75) <= 3, (css(pg, '#screen header.b2-hd .b2-join', 'backgroundColor'), pg.evaluate(BOX, 'header.b2-hd')))
    pg.click('#screen header.b2-hd .b2-lngb'); pg.wait_for_timeout(200)
    lang = pg.evaluate("() => { const b = document.querySelector('#screen header.b2-hd .b2-lngb'), m = document.querySelector('#screen header.b2-hd .lgm'); const r = b.getBoundingClientRect(), mr = m ? m.getBoundingClientRect() : null; return [b.textContent.replace(/\\s+/g, ' ').trim(), Math.round(r.height), m ? m.querySelectorAll('[data-lang]').length : 0, mr ? Math.round(mr.top - r.bottom) : null] }")
    rec('A-7 언어 단추 「KR」 — 머리줄 안(높이 46px 이하) · 누르면 목록 12개가 단추 바로 아래에 열림', lang[0].startswith('KR') and lang[1] <= 46 and lang[2] == 12 and lang[3] is not None and 0 <= lang[3] <= 16, lang)
    pg.click('#screen header.b2-hd .lgm [data-lang="ja"]'); pg.wait_for_timeout(200)
    rec('A-8 언어를 고르면 단추가 「JP」로 · 「준비 중」 안내', pg.inner_text('#screen header.b2-hd .b2-lngb').strip().startswith('JP') and '준비 중' in pg.evaluate(TOAST), (pg.inner_text('#screen header.b2-hd .b2-lngb'), pg.evaluate(TOAST)))
    pg.click('#screen header.b2-hd .b2-lngb'); pg.wait_for_timeout(150); pg.click('#screen header.b2-hd .lgm [data-lang="ko"]'); pg.wait_for_timeout(150)
    ft = pg.inner_text('#screen footer.b2-ft')
    rec('A-9 바닥줄 — 로고(802×200) · 서비스 소개 · 이용약관 · 개인정보처리방침 · 운영정책 · 고객센터 · © 올해 · 사업자 정보 · 통신판매중개자 고지', pg.evaluate("() => { const i = document.querySelector('#screen footer.b2-ft .b2-logo img'); return i ? [i.naturalWidth, i.naturalHeight] : null }") == [802, 200] and all(x in ft for x in ('서비스 소개', '이용약관', '개인정보처리방침', '운영정책', '고객센터', '사업자등록번호', '통신판매중개자')) and re.search(r'20\d\d 소개뱅크\. All rights reserved\.', ft), ft[:200])
    sns = pg.evaluate("() => [...document.querySelectorAll('#screen footer.b2-ft .b2-sns [data-sns]')].map(e => [e.getAttribute('data-sns'), e.querySelector('img').naturalWidth])")
    rec('A-10 사회관계망 아이콘 3개(페이스북 · 인스타그램 · 유튜브) — 받은 그림에서 자른 것', [s[0] for s in sns] == ['facebook', 'instagram', 'youtube'] and all(s[1] in (120, 121) for s in sns), sns)
    jumps = []
    for sel, want in (('#screen header.b2-hd .b2-login', '#/login'), ('#screen header.b2-hd .b2-join', '#/join'), ('#screen header.b2-hd .b2-find', '#/search')):
        open_('#/community'); pg.click(sel); pg.wait_for_timeout(350); jumps.append((want, '#/search' if want == '#/search' and pg.evaluate("!!document.querySelector('#spop.on')") else pg.evaluate('location.hash')))   # v10.31 시안 — 돋보기 = 검색 팝업(#spop · 검색하면 #/search?q=)
    open_('#/community'); pg.click('#screen header.b2-hd .b2-cart'); pg.wait_for_timeout(900)
    cart = pg.evaluate("() => [location.hash, window.__hltx.isOpen(), String(window.__hltMall.route()), document.querySelector('#hltapp h1, #hltapp h2') ? document.querySelector('#hltapp h1, #hltapp h2').innerText.trim() : '']")
    rec('A-11 머리줄 단추 — 로그인 · 무료 회원가입 · 돋보기가 그 화면으로 · 장바구니는 소개몰의 장바구니 화면으로(몰 메인이 아님)', all(a == b_ for a, b_ in jumps) and cart[0] == '#/health' and cart[1] is True and 'cart' in cart[2] and '장바구니' in cart[3], (jumps, cart))

    # ── B ── 목록 1쪽 = 제시 디자인
    open_('#/community')
    rows = pg.evaluate(ROWS)
    rec('B-1 목록 1쪽 — 줄 10개의 제목 · 분류 · 작성자 · 작성일 · 조회가 제시 디자인과 같음', [tuple(r[:5]) for r in rows] == DESIGN, [r[:5] for r, d in zip(rows, DESIGN) if tuple(r[:5]) != d][:2] or len(rows))
    rec('B-2 표 머리 — 제목 · 분류 · 작성자 · 작성일 · 조회', pg.evaluate(TXT, 'table.plz-tbl thead th') == ['제목', '분류', '작성자', '작성일', '조회'], pg.evaluate(TXT, 'table.plz-tbl thead th'))
    rec('B-3 사진 띠 — 제목 「소개광장」 · 한 줄 설명 · 안내 3줄 · 검색 칸 「게시글을 검색해보세요.」', pg.inner_text('.plz-hero h1').strip() == '소개광장' and pg.inner_text('.plz-hero .plz-lead').strip() == '소개 후기와 업종 이야기가 모이는 자리입니다.' and pg.evaluate(TXT, '.plz-hero .plz-note > *') == ['누구나 쓰실 수 있습니다.', '다만, 첫 글은 확인 후 올라갑니다 - 보통 하루 안에 끝납니다.', '소개 후기는 성사된 거래가 있어야 쓰실 수 있습니다.'] and pg.get_attribute('.plz-find input[name=q]', 'placeholder') == '게시글을 검색해보세요.', pg.evaluate(TXT, '.plz-hero .plz-note > *'))
    tabs = pg.evaluate("() => [...document.querySelectorAll('.plz-tabs a')].map(e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return [e.textContent.trim(), e.getAttribute('aria-current') || '', s.backgroundColor, s.color, Math.round(r.width), Math.round(r.height), Math.round(parseFloat(s.borderTopLeftRadius))] })")
    rec('B-4 알약 탭 6개 — 전체 · 소개 후기 · 업종 이야기 · 질문 · 공지 · 이건 어때? 투표', [t[0] for t in tabs] == ['전체', '소개 후기', '업종 이야기', '질문', '공지', '이건 어때? 투표'], [t[0] for t in tabs])

    # ── C ── 색 · 치수
    hero = pg.evaluate(BOX, '.plz-hero'); h1 = pg.evaluate("() => { const e = document.querySelector('.plz-hero h1'); return [getComputedStyle(e).color, parseFloat(getComputedStyle(e).fontSize)] }")
    rec('C-1 사진 띠 — 화면 폭 전체 · 높이 303px(±6) · 제목 남색 40px 이상', hero[0] == 0 and abs(hero[2] - 1500) <= 1 and abs(hero[3] - 303) <= 6 and h1[0] == NAVY and h1[1] >= 40, (hero, h1))
    rec('C-2 고른 탭 — 남색 바탕 · 흰 글자 / 나머지 — 흰 바탕 · 남색 글자 / 150×44 · 모서리 10px', tabs[0][1:4] == ['page', NAVY, 'rgb(255, 255, 255)'] and all(t[1] == '' and t[2] == 'rgb(255, 255, 255)' and t[3] == NAVY for t in tabs[1:]) and all(abs(t[5] - 44) <= 1 and t[6] == 10 for t in tabs) and all(abs(t[4] - 150) <= 1 for t in tabs[:5]), tabs)
    th = pg.evaluate("() => [...document.querySelectorAll('table.plz-tbl thead th')].map(e => [getComputedStyle(e).color, getComputedStyle(e).backgroundColor])")
    rec('C-3 표 머리 남색 글자 · 바탕 #F7F8FA · 줄 높이 44px(±2) · 테두리 #DBDBDB · 표 가로 1378px(±4)', all(t == [NAVY, 'rgb(247, 248, 250)'] for t in th) and all(abs(r[6] - 44) <= 2 for r in rows) and css(pg, '.plz-tblw', 'borderTopColor') == 'rgb(219, 219, 219)' and abs(pg.evaluate(BOX, 'table.plz-tbl')[2] - 1378) <= 4, (th[:1], [r[6] for r in rows][:3], pg.evaluate(BOX, 'table.plz-tbl')))
    bd = {e[0]: (e[1], e[2]) for e in pg.evaluate("() => [...document.querySelectorAll('table.plz-tbl tbody .plz-bd')].map(e => [e.textContent.trim(), getComputedStyle(e).backgroundColor, getComputedStyle(e).color])")}
    rec('C-4 분류 배지 색 — 소개 후기 · 질문 · 업종 이야기(디자인의 값 그대로)', all(bd.get(k) == v for k, v in BADGE.items()), bd)
    pgs = pg.evaluate("() => [...document.querySelectorAll('nav.plz-pager > *')].map(e => { const s = getComputedStyle(e), r = e.getBoundingClientRect(); return [e.textContent.trim(), e.getAttribute('aria-current') || '', s.backgroundColor, Math.round(r.height), e.getAttribute('href'), e.getAttribute('aria-disabled') || ''] })")
    last = int(pgs[-2][0]) if pgs and pgs[-2][0].isdigit() else 0
    rec('C-5 쪽 번호 — ‹ 1 2 3 4 5 … 끝 › 꼴 · 지금 쪽(1)은 주황 바탕 · 칸 38px · 1쪽에서 ‹ 는 눌리지 않음', [x[0] for x in pgs][:6] == ['‹', '1', '2', '3', '4', '5'] and '…' in [x[0] for x in pgs] and last >= 7 and pgs[-1][0] == '›' and [x[0] for x in pgs if x[1] == 'page'] == ['1'] and [x[2] for x in pgs if x[1] == 'page'] == [ORANGE] and all(abs(x[3] - 38) <= 1 for x in pgs) and pgs[0][5] == 'true', pgs)
    wr = pg.evaluate("() => { const e = document.querySelector('.plz-write'); const r = e.getBoundingClientRect(), t = document.querySelector('table.plz-tbl').getBoundingClientRect(), s = getComputedStyle(e); return [s.backgroundColor, s.color, Math.round(r.width), Math.round(r.height), r.top > t.bottom, Math.abs(Math.round(r.right - t.right)) <= 2, e.textContent.trim()] }")
    rec('C-6 글쓰기 — 표 아래 오른쪽 · 주황 바탕 · 흰 글자 · 184×52', wr[0] == ORANGE and wr[1] == 'rgb(255, 255, 255)' and abs(wr[2] - 184) <= 2 and abs(wr[3] - 52) <= 2 and wr[4] and wr[5] and wr[6] == '글쓰기', wr)
    sf = pg.evaluate("() => { const f = document.querySelector('.plz-find'), b = f.querySelector('button'); const r = f.getBoundingClientRect(); return [getComputedStyle(b).backgroundColor, getComputedStyle(b).borderTopLeftRadius, Math.round(r.width), Math.round(r.height), f.querySelector('input').getAttribute('maxlength')] }")
    rec('C-7 검색 칸 — 남색 둥근 단추 · 가로 510px(±40) · 높이 60px(±4) · 50자까지', sf[0] == NAVY and sf[1] == '50%' and abs(sf[2] - 510) <= 40 and abs(sf[3] - 60) <= 4 and sf[4] == '50', sf)
    pg.screenshot(path=os.path.join(OUT, 'proto_cmu_list.png'), full_page=True)

    # ── D ── 탭 · 검색 · 쪽 넘김
    pg.click('nav.plz-pager a:text-is("2")'); pg.wait_for_timeout(400)
    r2 = pg.evaluate(ROWS)
    rec('D-1 「2」 → 주소 #/community?page=2 · 다른 10줄 · 「2」가 주황', pg.evaluate('location.hash') == '#/community?page=2' and len(r2) == 10 and not {r[0] for r in r2} & {d[0] for d in DESIGN} and pg.inner_text('nav.plz-pager [aria-current=page]').strip() == '2', (pg.evaluate('location.hash'), len(r2)))
    pg.reload(); pg.wait_for_timeout(900)
    rec('D-2 새로 고쳐도 2쪽 그대로(주소가 화면을 정함)', [r[0] for r in pg.evaluate(ROWS)] == [r[0] for r in r2] and pg.evaluate(SCR) == 'cmu', pg.evaluate('location.hash'))
    pg.click(f'nav.plz-pager a:text-is("{last}")'); pg.wait_for_timeout(400)
    rl = pg.evaluate(ROWS)
    rec(f'D-3 마지막 쪽({last}) — 1줄 이상 10줄 이하 · › 가 눌리지 않음 · 앞쪽에 「1」과 「…」', 1 <= len(rl) <= 10 and pg.locator('nav.plz-pager [aria-label="다음 쪽"][aria-disabled=true]').count() == 1 and pg.evaluate(TXT, 'nav.plz-pager > *')[1] == '1' and '…' in pg.evaluate(TXT, 'nav.plz-pager > *'), (len(rl), pg.evaluate(TXT, 'nav.plz-pager > *')))
    total_all = (last - 1) * 10 + len(rl)
    open_('#/community'); pg.click('.plz-tabs a:text-is("질문")'); pg.wait_for_timeout(400)
    rq = pg.evaluate(ROWS)
    rec('D-4 탭(질문) — 주소 #/community?board=QNA · 줄이 모두 「질문」 · 그 탭이 남색', pg.evaluate('location.hash') == '#/community?board=QNA' and rq and {r[1] for r in rq} == {'질문'} and pg.inner_text('.plz-tabs a[aria-current=page]').strip() == '질문', (pg.evaluate('location.hash'), {r[1] for r in rq}))
    cnt = {}
    for code, nm in (('REVIEW', '소개 후기'), ('TRADE', '업종 이야기'), ('QNA', '질문'), ('NOTICE', '공지')):
        open_(f'#/community?board={code}'); n = 0; seen = set()
        for _ in range(30):
            rr = pg.evaluate(ROWS); n += len(rr); seen |= {r[1] for r in rr}
            if pg.locator('nav.plz-pager a[aria-label="다음 쪽"]').count() == 0: break
            pg.click('nav.plz-pager a[aria-label="다음 쪽"]'); pg.wait_for_timeout(250)
        cnt[nm] = (n, seen)
    rec(f'D-5 네 게시판의 글 수를 더하면 전체({total_all}건)와 같음 · 게시판마다 그 분류의 글만', sum(v[0] for v in cnt.values()) == total_all and all(v[1] == {k} for k, v in cnt.items()), {k: (v[0], sorted(v[1])) for k, v in cnt.items()})
    open_('#/community'); pg.fill('.plz-find input[name=q]', '권리금'); pg.press('.plz-find input[name=q]', 'Enter'); pg.wait_for_timeout(450)
    rs = pg.evaluate(ROWS)
    rec('D-6 검색(권리금) — 주소에 q 가 실림 · 제목에 그 낱말이 있는 글만 · 결과 건수 안내', 'q=' in pg.evaluate('location.hash') and rs and all('권리금' in r[0] for r in rs) and pg.locator('.plz-found').count() == 1 and f'{len(rs)}건' in pg.inner_text('.plz-found') and pg.input_value('.plz-find input[name=q]') == '권리금', (pg.evaluate('location.hash'), [r[0] for r in rs][:3]))
    hs = pg.evaluate(HREF, '.plz-tabs a')
    rec('D-7 검색 중에 탭 링크가 검색어를 잃지 않음(투표 탭 제외)', all('q=' in h for h in hs[:5]) and hs[5] == '#/community/polls', hs)
    pg.click('.plz-tabs a:text-is("소개 후기")'); pg.wait_for_timeout(350)
    rec('D-8 검색 + 탭(소개 후기) — 둘 다 주소에 · 맞는 글이 없으면 빈 안내와 「검색 지우기」', 'board=REVIEW' in pg.evaluate('location.hash') and 'q=' in pg.evaluate('location.hash') and (pg.locator('.plz-empty').count() == 1 or all('권리금' in r[0] and r[1] == '소개 후기' for r in pg.evaluate(ROWS))), pg.evaluate('location.hash'))
    pg.click('.plz-found a, .plz-empty a'); pg.wait_for_timeout(350)
    rec('D-9 「검색 지우기」 — 검색어만 빠지고 게시판은 남음', pg.evaluate('location.hash') == '#/community?board=REVIEW' and pg.input_value('.plz-find input[name=q]') == '', pg.evaluate('location.hash'))
    open_('#/community?q=%EC%97%86%EB%8A%94%EB%82%B1%EB%A7%90zz')
    rec('D-10 없는 낱말 — 빈 안내 · 쪽 번호 없음', pg.locator('.plz-empty').count() == 1 and pg.locator('table.plz-tbl tbody tr').count() == 0 and pg.locator('nav.plz-pager').count() == 0, '')
    open_('#/community?page=9999')
    rec('D-11 없는 쪽(9999) — 빈 안내 + 1쪽으로 가는 링크', pg.locator('.plz-empty').count() == 1 and pg.locator('.plz-empty a[href="#/community"]').count() == 1, pg.inner_text('.plz-body')[:80])
    open_('#/community'); pg.click('.plz-find button'); pg.wait_for_timeout(300)
    rec('D-12 빈 검색어로 단추를 누르면 안내 글(아무 일도 없는 단추가 아님)', bool(pg.evaluate(TOAST)), pg.evaluate(TOAST))
    pg.click('#screen header.b2-hd .b2-nav a:text-is("안심소개")'); pg.wait_for_timeout(500); a1 = (pg.evaluate(SCR), pg.locator('#screen header.hd').count(), pg.locator('#screen header.b2-hd').count())
    pg.click('#screen header.hd a:text-is("소개광장")'); pg.wait_for_timeout(500); a2 = (pg.locator('#screen header.hd').count(), pg.locator('#screen header.b2-hd').count(), len(pg.evaluate(ROWS)))
    rec('D-13 관을 옮기면 머리줄이 바뀜 — 소개광장 → 안심소개(옛 머리줄) → 머리줄의 「소개광장」(새 머리줄 · 목록 10줄)', a1 == ('listl', 1, 0) and a2 == (0, 1, 10), (a1, a2))

    # ── E ── 하위 화면
    open_('#/community'); pg.click('table.plz-tbl tbody tr:nth-child(4) td a'); pg.wait_for_timeout(450)
    d4 = DESIGN[3]
    rec('E-1 넷째 줄을 누르면 그 글의 상세 — 주소 #/community/{번호} · 제목 · 분류 배지 · 작성자 · 날짜 · 조회가 그 줄과 같음', pg.evaluate(SCR) == 'cmud' and re.fullmatch(r'#/community/\d+', pg.evaluate('location.hash')) and pg.inner_text('.plz-post h1').strip() == d4[0] and pg.inner_text('.plz-post .plz-bd').strip() == d4[1] and all(x in pg.inner_text('.plz-post .plz-meta') for x in (d4[2], d4[3], d4[4])) and 'SB-HOM-CMU-020' in pg.inner_text('#screen'), (pg.evaluate('location.hash'), pg.inner_text('.plz-post header')[:120] if pg.locator('.plz-post header').count() else ''))
    rec('E-2 글 상세 — 새 머리줄 · 낮은 띠 · 알약 탭에서 그 글의 게시판(업종 이야기)이 남색 · 「목록으로」', pg.locator('#screen header.b2-hd').count() == 1 and pg.locator('.plz-hero.sm').count() == 1 and pg.inner_text('.plz-tabs a[aria-current=page]').strip() == d4[1] and pg.locator('.plz-body a.plz-back').count() == 1, '')
    h_d = pg.evaluate('location.hash'); pg.reload(); pg.wait_for_timeout(900)
    rec('E-3 글 상세를 새로 고쳐도 같은 글', pg.inner_text('.plz-post h1').strip() == d4[0] and pg.evaluate('location.hash') == h_d, pg.evaluate('location.hash'))
    pg.click('.plz-body a.plz-back'); pg.wait_for_timeout(400)
    rec('E-4 「목록으로」 → 소개광장 목록', pg.evaluate(SCR) == 'cmu' and len(pg.evaluate(ROWS)) == 10, pg.evaluate(SCR))
    open_('#/community/1')
    cm = pg.inner_text('.plz-body')
    rec('E-5 첫 글 — 본문 · 댓글(작성자 가림 「박OO」) · 댓글 달기(남색) · 신고 · 이름 전체가 없음', '당사자끼리 직접' in cm and '박OO' in cm and css(pg, '.plz-body [data-plz=cmt]', 'backgroundColor') == NAVY and '소개하니' not in cm, cm[:160])
    pg.fill('.plz-body textarea', '시험 댓글입니다'); pg.click('.plz-body [data-plz=cmt]'); pg.wait_for_timeout(250); t1 = pg.evaluate(TOAST)
    rec('E-6 댓글 달기 — 안내 글이 뜸(시연)', '댓글' in t1, t1)
    open_('#/community'); pg.click('.plz-write'); pg.wait_for_timeout(400)
    rec('E-7 글쓰기 — 주소 #/community/write · 새 머리줄 · 낮은 띠 · 제목 「글쓰기」 · 올리기 단추가 주황 · SB-HOM-CMU-030', pg.evaluate(SCR) == 'cmuw' and pg.evaluate('location.hash') == '#/community/write' and pg.locator('#screen header.b2-hd').count() == 1 and pg.locator('.plz-hero.sm').count() == 1 and pg.inner_text('.plz-body h1').strip() == '글쓰기' and css(pg, '.plz-body [data-plz=post]', 'backgroundColor') == ORANGE and 'SB-HOM-CMU-030' in pg.inner_text('#screen'), (pg.evaluate(SCR), css(pg, '.plz-body [data-plz=post]', 'backgroundColor')))
    pg.click('.plz-body [data-plz=post]'); pg.wait_for_timeout(250); t2 = pg.evaluate(TOAST)
    pg.fill('#cmuT', '소개비 세금계산서는 누가 끊나요'); pg.fill('#cmuB', '열 자를 넘기는 본문입니다. 시험으로 씁니다.'); pg.click('.plz-body [data-plz=post]'); pg.wait_for_timeout(300); t3 = pg.evaluate(TOAST)
    rec('E-8 글쓰기 — 빈 채로 누르면 무엇이 빠졌는지 안내 · 채우면 「확인 후 올라갑니다」 안내와 함께 목록으로', ('제목' in t2 or '내용' in t2) and '확인' in t3 and pg.evaluate(SCR) == 'cmu', (t2, t3, pg.evaluate(SCR)))
    open_('#/community'); pg.click('.plz-tabs a[data-polls-tab]'); pg.wait_for_timeout(450)
    tp = pg.evaluate("() => [...document.querySelectorAll('.plz-tabs a')].map(e => [e.textContent.trim(), e.getAttribute('aria-current') || '', getComputedStyle(e).backgroundColor])")
    rec('E-9 투표 — 주소 #/community/polls · 새 머리줄 · 낮은 띠 · 「이건 어때? 투표」 탭이 남색 · 제목 「이건 어때?」 · SB-HOM-CMU-040', pg.evaluate(SCR) == 'cmupoll' and pg.evaluate('location.hash') == '#/community/polls' and pg.locator('#screen header.b2-hd').count() == 1 and pg.locator('.plz-hero.sm').count() == 1 and tp[-1] == ['이건 어때? 투표', 'page', NAVY] and pg.inner_text('.plz-body h1').strip() == '이건 어때?' and 'SB-HOM-CMU-040' in pg.inner_text('#screen'), tp[-1:])
    pv = css(pg, '.plz-body [data-vote]', 'backgroundColor')
    card = pg.evaluate("() => { const c = document.querySelector('.px-card[data-voted=\"0\"]'); return c ? c.getAttribute('data-poll') : null }")
    pg.click(f'.px-card[data-poll="{card}"] [data-px=pick]'); pg.wait_for_timeout(150); pg.click(f'.px-card[data-poll="{card}"] [data-vote]'); pg.wait_for_timeout(300)
    rec('E-10 투표 단추가 남색 · 투표가 그대로 동작(고르고 누르면 「투표했습니다」)', pv == NAVY and pg.get_attribute(f'.px-card[data-poll="{card}"]', 'data-voted') == '1', (pv, card))
    pg.screenshot(path=os.path.join(OUT, 'proto_cmu_polls.png'), full_page=True)
    pg.click('.plz-tabs a:text-is("전체")'); pg.wait_for_timeout(400)
    rec('E-11 투표 화면의 「전체」 탭 → 소개광장 목록', pg.evaluate(SCR) == 'cmu' and pg.evaluate('location.hash') == '#/community', pg.evaluate('location.hash'))
    open_('#/community/9999')
    rec('E-12 없는 글 번호 — 「없는 글입니다」 + 목록으로(다른 글이 대신 나오지 않음)', '없는 글' in pg.inner_text('.plz-body') and pg.locator('.plz-post').count() == 0 and pg.locator('.plz-body a.plz-back').count() == 1, pg.inner_text('.plz-body')[:100])
    for nm, h in (('detail', '#/community/1'), ('write', '#/community/write')):
        open_(h); pg.screenshot(path=os.path.join(OUT, f'proto_cmu_{nm}.png'), full_page=True)

    # ── P ── 사진
    art = pg.evaluate("() => { const o = {}; for (const k in (window.__PLZ_ART || {})) o[k] = window.__PLZ_ART[k]; return o }")
    man = json.load(open(os.path.join(OUT, 'b2_assets.json'), encoding='utf8')); bad = []; n = 0
    for src, parts in man.items():
        if src.startswith('_'): continue
        _orig = K + '/sgb/docs/design/' + src      # v10.31.1 — 원본이 킷 밖이면 지문(design_fp)으로
        base = Image.open(_orig).convert('RGB') if os.path.exists(_orig) else None
        for name, box in parts.items():
            n += 1; key = name[:-4]; uri = art.get(key, '')
            if not uri.startswith('data:image/png;base64,'): bad.append((name, '시안에 없음')); continue
            data = base64.b64decode(uri.split(',', 1)[1]); site = open(K + '/sgb/site/public/b2/' + name, 'rb').read()
            got = Image.open(io.BytesIO(data))
            if not (data == site and got.format == 'PNG' and got.size == (box[2] - box[0], box[3] - box[1]) and (ImageChops.difference(got.convert('RGB'), base.crop(tuple(box))).getbbox() is None if base is not None else __import__('design_fp').same_fp('b2', name, data))): bad.append((name, got.format, got.size, data == site))
    rec(f'P-1 시안에 넣은 그림 {n}개 — 실제 웹의 PNG 파일과 바이트가 같고(다시 저장하지 않음) 받은 디자인의 그 자리와 점 하나 같음', n >= 6 and not bad, bad)
    open_('#/community')
    used = pg.evaluate("() => [...document.querySelectorAll('#screen header.b2-hd img, #screen .plz img, #screen footer.b2-ft img')].map(i => [i.src.slice(0, 22), i.naturalWidth > 0])")
    rec('P-2 화면의 그림은 모두 PNG(data:image/png) · 깨진 그림 0', len(used) >= 6 and all(u == ['data:image/png;base64,', True] for u in used), [u for u in used if u != ['data:image/png;base64,', True]][:3] or len(used))

    # ── M ── 좁은 화면 · 오류
    m = b.new_context(viewport={'width': 390, 'height': 844}); mp = m.new_page(); over = []
    mp.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
    mp.on('pageerror', lambda e: errs.append('pageerror(390): ' + str(e)[:160]))
    for h in ('#/community', '#/community/1', '#/community/write', '#/community/polls'):
        mp.goto('file://' + FILE + h); mp.wait_for_timeout(700)
        mp.evaluate("() => document.querySelectorAll('.admask,.adfloat').forEach(e => e.remove())")
        o = mp.evaluate("() => ({ sw: document.scrollingElement.scrollWidth, iw: window.innerWidth })"); over.append((h, o['sw'], o['iw']))
    rec('M-1 390px — 목록 · 글 상세 · 글쓰기 · 투표에서 가로 넘침 없음', all(o[1] <= o[2] + 1 for o in over), over)
    mp.goto('file://' + FILE + '#/community'); mp.wait_for_timeout(700)
    tops = mp.evaluate("() => [...document.querySelectorAll('nav.plz-pager > *')].map(e => Math.round(e.getBoundingClientRect().top))")
    rec('M-2 390px — 쪽 번호가 한 줄(「›」가 다음 줄로 넘어가지 않음)', len(tops) >= 9 and len(set(tops)) == 1, tops)
    mp.screenshot(path=os.path.join(OUT, 'proto_cmu_390.png'), full_page=True); m.close()
    rec('Z-0 화면 오류 0', not errs, errs[:4])
    b.close()


if __name__ == '__main__':
    try:
        with sync_playwright() as p: main(p)
    except Exception as ex:
        import traceback; traceback.print_exc(); rec('실행 중 오류', False, repr(ex)[:300])
    ok = sum(1 for r in R if r['ok'])
    json.dump({'items': R, 'pass': ok, 'total': len(R)}, open(os.path.join(OUT, 'proto_cmu.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'통과 {ok} / {len(R)}')
