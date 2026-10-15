"""v10.23 요약 시트(summary.json) — final_all.txt · 시험 결과 · doc71_extra.txt 에서 수치를 읽어 씁니다."""
import json, re, os
Q = os.path.dirname(os.path.abspath(__file__))
def kv(f):
    try: return dict(l.split(': ', 1) for l in open(f'{Q}/{f}', encoding='utf-8').read().split('\n') if ': ' in l)
    except FileNotFoundError: return {}
fa = kv('final_all.txt'); ex = kv('doc71_extra.txt')
J = lambda f: json.load(open(f'{Q}/{f}', encoding='utf-8'))
okn = lambda xs: f"{sum(1 for x in xs if x['ok'])}/{len(xs)}"
g = lambda k: fa.get(k + '_rerun', fa.get(k, '?')).split('   (')[0]
g0 = lambda k: fa.get(k, '?')
cmu = J('srv_cmu.json')['items']; cui = J('srv_cmu_ui.json')['items']; pcm = J('proto_cmu.json')['items']; ppx = J('proto_pixel.json'); pdf = J('proto_diff.json')
sc = J('site_crawl.json')['pages']; bo = J('admin_final.json')['tabs']
n200 = sum(1 for p in sc if p['status'] == 200); n404 = sum(1 for p in sc if p['status'] == 404)
d = J('defects.json'); num = lambda x: int(re.sub(r'\D', '', x['no']) or 0)
new = [x for x in d if 146 <= num(x)]; opened = [x for x in d if '열려 있음' in x['what']]
short = lambda k: re.sub(r'^통과 ', '', g(k)).split(' →')[0]
SUITES = ['fixtures','e2e','decisions','decisions_ui','fixes_1002','srv_aff','srv_hlt','srv_ptn','srv_aff_ui','srv_hlt_ui','srv_ptn_ui','srv_proto','srv_pay','srv_pay_ui','srv_file','srv_file_ui','srv_lead','srv_lead_ui',
          'srv_consult','srv_consult_ui','srv_retship','srv_refcode','srv_refcode_ui','srv_viewlimit','csrf','srv_poll','srv_poll_ui','srv_billing','srv_billing_ui','srv_detail','srv_cmu','srv_cmu_ui']
rep = g0('proto_report'); m = re.search(r"^(\d+) \{'clicks': (\d+).*'none': (\d+), 'error': (\d+)", rep)
sweep = f"{m.group(1)}화면 · {int(m.group(2)):,}회 · 무반응 {m.group(3)} · 오류 {m.group(4)}" if m else '?'
rer = [k for k in SUITES + ['verify'] if (k + '_rerun') in fa]
f1 = kv('final_all_first_v1023.txt'); _fr = lambda v: re.search(r'(\d+) ?/ ?(\d+)', v or '')
stuck = [k for k in SUITES if k in f1 and (not _fr(f1[k]) or _fr(f1[k]).group(1) != _fr(f1[k]).group(2))]
stuck += [k[:-6] for k in fa if k.endswith('_rerun') and k != 'verify_rerun' and k[:-6] not in stuck]
try: WHY = json.load(open(f'{Q}/doc71_why.json', encoding='utf-8'))
except FileNotFoundError: WHY = {}
rows = [
 ['결론', "10/7 v10.23 — 지시 「소개몰, 소개광장 디자인대로 적용 · 하위 페이지 생성 · 색상이나 스타일을 제시한 형태로 유지 · 사진을 변환하지 않고 사용(png) · 다른 부분은 현 상태 유지 · 작업 후 전수 검사(개발분과 시안을 비교 · 반영 전에 확인 후 반영)」 가운데 **소개광장**을 시안 · 실제 웹 · 서버에 반영했습니다"
          "(답: 서버까지 확장 · 새 머리줄은 두 관에서만 · 글자 없는 원본 사진을 올림 · 메뉴 이름 「소개뱅크몰」 유지 / 비교 그림 확인 뒤 「변경분 반영 작업」 · 로그인 머리줄 「제안대로」 · 글쓰기 안내 상자 「시안처럼」). "
          f"소개광장 4쪽(목록 · 글 상세 · 글쓰기 · 투표)이 시안과 실제 웹에서 같은 모양입니다. 새 시험 — 서버 {okn(cmu)} · 실제 웹 {okn(cui)} · 시안 {okn(pcm)} · 그림이 받은 PNG 그대로인지 {g0('cut_b2')} · "
          f"앞 판과 그림 비교 {okn(ppx['items'])}(바꾸기로 한 5장 말고 {ppx['same']}장은 점 하나 같음) · 글자 비교 {okn(pdf['items'])}. 소개뱅크몰은 원본 PNG 를 받지 못해 다음 판입니다."],
 ['바뀐 규모', '서버: 새 길 1개(GET /community/board — 검색 · 쪽 번호) · 작성자 가림(목록 · 글 상세 · 댓글 — G-146) · API 419 → 420 / 실제 웹: 소개광장 4쪽 · 두 관 전용 머리줄 · 바닥줄(components/b2) · 사이트 안의 길 1개(/cart-count) · 스타일 2개(b2.css · plaza.css) · 그림 7개(public/b2) / 시안: 화면 5장(cmu · commu · cmud · cmuw · cmupoll) · 화면 수 193 그대로 · 파일 약 4.0MB → 5.0MB(그림을 그대로 넣음) / DB: 없음(마이그레이션 68 그대로) / 등록부: spec/screens.json 의 소개광장 목록 화면에 새 길 연결'],
 ['절차서', 'sgb/docs/71_소개광장_제시디자인적용_v10.23_20261007.md — 결론 · 제시 디자인에서 읽은 값 · 그림과 다르게 넣은 것 · 시안과 개발분이 다른 것 · 바꾼 곳 · 함께 찾은 것 · 알아 두실 것 · 확인 결과 · PC 에서 보는 법 · 다음 판'],
 ['소개광장 서버(srv_cmu.py)', f"전체 {okn(cmu)} — 작성자 가림 11(목록 · 글 상세 · 댓글 · 운영자 · 탈퇴 · 한 글자 이름 · 영문 · 운영 대기열은 이름 전체) · 쪽 번호 11 · 검색 11(제목 + 본문 · 낱말 모두 · 50자 넘으면 400 · 같은 이름 두 번) · 보이는 범위 4(검수 대기는 본인만) · 기존 길 · SQL 고정 글 4 · 뒷정리 1. 고치기 전 9/40"],
 ['소개광장 실제 웹(srv_cmu_ui.py)', f"전체 {okn(cui)} — 머리줄 · 바닥줄 12 · 목록 16(제시 디자인의 치수 · 색) · 검색 · 쪽 넘김 · 탭 9 · 글 상세 · 글쓰기 · 로그인/로그아웃 · 장바구니 숫자 14 · 그림 7개가 PNG 그대로 2 · 소개광장 밖 11곳은 옛 머리줄 그대로 3 · 390px 3 · 화면 오류 0"],
 ['소개광장 시안(proto_cmu.py)', f"전체 {okn(pcm)} — 새 머리줄 · 바닥줄은 5장에만 11 · 목록 1쪽 10줄 = 제시 디자인 4 · 치수 · 색 7 · 쪽 번호 · 탭 · 검색(주소에 실림) 13 · 글 상세 · 글쓰기 · 투표 12 · 그림이 실제 웹의 PNG 와 바이트까지 같음 2 · 390px 2 · 화면 오류 0"],
 ['앞 판과 비교(proto_pixel.py · proto_diff.py)', f"그림 {okn(ppx['items'])} — 193장을 두 판에서 찍어 견줌: 점 하나 같음 {ppx['same']}장 · 다름 {ppx['diff']}(바꾸기로 한 소개광장 5장) / 글자 {okn(pdf['items'])} — 달라진 화면 {pdf.get('changed')} · 새 화면 {pdf.get('added')} | 옛 판 시험: 축 상세(v10.22) {g('proto_axis')} · 언어 단추 {g('proto_lang')} · 매물 상세(v10.21) {g('proto_item')} · 상세(v10.20) {g('proto_detail')} · 급구 · 급매 {g('proto_urg')} · 투표 · 옛 판 비교 {g('proto_poll')}"],
 ['통합 검정(npm run verify)', g('verify') + (f" | 첫 실행: {g0('verify')} — {WHY.get('verify', '')}" if 'verify_rerun' in fa else '')],
 ['매트릭스', g('matrix').replace('매트릭스: ', '') + ' · 마이그레이션 68 · 시안 화면 193'],
 ['전수 검정 — 운영 방식 API', 'API 를 tsc 로 빌드한 dist/main.js 로 띄우고 전부(마지막 코드로 다시 돌린 결과): ' + ' · '.join(f"{k} {short(k)}" for k in SUITES)],
 ['첫 실행에서 드러난 것(고치고 다시 돌림)', ' / '.join([f"통합 검정 — {WHY.get('verify', '')}"] + [f"{k} — {WHY.get(k, '')}" for k in stuck]) + ' / 서버 코드를 마지막으로 고친 뒤(G-153) 1구간의 매트릭스 · 흐름 시험 5묶음 · 2구간 27묶음을 전부 다시 돌렸고, 3구간 · Docker · 리허설은 그 뒤에 돌렸습니다. 첫 실행의 결과는 qa/results_v10_23/final_all_first_v1023.txt'],
 ['사용자 웹 메인 · 안심소개 · 시간대', f"web_main {g('web_main')} · web_main_live {g('web_main_live')} · web_mal {g('web_mal').split(' ')[0]} · site_tz {short('site_tz')} · site_detail {short('site_detail')}"],
 ['GET API 전수', g('smoke')],
 ['목록 쪽 넘김', g('pagetest')[:200]],
 ['사용자 웹 페이지(모든 페이지 상호 확인)', f"{len(sc)} (경로 × 5역할) — 200 {n200} · 404 {n404} (의도) · API 실패 {sum(1 for p in sc if p.get('api_fail'))} · 스크립트 오류 {sum(1 for p in sc if p.get('errors'))}"],
 ['운영 BO', f"{len(bo)} 화면 상태 × 5계정 — 실패 {sum(1 for t in bo if t.get('errors') or t.get('api_fail') or t.get('errview'))} (일반회원 거부 포함)"],
 ['시안 v10.23', f"소개광장 {g('proto_cmu')} · 그림 비교 {g('proto_pixel')} · 글자 비교 {g('proto_diff')} · 축 상세 {g('proto_axis')} · 언어 단추 {g('proto_lang')} · 매물 상세 {g('proto_item')} · 상세(v10.20 시험) {g('proto_detail')} · 급구 · 급매 {g('proto_urg')} · 내 구독 {g('proto_bill')} · 상담 {g('proto_consult')} · 메인 {g('proto_main')} · 투표 {g('proto_poll')} · 누르기 전수 {sweep} · 서버 연동 {g('srv_proto')}"],
 ['Docker 실구동(대체 이미지)', ex.get('DOCKER', '?')],
 ['PowerShell 도우미 · 새로 설치', ex.get('PS', '?') + ' | 새로 설치: ' + ex.get('FRESH', '?')],
 ['서버 적용 리허설(v10.23 zip)', ex.get('REHEARSAL', '?')],
 ['이번 판에서 찾은 것', ' · '.join(f"{x['no']} {x['what'][:100]}" for x in new)],
 ['열려 있는 것', ' · '.join(f"{x['no']} {x['what'][:110]}" for x in opened)],
 ['알아 두실 것', '① 사진 띠의 사진은 임시(받은 그림의 글자 없는 오른쪽 부분) — 글자 없는 원본이 오면 한 줄만 바꿈 ② 새 머리줄 · 바닥줄은 소개광장에서만(다른 관은 그대로 — 관을 옮기면 머리줄이 달라 보임) ③ 작성자 가림은 서버가 함(응답에 이름 전체가 실리지 않음 · 운영 대기열은 그대로) ④ 한 글자 낱말은 검색에서 빠짐(서버의 검색 규칙) ⑤ 시안의 글은 견본 72건(1쪽 10줄은 그림 그대로 · 나머지는 지어낸 예시) · 저장하지 않음 ⑥ 글꼴은 그림만으로 알 수 없어 지금 글꼴에 굵기 · 크기만 맞춤 ⑦ 좁은 화면 디자인은 받은 것이 없어 같은 색 · 모양으로 줄여 그림 ⑧ 로그아웃 단추는 소개광장 머리줄에만(G-149) ⑨ 그림과 다르게 넣은 것 9가지는 문서 71 의 2절'],
 ['확인하지 못한 것', '글자 없는 사진 띠 원본 · 소개뱅크몰 원본 PNG(받지 못함) · 제시 디자인의 글꼴 이름 · 좁은 화면 디자인 · PC 의 Chrome 에서의 모양(작업 환경의 Chromium 으로 확인) · 전자상거래법 제10조 · 제20조 현행 조문 · 결제사(토스) 테스트 환경 · Windows PowerShell 5.1 · ISE 에서의 dev.ps1 · 실제 AWS · 진짜 Docker Hub 이미지'],
 ['남은 일', '⓪ 받을 것: 소개뱅크몰 원본 PNG · 글자 없는 사진(소개광장 띠 · 몰 큰 띠 · 특가전 · 아래 띠) ① v10.24 안심소개 「생활 · 금융 상담」(업종 상세 · 축 주소 · 신청서 다듬기 · 시험용 업체) — 비교 그림 → 확인 → 반영 ② 소개뱅크몰 모양(시안 21장 + 새 6장 · 실제 웹 22쪽) ③ 서버 1차(상품 관리 · 기획 띠 · 성분별 최저가) · 2차(배송 처리 · 구매 후기 · 순위) — G-147 ④ 결정: 로그아웃 단추를 다른 화면에도(G-149) · 시안의 남은 「같은 상세」 6곳 24건(G-122) · 안내만 나오는 단추 22건(G-130) · 실제 웹에 소개창업 세 축 ⑤ 실제 웹 디자인 맞춤(관 · 마이 · 파트너센터 · 운영 화면) · V-World 연동(키 값을 다시 받아야 함) · G-142 · G-120 · G-127'],
]
json.dump({'rows': rows}, open(f'{Q}/summary.json', 'w'), ensure_ascii=False, indent=1)
print('summary rows', len(rows))
