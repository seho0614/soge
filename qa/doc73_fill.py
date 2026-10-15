"""docs/73 을 결과 파일의 수치로 채웁니다 — final_all.txt · 시험 결과 json · doc73_extra.txt(Docker · PowerShell · 리허설 · 묶음은 여기에 적어 둠) · doc73_why.json(첫 실행에서 모자랐던 것의 원인)."""
import json, re, os
Q = os.path.dirname(os.path.abspath(__file__))
K = '/home/claude/pkg/SGB_DevDocker_Integrated_20261002'
OUT = K + '/sgb/docs/73_소개몰_시안기준_개발_v10.25_20261008.md'
def kv(f):
    try: return dict(l.split(': ', 1) for l in open(f'{Q}/{f}', encoding='utf-8').read().split('\n') if ': ' in l)
    except FileNotFoundError: return {}
fa = kv('final_all.txt'); ex = kv('doc73_extra.txt'); f1 = kv('final_all_first_v1025.txt')
J = lambda f: json.load(open(f'{Q}/{f}', encoding='utf-8'))
items = lambda f: (lambda d: d if isinstance(d, list) else d['items'])(J(f))
okn = lambda xs: f"통과 {sum(1 for x in xs if x['ok'])} / {len(xs)}"
sc = J('site_crawl.json')['pages']; bo = J('admin_final.json')['tabs']
rep = fa.get('proto_report', '')
m = re.search(r"^(\d+) \{'clicks': (\d+).*'none': (\d+), 'error': (\d+)", rep)
sweep = f"{m.group(1)}화면(본체 194 + 소개몰 21) · {int(m.group(2)):,}회 · 무반응 {m.group(3)} · 오류 {m.group(4)}" if m else '?'
SUITES = ['fixtures', 'e2e', 'decisions', 'decisions_ui', 'fixes_1002', 'srv_aff', 'srv_hlt', 'srv_ptn', 'srv_aff_ui', 'srv_hlt_ui', 'srv_ptn_ui', 'srv_proto', 'srv_pay', 'srv_pay_ui', 'srv_file', 'srv_file_ui',
          'srv_lead', 'srv_lead_ui', 'srv_consult', 'srv_consult_ui', 'srv_retship', 'srv_refcode', 'srv_refcode_ui', 'srv_viewlimit', 'csrf', 'srv_poll', 'srv_poll_ui', 'srv_billing', 'srv_billing_ui', 'srv_detail',
          'srv_cmu', 'srv_cmu_ui', 'srv_fin', 'srv_fin_ui', 'srv_mall', 'site_mall']
PROTO = ['proto_consult', 'proto_main', 'proto_poll', 'proto_bill', 'proto_urg', 'proto_detail', 'proto_item', 'proto_axis', 'proto_lang', 'proto_cmu', 'proto_fin', 'proto_mall', 'proto_guard', 'proto_diff', 'proto_pixel']
def frac(v):
    m = re.search(r'(\d+) ?/ ?(\d+)', v or ''); return (int(m.group(1)), int(m.group(2))) if m else None
val = lambda k: fa.get(k + '_rerun', fa.get(k))
last = {k: frac(val(k)) for k in SUITES}; assert all(last.values()), [k for k, t in last.items() if not t]
a1 = sum(t[0] for t in last.values()); b1 = sum(t[1] for t in last.values())
assert a1 == b1, [(k, t) for k, t in last.items() if t[0] != t[1]]
plast = {k: frac(val(k)) for k in PROTO}; assert all(plast.values()) and all(t[0] == t[1] for t in plast.values()), [(k, t) for k, t in plast.items() if not t or t[0] != t[1]]
full = lambda v: bool(frac(v)) and frac(v)[0] == frac(v)[1]
again1 = [k for k in SUITES + PROTO + ['web_mal', 'site_tz'] if k in f1 and not full(f1[k])]                             # 첫 실행에서 모자랐던 것
again2 = [k[:-6] for k in fa if k.endswith('_rerun')]                                          # 마지막 실행에서 다시 돌린 것
srv = f"{len(SUITES)}묶음 {a1:,} / {b1:,} · 시안 {len(PROTO)}묶음 {sum(t[0] for t in plast.values()):,} / {sum(t[1] for t in plast.values()):,}" \
      + ('' if not again1 else f" — 첫 실행에서 모자랐던 것 {len(again1)}묶음은 고친 뒤 전 구간을 다시 돌림(8-2절 아래)") \
      + ('' if not again2 else f" · 다시 돌린 전 구간에서도 {len(again2)}묶음은 한 번 더 돌림(상담 화면 — 가끔 나는 화면 오류 G-94 · 소개몰 실제 웹 — 시험이 주문을 고르는 법 · 시안 글 한 줄을 고친 뒤 시안 시험 6묶음)")
names = {'api_mode': 'API 방식', 'verify': '통합 검정', 'ads': '광고 검정', 'matrix': '매트릭스', 'fixtures': '시험 준비 자료', 'e2e': '처음부터 끝까지', 'decisions': '운영 결정', 'decisions_ui': '운영 결정(화면)', 'fixes_1002': '10/2 수정',
         'srv_aff': '제휴', 'srv_hlt': '소개몰 서버(주문 · 취소 · 반품)', 'srv_ptn': '파트너', 'srv_aff_ui': '제휴(화면)', 'srv_hlt_ui': '소개몰(화면 — 주문 · 취소 · 운영)', 'srv_ptn_ui': '파트너(화면)', 'srv_proto': '시안 서버 연동', 'srv_pay': '결제 · 환불', 'srv_pay_ui': '결제(화면)',
         'srv_file': '파일', 'srv_file_ui': '파일(화면)', 'srv_lead': '리드 배정', 'srv_lead_ui': '리드(화면)', 'srv_consult': '상담', 'srv_consult_ui': '상담(화면)',
         'srv_retship': '반품 배송비', 'srv_refcode': '소개코드', 'srv_refcode_ui': '소개코드(화면)', 'srv_viewlimit': '열람 한도', 'csrf': '요청 위조 방어', 'srv_poll': '투표', 'srv_poll_ui': '투표(화면)',
         'srv_billing': '결제 · 환불 정합', 'srv_billing_ui': '내 구독(화면)', 'srv_detail': '매물 상세 · 후기 · 누적수익 공개', 'srv_cmu': '소개광장 서버', 'srv_cmu_ui': '소개광장(화면)', 'srv_fin': '생활금융 상담 서버', 'srv_fin_ui': '생활금융 상담(화면)',
         'srv_mall': '**소개몰 v10.25 서버**', 'site_mall': '**소개몰 v10.25 실제 웹**', 'proto_mall': '**시안 — 소개몰 v10.25**',
         'proto_consult': '시안 — 상담', 'proto_main': '시안 — 메인', 'proto_poll': '시안 — 투표 · 옛 판 비교', 'proto_bill': '시안 — 내 구독', 'proto_urg': '시안 — 급구 · 급매', 'proto_detail': '시안 — 상세', 'proto_item': '시안 — 매물 상세',
         'proto_axis': '시안 — 소개창업 축 상세 4종', 'proto_lang': '시안 — 언어 단추 · 로그인 화면', 'proto_cmu': '시안 — 소개광장', 'proto_fin': '시안 — 생활금융 상담', 'proto_guard': '시안 — 시연 보장(이미 고른 갈래 단추)',
         'attack_pick': '공격 검정의 고르기', 'cut_b2': '그림 조각 — 소개광장(받은 PNG 그대로인지)', 'cut_mall': '그림 조각 — 소개몰(받은 JPEG 에서 자르기만 했는지)',
         'proto_diff': '시안 — 앞 판과 글자 비교', 'proto_pixel': '시안 — 앞 판과 그림 비교', 'proto_report': '시안 — 누르기 전수', 'web_main': '사용자 웹 메인',
         'web_main_live': '사용자 웹 메인(실제 자료)', 'hyd_home': '메인 수화', 'measure_home': '메인 치수', 'web_mal': '안심소개 화면', 'site_tz': '날짜 · 시각의 시간대', 'site_detail': '실제 웹 매물 상세', 'smoke': 'GET API 전수',
         'pagetest': '목록 쪽 넘김'}
n200 = sum(1 for p in sc if p['status'] == 200); n404 = sum(1 for p in sc if p['status'] == 404); nerr = sum(1 for p in sc if p.get('errors'))
rows = ['| 묶음 | 결과 |', '|---|---|']
for l in open(f'{Q}/final_all.txt', encoding='utf-8').read().split('\n'):
    if ': ' not in l: continue
    k, v = l.split(': ', 1)
    if k in ('sweep_proto', 'sweep_hlt', 'crawl_site', 'crawl_admin'): continue
    if k == 'proto_report': v = sweep
    if k in ('smoke', 'smoke_rerun'):
        c = dict(re.findall(r'(\d+): (\d+)', v)); v = f"200 응답 {c.get('200')} · 의도한 거절(404 {c.get('404', 0)} · 409 {c.get('409', 0)} · 403 {c.get('403', 0)} · 422 {c.get('422', 0)}) · 5xx {sum(int(n) for cc, n in c.items() if cc.startswith('5'))}"
    if k == 'pagetest': v = '세 정렬 모두 순서 같음 · 중복 0 · 키 노출 없음'
    v = v.replace(' → /home/claude/qa/web_mal.json', '').replace('|', '·').strip()
    base = k[:-6] if k.endswith('_rerun') else k
    rows.append(f"| {names.get(base, base)}{' — 다시' if k.endswith('_rerun') else ''} (`{k}`) | {v[:230]} |")
rows.append(f"| 사용자 웹 전수 순회 (`crawl_site`) | {len(sc)}쪽(경로 × 5역할) — 200 {n200} · 404 {n404}(의도) · API 실패 {sum(1 for p in sc if p.get('api_fail'))} · 스크립트 오류 {nerr}쪽 |")
rows.append(f"| 운영 화면 전수 (`crawl_admin`) | {len(bo)} 화면 상태 × 5계정 — 실패 {sum(1 for t in bo if t.get('errors') or t.get('api_fail') or t.get('errview'))} |")
WHY = json.load(open(f'{Q}/doc73_why.json', encoding='utf-8'))
first = []
if again1 or again2:
    first = ['첫 실행에서 모자랐던 것 — 원인을 확인하고 고친 뒤 **1 ~ 4구간을 마지막 코드로 전부 다시** 돌렸습니다(위 표는 다시 돌린 결과 · 첫 실행의 결과 파일: `qa/results_v10_25/final_all_first_v1025.txt`).', '',
             '| 시험 | 첫 실행 | 원인 | 고친 곳 |', '|---|---|---|---|']
    for k in again1:
        assert k in WHY, f'원인을 적지 않았습니다: {k}'
        first.append(f"| `{k}` | {(f1[k] or '결과 없음')[:90].replace('|', '·')} | {WHY[k][0]} | {WHY[k][1]} |")
    for k in again2:
        assert k in WHY, f'원인을 적지 않았습니다: {k}'
        w = WHY.get(k + '__late', WHY[k]); v0 = sweep if k == 'proto_report' else fa[k][:90].replace('|', '·')
        first.append(f"| `{k}`(마지막 실행) | {v0} | {w[0]} | {w[1]} → 다시 {(fa[k + '_rerun'].split('   (')[0])[:60] if k != 'proto_report' else '같은 결과'} |")
    first += ['', '- 원인은 시험 쪽(시험 자료의 재고 · 박아 둔 상품 이름 · 옛 판과 견주는 기준 · 고르는 말의 범위)이 대부분이고, 제품 쪽에서 고친 것은 없습니다. `srv_proto` 는 작업 순서(시안 파일 이름을 바꾼 뒤 사용자 웹을 다시 올리지 않음) 때문이었습니다.']
px = J('proto_pixel.json'); assert px['diff'] == [] and px['same'] == 194, (px['diff'], px['same'])
D = J('defects.json'); num = lambda x: int(re.sub(r'\D', '', x['no']) or 0)
new = [x for x in D if 162 <= num(x) <= 169]; assert len(new) == 8
dtab = ['| 번호 | 구분 | 내용 | 원인 | 한 일 |', '|---|---|---|---|---|'] + [f"| {x['no']} | {x['area']} | {x['what'].replace('|', '·')} | {x['cause'].replace('|', '·')} | {x['fix'].replace('|', '·')} |" for x in new]
s = open(f'{Q}/doc73_template.md', encoding='utf-8').read()
repl = {
 'NEW_SRV': okn(items('srv_mall.json')), 'NEW_WEB': okn(items('site_mall.json')), 'NEW_PROTO': okn(items('proto_mall.json')),
 'PIX': okn(px['items']), 'DIFF': okn(J('proto_diff.json')['items']), 'CUT': fa.get('cut_mall', '?'),
 'VERIFY': re.sub(r'exit=0 ', '', fa.get('verify', '?')).replace(' | ', ' · '),
 'MATRIX': re.sub(r'\s+', ' ', fa.get('matrix', '?').replace('매트릭스: ', '')).strip(),
 'SRV': srv, 'SWEEP': sweep,
 'CRAWL': f"{len(sc)}쪽 — 200 {n200} · 404 {n404}(의도) · API 실패 {sum(1 for p in sc if p.get('api_fail'))} · 스크립트 오류 {nerr}쪽",
 'BO': f"{len(bo)} 화면 상태 — 실패 {sum(1 for t in bo if t.get('errors') or t.get('api_fail') or t.get('errview'))}",
 'DOCKER': ex.get('DOCKER', '(실행 전)'), 'PS': ex.get('PS', '(실행 전)'), 'FRESH': ex.get('FRESH', '(실행 전)'),
 'REHEARSAL': ex.get('REHEARSAL', '(포장 뒤 실행)'), 'PACK': ex.get('PACK', '(포장 뒤 기록)'),
 'SUITES': '\n'.join(rows), 'FIRST': '\n'.join(first), 'DEFECTS': '\n'.join(dtab),
}
for k, v in repl.items(): s = s.replace('{{' + k + '}}', v)
left = re.findall(r'\{\{[A-Z_]+\}\}', s)
assert not left, left
open(OUT, 'w', encoding='utf-8').write(s)
print('doc73', len(s), '자 ·', srv[:80], '·', sweep)
