"""v10.161 시험 — 약관 예정 게시(시행일 지키기 · D151) · 예정 취소 · 재동의 시점 스위치 · 운영 화면 「약관」 메뉴 · 사용자 웹 알림(docs/246)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e SITE=http://localhost:15174 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1161.py

  ① 코드 — D151(뷰 2 · 함수 · 트리거 함수 · 설정 · 지우는 문장 없음 · 189) · 서버(게시 · 예정 취소 · 지금 판으로 읽기 · 시행 예정 목록 · 매시간 작업 · SUPER 설정) ·
     운영 화면(시행 예정 · 예정 취소 · 제14조 경고 · 재동의 스위치 · 「약관」 메뉴) · 사용자 웹(알림 띠 · 약관 · 동의 화면 · 영어) · 명세 · 영어 · docs/246 · 판
  ② (API) 마케팅 약관 9.7 을 10일 뒤 시행으로 게시 → 시행 예정 · 앞 판 게시 그대로 · /terms/required 는 앞 판 · /terms/upcoming 에 9.7 ·
     다른 판 게시 422 TERM_SCHEDULED_EXISTS · 게시된 판 다시 게시 422 TERM_PUBLISHED · 예정 취소(법무 검토 · 〔시행일〕 되돌림 · 감사) ·
     다시 게시 → 동의 기록이 있으면 취소 422 TERM_HAS_CONSENT · 스위치 on → 바로 9.7 · ADMIN 은 스위치 403 · 시행일 지나면 앞 판 보관 · 되돌림
  ③ (화면) 운영 화면 관 관리 › 약관(#/terms) — 시행 예정 줄 · 예정 취소 단추 · 재동의 시점 · 사용자 웹 /terms 「약관이 바뀝니다」 · 바닥줄 위 알림
"""
import datetime, json, os, re, subprocess, time, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB'); SITE = os.environ.get('SITE')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(d for d in os.listdir(MD) if os.path.isdir(os.path.join(MD, d)))
M = rd('prisma/migrations/D151_terms_scheduled/migration.sql')
ok('① D151 — v_terms_current(시행일 지난 최근 · 없으면 가장 이른 예정 · 스위치) · v_terms_upcoming · fn_terms_archive_due · 트리거 함수(초안만 바로 보관) · 미동의 · AI 조건 · 설정 off · 지우는 문장 없음 · 189',
   all(x in M for x in ('CREATE OR REPLACE VIEW public.v_terms_current', 'CREATE OR REPLACE VIEW public.v_terms_upcoming', 'FUNCTION public.fn_terms_archive_due()',
                        'FUNCTION public.fn_archive_prior_terms()', "AND status IN ('LEGAL_REVIEW','DRAFT');", 'PERFORM public.fn_terms_archive_due();',
                        'CREATE OR REPLACE VIEW public.v_term_not_agreed', 'FROM public.v_terms_current', "('terms.reconsent_before_effective', 'off'",
                        "(sw.early OR t.effective_from <= now()) DESC", 'ON CONFLICT (key) DO NOTHING'))
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|DROP FUNCTION|TRUNCATE)\b', M) and (len(mig), mig[-1]) in ((189, 'D151_terms_scheduled'),),
   f'{len(mig)} · {mig[-1]}')

TS = rd('src/modules/catalog/terms.service.ts'); TC = rd('src/modules/catalog/terms.controller.ts'); CS = rd('src/modules/catalog/compliance.service.ts')
AS = rd('src/modules/identity/auth.service.ts'); AC = rd('src/modules/identity/auth.controller.ts'); SC = rd('src/worker/scheduler.service.ts')
ADS = rd('src/modules/admin/admin.service.ts'); EN = rd('src/common/i18n/server-text.en.ts')
pub = TS.split('async publish(')[1][:4000] if 'async publish(' in TS else ''
ok('① 서버 게시 — 앞 판은 시행된 뒤 보관(fn_terms_archive_due) · scheduled · 예정 판 하나(TERM_SCHEDULED_EXISTS) · 게시 판 다시 게시 막음(TERM_PUBLISHED) · 옛 「바로 보관」 문장 없음',
   'SELECT fn_terms_archive_due() AS n' in pub and 'scheduled: sc.scheduled' in pub and "'TERM_SCHEDULED_EXISTS'" in pub and "'TERM_PUBLISHED'" in pub
   and "version <> $2 AND status = 'PUBLISHED'" not in pub, '')
uns = TS.split('async unschedule(')[1][:2500] if 'async unschedule(' in TS else ''
ok('① 예정 취소 — 시행일 전 · 동의 0 · 법무 검토 · 시행일 없음 · 본문 날짜 → 〔시행일〕(상태 먼저) · PATCH unschedule · SUPER · 감사 TERM_UNSCHEDULE',
   "'TERM_NOT_SCHEDULED'" in uns and "'TERM_HAS_CONSENT'" in uns and "status = 'LEGAL_REVIEW', effective_from = 'infinity'" in uns
   and "replace(body, $3, '〔시행일〕')" in uns and uns.find("status = 'LEGAL_REVIEW'") < uns.find("replace(body, $3")
   and "@Patch('terms/:code/unschedule')" in TC and "@Audit('TERM_UNSCHEDULE', 'TERM')" in TC and "@Roles('SUPER')" in TC, '')
req = CS.split('async required()')[1][:1800] if 'async required()' in CS else ''
agr = CS.split('async agree(')[1][:2500] if 'async agree(' in CS else ''
ok('① 지금 판으로 읽기 — /terms/required · 동의 · 가입 · 파트너 · 맞춤형 광고 · 처리방침 판 · 관 점검이 v_terms_current',
   'FROM v_terms_current t' in req and 'FROM v_terms_current\n            WHERE code = $1' in agr
   and "FROM v_terms_current WHERE audience = 'ALL'" in AS and 'v_terms_current t WHERE t.audience' in rd('src/modules/partner/partner-admin.service.ts')
   and rd('src/modules/ads/ads.service.ts').count("FROM v_terms_current WHERE code = 'ADPERSONAL'") == 2
   and "FROM v_terms_current WHERE code = 'PRIVACY'" in ADS and "FROM v_terms_current WHERE code = 'PRIVACY'" in rd('src/modules/agent/agent.service.ts')
   and 'FROM v_terms_current WHERE (gwan_code' in rd('src/modules/admin/admin-v31.service.ts'), '')
ok('① 시행 예정 목록 GET /terms/upcoming(전체 회원 대상) · 매시간 작업이 보관 · 약관 설정은 SUPER(TERMS_SETTING_SUPER) · 목록 전에 보관 · scheduled 칸',
   "@Get('terms/upcoming')" in AC and 'FROM v_terms_upcoming u LEFT JOIN v_terms_current c' in AS and "WHERE u.audience = 'ALL'" in AS
   and 'SELECT fn_terms_archive_due() AS n' in SC and "key.startsWith('terms.')" in ADS and "'TERMS_SETTING_SUPER'" in ADS
   and 'await this.db.query(`SELECT fn_terms_archive_due()`)' in TS and 'FROM v_terms_upcoming u WHERE u.code = t.code' in TS, '')
NEW_TXT = ('시행 예정인 판({0})이 이미 있습니다 — 먼저 그 판의 「예정 취소」를 하십시오.', '시행 예정인 게시 판만 취소할 수 있습니다 — 이미 시행된 판은 새 판으로 바꾸십시오.',
           '이 판에 이미 동의한 기록이 {0}건 있어 취소할 수 없습니다 — 새 판으로 바꾸십시오.', '이미 게시된 판입니다 — 시행일을 바꾸려면 「예정 취소」 뒤 다시 게시하십시오.',
           '약관 설정은 최고 관리자(SUPER)만 바꿀 수 있습니다.')
ok('① 새 서버 문구 5개 영어 사전', all(json.dumps(x, ensure_ascii=False) + ':' in EN for x in NEW_TXT), '')

TP = rd('web/src/app/admin/TermsPanel.tsx'); MN = rd('web/src/lib/adminMenu.ts'); APP = rd('web/src/App.tsx')
ok('① 운영 화면 — 시행 예정 표시 · 예정 취소 · 제14조 경고(7일 · 30일) · 재동의 시점 스위치 · 결과 글 · 관 관리 › 약관 메뉴(SUPER · SB-ADM-SIT-070)',
   all(x in TP for x in ('data-term-scheduled', 'data-term-unschedule', '/unschedule`', 'lead < 7', 'lead < 30', '제14조', 'data-terms-reconsent', "key: 'terms.reconsent_before_effective'", 'r.scheduled'))
   and "['terms', '약관']" in MN and "'siteinfo', 'terms', 'i18n'" in MN and "terms:         { title: '약관'" in MN
   and "{tab === 'terms' && <TermsPanel />}" in APP and "'integ', 'terms']" in APP, '')
UT = rd('site/src/components/UpcomingTerms.tsx'); LY = rd('site/src/app/layout.tsx')
ko = json.loads(rd('site/src/i18n/messages/ko/policy.json') or '{}').get('upcoming', {}); en = json.loads(rd('site/src/i18n/messages/en/policy.json') or '{}').get('upcoming', {})
ok('① 사용자 웹 — 알림(/terms/upcoming · 60초) · 바닥줄 위 한 줄 · 약관 화면 · 동의 화면 · 사전 ko · en 같은 칸',
   "apiGet<Upcoming[]>('/terms/upcoming', 60)" in UT and 'data-upcoming-terms' in UT and 'data-upcoming-bar' in UT and 'id="upcoming-terms"' in UT
   and '<UpcomingTermsBar /><Footer' in LY and '<UpcomingTerms />' in rd('site/src/app/terms/agree/page.tsx') and 'top={<UpcomingTerms />}' in rd('site/src/app/terms/page.tsx')
   and '{top}' in rd('site/src/components/terms/TermsViewer.tsx') and ko and set(ko) == set(en), f'{sorted(ko)}')
SP = json.loads(rd('spec/screens.json') or '{}'); scr = {s['id']: s for s in SP.get('screens', [])}
D246 = next((rd('docs/' + f) for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('246_')), '')
ok('① 명세 — GET /terms/upcoming(약관 · 동의 화면) · PATCH unschedule(SIT-070) · docs/246 · 판 v10.161 이상',
   'GET /terms/upcoming' in scr.get('SB-HOM-ETC-020', {}).get('apis', []) and 'GET /terms/upcoming' in scr.get('SB-HOM-ETC-022', {}).get('apis', [])
   and 'PATCH /admin/terms/{code}/unschedule' in scr.get('SB-ADM-SIT-070', {}).get('apis', [])
   and all(x in D246 for x in ('D151', 'v_terms_current', '제14조', 'terms.reconsent_before_effective', '예정 취소', 'TERM_SCHEDULED_EXISTS'))
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 161), rd('VERSION').strip())


# ── ② API ─────────────────────────────────────────────────────────────
def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m)
    try:
        raw = urllib.request.urlopen(r, timeout=60).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b'{}')
        except Exception:
            body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip()


CODE = 'MARKETING'; NV = '9.7'; NV2 = '9.6'; SELLER = 'seller@x.com'
NOTE = '시험 — 제2조 수신 방법을 고침(T1161)'
st = lambda: psql(f"SELECT string_agg(version || ' ' || status, ' · ' ORDER BY version) FROM terms WHERE code = '{CODE}' AND version IN ('{v0}', '{NV}')")
cur = lambda: psql(f"SELECT version FROM v_terms_current WHERE code = '{CODE}'")
req_ver = lambda tok: next((x.get('version') for x in (call('GET', '/terms/required', t=tok) or []) if isinstance(x, dict) and x.get('code') == CODE), None)
ups = lambda: [u for u in (call('GET', '/terms/upcoming') or []) if isinstance(u, dict) and u.get('code') == CODE]
screen_ok = False
if API and DB:
    t0 = psql(f"SELECT version || '|' || effective_from::text FROM terms WHERE code = '{CODE}' AND status = 'PUBLISHED' ORDER BY effective_from DESC LIMIT 1")
    v0, e0 = (t0.split('|') + [''])[:2]
    sw0 = psql("SELECT value FROM site_settings WHERE key = 'terms.reconsent_before_effective'")
    print(f'  점검판 마케팅 약관: {t0 or "(게시 판 없음)"} · 스위치 {sw0}')
    if not v0:
        print('  (점검판에 마케팅 게시 판 없음 — ② 건너뜀)')
    else:
        T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
        psql(f"INSERT INTO account_roles(account_id, role) SELECT id, 'ADMIN' FROM accounts WHERE email = '{SELLER}' ON CONFLICT DO NOTHING;")
        TA = call('POST', '/auth/login', {'email': SELLER, 'password': PW}).get('accessToken')
        day = (datetime.date.today() + datetime.timedelta(days=10)).isoformat()
        try:
            title = psql(f"SELECT title FROM terms WHERE code = '{CODE}' AND version = '{v0}'")
            body = re.sub(r'〔(?!시행일)[^〕]*〕', '', psql(f"SELECT body FROM terms WHERE code = '{CODE}' AND version = '{v0}'")) + '\n\n부칙 이 판(시험 T1161)은 〔시행일〕부터 시행합니다.'
            r0 = call('PUT', f'/admin/terms/{CODE}', {'version': NV, 'title': title, 'body': body, 'changeNote': NOTE}, T_)
            r1 = call('PATCH', f'/admin/terms/{CODE}/publish', {'version': NV, 'effectiveFrom': day}, T_)
            u = ups()
            ok('② 9.7 을 10일 뒤 시행으로 게시 → scheduled · 앞 판 게시 그대로 · 지금 판은 앞 판 · /terms/required 는 앞 판 · /terms/upcoming 에 9.7(지금 판 · 바뀐 점 · 본문 날짜)',
               r0.get('status') == 'LEGAL_REVIEW' and r1.get('status') == 'PUBLISHED' and r1.get('scheduled') is True and st() == f'{v0} PUBLISHED · {NV} PUBLISHED'
               and cur() == v0 and req_ver(T_) == v0 and len(u) == 1 and u[0].get('version') == NV and u[0].get('currentVersion') == v0
               and u[0].get('changeNote') == NOTE and f'{day}부터' in (u[0].get('body') or ''), f'{str(r1)[:90]} · {st()} · 지금 {cur()} · {str(u)[:90]}')
            na = psql(f"SELECT count(*) FROM v_term_not_agreed WHERE code = '{CODE}'")
            ai = psql("SELECT public.fn_privacy_ai_ready()")
            ok('② 미동의 보기 · AI 조건은 지금 판 기준(마케팅은 선택 약관이라 미동의 0 · 함수 동작)', na == '0' and ai in ('t', 'f'), f'{na} · {ai}')

            r2 = call('PUT', f'/admin/terms/{CODE}', {'version': NV2, 'title': title, 'body': body}, T_)
            r3 = call('PATCH', f'/admin/terms/{CODE}/publish', {'version': NV2, 'effectiveFrom': day}, T_)
            r4 = call('PATCH', f'/admin/terms/{CODE}/publish', {'version': v0, 'effectiveFrom': day}, T_)
            ok('② 다른 판 게시 → 422 TERM_SCHEDULED_EXISTS · 게시된 앞 판 다시 게시 → 422 TERM_PUBLISHED(시행일 그대로)',
               r3.get('code') == 'TERM_SCHEDULED_EXISTS' and r4.get('code') == 'TERM_PUBLISHED'
               and psql(f"SELECT effective_from::text FROM terms WHERE code = '{CODE}' AND version = '{v0}'") == e0, f"{r2.get('status')} · {r3.get('code')} · {r4.get('code')}")
            psql(f"DELETE FROM terms WHERE code = '{CODE}' AND version = '{NV2}' AND status IN ('DRAFT', 'LEGAL_REVIEW')")

            ra = call('PATCH', f'/admin/terms/{CODE}/unschedule', {'version': NV}, TA)
            r5 = call('PATCH', f'/admin/terms/{CODE}/unschedule', {'version': NV}, T_)
            row = psql(f"SELECT status || '|' || (effective_from = 'infinity')::text || '|' || (body LIKE '%〔시행일〕부터%')::text || '|' || (body LIKE '%{day}%')::text FROM terms WHERE code = '{CODE}' AND version = '{NV}'")
            aud = psql("SELECT count(*) FROM audit.audit_logs WHERE action = 'TERM_UNSCHEDULE' AND occurred_at > now() - interval '5 minutes'")
            ok('② 예정 취소 — ADMIN 403 · SUPER → 법무 검토 · 시행일 없음 · 본문 날짜 → 〔시행일〕 · 앞 판 그대로 · upcoming 비움 · 감사 TERM_UNSCHEDULE',
               ra.get('_err') == 403 and r5.get('status') == 'LEGAL_REVIEW' and row == 'LEGAL_REVIEW|true|true|false' and cur() == v0 and not ups() and aud not in ('', '0'),
               f"{ra.get('_err')} · {str(r5)[:60]} · {row} · 감사 {aud}")
            r6 = call('PATCH', f'/admin/terms/{CODE}/unschedule', {'version': v0}, T_)
            ok('② 이미 시행 중인 판 취소 → 422 TERM_NOT_SCHEDULED', r6.get('code') == 'TERM_NOT_SCHEDULED', str(r6)[:90])

            r7 = call('PATCH', f'/admin/terms/{CODE}/publish', {'version': NV, 'effectiveFrom': day}, T_)
            psql(f"INSERT INTO term_agreements(account_id, term_code, term_version, agreed) SELECT id, '{CODE}', '{NV}', true FROM accounts WHERE email = '{SELLER}'")
            r8 = call('PATCH', f'/admin/terms/{CODE}/unschedule', {'version': NV}, T_)
            ok('② 다시 게시(예정) → 그 판 동의 기록이 있으면 취소 422 TERM_HAS_CONSENT', r7.get('scheduled') is True and r8.get('code') == 'TERM_HAS_CONSENT', f"{r7.get('scheduled')} · {r8.get('code')}")
            screen_ok = True

            # ③ 화면 — 시행 예정 상태에서
            if ADMIN_WEB or SITE:
                try:
                    from playwright.sync_api import sync_playwright
                except Exception:
                    sync_playwright = None
                if sync_playwright:
                    with sync_playwright() as p:
                        b_ = p.chromium.launch()
                        if ADMIN_WEB:
                            pg = b_.new_page(viewport={'width': 1400, 'height': 1000}); errs = []
                            pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                            pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                            pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(1500)
                            pg.goto(ADMIN_WEB + '/#/terms', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                            box = pg.locator('[data-terms-panel]'); rowl = box.locator(f'[data-term-row="{CODE}:{NV}"]')
                            sched = rowl.get_attribute('data-scheduled') if rowl.count() else None
                            ok('③ 운영 화면 관 관리 › 약관(#/terms) — 「약관」 부품 · 9.7 줄 「시행 예정」 · 「예정 취소」 단추 · 재동의 시점 「시행일부터」 · 오류 없음',
                               box.count() == 1 and sched == 'y' and rowl.locator('[data-term-scheduled]').count() == 1 and rowl.locator('[data-term-unschedule]').count() == 1
                               and box.locator('[data-terms-reconsent="effective"]').count() == 1 and not errs, f'{box.count()} · {sched} · {errs[:2]}')
                            box.scroll_into_view_if_needed(); pg.screenshot(path=os.path.join(HERE, 'v1161_admin_terms.png'), full_page=False)
                        if SITE:
                            pg = b_.new_page(viewport={'width': 1300, 'height': 1000}); seen = bar = 0
                            for i in range(10):   # 사용자 웹은 /terms/upcoming 을 60초 캐시 — 새 값이 나올 때까지 다시 엶
                                pg.goto(SITE + '/terms', wait_until='networkidle', timeout=120000)
                                seen = pg.locator(f'[data-upcoming-term="{CODE}"]').count(); bar = pg.locator('[data-upcoming-bar]').count()
                                if seen and bar: break
                                pg.wait_for_timeout(10000)
                            txt = pg.locator('[data-upcoming-terms]').inner_text() if seen else ''
                            ok('③ 사용자 웹 /terms — 「약관이 바뀝니다」 9.7 · 시행일 · 바닥줄 위 알림', seen == 1 and bar == 1 and NV in txt and day in txt, f'{seen} · {bar} · {txt[:100]!r}')
                            pg.locator('[data-upcoming-terms]').scroll_into_view_if_needed(); pg.screenshot(path=os.path.join(HERE, 'v1161_site_upcoming.png'), full_page=False)
                        b_.close()

            # 스위치 on → 바로 9.7(예전 방식) · ADMIN 403
            rs = call('PATCH', '/admin/site-settings', {'key': 'terms.reconsent_before_effective', 'value': 'on'}, TA)
            call('PATCH', '/admin/site-settings', {'key': 'terms.reconsent_before_effective', 'value': 'on'}, T_)
            on_cur, on_req, on_up = cur(), req_ver(T_), ups()
            call('PATCH', '/admin/site-settings', {'key': 'terms.reconsent_before_effective', 'value': 'off'}, T_)
            ok('② 스위치 on(법무 판단 뒤) → 지금 판 9.7 · /terms/required 9.7 · upcoming 비움 · off 로 되돌리면 앞 판 · ADMIN 은 403 TERMS_SETTING_SUPER',
               rs.get('code') == 'TERMS_SETTING_SUPER' and on_cur == NV and on_req == NV and not on_up and cur() == v0 and psql("SELECT value FROM site_settings WHERE key = 'terms.reconsent_before_effective'") == 'off',
               f"{rs.get('code')} · on {on_cur}/{on_req}/{len(on_up)} · off {cur()}")

            # 시행일이 온 것으로 → 매시간 작업과 같은 함수 → 앞 판 보관 · 지금 판 9.7
            psql(f"UPDATE terms SET effective_from = now() - interval '1 minute' WHERE code = '{CODE}' AND version = '{NV}'")
            n = psql("SELECT fn_terms_archive_due()")
            ok('② 시행일이 지나면 fn_terms_archive_due → 앞 판 보관 · 지금 판 9.7 · /terms/required 9.7', st() == f'{v0} ARCHIVED · {NV} PUBLISHED' and cur() == NV and req_ver(T_) == NV and n not in ('', '0'),
               f'{n} · {st()} · {cur()}')
        finally:
            psql(f"SET session_replication_role = replica; DELETE FROM term_agreements WHERE term_code = '{CODE}' AND term_version IN ('{NV}', '{NV2}'); "
                 f"DELETE FROM terms WHERE code = '{CODE}' AND version IN ('{NV}', '{NV2}'); "
                 f"UPDATE terms SET status = 'PUBLISHED', effective_from = '{e0}' WHERE code = '{CODE}' AND version = '{v0}'; "
                 f"UPDATE site_settings SET value = '{sw0 or 'off'}' WHERE key = 'terms.reconsent_before_effective';")
            psql(f"DELETE FROM account_roles WHERE role = 'ADMIN' AND account_id = (SELECT id FROM accounts WHERE email = '{SELLER}');")
        t1 = psql(f"SELECT version || '|' || effective_from::text FROM terms WHERE code = '{CODE}' AND status = 'PUBLISHED' ORDER BY effective_from DESC LIMIT 1")
        ok('끝 — 되돌림(9.7 · 9.6 · 그 동의 기록 없음 · 앞 판 다시 게시 · 같은 시행일 · 스위치 그대로)', t1 == t0 and cur() == v0
           and psql(f"SELECT count(*) FROM terms WHERE code = '{CODE}' AND version IN ('{NV}', '{NV2}')") == '0' and not ups(), f'{t0} → {t1}')
else:
    print('  (API · DB 없음 — ② · ③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
