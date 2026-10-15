"""문서 80 — 소개뱅크 v10.31 시안 기준 반영 결과(2026-10-10).
   python3 doc80_gen.py   → 킷 sgb/docs/80_시안기준반영_v10.31_20261010.md (DOC80_OUT=… 로 다른 곳에)

   글(지시 · 답 · 묶음별 반영 · 바뀐 정책 · 위험 · 다음 할 일)은 이 파일에, 숫자 · 표(새 API · 새 표 · 마이그레이션 · 검정 결과 · 고친 결함 · 남은 것)는
   matrix.json(지금 / v10.30 바탕 git 40ac141) · final_all.txt + final_all_reruns_1031.txt · 킷 qa/results_v10_30 · fixed_v1031.json · left_v1031.json · git log 에서 읽습니다."""
import collections, json, os, re, subprocess, time

Q = os.path.dirname(os.path.abspath(__file__)); K = '/home/claude/pkg/SGB_DevDocker_Integrated_20261002'
OUT = os.environ.get('DOC80_OUT', K + '/sgb/docs/80_시안기준반영_v10.31_20261010.md')
BASE = '40ac141'
J = lambda f, d=None: (json.load(open(os.path.join(Q, f), encoding='utf8')) if os.path.exists(os.path.join(Q, f)) else d)
git = lambda *a: subprocess.run(['git', '-C', K, *a], capture_output=True, text=True).stdout
cell = lambda s: str(s if s is not None else '').replace('|', '\\|').replace('\n', ' ')

m = json.load(open(K + '/sgb/docs/matrix/matrix.json', encoding='utf8')); S = m['summary']
old = json.loads(git('show', f'{BASE}:sgb/docs/matrix/matrix.json')); OS = old['summary']
NORM = lambda p: re.sub(r':[A-Za-z_]+|\{[^}]*\}', '{}', p or '')
old_api = {f"{a.get('method')} {NORM(a.get('path'))}" for a in old['apis']}
new_api = [a for a in m['apis'] if f"{a.get('method')} {NORM(a.get('path'))}" not in old_api]
old_db = {d['name'] for d in old['db']}
new_db = [d for d in m['db'] if d['name'] not in old_db]
old_fn = set(); new_mig = []
for d in sorted(os.listdir(K + '/sgb/prisma/migrations')):
    if git('ls-tree', '--name-only', BASE, f'sgb/prisma/migrations/{d}/').strip() == '': new_mig.append(d)

# ── 검정 결과 — v10.31(final + 다시 돌린 줄) · v10.30(킷 qa/results_v10_30) ──
NOTE = re.compile(r' — (?=시험을 고친|결함 고친|환경을 고친|새 시험|다시 빌드한|최신 소스|전 회차|고친 것 없이|앞 판)')
def read(f):
    out = collections.OrderedDict()
    if not os.path.exists(f): return out
    for l in open(f, encoding='utf8').read().split('\n'):
        if ': ' not in l or l.startswith(('PART-', 'CHAIN', 'RERUN', 'FINAL', 'ALLDONE')): continue
        k, v = l.split(': ', 1); k = k.strip()
        mm = NOTE.search(v); res, why = (v[:mm.start()], v[mm.end():]) if mm else (v, '')
        prev = out.get(k, {'why': []})
        out[k] = {'res': res.strip(), 'why': prev['why'] + ([why.strip()] if why.strip() else [])}
    return out
def verdict(v):
    if v.startswith('건너뜀'): return '건너뜀'
    if re.search(r'실패 [1-9]|FAIL|뚫림 [1-9]|exit=[1-9]|▲위험 [1-9]|Error|Traceback|Timeout|^실패|문제 [1-9]|다른 것 [1-9]|스크립트 오류 [1-9]|뜻밖의 404 [1-9]', v): return '실패'
    mm = re.search(r'(\d+)\s*/\s*(\d+)', v); sk = re.search(r'건너뜀 (\d+)', v)
    if mm and sk and int(mm.group(1)) + int(sk.group(1)) == int(mm.group(2)): return '통과'
    if mm and mm.group(1) != mm.group(2) and not re.search(r'통과 \d+ / 실패 0|오류 0 / \d+', v): return '실패'
    if v in ('', 'done'): return '확인'
    return '통과'
fin = read(os.path.join(Q, 'final_all.txt')); rer = read(os.path.join(Q, 'final_all_reruns_1031.txt'))
R30 = K + '/qa/results_v10_30'
fin30 = read(R30 + '/final_all_v1030.txt'); rer30 = read(R30 + '/final_all_reruns_1030.txt')
SKIPK = {'adapters_up', 'site_build'}
keys = [k for k in fin if k not in SKIPK] + [k for k in rer if k not in fin and k not in SKIPK]
rows = []
for k in keys:
    first = fin.get(k, {}).get('res', ''); now = rer[k]['res'] if k in rer else first
    why = ' / '.join(reversed(list(dict.fromkeys(rer[k]['why'])))) if k in rer else ''      # 마지막으로 다시 돌린 까닭이 앞
    v30 = rer30[k]['res'] if k in rer30 else fin30.get(k, {}).get('res', '')
    if ' — ' in v30 and re.search(r'\d', v30.split(' — ')[0]) and not k.startswith('crawl'): v30 = v30.split(' — ')[0]      # v10.30 줄 뒤의 설명은 뺌
    rows.append({'k': k, 'now': now, 'v': verdict(now), 'first': first if k in rer and first != now else '', 'why': why, 'v30': v30, 'v30v': verdict(v30) if v30 else '—'})
cnt = collections.Counter(r['v'] for r in rows); cnt30 = collections.Counter(r['v30v'] for r in rows if r['v30'])
FIX = J('fixed_v1031.json', []); LEFT = J('left_v1031.json', [])
BADB = ('죽은 단추', '누를 수 없음', '요청에 로그인 토큰이 없음', '다시 열었더니 없음')
def btn(kind):
    b = J(f'btn_{kind}.json')
    if not b: return '(결과 없음)'
    return f"{'쪽' if kind == 'site' else '상태'} {b['units']} · 단추 {sum(b['total'].values()):,} · 문제 {sum(b['total'].get(x, 0) for x in BADB)}"
flows = []
for f in ('trade', 'mall', 'plaza', 'biz', 'proto'):
    d = J(f'flow_{f}.json', []); st = [x for fl in d for x in fl.get('steps', [])]
    flows.append((f, len(d), sum(1 for x in st if x.get('ok')), len(st), sum(1 for x in st if x.get('skip')), sum(1 for x in st if not x.get('ok') and not x.get('skip'))))
head = git('rev-parse', '--short', 'HEAD').strip(); ncommit = len(git('log', '--oneline', f'{BASE}..HEAD').split('\n')) - 1

L = []; w = L.append
w('# 80. 시안 기준 반영 — v10.31 (2026-10-10)')
w('')
w(f"원본 저장소 `SGB_DevDocker_Integrated_20261002` · master `{head}` · 판 `v10.31` · 바탕 v10.30(`{BASE}`) 뒤 커밋 {ncommit}개 · 시안 `SGB_Prototype_v10_31.html`(211화면)")
w(f"작성 {time.strftime('%Y-%m-%d %H:%M')} (한국 시각) · 매트릭스 · 검정 엑셀 `sgb/docs/SGB_Matrix_Verification_20261010_v10_31.xlsx` · 결과 파일 `qa/results_v10_31/`")
w('')
w('## 1. 지시 (10/10)')
w('')
w('> 「시안과 개발 다른 점을 찾아서 비교, 다른 것은 **시안을 기준으로** 개발 반영, 기능 반영, 검색 기능은 시안과 동일하게」')
w('')
w('작업 기준으로 정한 세 가지(지시 확인 답):')
w('')
w('1. 시안에 있는데 서버 자료 · 기능이 없는 구역 → **서버(DB · API)까지 만들어 시안대로**. 숫자를 지어내지 않고 실제 자료로 계산 · 저장합니다.')
w('2. 시안과 다른 **정책 · 금액 · 문구 → 시안대로** 바꿉니다(이미 정한 결정과 달라도 — 약관 · 안내 글 · 서버 규칙 · 시드 · 시험 기대값을 함께).')
w('3. 시안에 없고 개발에만 있는 기능 · 링크 → **남기고 시안 모양 안에 배치**합니다(법정 고지는 반드시 남김).')
w('')
w('그 밖의 규칙: 시안 스스로 동작하지 않는 곳(시안 결함)은 **시안이 뜻한 동작**으로 만들고, 시안이 개인정보 · 보안 규칙(실명 · 연락처 가림 · 권한 · 금칙 업종 · INV-11 자금 수탁 금지)을 어기는 곳은 **개발의 보호를 유지**하고 기록했습니다.')
w('')
w('## 2. 사용자 답 (10/10) — 반영 결과')
w('')
w('| # | 물음 | 답 | 반영 |')
w('|---|---|---|---|')
w('| 1 | 서버까지 시안대로 만들지 | **서버까지 시안대로** | 마이그레이션 D044 ~ D090 40개 · 새 API 154개 · 새 표 42 · 뷰 10(아래 5 · 6절) |')
w('| 2 | 시안과 다른 정책 · 금액 · 문구 | **정책도 시안대로** | 4절 표(전 → 후) — 약관 SERVICE 1.1(D062 · D090) · 서버 규칙 · 안내 글 · 시험 기대값 함께 |')
w('| 3 | 개발에만 있는 기능 | **유지** | 시안 모양 안에 배치(간단 서비스 등록 · 인기 상품 · 서류 확인 매물 · 개인 회원 가입 등 — 묶음별 결정 기록) |')
w('| 4 | 시안 「소개비 수령은 사업자 인증 후」와 개인 수령(INV-10R)의 충돌 | **개인 소개비 수령 가능 — 지금 방식 유지** | 사업자로 받는 소개비는 사업자 인증 뒤 성사된 거래부터(소급 안 함 · D060 ⑦), 그 전 거래 · 개인 회원은 개인으로. 운영 화면 「모든 회원이 사업자(A-00)」는 적용 안 함 |')
w('| 5 | 파트너 이용약관(PARTNER 1.0) 발행 | **발행 전부 가능** | 시행 2026-10-10 · 대상 = 입점한 파트너(대표 · 합류 직원 · terms.audience=PARTNER) 안에서 필수 → 다음 로그인 · 파트너센터 진입 때 재동의 · 일반 회원 가입 · 재동의 목록에는 나오지 않음(D090 audience · fn_term_applies · v_term_not_agreed · scripts/publish-terms.sh 기본 대상에 PARTNER). 선불 충전 범위의 「법무 검토 전 잠정」 표시는 약관 제3 ~ 5조로 시행 |')
w('| 6 | 퍼블리셔(외부 광고 송출) 실제 지급 | **닫아 둠** | `adx.payout_gate=closed` 그대로 — 정산서 · 장부까지만(D084). 선불 충전 상한(1회 · 잔액 200만 원) · 결제사 취소 기한 지난 충전의 환불 경로도 바꾸지 않음 |')
w('')
w('## 3. 묶음별 반영')
w('')
w('여섯 갈래의 차이 목록(`/home/claude/work/v3/inventory.json`)을 다섯 묶음이 각자 작업 사본(git worktree · 묶음 DB · 묶음 API 포트)에서 반영한 뒤 master 에 차례로 합치고(`52156de` w2 → `78a8fae` w3 → `7822fd7` w5 → `18b32c5` w6), 묶음끼리 맞출 점을 `6f49752`(통합 처리)에서 맞췄습니다. 결정 기록은 `/home/claude/work/v3/w*_decisions.md`, 묶음끼리 맞출 점은 `SHARED_NOTES.md` 에 있습니다.')
w('')
BUNDLE = [
 ('w1', '메인 · 검색 · 소개받기 · 소개광장 · AI · 광고 · 약관 · 로그인/가입 · 고객센터 · 이용안내 · 공통 틀', 'D044 ~ D049',
  ['검색을 시안과 같게 — 메인 히어로 검색칸 · 탭 7개 · 추천 칩이 검색 팝업을 열고 탭이 팝업 결과를 거름 · 검색어 집계(search_term_stats · 원문 저장 안 함) · 통합 결과 「등급 · 조회」 칸 · 제목 · 업종 일치 · 문장 읽기(지역 별칭 · 평수)를 팝업과 서버가 같게',
   '소개받기 목록 · 등록(4구역 · 이미지) · 요청 30일 자동 마감 · 공개 범위(전체 · 회원 · 인증 회원) · 회사명 비공개 · 예산 공개 · 받은 제안은 요청자만 · 제안 수락/거절 → 1:1 대화',
   '가입 5단계(유형 · 기업 인증 · 담당자 · 약관 · 관심 성향) + 가입 완료 화면 · 가입 전 사업자번호 조회(POST /signup/biz-check) · 휴업 · 폐업 거부(BIZ_CLOSED) · 법인등록번호 · 개인사업자 대표 = 가입자 · 비밀번호 영문 · 숫자 · 특수문자 10자',
   '로그인(로그인 유지 · 비밀번호 찾기 → 고객센터) · 1:1 문의(매물 줄 · 상대 · 날짜 구분 · 보내기 전 경고 · 거래 정보 · 소개 귀속) · 고객센터 문의 첨부(INQUIRY_ATTACHMENT) · 문의 유형 시안 4종 · 접수 번호 · FAQ 채널',
   '상품/서비스 등록 5구역 · 매물 수정(400 결함 · 반려 사유 · 걸린 표현 · 임시 저장 · 이력 · 남의 매물 수정 화면은 404) · 전체 목록 /listings 시안 표 · AI 자동 분류 · 신고하기 · 본문으로 건너뛰기 · 좁은 화면 머리줄']),
 ('w2', '소개장터 · 안심소개 · 소개창업 (+ v10.30 소개장터 메인에서 뺀 7구역)', 'D050 ~ D059',
  ['정책 14건(4절) — INV-2 귀속 시점 = 1:1 대화를 여는 순간 · 안심소개 부동산 노출료(A-07) · 검수 영업일 24시간 · 정렬 마감임박 · 소개비율 · 안심소개 3축 · 소개창업 4축 · 소개 신뢰도(fn_trust_score 4관 공통)',
   '소개장터 메인 7구역을 서버 자료로(키워드 · 업체 추천 · AI 추천 · 띠 광고 · 연결 사례 · 쪽 번호 · 제한 업종 표시 · 지역으로 찾기) · 급매 배지(URGENT_SALE) · 사진(LISTING_IMAGE) · 지역 · 거래 금액 칸',
   '베스트매칭 · 성공 사례(양측 동의 공개 · 이름 가림) · 피해 사례 게시판(연락처 가림 · 운영 숨김) · 안전거래(5,000만 원 이상 양측 합의 — 대금 보관 없음) · 공급자 · 추천',
   '소개창업 4축(창업 · 인력[도급만] · 운영지원 · 정보) · 빠른 매칭 · 중개사 보증 · 서류 · 중개사 매물 연동 화면은 「A-07 법무 회신 대기」로 닫음(운영 스위치)']),
 ('w3', '나의공간 + 소개몰', 'D060 ~ D065',
  ['요금제 — BASIC 무료 소개코드 0건 · 소개 제안 월 한도 10 / 50 / 무제한(DB 트리거) · 카드 혜택 줄 = 서버 값 · 사업자 수령 소급 안 함(개인 수령 유지) · 거래 상태 글 · 포인트 「원」 · 거래신용 점수',
   '나의공간 시안 화면 — 첫 화면 숫자 · 내 등록 리스팅(조회 · 관심 · 문의) · 정산(정산번호 · 부가세 · 세금계산서 발행 표시) · 계약 진행(초안 · 재촉) · 알림 종류별 수신 설정 · 소개자 프로필 · 등급 · 맞춤 요청(결함 F7) · 신고 · 이벤트 메뉴',
   '소개몰 — 오늘의 건강상품(특가 배너 · 순위 탭) · 많이 찾는 상품 · 배송 요청사항 · 반품 ①항목 ②사유 ③환불 예상 · 주문 시각 순서를 DB 가 지킴(D064 · 결함 F2) · 택배사 조회 · 성분 「자격 필요」 · 판매 약관 마크다운',
   '이용약관 SERVICE 1.1(D062 — 본인인증 단계 「무료 소개코드」 삭제 · 제4조 · 제9조) · 알림 event_code 잘림 결함(D063)']),
 ('w5', '파트너센터 · 제휴 영업', 'D070 ~ D079',
  ['리드 이용료 **후불 청구 → 선불 충전 잔액**(D070 — 이중 기입 원장 · 불변식 뷰 v_lead_cash_invariants · 보너스 먼저 차감 · 등급 할인 20% · 충전 1만 ~ 200만 원 · 유상 잔액 상한 200만 원 · 유상분만 결제 취소로 환불 · 잔액 0 이면 배정 후보에서 빠짐 · 자동 청구)',
   '상담 등급 8단계(S ~ C · 비율 100 ~ 12%) · 확인비용 계산 한 곳(fn_lead_fee_quote · D077) · 반려 한도(72시간 + 월 15%) · 상담 메모(덧붙이기만)',
   '서비스 등록 7단계 위자드(업종별 등록 방식 · 이사 견적 매트릭스 4×6 · 블록) + 간단 등록 유지 · 내용 수정은 재검수 · 노출 중단/재개 · 이행 보고 → 소비자 확인 = 성사 · 신뢰 배지',
   '회사 · 계정(변경 요청 · 직원 초대 · 브랜드 · 소재) · 성사 정산 · 세금계산서(D076) · 제휴 대시보드 6칸 · 추천상품 표지 · 구매 소식(이름 없음) · 전용 트랙 /partner/tracks · 파트너 이용약관 PARTNER 1.0']),
 ('w6', '운영 화면', 'D080 ~ D086',
  ['정산 「신청 → 승인 → 지급」(D080 — APPROVED 단계 · 승인자 ≠ 거래 당사자 · 지급 표시는 당사자만 · 새 정산은 REQUESTED 로만 D086) · INV-11 문장 고침',
   '등록 일시 정지(제한업종 · 금칙 반려 90일 3회 → 7일 · D082) · 검수 SLA 넘김 → 등록자 알림 · 목록 줄에서 바로 승인 · 사업자 반려 · 회원 정지(기록 지울 수 없음)',
   '경영 지표 「월 비용 · 활주로」(실제 매출 v_monthly_revenue − 입력한 월 비용 · D081) · 정책 항목 9줄(D083) · 관 축 · UI 유형 · 옮길 대상 미리보기 · 통합 현황(실제 DB · 라우트에서 셈)',
   '외부 송출 · 퍼블리셔 정산(D084 · 무효 클릭 필터 · 월 마감 · 원천징수 3.3% · 2인 원칙 · **지급 게이트 닫힘**) · 회원 · 사업자 개인정보 가림(목록 · 상세 · 서버 응답) · 비밀 설정 값 가림 · 다른 묶음 API 의 운영 화면(리드 이용료 · 세금계산서 · 변경 요청 · 성공 사례 · 피해 사례)']),
]
for code, scope, mig, items in BUNDLE:
    nc = len([l for l in git('log', '--oneline', f'{BASE}..HEAD').split('\n') if re.match(rf'^[0-9a-f]+ ({code}|{code.upper()})[ :]', l)])
    w(f'### {code} — {scope}')
    w('')
    w(f'마이그레이션 {mig} · 묶음 커밋 {nc}개 · 결정 기록 `/home/claude/work/v3/{code}_decisions.md`')
    w('')
    for it in items: w(f'- {it}')
    w('')
w('### 합침 · 통합 처리 (`6f49752` · D090)')
w('')
w('- 파일 용도 CHECK 하나로(LISTING_IMAGE · REQUEST_IMAGE · INQUIRY_ATTACHMENT · BROKER_DOC · PARTNER_MEDIA) · app.module 등록 · 코드 정의(codes.ts · 20_코드정의서) 다시 생성 · 「소개 신뢰도」(w2)와 「거래신용」(w3)은 같은 fn_trust_score')
w('- 이용약관 SERVICE 1.1 의 「바뀐 점」을 이용자 글로(무료 요금제 소개코드 없음 · 사업자 수령 기준일 · 영업일 24시간 · 부동산 노출료) · 파트너 이용약관 발행(audience) · 자동 충전 정기 작업 lead_cash_auto(30분)')
w(f"- 검정 중 고친 결함 {sum(1 for f in FIX if f.get('kind', '').startswith('결함'))}건(9절) · 매트릭스 도구의 읽기 한계 고침(교차 점검 상 16 · 중 4 → 0)")
w('')
w('## 4. 바뀐 정책 (전 → 후)')
w('')
w('근거는 모두 「10/10 시안 기준 지시」, 사용자 답이 있는 것은 그 답. 묶음 결정 기록의 줄을 한 표로 모았습니다(문구만 바뀐 것은 결정 기록에).')
w('')
w('| 영역 | 무엇 | 전 | 후 | 반영 |')
w('|---|---|---|---|---|')
POL = [
 ('요금제', 'BASIC 무료 소개코드', '월 1건(본인인증 1명당 · 10/1 결정)', '0건 — 필요하면 건당 30,000원 추가 발급', 'w3 D060 ① · 약관 1.1 제9조'),
 ('요금제', '소개 제안 월 한도', '베이직 10(세지 않음) · 나머지 무제한', '베이직 10 · 스탠다드 50 · 프로 무제한 — DB 가 지킴(422 PROPOSAL_QUOTA_EXCEEDED)', 'w3 D060 ①'),
 ('정산', '사업자로 받는 소개비', '인증 시점 구분 없음', '사업자 인증 뒤 성사된 거래부터(소급 안 함) · 그 전 거래 · 개인 회원은 개인 수령(INV-10R 유지 — 사용자 답 4)', 'w3 D060 ⑦ · 약관 1.1 제4조'),
 ('정산', '정산 단계', '신청 → 당사자 지급 표시(플랫폼은 승인하지 않음)', '신청 → **운영 승인(정산서 확인)** → 당사자 지급 표시 · 승인자 ≠ 거래 당사자 · 돈은 여전히 당사자끼리(INV-11)', 'w6 D080 · D086'),
 ('정산', '정산 상태 글', 'REQUESTED 「지급 대기」', '「승인 대기」 · 새 APPROVED 「승인됨 · 지급 대기」', 'w6 D080'),
 ('거래', 'INV-2 귀속 시점', '거래를 만들 때 유입 기록으로 판정', '1:1 대화를 여는 순간 소개코드 귀속을 찍고 거래가 그 값을 씀', 'w2 D056 ①'),
 ('거래', '거래 상태 글', '조건 협의 중 · 계약서 작성됨 · 분쟁 진행 중', '협의 중 · 계약 진행 · 분쟁', 'w3 D060 ⑥'),
 ('거래', '안전거래', '없음', '5,000만 원 이상 거래에서 양측 합의로 당사자 확인 · 분쟁 지원 · 기록 보존(대금 보관 없음)', 'w2 D053'),
 ('거래', '거래 후기', '내용 없이 등록 · 수정 불가', '별점 + 태그 또는 10자 이상(빈 후기 422) · 같은 거래 후기는 고쳐 씀', 'w1 D047'),
 ('안심소개', '부동산 소개비', '희망 소개비 · 약정 · 정산', '노출료(A-07) — 희망 소개비 받지 않음(422 RE_EXPOSURE_FEE) · 정산 줄 없음', 'w2 D056 ② · 약관 제8조 ③'),
 ('안심소개', '중개사 매물 연동 화면', '열림', '「A-07 법무 회신 대기」로 닫음(운영 스위치 mal.broker_sync.open)', 'w2 D056 ④'),
 ('관', '안심소개 · 소개창업 축', '2축 · 1축', '3축(기계 · 설비 · 시설 / 부동산 / 생활 · 금융 상담) · 4축(창업 · 인력[도급만] · 운영지원 · 정보)', 'w2 D056 ③ · D054'),
 ('검수', '검수 마감', '시간 약속 없음', '영업일 24시간(토 · 일 건너뜀 — 공휴일 표 없음) · 넘기면 등록자에게 알림', 'w2 D056 ⑤ · w6 D082 · 약관 제6조 ②'),
 ('검수', '등록 일시 정지', '없음', '제한업종 · 금칙 표현 반려 90일 3회 → 7일 새 등록 막음(422 POSTING_SUSPENDED) · 운영이 풂', 'w6 D082'),
 ('목록', '정렬', '소개비순 · 최신 · 인기', '+ 마감임박 · 소개비율(시안 순서) · 인기 유지', 'w2'),
 ('리드', '리드 이용료', '열람 때 후불 청구(PENDING → 월 청구)', '**선불 충전 잔액**에서 열람 때 바로 차감(BILLED · PREPAID · 보너스 먼저) · 잔액 부족이면 열람 막음(422 LEADCASH) · 배정 후보에서 빠짐', 'w5 D070 · 파트너 약관 제3 ~ 5조'),
 ('리드', '충전 · 보너스 · 환불', '—', '1회 1만 ~ 200만 원 · 유상 잔액 상한 200만 원 · 충전액의 20% 보너스 · 유상 잔액만 최근 충전부터 결제 취소로 환불 · 보너스 회수', 'w5 D070 (사용자 답 6 — 상한 그대로)'),
 ('리드', '반려 인정 · 무효', '청구에서 뺌', '확인비용을 잔액으로 환급(전환 전 후불분만 청구에서 뺌)', 'w5 D070'),
 ('리드', '등급 · 반려 한도', 'S ~ G 한 줄 · 72시간 1회', '8등급 S · A+ · A · A- · B+ · B · B- · C(100 ~ 12%) · 72시간 + 월 접수량의 15%', 'w5 D071'),
 ('약관', '파트너 이용약관', '없음', 'PARTNER 1.0 발행(시행 2026-10-10 · 파트너 대상 필수)', 'w5 D076 · D090 (사용자 답 5)'),
 ('약관', '이용약관 SERVICE', '1.0', '1.1 — 무료 소개코드 삭제 · 제4조 사업자 수령 기준일 · 제6조 ② 영업일 24시간 · 제8조 ③ 부동산 노출료 · 제9조 요금제', 'w3 D062 · w2 · D090'),
 ('가입', '가입 · 사업자 확인', '한 화면 · 가입 뒤 사업자 신청 때 조회', '5단계 · 가입 전 조회 · 휴업 · 폐업 거부 · 법인등록번호 필수 · 개인사업자 대표 = 가입자 · 비밀번호 조합 10자', 'w1 D049'),
 ('소개받기', '요청 마감 · 공개', '마감 없음 · 모두 공개 · 제안자 실명', '등록 30일 자동 마감 · 공개 범위(전체 · 회원 · 인증 회원) · 회사명 비공개 · 받은 제안은 요청자만 · 이름 첫 글자', 'w1 D044'),
 ('고지', '중개 고지 · 꼬리줄', '개발 문구', '시안 문구(전자상거래법 제20조 고지 + 등록자 책임) · 운영정책 링크 · 시안 순서', 'w1 D049'),
 ('고객센터', '1:1 문의', '개발 분류', '시안 4종(거래 · 정산 · 계정 · 사업자 인증 · 분쟁 · 신고) + 기타 · 접수 번호 Q-YYYYMMDD-XXXX · 답변 예정일 다음 영업일 · 첨부 3개', 'w1 D049'),
 ('운영', '운영(ADMIN) 권한', '메인 운영 · 자동검수 규칙 = SUPER 전용', 'ADMIN · SUPER (제한업종 · 정책 항목 · 관 오픈은 SUPER 그대로)', 'w6'),
 ('운영', '외부 송출 퍼블리셔 정산', '없음', '정산서 · 장부까지(원천징수 3.3% · 2인 원칙) · 실제 지급은 닫힘(adx.payout_gate=closed)', 'w6 D084 (사용자 답 6)'),
 ('표기', '포인트 단위 · 신뢰 점수', '「P」 · 없음', '「원」 · 소개 신뢰도 / 거래신용(같은 fn_trust_score — 거래신용은 후기 · 성사 더함 ×10)', 'w3 · w2 D059'),
]
for r in POL: w('| ' + ' | '.join(cell(x) for x in r) + ' |')
w('')
w('## 5. 새 API')
w('')
w(f"처리기(= API) **{OS.get('handlers')} → {S.get('handlers')}** (새 {len(new_api)} · OpenAPI {S.get('openapi_ops')}). 모듈별 새 API 수: " + ' · '.join(f'{k} {v}' for k, v in collections.Counter(a.get('module') for a in new_api).most_common()) + '.')
w('')
w('| 모듈 | 새 API |')
w('|---|---|')
for mod, n in collections.Counter(a.get('module') for a in new_api).most_common():
    lst = sorted(f"{a.get('method')} {a.get('path')}" for a in new_api if a.get('module') == mod)
    w(f"| {mod} ({n}) | {cell(' · '.join(lst))} |")
w('')
w('## 6. 새 표 · 뷰 · 함수')
w('')
w(f"표 **{OS.get('tables')} → {S.get('tables')}** · 뷰 **{OS.get('views')} → {S.get('views')}** · 함수 **{OS.get('functions')} → {S.get('functions')}** · 페이지(사용자 웹 + 운영 화면) {OS.get('site_pages')} + {OS.get('admin_pages')} → {S.get('site_pages')} + {S.get('admin_pages')}")
w('')
w('| 종류 | 새 이름 |')
w('|---|---|')
for kind, nm in (('TABLE', '표'), ('VIEW', '뷰')):
    lst = sorted(d['name'] for d in new_db if d.get('kind') == kind)
    w(f"| {nm} ({len(lst)}) | {cell(' · '.join(lst))} |")
w('')
w('기존 표에 더한 칸(주요): listings(deal_amount · summary · region_detail · listing_no · contact_hours · address · biz_info) · requests(region · quantity · visibility · closes_at · company_blind · budget_open · kind · photo) · conversations.attributed_code/at · settlements(approved_by/at · seq · tax_invoice_*) · lead_fees(settle_mode · bonus_part · paid_part) · partner_services(form_type · top_fee · referral_rate …) · categories(service_form · trust_label · partner_track) · subscription_plans.features · terms.audience · accounts.job_title · businesses(corp_reg_no · biz_type · biz_item · rejected_at/by) · hlt_orders.ship_memo · ingredients.needs_license.')
w('')
w('## 7. 마이그레이션')
w('')
w(f"**{OS.get('migrations', 88)} → {S.get('migrations')}** (새 {len(new_mig)}개 — 깨끗한 DB 에서 처음부터 한 번에 적용 확인 · 검정 DB `sgb_check` 도 같은 순서)")
w('')
w('| 묶음 | 마이그레이션 |')
w('|---|---|')
grp = collections.OrderedDict([('w1', r'^D04[4-9]'), ('w2', r'^D05'), ('w3', r'^D06'), ('w5', r'^D07'), ('w6', r'^D08'), ('합침', r'^D09')])
for g, rx in grp.items():
    w(f"| {g} | {cell(' · '.join(x for x in new_mig if re.match(rx, x)))} |")
w('')
w('## 8. 검정 결과')
w('')
w('실행 환경: API = 운영 방식 `dist/main.js`(3000) · 사용자 웹 = `next build` → `next start`(5174) · 운영 화면 = vite(5173) · PostgreSQL 16(개발 `sgb` · 검정 `sgb_check` · 광고 `sgb_ads`) · 메모리 7GB · CPU 2. 실패한 시험은 「실제 결함 / 시험이 새 화면 · 정책을 못 따라감 / 시험 자료 / 환경」으로 나눠, 결함은 고쳐 다시 빌드한 뒤, 시험 문제는 시험을 고친 뒤 다시 돌렸습니다(최종 = 다시 돌린 줄).')
w('')
w(f"| | v10.31 최종 | v10.30 최종 |\n|---|---|---|\n| 시험 줄 | {len(rows)} | {sum(1 for r in rows if r['v30'])} (같은 이름이 있는 줄) |\n| 통과 | {cnt.get('통과', 0)} | {cnt30.get('통과', 0)} |\n| 실패 | {cnt.get('실패', 0)} | {cnt30.get('실패', 0)} |\n| 확인 · 건너뜀 | {cnt.get('확인', 0)} · {cnt.get('건너뜀', 0)} | {cnt30.get('확인', 0)} · {cnt30.get('건너뜀', 0)} |")
w('')
w(f"- 버튼 체크: 사용자 웹(5역할) {btn('site')} / 운영 화면(역할별) {btn('bo')}")
w('- flow 점검(화면 · API · DB 를 잇는 이용 흐름): ' + ' · '.join(f"{f} 통과 {ok}/{n}" + (f"(건너뜀 {sk})" if sk else '') + (f" **실패 {bad}**" if bad else '') for f, _, ok, n, sk, bad in flows))
w(f"- 매트릭스: 화면 {S.get('screens_registry')}(구현 {S.get('screens_with_impl')} · 시안 {S.get('screens_with_proto')}) · 교차 점검 상 {S.get('issues', {}).get('상')} · 중 {S.get('issues', {}).get('중')} · 하 {S.get('issues', {}).get('하')}")
w('')
w('### 8-1. 마지막 정리에서 나눈 실패 (flow 11단계 · 버튼 「문제 3」 · 뜻밖의 404 3쪽 · 그림 비교 1)')
w('')
w('| 시험 · 단계 | 증상 | 나눔 | 처리 | 다시 돌린 결과 |')
w('|---|---|---|---|---|')
for r in [
    ('flow_trade T1-5 · T3-3 · T5-9', '약관 동의 줄 class · 부담 주체 · 요청 상세 틀', '시험이 새 화면(w1)을 못 따라감', '시험 고침', 'flow_trade 91 / 91'),
    ('flow_trade T4-9 (다시 돌릴 때 드러남)', '「거래 성사 확인」 뒤 결과 글이 곧바로 사라짐', '**실제 결함**(v10.31 시안 틀)', '확인 칸을 늘 두고 단추만 뺌 · 커밋 15ea55e · 다시 빌드', '〃'),
    ('flow_trade T6-4 · T7-3 · T7-9 (〃)', '관심 목록 · 내 신고 내역의 표 모양', '시험이 새 화면을 못 따라감', '시험 고침', '〃'),
    ('flow_trade T3-10 (〃)', '새 매물이 목록 1쪽에 없음', '시험 자료(같은 소개비 매물 9건 · 기본 소개비순)', '「최신」 정렬로 보고 60초 기억까지 기다림', '〃'),
    ('flow_trade T5-2 · T2-5 (〃)', '누른 지 27초 뒤 요청이 생김 · 서버 내려감', '환경(다른 사슬과 겹침 · 다시 빌드 순간)', '하나씩 다시 돌림 · 수화 뒤 채우게', '〃'),
    ('flow_mall M4-1 · M5-8 · M7-10', '반품 · 취소 신청 화면(① 항목 선택) · 배송지 삭제는 앞이 막혀 생긴 것', '시험이 새 화면(w3)을 못 따라감', '시험 고침', 'flow_mall 108 / 110(건너뜀 2)'),
    ('flow_plaza P1-3 → P1-6 · 8 · 9 · 12', '관 화면 축 단추 · 리드 이용료가 열람 때 선불 차감(BILLED)', '시험이 새 화면 · 정책(D070)을 못 따라감', '시험 고침', 'flow_plaza 80 / 81(건너뜀 1)'),
    ('flow_biz B1-5 · B4-3 → B4-7 · 8 · 13 · 16', '결제 수단 칸 · 입점 단계 칸 · 서비스 위자드 · 「검수대기 · 노출중」 · 잔액 0 이면 리드 수신 막힘', '시험이 새 화면 · 정책(W5 · D070)을 못 따라감', '시험 고침(간단 등록 · 시험 결제 충전)', 'flow_biz 77 / 77'),
    ('flow_proto S8-7 · S10-10', '파트너 첫 화면 「리드 이용료 잔액」 · 약관 표 11줄(파트너 이용약관 발행)', '시험이 새 시안 · 정책을 못 따라감', '시험 고침', 'flow_proto 139 / 140(건너뜀 1)'),
    ('flow_proto S10-11 (건너뜀이던 것)', '「시안에 이 화면이 없음」으로 건너뜀 — 시안은 v10.27(G-199)부터 약관 이름이 전문 화면 링크', '시험이 시안을 못 따라감', '실제로 눌러 봄(termsv · 조항 · 돌아가기)', '〃'),
    ('btn_site /biz/list 「예상 세액 보기」(guest · person)', '다시 열었더니 단추가 없음', '시험이 새 화면을 못 따라감 — 떠 있는 광고는 ✕ 를 누르면 그 세션 동안 숨음(제품 규칙)', '다시 열 때 숨김 표시를 지움', '8절 btn_site'),
    ('btn_site /partner/settlement 빈 글자 단추(intro)', '누를 수 없음(2.5초)', '시험이 새 화면을 못 따라감 — 접힌 「계좌 변경 · 인증」 안의 단추', '펼친 뒤 누름', '〃'),
    ('crawl_site /listings/{id}/edit 404(person · buyer · admin)', '남의 매물 수정 화면이 404', '시험이 새 화면을 못 따라감 — w1 이 매물 주인이 아니면 404 로 바꿈(의도)', '의도한 404 로 셈(없는 초대 5 + 남의 매물 수정 3)', '8절 crawl_site'),
    ('proto_pixel 1 / 2', '글자는 같은데 그림이 다른 12장 · 그 반대 1장', '시험(기대 목록)이 새 시안을 못 따라감 — v10.31 시안이 상태 꼬리표 · 계약 진행 막대 모양을 고침', '앞 판 · 새 판 그림을 나란히 보고 기대 목록 고침', 'proto_pixel 2 / 2'),
]: w('| ' + ' | '.join(cell(x) for x in r) + ' |')
w('')
w('### 8-2. 시험별 최종')
w('')
w('| 시험 | v10.31 판정 | v10.31 최종 결과 | v10.30 최종 결과 | 다시 돌린 까닭 |')
w('|---|---|---|---|---|')
for r in rows:
    w(f"| `{r['k']}` | {r['v']} | {cell(r['now'][:160])} | {cell(r['v30'][:110]) or '—'} | {cell(r['why'][:260])} |")
w('')
w('## 9. 고친 결함')
w('')
w('| 번호 | 구분 | 무엇 | 증상 | 한 일 | 파일 · 커밋 | 다시 돌린 결과 |')
w('|---|---|---|---|---|---|---|')
for f in FIX: w('| ' + ' | '.join(cell(f.get(x, '')) for x in ('no', 'kind', 'what', 'symptom', 'done', 'where', 'rerun')) + ' |')
w('')
w('시험 쪽(실제 결함이 아니라 시험이 v10.31 의 새 화면 · 정책을 못 따라가던 것)은 8절 「다시 돌린 까닭」과 엑셀 `11_고친것` 시트에 시험마다 적었습니다. 고치기 전 시험 사본은 `/home/claude/work/v3/out/logs/`.')
w('')
w('## 10. 남은 것')
w('')
if LEFT:
    w('| 번호 | 구분 | 무엇 | 까닭 | 할 일 |')
    w('|---|---|---|---|---|')
    for f in LEFT: w('| ' + ' | '.join(cell(f.get(x, '')) for x in ('no', 'kind', 'what', 'why', 'todo')) + ' |')
else: w('검정에서 남은 실패 없음.')
w('')
w('결정 · 확인이 남은 것(묶음 결정 기록에서):')
w('')
for x in [
    '공휴일 표가 없어 「영업일 24시간」 검수 마감이 토 · 일만 건너뜀(공휴일은 셈에 들어감).',
    '비밀번호 찾기 · 이메일 찾기는 메일 발송(SES)이 아직 없어 고객센터 「계정」 문의로 이음.',
    '알림톡 연동 전 — 리드 등급은 미판정이면 기준 단가 그대로(등급을 지어내지 않음).',
    '파트너 등급 기준(partner_grade_rules)은 표만 있고 값이 비어 있음 — 운영이 정해야 「다음 등급까지」가 계산됨.',
    '소개몰 특가 배너(hlt_promos)는 운영 편집 API · 화면이 없음(지금은 시안 견본 글 · is_sample 표시) · 택배사 조회 주소 5곳은 운영 확인 전(checked_at 빈칸).',
    '지역 코드 표(regions)는 시 · 도 17 만 — 소개자 지역은 「시 · 도 + 시 · 군 · 구」 글로 저장.',
    '시안 v10.31 안에 「선불 충전이 아니라 후불 청구」 안내 띠가 남아 있음(화면은 선불 — 시안 쪽 글 정리 필요).',
]: w(f'- {x}')
w('')
w('## 11. 위험')
w('')
w('| 위험 | 무엇이 걸리는가 | 지금 막아 둔 것 | 확인할 곳 |')
w('|---|---|---|---|')
for r in [
    ('선불 충전(리드 이용료) — 법무', '충전금을 미리 받아 두는 구조라 전자금융거래법의 선불전자지급수단 · 자금 보관(INV-11) 해당 여부가 문제될 수 있음. 시안 스스로의 안내문(「선불 충전은 만들지 않습니다」)과도 충돌', '자사 서비스 이용료(리드 열람 확인비용) 선납으로만 — 다른 회원 · 가맹점 사용 · 양도 · 현금화 불가 · 소개비는 잔액을 지나지 않음 · 유상 잔액 상한 200만 원 · 유상분 환불(결제 취소) · 이중 기입 원장 · 불변식 뷰 · 파트너 약관 제3 ~ 5조', '법무 검토(적용 제외 요건 · 약관 문구) — 결과에 따라 상한 · 환불 경로 조정'),
    ('선불 충전 — 세무', '충전 시점과 사용 시점 중 어느 때를 공급 시기로 볼지 · 보너스 잔액(등급 할인 20%)의 처리 · 세금계산서 발행 기준', '세금계산서는 달마다 유상 잔액 실사용액 기준(보너스 사용분 제외 · 공급가액/세액 분리) · 운영이 발행 표시만(국세청 전자 발행 연동 없음)', '세무 확인(공급 시기 · 보너스 = 에누리 여부 · 선수금 회계)'),
    ('결제사 취소 기한이 지난 충전의 환불', '유상 잔액 환불은 원래 결제 취소로만 — 기한이 지나면 돌려줄 길이 없음', '경로를 만들지 않음(사용자 답 6) · 실패하면 묶음을 되돌림(REFUND_RETURN)', '결제사 계약 조건 확인 뒤 계좌 환불 등 별도 경로 결정'),
    ('퍼블리셔 지급(외부 송출)', '광고주 돈을 받아 퍼블리셔에게 나눠 주는 흐름 — 자금 수탁(INV-11) · 전자금융 · 원천징수(3.3%) 신고', '지급 게이트 닫힘(adx.payout_gate=closed) — 정산서 · 장부까지만 · 2인 원칙', '법무 · 세무 확인 전에는 열지 않음'),
    ('정산 승인 단계', '운영이 「승인」하면 플랫폼이 돈을 관리하는 것으로 읽힐 수 있음', '승인은 정산서 확인일 뿐 돈 칸 없음 · 지급 표시는 당사자만 · 승인자 ≠ 거래 당사자 · 승인 기록 지울 수 없음 · v_inv11_violations 0줄', 'INV-11 문장 변경을 약관 · 운영 안내와 맞출 것'),
    ('안심소개 부동산 노출료(A-07)', '공인중개사법 — 중개보수 · 중개 행위로 볼지', '부동산은 소개비 · 정산 없음(노출료만) · 중개사 매물 연동 화면 닫음', 'A-07 법무 회신'),
    ('개인 소개비 수령', '사업자가 아닌 개인의 소개비 — 소득 구분 · 원천징수', '사업자 수령은 인증 뒤 성사분부터 · 개인 수령은 v10.28 방식 그대로(INV-10R)', '세무 확인(v10.28 개인 정산 결정과 같음)'),
]: w('| ' + ' | '.join(cell(x) for x in r) + ' |')
w('')
w('## 12. 다음 할 일')
w('')
for i, x in enumerate([
    '법무 검토 — 선불 충전(리드 이용료) 범위 · 약관 제3 ~ 5조 · 시안 안내 띠 문구 정리 / A-07 부동산 노출료 / 퍼블리셔 지급 게이트.',
    '세무 확인 — 선불 충전 공급 시기 · 보너스 처리 · 세금계산서 기준 / 개인 소개비 수령 원천징수 / 퍼블리셔 원천징수 신고.',
    '운영 값 입력 — 파트너 등급 기준(partner_grade_rules) · 등급별 보너스 비율(lead_cash_bonus_rates) · 택배사 조회 주소 확인 · 특가 배너 운영 편집(API · 화면) · 공휴일 표.',
    '외부 연동 — 알림톡(리드 등급) · PG 실 결제(충전 · 자동 청구 · 환불) · 메일(SES — 비밀번호 찾기) · 국세청 상태조회 실 키. 오픈을 막는 항목은 `sgb/docs` 의 오픈 차단 목록과 운영 화면 「오픈 체크리스트」.',
    '배포 — 이 판은 마이그레이션 40개(D044 ~ D090)가 더해짐: AWS 적용 전 `precheck.sh` → 백업 → `apply.sh` · 적용 뒤 파트너 이용약관 발행(`EFFECTIVE_FROM=… bash scripts/publish-terms.sh PARTNER`) · 이용약관 1.1 재동의 안내.',
    '시안 v10.31 쪽 정리 — 선불/후불 안내 띠 · SB-ADM-DSP-010 화면 키 · 파트너 하위 화면 이름(결정 기록의 「시안 결함」).',
], 1): w(f'{i}. {x}')
w('')
open(OUT, 'w', encoding='utf8').write('\n'.join(L) + '\n')
print('저장', OUT, '· 시험 줄', len(rows), dict(cnt), '· v10.30', dict(cnt30), '· 새 API', len(new_api), '· 새 표/뷰', len(new_db), '· 새 마이그레이션', len(new_mig))
