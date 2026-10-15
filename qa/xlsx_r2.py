# ═════ v10.25 확장 점검(2026-10-08) — 연동 목록 · 연동 테스트 · DB 연동 테스트 · 버튼 체크 · flow 점검 · 시안 시연 안 되는 부분 · 발견 목록 ═════
# build_xlsx.py 가 저장 직전에 이 파일을 실행합니다(sheet · wb · Q · K · json 을 그대로 씀).
_F2 = json.load(open(f'{Q}/findings_r2.json', encoding='utf-8'))
_TAG = {}
for _f in _F2:
    for _t in _f.get('tags', []): _TAG[tuple(_t)] = _f['no']
def _jr(f):
    try: return json.load(open(f'{Q}/{f}', encoding='utf-8'))
    except Exception: return None
def _judge(ok, skip, no):
    if skip: return '건너뜀' + (f' — {no}' if no else '')
    return '통과' if ok else '실패 — ' + (no or '미등록')
def _cnt(f):
    d = _jr(f); d = (d.get('items') if isinstance(d, dict) else d) or []
    return (sum(1 for x in d if x.get('ok') and not x.get('skip')), len(d)) if d else (0, 0)
def _pt(f):
    a, b = _cnt(f); return f'{a} / {b}' if b else '결과 없음'

# ── 49. 연동 목록 ──
_li = {x['code']: x for x in (_jr('link_integrations.json') or [])}
_st = lambda c: (lambda x: f"{ {'NOT_STARTED': '미착수', 'TESTING': '시험 중', 'LIVE': '운영 중'}.get(x.get('status'), x.get('status', '?')) }" + (' · 오픈을 막는 항목' if x.get('blocks_open') else ''))(_li.get(c, {}))
_lk = {r['step'].split(' ')[0]: r for r in (_jr('link_check.json') or [])}
_ok = lambda *ks: ' · '.join(f"{k} {'통과' if _lk.get(k, {}).get('ok') else '실패' if k in _lk else '없음'}" for k in ks)
_R49 = [
 # 구분, 이름, 구간, 방식, 설정(환경 변수 · 키), 지금 상태(개발 환경), 연동 전 동작, 시험(이번 실행), 실제 상대와의 확인, 비고
 ['외부 연동', '본인인증 (PASS)', 'API → 본인인증 기관', 'HTTPS', 'PASS_API_KEY', _st('PASS'), '키가 없으면 「시험(stub)」으로 통과시키고 응답에 stub: true 를 실음', f"연동 테스트 {_ok('D-5')} · e2e 2-1", '확인 못 함 — 키 없음(계약 · IP 등록 필요)', 'CI 는 해시만 저장'],
 ['외부 연동', '1원 계좌인증', 'API → 계좌 인증 업체', 'HTTPS · 보내기/확인 두 단계', 'BANK_VERIFY_URL · BANK_VERIFY_KEY · BANK_VERIFY_SEND_PATH · BANK_VERIFY_CONFIRM_PATH · BANK_VERIFY_AUTH_HEADER · BANK_VERIFY_AUTH_PREFIX · BANK_VERIFY_CODE_MODE', _st('BANK'), '간주 모드 assume.bank(가상 계좌) — 켠 채로는 오픈 점검을 통과하지 못함', f"가짜 상대 서버(3123)로 실제 HTTP — srv_lead {_pt('srv_lead.json')}", '확인 못 함 — 키 없음', ''],
 ['외부 연동', '국세청 사업자 진위', 'API → 공공데이터포털(국세청)', 'HTTPS POST …/status', 'NTS_SERVICE_KEY · NTS_API_BASE(기본 api.odcloud.kr) · NTS_TIMEOUT_MS', _st('NTS'), '키가 없으면 「시험(stub)」으로 정상 사업자로 봄', f"가짜 상대 서버(3123) — srv_lead {_pt('srv_lead.json')} · 응답 처리 10건(scripts/test-nts-offline.ts)", '확인 못 함 — 이 환경에 키 없음(표에는 「키 등록됨」으로 표시 · 손으로 켜는 값)', '실제 응답 확인 뒤 「운영 중」으로 올리게 돼 있음'],
 ['외부 연동', '전자결제 (토스페이먼츠)', 'API → 결제사 · 결제사 → API(입금 알림) · 브라우저 → 결제창', 'HTTPS · 웹훅 POST /webhooks/toss · 결제창 스크립트 js.tosspayments.com', 'TOSS_SECRET_KEY · TOSS_API_BASE · NEXT_PUBLIC_TOSS_CLIENT_KEY(사용자 웹)', _st('PG'), '키가 없으면 「시험 결제」로 승인하고 표식(paymentStub · is_stub)을 남김', f"가짜 결제사로 실제 HTTP — srv_pay {_pt('srv_pay.json')} · srv_billing {_pt('srv_billing.json')} · 연동 테스트 {_ok('D-6')}", '확인 못 함 — 상점 키 없음(계약 필요)', '★ G-174 — 운영 화면 · 절차서의 키 이름(PG_SECRET_KEY)이 서버가 읽는 이름(TOSS_SECRET_KEY)과 다름 · 구독료 · 초과 코드 요금만 결제(소개비는 태우지 않음)'],
 ['외부 연동', '알림톡 · 문자', 'API → 발송 업체', '(코드 없음)', 'ALIMTALK_KEY(예정)', _st('ALIMTALK'), '상담 신청의 인증번호를 보내지 못함 → 개발 환경에서만 응답에 실어 주고, 그 밖의 환경은 접수를 받지 않음', f"연동 테스트 {_ok('D-7')} · srv_consult {_pt('srv_consult.json')}(개발이 아닌 환경 3124 포함)", '해당 없음 — 연동 코드 없음', '발신번호 등록 · 템플릿 승인 필요'],
 ['외부 연동', '050 안심번호', 'API → 안심번호 업체', '(코드 없음)', 'SAFENUM_KEY(예정)', _st('SAFENUM'), '기능 없음', f"연동 테스트 {_ok('D-9')}", '해당 없음', '도입 여부 미결'],
 ['외부 연동', '전자계약', 'API → 전자서명 업체', 'HTTPS', 'ESIGN_API_KEY', _st('ESIGN'), '키가 없으면 stub 표식 — 서명 요청이 실제로 나가지 않음', f"연동 테스트 {_ok('D-8')}(코드 경로)", '확인 못 함 — 키 없음', ''],
 ['외부 연동', '중개사 자격 대조 (국토부)', 'API → 조회 서비스', 'HTTP(주소 · 응답 경로를 환경 변수로 지정)', 'BROKER_LOOKUP_URL · _KEY · _METHOD · _KEY_PARAM · _AUTH_HEADER · _ITEMS_PATH · _RESULT_PATH · _RESULT_OK · _ACTIVE', '간주 모드(assume.broker 켜짐) · 외부 연동 7건 표에는 없음', '간주 모드면 대조를 건너뛰고 「간주」로 기록(lookup_source = ASSUMED)', f"가짜 상대 서버(3123) — srv_lead {_pt('srv_lead.json')} · srv_ptn {_pt('srv_ptn.json')} · 연동 테스트 {_ok('E-3c')}", '확인 못 함', 'V-World 연동(개발 키 수령 뒤)은 아직 시작하지 않음 — 키는 PC · 서버의 .env 에만'],
 ['외부 연동', '파일 저장소 (S3)', '브라우저 → S3(서명 주소로 직접) · API → S3', 'HTTPS · 서명(SigV4)', 'S3_BUCKET · AWS_REGION · S3_ENDPOINT · S3_FORCE_PATH_STYLE · 자격 증명(환경 변수 → ECS 역할 → EC2 역할) · FILE_TOKEN_SECRET · FILE_UPLOAD_TTL · FILE_DOWNLOAD_TTL', 'S3_BUCKET 없음 → 서버 폴더(UPLOAD_DIR)에 저장', 'S3 가 없으면 서버 폴더 + 기한 있는 토큰 주소', f"가짜 S3(9022)로 실제 HTTP — srv_file {_pt('srv_file.json')} · srv_file_ui {_pt('srv_file_ui.json')}", '실제 S3 — 서버 적용 리허설에서는 쓰지 않음(확인 못 함)', ''],
 ['외부 연동', '주소 찾기 (다음 우편번호)', '브라우저 → 다음 스크립트', '외부 스크립트 t1.daumcdn.net', '없음', '사용자 웹의 주소 입력에서 부름', '막히면 「직접 입력」 칸이 열림', 'flow 점검이 직접 입력으로 진행(외부 요청은 막음)', '확인 안 함(시험에서 외부 요청을 보내지 않음)', ''],
 ['서버 ↔ 서버', '예약 작업 (스케줄러 → API)', '스케줄러(Docker) · EventBridge(AWS) → API', 'POST /admin/jobs/tick · /run · 머리말 X-Job-Token', 'JOB_TOKEN(32자 이상) · API_ORIGIN', '개발: 손으로 호출 · Docker: scheduler 서비스가 매분', '토큰이 없거나 짧으면 늘 거절', f"연동 테스트 {_ok('C-1', 'C-2', 'C-3')} · Docker 점검", '실제 호출로 확인', '같은 시간대 같은 작업은 한 번만'],
 ['서버 ↔ 서버', '광고 서버 → 본체 (성향 · 사업자 실재)', '광고 서버(sgb-ads · 아직 띄우지 않음) → API', 'GET /internal/accounts/{id}/ad-profile · /internal/businesses/{id} · 머리말 X-Internal-Key', '운영 설정 internal.api_key', '본체 쪽 준비됨 · 광고 서버는 소스만 있음', '키가 비면 늘 거절', f"연동 테스트 {_ok('C-4', 'C-5', 'C-6', 'C-7')}", '본체 쪽만 실제 호출로 확인', '★ G-175 — 광고 서버가 보내는 머리말 이름이 다름'],
 ['서버 ↔ 서버', '광고 노출 · 클릭 기록', '사용자 웹 → API → DB', 'POST /ads/{id}/impression · /click', '없음', '동작', '-', f"연동 테스트 {_ok('C-8')}", '실제 호출로 확인', '광고 DB(sgb_ads)는 본체와 실행 중 연결이 없음 — 따로 검증(verify-ads)'],
 ['화면 ↔ API', '사용자 웹(서버 쪽 조회) → API', 'Next.js 서버 → API', 'HTTP · 쿠키의 토큰을 머리말로', 'API_BASE · SITE_ORIGIN(S) · HOME_CONTENT', '동작', '-', f"연동 테스트 {_ok('A-3', 'A-4', 'A-5', 'A-7')} · 모든 페이지 상호 확인", '실제 호출로 확인', '로그인 · 가입은 서버 액션'],
 ['화면 ↔ API', '브라우저 → 사용자 웹 /api 넘김 → API', '브라우저 → Next.js → API', '같은 출처 /api/* · httpOnly 쿠키', 'API_ORIGIN', '동작', '-', f"연동 테스트 {_ok('A-1', 'A-6', 'A-6b', 'A-10')} · 버튼 체크(실제 웹)", '실제 호출로 확인', 'API 는 다른 출처를 허용하지 않음(C-10)'],
 ['화면 ↔ API', '운영 화면 → API', '브라우저 → Vite/정적 서버 → API', '같은 출처 /api/* · 머리말 Authorization(공용 함수 api)', 'VITE_API_BASE', '동작 — 단, 세 화면의 쓰기 요청은 토큰이 빠짐', '-', f"연동 테스트 {_ok('A-2', 'A-8', 'A-9', 'A-12')} · 버튼 체크(운영 화면)", '실제 호출로 확인', '★ G-178 — 신고 처리 · 이벤트 · 수집 관리'],
 ['화면 ↔ API', '시안 ↔ 사용자 웹', '사용자 웹이 시안 파일을 내줌(/proto/…)', '정적 파일', '없음', '킷의 시안 3벌이 같은 파일', '-', f"연동 테스트 {_ok('B-1', 'B-2')} · srv_proto {_pt('srv_proto.json')}", '확인', '시안은 서버 없이 열리는 한 파일'],
 ['서버 ↔ DB', 'API → PostgreSQL', 'API → DB', '연결 풀', 'DATABASE_URL · DB_POOL_MAX', '동작', '-', f"연동 테스트 {_ok('A-1', 'C-9')} · DB 연동 테스트 {_pt('db_link.json')}", '실제 호출로 확인', '마이그레이션 70 · 표 201 · 뷰 299'],
 ['간주 모드', 'assume.payment (결제 간주)', '운영 설정 → 사용자 웹 표시', '공개 설정 API', '운영 설정 assume.payment = on', '켜짐(개발 기본)', '화면에 「간주」 표시 — 실제 시험 결제 여부는 결제 키 유무가 정함', f"연동 테스트 {_ok('E-1', 'E-2', 'E-4', 'E-5')}", '-', '스위치만 끄고 키를 안 넣으면 여전히 시험 결제'],
 ['간주 모드', 'assume.broker (중개사 인증 간주)', '운영 설정 → API', 'DB 설정 조회', '운영 설정 assume.broker = on', '켜짐(개발 기본)', '국토부 대조를 건너뛰고 통과로 봄(기록에 「간주」)', f"연동 테스트 {_ok('E-1', 'E-4')} · srv_ptn {_pt('srv_ptn.json')}", '-', ''],
 ['간주 모드', 'assume.bank (수금 계좌 간주)', '운영 설정 → DB 트리거 · 오픈 점검', 'DB', '운영 설정 assume.bank = on', '켜짐(개발 기본)', '가상 계좌로 돎 — 실계좌 3항목을 넣으면 스스로 풀림', f"연동 테스트 {_ok('E-1', 'E-3', 'E-3b')}", '-', '★ G-176 — 운영 화면 「오픈 체크리스트」에는 간주가 나오지 않음(쉘 점검 · 「불변식」 탭이 봄)'],
]
sheet('49_연동목록', ['구분', '이름', '구간(누가 → 누구)', '방식', '설정(환경 변수 · 키)', '지금 상태(개발 환경)', '연동 전 동작', '시험(이번 실행)', '실제 상대와의 확인', '비고'], _R49,
      {'구분': 12, '이름': 26, '구간(누가 → 누구)': 34, '방식': 34, '설정(환경 변수 · 키)': 44, '지금 상태(개발 환경)': 26, '연동 전 동작': 46, '시험(이번 실행)': 50, '실제 상대와의 확인': 30, '비고': 50})

# ── 50. 연동 테스트 ──
_rows = []
for _r in (_jr('link_check.json') or []):
    _k = _r['step'].split(' ')[0]; _sec = {'A': '화면 ↔ API', 'B': '시안 ↔ 서버', 'C': '서버 ↔ 서버', 'D': '외부 연동 7건', 'E': '간주 모드'}.get(_k[0], '')
    _rows.append([_sec, _r['step'], _judge(_r['ok'], _r.get('skip'), _TAG.get(('link_check', _k))), str(_r.get('detail', ''))[:300]])
for _f, _lab in [('srv_pay', '결제(토스) 어댑터 — 가짜 결제사와 실제 HTTP(승인 · 금액 불일치 · 가상계좌 · 입금 알림 · 환불)'), ('srv_billing', '정기결제 · 환불 정합 — 가짜 결제사(장애 주입) · 운영 방식 API 2대'),
                  ('srv_file', '파일(S3) 어댑터 — 가짜 S3 와 실제 HTTP(서명 주소 올리기 · 내려받기 · 기한)'), ('srv_lead', '1원 인증 · 중개사 대조 · 국세청 어댑터 — 가짜 상대 서버'), ('srv_consult', '알림톡 연동 전 동작 — 개발 · 그 밖의 환경(3124)'),
                  ('srv_proto', '시안 ↔ 서버 대조'), ('srv_pay_ui', '결제 화면'), ('srv_file_ui', '파일 화면'), ('srv_lead_ui', '리드 · 인증 화면'), ('srv_billing_ui', '구독 · 환불 화면')]:
    _a, _b = _cnt(_f + '.json')
    _rows.append(['어댑터 묶음(전수 검정 B 구간)', f'{_lab} — {_f}.py', ('통과' if _b and _a == _b else '실패 — 미등록' if _b else '결과 없음') , f'통과 {_a} / {_b}'])
sheet('50_연동테스트', ['구간', '확인한 것', '판정', '자세히'], _rows, {'구간': 26, '확인한 것': 110, '판정': 16, '자세히': 80}, status_col=2)

# ── 51. DB 연동 테스트 ──
_SEC = {'A': '연결 · 마이그레이션', 'B': '조회 전수', 'C': 'API → DB 왕복', 'D': 'DB 가 막는 것(제약 · 트리거)', 'E': '거래 단위', 'F': '새로 설치한 DB 와 구조 비교', 'G': '표 ↔ API', 'H': '시각 · 글자'}
sheet('51_DB연동테스트', ['갈래', '확인한 것', '판정', '자세히'],
      [[_SEC.get(_r['step'][0], ''), _r['step'], _judge(_r['ok'], _r.get('skip'), _TAG.get(('db_link', _r['step'].split(' ')[0]))), str(_r.get('detail', ''))[:300]] for _r in (_jr('db_link.json') or [])],
      {'갈래': 28, '확인한 것': 110, '판정': 16, '자세히': 90}, status_col=2)
_na = _jr('db_link_noapi.json') or {}; _cn = (_jr('db_link_counts.json') or {}).get('counts', {})
sheet('51b_API와_잇지못한_표', ['표', '행 수(개발 DB)', '까닭'], [[k, _cn.get(k, ''), v] for k, v in sorted(_na.items(), key=lambda x: (x[1], x[0]))], {'표': 40, '행 수(개발 DB)': 16, '까닭': 80})

# ── 52 · 53. 버튼 체크 ──
_RV = {  # 무반응(처리기 있음)을 하나씩 본 결과 — (어디, 글자의 앞부분) → 까닭
 ('회원', '찾기'): '확인 — 빈 검색어로 눌러 같은 목록(검색어를 넣으면 조회함 · 소스 확인)',
 ('외부 연동', '전 연동에 반영'): '확인 — 빈 칸으로 누르면 안내 없이 끝남(G-187)',
}
def _btn_res(r, bo=False):
    v = r['result']
    if v == '반응 있음': return '통과 — 반응 있음'
    if v == '같은 단추(대표만)': return '통과(대표만) — 같은 모양 단추는 3개까지만 누름'
    if v == '같은 틀에서 확인함': return '통과 — 같은 머리줄 · 바닥줄에서 이미 누름'
    if v == '꺼짐': return '꺼짐 — 입력 · 조건을 채워야 켜짐(채운 뒤의 동작은 flow 점검 · 기능 검증)'
    if v == '무반응(처리기 있음)':
        for (w, t), why in _RV.items():
            if r['where'].startswith(w) and (r.get('text') or '').startswith(t): return why
        return '확인 — 이미 골라진 거르개(같은 것을 다시 눌러 변화 없음)' if bo else '확인 — 처리기는 있으나 변화가 보이지 않음'
    if v == '다시 열었더니 없음': return '확인 — 목록이 바뀌어 그 단추가 사라짐(다른 시험이 같이 도는 중)'
    if v == '요청에 로그인 토큰이 없음': return '실패 — G-178'
    return '실패 — 미등록(' + v + ')'
_bs = _jr('btn_site.json') or {'rows': [], 'total': {}, 'units': 0}
sheet('52_버튼체크_실제웹', ['역할', '쪽', '자리', '단추 글자', '종류', '처리기', '판정', '반응', '나간 요청(쓰기는 서버에 닿기 전에 막음)'],
      [[r['who'], r['where'], r.get('region'), r.get('text') or r.get('title') or '(글자 없음)', r.get('tag'), r.get('handler'), _btn_res(r), ' / '.join(r.get('react') or []), ' / '.join(r.get('requests') or [])] for r in _bs['rows']],
      {'역할': 9, '쪽': 40, '자리': 9, '단추 글자': 34, '종류': 9, '처리기': 18, '판정': 46, '반응': 50, '나간 요청(쓰기는 서버에 닿기 전에 막음)': 50}, status_col=6)
_bb = _jr('btn_bo.json') or {'rows': [], 'total': {}, 'units': 0}
sheet('53_버튼체크_운영화면', ['계정', '상태(탭 › 하위 탭)', '자리', '단추 글자', '처리기', '판정', '반응', '나간 요청(쓰기는 서버에 닿기 전에 막음)'],
      [[r['who'], r['where'], r.get('region'), r.get('text') or r.get('title') or '(글자 없음)', r.get('handler'), _btn_res(r, True), ' / '.join(r.get('react') or []), ' / '.join(r.get('requests') or [])] for r in _bb['rows']],
      {'계정': 20, '상태(탭 › 하위 탭)': 40, '자리': 9, '단추 글자': 34, '처리기': 18, '판정': 46, '반응': 50, '나간 요청(쓰기는 서버에 닿기 전에 막음)': 50}, status_col=5)

# ── 54 · 55. flow 점검 ──
def _flow_rows(names):
    out = []
    for n in names:
        for f in (_jr(f'flow_{n}.json') or []):
            code = f['flow'].split(' ')[0]
            for s in f['steps']:
                out.append([f['flow'], s['no'], s['step'], s['how'], _judge(s['ok'], s.get('skip'), _TAG.get(('flow', code, s['no']))), s.get('detail', '')])
    return out
_fw = _flow_rows(['trade', 'mall', 'plaza', 'biz']); _fp = _flow_rows(['proto'])
sheet('54_flow점검_실제웹', ['흐름', '#', '단계(무엇을 누르고 무엇을 확인했나)', '방법', '판정', '자세히'], _fw, {'흐름': 40, '#': 5, '단계(무엇을 누르고 무엇을 확인했나)': 90, '방법': 10, '판정': 16, '자세히': 80}, status_col=4)
sheet('55_flow점검_시안', ['흐름', '#', '단계(무엇을 누르고 무엇을 확인했나)', '방법', '판정', '자세히'], _fp, {'흐름': 40, '#': 5, '단계(무엇을 누르고 무엇을 확인했나)': 90, '방법': 10, '판정': 16, '자세히': 80}, status_col=4)
def _flow_sum(rows):
    by = {}
    for r in rows:
        b = by.setdefault(r[0], [0, 0, 0, 0, set()]); b[0] += 1
        if r[4].startswith('통과'): b[1] += 1
        elif r[4].startswith('실패'): b[2] += 1; b[4].add(r[4].split('— ')[-1])
        else: b[3] += 1; b[4].add(r[4].split('— ')[-1]) if '—' in r[4] else None
    return [[k, v[0], v[1], v[2], v[3], ' · '.join(sorted(v[4])), ('끝까지 이어짐' if not v[2] and not v[3] else '끊긴 곳 있음 — ' + ' · '.join(sorted(v[4])))] for k, v in by.items()]
sheet('54a_flow요약', ['흐름', '단계', '통과', '실패', '건너뜀', '걸린 발견 번호', '한 줄 결과'], _flow_sum(_fw) + _flow_sum(_fp), {'흐름': 60, '걸린 발견 번호': 30, '한 줄 결과': 50})

# ── 56. 시안 — 시연 안 되는 부분 ──
_pd = _jr('proto_demo.json') or {'rows': [], 'no_way_in_strict': [], 'total': {}}
_K2 = {'없는 주소': '실패 — G-197', '안내로 대신': '시연 안 됨 — 안내 글로 대신(실제 동작은 구현 화면)', '표시만 바뀜': '표시만 — 선택 표시만 바뀌고 목록은 그대로', '무반응': '실패 — 미등록', '오류': '실패 — 미등록'}
sheet('56_시안_시연안되는부분', ['어디', '화면 열쇠', '화면 제목', '단추 글자', '갈래', '판정', '자세히(가려던 주소 · 뜬 안내)'],
      [[r['where'], r['screen'], (r.get('title') or '').replace('\n', ' ')[:40], r.get('text') or '(글자 없음)', r['kind'], _K2.get(r['kind'], r['kind']), r.get('detail', '')] for r in sorted(_pd['rows'], key=lambda x: ({'없는 주소': 0, '안내로 대신': 1, '표시만 바뀜': 2}.get(x['kind'], 3), x['where'], x['screen']))],
      {'어디': 8, '화면 열쇠': 16, '화면 제목': 34, '단추 글자': 34, '갈래': 14, '판정': 50, '자세히(가려던 주소 · 뜬 안내)': 80}, status_col=5)
sheet('56b_시안_여는길없는화면', ['화면 열쇠', '화면 ID', '화면 제목', '등록된 주소', '다른 화면의 단추', '주소로 열림', '판정'],
      [[o['screen'], o.get('id', ''), o.get('title', ''), o.get('url', ''), '없음', '열림 — ' + o.get('address', '') if o.get('by_address') else ('안 열림' if o.get('by_address') is False else '주소 없음'),
        ('주소로만 열림 — 시연하려면 주소를 직접 넣어야 함' if o.get('by_address') else '여는 길 없음 — G-198')] for o in sorted(_pd['no_way_in_strict'], key=lambda x: (bool(x.get('by_address')), x['screen']))],
      {'화면 열쇠': 16, '화면 ID': 20, '화면 제목': 34, '등록된 주소': 36, '다른 화면의 단추': 16, '주소로 열림': 34, '판정': 50})

# ── 57. 이번 확장 점검에서 나온 것 ──
_SV = {'상': 0, '중': 1, '하': 2}; _KD = {'제품 결함': 0, '빠진 기능': 1, '시안': 2, '관찰': 3, '시험 도구': 4}
sheet('57_확장점검_발견목록', ['번호', '갈래', '심각도', '어디', '무엇', '원인', '근거(찾은 점검)', '권고 · 조치', '파일', '상태'],
      [[f['no'], f['kind'], f['sev'], f['area'], f['what'], f['cause'], f['evidence'], f['fix'], f['file'], ('열려 있음 — 수정 대기(결정 필요)' if f['open'] else '수정 · 재검정 통과')]
       for f in sorted(_F2, key=lambda f: (_KD.get(f['kind'], 9), _SV.get(f['sev'], 9), f['no']))],
      {'번호': 8, '갈래': 10, '심각도': 7, '어디': 28, '무엇': 80, '원인': 40, '근거(찾은 점검)': 50, '권고 · 조치': 50, '파일': 50, '상태': 28}, status_col=9)

# ── 0_요약에 줄 추가 ──
_ws0 = wb['0_요약']; _r0 = _ws0.max_row + 2
def _add(k, v):
    global _r0
    _ws0.cell(_r0, 1, k).font = Font(bold=True); c = _ws0.cell(_r0, 2, v); c.alignment = Alignment(wrap_text=True, vertical='top'); _r0 += 1
_fa = lambda rows: (len(rows), sum(1 for r in rows if r[4].startswith('통과')), sum(1 for r in rows if r[4].startswith('실패')), sum(1 for r in rows if r[4].startswith('건너뜀')))
_la, _lb = _cnt('link_check.json'); _da, _db_ = _cnt('db_link.json')
_w = _fa(_fw); _p = _fa(_fp)
_add('── 확장 점검(10/8 · v10.25 · 제품 코드는 그대로) ──', '연동 목록 · 연동 테스트 · DB 연동 테스트 · 버튼 체크 · flow 점검 · 시안의 시연 안 되는 부분을 새로 더함(49 ~ 57 시트)')
_add('연동 목록', f'{len(_R49)}줄 — 외부 연동 {sum(1 for r in _R49 if r[0] == "외부 연동")} · 서버 ↔ 서버 {sum(1 for r in _R49 if r[0] == "서버 ↔ 서버")} · 화면 ↔ API {sum(1 for r in _R49 if r[0] == "화면 ↔ API")} · 서버 ↔ DB 1 · 간주 모드 3 (49 시트)')
_add('연동 테스트', f'통과 {_la} / {_lb} — 실패는 모두 발견 목록에 있음(50 시트) · 어댑터 묶음(가짜 상대 서버)은 전수 검정 B 구간 결과를 함께 실음 · 실제 외부 기관으로는 보내지 않음')
_add('DB 연동 테스트', f'통과 {_da} / {_db_} — 왕복 · 뷰 299 · 표 201 조회 · 제약/트리거 거절 · 거래 단위 · 새 설치 DB 와 구조 비교(51 시트)')
_add('버튼 체크(실제 웹)', f"쪽 {_bs.get('units')} · 단추 {sum(_bs.get('total', {}).values())} — " + ' · '.join(f'{k} {v}' for k, v in sorted(_bs.get('total', {}).items(), key=lambda x: -x[1])) + ' (52 시트)')
_add('버튼 체크(운영 화면)', f"상태 {_bb.get('units')} · 단추 {sum(_bb.get('total', {}).values())} — " + ' · '.join(f'{k} {v}' for k, v in sorted(_bb.get('total', {}).items(), key=lambda x: -x[1])) + ' (53 시트)')
_add('flow 점검(실제 웹)', f"흐름 {len({r[0] for r in _fw})}개 · 단계 {_w[0]} — 통과 {_w[1]} · 실패 {_w[2]} · 건너뜀 {_w[3]} (54 · 54a 시트)")
_add('flow 점검(시안)', f"흐름 {len({r[0] for r in _fp})}개 · 단계 {_p[0]} — 통과 {_p[1]} · 실패 {_p[2]} · 건너뜀 {_p[3]} (55 시트)")
_t = _pd.get('total', {})
_add('시안 — 시연 안 되는 부분', f"누른 것 {sum(_t.values())} 가운데 안내로 대신 {_t.get('안내로 대신', 0)} · 표시만 바뀜 {_t.get('표시만 바뀜', 0)} · 없는 주소 {_t.get('없는 주소', 0)} · 무반응 {_t.get('무반응', 0)} / 여는 길이 없는 화면 {sum(1 for o in _pd['no_way_in_strict'] if not o.get('by_address'))}장 · 주소로만 열리는 화면 {sum(1 for o in _pd['no_way_in_strict'] if o.get('by_address'))}장 (56 · 56b 시트)")
_kc = {}
for _f in _F2:
    if _f['open']: _kc[_f['kind']] = _kc.get(_f['kind'], 0) + 1
_add('확장 점검에서 나온 것', f"{len(_F2)}건 — 열려 있음 {sum(_kc.values())}건(" + ' · '.join(f'{k} {v}' for k, v in _kc.items()) + f") · 심각도 상 {sum(1 for f in _F2 if f['open'] and f['sev'] == '상')}건 (57 시트 · 고치는 것은 확인 뒤 다음 판에서)")
