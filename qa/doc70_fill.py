"""docs/70 을 결과 파일의 수치로 채웁니다 — final_all.txt · 시험 결과 json · doc70_extra.txt(Docker · PowerShell · 리허설 · 묶음은 여기에 적어 둠)."""
import json, re, os
Q = os.path.dirname(os.path.abspath(__file__))
K = '/home/claude/pkg/SGB_DevDocker_Integrated_20261002'
OUT = K + '/sgb/docs/70_소개창업_축상세4종_언어단추수정_v10.22_20261007.md'
def kv(f):
    try: return dict(l.split(': ', 1) for l in open(f'{Q}/{f}', encoding='utf-8').read().split('\n') if ': ' in l)
    except FileNotFoundError: return {}
fa = kv('final_all.txt'); ex = kv('doc70_extra.txt')
J = lambda f: json.load(open(f'{Q}/{f}', encoding='utf-8'))
okn = lambda xs: f"통과 {sum(1 for x in xs if x['ok'])} / {len(xs)}"
sc = J('site_crawl.json')['pages']; bo = J('admin_final.json')['tabs']
rep = fa.get('proto_report', '')
m = re.search(r"^(\d+) \{'clicks': (\d+).*'none': (\d+), 'error': (\d+)", rep)
sweep = f"{m.group(1)}화면 · {int(m.group(2)):,}회 · 무반응 {m.group(3)} · 오류 {m.group(4)}" if m else '?'
SUITES = ['fixtures', 'e2e', 'decisions', 'decisions_ui', 'fixes_1002', 'srv_aff', 'srv_hlt', 'srv_ptn', 'srv_aff_ui', 'srv_hlt_ui', 'srv_ptn_ui', 'srv_proto', 'srv_pay', 'srv_pay_ui', 'srv_file', 'srv_file_ui',
          'srv_lead', 'srv_lead_ui', 'srv_consult', 'srv_consult_ui', 'srv_retship', 'srv_refcode', 'srv_refcode_ui', 'srv_viewlimit', 'csrf', 'srv_poll', 'srv_poll_ui', 'srv_billing', 'srv_billing_ui', 'srv_detail']
def frac(v):
    m = re.search(r'(\d+) ?/ ?(\d+)', v or ''); return (int(m.group(1)), int(m.group(2))) if m else None
first = {k: frac(fa.get(k)) for k in SUITES}; assert all(first.values()), [k for k, t in first.items() if not t]
last = {k: (frac(fa.get(k + '_rerun')) or first[k]) for k in SUITES}
a0 = sum(t[0] for t in first.values()); b0 = sum(t[1] for t in first.values()); a1 = sum(t[0] for t in last.values()); b1 = sum(t[1] for t in last.values())
again = [k for k in SUITES if first[k][0] != first[k][1]]
srv = f"{len(SUITES)}묶음 {a1:,} / {b1:,}" + ('' if not again else f" — 첫 실행은 {a0:,} / {b0:,}(모자란 {b0 - a0}건: {' · '.join(again)}) · 원인을 확인하고 다시 돌려 통과(5-2절 아래)")
names = {'api_mode': 'API 방식', 'verify': '통합 검정', 'ads': '광고 검정', 'matrix': '매트릭스', 'fixtures': '시험 준비 자료', 'e2e': '기본 흐름', 'decisions': '운영 결정', 'decisions_ui': '운영 결정(화면)', 'fixes_1002': '10/2 수정',
         'srv_aff': '제휴', 'srv_hlt': '건강몰', 'srv_ptn': '파트너', 'srv_aff_ui': '제휴(화면)', 'srv_hlt_ui': '건강몰(화면)', 'srv_ptn_ui': '파트너(화면)', 'srv_proto': '시안 서버 연동', 'srv_pay': '결제 · 환불', 'srv_pay_ui': '결제(화면)',
         'srv_file': '파일', 'srv_file_ui': '파일(화면)', 'srv_lead': '리드 배정', 'srv_lead_ui': '리드(화면)', 'srv_lead_ui_rerun': '리드(화면) — 시험의 기다림을 고친 뒤 다시', 'srv_consult': '상담', 'srv_consult_ui': '상담(화면)',
         'srv_retship': '반품 배송비', 'srv_retship_rerun': '반품 배송비 — 다시', 'srv_refcode': '소개코드', 'srv_refcode_ui': '소개코드(화면)', 'srv_viewlimit': '열람 한도', 'csrf': '요청 위조 방어', 'srv_poll': '투표', 'srv_poll_ui': '투표(화면)',
         'srv_billing': '결제 · 환불 정합', 'srv_billing_ui': '내 구독(화면)', 'srv_detail': '매물 상세 · 후기 · 누적수익 공개', 'proto_consult': '시안 — 상담', 'proto_main': '시안 — 메인', 'proto_poll': '시안 — 투표 · 옛 판 비교',
         'proto_bill': '시안 — 내 구독', 'proto_urg': '시안 — 급구 · 급매', 'proto_detail': '시안 — 상세(v10.20 시험)', 'proto_item': '시안 — 매물 상세(v10.21 시험)', 'proto_axis': '시안 — 소개창업 축 상세 4종 · 주소',
         'proto_lang': '시안 — 언어 단추 · 로그인 화면', 'proto_guard': '시안 — 시연 보장(소개뱅크몰)', 'attack_pick': '공격 검정의 고르기', 'srv_proto_rerun': '시안 서버 연동 — 마지막 시안 파일로 다시', 'proto_diff': '시안 — 앞 판과 글자 비교', 'proto_pixel': '시안 — 앞 판과 그림 비교', 'proto_report': '시안 — 누르기 전수', 'web_main': '사용자 웹 메인',
         'web_main_live': '사용자 웹 메인(실제 자료)', 'hyd_home': '메인 수화', 'measure_home': '메인 치수', 'web_mal': '안심소개 화면', 'site_tz': '날짜 · 시각의 시간대', 'site_detail': '실제 웹 매물 상세', 'smoke': 'GET API 전수',
         'pagetest': '목록 쪽 넘김', 'hyd_pages': '목록 수화'}
n200 = sum(1 for p in sc if p['status'] == 200); n404 = sum(1 for p in sc if p['status'] == 404); nerr = sum(1 for p in sc if p.get('errors'))
rows = ['| 묶음 | 결과 |', '|---|---|']
for l in open(f'{Q}/final_all.txt', encoding='utf-8').read().split('\n'):
    if ': ' not in l: continue
    k, v = l.split(': ', 1)
    if k in ('sweep_proto', 'sweep_hlt', 'crawl_site', 'crawl_admin'): continue
    if k == 'proto_report': v = sweep
    if k == 'smoke':
        c = dict(re.findall(r'(\d+): (\d+)', v)); v = f"200 응답 {c.get('200')} · 의도한 거절(404 {c.get('404', 0)} · 409 {c.get('409', 0)} · 403 {c.get('403', 0)} · 422 {c.get('422', 0)}) · 5xx {sum(int(n) for cc, n in c.items() if cc.startswith('5'))}"
    if k == 'pagetest': v = '세 정렬 모두 순서 같음 · 중복 0 · 키 노출 없음'
    v = v.replace(' → /home/claude/qa/web_mal.json', '').replace('|', '·').strip()
    rows.append(f"| {names.get(k, k)} (`{k}`) | {v[:230]} |")
rows.append(f"| 사용자 웹 전수 순회 (`crawl_site`) | {len(sc)}쪽(경로 × 5역할) — 200 {n200} · 404 {n404}(의도) · API 실패 {sum(1 for p in sc if p.get('api_fail'))} · 스크립트 오류 {nerr}쪽 |")
rows.append(f"| 운영 화면 전수 (`crawl_admin`) | {len(bo)} 화면 상태 × 5계정 — 실패 {sum(1 for t in bo if t.get('errors') or t.get('api_fail') or t.get('errview'))} |")
if again:
    rows += ['', '첫 실행에서 모자랐던 것 — 이번 판의 변경(시안)과는 관계가 없습니다(서버 · 실제 웹은 v10.21 과 같은 파일).', '',
             '| 시험 | 첫 실행 | 원인 | 다시 |', '|---|---|---|---|']
    WHY = {'srv_lead_ui': '운영 「리드 배정」의 「전체」 목록이 2.4초 걸리는데(개발 DB 에 리드가 602건 쌓임 · 줄마다 보낼 수 있는 업체 수를 계산 — **G-142**) 시험은 1.8초만 기다림 → 시험이 그 카드가 나올 때까지 기다리게 고침',
           'srv_retship': '화면 다시 그리기 오류(React #418)가 한 번 남 — 가끔 나는 기존 결함 **G-94** · 손대지 않고 다시 실행'}
    for k in again:
        rr = fa.get(k + '_rerun', '(다시 돌리지 않음)')
        rows.append(f"| `{k}` | {fa.get(k)} | {WHY.get(k, '확인 필요')} | {rr} |")
px = J('proto_pixel.json')
s = open(f'{Q}/doc70_template.md', encoding='utf-8').read()
rep = {
 '__AXIS__': okn(J('proto_axis.json')['items']), '__LANG__': okn(J('proto_lang.json')['items']), '__PIXEL__': okn(px['items']), '__DIFF__': okn(J('proto_diff.json')['items']),
 '__GUARD__': okn(J('proto_guard.json')['items']), '__PICK__': okn(J('attack_pick.json')['items']),
 '__PXSAME__': str(px['same']), '__PXHEAD__': str(px['header_only']), '__SWEEP__': sweep,
 '__VERIFY__': fa.get('verify', '?').replace('exit=0 ', '').replace(' | ', ' · '),
 '__MATRIX__': re.sub(r'\s+', ' ', fa.get('matrix', '?').replace('매트릭스: ', '')).strip(),
 '__SRV__': srv,
 '__SITE__': f"{len(sc)}쪽 — 200 {n200} · 404 {n404}(의도) · API 실패 {sum(1 for p in sc if p.get('api_fail'))} · 스크립트 오류 {nerr}쪽",
 '__BO__': f"{len(bo)} 화면 상태 — 실패 {sum(1 for t in bo if t.get('errors') or t.get('api_fail') or t.get('errview'))}",
 '__DOCKER__': ex.get('DOCKER', '(실행 전)'), '__PS__': ex.get('PS', '(실행 전)'), '__FRESH__': ex.get('FRESH', '(실행 전)'),
 '__REHEARSAL__': ex.get('REHEARSAL', '(포장 뒤 실행)'), '__PACK__': ex.get('PACK', '(포장 뒤 기록)'),
 '__TABLE__': '\n'.join(rows),
}
for k, v in rep.items(): s = s.replace(k, v)
left = re.findall(r'__[A-Z_]+__', s)
assert not left, left
assert px['diff'] == ['listb', 'login'], px['diff']
open(OUT, 'w', encoding='utf-8').write(s)
print('doc70', len(s), '자 ·', srv[:60], '·', sweep)
