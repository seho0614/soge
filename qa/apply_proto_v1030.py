"""시안(spec/proto.html)에 v10.30 을 넣습니다 — 소개장터 메인(#/g/mny · SB-MNY-MAIN-010)을 제시 디자인(2026-10-09)대로.
  (v10.29 「시안 디자인 · 기능 반영 + 검색」은 실제 웹만 바꿨고 시안은 v10.28 그대로였습니다 — 그래서 바탕은 v10.28 시안입니다.)

  python3 apply_proto_v1030.py                 BASE(v10.28 시안)에서 읽어 OUT 에 씁니다 — 몇 번을 돌려도 같은 결과
  BASE=/path/SGB_Prototype_v10_28.html OUT=/path/proto.html python3 apply_proto_v1030.py

10/9 지시 — 「소개뱅크로 적용할 수 있도록 변환 · 이미지 그대로 사용」 (받은 것: 소개장터 메인 화면 그림 · 디자인 시트)
답 — ① 시안 + 실제 웹 모양(DB 변경 없음) ② 지금 있던 구역(인기 매물 · 바로가기 5)은 디자인 아래에 남김 ③ 디자인 시트는 소개장터에만 ④ 글꼴도 소개장터에만

넣는 것
  ① 스타일 — 실제 웹의 styles/sgb-tokens.css · styles/money.css 를 **글자 그대로** 넣습니다(시안과 실제 웹이 같은 모양이 되게) + 시안에만 필요한 몇 줄.
  ② 글꼴 — 페이퍼로지 500 · 700 / 나눔스퀘어 네오 400 · 700 · 800 을 이 화면에 쓰는 글자만 추려(woff2) 파일 안에 넣습니다(시안은 파일 한 장이라야 합니다).
  ③ 그림 — 받은 그림에서 자른 53장(qa/cut_money.py 가 만든 money_cut/*.png): 아이콘 · 로고 36장은 PNG 파일 그대로, 견본 사진 17장은 무손실 WebP(받은 그림의 형식 · 점 하나까지 같음). 줄이거나 색을 바꾸지 않습니다(MNY_ART).
  ④ 머리줄 · 바닥줄 — 두 관 전용 머리줄 · 바닥줄(b2Header · b2Footer)을 같이 쓰고, 소개장터에서는 로고 · 사회관계망 아이콘을 그 디자인의 것으로, 장바구니 자리에 알림 종을 놓습니다.
  ⑤ 화면 — 그림의 구역 전부(맨 위 · 광고 · 바로가기 3 · 분야 14 · 분류 목록 · 업체 추천 · 소개 요청 · AI 추천 · 띠 광고 · 연결 사례 · 공급자 등록).
            글자 · 숫자는 그림 그대로인 **견본**입니다. 「지금 인기 있는 상품/서비스」(퀵메뉴 5 · 소개상품 찾기 · 매물 · 쪽 번호)는 오른쪽 칸의 디자인 구역 아래에 남깁니다.
            분야 14칸 · 분류 목록을 누르면 실제 웹과 같이 그 낱말로 아래 목록을 거릅니다(S.mnyKw).
  ⑥ 판 이름 v10.30 · 화면 설명(SB-MNY-MAIN-010)
화면 수는 그대로입니다(모양만 바뀜). 안심소개 · 소개창업의 관 메인(gwanLanding)은 그대로입니다.
"""
import base64, io, json, os, re, shutil

Q = os.path.dirname(os.path.abspath(__file__))
_kit = os.path.join(os.path.dirname(Q), 'sgb')
K = os.environ.get('KIT') or (_kit if os.path.isdir(os.path.join(_kit, 'spec')) else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
BASE = os.environ.get('BASE') or next((p for p in ('/home/claude/w/v29/base/SGB_Prototype_v10_28.html', os.path.join(Q, '_proto_v1028_base.html')) if os.path.isfile(p)), '')
OUT = os.environ.get('OUT', os.path.join(K, 'spec/proto.html'))
CUT = os.environ.get('CUT', os.path.join(Q, 'money_cut'))
FONTS = os.environ.get('FONTS', os.path.join(K, 'site/public/fonts'))
s = open(BASE, encoding='utf-8').read(); n0 = len(s)
assert re.search(r'<title>소개뱅크 시안 v10\.28 ', s), 'BASE 가 v10.28 시안이 아닙니다'

def rep(old, new, n=1):
    global s
    assert s.count(old) == n, (old[:90], s.count(old))
    s = s.replace(old, new)

# ══ ③ 그림 — 자른 PNG 를 파일 그대로 ═══════════════════════════════════════════════
man = json.load(open(os.path.join(Q, 'money_assets.json'), encoding='utf8'))['parts']
# · 아이콘 · 로고 · 작은 그림(36장)은 자른 PNG 파일 그대로 — 실제 웹(site/public/money)이 쓰는 29장은 그 파일과 바이트가 같습니다.
# · 견본 사진 17장(광고 2 · 업체 4 · 요청 4 · AI 4 · 사례 3)은 **받은 그림과 같은 형식(WebP)의 무손실**로 넣습니다 — 점은 하나도 달라지지 않고(아래에서 풀어 다시 견줍니다),
#   PNG 보다 27% 작습니다. 시안은 같은 파일이 킷에 세 벌 들어가 묶음 크기 한도(30MiB)를 넘기 때문입니다(사진은 실제 웹에 두지 않습니다 — 서버에 자료가 없는 구역).
from PIL import Image
PHOTO = re.compile(r'^(hero_ad|band_ad|svc_\d|req_\d|ai_\d|case_\d)$')
art = {}; size = {}; n_webp = 0
for name, v in man.items():
    path = os.path.join(CUT, name + '.png'); data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', name
    if PHOTO.match(name):
        im = Image.open(path).convert('RGB'); b = io.BytesIO(); im.save(b, 'WEBP', lossless=True, quality=100, method=6)
        assert Image.open(io.BytesIO(b.getvalue())).convert('RGB').tobytes() == im.tobytes(), name      # 무손실 — 점 하나까지 같음
        art[name] = 'data:image/webp;base64,' + base64.b64encode(b.getvalue()).decode(); n_webp += 1
    else:
        art[name] = 'data:image/png;base64,' + base64.b64encode(data).decode()
    size[name] = v['css']
assert not PHOTO.match('logo') and all(not PHOTO.match(n) for n, v in man.items() if v['site']), '실제 웹이 쓰는 그림은 PNG 그대로여야 합니다'
m = re.search(r'\nvar PLZ_ART = \{.*\};\n', s); assert m
s = s[:m.end()] + ('/* v10.30 — 소개장터 메인의 그림. 받은 디자인(docs/design/money_main_20261009.webp · 3000×4850)에서 그 자리만 잘라 냈습니다(색 · 크기 변경 없음).\n'
                   '   아이콘 · 로고 36장은 PNG 파일 그대로(실제 웹의 29장과 바이트가 같음) · 견본 사진 17장은 받은 그림과 같은 형식(WebP)의 무손실 — 어느 쪽이든 원본의 그 자리와 점 하나까지 같습니다\n'
                   '   (qa/cut_money.py --check 가 봅니다). 화면에는 절반 크기(MNY_SIZE)로 놓습니다. */\n'
                   'var MNY_ART = ' + json.dumps(art, ensure_ascii=False) + ';\n'
                   'var MNY_SIZE = ' + json.dumps(size) + ';\n') + s[m.end():]

# ══ ⑤ 화면 — 변환본(2026-10-09)의 틀을 시안의 글자 조립으로 옮깁니다 ═════════════════════════════
T = r'''
<section class="mny-hero" aria-labelledby="mny-h1"><div class="mny-hero-in">
  <div class="mny-hero-l">
    <h1 class="mny-h1" id="mny-h1">필요한 업체를<br>AI로 쉽게 <em>찾아보세요.</em></h1>
    <p class="mny-lead">상품, 서비스, 전문가까지.<br>원하는 조건에 맞는 믿을 수 있는 공급자를 연결해드립니다.</p>
    <form class="mny-search" role="search" data-search="1" action="#" novalidate>
      {{spark|}}
      <label class="mny-sr" for="mny-q">키워드 검색</label>
      <input id="mny-q" class="si" name="q" type="search" placeholder="키워드를 검색해보세요." autocomplete="off" maxlength="50">
      <button type="submit" aria-label="검색"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="10.6" cy="10.6" r="7"/><path d="m16 16 4.6 4.6"/></svg></button>
    </form>
    <div class="mny-kw">
      <span class="mny-kw-t">{{flame|}}많이 찾는 키워드</span>
      <a class="mny-chip" href="#" data-mny-kw="사무실 청소" style="--pad:11.5px">사무실 청소</a>
      <a class="mny-chip" href="#" data-mny-kw="인테리어" style="--pad:14.75px">인테리어</a>
      <a class="mny-chip" href="#" data-mny-kw="이사" style="--pad:14.5px">이사</a>
      <a class="mny-chip" href="#" data-mny-kw="세무사" style="--pad:17.5px">세무사</a>
      <a class="mny-chip" href="#" data-mny-kw="카페 창업" style="--pad:14.25px">카페 창업</a>
    </div>
  </div>
  <div class="mny-ad" data-mny-ad="hero">
    <a href="#" data-t="광고(견본) — 받은 그림의 광고입니다. 실제 웹은 이 자리에 운영 화면에서 넣은 「관 랜딩 상단」 광고를 보여 줍니다." aria-label="광고 — 사무실 인테리어 전문 시공 업체. 공간의 가치를 높이는 맞춤형 사무공간 제안. 견적 문의하기">{{hero_ad|}}</a>
    <button type="button" class="is-prev" data-t="받은 그림에는 광고가 1장뿐입니다. 「1 / 3」 과 화살표는 그림에 들어 있는 모양입니다." aria-label="이전 광고"></button>
    <button type="button" class="is-next" data-t="받은 그림에는 광고가 1장뿐입니다. 「1 / 3」 과 화살표는 그림에 들어 있는 모양입니다." aria-label="다음 광고"></button>
  </div>
</div></section>
<div class="mny-wrap">
  <nav class="mny-quick" aria-label="소개장터 바로가기">
    <a class="mny-qc" href="#" data-go="reg"><i class="mny-qc-i">{{quick_send|}}</i><div><b>소개하기</b><span>상품, 서비스를 소개해요.</span></div><i class="mny-chev" aria-hidden="true"></i></a>
    <a class="mny-qc" href="#" data-go="reqn"><i class="mny-qc-i">{{quick_want|}}</i><div><b>소개받고 싶어요</b><span>원하는 조건으로 요청해요.</span></div><i class="mny-chev" aria-hidden="true"></i></a>
    <a class="mny-qc" href="#" data-go="reql"><i class="mny-qc-i">{{quick_recv|}}</i><div><b>소개받기</b><span>지금 올라온 요청을 확인해요.</span></div><i class="mny-chev" aria-hidden="true"></i></a>
  </nav>
  <section class="mny-cat" aria-labelledby="mny-cat-t">
    <div class="mny-cat-h"><h2 id="mny-cat-t">무엇을 소개받고 싶으세요 ?</h2><p>원하는 분야를 선택하면 더 정확한 매칭을 도와드려요.</p><a class="mny-more" href="#" data-go="lstm">전체보기<i class="mny-chev" aria-hidden="true"></i></a></div>
    <div class="mny-tiles">{{TILES}}</div>
  </section>
  <div class="mny-cols">
    <aside class="mny-side" aria-labelledby="mny-side-t">
      <h2 class="mny-side-h" id="mny-side-t">전체 카테고리</h2>
      <div class="mny-side-b">
        <div>
          <button type="button" class="mny-sg" aria-expanded="true" aria-controls="mny-sl-goods">{{side_goods|}}상품<i class="mny-chev" aria-hidden="true"></i></button>
          <ul class="mny-sl" id="mny-sl-goods">{{SIDE_goods}}</ul>
        </div>
        <div>
          <button type="button" class="mny-sg is-on" aria-expanded="true" aria-controls="mny-sl-service">{{side_service|}}서비스<i class="mny-chev" aria-hidden="true"></i></button>
          <ul class="mny-sl" id="mny-sl-service">{{SIDE_service}}</ul>
        </div>
        <div>
          <a class="mny-sg is-plain" href="#" data-mny-f="전문가"{{CUR_expert}}>{{side_expert|}}전문가<i class="mny-chev" aria-hidden="true"></i></a>
          <a class="mny-sg is-plain" href="#" data-mny-f="업체"{{CUR_company}}>{{side_company|}}업체<i class="mny-chev" aria-hidden="true"></i></a>
          <a class="mny-sg is-plain" href="#" data-go="reql">{{side_want|}}구해요 / 의뢰<i class="mny-chev" aria-hidden="true"></i></a>
        </div>
        <hr>
        <div>
          <div class="mny-sg is-region">{{side_region|}}지역으로 찾기</div>
          <ul class="mny-sl is-region">{{REGIONS}}</ul>
        </div>
      </div>
    </aside>
    <div class="mny-main">
      <section class="mny-panel" aria-labelledby="mny-p1" data-mny-sample="providers">
        <div class="mny-ph">{{badge|}}<h2 id="mny-p1">서비스 업체 추천</h2><a class="mny-more" href="#" data-t="서비스 업체 전체보기 — 견본입니다. 업체 단위 목록 · 평점이 서버에 없어 실제 웹에는 이 구역을 넣지 않았습니다.">전체보기<i class="mny-chev" aria-hidden="true"></i></a></div>
        <div class="mny-cards">{{CARDS_svc}}</div>
      </section>
      <section class="mny-panel is-req" aria-labelledby="mny-p2">
        <div class="mny-ph">{{badge|}}<h2 id="mny-p2">지금 올라온 소개 요청</h2><a class="mny-more" href="#" data-go="reql">전체보기<i class="mny-chev" aria-hidden="true"></i></a></div>
        <div class="mny-tabs" role="tablist" aria-label="요청 종류">{{TABS}}</div>
        <div class="mny-reqs" role="tabpanel">{{REQS}}<p class="mny-empty" hidden>이 종류의 요청은 받은 그림에 없습니다. 「전체」에서 4건을 볼 수 있습니다.</p></div>
      </section>
      <section class="mny-panel is-aip" aria-labelledby="mny-p3" data-mny-sample="ai">
        <div class="mny-ph">{{badge|}}<h2 id="mny-p3">AI 추천 맞춤 공급자</h2><a class="mny-more" href="#" data-t="AI 추천 전체보기 — 견본입니다. 메인에 뿌릴 추천 목록이 서버에 없어 실제 웹에는 이 구역을 넣지 않았습니다.">전체보기<i class="mny-chev" aria-hidden="true"></i></a></div>
        <div class="mny-cards is-ai">{{CARDS_ai}}</div>
      </section>
    </div>
    {{OLD}}
  </div>
  <a class="mny-band" href="#" data-t="광고(견본) — 받은 그림의 띠 광고입니다. 이 자리의 광고 칸 종류가 서버에 없어 실제 웹에는 넣지 않았습니다." aria-label="광고 — 우리 공간에 딱 맞는 사무 가구, 다양한 브랜드를 비교하고 선택하세요. 지금 견적 받기">{{band_ad|}}</a>
  <div class="mny-bottom">
    <section class="mny-cases" aria-labelledby="mny-p4" data-mny-sample="cases">
      <div class="mny-cases-h">{{badge_s|}}<h2 id="mny-p4">최근 실제 연결 사례</h2></div>
      <div class="mny-case-l">{{CASES}}</div>
    </section>
    <div class="mny-cta">
      <p>전국의 다양한 공급자를 기다리고 있어요.<br>지금, 새로운 기회를 만나보세요.</p>
      <a href="#" data-go="reg">공급자로 등록하기<svg width="14" height="10" viewBox="0 0 14 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 5h12M9 1l4 4-4 4"/></svg></a>
    </div>
  </div>
</div>
'''
def js_html(t):
    """HTML 틀 → 자바스크립트 글자 조립. {{이름|대체 글}} = 그림 · {{이름}} = 그 자리에 넣을 변수"""
    out = []
    for line in t.strip().split('\n'):
        line = line.strip()
        if not line: continue
        line = line.replace('\\', '\\\\').replace("'", "\\'")
        line = re.sub(r'\{\{([a-z0-9_]+)\|([^}]*)\}\}', lambda m: "'+mnyPic(\"%s\",\"%s\")+'" % (m.group(1), m.group(2)), line)
        line = re.sub(r'\{\{([A-Za-z_]+)\}\}', lambda m: "'+%s+'" % m.group(1), line)
        out.append("      '" + line + "'")
    return '+\n'.join(out)
for n in re.findall(r'\{\{([a-z0-9_]+)\|', T): assert n in art, n

JS = r'''
  /* ══ v10.30 (2026-10-09) — 소개장터 메인(SB-MNY-MAIN-010 · #/g/mny) — 제시 디자인(docs/design/money_main_20261009.webp · 디자인 시트) ══════════
     10/9 지시 — 「소개뱅크로 적용할 수 있도록 변환 · 이미지 그대로 사용」
     답 — ① 시안 + 실제 웹 모양(DB 변경 없음) ② 지금 있던 구역(인기 매물 · 바로가기 5)은 디자인 아래에 남김 ③ 디자인 시트는 소개장터에만 ④ 글꼴도 소개장터에만
     · 그림은 MNY_ART(받은 그림에서 자른 PNG 그대로 · 화면에는 절반 크기)입니다. 선으로 된 기호(돋보기 · 화살표 · ›)만 여기서 그립니다.
     · 머리줄 · 바닥줄은 두 관 전용 틀(b2Header · b2Footer)을 같이 씁니다 — 색조 money(글꼴 · 치수 · 주황 #FFA03E · 로고 · 종).
     · 모양은 실제 웹의 styles/money.css 그대로입니다(같은 파일을 글자 그대로 넣음).
     ★ 견본입니다 — 업체 · 요청 · 사례 · 광고 · 키워드의 글자와 숫자는 **받은 그림의 내용 그대로**이고 저장하지 않습니다.
       실제 웹(/money)은 서버에 자료가 있는 구역만 그립니다: 검색 · 광고(관 랜딩 상단 소재) · 바로가기 3 · 분야 14 · 분류 목록 · 소개 요청(실제 요청) · 인기 매물 · 공급자 등록.
       서버에 없어 실제 웹에 넣지 않은 구역: 많이 찾는 키워드 · 서비스 업체 추천 · AI 추천 맞춤 공급자 · 띠 광고 · 최근 실제 연결 사례 · 지역으로 찾기 · 요청 종류 탭 · 요청 사진 · 지역.
     · 그림과 다르게 넣은 것: 사업자 정보 · 통신판매중개자 고지 · 바로가기 줄(바닥줄) · 「분쟁조정 안내」 링크(사이트 정보의 목록 그대로) · 로그인한 사람의 칸 ·
       지금 있던 구역(인기 매물 · 바로가기 5)을 오른쪽 칸의 디자인 구역 아래에 · 사회관계망 아이콘은 계정 주소를 넣기 전에는 흐리게(준비 중). */
  function mnyPic(n, alt){
    var a = MNY_SIZE[n];
    return '<img src="'+MNY_ART[n]+'" width="'+a[0]+'" height="'+a[1]+'" alt="'+esc(alt || "")+'"'+(alt ? '' : ' aria-hidden="true"')+'>';
  }
  /* 알림 종 — 로그인하지 않은 모습은 받은 그림 그대로입니다(종에 숫자 「1」이 같이 그려져 있음 · 견본).
     로그인하면 실제 웹과 같이 선으로 그린 종에 읽지 않은 알림 수를 붙입니다(운영 「알림 정책」을 끄면 숫자 없음). */
  function mnyBell(inn){
    var n = CFG.alertPolicy ? CFG.alertCount : 0;
    if (!inn) return '<a class="b2-bell is-pic" href="#" data-go="myntf" aria-label="알림 — 견본(받은 그림 그대로)">'+mnyPic("bell","")+'</a>';
    return '<a class="b2-bell" href="#" data-go="myntf" aria-label="알림'+(n > 0 ? ' — 읽지 않은 알림 '+n+'건' : '')+'">'+
      '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+
      '<path d="M12 3.2v1.3"/><path d="M5.2 17.2c1.3-1.2 1.9-2.6 1.9-4.6v-2a4.9 4.9 0 0 1 9.8 0v2c0 2 .6 3.4 1.9 4.6z"/><path d="M10.2 19.6a1.9 1.9 0 0 0 3.6 0"/></svg>'+
      (n > 0 ? '<span class="b2-belln" aria-hidden="true">'+(n > 99 ? "99+" : n)+'</span>' : '')+'</a>';
  }
  /* 분야 14칸 · 분류 목록 — 이름은 그림 그대로. 서버에 이 분류가 없어(업종 15개의 이름이 다름) 실제 웹은 그 이름의 첫 낱말로 매물을 찾습니다
     (/money?keyword=…#mny-list · site/src/components/money/menu.ts 와 같은 표). 시안도 같은 방식입니다 — 누르면 아래 「지금 인기 있는 상품/서비스」를 그 낱말로 거릅니다(S.mnyKw). */
  var MNY_TILES = [["cat_all","전체",""],["cat_furn","가구, 인테리어","가구"],["cat_clean","청소, 방역","청소"],["cat_move","이사, 운송","이사"],["cat_used","중고 거래","중고"],
    ["cat_office","사무 용품","사무"],["cat_make","제조, 유통","제조"],["cat_build","공사, 시공","공사"],["cat_design","디자인, 마케팅","디자인"],["cat_it","IT, 개발","개발"],
    ["cat_tax","세무, 노무","세무"],["cat_edu","교육, 컨설팅","교육"],["cat_event","행사, 모임","행사"],["cat_etc","기타",""]];
  var MNY_SIDE = { goods:[["가구, 인테리어","가구"],["사무용품,전자기기","사무용품"],["중고 물품","중고"],["산업 장비","장비"],["기타 상품",""]],
                   service:[["청소, 방역","청소"],["인테리어","인테리어"],["이사, 운송","이사"],["설치, 수리","설치"],["광고, 마케팅","광고"],["기타 서비스",""]] };
  var MNY_REGIONS = ["서울","경기","인천","대전","대구","부산","울산","광주","제주","기타 지역"];
  /* 견본 — 받은 그림의 글자 · 숫자 그대로 */
  var MNY_SVC = [["svc_1","넓은 로비 바닥을 청소 기계로 닦는 모습","클린하우스","사무실, 상가 청소 전문","4.8","123","서울 강남구"],
    ["svc_2","책상과 모니터가 줄지어 놓인 사무실","한성 인테리어 파트너","사무공간 인테리어, 리모델링","4.7","56","경기 성남시"],
    ["svc_3","두 사람이 소파를 옮기는 모습","행복 이사","가정 이사, 사무실 이사","4.6","91","인천 연수구"],
    ["svc_4","기사가 벽걸이 에어컨을 점검하는 모습","에어존 시스템","에어컨 설치, 이전, 수리","4.9","203","서울 마포구"]];
  var MNY_AI = [["ai_1","서류 위에서 계산기를 두드리는 손","김현우 세무사","법인, 개인 세무 상담","4.9","203","서울 강남구"],
    ["ai_2","밝은 색 소파가 놓인 라운지","더존 인테리어","상가, 사무실 인테리어","4.7","56","경기 고양시"],
    ["ai_3","의자와 모니터가 놓인 사무실 책상","스마트오피스","사무용 가구 전문","4.6","91","서울 마포구"],
    ["ai_4","이삿짐 상자를 나르는 사람들","행복 이사","이사, 운송 전문","4.6","91","인천 연수구"]];
  /* [그림, 종류(견본 배정 — 그림에는 어느 요청이 어느 종류인지 없습니다), 제목, 분야, 분야 색, 지역, 시각, 예산, 제안 수] */
  var MNY_REQ = [["req_1","service","사무실 입주청소 믿을 수 있는 업체 찾습니다.","청소, 방역","is-blue","서울 강남구","3시간 전","300 ~ 500만원",7],
    ["req_2","goods","카페 테이블 20개 제작 가능한 업체를 찾습니다.","가구, 인테리어","is-orange","경기 성남시","5시간 전","50 ~ 100만원",12],
    ["req_3","expert","홈페이지 리뉴얼 가능한 업체를 찾습니다.","IT, 개발","is-purple","서울 마포구","1일 전","100 ~ 300만원",5],
    ["req_4","company","가정 이사 당일 가능한 업체 추천해주세요.","이사, 운송","is-orange","인천 연수구","2일 전","협의",8]];
  var MNY_TABS = [["all","전체"],["goods","상품 구매"],["service","서비스 의뢰"],["expert","전문가 문의"],["company","업체 찾기"],["used","중고 구하기"]];
  var MNY_CASES = [["case_1","판교 사무실 입주청소","3개 업체 제안 → 1곳 연결","경기 성남시"],["case_2","카페 테이블 20개 제작","5개 업체 제안 → 1곳 연결","서울 마포구"],["case_3","학원 인테리어 시공","4개 업체 제안 → 1곳 연결","경기 고양시"]];
  function mnyCards(rows){
    return rows.map(function(c){
      return '<article class="mny-card">'+mnyPic(c[0], c[1])+'<div class="mny-card-b"><h3>'+esc(c[2])+'</h3><p>'+esc(c[3])+'</p>'+
        '<div class="mny-meta"><span class="is-star">'+mnyPic("star","별점")+c[4]+'<small>('+c[5]+')</small></span><span class="is-pin">'+mnyPic("pin","지역")+esc(c[6])+'</span></div>'+
        '<div class="mny-btns"><a class="mny-btn is-line" href="#" data-t="「'+esc(c[2])+'」 프로필 — 견본입니다. 업체 프로필 화면은 아직 없습니다.">프로필 보기</a>'+
        '<a class="mny-btn is-fill" href="#" data-t="「'+esc(c[2])+'」에 제안 — 견본입니다. 업체에 바로 제안하는 기능은 아직 없습니다.">제안 하기</a></div></div></article>'; }).join("");
  }
  function mnyMain(){
    var G = GLAND.MNY;
    /* 관을 중지했을 때의 안내는 전과 같습니다(E-01) */
    if (!gwanOn("MNY")) return gwanLanding("MNY");
    var KW = S.mnyKw || "";      /* 분야 · 분류로 고른 낱말 — 아래 목록을 거릅니다 */
    var TILES = MNY_TILES.map(function(t, i){
      var on = KW ? t[2] === KW : i === 0;      /* 「전체」 칸의 옅은 주황 바탕은 그림에 든 것이라 늘 그대로(is-all) — 지금 고른 칸에는 주황 테두리 */
      return '<a class="mny-tile'+(i === 0 ? " is-all" : "")+'" href="#" data-mny-f="'+esc(t[2])+'"'+(on ? ' aria-current="true"' : '')+'><i>'+mnyPic(t[0],"")+'</i>'+esc(t[1])+'</a>'; }).join("");
    var side = function(k){ return MNY_SIDE[k].map(function(x){ return '<li><a href="#" data-mny-f="'+esc(x[1])+'"'+(x[1] && x[1] === KW ? ' aria-current="true"' : '')+'>'+esc(x[0])+'</a></li>'; }).join(""); };
    var SIDE_goods = side("goods"), SIDE_service = side("service");
    var CUR_expert = KW === "전문가" ? ' aria-current="true"' : "", CUR_company = KW === "업체" ? ' aria-current="true"' : "";
    var REGIONS = MNY_REGIONS.map(function(r){
      return '<li><a href="#" data-t="「'+esc(r)+'」 지역으로 찾기 — 견본입니다. 매물 · 요청에 지역 값이 없어 실제 웹에는 이 묶음을 넣지 않았습니다.">'+esc(r)+'</a></li>'; }).join("");
    var CARDS_svc = mnyCards(MNY_SVC), CARDS_ai = mnyCards(MNY_AI);
    var TABS = MNY_TABS.map(function(t, i){
      return '<button type="button" class="mny-tab" role="tab" aria-selected="'+(i === 0 ? "true" : "false")+'" data-mny-tab="'+t[0]+'">'+t[1]+'</button>'; }).join("");
    var REQS = MNY_REQ.map(function(r){
      return '<div class="mny-req" data-type="'+r[1]+'">'+mnyPic(r[0],"")+'<div class="mny-req-m"><a href="#" data-go="reqd">'+esc(r[2])+'</a>'+
        '<div><span class="mny-tag '+r[4]+'">'+esc(r[3])+'</span>'+mnyPic("pin_s","지역")+esc(r[5])+'</div></div>'+
        '<span class="mny-req-c is-time">'+r[6]+'</span><span class="mny-req-c is-price">'+r[7]+'</span><span class="mny-req-c is-n">제안<b>'+r[8]+'건</b></span>'+
        '<a class="mny-btn is-ghost" href="#" data-go="reqd" aria-label="제안 하기 — '+esc(r[2])+'">제안 하기</a></div>'; }).join("");
    var CASES = MNY_CASES.map(function(c){
      return '<div class="mny-case">'+mnyPic(c[0],"")+'<div><b>'+esc(c[1])+'</b><p>'+esc(c[2])+'</p><span>'+mnyPic("pin","지역")+esc(c[3])+'</span><span>'+mnyPic("pin","날짜")+'2026. 10. 09</span></div></div>'; }).join("");
    /* 지금 있던 것 — 퀵메뉴 5(성공현황 · 베스트매칭 · 급구 · 급매 · 사고예방 · 이벤트존) · 「소개상품 찾기」(구분 · 분류) · 검색 조건 줄 · 매물 카드 · 쪽 번호 · 정렬.
       오른쪽 칸의 디자인 구역 아래에 한 구역으로 남깁니다(10/9 답 ②). 「내가 등록한 …」 · 전체 목록으로 가는 길도 여기에 둡니다.
       실제 웹(v10.30)도 같은 구성입니다 — 그쪽은 v10.29 관 화면 부품(components/gwan)을 그대로 씁니다. */
    var sel = gwanCat(G), gsel = gwanGrade(G);
    var items = G.list.filter(function(x){ return catMatch(G,x,sel) && gradeMatch(G,x,gsel) && (!KW || String(x.t).indexOf(KW) >= 0 || String(x.c).indexOf(KW) >= 0 || String(catCanon(G,x.c)).indexOf(KW) >= 0); });      /* 낱말 = 제목 · 분류 이름에 든 것(견본 자료에는 본문이 없습니다) */
    var what = [gsel, sel, KW ? "「"+KW+"」" : ""].filter(Boolean);
    var BAR = !what.length ? "" : '<div class="catbar"><span class="cbl">검색 조건</span>'+
      (gsel ? '<span class="cbv">'+esc(gsel)+'</span><button class="cbx" data-clear="grade">✕ 구분 해제</button>' : '')+
      (sel  ? '<span class="cbv">'+esc(sel)+'</span><button class="cbx" data-clear="cat">✕ 분류 해제</button>' : '')+
      (KW   ? '<span class="cbv">「'+esc(KW)+'」</span><button class="cbx" data-mny-clear="kw">✕ 검색어 해제</button>' : '')+
      '<button class="cbx" data-clear="all">전체 해제</button><span class="cbn">해제하면 '+esc(G.allcat)+'가 다시 보입니다</span></div>';
    var LIST = (function(){
      if (!items.length) return catEmpty(G, [sel, KW ? "「"+KW+"」" : ""].filter(Boolean).join(" · ") || null);
      var P = pgSlice(lkey(G), items, 6);
      if (!KW) return prodGrid(G, P.rows) + pager(G, P);
      return prodGrid(G, P.rows) + pgBar(lkey(G), P, '<span class="tot"><b>'+esc(what.join(" · "))+'</b> · <b>'+P.n+'</b>건</span>',
        '<select class="sortsel" aria-label="목록 정렬 기준">'+LSTSORT.map(function(o){ return '<option>'+esc(o)+'</option>'; }).join("")+'</select>');
    })();
    var OLD = '<section class="mny-old" id="mny-list" aria-labelledby="mny-old-t" data-mny-old="1">'+
      '<div class="mny-old-h"><h2 id="mny-old-t">'+(sel ? esc(sel) : '지금 인기 있는 '+esc(G.sect))+'</h2>'+
        '<nav class="mny-old-q" aria-label="퀵메뉴">'+QM.map(function(q){
          return '<a href="#" '+(q[2] ? 'data-go="'+q[2]+'"' : 'data-t="'+esc(q[1])+' — 콘텐츠 기획 미확정"')+'>'+esc(q[1])+'</a>'; }).join("")+'</nav>'+
        '<nav class="mny-old-q" aria-label="내 목록 · 전체 목록"><a href="#" data-go="mylst">'+esc(G.mine)+'</a><a href="#" data-go="lstm">전체 목록</a></nav></div>'+
      '<div class="mny-old-b gwl '+G.cls+'">'+findPanel(G)+BAR+'<div class="mny-old-l">'+LIST+'</div></div></section>';
    return '<div class="mny-shell" data-b2-tone="money">'+b2Header("mny")+
      '<div class="mny" data-sgb-gwan="money" data-design="money_main_20261009" data-content="sample">'+
__MNY_BODY__+
      '</div>'+b2Footer("mny")+'</div>';
  }
  /* 소개장터 메인의 누르기 — 요청 종류 탭(걸러 보기) · 분류 묶음 접기 · 키워드 칩(검색 결과로). 화면을 다시 그리지 않고 그 자리에서 바꿉니다. */
  if (!window.__MNY_WIRED) {
    window.__MNY_WIRED = 1;
    document.addEventListener("click", function(e){
      var t = e.target && e.target.closest ? e.target.closest("[data-mny-tab],[data-mny-kw],[data-mny-f],[data-mny-clear],.mny [data-clear],.mny .mny-sg[aria-controls]") : null;
      var root = t && t.closest(".mny");
      if (!root) return;
      if (t.hasAttribute("data-mny-tab")) {
        var k = t.getAttribute("data-mny-tab"), n = 0;
        Array.prototype.forEach.call(root.querySelectorAll(".mny-tab"), function(b){ b.setAttribute("aria-selected", b === t ? "true" : "false"); });
        Array.prototype.forEach.call(root.querySelectorAll(".mny-req"), function(r){ var show = k === "all" || r.getAttribute("data-type") === k; r.hidden = !show; if (show) n++; });
        var em = root.querySelector(".mny-empty"); if (em) em.hidden = n > 0;
        return;
      }
      /* 분야 14칸 · 분류 목록 — 그 낱말로 아래 목록을 거르고 그 구역으로 내립니다(실제 웹의 /money?keyword=…#mny-list 와 같음). 낱말이 없는 칸(전체 · 기타 …)은 거르기를 풉니다 */
      if (t.hasAttribute("data-mny-f") || t.hasAttribute("data-mny-clear")) {
        e.preventDefault();
        S.mnyKw = t.hasAttribute("data-mny-f") ? (t.getAttribute("data-mny-f") || null) : null;
        if (S.pg) S.pg[lkey(GLAND.MNY)] = 1;
        render();
        var el = document.getElementById("mny-list"); if (el && el.scrollIntoView) el.scrollIntoView();
        return;
      }
      /* 「전체 해제」 · 빈 목록의 「전체 목록으로 돌아가기」 — 구분 · 분류를 푸는 일은 전부터 있던 처리가 하고, 여기서는 낱말만 같이 풉니다 */
      if (t.hasAttribute("data-clear")) {
        if (t.getAttribute("data-clear") === "all" && S.mnyKw) { S.mnyKw = null; setTimeout(render, 0); }
        return;
      }
      if (t.hasAttribute("data-mny-kw")) {
        e.preventDefault();
        S.q = S.kw = t.getAttribute("data-mny-kw"); S.stab2 = "전체"; go("src");
        return;
      }
      var open = t.getAttribute("aria-expanded") !== "true", ul = document.getElementById(t.getAttribute("aria-controls"));
      t.setAttribute("aria-expanded", open ? "true" : "false"); if (ul) ul.hidden = !open;
    });
  }
  window.__MNY_ART = MNY_ART;      /* 검증용 창구 — 넣은 그림이 받은 그림의 그 자리와 같은지 밖에서 봅니다(qa/cut_money.py --check · qa/proto_mny.py) */
'''
JS = JS.replace('__MNY_BODY__', js_html(T))
rep('  function scList(){  return gwanLanding("MNY"); }', JS + '  function scList(){  return mnyMain(); }      /* v10.30 — 소개장터 메인은 제시 디자인(mnyMain). 안심소개 · 소개창업은 아래 그대로 */')

# ══ ④ 머리줄 · 바닥줄 — 소개장터(cur · tone = "mny")일 때만 달라지는 것 ══════════════════════════════
rep('''plzPic("logo",866,210,52,"소개뱅크")''', '''(cur === "mny" ? mnyPic("logo","소개뱅크") : plzPic("logo",866,210,52,"소개뱅크"))''')
rep('''      '<div class="b2-hdr">'+
        '<button type="button" class="b2-find" data-go="src" aria-label="검색">'+plzIc("search",22,1.8)+'</button>'+''',
    '''      '<div class="b2-hdr'+(cur === "mny" && inn ? " is-in" : "")+'">'+      /* v10.30 — 소개장터 · 로그인한 모습(그림에 없음)은 칸이 많아 단추를 한 단계 작게 */
        '<button type="button" class="b2-find" data-go="src" aria-label="검색">'+plzIc("search",22,1.8)+'</button>'+''')
rep('''var on = cur === "hlt" && g.code === "HLT";''', '''var on = (cur === "hlt" && g.code === "HLT") || (cur === "mny" && g.code === "MNY");      /* v10.30 — 소개장터 메인 */''')
rep("""'<button type="button" class="b2-login" data-go="my">나의공간</button>'+bell()+""",
    """'<button type="button" class="b2-login" data-go="my">나의공간</button>'+(cur === "mny" ? "" : bell())+      /* v10.30 — 소개장터는 종을 그림의 자리(오른쪽 끝)에 둡니다 */""")
rep("""'<a class="b2-cart" href="#/health" data-hltgo="#/cart" aria-label="소개몰 장바구니">'+plzIc("cart",30,1.5)+'<span class="b2-cartn">'+n+'</span></a>'+""",
    """(cur === "mny" ? mnyBell(inn) :      /* v10.30 — 소개장터 메인은 그림대로 장바구니 자리에 알림 종 */
        '<a class="b2-cart" href="#/health" data-hltgo="#/cart" aria-label="소개몰 장바구니">'+plzIc("cart",30,1.5)+'<span class="b2-cartn">'+n+'</span></a>')+""")
rep('''plzPic("logo-ft",802,200,50,"소개뱅크 — 소개하면 돈이 된다")''', '''(tone === "mny" ? mnyPic("logo_foot","소개뱅크 — 소개하면 돈이 된다") : plzPic("logo-ft",802,200,50,"소개뱅크 — 소개하면 돈이 된다"))''')
rep('''var SNS = [["페이스북","sns-1","facebook",120],["인스타그램","sns-2","instagram",120],["유튜브","sns-3","youtube",121]];''',
    '''var SNS = [["페이스북","sns-1","facebook",120,"sns_fb"],["인스타그램","sns-2","instagram",120,"sns_ig"],["유튜브","sns-3","youtube",121,"sns_yt"]];      /* v10.30 — 다섯째 = 소개장터 디자인의 아이콘 */''')
rep('''plzPic(x[1],x[3],120,30)''', '''(tone === "mny" ? mnyPic(x[4],"") : plzPic(x[1],x[3],120,30))''', 2)

# ══ ① 스타일 — 실제 웹의 파일을 글자 그대로 + 시안에만 필요한 것 ══════════════════════════════════════
tok = open(os.path.join(K, 'site/src/styles/sgb-tokens.css'), encoding='utf8').read()
mny = open(os.path.join(K, 'site/src/styles/money.css'), encoding='utf8').read()
EXTRA = r'''
/* ── 시안에만 있는 것 — 단추로 그린 머리줄 칸 · 로그인한 사람의 칸 · 받은 그림의 종 · 옛 부품(매물 카드)의 자리 ── */
.mny-shell { background: #f6f8fa; }
/* 로그인한 모습은 받은 그림에 없습니다. 칸이 4개(나의공간 · 로그아웃 · 관리자 페이지 · 종)라 그림의 치수로는 1500px 에 들어가지 않아, 단추를 한 단계 작게(42px) 하고 이름은 넓은 화면에서만 보입니다 */
[data-b2-tone=money] .b2-hdr.is-in .b2-find, [data-b2-tone=money] .b2-hdr.is-in .b2-login, [data-b2-tone=money] .b2-hdr.is-in .b2-lngb, [data-b2-tone=money] .b2-hd .b2-adm { height: 42px; border-radius: 21px; font-size: 16px; font-family: inherit; }
[data-b2-tone=money] .b2-hdr.is-in .b2-find { width: 42px; }
[data-b2-tone=money] .b2-hdr.is-in .b2-lngb { width: 84px; }
[data-b2-tone=money] .b2-hdr.is-in .b2-login { min-width: 0; padding: 0 16px; }
[data-b2-tone=money] .b2-hd .b2-adm { padding: 0 16px; font-size: 15px; }
[data-b2-tone=money] .b2-hd .b2-user { display: none; font-weight: 700; }
@media (min-width: 1600px) { [data-b2-tone=money] .b2-hd .b2-user { display: inline; } }
@media (max-width: 1320px) { [data-b2-tone=money] .b2-hdr.is-in { gap: 5px; } [data-b2-tone=money] .b2-hdr.is-in .b2-login, [data-b2-tone=money] .b2-hd .b2-adm { padding: 0 12px; } }
[data-b2-tone=money] .b2-hd .b2-join { min-width: 153.5px; }
.b2-bell.is-pic { width: 40px; height: 41px; margin-top: -2px; }
.b2-bell.is-pic img { width: 40px; height: 41px; }
[data-b2-tone=money] .b2-ft .b2-sns button { opacity: .35; }
.mny .mny-old-b.gwl { background: none; padding: 0; }
.mny .mny-old-b .pgrid { grid-template-columns: repeat(6, minmax(0, 1fr)); }
.mny .mny-old-b .catbar { margin: 12px 0 0; }
.mny .mny-old-b .panel.find { margin: 0; }
.mny .mny-old-b .catnone { padding-bottom: 10px; }
@media (max-width: 900px) { .mny .mny-old-b.gwl .fbar { grid-template-columns: 1fr; gap: 10px; } }
@media (max-width: 1280px) { .mny .mny-old-b .pgrid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 720px) { .mny .mny-old-b .pgrid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 900px) { .b2-bell.is-pic { width: 32px; height: 33px; margin-top: 0; } .b2-bell.is-pic img { width: 32px; height: 33px; } [data-b2-tone=money] .b2-hdr.is-in .b2-find, [data-b2-tone=money] .b2-hdr.is-in .b2-login, [data-b2-tone=money] .b2-hdr.is-in .b2-lngb, [data-b2-tone=money] .b2-hd .b2-adm { height: 36px; font-size: 14px; } [data-b2-tone=money] .b2-hdr.is-in .b2-find { width: 36px; } [data-b2-tone=money] .b2-hdr.is-in .b2-lngb { width: auto; } [data-b2-tone=money] .b2-hdr.is-in .b2-login, [data-b2-tone=money] .b2-hd .b2-adm { padding: 0 10px; } }
'''

# ══ ② 글꼴 — 이 화면에 쓰는 글자만 추려 파일 안에 ═══════════════════════════════════════════════
def chunk(key, n):
    i = s.find(key); assert i >= 0, key
    return s[i:i + n]
i_h = s.index('function b2Header(cur){'); i_f = s.index('function plzPhoto(){')
text = (JS + s[i_h:i_f] + chunk('"site": {"corp"', 900) + chunk('"quickmenu":', 260) + chunk('"promo":', 260) + chunk('var PLZ_LANGCODE', 220)
        + ''.join(g for g in re.findall(r'"name": "([^"]{2,12})"', chunk('"sites": {"list"', 700)))
        + '소개장터 안심소개 소개창업 소개몰 소개광장 이용안내 소개하니 나의공간 로그아웃 관리자 페이지 로그인 무료 회원가입 회원가입 지금 인기 있는 상품/서비스 내가 등록한 상품/서비스 전체 목록 준비 중'
        + ''.join(re.findall(r'[가-힣]', chunk('"gwan": {"MNY"', 900)))      # 분류 이름 — 분류를 고르면 구역 제목이 그 이름이 됩니다
        + ''.join(chr(c) for c in range(0x20, 0x7f)) + '·—–「」『』→←↑↓…‘’“”×※○●▲▼✓©®™₩°')
chars = sorted(set(ch for ch in text if ch >= ' '))
from fontTools import subset
from fontTools.ttLib import TTFont
def sub_font(path):
    opt = subset.Options(); opt.flavor = 'woff2'; opt.layout_features = ['*']; opt.name_IDs = ['*']; opt.notdef_outline = True; opt.desubroutinize = True
    f = TTFont(path, recalcTimestamp=False)      # 저장 시각을 다시 찍지 않습니다 — 몇 번을 돌려도 같은 바이트
    ss = subset.Subsetter(opt); ss.populate(text=''.join(chars)); ss.subset(f)
    b = io.BytesIO(); f.flavor = 'woff2'; f.save(b); return b.getvalue()
FACES = [('Paperlogy', 500, 'Paperlogy-5Medium.woff2'), ('Paperlogy', 700, 'Paperlogy-7Bold.woff2'),
         ('Nanum Square Neo', 400, 'NanumSquareNeo.woff2'), ('Nanum Square Neo', 700, 'NanumSquareNeoB.woff2'), ('Nanum Square Neo', 800, 'NanumSquareNeoEB.woff2')]
ff = []; fbytes = 0
for fam, w, fn in FACES:
    b = sub_font(os.path.join(FONTS, fn)); fbytes += len(b)
    ff.append("@font-face { font-family: '%s'; font-weight: %d; font-style: normal; font-display: swap; src: url(data:font/woff2;base64,%s) format('woff2'); }" % (fam, w, base64.b64encode(b).decode()))
css = ('\n/* ═══ v10.30 (2026-10-09) — 소개장터 메인(mny-*) · 디자인 시트 토큰(--sgb-*) — 제시 디자인 ═══\n'
       '   아래 두 덩어리는 실제 웹의 styles/sgb-tokens.css · styles/money.css 를 **글자 그대로** 옮긴 것입니다(시안과 실제 웹이 같은 모양이 되게).\n'
       '   이름이 모두 --sgb- · mny- 로 시작하고, 머리줄 · 바닥줄은 [data-b2-tone=money] 아래에서만 바뀝니다 — 시안의 다른 화면에 닿지 않습니다.\n'
       '   글꼴(페이퍼로지 · 나눔스퀘어 네오 — SIL OFL 1.1)은 이 화면에 쓰는 글자 %d자만 추려 넣었습니다. 없는 글자는 기기 글꼴로 보입니다. */\n' % len(chars)
       + '\n'.join(ff) + '\n' + tok + '\n' + mny + EXTRA)
i = s.index('</style>'); s = s[:i] + css + s[i:]

# ══ ⑥ 판 이름 · 화면 설명 ══════════════════════════════════════════════════════════════
rep('<title>소개뱅크 시안 v10.28 (2026-10-09 · 소개몰 발송 처리 · ',
    '<title>소개뱅크 시안 v10.30 (2026-10-09 · 소개장터 메인을 제시 디자인대로 — 새 머리줄 · 맨 위 구역 · 바로가기 3장 · 분야 14칸 · 분류 목록 · 서비스 업체 추천 · 소개 요청 · AI 추천 · 띠 광고 · 연결 사례 · 공급자 등록 · '
    '지금 있던 퀵메뉴 5 · 소개상품 찾기 · 인기 매물은 디자인 구역 아래에 · 분야를 누르면 그 낱말로 아래 목록을 거름 · 디자인 시트 토큰 · 글꼴(페이퍼로지 · 나눔스퀘어 네오)은 소개장터에만 · v10.29: 시안은 그대로(실제 웹만) · v10.28: 소개몰 발송 처리 · ')
rep('"note": "소개장터 관의 랜딩(관 랜딩 ①). GNB에서 소개장터를 누르면 여기로 옵니다 — 목록이 아니라 이 관의 메인입니다. 3관이 이 골격을 그대로 씁니다. ',
    '"note": "<b>v10.30 — 2026-10-09 제시 디자인</b>(새 머리줄 · 맨 위 구역 · 바로가기 3 · 분야 14 · 분류 목록 · 업체 추천 · 소개 요청 · AI 추천 · 띠 광고 · 연결 사례 · 공급자 등록). '
    '글자 · 숫자는 받은 그림 그대로인 견본입니다. 지금 있던 퀵메뉴 5 · 소개상품 찾기 · 인기 매물은 오른쪽 칸의 디자인 구역 아래에 남겼습니다. 분야 14칸 · 분류 목록을 누르면 그 낱말로 아래 목록을 거릅니다(실제 웹은 /money?keyword=…#mny-list). '
    '실제 웹은 서버에 자료가 있는 구역만 그립니다(키워드 · 업체 추천 · AI 추천 · 띠 광고 · 연결 사례는 넣지 않음). '
    '소개장터 관의 랜딩(관 랜딩 ①). GNB에서 소개장터를 누르면 여기로 옵니다 — 목록이 아니라 이 관의 메인입니다. 안심소개 · 소개창업은 전의 골격 그대로입니다. ')

open(OUT, 'w', encoding='utf-8').write(s)
print(f'{os.path.basename(BASE)} → {OUT}  {n0:,} → {len(s):,} 자 · 그림 {len(art)}장(PNG {len(art) - n_webp} · 무손실 WebP {n_webp} · {sum(len(v) for v in art.values()):,}자) · 글꼴 5개 {len(chars)}자({fbytes:,}바이트)')
