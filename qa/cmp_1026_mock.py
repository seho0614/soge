"""v10.26 반영 전 — 운영 화면 「소개몰 상품」 제안 그림(모형).  (2026-10-08)

시안 · 개발분 어디에도 상품 · 재고를 넣는 화면이 없어 맞출 기준 그림이 없습니다. 그래서 지금 운영 화면의 틀 · 글꼴 · 색(app.css)을 그대로 쓰고
본문만 바꿔 끼운 **모형**을 찍습니다 — 떠 있는 운영 화면(5173)을 열어 브라우저 안에서만 본문을 갈아 끼우며, 코드 · 서버 · DB 는 건드리지 않습니다.
값은 시안 견본 16종의 것입니다.   결과: /home/claude/design_1007/cmp26/소개몰_v10.26_반영전_5_운영_상품관리_제안.png
"""
import os
from PIL import Image
from playwright.sync_api import sync_playwright
import shot_mall2 as s2
import flow_lib as fl
OUT = '/home/claude/design_1007/cmp26'; RAW = OUT + '/raw'
W = lambda n: format(n, ',')
SUB = lambda on: '<div class="subtabs" role="tablist">' + ''.join(f'<button class="{"on" if t == on else ""}">{t}</button>' for t in ('상품', '성분 · 고민', '갈래 · 판매 범위')) + '</div>'
BOX = lambda form, tone: f'<span style="display:inline-block;width:34px;height:34px;border-radius:6px;background:{tone};color:#fff;font-size:10px;line-height:34px;text-align:center">{form}</span>'
ROWS = [  # 그림, 코드, 이름, 성분|함량, 갈래, 판매자, 대표 판매가, 정가, 옵션(재고), 상태
    (BOX('상자', '#d99a00'), 'p01', '메가바이탈 비타민C 3000', '비타민C | 3,000mg', '건강식품', '직판', 14700, 36750, '9개월 26 · 6개월 31 · 3개월 54', '판매 중', 'ok'),
    (BOX('병', '#1f7a4d'), 'p02', '선데이 비타민D 2000', '비타민D | 2,000IU', '건강식품', '직판', 9900, 29000, '12개월 18 · 6개월 40 · 3개월 66', '판매 중', 'ok'),
    (BOX('파우치', '#6b8f3a'), 'p10', '양배추 매스틱 1000', '양배추 | 1,000mg', '건강식품', '직판', 8970, 31000, '6개월 <b class="warn-text">0</b> · 3개월 48', '판매 중 <span class="pill pill-warning" style="margin-left:6px">옵션 1개 품절</span>', 'ok'),
    (BOX('파우치', '#c2386b'), 'p12', '저분자 콜라겐 1500', '콜라겐 | 1,500mg', '화장품', '직판', 14700, 42000, '6개월 28 · 3개월 41', '판매 중', 'ok'),
    (BOX('파우치', '#555'), 'p15', '멀티비타민 데일리팩', '멀티비타민 | 1일분', '건강기능식품 🔒', '직판', 19800, 66000, '6개월 30 · 3개월 44', '판매 중지 <span class="dim">(잠긴 갈래)</span>', 'no'),
    ('<span class="dim">사진 없음</span>', 'RED-30', '홍삼 농축액 스틱 30포', '홍삼 농축액 | —', '건강식품', '직판', 45000, None, '단품 29', '판매 중', 'ok'),
]
LIST = f"""
<h2 class="sec-title">소개몰 상품 <span class="cnt">19</span></h2>
<p class="lead">소개몰에서 파는 상품을 등록하고 옵션 · 재고 · 판매 상태를 관리합니다. 「판매 중」으로 바꿀 때 갈래의 판매 범위(잠김 · 팔지 않음) · 심의필 번호 · 금지 표현을 서버가 검사합니다.</p>
{SUB('상품')}
<div class="acts" style="margin:0 0 12px">
  <select class="sel"><option>갈래 전체</option><option>건강식품</option><option>화장품</option></select>
  <select class="sel"><option>상태 전체</option><option>판매 중</option><option>품절</option><option>판매 중지</option><option>초안</option></select>
  <input class="sel" style="min-width:240px" placeholder="상품 이름 · 코드 · 성분">
  <button class="btn-sm btn-plain">찾기</button>
  <span style="flex:1"></span>
  <button class="btn-sm btn-ok">+ 상품 등록</button>
</div>
<table class="tbl"><thead><tr><th>그림</th><th>코드</th><th>상품 이름 / 성분 | 함량</th><th>갈래</th><th>판매자</th><th class="num-cell">대표 판매가</th><th class="num-cell">정가 (할인율)</th><th>옵션 · 재고</th><th>상태</th><th></th></tr></thead><tbody>
{''.join(f'<tr><td>{g}</td><td class="mono">{c}</td><td><b>{n}</b><br><span class="dim">{ia}</span></td><td>{cat}</td><td>{sel}</td><td class="num-cell">{W(sale)}원</td><td class="num-cell">{(W(lp) + "원 (" + str(round((1 - sale / lp) * 100)) + "%)") if lp else "<span class=dim>—</span>"}</td><td>{opt}</td><td><span class="st {k}">{st}</span></td><td><button class="btn-sm btn-plain">수정</button></td></tr>' for g, c, n, ia, cat, sel, sale, lp, opt, st, k in ROWS)}
</tbody></table>
<p class="hint" style="margin-top:8px">대표 판매가 = 가장 짧은 개월 수 옵션의 결제 금액 · 할인율 = 정가 대비 대표 판매가(정가가 더 클 때만) · 재고는 옵션마다 따로 셉니다.</p>
"""
OPTS = [(9, 35100, '2+1', 26), (6, 25200, '1+1', 31), (3, 14700, '', 54)]
NOTICE = ['제품명', '식품유형', '생산자', '소재지', '제조연월일', '유통기한', '포장단위별 내용물의 용량', '원재료명', '영양성분', '보관방법', '소비자상담 전화']      # 시안의 식품 11항목 그대로(19418 ~ 19428)
NV = {'제품명': '메가바이탈 비타민C 3000', '유통기한': '제조일로부터 24개월', '소비자상담 전화': '1688-2887'}
EDIT = f"""
<h2 class="sec-title">상품 수정 <span class="mono">p01</span> <span class="st ok" style="margin-left:8px">판매 중</span></h2>
<p class="lead">← 상품 목록 &nbsp;·&nbsp; 저장하면 사용자 웹에 바로 반영됩니다. 결제 금액 · 재고를 바꾼 기록은 아래 「변경 기록」에 남습니다.</p>
{SUB('상품')}
<h3 class="sec">① 기본</h3>
<div class="card pad"><div class="form-grid">
  <label>상품 코드 (주소에 쓰임 · 등록 뒤 못 바꿈)<input value="p01" disabled></label>
  <label>상품 이름<input value="메가바이탈 비타민C 3000"></label>
  <label>갈래<select><option>건강식품</option><option>화장품</option><option>운동 · 재활 용품</option><option disabled>건강기능식품 (잠김)</option></select></label>
  <label>판매자<select><option>소개뱅크 직판관 (직판)</option></select></label>
  <label>표제 성분 (카드 · 상세의 「성분 | 함량」)<select><option>비타민C (VITC)</option></select></label>
  <label>함량 표제<input value="3,000mg"></label>
  <label style="grid-column:span 2">한 줄 설명<input value="1일 1포 · 물 없이 먹는 분말형 · 3g × 90포"></label>
  <label>정가 (대표 옵션 기준 · 비우면 할인율을 안 보임)<input value="36,750"></label>
  <label>배지<select><option>신규입점</option><option>없음</option><option>특별가격 (메인 「이번 주 특별 할인」에 나옴)</option></select></label>
  <label>청약철회 규칙 (갈래에 따라 정해짐)<input value="식품 — 개봉 시 청약철회 제한" disabled></label>
  <label>심의필 번호 · 기능성 표시 문구 (잠긴 갈래를 열 때만)<input value="" placeholder="해당 없음" disabled></label>
</div></div>
<h3 class="sec">② 옵션 · 재고 <span class="right muted">한 달 단가 = 결제 금액 ÷ 개월 수 (자동)</span></h3>
<table class="tbl"><thead><tr><th style="width:90px">개월 수</th><th style="width:150px">결제 금액</th><th class="num-cell" style="width:120px">한 달 단가</th><th style="width:110px">꼬리 글자</th><th style="width:110px">재고</th><th>화면에 보이는 이름</th><th style="width:90px">판매</th><th style="width:60px"></th></tr></thead><tbody>
{''.join(f'<tr><td><input value="{m}"></td><td><input value="{W(pr)}"></td><td class="num-cell">{W(round(pr / m))}원</td><td><input value="{tag}"></td><td><input value="{st}"></td><td class="muted">월 {W(round(pr / m))}원 × {m}개월 분{(" " + tag) if tag else ""}</td><td><span class="st ok">켬</span></td><td><button class="btn-sm btn-plain">빼기</button></td></tr>' for m, pr, tag, st in OPTS)}
</tbody></table>
<div class="acts"><button class="btn-sm btn-plain">+ 옵션 더하기</button><span class="hint" style="margin:0">개월 수를 비우면 「단품」 옵션입니다(한 달 단가를 보이지 않음 — 운동 용품 등). 주문이 있는 옵션은 지우지 않고 「끔」으로 둡니다.</span></div>
<h3 class="sec">③ 상품 그림</h3>
<div class="card pad"><div class="form-grid">
  <label>사진 올리기 (JPG · PNG · 5MB 까지 · 권리를 가진 사진만)<input type="file"></label>
  <label>사진이 없을 때 그리는 그림 — 꼴<select><option>상자</option><option>병</option><option>파우치</option></select></label>
  <label>색<select><option>금색</option><option>파랑</option><option>자동</option></select></label>
</div><p class="hint" style="margin:8px 0 0">그린 그림에는 성분 이름 · 함량만 적습니다 — 「건강기능식품」 「GMP」 글자는 넣지 않습니다(갈래가 건강기능식품이 아닌 상품에 붙으면 안 됨).</p></div>
<h3 class="sec">④ 상품정보제공고시 · 주의사항 <span class="right muted">갈래 「건강식품」 → 식품 11항목</span></h3>
<table class="tbl"><tbody>
{''.join(f'<tr><th style="width:230px">{k}</th><td><input value="{NV.get(k, "")}" placeholder="비우면 「상세 설명 참조」로 보입니다"></td></tr>' for k in NOTICE)}
<tr><th>섭취 · 사용상 주의사항</th><td><input value="위가 약한 분은 식후에 드십시오. 1일 권장량을 넘기지 마십시오."></td></tr>
</tbody></table>
<div class="acts"><button class="btn-ok btn-sm">저장</button><button class="btn-sm btn-no">판매 중지</button><button class="btn-sm btn-plain">사용자 웹에서 보기</button></div>
<h3 class="sec">변경 기록</h3>
<table class="tbl"><thead><tr><th>언제</th><th>누가</th><th>무엇을</th></tr></thead><tbody>
<tr><td>2026-10-08 14:02</td><td>admin@x.com</td><td>3개월 옵션 재고 50 → 54 (입고 4)</td></tr>
<tr><td>2026-10-08 11:30</td><td>admin@x.com</td><td>6개월 옵션 결제 금액 26,400원 → 25,200원</td></tr>
</tbody></table>
"""
ING = [('VITC', '비타민C', '아스코르브산', '—', '켬', 1), ('OMEGA3', '오메가3', 'EPA · DHA · rTG', '—', '켬', 1), ('BERRY', '블루베리·베리류', '', '군(묶음)', '—', 0), ('BLUEB', '블루베리', '', '▸ 블루베리·베리류', '—', 0), ('BILB', '빌베리', '', '▸ 블루베리·베리류', '—', 0), ('COLLA', '콜라겐', '저분자 콜라겐', '—', '—', 1)]
INGS = f"""
<h2 class="sec-title">소개몰 상품</h2>
{SUB('성분 · 고민')}
<h3 class="sec">성분 <em>26</em> <span class="right"><button class="btn-sm btn-ok">+ 성분 더하기</button></span></h3>
<table class="tbl"><thead><tr><th>코드</th><th>이름</th><th>다른 이름 (검색에 쓰임)</th><th>성분군</th><th>많이 찾는 성분</th><th class="num-cell">판매 중 상품</th><th></th></tr></thead><tbody>
{''.join(f'<tr><td class="mono">{c}</td><td><b>{n}</b></td><td class="muted">{al or "—"}</td><td>{g}</td><td>{ft}</td><td class="num-cell">{k}</td><td><button class="btn-sm btn-plain">수정</button></td></tr>' for c, n, al, g, ft, k in ING)}
<tr><td colspan="7" class="dim">… 20줄 더</td></tr></tbody></table>
<p class="hint" style="margin-top:8px">성분군은 2단까지입니다(군 → 성분). 「많이 찾는 성분」을 켠 성분이 사용자 웹 「성분별」의 첫 구역에 나옵니다. 고민 이름은 광고 문구로 읽히므로 금지 표현 검사를 거칩니다.</p>
"""


def main():
    shots = []
    with sync_playwright() as p:
        b = p.chromium.launch(); c = b.new_context(viewport={'width': 1500, 'height': 1000}); bo = fl.bo_login(c)
        assert fl.bo_tab(bo, '소개몰 정산'), '운영 화면 탭을 못 찾음'
        for nm, html in (('list', LIST), ('edit', EDIT), ('ing', INGS)):
            # v10.29 — 상단은 묶음 단추(data-tabs). 「소개몰 정산」이 든 묶음 뒤에 모형 단추를 둡니다
            bo.evaluate("""(html) => { const nav = document.querySelector('.bo-head nav'); nav.querySelectorAll('button').forEach(x => x.classList.remove('on'));
                let m = nav.querySelector('[data-mock]'); if (!m) { const ref = [...nav.querySelectorAll('button')].find(x => (x.getAttribute('data-tabs') || '|' + x.innerText.trim() + '|').includes('|소개몰 정산|')); m = document.createElement('button'); m.setAttribute('data-mock', '1'); m.textContent = '소개몰 상품'; ref.after(m); }
                m.classList.add('on'); m.style.outline = '2px dashed #d97706';
                const main = document.querySelector('.bo-main'); main.innerHTML = '<style>.bo-main .tbl button{white-space:nowrap}.bo-main .tbl .st{white-space:nowrap}</style><div style="background:#fff7e6;border:1px dashed #d97706;color:#7a4b00;padding:8px 12px;border-radius:6px;font-size:13px;margin-bottom:14px">제안 그림(모형) — 아직 만들지 않은 화면입니다. 지금 운영 화면의 틀에 본문만 끼워 찍었습니다. 확인하신 뒤에 만듭니다.</div>' + html; }""", html)
            bo.wait_for_timeout(300); pth = f'{RAW}/m_{nm}.png'; bo.screenshot(path=pth, full_page=True); shots.append(pth)
        c.close(); b.close()
    labs = ['⑤-1 상품 목록 — 탭 「소개몰 상품」(새로) · 하위 탭 3개', '⑤-2 상품 등록 · 수정 — 기본 · 옵션/재고 · 그림 · 고시/주의사항 · 변경 기록', '⑤-3 성분 · 고민 — 성분군 · 많이 찾는 성분']
    cols = [s2.colim(Image.open(pth).convert('RGB'), lab, '#7a4b00', w=1100) for pth, lab in zip(shots, labs)]
    left = cols[0]; H = left.size[1] + 12 + cols[2].size[1]; lc = Image.new('RGB', (1100, H), '#8a8a8a'); lc.paste(left, (0, 0)); lc.paste(cols[2], (0, left.size[1] + 12))
    body = s2.pair(lc, cols[1])
    nt = s2.note(['v10.26 반영 전 ⑤ 운영 화면 「소개몰 상품」 — 제안 그림(모형)', '시안 · 개발분 모두 상품 · 재고를 넣는 화면이 없어 기준 그림이 없습니다. 지금 운영 화면의 틀 · 글꼴 · 색을 그대로 쓴 제안입니다(값 = 시안 견본). 본사 운영자만 씁니다 — 입점 판매자용은 v10.28.'], body.size[0])
    s = Image.new('RGB', (body.size[0], nt.size[1] + 10 + body.size[1]), '#8a8a8a'); s.paste(nt, (0, 0)); s.paste(body, (0, nt.size[1] + 10))
    s = s.resize((int(s.size[0] * 0.8), int(s.size[1] * 0.8)), Image.LANCZOS); out = f'{OUT}/소개몰_v10.26_반영전_5_운영_상품관리_제안.png'; s.save(out, optimize=True); print(out, s.size, os.path.getsize(out) // 1024, 'KB')


if __name__ == '__main__':
    main()
