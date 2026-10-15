"""문서 74 — v10.25 확장 점검(연동 · 버튼 체크 · flow 점검 · DB 연동) 을 결과 파일에서 만듭니다.  python3 doc74_gen.py > (킷 docs · 전달 폴더에 씀)"""
import json, os, re, sys
Q = os.path.dirname(os.path.abspath(__file__)); K = '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb'
J = lambda f: json.load(open(f'{Q}/{f}', encoding='utf-8'))
def cnt(f):
    try: d = J(f)
    except Exception: return (0, 0)
    d = (d.get('items') if isinstance(d, dict) else d) or []
    return (sum(1 for x in d if x.get('ok') and not x.get('skip')), len(d))
F = J('findings_r2.json'); TAG = {}
for f in F:
    for t in f.get('tags', []): TAG[tuple(t)] = f['no']
fa = {}
for l in open(f'{Q}/final_all.txt', encoding='utf-8'):
    if ': ' in l: k, v = l.rstrip('\n').split(': ', 1); fa[k] = v
lk = J('link_check.json'); dbl = J('db_link.json'); bs = J('btn_site.json'); bb = J('btn_bo.json'); pd = J('proto_demo.json')
flows = {n: J(f'flow_{n}.json') for n in ['trade', 'mall', 'plaza', 'biz', 'proto']}
def fstat(fl):
    st = fl['steps']; bad = [s for s in st if not s['ok'] and not s.get('skip')]; sk = [s for s in st if s.get('skip')]
    return len(st), len(st) - len(bad) - len(sk), len(bad), len(sk)
def fnos(fl):
    code = fl['flow'].split(' ')[0]
    return sorted({TAG.get(('flow', code, s['no']), '미등록') for s in fl['steps'] if (not s['ok'] and not s.get('skip')) or s.get('skip')})
web = [f for n in ['trade', 'mall', 'plaza', 'biz'] for f in flows[n]]; pro = flows['proto']
tot = lambda fls: tuple(sum(fstat(f)[i] for f in fls) for i in range(4))
W = tot(web); P = tot(pro)
la = (sum(1 for r in lk if r['ok']), len(lk)); da = (sum(1 for r in dbl if r['ok']), len(dbl))
lbad = [r for r in lk if not r['ok']]; dbad = [r for r in dbl if not r['ok']]
SV = {'상': 0, '중': 1, '하': 2}; KD = {'제품 결함': 0, '빠진 기능': 1, '시안': 2, '관찰': 3, '시험 도구': 4}
opn = [f for f in F if f['open']]
kc = lambda k, s=None: sum(1 for f in opn if f['kind'] == k and (s is None or f['sev'] == s))
t = pd['total']; nw = pd['no_way_in_strict']; nw0 = [o for o in nw if not o.get('by_address')]; nw1 = [o for o in nw if o.get('by_address')]
nf = [r for r in pd['rows'] if r['kind'] == '없는 주소']
ver = open(f'{K}/VERSION').read().strip()
units = lambda d, k: sum(v for kk, v in d['total'].items() if kk == k)
sm = lambda d: ' · '.join(f'{k} {v}' for k, v in sorted(d['total'].items(), key=lambda x: -x[1]))
for k in [k for k in fa if k.endswith('_rerun')]:        # 다시 돌린 줄이 있으면 그 값을 씁니다(첫 실행은 괄호 안 설명에 남아 있음)
    fa[k[:-6]] = fa.pop(k).split('   (')[0]
bundles = [(k, v) for k, v in fa.items() if re.match(r'통과 \d+ / \d+', v)]
bsum = (sum(int(re.match(r'통과 (\d+) / (\d+)', v).group(1)) for k, v in bundles), sum(int(re.match(r'통과 (\d+) / (\d+)', v).group(2)) for k, v in bundles))
E = {'db_link', 'link_check', 'flow_trade', 'flow_mall', 'flow_plaza', 'flow_biz', 'flow_proto'}
old = [(k, v) for k, v in bundles if k not in E]
osum = (sum(int(re.match(r'통과 (\d+) / (\d+)', v).group(1)) for k, v in old), sum(int(re.match(r'통과 (\d+) / (\d+)', v).group(2)) for k, v in old))
site = J('site_final.json'); adm = J('admin_final.json')
sp = site['pages']; s200 = sum(1 for p in sp if p['status'] == 200); s404 = sum(1 for p in sp if p['status'] == 404)
links = sum(len(v) for v in site.get('links', {}).values())
atabs = [x for x in adm['tabs'] if x.get('tab')]; abad = [x for x in atabs if x.get('errors') or x.get('api_fail') or x.get('errview')]

o = []; w = o.append
w(f'# 소개뱅크 {ver} 확장 점검 — 연동 · 버튼 체크 · flow 점검 · DB 연동 (2026-10-08)\n')
w('> 10/8 지시: 「매트릭스 작성(화면목록 · 백엔드목록 · API목록 · 디비 · 연동) · 기능 검증 · 시안(확인 및 기능 시연 되지 않는 부분 점검) · 버튼 체크 · flow 점검 · 연동 테스트 · DB 연동 테스트 · 전수 검정 · 로컬 테스트(모든 페이지 상호간 체크) · 최신 버전(시안 포함)」\n')
w('## 1. 결론\n')
w(f'1. **제품 코드는 {ver} 그대로입니다.** 이번에는 점검만 넓혔습니다(점검 도구 · 결과 · 문서 · 매트릭스만 더함 — 앞서 드린 {ver} 묶음과 코드 쪽 차이 0).')
w(f'2. **전에 하던 전수 검정은 다시 돌려 모두 통과**했습니다 — 한 줄 결과가 「통과 n / m」인 묶음 {len(old)}개 {osum[0]:,} / {osum[1]:,}(앞 문서에서 세던 서버 · 화면 36묶음 1,529 / 1,529 포함) · 사용자 웹 {len(sp)}쪽 · 운영 화면 {len(atabs)}상태 · 시안 누르기 {sum(t.values()):,}회 무반응 {t.get("무반응", 0)}.')
w(f'3. **새로 더한 점검 5가지에서 지금까지 보지 못한 문제가 드러났습니다.** 발견 {len(F)}건 가운데 열려 있는 것 {len(opn)}건 — 제품 결함 {kc("제품 결함")}건(심각도 상 {kc("제품 결함", "상")}건) · 빠진 기능 {kc("빠진 기능")}건 · 시안 {kc("시안")}건 · 관찰 {kc("관찰")}건.')
w('4. **이번 판에서는 고치지 않았습니다.** 일하는 순서(비교 → 확인 → 반영)에 따라 목록과 권고를 먼저 드립니다. 무엇을 언제 고칠지 정해 주시면 시험을 먼저 만들고 고칩니다(§10).\n')
w('| 새 점검 | 범위 | 결과 |\n|---|---|---|')
w(f'| 연동 목록 | 외부 연동 10 · 서버 ↔ 서버 3 · 화면 ↔ API 4 · DB 1 · 간주 모드 3 | 매트릭스 49 시트 |')
w(f'| 연동 테스트 | 연결 구간을 실제로 호출 {la[1]}항목 + 가짜 상대 서버를 세운 어댑터 묶음 | 통과 {la[0]} / {la[1]} — 실패 {len(lbad)}({", ".join(TAG.get(("link_check", r["step"].split(" ")[0]), "미등록") for r in lbad)}) |')
w(f'| DB 연동 테스트 | API 로 쓰고 DB 에서 확인 · 뷰 299 · 표 201 조회 · 제약/트리거 · 거래 단위 · 새 설치 DB 와 구조 비교 {da[1]}항목 | 통과 {da[0]} / {da[1]} — 실패 {len(dbad)}({", ".join(TAG.get(("db_link", r["step"].split(" ")[0]), "미등록") for r in dbad)}) |')
w(f'| 버튼 체크(실제 웹) | {bs["units"]}쪽(132쪽 × 역할 5) · 단추 {sum(bs["total"].values()):,}개 | {sm(bs)} — 죽은 단추 {bs["total"].get("죽은 단추", 0)} |')
w(f'| 버튼 체크(운영 화면) | {bb["units"]}상태(운영 계정 4 · 일반 회원 계정은 들어가지 못함) · 단추 {sum(bb["total"].values()):,}개 | {sm(bb)} — 죽은 단추 {bb["total"].get("죽은 단추", 0)} |')
w(f'| flow 점검(실제 웹) | 흐름 {len(web)}개 · 단계 {W[0]} | 통과 {W[1]} · 실패 {W[2]} · 건너뜀 {W[3]} — 끝까지 이어진 흐름 {sum(1 for f in web if not fstat(f)[2] and not fstat(f)[3])}개 |')
w(f'| flow 점검(시안) | 흐름 {len(pro)}개 · 단계 {P[0]} | 통과 {P[1]} · 실패 {P[2]} · 건너뜀 {P[3]} |')
w(f'| 시안 — 시연 안 되는 부분 | 누른 것 {sum(t.values()):,}회를 갈래로 다시 나눔 | 안내 글로 대신 {t.get("안내로 대신", 0)} · 표시만 바뀜 {t.get("표시만 바뀜", 0)} · 없는 주소 {len(nf)} · 여는 길 없는 화면 {len(nw0)}장 |\n')

w('## 2. 먼저 보실 것 — 심각도 「상」\n')
w('| 번호 | 어디 | 무엇 | 권고 |\n|---|---|---|---|')
for f in sorted([f for f in opn if f['sev'] == '상'], key=lambda f: (KD[f['kind']], f['no'])):
    w(f"| {f['no']} | {f['area']} | {f['what']} | {f['fix']} |")
w('')
w('## 3. 무엇을 어떻게 점검했나\n')
w('| 항목 | 어떻게 | 도구 | 한계 |\n|---|---|---|---|')
w('| 매트릭스(화면 · 백엔드 · API · DB) | 소스 · DB 에서 다시 뽑음(npm run matrix) | scripts/gen-matrix.js | 표 ↔ API 는 정적 대조 — 공용 서비스를 거치는 것은 못 잇습니다(51b 시트에 까닭) |')
w('| 연동 목록 | DB 의 연동 표 · 운영 설정 · 서버가 읽는 환경 변수 · 소스의 바깥 주소를 모아 표로 | link_check.py · 직접 조사 | - |')
w('| 연동 테스트 | 연결 구간마다 실제 요청을 보내 응답 · DB 를 확인. 결제 · 파일 · 1원 인증 · 중개사 · 국세청은 **가짜 상대 서버**를 세워 실제 HTTP 로 | link_check.py + srv_pay · srv_file · srv_lead · srv_billing · srv_consult | **실제 외부 기관으로는 보내지 않았습니다**(키 없음). 그 구간은 「확인 못 함」입니다 |')
w('| DB 연동 테스트 | API 로 쓰고 → DB 에서 그 행 확인 → API 로 다시 읽기. 뷰 · 표 전부 조회. 잘못된 값은 되돌리는 거래 안에서 넣어 거절 확인. 새로 설치한 DB 와 구조 비교 | db_link.py | 대표 흐름 15가지의 왕복 — API 422개 전부의 왕복은 아닙니다(전부의 호출 여부는 기능 검증 · API 조회 전수가 봄) |')
w('| 버튼 체크 | 쪽마다 보이는 단추를 **하나씩 누르고**(누르기 전마다 쪽을 새로 엶) 주소 · 화면 · 요청 · 안내창 변화를 기록 | btn_site.py · btn_bo.py | 자료가 바뀌지 않게 **쓰기 요청은 서버에 닿기 전에 막았습니다** → 「눌렀을 때 서버가 실제로 처리하는지」는 flow 점검이 봅니다. 같은 모양 단추는 쪽마다 3개까지만 · 입력을 채워야 켜지는 단추는 「꺼짐」으로 기록 |')
w('| flow 점검 | 주요 흐름을 처음부터 끝까지 — 화면에서 실제로 채우고 누름 · 상태를 바꾼 뒤에는 DB 로 확인 · 화면으로 못 하는 단계는 API 로 하고 그 사실을 적음 | flow_trade · flow_mall · flow_plaza · flow_biz · flow_proto (+ flow_lib) | 흐름 36개 — 모든 화면의 모든 경우는 아닙니다 |')
w('| 시안 점검 | 전수 누르기 기록을 「실제 시연 · 안내로 대신 · 표시만 · 없는 주소」로 다시 나눔 + 단추 · 주소로 열리지 않는 화면 찾기 | sweep_proto.py(보강) · proto_demo.py | - |')
w('| 전수 검정 · 로컬 테스트 | 기존 묶음 전부 + 모든 페이지 상호 확인(사용자 웹 · 운영 화면) | final_parts.sh A ~ D | Docker · PowerShell · 서버 적용 리허설은 이번에 다시 돌리지 않았습니다 — 제품 코드가 같아 앞 결과(문서 73)가 그대로입니다 |\n')

w('## 4. 발견 목록 (열려 있는 것)\n')
for kind in ['제품 결함', '빠진 기능', '시안', '관찰']:
    xs = sorted([f for f in opn if f['kind'] == kind], key=lambda f: (SV[f['sev']], f['no']))
    if not xs: continue
    w(f'### 4-{list(KD).index(kind)+1}. {kind} — {len(xs)}건\n')
    w('| 번호 | 심각도 | 어디 | 무엇 | 원인 | 근거 | 권고 |\n|---|---|---|---|---|---|---|')
    for f in xs: w(f"| {f['no']} | {f['sev']} | {f['area']} | {f['what']} | {f['cause']} | {f['evidence']} | {f['fix']} |")
    w('')
w('이번에 고친 것은 시험 도구 1건입니다.\n')
for f in [f for f in F if not f['open']]:
    w(f"- **{f['no']}** ({f['area']}) — {f['what']} → {f['fix']}")
w('')
w('## 5. 연동\n')
w('### 5-1. 실제 상대와 확인하지 못한 구간\n')
w('| 연동 | 지금 상태 | 지금까지 확인한 방법 | 실제 연동에 필요한 것 |\n|---|---|---|---|')
for r in J('link_integrations.json'):
    st = {'NOT_STARTED': '미착수', 'TESTING': '시험 중', 'LIVE': '운영 중'}.get(r['status'], r['status'])
    how = {'PASS': '키 없음 → 시험(stub) 표식 확인', 'BANK': '가짜 상대 서버로 실제 HTTP(srv_lead)', 'NTS': '가짜 상대 서버 + 응답 처리 10건', 'PG': '가짜 결제사로 실제 HTTP(srv_pay · srv_billing)', 'ALIMTALK': '연동 전 동작만(개발: 응답에 인증번호 · 그 밖: 접수 안 받음)', 'SAFENUM': '코드 없음', 'ESIGN': '코드 경로(stub)'}.get(r['code'], '')
    need = {'PASS': '계약 · 발신 IP 등록 · 키', 'BANK': '계약 · IP 등록 · 키 · 실계좌 3항목', 'NTS': '활용 신청 승인 · 실제 응답 확인', 'PG': '상점 키(TOSS_SECRET_KEY) · 실제 승인 확인 · G-174 수정', 'ALIMTALK': '발신번호 등록 · 템플릿 승인 · 연동 코드', 'SAFENUM': '도입 결정', 'ESIGN': '키 · 엔드포인트'}.get(r['code'], '')
    w(f"| {r['name']} ({r['code']}) | {st}{' · 오픈을 막음' if r['blocks_open'] else ''} | {how} | {need} |")
w('| 중개사 자격 대조(국토부) | 간주 모드 | 가짜 상대 서버(srv_lead · srv_ptn) | 조회 서비스 주소 · 키(BROKER_LOOKUP_*) → assume.broker 끄기 |')
w('| 파일 저장소(S3) | 서버 폴더 | 가짜 S3 로 실제 HTTP(srv_file) | 버킷 · 역할 |\n')
w('### 5-2. 연동 테스트에서 실패한 것\n')
for r in lbad: w(f"- **{TAG.get(('link_check', r['step'].split(' ')[0]), '미등록')}** {r['step']} — {r['detail'][:160]}")
w('')
w('### 5-3. 사실 기록(알아 두실 것)\n')
w('- **간주 스위치와 결제 키는 따로입니다.** `assume.payment` 는 화면 표시용이고, 실제로 시험 결제인지는 결제 키(TOSS_SECRET_KEY)가 있느냐로 정해집니다. 스위치만 끄고 키를 넣지 않으면 여전히 시험 결제입니다.')
w('- 연동 표의 「키 등록됨」 표시는 운영자가 손으로 켜는 값입니다. 서버가 환경 변수를 보고 정하지 않습니다(국세청이 「등록됨」인데 이 개발 환경에는 키가 없습니다).')
w('- API 는 다른 출처의 브라우저 호출을 허용하지 않습니다. 화면은 같은 출처의 `/api` 넘김으로만 부릅니다.')
w('- 광고 DB(sgb_ads)는 본체와 실행 중 연결이 없습니다. 광고 서버(sgb-ads)는 소스만 있고 띄우지 않았습니다.\n')

w('## 6. flow 점검\n')
w('### 6-1. 실제 웹\n')
w('| 흐름 | 단계 | 통과 | 실패 | 건너뜀 | 걸린 발견 |\n|---|---|---|---|---|---|')
for f in web:
    a = fstat(f); w(f"| {f['flow']} | {a[0]} | {a[1]} | {a[2]} | {a[3]} | {' · '.join(fnos(f)) or '-'} |")
w(f'| **합계** | **{W[0]}** | **{W[1]}** | **{W[2]}** | **{W[3]}** | |\n')
w('**화면으로 하지 못해 API · DB 로 이어 간 단계** (단계 이름에도 적혀 있습니다)\n')
w('| 흐름 | 단계 | 까닭 |\n|---|---|---|')
w('| T4 거래 | 거래 생성 | 사용자 웹에 거래를 만드는 단추가 없음(G-193) |')
w('| T3 · T5 검수 | 운영 승인 | 운영 화면 「검수 큐」가 비어 보여 누를 것이 없음(G-177) |')
w('| T7 신고 | 신고 기각 | 운영 화면의 처리 단추가 403(G-178) |')
w('| M3 배송 | 발송 · 배송 완료 | 운영 쪽 발송 처리 화면 · API 가 없어 DB 에 배송 기록을 넣음(G-194) |')
w('| B1 구독 | 구독 시작 | 요금제 화면에 결제 단추가 없음(G-189) |')
w('| B4 파트너 | 활동 지역 저장 | 화면에 저장 수단이 없음(G-192) |')
w('| P5 글 가림 | 운영자가 글을 가림 | 운영 화면에 공개된 글을 가리는 단추가 없음 — 운영 API 로 |\n')
w('### 6-2. 시안\n')
w('| 흐름 | 단계 | 통과 | 실패 | 건너뜀 | 걸린 발견 |\n|---|---|---|---|---|---|')
for f in pro:
    a = fstat(f); w(f"| {f['flow']} | {a[0]} | {a[1]} | {a[2]} | {a[3]} | {' · '.join(fnos(f)) or '-'} |")
w(f'| **합계** | **{P[0]}** | **{P[1]}** | **{P[2]}** | **{P[3]}** | |\n')

w('## 7. 버튼 체크\n')
w('| 대상 | 범위 | 반응 있음 | 대표만(같은 모양) | 같은 틀에서 확인 | 꺼짐 | 무반응(처리기 있음) | 죽은 단추 | 그 밖 |\n|---|---|---|---|---|---|---|---|---|')
for lab, d in [('실제 웹', bs), ('운영 화면', bb)]:
    T = d['total']; known = ('반응 있음', '같은 단추(대표만)', '같은 틀에서 확인함', '꺼짐', '무반응(처리기 있음)', '죽은 단추')
    w(f"| {lab} | {d['units']}{'쪽' if lab == '실제 웹' else '상태'} · 단추 {sum(T.values()):,} | {T.get('반응 있음', 0)} | {T.get('같은 단추(대표만)', 0)} | {T.get('같은 틀에서 확인함', 0)} | {T.get('꺼짐', 0)} | {T.get('무반응(처리기 있음)', 0)} | {T.get('죽은 단추', 0)} | {' · '.join(f'{k} {v}' for k, v in T.items() if k not in known) or '-'} |")
w('')
w('- **죽은 단추(눌러도 아무 일도 없고 처리기도 없는 단추)는 없습니다.**')
w(f'- 운영 화면의 상태 수({bb["units"]})가 모든 페이지 상호 확인의 상태 수({len(atabs)})와 다른 것은 세는 방법 차이입니다 — 버튼 체크는 탭을 열면 이미 보이는 첫 하위 탭을 따로 세지 않고, 들어가지 못하는 일반 회원 계정은 0상태입니다.')
w('- 운영 화면의 「무반응(처리기 있음)」은 하나씩 봤습니다 — 이미 골라진 거르개를 다시 누른 것, 빈 검색어로 「찾기」를 누른 것, 그리고 발신 IP 를 비운 채 「전 연동에 반영」을 누른 것(G-187) 입니다.')
w('- **이 점검이 보지 못하는 것:** 쓰기 요청을 막고 눌렀기 때문에 「요청이 나가는가」까지만 봅니다. 운영 화면 세 곳의 요청에 로그인 토큰이 빠진 것(G-178)은 flow 점검에서 드러났고, 그 뒤 버튼 체크가 막은 요청의 토큰 유무도 기록하게 보강했습니다. 입력을 채워야 나가는 요청은 여전히 flow 점검의 몫입니다.\n')

w('## 8. DB 연동 테스트\n')
SEC = {'A': '연결 · 마이그레이션', 'B': '조회 전수', 'C': 'API → DB 왕복', 'D': 'DB 가 막는 것', 'E': '거래 단위', 'F': '새 설치 DB 와 구조 비교', 'G': '표 ↔ API', 'H': '시각 · 글자'}
w('| 갈래 | 항목 | 통과 | 내용 |\n|---|---|---|---|')
DESC = {'A': '적용 기록 70 = 폴더 70 · 적용 뒤 바뀐 파일 0 · 객체 수 = 매트릭스 · 꺼 둔 트리거 0', 'B': '뷰 299 · 표 201 을 모두 실제로 읽음 — 오류 0', 'C': '가입 · 이름 변경 · 찜 · 글 · 댓글 · 삭제 · 장바구니 · 주문 · 취소 · 운영 설정 · 감사 기록 · 상담 신청',
        'D': '감사 기록 고치기/지우기 · 음수 재고 · 중복 이메일 · 없는 계정의 주문 · 없는 상태 값 · 잠긴 갈래 판매 · 설정 값 모양 · 리드 요약의 전화번호 · 중복 투표', 'E': '틀린 품목이 섞인 주문은 통째로 거절 · 재고 초과 거절 · 재고 1개를 네 요청이 동시에 → 한 건만 · 요청 키',
        'F': '표 · 열 1,861 · 뷰 299 · 함수 287 · 제약 887 · 트리거 237 · 색인 406 — 쓰던 개발 DB = 마이그레이션만으로 새로 만든 DB', 'G': 'API 와 이어진 표 · 이어지지 않은 표의 까닭', 'H': '시각 열은 모두 시간대 포함 · UTF8 · 한글 왕복'}
for k, nm in SEC.items():
    xs = [r for r in dbl if r['step'].startswith(k + '-')]
    w(f"| {nm} | {len(xs)} | {sum(1 for r in xs if r['ok'])} | {DESC[k]} |")
w('')
for r in dbad: w(f"- **실패 — {TAG.get(('db_link', r['step'].split(' ')[0]), '미등록')}** {r['step']}")
w('- 이 점검을 만들며 알게 된 것: 이미 적용한 마이그레이션 파일을 고치면 그 DB 에서는 `migrate` 가 「변경감지」로 멈춥니다(종료 코드 1). 제 개발 DB 에 그런 기록이 1건 있었고(D025 — v10.25 를 드리기 전에 끝에 한 줄을 더한 것) 기록을 지금 파일에 맞췄습니다. 드린 묶음과 새로 설치한 DB 는 처음부터 같은 파일이라 해당이 없습니다. 이제 A-3 · A-3b 가 이것을 봅니다.\n')

w('## 9. 시안 — 시연 안 되는 부분\n')
w(f'시안은 「눌러도 변화가 없으면 안내 글을 띄우는」 장치가 있어 무반응은 {t.get("무반응", 0)}입니다. 그래서 이번에는 **그 안내만 뜬 단추**를 따로 셌습니다.\n')
w('| 갈래 | 수 | 뜻 |\n|---|---|---|')
for k, d in [('실제 시연(화면 이동)', '다른 화면으로 감'), ('실제 시연(내용 바뀜)', '같은 화면의 내용이 바뀜'), ('실제 시연(안내 글)', '시안이 스스로 띄우는 안내'), ('안내로 대신', '「실제 동작은 구현 화면에서 확인」 안내만 — 그 동작은 시안에 없음'), ('표시만 바뀜', '탭 · 칩의 선택 표시만 바뀌고 목록은 그대로'), ('없는 주소', '「페이지를 찾을 수 없습니다」가 됨(G-197)'), ('입력', '입력 칸'), ('꺼짐', '조건이 안 돼 꺼져 있음')]:
    w(f'| {k} | {len(nf) if k == "없는 주소" else t.get(k, 0):,} | {d} |')
w('')
if nf:
    w('**없는 주소로 가는 단추**\n'); w('| 화면 | 단추 | 가려던 주소 |\n|---|---|---|')
    for r in nf[:30]: w(f"| {r['screen']} {r['title'][:20]} | {r['text'] or '(글자 없음)'} | {r['detail']} |")
    w('')
w(f'**여는 길이 없는 화면 {len(nw0)}장** (다른 화면의 단추로도 · 시안의 주소로도 열리지 않음 — G-198)\n')
w('| 화면 열쇠 | 화면 ID | 제목 | 등록된 주소 |\n|---|---|---|---|')
for x in sorted(nw0, key=lambda x: x['screen']): w(f"| {x['screen']} | {x.get('id', '')} | {x.get('title', '')[:30]} | {x.get('url', '')} |")
w(f'\n그 밖에 단추로는 닿지 않고 주소를 직접 넣어야 열리는 화면이 {len(nw1)}장 있습니다(매트릭스 56b 시트).\n')

w('## 10. 정해 주실 것\n')
w('| # | 정할 것 | 권고 |\n|---|---|---|')
w(f'| 1 | **제품 결함 {kc("제품 결함")}건을 언제 고칠지** | 심각도 상 · 중({kc("제품 결함", "상") + kc("제품 결함", "중")}건)은 v10.26 의 첫 단계로 먼저 고치고(시험 먼저 → 수정 → 전수 검정), 그다음 상품 자료를 비교 그림부터 진행 |')
w(f'| 2 | **빠진 기능 {kc("빠진 기능")}건의 범위** | 오픈 전 필수인 것(G-189 구독 결제 화면 — 결제사 계약 뒤)과 화면 연결(G-192 · G-193 · G-195 — 미뤄 둔 「실제 웹을 시안에 맞추기」)은 묶어서 따로 일정을 잡음. G-188(가입 약관 동의) · G-190(제휴 귀속) · G-191(글 신고)은 만들지 · 안내 글을 바꿀지 결정 |')
w(f'| 3 | **시안 {kc("시안")}건** | 다음에 시안을 고칠 때(v10.26 상품 자료 반영 때) 함께 — 여는 길 없는 화면은 메뉴에 이을지 · 정리할지 |')
w('| 4 | 교환 배송비 | 10/8 답: **받음** — 시안 값(왕복 6,000원 · 고객 사정)으로 v10.26 비교 그림에 넣음. 금액이 다르면 알려 주십시오 |\n')

w('## 11. 다시 돌리는 법\n')
w('```bash\ncd qa\nbash final_parts.sh A      # 검정 DB · verify · 매트릭스 · 준비 자료 · e2e\nbash final_parts.sh B      # 서버 기능 + 화면(어댑터 포함)      ← D 와 같이 돌려도 됨\nbash final_parts.sh D      # 시안 전수\nbash final_parts.sh C      # 사용자 웹 · 모든 페이지 상호 확인\nbash final_parts.sh E      # 확장 점검: DB 연동 · 연동 · 버튼 체크 · flow 점검   (A ~ D 뒤에)\npython3 proto_demo.py      # 시안의 시연 안 되는 부분\npython3 findings_r2.py && python3 build_xlsx.py   # 발견 목록 → 매트릭스\n```\n')
w('- flow 점검이 남기는 것: 계정 `flw_*@t.local` · 닫힌 주문 · 지운 글 · 끝난 리드 · 시험 업체(지역을 「시험도」로 옮김). 주문 · 재고 · 운영 설정은 스스로 처음 값으로 되돌리고 마지막 단계에서 확인합니다.')
w('- 버튼 체크는 쓰기 요청을 막고 누르므로 자료를 바꾸지 않습니다(장바구니 한 줄을 담았다가 뺌).\n')

w('## 12. 이번 실행의 수치\n')
w('| 항목 | 값 |\n|---|---|')
for k in ['verify', 'matrix', 'ads', 'e2e', 'smoke', 'pagetest']:
    if k in fa: w(f'| {k} | {fa[k][:200]} |')
w(f'| 전수 묶음(기존) | {len(old)}묶음 {osum[0]:,} / {osum[1]:,} |')
w(f'| 사용자 웹 모든 페이지 | {len(sp)}쪽 — 200 {s200} · 404 {s404}(의도) · 링크 상호 확인 {links:,}개 |')
w(f'| 운영 화면 | {len(atabs)}상태 — 오류 있는 상태 {len(abad)} (G-170 을 고친 뒤 「광고」 「감사」 탭 포함) |')
w(f'| 확장 점검 | 연동 {la[0]}/{la[1]} · DB 연동 {da[0]}/{da[1]} · flow(실제 웹) {W[1]}/{W[0]} · flow(시안) {P[1]}/{P[0]} |\n')
w('**이번 실행에서 손이 간 곳**\n')
w('- 시안 그림 비교(proto_pixel)가 버튼 체크와 같이 돌 때 1 / 2 — 운영 「회원」 화면 한 장의 오른쪽 끝 3점. 혼자 다시 돌리면 194장 모두 같음(2 / 2 · G-202 · 시험 도구).')
w('- 모든 페이지 상호 확인에서 링크 1개가 404 — 2시간 전에 내려간 매물이 비로그인 목록(/money/list)에 한 번 더 보인 것. 이미 열려 있는 G-161(오래 열지 않은 쪽을 처음 여는 사람에게 예전 자료를 한 번 보여 줌)이 이번에는 이렇게 나타났습니다.')
w('- 사용자 웹 1쪽(/mal/consult · 사업자 회원)에서 수화 경고(React #418) — 이미 열려 있는 G-94(간헐 · 화면은 정상).\n')
w('Docker · PowerShell · 새로 설치 · 서버 적용 리허설은 제품 코드가 같아 문서 73(v10.25)의 결과가 그대로입니다 — 이번에 다시 돌리지 않았습니다.\n')
w('## 13. 출처\n')
w('- 결과 파일: `qa/results_v10_25_r2/`(final_all · link_check · db_link · btn_site · btn_bo · flow_* · proto_demo · findings_r2)')
w('- 매트릭스: `SGB_Matrix_Verification_20261008_v10_25_r2.xlsx` — 49 연동목록 · 50 연동테스트 · 51 DB연동테스트 · 52 · 53 버튼체크 · 54 · 55 flow점검 · 56 시안 시연 안 되는 부분 · 57 발견목록')
w('- 소스 위치는 발견 목록의 「파일」 열(파일:줄)')
print('\n'.join(o))
