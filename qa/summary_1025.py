"""v10.25 요약 시트(summary.json) — final_all.txt · 시험 결과 · doc73_extra.txt 에서 수치를 읽어 씁니다."""
import json, re, os
Q = os.path.dirname(os.path.abspath(__file__))
def kv(f):
    try: return dict(l.split(': ', 1) for l in open(f'{Q}/{f}', encoding='utf-8').read().split('\n') if ': ' in l)
    except FileNotFoundError: return {}
fa = kv('final_all.txt'); ex = kv('doc73_extra.txt'); f1 = kv('final_all_first_v1025.txt')
J = lambda f: json.load(open(f'{Q}/{f}', encoding='utf-8'))
items = lambda f: (lambda d: d if isinstance(d, list) else d['items'])(J(f))
okn = lambda xs: f"{sum(1 for x in xs if x['ok'])}/{len(xs)}"
g = lambda k: fa.get(k + '_rerun', fa.get(k, '?')).split('   (')[0]
g0 = lambda k: fa.get(k, '?')
sm = items('srv_mall.json'); wm = items('site_mall.json'); pm = items('proto_mall.json'); ppx = J('proto_pixel.json'); pdf = J('proto_diff.json')
sc = J('site_crawl.json')['pages']; bo = J('admin_final.json')['tabs']
n200 = sum(1 for p in sc if p['status'] == 200); n404 = sum(1 for p in sc if p['status'] == 404)
d = J('defects.json'); num = lambda x: int(re.sub(r'\D', '', x['no']) or 0)
new = [x for x in d if 162 <= num(x) <= 169]; opened = [x for x in d if '열려 있' in x['what']]
short = lambda k: re.sub(r'^통과 ', '', g(k)).split(' →')[0]
SUITES = ['fixtures','e2e','decisions','decisions_ui','fixes_1002','srv_aff','srv_hlt','srv_ptn','srv_aff_ui','srv_hlt_ui','srv_ptn_ui','srv_proto','srv_pay','srv_pay_ui','srv_file','srv_file_ui','srv_lead','srv_lead_ui',
          'srv_consult','srv_consult_ui','srv_retship','srv_refcode','srv_refcode_ui','srv_viewlimit','csrf','srv_poll','srv_poll_ui','srv_billing','srv_billing_ui','srv_detail','srv_cmu','srv_cmu_ui','srv_fin','srv_fin_ui','srv_mall','site_mall']
_fr = lambda v: re.search(r'(\d+) ?/ ?(\d+)', v or '')
tot = [(_fr(g(k)).group(1), _fr(g(k)).group(2)) for k in SUITES]; a1 = sum(int(a) for a, b in tot); b1 = sum(int(b) for a, b in tot)
rep = g0('proto_report'); m = re.search(r"^(\d+) \{'clicks': (\d+).*'none': (\d+), 'error': (\d+)", rep)
sweep = f"{m.group(1)}화면(본체 194 + 소개몰 21) · {int(m.group(2)):,}회 · 무반응 {m.group(3)} · 오류 {m.group(4)}" if m else '?'
full = lambda v: bool(_fr(v)) and _fr(v).group(1) == _fr(v).group(2)
try: WHY = json.load(open(f'{Q}/doc73_why.json', encoding='utf-8'))
except FileNotFoundError: WHY = {}
WHY0 = WHY
stuck = [k for k in f1 if k in WHY0 and (('Error' in f1[k]) or (_fr(f1[k]) is not None and not full(f1[k])))]
rows = [
 ['결론', "10/8 v10.25 — 지시 「개발분과 시안을 비교 · 반영 전에 확인 후 반영 · 다른 점이 있으면 시안을 기준으로」에 따라 소개몰(쇼핑몰) 22쪽의 틀 · 화면 구성을 시안에 맞추고, 시안 값 3가지(배송비 전 상품 무료 · 의료기기 미판매 · 건강기능식품 잠금)를 서버 규칙으로 넣었습니다 "
          "(답: 4판으로 나눔 · 시안 값으로 · 입점 판매자는 마지막 판 · 개발분에만 있는 10건 모두 남김 · 임시 값 3건은 개발분 값). 남긴 10건과 개발분 값 3건은 시안에도 넣었습니다. 네 판 가운데 첫 판입니다. "
          f"새 시험 — 서버 {okn(sm)} · 실제 웹 {okn(wm)} · 시안 {okn(pm)} · 앞 판과 그림 비교 {okn(ppx['items'])}(이름 규칙을 입힌 뒤 본체 {ppx['same']}장 모두 점 하나 같음) · 글자 비교 {okn(pdf['items'])}."],
 ['먼저 알려 드릴 것', "① 개발 DB 에서 팔리는 상품이 3종으로 줄었습니다(건강기능식품 3 · 의료기기 2 판매 중지 — 지우지 않음 · v10.26 에서 견본 16종 시드) "
          "② 서버에 올리면 건강기능식품 · 의료기기 갈래의 판매 중 상품이 판매 중지가 되고, 약관 3종의 글이 고쳐집니다(이미 발행된 DB 는 새 버전 발행 → 재동의 집계 · 9/30 서버처럼 초안이면 글만) "
          "③ 시안의 「교환 배송비 6,000원」은 서버에 넣지 않았습니다(규칙 없음 — 결정 필요) "
          "④ 주문서 동의 ② 문구는 그대로(v10.28) "
          "⑤ 법률 확인 필요 2가지 — 무료배송 상품의 단순 변심 반품에 왕복 6,000원을 빼는 것 · 식품 「개봉 시 청약철회 제한」의 표시 방식 "
          "⑥ 확인 받은 비교표에 없던 차이 3건(날짜 표기 · 잠긴 갈래 단추 · 고민 상세의 🔒)을 시안에 맞췄고, 청약철회 규칙 이름에서 「의료기기」를 뺐습니다 "
          "⑦ 개발 DB 의 반품 신청 「접수」 20건을 한꺼번에 반려했습니다(19건은 옛 시험이 남긴 것 · 개발 DB 만)"],
 ['바뀐 규모', '서버: 마이그레이션 68 → 70(D024 이름 · 약관 · D025 판매 범위 · 배송비) · 새 길 1개(GET /health/categories) · API 421 → 422 · 표 hlt_sale_categories · 뷰 v_hlt_locked_on_sale / '
              '실제 웹: 소개몰 22쪽 + 한글 「없는 주소」 화면 · 머리줄 · 바닥줄(두 관 전용) · 그림 조각 23개 / '
              '시안: 화면 수 그대로(본체 194 + 소개몰 21) · 소개몰 메인(제시 디자인 · 그림 조각 53개) · 남긴 10건 · 값 3건 · 머리줄/바닥줄을 본체로 이음 · 이름 4가지'],
 ['절차서', 'sgb/docs/73_소개몰_시안기준_개발_v10.25_20261008.md — 결론 · 확정하신 것 · 서버 · 실제 웹 22쪽 · 시안 · 아직 다른 것(다음 판) · 함께 찾은 것 · 알아 두실 것 · 확인 결과 · PC 에서 보는 법(체크리스트) · 서버에 올릴 때 · 다음 판 · 확인하지 못한 것 · 근거'],
 ['소개몰 서버(srv_mall.py)', f"전체 {okn(sm)} — 이름 · 약관 3종 · 배송비 0(주문 · 장바구니 · 환불) · 갈래 조회 · 잠금/미판매 규칙(DB 가 거절) · 매물 등록 규칙 그대로 · 청약철회 규칙 이름 · 약관 글 = 시안에 실은 글 · 등록부 · 고정 SQL"],
 ['소개몰 실제 웹(site_mall.py)', f"전체 {okn(wm)} — 이름 · 머리줄/바닥줄 · 메인(그림 바이트 비교) · 누르기 · 하위 쪽 · 시안 기준 화면 구성 17묶음 · 한글 「없는 주소」 · 390px · 화면 오류"],
 ['소개몰 시안(proto_mall.py)', f"전체 {okn(pm)} — 이름 · 메인(제시 디자인) · 누르기 전수 · 그림 53개 바이트 비교 · 남긴 10건 · 개발분 값 3건 · 머리줄/바닥줄 단추가 본체 화면으로 · 자가 점검 21화면 × 14항목"],
 ['앞 판과 비교(proto_pixel.py · proto_diff.py)', f"그림 {okn(ppx['items'])} — 앞 판의 글자에 이름 규칙을 입힌 뒤 본체 194장을 두 판에서 찍어 견줌: 점 하나 같음 {ppx['same']}장 · 다름 {ppx['diff']} / 글자 {okn(pdf['items'])} — 표식만 달라진 화면 {pdf.get('changed')} · 이름만 바뀐 화면 {len(pdf.get('name_only') or [])}장"],
 ['통합 검정(npm run verify)', g('verify')],
 ['매트릭스', g('matrix').replace('매트릭스: ', '') + ' · 마이그레이션 70 · 시안 화면 194 + 소개몰 21'],
 ['전수 검정 — 운영 방식 API', f'API 를 tsc 로 빌드한 dist/main.js 로 띄우고 전부 — {len(SUITES)}묶음 {a1:,} / {b1:,}: ' + ' · '.join(f"{k} {short(k)}" for k in SUITES)],
 ['첫 실행에서 모자랐던 것(고치고 전 구간을 다시 돌림)', ' / '.join(f"{k} — 첫 실행 {(f1.get(k) or '결과 없음')[:50]} → 다시 {g(k)[:30]} · {WHY.get(k, ['', ''])[0]}" for k in dict.fromkeys(stuck)) + ' / 원인은 시험 쪽(시험 자료의 재고 · 박아 둔 상품 이름 · 옛 판과 견주는 기준 · 고르는 말의 범위)이 대부분입니다'],
 ['사용자 웹 메인 · 안심소개 · 시간대', f"web_main {g('web_main')} · web_main_live {g('web_main_live')} · web_mal {g('web_mal').split(' ')[0]} · site_tz {short('site_tz')} · site_detail {short('site_detail')}"],
 ['GET API 전수', g('smoke')],
 ['목록 쪽 넘김', g('pagetest')[:200]],
 ['사용자 웹 페이지(모든 페이지 상호 확인)', f"{len(sc)} (경로 × 5역할) — 200 {n200} · 404 {n404} (의도) · API 실패 {sum(1 for p in sc if p.get('api_fail'))} · 스크립트 오류 {sum(1 for p in sc if p.get('errors'))}"],
 ['운영 BO', f"{len(bo)} 화면 상태 × 5계정 — 실패 {sum(1 for t in bo if t.get('errors') or t.get('api_fail') or t.get('errview'))} (일반회원 거부 포함)"],
 ['시안 v10.25', f"소개몰 {g('proto_mall')} · 그림 비교 {g('proto_pixel')} · 글자 비교 {g('proto_diff')} · 생활금융 {g('proto_fin')} · 소개광장 {g('proto_cmu')} · 축 상세 {g('proto_axis')} · 언어 단추 {g('proto_lang')} · 매물 상세 {g('proto_item')} · 상세 {g('proto_detail')} · 급구 · 급매 {g('proto_urg')} · 내 구독 {g('proto_bill')} · 투표 {g('proto_poll')} · 메인 {g('proto_main')} · 상담 {g('proto_consult')} · 시연 보장 {g('proto_guard')} · 누르기 전수 {sweep}"],
 ['Docker 실구동(대체 이미지)', ex.get('DOCKER', '?')],
 ['PowerShell 도우미 · 새로 설치', ex.get('PS', '?') + ' | 새로 설치: ' + ex.get('FRESH', '?')],
 ['서버 적용 리허설(v10.25 zip)', ex.get('REHEARSAL', '?')],
 ['이번 판에서 찾은 것', ' · '.join(f"{x['no']} {x['what'][:100]}" for x in new)],
 ['열려 있는 것', ' · '.join(f"{x['no']} {x['what'][:110]}" for x in opened)],
 ['알아 두실 것', '① 배송비가 무료여도 단순 변심 · 잘못 주문 반품은 왕복 6,000원을 환불액에서 뺍니다(약관 제3조) ② 잠긴 갈래는 주소로 가면 「준비 중」 안내 · 단추는 누를 수 없음 ③ 운영 화면에 재고 입력이 없어 시험 준비 자료가 재고를 채웁니다(G-147) '
              '④ 판매 중지 직후 오래 열지 않은 상품 쪽은 예전 화면이 한 번 보일 수 있습니다(G-161 · 주문은 서버가 거절) ⑤ docs/terms/HLT_SALE.md 는 초안 생성기의 글이고 게시된 약관은 DB 의 글입니다 ⑥ 받은 그림은 줄인 JPEG — 원본 PNG 가 오면 조각만 바꿉니다'],
 ['확인하지 못한 것', 'PC 의 Chrome · Windows PowerShell 5.1 에서의 실제 모양과 실행(작업 환경의 Chromium · PowerShell 7 · 대체 이미지로 확인) · 진짜 Docker 이미지에서의 기동 · 실제 AWS 서버 적용(리허설은 작업 환경 안에서 9/30 서버를 흉내 낸 것) · '
              '법률 2가지(조문 원문을 작업 환경에서 열지 못함) · 받은 그림의 원본 PNG · 좁은 화면 디자인'],
 ['남은 일', '① v10.26 — 상품 자료 · 옵션 · 성분군 · 화장품 갈래 · 견본 16종 시드 · 운영 화면의 상품 관리(+ 검색어 자동완성 칸) ② v10.27 — 배송 · 후기 · 문의 · 구매확정 · 순위 ③ v10.28 — 입점 판매자 · 약관 개정 '
           '④ 정해 주실 것 — 교환 배송비 ⑤ 미뤄 둔 것 — V-World 연동(개발 키를 다시 받아야 함) · v10.23 이후 실제 웹 디자인을 시안에 맞추기'],
 ['묶음', ex.get('PACK', '?')],
]
json.dump({'rows': rows}, open(f'{Q}/summary.json', 'w'), ensure_ascii=False, indent=1)
print('summary rows', len(rows))
