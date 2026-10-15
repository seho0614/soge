"""시안에 v10.25 를 넣습니다 — 소개몰(쇼핑몰) 메인을 제시 디자인(2026-10-07 · 대화로 받은 1092×2000 JPEG)대로 · 메뉴 이름 「소개뱅크몰」→「소개몰」.

  BASE(기본: 킷의 v10.24 시안을 떠 둔 _proto_v1024_base.html) → OUT(기본: 미리보기 /home/claude/pv1025/proto_v1025.html). 킷은 건드리지 않습니다(OUT 을 킷으로 주면 그때 반영).

  넣는 것
    1) 스타일 — 실제 웹의 styles/shop.css 를 글자 그대로(두 곳의 모양이 갈라지지 않게) + 시안의 소개몰 틀(#hltroot) 안에서 필요한 몇 줄
    2) 그림 — 받은 그림에서 손실 없이 자른 조각 53개(qa/cut_mall.py · mall_assets.json)를 파일 그대로(SHOP_ART)
    3) 소개몰 메인(SB-HLT-HUB-010) — 사진 띠 · 성분으로 찾기 10 · 고민으로 찾기 10 · 성분별 최저가 8 · 오늘의 건강상품(큰 띠 + 순위 5 · 탭 3) ·
       많이 찾는 상품 6 · 새로 올라온 상품 4 · 이번 주 특별 할인 6 · 아래 띠. 값은 그림의 견본 값입니다.
    4) 소개몰 화면의 머리줄 · 바닥줄 — 두 관 전용(소개광장과 같은 것 · 「무료 회원가입」만 그림대로 초록)
    5) 이름 — 보이는 글자의 「소개뱅크몰」→「소개몰」
    6) 10/8 확정 — 남기기로 한 개발분 10건(청약철회 제한 문구 · 「의약품이 아닙니다」 고지 · 판매자 정보와 약관 전문 · 판매 금지 품목 안내 · 품절 표시 ·
       교환/개봉 여부/마감일 · 단계별 시각과 발송 날짜 · 배송/환불 기한 · 내 주문 쪽 메뉴 줄 · 도매/납품 매물 구역)과 개발분 값 3건(전화 · 상호/주소 · 철회 제한 확정 문구)을 시안에도.
       소개몰 안의 머리줄 · 바닥줄 단추가 본체 화면으로 가게 이음(전에는 소개몰의 「없는 주소입니다」).
"""
import base64, json, os, re

Q = os.path.dirname(os.path.abspath(__file__))
K = '/home/claude/pkg/SGB_DevDocker_Integrated_20261002'
BASE = os.environ.get('BASE', os.path.join(Q, '_proto_v1024_base.html'))      # 킷의 v10.24 시안을 떠 둔 것 — 킷의 시안은 이 도구가 v10.25 로 바꿔 놓으므로 바탕으로 쓸 수 없습니다
OUT = os.environ.get('OUT', '/home/claude/pv1025/proto_v1025.html')
CSS = os.environ.get('CSS', '/home/claude/pv1025/sgb/site/src/styles/shop.css')
CUT = os.environ.get('CUT', os.path.join(Q, 'mall_cut'))
TERMS = os.environ.get('TERMS', os.path.join(Q, 'hlt_sale_terms.md'))      # 개발 DB 의 지금 약관(HLT_SALE 1.1) 글 그대로 — qa/srv_mall.py 가 DB 와 같은지 봅니다

s = open(BASE, encoding='utf-8').read(); n0 = len(s)
assert 'shop-hero' not in s, '이미 v10.25 가 들어 있는 파일입니다 — BASE 를 v10.24 시안으로 주십시오'

def rep(old, new, n=1):
    global s
    assert s.count(old) == n, (s.count(old), old[:90])
    s = s.replace(old, new)

# ── 0) 이름 — 맨 먼저(이 뒤에 넣는 v10.25 의 글은 이미 새 이름이라 손대지 않게) ────────────────────────────────────────────────────────────────
#   10/7 답 — 메뉴 이름 「소개몰」 · 「옛 뜻으로 남은 소개몰과 옛 이름(소개머니 · 건강몰)을 약관까지 같이 고침」.
#   「소개몰」은 2026-09-26 까지 안심소개의 이름이었습니다. 그 뜻으로 남은 글을 먼저 「안심소개」로 고친 뒤에 새 이름을 넣습니다(순서가 바뀌면 뜻이 섞입니다).
#     ① 옛 「소개몰」(= 안심소개) → 안심소개      ② 소개머니 → 소개장터      ③ 건강몰 → 소개몰      ④ 소개뱅크몰 → 소개몰
#   그림 조각(글자가 아님)과 제목의 판 이력은 건드리지 않습니다. 그대로 두는 글: 「(그림은 「소개몰」)」— 제시 디자인의 메뉴 글자를 말하는 곳.
t0 = s.index('<title>'); t1 = s.index('</title>')
head, title, tail = s[:t0], s[t0:t1], s[t1:]
KEEP = '(그림은 「소개몰」)'; HOLD = '\x00KEEP_DESIGN_NAME\x00'
B64 = re.compile(r'data:image/[a-z]+;base64,[A-Za-z0-9+/=]+')
cnt = {'옛 소개몰 → 안심소개': 0, '소개머니 → 소개장터': 0, '건강몰 → 소개몰': 0, '소개뱅크몰 → 소개몰': 0}
def names(text):
    out = []; pos = 0
    for m in B64.finditer(text):
        out.append(fix(text[pos:m.start()])); out.append(m.group(0)); pos = m.end()
    out.append(fix(text[pos:])); return ''.join(out)
def fix(t):
    t = t.replace(KEEP, HOLD)
    t, n = re.subn(r'(?<!뱅크)소개몰', '안심소개', t); cnt['옛 소개몰 → 안심소개'] += n
    n = t.count('소개머니'); t = t.replace('소개머니', '소개장터'); cnt['소개머니 → 소개장터'] += n
    n = t.count('건강몰'); t = t.replace('건강몰', '소개몰'); cnt['건강몰 → 소개몰'] += n
    n = t.count('소개뱅크몰'); t = t.replace('소개뱅크몰', '소개몰'); cnt['소개뱅크몰 → 소개몰'] += n
    return t.replace(HOLD, KEEP)
head = names(head); tail = names(tail)
title = title.replace('<title>소개뱅크 시안 v10.24 (', '<title>소개뱅크 시안 v10.25 (2026-10-08 · 소개몰(쇼핑몰) 메인을 제시 디자인대로 — 사진 띠 · 성분 · 고민 타일 · 성분별 최저가 · 오늘의 건강상품 · 특별 할인 · 메뉴 이름 「소개몰」 · 옛 이름 정리 · 청약철회 제한 문구 · 판매자 정보 · 약관 전문 · 교환 · 개봉 여부 · 단계별 시각 · 내 주문 메뉴 줄 · 도매 · 납품 매물 · 소개몰 안의 머리줄 · 바닥줄을 본체 화면으로 이음 · v10.24: ', 1)
assert title.startswith('<title>소개뱅크 시안 v10.25 ('), title[:60]
s = head + title + tail
nb = cnt

# ── 1) 스타일 ─────────────────────────────────────────────────────────────
css = open(CSS, encoding='utf-8').read()
extra = '''
/* ── 시안의 소개몰 틀(#hltroot) 안에서 필요한 것 — 그 틀은 a · button 의 색을 「물려받기」로 눌러 두어, 색을 정한 곳을 다시 적습니다 ── */
#hltroot[data-tone=shop] { --pri: #17A34A; --pri-weak: #EAF6EE; --badge-direct: #17A34A; }
#hltroot .shop [data-go], #hltroot .shop [data-stab] { cursor: pointer; }
#hltroot .shop-all { color: var(--shop-dim); }
#hltroot .shop-find button, #hltroot .shop-promo .go, #hltroot .shop-tabs button[aria-selected=true], #hltroot .shop-no { color: #fff; }
#hltroot .shop-tabs button { color: #111; font-size: 18.5px; font-weight: 700; }
#hltroot .b2-find, #hltroot .b2-login, #hltroot .b2-join, #hltroot .b2-lngb { font-size: 18px; font-weight: 700; }
#hltroot .b2-adm { font-size: 15px; font-weight: 700; }
@media (max-width: 900px) { #hltroot .shop-tabs button { font-size: 14px; } #hltroot .b2-find, #hltroot .b2-login, #hltroot .b2-join, #hltroot .b2-lngb { font-size: 13px; } }
#hltroot .shop-rank a > svg { color: var(--shop-navy); }
#hltroot .shop-hero h1 { color: #fff; } #hltroot .shop-hero h1 em { color: #22C55E; }
#hltroot .shop-promo h3 { color: #fff; } #hltroot .shop-promo h3 em { color: #FDB913; }
#hltroot .shop-sec h2, #hltroot .shop-band .tx b { color: var(--shop-navy); } #hltroot .shop-band .tx b em { color: var(--shop-green); }
#hltroot .shop h1, #hltroot .shop h2, #hltroot .shop h3 { border: 0; padding: 0; }
#hltroot .b2-hd { position: sticky; top: 0; }
#hltroot .b2-nav a { color: var(--b2-ink); } #hltroot .b2-nav a[aria-current=page] { color: var(--b2-navy); }
#hltroot .b2-find, #hltroot .b2-login, #hltroot .b2-lngb { color: var(--b2-ink); }
#hltroot .b2-join { color: #fff; } #hltroot .b2-cart { color: var(--b2-orange); } #hltroot .b2-cartn { color: #fff; }
#hltroot .b2-ftl a { color: var(--b2-ink); } #hltroot .b2-quick a { color: #555; }
#hltroot .hlt-ft { margin-top: 28px; }
#hltroot .hlt-ft.slim { padding: 12px 16px; } #hltroot .hlt-ft.slim .hlt-ft-in { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px 16px; }
#hltroot .hlt-ft.slim .hlt-ft-lnk { margin: 0; } #hltroot .hlt-ft.slim .hlt-admin-link { border: 0; margin: 0; padding: 0; }
'''
rep('<script id="hltx-integ">', '<style id="shop-css">\n' + css + extra + '</style>\n\n<script id="hltx-integ">')

# ── 2) 두 관 전용 머리줄 · 바닥줄을 소개몰 틀에서도 쓰게 내어 줌 ────────────────
rep("  window.__PLZ_ART = PLZ_ART;", "  window.__B2 = { header: b2Header, footer: b2Footer, go: function(k){ go(k); } };      /* v10.25 — 소개몰(겹쳐 뜨는 틀)이 같은 머리줄 · 바닥줄을 씁니다 · go 는 본체 화면으로 가는 길(나의공간 · 전체 목록 …) */\n  window.__PLZ_ART = PLZ_ART;")
rep("""  try{
    if (window.__SGB_HEADER) return window.__SGB_HEADER();
  }catch(_){}""", """  /* v10.25 — 두 관 전용 머리줄(소개광장과 같은 것). 「무료 회원가입」만 그림대로 초록입니다(data-b2-tone=shop) */
  try{
    if (window.__B2) return '<div data-b2-tone="shop">' + window.__B2.header("hlt") + '</div>';
  }catch(_){}
  try{
    if (window.__SGB_HEADER) return window.__SGB_HEADER();
  }catch(_){}""")
rep("""    + '<div id="hltroot"><div id="hltapp"></div>""", """    + '<div id="hltroot" data-tone="shop" data-theme="light"><div id="hltapp"></div>""")
rep("""  app.innerHTML = header()
    + '<main class="hlt-wrap" data-screen="' + r.key + '">'
    + (sc.noBack ? '' : backLink(sc, r.p))
    + body + '</main>'
    + footer(mixed);
  document.title = sc.title + " · 소개몰";""", """  /* v10.25 — 메인은 화면 폭 전체(사진 띠 · 구역 바탕), 그 밖의 쪽은 본문 폭 그대로. 바닥은 footer() 가 얇은 줄 + 두 관 전용 바닥줄을 함께 돌려줍니다 · 메인의 창 제목은 「소개몰」 한 번 */
  app.innerHTML = header()
    + (sc.bleed
        ? '<main class="shop" data-screen="' + r.key + '">' + body + '</main>'
        : '<main class="hlt-wrap" data-screen="' + r.key + '">' + (sc.noBack ? '' : (MY_SCREENS.indexOf(r.key) >= 0 ? myNav(r.key) : backLink(sc, r.p))) + body + '</main>')
    + footer(mixed);
  document.title = sc.title === "소개몰" ? "소개몰" : sc.title + " · 소개몰";""")

# 소개몰의 옛 바닥은 얇은 줄만 남김 — 새 바닥줄이 사업자 정보 · 고지를 다 싣기 때문에 그대로 두면 고지가 두 번 · 사업자 정보가 두 번 나오고 호스팅 표기(빈칸 ↔ AWS)가 서로 달랐습니다
rep("""function footer(mixed){
  return '<footer class="hlt-ft"><div class="hlt-ft-in">'""", """function footer(mixed){
  /* v10.25 — 두 관 전용 바닥줄이 사업자 정보와 두 고지(직판 · 통신판매중개자)를 싣습니다. 여기서는 겹치지 않는 것만 얇게 남깁니다 */
  if (window.__B2) return '<footer class="hlt-ft slim"><div class="hlt-ft-in">'
    + '<div class="hlt-ft-lnk">'
    + '<a href="#/guide" data-go="#/guide">이용안내 · 청약철회</a>'
    + '<a class="tbd" title="법무 회신 대기 — B-12" data-tbd="1">제3자 제공 동의</a>'
    + '<a class="tbd" title="법무 회신 대기 — B-12" data-tbd="1">유료서비스 약관</a>'
    + '</div>'
    + '<div class="hlt-admin-link"><a href="#/admin/collect" '
    + 'data-ext="ingest" title="20260930 — 별도 파일(수집관리_로컬확인_v1.1.html)이 킷에 없어 같은 시안의 수집 관리 화면(SB-ADM-COL-010)으로 연결">🔒 관리자 · 수집관리 시안 열기</a></div>'
    + '</div></footer>'
    + '<div data-b2-tone="shop">' + window.__B2.footer("shop") + '</div>';      /* 없는 주소 화면 등 소개몰의 모든 화면이 같은 바닥을 갖습니다 */
  return '<footer class="hlt-ft"><div class="hlt-ft-in">'""")

# 바닥 고지 — 10/7 답 「두 고지를 같이」: 소개몰 화면에서는 직판 고지 + 통신판매중개자 고지, 다른 화면은 중개자 고지 하나 그대로
rep("  function b2Footer(){", "  function b2Footer(tone){")
rep("""        '<p class="b2-notice"><b>소개뱅크는 통신판매중개자이며 거래의 당사자가 아닙니다.</b> 상품 · 서비스 · 사업기회에 대한 정보와 거래에 관한 책임은 등록자에게 있습니다.</p>'+""",
    """        (tone === "shop"
          ? '<p class="b2-notice" data-notice="direct"><span class="b2-ntag">소개몰 직판 상품</span> <b>소개몰에서 판매하는 상품은 소개뱅크가 직접 판매합니다.</b> 상품의 하자 · 배송 · 반품 · 환불에 대한 책임은 소개뱅크에 있습니다.</p>'+
            '<p class="b2-notice" data-notice="inter"><span class="b2-ntag">입점 판매 상품 · 매물 등 회원 간 거래</span> <b>소개뱅크는 통신판매중개자이며 거래의 당사자가 아닙니다.</b> 상품 · 서비스 · 사업기회에 대한 정보와 거래에 관한 책임은 등록자에게 있습니다.</p>'
          : '<p class="b2-notice" data-notice="inter"><b>소개뱅크는 통신판매중개자이며 거래의 당사자가 아닙니다.</b> 상품 · 서비스 · 사업기회에 대한 정보와 거래에 관한 책임은 등록자에게 있습니다.</p>')+""")

# ── 3) 그림 조각 ──────────────────────────────────────────────────────────
man = json.load(open(os.path.join(Q, 'mall_assets.json'), encoding='utf-8'))['parts']
art = {n: 'data:image/jpeg;base64,' + base64.b64encode(open(os.path.join(CUT, a['file']), 'rb').read()).decode() for n, a in man.items()}
parts = {n: [a['w'], a['h']] + a['inner'] for n, a in man.items()}

# ── 4) 소개몰 메인 ─────────────────────────────────────────────────────────
i = s.index('SCREENS["SB-HLT-HUB-010"] = {'); j = s.index('/* ── SB-HLT-HUB-020 직판관')
home = r'''/* ══ v10.25 — 소개몰 메인: 2026-10-07 제시 디자인 ══════════════════════════════════════
 * 그림 조각(SHOP_ART)은 받은 그림(대화 미리보기 JPEG)에서 **다시 압축하지 않고** 자른 파일 그대로입니다(qa/cut_mall.py).
 * 임시입니다 — 원본 PNG 가 오면 조각만 바꿉니다. SHOP_PARTS = [조각 가로, 세로, 보일 자리 x0, y0, x1, y1].
 * 값(이름 · 가격 · 할인율 · 별점)은 그림에 적힌 견본 값입니다. 그림과 다르게 넣은 것:
 *   ① 「소개뱅크몰」→「소개몰」(10/7 결정)  ② 순위 탭 「새로운 요청」→「새로 올라온 상품」  ③ 순위 아래 산출 근거 한 줄(지금 규칙)
 *   ④ 큰 띠에 「견본 문구」 표시(기능성 문구 확인 전)  ⑤ 콜라겐 정상가 28,000 → 38,000원(그림의 40% 와 맞지 않아서)
 *   ⑥ 「탱탱한 치부」→「피부」 · 「확인헤보세요」→「확인해보세요」(오자) */
var SHOP_ART = __SHOP_ART__;
var SHOP_PARTS = __SHOP_PARTS__;
window.__SHOP_ART = SHOP_ART;      /* 검증용 창구 — 넣은 조각이 잘라 둔 파일과 바이트가 같은지 밖에서 봅니다(qa/proto_mall.py) */
function shopPic(name, h, cls){
  var a = SHOP_PARTS[name]; if (!a) return "";
  var sc = h ? h / (a[5] - a[3]) : 1500 / 1092, r = Math.round;      /* 높이를 주지 않으면 그림의 크기 그대로(받은 그림 1092px = 화면 1500px) */
  return '<span class="shop-pic' + (cls ? ' ' + cls : '') + '" style="width:' + r((a[4] - a[2]) * sc) + 'px;height:' + r((a[5] - a[3]) * sc) + 'px" aria-hidden="true">'
    + '<img src="' + SHOP_ART[name] + '" alt="" width="' + r(a[0] * sc) + '" height="' + r(a[1] * sc) + '" style="left:' + (-r(a[2] * sc)) + 'px;top:' + (-r(a[3] * sc)) + 'px"></span>';
}
var SHOP_STAR = '<svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><circle cx="15" cy="15" r="15" fill="#17A34A"/><path fill="#fff" d="m15 6.6 2.5 5.3 5.8.7-4.3 4 1.1 5.8L15 19.5l-5.1 2.9 1.1-5.8-4.3-4 5.8-.7z"/></svg>';
var SHOP_CHEV = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
function shopHead(title, lead, all){
  return '<div class="shop-sech">' + SHOP_STAR + '<h2>' + esc(title) + '</h2>' + (lead ? '<p>' + esc(lead) + '</p>' : '')
    + (all ? '<a class="shop-all" role="link" tabindex="0" data-go="' + all + '">전체보기 ' + SHOP_CHEV + '</a>' : '') + '</div>';
}
/* 그림의 견본 값 — [그림 조각, 이름, 가는 곳(성분 코드 · 없으면 목록)] */
var SHOP_ING = [["ing-01","비타민","VITC"],["ing-02","유산균","PROBIO"],["ing-03","오메가 3","OMEGA3"],["ing-04","루테인","LUTEIN"],["ing-05","마그네슘","MAGNE"],
                ["ing-06","콜라겐","COLLA"],["ing-07","홍삼","REDGIN"],["ing-08","밀크씨슬","MILK"],["ing-09","단백질",""],["ing-10","칼슘","CALC"]];
var SHOP_CON = [["con-01","면역력","IMMUNE"],["con-02","눈건강","EYE"],["con-03","혈행,혈압","CIRC"],["con-04","장 건강",""],["con-05","간 건강","LIVER"],
                ["con-06","뼈, 관절","BONE"],["con-07","피부, 미용","SKIN"],["con-08","다이어트","DIET"],["con-09","남성 건강","MEN"],["con-10","여성 건강",""]];
/* [조각, 성분 이름, 30일 값, 정상가, 규격, 성분 코드] */
var SHOP_LOW = [["low-01","비타민C",2000,14700,"비타민C 1,000mg","VITC"],["low-02","유산균",2300,19800,"프로바이오 500mg","PROBIO"],["low-03","루테인",2400,21900,"루테인 20mg","LUTEIN"],
                ["low-04","마그네슘",2600,16600,"마그네슘 350mg","MAGNE"],["low-05","콜라겐",3200,22500,"콜라겐 1,500mg","COLLA"],["low-06","오메가3",3800,24900,"오메가3 1,000mg","OMEGA3"],
                ["low-07","홍삼",4700,29900,"홍삼 진액 스틱","REDGIN"],["low-08","밀크씨슬",4900,28000,"밀크씨슬 130mg","MILK"]];
/* 순위 — 탭 3개. [조각, 이름, 값, 할인율(없으면 0), 성분 코드] */
var SHOP_RANK = {
  hot:  [["rank-01","비타민C 1,000mg",14700,39,"VITC"],["rank-02","오메가3 1,000mg",24900,35,"OMEGA3"],["rank-03","루테인 20mg",21900,37,"LUTEIN"],["rank-04","유산균 500mg",19800,38,"PROBIO"],["rank-05","마그네슘 350mg",16500,41,"MAGNE"]],
  fresh:[["new-01","홍삼 진액스틱 30포",34900,0,"REDGIN"],["new-02","포스트바이오틱스",27800,0,"PROBIO"],["new-03","관절건강 MSM",19900,0,"MSM"],["new-04","어린이 비타민D",15900,0,"VITD"],["rank-05","마그네슘 350mg",16500,41,"MAGNE"]],
  many: [["many-01","비타민C 1,000mg",14700,39,"VITC"],["many-02","유산균 500mg",19800,38,"PROBIO"],["many-03","루테인 20mg",21900,37,"LUTEIN"],["many-04","마그네슘 350mg",16500,41,"MAGNE"],["many-05","콜라겐 1,500mg",22900,40,"COLLA"]]
};
var SHOP_TABS = [["hot","실시간 인기"],["fresh","새로 올라온 상품"],["many","많이 찾는 상품"]];
var SHOP_MANY = [["many-01","비타민C 1,000mg",14700,"VITC"],["many-02","유산균 500mg",19800,"PROBIO"],["many-03","루테인 20mg",21900,"LUTEIN"],
                 ["many-04","마그네슘 350mg",16500,"MAGNE"],["many-05","콜라겐 1,500mg",22900,"COLLA"],["many-06","밀크씨슬 130mg",18900,"MILK"]];
/* [조각, 이름, 값, 별점, 후기 수, 성분 코드] */
var SHOP_NEW = [["new-01","홍삼 진액스틱 30포",34900,"4.8",123,"REDGIN"],["new-02","포스트바이오틱스",27800,"4.7",86,"PROBIO"],["new-03","관절건강 MSM",19900,"4.6",94,"MSM"],["new-04","어린이 비타민D",15900,"4.8",65,"VITD"]];
/* [조각, 이름, 설명 1, 설명 2, 값, 정상가, 별점, 후기 수, 성분 코드] */
var SHOP_DEAL = [["deal-01","비타민C 1,000mg","프리미엄 정","하루 한 알, 활력 충전",14700,24000,"4.8",1234,"VITC"],["deal-02","유산균 500mg","프로바이오틱스","장 건강을 위한 선택",19800,32000,"4.9",856,"PROBIO"],
                 ["deal-03","루테인 20mg","눈 건강 포뮬러","하루 한 알, 선명한 하루",21900,35000,"4.8",642,"LUTEIN"],["deal-04","마그네슘 350mg","에너지 밸런스","활기찬 하루를 위해",16500,28000,"4.7",421,"MAGNE"],
                 ["deal-05","콜라겐 1,500mg","저분자 피쉬콜라겐","탱탱한 피부를 위한 선택",22900,38000,"4.8",978,"COLLA"],["deal-06","밀크씨슬 130mg","간 건강 포뮬러","간 건강을 위한 하루 한 알",18900,29000,"4.7",512,"MILK"]];
function shopTo(code, list){ return code ? "#/i/" + code : (list || "#/ingredients"); }
function shopPct(now, was){ return Math.round((1 - now / was) * 100); }

SCREENS["SB-HLT-HUB-010"] = {
  path:"#/", parent:null, title:"소개몰", bleed:true, noBack:true, tab:"hot",
  render:function(){
    var me = this, rk = SHOP_RANK[me.tab] || SHOP_RANK.hot;
    return '<section class="shop-hero" data-shop-hero="1"><div class="shop-hero-in">'
      + shopPic("hero-right", 326)
      + '<h1>믿을 수 있는 건강 상품,<br><em>소개몰</em>에서 만나보세요.</h1>'
      + '<p class="shop-lead">합리적인 가격으로 건강한 습관을 시작하세요.</p>'
      + '<form class="shop-find" role="search" data-shopfind="1">'
      + '<svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true"><path fill="#1D6BF3" d="M12 1.5c.7 5.6 4.9 9.8 10.5 10.5C16.9 12.7 12.7 16.9 12 22.5 11.3 16.9 7.1 12.7 1.5 12 7.1 11.3 11.3 7.1 12 1.5z"/></svg>'
      + '<label><b>어떤 건강 상품을 찾고 계신가요 ?</b><input name="q" type="search" maxlength="50" placeholder="예) 비타민 C, 유산균, 루테인, 마그네슘, 콜라겐" aria-label="건강 상품 검색어"></label>'
      + '<button type="submit" aria-label="검색"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg></button>'
      + '</form></div></section>'

      + '<div class="shop-in">'
      /* 그림에는 없지만 남긴 줄 — 직판관 · 전체제품 · 이용안내(청약철회) · 내 주문 · 장바구니로 가는 길 */
      + '<nav class="shop-lnav" aria-label="소개몰 메뉴">'
      + [["직판관","#/direct"],["전체제품","#/c/HLT_FOOD"],["성분별","#/ingredients"],["고민별","#/concerns"]].map(function(x){ return '<a role="link" tabindex="0" data-go="' + x[1] + '">' + x[0] + '</a>'; }).join("")
      + '<span class="sp"></span>'
      + [["이용안내 · 청약철회","#/guide"],["내 주문","#/my/orders"],["장바구니","#/cart"]].map(function(x){ return '<a role="link" tabindex="0" data-go="' + x[1] + '">' + x[0] + '</a>'; }).join("")
      + '</nav>'

      + '<section class="shop-sec cream" data-shop-ing="1">' + shopHead("성분으로 찾기", "원하는 성분을 선택하면 관련 상품을 바로 볼 수 있어요.", "#/ingredients")
      + '<div class="shop-tiles">' + SHOP_ING.map(function(x){
          return '<a class="shop-tile" role="link" tabindex="0" data-go="' + shopTo(x[2], "#/ingredients") + '">' + shopPic(x[0], 0) + '<b>' + esc(x[1]) + '</b></a>'; }).join("") + '</div></section>'

      + '<section class="shop-sec cream" data-shop-con="1">' + shopHead("고민으로 찾기", "건강 고민에 맞는 상품을 찾아보세요.", "#/concerns")
      + '<div class="shop-tiles">' + SHOP_CON.map(function(x){
          return '<a class="shop-tile" role="link" tabindex="0" data-go="' + (x[2] ? "#/w/" + x[2] : "#/concerns") + '">' + shopPic(x[0], 0) + '<b>' + esc(x[1]) + '</b></a>'; }).join("") + '</div></section>'

      + '<section class="shop-sec" data-shop-low="1">' + shopHead("성분별 최저가", "주요 성분별 가장 저렴한 상품을 확인해보세요. (30일 기준)", "#/ingredients")
      + '<div class="shop-low">' + SHOP_LOW.map(function(x){
          return '<a class="shop-lowc" role="link" tabindex="0" data-go="' + shopTo(x[5]) + '"><span class="ph">' + shopPic(x[0], 111) + '</span>'
            + '<b>' + esc(x[1]) + '</b><b>' + won(x[2]) + ' / 30일</b><span class="was">정상가 ' + won(x[3]) + '</span><span class="spec">' + esc(x[4]) + '</span></a>'; }).join("") + '</div></section>'

      + '<section class="shop-sec pale" data-shop-today="1">' + shopHead("오늘의 건강상품", "지금 가장 인기 있는 건강상품과 실시간 트렌드를 확인해보세요.", "#/c/HLT_FOOD")
      + '<div class="shop-today">'
      + '<div class="shop-promo" data-shop-promo="1">' + shopPic("promo-right", 393)
      + '<span class="tag">지금 가장 많이 찾는 건강상품</span>'
      + '<h3>환절기 면역력 강화<em>비타민C 특가전</em></h3>'
      + '<p>온 가족이 함께하는<br>건강한 하루를 시작하세요.</p>'
      + '<a class="go" role="link" tabindex="0" data-go="#/i/VITC">지금 바로 보기 →</a>'
      + '<span class="sample" title="건강기능식품의 기능성 문구는 인정된 범위와 광고 심의를 확인한 뒤에 씁니다">견본 문구 — 광고 심의 확인 전</span></div>'
      + '<div class="shop-rankbox" data-shop-rank="1">'
      + '<div class="shop-tabs" role="tablist">' + SHOP_TABS.map(function(t){
          return '<button type="button" role="tab" aria-selected="' + (me.tab === t[0] ? "true" : "false") + '" data-stab="' + t[0] + '">' + t[1] + '</button>'; }).join("") + '</div>'
      + '<ol class="shop-rank">' + rk.map(function(x, i){
          return '<li><a role="link" tabindex="0" data-go="' + shopTo(x[4]) + '"><span class="shop-no">' + (i + 1) + '</span><span class="th">' + shopPic(x[0], 60) + '</span>'
            + '<span class="tx"><b>' + esc(x[1]) + '</b><span>' + won(x[2]) + (x[3] ? '<i>' + x[3] + '%</i>' : '') + '</span></span>' + SHOP_CHEV.replace('width="16" height="16"', 'width="26" height="26"') + '</a></li>'; }).join("") + '</ol>'
      + '<p class="shop-basis" data-basis="1">순위 근거 — 자사 2026-09 주문 건수 기준(견본) · 순위에는 산출 근거 · 기간을 함께 답니다.</p>'
      + '</div></div></section>'

      + '<div class="shop-two">'
      + '<section class="shop-sec" data-shop-many="1">' + shopHead("많이 찾는 상품", "", "#/c/HLT_FOOD")
      + '<div class="shop-many">' + SHOP_MANY.map(function(x, i){
          return '<a role="link" tabindex="0" data-go="' + shopTo(x[3]) + '"><span class="shop-no">' + (i + 1) + '</span><span class="th">' + shopPic(x[0], 50) + '</span>'
            + '<span class="tx"><b>' + esc(x[1]) + '</b><span>' + won(x[2]) + '</span></span></a>'; }).join("") + '</div></section>'
      + '<section class="shop-sec" data-shop-new="1">' + shopHead("새로 올라온 상품", "", "#/c/HLT_FOOD")
      + '<div class="shop-new">' + SHOP_NEW.map(function(x){
          return '<a class="shop-newc" role="link" tabindex="0" data-go="' + shopTo(x[5]) + '"><span class="ph">' + shopPic(x[0], 84) + '</span>'
            + '<span class="bd"><b>' + esc(x[1]) + '</b><span class="pr">' + won(x[2]) + '</span><span class="shop-star">' + x[3] + ' <i>(' + x[4].toLocaleString("ko-KR") + ')</i></span></span></a>'; }).join("") + '</div></section>'
      + '</div>'

      + '<section class="shop-sec" data-shop-deal="1">' + shopHead("이번 주 특별 할인", "지금 가장 주목받는 할인 상품이에요.", "#/c/HLT_FOOD")
      + '<div class="shop-deal">' + SHOP_DEAL.map(function(x){
          return '<a class="shop-dealc" role="link" tabindex="0" data-go="' + shopTo(x[8]) + '"><span class="ph">' + shopPic(x[0], 76) + '</span>'
            + '<b>' + esc(x[1]) + '</b><span class="ds">' + esc(x[2]) + '</span><span class="ds">' + esc(x[3]) + '</span>'
            + '<span class="pr"><strong>' + won(x[4]) + '</strong><s>' + won(x[5]) + '</s><i>' + shopPct(x[4], x[5]) + '%</i></span>'
            + '<span class="shop-star">' + x[6] + ' <i>(' + x[7].toLocaleString("ko-KR") + ')</i></span></a>'; }).join("") + '</div></section>'

      + '<section class="shop-band" data-shop-band="1">' + shopPic("band-left", 110, "l") + shopPic("band-right", 110, "r")
      + '<div class="tx"><b>건강한 선택, <em>소개몰</em>과 함께하세요</b><span>믿을 수 있는 건강상품으로 더 나은 오늘을 만들어보세요.</span></div>'
      + '<a class="go" role="link" tabindex="0" data-go="#/c/HLT_FOOD">특가 상품 보러가기 →</a></section>'
      + '</div>';
  },
  mixed:function(){ return mixedSellers(openProducts()); }
};

'''.replace('__SHOP_ART__', json.dumps(art)).replace('__SHOP_PARTS__', json.dumps(parts))
s = s[:i] + home + s[j:]

# 순위 탭 · 사진 띠의 검색 — 소개몰의 누르기 처리(wire)에 더합니다
rep("""function wire(){
  const app = document.getElementById("hltapp");
""", """function wire(){
  const app = document.getElementById("hltapp");
  /* v10.25 — 메인의 순위 탭 · 사진 띠의 검색 칸 */
  app.querySelectorAll("[data-stab]").forEach(function(b){
    b.onclick = function(e){ e.stopPropagation(); SCREENS["SB-HLT-HUB-010"].tab = b.getAttribute("data-stab"); const y = document.getElementById("hltroot").scrollTop; render(); document.getElementById("hltroot").scrollTop = y; };
  });
  const sf = app.querySelector("[data-shopfind]");
  if (sf) sf.onsubmit = function(e){ e.preventDefault(); const v = (sf.querySelector("input").value || "").trim(); location.hash = v ? "/search?q=" + encodeURIComponent(v) : "/search"; };
""")

# 작은 상품 그림(장바구니 · 주문서 · 내 주문 · 주문 상세 · 취소/반품) — 상품에 그림 글자(ic) 값이 없는데 그대로 이어 붙여 「undefined」가 글자로 찍혔습니다(v10.24 까지 · G-162)
import re as _re
s, n_th = _re.subn(r"""<div class="th">' \+ ([\w\.\[\]]+)\.ic \+ '</div>""", lambda m: """<div class="th">' + thIc(""" + m.group(1) + """) + '</div>""", s)
assert n_th == 7, n_th
rep("""const prod = function(id){ return PRODUCTS.filter(function(p){ return p.id === id; })[0]; };""",
    """const prod = function(id){ return PRODUCTS.filter(function(p){ return p.id === id; })[0]; };
/* v10.25 — 작은 상품 그림. 「undefined」가 글자로 찍히던 자리에 상품 그림을 칸 크기(60px)로 그립니다. 상품을 못 찾으면 빈 칸 */
const thIc = function(it){ const p = it && it.pid ? prod(it.pid) : null; return p ? productArt(p, 60) : ""; };""")
rep("#hltroot .hlt-ft { margin-top: 28px; }\n", "#hltroot .hlt-ft { margin-top: 28px; }\n#hltroot .hlt-ci .th svg { display: block; border-radius: 8px; }\n")

# ── 6) 10/8 확정분 — 남기기로 한 10건 · 개발분 값 3건 · 머리줄/바닥줄을 본체로 잇기 ────────────────
from apply_proto_v1025_x import apply as apply_x
s = apply_x(s, TERMS)

open(OUT, 'w', encoding='utf-8').write(s)
print(f'{BASE} → {OUT}  {n0:,} → {len(s):,} 자 · 그림 조각 {len(art)}개 · 이름 {nb}')
