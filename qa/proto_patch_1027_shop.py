# v10.27 — 소개몰 메인의 나머지 구역도 실제 상품 값으로(10/8 두 번째 답 「실제상품값으로」)
#   성분별 최저가 · 오늘의 건강상품 순위(탭 3개) · 많이 찾는 상품 · 새로 올라온 상품. 모양은 시안 그대로 ·
#   그 성분의 판매 중인 상품이 없으면 시안 값 그대로(성분 목록으로). proto_patch_1027.py 가 exec 로 불러 씁니다(같은 s · rep).
rep('''SCREENS["SB-HLT-HUB-010"] = {''', '''/* v10.27 (G-199 · 10/8 「실제상품값으로」) — 메인 구역의 카드 값을 그 성분의 판매 중인 실제 상품에서 가져옵니다. 없으면 시안 값 그대로 */
function shopReal(code){ return code ? (openProducts().filter(function(q){ return q.ing === code; })[0] || null) : null; }
function shopBest(code){               /* 그 성분에서 한 달 단가가 가장 낮은 상품 · [상품, 한 달 단가] */
  var ps = code ? openProducts().filter(function(q){ return q.ing === code; }) : [];
  ps = ps.map(function(p){ return [p, minUnitOf(p)]; }).filter(function(x){ return x[1] != null; }).sort(function(a, b){ return a[1] - b[1]; });
  return ps.length ? ps[0] : null;
}
SCREENS["SB-HLT-HUB-010"] = {''')

rep("""          return '<a class="shop-lowc" role="link" tabindex="0" data-go="' + shopTo(x[5]) + '"><span class="ph">' + shopPic(x[0], 111) + '</span>'
            + '<b>' + esc(x[1]) + '</b><b>' + won(x[2]) + ' / 30일</b><span class="was">정상가 ' + won(x[3]) + '</span><span class="spec">' + esc(x[4]) + '</span></a>'; }).join("") + '</div></section>'""",
    """          var r = shopBest(x[5]), p = r && r[0];
          return '<a class="shop-lowc" role="link" tabindex="0" data-go="' + (p ? "#/p/" + p.id : shopTo(x[5])) + '"' + (p ? ' data-low-pid="' + p.id + '"' : '') + '><span class="ph">' + shopPic(x[0], 111) + '</span>'
            + '<b>' + esc(x[1]) + '</b><b>' + won(p ? r[1] : x[2]) + ' / 30일</b><span class="was">정상가 ' + won(p ? p.list : x[3]) + '</span><span class="spec">' + esc(p ? p.ingName + " " + p.amt : x[4]) + '</span></a>'; }).join("") + '</div></section>'""")

rep("""          return '<li><a role="link" tabindex="0" data-go="' + shopTo(x[4]) + '"><span class="shop-no">' + (i + 1) + '</span><span class="th">' + shopPic(x[0], 60) + '</span>'
            + '<span class="tx"><b>' + esc(x[1]) + '</b><span>' + won(x[2]) + (x[3] ? '<i>' + x[3] + '%</i>' : '') + '</span></span>' + SHOP_CHEV.replace(""",
    """          var p = shopReal(x[4]), nm = p ? p.name : x[1], pr = p ? p.sale : x[2], off = p ? p.off : x[3];
          return '<li><a role="link" tabindex="0" data-go="' + (p ? "#/p/" + p.id : shopTo(x[4])) + '"' + (p ? ' data-rank-pid="' + p.id + '"' : '') + '><span class="shop-no">' + (i + 1) + '</span><span class="th">' + shopPic(x[0], 60) + '</span>'
            + '<span class="tx"><b>' + esc(nm) + '</b><span>' + won(pr) + (off ? '<i>' + off + '%</i>' : '') + '</span></span>' + SHOP_CHEV.replace(""")

rep("""          return '<a role="link" tabindex="0" data-go="' + shopTo(x[3]) + '"><span class="shop-no">' + (i + 1) + '</span><span class="th">' + shopPic(x[0], 50) + '</span>'
            + '<span class="tx"><b>' + esc(x[1]) + '</b><span>' + won(x[2]) + '</span></span></a>'; }).join("") + '</div></section>'""",
    """          var p = shopReal(x[3]);
          return '<a role="link" tabindex="0" data-go="' + (p ? "#/p/" + p.id : shopTo(x[3])) + '"' + (p ? ' data-many-pid="' + p.id + '"' : '') + '><span class="shop-no">' + (i + 1) + '</span><span class="th">' + shopPic(x[0], 50) + '</span>'
            + '<span class="tx"><b>' + esc(p ? p.name : x[1]) + '</b><span>' + won(p ? p.sale : x[2]) + '</span></span></a>'; }).join("") + '</div></section>'""")

rep("""          return '<a class="shop-newc" role="link" tabindex="0" data-go="' + shopTo(x[5]) + '"><span class="ph">' + shopPic(x[0], 84) + '</span>'
            + '<span class="bd"><b>' + esc(x[1]) + '</b><span class="pr">' + won(x[2]) + '</span><span class="shop-star">' + x[3] + ' <i>(' + x[4].toLocaleString("ko-KR") + ')</i></span></span></a>'; }).join("") + '</div></section>'""",
    """          var p = shopReal(x[5]);
          return '<a class="shop-newc" role="link" tabindex="0" data-go="' + (p ? "#/p/" + p.id : shopTo(x[5])) + '"' + (p ? ' data-new-pid="' + p.id + '"' : '') + '><span class="ph">' + shopPic(x[0], 84) + '</span>'
            + '<span class="bd"><b>' + esc(p ? p.name : x[1]) + '</b><span class="pr">' + won(p ? p.sale : x[2]) + '</span><span class="shop-star">' + (p ? p.rate : x[3]) + ' <i>(' + Number(p ? p.rev : x[4]).toLocaleString("ko-KR") + ')</i></span></span></a>'; }).join("") + '</div></section>'""")

rep('''순위 근거 — 자사 2026-09 주문 건수 기준(견본) · 순위에는 산출 근거 · 기간을 함께 답니다.''',
    '''순위 근거 — 자사 2026-09 주문 건수 기준(견본 순서) · 이름 · 값은 판매 중인 실제 상품 · 순위에는 산출 근거 · 기간을 함께 답니다.''')
