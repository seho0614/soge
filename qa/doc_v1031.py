"""v10.31 전수 검정 결과 문서 — /home/claude/work/v3/out/검정결과_v10.31.md (+ 킷 qa/results_v10_31/ 로 결과 파일을 모음)
   final_all.txt(구간 A ~ E) + final_all_reruns_1031.txt(다시 돌린 줄이 앞섬) + fixed_v1031.json · left_v1031.json + btn_*.json · flow_*.json + matrix.json"""
import glob, json, os, re, shutil, subprocess, time
Q = os.path.dirname(os.path.abspath(__file__)); K = '/home/claude/pkg/SGB_DevDocker_Integrated_20261002'
OUT = os.environ.get('DOC_OUT', '/home/claude/work/v3/out/검정결과_v10.31.md'); RES = K + '/qa/results_v10_31'
J = lambda f, d=None: (json.load(open(os.path.join(Q, f), encoding='utf8')) if os.path.exists(os.path.join(Q, f)) else d)

PART_NAME = {'A': 'A 통합 검정 · 준비', 'B': 'B 서버 기능 · 화면', 'C': 'C 사용자 웹 · 모든 페이지', 'D': 'D 시안 v10.31', 'E': 'E 확장 점검'}
part = 'A'; rows = {}; order = []
for l in open(os.path.join(Q, 'final_all.txt'), encoding='utf8').read().split('\n'):
    m = re.match(r'PART-([A-E])-DONE', l)
    if m: part = chr(ord(m.group(1)) + 1); continue
    if ': ' not in l or l.startswith(('CHAIN', 'ALLDONE')): continue
    k, v = l.split(': ', 1); k = k.strip()
    if k in ('crawl_site', 'crawl_admin') and '빌드)' not in v: part_k = 'E'
    else: part_k = part if part in PART_NAME else 'E'
    if k not in rows: order.append(k)
    rows[k] = {'part': rows.get(k, {}).get('part', part_k), 'first': rows.get(k, {}).get('first', v.strip()), 'now': v.strip(), 'why': ''}
for l in open(os.path.join(Q, 'final_all_reruns_1031.txt'), encoding='utf8').read().split('\n'):
    if ': ' not in l or l.startswith(('RERUN', 'CHAIN')): continue
    k, v = l.split(': ', 1); k = k.strip()
    mm = re.search(r' — (?=시험을 고친|결함 고친|환경을 고친|새 시험|다시 빌드한|최신 소스|전 회차)', v)
    res, why = (v[:mm.start()], v[mm.end():]) if mm else (v, '')
    if k == 'adapters_up': continue
    if k not in rows: order.append(k); rows[k] = {'part': 'B', 'first': '', 'now': '', 'why': ''}
    ws = [x for x in rows[k]['why'].split(' / ') if x]
    if why.strip() and why.strip() not in ws: ws.append(why.strip())
    rows[k]['now'] = res.strip(); rows[k]['why'] = ' / '.join(ws)

def verdict(v):
    if v.startswith('건너뜀'): return '건너뜀'
    if re.search(r'실패 [1-9]|FAIL|뚫림 [1-9]|exit=[1-9]|▲위험 [1-9]|Error|Traceback|Timeout|^실패|문제 [1-9]|다른 것 [1-9]|실패 [1-9]쪽|스크립트 오류 [1-9]', v): return '실패'
    m = re.search(r'(\d+)\s*/\s*(\d+)', v)
    sk = re.search(r'건너뜀 (\d+)', v)   # 흐름 점검 · 시안 시험 — 「통과 a / b · 건너뜀 c」 는 a + c = b 면 통과(건너뜀은 따로 셈)
    if m and sk and int(m.group(1)) + int(sk.group(1)) == int(m.group(2)): return '통과'
    if m and m.group(1) != m.group(2) and not re.search(r'통과 \d+ / 실패 0|오류 0 / \d+', v): return '실패'
    if v in ('', 'done'): return '확인'
    return '통과'
for k in rows: rows[k]['v'] = verdict(rows[k]['now'])
cnt = {}
for k in rows: cnt[rows[k]['v']] = cnt.get(rows[k]['v'], 0) + 1

FIX = J('fixed_v1031.json', []); LEFT = J('left_v1031.json', [])
m = json.load(open(K + '/sgb/docs/matrix/matrix.json', encoding='utf8')); S = m['summary']
BAD = ('죽은 단추', '누를 수 없음', '요청에 로그인 토큰이 없음', '다시 열었더니 없음')
def btn_line(kind):
    b = J(f'btn_{kind}.json')
    if not b: return '(결과 없음)'
    bad = sum(b['total'].get(x, 0) for x in BAD)
    return f"{'쪽' if kind == 'site' else '상태'} {b['units']} · 단추 {sum(b['total'].values()):,} · " + ' · '.join(f'{k} {v:,}' for k, v in sorted(b['total'].items(), key=lambda x: -x[1])) + f' · **문제 {bad}**'
flows = []
for f in ('trade', 'mall', 'plaza', 'biz', 'proto'):
    d = J(f'flow_{f}.json', []); st = [x for fl in d for x in fl.get('steps', [])]
    flows.append((f, len(d), sum(1 for x in st if x.get('ok') and not x.get('skip')), len(st), [fl.get('flow') for fl in d], [f"{fl.get('flow')} {x.get('no')}. {x.get('step')[:60]}" for fl in d for x in fl.get('steps', []) if not x.get('ok') and not x.get('skip')], sum(1 for x in st if x.get('skip'))))

cell = lambda s: str(s).replace('|', '\\|').replace('\n', ' ')
L = []; w = L.append
w('# 소개뱅크 v10.31 전수 검정 결과')
w('')
w(f"작성 {time.strftime('%Y-%m-%d %H:%M')} (한국 시각) · 원본 저장소 `SGB_DevDocker_Integrated_20261002`(master `{subprocess.run(['git', '-C', K, 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True).stdout.strip()}`) · 판 `{open(K + '/sgb/VERSION').read().strip()}`")
w('')
w('실행 환경: API = 운영 방식 `dist/main.js`(3000) · 사용자 웹 = `next build` → `next start`(5174) · 운영 화면 = vite(5173) · PostgreSQL 16(개발 DB `sgb` · 검정 DB `sgb_check` · 광고 DB `sgb_ads`) · 메모리 7GB · CPU 2 — 무거운 시험은 한 번에 하나.')
w('API · 사용자 웹은 마지막 고침 커밋 뒤 **다시 빌드한 것(19:2x)** 으로 돌렸습니다. 그 전(16:41 · 16:42 빌드)에 돈 줄은 「처음 결과」 칸에만 남깁니다.')
w('')
w('## 1. 요약')
w('')
w(f"| 항목 | 값 |\n|---|---|")
w(f"| 시험 줄 | {len(rows)} — 통과 {cnt.get('통과', 0)} · 실패 {cnt.get('실패', 0)} · 확인 {cnt.get('확인', 0)} · 건너뜀 {cnt.get('건너뜀', 0)} |")
w(f"| 고친 결함 | 제품 {sum(1 for f in FIX if f['kind'].startswith('결함'))} · 도구 {sum(1 for f in FIX if f['kind'].startswith('도구'))} · 환경 {sum(1 for f in FIX if f['kind'].startswith('환경'))} (3절) |")
w(f"| 고친 시험(새 화면 · 정책을 못 따라가던 것) | {sum(1 for k in rows if '시험을 고친' in rows[k]['why'] or '새 시험' in rows[k]['why'])}개 (4절) |")
w(f"| 버튼 체크 | 사용자 웹 {btn_line('site')} / 운영 화면 {btn_line('bo')} |")
w(f"| flow 점검 | " + ' · '.join(f"{f} {ok}/{n}" + (f"(건너뜀 {k})" if k else '') for f, _, ok, n, _, _, k in flows) + ' |')
w(f"| 매트릭스 | 화면 {S.get('screens_registry')} (구현 {S.get('screens_with_impl')} · 시안 {S.get('screens_with_proto')}) · 페이지 {S.get('site_pages')}+{S.get('admin_pages')} · API {S.get('handlers')} · 표 {S.get('tables')} · 뷰 {S.get('views')} · 함수 {S.get('functions')} · 마이그레이션 {S.get('migrations')} · 교차 점검 상 {S.get('issues', {}).get('상')} · 중 {S.get('issues', {}).get('중')} · 하 {S.get('issues', {}).get('하')} |")
w(f"| 남은 것 | {len(LEFT)}건 (6절) |")
w('')
w('## 2. 시험별 최종 결과')
w('')
for p in 'ABCDE':
    ks = [k for k in order if rows[k]['part'] == p]
    if not ks: continue
    w(f'### {PART_NAME[p]}')
    w('')
    w('| 시험 | 판정 | 최종 결과 | 처음 결과(다시 돌린 것만) · 다시 돌린 까닭 |')
    w('|---|---|---|---|')
    for k in ks:
        r = rows[k]; extra = (f"처음: {(r['first'] or '(결과 줄 없음)')[:110]} · " if r['why'] and r['first'] != r['now'] else '') + r['why']
        w(f"| `{k}` | {r['v']} | {cell(r['now'][:200])} | {cell(extra[:420])} |")
    w('')
w('## 3. 고친 결함')
w('')
w('| 번호 | 구분 | 무엇 | 증상 | 한 일 | 파일 · 커밋 | 다시 돌린 결과 |')
w('|---|---|---|---|---|---|---|')
for f in FIX: w('| ' + ' | '.join(cell(f.get(x, '')) for x in ('no', 'kind', 'what', 'symptom', 'done', 'where', 'rerun')) + ' |')
w('')
w('## 4. 고친 시험 — 실제 결함이 아니라 시험이 v10.31 의 새 화면 · 정책을 못 따라가던 것')
w('')
w('| 시험 | 고친 것 |')
w('|---|---|')
for k in order:
    why = rows[k]['why']
    if '시험을 고친' in why or '새 시험' in why:
        segs = []
        for sg in why.split(' / '):
            i = min([j for j in (sg.find('시험을 고친'), sg.find('새 시험')) if j >= 0], default=-1)
            if i >= 0: segs.append(sg[i:])
        t = ' / '.join(segs) or why
        w(f'| `{k}` | {cell(t[:300])} |')
w('')
w('## 5. 확장 점검 — 버튼 · flow · 연동 · 모든 페이지')
w('')
w(f"- **버튼 체크(사용자 웹 · 5역할 guest · person · buyer · intro · admin)** — {btn_line('site')}")
w(f"- **버튼 체크(운영 화면 · admin 3갈래 + ops · reviewer · payout · member)** — {btn_line('bo')}")
for f, n, ok, tot, names, bad, k in flows:
    w(f"- **flow_{f}** — 흐름 {n} · 단계 통과 {ok} / {tot}" + (f" · 건너뜀 {k}" if k else '') + (f" · 실패: {'; '.join(bad[:4])}" if bad else '') + (f"  \n  {' / '.join(x for x in names if x)}" if names else ''))
for k in ('db_link', 'link_check', 'crawl_site', 'crawl_admin', 'srv_pay', 'srv_file', 'srv_lead', 'srv_consult'):
    if k in rows: w(f"- **{k}** — {rows[k]['now'][:200]}")
w('')
w('연동 테스트는 `adapters_up.sh` 로 어댑터 API 4대(3121 토스 · 3122 S3 · 3123 1원 인증 · 중개사 · 국세청 · 3124 staging)와 가짜 서버(가짜 결제사 3129 · 가짜 S3 9022 · 가짜 연동 13023)를 띄워 실제 HTTP 로 돌리고 `adapters_down.sh` 로 껐습니다.')
w('파트너 선불 흐름(리드 이용료 충전 → 리드 배정 → 열람 → 차감)은 `flow_plaza`(파트너 단계) · `srv_w5` · `srv_lead` · `srv_lead_ui` 가 봅니다.')
w('')
w('## 6. 남은 것')
w('')
if LEFT:
    w('| 번호 | 구분 | 무엇 | 까닭 | 할 일 |')
    w('|---|---|---|---|---|')
    for f in LEFT: w('| ' + ' | '.join(cell(f.get(x, '')) for x in ('no', 'kind', 'what', 'why', 'todo')) + ' |')
else: w('없음')
w('')
w('## 7. 결과 파일')
w('')
w('- 킷 `qa/results_v10_31/` — `final_all_v1031.txt`(구간 A ~ E) · `final_all_reruns_1031.txt`(다시 돌린 줄) · 시험별 `*.json` · 다시 돌린 로그 `rr*_*.log` · 버튼 체크 `btn_site.json` · `btn_bo.json` · flow `flow_*.json`')
w('- 매트릭스 · 검정 엑셀 — `/home/claude/work/v3/out/SGB_Matrix_Verification_20261010_v10_31.xlsx` = 킷 `sgb/docs/SGB_Matrix_Verification_20261010_v10_31.xlsx`')
w('- 고치기 전 시험 사본 — `/home/claude/work/v3/out/logs/*.before_v1031*.py`')
open(OUT, 'w', encoding='utf8').write('\n'.join(L) + '\n'); print('저장', OUT, '· 시험 줄', len(rows), cnt)

if os.environ.get('NO_KIT'): raise SystemExit(0)
# ── 킷 qa/results_v10_31 ──
os.makedirs(RES, exist_ok=True)
shutil.copyfile(os.path.join(Q, 'final_all.txt'), RES + '/final_all_v1031.txt'); shutil.copyfile(os.path.join(Q, 'final_all_reruns_1031.txt'), RES + '/final_all_reruns_1031.txt')
keep = set()
for k in rows:
    for f in (f'{k}.json',): keep.add(f)
keep |= {'btn_site.json', 'btn_bo.json', 'site_final.json', 'admin_final.json', 'link_integrations.json', 'fixed_v1031.json', 'left_v1031.json', 'hyd_load.txt', 'srv_proto.json', 'hyd_pages.json',
         'flow_trade.json', 'flow_mall.json', 'flow_plaza.json', 'flow_biz.json', 'flow_proto.json', 'proto_sweep.json', 'srv_w5.json', 'srv_v1031.json', 'web_mal.json', 'web_main.json', 'site_mny.json', 'site_mall.json'}
n = 0
for f in sorted(keep):
    p = os.path.join(Q, f)
    if os.path.exists(p) and os.path.getsize(p) < 8_000_000: shutil.copyfile(p, os.path.join(RES, f)); n += 1
for p in sorted(glob.glob(os.path.join(Q, 'rr*_*.log')) + glob.glob(os.path.join(Q, 'part[A-E].log'))):
    if os.path.getmtime(p) > time.time() - 6 * 3600: shutil.copyfile(p, os.path.join(RES, os.path.basename(p))); n += 1
shutil.copyfile(OUT, RES + '/검정결과_v10.31.md')
print('results_v10_31', n + 3, '파일')
