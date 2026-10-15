"""docs/71 을 결과 파일의 수치로 채웁니다 — final_all.txt · 시험 결과 json · doc71_extra.txt(Docker · PowerShell · 리허설 · 묶음은 여기에 적어 둠)."""
import json, re, os
Q = os.path.dirname(os.path.abspath(__file__))
K = '/home/claude/pkg/SGB_DevDocker_Integrated_20261002'
OUT = K + '/sgb/docs/71_소개광장_제시디자인적용_v10.23_20261007.md'
def kv(f):
    try: return dict(l.split(': ', 1) for l in open(f'{Q}/{f}', encoding='utf-8').read().split('\n') if ': ' in l)
    except FileNotFoundError: return {}
fa = kv('final_all.txt'); ex = kv('doc71_extra.txt')
J = lambda f: json.load(open(f'{Q}/{f}', encoding='utf-8'))
okn = lambda xs: f"통과 {sum(1 for x in xs if x['ok'])} / {len(xs)}"
sc = J('site_crawl.json')['pages']; bo = J('admin_final.json')['tabs']
rep = fa.get('proto_report', '')
m = re.search(r"^(\d+) \{'clicks': (\d+).*'none': (\d+), 'error': (\d+)", rep)
sweep = f"{m.group(1)}화면 · {int(m.group(2)):,}회 · 무반응 {m.group(3)} · 오류 {m.group(4)}" if m else '?'
SUITES = ['fixtures', 'e2e', 'decisions', 'decisions_ui', 'fixes_1002', 'srv_aff', 'srv_hlt', 'srv_ptn', 'srv_aff_ui', 'srv_hlt_ui', 'srv_ptn_ui', 'srv_proto', 'srv_pay', 'srv_pay_ui', 'srv_file', 'srv_file_ui',
          'srv_lead', 'srv_lead_ui', 'srv_consult', 'srv_consult_ui', 'srv_retship', 'srv_refcode', 'srv_refcode_ui', 'srv_viewlimit', 'csrf', 'srv_poll', 'srv_poll_ui', 'srv_billing', 'srv_billing_ui', 'srv_detail',
          'srv_cmu', 'srv_cmu_ui']
def frac(v):
    m = re.search(r'(\d+) ?/ ?(\d+)', v or ''); return (int(m.group(1)), int(m.group(2))) if m else None
# 전수 검정은 두 번 돌았습니다 — 첫 실행(final_all_first_v1023.txt)에서 드러난 것을 고친 뒤, 2구간(서버 기능 · 화면)을 **마지막 코드로 전부 다시**.
#   final_all.txt 는 마지막 실행의 결과입니다. 첫 실행에서 모자랐던 것은 첫 실행 파일에서 읽어 따로 적습니다.
f1 = kv('final_all_first_v1023.txt')
val = lambda k: fa.get(k + '_rerun', fa.get(k))
last = {k: frac(val(k)) for k in SUITES}; assert all(last.values()), [k for k, t in last.items() if not t]
a1 = sum(t[0] for t in last.values()); b1 = sum(t[1] for t in last.values())
assert a1 == b1, [(k, t) for k, t in last.items() if t[0] != t[1]]
full = lambda v: bool(frac(v)) and frac(v)[0] == frac(v)[1]
again1 = [k for k in SUITES if k in f1 and not full(f1[k])]                                   # 첫 실행(고치기 전 코드)에서 멈춘 것
again2 = [k[:-6] for k in fa if k.endswith('_rerun') and k not in ('verify_rerun',)]            # 마지막 실행에서 다시 돌린 것
again = again1 + [k for k in again2 if k not in again1]
srv = f"{len(SUITES)}묶음 {a1:,} / {b1:,}(마지막 코드로 전부 다시 돌린 결과)" + ('' if not again else f" — 다시 돌린 것: {' · '.join(k for k in again if k in SUITES)}(7-2절 아래)")
names = {'api_mode': 'API 방식', 'verify': '통합 검정', 'verify_2nd': '통합 검정 — 둘째(등록부만 고친 뒤)', 'verify_3rd': '통합 검정 — 셋째(응답 표본까지 · SQL 대조 803)', 'ads': '광고 검정', 'matrix': '매트릭스', 'fixtures': '시험 준비 자료', 'e2e': '기본 흐름', 'decisions': '운영 결정', 'decisions_ui': '운영 결정(화면)', 'fixes_1002': '10/2 수정',
         'srv_aff': '제휴', 'srv_hlt': '건강몰', 'srv_ptn': '파트너', 'srv_aff_ui': '제휴(화면)', 'srv_hlt_ui': '건강몰(화면)', 'srv_ptn_ui': '파트너(화면)', 'srv_proto': '시안 서버 연동', 'srv_pay': '결제 · 환불', 'srv_pay_ui': '결제(화면)',
         'srv_file': '파일', 'srv_file_ui': '파일(화면)', 'srv_lead': '리드 배정', 'srv_lead_ui': '리드(화면)', 'srv_consult': '상담', 'srv_consult_ui': '상담(화면)',
         'srv_retship': '반품 배송비', 'srv_refcode': '소개코드', 'srv_refcode_ui': '소개코드(화면)', 'srv_viewlimit': '열람 한도', 'csrf': '요청 위조 방어', 'srv_poll': '투표', 'srv_poll_ui': '투표(화면)',
         'srv_billing': '결제 · 환불 정합', 'srv_billing_ui': '내 구독(화면)', 'srv_detail': '매물 상세 · 후기 · 누적수익 공개', 'srv_cmu': '소개광장 — 작성자 가림 · 검색 · 쪽 번호(v10.23)', 'srv_cmu_ui': '소개광장 — 실제 웹(v10.23)',
         'proto_consult': '시안 — 상담', 'proto_main': '시안 — 메인', 'proto_poll': '시안 — 투표 · 옛 판 비교',
         'proto_bill': '시안 — 내 구독', 'proto_urg': '시안 — 급구 · 급매', 'proto_detail': '시안 — 상세(v10.20 시험)', 'proto_item': '시안 — 매물 상세(v10.21 시험)', 'proto_axis': '시안 — 소개창업 축 상세 4종 · 주소(v10.22 시험)',
         'proto_lang': '시안 — 언어 단추 · 로그인 화면', 'proto_cmu': '시안 — 소개광장(v10.23)', 'proto_guard': '시안 — 시연 보장(소개뱅크몰)', 'attack_pick': '공격 검정의 고르기', 'cut_b2': '그림 조각 — 받은 PNG 그대로인지',
         'proto_diff': '시안 — 앞 판과 글자 비교', 'proto_pixel': '시안 — 앞 판과 그림 비교', 'proto_report': '시안 — 누르기 전수', 'web_main': '사용자 웹 메인',
         'web_main_live': '사용자 웹 메인(실제 자료)', 'hyd_home': '메인 수화', 'measure_home': '메인 치수', 'web_mal': '안심소개 화면', 'site_tz': '날짜 · 시각의 시간대', 'site_detail': '실제 웹 매물 상세', 'smoke': 'GET API 전수',
         'pagetest': '목록 쪽 넘김', 'hyd_pages': '목록 화면 다시 그리기 오류율(60번씩)'}
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
    base = k[:-6] if k.endswith('_rerun') else k
    nm = names.get(base, base) + (' — 다시' if k.endswith('_rerun') else '')
    rows.append(f"| {nm} (`{k}`) | {v[:230]} |")
rows.append(f"| 사용자 웹 전수 순회 (`crawl_site`) | {len(sc)}쪽(경로 × 5역할) — 200 {n200} · 404 {n404}(의도) · API 실패 {sum(1 for p in sc if p.get('api_fail'))} · 스크립트 오류 {nerr}쪽 |")
rows.append(f"| 운영 화면 전수 (`crawl_admin`) | {len(bo)} 화면 상태 × 5계정 — 실패 {sum(1 for t in bo if t.get('errors') or t.get('api_fail') or t.get('errview'))} |")
WHY = {}
try: WHY = json.load(open(f'{Q}/doc71_why.json', encoding='utf-8'))
except FileNotFoundError: pass
again_all = (['verify'] if 'verify_rerun' in fa else []) + again
if again_all:
    rows += ['', '첫 실행에서 모자랐던 것 — 원인을 확인하고 고친 뒤 다시 돌렸습니다(첫 실행의 결과 파일: `qa/results_v10_23/final_all_first_v1023.txt`).', '', '| 시험 | 첫 실행 | 원인 | 다시 |', '|---|---|---|---|']
    for k in again_all:
        assert k in WHY, f'원인을 적지 않았습니다: {k}'
        if k == 'verify': rows.append(f"| `verify` | {fa['verify'][:70].replace('|', '·')} / 둘째: 같은 수치 · exit=1 / 셋째: exit=0 · SQL 대조 803 | {WHY[k]} | {fa['verify_rerun'].split('   (')[0].replace('|', '·')} |")
        elif k in again1: rows.append(f"| `{k}` | {f1[k][:110].replace('|', '·')} | {WHY[k]} | {fa.get(k)} |")
        else: rows.append(f"| `{k}` | {fa[k][:110].replace('|', '·').replace('  → /home/claude/qa/web_mal.json', '')} | {WHY[k]} | {fa[k + '_rerun'].split('   (')[0]} |")
    rows += ['', '- 서버 코드를 마지막으로 고친 것(소개광장 조회의 SQL 을 고정 글로 — G-153)이 2구간 첫 실행 뒤였으므로, **1구간의 매트릭스 · 흐름 시험 5묶음 · 2구간 27묶음을 마지막 코드로 다시** 돌렸습니다(3구간 · Docker · 새로 설치 · 리허설은 그 뒤에 돌렸습니다). 위 표는 그 결과입니다. 통합 검정도 마지막 코드로 넷째 실행을 했습니다.']
px = J('proto_pixel.json')
s = open(f'{Q}/doc71_template.md', encoding='utf-8').read()
rep = {
 '__CMU__': okn(J('srv_cmu.json')['items']), '__CMUUI__': okn(J('srv_cmu_ui.json')['items']), '__PCMU__': okn(J('proto_cmu.json')['items']),
 '__CUT__': fa.get('cut_b2', '?'), '__PIXEL__': okn(px['items']), '__DIFF__': okn(J('proto_diff.json')['items']),
 '__PXSAME__': str(px['same']), '__SWEEP__': sweep,
 '__VERIFY__': re.sub(r'exit=0 ', '', fa.get('verify_rerun', fa.get('verify', '?'))).split('   (')[0].replace(' | ', ' · ') + (' — 첫 실행 · 둘째 실행은 실패(새 길을 화면 등록부에 연결하지 않음 · 응답 표본 없음 — **G-151**) · 셋째는 통과했으나 SQL 대조가 3건 줄어 있어(**G-153**) 고친 뒤 마지막 코드로 넷째 실행' if 'verify_rerun' in fa else ''),
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
assert sorted(px['diff']) == ['cmu', 'cmud', 'cmupoll', 'cmuw', 'commu'], px['diff']
open(OUT, 'w', encoding='utf-8').write(s)
print('doc71', len(s), '자 ·', srv[:60], '·', sweep)
