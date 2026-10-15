"""v10.24 요약 시트(summary.json) — final_all.txt · 시험 결과 · doc72_extra.txt 에서 수치를 읽어 씁니다."""
import json, re, os
Q = os.path.dirname(os.path.abspath(__file__))
def kv(f):
    try: return dict(l.split(': ', 1) for l in open(f'{Q}/{f}', encoding='utf-8').read().split('\n') if ': ' in l)
    except FileNotFoundError: return {}
fa = kv('final_all.txt'); ex = kv('doc72_extra.txt'); f1 = kv('final_all_first_v1024.txt')
J = lambda f: json.load(open(f'{Q}/{f}', encoding='utf-8'))
okn = lambda xs: f"{sum(1 for x in xs if x['ok'])}/{len(xs)}"
g = lambda k: fa.get(k + '_rerun', fa.get(k, '?')).split('   (')[0]
g0 = lambda k: fa.get(k, '?')
fin = J('srv_fin.json')['items']; fui = J('srv_fin_ui.json')['items']; pfn = J('proto_fin.json')['items']; ppx = J('proto_pixel.json'); pdf = J('proto_diff.json'); fm = J('fin_matrix.json')
sc = J('site_crawl.json')['pages']; bo = J('admin_final.json')['tabs']
n200 = sum(1 for p in sc if p['status'] == 200); n404 = sum(1 for p in sc if p['status'] == 404)
d = J('defects.json'); num = lambda x: int(re.sub(r'\D', '', x['no']) or 0)
new = [x for x in d if 154 <= num(x)]; opened = [x for x in d if '열려 있' in x['what']]
short = lambda k: re.sub(r'^통과 ', '', g(k)).split(' →')[0]
SUITES = ['fixtures','e2e','decisions','decisions_ui','fixes_1002','srv_aff','srv_hlt','srv_ptn','srv_aff_ui','srv_hlt_ui','srv_ptn_ui','srv_proto','srv_pay','srv_pay_ui','srv_file','srv_file_ui','srv_lead','srv_lead_ui',
          'srv_consult','srv_consult_ui','srv_retship','srv_refcode','srv_refcode_ui','srv_viewlimit','csrf','srv_poll','srv_poll_ui','srv_billing','srv_billing_ui','srv_detail','srv_cmu','srv_cmu_ui','srv_fin','srv_fin_ui']
_fr = lambda v: re.search(r'(\d+) ?/ ?(\d+)', v or '')
tot = [(_fr(g(k)).group(1), _fr(g(k)).group(2)) for k in SUITES]; a1 = sum(int(a) for a, b in tot); b1 = sum(int(b) for a, b in tot)
rep = g0('proto_report'); m = re.search(r"^(\d+) \{'clicks': (\d+).*'none': (\d+), 'error': (\d+)", rep)
sweep = f"{m.group(1)}화면 · {int(m.group(2)):,}회 · 무반응 {m.group(3)} · 오류 {m.group(4)}" if m else '?'
stuck = [k[:-6] for k in fa if k.endswith('_rerun') and k != 'verify_rerun']
try: WHY = json.load(open(f'{Q}/doc72_why.json', encoding='utf-8'))
except FileNotFoundError: WHY = {}
rows = [
 ['결론', "10/7 v10.24 — 지시 「안심소개 → 생활금융 부분(리스트 및 상세 보기 · 상담하기) 등을 작동 가능하게 · 디자인 모두 적용 · 시안 및 개발 적용」을 시안 · 실제 웹 · 서버에 반영했습니다 "
          "(답: 상세 보기 = 업종 상세 · 디자인 = 지금 안심소개 모양으로 다듬기 · 준비 중 업종 = 규칙 그대로 + 시험용 업체 / 비교 그림 9장 확인 뒤 「이대로 반영」 · 법률 · 세무 「시험용 사무소를 넣음」 · 같은 결함 「같이 고침」). "
          f"목록 → 업종 상세 → 상담 신청 → 휴대폰 확인 → 접수가 시안과 실제 웹에서 끝까지 됩니다. 새 시험 — 서버 {okn(fin)} · 실제 웹 {okn(fui)} · 시안 {okn(pfn)} · 업종 22종 연결표 {fm['pass']}/{fm['total']} · "
          f"앞 판과 그림 비교 {okn(ppx['items'])}(바꾸기로 한 4장 말고 {ppx['same']}장은 점 하나 같음) · 글자 비교 {okn(pdf['items'])}."],
 ['먼저 알려 드릴 것', "① 법률 · 세무 시험용 사무소는 업종마다 1곳입니다(확인 때의 선택지에는 2곳씩이라고 적었음 — 한 업체는 한 업종에 게재 1건이라는 DB 규칙 · 시연용 업체 1곳). 2곳씩은 시연용 업체를 하나 더 만들어야 합니다 "
          "② 시험용 업체 · 사무소는 개발 · 시연용 — 운영 서버 적용 길은 이 시드를 부르지 않습니다(운영에서는 실제 입점 전까지 「준비 중」) "
          "③ 확인 받은 미리보기와 다른 점 1가지 — 시안의 업종 상세를 주소 없이 열면 「없는 업종」이 나오던 것을 첫 업종의 상세가 나오게 고침(G-160) "
          "④ 신청서 주소가 /mal/consult/{코드} → /mal/consult/{코드}/apply 로 옮겨짐(앞 주소는 업종 상세)"],
 ['바뀐 규모', '서버: 새 길 1개(GET /consult/categories/{code} — 받는 지역 · 진행 규칙) · API 420 → 421 · 개발 · 시연용 시드 1개(scripts/seed-consult-demo.sql) · DB 변경 없음(마이그레이션 68) / 실제 웹: 업종 상세(새 내용) · 신청서 쪽(새 파일 …/apply) · 줄 단추 2개 · 스타일(mal-cd-* · mal-row-*) / 화면 등록부 195 → 196(SB-MAL-CSL-025) / '
              '시안: 화면 193 → 194(새 화면 malcsld) · 글자가 달라진 화면 4(malcsl · listl · listb · malgive) · 그림이 달라진 화면 4(malcsl · myntf · introhome · admptnw)'],
 ['절차서', 'sgb/docs/72_생활금융상담_업종상세_시험용업체_v10.24_20261007.md — 결론 · 화면과 주소 · 업종 상세에 나오는 것 · 시안과 개발분이 다른 것 · 바꾼 곳 · 함께 찾은 것 · 알아 두실 것 · 확인 결과 · PC 에서 보는 법 · 다음 판'],
 ['생활금융 서버(srv_fin.py)', f"전체 {okn(fin)} — 업종 상세(목록과 같은 값 · 받는 지역 · 진행 규칙) · 22업종 · 없는 것/이상한 입력 404 · 업체 이름 · 연락처가 실리지 않음 · 등록부 · 고정 SQL · 시험용 업체(두 번 돌려도 같음 · 자격 심사 기록) · 시험용 사무소 · 운영 길이 시드를 부르지 않음(F-8) · 상담하기(1곳 전달 · 받는 지역 밖은 전달 안 함) · 뒷정리"],
 ['생활금융 실제 웹(srv_fin_ui.py)', f"전체 {okn(fui)} — 목록(줄 단추 · 이름 링크) · 업종 상세(값 = API) · 신청서 주소 · 법률 · 세무 · 상담하기(인증번호 → 접수) · 390px · 화면 오류 0 · 뒷정리"],
 ['생활금융 시안(proto_fin.py)', f"전체 {okn(pfn)} — 축 주소(새로 고침 · 뒤로) · 줄 단추 · 업종 상세 20종 · 주소 없이 열기 · 신청서 · 접수 · 법률 · 세무 · 같이 고친 3장 · 390px · 스크립트 오류 0"],
 ['업종 22종 연결표(fin_matrix.py)', f"{fm['pass']}/{fm['total']} — 업종마다 목록의 단추 · 상세 주소 · 신청서 주소를 실제로 열어 봄(매트릭스 43번 시트)"],
 ['앞 판과 비교(proto_pixel.py · proto_diff.py)', f"그림 {okn(ppx['items'])} — 193장을 두 판에서 찍어 견줌: 점 하나 같음 {ppx['same']}장 · 다름 {ppx['diff']} / 글자 {okn(pdf['items'])} — 달라진 화면 {pdf.get('changed')} · 새 화면 {pdf.get('added')} | 옛 판 시험: 소개광장(v10.23) {g('proto_cmu')} · 축 상세(v10.22) {g('proto_axis')} · 언어 단추 {g('proto_lang')} · 매물 상세 {g('proto_item')}"],
 ['통합 검정(npm run verify)', g('verify')],
 ['매트릭스', g('matrix').replace('매트릭스: ', '') + ' · 마이그레이션 68 · 시안 화면 194'],
 ['전수 검정 — 운영 방식 API', f'API 를 tsc 로 빌드한 dist/main.js 로 띄우고 전부 — {len(SUITES)}묶음 {a1:,} / {b1:,}: ' + ' · '.join(f"{k} {short(k)}" for k in SUITES)],
 ['첫 실행에서 모자랐던 것(고치고 다시 돌림)', ' / '.join(f"{k} — 첫 실행 {(g0(k) or '결과 없음(중간에 멈춤)')[:60]} → 다시 {g(k)} · {WHY.get(k, '')}" for k in stuck) + ' / 까닭은 모두 시험 쪽(뒷정리 · 옛 주소 · 견주는 때)이고 제품 코드는 1구간 뒤로 바꾸지 않아, 모자랐던 시험만 다시 돌렸습니다. 첫 실행의 결과는 qa/results_v10_24/final_all_first_v1024.txt 에 남겼습니다.'],
 ['사용자 웹 메인 · 안심소개 · 시간대', f"web_main {g('web_main')} · web_main_live {g('web_main_live')} · web_mal {g('web_mal').split(' ')[0]} · site_tz {short('site_tz')} · site_detail {short('site_detail')}"],
 ['GET API 전수', g('smoke')],
 ['목록 쪽 넘김', g('pagetest')[:200]],
 ['사용자 웹 페이지(모든 페이지 상호 확인)', f"{len(sc)} (경로 × 5역할) — 200 {n200} · 404 {n404} (의도) · API 실패 {sum(1 for p in sc if p.get('api_fail'))} · 스크립트 오류 {sum(1 for p in sc if p.get('errors'))}"],
 ['운영 BO', f"{len(bo)} 화면 상태 × 5계정 — 실패 {sum(1 for t in bo if t.get('errors') or t.get('api_fail') or t.get('errview'))} (일반회원 거부 포함)"],
 ['시안 v10.24', f"생활금융 {g('proto_fin')} · 그림 비교 {g('proto_pixel')} · 글자 비교 {g('proto_diff')} · 소개광장 {g('proto_cmu')} · 축 상세 {g('proto_axis')} · 언어 단추 {g('proto_lang')} · 매물 상세 {g('proto_item')} · 상세(v10.20 시험) {g('proto_detail')} · 급구 · 급매 {g('proto_urg')} · 내 구독 {g('proto_bill')} · 상담 {g('proto_consult')} · 메인 {g('proto_main')} · 투표 {g('proto_poll')} · 시연 보장 {g('proto_guard')} · 누르기 전수 {sweep}"],
 ['Docker 실구동(대체 이미지)', ex.get('DOCKER', '?')],
 ['PowerShell 도우미 · 새로 설치', ex.get('PS', '?') + ' | 새로 설치: ' + ex.get('FRESH', '?')],
 ['서버 적용 리허설(v10.24 zip)', ex.get('REHEARSAL', '?')],
 ['이번 판에서 찾은 것', ' · '.join(f"{x['no']} {x['what'][:100]}" for x in new)],
 ['열려 있는 것', ' · '.join(f"{x['no']} {x['what'][:110]}" for x in opened)],
 ['알아 두실 것', '① 시험용 업체는 1곳이라 개발분에서는 업종마다 「인증업체 1곳」 · 받는 지역은 서울 · 경기 · 인천(그 밖은 「받을 업체 없음」) ② 시연용 업체(intro@x.com)가 없는 DB 에서는 시드가 아무것도 하지 않음 ③ Docker 는 올릴 때마다 시드를 다시 봄(없는 것만 더함 · 게재 기간 30일 아래면 1년으로) ④ 메뉴 이름은 아직 「소개뱅크몰」(소개몰 판에서 바꿈) ⑤ 사용자 웹은 자료를 60초 기억하고 그 뒤 처음 여는 사람에게는 예전 것을 한 번 보여 줌(G-161) — 신청은 서버가 다시 판정'],
 ['확인하지 못한 것', 'PC 의 Chrome · Windows PowerShell 5.1 에서의 실제 모양과 실행(작업 환경의 Chromium · PowerShell 7 · 대체 이미지로 확인) · 진짜 Docker 이미지에서의 기동 · 실제 AWS 서버 적용(리허설은 작업 환경에서 9/30 서버를 재현) · 알림톡 실제 발송 · 법률 · 세무 광고 표시의 법 조문 검토 · 좁은 화면 디자인 시안(받은 것이 없어 390px 에서 깨지지 않는지만 봄)'],
 ['남은 일', '① 소개몰(쇼핑몰) 디자인 — 메뉴 이름 「소개뱅크몰」→「소개몰」 · 받은 그림(1092×2000 JPEG)으로 먼저 · 사진은 원본 PNG 가 오면 교체 — 비교 그림 → 확인 → 반영 ② 소개몰 서버(상품 관리 · 배송 · 후기 · 순위 — G-147) ③ 실제 웹 디자인 정렬(다른 관) · V-World 연동(개발 키를 다시 받아 .env 에만) ④ 정해 주실 것: 법률 · 세무 시험용 사무소 2곳씩 여부 · G-161(자료 기억 방식) · G-149 · G-122 · G-130 · G-116'],
]
json.dump({'rows': rows}, open(f'{Q}/summary.json', 'w'), ensure_ascii=False, indent=1)
print('summary rows', len(rows))
