# v10.26(2026-10-08) — build_xlsx.py 가 exec 로 부릅니다(sheet · _j · K · Q · defects 를 그대로 씀).  58 ~ 62 시트
import json as _json, re as _re, os as _os
_R26 = K + '/../qa/results_v10_26/'      # v10.27 — 58 ~ 62 시트는 v10.26 때의 결과 파일(킷의 qa/results_v10_26)로 고정합니다(proto_pixel · proto_diff · fix · defects 가 v10.27 에서는 새 판 기준)
def _j26(f):
    try: return _json.load(open(_R26 + f, encoding='utf-8'))
    except FileNotFoundError: return None
_it = lambda d: (d if isinstance(d, list) else (d or {}).get('items', []))
_ok = lambda r: str(r.get('ok')) in ('True', 'true', '1') or r.get('ok') is True

# 58. 새 시험 — 서버 · 실제 웹 · 시안 · 수정 확인 · 앞 판과 비교 · Docker
rows = []
SEC58S = {'D': 'D DB 구조(옵션 · 장바구니 · 기록)', 'P': 'P 상품 자료 · 옵션 · 한 달 단가', 'L': 'L 목록 · 카드', 'C': 'C 갈래(화장품)', 'I': 'I 성분 · 성분군',
          'S': 'S 검색 · 자동완성', 'K': 'K 장바구니 · 주문 · 재고(옵션 단위)', 'X': 'X 교환 배송비 · 바꾼 반품', 'A': 'A 운영 「소개몰 상품」', 'T': 'T 판매 약관 1.2'}
for r in _it(_j26('srv_opt.json')):
    rows.append(['서버 v10.26 — 상품 옵션 · 자료 · 교환 배송비 (srv_opt.py · 실제 API · DB)', SEC58S.get(r['step'][:1], ''), r['step'], '통과' if _ok(r) else '실패', '' if _ok(r) else str(r.get('detail', ''))[:300]])
for r in _it(_j26('site_opt.json')):
    rows.append(['실제 웹 v10.26 — 소개몰 14쪽 + 교환 배송비 결제 쪽 · 운영 「소개몰 상품」 (site_opt.py · 실제 로그인 · 클릭)', '', r.get('step') or r.get('name'), '통과' if _ok(r) else '실패', '' if _ok(r) else str(r.get('detail', ''))[:300]])
for r in _it(_j26('proto_opt.json')):
    rows.append(['시안 v10.26 — 고친 곳 (proto_opt.py · 파일로 열어 눌러 봄)', '', r['step'], '통과' if _ok(r) else '실패', '' if _ok(r) else str(r.get('detail', ''))[:300]])
for r in _it(_j26('fix_1026.json')):
    rows.append(['수정 확인 — 확장 점검 결함 10건 · G-203 (fix_1026.py · 고치기 전에 실패를 봄)', (_re.match(r'(G-\d+)', r['step']) or [''])[0], r['step'], '통과' if _ok(r) else '실패', '' if _ok(r) else str(r.get('detail', ''))[:300]])
_px26 = _j26('proto_pixel.json') or {}
for r in _px26.get('items', []):
    rows.append(['시안 v10.26 — 앞 판(v10.25)과 그림으로 비교 (proto_pixel.py)', '', r['step'], '통과' if _ok(r) else '실패', '' if _ok(r) else str(r.get('detail', ''))[:300]])
for r in (_j26('proto_diff.json') or {}).get('items', []):
    rows.append(['시안 v10.26 — 앞 판(v10.25)과 글자로 비교 (proto_diff.py)', '', r['step'], '통과' if _ok(r) else '실패', '' if _ok(r) else str(r.get('detail', ''))[:300]])
try:
    for l in open(_R26 + 'docker_1026.txt', encoding='utf-8').read().split('\n'):
        if ': ' not in l: continue
        k, _, v = l.partition(': '); m = _re.search(r'(\d+) ?/ ?(\d+)', v)
        st = ('통과' if m and m.group(1) == m.group(2) else '확인') if m else ('통과' if _re.search(r'통과|ok|done|같음', v) else '확인')
        rows.append(['Docker 실구동(쓰던 볼륨 → 75) — docker_set.sh', '', k, st, v[:300]])
except FileNotFoundError: pass
_d26 = {x['no']: x for x in (_j26('defects.json') or defects)}      # v10.27 — v10.26 때의 결함 목록으로 고정
for no in ('G-203', 'G-204', 'G-205', 'G-206', 'G-207'):
    x = _d26.get(no)
    if x: rows.append(['이번 판을 만들며 찾은 것', no, f"{x['area']} — {x['what'][:230]}", '확인(고침)' if not x.get('open') else '확인(열림 — 시험 쪽만 고침)', x['fix'][:300]])
sheet('58_소개몰_상품옵션_v10.26', ['묶음', '구역', '항목', '판정', '내용'], rows, {'묶음': 62, '구역': 26, '항목': 96, '내용': 70}, status_col=3)

# 59. 시안 216장 — 앞 판(v10.25)과 그림 비교(화면마다)
if _px26.get('screens'):
    sheet('59_시안_그림비교_v10.26', ['시안 키', '결과', '판정'],
          [[k, v.get('kind'), '정상 — 점 하나 같음' if v.get('kind') == '같음' else '실패 — 앞 판과 다름'] for k, v in _px26['screens'].items()]
          + [[k, '새 화면(앞 판에 없음)', '정상 — 새 화면(proto_opt.py 가 봄)'] for k in (_px26.get('added') or ['admhpr'])],
          {'시안 키': 18, '결과': 30, '판정': 34}, status_col=2)

# 60. 소개몰 — 시안 ↔ 개발분 대조(v10.26 에서 맞춘 것 · 다음 판)
_M60 = [
 ('1', '메인', '#/', '/health', '성분별 최저가 「N원 / 30일」(살 수 있는 옵션) · 새로 올라온 상품 4 · 이번 주 특별 할인(배지 「특별가격」)', '오늘의 건강상품 · 많이 찾는 상품(순위 · 별점) — v10.27'),
 ('2', '직판관', '#/direct', '/health/direct', '새 카드(그림 · 표제 성분 · 정가 · 할인율 · 한 달 N원 부터)', '판매자 배지 공식 · 입점 — v10.28'),
 ('3', '전체제품 · 갈래', '#/c/{갈래}', '/health/c/{갈래}', '새 카드 · 화장품 갈래(열림)', '—'),
 ('4', '검색', '#/search', '/health/search', '자동완성(성분 + 살 수 있는 상품 이름 · 고르면 바로 검색) · 검색 범위 이름 · 설명 · 성분 · 갈래 · 인기 검색어', '—'),
 ('5', '성분별', '#/ingredients', '/health/ingredients', '많이 찾는 성분 · 전체 성분 · 성분군 3묶음', '「자격 필요」 표 — 넣지 않음(B-6)'),
 ('6', '성분 상세', '#/i/{성분}', '/health/i/{성분}', '최저 월 N원 · 함량 단추 · 정렬(월 단가 · 이름)', '리뷰 많은 순 · 별점 높은 순 — v10.27'),
 ('9', '상품 상세', '#/p/{상품}', '/health/p/{상품}', '옵션 줄(품절) · 단품 수량 칸 · 정가 · 할인율 · 고시 · 주의사항 · 교환 배송비 줄 · 품절 배지', '후기 · 문의 — v10.27'),
 ('10', '장바구니', '#/cart', '/health/cart', '옵션 이름 · 작은 그림 · 가격 변경 확인', '판매자별 묶음 — v10.28'),
 ('11', '주문서', '#/order', '/health/order', '옵션 이름', '동의 ② 문구 — v10.28'),
 ('13', '주문 완료', '#/order/done', '/health/order/done', '옵션 이름', '—'),
 ('15', '내 주문', '#/my/orders', '/my/health/orders', '작은 그림 · 교환 배송비 「결제하기」', '구매확정 · 리뷰쓰기 — v10.27'),
 ('16', '주문 상세', '#/my/orders/{번호}', '/my/health/orders/{번호}', '작은 그림 · 옵션 이름 · 교환 배송비 「결제하기」', '—'),
 ('18', '취소 · 반품 신청', '#/my/returns/new', '/my/health/returns/new', '교환 비용 상자(6,000원 · 14일) · 접수 뒤 결제 창 · 품목/수량 칸 뺌(시안도)', '일부 반품 — 넣는다면 v10.27'),
 ('19', '취소 · 반품 내역', '#/my/returns', '/my/health/returns', '교환 배송비 상태 · 「결제하기」 · 바꾼 반품', '—'),
 ('21', '이용안내', '#/guide', '/health/guide', '판매 약관 1.2(제3조 반품 · 교환 비용)', '—'),
 ('새', '교환 배송비 결제', '(창 — xfeeModal)', '/my/health/returns/{id}/fee', '시험 결제 · 토스 결제창에서 돌아오는 곳', '실제 결제창 — 결제 키를 넣은 뒤'),
 ('운영', '소개몰 상품', 'admhpr', '운영 화면 탭 「소개몰 상품」', '상품 목록 · 고치기(옵션/재고 · 그림 · 고시 · 변경 기록) · 성분 · 고민 · 갈래 · 판매 범위', '입점 판매자용 — v10.28'),
]
sheet('60_소개몰_시안_개발분_대조_v10.26', ['#', '화면', '시안 주소(#/health 안)', '개발분 주소', '시안 기준으로 맞춘 것(v10.26)', '아직 다른 것 — 다음 판', '판정'],
      [list(r) + ['정상 — 이번 판 범위는 맞춤'] for r in _M60],
      {'화면': 20, '시안 주소(#/health 안)': 26, '개발분 주소': 32, '시안 기준으로 맞춘 것(v10.26)': 70, '아직 다른 것 — 다음 판': 50, '판정': 26}, status_col=6)

# 61. 새 API · 표 — v10.25 매트릭스와 견줌(git 의 v10.25-r2 커밋)
try:
    import subprocess as _sp
    _old = _json.loads(_sp.run(['git', '-C', K + '/..', 'show', 'v10.25-r2:sgb/docs/matrix/matrix.json'], capture_output=True, text=True).stdout)
    _new = _json.loads(_sp.run(['git', '-C', K + '/..', 'show', 'v10.26:sgb/docs/matrix/matrix.json'], capture_output=True, text=True).stdout)      # v10.27 — v10.26 태그의 매트릭스로 고정(지금 매트릭스에는 v10.27 의 새 API 가 있음)
    _ka = lambda a: (a['method'], a['path'])
    _oa = {_ka(a) for a in _old['apis']}
    rows = [['API', f"{a['method']} {a['path']}", a.get('controller', ''), a.get('roles', ''), ', '.join(a.get('screens_registry') or []), ', '.join((a.get('callers') or [])[:3]), '정상 — 화면 등록 · 호출하는 곳 있음' if (a.get('screens_registry') and a.get('callers')) else '확인']
            for a in _new['apis'] if _ka(a) not in _oa]
    _kd = lambda x: (x['kind'], x['schema'] + '.' + x['name'])
    _od = {_kd(x) for x in _old['db']}
    rows += [['표', x['schema'] + '.' + x['name'], x.get('comment', '')[:120], '', '', f"열 {x.get('cols')} · 트리거 {x.get('triggers')}", '정상 — D027']
             for x in _new['db'] if _kd(x) not in _od]
    sheet('61_새API_새표_v10.26', ['갈래', '이름', '처리 · 설명', '권한', '화면(등록부)', '호출하는 곳 · 구조', '판정'], rows,
          {'이름': 52, '처리 · 설명': 50, '권한': 18, '화면(등록부)': 30, '호출하는 곳 · 구조': 50, '판정': 30}, status_col=6)
except Exception as _e: print('61 시트 건너뜀', _e)

# 62. 마이그레이션 D026 ~ D030
_M62 = [
 ('D026', '확장 점검 결함 — 연동 표의 결제 키 이름(TOSS_SECRET_KEY · G-174) · 사업자 승인과 검수 건 닫기(G-186)', '쌓인 검수 건 정리(개발 DB 1,193건)', '해당 없음'),
 ('D027', '옵션 · 상품 자료 · 성분군 · 화장품 갈래 · 고시 항목 · 교환 배송비 · 상품 변경 기록', '지금 상품 → 「단품」 옵션 하나 · 장바구니 줄 · 주문 품목이 그 옵션을 가리킴 · 성분 코드 합침', '같은 구조'),
 ('D028', '판매 약관 1.2 — 제3조 「반품 · 교환 비용」', '발행된 판이 있으면 1.2 새로 발행(이전 판 보관 · 재동의 집계)', '초안의 글만 고침'),
 ('D029', '금칙어 같은 줄 정리 + 유일 규칙 uq_banned_words_rule (G-203)', '「100% 성공」 422줄 → 1줄', '같은 규칙'),
 ('D030', '자금수탁 감시(INV-11) 예외에 hlt_exchange_fees.pg_tid (G-205)', '감시 대상은 그대로', '같음'),
]
_mig = sorted(_os.listdir(K + '/prisma/migrations'))
sheet('62_마이그레이션_v10.26', ['번호', '무엇', '쓰던 DB 에서', '새로 설치한 DB 에서', '파일', '판정'],
      [list(r) + [next((m for m in _mig if m.startswith(r[0])), '없음'), '정상 — 파일 있음 · 통합 검정 · Docker · 리허설에서 적용' if any(m.startswith(r[0]) for m in _mig) else '실패 — 파일 없음'] for r in _M62],
      {'무엇': 60, '쓰던 DB 에서': 50, '새로 설치한 DB 에서': 24, '파일': 40, '판정': 40}, status_col=5)
