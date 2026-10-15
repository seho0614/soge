"""v10.21 요약 시트(summary.json) — final_all.txt · docker_1021.txt · 시험 결과에서 수치를 읽어 씁니다."""
import json, re, os
Q = os.path.dirname(os.path.abspath(__file__))
def kv(f):
    try: return dict(l.split(': ', 1) for l in open(f'{Q}/{f}', encoding='utf-8').read().split('\n') if ': ' in l)
    except FileNotFoundError: return {}
fa = kv('final_all.txt'); dk = kv('docker_1021.txt'); ex = kv('doc67_extra.txt')
J = lambda f: json.load(open(f'{Q}/{f}', encoding='utf-8'))
okn = lambda xs: f"{sum(1 for x in xs if x['ok'])}/{len(xs)}"
g = lambda k: fa.get(k, '?')
pit = J('proto_item.json')['items']; sdt = J('site_detail.json')['items']; svd = J('srv_detail.json')['items']; pdf = J('proto_diff.json')['items']
s0 = J('detail_links_table_stats_v1020.json'); s1 = J('detail_links_table_stats_v1021.json')
sc = json.load(open(f'{Q}/site_crawl.json'))['pages']; bo = json.load(open(f'{Q}/admin_final.json'))['tabs']
n200 = sum(1 for p in sc if p['status'] == 200); n404 = sum(1 for p in sc if p['status'] == 404)
d = J('defects.json'); num = lambda x: int(re.sub(r'\D', '', x['no']) or 0)
new = [x for x in d if 131 <= num(x) <= 137]
closed = [x for x in new if '열려 있음' not in x['what']]; opened = [x for x in d if '열려 있음' in x['what']]
short = lambda k: re.sub(r'^통과 ', '', g(k)).split(' →')[0]
SUITES = ['fixtures','e2e','decisions','decisions_ui','fixes_1002','srv_aff','srv_hlt','srv_ptn','srv_aff_ui','srv_hlt_ui','srv_ptn_ui','srv_proto','srv_pay','srv_pay_ui','srv_file','srv_file_ui','srv_lead','srv_lead_ui',
          'srv_consult','srv_consult_ui','srv_retship','srv_refcode','srv_refcode_ui','srv_viewlimit','csrf','srv_poll','srv_poll_ui','srv_billing','srv_billing_ui','srv_detail']
rep = g('proto_report'); m = re.search(r"^(\d+) \{'clicks': (\d+).*'none': (\d+), 'error': (\d+)", rep)
sweep = f"{m.group(1)}화면 · {int(m.group(2)):,}회 · 무반응 {m.group(3)} · 오류 {m.group(4)}" if m else '?'
rows = [
 ['결론', "10/7 v10.21 — 지시 「매물 카드의 제목 · 분류 · 금액 · 지역 · 사진을 상세 화면에 넘겨 그립니다(소개장터 · 안심소개 · 소개창업 상세). 마이 관심은 항목의 관에 맞는 상세로. 주소도 항목마다 다르게, 그림과 같은 형식으로 변경, 1:1 문의 · 관심 담기 · 신고하기 버튼 추가」를 "
          "시안과 실제 웹에 모두 반영했습니다(답: 버튼은 맨 아래 줄에 합치기 · 시안 + 실제 웹 상세 · 누적수익은 본인이 켠 경우만 공개). "
          f"시안에서 「무엇을 눌러도 같은 상세」 {s0['bad_groups']}곳 {s0['bad_links']}건 → {s1['bad_groups']}곳 {s1['bad_links']}건(남은 것은 요청 · 계약 · 운영 목록 — 범위 밖). "
          f"시안 시험 {okn(pit)} · 실제 웹 {okn(sdt)} · 서버 {okn(svd)} · 앞 판과 189장 중 16장만 다름({okn(pdf)}). 만들면서 찾은 5건(로그인 직후 404 · 후기 작성 실패 · 불리언 입력 · 소개광장 빈 표 · 후기 잘림)을 함께 고쳤습니다."],
 ['바뀐 규모', '시안 16장(매물 상세 3 · 문의방 2 · 카드가 있는 목록 7 · 마이 관심 · 소개광장 글 목록 · 프로필 · 창업 등록의 돌아가기 글) · 화면 수 189 · 화면 ID 그대로 / 실제 웹: 매물 상세(세 관) · 내 정보(공개 설정) · 로그인 / 서버: 마이그레이션 D023(68번째) · API 1개 추가(GET /listings/{id}/reviews — 419) · 뷰 1(298) · 함수 1(283) · 불리언 입력 22곳'],
 ['절차서', 'sgb/docs/67_매물상세_누른매물_실제웹적용_v10.21_20261007.md — 결론 · 시안 · 실제 웹 · 서버 · 알아 두실 것 · 찾은 것 · 확인 결과 · PC 에서 보는 법 / 재조사 목록표 sgb/docs/68_상세보기_전체목록표_재조사_v10.21_20261007.md'],
 ['시안 매물 상세(proto_item.py)', f"전체 {okn(pit)} — 카드 83장을 하나씩(제목 · 분류 · 금액 · 지역 · 사진) · 매물 60건 → 주소 60개 · 주소로 바로 열기 9건 · 세 관 한 틀 · 맨 아래 줄 「관심 담기 · 질문 N · 공유하기 · 신고 · 1:1 문의 시작」 · 관별 안내 유지 · 마이 관심 4건 · 문의방 왕복 · 견본 3건 그대로 · 소개광장 글 6건 · 공개 설정 · 390px. 고치기 전(v10.20 시안) 5/28"],
 ['실제 웹 매물 상세(site_detail.py)', f"전체 {okn(sdt)} — 실제 로그인 · 클릭. 구성 9 · 진짜 값만 6(실적 = 서버 집계 · 후기 이름/연락처 가림 · 견본 값 없음) · 누적수익 공개 6(마이에서 켜면 4번째 칸 · 끄면 3칸) · 맨 아래 줄과 로그인 15(관심 담기 DB 반영 · 로그인 뒤 보던 매물로 · 바깥 주소 거절 · 도착 화면 404 아님) · 세 관 2 · 그 밖 6. 고치기 전 3/17"],
 ['서버(srv_detail.py · verify D23)', f"전체 {okn(svd)} — 상세 응답 6 · 누적수익 공개 12 · 후기 작성 7 · 후기 공개 조회 8 · 불리언 입력 2 · 요청 등록 시각 2 · 뒷정리 1. DB 규칙 D23-01~12(후기 당사자 · 대상 · 성사 확정 · 누적수익 뷰) 12/12. 고치기 전 7/35"],
 ['앞 판 비교(proto_diff.py) · 옛 판 시험', f"{okn(pdf)} — 189장 중 173장은 글자 하나 같음 · 목록 7장과 마이 관심은 링크 값 · 사진 · 분류 이름 · 돌아가기 글만 다름 | 상세(v10.20 시험) {g('proto_detail')} · 급구 · 급매 {g('proto_urg')} · 투표 · 옛 판 비교 {g('proto_poll')}"],
 ['「상세 보기」 재조사(detail_links.py)', f"시안 {s1['proto_links']}건 · 실제 웹 {s1['site_links']:,}건을 다시 전부 눌러 봄 — 열리지 않는 링크 0 · 같은 상세만 나옴 {s0['bad_groups']}곳 {s0['bad_links']}건 → {s1['bad_groups']}곳 {s1['bad_links']}건 · 문의방 왕복 실패 {s0['roundtrip_fail']} → {s1['roundtrip_fail']} · 들어가는 링크 없는 상세 {s0['orphan']} → {s1['orphan']}장 · 실제 웹 요청 「등록」 빈 값 45 → 0 · 실제 웹 화면 오류 {s1['site_page_errors']}건(주문 상세 한 쪽 · G-94 · 다시 10번 열어 0번). 시트 33 ~ 35"],
 ['통합 검정(npm run verify)', g('verify')],
 ['매트릭스', g('matrix').replace('매트릭스: ', '') + ' · 마이그레이션 68'],
 ['전수 검정 — 운영 방식 API', 'API 를 tsc 로 빌드한 dist/main.js 로 띄우고 전부 다시: ' + ' · '.join(f"{k} {short(k)}" for k in SUITES)],
 ['사용자 웹 메인 · 안심소개 · 시간대', f"web_main {g('web_main')} · web_main_live {g('web_main_live')} · web_mal {g('web_mal').split(' ')[0]} · site_tz {short('site_tz')} · site_detail {short('site_detail')}"],
 ['GET API 전수', g('smoke')],
 ['목록 쪽 넘김', g('pagetest')[:200]],
 ['사용자 웹 페이지(모든 페이지 상호 확인)', f"{len(sc)} (경로 × 5역할) — 200 {n200} · 404 {n404} (의도) · API 실패 {sum(1 for p in sc if p.get('api_fail'))} · 스크립트 오류 {sum(1 for p in sc if p.get('errors'))}"],
 ['운영 BO', f"{len(bo)} 화면 상태 × 5계정 — 실패 {sum(1 for t in bo if t.get('errors') or t.get('api_fail') or t.get('errview'))} (일반회원 거부 포함)"],
 ['시안 v10.21', f"매물 상세 {g('proto_item')} · 앞 판 비교 {g('proto_diff')} · 상세(v10.20 시험) {g('proto_detail')} · 급구 · 급매 {g('proto_urg')} · 내 구독 {g('proto_bill')} · 상담 {g('proto_consult')} · 메인 {g('proto_main')} · 투표 {g('proto_poll')} · 누르기 전수 {sweep} · 서버 연동 {g('srv_proto')}"],
 ['Docker 실구동(대체 이미지)', ex.get('DOCKER', '?')],
 ['PowerShell 도우미 · 새로 설치', ex.get('PS', '?') + ' | 새로 설치: ' + ex.get('FRESH', '?')],
 ['서버 적용 리허설(v10.21 zip)', ex.get('REHEARSAL', '?')],
 ['만들면서 찾아 고친 것', ' · '.join(f"{x['no']} {x['what'][:80]}" for x in closed)],
 ['앞 판 목록표의 것', 'G-122(매물 상세 부분) · G-123 · G-129 · G-128 · G-121 고침 · G-124 는 소개광장 글 상세를 고치고 화면 변형 3장이 남음'],
 ['열려 있는 것', ' · '.join(f"{x['no']} {x['what'][:110]}" for x in opened)],
 ['알아 두실 것', '① 소개자 실적은 그 회원이 소개자로 참여한 거래(소개코드 귀속) 기준 — 개발 자료에서는 대부분 0 ② 누적수익은 소개비 중개 기능이 꺼져 있어 지금은 0원(시험에서는 정산 완료 거래 1건을 넣어 확인하고 지움) ③ 실제 웹의 금액 자리는 소개비(매물 금액 항목이 서버에 없음) ④ 실제 웹의 색 · 글꼴은 그대로(구성만 맞춤) ⑤ 시안의 소개자 · 실적 · 후기는 견본 ⑥ 시안 견본 사진은 5종'],
 ['확인하지 못한 것', '결제사(토스) 테스트 환경(v10.18 그대로 — docs/62 9절) · Windows PowerShell 5.1 · ISE 에서의 dev.ps1 · 실제 AWS · 진짜 Docker Hub 이미지 · 실제 웹 소개광장 글 상세(개발 DB 에 글 없음) · 운영 화면(BO) 안의 상세 열기'],
 ['남은 일', '⓪ 결정: 시안의 남은 「같은 상세」 6곳 24건(요청 · 계약 · 회원 · 검수 · 서비스 — 선택 ②) · 안내만 나오는 「상세 · 보기」 단추 22건(G-130) · 소개자 실적에 판매 실적을 넣을지 ① 실제 웹 디자인 맞춤(색 · 글꼴 · 나머지 화면 · G-94 · G-91 · G-137) — v10.22 ② V-World 연동(키 값 다시 필요) ③ G-120 · G-127'],
]
json.dump({'rows': rows}, open(f'{Q}/summary.json', 'w'), ensure_ascii=False, indent=1)
print('summary rows', len(rows))
