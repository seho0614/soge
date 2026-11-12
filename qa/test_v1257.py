"""v10.257 · v10.258 (docs/390) — 나의공간 첫 화면 추천 관계도 · 직접 추천한 분별 「내가 받은 추천 보상」

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb SITE=http://localhost:15174 ADMIN_WEB=http://localhost:15173 python3 test_v1257.py

  ① (코드) 보상 계산(referral-reward.ts · 받음 · 기다림 · 없음 · 내가 받은 포인트만 · 1단계만) · 관계도(1번째 줄만 reward · 합계) · 운영 관계도 ·
     정산 내역 referral · 사용자 웹 RcmTree(작은 그림 · 보상 줄 · 한국어 글자 없음) · 첫 화면 카드 · 관계도 화면 합계 · 정산 내역 「추천 보상」 ·
     운영 화면(그림 상자 · 목록 · 회원 정산 내역) · 사전 ko/en · 계층 용어 없음 · 마이그레이션 없음(242) · 문서 390 · 판 v10.258 이상
  ② (API · DB) buyer 가 세 사람을 추천 — A(보상 켜고 본인인증 → 받음) · B(인증 전 → 기다림) · C(보상 끄고 인증 → 없음) · A 가 추천한 D(2번째 줄 → 보상 없음 칸)
     → 관계도 합계 받음 +1 · 기다림 +1 · 없음 +1 · 포인트 +점수 · 2번째 줄 이하 reward 없음 · 상자 칸에 금액(그분 돈) 없음
  ③ (API · DB) 정산 내역 referral = 관계도 합계 · 포인트 = DB(REFERRAL_DIRECT · invitee 메모) · 운영 관계도 · 운영 정산 내역 같은 숫자
  ④ (화면) 나의공간 첫 화면 작은 관계도(상자 · 보상 글) · 관계도 화면 합계 · 정산 내역 「추천 보상」 칸 · 표
  ⑤ (화면) 운영 회원 상세 — 관계도 보상 합계 · 상자 보상 줄 · 정산 내역 추천 보상
  두 번 돌아도 통과 — 가입 회원은 매번 새 이메일 · 숫자는 시작 전과의 차이로 · 보상 규칙은 끝나면 원래대로.
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
TPW = 'Sgb-test-1257!'
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
RR, RS, RC = rd('src/modules/affiliate/referral-reward.ts'), rd('src/modules/affiliate/recommend.service.ts'), rd('src/modules/affiliate/recommend.controller.ts')
SS = rd('src/modules/settlement/settlement-summary.service.ts')
RT, LB, HM = rd('site/src/components/recommend/RcmTree.tsx'), rd('site/src/components/recommend/labels.ts'), rd('site/src/app/my/page.tsx')
MR, SA, CSS = rd('site/src/app/my/recommend/page.tsx'), rd('site/src/app/my/settlement/all/page.tsx'), rd('site/src/styles/partners.css')
RG, AR, SM = rd('web/src/app/admin/affiliates/RcmGraph.tsx'), rd('web/src/app/admin/affiliates/Recommend.tsx'), rd('web/src/app/admin/SettlementSummary.tsx')
KO, EN = json.loads(rd('site/src/i18n/messages/ko/my.json') or '{}'), json.loads(rd('site/src/i18n/messages/en/my.json') or '{}')
KA, EA = json.loads(rd('site/src/i18n/messages/ko/affiliate.json') or '{}'), json.loads(rd('site/src/i18n/messages/en/affiliate.json') or '{}')

ok('① 보상 계산 — 직접 추천(introducer_referrals.inviter_id) · 내가 받은 REFERRAL_DIRECT(invitee 메모) · 받음(rewarded_at) · 기다림(인증 전) · 없음 · 합계',
   'export async function directRewards' in RR and "l.rule_code = 'REFERRAL_DIRECT'" in RR and "l.memo = 'invitee ' || r.invitee_id::text" in RR
   and 'WHERE r.inviter_id = $1' in RR and "state: r.at ? 'GOT' : r.verified ? 'NONE' : 'WAIT'" in RR and 'export function rewardSum' in RR, '')
ok('① 관계도 — 1번째 줄만 reward · 그 아래 null · 합계 reward(나 · 운영) · 명세 스키마',
   RS.count("reward: r.gen === 1 ? RecommendService.rewardOf(byId.get(r.id)) : null") == 2 and RS.count('reward: rewardSum(rw)') == 2
   and 'directRewards(this.db, this.me)' in RS and 'directRewards(this.db, id)' in RS and "reward: { type: 'object', properties: { points:" in RC, '')
ok('① 정산 내역 — referral(합계 · 사람별 · 가린 이름 · 가입일 · 상태 · 내가 받은 포인트 · 받은 날) · 다른 사람 금액 없음',
   'const rw = await directRewards(this.db, accountId);' in SS and 'referral: { ...rewardSum(rw), items: rw.map' in SS
   and 'name: x.withdrawn ? null : maskName(x.name)' in SS, '')
site_ko = [ln.strip() for ln in strip_comments(RT + LB + MR + SA + HM).splitlines() if re.search('[가-힣]', ln)]
ok('① 사용자 웹 — RcmTree 작은 그림(compact · 단추 없음 · 1번째 줄까지 펴 둠 · 화면에 맞춤) · 보상 줄(그림 · 목록 · 화면 읽기) · 한국어 글자 없음',
   'compact = false' in RT and '{!compact && <div className="rcm-bar">' in RT and 'n.gen <= (compact ? 1 : 2)' in RT and 'if (compact) fit();' in RT
   and RT.count('data-rcm-reward=') >= 3 and "rGot: t('rGot', { p: '{p}' })" in LB and '.rcm-box.sm .rcm-canvas' in CSS and not site_ko, str(site_ko[:2]))
ok('① 나의공간 첫 화면 「내 추천 관계도」 카드(추천한 분 있을 때만 · 작은 그림 · 전체 보기 · 받은 보상) · 관계도 화면 합계 · 정산 내역 「추천 보상」 칸 · 표',
   "'/me/recommend/tree'" in HM and '<RcmTree compact' in HM and 'tree && tree.total > 0' in HM and 'data-my-rcm-full=' in HM and 'data-my-rcm-reward=' in HM
   and 'data-rcm-reward-sum=' in MR and "t('rewardSum'" in MR and 'data-settle-tile="referral"' in SA and 'data-settle-row="referral"' in SA and 'id="referral"' in SA, '')
ok('① 운영 화면 — 그림 상자 셋째 줄 보상 · 목록 보상 · 합계 줄 · 회원 정산 내역 추천 보상 표',
   'data-rcm-reward={n.reward.state}' in RG and 'data-rcm-reward={x.reward.state}' in AR and 'data-rcm-reward-sum=' in AR
   and 'data-settle-referral=' in SM and 'data-settle-referral-tbl=' in SM, '')
pair = lambda a, b: set(a.keys()) == set(b.keys())
ok('① 사전 — ko/en 같은 키(관계도 보상 · 첫 화면 카드 · 정산 내역 추천 보상) · 영어 개수 문장은 복수형',
   all(k in KA.get('recommend', {}) and k in EA.get('recommend', {}) for k in ('rGot', 'rWait', 'rNone', 'rewardSum', 'rewardNote', 'rewardMore'))
   and pair(KO['home']['recommend'], EN['home']['recommend']) and all(k in KO['home']['recommend'] for k in ('card', 'full', 'sum', 'reward'))
   and pair(KO['settleAll'], EN['settleAll']) and pair(KO['settleAll']['rs'], EN['settleAll']['rs'])
   and 'plural' in EA['recommend']['rewardSum'] and 'plural' in EN['home']['recommend']['sum'] and 'plural' in EN['settleAll']['tReferralSub'], '')
mig = [d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isfile(os.path.join(K, 'prisma/migrations', d, 'migration.sql'))] if os.path.isdir(os.path.join(K, 'prisma/migrations')) else []
all_text = strip_comments(RT + MR + SA + HM) + json.dumps(KA.get('recommend', {}), ensure_ascii=False) + json.dumps(KO.get('settleAll', {}), ensure_ascii=False) + json.dumps(KO['home']['recommend'], ensure_ascii=False)
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('390_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 계층 용어 없음 · 마이그레이션 없음(242) · 여러 단계 보상 없음 · 문서 390 · 판 v10.258 이상',
   not any(w in all_text for w in WORDS) and len(mig) == 242 and bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 258),
   f'{len(mig)} · {DOC} · {VER}')


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


def rsum(t):
    r = (t or {}).get('reward') or {}
    return (r.get('points') or 0, r.get('got') or 0, r.get('wait') or 0, r.get('none') or 0)


if API and DB:
    import sys
    sys.path.insert(0, HERE)
    import consent_ok
    consent_ok.agree('buyer@x.com', PW)
    consent_ok.agree('admin@x.com', PW)
    TB = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW}).get('accessToken')
    TS = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    TA = call('POST', '/auth/login', {'email': 'ops@t.local', 'password': RPW}).get('accessToken')
    stamp = str(int(time.time()))[-7:]
    bid = psql("SELECT id FROM accounts WHERE email = 'buyer@x.com'")
    bcode = psql("SELECT recommend_code FROM accounts WHERE email = 'buyer@x.com'")
    rule0 = psql("SELECT is_active::text || '|' || points || '|' || coalesce(monthly_cap::text, '') FROM point_rules WHERE code = 'REFERRAL_DIRECT'")
    PTS = 1234

    # ── ② 세 사람 · 그 아래 한 사람 ──
    t1 = call('GET', '/me/recommend/tree', None, TB)
    s1 = rsum(t1)
    em = {x: f'rcm57-{x}-{stamp}@t.local' for x in 'abcd'}
    for x, nm in (('a', '보상가나'), ('b', '보상다라'), ('c', '보상마바')):
        call('POST', '/auth/signup', {'email': em[x], 'password': TPW, 'name': nm, 'recommendCode': bcode})
    acode = psql(f"SELECT recommend_code FROM accounts WHERE email = '{em['a']}'")
    call('POST', '/auth/signup', {'email': em['d'], 'password': TPW, 'name': '보상사아', 'recommendCode': acode})
    try:
        on = psql(f"UPDATE point_rules SET is_active = true, points = {PTS}, monthly_cap = NULL WHERE code = 'REFERRAL_DIRECT'")
        va = psql(f"UPDATE accounts SET identity_verified_at = now() WHERE email = '{em['a']}'")
        vd = psql(f"UPDATE accounts SET identity_verified_at = now() WHERE email = '{em['d']}'")   # D 의 보상은 A 에게(buyer 아님)
        off = psql("UPDATE point_rules SET is_active = false WHERE code = 'REFERRAL_DIRECT'")
        vc = psql(f"UPDATE accounts SET identity_verified_at = now() WHERE email = '{em['c']}'")
    finally:
        on_, pts_, cap_ = (rule0.split('|') + ['', '', ''])[:3] if not rule0.startswith('!') else ('false', '1000', '')
        psql(f"UPDATE point_rules SET is_active = {on_ or 'false'}, points = {pts_ or 1000}, monthly_cap = {cap_ or 'NULL'} WHERE code = 'REFERRAL_DIRECT'")
    t2 = call('GET', '/me/recommend/tree', None, TB)
    s2 = rsum(t2)
    nodes = t2.get('nodes') or []
    deep_bad = [n for n in nodes if n.get('gen', 0) > 1 and n.get('reward') is not None]
    g1 = [n for n in nodes if n.get('gen') == 1]
    rw_keys = set().union(*[set((n.get('reward') or {}).keys()) for n in g1]) if g1 else set()
    node_keys = set().union(*[set(n.keys()) for n in nodes]) if nodes else set()
    ok('② buyer 가 추천한 세 사람 — 받음 +1 · 기다림 +1 · 없음 +1 · 포인트 +점수(받음만)',
       t2.get('_err') is None and s2[0] - s1[0] == PTS and s2[1] - s1[1] == 1 and s2[2] - s1[2] == 1 and s2[3] - s1[3] == 1
       and not any(v.startswith('!') for v in (on, va, vd, off, vc)), f'{s1} → {s2}')
    ok('② 2번째 줄 이하는 reward 없음 · 1번째 줄 reward 는 state · points · at 만 · 상자에 그분 금액 · 번호 · 이메일 없음',
       not deep_bad and rw_keys <= {'state', 'points', 'at'} and node_keys <= {'k', 'p', 'gen', 'name', 'joined', 'children', 'reward'}
       and all((n.get('reward') or {}).get('state') in ('GOT', 'WAIT', 'NONE') for n in g1),
       f'{len(deep_bad)} · {sorted(rw_keys)} · {sorted(node_keys)}')
    ok('② 합계 = 1번째 줄 상자의 합(포인트 · 받음 · 기다림 · 없음)',
       s2 == (sum((n.get('reward') or {}).get('points') or 0 for n in g1), sum(1 for n in g1 if (n.get('reward') or {}).get('state') == 'GOT'),
              sum(1 for n in g1 if (n.get('reward') or {}).get('state') == 'WAIT'), sum(1 for n in g1 if (n.get('reward') or {}).get('state') == 'NONE'))
       or (t2.get('truncated') is True), str(s2))

    # ── ③ 정산 내역 · 운영 ──
    s = call('GET', '/me/settlement-summary', None, TB)
    rf = s.get('referral') or {}
    dbp = psql(f"SELECT coalesce(sum(points), 0) FROM point_ledger WHERE account_id = '{bid}' AND rule_code = 'REFERRAL_DIRECT' AND memo LIKE 'invitee %'")
    items = rf.get('items') or []
    ok('③ 정산 내역 referral = 관계도 합계 · 포인트 = DB · 사람별 줄(가린 이름 · 가입일 · 상태 · 포인트 · 받은 날 · 그분 금액 없음)',
       s.get('_err') is None and (rf.get('points'), rf.get('got'), rf.get('wait'), rf.get('none')) == s2 and str(rf.get('points')) == dbp
       and len(items) == s2[1] + s2[2] + s2[3] and all(set(x.keys()) <= {'name', 'joined', 'state', 'points', 'at'} for x in items)
       and any(x.get('name') == '보***' and x.get('state') == 'GOT' and x.get('points') == PTS for x in items), f"{rf.get('points')}/{dbp} · {len(items)}")
    an = call('GET', f'/admin/affiliates/recommend/{bid}', None, TA)
    sa = call('GET', f'/admin/accounts/{bid}/settlement-summary', None, TA)
    ok('③ 운영 — 관계도 reward 합계 · 회원 정산 내역 referral 이 회원 화면과 같은 숫자 · 1번째 줄 상자에 보상',
       an.get('_err') is None and rsum(an) == s2 and sa.get('_err') is None and (sa.get('referral') or {}).get('points') == rf.get('points')
       and any((n.get('reward') or {}).get('state') == 'GOT' for n in an.get('nodes') or [] if n.get('gen') == 1)
       and not any(n.get('reward') is not None for n in an.get('nodes') or [] if n.get('gen', 0) > 1), f'{rsum(an)} · {(sa.get("referral") or {}).get("points")}')

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
                pg.goto(SITE + '/my', wait_until='networkidle', timeout=120000)
                seen['card'] = pg.locator('[data-my-rcm-tree]').count()
                seen['compact'] = pg.locator('[data-my-rcm-tree] [data-rcm-compact]').count()
                seen['bar'] = pg.locator('[data-my-rcm-tree] .rcm-bar').count()
                seen['boxes'] = pg.locator('[data-my-rcm-tree] g[data-rcm-node]').count()
                seen['hrw'] = pg.locator('[data-my-rcm-tree] text[data-rcm-reward]').count()
                seen['hsum'] = pg.locator('[data-my-rcm-reward]').get_attribute('data-my-rcm-reward') if seen['card'] else None
                pg.goto(SITE + '/my/recommend', wait_until='networkidle', timeout=120000)
                seen['rsum'] = pg.locator('[data-rcm-reward-sum]').get_attribute('data-rcm-reward-sum') if pg.locator('[data-rcm-reward-sum]').count() else None
                seen['rgot'] = pg.locator('[data-rcm-tree] text[data-rcm-reward="GOT"]').count()
                txt = pg.locator('[data-screen="SB-MYP-RCM-010"]').inner_text()[:4000]
                pg.goto(SITE + '/my/settlement/all', wait_until='networkidle', timeout=120000)
                seen['tile'] = pg.locator('[data-settle-tile="referral"]').count()
                seen['rows'] = pg.locator('[data-settle-row="referral"]').count()
                seen['got'] = pg.locator('[data-settle-row="referral"][data-settle-rstate="GOT"]').count()
                b.close()
        except Exception as ex:
            errs.append(str(ex)[:160])
            txt = ''
        ok('④ 나의공간 — 첫 화면 작은 관계도(단추 없음 · 상자 · 보상 글 · 받은 보상 합계) · 관계도 화면 합계 · 정산 내역 「추천 보상」 칸 · 표(사람 수) · 계층 용어 없음 · 화면 오류 없음',
           seen.get('card') == 1 and seen.get('compact') == 1 and seen.get('bar') == 0 and seen.get('boxes', 0) >= 2 and seen.get('hrw', 0) >= 1
           and seen.get('hsum') == str(s2[0]) and seen.get('rsum') == f'{s2[0]}|{s2[1]}|{s2[2]}' and seen.get('rgot', 0) >= 1
           and seen.get('tile') == 1 and seen.get('rows') == len(items) and seen.get('got') == s2[1] and not any(w in txt for w in WORDS) and not errs,
           f'{seen} · {errs[:2]}')
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
                seen['sum'] = pg.locator('[data-rcm-reward-sum]').first.get_attribute('data-rcm-reward-sum') if pg.locator('[data-rcm-reward-sum]').count() else None
                seen['boxrw'] = pg.locator('[data-rcm-graph] text[data-rcm-reward]').count()
                pg.click(f'[data-member-money="{bid}"]'); pg.wait_for_timeout(2000)
                seen['money'] = pg.locator('[data-settle-referral]').first.get_attribute('data-settle-referral') if pg.locator('[data-settle-referral]').count() else None
                seen['tbl'] = pg.locator('[data-settle-referral-tbl] tbody tr').count()
                b.close()
        except Exception as ex:
            errs.append(str(ex)[:160])
        ok('⑤ 운영 화면 회원 상세 — 관계도 보상 합계 · 상자 보상 줄 · 정산 내역 추천 보상(같은 숫자 · 사람 수) · 화면 오류 없음',
           seen.get('sum') == f'{s2[0]}|{s2[1]}|{s2[2]}' and seen.get('boxrw', 0) >= 1 and seen.get('money') == str(s2[0])
           and seen.get('tbl') == len(items) and not errs, f'{seen} · {errs[:2]}')
    else:
        print('  (운영 화면 · playwright 없음 — ⑤ 건너뜀)')
    ok('되돌림 — 보상 규칙 원래대로', psql("SELECT is_active::text || '|' || points || '|' || coalesce(monthly_cap::text, '') FROM point_rules WHERE code = 'REFERRAL_DIRECT'") == rule0, rule0)

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
