"""v10.120 시험 — 로그인 전 관심 성향(시안 loginCta · 대표 결정 「가」 · docs/184)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e SITE=http://localhost:15174 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1120.py

  ① 코드 — 성향 화면이 손님을 로그인으로 보내지 않음 · 손님은 공개 문항 · 공개 진단 · 답은 이 탭에만(sessionStorage) · 저장 뒤 지움
     · 가입 5단계도 채움 · 로그인 화면 문구 · 사전 ko/en 키 같음 · 마이그레이션 없음(163 · D125)
  ② (브라우저) 손님 — 결과가 나옴 · 동의 칸 · 「성향 쓰지 않기」 없음 · 「로그인하고 등록」 → 로그인 → 성향 화면에 답이 채워짐 ·
     동의 칸은 비어 있고 등록 단추는 꺼짐 · 서버엔 저장 없음 → 동의 켜고 등록 → 저장 · 탭의 답 지움 — 끝나면 성향 지움
"""
import json, os, re, subprocess, time, urllib.error, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); SITE = os.environ.get('SITE')
RES = []
EMAIL = 'person@x.com'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


def keys(d, pre=''):
    out = set()
    for k, v in d.items():
        out |= keys(v, pre + k + '.') if isinstance(v, dict) else {pre + k}
    return out


mig = sorted(d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d)))
ok('① 마이그레이션 없음 — 163 · 마지막 D125', (len(mig), mig[-1] if mig else '') in ((163, 'D125_i18n_more_targets'), (164, 'D126_i18n_db_text'), (165, 'D127_partner_badge_codes'), (166, 'D128_integ_keys_admin'),), f'{len(mig)} · {mig[-1] if mig else ""}')
PG = rd('site/src/app/ai/profile/page.tsx'); PS = rd('site/src/components/ProfileSurvey.tsx'); DR = rd('site/src/lib/profileDraft.ts')
SW = rd('site/src/components/auth/SignupWizard.tsx'); SP = rd('site/src/components/auth/signup/StepProfile.tsx')
ok('① 성향 화면 — 손님을 로그인으로 보내지 않음 · 손님은 공개 문항 · guest',
   "redirect('/login?next=/ai/profile')" not in PG and "'/signup/profile-questions'" in PG and 'guest={!p}' in PG, '')
ok('① 손님 — 공개 진단 · 동의 칸 · 「성향 쓰지 않기」 없음 · 단추 둘이 답을 탭에 두고 이동',
   "guest ? '/api/v1/signup/profile-analyze'" in PS and '{res && !guest && (' in PS and '{!guest && <button' in PS
   and "saveDraft(ans); router.push('/login?next=/ai/profile')" in PS and "saveDraft(ans); router.push('/signup')" in PS, '')
ok('① 답 보관 — sessionStorage 만 · 지금 문항의 코드만 · 저장 · 다시 하기 · 쓰지 않기 뒤 지움 · 등록 회원은 채우지 않음',
   'sessionStorage' in DR and 'localStorage' not in DR and 'q.options.some((o) => o.code === x)' in DR
   and PS.count('clearDraft()') >= 3 and 'if (guest) return;' in PS, '')
ok('① 가입 5단계 — 채움 · 동의 칸은 그대로(켜야 저장) · 저장했을 때만 지움', 'loadDraft(questions)' in SW and 'if (pr.ok) clearDraft();' in SW and 'filled={filled}' in SW and "t('draftFilled')" in SP, '')
ok('① 검토 반영 — 로그아웃 · 이미 등록한 회원이면 탭의 답 지움 · 진단 실패면 옛 결과 지움',
   'clearDraft();' in rd('site/src/components/HdAuth.tsx') and 'clearDraft(); await logout()' in rd('site/src/components/home/HomeLogout.tsx')
   and 'if (mine?.registered) { clearDraft(); return; }' in PS and 'setRes(null); setErr(tr(' in PS, '')
MS = 'site/src/i18n/messages/'
jk, je = json.loads(rd(MS + 'ko/join.json') or '{}'), json.loads(rd(MS + 'en/join.json') or '{}')
bk, be = json.loads(rd(MS + 'ko.json') or '{}'), json.loads(rd(MS + 'en.json') or '{}')
NEW = ('draftFilled', 'guestLogin', 'guestSignup', 'guestNow', 'guestStore')
ok('① 사전 — 새 문장 ko/en · 로그인 화면 「가입 전에도」 · 가입 5단계 안내',
   all(k in jk['profileSurvey'] and k in je['profileSurvey'] for k in NEW) and keys(jk['profileSurvey']) == keys(je['profileSurvey'])
   and bk['login']['profileSub'] == '가입 전에도 할 수 있습니다' and '채워지고' in bk['login']['profileBody']
   and 'draftFilled' in bk['signup']['profile'] and 'draftFilled' in be['signup']['profile'], '')


def call(m, p, b=None, t=None, h=None):
    hd = {'content-type': 'application/json', **(h or {})}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m)
    try:
        return json.load(urllib.request.urlopen(r, timeout=60))
    except urllib.error.HTTPError as e:
        try: body = json.loads(e.read().decode('utf-8', 'replace'))
        except Exception: body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip()


if API and DB and SITE:
    TP = call('POST', '/auth/login', {'email': EMAIL, 'password': 'sgb-dev-1234'})['accessToken']
    AID = psql(f"SELECT id FROM accounts WHERE email = '{EMAIL}'")
    call('DELETE', '/me/profile', t=TP)   # 시작 — 등록 안 된 회원
    qs = call('GET', '/signup/profile-questions').get('questions') or []
    Q1, Q2 = qs[0], qs[1]
    O1, O2 = Q1['options'][0], Q2['options'][0]
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if not sync_playwright:
        ok('② 화면 시험은 시험 이미지(sgb-qa:v1 · playwright)에서', False, 'playwright 없음')
    else:
        try:
            with sync_playwright() as p:
                b = p.chromium.launch()
                ctx = b.new_context(viewport={'width': 1280, 'height': 900}); pg = ctx.new_page()
                pg.goto(SITE + '/ai/profile', wait_until='networkidle', timeout=120000)
                ok('② 손님 — 성향 화면이 열림(로그인으로 가지 않음)', '/ai/profile' in pg.url and pg.locator('[data-q]').count() == len(qs), pg.url)
                pg.locator(f'[data-q="{Q1["code"]}"] button', has_text=O1['label']).first.click()
                pg.locator(f'[data-q="{Q2["code"]}"] button', has_text=O2['label']).first.click()
                pg.wait_for_selector('.w1-segbox h3', timeout=15000)
                ok('② 손님 — 분석 결과가 나옴 · 동의 칸 · 「성향 쓰지 않기」 없음 · 단추 둘',
                   pg.locator('.w1-segbox h3').count() == 1 and pg.locator('.w1-prfq input[type=checkbox]').count() == 0
                   and pg.locator('[data-prf-guest]').count() == 2, pg.locator('.w1-segbox h3').inner_text())
                ok('② 손님 — 서버에 저장 없음', psql(f"SELECT count(*) FROM member_ad_profiles WHERE account_id = '{AID}'") == '0', '')
                pg.locator('[data-prf-guest="login"]').click(); pg.wait_for_url(lambda u: '/login' in u, timeout=30000, wait_until='commit'); pg.wait_for_selector('input[name=email]', timeout=30000)
                draft = pg.evaluate("() => sessionStorage.getItem('sgb_prf_draft')")
                ok('② 「로그인하고 등록」 → 로그인 화면(next=/ai/profile) · 답은 이 탭의 sessionStorage 에', 'next=' in pg.url and draft and Q1['code'] in draft
                   and pg.evaluate("() => localStorage.getItem('sgb_prf_draft')") is None, f'{pg.url} · {draft}')
                pg.fill('input[name=email]', EMAIL); pg.fill('input[name=password]', 'sgb-dev-1234'); pg.click('form button.cta-primary')
                pg.wait_for_url('**/ai/profile', timeout=60000, wait_until='commit'); pg.wait_for_load_state('networkidle'); pg.wait_for_timeout(1500)
                on1 = pg.locator(f'[data-q="{Q1["code"]}"] button[aria-pressed=true]').all_inner_texts()
                on2 = pg.locator(f'[data-q="{Q2["code"]}"] button[aria-pressed=true]').all_inner_texts()
                ok('② 로그인 뒤 성향 화면 — 고른 답이 채워짐 · 안내 문장', on1 == [O1['label']] and on2 == [O2['label']] and pg.locator('[data-prf-filled]').count() == 1, f'{on1} · {on2}')
                pg.wait_for_selector('.w1-prfq input[type=checkbox]', timeout=15000)
                cb = pg.locator('.w1-prfq input[type=checkbox]')
                save = pg.locator('.w1-prfact button.w1-bp')
                ok('② 동의 칸은 비어 있고 등록 단추는 꺼짐 · 서버엔 아직 저장 없음', not cb.is_checked() and save.is_disabled()
                   and psql(f"SELECT count(*) FROM member_ad_profiles WHERE account_id = '{AID}'") == '0', '')
                cb.check(); save.click(); pg.wait_for_url('**/ai/profile/done', timeout=30000, wait_until='commit')
                ok('② 동의 켜고 등록 → 저장 · 약관 동의 기록 · 탭의 답 지움',
                   psql(f"SELECT count(*) FROM member_ad_profiles WHERE account_id = '{AID}'") == '1' and psql(f"SELECT fn_adpersonal_on('{AID}')") == 't'
                   and pg.evaluate("() => sessionStorage.getItem('sgb_prf_draft')") is None, '')
                pg.goto(SITE + '/login', wait_until='networkidle')
                ctx.close()
                ctx = b.new_context(viewport={'width': 1280, 'height': 900}); pg = ctx.new_page()
                pg.goto(SITE + '/login', wait_until='networkidle', timeout=120000)
                cta = pg.locator('.w1-prfcta')
                ok('② 로그인 화면 칸 — 「가입 전에도 할 수 있습니다」 · 누르면 손님 성향 화면', '가입 전에도' in cta.inner_text(), '')
                cta.locator('a').click(); pg.wait_for_url('**/ai/profile', timeout=30000, wait_until='commit')
                ok('② 로그인 화면 칸 → 성향 화면(로그인으로 되돌아오지 않음)', pg.url.endswith('/ai/profile') and pg.locator('[data-q]').count() == len(qs), pg.url)
                ctx.close(); b.close()
        finally:
            call('DELETE', '/me/profile', t=TP)

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
