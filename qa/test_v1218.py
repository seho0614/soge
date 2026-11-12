"""v10.218 (D189 · docs/351) — 회원 추천인 · 추천 관계도(보상은 직접 추천 1단계만)

  ① (코드) D189 추천 코드 · 고리 막기 · 변경 기록 · 보상(직접 · 한 번 · 꺼짐) · 표에 단계 · 부모 칸 없음 · 서비스 · 가입 · 쿠키 sgb_rcm · 파트너센터 메뉴 · 운영 화면 탭 ·
     screens.json · 사전 ko · en(계층 용어 없음 · 영어 invite code) · 문서 351 · 판
  ② (API · DB) 시험 회원 A(intro@x.com 의 코드) → B(A 코드) → C(B 코드) 가입 · 없는 코드 422 · 코드 확인(가린 이름) · 내 추천 · 파트너 트리(가린 이름 · 날짜만 ·
     대 수가 하나씩 늘어남) · 파트너 아님 403 · 운영 찾기 · 한 회원 · 고리(A ← C) 422 · 사유 없음 422 · 지우고 되돌림(기록) ·
     보상 켜고 C 본인인증 → B 에게만 · 직접 넣기 막힘 · 보상 규칙 되돌림
  ③ (화면) 가입 ?rc= 칸 채움 · 파트너센터 「추천 관계도」 · 운영 화면 「추천 관계도」 탭
  시험 회원은 매번 새 이메일(지우지 않음 — 변경 기록 · 보상 장부는 지울 수 없음) · 보상 규칙은 원래대로(두 번 돌려도 같음)
"""
import json, os, re, subprocess, time, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); SITE = os.environ.get('SITE'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'
TPW = 'Sgb-test-1218!'
P_EMAIL = 'intro@x.com'   # local-setup.sh — 제휴 활동 중(aff_status ACTIVE)


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


def js(rel):
    try:
        return json.loads(rd(rel))
    except Exception:
        return {}


M = rd('prisma/migrations/D189_member_recommend/migration.sql')
mig = sorted(d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d))) if os.path.isdir(os.path.join(K, 'prisma/migrations')) else []
ok('① D189 — 추천 코드(6자 · 0 · O · 1 · I 없음 · 겹치지 않음 · 못 바꿈 · 있는 회원 채움) · 고리 막기(위로 올라감 · UPDATE 도) · 변경 기록(못 고침) · 보상 REFERRAL_DIRECT 꺼진 채 · 직접 추천 · 한 번 · 표에 단계 · 부모 칸 없음 · 지우는 문장 없음',
   'ADD COLUMN IF NOT EXISTS recommend_code text' in M and "'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'" in M and 'ux_accounts_recommend_code' in M
   and "추천 코드는 바꿀 수 없습니다." in M and 'UPDATE accounts SET recommend_code = fn_recommend_code_new() WHERE id = r.id' in M
   and 'WITH RECURSIVE up(id, n)' in M and 'trg_referral_no_chain_upd BEFORE UPDATE ON public.introducer_referrals' in M
   and 'CREATE TABLE IF NOT EXISTS public.recommend_changes' in M and 'trg_recommend_changes_ro BEFORE UPDATE OR DELETE' in M
   and "VALUES ('REFERRAL_DIRECT'," in M and "1000, true, NULL, false, 9)" in M
   and "set_config('sgb.referral_reward', p_invitee::text, true)" in M and 'trg_referral_reward_guard BEFORE INSERT ON public.point_ledger' in M
   and 'AFTER UPDATE OF identity_verified_at ON public.accounts' in M
   and not re.search(r'ALTER TABLE public\.introducer_referrals ADD', M) and not re.search(r'introducer_referrals[^;]*\b(level|tier|depth|upline|parent)\b', M, re.I)
   and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE)\b', M) and 'D189_member_recommend' in mig, f'{len(mig)} · {mig[-1] if mig else ""}')

SV, CT = rd('src/modules/affiliate/recommend.service.ts'), rd('src/modules/affiliate/recommend.controller.ts')
AS, AM, FL = rd('src/modules/identity/auth.service.ts'), rd('src/app.module.ts'), rd('src/common/db-error.filter.ts')
ok('① API — 서비스 · 컨트롤러 7개(코드 확인 1분 20번 · 내 추천 · 파트너 트리 · 운영 찾기 · 한 회원 · 고치기 ADMIN · 보상 규칙 SUPER) · 가입에 추천 코드 · 모듈 · DB 오류 RECOMMEND_RULE · 파트너 트리는 회원 번호 · 이메일 안 보냄',
   all(x in CT for x in ("@Get('auth/recommend-code/:code')", "@Get('me/recommend')", "@Get('partner/affiliate/recommend-tree')", "@Get('admin/affiliates/recommend')",
                         "@Get('admin/affiliates/recommend/:id')", "@Patch('admin/affiliates/recommend/:id')", "@Put('admin/affiliates/recommend-reward')"))
   and "if (hits.length >= 20)" in CT and "@Roles('SUPER')" in CT and "@Audit('RECOMMEND_CHANGE', 'ACCOUNT')" in CT
   and "throw new Forbidden('AFF_REQUIRED'" in SV and "name: r.withdrawn ? null : maskName(r.name)" in SV and "joined: r.gen === 1 ? ymd(r.created_at) : ymd(r.created_at).slice(0, 7)" in SV
   and "RECOMMEND_CODE_UNKNOWN" in AS and "INSERT INTO introducer_referrals (inviter_id, invitee_id) VALUES ($1, $2)`, [recommender, acc.id]" in AS
   and 'RecommendController,' in AM and 'RecommendService,' in AM and "code: 'RECOMMEND_RULE'" in FL, '')

SW, SP, SPG = rd('site/src/components/auth/SignupWizard.tsx'), rd('site/src/components/auth/signup/StepPerson.tsx'), rd('site/src/app/signup/page.tsx')
MW, SS, PF = (rd('site/src/proxy.ts') or rd('site/src/middleware.ts')), rd('site/src/lib/session.ts'), rd('site/src/components/partner/P2Frame.tsx')
PR, MY, AD, AFT = rd('site/src/app/partners/recommend/page.tsx'), rd('site/src/app/my/page.tsx'), rd('web/src/app/admin/affiliates/Recommend.tsx'), rd('web/src/app/admin/Affiliates.tsx')
ok('① 화면 — 가입 3단계 추천 코드(?rc= · 쿠키 sgb_rcm 30일 · 칠 때 확인) · 나의공간 내 추천 코드 · 파트너센터 메뉴 · SB-AFC-RCM-010 · 운영 화면 탭 SB-AFF-RCM-010',
   'data-recommend=""' in SP and "fetch(`/api/v1/auth/recommend-code/${c}`)" in SW and "r.code === 'RECOMMEND_CODE_UNKNOWN'" in SW
   and "get('sgb_rcm')" in SPG and 'initialCode={rc}' in SPG and "const RCM = 'sgb_rcm';" in MW and 'maxAge: 60 * 60 * 24 * 30' in MW
   and '...(recommendCode ? { recommendCode } : {})' in SS and "['/partners/recommend', 'rcm']" in PF and 'rcm: <>' in PF
   and 'data-screen="SB-AFC-RCM-010"' in PR and "'/partner/affiliate/recommend-tree'" in PR and 'data-my-recommend=""' in MY
   and 'data-screen="SB-AFF-RCM-010"' in AD and "{ key: 'recommend', label: '추천 관계도', screen: 'SB-AFF-RCM-010' }" in AFT and '<Recommend />' in AFT, '')

SCR = js('spec/screens.json').get('screens', [])
sid = {s['id']: s for s in SCR}
ko, en = js('site/src/i18n/messages/ko/affiliate.json').get('recommend', {}), js('site/src/i18n/messages/en/affiliate.json').get('recommend', {})
kp, ep = js('site/src/i18n/messages/ko.json').get('signup', {}).get('person', {}), js('site/src/i18n/messages/en.json').get('signup', {}).get('person', {})
WORDS = ('하위', '산하', '직급', '다운라인', '상위')
nocom = lambda src: '\n'.join(l for l in src.split('\n') if not re.match(r'\s*(/\*|\*|//)', l))   # 주석(「계층 용어를 쓰지 않습니다」)은 빼고 화면 글만
kotext = json.dumps(ko, ensure_ascii=False) + json.dumps(kp, ensure_ascii=False) + nocom(PR) + nocom(AD)
ok('① screens.json · 사전 — 두 화면 · API 연결 · ko · en 칸 같음 · 계층 용어 없음 · 영어 「invite」(소개코드 referral code 와 따로)',
   'GET /partner/affiliate/recommend-tree' in sid.get('SB-AFC-RCM-010', {}).get('apis', []) and 'PUT /admin/affiliates/recommend-reward' in sid.get('SB-AFF-RCM-010', {}).get('apis', [])
   and 'GET /auth/recommend-code/{code}' in sid.get('SB-HOM-AUT-020', {}).get('apis', []) and 'GET /me/recommend' in sid.get('SB-MYP-DSH-010', {}).get('apis', [])
   and ko and set(ko) == set(en) and all(k in kp and k in ep for k in ('rc', 'rcPh', 'rcOk', 'rcNo', 'rcNotice'))
   and not any(w in kotext for w in WORDS) and 'Invite code' in ep.get('rc', '') and 'referral' not in json.dumps(en).lower(),
   f"{[w for w in WORDS if w in kotext]}")

DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('351_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 문서 351 · 판 v10.218 이상', bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 218), f'{DOC} · {rd("VERSION").strip()}')


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
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return r.stdout.strip() if not r.returncode else ('!' + r.stderr.strip()[:200])


def page(url):
    try:
        return urllib.request.urlopen(url, timeout=120).read().decode('utf-8', 'replace')
    except Exception as ex:
        return f'!{ex}'


def gens(tree):
    return {g['gen']: g['count'] for g in (tree.get('generations') or [])} if isinstance(tree, dict) else {}


if API and DB:
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import consent_ok
    stamp = str(int(time.time()))[-7:]
    rule0 = psql("SELECT is_active::text || '|' || points || '|' || coalesce(monthly_cap::text, '') FROM point_rules WHERE code = 'REFERRAL_DIRECT'")
    try:
        PT = call('POST', '/auth/login', {'email': P_EMAIL, 'password': PW}).get('accessToken')
        AT = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
        pcode = psql(f"SELECT recommend_code FROM accounts WHERE email = '{P_EMAIL}'")
        before = call('GET', '/partner/affiliate/recommend-tree', t=PT)
        ok('② 모든 회원에게 추천 코드(형식) · 파트너 코드 있음 · 표에 단계 · 부모 칸 없음(N-12)',
           psql("SELECT count(*) FROM accounts WHERE recommend_code IS NULL OR recommend_code !~ '^[A-HJ-NP-Z2-9]{6}$'") == '0' and re.fullmatch(r'[A-HJ-NP-Z2-9]{6}', pcode or '') is not None
           and psql("SELECT count(*) FROM information_schema.columns WHERE table_name = 'introducer_referrals' AND column_name ~* 'level|tier|depth|upline|parent'") == '0',
           f'{pcode} · {gens(before)}')

        bad = call('POST', '/auth/signup', {'email': f'rcm-bad-{stamp}@t.local', 'password': TPW, 'name': '없는코드', 'recommendCode': 'ZZZZZ2'})
        A = call('POST', '/auth/signup', {'email': f'rcm-a-{stamp}@t.local', 'password': TPW, 'name': '추천가나', 'recommendCode': pcode.lower()})
        acode = psql(f"SELECT recommend_code FROM accounts WHERE email = 'rcm-a-{stamp}@t.local'")
        B = call('POST', '/auth/signup', {'email': f'rcm-b-{stamp}@t.local', 'password': TPW, 'name': '추천다라', 'recommendCode': acode})
        bcode = psql(f"SELECT recommend_code FROM accounts WHERE email = 'rcm-b-{stamp}@t.local'")
        C = call('POST', '/auth/signup', {'email': f'rcm-c-{stamp}@t.local', 'password': TPW, 'name': '추천마바', 'recommendCode': bcode})
        ids = dict(x.split('|') for x in psql(f"SELECT email || '|' || id FROM accounts WHERE email LIKE 'rcm-_-{stamp}@t.local'").split('\n') if '|' in x)
        aid, bid, cid = ids.get(f'rcm-a-{stamp}@t.local'), ids.get(f'rcm-b-{stamp}@t.local'), ids.get(f'rcm-c-{stamp}@t.local')
        chain = psql(f"SELECT string_agg(i.email || '<' || u.email, ',' ORDER BY i.created_at) FROM introducer_referrals r JOIN accounts i ON i.id = r.invitee_id JOIN accounts u ON u.id = r.inviter_id WHERE i.email LIKE 'rcm-_-{stamp}@t.local'")
        ok('② 가입 — 없는 코드 422 RECOMMEND_CODE_UNKNOWN(계정 안 생김) · 소문자 코드도 받음 · A ← intro · B ← A · C ← B',
           bad.get('_err') == 422 and bad.get('code') == 'RECOMMEND_CODE_UNKNOWN' and psql(f"SELECT count(*) FROM accounts WHERE email = 'rcm-bad-{stamp}@t.local'") == '0'
           and A.get('accessToken') and B.get('accessToken') and C.get('accessToken')
           and chain == f'rcm-a-{stamp}@t.local<{P_EMAIL},rcm-b-{stamp}@t.local<rcm-a-{stamp}@t.local,rcm-c-{stamp}@t.local<rcm-b-{stamp}@t.local', f'{bad.get("code")} · {chain}')

        chk, chk2 = call('GET', f'/auth/recommend-code/{acode}'), call('GET', '/auth/recommend-code/ZZZZZ2')
        mine = call('GET', '/me/recommend', t=A.get('accessToken'))
        ok('② 코드 확인 — 가린 이름(추***) · 계정 번호 없음 · 없는 코드 404 · 내 추천(A) — 코드 · 링크 · 직접 1명 · 추천한 분 가린 이름',
           chk.get('name') == '추***' and set(chk) == {'code', 'name'} and chk2.get('_err') == 404
           and mine.get('code') == acode and mine.get('link') == f'/signup?rc={acode}' and mine.get('directCount') == 1 and '*' in (mine.get('recommender') or ''),
           f'{chk} · {chk2.get("_err")} · {mine}')

        after = call('GET', '/partner/affiliate/recommend-tree', t=PT)
        g0, g1 = gens(before), gens(after)
        nodes = after.get('nodes') or [] if isinstance(after, dict) else []
        mine_n = [x for x in nodes if x.get('name') in ('추***',)]
        ok('② 파트너 트리 — 1 · 2 · 3번째가 하나씩 늘어남 · 가린 이름 · 직접은 가입일 · 그 아래는 가입 월 · 회원 번호 · 이메일 · 코드 없음',
           all(g1.get(k, 0) == g0.get(k, 0) + 1 for k in (1, 2, 3)) and len(mine_n) >= 3
           and all(set(x) - {'reward'} == {'k', 'p', 'gen', 'name', 'joined', 'children'} for x in nodes)  # v10.258 보상 칸(1번째 줄만 · test_v1257)
           and all((len(x['joined']) == 10) == (x['gen'] == 1) for x in nodes) and '@' not in json.dumps(after),
           f'{g0} → {g1} · {len(nodes)}')
        na = call('GET', '/partner/affiliate/recommend-tree', t=A.get('accessToken'))
        ok('② 파트너 아님(A) → 403 AFF_REQUIRED', na.get('_err') == 403 and na.get('code') == 'AFF_REQUIRED', str(na)[:120])

        srch = call('GET', f'/admin/affiliates/recommend?q={acode}', t=AT)
        node = call('GET', f'/admin/affiliates/recommend/{aid}', t=AT)
        cyc = call('PATCH', f'/admin/affiliates/recommend/{aid}', {'recommendCode': ccode, 'reason': '시험 고리'} if (ccode := psql(f"SELECT recommend_code FROM accounts WHERE id = '{cid}'")) else {}, t=AT)
        nor = call('PATCH', f'/admin/affiliates/recommend/{bid}', {'recommendCode': None, 'reason': ' '}, t=AT)
        rm = call('PATCH', f'/admin/affiliates/recommend/{bid}', {'recommendCode': None, 'reason': '시험 — 추천인 지움'}, t=AT)
        nb = call('GET', f'/admin/affiliates/recommend/{bid}', t=AT)
        back = call('PATCH', f'/admin/affiliates/recommend/{bid}', {'recommendCode': acode, 'reason': '시험 — 되돌림'}, t=AT)
        ok('② 운영 — 코드로 찾기 1명(직접 1) · 한 회원(위로 intro · 아래 1 · 1) · 고리(A ← C) 422 INV_1 · 사유 없음 422 · B 추천인 지움 → 기록 · 되돌림',
           isinstance(srch, list) and len(srch) == 1 and srch[0].get('directCount') == 1
           and [u.get('code') for u in node.get('recommenders', [])][:1] == [pcode] and gens(node) == {1: 1, 2: 1}
           and cyc.get('_err') == 422 and cyc.get('code') == 'INV_1' and nor.get('_err') == 422 and nor.get('code') == 'REASON_REQUIRED'
           and rm.get('ok') is True and nb.get('recommenders') == [] and len(nb.get('changes') or []) >= 1 and back.get('ok') is True
           and psql(f"SELECT count(*) FROM recommend_changes WHERE invitee_id = '{bid}'") == '2'
           and psql(f"SELECT count(*) FROM introducer_referrals WHERE invitee_id = '{bid}' AND inviter_id = '{aid}'") == '1',
           f'{len(srch) if isinstance(srch, list) else srch} · {gens(node)} · {cyc.get("code")} · {nor.get("code")} · {rm} · {back}')

        put = call('PUT', '/admin/affiliates/recommend-reward', {'isActive': True, 'points': 700, 'monthlyCap': None}, t=AT)
        v = psql(f"UPDATE accounts SET identity_verified_at = now() WHERE id = '{cid}'")
        led = psql(f"SELECT string_agg(a.email || ':' || l.points, ',') FROM point_ledger l JOIN accounts a ON a.id = l.account_id WHERE l.rule_code = 'REFERRAL_DIRECT' AND a.id IN ('{aid}', '{bid}', '{cid}')")
        direct = psql(f"INSERT INTO point_ledger (account_id, rule_code, points) VALUES ('{aid}', 'REFERRAL_DIRECT', 5)")
        again = psql(f"UPDATE accounts SET identity_verified_at = NULL WHERE id = '{cid}'; UPDATE accounts SET identity_verified_at = now() WHERE id = '{cid}'; SELECT count(*) FROM point_ledger WHERE rule_code = 'REFERRAL_DIRECT' AND account_id = '{bid}'")
        locked = call('PATCH', f'/admin/affiliates/recommend/{cid}', {'recommendCode': acode, 'reason': '시험 — 보상 준 관계'}, t=AT)
        ok('② 보상 — 켜고(700점) C 본인인증 → 직접 추천한 B 에게만 한 번(A 없음) · 다시 인증해도 그대로 · 직접 넣기 막힘 · 보상 준 관계 고치기 422',
           put.get('isActive') is True and put.get('points') == 700 and not v.startswith('!') and led == f'rcm-b-{stamp}@t.local:700'
           and direct.startswith('!') and '직접 추천한 한 사람에게 한 번만' in direct and again == '1'
           and locked.get('_err') == 422 and locked.get('code') == 'RECOMMEND_REWARDED',
           f'{put} · {led} · {direct[:60]} · {again} · {locked.get("code")}')
        mem = call('PUT', '/admin/affiliates/recommend-reward', {'isActive': False, 'points': 700, 'monthlyCap': None}, t=A.get('accessToken'))
        ok('② 보상 규칙 바꾸기는 SUPER 만(회원 403)', mem.get('_err') == 403, str(mem)[:100])

        if SITE:
            h = page(SITE + f'/signup?rc={acode}')
            # 추천 코드 칸은 3단계(브라우저에서 넘어감)라 첫 HTML 에는 없음 — 형식이 맞는 코드가 initialCode 로 넘어가는지 봄(있는 코드인지는 브라우저가 확인) · 형식이 틀린 코드(0 · O 들어감)는 안 넘어감
            hb = page(SITE + '/signup?rc=O0O0O0')
            want, bad = '\\"initialCode\\":\\"' + acode + '\\"', '\\"initialCode\\":\\"\\"'
            ok('③ 가입 화면 ?rc= — 형식 맞는 코드는 가입 마법사 initialCode 로 넘어감 · 형식 틀린 코드는 빈 칸',
               want in h and bad in hb, f'{want in h} · {bad in hb}')
        try:
            from playwright.sync_api import sync_playwright
        except Exception:
            sync_playwright = None
        if sync_playwright and SITE:
            seen, errs = {}, []
            consent_ok.agree(P_EMAIL, PW)
            try:
                with sync_playwright() as p:
                    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1400, 'height': 1000})
                    pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                    pg.goto(SITE + '/login'); pg.fill('input[name=email]', P_EMAIL); pg.fill('input[name=password]', PW)
                    pg.click('form.auth button'); pg.wait_for_timeout(2000)
                    pg.goto(SITE + '/partners/recommend', wait_until='networkidle', timeout=120000)
                    seen['screen'] = pg.locator('[data-screen="SB-AFC-RCM-010"]').count()
                    seen['total'] = pg.locator('[data-rcm-total]').get_attribute('data-rcm-total') if pg.locator('[data-rcm-total]').count() else None
                    seen['code'] = pg.locator('[data-testid=rcm-code]').inner_text() if pg.locator('[data-testid=rcm-code]').count() else ''
                    seen['menu'] = pg.locator('nav.p2menu a[href="/partners/recommend"]').count()
                    seen['text'] = pg.locator('[data-screen="SB-AFC-RCM-010"]').inner_text()[:4000] if seen['screen'] else ''
                    b.close()
            except Exception as ex:
                errs.append(str(ex)[:160])
            ok('③ 파트너센터 「추천 관계도」 — 메뉴 · 화면 · 내 코드 · 모두 n명 · 「추***」 · 계층 용어 없음',
               seen.get('screen') == 1 and seen.get('menu') == 1 and seen.get('code') == pcode and int(seen.get('total') or 0) >= 3
               and '추***' in seen.get('text', '') and not any(w in seen.get('text', '') for w in WORDS) and not errs,
               f"{ {k: v for k, v in seen.items() if k != 'text'} } · {errs[:2]}")
        if sync_playwright and ADMIN_WEB:
            seen, errs = {}, []
            consent_ok.agree('admin@x.com', PW)
            try:
                with sync_playwright() as p:
                    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 1000})
                    pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                    pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                    pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                    pg.wait_for_selector('[data-state-check]', timeout=30000)
                    pg.goto(ADMIN_WEB + '/#/affiliates', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(1500)
                    pg.locator('button[role=tab][data-screen="SB-AFF-RCM-010"]').click(); pg.wait_for_timeout(1500)
                    seen['screen'] = pg.locator('div[data-screen="SB-AFF-RCM-010"]').count()
                    seen['rule'] = pg.locator('[data-rcm-rule]').count()
                    pg.fill('input[aria-label="회원 찾기"]', acode); pg.locator('button', has_text='찾기').first.click(); pg.wait_for_timeout(1500)
                    pg.locator('[data-rcm-list] button', has_text='관계도').first.click(); pg.wait_for_timeout(1500)
                    seen['detail'] = pg.locator(f'[data-rcm-detail="{aid}"]').count()
                    seen['nodes'] = pg.locator('[data-rcm-node]').count()
                    b.close()
            except Exception as ex:
                errs.append(str(ex)[:160])
            ok('③ 운영 화면 「추천 관계도」 탭 — 보상 규칙 · 찾기 · 관계도(아래 B · C)', seen.get('screen') == 1 and seen.get('rule') == 1 and seen.get('detail') == 1
               and seen.get('nodes', 0) >= 2 and not errs, f'{seen} · {errs[:2]}')
    finally:
        on, pts, cap = (rule0.split('|') + ['', '', ''])[:3]
        psql(f"UPDATE point_rules SET is_active = {on or 'false'}, points = {pts or 1000}, monthly_cap = {cap or 'NULL'} WHERE code = 'REFERRAL_DIRECT'")
    ok('되돌림 — 보상 규칙 원래대로', psql("SELECT is_active::text || '|' || points || '|' || coalesce(monthly_cap::text, '') FROM point_rules WHERE code = 'REFERRAL_DIRECT'") == rule0, rule0)

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
