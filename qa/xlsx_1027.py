# v10.27(2026-10-09) — build_xlsx.py 가 exec 로 부릅니다(sheet · K · Q · defects · json 을 그대로 씀).  63 ~ 68 시트
#   결함 수정판: 서버 · DB(G-212 · 172 · 176 · 175 · 171 · 184 · 190 · 191 · 207 · 판매 약관) · 거래 흐름(G-193) · 가입 동의(G-188) · 나의공간(G-195) · 거래 당사자(G-213) · 정산(G-120)
#   · 한국 날짜(G-127 · G-215) · 구독 예약(G-189 ③) · 시안 결함(G-196 ~ G-200 · G-116 · G-130 · G-137) · 수화 오류(G-94) · G-114 가상 결제사
import json as _json, re as _re, os as _os
_R27 = K + '/../qa/results_v10_27/'
def _j27(*names):
    # 이번 판 — 작업 폴더(Q)의 최신 결과를 먼저, 없으면 결과 폴더(qa/results_v10_27 · 킷의 qa/results_v10_27)
    for f in names:
        for p in (f'{Q}/results_v10_27/{_os.path.basename(f)}', _R27 + _os.path.basename(f)):      # v10.28 부터 v10.27 때의 결과 파일로 고정
            try: return _json.load(open(p, encoding='utf-8'))
            except FileNotFoundError: pass
    return None
def _t27(*names):
    for f in names:
        for p in (f'{Q}/results_v10_27/{f}', _R27 + f):      # v10.28 부터 v10.27 때의 결과로 고정
            try: return open(p, encoding='utf-8').read()
            except FileNotFoundError: pass
    return None
_it = lambda d: (d if isinstance(d, list) else (d or {}).get('items', []))
_ok = lambda r: str(r.get('ok')) in ('True', 'true', '1') or r.get('ok') is True
def _gno(s):
    m = _re.match(r'G-?(\d+)', s)      # g130_check 은 「G130-1」 꼴
    return f'G-{m.group(1)}' if m else ''
_gs = lambda xs: ' · '.join(dict.fromkeys(g for g in (_gno(r['step']) for r in xs) if g))
_st = lambda r: '확인(건너뜀)' if r.get('skip') else ('통과' if _ok(r) else '실패')
_dt = lambda r: '' if _ok(r) and not r.get('skip') else str(r.get('detail', ''))[:300]

# 63. 이번 판 시험 — 결함 수정 확인 · 시안 · 앞 판과 비교 · G-114 가상 결제사 · 수화 오류 부하 · flow · Docker
rows = []
_fx = _it(_j27('fix_1027.json'))
for r in _fx:
    rows.append([f'서버 · DB v10.27 — 결함 수정 확인 (fix_1027.py · 실제 API · DB · 고치기 전에 실패를 봄)', _gno(r['step']) or r['step'].split(' ')[0], r['step'], _st(r), _dt(r)])
_fb = _it(_j27('fix_1027b.json'))
for r in _fb:
    rows.append([f'서버 v10.27 — {_gs(_fb) or "결함 수정 확인"} (fix_1027b.py · 실제 API · DB)', _gno(r['step']), r['step'], _st(r), _dt(r)])
_fu = _it(_j27('fix_1027b_ui.json'))
for r in _fu:
    rows.append(['실제 웹 v10.27 — 가입 동의 · 받은/보낸 문의 · 거래 다음 단계 · 내리기 · 나의공간 · 작은 결함 · 구독 예약 (fix_1027b_ui.py · 실제 로그인 · 클릭)', _gno(r['step']), r['step'], _st(r), _dt(r)])
SEC63C = {'C-1': 'C-1 운영 파트너사 상세 API', 'C-2': 'C-2 파트너 알림 「보기」', 'C-3': 'C-3 계약서 양식 전문', 'C-4': 'C-4 사기 예방 가이드', 'C-5': 'C-5 택배사 조회', 'C-6': 'C-6 운영 화면 파트너사 상세'}
for r in _it(_j27('fix_1027c.json')):
    rows.append(['실제 웹 · 운영 v10.27 — G-130 개발 반영 (fix_1027c.py · 실제 API · 실제 로그인 · 클릭)', SEC63C.get(r['step'][:3], ''), r['step'], _st(r), _dt(r)])
for r in _it(_j27('fix_1027_proto.json')):
    rows.append(['시안 v10.27 — 시안 결함 G-196 ~ G-200 · G-116 · 구독 결제 ③ (fix_1027_proto.py · 파일로 열어 눌러 봄)', _gno(r['step']), r['step'], _st(r), _dt(r)])
for r in _it(_j27('g130/g130_check.json', 'g130_check.json')):
    rows.append(['시안 v10.27 — G-130 「상세 · 보기」 단추가 화면을 엶 · 새 화면 8장 · 개발중 표시 (g130_check.py)', 'G-130', r['step'], _st(r), _dt(r)])
_px27 = _j27('proto_pixel.json') or {}
for r in _px27.get('items', []):
    rows.append(['시안 v10.27 — 앞 판(v10.26)과 그림으로 비교 (proto_pixel.py)', '', r['step'], _st(r), _dt(r)])
_pd27 = _j27('proto_diff.json') or {}
for r in _pd27.get('items', []):
    rows.append(['시안 v10.27 — 앞 판(v10.26)과 글자로 비교 (proto_diff.py)', '', r['step'], _st(r), _dt(r)])
# G-114 — 가상 결제사(실제 HTTP · 장애 주입)로 docs/62 9절 확인표 T-1 ~ T-10 을 봄. T 번호와 srv_billing.py 단계의 짝은 9절 표의 「하는 일 · 보는 것」에 맞춰 이 파일에서 정함
_T114 = [
 ('T-1', '정기결제 정상', ['1-3', '1-4', '1-7']),   # 1-24(키를 고친 뒤 청구)는 T-10 에만 — docs/62 9절 확인표와 대조(10/9)
 ('T-2', '거절 뒤 재시도 승인', ['1-1', '1-2', '1-5', '1-6']),
 ('T-3', '응답 유실', ['1-8', '1-9', '1-9b', '1-10', '1-11', '1-12', '1-15', '1-16', '1-17', '1-18']),
 ('T-4', '승인 직후 서버 종료', ['1-13', '1-14', '3-14', '3-15']),
 ('T-5', '같은 멱등 키 재전송', ['3-1', '3-2', '3-3', '3-4', '3-7', '3-8', '3-9']),
 ('T-6', '환불 정상', ['2-1', '2-2', '2-3', '2-5', '2-6']),
 ('T-7', '환불 완료 직전 DB 장애', ['2-16', '2-17']),
 ('T-8', '환불 거절(이미 취소 · 취소할 수 없는 결제)', ['2-7', '2-8', '2-9', '2-26']),
 ('T-9', '에러 코드 이름(코드로 판단)', ['1-21', '1-21b', '2-26']),
 ('T-10', '틀린 시크릿 키', ['1-22', '1-23', '1-24']),
]
_SEC114 = {'1': '정기결제', '2': '환불', '3': '중복 요청(멱등 키)', '4': '해지', '5': '스텁 방식', '6': '직접 결제', '7': '운영 알림'}
_bl = _it(_j27('srv_billing.json'))
_bk = {r['step'].split(' ')[0]: r for r in _bl}
for r in _bl:
    sid = r['step'].split(' ')[0]
    ts = [t for t, _, ss in _T114 if sid in ss]
    rows.append(['G-114 가상 결제사 확인(T-1 ~ T-10) — srv_billing.py · 가짜 결제사(실제 HTTP · 장애 주입) · 운영 방식 API 2대', ' · '.join(ts + [_SEC114.get(sid[:1], '')]).strip(' ·'), r['step'], _st(r), _dt(r)])
# G-94 — 목록 화면 수화 오류를 부하 속에서(창 6개 동시 · 3곳 × 180 = 540번) — hyd_load.sh 가 남긴 줄(창마다 · 쪽마다 30번)
_hl = _t27('hyd_load.txt')
if _hl:
    for i, l in enumerate([l for l in _hl.split('\n') if '오류' in l], 1):
        m = _re.match(r'^(\S+) (\S+) — 오류 (\d+) / (\d+)', l.strip())
        rows.append(['G-94 수화 오류(#418) — 부하 속에서 · 창 6개 동시 (hyd_load.sh → hyd_pages.py)', 'G-94', f'창 {(i - 1) // 3 + 1} — {m.group(1)} {m.group(2)} · {m.group(4)}번 새로 열기' if m else l.strip()[:120],
                     ('통과' if m.group(3) == '0' else '실패 — G-94') if m else '확인', l.strip()[:300]])
# flow 점검 — v10.27 기준으로 다시 맞춘 흐름(흐름마다 한 줄 · 단계는 54 · 55 시트)
_TG = {}
for _f in (_j27('findings_r2.json') or []):
    for _t in _f.get('tags', []): _TG[tuple(_t)] = _f['no']
for n, lab in (('trade', '실제 웹'), ('mall', '실제 웹'), ('plaza', '실제 웹'), ('biz', '실제 웹'), ('proto', '시안')):
    for f in (_j27(f'flow_{n}.json') or []):
        code = f['flow'].split(' ')[0]; st = f.get('steps', [])
        fail = [s for s in st if not s.get('ok') and not s.get('skip')]; skip = [s for s in st if s.get('skip')]
        nos = sorted({_TG[('flow', code, s['no'])] for s in fail + skip if ('flow', code, s['no']) in _TG})
        pas = sum(1 for s in st if s.get('ok') and not s.get('skip'))
        jd = ('실패 — ' + (' · '.join(nos) if nos else '미등록') + ' (단계 ' + ', '.join(str(s['no']) for s in fail) + ')') if fail else \
             (f'통과(건너뜀 {len(skip)} — 단계 ' + ', '.join(str(s['no']) for s in skip) + (' · ' + ' · '.join(nos) if nos else '') + ')') if skip else '통과'
        rows.append([f'flow 점검 v10.27 기준 — {lab} (flow_{n}.py · 단계는 54 · 55 시트)', code, f"{f['flow']} — {f.get('who', '')}", jd, f'단계 {len(st)} · 통과 {pas} · 실패 {len(fail)} · 건너뜀 {len(skip)}'])
try:
    for l in (_t27('docker_1027.txt') or '').split('\n'):
        if ': ' not in l: continue
        k, _, v = l.partition(': '); m = _re.search(r'(\d+) ?/ ?(\d+)', v)
        st = ('통과' if m and m.group(1) == m.group(2) else '확인') if m else ('통과' if _re.search(r'통과|ok|done|같음', v) else '확인')
        rows.append(['Docker 실구동(v10.27) — docker_set.sh', '', k, st, v[:300]])
except FileNotFoundError: pass
sheet('63_결함수정_시험_v10.27', ['묶음', '구역', '항목', '판정', '내용'], rows, {'묶음': 62, '구역': 26, '항목': 96, '내용': 70}, status_col=3)

# 64. G-114 — 결제사 확인표(docs/62 9절) T-1 ~ T-10 을 가상 결제사로
if _bl:
    _r64 = []
    for t, name, ss in _T114:
        got = [_bk[s] for s in ss if s in _bk]
        okn = sum(1 for r in got if _ok(r))
        _r64.append([t, name, ', '.join(ss), f'{okn} / {len(ss)}' + ('' if len(got) == len(ss) else f' (결과에 없는 단계 {len(ss) - len(got)})'),
                     ('통과(가상 결제사) — 실제 결제사 확인은 토스 테스트 키를 받은 뒤 · G-114' if okn == len(ss) else '실패 — G-114'),
                     '토스 테스트 키를 받으면 docs/62 9절 순서대로'])
    sheet('64_G-114_가상결제사_v10.27', ['확인표', '무엇(docs/62 9절)', '가상 결제사로 본 단계(srv_billing.py)', '통과', '판정', '실제 결제사'], _r64,
          {'확인표': 8, '무엇(docs/62 9절)': 40, '가상 결제사로 본 단계(srv_billing.py)': 50, '통과': 16, '판정': 60, '실제 결제사': 40}, status_col=4)

# 65. 시안 본체 — 앞 판(v10.26)과 그림 비교(화면마다)
if _px27.get('screens'):
    _chg = set(_pd27.get('changed') or []); _pxok = all(_ok(r) for r in _px27.get('items', []))
    _diff = set(_px27.get('diff') or [])
    sheet('65_시안_그림비교_v10.27', ['시안 키', '결과', '글자', '판정'],
          [[k, v.get('kind'), '바뀜(바뀌어야 할 화면)' if k in _chg else '같음',
            '정상 — 점 하나 같음' if v.get('kind') == '같음' else ('정상 — 바꾸기로 한 화면' + ('' if k in _chg else '(그림만 — G-137 견본 그림 · 그리는 때에 따라 다른 화면)')) if (k in _diff and _pxok) else '확인']
           for k, v in _px27['screens'].items()]
          + [[k, '새 화면(앞 판에 없음)', '새 화면', '정상 — 새 화면(fix_1027_proto.py · g130_check.py 가 봄)'] for k in (_pd27.get('added') or [])],
          {'시안 키': 18, '결과': 30, '글자': 26, '판정': 60}, status_col=3)

# 66. 이번 판의 결함 — 고친 것 · 남은 것(defects.json · 확장 점검 발견 목록 findings_r2.json 의 열림 표시)
_d27 = {x['no']: x for x in defects}
_o27 = {x['no']: x.get('open') for x in (_j27('findings_r2.json') or [])}
_OPEN27 = {'G-114': '열려 있음 — 실제 결제 키를 받은 뒤(가상 결제사로는 T-1 ~ T-10 확인 · 64 시트)',
           'G-147': '열려 있음 — v10.28(배송 처리 · G-194 와 함께)', 'G-194': '열려 있음 — v10.28(10/8 지시)',
           'G-214': '열려 있음 — 결정 필요(기본 v10.28)'}
_r66 = []
for no in ('G-212', 'G-213', 'G-214', 'G-215', 'G-216', 'G-116', 'G-120', 'G-130', 'G-137', 'G-114', 'G-147', 'G-194'):
    x = _d27.get(no)
    if not x: _r66.append([no, '', '', '(defects.json 에 없음)', '', '', '확인']); continue
    op = bool(_o27.get(no)) or str(x.get('what', '')).startswith('(열려 있음)') or bool(x.get('open'))
    chk = (_re.search(r'확인: ?(.*)$', x.get('fix', '')) or [None, ''])[1]
    _r66.append([no, x.get('area', ''), x.get('sev', ''), x['what'][:400], _re.sub(r' ?확인: ?.*$', '', x.get('fix', ''))[:400], chk[:200],
                 _OPEN27.get(no, '열려 있음 — 다음 판') if op else '수정 · 재검정 통과'])
sheet('66_결함목록_v10.27', ['번호', '영역', '등급', '무엇', '조치', '확인(시험)', '상태'], _r66,
      {'번호': 8, '영역': 28, '등급': 6, '무엇': 80, '조치': 70, '확인(시험)': 40, '상태': 44}, status_col=6)

# 67. 새 API · 표 — v10.26 매트릭스와 견줌(git 의 v10.26 태그)
try:
    import subprocess as _sp
    _old = _json.loads(_sp.run(['git', '-C', K + '/..', 'show', 'v10.26:sgb/docs/matrix/matrix.json'], capture_output=True, text=True).stdout)
    _new = _json.load(open(f'{K}/docs/matrix/matrix.json'))
    _ka = lambda a: (a['method'], a['path'])
    _oa = {_ka(a) for a in _old['apis']}
    rows = [['API', f"{a['method']} {a['path']}", a.get('controller', ''), a.get('roles', ''), ', '.join(a.get('screens_registry') or []), ', '.join((a.get('callers') or [])[:3]), '정상 — 화면 등록 · 호출하는 곳 있음' if (a.get('screens_registry') and a.get('callers')) else '확인']
            for a in _new['apis'] if _ka(a) not in _oa]
    _kd = lambda x: (x['kind'], x['schema'] + '.' + x['name'])
    _od = {_kd(x) for x in _old['db']}; _nd = {_kd(x) for x in _new['db']}
    rows += [['표', x['schema'] + '.' + x['name'], x.get('comment', '')[:120], '', '', f"열 {x.get('cols')} · 트리거 {x.get('triggers')}", '정상 — D031 ~ D034']
             for x in _new['db'] if _kd(x) not in _od]
    rows += [['표(지움)', x['schema'] + '.' + x['name'], x.get('comment', '')[:120], '', '', '', '정상 — 지움(G-172 · D031)' if x['name'] == '_t' else '확인 — v10.27 에서 없어짐']
             for x in _old['db'] if _kd(x) not in _nd]
    sheet('67_새API_새표_v10.27', ['갈래', '이름', '처리 · 설명', '권한', '화면(등록부)', '호출하는 곳 · 구조', '판정'], rows,
          {'이름': 52, '처리 · 설명': 50, '권한': 18, '화면(등록부)': 30, '호출하는 곳 · 구조': 50, '판정': 30}, status_col=6)
except Exception as _e: print('67 시트 건너뜀', _e)

# 68. 마이그레이션 D031 ~ D034
_M68 = [
 ('D031', '열린 결함 정리 — 기준 데이터(B900) 4줄 비움(G-212) · 빈 표 _t 지움(G-172) · 오픈 체크리스트 간주 모드 줄 · 연동 BROKER(G-176) · 제휴 링크 귀속(G-190) · 글 신고 · 3명이면 가림(G-191)', '없는 계정 · 사업자를 가리키던 4줄 → NULL'),
 ('D032', '구독 요금제 예약(G-189 ③) — subscriptions.next_plan_code · next_plan_at · subscription_invoices.plan_code · v_billing_due', '예약이 없으면 예전과 같은 청구'),
 ('D033', '한국 날짜(G-127) — 소개몰 주문번호의 날짜 · 제휴 클릭 집계 날짜 · 월 경계', '이미 만든 주문번호 · 지난 집계는 그대로'),
 ('D034', '정산 받는 사람 = 그 거래의 소개자(G-120 · INV-9R)', '받는 사람 ≠ 소개자인 정산 0 이어야 함(10/8 개발 DB 0)'),
]
_mig = sorted(_os.listdir(K + '/prisma/migrations'))
sheet('68_마이그레이션_v10.27', ['번호', '무엇', '쓰던 DB 에서', '파일', '판정'],
      [list(r) + [next((m for m in _mig if m.startswith(r[0])), '없음'), '정상 — 파일 있음' if any(m.startswith(r[0]) for m in _mig) else '실패 — 파일 없음'] for r in _M68],
      {'무엇': 80, '쓰던 DB 에서': 50, '파일': 44, '판정': 30}, status_col=4)
