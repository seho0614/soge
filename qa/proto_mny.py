"""v10.30 시안 — 소개장터 메인(#/g/mny · SB-MNY-MAIN-010)을 제시 디자인(2026-10-09)대로. 결과: proto_mny.json  (바탕 = v10.28 시안 — v10.29 는 시안을 바꾸지 않았습니다)

  A. 틀           새 머리줄 · 바닥줄(색조 money)은 소개장터 메인 한 장에만 더해짐 — 소개광장 5장은 그대로, 그 밖의 화면은 옛 머리줄 그대로
  B. 그림 그대로   구역 · 글자 · 숫자가 받은 그림과 같음(제목 · 키워드 5 · 바로가기 3 · 분야 14 · 분류 목록 · 업체 4 · 요청 4 · AI 4 · 사례 3 · 등록)
  C. 그림          넣은 PNG 52장이 모두 쓰이고, 화면에 절반 크기로 놓임 · 받은 그림의 그 자리와 점 하나까지 같음(cut_money.py --check)
  D. 색 · 글꼴     디자인 시트의 토큰 값 · 페이퍼로지(제목) · 나눔스퀘어 네오(본문)가 실제로 쓰임 · 다른 화면에는 닿지 않음
  E. 누르기        소개장터 메인 안의 누를 수 있는 것 전부 — 화면으로 가거나(없는 화면 0) · 안내가 뜨거나 · 그 자리에서 바뀜
  F. 지금 있던 것  퀵메뉴 5 · 「내가 등록한 …」 · 전체 목록 · 소개상품 찾기(구분 · 분류) · 인기 매물 6칸 · 쪽 번호 — 오른쪽 칸의 디자인 구역 아래 · 분야 · 분류를 누르면 그 낱말로 이 목록을 거름
  G. 로그인        로그인하면 나의공간 · 로그아웃 · 선으로 그린 종 + 알림 수(받은 그림의 종은 로그인하지 않은 모습에만)
  H. 다른 관       안심소개 · 소개창업의 관 메인은 전의 골격 그대로
  M. 좁은 화면     1500 → 320px 가로 넘침 없음 · 화면 오류 없음

사용: python3 proto_mny.py     PROTO=/path/proto.html (기본: 킷의 spec/proto.html)
"""
import json, os, re, subprocess, sys
from playwright.sync_api import sync_playwright

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
if not os.path.isdir(K + '/sgb'): K = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILE = os.environ.get('PROTO', K + '/sgb/spec/proto.html')
OUT = os.path.dirname(os.path.abspath(__file__))
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:400]})
    print('ok  ' if ok else 'FAIL', step, '' if ok else str(detail)[:300], file=sys.stderr)

SCR = "() => __VIEW.state.screen"
TOAST = "() => { const e = document.getElementById('toast'); return e && e.classList.contains('on') ? e.textContent.trim() : '' }"
TXT = "(sel) => [...document.querySelectorAll(sel)].map(e => e.textContent.trim().replace(/\\s+/g, ' '))"
CSS = "([sel, prop]) => { const e = document.querySelector(sel); return e ? getComputedStyle(e)[prop] : null }"
PLZ = ['cmu', 'commu', 'cmud', 'cmuw', 'cmupoll']
TILES = ['전체', '가구, 인테리어', '청소, 방역', '이사, 운송', '중고 거래', '사무 용품', '제조, 유통', '공사, 시공', '디자인, 마케팅', 'IT, 개발', '세무, 노무', '교육, 컨설팅', '행사, 모임', '기타']
SIDE = ['가구, 인테리어', '사무용품,전자기기', '중고 물품', '산업 장비', '기타 상품', '청소, 방역', '인테리어', '이사, 운송', '설치, 수리', '광고, 마케팅', '기타 서비스',
        '서울', '경기', '인천', '대전', '대구', '부산', '울산', '광주', '제주', '기타 지역']
SVC = [('클린하우스', '사무실, 상가 청소 전문', '4.8(123)', '서울 강남구'), ('한성 인테리어 파트너', '사무공간 인테리어, 리모델링', '4.7(56)', '경기 성남시'),
       ('행복 이사', '가정 이사, 사무실 이사', '4.6(91)', '인천 연수구'), ('에어존 시스템', '에어컨 설치, 이전, 수리', '4.9(203)', '서울 마포구')]
AI = [('김현우 세무사', '법인, 개인 세무 상담', '4.9(203)', '서울 강남구'), ('더존 인테리어', '상가, 사무실 인테리어', '4.7(56)', '경기 고양시'),
      ('스마트오피스', '사무용 가구 전문', '4.6(91)', '서울 마포구'), ('행복 이사', '이사, 운송 전문', '4.6(91)', '인천 연수구')]
REQ = [('사무실 입주청소 믿을 수 있는 업체 찾습니다.', '청소, 방역', '서울 강남구', '3시간 전', '300 ~ 500만원', '제안7건'),
       ('카페 테이블 20개 제작 가능한 업체를 찾습니다.', '가구, 인테리어', '경기 성남시', '5시간 전', '50 ~ 100만원', '제안12건'),
       ('홈페이지 리뉴얼 가능한 업체를 찾습니다.', 'IT, 개발', '서울 마포구', '1일 전', '100 ~ 300만원', '제안5건'),
       ('가정 이사 당일 가능한 업체 추천해주세요.', '이사, 운송', '인천 연수구', '2일 전', '협의', '제안8건')]
CASES = [('판교 사무실 입주청소', '3개 업체 제안 → 1곳 연결', '경기 성남시', '2026. 10. 09'), ('카페 테이블 20개 제작', '5개 업체 제안 → 1곳 연결', '서울 마포구', '2026. 10. 09'),
         ('학원 인테리어 시공', '4개 업체 제안 → 1곳 연결', '경기 고양시', '2026. 10. 09')]
RGB = lambda h: 'rgb(%d, %d, %d)' % tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def main(p):
    src = open(FILE, encoding='utf-8').read()
    b = p.chromium.launch(); errs = []
    ctx = b.new_context(viewport={'width': 1500, 'height': 1000}); pg = ctx.new_page()
    pg.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)[:160]))
    def open_(h='#/g/mny'):
        pg.goto('file://' + FILE + h); pg.wait_for_timeout(700)
        pg.evaluate("() => { document.querySelectorAll('.admask,.adfloat').forEach(e => e.remove()); const t = document.getElementById('toast'); t && t.classList.remove('on'); document.querySelectorAll('.spop.on').forEach(e => e.classList.remove('on')) }")
    def clean(): pg.evaluate("() => { document.querySelectorAll('.admask,.adfloat').forEach(e => e.remove()); const t = document.getElementById('toast'); t && t.classList.remove('on'); document.querySelectorAll('.spop.on').forEach(e => e.classList.remove('on')) }")
    open_()

    # ── A ── 틀
    rec('A-0 판 이름 — 시안 v10.31(v10.30 의 소개장터 메인 설명이 그대로 남음)', re.search(r'<title>소개뱅크 시안 v10\.31 \(2026-10-10 · ', src) is not None and 'v10.30: 소개장터 메인을 제시 디자인대로' in src[:6000])
    has = pg.evaluate("""() => { const out = {}; for (const k of Object.keys(__VIEW.screens)) { try { __VIEW.paint(k); out[k] = [document.querySelectorAll('#screen header.b2-hd').length, document.querySelectorAll('#screen footer.b2-ft').length, document.querySelectorAll('#screen header.hd').length, document.querySelectorAll('#screen [data-b2-tone=money]').length, document.querySelectorAll('#screen .mny').length]; } catch (e) { out[k] = ['ERR ' + e.message]; } } return out; }""")
    new = sorted(k for k, v in has.items() if v[0] == 1); tone = sorted(k for k, v in has.items() if len(v) > 3 and v[3]); mny = sorted(k for k, v in has.items() if len(v) > 4 and v[4])
    bad = {k: v for k, v in has.items() if isinstance(v[0], str)}
    rec(f'A-1 새 머리줄 · 바닥줄 — 전체 {len(has)}장 가운데 소개광장 5장 + 소개장터 메인(list) · 색조 money 와 mny- 구역은 list 한 장에만 · 그리다 실패한 화면 0', new == sorted(PLZ + ['list']) and tone == ['list'] and mny == ['list'] and not bad, (new, tone, mny, bad))
    open_()
    rec('A-2 #/g/mny — 화면 list · 옛 머리줄(header.hd) 없음 · 옛 골격(.gwl > .wrap) 없음', pg.evaluate(SCR) == 'list' and pg.locator('#screen header.hd').count() == 0 and pg.locator('#screen > .gwl, #screen .body2').count() == 0, pg.evaluate(SCR))
    nav = pg.evaluate("() => [...document.querySelectorAll('#screen header.b2-hd .b2-nav a')].map(e => [e.textContent.trim(), e.getAttribute('aria-current') || ''])")
    rec('A-3 메뉴 6개 — 소개장터 · 안심소개 · 소개창업 · 소개몰 · 소개광장 · 이용안내 · 「소개장터」에 지금 화면 표시', [n[0] for n in nav] == ['소개장터', '안심소개', '소개창업', '소개몰', '소개광장', '이용안내'] and [n[1] for n in nav] == ['page', '', '', '', '', ''], nav)
    hd = pg.evaluate("""() => { const q = (s) => document.querySelector('#screen header.b2-hd ' + s); const lg = q('.b2-logo img'), bl = q('.b2-bell img');
      return { logo: lg ? [lg.naturalWidth, lg.naturalHeight, lg.width, lg.height, lg.src === __MNY_ART.logo] : null, bell: bl ? [bl.naturalWidth, bl.naturalHeight, bl.width, bl.height, bl.src === __MNY_ART.bell] : null,
               cart: !!q('.b2-cart'), login: (q('.b2-login') || {}).textContent, join: (q('.b2-join') || {}).textContent, joinBg: q('.b2-join') ? getComputedStyle(q('.b2-join')).backgroundColor : '', h: q('').getBoundingClientRect().height,
               under: getComputedStyle(q('.b2-nav a[aria-current=page]'), '::after').backgroundColor, navFont: getComputedStyle(q('.b2-nav a')).fontFamily.split(',')[0], navSize: getComputedStyle(q('.b2-nav a')).fontSize, navW: getComputedStyle(q('.b2-nav a')).fontWeight }; }""".replace("q('')", "document.querySelector('#screen header.b2-hd')"))
    rec('A-4 머리줄 — 로고(432×104 → 216×52) · 받은 그림의 종(80×82 → 40×41) · 장바구니 없음 · 로그인 · 주황(#FFA03E) 무료 회원가입 · 높이 75 · 밑줄 주황 · 메뉴 글꼴 나눔스퀘어 네오 800 19px',
        hd['logo'] == [432, 104, 216, 52, True] and hd['bell'] == [80, 82, 40, 41, True] and not hd['cart'] and hd['login'] == '로그인' and hd['join'] == '무료 회원가입' and hd['joinBg'] == RGB('#ffa03e')
        and hd['h'] == 75 and hd['under'] == RGB('#ffa03e') and 'Nanum Square Neo' in hd['navFont'] and hd['navSize'] == '19px' and hd['navW'] == '800', hd)
    ft = pg.evaluate("""() => { const f = document.querySelector('#screen footer.b2-ft'); const lg = f.querySelector('.b2-logo img'); const sns = [...f.querySelectorAll('.b2-sns img')];
      return { logo: [lg.naturalWidth, lg.naturalHeight, lg.width, lg.height, lg.src === __MNY_ART.logo_foot], sns: sns.map(i => [i.naturalWidth, i.naturalHeight, i.width, i.height]), snsSrc: sns.every((i, k) => i.src === __MNY_ART[['sns_fb', 'sns_ig', 'sns_yt'][k]]),
               links: [...f.querySelectorAll('.b2-ftl a')].map(a => a.textContent.trim()), legal: f.querySelector('.b2-legal').textContent, bg: getComputedStyle(f).backgroundColor, inTone: !!f.closest('[data-b2-tone=money]') }; }""")
    rec('A-5 바닥줄 — 그 디자인의 로고(406×104 → 203×52) · 사회관계망 3(64px → 32px) · 링크는 사이트 정보의 목록 그대로 · 사업자 정보 · 통신판매중개자 고지 유지 · 바탕 #F6F8FA',
        ft['logo'] == [406, 104, 203, 52, True] and ft['sns'] == [[64, 64, 32, 32], [64, 64, 32, 32], [65, 64, 32.5, 32]] or (ft['logo'] == [406, 104, 203, 52, True] and [x[:2] for x in ft['sns']] == [[64, 64], [64, 64], [65, 64]] and ft['snsSrc']
        and ft['links'][:4] == ['서비스 소개', '이용약관', '개인정보처리방침', '운영정책'] and ft['links'][-1] == '고객센터' and '사업자등록번호' in ft['legal'] and '통신판매중개자' in ft['legal'] and ft['bg'] == RGB('#f6f8fa') and ft['inTone']), ft)

    # ── B ── 그림 그대로(글자 · 숫자)
    t = lambda sel: pg.evaluate(TXT, '#screen .mny ' + sel)
    rec('B-1 맨 위 — 제목 · 설명 · 검색 안내 글자', t('.mny-h1') == ['필요한 업체를AI로 쉽게 찾아보세요.'] and t('.mny-lead') == ['상품, 서비스, 전문가까지.원하는 조건에 맞는 믿을 수 있는 공급자를 연결해드립니다.'] and pg.get_attribute('#screen #mny-q', 'placeholder') == '키워드를 검색해보세요.', (t('.mny-h1'), t('.mny-lead')))
    rec('B-2 많이 찾는 키워드 5 — 사무실 청소 · 인테리어 · 이사 · 세무사 · 카페 창업', t('.mny-kw-t') == ['많이 찾는 키워드'] and t('.mny-chip') == ['사무실 청소', '인테리어', '이사', '세무사', '카페 창업'], t('.mny-chip'))
    rec('B-3 바로가기 3 — 소개하기 · 소개받고 싶어요 · 소개받기(설명 글 포함)', t('.mny-qc b') == ['소개하기', '소개받고 싶어요', '소개받기'] and t('.mny-qc span') == ['상품, 서비스를 소개해요.', '원하는 조건으로 요청해요.', '지금 올라온 요청을 확인해요.'], t('.mny-qc'))
    rec('B-4 분야 14칸 — 이름 · 순서 · 「전체」가 고른 모양', t('.mny-cat-h h2') == ['무엇을 소개받고 싶으세요 ?'] and t('.mny-tile') == TILES and pg.evaluate("() => [...document.querySelectorAll('#screen .mny-tile')].map(e => e.getAttribute('aria-current') || '').join('|')") == 'true' + '|' * 13, t('.mny-tile'))
    rec('B-5 분류 목록 — 전체 카테고리 · 상품 5 · 서비스 6 · 전문가 · 업체 · 구해요 / 의뢰 · 지역으로 찾기 10', t('.mny-side-h') == ['전체 카테고리'] and t('.mny-sl a') == SIDE and t('.mny-sg') == ['상품', '서비스', '전문가', '업체', '구해요 / 의뢰', '지역으로 찾기'], (t('.mny-sg'), t('.mny-sl a')))
    cards = pg.evaluate("""(sel) => [...document.querySelectorAll('#screen .mny ' + sel + ' .mny-card')].map(c => [c.querySelector('h3').textContent, c.querySelector('p').textContent, c.querySelector('.is-star').textContent.trim(), c.querySelector('.is-pin').textContent.trim(), [...c.querySelectorAll('.mny-btn')].map(b => b.textContent).join('|')])""", '.mny-cards:not(.is-ai)')
    rec('B-6 서비스 업체 추천 4 — 이름 · 설명 · 별점(건수) · 지역 · 프로필 보기 | 제안 하기', [tuple(c[:4]) for c in cards] == SVC and all(c[4] == '프로필 보기|제안 하기' for c in cards), cards)
    cards = pg.evaluate("""(sel) => [...document.querySelectorAll('#screen .mny ' + sel + ' .mny-card')].map(c => [c.querySelector('h3').textContent, c.querySelector('p').textContent, c.querySelector('.is-star').textContent.trim(), c.querySelector('.is-pin').textContent.trim(), [...c.querySelectorAll('.mny-btn')].map(b => b.textContent).join('|')])""", '.mny-cards.is-ai')
    rec('B-7 AI 추천 맞춤 공급자 4', [tuple(c[:4]) for c in cards] == AI and all(c[4] == '프로필 보기|제안 하기' for c in cards), cards)
    reqs = pg.evaluate("""() => [...document.querySelectorAll('#screen .mny .mny-req')].map(r => [r.querySelector('.mny-req-m a').textContent, r.querySelector('.mny-tag').textContent, r.querySelector('.mny-req-m div').textContent.replace(r.querySelector('.mny-tag').textContent, '').trim(), r.querySelector('.is-time').textContent, r.querySelector('.is-price').textContent, r.querySelector('.is-n').textContent, r.querySelector('.mny-btn').textContent])""")
    rec('B-8 지금 올라온 소개 요청 — 탭 6 · 줄 4(제목 · 분야 · 지역 · 시각 · 예산 · 제안 수 · 제안 하기)', t('.mny-tab') == ['전체', '상품 구매', '서비스 의뢰', '전문가 문의', '업체 찾기', '중고 구하기'] and [tuple(r[:6]) for r in reqs] == REQ and all(r[6] == '제안 하기' for r in reqs), reqs)
    cs = pg.evaluate("""() => [...document.querySelectorAll('#screen .mny .mny-case')].map(c => [c.querySelector('b').textContent, c.querySelector('p').textContent, ...[...c.querySelectorAll('span')].map(s => s.textContent.trim())])""")
    rec('B-9 최근 실제 연결 사례 3 · 공급자 등록 안내 · 단추', t('.mny-cases-h h2') == ['최근 실제 연결 사례'] and [tuple(c) for c in cs] == CASES and t('.mny-cta p') == ['전국의 다양한 공급자를 기다리고 있어요.지금, 새로운 기회를 만나보세요.'] and t('.mny-cta a') == ['공급자로 등록하기'], (cs, t('.mny-cta a')))
    order = pg.evaluate("""() => { const y = (s) => { const e = document.querySelector('#screen ' + s); return e ? Math.round(e.getBoundingClientRect().top + scrollY) : -1 };
      return ['.b2-hd', '.mny-hero', '.mny-quick', '.mny-cat', '.mny-panel:not(.is-req):not(.is-aip)', '.mny-panel.is-req', '.mny-panel.is-aip', '.mny-old', '.mny-band', '.mny-bottom', '.b2-ft'].map(y) }""")
    rec('B-10 구역 순서 — 머리줄 → 맨 위 → 바로가기 → 분야 → 업체 추천 → 소개 요청 → AI 추천 → (지금 있던 것) → 띠 광고 → 사례 · 등록 → 바닥줄', -1 not in order and order == sorted(order), order)
    rec('B-11 견본 표시 — 화면에 data-content="sample" · 화면 설명에 「견본」 · 「v10.30」', pg.get_attribute('#screen .mny', 'data-content') == 'sample' and pg.evaluate("() => { const m = __VIEW.meta && __VIEW.meta.list; return m ? m.note : '' }") is not None
        and 'v10.30 — 2026-10-09 제시 디자인' in src and '글자 · 숫자는 받은 그림 그대로인 견본입니다' in src)

    # ── C ── 그림
    pics = pg.evaluate("""() => { const A = __MNY_ART, used = {}; const bad = [];
      document.querySelectorAll('#screen [data-b2-tone=money] img').forEach(i => { if (i.closest('.mny-old')) return; const n = Object.keys(A).find(k => A[k] === i.src); if (!n) { bad.push('모르는 그림 ' + i.src.slice(0, 40)); return; } used[n] = 1;
        if (!(i.complete && i.naturalWidth > 0)) bad.push(n + ' 안 뜸'); const r = i.getBoundingClientRect();
        if (n.indexOf('svc_') && n.indexOf('ai_') && n.indexOf('req_') && n.indexOf('case_') && (Math.abs(r.width * 2 - i.naturalWidth) > 1.01 || Math.abs(r.height * 2 - i.naturalHeight) > 1.01)) bad.push(n + ' 크기 ' + r.width + 'x' + r.height + ' / ' + i.naturalWidth + 'x' + i.naturalHeight); });
      return { n: Object.keys(A).length, used: Object.keys(used).length, unused: Object.keys(A).filter(k => !used[k]), bad }; }""")
    rec('C-1 넣은 그림 53장이 모두 쓰임 · 모두 뜸 · 아이콘 · 로고 · 광고는 원본의 정확히 절반 크기(늘이거나 줄이지 않음)', pics['n'] == 53 and pics['used'] == 53 and not pics['unused'] and not pics['bad'], pics)
    ph = pg.evaluate("""() => ['.mny-card > img', '.mny-cards.is-ai .mny-card > img', '.mny-req > img', '.mny-case > img', '.mny-ad img', '.mny-band img'].map(s => { const i = document.querySelector('#screen .mny ' + s); const r = i.getBoundingClientRect(); return [s, Math.round(r.width * 2) / 2, Math.round(r.height * 2) / 2, i.naturalWidth, i.naturalHeight, getComputedStyle(i).objectFit] })""")
    okp = all(abs(w * 2 - nw) <= 4 and abs(h * 2 - nh) <= 2 for _, w, h, nw, nh, _ in ph)      # 카드 사진은 카드 테두리(1px) 안쪽이라 가로 1.5px 가 잘립니다(늘이거나 줄이지 않음 — 세로는 정확히 절반)
    rec('C-2 사진(업체 · AI · 요청 · 사례 · 광고 2) — 원본의 절반 크기(세로 ±1px · 가로는 카드 테두리만큼 1.5px 잘림 · 찌그러짐 없음)', okp, ph)
    r = subprocess.run([sys.executable, os.path.join(OUT, 'cut_money.py'), '--check'], capture_output=True, text=True, env={**os.environ, 'PROTO': FILE})
    rec('C-3 넣은 그림 = 받은 그림의 그 자리(점 하나까지) — cut_money.py --check', r.returncode == 0 and '원본과 다른 것 0' in r.stdout and '시안 53개' in r.stdout, r.stdout.strip()[-200:])

    # ── D ── 색 · 글꼴
    c = lambda sel, prop: pg.evaluate(CSS, ['#screen ' + sel, prop])
    tok = pg.evaluate("() => { const s = getComputedStyle(document.documentElement); return ['--sgb-navy', '--sgb-orange', '--sgb-money', '--sgb-mall', '--sgb-biz', '--sgb-shop', '--sgb-plaza', '--sgb-sys', '--sgb-bg'].map(k => s.getPropertyValue(k).trim()) }")
    rec('D-1 디자인 시트의 토큰 — 남색 #00245a · 주황 #ffa03e · 관 5색 · 시스템 2색', tok == ['#00245a', '#ffa03e', '#ffa03e', '#0f766e', '#6d28d9', '#16a34a', '#fd580a', '#65779c', '#f5f7fa'], tok)
    col = {'h1': c('.mny-h1', 'color'), 'em': c('.mny-h1 em', 'color'), 'hero': c('.mny-hero', 'backgroundColor'), 'btn': c('.mny-search button', 'backgroundColor'), 'fill': c('.mny-btn.is-fill', 'backgroundColor'),
           'line': c('.mny-btn.is-line', 'color'), 'tab': c('.mny-tab[aria-selected=true]', 'backgroundColor'), 'side': c('.mny-side-h', 'backgroundColor'), 'cta': c('.mny-cta a', 'backgroundColor'), 'point': pg.evaluate("() => getComputedStyle(document.querySelector('#screen .mny')).getPropertyValue('--sgb-point').trim()")}
    want = {'h1': RGB('#00245a'), 'em': RGB('#f5a008'), 'hero': RGB('#fbf4e8'), 'btn': RGB('#f5a008'), 'fill': RGB('#fca22a'), 'line': RGB('#156afd'), 'tab': RGB('#fca22a'), 'side': RGB('#00245a'), 'cta': RGB('#fca22a'), 'point': '#ffa03e'}
    rec('D-2 화면의 색 — 제목 남색 · 강조 #f5a008 · 맨 위 바탕 #fbf4e8 · 실행 단추 #fca22a · 줄 단추 #156afd · 분류 머리 남색 · 관 포인트 색 = 소개장터', col == want, col)
    fonts = pg.evaluate("""async () => { await document.fonts.ready; const f = (s) => getComputedStyle(document.querySelector('#screen ' + s)).fontFamily.split(',')[0].replace(/"/g, '');
      return { h1: f('.mny-h1'), lead: f('.mny-lead'), h2: f('.mny-ph h2'), tile: f('.mny-tile'), old: f('.mny-old-b'), loaded: [...document.fonts].filter(x => x.status === 'loaded').map(x => x.family.replace(/"/g, '') + ' ' + x.weight).sort(),
               chk: ['500 20px Paperlogy', '700 20px Paperlogy', '400 20px "Nanum Square Neo"', '700 20px "Nanum Square Neo"', '800 20px "Nanum Square Neo"'].map(x => document.fonts.check(x, '소개장터 가나다 AI 123')) }; }""")
    rec('D-3 글꼴 — 제목 페이퍼로지 · 본문 나눔스퀘어 네오가 파일 안에서 실제로 불려 쓰임(5개) · 지금 있던 매물 구역은 전의 글꼴(Pretendard)',
        fonts['h1'] == 'Paperlogy' and fonts['h2'] == 'Paperlogy' and fonts['lead'] == 'Nanum Square Neo' and fonts['tile'] == 'Nanum Square Neo' and fonts['old'] == 'Pretendard' and all(fonts['chk'])
        and {'Paperlogy 500', 'Paperlogy 700', 'Nanum Square Neo 700', 'Nanum Square Neo 800'} <= set(fonts['loaded']), fonts)
    other = pg.evaluate("""() => { const out = []; for (const k of ['main1', 'listl', 'listb', 'cmu', 'lstm', 'reql', 'my']) { __VIEW.paint(k); const b = document.querySelector('#screen'); const e = b.querySelector('h1, h2, .lg, a, button') || b;
        out.push([k, getComputedStyle(e).fontFamily.indexOf('Paperlogy') < 0 && getComputedStyle(e).fontFamily.indexOf('Nanum Square Neo') < 0, getComputedStyle(b.querySelector('header') || b).fontFamily.split(',')[0]]); } __VIEW.paint('list'); return out; }""")
    rec('D-4 다른 화면에는 닿지 않음 — 메인 · 안심소개 · 소개창업 · 소개광장 · 전체 목록 · 소개받기 · 나의공간의 글꼴이 전과 같음', all(o[1] and 'Paperlogy' not in o[2] and 'Nanum' not in o[2] for o in other), other)
    css_all = src[src.index('/* ═══ v10.30 (2026-10-09) — 소개장터 메인(mny-*)'):]
    css_all = css_all[:css_all.index('</style>')]
    body = re.sub(r'/\*.*?\*/', '', css_all, flags=re.S); body = re.sub(r'@font-face\s*\{[^}]*\}', '', body)
    sels = []
    for m in re.finditer(r'([^{}]+)\{[^{}]*\}', body):
        for s1 in m.group(1).split(','):
            s1 = s1.strip()
            if s1 and not s1.startswith('@') and not re.match(r'^(from|to|\d+%)$', s1): sels.append(s1)
    okpre = (':root', ':where(.mny', '.mny', '[data-b2-tone=money]', '.main-mny', '.main.main-b2.main-mny', '.b2-bell', '.b2-belln', '[data-sgb-gwan=')
    out = [s1 for s1 in sels if not s1.startswith(okpre)]
    rec(f'D-5 넣은 스타일 {len(sels)}개가 모두 소개장터 이름 아래(.mny · [data-b2-tone=money] · .b2-bell · 토큰 :root) — 밖으로 새는 것 0', len(sels) > 300 and not out, out[:6])

    # ── E ── 누르기
    open_()
    info = pg.evaluate("""() => { const root = document.querySelector('#screen [data-b2-tone=money]'); const all = [...root.querySelectorAll('a, button, [data-go], [role=button], select, input')];
      const kinds = { go: 0, t: 0, own: 0, href: 0, form: 0, other: [] }; const gos = {};
      all.forEach(e => { if (e.hasAttribute('data-go')) { kinds.go++; gos[e.getAttribute('data-go')] = 1; } else if (e.hasAttribute('data-t')) kinds.t++;
        else if (e.matches('[data-mny-tab],[data-mny-kw],[data-mny-f],[data-mny-clear],.mny-sg[aria-controls],[data-lang-toggle],[data-auth],[data-open],[data-pg],[data-lang],[data-clear]') || e.closest('.pgb, .pg, .pgbar') || e.matches('select.sortsel, select')) kinds.own++;
        else if (e.matches('a[href^="#/"]') || (e.matches('a[href]') && e.getAttribute('href') !== '#')) kinds.href++;
        else if (e.matches('form *') || e.matches('input')) kinds.form++;
        else kinds.other.push((e.className || e.tagName).toString().slice(0, 30) + ':' + e.textContent.trim().slice(0, 16)); });
      return { n: all.length, kinds, gos: Object.keys(gos), noScreen: Object.keys(gos).filter(k => !__VIEW.screens[k]) }; }""")
    rec(f"E-1 소개장터 메인의 누를 수 있는 것 {info['n']}개 — 화면으로 감 {info['kinds']['go']} · 안내가 뜸 {info['kinds']['t']} · 그 자리에서 바뀜 {info['kinds']['own']} · 주소로 감 {info['kinds']['href']} · 검색 칸 {info['kinds']['form']} · 아무 일도 없는 것 0",
        info['n'] >= 120 and not info['kinds']['other'] and not info['noScreen'], (info['kinds']['other'][:8], info['noScreen']))
    def go_from(sel, want, nth=0):
        open_(); pg.locator('#screen ' + sel).nth(nth).click(); pg.wait_for_timeout(350)
        if want == 'schres' and pg.evaluate("!!document.querySelector('#spop.on')"): return True, '검색 팝업'   # v10.31 시안 — 머리줄 돋보기 = 검색 팝업(검색하면 결과 #/search?q=)
        return pg.evaluate(SCR) == want, pg.evaluate(SCR)
    G = [('.mny-qc', 0, 'reg', '소개하기 → 소개 등록'), ('.mny-qc', 1, 'reqn', '소개받고 싶어요 → 소개받기 등록'), ('.mny-qc', 2, 'reql', '소개받기 → 요청 목록'), ('.mny-cat-h .mny-more', 0, 'lstm', '분야 전체보기 → 전체 목록'),
         ('.mny-old-q a', 6, 'lstm', '전체 목록'), ('.mny-sg.is-plain', 2, 'reql', '구해요 / 의뢰 → 요청 목록'),
         ('.mny-panel.is-req .mny-more', 0, 'reql', '소개 요청 전체보기 → 요청 목록'), ('.mny-req-m a', 0, 'reqd', '요청 제목 → 요청 상세'), ('.mny-req .mny-btn', 3, 'reqd', '요청의 제안 하기 → 요청 상세'), ('.mny-cta a', 0, 'reg', '공급자로 등록하기 → 소개 등록'),
         ('.b2-find', 0, 'schres', '머리줄 돋보기 → 검색 팝업(v10.31) · 결과'), ('.b2-bell', 0, 'myntf', '알림 종 → 알림 센터'), ('.b2-nav a >> nth=5', 0, 'guide', '이용안내')]
    res = [(lbl,) + go_from(sel, want, nth) for sel, nth, want, lbl in G]
    rec(f'E-2 화면으로 가는 길 {len(G)}곳 — ' + ' · '.join(x[0] for x in res[:6]) + ' …', all(x[1] for x in res), [x for x in res if not x[1]])
    open_(); tl = []
    for sel, nth in [('.mny-ad a', 0), ('.mny-ad .is-next', 0), ('.mny-panel:not(.is-req):not(.is-aip) .mny-more', 0), ('.mny-card .mny-btn.is-line', 0), ('.mny-card .mny-btn.is-fill', 5), ('.mny-panel.is-aip .mny-more', 0), ('.mny-sl.is-region a', 0), ('.mny-band', 0), ('.b2-sns button', 0)]:
        clean(); pg.locator('#screen ' + sel).nth(nth).click(); pg.wait_for_timeout(200); tl.append((sel, pg.evaluate(TOAST), pg.evaluate(SCR)))
    rec('E-3 견본 구역 9곳(광고 · 업체 전체보기 · 프로필 · 제안 · AI 전체보기 · 지역 · 띠 광고 · 사회관계망) — 누르면 「견본 / 준비 중」 안내가 뜨고 화면은 그대로', all(x[1] and x[2] == 'list' and ('견본' in x[1] or '그림' in x[1] or '준비 중' in x[1]) for x in tl), tl)
    open_(); tabs = []
    for i, want in enumerate([4, 1, 1, 1, 1, 0]):
        pg.locator('#screen .mny-tab').nth(i).click(); pg.wait_for_timeout(120)
        tabs.append([pg.evaluate("() => [...document.querySelectorAll('#screen .mny-req')].filter(r => !r.hidden).length"), want, pg.evaluate("() => [...document.querySelectorAll('#screen .mny-tab')].map(b => b.getAttribute('aria-selected')).indexOf('true')") == i, pg.evaluate("() => !document.querySelector('#screen .mny-empty').hidden")])
    rec('E-4 요청 종류 탭 6 — 전체 4 · 상품 구매 1 · 서비스 의뢰 1 · 전문가 문의 1 · 업체 찾기 1 · 중고 구하기 0(안내 글) · 누른 탭만 고른 모양 · 화면은 그대로', all(a == w and sel and (emp == (w == 0)) for a, w, sel, emp in tabs) and pg.evaluate(SCR) == 'list', tabs)
    open_(); acc = []
    for i in (0, 1):
        bt = pg.locator('#screen .mny-sg[aria-controls]').nth(i); uid = bt.get_attribute('aria-controls'); bt.click(); pg.wait_for_timeout(100)
        a1 = (bt.get_attribute('aria-expanded'), pg.evaluate("(i) => document.getElementById(i).hidden", uid)); bt.click(); pg.wait_for_timeout(100)
        acc.append((a1, (bt.get_attribute('aria-expanded'), pg.evaluate("(i) => document.getElementById(i).hidden", uid))))
    rec('E-5 분류 묶음(상품 · 서비스) — 누르면 접히고 다시 누르면 펴짐', all(a == (('false', True), ('true', False)) for a in acc), acc)
    open_(); pg.locator('#screen .mny-chip').nth(3).click(); pg.wait_for_timeout(400)
    kw = (pg.evaluate(SCR), pg.evaluate("() => __VIEW.state.q"))
    # 시안의 검색 칸(.si)은 어느 화면에서나 누르면 통합 검색 창(#spop)을 엽니다 — 메인 · 관 메인과 같은 규칙입니다
    pg.goto('about:blank'); open_(); pg.locator('#screen #mny-q').click(); pg.wait_for_timeout(300)   # v10.31 — 앞 단계(칩 → 검색 결과 src)의 검색 상태가 남지 않게 새로 엶
    pop = pg.evaluate("() => { const e = document.getElementById('spop'); return !!(e && e.classList.contains('on')) }")
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    pop2 = pg.evaluate("() => { const e = document.getElementById('spop'); return !!(e && e.classList.contains('on')) }")
    open_(); pg.evaluate("() => { document.querySelector('#screen #mny-q').value = '인테리어' }"); pg.locator('#screen .mny-search button').click(); pg.wait_for_timeout(400)
    sr = (pg.evaluate(SCR), pg.evaluate("() => __VIEW.state.q"))
    open_(); pg.evaluate("() => { document.querySelector('#screen #mny-q').value = '   ' }"); pg.locator('#screen .mny-search button').click(); pg.wait_for_timeout(300); se = pg.evaluate(SCR)
    rec('E-6 검색 — 키워드 칩 「세무사」 → 검색 결과(그 낱말) · 검색 칸을 누르면 통합 검색 창이 열리고 ESC 로 닫힘 · 「인테리어」 + 주황 단추 → 검색 결과 · 빈 칸은 그대로',
        kw in (('schres', '세무사'), ('src', '세무사')) and pop and not pop2 and sr in (('schres', '인테리어'), ('src', '인테리어')) and se == 'list', (kw, pop, pop2, sr, se))   # v10.31 시안 — 검색 결과는 통합 결과 화면 src(#/search?q=)

    # 분야 14칸 · 분류 목록 — 누르면 그 낱말로 아래 목록(#mny-list)을 거릅니다(실제 웹의 /money?keyword=…#mny-list 와 같음)
    ST = """() => { const o = document.querySelector('#screen .mny-old'); const q = (s) => [...document.querySelectorAll('#screen ' + s)].map(e => e.textContent.trim());
      return { scr: __VIEW.state.screen, kw: __VIEW.state.mnyKw || '', tile: q('.mny-tile[aria-current=true]'), side: q('.mny-side a[aria-current=true]'), bar: q('.mny-old .catbar .cbv'), cards: [...o.querySelectorAll('.pgc')].map(c => c.querySelector('.tt').textContent + '|' + c.querySelector('.cc').textContent),
        none: !!o.querySelector('.catnone'), tot: (o.querySelector('.tot') || {}).textContent || '', top: Math.round(o.getBoundingClientRect().top), allBg: getComputedStyle(document.querySelector('#screen .mny-tile')).backgroundColor }; }"""
    open_(); pg.locator('#screen .mny-tile').nth(1).click(); pg.wait_for_timeout(350); k1 = pg.evaluate(ST)
    ring = pg.evaluate("() => { const t = [...document.querySelectorAll('#screen .mny-tile')]; const c = (e) => getComputedStyle(e); return [c(t[1]).boxShadow !== 'none', c(t[1]).backgroundColor === c(t[2]).backgroundColor, c(t[0]).boxShadow === 'none'] }")
    pg.locator('#screen .mny-old .catbar [data-mny-clear]').click(); pg.wait_for_timeout(300); k2 = pg.evaluate(ST)
    rec('E-7 분야 「가구, 인테리어」를 누르면 — 같은 화면 · 아래 목록이 「가구」가 든 매물만 · 검색 조건 줄에 「가구」 · 그 칸에 주황 테두리(바탕은 그림 그대로) · 목록 구역이 화면에 옴 · 「✕ 검색어 해제」 → 다시 전체 6칸',
        k1['scr'] == 'list' and k1['kw'] == '가구' and k1['tile'] == ['가구, 인테리어'] and k1['bar'] == ['「가구」'] and 1 <= len(k1['cards']) < 6 and set(k1['cards']) < set(k2['cards'] + k1['cards']) and '「가구」' in k1['tot'] and 0 <= k1['top'] < 500
        and ring == [True, True, True] and k1['allBg'] == RGB('#fbf4e8') and k2['kw'] == '' and k2['tile'] == ['전체'] and k2['bar'] == [] and len(k2['cards']) == 6, (k1, ring, k2['tile'], len(k2['cards'])))
    open_(); pg.locator('#screen .mny-sl:not(.is-region) a').nth(5).click(); pg.wait_for_timeout(350); k3 = pg.evaluate(ST)      # 서비스 「청소, 방역」 — 견본 매물에 「청소」가 없습니다
    pg.locator('#screen .mny-old .catnone [data-clear=all]').click(); pg.wait_for_timeout(350); k4 = pg.evaluate(ST)
    pg.locator('#screen .mny-sg.is-plain').nth(0).click(); pg.wait_for_timeout(350); k5 = pg.evaluate(ST)
    pg.locator('#screen .mny-tile').nth(0).click(); pg.wait_for_timeout(350); k6 = pg.evaluate(ST)
    rec('E-8 분류 「청소, 방역」 — 맞는 매물이 없으면 빈 목록 안내(「청소」) · 분야 칸 · 분류 줄 둘 다 고른 표시 · 「전체 목록으로 돌아가기」 → 낱말 풀림 · 「전문가」 → 그 낱말 · 「전체」 칸 → 풀림',
        k3['scr'] == 'list' and k3['kw'] == '청소' and k3['none'] and not k3['cards'] and k3['tile'] == ['청소, 방역'] and k3['side'] == ['청소, 방역'] and k3['bar'] == ['「청소」']
        and k4['kw'] == '' and len(k4['cards']) == 6 and k5['kw'] == '전문가' and k5['side'] == ['전문가'] and k5['tile'] == [] and k6['kw'] == '' and k6['tile'] == ['전체'] and len(k6['cards']) == 6, (k3, k4['kw'], k5['kw'], k5['side'], k6['tile']))
    open_(); pg.evaluate("() => { __VIEW.state.mnyKw = null }")

    # ── F ── 지금 있던 것
    open_()
    old = pg.evaluate("""() => { const o = document.querySelector('#screen .mny-old'); const r = o.getBoundingClientRect(), m = document.querySelector('#screen .mny-main').getBoundingClientRect(), p3 = document.querySelector('#screen .mny-panel.is-aip').getBoundingClientRect(), sd = document.querySelector('#screen .mny-side').getBoundingClientRect();
      return { h2: o.querySelector('h2').textContent, chips: [...o.querySelectorAll('.mny-old-q a')].map(a => [a.textContent.trim(), a.getAttribute('data-go') || '']), cards: o.querySelectorAll('.pgc').length, pager: !!o.querySelector('.sortsel'),
               find: [(o.querySelector('.panel.find .fh2') || {}).textContent || '', o.querySelectorAll('form[data-find] select').length, [...o.querySelectorAll('#f-grade option')].map(x => x.textContent.trim())], navs: o.querySelectorAll('.mny-old-q').length,
               sameCol: Math.abs(r.left - m.left) < 1 && Math.abs(r.width - m.width) < 1, below: Math.round(r.top - p3.bottom), sideEnds: Math.abs(sd.bottom - p3.bottom) < 1.5, tot: o.textContent.indexOf('1,248') >= 0 }; }""")
    rec('F-1 「지금 인기 있는 상품/서비스」 — 퀵메뉴 5(성공현황 · 베스트매칭 · 급구 · 급매 · 사고예방 · 이벤트존) · 내가 등록한 … · 전체 목록 · 소개상품 찾기(구분 · 분류 고르기) · 매물 6칸 · 총 1,248개 · 쪽 번호 · 정렬',
        old['h2'] == '지금 인기 있는 상품/서비스' and old['chips'] == [['성공현황', 'win'], ['베스트매칭', 'bst'], ['급구 · 급매', 'urg'], ['사고예방', 'saf'], ['이벤트존', 'evt'], ['내가 등록한 상품/서비스', 'mylst'], ['전체 목록', 'lstm']] and old['cards'] == 6 and old['pager'] and old['tot'] and old['navs'] == 2 and old['find'][:2] == ['소개상품 찾기', 2] and old['find'][2][0] == '전체' and len(old['find'][2]) >= 4, old)
    rec('F-2 자리 — 오른쪽 칸(디자인 구역과 같은 폭) · AI 추천 바로 아래 32px · 분류 목록은 그림대로 디자인 구역의 높이까지만', old['sameCol'] and old['below'] == 32 and old['sideEnds'], old)
    ch = [(k,) + go_from('.mny-old-q a', k, i) for i, k in enumerate(['win', 'bst', 'urg', 'saf', 'evt', 'mylst', 'lstm'])]
    rec('F-3 바로가기 7곳이 제 화면으로 감 — 성공현황 · 베스트매칭 · 급구 · 급매 · 사고예방 · 이벤트존 · 내 목록 · 전체 목록', all(x[1] for x in ch), ch)
    open_(); t1 = pg.evaluate("() => [...document.querySelectorAll('#screen .mny-old .pgc .tt')].map(e => e.textContent)")
    pg.locator('#screen .mny-old .pgc').first.click(); pg.wait_for_timeout(400); det = pg.evaluate(SCR)
    open_(); nxt = pg.locator('#screen .mny-old [data-pg]'); n_pg = nxt.count()
    if n_pg: pg.evaluate("() => { const b = [...document.querySelectorAll('#screen .mny-old [data-pg]')].find(x => x.textContent.trim() === '2'); b && b.click(); }"); pg.wait_for_timeout(350)
    t2 = pg.evaluate("() => [...document.querySelectorAll('#screen .mny-old .pgc .tt')].map(e => e.textContent)")
    rec('F-4 매물 카드를 누르면 그 매물 상세 · 쪽 번호 2 를 누르면 다음 6칸(같은 화면 안에서)', det not in ('list', None) and len(t1) == 6 and len(t2) == 6 and t1 != t2 and pg.evaluate(SCR) == 'list', (det, n_pg, t1[:2], t2[:2]))
    open_(); g_opt = pg.evaluate("() => [...document.querySelectorAll('#screen .mny-old #f-grade option')].map(x => x.value)")[1]
    pg.select_option('#screen .mny-old #f-grade', g_opt); pg.locator('#screen .mny-old form[data-find] button[type=submit], #screen .mny-old form[data-find] .fgo').first.click(); pg.wait_for_timeout(400); f1 = pg.evaluate(ST)
    pg.locator('#screen .mny-old .catbar [data-clear=all]').click(); pg.wait_for_timeout(400); f2 = pg.evaluate(ST)
    rec(f'F-5 소개상품 찾기 — 구분 「{g_opt}」을 고르고 검색하면 같은 화면에서 목록이 걸러지고 검색 조건 줄에 적힘 · 「전체 해제」 → 다시 6칸', f1['scr'] == 'list' and f1['bar'] == [g_opt] and (f1['cards'] or f1['none']) and f1['cards'] != f2['cards'] and f2['bar'] == [] and len(f2['cards']) == 6, (f1['bar'], len(f1['cards']), f2['bar'], len(f2['cards'])))
    pg.evaluate("() => { __VIEW.state.grade = null; __VIEW.state.cat = null; __VIEW.state.mnyKw = null }")

    # ── G ── 로그인
    open_(); pg.locator('#screen header.b2-hd [data-auth=in]').click(); pg.wait_for_timeout(500)
    lg_scr = pg.evaluate(SCR)
    pg.evaluate("""(()=>{const b=[...document.querySelectorAll('#screen button, #screen a')].find(x=>/^로그인$|로그인하기|시연 로그인/.test(x.textContent.trim())&&!x.closest('header'));if(b){b.click();return b.textContent.trim()}return null})()""")
    pg.wait_for_timeout(900)
    pg.evaluate("() => { location.hash = '#/g/mny' }"); pg.wait_for_timeout(700)
    if pg.evaluate(SCR) != 'list': pg.evaluate("() => __VIEW.paint('list')"); pg.wait_for_timeout(300)
    clean()
    li = pg.evaluate("""() => { const h = document.querySelector('#screen header.b2-hd'); if (!h) return null; const bl = h.querySelector('.b2-bell');
      return { btns: [...h.querySelectorAll('.b2-login, .b2-adm')].map(b => b.textContent.trim()), join: !!h.querySelector('.b2-join'), emoji: !!h.querySelector('.bell'), cart: !!h.querySelector('.b2-cart'),
               bell: bl ? [!!bl.querySelector('svg'), !!bl.querySelector('img'), (bl.querySelector('.b2-belln') || {}).textContent || '', bl.getAttribute('aria-label')] : null, n: (window.__VIEW.cfg && __VIEW.cfg.alertCount) }; }""")
    rec('G-0 「로그인」 → 로그인 화면', lg_scr == 'login', lg_scr)
    rec('G-1 로그인하면 — 나의공간 · 로그아웃 · 관리자 페이지 · 무료 회원가입 없음 · 선으로 그린 종 + 읽지 않은 알림 수(받은 그림의 종 아님) · 장바구니 없음',
        li is not None and li['btns'][:2] == ['나의공간', '로그아웃'] and not li['join'] and not li['emoji'] and not li['cart'] and li['bell'] and li['bell'][0] and not li['bell'][1] and (li['bell'][2] == '' or li['bell'][2].isdigit() or li['bell'][2] == '99+'), li)
    w_in = pg.evaluate("() => document.documentElement.scrollWidth")
    rec('G-2 로그인한 머리줄도 1500px 에서 한 줄(가로 넘침 없음 · 높이 75)', w_in <= 1500 and pg.evaluate("() => document.querySelector('#screen header.b2-hd').getBoundingClientRect().height") == 75, w_in)
    ov_in = []
    for w in (1460, 1321, 1320, 1221, 1220, 1024, 901, 900, 768, 390, 320):
        pg.set_viewport_size({'width': w, 'height': 900}); pg.wait_for_timeout(150); sw = pg.evaluate("() => document.documentElement.scrollWidth")
        if sw > w: ov_in.append((w, sw))
    pg.set_viewport_size({'width': 1500, 'height': 1000}); pg.wait_for_timeout(150)
    rec('G-3 로그인한 모습 — 폭 11가지(1460 → 320px) 가로 넘침 없음', not ov_in, ov_in)
    if li and li['btns'][:1] == ['나의공간']: pg.locator('#screen header.b2-hd [data-auth=out]').click(); pg.wait_for_timeout(500)

    # ── H ── 다른 관
    hh = []
    for h, k in (('#/g/mal', 'listl'), ('#/g/biz', 'listb')):
        open_(h); hh.append((pg.evaluate(SCR), pg.locator('#screen header.hd').count(), pg.locator('#screen .gwl').count(), pg.locator('#screen .mny, #screen header.b2-hd').count()))
    rec('H-1 안심소개 · 소개창업의 관 메인 — 전의 골격(옛 머리줄 · .gwl) 그대로 · mny- 구역 없음', hh == [('listl', 1, 1, 0), ('listb', 1, 1, 0)], hh)

    # ── M ── 좁은 화면 · 화면 오류
    ov = []
    for w in (1500, 1460, 1321, 1320, 1281, 1221, 1220, 1141, 1101, 1100, 1024, 960, 901, 900, 768, 721, 720, 480, 390, 360, 320):
        c2 = b.new_context(viewport={'width': w, 'height': 900}); p2 = c2.new_page(); p2.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
        p2.on('pageerror', lambda e: errs.append('pageerror(%d): ' % w + str(e)[:120]))
        p2.goto('file://' + FILE + '#/g/mny'); p2.wait_for_timeout(450)
        sw = p2.evaluate("() => { document.querySelectorAll('.admask,.adfloat').forEach(e => e.remove()); return document.documentElement.scrollWidth }")
        if sw > w: ov.append((w, sw))
        c2.close()
    rec('M-1 폭 21가지(1500 → 320px) — 가로 넘침 없음', not ov, ov)
    rec('M-2 화면 오류(pageerror) 0', not errs, errs[:3])
    b.close()


with sync_playwright() as p: main(p)
bad = [r for r in R if not r['ok']]
json.dump(R, open(os.path.join(OUT, 'proto_mny.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'proto_mny {len(R) - len(bad)}/{len(R)}' + (' 실패: ' + ' | '.join(r['step'][:40] for r in bad) if bad else ''))
sys.exit(1 if bad else 0)
