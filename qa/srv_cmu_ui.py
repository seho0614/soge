"""v10.23 소개광장 — 실제 웹 화면 점검(제시 디자인 적용). 사용자 웹(5174) + API(3000) + 개발 DB. 결과: srv_cmu_ui.json · srv_cmu_ui_*.png

  H. 두 관 전용 머리줄 · 바닥줄   그림 로고 · 메뉴 · 주황 「무료 회원가입」 · 장바구니 · 바닥줄(사업자 정보 · 통신판매중개자 고지 유지)
  L. 목록(제시 디자인)            사진 띠 · 게시글 검색 · 알약 탭 6개 · 표 · 분류 배지 3색 · 쪽 번호 · 글쓰기
  S. 검색 · 쪽 넘김 · 탭          주소에 값이 실리고, 서로의 값을 잃지 않음
  D. 하위 화면                   글 상세 · 글쓰기 · 투표 — 같은 머리줄 · 같은 색
  P. 사진                        받은 PNG 에서 자른 그대로(형식 · 크기 · 점의 값)
  O. 다른 화면                   소개광장 밖은 머리줄 · 바닥줄이 지금 그대로
  M. 좁은 화면(390px)             가로 넘침 없음

사용: python3 srv_cmu_ui.py     SITE=http://localhost:5174 · API=http://localhost:3000 · DB=…
시험 글은 srv_cmu.py 와 같은 방식(표식을 달아 넣고 끝에 지움)입니다.
"""
import io, json, os, re, sys, urllib.request
from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright
import srv_cmu as C
from detail_fixture import call, q, member, login, PW

SITE = os.environ.get('SITE', 'http://localhost:5174').rstrip('/')
K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
if not os.path.isdir(K + '/sgb'): K = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.dirname(os.path.abspath(__file__))
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:400]})
    print('ok  ' if ok else 'FAIL', step, '' if ok else str(detail)[:300], file=sys.stderr)

NAVY = 'rgb(0, 36, 90)'; ORANGE = 'rgb(245, 160, 8)'
BADGE = {'소개 후기': ('rgb(254, 243, 224)', 'rgb(247, 128, 19)'), '질문': ('rgb(235, 243, 255)', 'rgb(19, 98, 244)'), '업종 이야기': ('rgb(241, 238, 254)', 'rgb(105, 62, 221)')}
CSS = "([sel, prop]) => { const e = document.querySelector(sel); return e ? getComputedStyle(e)[prop] : null }"
def css(page, sel, prop): return page.evaluate(CSS, [sel, prop])
BOX = "(sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }"
TXT = "(sel) => [...document.querySelectorAll(sel)].map(e => e.textContent.trim())"
HREF = "(sel) => [...document.querySelectorAll(sel)].map(e => e.getAttribute('href'))"
OVER = "() => ({ sw: document.scrollingElement.scrollWidth, iw: window.innerWidth })"


def main(p):
    adm = login('admin@x.com'); adm_id = q("select id from accounts where email='admin@x.com'")
    A = member('cmuu', '김가람'); B = member('cmuv', '이서준')
    deal = q("select id from deals where status in ('CONFIRMED','FULFILLED','CLOSED') and buyer_account_id is not null order by created_at limit 1")
    rev_author = q(f"select buyer_account_id from deals where id='{deal}'")
    ids = []
    for i in range(14): ids.append(C.put('TRADE', A['id'], f'업종 이야기 {i:02d}', f'본문 {i:02d} 입니다. 열 글자를 넘깁니다. {C.KW}', 3 + i))
    for i in range(6):  ids.append(C.put('QNA', B['id'], f'질문 {i:02d} 권리금', f'질문 본문 {i:02d} 입니다. 열 글자를 넘깁니다.', 30 + i))
    C.sql(f"UPDATE posts SET views = 1204, comment_count = 0 WHERE id='{ids[0]}'")
    rv = None
    if deal and rev_author:
        rv = __import__('uuid').uuid4().hex; rv = f'{rv[:8]}-{rv[8:12]}-4{rv[13:16]}-a{rv[17:20]}-{rv[20:32]}'
        C.sql(f"INSERT INTO posts(id, board, author_id, title, body, deal_id, created_at) VALUES ('{rv}','REVIEW','{rev_author}','{C.MARK} 소개 후기 한 건','후기 본문입니다. 열 글자를 넘깁니다.','{deal}', now() - interval '50 days'); UPDATE posts SET state='PUBLISHED' WHERE id='{rv}'")
    notice = C.put('NOTICE', adm_id, '공지 검수 안내', '운영 공지의 본문입니다. 열 글자를 넘깁니다.', 70, pinned=True)
    n_pub = 14 + 6 + (1 if rv else 0) + 1
    st, c1 = call('POST', f'/me/community/posts/{ids[0]}/comments', B['tok'], {'body': '댓글 본문입니다 — 세금계산서는 누가 끊나요'}); assert st < 300, (st, c1)
    total = int(q("select count(*) from posts where state='PUBLISHED'"))
    gw = [g for g in call('GET', '/gwans')[1] if g.get('isActive') is not False]
    from importlib import import_module
    try: GP = import_module('web_main').GWAN_PATH
    except Exception: GP = {'MNY': 'money', 'MAL': 'mall', 'BIZ': 'biz', 'HLT': 'health'}
    gnav = [g for g in gw if GP.get(g['code'])]

    b = p.chromium.launch(); errs = []
    ctx = b.new_context(viewport={'width': 1500, 'height': 1000}); pg = ctx.new_page()
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)[:160]))
    pg.on('console', lambda m: errs.append('console: ' + m.text[:160]) if m.type == 'error' and 'favicon' not in m.text and not any(h in ((m.location or {}).get('url') or '') for h in ('fonts.googleapis.com', 'fonts.gstatic.com')) else None)   # v10.29 — 바깥 글꼴(Google Fonts) 받기 실패는 검정 환경 탓이라 뺌
    M = '%5B' + C.MARK[1:-1] + '%5D'                                  # 표식 — 주소용
    pg.goto(f'{SITE}/community?q={M}', wait_until='networkidle')

    # ── H ── 머리줄 · 바닥줄
    rec('H-1 새 머리줄(header.b2-hd)이 있고 옛 머리줄(header.hd) · 옛 바닥줄(footer.ft)은 없음', pg.locator('header.b2-hd').count() == 1 and pg.locator('header.pc-hd').count() == 0 and pg.locator('footer.pc-ft').count() == 0 and pg.locator('footer.b2-ft').count() == 1,   # v10.29 — 공통 머리줄 header.hd → header.pc-hd · footer.ft → footer.pc-ft(시안 모양)
        [pg.locator(s).count() for s in ('header.b2-hd', 'header.pc-hd', 'footer.pc-ft', 'footer.b2-ft')])   # v10.29 — 공통 머리줄 header.hd → header.pc-hd · footer.ft → footer.pc-ft(시안 모양)
    lg = pg.evaluate("() => { const i = document.querySelector('header.b2-hd .b2-logo img'); return i ? [i.getAttribute('src'), i.naturalWidth, i.naturalHeight, i.alt, i.closest('a').getAttribute('href')] : null }")
    rec('H-2 로고 — 받은 그림에서 자른 PNG(/b2/logo.png · 866×210) · 메인으로 감', lg == ['/b2/logo.png', 866, 210, '소개뱅크', '/'], lg)
    nav_t = pg.evaluate(TXT, 'header.b2-hd .b2-nav a'); nav_h = pg.evaluate(HREF, 'header.b2-hd .b2-nav a')
    rec('H-3 메뉴 — 관 이름 그대로(v10.25 — 「소개몰」) + 소개광장 + 이용안내', nav_t == [g['name'] for g in gnav] + ['소개광장', '이용안내'] and nav_h == ['/' + GP[g['code']] for g in gnav] + ['/community', '/guide'] and '소개몰' in nav_t and '소개뱅크몰' not in nav_t, (nav_t, nav_h))
    cur = pg.evaluate("() => [...document.querySelectorAll('header.b2-hd .b2-nav a[aria-current=page]')].map(e => [e.textContent.trim(), getComputedStyle(e).color, getComputedStyle(e, '::after').backgroundColor])")
    rec('H-4 지금 화면 표시 — 「소개광장」에 남색 글자 · 주황 밑줄', cur == [['소개광장', NAVY, ORANGE]], cur)
    rec('H-5 「무료 회원가입」 — 주황 바탕 · 흰 글자 · 알약 모양 → /signup', css(pg, 'header.b2-hd a.b2-join', 'backgroundColor') == ORANGE and css(pg, 'header.b2-hd a.b2-join', 'color') == 'rgb(255, 255, 255)' and pg.get_attribute('header.b2-hd a.b2-join', 'href') == '/signup' and float(css(pg, 'header.b2-hd a.b2-join', 'borderTopLeftRadius').replace('px', '')) >= 20,
        [css(pg, 'header.b2-hd a.b2-join', x) for x in ('backgroundColor', 'color', 'borderTopLeftRadius')])
    # v10.40 — 시안 SPOP: 머리줄 돋보기(.b2-find)는 검색 팝업을 엽니다(전: /search 링크 · 대표 지시 2026-10-14 결과는 팝업에서)
    pg.click('header.b2-hd button.b2-find'); pg.wait_for_timeout(500)
    popn = pg.locator('.pc-spop.on #spopq').count(); pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    rec('H-6 로그인 → /login · 돋보기 → 검색 팝업(v10.40 시안) · 장바구니 → /health/cart(숫자 0)', pg.get_attribute('header.b2-hd a.b2-login', 'href') == '/login' and popn == 1 and pg.locator('.pc-spop.on').count() == 0 and pg.get_attribute('header.b2-hd a.b2-cart', 'href') == '/health/cart' and pg.inner_text('header.b2-hd a.b2-cart .b2-cartn').strip() == '0',
        [pg.get_attribute('header.b2-hd a.b2-login', 'href'), popn, pg.get_attribute('header.b2-hd a.b2-cart', 'href')])
    pg.click('header.b2-hd .b2-lang summary'); pg.wait_for_timeout(150)
    rec('H-7 「KR」 — 누르면 목록이 열리고 「한국어」가 선택됨 · 다른 언어는 준비 중이라고 적혀 있음', pg.locator('header.b2-hd .b2-lang[open]').count() == 1 and '한국어' in pg.inner_text('header.b2-hd .b2-lang') and '준비 중' in pg.inner_text('header.b2-hd .b2-lang'), pg.inner_text('header.b2-hd .b2-lang')[:80])
    pg.click('header.b2-hd .b2-lang summary')
    hb = pg.evaluate(BOX, 'header.b2-hd')
    rec('H-8 머리줄 높이 75px(±3) · 화면 위에 붙어 있음', hb and abs(hb[3] - 75) <= 3 and hb[1] == 0, hb)
    ft = pg.inner_text('footer.b2-ft')
    fl = pg.evaluate("() => { const i = document.querySelector('footer.b2-ft .b2-logo img'); return i ? [i.getAttribute('src'), i.naturalWidth, i.naturalHeight] : null }")
    rec('H-9 바닥줄 — 로고(/b2/logo-ft.png · 802×200) · 「서비스 소개」 · 약관 링크 · © 올해 · All rights reserved.', fl == ['/b2/logo-ft.png', 802, 200] and '서비스 소개' in ft and '이용약관' in ft and '개인정보처리방침' in ft and '고객센터' in ft and re.search(r'20\d\d 소개뱅크\. All rights reserved\.', ft), (fl, ft[:160]))
    sns = pg.evaluate("() => [...document.querySelectorAll('footer.b2-ft .b2-sns [data-sns]')].map(e => [e.getAttribute('data-sns'), e.querySelector('img').getAttribute('src'), e.querySelector('img').naturalWidth])")
    rec('H-10 사회관계망 아이콘 3개(페이스북 · 인스타그램 · 유튜브) — 받은 그림에서 자른 PNG · 설정의 주소로', [s[0] for s in sns] == ['sns.facebook', 'sns.instagram', 'sns.youtube'] and [s[1] for s in sns] == ['/b2/sns-1.png', '/b2/sns-2.png', '/b2/sns-3.png'] and all(s[2] in (120, 121) for s in sns), sns)
    st_, pub = call('GET', '/site-settings/public')
    rec('H-11 법정 표시가 그대로 있음 — 사업자등록번호 · 통신판매업 신고 · 통신판매중개자 고지(공통 바닥줄과 같은 값)', all(str(pub.get(k) or '') in ft for k in ('footer.biz_reg_no', 'footer.mail_order_no', 'legal.intermediary_notice') if pub.get(k)) and '사업자등록번호' in ft and '통신판매' in ft, ft[-260:])
    quick = pg.evaluate(HREF, 'footer.b2-ft .b2-quick a')
    rec('H-12 새 머리줄에서 빠진 곳을 바닥줄 바로가기로 — 소개받기 · 파트너센터 2곳 · 나의공간 · 알림', all(h in quick for h in ('/request', '/partners', '/partner', '/my', '/my/notifications')), quick)

    # ── L ── 목록
    hero = pg.evaluate(BOX, '.plz-hero'); h1 = pg.evaluate("() => { const e = document.querySelector('.plz-hero h1'); return e ? [e.textContent.trim(), getComputedStyle(e).color, parseFloat(getComputedStyle(e).fontSize), getComputedStyle(e).fontWeight] : null }")
    rec('L-1 사진 띠 — 화면 폭 전체 · 높이 303px(±6) · 머리줄 바로 아래', hero and hero[0] == 0 and abs(hero[2] - 1500) <= 1 and abs(hero[3] - 303) <= 6 and abs(hero[1] - 75) <= 3, hero)
    rec('L-2 제목 「소개광장」 — 남색 · 굵게 · 40px 이상', h1 and h1[0] == '소개광장' and h1[1] == NAVY and h1[2] >= 40 and int(h1[3]) >= 700, h1)
    rec('L-3 한 줄 설명 · 안내 3줄(첫 줄 남색 굵게)', pg.inner_text('.plz-hero .plz-lead').strip() == '소개 후기와 업종 이야기가 모이는 자리입니다.' and pg.evaluate(TXT, '.plz-hero .plz-note > *') == ['누구나 쓰실 수 있습니다.', '다만, 첫 글은 확인 후 올라갑니다 - 보통 하루 안에 끝납니다.', '소개 후기는 성사된 거래가 있어야 쓰실 수 있습니다.'] and css(pg, '.plz-hero .plz-note b', 'color') == NAVY,
        pg.evaluate(TXT, '.plz-hero .plz-note > *'))
    mg = pg.evaluate("() => { const i = document.querySelector('.plz-hero img.plz-mega'); return i ? [i.getAttribute('src'), i.naturalWidth, i.naturalHeight, i.alt] : null }")
    rec('L-4 확성기 — 받은 그림에서 자른 PNG(/b2/megaphone.png · 415×370) · 꾸밈 그림(alt 빈 값)', mg == ['/b2/megaphone.png', 415, 370, ''], mg)
    sf = pg.evaluate("() => { const f = document.querySelector('.plz-hero form.plz-find'); if (!f) return null; const i = f.querySelector('input[name=q]'), b = f.querySelector('button'); const r = f.getBoundingClientRect(); return [f.getAttribute('action'), (f.getAttribute('method') || 'get').toLowerCase(), i && i.placeholder, i && i.getAttribute('maxlength'), b && getComputedStyle(b).backgroundColor, b && getComputedStyle(b).borderTopLeftRadius, Math.round(r.width), Math.round(r.height), i && i.getAttribute('aria-label')] }")
    rec('L-5 게시글 검색 칸 — 「게시글을 검색해보세요.」 · 남색 둥근 단추 · 50자까지 · /community 로 보냄', sf and sf[0] == '/community' and sf[1] == 'get' and sf[2] == '게시글을 검색해보세요.' and sf[3] == '50' and sf[4] == NAVY and sf[5] == '50%' and 440 <= sf[6] <= 540 and 54 <= sf[7] <= 64 and sf[8], sf)
    tabs = pg.evaluate("() => [...document.querySelectorAll('.plz-tabs a')].map(e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return [e.textContent.trim(), e.getAttribute('aria-current') || '', s.backgroundColor, s.color, Math.round(r.width), Math.round(r.height), Math.round(parseFloat(s.borderTopLeftRadius))] })")
    rec('L-6 알약 탭 6개 — 전체 · 소개 후기 · 업종 이야기 · 질문 · 공지 · 이건 어때? 투표', [t[0] for t in tabs] == ['전체', '소개 후기', '업종 이야기', '질문', '공지', '이건 어때? 투표'], [t[0] for t in tabs])
    rec('L-7 고른 탭(전체) — 남색 바탕 · 흰 글자 / 나머지 — 흰 바탕 · 남색 글자 / 크기 150×44 · 모서리 10px', tabs and tabs[0][1:4] == ['page', NAVY, 'rgb(255, 255, 255)'] and all(t[1] == '' and t[2] == 'rgb(255, 255, 255)' and t[3] == NAVY for t in tabs[1:]) and all(abs(t[5] - 44) <= 1 and t[6] == 10 for t in tabs) and all(abs(t[4] - 150) <= 1 for t in tabs[:5]), tabs)
    rec('L-8 「이건 어때? 투표」 탭 → /community/polls', pg.get_attribute('.plz-tabs a[data-polls-tab]', 'href') == '/community/polls')
    th = pg.evaluate("() => [...document.querySelectorAll('table.plz-tbl thead th')].map(e => [e.textContent.trim(), getComputedStyle(e).color, getComputedStyle(e).backgroundColor])")
    rec('L-9 표 머리 — 제목 · 분류 · 작성자 · 작성일 · 조회 (남색 글자 · 바탕 #F7F8FA)', [t[0] for t in th] == ['제목', '분류', '작성자', '작성일', '조회'] and all(t[1] == NAVY and t[2] == 'rgb(247, 248, 250)' for t in th), th)
    rows = pg.evaluate("() => [...document.querySelectorAll('table.plz-tbl tbody tr')].map(tr => { const td = [...tr.children]; const bd = td[1].querySelector('.plz-bd'); const s = bd ? getComputedStyle(bd) : null; return { title: td[0].querySelector('a').textContent.trim(), href: td[0].querySelector('a').getAttribute('href'), pin: !!td[0].querySelector('.plz-pin'), cc: (td[0].querySelector('.plz-cc') || {}).textContent || '', board: bd ? bd.textContent.trim() : td[1].textContent.trim(), bbg: s && s.backgroundColor, bfg: s && s.color, author: td[2].textContent.trim(), date: td[3].textContent.trim(), views: td[4].textContent.trim(), h: Math.round(tr.getBoundingClientRect().height) } })")
    rec('L-10 한 쪽 10줄 · 줄 높이 44px(±2) · 고정 글(공지)이 맨 위', len(rows) == 10 and all(abs(r['h'] - 44) <= 2 for r in rows) and rows[0]['pin'] and rows[0]['board'] == '공지', (len(rows), [r['h'] for r in rows][:3], rows[0] if rows else None))
    seen_b = {r['board']: (r['bbg'], r['bfg']) for r in rows}
    pg2 = ctx.new_page(); pg2.goto(f'{SITE}/community?q={M}&page=3', wait_until='networkidle')
    for e in pg2.evaluate("() => [...document.querySelectorAll('table.plz-tbl tbody .plz-bd')].map(e => [e.textContent.trim(), getComputedStyle(e).backgroundColor, getComputedStyle(e).color])"): seen_b.setdefault(e[0], (e[1], e[2]))
    pg2.goto(f'{SITE}/community?q={M}&page=2', wait_until='networkidle')
    for e in pg2.evaluate("() => [...document.querySelectorAll('table.plz-tbl tbody .plz-bd')].map(e => [e.textContent.trim(), getComputedStyle(e).backgroundColor, getComputedStyle(e).color])"): seen_b.setdefault(e[0], (e[1], e[2]))
    pg2.close()
    need = {k: v for k, v in BADGE.items() if k != '소개 후기' or rv}
    rec(f'L-11 분류 배지 색 — {" · ".join(need)} (디자인의 값 그대로)', all(tuple(seen_b.get(k) or ()) == v for k, v in need.items()), {k: seen_b.get(k) for k in need})
    r0 = next((r for r in rows if r['title'].endswith('업종 이야기 00')), None)
    rec('L-12 줄 — 작성자 「김OO」 · 날짜 「2026.10.04」 꼴 · 조회 「1,204」 · 댓글 수 [1] · 제목은 글 상세로', r0 and r0['author'] == '김OO' and re.fullmatch(r'20\d\d\.\d\d\.\d\d', r0['date']) and r0['views'] == '1,204' and '1' in r0['cc'] and r0['href'] == f'/community/{ids[0]}', r0)
    rec('L-13 목록 어디에도 이름 전체가 없음', '김가람' not in pg.content() and '이서준' not in pg.content())
    wr = pg.evaluate("() => { const e = document.querySelector('a.plz-write'); if (!e) return null; const r = e.getBoundingClientRect(), t = document.querySelector('table.plz-tbl').getBoundingClientRect(), s = getComputedStyle(e); return [e.getAttribute('href'), s.backgroundColor, s.color, Math.round(r.width), Math.round(r.height), r.top > t.bottom, Math.abs(Math.round(r.right - t.right)) <= 2, e.textContent.trim()] }")
    rec('L-14 글쓰기 — 표 아래 오른쪽 · 주황 바탕 · 흰 글자 · 184×52 → /community/write', wr and wr[0] == '/community/write' and wr[1] == ORANGE and wr[2] == 'rgb(255, 255, 255)' and abs(wr[3] - 184) <= 2 and abs(wr[4] - 52) <= 2 and wr[5] and wr[6] and wr[7] == '글쓰기' and pg.locator('a.cmu-write').count() == 1, wr)
    pgs = pg.evaluate("() => [...document.querySelectorAll('nav.plz-pager > *')].map(e => { const s = getComputedStyle(e), r = e.getBoundingClientRect(); return [e.tagName, e.textContent.trim(), e.getAttribute('href'), e.getAttribute('aria-current') || '', s.backgroundColor, Math.round(r.width), Math.round(r.height), e.getAttribute('aria-label') || '', e.getAttribute('aria-disabled') || ''] })")
    pages = -(-n_pub // 10)
    rec(f'L-15 쪽 번호 — ‹ 1 … {pages} › · 지금 쪽은 주황 바탕 · 칸 38px · 1쪽에서는 ‹ 가 눌리지 않음', [x[1] for x in pgs] == ['‹'] + [str(i) for i in range(1, pages + 1)] + ['›'] and [x for x in pgs if x[3] == 'page'] and [x for x in pgs if x[3] == 'page'][0][1] == '1' and [x for x in pgs if x[3] == 'page'][0][4] == ORANGE and all(abs(x[6] - 38) <= 1 for x in pgs) and pgs[0][8] == 'true' and pgs[0][2] is None and pgs[-1][2] and 'page=2' in pgs[-1][2], pgs)
    tb = pg.evaluate(BOX, 'table.plz-tbl');
    rec('L-16 표 — 가로 1378px(±4) · 화면 가운데 · 테두리 #DBDBDB', tb and abs(tb[2] - 1378) <= 4 and abs((tb[0] * 2 + tb[2]) - 1500) <= 2 and css(pg, '.plz-tblw', 'borderTopColor') == 'rgb(219, 219, 219)', (tb, css(pg, '.plz-tblw', 'borderTopColor')))
    pg.screenshot(path=os.path.join(OUT, 'srv_cmu_ui_list.png'), full_page=True)

    # ── S ── 검색 · 쪽 넘김 · 탭
    pg.click('nav.plz-pager a[aria-label="다음 쪽"]'); pg.wait_for_url('**page=2**'); pg.wait_for_load_state('networkidle'); pg.wait_for_selector('nav.plz-pager [aria-current=page]:text-is("2")')
    rows2 = pg.evaluate(TXT, 'table.plz-tbl tbody tr td:first-child a')
    rec('S-1 › → 2쪽 — 주소에 page=2 · 다른 10줄 · 「2」가 주황 · 검색어 유지', 'page=2' in pg.url and 'q=' in pg.url and len(rows2) == 10 and not set(rows2) & {r['title'] for r in rows} and pg.inner_text('nav.plz-pager [aria-current=page]').strip() == '2' and pg.input_value('.plz-find input[name=q]') == C.MARK, (pg.url, len(rows2)))
    pg.click(f'nav.plz-pager a:text-is("{pages}")'); pg.wait_for_url(f'**page={pages}**'); pg.wait_for_load_state('networkidle'); pg.wait_for_selector(f'nav.plz-pager [aria-current=page]:text-is("{pages}")')
    last = pg.evaluate(TXT, 'table.plz-tbl tbody tr td:first-child a')
    rec(f'S-2 마지막 쪽({pages}) — 남은 {n_pub - 10 * (pages - 1)}줄 · › 가 눌리지 않음', len(last) == n_pub - 10 * (pages - 1) and pg.locator('nav.plz-pager [aria-label="다음 쪽"][aria-disabled=true]').count() == 1, (len(last),))
    pg.fill('.plz-find input[name=q]', f'{C.MARK} 권리금'); pg.press('.plz-find input[name=q]', 'Enter'); pg.wait_for_url('**%EA%B6%8C%EB%A6%AC%EA%B8%88**'); pg.wait_for_load_state('networkidle'); pg.wait_for_selector('.plz-found')
    t3 = pg.evaluate(TXT, 'table.plz-tbl tbody tr td:first-child a')
    rec('S-3 검색(권리금) — 질문 6건만 · 1쪽으로 돌아감 · 결과 건수 안내 · 쪽 번호는 「1」 하나', len(t3) == 6 and all('권리금' in t for t in t3) and 'page=' not in pg.url and '6건' in pg.inner_text('.plz-found') and pg.evaluate(TXT, 'nav.plz-pager > *') == ['‹', '1', '›'], (pg.url, len(t3), pg.inner_text('.plz-found') if pg.locator('.plz-found').count() else ''))
    th_ = pg.evaluate(HREF, '.plz-tabs a')
    rec('S-4 검색 중에 탭 링크가 검색어를 잃지 않음(투표 탭 제외)', all('q=' in h for h in th_[:5]) and th_[5] == '/community/polls', th_)
    pg.click('.plz-tabs a:text-is("업종 이야기")'); pg.wait_for_url('**board=TRADE**'); pg.wait_for_load_state('networkidle'); pg.wait_for_selector('.plz-tabs a[aria-current=page]:text-is("업종 이야기")')
    rec('S-5 탭(업종 이야기) — 주소에 board=TRADE · 검색어와 함께 걸려 0건 → 빈 안내 · 그 탭이 남색', 'board=TRADE' in pg.url and 'q=' in pg.url and pg.locator('table.plz-tbl tbody tr').count() == 0 and pg.locator('.plz-empty').count() == 1 and pg.inner_text('.plz-tabs a[aria-current=page]').strip() == '업종 이야기', (pg.url, pg.locator('.plz-empty').count()))
    pg.goto(f'{SITE}/community?board=QNA&q={M}', wait_until='networkidle')
    rec('S-6 주소로 바로 열어도 같은 결과(board=QNA) — 질문 6건 · 배지가 모두 「질문」', pg.locator('table.plz-tbl tbody tr').count() == 6 and set(pg.evaluate(TXT, 'table.plz-tbl tbody .plz-bd')) == {'질문'}, pg.locator('table.plz-tbl tbody tr').count())
    pg.goto(f'{SITE}/community?q=' + 'ㄱ' * 51, wait_until='networkidle')
    rec('S-7 51자 검색어 — 화면이 깨지지 않고 안내가 나옴', pg.locator('header.b2-hd').count() == 1 and pg.locator('.plz-err, .plz-empty').count() >= 1 and pg.locator('table.plz-tbl tbody tr').count() == 0, pg.inner_text('.plz-body')[:120] if pg.locator('.plz-body').count() else '')
    pg.goto(f'{SITE}/community?page=99999&q={M}', wait_until='networkidle')
    rec('S-8 없는 쪽(99999) — 빈 안내 + 1쪽으로 가는 링크', pg.locator('.plz-empty').count() == 1 and pg.locator('.plz-empty a[href*="/community"]').count() >= 1, '')
    pg.goto(f'{SITE}/community', wait_until='networkidle')
    rec(f'S-9 검색어 없이 열면 전체({total}건) — 쪽 수가 맞음', pg.evaluate(TXT, 'nav.plz-pager > *')[-2] == str(-(-total // 10)), pg.evaluate(TXT, 'nav.plz-pager > *'))

    # ── D ── 하위 화면
    pg.goto(f'{SITE}/community/{ids[0]}', wait_until='networkidle')
    dt_ = pg.inner_text('.plz-body')
    rec('D-1 글 상세 — 새 머리줄 · 낮은 띠(「소개광장」) · 제목 · 분류 배지 · 작성자 「김OO」 · 댓글 「이OO」 · 이름 전체 없음', pg.locator('header.b2-hd').count() == 1 and pg.locator('.plz-hero.sm').count() == 1 and pg.inner_text('.plz-post h1').strip().endswith('업종 이야기 00') and pg.inner_text('.plz-post .plz-bd').strip() == '업종 이야기' and '김OO' in dt_ and '이OO' in dt_ and '김가람' not in pg.content() and '이서준' not in pg.content(), dt_[:200])
    rec('D-2 글 상세 — 「목록으로」 단추(남색 테두리) → /community · 로그인하지 않으면 댓글 칸 대신 로그인 안내', pg.get_attribute('.plz-body a.plz-back', 'href') == '/community' and css(pg, '.plz-body a.plz-back', 'borderTopColor') == NAVY and pg.locator('.plz-body .cmu-cform').count() == 0 and pg.locator('.plz-body a[href="/login"]').count() >= 1, css(pg, '.plz-body a.plz-back', 'borderTopColor'))
    pg.screenshot(path=os.path.join(OUT, 'srv_cmu_ui_detail.png'), full_page=True)
    pg.goto(f'{SITE}/community/write', wait_until='networkidle')
    rec('D-3 글쓰기 — 로그인하지 않으면 /login 으로', '/login' in pg.url, pg.url)
    c2 = b.new_context(viewport={'width': 1500, 'height': 1000}); g = c2.new_page()
    g.on('pageerror', lambda e: errs.append('pageerror(로그인): ' + str(e)[:160]))
    g.goto(SITE + '/login', wait_until='networkidle'); __import__('consent_ok').agree(A['email'], PW); g.fill('input[name=email]', A['email']); g.fill('input[name=password]', PW); g.locator('button', has_text='로그인').last.click(); g.wait_for_timeout(2500)
    g.goto(f'{SITE}/community/write', wait_until='networkidle')
    rec('D-4 글쓰기(로그인) — 새 머리줄 · 낮은 띠 · 제목 「글쓰기」 · 올리기 단추가 주황', g.locator('header.b2-hd').count() == 1 and g.locator('.plz-hero.sm').count() == 1 and g.inner_text('.plz-body h1').strip() == '글쓰기' and g.locator('.plz-body form.cmu-editor').count() == 1 and css(g, '.plz-body form.cmu-editor .p2act button.p2primary', 'backgroundColor') == ORANGE, (g.url, css(g, '.plz-body form.cmu-editor .p2act button.p2primary', 'backgroundColor')))
    rec('D-4b 글쓰기의 안내 상자(첫 글은 확인 후 …) — 시안과 같은 베이지 바탕(붉은 띠가 아님)', css(g, '.plz-body form.cmu-editor .notice.warn', 'backgroundColor') == 'rgb(255, 247, 237)' and css(g, '.plz-body form.cmu-editor .notice.warn', 'borderLeftColor') != 'rgb(179, 38, 30)', (css(g, '.plz-body form.cmu-editor .notice.warn', 'backgroundColor'), css(g, '.plz-body form.cmu-editor .notice.warn', 'borderLeftColor')))
    g.screenshot(path=os.path.join(OUT, 'srv_cmu_ui_write.png'), full_page=True)
    g.goto(f'{SITE}/community/{ids[0]}', wait_until='networkidle')
    rec('D-5 내 글을 열면 수정 · 삭제가 보임(이름은 그대로 「김OO」) · 댓글 달기 단추는 남색', g.locator('.plz-body').count() == 1 and ('수정' in g.inner_text('.plz-body')) and '김가람' not in g.inner_text('.plz-body') and css(g, '.plz-body form.cmu-cform button', 'backgroundColor') == NAVY, (g.inner_text('.plz-body')[:120] if g.locator('.plz-body').count() else '', css(g, '.plz-body form.cmu-cform button', 'backgroundColor')))
    g.goto(f'{SITE}/community', wait_until='networkidle')
    g.wait_for_selector('header.b2-hd .b2-out', timeout=8000)
    hin = g.evaluate("() => ({ my: [...document.querySelectorAll('header.b2-hd a.b2-login')].map(a => [a.textContent.trim(), a.getAttribute('href')]), out: [...document.querySelectorAll('header.b2-hd button.b2-out')].map(b => b.textContent.trim()), join: document.querySelectorAll('header.b2-hd a.b2-join').length, login: document.querySelectorAll('header.b2-hd a[href=\"/login\"]').length })")
    rec('D-6 로그인한 사람의 머리줄 — 「나의공간」(/my) · 「로그아웃」으로 바뀌고 「로그인 · 무료 회원가입」은 없음 · 목록은 같은 모양', hin['my'] == [['나의공간', '/my']] and hin['out'] == ['로그아웃'] and hin['join'] == 0 and hin['login'] == 0 and g.locator('table.plz-tbl tbody tr').count() == min(10, total) and re.fullmatch(r'\d+', g.inner_text('header.b2-hd .b2-cartn').strip()), hin)
    cc0 = g.evaluate("async () => { const r = await fetch('/cart-count'); return [r.status, await r.json()] }")
    code = q("select code from hlt_products where status='ON_SALE' and stock > 0 and (select count(*) from hlt_product_options o where o.product_id=hlt_products.id and o.is_active)=1 order by code limit 1")
    put_ = g.evaluate("async (c) => { const r = await fetch('/api/v1/me/health/cart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productCode: c, qty: 1 }) }); return r.status }", code)
    g.goto(f'{SITE}/community', wait_until='networkidle'); g.wait_for_timeout(400)
    # v10.31 (w1) — /cart-count 가 알림 수(bell) · 운영 여부(ops)도 함께 돌려줌 → n · in 만 견줌 / 메뉴 「이용안내」는 새 화면 /guide 로(전: /support)
    rec('D-6b 장바구니 숫자 — 담기 전 0 → 상품 1가지를 담으면 머리줄 숫자 1(로그인한 사람의 것)', cc0[0] == 200 and {k: cc0[1].get(k) for k in ('n', 'in')} == {'n': 0, 'in': True} and put_ in (200, 201) and g.inner_text('header.b2-hd .b2-cartn').strip() == '1', (cc0, put_, code, g.inner_text('header.b2-hd .b2-cartn')))
    g.click('header.b2-hd button.b2-out'); g.wait_for_selector('header.b2-hd a.b2-join', timeout=8000); g.wait_for_timeout(400)
    out = g.evaluate("async () => { const r = await fetch('/cart-count'); return await r.json() }")
    rec('D-6d 「로그아웃」 — 머리줄이 「로그인 · 무료 회원가입」으로 돌아오고 · 로그인 쿠키가 지워지고 · 장바구니 숫자 0', g.locator('header.b2-hd a.b2-login[href="/login"]').count() == 1 and not any(c['name'] in ('sgb_at', 'sgb_rt') for c in c2.cookies()) and {k: out.get(k) for k in ('n', 'in')} == {'n': 0, 'in': False} and g.inner_text('header.b2-hd .b2-cartn').strip() == '0', (out, [c['name'] for c in c2.cookies()]))
    g.goto(f'{SITE}/community/write', wait_until='networkidle')
    rec('D-6e 로그아웃한 뒤 글쓰기 주소 → 로그인 화면으로', '/login' in g.url, g.url)
    c2.close()
    an = pg.evaluate("async () => { const r = await fetch('/cart-count'); return [r.status, await r.json(), r.headers.get('cache-control')] }")
    rec('D-6c 로그인하지 않은 사람 — /cart-count 는 200 · 0 · 캐시하지 않음(브라우저 오류 기록이 남지 않음)', an[0] == 200 and {k: an[1].get(k) for k in ('n', 'in')} == {'n': 0, 'in': False} and an[1].get('ops') is False and 'no-store' in (an[2] or ''), an)
    pg.goto(f'{SITE}/community/polls', wait_until='networkidle')
    tp = pg.evaluate("() => [...document.querySelectorAll('.plz-tabs a')].map(e => [e.textContent.trim(), e.getAttribute('aria-current') || '', getComputedStyle(e).backgroundColor])")
    rec('D-7 투표 — 새 머리줄 · 낮은 띠 · 알약 탭에서 「이건 어때? 투표」가 남색 · 제목 「이건 어때?」', pg.locator('header.b2-hd').count() == 1 and pg.locator('.plz-hero.sm').count() == 1 and [t[0] for t in tp][-1] == '이건 어때? 투표' and tp[-1][1:] == ['page', NAVY] and pg.inner_text('.plz-body h1').strip() == '이건 어때?', tp)
    pb = css(pg, '.plz-body [data-vote]', 'backgroundColor'); pk = css(pg, '.plz-body .poll-kind', 'color')
    rec('D-8 투표 단추 · 종류 표시가 남색(옛 파랑 #1B4D8F 이 아님) — 열린 투표가 없으면 종류 표시만 봄', (pb == NAVY or (pb is None and pg.locator('.plz-body [data-vote]').count() == 0)) and pk in (NAVY, None) and (pb or pk), (pb, pk))
    pg.screenshot(path=os.path.join(OUT, 'srv_cmu_ui_polls.png'), full_page=True)
    pg.goto(f'{SITE}/community/00000000-0000-4000-a000-000000000000', wait_until='networkidle')
    rec('D-9 없는 글 — 새 머리줄 그대로 · 「없는 글입니다」 · 목록으로', pg.locator('header.b2-hd').count() == 1 and '없는 글' in pg.inner_text('.plz-body') and pg.locator('.plz-body a[href="/community"]').count() >= 1, '')

    # ── P ── 사진
    man = json.load(open(os.path.join(OUT, 'b2_assets.json'), encoding='utf8')); bad = []; n = 0
    for src, parts in man.items():
        if src.startswith('_'): continue
        _orig = K + '/sgb/docs/design/' + src      # v10.31.1 — 원본이 킷 밖이면 지문(design_fp)으로
        base = Image.open(_orig).convert('RGB') if os.path.exists(_orig) else None
        for name, box in parts.items():
            n += 1
            try:
                raw = urllib.request.urlopen(f'{SITE}/b2/{name}', timeout=30); ctype = raw.headers.get('content-type', ''); data = raw.read()
                got = Image.open(io.BytesIO(data))
                if not (got.format == 'PNG' and ctype.startswith('image/png') and data[:8] == b'\x89PNG\r\n\x1a\n' and got.size == (box[2] - box[0], box[3] - box[1]) and (ImageChops.difference(got.convert('RGB'), base.crop(tuple(box))).getbbox() is None if base is not None else __import__('design_fp').same_fp('b2', name, data))): bad.append((name, got.format, got.size))
            except Exception as ex: bad.append((name, repr(ex)[:60]))
    rec(f'P-1 사용자 웹이 내주는 그림 {n}개 — PNG 그대로 · 크기 그대로 · 받은 디자인의 그 자리와 점 하나 같음', n >= 6 and not bad, bad)
    used = set(re.findall(r'/b2/[\w.-]+\.(?:png|jpe?g|webp|gif|svg)', urllib.request.urlopen(f'{SITE}/community', timeout=30).read().decode('utf8', 'ignore')))
    rec('P-2 화면이 쓰는 그림은 모두 PNG — 다른 형식(jpg · webp)으로 바꿔 내주지 않음(/_next/image 를 거치지 않음)', used and all(u.endswith('.png') for u in used) and '/_next/image' not in urllib.request.urlopen(f'{SITE}/community', timeout=30).read().decode('utf8', 'ignore'), sorted(used))

    # ── O ── 다른 화면은 그대로
    keep = []
    # v10.25 — 새 머리줄 · 바닥줄은 두 관(소개광장 · 소개몰)에서 씁니다(10/7 결정). 전에는 /health · /health/cart 도 「그대로여야 하는 화면」에 넣어 두었습니다
    # v10.30 — 소개장터 **메인**(/money)은 10/9 제시 디자인이라 두 관 전용 머리줄 · 바닥줄을 씁니다(색조 money · site_mny.py 가 봄). 그 아래 화면(/money/list)은 그대로라 여기서는 그것을 봅니다
    for u in ['/money/list', '/mall', '/biz', '/my', '/search', '/support', '/request', '/partners', '/login']:
        pg.goto(SITE + u, wait_until='networkidle')
        keep.append((u, pg.locator('header.pc-hd').count(), pg.locator('header.b2-hd').count(), pg.locator('footer.b2-ft').count()))   # v10.29 — 공통 머리줄 header.hd → header.pc-hd · footer.ft → footer.pc-ft(시안 모양)
    rec('O-1 두 관(소개광장 · 소개몰) 밖의 화면 9곳 — 옛 머리줄 그대로 · 새 머리줄 · 새 바닥줄 없음', all(k[1] == 1 and k[2] == 0 and k[3] == 0 for k in keep), [k for k in keep if not (k[1] == 1 and k[2] == 0 and k[3] == 0)])
    two = []
    for u in ['/health', '/health/direct', '/health/guide']:
        pg.goto(SITE + u, wait_until='networkidle'); two.append((u, pg.locator('header.pc-hd').count(), pg.locator('header.b2-hd').count(), pg.locator('footer.b2-ft').count()))   # v10.29 — 공통 머리줄 header.hd → header.pc-hd · footer.ft → footer.pc-ft(시안 모양)
    rec('O-1b 소개몰(메인 · 직판관 · 이용안내)은 소개광장과 같은 새 머리줄 · 새 바닥줄(v10.25)', all(k[1] == 0 and k[2] == 1 and k[3] == 1 for k in two), two)
    pg.goto(SITE + '/', wait_until='networkidle')
    rec('O-2 메인(/) — 메인 전용 머리줄 그대로(새 머리줄 · 옛 머리줄 없음)', pg.locator('header.home-hd').count() == 1 and pg.locator('header.b2-hd').count() == 0 and pg.locator('header.pc-hd').count() == 0, '')   # v10.29 — 공통 머리줄 header.hd → header.pc-hd · footer.ft → footer.pc-ft(시안 모양)
    pg.goto(SITE + '/community', wait_until='networkidle'); pg.click('header.b2-hd .b2-nav a:text-is("안심소개")'); pg.wait_for_url('**/mall**'); pg.wait_for_load_state('networkidle'); pg.wait_for_timeout(300)
    a1 = (pg.locator('header.pc-hd').count(), pg.locator('header.b2-hd').count())   # v10.29 — 공통 머리줄 header.hd → header.pc-hd · footer.ft → footer.pc-ft(시안 모양)
    pg.click('header.pc-hd a:text-is("소개광장")'); pg.wait_for_url('**/community**'); pg.wait_for_load_state('networkidle'); pg.wait_for_timeout(300)   # v10.29 — 공통 머리줄 header.hd → header.pc-hd · footer.ft → footer.pc-ft(시안 모양)
    a2 = (pg.locator('header.pc-hd').count(), pg.locator('header.b2-hd').count())   # v10.29 — 공통 머리줄 header.hd → header.pc-hd · footer.ft → footer.pc-ft(시안 모양)
    rec('O-3 화면을 옮겨 다닐 때 머리줄이 바뀜 — 소개광장 → 안심소개(옛 머리줄) → 소개광장(새 머리줄) · 새로 고침 없이', a1 == (1, 0) and a2 == (0, 1), (a1, a2))

    # ── M ── 좁은 화면
    m = b.new_context(viewport={'width': 390, 'height': 844}); mp = m.new_page(); over = []
    mp.on('pageerror', lambda e: errs.append('pageerror(390): ' + str(e)[:160]))
    for u in [f'/community?q={M}', f'/community/{ids[0]}', '/community/polls']:
        mp.goto(SITE + u, wait_until='networkidle'); o = mp.evaluate(OVER); over.append((u[:24], o['sw'], o['iw']))
    rec('M-1 390px — 목록 · 글 상세 · 투표에서 가로 넘침 없음', all(o[1] <= o[2] + 1 for o in over), over)
    mp.goto(f'{SITE}/community?q={M}', wait_until='networkidle')
    mrow = mp.evaluate("() => { const tr = document.querySelector('table.plz-tbl tbody tr'); const a = tr && tr.querySelector('td a'); return a ? [Math.round(a.getBoundingClientRect().width), getComputedStyle(document.querySelector('.plz-find')).display !== 'none', document.querySelectorAll('.plz-tabs a').length] : null }")
    rec('M-2 390px — 제목 칸이 200px 이상 · 검색 칸 · 탭 6개가 그대로 있음', mrow and mrow[0] >= 200 and mrow[1] and mrow[2] == 6, mrow)
    tops = mp.evaluate("() => [...document.querySelectorAll('nav.plz-pager > *')].map(e => Math.round(e.getBoundingClientRect().top))")
    rec('M-3 390px — 쪽 번호가 한 줄(「›」가 다음 줄로 넘어가지 않음)', len(tops) >= 5 and len(set(tops)) == 1, tops)
    mp.screenshot(path=os.path.join(OUT, 'srv_cmu_ui_390.png'), full_page=True); m.close()

    rec('Z-0 화면 오류(스크립트 · 수화) 0', not errs, errs[:4])
    b.close()


if __name__ == '__main__':
    try:
        with sync_playwright() as p: main(p)
    except Exception as ex:
        import traceback; traceback.print_exc(); rec('실행 중 오류', False, repr(ex)[:300])
    finally:
        try: rec('Z-1 시험 글을 모두 지움(개발 DB 에 남기지 않음)', C.cleanup())
        except Exception as ex: rec('Z-1 시험 글을 모두 지움(개발 DB 에 남기지 않음)', False, repr(ex)[:200])
    ok = sum(1 for r in R if r['ok'])
    json.dump({'items': R, 'pass': ok, 'total': len(R)}, open(os.path.join(OUT, 'srv_cmu_ui.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'통과 {ok} / {len(R)}')
