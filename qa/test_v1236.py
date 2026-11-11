"""v10.236 (docs/375) — 운영자 2단계 인증 켜기 전 점검

  ① (코드) turnOnPreview(SUPER · ALL · 정상 계정 · 운영 역할 · 이메일 가림 · 막지 않음) · API GET admin/mfa/turn-on-preview(SUPER · 422 MFA_MODE_INVALID) ·
     화면(설정에서 고르면 점검 줄) · 명세 · 영어 · 문서 375 · 판 v10.236 이상
  ② (API · DB) 회원 · ADMIN 403 · off 422 · ALL 필요 수 · 등록 수 = DB · SUPER 필요 수 = DB · 등록 안 한 사람 이메일은 가림(전체 이메일 없음) ·
     meEnrolled = DB · 설정 admin.mfa_required 그대로(읽기만)
  ③ (화면) 「내 2단계 인증」 설정에서 「운영 역할 모두」를 고르면 「켜기 전 점검」 줄
"""
import json, os, re, subprocess, time, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []
PW = 'sgb-dev-1234'
RPW = 'sgb-test-1234'      # ops@t.local(ADMIN)
OPS = "('REVIEWER','ADMIN','PAYOUT','SUPER','PARTNER_MAL','PARTNER_AFF')"


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ──────────────────────────────────────────────────────────────
MS, MC = rd('src/modules/identity/mfa.service.ts'), rd('src/modules/identity/mfa.controller.ts')
ok('① 서비스 · API — SUPER · ALL 만 · 정상 계정 · 운영 역할 · 이메일 가림 · SUPER 만 · 막지 않음(읽기만)',
   'async turnOnPreview(mode: string)' in MS and "'MFA_MODE_INVALID'" in MS and "WHERE a.status = 'ACTIVE'" in MS
   and 'MfaService.requiredFor(mode, r.roles)' in MS and 'email: maskMail(r.email)' in MS
   and 'UPDATE' not in MS[MS.index('async turnOnPreview'):MS.index('/** 설정 저장 전(AdminService)')]
   and "@Get('admin/mfa/turn-on-preview')\n  @Roles('SUPER')" in MC and "turnOnPreview(@Query('mode') mode: string)" in MC, '')
MY = rd('web/src/app/admin/MyMfa.tsx')
EN = rd('src/common/i18n/server-text.en.ts')
SJ = json.loads(rd('spec/screens.json') or '{"screens":[]}'); sc = {s['id']: s for s in SJ.get('screens', [])}
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('375_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 화면 · 명세 · 영어 · 문서 375 · 판 v10.236 이상',
   '/admin/mfa/turn-on-preview?mode=${pick}' in MY and 'data-mfa-turnon={pv.notEnrolled.length}' in MY and '켜기 전 점검' in MY
   and 'GET /admin/mfa/turn-on-preview' in sc.get('SB-ADM-MFA-010', {}).get('apis', [])
   and '"SUPER 또는 ALL 만 미리 볼 수 있습니다."' in EN
   and bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 236), f'{DOC} · {rd("VERSION").strip()}')


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


# ── ② API · DB ──────────────────────────────────────────────────────────
if API and DB:
    import sys
    sys.path.insert(0, HERE)
    import consent_ok
    for e in ('admin@x.com', 'buyer@x.com'): consent_ok.agree(e, PW)
    TS = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    TA = call('POST', '/auth/login', {'email': 'ops@t.local', 'password': RPW}).get('accessToken')
    TB = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW}).get('accessToken')
    before = psql("SELECT coalesce((SELECT value FROM site_settings WHERE key = 'admin.mfa_required'), '(없음)')")
    rb = call('GET', '/admin/mfa/turn-on-preview?mode=ALL', None, TB)
    ra = call('GET', '/admin/mfa/turn-on-preview?mode=ALL', None, TA)
    ro = call('GET', '/admin/mfa/turn-on-preview?mode=off', None, TS)
    ok('② 회원 403 · ADMIN 403 · off 422 MFA_MODE_INVALID', rb.get('_err') == 403 and ra.get('_err') == 403 and (ro.get('_err'), ro.get('code')) == (422, 'MFA_MODE_INVALID'),
       f"{rb.get('_err')} · {ra.get('_err')} · {ro.get('_err')} {ro.get('code')}")
    base = (f"FROM accounts a WHERE a.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id = a.id AND r.role IN {OPS})")
    all_n = psql(f"SELECT count(*) || '|' || count(*) FILTER (WHERE EXISTS (SELECT 1 FROM account_mfa m WHERE m.account_id = a.id AND m.enabled_at IS NOT NULL)) {base}")
    sup_n = psql("SELECT count(*) FROM accounts a WHERE a.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id = a.id AND r.role = 'SUPER')")
    p_all = call('GET', '/admin/mfa/turn-on-preview?mode=ALL', None, TS)
    p_sup = call('GET', '/admin/mfa/turn-on-preview?mode=SUPER', None, TS)
    ok('② ALL — 필요 수 · 등록 수 = DB · 등록 안 한 사람 수 = 필요 - 등록', f"{p_all.get('need')}|{p_all.get('enrolled')}" == all_n
       and len(p_all.get('notEnrolled') or []) == (p_all.get('need') or 0) - (p_all.get('enrolled') or 0), f"{p_all.get('need')}|{p_all.get('enrolled')} / {all_n}")
    ok('② SUPER — 필요 수 = DB(SUPER 정상 계정) · ALL 보다 많지 않음', str(p_sup.get('need')) == sup_n and (p_sup.get('need') or 0) <= (p_all.get('need') or 0), f"{p_sup.get('need')} / {sup_n}")
    emails = [x.get('email') or '' for x in p_all.get('notEnrolled') or []]
    full = psql(f"SELECT string_agg(a.email, ',') {base}").split(',')
    ok('② 등록 안 한 사람 이메일은 가림(***@) · 전체 이메일 없음', all('***@' in e for e in emails) and not any(f and f in json.dumps(p_all, ensure_ascii=False) for f in full),
       f'{emails[:3]}')
    me = psql("SELECT EXISTS (SELECT 1 FROM account_mfa m JOIN accounts a ON a.id = m.account_id WHERE a.email = 'admin@x.com' AND m.enabled_at IS NOT NULL)")
    after = psql("SELECT coalesce((SELECT value FROM site_settings WHERE key = 'admin.mfa_required'), '(없음)')")
    ok('② meEnrolled = DB · 설정 그대로(읽기만) · 안내 글', str(p_all.get('meEnrolled')).lower() == {'t': 'true', 'f': 'false'}.get(me, me) and before == after and bool(p_all.get('note')),
       f"{p_all.get('meEnrolled')}/{me} · {before} → {after} · {p_all.get('note', '')[:60]}")

    # ── ③ 화면 ──
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if ADMIN_WEB and sync_playwright:
        errs = []
        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = b.new_page(viewport={'width': 1400, 'height': 900})
            pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
            pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
            pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
            pg.goto(ADMIN_WEB + '/#/my-mfa', wait_until='networkidle', timeout=120000)
            pg.reload(wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
            cur = pg.locator('[data-mfa-mode]').first.get_attribute('data-mfa-mode') if pg.locator('[data-mfa-mode]').count() else None
            pick = 'SUPER' if cur == 'ALL' else 'ALL'
            sel = pg.locator('select[name=mfa-mode]')
            ns = sel.count()
            if ns: sel.select_option(pick); pg.wait_for_timeout(2500)
            box = pg.locator('[data-mfa-turnon]')
            seen = (ns, box.count(), '켜기 전 점검' in (box.first.inner_text() if box.count() else ''))
            pg.screenshot(path=os.path.join(HERE, 'v1236_mfa_turnon.png'), full_page=False)
            b.close()
        after2 = psql("SELECT coalesce((SELECT value FROM site_settings WHERE key = 'admin.mfa_required'), '(없음)')")
        ok('③ 「내 2단계 인증」 설정에서 고르면 「켜기 전 점검」 줄(저장 안 함 · 설정 그대로) · 화면 오류 없음', seen == (1, 1, True) and after2 == before and not errs, f'{cur}→{pick} · {seen} · {errs[:2]}')
    else:
        print('  (운영 화면 · playwright 없음 — ③ 건너뜀)')
else:
    print('  (API · DB 없음 — ② · ③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
