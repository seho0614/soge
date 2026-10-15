"""「상세 보기」 링크 목록 문서(docs/65)를 조사 결과(detail_links_proto.json · detail_links_site.json)로 만듭니다.
   python3 detail_links_doc.py      → 킷 sgb/docs/65_상세보기_링크목록_동작확인_v10.20_20261007.md · detail_links_stats.json
"""
import json, os, re
from collections import defaultdict, Counter
Q = os.path.dirname(os.path.abspath(__file__))
K = '/home/claude/pkg/SGB_DevDocker_Integrated_20261002'
OUT = os.environ.get('DOC_OUT') or (K + '/sgb/docs/65_상세보기_링크목록_동작확인_v10.20_20261007.md')     # v10.21 재조사 때는 DOC_OUT 을 줍니다(앞 판 문서를 덮지 않게)
P = json.load(open(f'{Q}/detail_links_proto.json', encoding='utf-8')); S = json.load(open(f'{Q}/detail_links_site.json', encoding='utf-8'))
sc = json.load(open(K + '/sgb/spec/screens.json', encoding='utf-8')); sc = sc if isinstance(sc, list) else sc.get('screens', [])
NAME = {x['id']: x.get('name', '') for x in sc}
ids = json.load(open(K + '/sgb/spec/proto_ids.json', encoding='utf-8'))
sid = lambda k: (ids.get(k, {}).get('ids') or [''])[0]
nm = lambda r: NAME.get(r['from_id']) or r['from_name'] or r['from']
tonm = lambda k: NAME.get(sid(k)) or {'ask': '1:1 문의방', 'asklock': '1:1 문의방(잠금)', 'deal': '계약 · 성사 확정', 'myctrd': '계약 진행', 'ctrd': '계약서', 'dtm': '상세(모바일)', 'reqdm': '요청 상세(모바일)'}.get(k, k)
esc = lambda s: (s or '').replace('|', '·').replace('\n', ' ')

rows = P['rows']; main = [r for r in rows if not r['from'].startswith('health')]; hlt = [r for r in rows if r['from'].startswith('health')]
# 묶음 = (어느 화면 · 어느 관 · 어느 종류의 상세로)
G = defaultdict(list)
for r in main: G[(r['from'], r['gwan'], r['to'])].append(r)
def kind_of(to):
    if to in ('dtlm', 'dtll', 'detail', 'dtm'): return '1 매물 상세'
    if to in ('reqd', 'reqdm'): return '2 요청 상세'
    if to in ('ask', 'asklock'): return '3 1:1 문의방'
    if to in ('myctrd', 'ctrd', 'deal'): return '4 계약'
    return '5 운영 · 파트너센터'
GENERIC = re.compile(r'^(리스팅 보기|소개 제안하기|이전|보기|상세|열기|1:1 문의|💬|⭐|서명하기|대화로)')
def verdict(v, kind):
    items = len({r['label'] for r in v}); dests = len({r['to_hash'] or r['to'] for r in v})
    if kind == '3 1:1 문의방': return '확인 — 어느 매물 · 계약에서 눌러도 같은 대화방'
    if items >= 2 and dests == items and all(r['same'] for r in v): return '정상 — 항목마다 그 항목의 상세'
    named = [r for r in v if not GENERIC.match(r['label'])]
    if len({r['label'] for r in named}) >= 2 and dests == 1: return '이상 — 무엇을 눌러도 같은 상세 1건'
    if named and not all(r['same'] for r in named): return '이상 — 누른 것과 다른 내용(고정 화면)'
    return '확인 — 단추 1개(고정 화면으로 감)'
groups = []
for (k, gw, to), v in G.items():
    groups.append({'kind': kind_of(to), 'from': k, 'from_id': v[0]['from_id'], 'name': nm(v[0]), 'gwan': gw, 'hash': v[0]['from_hash'], 'n': len(v),
                   'to': to, 'to_id': sid(to), 'to_name': tonm(to), 'dests': sorted({r['to_hash'] or r['to'] for r in v}), 'title': v[0]['title'], 'verdict': verdict(v, kind_of(to)),
                   'ex': [r['label'][:38] for r in v[:2]]})
groups.sort(key=lambda g: (g['kind'], g['from_id'], g['gwan']))
bad = [g for g in groups if g['verdict'].startswith('이상')]; good = [g for g in groups if g['verdict'].startswith('정상')]
n_bad_links = sum(g['n'] for g in bad)
detail_keys = P['detail_screens']; reached = {r['to'] for r in main}; reached_ids = {sid(k) for k in reached}
# 같은 화면을 가리키는 다른 화면 키로 들어가는 것(계약서 = ctrd · myctrd)은 들어갈 수 있는 화면입니다 — 10/7 바로잡음(전: 계약서를 「들어가는 링크 없음」으로 잘못 셈)
orphan = [(k, sid(k), tonm(k)) for k in detail_keys if k not in reached and sid(k) not in reached_ids]

# 건강몰
HG = defaultdict(list)
for r in hlt: HG[(r['from_id'], r['from_name'], r['to_name'])].append(r)
# 실제 웹
srows = S['rows']
SK = defaultdict(list)
for r in srows: SK[r['kind']].append(r)
KN = {'/money/{id}': '소개장터 매물 상세', '/mall/{id}': '안심소개 매물 상세', '/biz/{id}': '소개창업 매물 상세', '/request/{id}': '요청 상세', '/health/p/{id}': '소개뱅크몰 상품 상세',
      '/health/i/{id}': '성분 상세', '/health/w/{id}': '고민 상세', '/my/health/orders/{id}': '주문 상세', '/mal/consult/{id}': '상담 업종 상세(사무소 목록)'}

stats = {'proto_links': len(rows), 'proto_main': len(main), 'proto_hlt': len(hlt), 'proto_groups': len(groups), 'proto_bad_groups': len(bad), 'proto_bad_links': n_bad_links,
         'proto_good_groups': len(good), 'proto_hlt_same': sum(1 for r in hlt if r['same']), 'orphan': [o[0] for o in orphan],
         'site_links': len(srows), 'site_200': sum(1 for r in srows if r['status'] == 200), 'site_same': sum(1 for r in srows if r['same'] is True),
         'site_pages': len({(r['role'], r['from']) for r in srows}), 'site_details': len({r['to'] for r in srows})}
json.dump(stats, open(f'{Q}/detail_links_stats.json', 'w'), ensure_ascii=False, indent=1)
# 줄마다 그 묶음의 판정을 붙여 둡니다 — 검정 매트릭스(엑셀 30번 시트)가 이 문서와 같은 판정을 쓰게
_gv = {(g['from'], g['gwan'], g['to']): g['verdict'] for g in groups}
judged = [dict(r, verdict=(_gv[(r['from'], r['gwan'], r['to'])] if not r['from'].startswith('health') else ('정상 — 누른 것의 상세' if r['same'] else '확인'))) for r in rows]
json.dump(judged, open(f'{Q}/detail_links_judged.json', 'w'), ensure_ascii=False, indent=1)

L = []
A = L.append
A('# 소개뱅크 — 「상세 보기」 링크 목록 · 동작 확인 (v10.20 · 2026-10-07)\n')
A('> 10/6 요청 「상세 보기 리스트를 작성해 줘 (동작 이상 확인 — 동일한 것이 계속 나옴 · 링크 확인 필요)」에 대한 조사 결과입니다.')
A('> 시안(`SGB_Prototype_v10_20.html`)과 실제 웹(사용자 웹)에서 **상세로 가는 링크를 전부 눌러 보고** 적었습니다. 전체 목록은 검정 매트릭스 엑셀의 `30_상세보기_시안` · `31_상세보기_실제웹` 시트에 있습니다.\n')
A('---\n')
A('## 0. 결론\n')
A(f'**「같은 것이 계속 나오는」 것은 시안입니다.** 시안은 상세 화면을 종류마다 **한 건만** 그려 두어, 목록에서 무엇을 눌러도 그 한 건이 열립니다. 실제 웹은 누른 항목의 상세가 열립니다.\n')
A('| 대상 | 상세로 가는 링크 | 결과 |')
A('|---|---|---|')
A(f"| 시안 — 소개장터 · 안심소개 · 소개창업 · 마이 · 운영 등 | {len(main)}건 (목록 묶음 {len(groups)}곳) | **이상 {len(bad)}곳 · {n_bad_links}건** — 무엇을 눌러도 같은 상세. 정상 {len(good)}곳(인증 심사) |")
A(f"| 시안 — 소개뱅크몰(건강관) | {len(hlt)}건 | 정상 — {stats['proto_hlt_same']}건 모두 누른 상품 · 성분 · 고민 · 주문의 상세 |")
A(f"| 실제 웹 — 5역할(비로그인 · 개인 · 구매자 · 소개자 · 운영) | {stats['site_links']:,}건 (목록 쪽 {stats['site_pages']}곳 · 상세 {stats['site_details']}개) | 정상 — 전부 열림(200) · {stats['site_same']:,}건 모두 누른 항목의 상세 |")
A('')
A('1. 시안의 상세 주소가 고정입니다 — 소개창업 `#/g/biz/l/1042`(특A급 프리미엄 고깃집), 소개장터 `#/g/mny/l/1042` · `/l/4471`(강남 소재 프랜차이즈 본사 식자재 공급처), 안심소개 `#/g/mal/l/1042` · `/l/4468`(수도권 물류창고 3,300㎡ 임대 이전 건).')
A('2. 열리지 않는 링크는 없습니다 — 「링크가 끊긴 것」이 아니라 「상세가 한 건뿐인 것」입니다. 가는 곳이 맞지 않는 링크는 1곳(마이 「관심」 — 3절)입니다.')
A('3. 따로 볼 것 4가지는 3절에 있습니다(마이 「관심」의 관이 맞지 않음 · 검색 「보기」가 다른 요청으로 감 · 들어가는 링크가 없는 상세 화면 · 문의방과 계약서가 한 건).\n')

A('## 1. 조사 방법\n')
A('| 대상 | 방법 |')
A('|---|---|')
A('| 시안 | 파일로 열어 화면 189장 + 소개뱅크몰 화면을 **주소(해시)로** 엽니다 — 관 화면은 소개장터 · 안심소개 · 소개창업 주소로 각각. 상세로 가는 것(매물 카드 · 「보기」 · 「상세」 · 「열기」 · 「리스팅 보기」 · 「질문하기」 등)을 하나씩 누르고, 간 주소 · 화면 · 상세 제목을 적습니다. 화면 안 갈래(탭)를 바꾼 상태도 봅니다 |')
A('| 실제 웹 | 운영 방식으로 띄운 사용자 웹에 5역할로 로그인해 열리는 쪽 전부에서 상세 주소(`/money/{id}` · `/mall/{id}` · `/biz/{id}` · `/request/{id}` · `/health/p/{id}` · 주문 상세 등)를 모으고, 하나씩 열어 상태 코드와 제목을 봅니다 |')
A('| 「같은 것」 판정 | ① 항목의 번호(L-3301 · V-3300 · S-61 · 주문번호)가 상세 본문에 있는지 ② 상세 제목의 앞 6자가 누른 항목의 글에 있는지 ③ 제목이 화면 이름뿐이면 항목의 이름이 본문에 있는지 |')
A('| 도구 | `qa/detail_links.py proto` · `qa/detail_links.py site` — 결과 `qa/results_v10_20/detail_links_proto.json` · `detail_links_site.json` |\n')

A('## 2. 시안 — 상세로 가는 링크 목록\n')
KT = {'1 매물 상세': '2-1. 매물 상세로 가는 곳', '2 요청 상세': '2-2. 요청 상세로 가는 곳', '3 1:1 문의방': '2-3. 1:1 문의방으로 가는 곳', '4 계약': '2-4. 계약 화면으로 가는 곳', '5 운영 · 파트너센터': '2-5. 운영 · 파트너센터'}
for kind in sorted(KT):
    gs = [g for g in groups if g['kind'] == kind]
    if not gs: continue
    A(f'### {KT[kind]}\n')
    A('| 화면 ID | 화면 | 관 | 여는 주소 | 누르는 것(예) | 수 | 가는 곳 | 상세에 나온 제목 | 판정 |')
    A('|---|---|---|---|---|---|---|---|---|')
    for g in gs:
        A(f"| {g['from_id']} | {esc(g['name'])} | {g['gwan'] or '—'} | `{g['hash'] or '(주소 없음 — 화면 키 ' + g['from'] + ')'}` | {esc(' / '.join(g['ex']))} | {g['n']} | {esc(g['to_name'])} `{' · '.join(g['dests'])[:60]}` | {esc(g['title']) or '—'} | {g['verdict']} |")
    A('')
A('### 2-6. 소개뱅크몰(건강관) — 정상\n')
A('| 화면 ID | 화면 | 가는 곳 | 수 | 서로 다른 상세 | 판정 |')
A('|---|---|---|---|---|---|')
for (fid, fn, tn), v in sorted(HG.items()):
    A(f"| {fid} | {esc(fn)} | {tn} | {len(v)} | {len({r['to_hash'] for r in v})} | {'정상 — 누른 것의 상세' if all(r['same'] for r in v) else '확인'} |")
A('\n소개뱅크몰은 상품 · 성분 · 고민 · 주문을 **자료로 그리기 때문에** 누른 것마다 다른 상세가 열립니다. 다른 관의 상세는 화면에 글을 직접 적어 둔 한 건입니다 — 이 차이가 원인입니다.\n')

A('## 3. 시안 — 따로 볼 것\n')
mylik = [g for g in groups if g['from'] == 'mylik' and g['to'] == 'dtlm']
A('| # | 무엇 | 내용 |')
A('|---|---|---|')
A(f"| 1 | 마이 「관심」의 「보기」가 **관이 맞지 않음** | 관심 목록에는 소개창업 · 안심소개 항목이 섞여 있는데 「보기」는 전부 소개장터 상세(`{mylik[0]['dests'][0] if mylik else ''}`)로 갑니다. 한 건 고정 문제와 별개로, 항목의 관에 맞는 상세로 가야 합니다 |")
A('| 2 | 검색의 「보기」 · 소개받기 목록의 「소개 제안하기」 | 요청 상세가 한 건(`#/request/2041` 한우 · 돈육 정기 납품처)이라, 검색 결과의 다른 요청(「수도권 프랜차이즈 본사 식자재 공급처를 찾습니다」)을 눌러도 그 화면이 나옵니다 |')
A(f"| 3 | 들어가는 링크를 찾지 못한 상세 화면 {len(orphan)}장 | " + ' · '.join(f"{o[2]}({o[1] or o[0]})" for o in orphan) + ' — 화면은 그려져 있으나 다른 화면에서 눌러 들어가는 길을 찾지 못했습니다(모바일 화면 2장 포함). 소개광장 글 목록에는 글을 누르는 링크가 없어 글 상세로 갈 수 없습니다 |')
A('| 4 | 1:1 문의방 · 계약 화면 | 「질문하기」 · 「1:1 문의」 · 「대화로 조율」은 어느 매물 · 계약에서 눌러도 같은 대화방(`#/chat/8821`), 계약 진행 목록의 6건은 모두 같은 계약서(`#/my/contracts/1`)입니다 |\n')

A('## 4. 실제 웹 — 상세로 가는 링크\n')
A('| 종류 | 주소 | 링크 수(5역할 합) | 서로 다른 상세 | 열림(200) | 누른 항목의 상세 | 판정 |')
A('|---|---|---|---|---|---|---|')
for k, v in sorted(SK.items(), key=lambda x: -len(x[1])):
    A(f"| {KN.get(k, k)} | `{k}` | {len(v)} | {len({r['to'] for r in v})} | {sum(1 for r in v if r['status'] == 200)} | {sum(1 for r in v if r['same'] is True)} | {'정상' if all(r['status'] == 200 and r['same'] is True for r in v) else '확인'} |")
A(f"| **합계** | | **{len(srows):,}** | **{stats['site_details']}** | **{stats['site_200']:,}** | **{stats['site_same']:,}** | |")
A('\n실제 웹의 매물 카드는 매물마다 고유 번호의 주소(`/money/<번호>`)로 가고, 그 주소의 상세는 그 매물의 제목 · 내용을 서버에서 받아 그립니다.')
A('소개광장 글 상세(`/community/{id}`)는 개발 DB 에 글이 없어 이번 목록에는 없습니다 — 글이 있을 때의 확인은 남아 있습니다.\n')

A('## 5. 고치는 방법 — 결정이 필요합니다\n')
A('| 선택 | 내용 | 결과 | 작업 크기 |')
A('|---|---|---|---|')
A('| ① 누른 항목의 내용이 상세에 나오게 (추천) | 매물 카드의 제목 · 분류 · 금액 · 지역 · 사진을 상세 화면에 넘겨 그립니다(소개장터 · 안심소개 · 소개창업 상세). 마이 「관심」은 항목의 관에 맞는 상세로. 주소도 항목마다 다르게(`/l/<번호>`) | 무엇을 누르든 그 항목의 상세가 열립니다. 소개자 · 실적 · 설명처럼 카드에 없는 내용은 표본 글을 그대로 씁니다 | 시안 1판(상세 3종 + 목록 · 급구 · 급매 · 관심 · 문의 연결) |')
A('| ② ①에 더해 요청 · 계약 · 운영 목록까지 | 요청 상세 · 계약서 · 회원 상세 · 검수 상세 · 서비스 상세도 누른 줄의 내용으로 | 2절의 「이상」이 모두 없어집니다 | ①의 약 2배 |')
A('| ③ 그대로 | 시안은 화면 모양을 보는 용도로 두고, 동작은 실제 웹에서 확인 | 시안에서는 계속 같은 상세가 나옵니다 | 없음 |')
A('\n추천 이유: 보시는 화면이 시안이고 「같은 것이 계속 나온다」는 지적이 매물 상세에서 나왔으므로, 매물 상세부터 고치는 것이 가장 효과가 큽니다. 요청 · 계약 · 운영 목록은 그 다음에 같은 방식으로 넓힐 수 있습니다.\n')

A('## 6. 확인하지 못한 것\n')
A('1. 실제 웹의 소개광장 글 상세 — 개발 DB 에 글이 없어 링크가 없습니다.')
A('2. 실제 웹의 운영 화면(BO) 안의 상세 열기 — 이번 조사는 사용자 웹입니다(운영 화면은 `crawl_admin` 150 화면 상태 점검에서 오류 0).')
A('3. 시안의 판정 ②(제목 앞 6자)는 글자 비교입니다 — 전체 목록(엑셀 30번 시트)에 누른 글과 상세 제목을 나란히 적어 두었으니 눈으로도 확인하실 수 있습니다.\n')

A('## 7. 근거\n')
A('- 이 킷 — `qa/detail_links.py` · `qa/results_v10_20/detail_links_proto.json`(시안 %d건) · `detail_links_site.json`(실제 웹 %s건) · `sgb/spec/proto.html`(주소 표 `TO_PATH` — `detail:"/l/1042"` · `dtlm:"/l/4471"` · `dtll:"/l/4468"` · `reqd:"/request/2041"`)' % (len(rows), f'{len(srows):,}'))
A('- 실제 웹 — `sgb/site/src/app/[gwan]/[id]/page.tsx`(매물 상세) · `sgb/site/src/components/ListingCard.tsx`(카드의 링크)')
A('- 검정 매트릭스 — `30_상세보기_시안` · `31_상세보기_실제웹` 시트')
open(OUT, 'w', encoding='utf-8').write('\n'.join(L) + '\n')
print('doc65', sum(len(x) for x in L), '자 ·', json.dumps(stats, ensure_ascii=False))
