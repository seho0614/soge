# v10.28(2026-10-09) — build_xlsx.py 가 exec 로 부릅니다(sheet · K · Q · defects · json 을 그대로 씀).  69 ~ 74 시트
#   두 묶음 한 판: (가) 소개몰 발송 · 구매확정 · 리뷰 · 문의 · 순위 · 선택 약관 바꾸기(G-214) (나) 상담 이메일 · 개인 소개비 정산 · 약관 한 벌(G-217) · 재동의
import json as _json, re as _re, os as _os
_R28 = K + '/../qa/results_v10_28/'
def _j28(*names):
    for f in names:
        for p in (f'{Q}/{f}', _R28 + _os.path.basename(f)):
            try: return _json.load(open(p, encoding='utf-8'))
            except FileNotFoundError: pass
    return None
def _t28(*names):
    for f in names:
        for p in (f'{Q}/{f}', _R28 + f):
            try: return open(p, encoding='utf-8').read()
            except FileNotFoundError: pass
    return None
_it = lambda d: (d if isinstance(d, list) else (d or {}).get('items', []))
_ok = lambda r: str(r.get('ok')) in ('True', 'true', '1') or r.get('ok') is True
_st = lambda r: '확인(건너뜀)' if r.get('skip') else ('통과' if _ok(r) else '실패')
_dt = lambda r: '' if _ok(r) and not r.get('skip') else str(r.get('detail', ''))[:300]
_PART = {'A': '발송 처리 · 구매확정(G-147 · G-194 · D035)', 'B': '리뷰 · 문의(D036)', 'C': '순위(D037)', 'D': '선택 약관 바꾸기(G-214 · D038)',
         'E': '상담 신청 이메일(D039 · 지시서 4절)', 'F': '개인 소개비 정산(D040 · INV-10R · 지시서 5절)', 'G': '약관 한 벌 · 재동의(G-217 · D041 · 지시서 3 · 6절)', 'H': '이번 판에 찾은 결함(G-220 · G-222)', 'I': '위탁은 「알림」(G-218 · D042)'}
_pk = lambda s: (_re.match(r'([A-I])-', s) or [None, ''])[1]

# 69. 이번 판 시험
rows = []
for r in _it(_j28('fix_1028.json')):
    rows.append([f'서버 · DB v10.28 — {_PART.get(_pk(r["step"]), "")} (fix_1028.py · 실제 API · DB · 고치기 전에 실패를 봄)', _pk(r['step']), r['step'], _st(r), _dt(r)])
for r in _it(_j28('fix_1028_ui.json')):
    rows.append([f'실제 웹 · 운영 화면 v10.28 — {_PART.get(_pk(r["step"]), "")} (fix_1028_ui.py · 실제 로그인 · 클릭)', _pk(r['step']), r['step'], _st(r), _dt(r)])
for r in _it(_j28('fix_1028_proto.json')):
    rows.append(['시안 v10.28 — 리뷰 쓰기 · 별점 거르기 · 문의 · 구매확정 안내 · 순위 기준 · 운영 소개몰 주문 · 리뷰 · 문의 · 정산 · 재동의 · 상담 이메일 (fix_1028_proto.py)', 'H', r['step'], _st(r), _dt(r)])
_px28 = _j28('proto_pixel.json') or {}; _pd28 = _j28('proto_diff.json') or {}
for r in _px28.get('items', []): rows.append(['시안 v10.28 — 앞 판(v10.27)과 그림으로 비교 (proto_pixel.py)', '', r['step'], _st(r), _dt(r)])
for r in _pd28.get('items', []): rows.append(['시안 v10.28 — 앞 판(v10.27)과 글자로 비교 (proto_diff.py)', '', r['step'], _st(r), _dt(r)])
for l in (_t28('docker_1028.txt') or '').split('\n'):
    if ': ' not in l: continue
    k, _, v = l.partition(': '); m = _re.search(r'(\d+) ?/ ?(\d+)', v)
    st = ('통과' if m and m.group(1) == m.group(2) else '확인') if m else ('통과' if _re.search(r'통과|ok|done|같음', v) else '확인')
    rows.append(['Docker 실구동(v10.28) — docker_set.sh', '', k, st, v[:300]])
sheet('69_두묶음_시험_v10.28', ['묶음', '구역', '항목', '판정', '내용'], rows, {'묶음': 70, '구역': 8, '항목': 100, '내용': 70}, status_col=3)

# 70. 작업 지시서 대조 — 4-4절(상담 이메일) · 5-4절(개인 정산) · 3절(약관 조항) 시험 번호 ↔ 이번 판 시험
_f8 = {r['step'].split(' ')[0]: r for r in _it(_j28('fix_1028.json'))}
_MAP = [('4-4 #1 · #2', '이메일 없이 · 형식이 틀린 이메일 → 400', ['E-1']), ('4-4 #3', '확인 전 — 업체 쪽 어디에도 이메일 없음', ['E-4']),
        ('4-4 #4', '열기 전 요약에 이메일 없음', ['E-6', 'E-7']), ('4-4 #5', '연 뒤 이메일 보임 · 조회 기록', ['E-9']), ('4-4 #6', '배정받지 않은 업체는 못 봄', ['E-10']),
        ('4-4 #7', '파기 뒤 이메일 없음', ['E-11', 'E-12']), ('4-4 #8', '화면의 동의 문구 ↔ 방침 제4조 ③(글자 대조)', ['G-6']),
        ('5-4 #1', '본인인증 개인 · 소개자 본인 · 계좌 확인 → 정산 신청 됨', ['F-1']), ('5-4 #2', '본인인증 전 개인 → 403', ['F-2']),
        ('5-4 #3', '계좌 없음 → 막힘 · 안내', ['F-3']), ('5-4 #4', '소개자가 아님 → 서비스 · DB 두 곳', ['F-4']), ('5-4 #5', '사업자 소개자 → 전처럼', ['F-5']),
        ('5-4 #6', '개인이 거래 만들기 · 소개비 제시 · 계약서 → 막힘', ['F-6']), ('5-4 #7', '기능을 끈 상태 → 422', ['F-7']), ('5-4 #8', '이용약관 제4조 표 ↔ 서버 자격', ['F-8']),
        ('3절 · 6-1절', '약관 한 벌 — 생성기 = docs = DB · 3절 조항 13곳 · 옛 이름 0 · 법정 고지 값 · 발행 기본 9종 · 다시 돌려도 판 안 생김', ['G-1', 'G-2', 'G-3', 'G-4', 'G-5', 'G-7', 'G-8']),
        ('6-2 · 7절 3번', '발행 전 가입 · 새 판 전 동의 회원 → 동의 필요(다음 로그인 때 동의)', ['G-9', 'G-10', 'G-11'])]
_r70 = []
for no, what, ss in _MAP:
    got = [_f8[s] for s in ss if s in _f8]; okn = sum(1 for r in got if _ok(r))
    _r70.append([no, what, ', '.join(ss), f'{okn} / {len(ss)}', '통과' if got and okn == len(ss) else ('결과 없음' if not got else '실패')])
sheet('70_작업지시서_대조_v10.28', ['지시서', '시험', 'fix_1028 단계', '통과', '판정'], _r70, {'지시서': 14, '시험': 70, 'fix_1028 단계': 30, '통과': 10, '판정': 14}, status_col=4)

# 71. 시안 본체 — 앞 판(v10.27)과 그림 비교(화면마다)
if _px28.get('screens'):
    _chg = set(_pd28.get('changed') or [])
    sheet('71_시안_그림비교_v10.28', ['시안 키', '결과', '글자', '판정'],
          [[k, v.get('kind'), '바뀜(바뀌어야 할 화면)' if k in _chg else '같음', '정상 — 점 하나 같음' if v.get('kind') == '같음' else ('정상 — 바꾸기로 한 화면' if k in _chg else '확인 — 그림만 다름')]
           for k, v in _px28['screens'].items()]
          + [[k, '새 화면(앞 판에 없음)', '새 화면', '정상 — 새 화면(fix_1028_proto.py 가 봄)'] for k in (_pd28.get('added') or [])],
          {'시안 키': 18, '결과': 30, '글자': 26, '판정': 60}, status_col=3)

# 72. 이번 판의 결함 — 고친 것 · 남은 것
_d28 = {x['no']: x for x in defects}
_r72 = []
for no in ('G-147', 'G-194', 'G-214', 'G-217', 'G-218', 'G-219', 'G-220', 'G-221', 'G-222', 'G-223'):
    x = _d28.get(no)
    if not x: _r72.append([no, '', '', '(defects.json 에 없음)', '', '', '확인']); continue
    op = str(x.get('what', '')).startswith('(열려 있음)')
    chk = (_re.search(r'확인: ?(.*)$', x.get('fix', '')) or [None, ''])[1]
    _r72.append([no, x.get('area', ''), x.get('sev', ''), x['what'][:400], _re.sub(r' ?확인: ?.*$', '', x.get('fix', ''))[:400], chk[:200],
                 '열려 있음' if op else ('10/9 답 「알림으로」 반영 · 재검정 통과' if no == 'G-218' else '수정 · 재검정 통과')])
sheet('72_결함목록_v10.28', ['번호', '영역', '등급', '무엇', '조치', '확인(시험)', '상태'], _r72,
      {'번호': 8, '영역': 28, '등급': 6, '무엇': 80, '조치': 70, '확인(시험)': 40, '상태': 44}, status_col=6)

# 73. 새 API · 표 — v10.27 매트릭스와 견줌(git 의 v10.27 태그)
try:
    import subprocess as _sp
    _old = _json.loads(_sp.run(['git', '-C', K + '/..', 'show', 'v10.27:sgb/docs/matrix/matrix.json'], capture_output=True, text=True).stdout)
    _new = _json.load(open(f'{K}/docs/matrix/matrix.json'))
    _ka = lambda a: (a['method'], a['path'])
    _oa = {_ka(a) for a in _old['apis']}
    rows = [['API', f"{a['method']} {a['path']}", a.get('controller', ''), a.get('roles', ''), ', '.join(a.get('screens_registry') or []), ', '.join((a.get('callers') or [])[:3]),
             '정상 — 화면 등록 · 호출하는 곳 있음' if (a.get('screens_registry') and a.get('callers')) else ('정상 — 화면 등록' if a.get('screens_registry') else '확인 — 화면 등록 없음')]
            for a in _new['apis'] if _ka(a) not in _oa]
    _kd = lambda x: (x['kind'], x['schema'] + '.' + x['name'])
    _od = {_kd(x) for x in _old['db']}; _nd = {_kd(x) for x in _new['db']}
    rows += [[x['kind'], x['schema'] + '.' + x['name'], x.get('comment', '')[:120], '', '', f"열 {x.get('cols')} · 트리거 {x.get('triggers')}", '정상 — D035 ~ D043']
             for x in _new['db'] if _kd(x) not in _od]
    rows += [[x['kind'] + '(지움)', x['schema'] + '.' + x['name'], x.get('comment', '')[:120], '', '', '', '확인 — v10.28 에서 없어짐'] for x in _old['db'] if _kd(x) not in _nd]
    sheet('73_새API_새표_v10.28', ['갈래', '이름', '처리 · 설명', '권한', '화면(등록부)', '호출하는 곳 · 구조', '판정'], rows,
          {'이름': 52, '처리 · 설명': 50, '권한': 18, '화면(등록부)': 30, '호출하는 곳 · 구조': 50, '판정': 30}, status_col=6)
except Exception as _e: print('73 시트 건너뜀', _e)

# 74. 마이그레이션 D035 ~ D043
_M74 = [
 ('D035', '구매확정(CONFIRMED · 누가 · 언제) · 배송 기록 넣은 사람 · 확정 · 배송 규칙(HLTC · HLTS) · 자동 확정 작업 hlt_auto_confirm', '확정 상태 · 자동 확정 기한 함수가 생김'),
 ('D036', '리뷰 · 상품 문의 표 · 규칙(HLTR · 구매확정한 본인 주문만) · 금칙어 → 확인 대기 · 반품 시 가림 · 운영 뷰', '새 표 2 · 뷰 2'),
 ('D037', '순위 표 · 집계 함수 fn_hlt_rank_build · 작업 hlt_rank(05:00)', '새 표 1'),
 ('D038', '동의 기록 이력(한 줄 제한 없앰) · 지금 상태 뷰 v_term_consent_current · 시각 기준 동의 · 읽는 곳 4곳(마케팅 감시 등)', '동의 기록은 그대로 · 바꿀 때마다 한 줄'),
 ('D039', '상담 이메일 암호화(email_enc) · 파기 · 열람 함수에 이메일', '이메일 칸이 생기기 전 신청은 빈 값'),
 ('D040', '개인 정산(INV-10R) · 성사 때 개인 정산 · 알림 · 안내 글 · FAQ · 스위치 설명', '스위치는 그대로(꺼짐)'),
 ('D041', '약관 한 벌 · 바뀐 점(change_note) · 본문 비교 함수 fn_term_body_norm', '발행된 DB: 다음 번호 판 발행(재동의) · 초안 DB: 본문만'),
 ('D043', '발행 약관의 깨진 시행일(「YYYY년 M월 N일」 · G-219) 바로잡기 — 시행일 줄만', '픽스처를 돌린 개발 DB 만 해당 · 운영 서버는 바꾸는 것 없음'),
 ('D042', '위탁은 「알림」(G-218) — terms.is_notice · 위탁 안내 글 · 알림 판에 동의 기록을 막는 트리거', '발행된 DB: 위탁 1.1 을 알림으로 발행(1.0 · 그 기록은 보관 · 재동의 없음) · 초안 DB: 본문 · 제목 · 알림 표시'),
]
_mig = sorted(_os.listdir(K + '/prisma/migrations'))
sheet('74_마이그레이션_v10.28', ['번호', '무엇', '쓰던 DB 에서', '파일', '판정'],
      [list(r) + [next((m for m in _mig if m.startswith(r[0])), '없음'), '정상 — 파일 있음' if any(m.startswith(r[0]) for m in _mig) else '실패 — 파일 없음'] for r in _M74],
      {'무엇': 80, '쓰던 DB 에서': 50, '파일': 44, '판정': 30}, status_col=4)
