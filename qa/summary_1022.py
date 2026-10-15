"""v10.22 요약 시트(summary.json) — final_all.txt · 시험 결과 · doc70_extra.txt 에서 수치를 읽어 씁니다."""
import json, re, os
Q = os.path.dirname(os.path.abspath(__file__))
def kv(f):
    try: return dict(l.split(': ', 1) for l in open(f'{Q}/{f}', encoding='utf-8').read().split('\n') if ': ' in l)
    except FileNotFoundError: return {}
fa = kv('final_all.txt'); ex = kv('doc70_extra.txt')
J = lambda f: json.load(open(f'{Q}/{f}', encoding='utf-8'))
okn = lambda xs: f"{sum(1 for x in xs if x['ok'])}/{len(xs)}"
g = lambda k: fa.get(k, '?')
pax = J('proto_axis.json'); plg = J('proto_lang.json')['items']; ppx = J('proto_pixel.json'); pdf = J('proto_diff.json')
sc = J('site_crawl.json')['pages']; bo = J('admin_final.json')['tabs']
n200 = sum(1 for p in sc if p['status'] == 200); n404 = sum(1 for p in sc if p['status'] == 404)
d = J('defects.json'); num = lambda x: int(re.sub(r'\D', '', x['no']) or 0)
fixed = [x for x in d if 138 <= num(x) <= 141 or num(x) == 143]; opened = [x for x in d if '열려 있음' in x['what']]
short = lambda k: re.sub(r'^통과 ', '', g(k)).split(' →')[0]
SUITES = ['fixtures','e2e','decisions','decisions_ui','fixes_1002','srv_aff','srv_hlt','srv_ptn','srv_aff_ui','srv_hlt_ui','srv_ptn_ui','srv_proto','srv_pay','srv_pay_ui','srv_file','srv_file_ui','srv_lead','srv_lead_ui',
          'srv_consult','srv_consult_ui','srv_retship','srv_refcode','srv_refcode_ui','srv_viewlimit','csrf','srv_poll','srv_poll_ui','srv_billing','srv_billing_ui','srv_detail']
rep = g('proto_report'); m = re.search(r"^(\d+) \{'clicks': (\d+).*'none': (\d+), 'error': (\d+)", rep)
sweep = f"{m.group(1)}화면 · {int(m.group(2)):,}회 · 무반응 {m.group(3)} · 오류 {m.group(4)}" if m else '?'
rer = [k for k in SUITES if (k + '_rerun') in fa]
rows = [
 ['결론', "10/7 v10.22 — 지시 ① 「시안 머리줄의 언어 선택 단추가 머리줄 밖으로 삐져나온 결함 … 수정」 ② 「공고 · 자문 서비스 · 정책 · 교육 상세를 만들고 주소도 항목마다 다르게(v10.21 매물 상세와 같은 방식)」을 시안에 반영했습니다"
          "(답: 인력 축 법무 회신 A-09 「회신 완료 — 연다」 · 같은 화면의 결함도 「같이 고치기」). "
          f"소개창업 세 축의 줄 14개가 저마다 그 항목의 상세로 가고(새 화면 4장 · 주소 14개 · 축 · 갈래 주소 7개), 언어 단추는 머리줄 안으로 들어왔으며 같은 원인으로 깨져 있던 로그인 화면도 원래 모양이 됐습니다. "
          f"축 상세 시험 {okn(pax['items'])} · 언어 단추 {okn(plg)} · 앞 판과 그림 비교 {okn(ppx['items'])}(점 하나 같은 화면 {ppx['same']}장 · 머리줄의 언어 단추 자리만 다른 화면 {ppx['header_only']}장 · 그 밖은 로그인 · 소개창업 랜딩뿐) · 글자 비교 {okn(pdf['items'])}. 시안만 바뀌었습니다(서버 · DB · 실제 웹은 v10.21 과 같음)."],
 ['바뀐 규모', '시안: 새 화면 4장(bjob 공고 상세 SB-BIZ-JOB-020 · bsvc 자문 서비스 상세 SB-BIZ-SVC-020 · bpol 정책 상세 SB-BIZ-POL-020 · bedu 교육 상세 SB-BIZ-EDU-020) · 달라진 화면 1장(소개창업 랜딩) · 스타일(언어 단추 이름 · 떨어져 나간 조각 삭제 · 강조 배지 이름) · 화면 수 189 → 193 / 서버 · DB · 실제 웹: 없음(마이그레이션 68 그대로) / 검정 도구: 화면 시험 1개의 기다림(srv_lead_ui) · 엑셀 도구의 결과 파일 이름(G-143)'],
 ['절차서', 'sgb/docs/70_소개창업_축상세4종_언어단추수정_v10.22_20261007.md — 결론 · 언어 단추(원인 3가지) · 상세 4종(주소 · 장부 · 구성 · 인력 축 · 함께 고친 것) · 알아 두실 것 · 확인 결과 · PC 에서 보는 법 / 조사 기록 sgb/docs/69_소개창업_인력_운영지원_정보_상세목록_확인_20261007.md'],
 ['축 상세(proto_axis.py)', f"전체 {okn(pax['items'])} — 축 · 갈래 주소 7개(누르기 · 바로 열기) · 줄 14개의 단추와 제목이 그 항목의 상세 · 주소 14개가 서로 다름 · 바로 열기 14 · 없는 번호 · 화면 ID · 네 종류 한 틀 · 정책 · 교육의 「시연용 견본」 표시 · 맨 아래 줄 동작 · 인력 축(「아직 열지 않았습니다」 없음 · 업체 소개 요청 → 접수 → 「지원」 갈래 · 초단기만 보기) · 돌아가기(들어온 축 · 갈래 / 바로 연 상세는 목록) · 배지 자리 16개 · 옛 관 이름 0 · 지난 날짜 0 · 창업계획 등록 · 홈 퀵메뉴 · 화면 193장 · 390px · 안심소개 축 · 창업 축 카드 · 오류 0. 고치기 전 2/19"],
 ['언어 단추(proto_lang.py)', f"전체 {okn(plg)} — 언어 단추가 있는 화면 전부에서 단추 높이 40px 이하 · 머리줄 안 · 「▾」가 글자 크기 · 목록이 단추 바로 아래 · 언어 바꾸기 · 로그인 상자 글자색 · 큰 단추 3개 44px 이상 · 가운데 · 이름 겹침 없음(소스) · 390px. 고치기 전 1/13(단추 153×87 · 「▾」 63×73 · 목록이 834px 아래 · 로그인 단추 32px)"],
 ['앞 판과 비교(proto_pixel.py · proto_diff.py)', f"그림 {okn(ppx['items'])} — 189장을 두 판에서 찍어 견줌: 점 하나 같음 {ppx['same']}장 · 머리줄의 언어 단추 자리만 다름 {ppx['header_only']}장 · 머리줄 밖까지 다름 {ppx['diff']} / 글자 {okn(pdf['items'])} — 새 화면 4장 · 달라진 화면 {pdf.get('changed')} · 언어 단추의 클래스 이름만 다른 화면 {len(pdf.get('only_lang_class', []))}장 | 옛 판 시험: 상세(v10.20) {g('proto_detail')} · 급구 · 급매 {g('proto_urg')} · 매물 상세(v10.21) {g('proto_item')} · 투표 · 옛 판 비교 {g('proto_poll')}"],
 ['통합 검정(npm run verify)', g('verify')],
 ['매트릭스', g('matrix').replace('매트릭스: ', '') + ' · 마이그레이션 68 · 시안 화면 193(새 4장은 시안에만 있는 화면 — 등록부에 넣지 않음)'],
 ['전수 검정 — 운영 방식 API', 'API 를 tsc 로 빌드한 dist/main.js 로 띄우고 전부 다시: ' + ' · '.join(f"{k} {short(k)}" for k in SUITES) + (' | 다시 돌린 것: ' + ' · '.join(f"{k} → {short(k + '_rerun')}" for k in rer) + ' (srv_lead_ui 는 운영 「리드 배정 · 전체」 목록이 2.4초 걸려 시험의 1.8초 기다림에 걸림 — G-142 · 시험을 고침 / srv_retship 는 가끔 나는 화면 오류 G-94)' if rer else '')],
 ['사용자 웹 메인 · 안심소개 · 시간대', f"web_main {g('web_main')} · web_main_live {g('web_main_live')} · web_mal {g('web_mal').split(' ')[0]} · site_tz {short('site_tz')} · site_detail {short('site_detail')}"],
 ['GET API 전수', g('smoke')],
 ['목록 쪽 넘김', g('pagetest')[:200]],
 ['사용자 웹 페이지(모든 페이지 상호 확인)', f"{len(sc)} (경로 × 5역할) — 200 {n200} · 404 {n404} (의도) · API 실패 {sum(1 for p in sc if p.get('api_fail'))} · 스크립트 오류 {sum(1 for p in sc if p.get('errors'))}"],
 ['운영 BO', f"{len(bo)} 화면 상태 × 5계정 — 실패 {sum(1 for t in bo if t.get('errors') or t.get('api_fail') or t.get('errview'))} (일반회원 거부 포함)"],
 ['시안 v10.22', f"축 상세 {g('proto_axis')} · 언어 단추 {g('proto_lang')} · 그림 비교 {g('proto_pixel')} · 글자 비교 {g('proto_diff')} · 매물 상세 {g('proto_item')} · 상세(v10.20 시험) {g('proto_detail')} · 급구 · 급매 {g('proto_urg')} · 내 구독 {g('proto_bill')} · 상담 {g('proto_consult')} · 메인 {g('proto_main')} · 투표 {g('proto_poll')} · 누르기 전수 {sweep} · 서버 연동 {g('srv_proto')}"],
 ['Docker 실구동(대체 이미지)', ex.get('DOCKER', '?')],
 ['PowerShell 도우미 · 새로 설치', ex.get('PS', '?') + ' | 새로 설치: ' + ex.get('FRESH', '?')],
 ['서버 적용 리허설(v10.22 zip)', ex.get('REHEARSAL', '?')],
 ['고친 것', ' · '.join(f"{x['no']} {x['what'][:90]}" for x in fixed)],
 ['열려 있는 것', ' · '.join(f"{x['no']} {x['what'][:110]}" for x in opened)],
 ['알아 두실 것', '① 실제 웹 · 서버 · DB 에는 세 축(인력 · 운영지원 · 정보)이 없습니다 — 이번 것은 시안 ② 자문 서비스의 주소는 advisory(설계 때 말씀드린 support 는 고객센터가 이미 쓰는 주소) ③ 목록의 단추 이름 둘이 바뀜(운영지원 「자문 요청」 · 교육 「수강 신청」 → 「상세 보기」 · 신청 단추는 상세 안) ④ 「지원」 갈래는 처음에 비어 있고 파일을 다시 열면 비워짐(시안은 저장하지 않음) ⑤ 날짜는 오늘 기준으로 계산해 볼 때마다 달라짐 ⑥ 정책 · 교육의 내용은 지어낸 예시(화면에 「시연용 견본」 표시) ⑦ 인력 축의 문구는 앞 판 그대로 — 법무 회신 내용과 맞는지는 확인하지 못함 ⑧ 떨어져 나간 스타일 조각이 원래 어느 요소의 것이었는지는 남아 있지 않음 ⑨ v10.19 ~ v10.21 엑셀의 PowerShell 시트는 v10.18 의 결과 파일을 실었음(G-143 — 통과 · 실패 수는 같음)'],
 ['확인하지 못한 것', '인력 축 문구와 법무 회신(A-09)의 일치 · PC 의 Chrome 에서의 모양(작업 환경의 Chromium 으로 확인) · 결제사(토스) 테스트 환경(v10.18 그대로 — docs/62 9절) · Windows PowerShell 5.1 · ISE 에서의 dev.ps1 · 실제 AWS · 진짜 Docker Hub 이미지 · 시안 전체의 스타일 이름 겹침 점검 · 안심소개의 축과 그 밖의 화면 안 탭(상세 보기 목록표 방식)'],
 ['남은 일', '⓪ 결정: 실제 웹에 세 축을 만들지 · 시안의 남은 「같은 상세」 6곳 24건 · 안내만 나오는 「상세 · 보기」 단추 22건(G-130) · 소개자 실적에 판매 실적을 넣을지 · 매물 금액 항목 ① 실제 웹 디자인 맞춤(색 · 글꼴 · 나머지 화면 · G-94 · G-91 · G-137 — v10.23) ② 운영 리드 배정 「전체」 목록 속도(G-142) ③ V-World 연동(키 값을 다시 받아야 함) ④ 정산 신청의 소개자 확인(G-120) · 서버 날짜의 시간대(G-127) ⑤ 결제사 테스트 환경 확인 ⑥ PC 에서 PowerShell 5.1 · ISE 확인'],
]
json.dump({'rows': rows}, open(f'{Q}/summary.json', 'w'), ensure_ascii=False, indent=1)
print('summary rows', len(rows))
