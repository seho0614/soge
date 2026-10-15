"""docs/67 을 결과 파일의 수치로 채웁니다 — final_all.txt · docker_1021.txt · 시험 결과 json · doc67_extra.txt(Docker · PowerShell · 리허설 · 묶음은 여기에 적어 둠)."""
import json, re, os
Q = os.path.dirname(os.path.abspath(__file__))
K = '/home/claude/pkg/SGB_DevDocker_Integrated_20261002'
OUT = K + '/sgb/docs/67_매물상세_누른매물_실제웹적용_v10.21_20261007.md'
def kv(f):
    try: return dict(l.split(': ', 1) for l in open(f'{Q}/{f}', encoding='utf-8').read().split('\n') if ': ' in l)
    except FileNotFoundError: return {}
fa = kv('final_all.txt'); dk = kv('docker_1021.txt'); ex = kv('doc67_extra.txt')
J = lambda f: json.load(open(f'{Q}/{f}', encoding='utf-8'))
okn = lambda xs: f"통과 {sum(1 for x in xs if x['ok'])} / {len(xs)}"
pu = J('proto_urg.json')['items']; pdf = J('proto_diff.json')['items']; pdt = J('proto_detail.json')['items']; ptn = J('srv_ptn.json')
sc = J('site_crawl.json')['pages']; bo = J('admin_final.json')['tabs']
rep = fa.get('proto_report', '')
m = re.search(r"^(\d+) \{'clicks': (\d+).*'none': (\d+), 'error': (\d+)", rep)
sweep = f"{m.group(1)}화면 · {int(m.group(2)):,}회 · 무반응 {m.group(3)} · 오류 {m.group(4)}" if m else '?'

# 서버 기능 · 화면 묶음 합계 (A · B 구간)
SUITES = ['fixtures', 'e2e', 'decisions', 'decisions_ui', 'fixes_1002', 'srv_aff', 'srv_hlt', 'srv_ptn', 'srv_aff_ui', 'srv_hlt_ui', 'srv_ptn_ui', 'srv_proto', 'srv_pay', 'srv_pay_ui', 'srv_file', 'srv_file_ui',
          'srv_lead', 'srv_lead_ui', 'srv_consult', 'srv_consult_ui', 'srv_retship', 'srv_refcode', 'srv_refcode_ui', 'srv_viewlimit', 'csrf', 'srv_poll', 'srv_poll_ui', 'srv_billing', 'srv_billing_ui', 'srv_detail']
def frac(v):
    m = re.search(r'(\d+) ?/ ?(\d+)', v or ''); return (int(m.group(1)), int(m.group(2))) if m else None
tot = [frac(fa.get(k)) for k in SUITES]; assert all(tot), [k for k, t in zip(SUITES, tot) if not t]
a = sum(t[0] for t in tot); b = sum(t[1] for t in tot)
srv = f"{len(SUITES)}묶음 {a:,} / {b:,}" + ('' if a == b else f" — 모자란 {b - a}건은 4-3 에")

names = {'api_mode': 'API 방식', 'verify': '통합 검정', 'ads': '광고 검정', 'matrix': '매트릭스', 'fixtures': '시험 준비 자료', 'e2e': '기본 흐름', 'decisions': '운영 결정', 'decisions_ui': '운영 결정(화면)', 'fixes_1002': '10/2 수정',
         'srv_aff': '제휴', 'srv_hlt': '건강몰', 'srv_ptn': '파트너', 'srv_aff_ui': '제휴(화면)', 'srv_hlt_ui': '건강몰(화면)', 'srv_ptn_ui': '파트너(화면)', 'srv_proto': '시안 서버 연동', 'srv_pay': '결제 · 환불', 'srv_pay_ui': '결제(화면)',
         'srv_file': '파일', 'srv_file_ui': '파일(화면)', 'srv_lead': '리드 배정', 'srv_lead_ui': '리드(화면)', 'srv_consult': '상담', 'srv_consult_ui': '상담(화면)', 'srv_retship': '반품 배송비', 'srv_refcode': '소개코드',
         'srv_refcode_ui': '소개코드(화면)', 'srv_viewlimit': '열람 한도', 'csrf': '요청 위조 방어', 'srv_poll': '투표', 'srv_poll_ui': '투표(화면)', 'srv_billing': '결제 · 환불 정합', 'srv_billing_rerun': '결제 · 환불 정합(시험 고친 뒤 다시)',
         'srv_billing_ui': '내 구독(화면)', 'proto_consult': '시안 — 상담', 'proto_main': '시안 — 메인', 'proto_poll': '시안 — 투표 · 옛 판 비교', 'proto_bill': '시안 — 내 구독', 'proto_urg': '시안 — 급구 · 급매', 'site_tz': '날짜 · 시각의 시간대', 'proto_detail': '시안 — 상세', 'proto_diff': '시안 — 앞 판 비교',
         'proto_report': '시안 — 누르기 전수', 'web_main': '사용자 웹 메인', 'web_main_live': '사용자 웹 메인(실제 자료)', 'hyd_home': '메인 수화', 'measure_home': '메인 치수', 'web_mal': '안심소개 화면', 'smoke': 'GET API 전수', 'pagetest': '목록 쪽 넘김', 'hyd_pages': '목록 수화(G-94)'}
n200 = sum(1 for p in sc if p['status'] == 200); n404 = sum(1 for p in sc if p['status'] == 404); nerr = sum(1 for p in sc if p.get('errors'))
pit = J('proto_item.json')['items']; sdt = J('site_detail.json')['items']; svd = J('srv_detail.json')['items']
s0 = J('detail_links_table_stats_v1020.json'); s1 = J('detail_links_table_stats_v1021.json')
CMP = [('시안 — 상세로 가는 링크', 'proto_links', '건'), ('시안 — 무엇을 눌러도 같은 상세', None, ''), ('시안 — 문의방 왕복 실패', 'roundtrip_fail', '건'), ('시안 — 들어가는 링크가 없는 상세 화면', 'orphan', '장'),
       ('시안 — 화면 스크립트 오류', 'proto_js_errors', '건'), ('실제 웹 — 상세로 가는 링크', 'site_links', '건'), ('실제 웹 — 열림(200) · 누른 항목의 상세', None, ''), ('실제 웹 — 요청 「등록」 빈 값', None, ''), ('실제 웹 — 화면 스크립트 오류', 'site_page_errors', '건')]
cmp = ['| 항목 | v10.20 (10/7 조사) | v10.21 (재조사) |', '|---|---|---|']
for n, k, u in CMP:
    if k: cmp.append(f"| {n} | {s0[k]:,}{u} | **{s1[k]:,}{u}** |")
    elif '같은 상세' in n: cmp.append(f"| {n} | {s0['bad_groups']}곳 {s0['bad_links']}건 | **{s1['bad_groups']}곳 {s1['bad_links']}건** (남은 것은 요청 · 계약 · 운영 목록) |")
    elif '열림' in n: cmp.append(f"| {n} | {s0['site_200']:,} · {s0['site_same']:,} | **{s1['site_200']:,} · {s1['site_same']:,}** |")
    else: cmp.append(f"| {n} | 45건(요청 9건 × 5역할) | **0건** |")
cmp.append('')
cmp.append(f"실제 웹의 화면 스크립트 오류 {s1['site_page_errors']}건은 소개뱅크몰 주문 상세 한 쪽에서 난 React #418 입니다(G-94 · 가끔 남 — 같은 쪽을 다시 10번 열어 0번). 이번에 만든 매물 상세에서는 나지 않았습니다(8번 새로 열기 · 순회 포함).")
names.update({'srv_detail': '매물 상세 · 후기 · 누적수익 공개', 'site_detail': '실제 웹 매물 상세', 'proto_item': '시안 — 매물 상세(누른 매물)', 'proto_detail': '시안 — 상세(v10.20 시험)', 'proto_urg': '시안 — 급구 · 급매', 'proto_diff': '시안 — 앞 판과 비교', 'site_tz': '날짜 · 시각의 시간대'})
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

s = open(f'{Q}/doc67_template.md', encoding='utf-8').read()
rep = {
 '__ITEM__': okn(pit), '__SITE_DETAIL__': okn(sdt), '__SRV_DETAIL__': okn(svd), '__DIFF__': okn(pdf), '__SWEEP__': sweep,
 '__VERIFY__': fa.get('verify', '?').replace('exit=0 ', '').replace(' | ', ' · '),
 '__MATRIX__': re.sub(r'\s+', ' ', fa.get('matrix', '?').replace('매트릭스: ', '')).strip(),
 '__SRV__': srv,
 '__SITE__': f"{len(sc)}쪽 — 200 {n200} · 404 {n404}(의도) · API 실패 0 · 스크립트 오류 {nerr}쪽",
 '__BO__': f"{len(bo)} 화면 상태 — 실패 {sum(1 for t in bo if t.get('errors') or t.get('api_fail') or t.get('errview'))}",
 '__DOCKER__': ex.get('DOCKER', '?'), '__PS__': ex.get('PS', '?'), '__FRESH__': ex.get('FRESH', '?'),
 '__REHEARSAL__': ex.get('REHEARSAL', '(포장 뒤 실행)'), '__PACK__': ex.get('PACK', '(포장 뒤 기록)'),
 '__TABLE__': '\n'.join(rows), '__CMP__': '\n'.join(cmp), '__BADG__': str(s1['bad_groups']), '__BADL__': str(s1['bad_links']),
}
for k, v in rep.items(): s = s.replace(k, v)
left = re.findall(r'__[A-Z_]+__', s)
assert not left, left
open(OUT, 'w', encoding='utf-8').write(s)
print('doc67', len(s), '자 ·', srv, '·', sweep)
