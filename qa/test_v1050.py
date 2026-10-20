"""v10.50 시험 — 메인 히어로 소개장터 퀵메뉴 5칸 · docs/102

  KIT=… python3 -I test_v1050.py

  ① 화면 — 히어로 안 · 검색칩 다음 · 소개장터 관이 켜졌을 때만 · QM 목록 재사용 · 주소 5개가 실제 페이지
  ② CSS — 쓰는 클래스가 모두 정의됨 · 720px 접힘
  ③ 시안 — mxHero 에 같은 줄 · 시안 화면 키(win · bst · urg · saf · evt)가 라우트에 있음 · 원본(proto_main_src.js)도 같음
  ④ 기록 — screens.json 메모 · VERSION · docs/102
"""
import json, os, re

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
INFRA = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel, base=None):
    p = os.path.join(base or K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


# ① 화면
HV = rd('site/src/components/home/HomeView.tsx')
GW = rd('site/src/components/gwan/gw.ts')
hero = HV[HV.find('<section className="home-hero"'):HV.find('</section>', HV.find('<section className="home-hero"'))]
ok('히어로 section 안에 퀵메뉴 줄', 'className="home-qm"' in hero, '')
ok('검색칩 줄 다음에 놓임', 0 < hero.find('home-chips') < hero.find('home-qm'), '')
ok('소개장터 관이 켜졌을 때만', re.search(r"on\('MNY'\)\s*&&\s*\(\s*<nav className=\"home-qm\"", HV) is not None, '')
ok('QM 목록을 gw.ts 에서 가져옴(목록 하나)', "import { QM } from '@/components/gwan/gw';" in HV and 'QM.map(' in hero, '')
ok('gw.ts 는 다른 파일을 import 하지 않음(client 파일에서 써도 안전)', not re.search(r'^import ', GW, re.M) and "'use client'" not in GW, '')
qm = re.findall(r"\{ key: '(\w+)', em: '[^']+', label: '([^']+)', href: '([^']+)' \}", GW)
ok('퀵메뉴 5칸 · 사진 순서', [l for _, l, _ in qm] == ['성공현황', '베스트매칭', '급구 · 급매', '사고예방', '이벤트존'], str([l for _, l, _ in qm]))
miss = [h for _, _, h in qm if not os.path.exists(os.path.join(K, 'site/src/app' + h, 'page.tsx'))]
ok('5개 주소 모두 실제 페이지가 있음', len(qm) == 5 and not miss, str(miss))
ok('아이콘은 읽지 않게(aria-hidden) · 이름표 있음', 'className="home-qe" aria-hidden="true"' in hero and 'aria-label="소개장터 바로가기"' in hero, '')

# ② CSS
CSS = rd('site/src/styles/home.css')
for c in ('home-qm', 'home-qe'):
    ok(f'CSS .{c} 정의', re.search(r'\.' + c + r'\b[^{]*\{', CSS) is not None, '')
blk = ''.join(CSS[m.start():CSS.find('\n}', m.start())] for m in re.finditer(r'@media \(max-width: 720px\)', CSS))   # 720px 묶음이 여러 개
ok('720px 에서 3칸씩 접힘', '.home-qm a { flex: 1 1 33%' in blk and '.home-qm { display: flex; flex-wrap: wrap' in blk, '')
ok('키보드 초점 표시', '.home-qm a:focus-visible' in CSS, '')

# ③ 시안
PR = rd('spec/proto.html')
SRC = rd('qa/proto_main_src.js', INFRA)
i = PR.find('function mxHero(')
mh = PR[i:PR.find('function mxHead(', i)]
ok('시안 mxHero 에 퀵메뉴 줄 · 검색칩 다음', 0 < mh.find('home-chips') < mh.find('<nav class="home-qm"'), '')
keys = re.findall(r'\["[^"]+","[^"]+","(\w+)"\]', mh)
ok('시안 키 5개(win · bst · urg · saf · evt)', keys == ['win', 'bst', 'urg', 'saf', 'evt'], str(keys))
ok('시안 키가 모두 라우트에 있음', all(re.search(r'\b' + k + r':sc\w+', PR) for k in keys), '')
ok('옛 히어로(6249행 쪽)는 건드리지 않음', PR.count('<nav class="home-qm"') == 1, str(PR.count('<nav class="home-qm"')))
st = PR[PR.find('<style id="mhx-style">'):PR.find('</style>', PR.find('<style id="mhx-style">'))]
ok('시안 CSS(.home-qm)가 메인 스타일 안에', '.home-qm {' in st and '.home-qm a { flex: 1 1 33%' in st, '')
ok('시안 원본(proto_main_src.js)도 같음', '<nav class="home-qm"' in SRC and '"evt"]].map' in SRC, '')

# ④ 기록
SJ = json.loads(rd('spec/screens.json') or '{"screens":[]}')
notes = {s['id']: s.get('note', '') for s in SJ['screens']}
ok('screens.json 메인 010 · 011 메모', all('v10.50 (docs/102)' in notes.get(x, '') for x in ('SB-HOM-MAIN-010', 'SB-HOM-MAIN-011')), '')
ok('VERSION v10.50 이상', re.match(r'v10\.(5\d|[6-9]\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
doc = rd('docs/102_히어로_소개장터퀵메뉴_v10.50_20261020.md')
ok('작업 문서 docs/102', all(h in doc for h in ('## 1. 화면', '## 3. 집 PC 확인', '## 4. 운영 적용')), '')
ok('마이그레이션 그대로 141 이상', len([d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d))]) >= 141, '')

n_ok = sum(1 for r in RES if r[0])
print(f'통과 {n_ok} / {len(RES)}')
