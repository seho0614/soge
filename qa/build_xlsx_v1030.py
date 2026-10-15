"""v10.30 매트릭스 · 검정 엑셀 — 화면 · 백엔드 · API · DB 목록(sgb/docs/matrix/matrix.json — `npm run matrix` 가 코드 · DB 에서 다시 만든 것) + 이번 판의 검정 결과.

  python3 build_xlsx_v1030.py          → /mnt/user-data/outputs/SGB_Matrix_Verification_20261009_v10_29.xlsx   (XLSX_OUT=… 로 다른 곳에)

v10.28 까지의 엑셀(build_xlsx.py)은 지난 판들의 결과 폴더(qa/results_v10_18 ~ 27)를 읽어 판별 시트 74장을 이어 붙였습니다. 그 폴더들은 10/9 「zip/tar 에 문서는 필수 문서만」에 따라
묶음에 없으므로, 이 판은 **지금의 목록 + 이번 판의 결과**만 담습니다. 지난 판의 판별 시트는 그 판의 엑셀에 그대로 있습니다(v10.29 는 엑셀을 내지 않았습니다).
"""
import json, os, re, csv
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

K = '/home/claude/pkg/SGB_DevDocker_Integrated_20261002'
Q = os.path.dirname(os.path.abspath(__file__))
VER, VDATE = 'v10.30', '20261009'
OUT = os.environ.get('XLSX_OUT') or f"/mnt/user-data/outputs/SGB_Matrix_Verification_{VDATE}_{VER.replace('.', '_')}.xlsx"
m = json.load(open(K + '/sgb/docs/matrix/matrix.json', encoding='utf8'))
J = lambda f, d=None: (json.load(open(os.path.join(Q, f), encoding='utf8')) if os.path.exists(os.path.join(Q, f)) else d)

wb = Workbook(); wb.remove(wb.active)
HDR = PatternFill('solid', fgColor='1F3A5F'); HF = Font(bold=True, color='FFFFFF')
OKF = PatternFill('solid', fgColor='E2F0D9'); NGF = PatternFill('solid', fgColor='FBE3E4'); WNF = PatternFill('solid', fgColor='FFF2CC'); NEWF = PatternFill('solid', fgColor='DDEBF7')
def cell(v):
    if isinstance(v, (list, tuple)): v = ', '.join(map(str, v))
    if isinstance(v, dict): v = json.dumps(v, ensure_ascii=False)
    if isinstance(v, str) and len(v) > 2000: v = v[:2000] + ' …'
    return v
def sheet(title, heads, rows, widths=None, status=None, mark=None):
    ws = wb.create_sheet(title[:31]); ws.append(heads)
    for c in ws[1]: c.fill = HDR; c.font = HF; c.alignment = Alignment(vertical='center', wrap_text=True)
    for r in rows: ws.append([cell(v) for v in r])
    ws.freeze_panes = 'A2'
    if rows: ws.auto_filter.ref = ws.dimensions
    for i, h in enumerate(heads, 1): ws.column_dimensions[get_column_letter(i)].width = (widths or {}).get(h) or min(60, max(10, len(str(h)) * 2 + 2))
    for row in ws.iter_rows(min_row=2):
        for c in row: c.alignment = Alignment(vertical='top', wrap_text=True)
        if status is not None:
            v = str(row[status].value or '')
            row[status].fill = OKF if v.startswith(('통과', '같음', '있음', '그대로', '고침')) else NGF if v.startswith(('실패', '다름')) else WNF if v else PatternFill()
        if mark and mark(row):
            for c in row[:2]: c.fill = NEWF
    return ws

S = m['summary']
MNY = 'SB-MNY-MAIN-010'
final = []
def read_final(f):
    out = []
    if os.path.exists(os.path.join(Q, f)):
        for l in open(os.path.join(Q, f), encoding='utf8').read().split('\n'):
            if ': ' in l and not l.startswith('PART-'): k, v = l.split(': ', 1); out.append((k, v))
    return out
final = read_final('final_all.txt'); rer = dict(read_final('final_all_reruns_1030.txt'))
def verdict(k, v):
    if v.startswith('건너뜀'): return '건너뜀'
    if 'v10.29 그대로에서도' in v and '이 판에서만 실패 0' in v and '같은 단계 0개 실패' not in v: return '넘어옴'
    if v.startswith('통과 —'): return '통과'
    if re.search(r'실패 [1-9]|FAIL|✗|뚫림 [1-9]|exit=[1-9]|▲위험 [1-9]|Error|Traceback|Timeout|^실패|문제 [1-9]', v): return '실패'
    mm = re.search(r'(\d+)\s*/\s*(\d+)', v)
    if mm and mm.group(1) != mm.group(2) and not re.search(r'통과 \d+ / 실패 0', v): return '통과' if ('건너뜀' in v and '실패' not in v) else '확인'
    return '통과'
# 다시 돌린 시험은 다시 돌린 줄이 앞섭니다(처음 줄은 「처음 결과」 칸에 남김)
FIN = [[k, verdict(k, rer.get(k, v)), rer.get(k, v), (v if k in rer else '')] for k, v in final] + [[k, verdict(k, v), v, '(전수 검정 밖에서 따로 돌림)'] for k, v in rer.items() if k not in dict(final)]

site = J('site_mny.json', []); proto = J('proto_mny.json', []); ms = J('measure_mny_site.json', {}); mp = J('measure_mny_proto.json', {})
pdiff = J('proto_diff.json', {}); ppix = J('proto_pixel.json', {}); parts = J('money_assets.json', {}).get('parts', {})
FOUND = J('found_v1030.json', [])

# ── 00 요약 ──
rows = [
 ['판', f'{VER} ({VDATE[:4]}-{VDATE[4:6]}-{VDATE[6:]})', '바탕 = v10.29(시안 디자인 · 기능 반영 + 검색 시안대로)'],
 ['이번 판', '소개장터 메인을 2026-10-09 제시 디자인대로 — 시안(#/g/mny) + 실제 웹(/money) · 디자인 시트 토큰 · 글꼴은 소개장터에만', '지시: 「소개뱅크로 적용할 수 있도록 변환 · 이미지 그대로 사용」'],
 ['10/9 답', '① 시안 + 실제 웹 모양(DB 변경 없음) ② 지금 있던 구역은 디자인 아래에 남김 ③ 디자인 시트는 소개장터에만 ④ 글꼴도 소개장터에만', ''],
 ['화면(등록부)', S.get('screens_registry'), f"구현 연결 {S.get('screens_with_impl')} · 시안 연결 {S.get('screens_with_proto')}"],
 ['사용자 웹 쪽 · 운영 화면 쪽', f"{S.get('site_pages')} · {S.get('admin_pages')}", ''],
 ['백엔드 처리기(API)', S.get('handlers'), f"OpenAPI {S.get('openapi_ops')} — v10.29 의 새 API GET /search/suggest 를 화면 목록(SB-HOM-SCH-020)에 연결(이번 판)"],
 ['DB', f"표 {S.get('tables')} · 뷰 {S.get('views')} · 함수 {S.get('functions')}", f"마이그레이션 {S.get('migrations')} — 이번 판에서 바뀌지 않음"],
 ['매트릭스 미연결', len(m.get('issues') or []), '0 이어야 함'],
 ['새 검사 — 실제 웹(site_mny.py)', f"{sum(1 for r in site if r['ok'])} / {len(site)}", ''],
 ['새 검사 — 시안(proto_mny.py)', f"{sum(1 for r in proto if r['ok'])} / {len(proto)}", ''],
 ['자리 대조 — 그림 ↔ 시안', f"{mp.get('pass')} / {mp.get('count')} (±{mp.get('tol')}px · ±2px 안 {mp.get('within2')}곳 · 가장 큰 차이 {mp.get('worst')}px)", '159곳 = 그림의 모든 구역'],
 ['자리 대조 — 그림 ↔ 실제 웹', f"{ms.get('pass')} / {ms.get('count')} (±{ms.get('tol')}px · ±2px 안 {ms.get('within2')}곳 · 가장 큰 차이 {ms.get('worst')}px)", f"견주지 않은 곳 {len(ms.get('skipped') or {})} — 서버에 자료가 없어 실제 웹에 넣지 않은 구역"],
 ['그림 조각', f"{len(parts)}장 — 실제 웹 {sum(1 for v in parts.values() if v['site'])}장 · 시안 {len(parts)}장", '받은 그림의 그 자리와 점 하나까지 같음(cut_money.py --check)'],
 ['앞 시안(v10.28)과 견줌', f"글자가 달라진 화면 {pdiff.get('changed')} · 그림이 달라진 화면 {ppix.get('diff')} · 같은 화면 {ppix.get('same')}장", '소개장터 메인(list) 한 장만 달라야 함 — v10.29 는 시안을 바꾸지 않았습니다'],
 ['전수 검정', f"{len(FIN)}줄 — 통과 {sum(1 for r in FIN if r[1] == '통과')} · 이 판에서 생긴 실패 {sum(1 for r in FIN if r[1] == '실패')} · v10.29 에서 넘어온 실패 {sum(1 for r in FIN if r[1] == '넘어옴')}줄 · 확인 {sum(1 for r in FIN if r[1] == '확인')} · 건너뜀 {sum(1 for r in FIN if r[1] == '건너뜀')}", '10_전수검정 시트 — 「넘어옴」 = v10.29 그대로에서도 같은 단계가 실패(9-3 · 16_찾은것 F-12 · F-13)'],
 ['v10.29 에서 넘어온 것 · 찾은 것', f"{len(FOUND)}건 — 고침 {sum(1 for f in FOUND if f.get('state') == '고침')} · 소개장터만 고침 {sum(1 for f in FOUND if f.get('state') == '소개장터만 고침')} · 알림만 {sum(1 for f in FOUND if f.get('state') == '알림만')}", '16_찾은것 시트'],
 ['지난 판의 판별 시트', 'v10.13 ~ v10.28 의 판별 결과 시트(74장)는 그 판의 엑셀에 있습니다 — 이 엑셀은 지금의 목록 + 이번 판의 결과입니다', '지난 판의 결과 폴더는 묶음에 없음(10/9 「필수 문서만」)'],
]
sheet('00_요약', ['항목', '값', '비고'], rows, {'항목': 30, '값': 90, '비고': 60})

# ── 01 ~ 06 매트릭스 ──
sc = m['screens']
sheet('01_화면목록', ['화면 ID', '이름', '묶음', '주소', '역할', '구현 파일', '구현 주소', '시안 화면', '쓰는 API(등록부)', '쓰는 API(코드)', '이번 판'],
      [[s.get('id'), s.get('name'), s.get('group'), s.get('url'), s.get('roles'), s.get('impl'), s.get('impl_route'), s.get('proto'), s.get('apis_registry'), s.get('apis_code') or s.get('apis'),
        '바뀜 — 제시 디자인(시안 + 실제 웹)' if s.get('id') == MNY else ('API 연결 더함 — GET /search/suggest(v10.29 의 새 API)' if s.get('id') == 'SB-HOM-SCH-020' else '')] for s in sc],
      {'화면 ID': 18, '이름': 26, '주소': 24, '구현 파일': 44, '구현 주소': 22, '시안 화면': 14, '쓰는 API(등록부)': 50, '쓰는 API(코드)': 50, '이번 판': 34}, mark=lambda r: bool(r[10].value))
pg = m['pages']
sheet('02_쪽목록(실제웹·운영)', ['앱', '파일', '주소', '화면 ID', '부르는 API'], [[p.get('app'), p.get('file'), p.get('route'), p.get('ids'), p.get('calls')] for p in pg], {'파일': 52, '주소': 28, '화면 ID': 30, '부르는 API': 80})
be = m['backend']
sheet('03_백엔드목록', ['모듈', '메서드', '경로', '컨트롤러', '처리기', '파일', '역할', '게이트', '서비스'], [[b.get('module'), b.get('method'), b.get('path'), b.get('controller'), b.get('handler'), b.get('file'), b.get('roles'), b.get('gate'), b.get('services')] for b in be],
      {'경로': 40, '컨트롤러': 28, '처리기': 22, '파일': 44, '역할': 24, '서비스': 40})
ap = m['apis']
USED = {'GET /requests', 'GET /ads/serve', 'POST /ads/{}/impression', 'POST /ads/{}/click', 'GET /listings', 'GET /categories', 'GET /me/summary', 'GET /gwans', 'GET /footer-links', 'GET /site-settings/public', 'GET /search/suggest', 'GET /search'}
def used(a):
    k = f"{a.get('method')} {re.sub(r':[a-zA-Z]+|\{[^}]*\}', '{}', a.get('path') or '')}"
    return '소개장터 메인이 씀' if k in USED else ''
sheet('04_API목록', ['메서드', '경로', '모듈', '컨트롤러', '역할', '상태', '화면(등록부)', '부르는 곳', '표', '이번 판'],
      [[a.get('method'), a.get('path'), a.get('module'), a.get('controller'), a.get('roles'), a.get('status'), a.get('screens_registry'), a.get('callers'), a.get('tables'), used(a)] for a in ap],
      {'경로': 40, '컨트롤러': 32, '역할': 22, '화면(등록부)': 30, '부르는 곳': 50, '표': 40, '이번 판': 20}, mark=lambda r: bool(r[9].value))
db = m['db']
sheet('05_DB목록', ['스키마', '이름', '종류', '칸 수', '트리거', '쓰는 API 수', '모듈', '설명'], [[d.get('schema'), d.get('name'), d.get('kind'), d.get('cols'), d.get('triggers'), d.get('apis'), d.get('modules'), d.get('comment')] for d in db], {'이름': 36, '모듈': 30, '설명': 70})
sheet('06_미연결', ['내용'], [[json.dumps(i, ensure_ascii=False)] for i in (m.get('issues') or [])] or [['없음 — 화면 · API · DB 의 미연결 0']], {'내용': 120})

# ── 07 이번 판 — 구역별: 화면 · 백엔드 · API · DB ──
Z = [
 ['머리줄', '로고 · 메뉴 6 · 검색 · KR · 로그인 · 무료 회원가입 · 알림 종', '그림 그대로(견본 종)', '로고 · 메뉴 = 서버의 관 목록 · 종 = 읽지 않은 알림 수', 'components/b2/Frame.tsx · AuthArea.tsx · TonePic.tsx · app/cart-count/route.ts', 'GET /gwans · GET /me/summary(사이트의 /cart-count?bell=1 이 부름)', 'gwans · notifications', '넣음'],
 ['맨 위', '큰 제목 · 설명 · 검색 칸', '그림 그대로 · 칸을 누르면 시안의 통합 검색 창', '칸을 누르면 v10.29 의 검색 팝업 · 제출하면 /search?q=…&gwanCode=MNY', 'components/money/MoneyMain.tsx · MoneySearch.tsx (+ components/search/SearchPopup.tsx)', 'GET /search/suggest · GET /listings · GET /requests(팝업) · GET /search(결과 화면)', 'search_term_stats · categories · listings · requests', '넣음'],
 ['맨 위', '많이 찾는 키워드 5', '견본(누르면 검색 결과)', '넣지 않음', '—', '— (검색 팝업 안의 추천 검색어는 v10.29 의 GET /search/suggest 가 줍니다 — 그림의 이 줄과는 다른 자리)', '—', '서버에 「메인에 뿌릴 키워드 줄」이 정해지지 않음'],
 ['맨 위', '광고(사진 · 1 / 3)', '받은 광고 그림(견본)', '「관 랜딩 상단」 칸의 소재(글자) · 노출 · 클릭 기록', 'components/money/MoneyAd.tsx', 'GET /ads/serve?slot=GHERO · POST /ads/{id}/impression · /click', 'ad_slots · ad_creatives · ad_events', '넣음(소재가 글자뿐이라 남색 칸에 글자)'],
 ['바로가기 3', '소개하기 · 소개받고 싶어요 · 소개받기', '화면 reg · reqn · reql', '/register · /request/new · /request (v10.29 의 역할 탭 3개와 같은 곳)', 'MoneyMain.tsx', '(가는 화면의 API)', '—', '넣음'],
 ['분야 14칸', '전체 … 기타', '누르면 그 낱말로 아래 목록을 거름(S.mnyKw)', '누르면 /money?keyword=낱말#mny-list — 아래 목록을 그 낱말로 거름 · 지금 고른 칸에 주황 테두리', 'components/money/menu.ts · MoneyMain.tsx', 'GET /listings?gwanCode=MNY&keyword=', 'listings(fn_search_match)', '넣음 — 서버의 업종과 이름이 달라 낱말로'],
 ['왼쪽 분류', '상품 5 · 서비스 6 · 전문가 · 업체 · 구해요 / 의뢰', '같은 방식(낱말) · 구해요 / 의뢰 → 요청 목록', '같은 방식(낱말) · 구해요 / 의뢰 → /request', 'components/money/MoneySide.tsx', 'GET /listings?keyword= · GET /requests', 'listings · requests', '넣음'],
 ['왼쪽 분류', '지역으로 찾기 10', '견본(안내)', '넣지 않음', '—', '없음(지역으로 걸러 받기 없음)', 'listing_regions(값은 있으나 조회 조건 없음)', '서버에 조건 없음'],
 ['서비스 업체 추천', '업체 카드 4(별점 · 지역)', '견본', '넣지 않음', '—', '없음(업체 단위 목록 · 목록의 평점)', 'v_owner_public_stats(상세에서만)', '서버에 자료 없음'],
 ['지금 올라온 소개 요청', '탭 6 · 줄 4', '견본(탭으로 걸러 봄)', '실제 요청 4건 · 탭 · 사진 · 지역 없음 · 제안 하기 → 요청 상세', 'MoneyMain.tsx', 'GET /requests?gwanCode=MNY&limit=4', 'requests · request_proposals', '넣음(일부 칸 없음)'],
 ['AI 추천 맞춤 공급자', '카드 4', '견본', '넣지 않음', '—', '없음(메인용 추천 목록)', '—', '서버에 자료 없음'],
 ['띠 광고', '사무 가구 띠', '받은 그림(견본)', '넣지 않음', '—', '없음(이 자리의 광고 칸 종류)', 'ad_slots 에 종류 없음', '서버에 칸 없음'],
 ['최근 실제 연결 사례', '사례 3', '견본', '넣지 않음', '—', '없음', '—', '서버에 자료 없음'],
 ['공급자 등록', '안내 · 단추', '화면 reg', '/register', 'MoneyMain.tsx', '(가는 화면의 API)', '—', '넣음'],
 ['지금 있던 것(#mny-list)', '(그림에 없음 — 10/9 답 ②)', '퀵메뉴 5 · 내 목록 · 전체 목록 · 소개상품 찾기 · 검색 조건 줄 · 매물 6칸 · 쪽 번호 · 정렬', '퀵메뉴 5(/money/new · best · urgent · verified · event) · 내가 등록한 … · 전체 목록 · 소개상품 찾기(구분 · 분류) · 검색 조건 줄 · 매물 사진 카드 6 · 쪽 · 정렬 — v10.29 부품 그대로', 'MoneyMain.tsx + components/gwan/{gw.ts · GwCard.tsx · GwParts.tsx · GwClient.tsx}', 'GET /listings?gwanCode=MNY(&sort · badge · categoryId · keyword · cursor) · GET /categories?gwanCode=MNY · GET /gwans', 'listings · categories · category_grades · gwans', '넣음'],
 ['관 중지', '(그림에 없음)', '전과 같음(중지 안내 화면)', '안내 한 줄만(바로가기 · 목록 없음) — GET /gwans 에 소개장터가 없으면 중지로 봄', 'MoneyMain.tsx', 'GET /gwans', 'gwans.is_active', '넣음'],
 ['바닥줄', '로고 · 링크 5 · 사회관계망 3 · ©', '그 디자인의 로고 · 아이콘 + 사업자 정보 · 고지', '같음(약관 링크는 서버 목록)', 'components/b2/Frame.tsx', 'GET /footer-links · GET /site-settings/public', 'footer_links · site_settings', '넣음(법정 표시 유지)'],
]
sheet('07_소개장터_구역별_연결', ['구역', '그림의 내용', '시안', '실제 웹', '화면 코드(sgb/site/src)', 'API', 'DB', '판정'], Z, {'구역': 20, '그림의 내용': 34, '시안': 36, '실제 웹': 46, '화면 코드(sgb/site/src)': 44, 'API': 46, 'DB': 36, '판정': 30})

# ── 08 ~ 09 새 검사 ──
sheet('08_새검사_실제웹', ['단계', '판정', '자세히'], [[r['step'], '통과' if r['ok'] else '실패', r.get('detail', '') if not r['ok'] else ''] for r in site], {'단계': 150, '자세히': 60}, status=1)
sheet('09_새검사_시안', ['단계', '판정', '자세히'], [[r['step'], '통과' if r['ok'] else '실패', r.get('detail', '') if not r['ok'] else ''] for r in proto], {'단계': 150, '자세히': 60}, status=1)

# ── 10 전수 검정 ──
sheet('10_전수검정', ['시험', '판정', '결과 줄', '처음 결과(다시 돌린 시험만)'], FIN, {'시험': 22, '결과 줄': 130, '처음 결과(다시 돌린 시험만)': 80}, status=1)

# ── 11 자리 대조 ──
rows = []
for lab, d in (('시안', mp), ('실제 웹', ms)):
    for n, v in (d.get('items') or {}).items():
        if 'diff' not in v: rows.append([lab, n, '실패', '', '', '', '', v.get('error', ''), '']); continue
        x, y, w, h = v['diff']; c = v.get('color') or ['', '', '']
        rows.append([lab, n, '통과' if v['ok'] else '실패', x, y, w, h, c[0], c[1]])
    for n, why in (d.get('skipped') or {}).items(): rows.append([lab, n, '견주지 않음', '', '', '', '', why, ''])
    for n, why in (d.get('known') or {}).items(): rows.append([lab, n + ' (알고 다르게 둔 곳)', '확인', '', '', '', '', why, ''])
sheet('11_자리대조_그림↔화면', ['화면', '자리', '판정', '왼쪽 차이(px)', '위 차이(px)', '폭 차이(px)', '높이 차이(px)', '그림의 글자색 / 까닭', '화면의 글자색'], rows, {'자리': 28, '그림의 글자색 / 까닭': 70}, status=2)

# ── 12 그림 조각 ──
sheet('12_그림조각_53장', ['이름', '구역', '쓰임', '받은 그림에서의 자리(x0, y0, x1, y1)', '원본 크기(px)', '화면 크기(px)', '실제 웹', '시안', '지문(점 RGB 의 sha256)'],
      [[n, v['section'], v['use'], v['box'], '%d × %d' % tuple(v['size']), '%g × %g' % tuple(v['css']), '둠(sgb/site/public/money/%s.png)' % n if v['site'] else '두지 않음', '넣음', v.get('px', '')] for n, v in parts.items()],
      {'이름': 14, '쓰임': 60, '받은 그림에서의 자리(x0, y0, x1, y1)': 30, '실제 웹': 40, '지문(점 RGB 의 sha256)': 68})

# ── 13 앞 시안과 견줌 ──
rows = [['글자(proto_diff)', r['step'], '통과' if r['ok'] else '실패', r.get('detail', '') if not r['ok'] else ''] for r in (pdiff.get('items') or [])] + \
       [['그림(proto_pixel)', r['step'], '통과' if r['ok'] else '실패', r.get('detail', '') if not r['ok'] else ''] for r in (ppix.get('items') or [])]
sheet('13_앞시안(v10.28)과_견줌', ['종류', '단계', '판정', '자세히'], rows, {'단계': 130, '자세히': 60}, status=2)

# ── 14 바뀐 파일 ──
CH = J('changed_files_v1030.json', [])
sheet('14_바뀐파일(v10.29대비)', ['구분', '파일', '내용'], [[c[0], c[1], c[2]] for c in CH], {'구분': 12, '파일': 70, '내용': 110}, mark=lambda r: '[v10.29 에서 넘어온 것]' in str(r[2].value or ''))

# ── 15 그림과 다르게 넣은 것 ──
DV = [
 ['공통', '사업자 정보 · 통신판매중개자 고지 · 바로가기 줄(바닥줄)', '그림에 없음', '넣음', '첫 화면에서 빠지면 안 되는 법정 표시(소개광장 · 소개몰 때와 같게)'],
 ['공통', '바닥줄의 약관 링크', '서비스 소개 · 이용약관 · 개인정보처리방침 · 운영정책 · 고객센터', '시안: 사이트 정보의 목록(「분쟁조정 안내」 포함) · 실제 웹: 서버 목록', '목록은 운영 화면 · 서버가 정함'],
 ['공통', '사회관계망 아이콘', '또렷함', '계정 주소를 넣기 전에는 흐리게(준비 중)', '소개광장 · 소개몰과 같은 규칙'],
 ['공통', '메뉴 「소개몰」 글자색', '#231815', '#000000', '이 메뉴만 다른 값 — 다른 메뉴와 같게'],
 ['공통', '지금 있던 구역(퀵메뉴 5 · 소개상품 찾기 · 매물 · 쪽 · 정렬)', '그림에 없음', '오른쪽 칸의 디자인 구역 아래에 남김(#mny-list)', '10/9 답 ②'],
 ['공통', '분야 칸의 「지금 고른 것」 표시', '「전체」 칸이 옅은 주황 바탕', '「전체」 칸의 바탕은 늘 그림 그대로 · 다른 칸을 고르면 그 칸에 주황 테두리(바탕은 회색 그대로)', '아이콘 그림에 그 자리의 바탕색이 같이 들어 있어, 바탕을 바꾸면 아이콘 둘레에 네모가 보입니다(그림은 바꾸지 않음)'],
 ['공통', '좁은 화면', '받은 것 없음(1500px 한 장)', '같은 색 · 모양으로 줄임 — 머리줄은 1320px 부터 한 단계 작게, 1220px 부터 메뉴가 둘째 줄', '—'],
 ['공통', '로그인한 머리줄', '그림에 없음', '나의공간 · 로그아웃 · 종(+ 시안은 관리자 페이지) · 시안은 단추를 한 단계 작게', '칸이 많아 그림의 치수로는 1500px 에 들어가지 않음'],
 ['공통', '머리줄의 돋보기 단추 · KR', '그림에 있음', '돋보기 = 검색(시안: 검색 결과 화면 · 실제 웹: 두 관 전용 머리줄의 것 그대로) · KR = 언어 고르기', '두 관 전용 머리줄(소개광장 · 소개몰)과 같은 부품'],
 ['실제 웹', '알림 종', '숫자 「1」이 같이 그려진 그림', '선으로 그린 종 + 읽지 않은 알림 수(없으면 숫자 없음)', '실제 숫자를 보여야 함 — 시안의 로그인하지 않은 모습은 그림 그대로'],
 ['실제 웹', '맨 위 광고', '사진 한 장(글자 · 단추가 사진 안)', '같은 자리 · 같은 크기의 남색 칸에 소재의 글자', '서버의 소재에 사진 칸이 없음'],
 ['실제 웹', '키워드 · 업체 추천 · AI 추천 · 띠 광고 · 연결 사례 · 지역으로 찾기 · 요청 종류 탭 · 요청 사진 · 지역', '있음', '넣지 않음', '서버에 자료가 없음 — 견본을 진짜처럼 보이게 넣지 않음'],
 ['실제 웹', '분야 14칸 · 분류 목록이 가는 곳', '—', '그 이름의 첫 낱말로 아래 목록 거르기(/money?keyword=…#mny-list)', '서버의 업종과 이름이 다름(DB 변경 없음) — 서버의 진짜 분류는 「소개상품 찾기」에서 고름'],
 ['실제 웹', '공급자 등록 안내의 자리', '연결 사례의 오른쪽', '가운데', '왼쪽의 사례 구역이 없음'],
 ['실제 웹', 'v10.29 관 첫 화면에 있던 것 가운데 뺀 것', '—', '지역 설정 칸 · 검색줄 옆 띠 그림(스마트팜 견본) · 아래 안내 6칸 · 왼쪽 「상품 분류」 목록 · 역할 탭의 안내 글', '지역 설정은 고른 값을 기억만 하고 목록을 거르지 않던 칸 · 분류는 「소개상품 찾기」의 고르기 칸으로 · 역할 탭 3개는 바로가기 3장으로'],
 ['시안', '요청 종류 탭', '전체만 고른 모습', '누르면 걸러짐 — 4건에 종류를 하나씩 붙임(견본 배정)', '그림에는 어느 요청이 어느 종류인지 없음'],
 ['시안', '광고 넘기기(1 / 3 · 화살표)', '그림에 들어 있음', '그림 그대로 · 누르면 「1장뿐」 안내', '받은 광고 그림이 1장'],
 ['시안', '떠 있는 광고 카드(오른쪽 아래)', '그림에 없음', '전과 같이 뜸', '관 메인의 광고 칸(FLOAT) — 이번 판에서 건드리지 않음'],
]
sheet('15_그림과_다르게_넣은것', ['어디', '무엇', '그림', '넣은 것', '까닭'], DV, {'무엇': 50, '그림': 44, '넣은 것': 60, '까닭': 60})

# ── 16 찾은 것 ──
sheet('16_찾은것', ['번호', '어디서 온 것', '무엇', '증상', '한 일', '상태', '근거'],
      [[f.get('no'), f.get('from'), f.get('what'), f.get('symptom'), f.get('done'), f.get('state'), f.get('proof')] for f in FOUND] or [['—', '', '없음', '', '', '', '']],
      {'어디서 온 것': 20, '무엇': 50, '증상': 60, '한 일': 60, '상태': 12, '근거': 60}, status=5)

wb.save(OUT)
print('저장', OUT, '· 시트', len(wb.sheetnames), wb.sheetnames)
