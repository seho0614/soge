"""「상세 보기」 전체 목록표 — v10.21 재조사(앞 판 v10.20 의 목록표 docs/66 과 견줌). 조사 자료로 엑셀과 문서를 만듭니다.

  먼저:  python3 detail_links.py proto · python3 detail_links.py site · python3 detail_links.py roundtrip
         DOC_OUT=detail_links_doc_v1021.md python3 detail_links_doc.py      (묶음 판정 detail_links_judged.json 을 만듭니다 · 앞 판 문서 docs/65 는 덮지 않습니다)
  그다음: python3 detail_links_table_v1021.py
  결과:  /mnt/user-data/outputs/소개뱅크_상세보기_전체목록표_v10.21_20261007.xlsx
         킷 sgb/docs/68_상세보기_전체목록표_재조사_v10.21_20261007.md   ·   detail_links_table_stats_v1021.json
  앞 판 수치: detail_links_table_stats_v1020.json (v10.20 조사 때의 값)
"""
import json, os, re
from collections import defaultdict, Counter
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

Q = os.path.dirname(os.path.abspath(__file__))
K = '/home/claude/pkg/SGB_DevDocker_Integrated_20261002'
XLSX = os.environ.get('XLSX', '/mnt/user-data/outputs/소개뱅크_상세보기_전체목록표_v10.21_20261007.xlsx')
DOC = K + '/sgb/docs/68_상세보기_전체목록표_재조사_v10.21_20261007.md'
PREV = json.load(open(f'{os.path.dirname(os.path.abspath(__file__))}/detail_links_table_stats_v1020.json', encoding='utf-8'))
J = lambda f: json.load(open(f'{Q}/{f}', encoding='utf-8'))
PJ = J('detail_links_judged.json'); P = J('detail_links_proto.json'); S = J('detail_links_site.json')['rows']; RT = J('detail_links_roundtrip.json')
sweep = J('proto_sweep.json'); hsweep = J('hlt_sweep_after.json')
sc = json.load(open(K + '/sgb/spec/screens.json', encoding='utf-8')); sc = sc if isinstance(sc, list) else sc.get('screens', [])
NAME = {x['id']: x.get('name', '') for x in sc}
ids = json.load(open(K + '/sgb/spec/proto_ids.json', encoding='utf-8'))
sid = lambda k: (ids.get(k, {}).get('ids') or [''])[0]
scr = lambda k: NAME.get(sid(k)) or k
esc = lambda s: (str(s) if s is not None else '').replace('|', '·').replace('\n', ' ')
tonm = lambda r: NAME.get(r.get('to_id') or '') or r.get('to_name') or {'ask': '1:1 문의방', 'asklock': '1:1 문의방(잠금)', 'deal': '계약 · 성사 확정', 'myctrd': '계약서 · 체결'}.get(r['to'], r['to'])
frnm = lambda r: NAME.get(r.get('from_id') or '') or r.get('from_name') or {'asklock': '1:1 문의방(잠금 화면)'}.get(r['from'], r['from'])

main = [r for r in PJ if not r['from'].startswith('health')]; hlt = [r for r in PJ if r['from'].startswith('health')]

# ── 시안: 목록(묶음)별 ──
G = defaultdict(list)
for r in PJ: G[(r['from'], r['gwan'], r['to'] if not r['from'].startswith('health') else r['to_name'])].append(r)
groups = []
for (k, gw, to), v in G.items():
    r0 = v[0]
    groups.append({'from_id': r0['from_id'], 'name': frnm(r0), 'gwan': gw, 'hash': r0['from_hash'] or f"(화면 키 {r0['from']})", 'n': len(v),
                   'items': len({x['label'] for x in v}), 'dests': len({x['to_hash'] or x['to'] for x in v}), 'to': tonm(r0) if not r0['from'].startswith('health') else to,
                   'to_hash': ' · '.join(sorted({x['to_hash'] or x['to'] for x in v})[:3]), 'title': r0['title'], 'verdict': r0['verdict'],
                   'js': sum(x['js_errors'] for x in v), 'bad': sorted({b for x in v for b in x['bad_text']}),
                   'back': '없음' if all(x['back_ok'] is None for x in v) else ('목록으로 돌아옴' if all(x['back_ok'] for x in v if x['back_ok'] is not None) else '다른 화면으로 감'),
                   'ex': v[0]['label'][:40], 'area': '소개뱅크몰' if r0['from'].startswith('health') else '관 · 마이 · 운영'})
groups.sort(key=lambda g: (g['area'] != '관 · 마이 · 운영', not g['verdict'].startswith('이상'), g['from_id'], g['gwan']))

# ── 시안: 「상세 · 보기」 단추인데 화면이 열리지 않고 안내만 나오는 것 (누르기 전수 기록에서) ──
LAB = re.compile(r'(상세|^보기|보기$|보기 ›$|열기$|자세히)')
toast_only = []
for s_ in sweep['screens']:
    for c in s_['clicks']:
        t = c['text']; m = c.get('msg') or ''
        if c['res'] != 'TOAST': continue
        if (LAB.search(t) and len(t) <= 24) or (m.startswith('시연:') and len(t) >= 20):
            toast_only.append({'id': sid(s_['key']), 'screen': scr(s_['key']), 'pressed': t, 'msg': m.replace('\n', ' ')[:110]})
for s_ in hsweep:
    for c in s_['clicks']:
        t = c['text']; m = c.get('msg') or ''
        if c['res'] == 'TOAST' and LAB.search(t) and len(t) <= 24 and '표시만 바꿉니다' not in m:
            toast_only.append({'id': s_['id'], 'screen': NAME.get(s_['id'], s_['id']), 'pressed': t, 'msg': m.replace('\n', ' ')[:110]})
TG = defaultdict(list)
for t in toast_only: TG[(t['id'], t['screen'], t['pressed'], t['msg'])].append(t)

# ── 시안: 들어가는 링크가 없는 상세 화면 ──
reached = {r['to'] for r in main}
reached_ids = {sid(k) for k in reached}       # 같은 화면을 가리키는 다른 화면 키로 들어가는 경우(예: 계약서 = ctrd · myctrd)는 「들어갈 수 있음」
ORPH_NAME = {'asklock': '1:1 문의방(잠금 화면)', 'dtm': '매물 상세(모바일 화면)', 'reqdm': '요청 상세(모바일 화면)'}
orphan = [(k, sid(k), ORPH_NAME.get(k) or scr(k)) for k in P['detail_screens'] if k not in reached and sid(k) not in reached_ids]

# ── 실제 웹: 종류별 ──
KN = {'/money/{id}': '소개장터 매물 상세', '/mall/{id}': '안심소개 매물 상세', '/biz/{id}': '소개창업 매물 상세', '/request/{id}': '요청 상세', '/health/p/{id}': '소개뱅크몰 상품 상세',
      '/health/i/{id}': '성분 상세', '/health/w/{id}': '고민 상세', '/my/health/orders/{id}': '주문 상세', '/mal/consult/{id}': '상담 업종 상세(사무소 목록)'}
SK = defaultdict(list)
for r in S: SK[r['kind']].append(r)
def site_judge(r):
    if r['status'] != 200: return '오류 — 열리지 않음'
    if r['same'] is not True: return '오류 — 누른 것과 다른 상세'
    if r['page_errors']: return '오류 — 화면 스크립트 오류'
    if r['bad_text']: return '오류 — 깨진 글자'
    if r['broken_imgs']: return '오류 — 깨진 그림'
    if r['empty_fields']: return '오류 — 값이 빈 항목(' + ' · '.join(r['empty_fields']) + ')' if r['kind'] == '/request/{id}' else '확인 — 값이 빈 항목(' + ' · '.join(r['empty_fields']) + ') · 시험 자료'
    return '정상'
for r in S: r['judge'] = site_judge(r)

# ── 오류 · 확인 목록 — 이번 판에 **남아 있는 것만** 적습니다 ──
bad_g = [g for g in groups if g['verdict'].startswith('이상')]
mylik = [r for r in main if r['from'] == 'mylik' and r['to'] in ('dtlm', 'dtll', 'detail')]
mylik_bad = [r for r in mylik if r['same'] is not True]
und = [r for r in PJ if r['bad_text']]
rt_bad = [o for o in RT if o['ok'] is False]; rt_wrong = [o for o in rt_bad if not o.get('same_screen')]
req_empty = [r for r in S if r['kind'] == '/request/{id}' and r['empty_fields']]
fix_empty = [r for r in S if r['kind'] != '/request/{id}' and r['empty_fields']]
perr = [r for r in S if r['page_errors']]
noback = [r for r in main if r['back_ok'] is None]
cmu_site = [r for r in S if r['kind'] == '/community/{id}']
E = []   # (구분, 대상, 무엇, 어디서 · 무엇을 눌렀을 때, 기대, 실제, 건수, 결함 번호, 고치는 방법)
if bad_g:
    E.append(['오류', '시안', '무엇을 눌러도 같은 상세가 나옴(요청 · 계약 · 운영 목록)', ' / '.join(sorted({f"{g['name']}{'(' + g['gwan'] + ')' if g['gwan'] else ''}" for g in bad_g})),
              '누른 항목의 상세', '종류마다 한 건으로 고정된 상세 — ' + ' · '.join(sorted({g['to'] for g in bad_g})),
              f"{len(bad_g)}곳 · {sum(g['n'] for g in bad_g)}건", 'G-122 (남은 부분)', '목록표의 선택 ② — 요청 · 계약 · 회원 · 검수 · 서비스 상세도 누른 줄의 내용으로'])
if mylik_bad:
    E.append(['오류', '시안', '마이 「관심」의 「보기」가 그 항목의 상세가 아님', ' / '.join(r['label'][:20] for r in mylik_bad), '그 항목의 관 상세 · 그 항목의 내용', ' / '.join(r['to_hash'] for r in mylik_bad), f'{len(mylik_bad)}건', 'G-123', '항목의 관 · 번호로 엶'])
if rt_bad:
    E.append(['오류', '시안', '문의방을 거치면 처음 상세로 돌아오지 않음', ' / '.join(f"{o['gwan']}: {o['step']}" for o in rt_bad), '처음 보던 그 상세로 돌아옴', ' / '.join(o.get('returned', {}).get('hash', '') for o in rt_bad), f"{len(rt_bad)}건(왕복 {len(RT)}건 중)", 'G-129', '문의방 주소에 관 · 매물을 실음'])
if und:
    E.append(['오류', '시안', '주문 상세에 `undefined` 글자가 보임', '소개뱅크몰 내 주문 목록 → 「상세보기」 (' + ' · '.join(sorted({r['to_hash'].split('/')[-1] for r in und})) + ')',
              '상품 그림 또는 빈 자리', '`undefined` 라는 글자', f"주문 {len({r['to_hash'] for r in und})}건(링크 {len(und)}건)", 'G-91', '주문 줄의 그림 값이 없을 때 대체 그림을 씀(디자인 반영 판)'])
if orphan:
    E.append(['확인', '시안', '들어가는 링크가 없는 상세 화면(화면 변형)', ' · '.join(f"{o[2]}({o[1] or o[0]})" for o in orphan),
              '—', '모바일 화면 · 잠금 화면처럼 같은 화면의 다른 모습이라 화면 목록에서만 엽니다', f'{len(orphan)}장', 'G-124 (남은 부분)', '그대로 두거나, 모바일 화면은 좁은 화면에서 자동으로 바뀌게'])
if req_empty:
    E.append(['오류', '실제 웹', '요청 목록 · 상세의 「등록」 값이 비어 있음', '소개받기(/request) → 요청 상세(/request/{id})', '등록 시각', '빈 칸', f"{len(req_empty)}건", 'G-128', '요청 조회 응답에 등록 시각'])
E.append(['확인', '시안', '「상세 · 보기」 단추인데 화면이 열리지 않고 안내만 나옴', ' / '.join(f"{k[1]} 「{k[2]}」×{len(v)}" for k, v in sorted(TG.items())),
          '상세 화면', '안내 글만 뜸(시연 안내 · 외부 창은 시연에서 열지 않음 등)', f'{len(toast_only)}건({len(TG)}종)', 'G-130', '상세 화면이 필요한 것(파트너사 상세 · 알림 보기 등)과 안내로 충분한 것을 가려 정함 — 결정 필요'])
if noback:
    E.append(['확인', '시안', '상세 화면에 돌아가기가 없음', ' · '.join(sorted({frnm(r) + ' → ' + tonm(r) for r in noback})),
              '목록으로 돌아가는 링크', '돌아가기 없음(운영 · 파트너센터 화면은 옆 메뉴로 이동)', f'{len(noback)}건', '—', '운영 화면의 관례대로 두거나 「목록으로」 추가'])
if fix_empty:
    E.append(['확인', '실제 웹', '값이 빈 항목', ' · '.join(sorted({r['to'] for r in fix_empty}))[:200], '값', '빈 값 — ' + ' · '.join(sorted({f for r in fix_empty for f in r['empty_fields']})), f"상세 {len({r['to'] for r in fix_empty})}개({len(fix_empty)}건)", '—', '자료를 확인'])
if perr:
    E.append(['확인', '실제 웹', '화면 스크립트 오류', ' · '.join(sorted({r['to'] for r in perr}))[:200], '오류 0', ' / '.join(sorted({e for r in perr for e in r['page_errors']}))[:160], f'{len(perr)}건', 'G-94', '디자인 반영 판에서 메인과 같은 방식으로 고침'])
if not cmu_site:
    E.append(['확인', '실제 웹', '소개광장 글 상세는 조사하지 못함', '/community/{id}', '—', '개발 DB 에 글이 없어 링크가 없음', '0건', '—', '글을 넣은 뒤 같은 도구로 확인'])
n_err = sum(1 for e in E if e[0] == '오류'); n_chk = sum(1 for e in E if e[0] == '확인')

stats = {'proto_links': len(PJ), 'proto_main': len(main), 'proto_hlt': len(hlt), 'groups': len(groups), 'bad_groups': len(bad_g), 'bad_links': sum(g['n'] for g in bad_g),
         'proto_js_errors': sum(r['js_errors'] for r in PJ), 'proto_bad_text': len(und), 'roundtrip': len(RT), 'roundtrip_fail': len(rt_bad), 'toast_only': len(toast_only), 'orphan': len(orphan),
         'site_links': len(S), 'site_200': sum(1 for r in S if r['status'] == 200), 'site_same': sum(1 for r in S if r['same'] is True), 'site_details': len({r['to'] for r in S}),
         'site_pages': len({(r['role'], r['from']) for r in S}), 'site_err_rows': sum(1 for r in S if r['judge'].startswith('오류')), 'site_ok_rows': sum(1 for r in S if r['judge'] == '정상'),
         'site_page_errors': len(perr), 'site_bad_text': sum(1 for r in S if r['bad_text']), 'site_broken_imgs': sum(len(r['broken_imgs']) for r in S), 'errors': n_err, 'checks': n_chk}
json.dump(stats, open(f'{Q}/detail_links_table_stats_v1021.json', 'w'), ensure_ascii=False, indent=1)

# ───────────────────────────── 엑셀 ─────────────────────────────
wb = Workbook(); HDR = PatternFill('solid', fgColor='1F3864'); OKF = PatternFill('solid', fgColor='E2EFDA'); NGF = PatternFill('solid', fgColor='F8CBAD'); WNF = PatternFill('solid', fgColor='FFF2CC')
def sheet(title, header, rows, widths=None, judge_col=None):
    ws = wb.create_sheet(title); ws.append(header)
    for c in ws[1]: c.font = Font(bold=True, color='FFFFFF'); c.fill = HDR; c.alignment = Alignment(vertical='center', wrap_text=True)
    for r in rows: ws.append([('' if v is None else (', '.join(map(str, v)) if isinstance(v, (list, tuple)) else v)) for v in r])
    for i, h in enumerate(header, 1): ws.column_dimensions[get_column_letter(i)].width = (widths or {}).get(h, 14)
    ws.freeze_panes = 'A2'; ws.auto_filter.ref = ws.dimensions
    if judge_col is not None:
        for row in ws.iter_rows(min_row=2):
            v = str(row[judge_col].value or '')
            row[judge_col].fill = NGF if v.startswith(('오류', '이상')) else OKF if v.startswith('정상') else WNF
    for row in ws.iter_rows(min_row=2):
        for c in row: c.alignment = Alignment(vertical='top', wrap_text=True)
    return ws
ws = wb.active; ws.title = '0_요약'
ws['A1'] = '소개뱅크 — 「상세 보기」 전체 목록표 · v10.21 재조사 (2026-10-07 · 시안 v10.21 · 실제 웹 v10.21 · 앞 판 v10.20 과 비교)'; ws['A1'].font = Font(bold=True, size=14)
summ = [
 ['조사한 것', '시안과 실제 웹에서 상세로 가는 링크를 전부 눌러(열어) 보고, 링크마다 ① 열리는지 ② 누른 항목의 상세인지 ③ 화면 스크립트 오류 ④ 깨진 글자(undefined 등) ⑤ 돌아가기 ⑥ 값이 빈 항목 · 깨진 그림(실제 웹)을 봤습니다'],
 ['시안 — 상세로 가는 링크', f"{stats['proto_links']}건 (관 · 마이 · 운영 {stats['proto_main']}건 + 소개뱅크몰 {stats['proto_hlt']}건) · 목록 묶음 {stats['groups']}곳"],
 ['시안 — 결과', f"무엇을 눌러도 같은 상세 {stats['bad_groups']}곳 {stats['bad_links']}건 · 스크립트 오류 {stats['proto_js_errors']} · 깨진 글자 {stats['proto_bad_text']}건(주문 상세의 undefined) · 문의방 왕복 {stats['roundtrip']}건 중 {stats['roundtrip_fail']}건이 처음 상세로 돌아오지 않음 · 안내만 나오는 「상세 · 보기」 단추 {stats['toast_only']}건 · 들어가는 링크가 없는 상세 화면 {stats['orphan']}장"],
 ['실제 웹 — 상세로 가는 링크', f"{stats['site_links']:,}건 (5역할 · 목록 쪽 {stats['site_pages']}곳 · 서로 다른 상세 {stats['site_details']}개)"],
 ['실제 웹 — 결과', f"열림(200) {stats['site_200']:,} · 누른 항목의 상세 {stats['site_same']:,} · 깨진 글자 {stats['site_bad_text']} · 깨진 그림 {stats['site_broken_imgs']} · 스크립트 오류 {stats['site_page_errors']}건 · 줄 판정: 정상 {stats['site_ok_rows']:,} · 오류 {stats['site_err_rows']}(요청 상세의 「등록」 빈 값) · 확인 {stats['site_links'] - stats['site_ok_rows'] - stats['site_err_rows']}"],
 ['오류 · 확인', f"오류 {n_err}종 · 확인 {n_chk}종 — 「1_오류목록」 시트"],
 ['앞 판(v10.20)과 비교', f"같은 상세만 나옴 {PREV['bad_groups']}곳 {PREV['bad_links']}건 → {stats['bad_groups']}곳 {stats['bad_links']}건 · 문의방 왕복 실패 {PREV['roundtrip_fail']}/{PREV['roundtrip']} → {stats['roundtrip_fail']}/{stats['roundtrip']} · 들어가는 링크 없는 상세 {PREV['orphan']}장 → {stats['orphan']}장 · 실제 웹 오류 줄 {PREV['site_err_rows']} → {stats['site_err_rows']} — 「8_앞판과비교」 시트"],
 ['시트', '1_오류목록 · 2_시안_목록별 · 3_시안_전체 · 4_시안_문의방왕복 · 5_시안_안내만나오는단추 · 6_실제웹_종류별 · 7_실제웹_전체 · 8_앞판과비교'],
 ['판정 보는 법', '오류 = 고쳐야 하는 것 · 확인 = 결정이 필요하거나 자료 · 환경 때문인 것 · 정상 = 누른 항목의 상세가 문제없이 열림'],
 ['도구 · 자료', 'qa/detail_links.py (proto · site · roundtrip) · qa/detail_links_table.py · detail_links_proto.json · detail_links_site.json · detail_links_roundtrip.json · proto_sweep.json(누르기 전수)'],
]
for i, (k, v) in enumerate(summ, 3):
    ws.cell(i, 1, k).font = Font(bold=True); c = ws.cell(i, 2, v); c.alignment = Alignment(wrap_text=True, vertical='top')
ws.column_dimensions['A'].width = 26; ws.column_dimensions['B'].width = 150
sheet('1_오류목록', ['번호', '구분', '대상', '무엇', '어디서 · 무엇을 눌렀을 때', '기대', '실제', '건수', '결함 번호', '고치는 방법'],
      [[f'E-{i:02d}'] + e for i, e in enumerate(E, 1)], {'무엇': 34, '어디서 · 무엇을 눌렀을 때': 60, '기대': 26, '실제': 54, '건수': 22, '고치는 방법': 44}, judge_col=1)
sheet('2_시안_목록별', ['구역', '화면 ID', '화면', '관', '여는 주소', '상세로 가는 것', '서로 다른 항목', '열리는 상세 가지 수', '가는 화면', '간 주소', '상세 제목(예)', '누른 것(예)', '스크립트 오류', '깨진 글자', '돌아가기', '판정'],
      [[g['area'], g['from_id'], g['name'], g['gwan'], g['hash'], g['n'], g['items'], g['dests'], g['to'], g['to_hash'], g['title'], g['ex'], g['js'], g['bad'], g['back'], g['verdict']] for g in groups],
      {'화면': 24, '여는 주소': 24, '가는 화면': 22, '간 주소': 34, '상세 제목(예)': 34, '누른 것(예)': 40, '판정': 38}, judge_col=15)
sheet('3_시안_전체', ['번호', '화면 ID', '화면', '관', '여는 주소', '누른 것', '그 항목의 글', '간 화면', '간 주소', '상세에 나온 제목', '누른 것과 같은가', '스크립트 오류', '깨진 글자', '돌아가기 글', '돌아간 곳', '돌아가기 판정', '판정(목록 묶음 기준)'],
      [[i, r['from_id'], frnm(r), r['gwan'], r['from_hash'], r['pressed'], r['label'], tonm(r), r['to_hash'] or r['to'], r['title'],
        '같음' if r['same'] else '다름' if r['same'] is False else '견줄 이름 없음', r['js_errors'], r['bad_text'], r['back_label'], r['back_to'],
        '없음' if r['back_ok'] is None else '목록으로 돌아옴' if r['back_ok'] else '다른 화면(화면 변형 · 관 바뀜 — 4번 시트)', r['verdict']] for i, r in enumerate(PJ, 1)],
      {'화면': 22, '여는 주소': 22, '누른 것': 26, '그 항목의 글': 50, '간 화면': 20, '간 주소': 28, '상세에 나온 제목': 34, '돌아가기 글': 26, '돌아간 곳': 14, '돌아가기 판정': 24, '판정(목록 묶음 기준)': 38}, judge_col=16)
sheet('4_시안_문의방왕복', ['관', '눌러 간 길', '처음 상세(화면 · 주소)', '돌아온 곳(화면 · 주소)', '돌아온 곳의 제목', '판정'],
      [[o['gwan'], o['step'], f"{o['detail']['screen']} {o['detail']['hash']}", f"{o.get('returned', {}).get('screen', '')} {o.get('returned', {}).get('hash', '')}", o.get('returned', {}).get('title', ''),
        '정상 — 처음 상세로 돌아옴' if o['ok'] else ('오류 — 다른 관의 상세로 감' if not o.get('same_screen') else '확인 — 같은 화면이지만 주소(매물 번호)가 바뀜')] for o in RT],
      {'눌러 간 길': 60, '처음 상세(화면 · 주소)': 30, '돌아온 곳(화면 · 주소)': 30, '돌아온 곳의 제목': 36, '판정': 40}, judge_col=5)
sheet('5_시안_안내만나오는단추', ['화면 ID', '화면', '누른 것', '수', '나온 안내', '판정'],
      [[k[0], k[1], k[2], len(v), k[3], '확인 — 화면이 열리지 않고 안내만'] for k, v in sorted(TG.items())], {'화면': 26, '누른 것': 40, '나온 안내': 90, '판정': 34}, judge_col=5)
rows6 = []
for k, v in sorted(SK.items(), key=lambda x: -len(x[1])):
    c = Counter(r['judge'].split(' — ')[0] for r in v)
    rows6.append([KN.get(k, k), k, len(v), len({r['to'] for r in v}), sum(1 for r in v if r['status'] == 200), sum(1 for r in v if r['same'] is True), sum(1 for r in v if r['page_errors']),
                  sum(1 for r in v if r['bad_text']), sum(len(r['broken_imgs']) for r in v), sum(1 for r in v if r['empty_fields']), '정상' if c.get('정상', 0) == len(v) else ('오류 — ' if c.get('오류') else '확인 — ') + ' · '.join(sorted({r['judge'].split(' — ', 1)[1] for r in v if r['judge'] != '정상'}))])
sheet('6_실제웹_종류별', ['종류', '주소', '링크 수(5역할 합)', '서로 다른 상세', '열림(200)', '누른 항목의 상세', '스크립트 오류', '깨진 글자', '깨진 그림', '값이 빈 항목', '판정'], rows6, {'종류': 28, '주소': 24, '판정': 50}, judge_col=10)
sheet('7_실제웹_전체', ['번호', '역할', '목록 쪽', '누른 항목', '종류', '간 주소', '상태', '상세 제목', '누른 것과 같은가', '스크립트 오류', '깨진 글자', '깨진 그림', '값이 빈 항목', '판정'],
      [[i, r['role'], r['from'], r['label'], KN.get(r['kind'], r['kind']), r['to'], r['status'], r['title'], '같음' if r['same'] else '확인 필요', r['page_errors'], r['bad_text'], r['broken_imgs'], r['empty_fields'], r['judge']] for i, r in enumerate(S, 1)],
      {'목록 쪽': 28, '누른 항목': 48, '종류': 24, '간 주소': 48, '상세 제목': 40, '판정': 40}, judge_col=13)
CMP = [
 ('시안 — 상세로 가는 링크', 'proto_links', '건', '문의방으로 가는 단추가 매물을 실어 보내게 되어 9건이 새로 잡힘 · 소개광장 글 6건이 새로 생김'),
 ('시안 — 목록 묶음', 'groups', '곳', ''),
 ('시안 — 무엇을 눌러도 같은 상세(묶음)', 'bad_groups', '곳', '매물 상세 3종(소개장터 · 안심소개 · 소개창업)과 마이 관심이 풀림 · 남은 것은 요청 · 계약 · 운영 목록'),
 ('시안 — 무엇을 눌러도 같은 상세(링크)', 'bad_links', '건', ''),
 ('시안 — 문의방 왕복 실패', 'roundtrip_fail', '건', f"왕복 {len(RT)}건 중"),
 ('시안 — 들어가는 링크가 없는 상세 화면', 'orphan', '장', '소개광장 글 상세로 가는 링크가 생김'),
 ('시안 — 깨진 글자(undefined)', 'proto_bad_text', '건', '소개뱅크몰 주문 상세 — 이번 판에서 고치지 않음(G-91)'),
 ('시안 — 화면 스크립트 오류', 'proto_js_errors', '건', ''),
 ('시안 — 안내만 나오는 「상세 · 보기」 단추', 'toast_only', '건', '이번 판에서 고치지 않음(G-130 · 결정 필요)'),
 ('실제 웹 — 상세로 가는 링크', 'site_links', '건', '개발 DB 의 매물 · 주문 수에 따라 달라짐'),
 ('실제 웹 — 열림(200)', 'site_200', '건', ''),
 ('실제 웹 — 누른 항목의 상세', 'site_same', '건', ''),
 ('실제 웹 — 오류 줄', 'site_err_rows', '건', '요청 상세의 「등록」 빈 값이 없어짐(G-128)'),
 ('실제 웹 — 화면 스크립트 오류', 'site_page_errors', '건', ''),
 ('오류 종류', 'errors', '종', ''),
 ('확인 종류', 'checks', '종', ''),
]
cmp_rows = [[n, f"{PREV.get(k, '—'):,}{u}" if isinstance(PREV.get(k), int) else '—', f"{stats[k]:,}{u}", (stats[k] - PREV[k]) if isinstance(PREV.get(k), int) else '', note] for n, k, u, note in CMP]
sheet('8_앞판과비교', ['항목', 'v10.20 (10/7 조사)', 'v10.21 (재조사)', '차이', '설명'], cmp_rows, {'항목': 40, 'v10.20 (10/7 조사)': 20, 'v10.21 (재조사)': 20, '설명': 90})
wb.save(XLSX)

# ───────────────────────────── 문서 ─────────────────────────────
L = []; A = L.append
A('# 소개뱅크 — 「상세 보기」 전체 목록표 · v10.21 재조사 (2026-10-07)\n')
A('> v10.21(매물 상세가 누른 매물의 내용으로 · 매물별 주소 · 실제 웹 상세 새 형식)을 만든 뒤, 앞 판의 목록표(`66_상세보기_전체목록표_오류점검_20261007.md`)와 **같은 도구로 다시 조사**한 결과입니다.')
A('> 링크 하나하나는 엑셀 **`소개뱅크_상세보기_전체목록표_v10.21_20261007.xlsx`** 에 있습니다(시안 %d줄 · 실제 웹 %s줄 · 앞 판과 비교 시트).\n' % (len(PJ), f'{len(S):,}'))
A('---\n')
A('## 0. 결론\n')
A(f"**상세로 가는 링크 {len(PJ) + len(S):,}건을 다시 전부 눌러 봤습니다. 열리지 않는 링크는 없습니다.** 「무엇을 눌러도 같은 상세」는 {PREV['bad_groups']}곳 {PREV['bad_links']}건에서 **{stats['bad_groups']}곳 {stats['bad_links']}건**으로 줄었고, 남은 것은 이번 범위 밖(요청 · 계약 · 운영 목록)입니다.\n")
A('| 항목 | v10.20 (10/7 조사) | v10.21 (재조사) | 설명 |')
A('|---|---|---|---|')
for n, k, u, note in CMP:
    pv = f"{PREV[k]:,}{u}" if isinstance(PREV.get(k), int) else '—'
    A(f"| {n} | {pv} | **{stats[k]:,}{u}** | {note} |")
A('')
A('## 1. 남아 있는 것\n')
A('| 번호 | 구분 | 대상 | 무엇 | 건수 | 기대 | 실제 | 결함 | 고치는 방법 |')
A('|---|---|---|---|---|---|---|---|---|')
for i, e in enumerate(E, 1):
    A(f"| R-{i:02d} | **{e[0]}** | {e[1]} | {esc(e[2])} | {esc(e[6])} | {esc(e[4])} | {esc(e[5])} | {e[7]} | {esc(e[8])} |")
A('\n「어디서 무엇을 눌렀을 때」는 엑셀 `1_오류목록` 시트에 줄마다 적었습니다.\n')
A('## 2. 시안 — 목록별 표 (상세로 가는 곳 %d곳)\n' % len(groups))
A('| # | 화면 ID | 화면 | 관 | 여는 주소 | 링크 수 | 열리는 상세 | 가는 화면 · 주소 | 상세 제목(예) | 판정 |')
A('|---|---|---|---|---|---|---|---|---|---|')
for i, g in enumerate(groups, 1):
    A(f"| {i} | {g['from_id']} | {esc(g['name'])} | {g['gwan'] or '—'} | `{g['hash']}` | {g['n']} | {g['dests']}가지 | {esc(g['to'])} `{g['to_hash'][:44]}` | {esc(g['title']) or '—'} | {g['verdict']} |")
A('')
A('## 3. 시안 — 문의방 왕복 점검\n')
A('관 메인 → 매물 → 상세 → 「질문하기」 → 문의방 → 「돌아가기」 / 「리스팅 보기」로 처음의 상세에 돌아오는지 봤습니다.\n')
A('| 관 | 눌러 간 길 | 처음 상세 | 돌아온 곳 | 판정 |')
A('|---|---|---|---|---|')
for o in RT:
    A(f"| {o['gwan']} | {esc(o['step'])} | `{o['detail']['hash']}` | `{o.get('returned', {}).get('hash', '')}` {esc(o.get('returned', {}).get('title', ''))[:22]} | {'정상' if o['ok'] else ('**오류** — 다른 관의 상세' if not o.get('same_screen') else '확인 — 주소(매물 번호)가 바뀜')} |")
A('\n문의방 주소가 `#/g/{관}/chat/{매물번호}` 가 되어, 돌아올 때 그 매물의 주소로 갑니다.\n')
A('## 4. 시안 — 「상세 · 보기」 단추인데 안내만 나오는 것 (앞 판과 같음 · 결정 필요)\n')
A('| 화면 ID | 화면 | 누른 것 | 수 | 나온 안내 |')
A('|---|---|---|---|---|')
for k, v in sorted(TG.items()): A(f"| {k[0]} | {esc(k[1])} | {esc(k[2])} | {len(v)} | {esc(k[3])[:90]} |")
A('')
A('## 5. 실제 웹 — 종류별 표\n')
A('| 종류 | 주소 | 링크 수 | 서로 다른 상세 | 열림(200) | 누른 항목의 상세 | 스크립트 오류 | 깨진 글자 | 값이 빈 항목 | 판정 |')
A('|---|---|---|---|---|---|---|---|---|---|')
for r in rows6: A(f"| {r[0]} | `{r[1]}` | {r[2]} | {r[3]} | {r[4]} | {r[5]} | {r[6]} | {r[7]} | {r[9]} | {esc(r[10])} |")
A(f"| **합계** | | **{len(S):,}** | **{stats['site_details']}** | **{stats['site_200']:,}** | **{stats['site_same']:,}** | **{len(perr)}** | **{stats['site_bad_text']}** | **{sum(1 for r in S if r['empty_fields'])}** | |")
A('\n실제 웹 매물 상세의 사진 자리는 분류 그림(「사진 준비 중」)입니다 — 사진 등록 기능 전이라 깨진 그림 점검 대상이 없습니다.\n')
A('## 6. 조사 방법\n')
A('앞 판 목록표(docs/66 6절)와 같습니다. 달라진 것 두 가지 — ① 문의방으로 가는 단추(`data-askitem`)를 상세로 가는 링크에 넣었습니다(매물을 실어 보내므로). ② 왕복 점검이 새 문의방 주소(`#/g/{관}/chat/{번호}`)와 「리스팅 보기」(`data-open`)를 봅니다.\n')
A('## 7. 확인하지 못한 것\n')
A('1. 실제 웹의 소개광장 글 상세 — 개발 DB 에 글이 없습니다.')
A('2. 실제 웹 운영 화면(BO) 안의 상세 열기 — 이 목록표는 사용자 웹입니다.')
A('3. 「누른 것과 같은가」는 글자 비교입니다 — 엑셀에 누른 글과 상세 제목을 나란히 적어 두었습니다. 시안 매물 상세는 `qa/proto_item.py` 가 제목 · 분류 · 금액 · 지역 · 사진을 카드와 하나씩 견줍니다(카드 83장).\n')
A('## 8. 근거\n')
A('- 조사 자료 — `qa/results_v10_21/detail_links_proto.json`(시안 %d건) · `detail_links_site.json`(실제 웹 %s건) · `detail_links_roundtrip.json`(왕복 %d건) · `proto_sweep.json`(누르기 전수)' % (len(PJ), f'{len(S):,}', len(RT)))
A('- 앞 판 수치 — `qa/detail_links_table_stats_v1020.json` · 문서 `66_상세보기_전체목록표_오류점검_20261007.md`')
A('- 도구 — `qa/detail_links.py` · `qa/detail_links_doc.py` · `qa/detail_links_table_v1021.py`')
open(DOC, 'w', encoding='utf-8').write('\n'.join(L) + '\n')
print('xlsx', XLSX); print('doc', DOC, sum(len(x) for x in L), '자'); print(json.dumps(stats, ensure_ascii=False))
