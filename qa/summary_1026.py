"""v10.26 요약 시트(summary.json) — final_all.txt · 시험 결과 · doc75_extra.txt 에서 수치를 읽어 씁니다."""
import json, re, os
Q = os.path.dirname(os.path.abspath(__file__))
def kv(f):
    try: return dict(l.split(': ', 1) for l in open(f'{Q}/{f}', encoding='utf-8').read().split('\n') if ': ' in l)
    except FileNotFoundError: return {}
fa = kv('final_all.txt'); ex = kv('doc75_extra.txt')
def J(f):
    for p in (f'{Q}/{f}', f'{Q}/results_v10_26/{f}'):
        if os.path.exists(p): return json.load(open(p, encoding='utf-8'))
items = lambda f: (lambda d: d if isinstance(d, list) else d['items'])(J(f))
okn = lambda xs: f"{sum(1 for x in xs if str(x['ok']) == 'True')}/{len(xs)}"
g = lambda k: fa.get(k + '_rerun', fa.get(k, '?')).split('   (')[0]
_fr = lambda v: re.search(r'(\d+) ?/ ?(\d+)', v or '')
short = lambda k: re.sub(r'^통과 ', '', g(k)).split(' →')[0]
so, wo, po, fx = items('srv_opt.json'), items('site_opt.json'), items('proto_opt.json'), items('fix_1026.json')
ppx = J('proto_pixel.json'); pdf = J('proto_diff.json')
sc = J('site_crawl.json')['pages']; bo = J('admin_final.json')['tabs']
n200 = sum(1 for p in sc if p['status'] == 200); n404 = sum(1 for p in sc if p['status'] == 404)
d = J('defects.json'); opened = [x for x in d if x.get('open')]
r2 = J('findings_r2.json') or []
r2open = [x for x in (r2 if isinstance(r2, list) else r2.get('items', [])) if x.get('open')]
SUITES = ['fixtures','e2e','decisions','decisions_ui','fixes_1002','srv_aff','srv_hlt','srv_ptn','srv_aff_ui','srv_hlt_ui','srv_ptn_ui','srv_proto','srv_pay','srv_pay_ui','srv_file','srv_file_ui','srv_lead','srv_lead_ui',
          'srv_consult','srv_consult_ui','srv_retship','srv_refcode','srv_refcode_ui','srv_viewlimit','csrf','srv_poll','srv_poll_ui','srv_billing','srv_billing_ui','srv_detail','srv_cmu','srv_cmu_ui','srv_fin','srv_fin_ui','srv_mall','site_mall',
          'fix_1026','srv_opt','site_opt']
tot = [(_fr(g(k)).group(1), _fr(g(k)).group(2)) if _fr(g(k)) else ('0', '0') for k in SUITES]; a1 = sum(int(a) for a, b in tot); b1 = sum(int(b) for a, b in tot)
PSU = ['proto_consult','proto_main','proto_poll','proto_bill','proto_urg','proto_detail','proto_item','proto_axis','proto_lang','proto_cmu','proto_fin','proto_mall','proto_opt','proto_guard','proto_diff','proto_pixel']
rep = fa.get('proto_report', ''); m = re.search(r"^(\d+) \{'clicks': (\d+).*'none': (\d+), 'error': (\d+)", rep)
sweep = f"{m.group(1)}화면(본체 195 + 소개몰 21) · {int(m.group(2)):,}회 · 무반응 {m.group(3)} · 오류 {m.group(4)}" if m else '?'
rows = [
 ['결론', "10/8 v10.26 — 소개몰의 상품을 시안처럼 「상품 → 옵션(복용 개월 수) → 옵션별 값 · 재고」로 바꾸고 장바구니 · 주문 · 재고를 옵션 단위로 옮겼습니다. 성분군 · 화장품 갈래 · 견본 17종(개발 · 시연용) · 검색 자동완성 · 운영 「소개몰 상품」 · "
          "회원 사정 교환의 왕복 배송비 6,000원 신청 때 결제(판매 약관 새 판 — 제3조 「반품 · 교환 비용」) · 확장 점검 결함 10건 수정 · 이번에 찾은 G-203 ~ G-206 · G-208 ~ G-211 수정. 시안을 그대로 옮기면 안 되는 5곳은 실제 웹을 바르게 만들고 시안도 같은 모양으로(디자인 틀은 그대로). "
          f"새 시험 — 서버 {okn(so)} · 실제 웹 {okn(wo)} · 시안 {okn(po)} · 수정 확인 {okn(fx)} · 앞 판과 그림 비교 {okn(ppx['items'])}(본체 {ppx.get('same')}장 같음) · 글자 비교 {okn(pdf['items'])}."],
 ['먼저 알려 드릴 것', "① 서버에 올리면 판매 약관의 새 판이 발행됩니다(이미 발행한 DB — 지금 판의 다음 번호 · 재동의 집계 · 시행일 · 공지 기간은 법령 원문 확인 필요 · 9/30 서버는 초안이라 글만) ② 지금 상품은 「단품」 옵션 하나로 옮겨지고 값 · 재고는 옵션에서 고칩니다 "
          "③ 견본 17종은 개발 · 시연용(서버 적용은 넣지 않음) ④ 교환 배송비는 결제 키 전까지 시험 결제 ⑤ 개발 DB 금칙어 같은 줄 422 → 1(G-203) ⑥ 개발 DB 의 중개사 심사 대기 202건(시험이 넣은 것)을 반려로 정리(G-207 — 제품은 열림) ⑦ 시안 215 → 216화면 · 매트릭스 화면 196 → 200"],
 ['바뀐 규모', '서버: 마이그레이션 70 → 75(D026 ~ D030) · API 422 → 442 · 표 201 → 206(옵션 · 교환 배송비 · 고시 2 · 변경 기록) · 함수 283 → 291 / 사용자 웹: 소개몰 14쪽 + 교환 배송비 결제 쪽 · 운영 화면 탭 「소개몰 상품」(하위 4) / 시안: 고친 곳 5 + 9 · 운영 「소개몰 상품」 1화면'],
 ['절차서', 'sgb/docs/75_소개몰_상품자료_옵션_교환배송비_v10.26_20261008.md — 결론 · 확정하신 것 · 서버 · DB(약관 제3조 확정 문안 · API) · 실제 웹 · 시안(5곳 · 함께 고친 것 · 아직 다른 것) · 고친 결함 · 알아 두실 것 · 확인 결과 · PC 에서 보는 법(체크리스트) · 서버에 올릴 때 · 다음 판 · 확인하지 못한 것 · 근거'],
 ['소개몰 상품 서버(srv_opt.py)', f"전체 {okn(so)} — DB 구조 · 상품 자료 · 옵션 · 한 달 단가(살 수 있는 옵션) · 화장품 · 성분군 · 검색 · 옵션 단위 장바구니/주문/재고 · 교환 배송비(결제 · 반려 환불 · 바꾼 반품 전액) · 운영 「소개몰 상품」 · 판매 약관 새 판"],
 ['소개몰 상품 실제 웹(site_opt.py)', f"전체 {okn(wo)} — 메인 · 카드 · 상세 옵션 · 단품 · 자동완성 · 성분 상세 · 장바구니 · 교환 비용 상자 · 결제 · 운영 화면"],
 ['소개몰 상품 시안(proto_opt.py)', f"전체 {okn(po)} — 5곳(한 달 단가 · 그림 글자 · 자동완성 · p12/p17 · 반품 칸) · 함께 고친 것 · 운영 「소개몰 상품」"],
 ['수정 확인(fix_1026.py)', f"전체 {okn(fx)} — 확장 점검 결함 10건(G-173 · 177 · 178 · 182 · 174 · 181 · 183 · 186 …) · G-203(금칙어)"],
 ['앞 판과 비교(proto_pixel.py · proto_diff.py)', f"그림 {okn(ppx['items'])} — 본체 화면 점 하나 같음 {ppx.get('same')}장 · 다름 {len(ppx.get('diff') or [])} / 글자 {okn(pdf['items'])}"],
 ['통합 검정(npm run verify)', fa.get('verify_rerun3', g('verify'))],
 ['매트릭스', fa.get('matrix_rerun', g('matrix')).replace('매트릭스: ', '').split('   (')[0] + ' · 마이그레이션 75'],
 ['전수 검정 — 운영 방식 API', f'API 를 tsc 로 빌드한 dist/main.js 로 띄우고 전부 — {len(SUITES)}묶음 {a1:,} / {b1:,}: ' + ' · '.join(f"{k} {short(k)}" for k in SUITES)],
 ['다시 돌린 것', ex.get('RERUN', '?')],
 ['사용자 웹 메인 · 안심소개 · 시간대', f"web_main {g('web_main')} · web_main_live {g('web_main_live')} · web_mal {g('web_mal').split(' ')[0]} · site_tz {short('site_tz')} · site_detail {short('site_detail')}"],
 ['GET API 전수', g('smoke')],
 ['목록 쪽 넘김', g('pagetest')[:200]],
 ['사용자 웹 페이지(모든 페이지 상호 확인)', f"{len(sc)} (경로 × 5역할) — 200 {n200} · 404 {n404} (의도) · API 실패 {sum(1 for p in sc if p.get('api_fail'))} · 스크립트 오류 {sum(1 for p in sc if p.get('errors'))}"],
 ['운영 BO', f"{len(bo)} 화면 상태 × 5계정 — 실패 {sum(1 for t in bo if t.get('errors') or t.get('api_fail') or t.get('errview'))} (일반회원 거부 포함)"],
 ['확장 점검(연동 · DB 연동 · 버튼 · flow)', ' · '.join(f"{k} {g(k)[:60]}" for k in ('db_link', 'link_check', 'btn_site', 'btn_bo', 'flow_trade', 'flow_mall', 'flow_plaza', 'flow_biz', 'flow_proto'))],
 ['시안 v10.26', ' · '.join(f"{k.replace('proto_', '')} {g(k)}" for k in PSU) + f" · 누르기 전수 {sweep}"],
 ['Docker 실구동(대체 이미지)', ex.get('DOCKER', '?')],
 ['PowerShell 도우미 · 새로 설치', ex.get('PS', '?') + ' | 새로 설치: ' + ex.get('FRESH', '?')],
 ['서버 적용 리허설(v10.26 zip)', ex.get('REHEARSAL', '?')],
 ['이번 판에서 찾은 것', 'G-203 금칙어 같은 줄(고침 · D029) · G-204 자동완성 Enter(고침) · G-205 교환 배송비 거래번호와 INV-11(고침 · D030) · G-206 시안 재고 되돌리기 연동(고침) · G-207 심사 목록 200건(시험 쪽만 고침 · 제품 열림) · G-208 새 운영 API 의 권한 표시 위치(고침) · G-209 약관을 처음 발행하는 길의 교환 조항(고침 · SV-T3) · G-210 쓰던 검정 DB 의 check 실패(고침 · 픽스처) · G-211 시험이 DB 상태를 가정(고침) · G-212 기준 데이터의 외래 키(열림 — 결정 필요)'],
 ['열려 있는 것', f"결함 목록 {len(d)}건 · 확장 점검(10/8) 이후 발견 가운데 열려 있음 {len(r2open)}건 — " + ' · '.join(f"{x['no']}" for x in r2open) + ' · 화면 다시 그리기 오류 G-94(가끔 — 이번 전수에서 640쪽 중 1번 · 같은 쪽 40번 다시 0)'],
 ['알아 두실 것', '① 값 · 재고는 옵션에서 고침 ② 정가 = 가장 짧은 개월 수 옵션의 정상가 ③ 한 달 N원 부터 = 살 수 있는 옵션만 ④ 재고는 주문을 만들 때 줄어듦 ⑤ 회원 사정 교환은 교환 배송비를 낸 뒤에 승인(회사 사정 판정이면 0원 · 돌려드림) · 교환 승인은 아직 주문 · 재고를 바꾸지 않음(v10.27) '
              '⑥ 견본 시드는 개발 Docker · 로컬 설치만 ⑦ 결제 키 · 개발 키는 .env 에만'],
 ['확인하지 못한 것', '법령 원문(약관 변경 시행일 · 공지 기간 · 화장품 판매 자격 · 고시 항목 · 화장품 청약철회 제한) · 견본 값의 출처 · 실제 결제창 · 결제사 부분 취소 · PC 의 Chrome · Windows PowerShell 5.1 · 진짜 Docker 이미지 · 실제 AWS 서버 적용 · 좁은 화면 모양'],
 ['남은 일', '① v10.27 — 배송 · 구매확정 · 후기 · 문의 · 순위 · 교환 승인 뒤 다시 보내기 · (넣는다면) 일부 반품 ② v10.28 — 입점 판매자 · 약관 개정 ③ 열린 결함의 범위 결정 ④ 미뤄 둔 것 — V-World 연동(개발 키를 다시 받아야 함) · 실제 웹 디자인을 시안에 맞추기'],
 ['묶음', ex.get('PACK', '?')],
 ['git', ex.get('GIT', '?')],
]
json.dump({'rows': rows}, open(f'{Q}/summary.json', 'w'), ensure_ascii=False, indent=1)
print('summary rows', len(rows))
