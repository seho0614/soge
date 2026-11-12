"""v10.253 ~ v10.256 (docs/388) — 모든 회원 추천 관계도 · 그림 ↔ 목록 · 정산 내역 한눈에 · 나의공간 메뉴 3단계

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb SITE=http://localhost:15174 ADMIN_WEB=http://localhost:15173 python3 test_v1253.py

  ① (코드) GET /me/recommend/tree(모든 회원 · 파트너 화면과 같은 모양) · 정산 내역 서비스 · API 2(나 · 운영 · 감사) · 명세 화면 2 ·
     나의공간 메뉴 3단계(대분류 5 · 메뉴 14 · 세부 · 옛 메뉴 이름 그대로 · 한국어 글자 없음) · 사전 ko/en · RcmTree(한국어 글자 없음 · 화면 읽기 목록) ·
     운영 화면 그림(RcmGraph) · 회원 상세 관계도 · 정산 내역 · 계층 용어 없음 · 문서 388 · 판 v10.256 이상
  ② (API) 제휴 파트너가 아닌 회원(buyer)도 관계도 — 새로 가입한 두 사람(직접 · 그다음) → 모두 +2 · 1 · 2번째 · 가린 이름 · 날짜만(번호 · 이메일 · 코드 없음) · 파트너 화면은 그대로 403
  ③ (API · DB) 정산 내역 — 내 것(포인트 합계 = DB) · 운영자가 그 회원 것(ADMIN 봄 · 감사 기록 ACCOUNT_SETTLEMENT_VIEW · 없는 회원 404 · 회원이 운영 API 403)
  ④ (화면) 나의공간 — 대분류 5 · 「추천 관계도」 메뉴 · 관계도 그림(상자 수) ↔ 목록 · 「정산 내역」 → 세부 4 · 한눈에 화면
  ⑤ (화면) 운영 화면 회원 상세 — 「추천 관계도」(그림) · 「정산 내역」
  두 번 돌아도 통과 — 가입 회원은 매번 새 이메일 · 「시작 뒤」만 셈.
"""
import json, os, re, subprocess, time, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
SITE = os.environ.get('SITE')
ADMIN_WEB = os.environ.get('ADMIN_WEB')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []
PW = 'sgb-dev-1234'
RPW = 'sgb-test-1234'
TPW = 'Sgb-test-1253!'
WORDS = ('하위', '산하', '직급', '다운라인', '상위', '조직')


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


def strip_comments(t):
    t = re.sub(r'\{/\*[\s\S]*?\*/\}', '', t)
    t = re.sub(r'/\*[\s\S]*?\*/', '', t)
    return re.sub(r'(^|[^:\'"`])//[^\n]*', r'\1', t)


VER = rd('VERSION').strip()
# ── ① 코드 ──────────────────────────────────────────────────────────────
RS, RC = rd('src/modules/affiliate/recommend.service.ts'), rd('src/modules/affiliate/recommend.controller.ts')
SS, SCt, AM = rd('src/modules/settlement/settlement-summary.service.ts'), rd('src/modules/settlement/settlement-summary.controller.ts'), rd('src/app.module.ts')
MS, RT, LB = rd('site/src/components/my/MyShell.tsx'), rd('site/src/components/recommend/RcmTree.tsx'), rd('site/src/components/recommend/labels.ts')
MR, SA, PR = rd('site/src/app/my/recommend/page.tsx'), rd('site/src/app/my/settlement/all/page.tsx'), rd('site/src/app/partners/recommend/page.tsx')
RG, SM, MB, AR = rd('web/src/app/admin/affiliates/RcmGraph.tsx'), rd('web/src/app/admin/SettlementSummary.tsx'), rd('web/src/app/admin/Members.tsx'), rd('web/src/app/admin/affiliates/Recommend.tsx')
KO, EN = json.loads(rd('site/src/i18n/messages/ko/my.json') or '{}'), json.loads(rd('site/src/i18n/messages/en/my.json') or '{}')
KA, EA = json.loads(rd('site/src/i18n/messages/ko/affiliate.json') or '{}'), json.loads(rd('site/src/i18n/messages/en/affiliate.json') or '{}')
SJ = json.loads(rd('spec/screens.json') or '{"screens":[]}')
sid = {s['id']: s for s in SJ.get('screens', [])}
ok('① 관계도 — GET /me/recommend/tree(모든 회원 · memberTree) · 파트너 화면은 자격 확인 뒤 같은 것 · 가린 이름 · 날짜만',
   "@Get('me/recommend/tree')" in RC and 'memberTree() { return this.svc.memberTree(); }' in RC and 'async memberTree()' in RS
   and "throw new Forbidden('AFF_REQUIRED'" in RS and 'return this.memberTree();' in RS and 'name: r.withdrawn ? null : maskName(r.name)' in RS, '')
ok('① 정산 내역 — 소개비 · 포인트 · 출금 · 제휴 · 판매자 · 다른 회원 금액 없음 · 나 · 운영(ADMIN · SUPER · 감사 ACCOUNT_SETTLEMENT_VIEW) · 공급자',
   'FROM settlements WHERE payee_account_id = $1' in SS and 'FROM point_ledger' in SS and 'FROM point_cashouts' in SS and 'FROM partner_settlements' in SS
   and 'FROM hlt_settlements' in SS and "@Get('me/settlement-summary')" in SCt and "@Get('admin/accounts/:id/settlement-summary')" in SCt
   and "@Audit('ACCOUNT_SETTLEMENT_VIEW', 'ACCOUNT')" in SCt and "@Roles('ADMIN', 'SUPER')" in SCt and 'SettlementSummaryService,' in AM and 'SettlementSummaryController,' in AM, '')
ok('① 명세 — SB-MYP-RCM-010(/my/recommend) · SB-MYP-STL-030(/my/settlement/all) · 회원 상세에 운영 정산 API',
   'GET /me/recommend/tree' in sid.get('SB-MYP-RCM-010', {}).get('apis', []) and sid.get('SB-MYP-RCM-010', {}).get('url') == '/my/recommend'
   and 'GET /me/settlement-summary' in sid.get('SB-MYP-STL-030', {}).get('apis', []) and 'GET /admin/accounts/{id}/settlement-summary' in sid.get('SB-ADM-MBR-020', {}).get('apis', []), '')
groups = re.findall(r"\{ key: '(\w+)', label: '(\w+)', items: \[", MS)
menu_keys = re.findall(r"\{ key: '(\w+)',\s+label: '\w+', href:", MS)
ko_left = [ln.strip() for ln in strip_comments(MS).splitlines() if re.search('[가-힣]', ln)]
ok('① 나의공간 메뉴 3단계 — 대분류 5 · 메뉴 14 · 세부(data-my-nav-subitem) · 옛 메뉴 이름(mylst · mydeal · myacc · myprv …) 그대로 · 한국어 글자 없음',
   [g for g, _ in groups] == ['deal', 'money', 'mall', 'rec', 'me'] and len(menu_keys) == 14
   and set(menu_keys) == {'mylst', 'mydeal', 'myctr', 'ask', 'mylik', 'mystl', 'mysub', 'mypaym', 'myhlt', 'myrcm', 'myacc', 'myntf', 'myprv', 'myrec'}
   and 'data-my-nav-group=' in MS and 'data-my-nav-subitem=' in MS and "'/my/recommend'" in MS and "'/my/settlement/all'" in MS and "'/my/fulfillments'" in MS
   and "'/my/health/orders'" in MS and '/my/account/security' in MS and not ko_left, f'{groups} · {len(menu_keys)} · {ko_left[:2]}')
ks = lambda d, *p: (lambda x: x)(__import__('functools').reduce(lambda a, k: (a or {}).get(k), p, d))
same_keys = all(set((ks(KO, *p) or {}).keys()) == set((ks(EN, *p) or {}).keys()) and ks(KO, *p) for p in (('shell', 'groups'), ('shell', 'sub'), ('shell', 'menu'), ('settleAll',), ('settleAll', 'st')))
ok('① 사전 — 대분류 · 세부 · 메뉴 · 정산 내역 · 관계도 그림 글자 ko/en 같은 키 · 메뉴 이름 정리(정산 내역 · 구독 · 요금제 · 알림 · 설정)',
   same_keys and KO['shell']['menu'].get('settlement') == '정산 내역' and KO['shell']['menu'].get('subscription') == '구독 · 요금제'
   and KO['shell']['menu'].get('notifications') == '알림 · 설정' and KO['shell']['menu'].get('recommend') == '추천 관계도'
   and all(k in KA.get('recommend', {}) and k in EA.get('recommend', {}) for k in ('graph', 'list', 'expandAll', 'collapseAll', 'search', 'fit', 'found', 'myLead'))
   and KO.get('home', {}).get('recommend', {}).get('view') and EN.get('home', {}).get('recommend', {}).get('view'), '')
rt_ko = [ln.strip() for ln in strip_comments(RT + LB + SA + MR).splitlines() if re.search('[가-힣]', ln)]
ok('① 그림 부품 RcmTree — 위 → 아래 상자 · 선 · 확대 · 끌기 · 찾기 · 모두 펴기 · 300명 / 휴대폰은 목록 · 화면 읽기 목록 · 새 묶음 없음 · 한국어 글자 없음(새 화면 3개 포함)',
   'export function RcmTree' in RT and '<svg' in RT and 'nodes.length > 300 || window.innerWidth < 640' in RT and 'data-rcm-sr=' in RT and 'setPointerCapture' in RT
   and 'n.gen <= 2' in RT and '<RcmTree' in MR and '<RcmTree' in PR and 'rcmLabels(' in LB and not rt_ko, str(rt_ko[:2]))
ok('① 운영 화면 — 관계도 그림(RcmGraph) · 고른 회원 · 정산 내역(SettlementSummary) · 회원 상세 「추천 관계도 · 정산 내역」',
   'export function RcmGraph' in RG and '<RcmGraph' in AR and 'data-rcm-picked=' in AR and 'export function SettlementSummary' in SM
   and '/admin/accounts/${id}/settlement-summary' in SM and 'function MemberMore' in MB and '<RecommendDetail' in MB and '<SettlementSummary' in MB, '')
all_text = strip_comments(MR + PR + RT + SA) + json.dumps(KA.get('recommend', {}), ensure_ascii=False) + json.dumps(KO.get('shell', {}), ensure_ascii=False)
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('388_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 계층 용어 없음(하위 · 산하 · 직급 · 다운라인 · 상위 · 조직) · 문서 388 · 판 v10.256 이상',
   not any(w in all_text for w in WORDS) and bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 256), f'{DOC} · {VER}')


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        raw = urllib.request.urlopen(r, timeout=120).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b'{}')
        except Exception:
            body = {}
        return {'_err': e.code, 'code': body.get('code')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return r.stdout.strip() if not r.returncode else ('!' + r.stderr.strip()[:200])


if API and DB:
    import sys
    sys.path.insert(0, HERE)
    import consent_ok
    consent_ok.agree('buyer@x.com', PW)
    consent_ok.agree('admin@x.com', PW)
    TB = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW}).get('accessToken')
    TS = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    TA = call('POST', '/auth/login', {'email': 'ops@t.local', 'password': RPW}).get('accessToken')
    t0 = psql("SELECT now()")
    stamp = str(int(time.time()))[-7:]
    bid = psql("SELECT id FROM accounts WHERE email = 'buyer@x.com'")
    bcode = psql("SELECT recommend_code FROM accounts WHERE email = 'buyer@x.com'")

    # ── ② 모든 회원 관계도 ──
    t1 = call('GET', '/me/recommend/tree', None, TB)
    n1 = t1.get('total') or 0
    A = call('POST', '/auth/signup', {'email': f'rcm53-a-{stamp}@t.local', 'password': TPW, 'name': '관계가나', 'recommendCode': bcode})
    acode = psql(f"SELECT recommend_code FROM accounts WHERE email = 'rcm53-a-{stamp}@t.local'")
    B = call('POST', '/auth/signup', {'email': f'rcm53-b-{stamp}@t.local', 'password': TPW, 'name': '관계다라', 'recommendCode': acode})
    t2 = call('GET', '/me/recommend/tree', None, TB)
    nodes = t2.get('nodes') or []
    a_ = next((n for n in nodes if n.get('name') == '관***' and n.get('gen') == 1 and re.match(r'^\d{4}-\d{2}-\d{2}$', n.get('joined') or '')), None)
    b_ = next((n for n in nodes if n.get('name') == '관***' and n.get('gen') == 2 and a_ and n.get('p') == a_.get('k')), None)
    keys = set().union(*[set(n.keys()) for n in nodes]) if nodes else set()
    ok('② 제휴 파트너가 아닌 회원(buyer)도 관계도 — 두 사람 가입 뒤 모두 +2 · 직접 추천(가입일) · 그분이 추천한 분(가입 월 · 그 아래) · 가린 이름',
       A.get('_err') is None and B.get('_err') is None and t2.get('_err') is None and (t2.get('total') or 0) == n1 + 2 and a_ is not None and b_ is not None
       and re.match(r'^\d{4}-\d{2}$', b_.get('joined') or '') is not None and (t2.get('root') or {}).get('code') == bcode,
       f"{n1} → {t2.get('total')} · {a_} · {b_}")
    ok('② 관계도 줄에는 번호 · 이메일 · 코드 · 금액 없음(k · p · gen · name · joined · children 만) · 파트너 화면은 그대로 403 AFF_REQUIRED',
       keys <= {'k', 'p', 'gen', 'name', 'joined', 'children'} and call('GET', '/partner/affiliate/recommend-tree', None, TB).get('code') == 'AFF_REQUIRED', str(sorted(keys)))

    # ── ③ 정산 내역 ──
    s = call('GET', '/me/settlement-summary', None, TB)
    pt = psql(f"SELECT coalesce(sum(points), 0) FROM point_ledger WHERE account_id = '{bid}'")
    paid = psql(f"SELECT coalesce(sum(amount), 0)::bigint FROM settlements WHERE payee_account_id = '{bid}' AND status = 'PAID'")
    ok('③ 내 정산 내역 — 소개비(받은 돈 = DB) · 포인트 합계 = DB · 출금 · 제휴 · 판매자(없으면 null) · 안내',
       s.get('_err') is None and {'intro', 'points', 'affiliate', 'seller', 'note'} <= set(s.keys()) and str((s.get('points') or {}).get('total')) == pt
       and int((s.get('intro') or {}).get('paid') or 0) == int(paid or 0) and 'cashout' in (s.get('points') or {}) and len((s.get('intro') or {}).get('items') or []) <= 20,
       f"pt {(s.get('points') or {}).get('total')}/{pt} · paid {(s.get('intro') or {}).get('paid')}/{paid}")
    sa = call('GET', f'/admin/accounts/{bid}/settlement-summary', None, TA)
    au = psql(f"SELECT count(*) FROM audit.audit_logs WHERE action = 'ACCOUNT_SETTLEMENT_VIEW' AND target_id::text = '{bid}' AND occurred_at >= '{t0}'")
    nf = call('GET', '/admin/accounts/00000000-0000-0000-0000-000000000000/settlement-summary', None, TS)
    mb = call('GET', f'/admin/accounts/{bid}/settlement-summary', None, TB)
    ok('③ 운영 — ADMIN 이 그 회원 정산 내역(내 것과 같은 숫자) · 감사 기록 ACCOUNT_SETTLEMENT_VIEW · 없는 회원 404 · 회원은 403',
       sa.get('_err') is None and (sa.get('points') or {}).get('total') == (s.get('points') or {}).get('total') and au not in ('', '0') and not au.startswith('!')
       and nf.get('_err') == 404 and mb.get('_err') == 403, f"{sa.get('_err')} · 감사 {au} · {nf.get('_err')} · {mb.get('_err')}")

    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    # ── ④ 나의공간 화면 ──
    if SITE and sync_playwright:
        seen, errs = {}, []
        try:
            with sync_playwright() as p:
                b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1400, 'height': 1000})
                pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                pg.goto(SITE + '/login'); pg.fill('input[name=email]', 'buyer@x.com'); pg.fill('input[name=password]', PW)
                pg.click('form.auth button'); pg.wait_for_timeout(2000)
                pg.goto(SITE + '/my/recommend', wait_until='networkidle', timeout=120000)
                seen['groups'] = pg.locator('[data-my-nav-group]').count()
                seen['menuOn'] = pg.locator('[data-my-nav-item="myrcm"].on').count()
                seen['mode'] = pg.locator('[data-rcm-tree]').get_attribute('data-rcm-tree') if pg.locator('[data-rcm-tree]').count() else None
                seen['boxes'] = pg.locator('[data-rcm-tree] g[data-rcm-node]').count()
                pg.click('[data-rcm-mode="list"]'); pg.wait_for_timeout(500)
                seen['list'] = pg.locator('[data-rcm-tree="list"] li').count()
                seen['text'] = pg.locator('[data-screen="SB-MYP-RCM-010"]').inner_text()[:3000]
                pg.goto(SITE + '/my/settlement/all', wait_until='networkidle', timeout=120000)
                seen['settle'] = pg.locator('[data-settle-all]').count()
                seen['subs'] = pg.locator('[data-my-nav-sub="mystl"] a').count()
                seen['tiles'] = pg.locator('[data-settle-tile]').count()
                b.close()
        except Exception as ex:
            errs.append(str(ex)[:160])
        ok('④ 나의공간 — 대분류 5 · 「추천 관계도」 켜짐 · 그림(나 + 2명 이상 상자) ↔ 목록 · 계층 용어 없음 · 「정산 내역」 세부 4 · 한눈에 타일 3 이상 · 화면 오류 없음',
           seen.get('groups') == 5 and seen.get('menuOn') == 1 and seen.get('mode') == 'graph' and seen.get('boxes', 0) >= 3 and seen.get('list', 0) >= 2
           and '관***' in seen.get('text', '') and not any(w in seen.get('text', '') for w in WORDS) and seen.get('settle') == 1 and seen.get('subs') == 4
           and seen.get('tiles', 0) >= 3 and not errs, f"{ {k: v for k, v in seen.items() if k != 'text'} } · {errs[:2]}")
    else:
        print('  (사용자 웹 · playwright 없음 — ④ 건너뜀)')
    # ── ⑤ 운영 화면 회원 상세 ──
    if ADMIN_WEB and sync_playwright:
        seen, errs = {}, []
        try:
            with sync_playwright() as p:
                b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 1000})
                pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                pg.goto(ADMIN_WEB + '/#/members', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(1500)
                pg.fill('input[aria-label="회원 검색"]', 'buyer@x.com'); pg.locator('form.search-row button[type=submit]').click(); pg.wait_for_timeout(2000)
                pg.locator('[data-member-list] tbody tr button.linkbtn').first.click(); pg.wait_for_timeout(2500)
                pg.click(f'[data-member-rcm="{bid}"]'); pg.wait_for_timeout(2000)
                seen['graph'] = pg.locator('[data-rcm-graph="graph"]').count()
                seen['nodes'] = pg.locator('[data-rcm-graph] g[data-rcm-node]').count()
                pg.click(f'[data-member-money="{bid}"]'); pg.wait_for_timeout(2000)
                seen['money'] = pg.locator(f'[data-settle-summary="{bid}"]').count()
                b.close()
        except Exception as ex:
            errs.append(str(ex)[:160])
        ok('⑤ 운영 화면 회원 상세 — 「추천 관계도」 그림(2명 이상) · 「정산 내역」 · 화면 오류 없음',
           seen.get('graph') == 1 and seen.get('nodes', 0) >= 2 and seen.get('money') == 1 and not errs, f'{seen} · {errs[:2]}')
    else:
        print('  (운영 화면 · playwright 없음 — ⑤ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
