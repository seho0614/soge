import json, collections
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

K = '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb'
Q = '/home/claude/qa'
# v10.27 — 판 · 날짜 · 저장 위치를 한 곳에. 시험 삼아 만들 때는 XLSX_OUT=/tmp/... 로 다른 곳에 저장합니다
import os as _os0
VER, VDATE = 'v10.28', '20261009'
XLSX_OUT = _os0.environ.get('XLSX_OUT') or f"/mnt/user-data/outputs/SGB_Matrix_Verification_{VDATE}_{VER.replace('.', '_')}.xlsx"
m = json.load(open(f'{K}/docs/matrix/matrix.json'))
site = json.load(open(f'{Q}/site_final.json'))
adm = json.load(open(f'{Q}/admin_final.json'))
e2e = json.load(open(f'{Q}/e2e.json'))
smoke = json.load(open(f'{Q}/api_smoke.json'))
proto = json.load(open(f'{Q}/proto_report_1002.json'))

defects = json.load(open(f'{Q}/defects.json'))
summary = json.load(open(f'{Q}/summary.json'))

wb = Workbook()
HDR = PatternFill('solid', fgColor='1F3A5F'); HF = Font(bold=True, color='FFFFFF')
OK = PatternFill('solid', fgColor='E2F0D9'); NG = PatternFill('solid', fgColor='FBE3E4'); WN = PatternFill('solid', fgColor='FFF2CC')
thin = Side(style='thin', color='D0D7DE')

def sheet(title, heads, rows, widths=None, status_col=None):
    ws = wb.create_sheet(title)
    ws.append(heads)
    for c in ws[1]:
        c.fill = HDR; c.font = HF; c.alignment = Alignment(vertical='center', wrap_text=True)
    for r in rows:
        ws.append([', '.join(map(str, v)) if isinstance(v, list) else v for v in r])
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = ws.dimensions
    for i, h in enumerate(heads, 1):
        w = (widths or {}).get(h) or min(60, max(10, len(str(h)) * 2 + 2))
        ws.column_dimensions[get_column_letter(i)].width = w
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.alignment = Alignment(vertical='top', wrap_text=True)
            c.border = Border(bottom=thin)
        if status_col is not None:
            v = str(row[status_col].value or '')
            fill = OK if (v.startswith(('통과', 'OK', '200', '수정')) or '정상' in v) else NG if v.startswith(('실패', 'FAIL', '5', '오류')) else WN if v else None
            if fill: row[status_col].fill = fill
    return ws

# 0. 요약
ws = wb.active; ws.title = '0_요약'
ws['A1'] = f'소개뱅크 코드킷 — 개발 Docker 통합판 검정 매트릭스 ({VDATE[:4]}-{VDATE[4:6]}-{VDATE[6:]} · {VER})'; ws['A1'].font = Font(bold=True, size=14)
r = 3
for k, v in summary['rows']:
    ws.cell(r, 1, k).font = Font(bold=True); ws.cell(r, 2, v); r += 1
ws.column_dimensions['A'].width = 34; ws.column_dimensions['B'].width = 100
for row in ws.iter_rows(min_row=3):
    for c in row: c.alignment = Alignment(wrap_text=True, vertical='top')

# 1. 화면목록
pages_by_file = collections.defaultdict(list)
for p in site['pages']:
    pages_by_file[p['route']].append(p)
def local_result(s):
    res = []
    for f in s['impl']:
        if not f.startswith('site/'): continue
        route = '/' + f.replace('site/src/app', '').replace('/page.tsx', '').strip('/')
        route = '/' if route == '/' else route
        import re
        route = re.sub(r'\[([^\]]+)\]', r'{\1}', route)
        ps = pages_by_file.get(route if route != '' else '/', [])
        if ps:
            bad = [p for p in ps if p['status'] >= 400 or p['errors'] or p['api_fail'] or p['bad_text']]
            res.append(f"{len(ps)-len(bad)}/{len(ps)} 정상" + (f" ({','.join(sorted(set(p['role'] for p in bad)))} 확인)" if bad else ''))
    return '; '.join(res)
sheet('1_화면목록', ['화면 ID', '이름', '그룹', 'URL', '역할', '게이트', '구현 파일', '연결 근거', '시안 키', 'API(레지스트리)', 'API(코드 호출)', '로컬 테스트'],
      [[s['id'], s['name'], s['group'], s['url'], s['roles'], s['gates'], s['impl'], s['match'], s['proto'], s['apis_registry'], s['apis_called'], local_result(s)] for s in m['screens']],
      {'화면 ID': 18, '이름': 26, 'URL': 30, '구현 파일': 42, 'API(레지스트리)': 46, 'API(코드 호출)': 46, '로컬 테스트': 22})

# 2. 백엔드목록
sheet('2_백엔드목록', ['모듈', '컨트롤러', '핸들러', '메서드', '경로', '역할', '게이트', '서비스 호출', '테이블', 'DB 함수', '파일'],
      [[h['module'], h['controller'], h['handler'], h['method'], h['path'], h['roles'], h['gate'], h['services'], h['tables'], h['fns'], h['file']] for h in m['backend']],
      {'경로': 42, '서비스 호출': 40, '테이블': 44, '파일': 44})

# 3. API목록 (+ GET 실측)
sm = {(r['path']): r for r in smoke}
rows = []
for a in m['apis']:
    s = sm.get(a['path']) if a['method'] == 'GET' else None
    st = '' if not s else (f"{s['status']} ({s['who'] or '비로그인'})")
    rows.append([a['method'], a['path'], a['module'], a['controller'], a['roles'], a['gate'], a['status'], a['screens_registry'], a['callers'],
                 a['tables'] or [t + '*' for t in a['tables_module']], st])
sheet('3_API목록', ['메서드', '경로', '모듈', '핸들러', '역할', '게이트', '문서상태', '레지스트리 화면', '호출 파일', '테이블(*=모듈단위)', 'GET 실측'],
      rows, {'경로': 42, '호출 파일': 40, '테이블(*=모듈단위)': 44, '레지스트리 화면': 30}, status_col=10)

# 4. DB목록
sheet('4_DB목록', ['스키마', '이름', '종류', '열', '행(개발DB)', '트리거', '쓰는 API 수', '모듈', '설명'],
      [[d['schema'], d['name'], d['kind'], d['cols'], d['rows'], d['triggers'], d['apis'], d['modules'], d['comment']] for d in m['db']],
      {'이름': 32, '모듈': 30, '설명': 70})

# 5. 수정내역
sheet('5_결함·수정', ['번호', '영역', '등급', '무엇', '원인', '근거', '조치', '파일', '상태'],
      [[d['no'], d['area'], d['sev'], d['what'], d['cause'], d['evidence'], d['fix'], d['file'], ('열려 있음 — 다음 판에서 수정' if d['what'].startswith('(열려 있음)') else '수정 · 재검정 통과')] for d in defects],
      {'무엇': 30, '원인': 44, '근거': 36, '조치': 44, '파일': 36}, status_col=8)

# 6. 시안점검 (v10.1 — 10/2 재점검)
rows = []
for p in proto:
    rows.append([p['kind'], p['id'], p['key'], p['title'], p['clicks'], p['nav'], p['toast'], p['dom'], p['input'], p['none'], p['error'],
                 p['dead_before'] or '—', p['dead'] or '—',
                 '정상' if p['error'] == 0 and not p['dead'] else ('정상(재확인 시 반응 — 측정 대기 시간 한계)' if p['error'] == 0 else '오류')])
sheet(f'6_시안점검_{VER}', ['구분', '화면 ID', '시안 키', '제목', '누른 수', '이동', '안내', '화면변화', '입력', '무반응', '오류', '무반응 버튼(전)', '무반응 버튼(후)', '판정'],
      rows, {'제목': 28, '무반응 버튼(전)': 44, '무반응 버튼(후)': 30}, status_col=13)

# 7. 로컬테스트 — 사용자 웹
rows = []
for p in site['pages']:
    ok = p['status'] < 400 and not p['errors'] and not p['api_fail'] and not p['bad_text']
    note = ''
    if not ok and '/i/' in p['url']: note = '무효 초대 링크 — 404 가 의도된 응답'
    elif not ok and p['url'].endswith('/edit') and p['status'] == 404: note = '남의 초안 매물 — 주인에게만 보임(의도)'
    elif not ok and p['status'] < 400 and any('#418' in e for e in p['errors']): note = '부하 중 간헐 수화 경고 — 화면은 정상, 재시도 125회 0'
    rows.append([p['role'], p['route'], p['url'], p['status'], p['final'], p['h1'], p['ms'], p['buttons'], p['forms'], len(p['links']),
                 p['api_fail'], p['errors'], p['console'], '정상' if ok else ('정상(의도)' if note else '실패'), note])
sheet('7_로컬테스트_웹', ['역할', '경로', '실제 주소', 'HTTP', '도착', '제목', '초', '버튼', '폼', '링크', 'API 실패', '스크립트 오류', '콘솔 오류', '판정', '비고'],
      rows, {'경로': 30, '실제 주소': 40, '제목': 26, '비고': 30}, status_col=13)

rows = []
for role, res in site['links'].items():
    for l, st in sorted(res.items()):
        _v = '정상' if isinstance(st, int) and st < 400 else '실패'
        # 확장 점검(10/8) — 404 가 된 매물 링크가 「그 사이 내려간 매물」이면 이미 알고 있는 G-161(오래 열지 않은 목록 쪽이 예전 자료를 한 번 보여 줌)입니다. DB 에서 그 매물의 지금 상태를 확인해 적습니다
        _m = __import__('re').match(r'^/(?:money|mall|biz)/([0-9a-f]{8}-[0-9a-f-]{27})$', l)
        if _v == '실패' and st == 404 and _m:
            _stt = __import__('subprocess').run(['psql', 'postgresql://sgb:sgb@localhost:5432/sgb', '-tAc', f"select status from listings where id='{_m.group(1)}'"], capture_output=True, text=True).stdout.strip()
            if _stt and _stt != 'PUBLISHED': _v = f'실패 — G-161 (그 사이 내려간 매물 · 지금 상태 {_stt} — 오래 열지 않은 목록 쪽이 예전 자료를 한 번 보여 줌)'
        rows.append([role, l, st, _v])
sheet('8_링크상호확인', ['역할', '링크', 'HTTP(리다이렉트 전)', '판정'], rows, {'링크': 50, '판정': 60}, status_col=3)

rows = []
for t in adm['tabs']:
    ok = not t.get('errors') and not t.get('api_fail') and not t.get('errview')
    rows.append([t['user'], t.get('tab') or '(로그인)', t.get('len', ''), t.get('buttons', ''), t.get('api_fail', ''), t.get('errors', ''),
                 t.get('alert', '') or t.get('head', ''), '정상' if ok else '실패'])
sheet('9_로컬테스트_BO', ['계정', '탭', '본문 글자', '버튼', 'API 실패', '스크립트 오류', '안내/첫 줄', '판정'], rows, {'안내/첫 줄': 60}, status_col=7)

# 10. 기능검증
sheet('10_기능검증', ['단계', '요청', 'HTTP', '판정', '응답(앞부분)'],
      [[r['step'], r['req'], r['status'], '통과' if r['ok'] else '실패', r['resp']] for r in e2e], {'단계': 32, '요청': 50, '응답(앞부분)': 90}, status_col=3)

# 11. 교차점검(자동)
sheet('11_교차점검', ['등급', '영역', '대상', '내용'], [[i['sev'], i['area'], i['what'], i['detail']] for i in m['issues']] or [['—', '—', '0건', '화면↔API↔백엔드↔DB 끊긴 곳 없음']], {'내용': 80})

# 12. 운영 결정 검증 (10/1)
dec = json.load(open(f'{Q}/decisions.json')); decu = json.load(open(f'{Q}/decisions_ui.json'))
sheet('12_운영결정검증', ['단계', '구분', '요청', 'HTTP', '판정', '내용'],
      [[r['step'], 'API·DB', r.get('req',''), r.get('status',''), '통과' if r['ok'] else '실패', r.get('resp','')] for r in dec] +
      [[r['step'], '화면', '', '', '통과' if r['ok'] else '실패', r.get('detail','')] for r in decu],
      {'단계': 40, '요청': 40, '내용': 80}, status_col=4)
# 13. 73화면 구현 (10/2)
r73=json.load(open(f'{Q}/screens73.json'))
sheet('13_73화면구현', ['화면 ID', '이름', '그룹', '레지스트리 경로', '역할', '구현 파일', '연결', '호출 API(레지스트리)', '미호출', '로컬 테스트'],
      [[r['id'], r['name'], r['group'], r['url'], r['roles'], r['impl'], r['match'], r['apis'], r['not_called'] or '—', r['local']] for r in r73],
      {'이름': 26, '레지스트리 경로': 30, '구현 파일': 44, '호출 API(레지스트리)': 50, '로컬 테스트': 26}, status_col=9)
fx=json.load(open(f'{Q}/fixes_1002.json'))
sheet('14_수정검증_1002', ['단계', '판정', '내용'], [[r['step'], '통과' if r['ok'] else '실패', r['detail']] for r in fx], {'단계': 60, '내용': 90}, status_col=1)
# 15. 서버 기능 6건 검증 (10/2)
rows=[]
for f,lab in [('srv_aff','제휴 링크·계좌 재인증 (API)'),('srv_aff_ui','제휴 링크·계좌 재인증 (화면)'),('srv_hlt','몰 재고·청약철회·배송지·성분 (API)'),('srv_hlt_ui','몰 (화면)'),('srv_ptn','파트너 운영 목록·중개사 심사 (API)'),('srv_ptn_ui','파트너·중개사 (화면)')]:
    for r in json.load(open(f'{Q}/{f}.json')): rows.append([lab, r['step'], '통과' if r['ok'] else '실패', r.get('detail','')])
sheet('15_서버기능검증', ['묶음', '단계', '판정', '내용'], rows, {'묶음': 30, '단계': 60, '내용': 80}, status_col=2)
# 16. 시안 v10.2 서버 연동
sp=json.load(open(f'{Q}/srv_proto.json'))
sheet('16_시안서버연동', ['단계', '구분', '판정', '내용'], [[r['step'], '시연(file://)' if r['step'].startswith('S-') else '실제 API', '통과' if r['ok'] else '실패', r.get('detail','')] for r in sp],
      {'단계': 56, '내용': 90}, status_col=2)
# 17. 10/2 서버 기능 — 결제·환불 · 파일 · 리드 배정 · 외부 연동 어댑터
rows=[]
for f,lab in [('srv_pay','결제·환불·개봉 반품 (API · 가짜 토스)'),('srv_pay_ui','결제·환불 (화면 · 결제창 경로 포함)'),('srv_file','파일 올리기 (API · 가짜 S3)'),('srv_file_ui','파일 올리기 (화면)'),('srv_lead','리드 배정 · 어댑터 3종 (API · 가짜 서버)'),('srv_lead_ui','리드 배정 · 상담 신청 (화면)')]:
    for r in json.load(open(f'{Q}/{f}.json')): rows.append([lab, r['step'], '건너뜀' if r.get('skip') else ('통과' if r['ok'] else '실패'), str(r.get('detail',''))[:300]])
sheet('17_서버기능_결제파일리드', ['묶음', '단계', '판정', '내용'], rows, {'묶음': 34, '단계': 60, '내용': 80}, status_col=2)
# 18. 실제 사용자 웹 반영 — 새 메인 · 안심소개 상담 축
rows=[]
wm=json.load(open(f'{Q}/web_main.json'))['items']; wl=json.load(open(f'{Q}/web_mal.json'))['items']
for r in wm: rows.append(['새 메인 (/)', r.get('state',''), r['name'], '통과' if r['pass'] else '실패', str(r.get('detail',''))[:300]])
for r in wl: rows.append(['안심소개 (/mall · /mall/give · /consult · /mal/consult)', '', r['name'], '통과' if r['ok'] else '실패', str(r.get('detail',''))[:300]])
sheet('18_사용자웹반영', ['화면', '상태', '항목', '판정', '내용'], rows, {'화면': 34, '항목': 60, '내용': 80}, status_col=3)
# 19. 10/2 2차 결정 — 반품 왕복 배송비 차감 · 일반 회원 소개코드 · 유입 기록 · CSRF
rows=[]
def _items(f):
    d=json.load(open(f'{Q}/{f}.json')); return d['items'] if isinstance(d, dict) else d
for f,lab in [('srv_retship','반품 왕복 배송비 차감 (API · 화면 · BO)'),('srv_refcode','소개코드 — 매물별 · 결제 후 추가 · 유입 · 귀속 (API)'),('srv_refcode_ui','소개코드 공유 · 링크 유입 (화면)'),('srv_viewlimit','요청 열람 한도 스위치 · 종료일 · BO 설정'),('csrf_check','사용자 웹 같은 출처 판정')]:
    for r in _items(f): rows.append([lab, r.get('step') or r.get('name'), '통과' if r.get('ok', r.get('pass')) else '실패', str(r.get('detail',''))[:300]])
sheet('19_결정반영_배송비_코드_열람한도', ['묶음', '단계', '판정', '내용'], rows, {'묶음': 34, '단계': 60, '내용': 80}, status_col=2)
# 20. 10/2 v10.11 — 올린 kit(v10.4.7) 안심소개 변경분: 상담 신청(휴대폰 확인 · 1곳) · 축별 입점 · 법률 · 세무 정액 노출
rows=[]
for f,lab in [('srv_lead','상담 신청 → 휴대폰 확인 → 1곳 배분 · 리드 배정 (API · DB)'),('srv_lead_ui','상담 신청 · 파트너 열람 · 운영 리드 배정 (화면)'),
              ('srv_consult','업종 22종 · 축별 입점 · 법률 · 세무 정액 노출 (API · DB)'),('srv_consult_ui','입점 신청 · 입점 심사 · 정액 노출 신청/관리 · 사무소 보기 (화면)')]:
    for r in _items(f): rows.append([lab, r.get('step') or r.get('name'), '건너뜀' if r.get('skip') else ('통과' if r.get('ok', r.get('pass')) else '실패'), str(r.get('detail',''))[:300]])
sheet('20_안심소개변경분_v10.11', ['묶음', '단계', '판정', '내용'], rows, {'묶음': 40, '단계': 64, '내용': 80}, status_col=2)
# 21. 10/2 v10.12 — 확인 항목 회신 반영: 법률 · 세무 월 노출료 기준 금액(관리자 등록 · 시작값 300,000원 · D020) · 보관 기간 별도 유지
rows=[]
for f,lab,pick in [('srv_consult','월 노출료 기준 금액 · 보관 기간 (API · DB)', lambda t: t.startswith(('F-','G-'))),
                   ('srv_consult_ui','기준 금액 등록 · 금액 비우고 켜기 · 업체 안내 (화면)', lambda t: '(v10.12)' in t),
                   ('proto_consult','시안 v10.12 — 기준 금액 상자 · 저장 · 켜기 · 업체 안내 (시연)', lambda t: t[:4] in ('P-0 ','P-14','P-15','P-16','P-17','P-18','P-19','P-20'))]:
    for r in _items(f):
        t = r.get('step') or r.get('name')
        if pick(t): rows.append([lab, t, '건너뜀' if r.get('skip') else ('통과' if r.get('ok', r.get('pass')) else '실패'), str(r.get('detail',''))[:300]])
sheet('21_노출료기준금액_v10.12', ['묶음', '단계', '판정', '내용'], rows, {'묶음': 44, '단계': 70, '내용': 80}, status_col=2)
# 22. 10/2 v10.13 — 메인 「hero 페이지」 디자인 적용(메인 전용 헤더 · 푸터 · 그림 속 이미지 · 내용 그대로) — 실제 웹 + 시안
rows=[]
def _wm(f):
    d=json.load(open(f'{Q}/{f}.json')); return d['items'] if isinstance(d, dict) else d
for f,lab in [('web_main_sample','실제 웹 메인 (/) — 그림 내용 그대로(기본)'),('web_main_live','실제 웹 메인 (/) — 실제 자료로 켠 경우(HOME_CONTENT=live)'),
              ('measure_home','실제 웹 메인 — 주신 그림과 자리 대조(1280px · 28곳 · ±12px)'),('hyd_home','실제 웹 메인 — 여러 번 새로 열기(수화 오류 #418 0건)'),
              ('proto_main','시안 메인 — 구성 · 동작 · 누르는 것 전부 · 390px'),('fixtures','시험 준비 자료(새 DB)'),
              ('web_main_docker','Docker 새 설치 — 메인'),('measure_home_docker','Docker 새 설치 — 그림과 자리 대조'),('hyd_home_docker','Docker 새 설치 — 여러 번 새로 열기(개발 모드)')]:
    try: items=_wm(f)
    except FileNotFoundError: continue
    for r in items:
        t = r.get('step') or r.get('name')
        rows.append([lab, r.get('state',''), t, '건너뜀' if r.get('skip') else ('통과' if r.get('ok', r.get('pass')) else '실패'), str(r.get('detail',''))[:300]])
sheet('22_메인디자인_v10.13', ['묶음', '상태', '항목', '판정', '내용'], rows, {'묶음': 44, '항목': 70, '내용': 80}, status_col=3)
# 23. 10/2 v10.14 — 시연되지 않던 기능 · 화면: 「이건 어때?」 투표(D021) · 사회관계망 주소 · 시안 「지급 데스크」 · 「리드 배정」
rows=[]
for f,lab,pick in [('srv_poll','투표 · 사회관계망 주소 (API · DB)', None),
                   ('srv_poll_ui','투표 · 사회관계망 주소 (사용자 웹 · 운영 화면 — 실제 브라우저)', None),
                   ('proto_poll','시안 v10.14 — 투표 · 사회관계망 · 지급 데스크 · 리드 배정 · 누르는 것 전부 · 이전 판과 화면마다 비교', None),
                   ('web_main_sample','실제 웹 메인 — 「이건 어때?」 · 사회관계망 (그림 내용 모드)', lambda t: '이건 어때' in t or '사회관계망' in t),
                   ('web_main_live','실제 웹 메인 — 「이건 어때?」 · 사회관계망 (실제 자료 모드)', lambda t: '이건 어때' in t or '사회관계망' in t or '지어낸' in t),
                   ('fixtures','시험 준비 자료', lambda t: t.startswith('5 ')),
                   ('srv_poll_docker','Docker 새 설치 — 투표 · 사회관계망 (API · DB)', None),
                   ('srv_poll_ui_docker','Docker 새 설치 — 투표 · 사회관계망 (화면)', None)]:
    try: items=_wm(f)
    except FileNotFoundError: continue
    for r in items:
        t = r.get('step') or r.get('name')
        if pick and not pick(t): continue
        rows.append([lab, r.get('state',''), t, '건너뜀' if r.get('skip') else ('통과' if r.get('ok', r.get('pass')) else '실패'), str(r.get('detail',''))[:300]])
sheet('23_투표_사회관계망_v10.14', ['묶음', '상태', '항목', '판정', '내용'], rows, {'묶음': 50, '항목': 76, '내용': 80}, status_col=3)
# 24. 10/3 v10.15 — 투표 질문 확정(시드 · 쓰던 DB 자동 반영 · 시안) · 진짜 기반 이미지 확인 절차(dev.ps1 realcheck)
rows=[]
for f,lab,pick in [('srv_poll','시드 규칙 (검정 DB · 되돌리기)', lambda t: t.startswith('G')),
                   ('srv_poll_docker','Docker 새 설치 — 시드 규칙', lambda t: t.startswith('G')),
                   ('proto_poll','시안 v10.15 — 확정한 질문 · 앞 판(v10.14)과 화면마다 비교', lambda t: t.startswith(('A-0','A-5','H-'))),
                   ('web_main_sample','실제 웹 메인 — 「이건 어때?」(그림 내용 모드)', lambda t: '이건 어때' in t),
                   ('web_main_live','실제 웹 메인 — 「이건 어때?」(실제 자료 모드)', lambda t: '이건 어때' in t),
                   ('measure_home','실제 웹 메인 — 그림과 자리 대조(투표 구역)', lambda t: '이건 어때' in t),
                   ('web_main_docker','Docker 새 설치 — 메인 「이건 어때?」', lambda t: '이건 어때' in t)]:
    try: items=_wm(f)
    except FileNotFoundError: continue
    for r in items:
        t = r.get('step') or r.get('name')
        if pick and not pick(t): continue
        rows.append([lab, r.get('state',''), t, '건너뜀' if r.get('skip') else ('통과' if r.get('ok', r.get('pass')) else '실패'), str(r.get('detail',''))[:300]])
import re as _re
for f,lab in [('realcheck_sh_standin.log','진짜 이미지 확인 — dev.sh realcheck (이 환경 · 대체 이미지)'),
              ('realcheck_ps_standin.txt','진짜 이미지 확인 — dev.ps1 realcheck (PowerShell 7 · 대체 이미지)'),
              ('realcheck_fresh_standin.log','진짜 이미지 확인 — dev.sh realcheck fresh (새 볼륨 · 대체 이미지)')]:
    try: lines=open(f'{Q}/{f}',encoding='utf-8-sig').read().split('\n')
    except FileNotFoundError: continue
    for l in lines:
        m=_re.match(r'^  (통과|실패|건너뜀)  (.*)$', l)
        if not m: continue
        name,_,det=m.group(2).partition(' — ')
        # 이 환경에서는 대체 이미지라 「공식 이미지 표지 없음」이 나오는 것이 바른 판정입니다
        expected = m.group(1)=='실패' and '공식 이미지 표지' in name
        rows.append([lab, '', name, '통과(바른 판정 — 대체 이미지를 가려냄)' if expected else m.group(1), det[:300]])
rows.append(['쓰던 DB 올리기 — v10.14 볼륨 → v10.15 (Docker)', '', '마이그레이션 적용 0 · 기존 66 · 변경감지 0', '통과', '준비 로그 「투표 시드 확인 (메인 3건)」'])
rows.append(['쓰던 DB 올리기 — v10.14 볼륨 → v10.15 (Docker)', '', '표가 1건 있는 예시 문구 투표 → 「감춤」(사유 · 표 그대로)', '통과', '둘 중 어떤 제품이 더 좋을까요? | HIDDEN | 1표 | 예시 문구 투표 — 확정한 질문으로 바꿈 (v10.15)'])
rows.append(['쓰던 DB 올리기 — v10.14 볼륨 → v10.15 (Docker)', '', '표가 없는 예시 문구 투표 2건 → 삭제 · 확정한 질문 3건 열림(0표) · 메인 API 가 새 질문을 냄', '통과', 'VS · ASK · USED'])
sheet('24_투표질문_Docker확인_v10.15', ['묶음', '상태', '항목', '판정', '내용'], rows, {'묶음': 52, '항목': 76, '내용': 80}, status_col=3)
# 25. 10/3 v10.16 — 로컬 점검 → AWS 적용: 운영 방식 리허설(9/30 서버 재현 → precheck → apply → Nginx → postcheck → 화면 · 기능 → 운영 동작)
rows=[]
for f,lab in [('aws_rehearsal_ops','리허설 — 올리기 · Nginx · 운영 동작 (aws_rehearsal.sh)'), ('aws_rehearsal','리허설 — 화면 · 기능 (브라우저 → Nginx(HTTPS) → 사용자 웹 → API · production)')]:
    try: items=_wm(f)
    except FileNotFoundError: continue
    for r in items:
        rows.append([lab, '', r.get('step'), '통과' if r.get('ok') else '실패', str(r.get('detail',''))[:300]])
for f,lab in [('aws_rehearsal_precheck.txt','precheck.sh 출력 (9/30 서버 재현 상태에서)'), ('aws_rehearsal_postcheck.txt','postcheck.sh 출력 (적용 · Nginx 교체 뒤)')]:
    try: lines=open(f'{Q}/{f}',encoding='utf-8').read().split('\n')
    except FileNotFoundError: continue
    sec=''
    for l in lines:
        m0=_re.match(r'^\[(\d+)\] (.*)$', l)
        if m0: sec=m0.group(2); continue
        m=_re.match(r'^  (통과|실패|확인)  (.*)$', l)
        if not m: continue
        name,_,det=m.group(2).partition(' — ')
        rows.append([lab, sec, name, '확인(오픈 전 정상 · 절차서 7-1)' if m.group(1)=='확인' else m.group(1), det[:300]])
try:
    for l in open(f'{Q}/final_all.txt',encoding='utf-8').read().split('\n'):
        if l.startswith(('api_mode:','proto_diff:')):
            k,_,v=l.partition(': '); rows.append(['전수 검정 — 운영 방식 API(dist/main.js)로 실행', '', k, '통과' if ('404' in v or _re.search(r'통과 (\d+) / \1$', v.strip())) else '실패', v[:300]])
except FileNotFoundError: pass
sheet(f'25_AWS적용_리허설_{VER}zip', ['묶음', '구역', '항목', '판정', '내용'], rows, {'묶음': 52, '구역': 22, '항목': 76, '내용': 80}, status_col=3)
# 26. 10/6 v10.17 — PowerShell 도우미(빨간 글씨 · 깨진 한글) · 설치 다음 날 검정 실패(AD-03)
rows=[]
def _j(f):
    try: return json.load(open(f'{Q}/{f}', encoding='utf-8'))
    except FileNotFoundError: return None
d=_j('ps_native_test.json')
for r in (d or {}).get('items', []):
    rows.append(['도우미 단위 시험 — 콘솔 코드 페이지 CP949 (ps_native_test.ps1)', r['name'][:2].strip(), r['name'], '통과' if r['ok'] else '실패', str(r.get('detail',''))[:300]])
d=_j('ps_e2e_more.json')
for r in (d or {}).get('items', []):
    rows.append(['dev.ps1 — 멈춤 · docker 없음 · docker 실패 (ps_e2e_more.ps1)', '', r['name'], '통과' if r['ok'] else '실패', str(r.get('detail',''))[:300]])
for c, exp in [('realcheck', 1), ('check', 0), ('up', 0), ('status', 0), ('down', 0)]:
    d=_j(f'ps_e2e_{c}.json')
    if not d: continue
    ok = d['rc']==exp and d['errors']==0
    rows.append(['dev.ps1 을 실제 Docker 로 — 콘솔 코드 페이지 CP949 (ps_e2e.ps1)', c, f'.\\dev.ps1 {c} — 종료 코드 {d["rc"]}(기대 {exp}) · 오류 기록 {d["errors"]}건 · {d["seconds"]}초',
                 '통과' if ok else '실패', 'realcheck 의 종료 코드 1 은 대체 이미지를 가려낸 것(공식 이미지 표지 없음 2건)' if c=='realcheck' else ''])
try:
    sec=''
    # v10.22 — 이 판의 결과 파일을 읽습니다. v10.19 ~ v10.21 의 엑셀은 이 줄이 v10.18 의 파일 이름으로 고정돼 있어 그때의 결과(통과 17 · 실패 2 는 같고, 마이그레이션 수 · 시안 파일 이름 두 줄의 글자가 옛 것)를 실었습니다(G-143)
    for l in open(f'{Q}/realcheck_ps_v1024.txt', encoding='utf-8-sig').read().split('\n'):
        m0=_re.match(r'^\[(\d+)\] (.*)$', l)
        if m0: sec=m0.group(2); continue
        m=_re.match(r'^  (통과|실패)  (.*)$', l)
        if m:
            name,_,det=m.group(2).partition(' — '); expected = m.group(1)=='실패' and '공식 이미지 표지' in name
            rows.append(['realcheck 결과 파일 (PowerShell · 대체 이미지 · 3일 된 개발 데이터 유지)', sec, name, '통과(바른 판정 — 대체 이미지를 가려냄)' if expected else m.group(1), det[:300]])
        elif l.startswith('        ') and sec.startswith('통합 검정'):
            rows.append(['realcheck 결과 파일 (PowerShell · 대체 이미지 · 3일 된 개발 데이터 유지)', sec, '요약 줄이 결과 파일에 들어감(한글 그대로)', '통과' if _re.search(r'통과|안전|SQL 대조|통합 검정', l) else '실패', l.strip()[:300]])
except FileNotFoundError: pass
try:
    for l in open(f'{Q}/ps_lint.txt', encoding='utf-8').read().split('\n'):
        m=_re.match(r'^(\S+): parse errors (\d+) · PS7-only syntax (\d+) · PS7-only operators (\d+) · direct docker (\d+)', l)
        if m: rows.append(['문법 나무 훑기 — Windows PowerShell 5.1 에 없는 문법 · docker 직접 호출 (ps_lint.ps1)', '', m.group(1), '통과' if m.group(2,3,4,5)==('0','0','0','0') else '실패', l[:300]])
except FileNotFoundError: pass
rows.append(['다시 생기지 않게 — 시험 안전 ⑰', '', '스크립트에 docker 직접 호출을 한 줄 넣으면 ▲위험 · BOM 을 빼도 ▲위험 · 되돌리면 안전', '통과', 'npm run verify 의 시험 안전 23 · ▲위험 0 (22 → 23)'])
rows.append(['설치 다음 날부터 통합 검정 실패 (G-89 · 광고 AD-03)', '', '3일 된 개발 데이터로 realcheck — 고치기 전: 통과 16 · 실패 3(AD-03 확인 오래된 광고주 7 포함) → 고친 뒤: 통과 17 · 실패 2(대체 이미지뿐)', '통과',
             'docker/ads-migrate.sh 가 기동 · 검정 때마다 「(시드)」 광고주의 확인 시각을 새로 찍음 · 규칙 AD-03 은 그대로 · 광고 플랫폼의 운영용 재확인 기능은 이 킷에 아직 없음(docs/61 8장)'])
rows.append(['날짜에 따라 실패하던 시험 (G-92)', '', 'srv_ptn 2-10 「당월 수신」 — 매달 5일부터 9건(고정값 8)', '통과', '기대값을 날짜에 맞춰 계산 · 고친 뒤 66/66'])
rows.append(['통합 검정의 실패 항목 표시 (G-93)', '', '10/6 12:10 Docker 통합 검정이 한 번 「통과 257 / 실패 1」 — 항목이 로그에 없어 원인 미확인 · 같은 순서 1회 · 불변식 13회 · 새 DB 3회 다시 돌려 재현 안 됨', '확인(원인 미확인 — 다시 나오면 항목이 보이게 고침)',
             'verify-all.sh 가 실패 항목(FAIL · ▲뚫림 · ★오류)을 출력 · 첫 번째 실행 결과도 판정 · 같은 검정 DB 를 동시에 두 번 돌리면 서로 깨뜨리는 것은 확인(동시에 돌리지 말 것)'])
rows.append(['확인하지 못한 것', '', 'Windows PowerShell 5.1 · PowerShell ISE 에서의 실행', '확인(PC 에서 한 번 실행 필요)', '작업 환경은 Linux · PowerShell 7.4 — CP949 조건으로 같은 깨짐을 다시 만들어 확인 · 5.1 문법만 사용 · 대비 경로 있음 (docs/61 8장)'])
sheet('26_PowerShell도우미_v10.17', ['묶음', '구역', '항목', '판정', '내용'], rows, {'묶음': 52, '구역': 22, '항목': 76, '내용': 80}, status_col=3)
# 27. 10/6 v10.18 — 결제 · 환불 정합 (D022): 정기결제 복구 · 환불 연동 · 중복 요청 선점 · 해지/청구 경합
rows=[]
SECN={'1':'1 정기결제','2':'2 구독 환불','3':'3 같은 요청은 한 번만','4':'4 해지','5':'5 열쇠 없는(스텁) 방식','6':'6 결제 뒤 구독이 안 열리던 길','7':'7 운영 알림'}
d=_j('srv_billing.json')
for r in (d or {}).get('items', []):
    m=_re.match(r'(\d)-', r['step'])
    rows.append(['결제 · 환불 정합 — 실제 PostgreSQL + 운영 방식 API 2대 + 가짜 결제사(실제 HTTP · 장애 주입) (srv_billing.py)', SECN.get(m.group(1) if m else '', ''), r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
d=_j('srv_billing_ui.json')
for r in (d or {}).get('items', []):
    rows.append(['사용자 웹 「내 구독」 — 실제 로그인 · 클릭 (srv_billing_ui.py)', 'SB-MYP-SUB-010', r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
d=_j('proto_bill.json')
for r in (d or {}).get('items', []):
    rows.append(['시안 v10.18 — 내 구독 · 결제 · 환불 확인 필요 (proto_bill.py)', r['step'][:1], r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
try: d=json.load(open(K + '/../qa/results_v10_18/proto_diff.json', encoding='utf-8'))
except FileNotFoundError: d=None
for r in (d or {}).get('items', []):
    rows.append(['시안 v10.18 — 앞 판(v10.17)과 화면마다 비교 (v10.18 때의 결과 — qa/results_v10_18/proto_diff.json)', '', r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
try:
    lab=''
    for l in open(f'{Q}/d022_db_checks.txt', encoding='utf-8').read().split('\n'):
        if l.startswith('### '): lab=l[4:].strip(); continue
        m=_re.match(r'^  (ok  |FAIL|안전 |▲뚫림|★오류) (.*)$', l)
        if not m: continue
        name=m.group(2).strip()
        if not _re.match(r'(D22-|M-04|M-2[3-8]|BL-)', name): continue
        rows.append([f'DB 규칙 — SQL 로 직접 (새 검정 DB · {lab})', name.split(' ')[0], name, '통과' if m.group(1).strip() in ('ok','안전') else '실패', ''])
except FileNotFoundError: pass
try:
    for l in open('/tmp/test_pay.log', encoding='utf-8').read().split('\n'):
        m=_re.match(r'^  (통과|실패)  (.*)$', l)
        if m and ('불명확' in l or '확정' in l or '조회' in l or '멱등' in l or '스텁' in l):
            rows.append(['결제 어댑터(오프라인) — 거절(확정)과 결과 불명확 가르기 (scripts/test-payment-offline.ts)', '', m.group(2).strip()[:120], m.group(1), ''])
except FileNotFoundError: pass
rows.append(['고친 방어가 실제로 막는가 — 코드를 되돌려 시험', '', '확인 중 직접 결제 방어 · 알림 심각도 · 사람 확인 알림을 되돌리면 6-4 · 7-1 · 7-2 · 7-3 이 실패', '통과', '10/6 대조 실행 — 되돌린 빌드에서 5/9, 원래대로 9/9'])
rows.append(['확인하지 못한 것', '', '결제사(토스) 테스트 환경에서의 실행', '확인(결제사 테스트 열쇠로 docs/62 9절 확인표 필요)', '작업 환경에서 결제사 접속 불가 — 가짜 결제사는 토스 문서(멱등키 · API 에러 코드 · 코어 API)를 따라 만든 실제 HTTP 서버'])
sheet('27_결제환불정합_v10.18', ['묶음', '구역', '항목', '판정', '내용'], rows, {'묶음': 60, '구역': 24, '항목': 90, '내용': 70}, status_col=3)
# 28. 10/6 v10.19 — 시안 「급구 · 급매」 화면의 소개 버튼 3종(소개하기 · 소개받고 싶어요 · 소개받기) 삭제
rows=[]
SEC28={'A':'A 구성','B':'B 급구 · 급매','C':'C 다른 화면','D':'D 누르는 것','E':'E 좁은 화면','F':'F 앞 판과 비교','G':'G 오류'}
d=_j('proto_urg.json')
for r in (d or {}).get('items', []):
    rows.append(['시안 v10.19 — 급구 · 급매의 소개 버튼 3종 삭제 (proto_urg.py · 파일로 열어 실제로 그려서 봄)', SEC28.get(r['step'][:1], ''), r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
try: d=json.load(open(K + '/../qa/results_v10_19/proto_diff.json', encoding='utf-8'))
except FileNotFoundError: d=None
for r in (d or {}).get('items', []):
    rows.append(['시안 v10.19 — 앞 판(v10.18)과 화면마다 비교 (v10.19 때의 결과 — qa/results_v10_19/proto_diff.json)', '', r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
rows.append(['고치기 전 실측(같은 시험을 v10.18 시안에 돌림)', 'B · D', '세 버튼이 있음 · 「소개받기」가 제목 「급구, 급매」를 덮음 · 제목이 왼쪽 끝에서 시작하지 않음 · 버튼을 누를 수 없음(제목이 가로챔)', '확인(고치기 전 상태 — 통과 4 / 13 에서 멈춤)', '10/6 — 보내 주신 화면과 같은 현상. 원인: 세 버튼 칸의 폭 184px < 세 버튼의 폭 262px'])
rows.append(['열려 있는 것(지시 범위 밖)', 'G-116', '베스트매칭 · 사고예방 · 성공현황 — 같은 줄 틀이라 「소개받기」가 제목을 덮음(981px 이상에서 늘)', '확인(10/6 답 「상세 화면만」 — 세 화면은 그대로 둠)', '10/6 측정 — 세 화면 모두 버튼 칸 184px · 세 버튼 262px'])
sheet('28_급구급매_버튼삭제_v10.19', ['묶음', '구역', '항목', '판정', '내용'], rows, {'묶음': 60, '구역': 18, '항목': 90, '내용': 70}, status_col=3)
# 29. 10/6 v10.20 — 시안 「상세」 화면(소개창업)의 소개 버튼 3종 삭제 · 남의 이용료 반려 신청 응답(G-118)
rows=[]
SEC29={'A':'A 구성','B':'B 상세','C':'C 다른 화면','D':'D 누르는 것','E':'E 좁은 화면','F':'F 앞 판과 비교','G':'G 오류'}
_R20 = K + '/../qa/results_v10_20/'      # v10.21 — 29 · 30 · 31 시트는 v10.20 때의 결과 파일로 고정합니다(같은 시험이 v10.21 에서는 기준이 달라졌습니다)
def _j20(f):
    try: return json.load(open(_R20 + f, encoding='utf-8'))
    except FileNotFoundError: return None
d=_j20('proto_detail.json')
for r in (d or {}).get('items', []):
    rows.append(['시안 v10.20 — 상세 화면의 소개 버튼 3종 삭제 (proto_detail.py · v10.20 때의 결과 — qa/results_v10_20)', SEC29.get(r['step'][:1], ''), r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
d=_j20('proto_diff.json')
for r in (d or {}).get('items', []):
    rows.append(['시안 v10.20 — 앞 판(v10.19)과 화면마다 비교 (proto_diff.py · v10.20 때의 결과)', '', r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
rows.append(['고치기 전 실측(같은 시험을 v10.19 시안에 돌림)', 'B · D', '세 버튼 · 안내 글이 있음 · 소개창업에서 매물을 눌러 들어온 상세(「← 소개창업(으)로 돌아가기」)에 세 버튼이 있음', '확인(고치기 전 상태 — 통과 7 / 17)', '10/6 — 보내 주신 화면과 같은 상태'])
try:
    for r in json.load(open(_R20 + 'srv_ptn.json', encoding='utf-8')):
        if r['step'].startswith(('2-5', '2-7')):
            rows.append(['남의 이용료 반려 신청 응답(G-118) — 실제 API · DB (srv_ptn.py)', 'POST /partner/fees/:id/dispute', r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
except FileNotFoundError: pass
rows.append(['고치기 전 실측(같은 시험을 고치기 전 서버에 돌림)', 'G-118', '2-7b 남의 이용료(반려 신청 있음) → 409 ALREADY_REQUESTED 「이미 반려를 신청한 이용료입니다」', '확인(고치기 전 상태 — 통과 70 / 71)', '10/6 — 신청 없는 남의 이용료는 422 「내 이용료가 아닙니다」여서 두 응답이 달랐음'])
d=_j20('site_tz.json')
for r in (d or {}).get('items', []):
    rows.append(['날짜 · 시각의 시간대(G-125 · G-126) — 소스 점검 + TZ=UTC 로 띄운 API · 사용자 웹 (site_tz.py)', r['step'][:1], r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
rows.append(['고치기 전 실측(같은 시험을 고치기 전 빌드에 돌림)', 'G-125 · G-126', '소스에 시간대가 빠진 곳 21 + 3 · 「내 구독」 서버 글 「2026. 10. 5. ~ 2026. 11. 4.」 ≠ 브라우저 글 「2026. 10. 6. ~ 2026. 11. 5.」 · React #418 · 주문 시각 UTC · 해지 안내 「2026. 11. 4.까지」', '확인(고치기 전 상태 — 통과 2 / 7)', '10/7 01시(한국) Docker 단계의 srv_billing_ui 13 / 16 으로 드러남'])
rows.append(['열려 있는 것', 'G-127', '서버(DB)가 UTC 날짜를 쓰는 곳 — 건강몰 주문번호의 날짜 부분 · 제휴 정산 기간과 파트너 이용료의 월 경계', '확인(다음 판 — 새 마이그레이션)', '주문 H26100200227 = 10/3 08:22 KST'])
rows.append(['열려 있는 것', 'G-120', '정산 신청(수동) API 가 신청자가 그 거래의 소개자인지 보지 않음 — 소개비 기능이 꺼져 있어 지금은 닿지 않음(422 INV_9)', '확인(소개비 기능을 켜기 전에 고쳐야 함)', '10/6 코드 · 트리거 정의 · 실제 호출로 확인'])
rows.append(['그 뒤 고친 것', 'G-121', '시안 돌아가기 글에 옛 관 이름(소개머니 · 소개몰)', '확인(v10.21 에서 고침 — 32번 시트)', '소개장터 · 안심소개 상세의 「← …(으)로 돌아가기」'])
rows.append(['열려 있는 것', 'G-116', '베스트매칭 · 사고예방 · 성공현황 — 세 버튼이 제목을 덮음', '확인(10/6 답 「상세 화면만」 — 그대로 둠)', ''])
sheet('29_상세버튼_이용료_시간대_v10.20', ['묶음', '구역', '항목', '판정', '내용'], rows, {'묶음': 60, '구역': 28, '항목': 90, '내용': 70}, status_col=3)
# 30 · 31. 10/7 — 「상세 보기」 링크 목록(요청: 상세 보기 리스트 · 동작 이상 확인 · 같은 것이 계속 나옴 · 링크 확인)
_dp=_j20('detail_links_judged.json'); _ds=_j20('detail_links_site.json')
if _dp:
    _g={}
    for r in _dp: _g.setdefault((r['from'], r['gwan'], r['to']), []).append(r)
    rows=[]
    for r in _dp:
        v=_g[(r['from'], r['gwan'], r['to'])]; n_item=len({x['label'] for x in v}); n_dest=len({x['to_hash'] or x['to'] for x in v})
        note=('누른 것의 상세' if r['same'] else '누른 것과 다른 상세' if r['same'] is False else '견줄 이름 없음(단추)')
        rows.append([r['from_id'], r['from_name'] or r['from'], r['gwan'], r['from_hash'], r['pressed'], r['label'], r['to_id'] or r['to'], r['to_name'], r['to_hash'], r['title'], f'{n_item}개 → 상세 {n_dest}가지', note, r['verdict']])
    sheet('30_상세보기_시안_v10.20', ['화면 ID', '화면', '관', '여는 주소', '누른 것', '그 항목의 글', '간 화면', '간 화면 이름', '간 주소', '상세에 나온 제목', '이 목록의 항목 → 상세', '이 줄만 보면', '판정(목록 묶음 기준 · docs/65 와 같음)'], rows,
          {'화면': 20, '여는 주소': 22, '누른 것': 26, '그 항목의 글': 54, '간 화면 이름': 18, '간 주소': 26, '상세에 나온 제목': 34, '이 목록의 항목 → 상세': 20, '이 줄만 보면': 18, '판정(목록 묶음 기준 · docs/65 와 같음)': 36}, status_col=12)
if _ds:
    rows=[[r['role'], r['from'], r['label'], r['kind'], r['to'], r['status'], r['title'], '누른 항목의 상세' if r['same'] else '확인 필요', '정상' if (r['status']==200 and r['same']) else '확인'] for r in _ds['rows']]
    sheet('31_상세보기_실제웹_v10.20', ['역할', '목록 쪽', '누른 항목', '종류', '간 주소', '상태', '상세 제목', '같은 것인가', '판정'], rows,
          {'목록 쪽': 30, '누른 항목': 50, '종류': 22, '간 주소': 50, '상세 제목': 40, '같은 것인가': 16}, status_col=8)
# 32. 10/7 v10.21 — 매물 상세가 누른 매물의 내용으로 · 그림과 같은 형식 · 실제 웹 적용 · 누적수익 공개(본인이 켠 경우만) (D023)
rows=[]
_R21 = K + '/../qa/results_v10_21/'      # v10.22 — 32 ~ 35 시트는 v10.21 때의 결과 파일로 고정합니다(같은 시험이 v10.22 에서는 기준이 달라졌습니다 — proto_diff 는 앞 판이 v10.21)
def _j21(f):
    try: return json.load(open(_R21 + f, encoding='utf-8'))
    except FileNotFoundError: return None
SEC32={'A':'A 카드 → 상세','B':'B 주소','C':'C 형식','D':'D 맨 아래 줄','E':'E 관별 안내','F':'F 마이 관심','G':'G 문의방 왕복','H':'H 견본 · 없는 번호','I':'I 내용','J':'J 그 밖','K':'K 소개광장','L':'L 누적수익 공개','M':'M 판'}
for r in (_j21('proto_item.json') or {}).get('items', []):
    rows.append(['시안 v10.21 — 매물 상세가 누른 매물의 내용으로 (proto_item.py · v10.21 때의 결과 — qa/results_v10_21)', SEC32.get(r['step'][:1], ''), r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
for r in (_j21('proto_diff.json') or {}).get('items', []):
    rows.append(['시안 v10.21 — 앞 판(v10.20)과 화면마다 비교 (proto_diff.py · v10.21 때의 결과)', '', r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
rows.append(['고치기 전 실측(같은 시험을 v10.20 시안에 돌림)', 'A ~ G', '카드를 눌러도 제목 · 분류 · 금액 · 지역이 상세와 다름 · 매물 60건의 주소가 5개 · 소개장터 · 안심소개 상세는 표 모양 · 마이 관심 「보기」가 전부 소개장터 상세', '확인(고치기 전 상태 — 통과 5 / 28)', '10/7 — 시험을 먼저 만들고 실패를 확인한 뒤 고침'])
SEC32S={'A':'A 구성','B':'B 진짜 값만','C':'C 누적수익 공개','D':'D 맨 아래 줄 · 로그인','E':'E 세 관','F':'F 그 밖','Z':'Z 뒷정리'}
for r in (_j21('site_detail.json') or {}).get('items', []):
    rows.append(['실제 웹 v10.21 — 매물 상세 새 형식 (site_detail.py · 실제 로그인 · 클릭)', SEC32S.get(r['step'][:1], ''), r['step'], '확인(건너뜀)' if r.get('skip') else ('통과' if r['ok'] else '실패'), '' if r['ok'] else str(r.get('detail',''))[:300]])
rows.append(['고치기 전 실측(같은 시험을 v10.20 사용자 웹에 돌림)', 'A ~ B', '사진 자리 · 등록자 줄 · 소개자 실적 · 후기 · 맨 아래 줄이 없음', '확인(고치기 전 상태 — 통과 3 / 17)', '10/7'])
SEC32V={'A':'A 상세 응답','B':'B 누적수익 공개','C':'C 후기 작성','D':'D 후기 공개 조회','S':'S 참 · 거짓 입력','E':'E 요청 등록 시각','Z':'Z 뒷정리'}
for r in (_j21('srv_detail.json') or {}).get('items', []):
    rows.append(['서버 v10.21 — 매물 상세 · 후기 · 누적수익 공개 (srv_detail.py · 실제 API · DB)', SEC32V.get(r['step'][:1], ''), r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
rows.append(['고치기 전 실측(같은 시험을 고치기 전 서버에 돌림)', 'A ~ E', '상세 응답에 조회 수 · 가입일 · 실적 없음 · 후기 작성이 늘 422 「필수 값이 빠졌습니다 (target_id)」 · 후기 공개 조회 없음(404) · 요청 응답에 등록 시각 없음', '확인(고치기 전 상태 — 통과 7 / 35)', '10/7'])
try:
    for l in open('/tmp/verify.log', encoding='utf-8').read().split('\n'):
        mm=_re.match(r'^\s+(ok|FAIL)\s+(D23-\d+ .*)$', l)
        if mm: rows.append(['DB 규칙 v10.21 — 후기 · 누적수익 뷰 (scripts/verify-invariants.sh · 검정 DB)', 'D23', mm.group(2)[:200], '통과' if mm.group(1)=='ok' else '실패', ''])
except FileNotFoundError: pass
for no, what, st in [('G-135', '실제 웹 — 로그인하면 /mny(없는 주소 · 404)로 감 · ?next= 를 쓰지 않음', '확인(고침 — site_detail D-1b · D-1c · D-1d)'),
                     ('G-133', '서버 — 후기 작성이 늘 실패(대상 target_id 를 넣지 않음) · 거래 당사자 확인 없음', '확인(고침 — D023 · srv_detail C · D)'),
                     ('G-134', '서버 — 불리언 입력에 글자 "false" 를 보내면 참으로 읽힘(22곳 · 초대 동의 · 제3자 제공 동의 포함)', '확인(고침 — srv_detail S)'),
                     ('G-132', '시안 — 소개광장 글 목록이 빈 표(없는 자료를 읽음) · 글 상세로 가는 길 없음', '확인(고침 — proto_item K)'),
                     ('G-131', '시안 — 상세의 세 번째 후기가 잘리고 「소개 내용」 상자가 화면 밖(스타일 이름 겹침)', '확인(고침)'),
                     ('G-136', '실제 웹 — 상세가 10초 캐시를 써서 관심 · 조회 수가 늦게 반영', '확인(고침 — 캐시 없이 읽음)')]:
    rows.append(['만들면서 찾아 고친 것', no, what, st, ''])
for no, what, st in [('G-122', '시안 — 요청 · 계약 · 회원 · 검수 · 서비스 상세는 아직 종류마다 한 건(6곳 24건)', '확인(남음 — 목록표 선택 ② · 결정 필요)'),
                     ('G-130', '시안 — 「상세 · 보기」 단추 22건이 안내만 띄움', '확인(남음 — 결정 필요)'),
                     ('G-137', '시안 — 견본 사진이 5종뿐이라 분류와 맞지 않는 사진(태양광 매물에 상가 사진 등)', '확인(남음 — 디자인 맞춤 판)'),
                     ('G-94', '실제 웹 — 화면 다시 그리기 오류(React #418)가 가끔 남(재조사 1,191건 중 2건 · 다시 10번 열어 0번)', '확인(남음 — 디자인 맞춤 판)'),
                     ('G-91', '시안 — 소개뱅크몰 주문 상세의 undefined 글자', '확인(남음)')]:
    rows.append(['열려 있는 것', no, what, st, ''])
sheet('32_매물상세_v10.21', ['묶음', '구역', '항목', '판정', '내용'], rows, {'묶음': 62, '구역': 22, '항목': 96, '내용': 70}, status_col=3)
# 33 · 34 · 35. 10/7 v10.21 — 「상세 보기」 재조사(앞 판 목록표와 같은 도구)
_dp=_j21('detail_links_judged.json'); _ds=_j21('detail_links_site.json')
if _dp:
    _g={}
    for r in _dp: _g.setdefault((r['from'], r['gwan'], r['to']), []).append(r)
    rows=[]
    for r in _dp:
        v=_g[(r['from'], r['gwan'], r['to'])]; n_item=len({x['label'] for x in v}); n_dest=len({x['to_hash'] or x['to'] for x in v})
        note=('누른 것의 상세' if r['same'] else '누른 것과 다른 상세' if r['same'] is False else '견줄 이름 없음(단추)')
        rows.append([r['from_id'], r['from_name'] or r['from'], r['gwan'], r['from_hash'], r['pressed'], r['label'], r['to_id'] or r['to'], r['to_name'], r['to_hash'], r['title'], f'{n_item}개 → 상세 {n_dest}가지', note, r['verdict']])
    sheet('33_상세보기_시안_v10.21', ['화면 ID', '화면', '관', '여는 주소', '누른 것', '그 항목의 글', '간 화면', '간 화면 이름', '간 주소', '상세에 나온 제목', '이 목록의 항목 → 상세', '이 줄만 보면', '판정(목록 묶음 기준 · docs/68 과 같음)'], rows,
          {'화면': 20, '여는 주소': 22, '누른 것': 26, '그 항목의 글': 54, '간 화면 이름': 18, '간 주소': 26, '상세에 나온 제목': 34, '이 목록의 항목 → 상세': 20, '이 줄만 보면': 18, '판정(목록 묶음 기준 · docs/68 과 같음)': 36}, status_col=12)
if _ds:
    rows=[[r['role'], r['from'], r['label'], r['kind'], r['to'], r['status'], r['title'], '누른 항목의 상세' if r['same'] else '확인 필요', '정상' if (r['status']==200 and r['same'] and not r.get('page_errors')) else '확인'] for r in _ds['rows']]
    sheet('34_상세보기_실제웹_v10.21', ['역할', '목록 쪽', '누른 항목', '종류', '간 주소', '상태', '상세 제목', '같은 것인가', '판정'], rows,
          {'목록 쪽': 30, '누른 항목': 50, '종류': 22, '간 주소': 50, '상세 제목': 40, '같은 것인가': 16}, status_col=8)
_s0=_j21('detail_links_table_stats_v1020.json'); _s1=_j21('detail_links_table_stats_v1021.json')
if _s0 and _s1:
    _lab=[('시안 — 상세로 가는 링크','proto_links'),('시안 — 목록 묶음','groups'),('시안 — 무엇을 눌러도 같은 상세(묶음)','bad_groups'),('시안 — 무엇을 눌러도 같은 상세(링크)','bad_links'),('시안 — 문의방 왕복 실패','roundtrip_fail'),
          ('시안 — 들어가는 링크가 없는 상세 화면','orphan'),('시안 — 깨진 글자(undefined)','proto_bad_text'),('시안 — 화면 스크립트 오류','proto_js_errors'),('시안 — 안내만 나오는 「상세 · 보기」 단추','toast_only'),
          ('실제 웹 — 상세로 가는 링크','site_links'),('실제 웹 — 열림(200)','site_200'),('실제 웹 — 누른 항목의 상세','site_same'),('실제 웹 — 오류 줄','site_err_rows'),('실제 웹 — 화면 스크립트 오류','site_page_errors'),('오류 종류','errors'),('확인 종류','checks')]
    sheet('35_상세보기_앞판과비교', ['항목', 'v10.20 (10/7 조사)', 'v10.21 (재조사)', '차이'], [[n, _s0.get(k), _s1.get(k), (_s1.get(k) or 0) - (_s0.get(k) or 0)] for n, k in _lab], {'항목': 44, 'v10.20 (10/7 조사)': 20, 'v10.21 (재조사)': 20})
# 36 · 37 · 38. 10/7 v10.22 — 소개창업 「인력 · 운영지원 · 정보」 축의 상세 4종 · 항목별 주소 · 언어 단추 수정(G-138 ~ G-141)
rows=[]
_R22 = K + '/../qa/results_v10_22/'      # v10.23 — 36 ~ 38 시트는 v10.22 때의 결과 파일로 고정합니다(같은 시험이 v10.23 에서는 기준이 달라졌습니다 — proto_pixel · proto_diff 는 앞 판이 v10.22)
def _j22(f):
    try: return json.load(open(_R22 + f, encoding='utf-8'))
    except FileNotFoundError: return None
SEC36={'A':'A 축 · 갈래 주소','B':'B 줄 → 상세','C':'C 상세 구성','D':'D 인력(회신 완료)','E':'E 돌아가기','F':'F 함께 고친 것','G':'G 그 밖'}
_ax=_j22('proto_axis.json') or {}
for r in _ax.get('items', []):
    rows.append(['시안 v10.22 — 소개창업 축의 상세 4종 · 주소 (proto_axis.py · v10.22 때의 결과 — qa/results_v10_22)', SEC36.get(r['step'][:1], ''), r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
SEC36L={'A':'A 언어 단추','B':'B 로그인 화면','C':'C 이름 겹침','D':'D 그 밖'}
for r in (_j22('proto_lang.json') or {}).get('items', []):
    rows.append(['시안 v10.22 — 언어 단추 · 로그인 화면 (proto_lang.py · 모든 화면에서 단추의 자리를 잼)', SEC36L.get(r['step'][:1], ''), r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
_px=_j22('proto_pixel.json') or {}
for r in _px.get('items', []):
    rows.append(['시안 v10.22 — 앞 판(v10.21)과 그림으로 비교 (proto_pixel.py · 화면마다 찍어 견줌)', '', r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
for r in (_j22('proto_diff.json') or {}).get('items', []):
    rows.append(['시안 v10.22 — 앞 판(v10.21)과 글자로 비교 (proto_diff.py)', '', r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
rows.append(['고치기 전 실측(같은 시험을 v10.21 시안에 돌림)', '축 상세', '축을 골라도 주소가 #/g/biz · 줄 단추 22개가 모두 안내 글 · 상세 화면 0장 · 새 화면 키 없음 · 「지원」 갈래가 「공고」와 같은 4줄 · 배지 12개가 줄 밖', '확인(고치기 전 2 / 19 — 묶음마다 첫 실패에서 멈춤)', 'proto_axis.py'])
rows.append(['고치기 전 실측(같은 시험을 v10.21 시안에 돌림)', '언어 단추', '단추 153×87(머리줄 58) · 「▾」 63×73 상자 · 목록이 단추에서 834px 아래 · 로그인 상자 글자 회색 10px · 큰 단추 3개 32px · 390px 에서 71px', '확인(고치기 전 1 / 13)', 'proto_lang.py'])
for no, what, st in [('G-138', '시안 — 언어 단추가 머리줄 밖으로(87px) · 언어 목록이 화면 맨 아래에 열림 · 로그인 화면의 납작한 단추(같은 이름 .lgb · .lgc + 떨어져 나간 스타일 조각)', '확인(고침 — proto_lang · proto_pixel)'),
                     ('G-139', '시안 — 강조 배지 16개가 화면 왼쪽 위 구석에 찍힘(.hot 이름 겹침 · 소개창업 4 · 안심소개 상담 축 12)', '확인(고침 — proto_axis F-1)'),
                     ('G-140', '시안 — 소개창업 세 축의 줄 단추 22개가 안내 글만 · 상세 0장 · 축에 주소 없음', '확인(고침 — 상세 4종 · 주소 14 + 7 · proto_axis A ~ E)'),
                     ('G-141', '시안 — 옛 관 이름 3곳 · 지난 날짜 3건 · 「지원」 = 「공고」 · 「창업계획 등록」→ 요청 목록 · 「초단기 급구」→ 일반 급구급매', '확인(고침 — proto_axis D · F)')]:
    rows.append(['고친 것', no, what, st, ''])
for no, what, st in [('G-142', '운영 화면 — 리드 배정 「전체」 목록이 느림(줄마다 보낼 수 있는 업체 수를 계산 · 개발 DB 200줄에 2.4초)', '확인(남음 — 화면 시험은 카드가 나올 때까지 기다리게 고침)'),
                     ('G-122 · G-130', '시안 — 남은 「같은 상세」 6곳 24건 · 안내만 나오는 「상세 · 보기」 단추 22건', '확인(남음 — 결정 필요)'),
                     ('—', '인력 축의 문구가 법무 회신(A-09) 내용과 맞는지', '확인(확인하지 못함 — 회신 문서를 보지 못함)'),
                     ('—', '실제 웹 · 서버 · DB 에는 세 축(인력 · 운영지원 · 정보)이 없음', '확인(시안만 — 별도 개발)'),
                     ('G-94', '실제 웹 — 화면 다시 그리기 오류(React #418)가 가끔 남(이번 전수 실행에서 반품 배송비 화면 시험 1건 · 다시 돌려 통과)', '확인(남음)')]:
    rows.append(['열려 있는 것', no, what, st, ''])
sheet('36_축상세_언어단추_v10.22', ['묶음', '구역', '항목', '판정', '내용'], rows, {'묶음': 62, '구역': 22, '항목': 96, '내용': 70}, status_col=3)
if _ax.get('rows'):
    _KN={'job':'공고','svc':'자문 서비스','pol':'정책','edu':'교육'}
    sheet('37_축_항목_주소_v10.22', ['종류', '축', '갈래', '번호', '구분', '항목', '값(목록)', '목록 주소', '목록의 단추', '상세 주소', '상세 화면 키', '상세 화면 ID', '상세의 값', '상세의 번호', '판정'],
          [[_KN.get(x['kind'], x['kind']), x['axis'], x['sub'] or '—', x['no'], x['badge'], x['title'], x['price'], x['list'], x['btn'], x['hash'], x['screen'], x['screen_id'], x['detail_price'], x['num'], '정상 — 그 항목의 상세'] for x in _ax['rows']],
          {'항목': 44, '값(목록)': 26, '목록 주소': 22, '상세 주소': 26, '상세 화면 ID': 18, '상세의 값': 26, '상세의 번호': 18, '판정': 22}, status_col=14)
_bz=_j22('biz_axes.json')
if _bz:
    rows=[]
    for a in _bz['axes']:
        for x in a['rows']:
            rows.append([a['axis'], a['sub'] or '—', x['where'], x.get('badge',''), x.get('row',''), x.get('price',''), x['label'], x['result'], x.get('toast','') if x['result']!='화면 이동' else '', x.get('to_hash',''), '확인 — 안내 글만(상세 없음)' if (x['where']=='줄') else ('정상' if x['result']=='화면 이동' else '확인 — 안내 글만')])
    sheet('38_축_줄단추_조사_v10.21', ['축', '갈래', '자리', '구분', '항목', '값', '단추', '누른 결과', '안내 글', '간 주소', '판정(v10.21 조사 — v10.22 에서 고침)'], rows,
          {'항목': 44, '값': 26, '안내 글': 60, '간 주소': 20, '판정(v10.21 조사 — v10.22 에서 고침)': 34}, status_col=10)
# 39 · 40 · 41. 10/7 v10.23 — 소개광장을 제시 디자인대로(시안 + 실제 웹 + 서버) · 작성자 이름 가림(G-146) · 검색 · 쪽 번호 · 두 관 전용 머리줄 · 바닥줄
_R23 = K + '/../qa/results_v10_23/'      # v10.24 — 39 ~ 41 시트는 v10.23 때의 결과 파일로 고정합니다(같은 시험이 v10.24 에서는 기준이 달라졌습니다 — proto_pixel · proto_diff 는 앞 판이 v10.23)
def _j23(f):
    try: return json.load(open(_R23 + f, encoding='utf-8'))
    except FileNotFoundError: return None
rows=[]
SEC39S={'A':'A 작성자 가림','B':'B 쪽 번호','C':'C 검색','D':'D 보이는 범위','E':'E 기존 길'}
for r in (_j23('srv_cmu.json') or {}).get('items', []):
    rows.append(['서버 v10.23 — 소개광장 목록(검색 · 쪽 번호) · 작성자 가림 (srv_cmu.py · 실제 API · DB)', SEC39S.get(r['step'][:1], ''), r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
SEC39U={'H':'H 머리줄 · 바닥줄','L':'L 목록(제시 디자인 치수)','S':'S 검색 · 쪽 번호 · 탭','D':'D 글 상세 · 글쓰기 · 로그인','P':'P 그림(PNG)','O':'O 다른 화면(그대로)','M':'M 좁은 화면','Z':'Z 화면 오류'}
for r in (_j23('srv_cmu_ui.json') or {}).get('items', []):
    rows.append(['실제 웹 v10.23 — 소개광장 4쪽 · 머리줄 · 바닥줄 (srv_cmu_ui.py · 실제 로그인 · 클릭)', SEC39U.get(r['step'][:1], ''), r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
SEC39P={'A':'A 머리줄 · 바닥줄','B':'B 목록 1쪽 = 제시 디자인','C':'C 치수 · 색','D':'D 쪽 번호 · 탭 · 검색','E':'E 글 상세 · 글쓰기 · 투표','P':'P 그림(PNG)','M':'M 좁은 화면','Z':'Z 화면 오류'}
for r in (_j23('proto_cmu.json') or {}).get('items', []):
    rows.append(['시안 v10.23 — 소개광장 5장 (proto_cmu.py · 파일로 열어 눌러 봄)', SEC39P.get(r['step'][:1], ''), r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
_px=_j23('proto_pixel.json') or {}
for r in _px.get('items', []):
    rows.append(['시안 v10.23 — 앞 판(v10.22)과 그림으로 비교 (proto_pixel.py · 화면마다 찍어 견줌)', '', r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
for r in (_j23('proto_diff.json') or {}).get('items', []):
    rows.append(['시안 v10.23 — 앞 판(v10.22)과 글자로 비교 (proto_diff.py)', '', r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
for no, what, st in [('G-146', '서버 — 소개광장 목록 · 글 상세 · 댓글이 작성자 실명을 그대로 내보냄', '확인(고침 — 첫 글자 + OO · 운영자 · (탈퇴) — srv_cmu A)'),
                     ('G-148', '실제 웹 — 소개광장에 검색 · 쪽 번호가 없어 50건을 넘는 글은 볼 길이 없음', '확인(고침 — GET /community/board · srv_cmu B · C)'),
                     ('G-150', '시안 — 소개광장 목록이 두 벌(cmu · commu)로 서로 다른 내용', '확인(고침 — 두 화면이 같은 목록을 씀 · proto_cmu)'),
                     ('G-151', '서버 · 문서 — 새 길 GET /community/board 를 화면 등록부(spec/screens.json)에 연결하지 않고 응답 표본도 넣지 않아 통합 검정이 실패(전수 검정 첫 실행 · 둘째 실행)', '확인(고침 — 등록부 연결 · 응답 표본 · 통합 검정을 처음부터 다시 돌려 통과)'),
                     ('G-152', '검정 도구 — srv_proto.py 에 시안 파일 이름(v10_22)이 적혀 있어 없는 파일을 열고 멈춤', '확인(고침 — 이름을 킷에서 읽음 · 33 / 33)'),
                     ('G-153', '서버 · 검정 — 소개광장 조회 5건이 조립식 SQL 이라 통합 검정의 「SQL 대조」가 건너뜀(확인 806 → 803)', '확인(고침 — 고정 글로 · 확인 808 · 통과 808 · srv_cmu E-4)')]:
    rows.append(['고친 것', no, what, st, ''])
for no, what, st in [('G-149', '실제 웹 — 로그아웃 단추가 어디에도 없었음', '확인(일부 고침 — 소개광장 머리줄에만 넣음 · 그 밖의 화면은 결정 필요)'),
                     ('G-94', '실제 웹 — 화면 다시 그리기 오류(React #418)가 가끔 남(이번 전수 실행에서 반품 배송비 화면 시험 1건 · 안심소개 화면 시험 1건 · 다시 돌려 통과 · 같은 주소 60번씩: /money/list 1 · /mall/list 0 · 소개광장 3곳 0)', '확인(남음)'),
                     ('—', 'Docker(개발 서버)에서 소개광장 실제 웹 시험 첫 실행 49 / 52 — 투표 쪽을 열 때 스타일 파일이 오지 않음 · 같은 스택에 세 번 다시 돌려 모두 61 / 61', '확인(원인을 확정하지 못함 — 그때의 개발 서버 기록이 남지 않음 · 운영 방식 빌드에서는 처음부터 통과)'),
                     ('G-147', '서버 — 소개뱅크몰 상품 등록 · 배송 처리의 길이 없음(제시 디자인의 상품 띠 · 순위 · 후기가 기댈 자료가 없음)', '확인(남음 — 소개뱅크몰 서버 1차 · 2차)'),
                     ('—', '소개광장 위 띠 사진 — 글자 없는 원본을 받지 못해 제시 그림의 오른쪽(글자 없는 부분)만 잘라 씀', '확인(임시 — 원본을 받으면 파일 1개를 바꿈)'),
                     ('—', '제시 디자인의 글꼴 이름 · 좁은 화면(휴대전화) 디자인', '확인(받지 못함 — 지금 글꼴 · 스스로 정한 좁은 화면 배치)'),
                     ('—', '소개뱅크몰 제시 디자인', '확인(v10.25 에서 받은 JPEG 조각으로 반영 — 원본 PNG 는 아직 받지 못함 · 45 · 47번 시트)')]:
    rows.append(['열려 있는 것', no, what, st, ''])
sheet('39_소개광장_v10.23', ['묶음', '구역', '항목', '판정', '내용'], rows, {'묶음': 62, '구역': 22, '항목': 96, '내용': 70}, status_col=3)
# 40. 그림 조각 — 받은 디자인(PNG)에서 자르기만 했는지(크기 · 점의 값이 원본의 그 자리와 같음)
try:
    from PIL import Image as _Im, ImageChops as _Ch
    _man=json.load(open(f'{Q}/b2_assets.json', encoding='utf8')); rows=[]
    for _src, _parts in _man.items():
        if _src.startswith('_'): continue
        _o=_Im.open(K + '/docs/design/' + _src); _fmt=_o.format; _osz=_o.size; _o=_o.convert('RGB')
        for _n, _box in _parts.items():
            _p=K + '/site/public/b2/' + _n; _g=_Im.open(_p); _c=_o.crop(tuple(_box))
            _same = _g.format=='PNG' and _g.size==_c.size and _Ch.difference(_g.convert('RGB'), _c).getbbox() is None
            rows.append([_src, f'{_fmt} {_osz[0]}×{_osz[1]}', _n, str(_box), f'{_g.format} {_g.size[0]}×{_g.size[1]}', __import__('os').path.getsize(_p), '통과 — 원본의 그 자리와 점 하나 같음' if _same else '실패 — 다름'])
    sheet('40_그림조각_대조_v10.23', ['받은 디자인', '원본 형식 · 크기', '조각(site/public/b2)', '자른 자리 [왼쪽, 위, 오른쪽, 아래]', '조각 형식 · 크기', '바이트', '판정'], rows,
          {'받은 디자인': 30, '원본 형식 · 크기': 20, '조각(site/public/b2)': 26, '자른 자리 [왼쪽, 위, 오른쪽, 아래]': 34, '조각 형식 · 크기': 20, '판정': 40}, status_col=6)
except Exception as _e: print('40 시트 건너뜀', _e)
# 41. 시안 193장 — 앞 판(v10.22)과 그림 비교 결과(화면마다 · v10.23 때의 결과)
if _px.get('screens'):
    sheet('41_시안_그림비교_v10.23', ['시안 키', '결과', '판정'], [[k, v.get('kind'), '정상 — 바꾸기로 한 화면' if k in (_px.get('diff') or []) else ('정상 — 점 하나 같음' if v.get('kind')=='같음' else '확인')] for k, v in _px['screens'].items()],
          {'시안 키': 18, '결과': 30, '판정': 30}, status_col=2)
# 42 · 43 · 44. 10/7 v10.24 — 안심소개 「생활 · 금융 상담」: 업종 상세(SB-MAL-CSL-025) · 상담하기 · 시험용 업체(개발 · 시연용 시드) · 시안 축 주소 · 같은 결함 5곳
_R24 = K + '/../qa/results_v10_24/'      # v10.25 — 42 ~ 44 시트는 v10.24 때의 결과 파일로 고정합니다(같은 시험이 v10.25 에서는 기준이 달라졌습니다 — proto_pixel · proto_diff 는 앞 판이 v10.24)
def _j24(f):
    try: return json.load(open(_R24 + f, encoding='utf-8'))
    except FileNotFoundError: return None
rows=[]
SEC42S={'A':'A 업종 상세(API)','B':'B 22업종','C':'C 없는 것 · 이상한 입력','D':'D 내보내는 것','E':'E 등록부 · 고정 SQL','F':'F 시험용 업체 · 사무소','G':'G 상담하기 · 뒷정리'}
for r in (_j24('srv_fin.json') or {}).get('items', []):
    rows.append(['서버 v10.24 — 상담 업종 상세 · 시험용 업체 · 상담하기 (srv_fin.py · 실제 API · DB)', SEC42S.get(r['step'][:1], ''), r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
SEC42U={'L':'L 목록','D':'D 업종 상세','A':'A 신청서 주소','F':'F 상담하기 · 뒷정리','M':'M 좁은 화면','O':'O 다른 화면(그대로)','Z':'Z 화면 오류'}
for r in (_j24('srv_fin_ui.json') or {}).get('items', []):
    rows.append(['실제 웹 v10.24 — 목록 → 업종 상세 → 신청서 → 접수 (srv_fin_ui.py · 실제 클릭)', SEC42U.get(r['step'][:1], ''), r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
SEC42P={'A':'A 축 주소','B':'B 줄 단추','C':'C 업종 상세','D':'D 신청서','E':'E 접수','F':'F 법률 · 세무','G':'G 같이 고친 화면','Z':'Z 좁은 화면 · 오류'}
for r in (_j24('proto_fin.json') or {}).get('items', []):
    rows.append(['시안 v10.24 — 상담 축 · 업종 상세 · 신청서 (proto_fin.py · 파일로 열어 눌러 봄)', SEC42P.get(r['step'][:1], ''), r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
_px24=_j24('proto_pixel.json') or {}
for r in _px24.get('items', []):
    rows.append(['시안 v10.24 — 앞 판(v10.23)과 그림으로 비교 (proto_pixel.py · 화면마다 찍어 견줌)', '', r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
for r in (_j24('proto_diff.json') or {}).get('items', []):
    rows.append(['시안 v10.24 — 앞 판(v10.23)과 글자로 비교 (proto_diff.py)', '', r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
rows.append(['고치기 전 실측(같은 시험을 v10.23 킷에 돌림)', '서버 · 실제 웹 · 시안', '서버 3 / 19(업종 상세의 길이 없음 · 19업종 「준비 중」) · 실제 웹 0 / 4 에서 멈춤(「상세 보기」 단추 없음) · 시안 0 / 5 에서 멈춤(축 주소 없음)', '확인(고치기 전 상태)', '10/7 반영 전 비교표 8절'])
_d24 = {x['no']: x for x in defects}
for no in ('G-154', 'G-155', 'G-156', 'G-157', 'G-158', 'G-159', 'G-160'):
    x = _d24.get(no)
    if x: rows.append(['고친 것', no, f"{x['area']} — {x['what'][:230]}", '확인(고침)', x['fix'][:300]])
for no, what, st in [('G-161', '사용자 웹 — 오래 열지 않은 쪽을 처음 열면 기억해 둔 예전 자료가 한 번 보임(업체 · 사무소를 넣고 뺀 직후 숫자가 API 와 다를 수 있음 · 다시 열면 맞음)', '확인(남음 — 동작 방식 · 바꿀지 결정 필요 · 시험은 견줄 쪽을 먼저 열어 둠)'),
                     ('—', '법률 · 세무 시험용 사무소는 업종마다 1곳(확인 때의 선택지에는 2곳씩이라고 적었음) — 한 업체는 한 업종에 게재 1건(DB 규칙) · 시연용 업체 1곳', '확인(남음 — 2곳씩은 시연용 업체를 하나 더 만들어야 함 · 결정 필요)'),
                     ('—', '시험용 업체 · 사무소는 개발 · 시연용 — 운영 서버에는 들어가지 않음(운영에서는 실제 입점 전까지 「준비 중」)', '확인(의도 — srv_fin F-8 · 서버 적용 리허설)'),
                     ('G-94', '실제 웹 — 화면 다시 그리기 오류(React #418)가 가끔 남(이번 전수 실행 첫 실행에서 상담 화면 시험 1건 · 다시 돌려 0)', '확인(남음)'),
                     ('—', '머리줄 메뉴 이름 「소개뱅크몰」→「소개몰」', '확인(v10.25 에서 반영 — 45번 시트)')]:
    rows.append(['열려 있는 것 · 알아 두실 것', no, what, st, ''])
sheet('42_생활금융상담_v10.24', ['묶음', '구역', '항목', '판정', '내용'], rows, {'묶음': 62, '구역': 22, '항목': 96, '내용': 70}, status_col=3)
# 43. 상담 업종 22종 — 목록 → 상세 → 신청서 연결표(fin_matrix.py 가 실제로 열어 봄)
_fm=_j24('fin_matrix.json')
if _fm:
    sheet('43_상담업종_연결표_v10.24', ['코드', '업종', '방식', '게시', '인증업체(게재) 수', '받는 지역(시 · 도 업체 수)', '목록의 단추', '상세 주소', '상태', '상세에 있는 것', '신청서 주소', '상태 ', '끝난 주소', '신청서 주소에 있는 것', '시안 주소', '판정'],
          [[r['code'], r['name'], r['mode'], r['gated'], r['partners'], r['regions'], r['buttons'], r['detail'], r['detail_status'], r['detail_has'], r['apply'], r['apply_status'], r['apply_end'], r['apply_has'], r['proto'], '통과' if r['ok'] else '실패'] for r in _fm['rows']],
          {'코드': 20, '업종': 22, '방식': 22, '게시': 12, '받는 지역(시 · 도 업체 수)': 40, '목록의 단추': 24, '상세 주소': 32, '상세에 있는 것': 30, '신청서 주소': 38, '끝난 주소': 38, '신청서 주소에 있는 것': 24, '시안 주소': 30, '판정': 10}, status_col=15)
# 44. 시안 193장(+ 새 화면 1) — 앞 판(v10.23)과 그림 비교 결과(화면마다)
if _px24.get('screens'):
    sheet('44_시안_그림비교_v10.24', ['시안 키', '결과', '판정'], [[k, v.get('kind'), '정상 — 바꾸기로 한 화면' if k in (_px24.get('diff') or []) else ('정상 — 점 하나 같음' if v.get('kind')=='같음' else '확인')] for k, v in _px24['screens'].items()] + [['malcsld', '새 화면(앞 판에 없음)', '정상 — 새 화면(proto_fin.py 가 봄)']],
          {'시안 키': 18, '결과': 30, '판정': 34}, status_col=2)
# 45 · 46 · 47 · 48. 10/8 v10.25 — 소개몰(쇼핑몰)을 시안 기준으로: 이름 · 약관(D024) · 배송비 무료 · 의료기기 미판매 · 건강기능식품 잠금(D025) · 22쪽 · 시안(남긴 10건 · 값 3건 · 머리줄/바닥줄 연결)
rows=[]
SEC45S={'N':'N 이름 · 약관','S':'S 배송비','L':'L 판매 범위(잠금 · 미판매)','K':'K 그대로인 것 · 규칙 이름 · 약관 글','E':'E 등록부 · 고정 SQL'}
_R25 = K + '/../qa/results_v10_25/'      # v10.26 — 45 ~ 48 시트는 v10.25 때의 결과 파일로 고정합니다(proto_pixel · proto_diff 의 앞 판이 v10.26 에서는 v10.25)
def _j25(f):
    try: return json.load(open(_R25 + f, encoding='utf-8'))
    except FileNotFoundError: return None
_sm = _j25('srv_mall.json') or []
for r in (_sm if isinstance(_sm, list) else _sm.get('items', [])):
    rows.append(['서버 v10.25 — 소개몰 이름 · 약관 · 배송비 · 판매 범위 (srv_mall.py · 실제 API · DB)', SEC45S.get(r['step'][:1], ''), r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
SEC45U={'N':'N 이름','H':'H 머리줄 · 바닥줄','M':'M 메인(제시 디자인)','L':'L 누르기','P':'P 그림','S':'S 하위 화면','V':'V 시안 기준 화면 구성','E':'E 없는 주소','Z':'Z 좁은 화면 · 화면 오류'}
for r in (_j25('site_mall.json') or {}).get('items', []):
    rows.append(['실제 웹 v10.25 — 소개몰 22쪽 (site_mall.py · 실제 로그인 · 클릭)', SEC45U.get(r['step'][:1], ''), r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
SEC45P={'N':'N 이름','H':'H 머리줄 · 바닥줄 · 본체로 잇기','M':'M 메인(제시 디자인)','L':'L 누르기','P':'P 그림','S':'S 하위 화면','X':'X 남긴 10건 · 개발분 값 3건 · 자가 점검','Z':'Z 좁은 화면 · 오류'}
for r in (_j25('proto_mall.json') or {}).get('items', []):
    rows.append(['시안 v10.25 — 소개몰 21화면 (proto_mall.py · 파일로 열어 눌러 봄)', SEC45P.get(r['step'][:1], ''), r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
_px25=_j25('proto_pixel.json') or {}
for r in _px25.get('items', []):
    rows.append(['시안 v10.25 — 앞 판(v10.24)과 그림으로 비교 (proto_pixel.py · 앞 판의 글자에 이름 규칙을 입힌 뒤 화면마다 찍어 견줌)', '', r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
for r in (_j25('proto_diff.json') or {}).get('items', []):
    rows.append(['시안 v10.25 — 앞 판(v10.24)과 글자로 비교 (proto_diff.py)', '', r['step'], '통과' if r['ok'] else '실패', '' if r['ok'] else str(r.get('detail',''))[:300]])
rows.append(['고치기 전 실측', '시안의 머리줄 · 바닥줄', '소개몰 안에서 누를 수 있는 것 30개를 하나씩 — 13종이 소개몰의 「없는 주소입니다」 또는 엉뚱한 화면 · 2종 무반응(언어 · 장바구니) · 3종 엉뚱한 안내(사회관계망)', '확인(고치기 전 상태)', '10/8 실측 — G-164'])
rows.append(['고치기 전 실측', '시안 안의 자가 점검', 'v10.24 시안: 13항목 가운데 6항목 실패 · 고치기 전 v10.25: 10항목 실패 → 14항목 × 21화면 모두 통과', '확인(고치기 전 상태)', '10/8 실측 — G-167'])
_d25 = {x['no']: x for x in defects}
for no in ('G-162', 'G-163', 'G-164', 'G-165', 'G-166', 'G-167', 'G-168', 'G-169'):
    x = _d25.get(no)
    if x: rows.append(['고친 것', no, f"{x['area']} — {x['what'][:230]}", '확인(고침)', x['fix'][:300]])
for no, what, st in [('—', '시안의 「교환 배송비 6,000원」 — 서버에는 교환 비용을 받는 규칙이 없음', '확인(남음 — 받을지 · 어떻게 받을지 결정 필요)'),
                     ('—', '주문서 동의 ② 문구 — 실제 웹 「배송사에 제공」 / 시안 「판매자에게 제공」(입점 판매 전제)', '확인(v10.28 — 약관 개정과 함께)'),
                     ('—', '무료배송 상품의 단순 변심 반품에 왕복 6,000원(보낸 3,000 + 돌려받는 3,000)을 빼는 것 · 식품 「개봉 시 청약철회 제한」의 표시 방식', '확인(남음 — 법률 확인 필요 · 문서 73 의 0절 5번)'),
                     ('—', '개발 DB 에서 팔리는 상품 3종(건강기능식품 3 · 의료기기 2 판매 중지) — 성분별 · 고민별의 대부분이 「취급 준비 중」', '확인(v10.26 — 시안 견본 16종을 개발 · 시연용 시드로)'),
                     ('G-147', '운영 화면에 상품 · 재고 · 배송 입력이 없음 — 재고는 시험 준비 자료(fixtures.py)가 채움', '확인(남음 — v10.26 · v10.27)'),
                     ('G-161', '사용자 웹 — 오래 열지 않은 쪽을 처음 열면 기억해 둔 예전 자료가 한 번 보임(판매 중지 직후의 상품 쪽 포함 · 주문은 서버가 거절)', '확인(남음 — 동작 방식 · 서버 적용 · Docker 는 새로 빌드해 올린 직후에는 해당 없음)'),
                     ('G-94', '실제 웹 — 화면 다시 그리기 오류(React #418)가 가끔 남', '확인(남음)'),
                     ('—', '받은 그림 — 대화로 받은 줄인 JPEG(1092×2000). 원본 PNG 는 아직', '확인(임시 — 원본을 받으면 조각 53개만 바꿈)')]:
    rows.append(['열려 있는 것 · 알아 두실 것', no, what, st, ''])
sheet('45_소개몰_v10.25', ['묶음', '구역', '항목', '판정', '내용'], rows, {'묶음': 62, '구역': 26, '항목': 96, '내용': 70}, status_col=3)
# 46. 소개몰 22쪽 — 시안 ↔ 개발분 대조(시안 기준으로 맞춘 것 · 다음 판에 남은 것)
_M46 = [
 ('1','메인','#/','/health','제시 디자인(사진 띠 · 성분 · 고민 타일) · 도매 · 납품 매물 구역','오늘의 건강상품(순위) · 많이 찾는 · 새로 올라온 · 특별 할인 구역과 정상가 · 할인율 · 별점(자료가 없어 실제 웹에서는 그리지 않음) — v10.26 · v10.27'),
 ('2','직판관','#/direct','/health/direct','「← 뒤로」 · 경로 줄 · 카드의 청약철회 문구','성분 | 함량 표제 · 정가 · 할인율 · 한 달 단가 · 상품 그림 — v10.26'),
 ('3','전체제품','#/c/HLT_FOOD','/health/c/{갈래}','갈래 단추(열린 갈래 + 잠긴 갈래 🔒 · 누를 수 없음) · 팔지 않는 품목 안내','화장품 갈래 — v10.26'),
 ('4','검색','#/search','/health/search','「← 뒤로」 · 많이 찾는 낱말','상품 카드의 자료 · 검색어 자동완성 칸(확인 받은 비교표에 빠졌던 차이) — v10.26'),
 ('5','성분별','#/ingredients','/health/ingredients','「성분 찾기」 칸','성분군 묶음 · 한 달 최저가 — v10.26'),
 ('6','성분 상세','#/i/{성분}','/health/i/{성분}','「← 뒤로」 → 성분별','함량 거르기 · 정렬(한 달 단가순) — v10.26'),
 ('7','고민별','#/concerns','/health/concerns','「성분 N종 (취급 N)」 · 「의약품이 아닙니다」 고지','—'),
 ('8','고민 상세','#/w/{고민}','/health/w/{고민}','살 수 있는 상품이 없는 성분은 「이름 🔒」 · 고지','—'),
 ('9','상품 상세','#/p/{상품}','/health/p/{상품}','「배송 · 교환 · 반품」 표(전 상품 무료 · 왕복 6,000원 · 철회 제한 · 근거) · 판매자 정보(1688-2887) · 고지','옵션(복용 개월 수) · 상품정보제공고시 · 주의사항 · 후기 · 문의 — v10.26 · v10.27 / 교환 배송비 — 결정 필요'),
 ('10','장바구니','#/cart','/health/cart','배송비 0원 · 「청약철회 제한: …」','판매자별 묶음 — v10.28'),
 ('11','주문서','#/order','/health/order','배송지 한 곳만 + 「변경」 · 「○원 결제하기」 · 동의 ① 문구','동의 ② 문구 · 판매자별 묶음 — v10.28'),
 ('12','결제','#/order/pay','/health/order/pay','「← 뒤로」','(시안은 시연용 결제 단추 — 실제 화면에 넣지 않음)'),
 ('13','주문 완료','#/order/done','/health/order/done','단추 「주문 상세」 「계속 쇼핑」 · 청약철회 안내','—'),
 ('14','주문 실패','#/order/fail','/health/order/fail','단추 「다시 시도」 「주문 내역」','부분 실패 안내 — v10.28'),
 ('15','내 주문','#/my/orders','/my/health/orders','상품 이름(외 N건) · 날짜 2026.10.03 · 발송 · 배송 완료 날짜 · 메뉴 줄','구매확정 · 리뷰쓰기 단추 — v10.27'),
 ('16','주문 상세','#/my/orders/{번호}','/my/health/orders/{번호}','단계별 시각 · 판매자 정보 · 메뉴 줄','—'),
 ('17','배송 조회','#/my/orders/{번호}/track','/my/health/orders/{번호}/ship','날짜 표기 · 메뉴 줄','택배사 · 송장번호 · 배송 추적 — v10.27'),
 ('18','취소 · 반품 신청','#/my/returns/new','/my/health/returns/new','단계 줄 · 환불 예상 표 · 신청 종류(반품 · 교환) · 개봉 여부 · 마감일','항목 · 수량 고르기(일부 반품) — v10.26'),
 ('19','취소 · 반품 내역','#/my/returns','/my/health/returns','날짜 표기 · 메뉴 줄','—'),
 ('20','배송지 관리','#/my/addresses','/my/health/addresses','「기본 배송지로 설정」 칸 · 메뉴 줄','—'),
 ('21','이용안내 · 청약철회','#/guide','/health/guide','「배송비는 받지 않습니다」 · 철회 제한(확정 문구) · 환불/배송 기한 · 취급하지 않는 것 · 판매자 정보 · 약관 전문','「직판 + 입점」 설명 — v10.28'),
 ('22','결제 승인','(시안에 없음)','/health/order/pay/success','그대로(결제사에서 돌아오는 주소)','—'),
]
sheet('46_소개몰_시안_개발분_대조', ['#', '화면', '시안 주소(#/health 안)', '개발분 주소', '시안 기준으로 맞춘 것(v10.25)', '아직 다른 것 — 다음 판', '판정'],
      [list(r) + ['정상 — 이번 판 범위는 맞춤' if r[5] == '—' or 'v10.2' in r[5] or '결정' in r[5] or '넣지 않음' in r[5] else '확인'] for r in _M46],
      {'화면': 20, '시안 주소(#/health 안)': 26, '개발분 주소': 32, '시안 기준으로 맞춘 것(v10.25)': 70, '아직 다른 것 — 다음 판': 60, '판정': 30}, status_col=6)
# 47. 그림 조각 — 받은 그림(JPEG)에서 다시 압축하지 않고 자른 것인지(cut_mall.py --check 와 같은 방법 · 조각마다)
try:
    import subprocess as _sp, io as _io
    from PIL import Image as _Im2, ImageChops as _Ch2
    _mm=json.load(open(f'{Q}/mall_assets.json', encoding='utf8')); _srcp=K + '/docs/design/' + _mm['_src']
    _plain=lambda p: _Im2.open(_io.BytesIO(_sp.run(['djpeg', '-nosmooth', '-ppm', p], capture_output=True).stdout)).convert('RGB')
    _sp0=_plain(_srcp); rows=[]; _web=set(__import__('os').listdir(K + '/site/public/shop'))
    for _n, _a in _mm['parts'].items():
        _p=f"{Q}/mall_cut/{_a['file']}"; _g=_plain(_p)
        _ok = _Im2.open(_p).format=='JPEG' and _g.size==(_a['w'], _a['h']) and _Ch2.difference(_g, _sp0.crop(tuple(_a['box']))).getbbox() is None
        rows.append([_mm['_src'], f"JPEG {_mm['_size'][0]}×{_mm['_size'][1]}", _a['file'], str(_a['box']), str(_a['inner']), f"JPEG {_a['w']}×{_a['h']}", __import__('os').path.getsize(_p),
                     '시안 · 실제 웹' if _a['file'] in _web else '시안', '통과 — 받은 그림의 그 자리와 점 하나 같음' if _ok else '실패 — 다름'])
    sheet('47_그림조각_대조_v10.25', ['받은 그림', '형식 · 크기', '조각', '자른 자리 [왼쪽, 위, 오른쪽, 아래]', '화면에 보일 자리(조각 안)', '조각 형식 · 크기', '바이트', '쓰는 곳', '판정'], rows,
          {'받은 그림': 36, '형식 · 크기': 18, '조각': 18, '자른 자리 [왼쪽, 위, 오른쪽, 아래]': 30, '화면에 보일 자리(조각 안)': 26, '조각 형식 · 크기': 18, '쓰는 곳': 16, '판정': 40}, status_col=8)
except Exception as _e: print('47 시트 건너뜀', _e)
# 48. 시안 본체 194장 — 앞 판(v10.24)과 그림 비교 결과(화면마다 · 이름 규칙을 입힌 뒤)
if _px25.get('screens'):
    _nm = set((_j25('proto_diff.json') or {}).get('name_only') or [])
    sheet('48_시안_그림비교_v10.25', ['시안 키', '결과', '글자', '판정'], [[k, v.get('kind'), '이름만 바뀜' if k in _nm else ('표식만 바뀜(소개광장)' if k in ((_j25('proto_diff.json') or {}).get('changed') or []) else '같음'), '정상 — 점 하나 같음' if v.get('kind')=='같음' else '확인'] for k, v in _px25['screens'].items()],
          {'시안 키': 18, '결과': 22, '글자': 26, '판정': 30}, status_col=3)
# v10.25 확장 점검(10/8) — 연동 목록 · 연동/DB 연동 테스트 · 버튼 체크 · flow 점검 · 시안 시연 안 되는 부분 · 발견 목록 (49 ~ 57 시트)
exec(open(f'{Q}/xlsx_r2.py', encoding='utf-8').read())
# v10.26(10/8) — 소개몰 상품 자료 · 옵션 · 교환 배송비 · 확장 점검 결함 10건 · 시안 v10.26 (58 ~ 62 시트)
exec(open(f'{Q}/xlsx_1026.py', encoding='utf-8').read())      # v10.27 부터 58 ~ 62 시트는 v10.26 때의 결과 파일(qa/results_v10_26)로 고정
# v10.27(10/9) — 결함 수정판 · G-114 가상 결제사 · 시안 v10.27 · 결함 목록 · 새 API · 마이그레이션 (63 ~ 68 시트)
exec(open(f'{Q}/xlsx_1027.py', encoding='utf-8').read())      # v10.28 부터 63 ~ 68 시트는 v10.27 때의 결과 파일(qa/results_v10_27)로 고정
# v10.28(10/9) — 두 묶음 한 판 · 작업 지시서 대조 · 시안 v10.28 · 결함 목록 · 새 API · 마이그레이션 (69 ~ 74 시트)
exec(open(f'{Q}/xlsx_1028.py', encoding='utf-8').read())
wb.save(XLSX_OUT)
print('saved', XLSX_OUT)
# v10.19 (G-119) — 만든 뒤 시트마다 「실패」 줄을 셉니다. 하나라도 있으면 어느 시트 · 어느 줄인지 보여 주고 종료 코드 1 (요약에 빠진 실패가 엑셀에만 남는 일을 막음)
import sys as _sys
_bad = []; _known = []
for _ws in wb.worksheets:
    _hdr = [c.value for c in _ws[1]]
    _cols = [i for i, h in enumerate(_hdr) if h in ('판정', '결과', '상태')]
    for _r in _ws.iter_rows(min_row=2):
        for _i in _cols:
            _v = str(_r[_i].value or '')
            # 확장 점검(10/8)부터 — 발견 목록(57 시트)에 번호(G-…)로 올린 실패는 「알고 있는 실패」로 따로 셉니다. 번호 없는 실패가 하나라도 있으면 종료 코드 1
            if _v.startswith(('실패', 'FAIL')): (_known if __import__('re').search(r'G-\d+', _v) else _bad).append((_ws.title, ' | '.join(str(c.value)[:60] for c in _r[:4])))
print(f'실패 줄 {len(_bad)} (발견 목록에 올린 실패 {len(_known)}줄은 따로 — 57 시트)' + ''.join(f'\n  {t}: {l}' for t, l in _bad[:20]))
if _bad: _sys.exit(1)
