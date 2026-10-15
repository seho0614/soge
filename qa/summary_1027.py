"""v10.27 확인 결과 — final_all.txt + final_all_reruns_1027.txt(같은 시험이면 다시 돌린 줄이 앞섬) + 결과 JSON 에서
   문서 76 의 {{RESULTS}}(한눈에 — 짧은 표) · {{DETAIL}}(6절 — 시험마다 표) 를 만듭니다.
   사용: python3 summary_1027.py                 화면에 두 묶음을 찍음(파일은 바꾸지 않음)
         python3 summary_1027.py --fill <문서>    문서의 {{RESULTS}} · {{DETAIL}} 를 바꿔 씀(결과가 빠진 시험이 있으면 멈춤 — --force 로 그래도)
         python3 summary_1027.py --json          엑셀 0_요약 시트용 summary.json 도 씀(build_xlsx.py 가 읽음)
   doc76_extra.txt 가 있으면(「키: 값」 줄 — DOCKER · PS · FRESH · REHEARSAL · PACK · GIT) 그 줄도 한눈에 표에 넣습니다."""
import json, re, os, sys, ast
Q = os.path.dirname(os.path.abspath(__file__))
K = '/home/claude/pkg/SGB_DevDocker_Integrated_20261002'
R27 = (f'{Q}/results_v10_27', f'{K}/qa/results_v10_27')

def J(*names):
    for f in names:
        for p in (f'{Q}/{f}',) + tuple(f'{d}/{os.path.basename(f)}' for d in R27):
            if os.path.exists(p): return json.load(open(p, encoding='utf-8'))
    return None
def T(f):
    for p in (f'{Q}/{f}',) + tuple(f'{d}/{f}' for d in R27):
        if os.path.exists(p): return open(p, encoding='utf-8').read()
    return None
items = lambda d: (d if isinstance(d, list) else (d or {}).get('items', [])) or []
okn = lambda xs: f"{sum(1 for x in xs if str(x.get('ok')) == 'True' and not x.get('skip'))} / {len(xs)}"
def gnos(xs):
    out = []
    for x in xs:
        m = re.match(r'G-?(\d+)', x.get('step', ''))
        if m and f'G-{m.group(1)}' not in out: out.append(f'G-{m.group(1)}')
    return ' · '.join(out)
md = lambda s: str(s).replace('|', '\\|').replace('\n', ' ')

# ── 전수 검정 줄 읽기 ── 「키: 값」 · 「키_rerun: 값」(v10.26 꼴) · 「키 (언제 · 왜 다시): 값」(final_all_reruns_1027.txt 꼴)
LINE = re.compile(r'^(\w+?)(?:_rerun\d*)?(?: \((.*)\))?: (.*)$')
def read_lines(f):
    out = []
    t = T(f)
    for l in (t or '').split('\n'):
        m = LINE.match(l.rstrip())
        if m: out.append((m.group(1), m.group(2) or ('다시 돌림' if '_rerun' in l.split(':')[0] else ''), m.group(3).strip()))
    return out, t is not None
base, has_fa = read_lines('final_all.txt')
rerun, has_rr = read_lines('final_all_reruns_1027.txt')
FA = {}; ORIG = {}; RR = {}
for k, why, v in base:
    if why: RR[k] = (why, v)          # final_all.txt 안의 「키_rerun」 줄
    else: ORIG[k] = v
for k, why, v in rerun: RR[k] = (why or '다시 돌림', v)
for k in list(ORIG) + list(RR): FA[k] = RR[k][1] if k in RR else ORIG[k]
done_parts = [p for p in 'ABCDE' if f'PART-{p}-DONE' in (T('final_all.txt') or '')]

PARTS = {   # final_parts.sh 의 구간과 같은 순서
 'A': ['api_mode', 'verify', 'attack_pick', 'cut_b2', 'cut_mall', 'ads', 'matrix', 'fixtures', 'e2e', 'decisions', 'decisions_ui', 'fixes_1002'],
 'B': ['srv_aff', 'srv_hlt', 'srv_ptn', 'srv_aff_ui', 'srv_hlt_ui', 'srv_ptn_ui', 'srv_proto', 'srv_pay', 'srv_pay_ui', 'srv_file', 'srv_file_ui', 'srv_lead', 'srv_lead_ui',
       'srv_consult', 'srv_consult_ui', 'srv_retship', 'srv_refcode', 'srv_refcode_ui', 'srv_viewlimit', 'csrf', 'srv_poll', 'srv_poll_ui', 'srv_billing', 'srv_billing_ui',
       'srv_detail', 'srv_cmu', 'srv_cmu_ui', 'srv_fin', 'srv_fin_ui', 'srv_mall', 'site_mall', 'fix_1026', 'srv_opt', 'site_opt', 'fix_1027', 'fix_1027b', 'fix_1027b_ui', 'fix_1027c'],
 'C': ['web_main', 'web_main_live', 'hyd_home', 'measure_home', 'web_mal', 'site_tz', 'site_detail', 'hyd_load', 'smoke', 'pagetest', 'crawl_site', 'crawl_admin'],
 'D': ['sweep_proto', 'proto_consult', 'proto_main', 'proto_poll', 'proto_bill', 'proto_urg', 'proto_detail', 'proto_item', 'proto_axis', 'proto_lang', 'proto_cmu', 'proto_fin',
       'proto_mall', 'proto_opt', 'fix_1027_proto', 'g130_check', 'proto_guard', 'proto_diff', 'proto_pixel', 'sweep_hlt', 'proto_report'],
 'E': ['db_link', 'link_check', 'btn_site', 'btn_bo', 'flow_trade', 'flow_mall', 'flow_plaza', 'flow_biz', 'flow_proto'],
}
PNAME = {'A': 'A 통합 검정 · 준비', 'B': 'B 서버 기능 · 화면', 'C': 'C 사용자 웹 · 페이지 전수', 'D': 'D 시안', 'E': 'E 확장 점검'}
ALLK = [k for p in PARTS.values() for k in p]
EXTRA = [k for k in FA if k not in ALLK]

FR = re.compile(r'(\d[\d,]*) ?/ ?(\d[\d,]*)')
num = lambda s: int(s.replace(',', ''))
def short(v): return (v or '').split('   (')[0].strip()
def judge(k, v):
    v = (v or '').strip()
    if not v: return '결과 없음'
    if k == 'verify':
        m = re.search(r'exit=(\d+)', v); f = re.search(r'통과 (\d+) / 실패 (\d+)', v)
        return '통과' if (m is None or m.group(1) == '0') and f and f.group(2) == '0' and '▲뚫림 0' in v else '실패'
    if re.search(r'Traceback|Error:|실패 [1-9]|exit=[1-9]', v): return '실패'
    if k == 'api_mode': return '통과' if '→ 404' in v else '확인'
    if k == 'hyd_load': return '통과' if v.startswith('통과') else '실패'
    if k in ('cut_b2', 'cut_mall'): return '통과' if re.search(r'다른 것 0', v) else '실패'
    if k == 'ads': return '통과' if '▲위험 0' in v else '실패'
    if k == 'matrix': return '통과' if re.search(r'상 0 · 중 0', v) else '확인'
    if k == 'pagetest': return '통과' if 'dups 0' in v and 'same order False' not in v and 'keys_leak True' not in v else '실패'
    if k == 'smoke': return '실패' if re.search(r'\b5\d\d:', v) else '기록(응답 분포)'
    if k == 'proto_report':
        m = re.search(r"'none': (\d+), 'error': (\d+)", v); return '통과' if m and m.group(1) == '0' and m.group(2) == '0' else '확인'
    if k in ('btn_site', 'btn_bo'): return '통과' if '문제 0' in v else '확인'
    if v.startswith('건너뜀'): return '건너뜀'
    if v == 'done': return '완료'
    m = FR.search(v)
    if m:
        a, b = num(m.group(1)), num(m.group(2)); sk = re.search(r'건너뜀 (\d+)', v)
        if a == b: return '통과'
        if sk and a + int(sk.group(1)) == b: return f'통과(건너뜀 {sk.group(1)})'
        return '실패'
    return '통과' if v.startswith('통과') else '기록'
g = lambda k: short(FA.get(k, ''))
res = lambda k: g(k) or '결과 없음(아직 돌지 않음)'
missing = [k for k in ALLK if k not in FA]

# ── 결과 파일 ──
fx, fb, fu, fc, fp = (items(J(f)) for f in ('fix_1027.json', 'fix_1027b.json', 'fix_1027b_ui.json', 'fix_1027c.json', 'fix_1027_proto.json'))
g130 = items(J('g130/g130_check.json', 'g130_check.json'))
ppx = J('proto_pixel.json') or {}; pdf = J('proto_diff.json') or {}
bl = items(J('srv_billing.json')); bk = {x['step'].split(' ')[0]: x for x in bl}
try:   # G-114 확인표 T-1 ~ T-10 과 srv_billing 단계의 짝 — xlsx_1027.py 의 _T114 를 그대로 씀(한 곳에서만 고치게)
    _src = ast.parse(open(f'{Q}/xlsx_1027.py', encoding='utf-8').read())
    T114 = next(ast.literal_eval(n.value) for n in _src.body if isinstance(n, ast.Assign) and getattr(n.targets[0], 'id', '') == '_T114')
except Exception: T114 = []
t114 = [(t, name, ss, sum(1 for s in ss if str(bk.get(s, {}).get('ok')) == 'True'), len(ss)) for t, name, ss in T114]
t114_ok = bool(t114) and all(a == b for *_, a, b in t114)
hyd = [l for l in (T('hyd_load.txt') or '').split('\n') if '오류' in l]
hyd_err = sum(int(m.group(1)) for m in (re.search(r'오류 (\d+) /', l) for l in hyd) if m)
docker = [l for l in (T('docker_1027.txt') or '').split('\n') if ': ' in l]
ex = {}
for l in (T('doc76_extra.txt') or '').split('\n'):
    if ': ' in l: k, _, v = l.partition(': '); ex[k.strip()] = v.strip()

def line_or_json(k, xs):
    """전수 검정 줄(다시 돌린 줄 우선)이 있으면 그 수치 · 없으면 결과 파일의 수치"""
    return g(k) if g(k) else (f'{okn(xs)} (결과 파일 — 전수 검정 줄 없음)' if xs else '결과 없음(아직 돌지 않음)')
SUITES = ['fixtures', 'e2e', 'decisions', 'decisions_ui', 'fixes_1002'] + PARTS['B']
PSU = ['proto_consult', 'proto_main', 'proto_poll', 'proto_bill', 'proto_urg', 'proto_detail', 'proto_item', 'proto_axis', 'proto_lang', 'proto_cmu', 'proto_fin', 'proto_mall',
       'proto_opt', 'fix_1027_proto', 'g130_check', 'proto_guard', 'proto_diff', 'proto_pixel']
def tot(keys):
    a = b = 0; n = 0; bad = []; miss = []
    for k in keys:
        m = FR.search(g(k)) if k != 'verify' else None
        if m: a += num(m.group(1)); b += num(m.group(2)); n += 1
        j = judge(k, FA.get(k))
        if j == '결과 없음': miss.append(k)
        elif not j.startswith('통과'): bad.append(k)
    return a, b, n, bad, miss
def tot_txt(keys):
    a, b, n, bad, miss = tot(keys)
    return (f"{len(keys)}묶음 중 결과 {n}묶음 — {a:,} / {b:,}" + (f" · 통과가 아닌 것: {', '.join(bad)}" if bad else '')
            + (f" · 결과 없음 {len(miss)}묶음" if miss else '') + (' · 모두 통과' if not bad and not miss else ''))

# ── {{RESULTS}} — 한눈에 ──
R = []
R.append(['수정 확인 — 서버 · DB(`fix_1027.py`)', f"{line_or_json('fix_1027', fx)} — {gnos(fx)} · 판매 약관(T-1 ~ T-3)"])
R.append(['수정 확인 — 서버(`fix_1027b.py`)', f"{line_or_json('fix_1027b', fb)}" + (f" — {gnos(fb)}" if fb else '')])
R.append(['수정 확인 — 실제 웹(`fix_1027b_ui.py`)', f"{line_or_json('fix_1027b_ui', fu)} — {gnos(fu)}"])
R.append(['G-130 개발 반영(`fix_1027c.py`)', f"{line_or_json('fix_1027c', fc)} — 파트너사 상세 · 알림 「보기」 · 계약서 양식 전문 · 사기 예방 가이드 · 택배사 조회"])
R.append(['시안 결함(`fix_1027_proto.py`)', f"{line_or_json('fix_1027_proto', fp)} — {gnos(fp)}"])
R.append(['시안 G-130(`g130_check.py`)', f"{line_or_json('g130_check', g130)} — 「상세 · 보기」 단추가 화면을 엶 · 새 화면 8장 · 시안에만 있는 3장 「개발중」"])
R.append(['G-114 가상 결제사(`srv_billing.py`)', f"{line_or_json('srv_billing', bl)} — 확인표(docs/62 9절) T-1 ~ T-10 " + ('모두 통과' if t114_ok else '· '.join(f'{t} {a}/{b}' for t, _, _, a, b in t114) or '짝 없음')
          + ' · 실제 결제사 확인은 토스 테스트 키를 받은 뒤'])
R.append(['화면 다시 그리기 오류(G-94 · `hyd_load.sh`)', g('hyd_load') or (f'오류 {hyd_err} / {30 * len(hyd)} (hyd_load.txt · 창 6개 동시)' if hyd else '결과 없음(아직 돌지 않음)')])
if ppx or pdf:
    R.append(['앞 판(v10.26)과 비교 — 본체 195장', f"그림 {okn(ppx.get('items', []))}(점 하나 같음 {ppx.get('same', '?')}장 · 바뀌어야 할 화면만 다름) · 글자 {okn(pdf.get('items', []))}(바뀐 {len(pdf.get('changed') or [])}장) · 새 화면 {len(pdf.get('added') or [])}장"])
R.append(['통합 검정(`npm run verify` · 새 검정 DB)', res('verify')])
R.append(['매트릭스', res('matrix').replace('매트릭스: ', '')])
R.append(['전수 검정(운영 방식 API)', tot_txt(SUITES)])
R.append(['시안 묶음', tot_txt(PSU)])
if 'crawl_site' in FA or 'crawl_admin' in FA:
    sc = (J('site_final.json') or {}).get('pages', []); bo = (J('admin_final.json') or {}).get('tabs', [])
    R.append(['모든 페이지 상호 확인', f"사용자 웹 {len(sc)} (경로 × 5역할) — 200 {sum(1 for p in sc if p['status'] == 200)} · 404 {sum(1 for p in sc if p['status'] == 404)} · API 실패 {sum(1 for p in sc if p.get('api_fail'))} · 스크립트 오류 {sum(1 for p in sc if p.get('errors'))}"
              f" / 운영 화면 {len(bo)} 화면 상태 × 5계정 — 실패 {sum(1 for t in bo if t.get('errors') or t.get('api_fail') or t.get('errview'))} (일반회원 거부 포함)"])
m = re.search(r"^(\d+) \{'clicks': (\d+).*'none': (\d+), 'error': (\d+)", g('proto_report'))
R.append(['시안 전수 누르기', f"{m.group(1)}화면 · {int(m.group(2)):,}회 · 무반응 {m.group(3)} · 오류 {m.group(4)}" if m else res('proto_report')])
R.append(['확장 점검', ' · '.join(f"{k} {g(k)[:140] or '결과 없음'}" for k in PARTS['E'])])
if docker:
    # v10.27(2) — 같은 시험을 다시 돌린 줄(「이름 (다시 …)」)은 다시 돌린 줄이 앞섬 · 수치가 없는 줄(주소 · 내용 대조)은 「기록」
    _last = {}
    for l in docker:
        k, _, v = l.partition(': '); _last[re.split(r' \(다시', k)[0].strip()] = v
    _redo = sum(1 for l in docker if '(다시' in l.partition(': ')[0])
    _jd = {k: ('통과' if re.search(r'(\d+) ?/ ?(\d+)', v) and (lambda m: m.group(1) == m.group(2))(re.search(r'(\d+) ?/ ?(\d+)', v)) else
               '실패' if re.search(r'(\d+) ?/ ?(\d+)', v) else '기록') for k, v in _last.items()}
    _fail = [k for k, j in _jd.items() if j == '실패' and not re.search(r'realcheck', k)]
    R.append(['Docker 실구동', ex.get('DOCKER') or f"docker_1027.txt 시험 {len(_last)}개(다시 돌린 {_redo}개는 다시 돌린 결과) — 통과 {sum(1 for j in _jd.values() if j == '통과')} · 실패 {len(_fail)}{(' ' + ', '.join(_fail)) if _fail else ''} · 기록 {sum(1 for j in _jd.values() if j == '기록')}(시안 주소 · 내용 대조 · 진짜 이미지 확인 — 대체 이미지 표시 2건은 진짜 이미지에서 나오지 않음)"])
elif 'DOCKER' in ex: R.append(['Docker 실구동', ex['DOCKER']])
for k, lab in (('PS', 'PowerShell 도우미'), ('FRESH', '새로 설치'), ('REHEARSAL', '서버 적용 리허설'), ('PACK', '묶음'), ('GIT', 'git')):
    if k in ex: R.append([lab, ex[k]])
RESULTS = '| 항목 | 결과 |\n|---|---|\n' + '\n'.join(f'| {md(a)} | {md(b)} |' for a, b in R)

# ── {{DETAIL}} — 6절 ──
D = ['### 6-1. 새 시험', '', '| 시험 | 결과 | 보는 것 |', '|---|---|---|']
NEW = [('fix_1027', '`qa/fix_1027.py`', fx, '서버 · DB — ' + (gnos(fx) or '—') + ' · 판매 약관 T-1 ~ T-3 (고치기 전에 실패를 봄)'),
       ('fix_1027b', '`qa/fix_1027b.py`', fb, '서버 — ' + (gnos(fb) or '—')),
       ('fix_1027b_ui', '`qa/fix_1027b_ui.py`', fu, '실제 웹(실제 로그인 · 클릭) — ' + (gnos(fu) or '—')),
       ('fix_1027c', '`qa/fix_1027c.py`', fc, 'G-130 개발 반영 — 운영 파트너사 상세 API · 운영 화면 · 파트너 알림 「보기」 · 계약서 양식 전문 · 사기 예방 가이드 · 택배사 조회'),
       ('fix_1027_proto', '`qa/fix_1027_proto.py`', fp, '시안 — ' + (gnos(fp) or '—')),
       ('g130_check', '`qa/g130_check.py`', g130, '시안 G-130 — 「상세 · 보기」 단추 22건 · 새 화면 8장 · 「개발중」 3장'),
       ('srv_billing', '`qa/srv_billing.py`', bl, 'G-114 — 가짜 결제사(실제 HTTP · 장애 주입)로 확인표 T-1 ~ T-10 (6-4)'),
       ('hyd_load', '`qa/hyd_load.sh`', [], 'G-94 — 창 6개 동시 · 목록 화면 3곳 × 180번(고치기 전 /money/list 27 / 180 · /mall/list 20 / 180 · /partner/notices 10 / 180)'),
       ('proto_diff', '`qa/proto_diff.py`', pdf.get('items', []), f"앞 판(v10.26)과 글자 — 바뀐 {len(pdf.get('changed') or [])}장 · 새 화면 {', '.join(pdf.get('added') or [])}"),
       ('proto_pixel', '`qa/proto_pixel.py`', ppx.get('items', []), f"앞 판(v10.26)과 그림 — 점 하나 같음 {ppx.get('same', '?')}장 · 다름 {len(ppx.get('diff') or [])}장(바뀌어야 할 화면 · G-137 견본 그림)")]
for k, name, xs, what in NEW:
    v = g(k) or (f'{okn(xs)} (결과 파일)' if xs else (f'오류 {hyd_err} / {30 * len(hyd)} (hyd_load.txt)' if k == 'hyd_load' and hyd else '결과 없음(아직 돌지 않음)'))
    D.append(f'| {name} | {md(v)}{" (다시 돌림)" if k in RR else ""} | {md(what)} |')
D += ['', '### 6-2. 전수 검정 — 시험마다', '', f"구간 완료: {', '.join(done_parts) or '없음'}" + (f" · 결과가 아직 없는 시험 {len(missing)}개" if missing else ' · 모든 시험의 결과 있음')
      + ' · 다시 돌린 시험은 다시 돌린 결과를 적고 처음 결과를 함께 적습니다.', '', '| 구간 | 시험 | 결과 | 판정 | 처음 결과(다시 돌리기 전) |', '|---|---|---|---|---|']
for p, keys in list(PARTS.items()) + [('그 밖', EXTRA)]:
    for k in keys:
        v = FA.get(k)
        D.append(f"| {PNAME.get(p, p)} | `{k}` | {md(short(v)[:220]) if v else '결과 없음(아직 돌지 않음)'} | {judge(k, v)} | {md(short(ORIG.get(k, ''))[:120]) if k in RR else ''} |")
D += ['', '### 6-3. 다시 돌린 것', '']
D += [f"- `{k}` — {md(why)} → {md(short(v)[:200])}" + (f" (처음: {md(short(ORIG[k])[:100])})" if k in ORIG else '') for k, (why, v) in RR.items()] or ['- 없음']
D += ['', '### 6-4. G-114 — 결제사 확인표(docs/62 9절)를 가상 결제사로', '', '| 확인표 | 무엇 | 가상 결제사로 본 단계(`srv_billing.py`) | 결과 |', '|---|---|---|---|']
D += [f"| {t} | {md(name)} | {', '.join(ss)} | {'통과' if a == b else '실패'} {a} / {b} |" for t, name, ss, a, b in t114] or ['| — | 결과 없음 | — | — |']
D += ['', '토스 테스트 키를 받으면 같은 표를 실제 결제사로 확인합니다(docs/62 9절). T 번호와 단계의 짝은 9절 표의 「하는 일 · 보는 것」에 맞춘 것입니다(`qa/xlsx_1027.py` 의 `_T114`).']
if docker:
    D += ['', '### 6-5. Docker 실구동(`docker_1027.txt`)', '', '| 항목 | 결과 |', '|---|---|'] + [f"| {md(l.partition(': ')[0])} | {md(l.partition(': ')[2][:200])} |" for l in docker]
DETAIL = '\n'.join(D)

# ── 내보내기 ──
args = sys.argv[1:]
warn = []
if not has_fa: warn.append('final_all.txt 없음')
if missing: warn.append(f"결과가 아직 없는 시험 {len(missing)}개: {', '.join(missing)}")
if 'ALLDONE' not in (T('final_all.txt') or '') and 'CHAIN-DONE' not in (T('final_all.txt') or ''): warn.append('전수 검정이 끝나지 않음(ALLDONE · CHAIN-DONE 줄 없음)')
for k in RR:    # 다시 돌린 줄이 앞서므로 — 처음 줄의 판정이 다르면 알림(다시 돌린 줄이 처음 줄보다 오래된 것은 아닌지 확인)
    if k in ORIG and judge(k, ORIG[k]) != judge(k, RR[k][1]): warn.append(f"{k}: 처음 「{short(ORIG[k])[:60]}」 → 다시 돌린 줄 「{short(RR[k][1])[:60]}」 을 씀")
for w in warn: print('※ ' + w, file=sys.stderr)
if '--json' in args:
    json.dump({'rows': [['결론', 'v10.27(10/9) — 결함 수정판: 거래 흐름 · 구독 예약 · 거래 당사자 확인 · 가입 동의 · 나의공간 · 제휴 귀속 · 글 신고 · 수화 오류 · 한국 날짜 · 시안 결함 — 문서 76']] + R},
              open(f'{Q}/summary.json', 'w'), ensure_ascii=False, indent=1)
    print('summary.json 씀', len(R) + 1, '줄', file=sys.stderr)
if '--fill' in args:
    i = args.index('--fill')
    if i + 1 >= len(args): sys.exit('사용: python3 summary_1027.py --fill <문서 경로>')
    doc = args[i + 1]
    if not os.path.isfile(doc): sys.exit(f'문서가 없습니다: {doc}')
    s = open(doc, encoding='utf-8').read()
    if '{{RESULTS}}' not in s or '{{DETAIL}}' not in s: sys.exit(f'{doc} 에 {{{{RESULTS}}}} · {{{{DETAIL}}}} 자리가 없습니다(이미 채웠는지 확인)')
    if warn and '--force' not in args: sys.exit('멈춤 — 위 ※ 줄을 확인하십시오(그래도 채우려면 --force)')
    open(doc, 'w', encoding='utf-8').write(s.replace('{{RESULTS}}', RESULTS).replace('{{DETAIL}}', DETAIL))
    print(f'채움: {doc}', file=sys.stderr)
else:
    print('<!-- {{RESULTS}} -->'); print(RESULTS); print(); print('<!-- {{DETAIL}} -->'); print(DETAIL)
