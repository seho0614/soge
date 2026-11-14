"""v10.279 (D210 · docs/408) — 공지 열람 등급 · 관리자 공지

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 SITE=http://localhost:15174 python3 test_v1279.py

  ① (코드) D210(등급 표 7 · 공지 등급 칸 · 기존 공지 PUBLIC · 요율 공지 SELLER · 판단 함수) · API(공개 공지 등급 거름 · 관리자 공지 빼기 · 등록 등급 필수 ·
     쓰지 않는 등급 · 초안 게시 · 등급 관리 · 관리자 공지) · 화면(등급 고르기 · 등급 관리 · 초안 「게시」 · 첫 화면 관리자 공지 · 고객센터 공지사항 한 · 영) · 명세 · 문서 408 · 마이그레이션 248 · 판 v10.279
  ② (DB) fn_notice_grades — 로그인 안 함 PUBLIC 만 · 회원 MEMBER · 관리자 STAFF · 판매자 SELLER · 등급 칸 검사(빈 · 모르는 등급 막힘)
  ③ (API) 관리자 공지(STAFF)는 운영 화면 「관리자 공지」에만(공개 공지에는 관리자 계정으로 봐도 없음) · 회원 공지는 로그인 회원만 · 판매자 공지는 판매자만 ·
     등급 없이 등록 400 · 쓰지 않는 등급 422 · 초안 → 「게시」 → 보임 · 두 번째 409 · 등급 이름 바꾸기 · 회원 403
  ④ (화면) 운영 화면 노출 › 메인 운영 › 「콘텐츠」 등급 고르기 · 등급 관리 표 · 첫 화면 「관리자 공지」 · 사용자 웹 고객센터 › 공지사항(로그인 안 함 — 전체 공개만)
  만든 공지 · 판매자는 지우고 등급은 처음대로(두 번 돌아도 통과).
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB, SITE = os.environ.get('ADMIN_WEB'), os.environ.get('SITE')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


VER = rd('VERSION').strip()
M10 = rd('prisma/migrations/D210_notice_grades/migration.sql')
PS, SS, SC, SD = rd('src/modules/public/public.service.ts'), rd('src/modules/site/site.service.ts'), rd('src/modules/site/site.controller.ts'), rd('src/modules/site/site.dto.ts')
RS, HS = rd('src/modules/health/health-rate-schedule.service.ts'), rd('src/modules/health/health-seller.service.ts')
MO, DA, SN = rd('web/src/app/admin/MainOps.tsx'), rd('web/src/app/admin/Dashboard.tsx'), rd('web/src/app/admin/StaffNotices.tsx')
SP, SNW = rd('site/src/app/support/notices/page.tsx'), rd('site/src/app/support/new/page.tsx')
PN = rd('site/src/app/partners/notices/page.tsx') + rd('site/src/app/partner/notices/page.tsx') + rd('site/src/app/partners/page.tsx')
SCR = rd('spec/screens.json')
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []
D408 = next((open(os.path.join(K, 'docs', x), encoding='utf-8').read() for x in docs if x.startswith('408_')), '')
mig = [d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isfile(os.path.join(K, 'prisma/migrations', d, 'migration.sql'))] if os.path.isdir(os.path.join(K, 'prisma/migrations')) else []
BAD = re.compile(r'\b(DELETE FROM|DROP TABLE|DROP FUNCTION|TRUNCATE)\b')


def msgs(lang):
    try:
        return json.load(open(os.path.join(K, f'site/src/i18n/messages/{lang}/deal.json'), encoding='utf-8'))
    except Exception:
        return {}


MK, ME = msgs('ko'), msgs('en')
NK = ('ntcTitle', 'ntcLead', 'ntcLogin', 'ntcEmpty', 'ntcFail', 'ntcPinned', 'ntcGo')

ok('① D210 — 등급 표 7(코드 · 규칙 고정) · 공지 등급 칸(하나 이상 · 아는 등급만 · 기본 PUBLIC) · 요율 공지 SELLER · fn_notice_grades · 지우는 문장 없음',
   'CREATE TABLE IF NOT EXISTS public.notice_grades' in M10 and all(f"('{c}'," in M10 for c in ('PUBLIC', 'MEMBER', 'BIZ', 'MAL_PARTNER', 'AFF_PARTNER', 'SELLER', 'STAFF'))
   and "grades text[] NOT NULL DEFAULT ARRAY['PUBLIC']::text[]" in M10 and 'cardinality(grades) >= 1' in M10 and "SET grades = ARRAY['SELLER']::text[]" in M10
   and 'FUNCTION public.fn_notice_grades(p_account uuid)' in M10 and not BAD.search(M10), '')
ok('① API — 공개 공지는 보는 사람 등급(관리자 등급 뺌) · 등록 등급 필수 · 쓰지 않는 등급 422 · 초안 게시 · 등급 관리(이름 · 순서 · 사용) · 관리자 공지(운영 역할) · 요율 공지 SELLER · 판매자센터',
   "grades && array_remove(fn_notice_grades($2::uuid), 'STAFF')" in PS and "'GRADE_REQUIRED'" in SS and "'GRADE_INACTIVE'" in SS and 'async publishNotice(' in SS
   and "@Post('notices/:id/publish')" in SC and "@Get('notice-grades')" in SC and "@Patch('notice-grades/:code')" in SC and "@Get('staff-notices')" in SC
   and "@Roles('REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER', 'PARTNER_MAL', 'PARTNER_AFF')" in SC and '@ArrayMinSize(1)' in SD
   and "ARRAY['SELLER']" in RS and "grades && array_remove(fn_notice_grades($1::uuid), 'STAFF')" in HS, '')
ok('① 화면 — 등급 고르기 · 등급 관리 · 초안 「게시」 · 첫 화면 관리자 공지 · 고객센터 공지사항(한 · 영 · 캐시 안 함) · 파트너센터 공지 보는 사람 기준 · 명세 · 문서 408 · 마이그레이션 248 · 판 v10.279',
   'data-grade-pick=' in MO and 'data-notice-grades-admin=' in MO and 'data-notice-publish=' in MO and '<StaffNotices />' in DA and "'/admin/staff-notices'" in SN
   and "apiGetPersonal<Notice[]>('/notices')" in SP and 'data-support-notices-link' in SNW and PN.count("apiGetPersonal<Notice[]>('/notices')") == 3 and "apiGet<Notice[]>('/notices'" not in PN
   and all((MK.get('support') or {}).get(k) and (ME.get('support') or {}).get(k) for k in NK) and (MK.get('meta') or {}).get('notices') and (ME.get('meta') or {}).get('notices')
   and '"id": "SB-HOM-NTC-010"' in SCR and all(f'"{a}"' in SCR for a in ('POST /admin/notices/{id}/publish', 'GET /admin/notice-grades', 'PATCH /admin/notice-grades/{code}', 'GET /admin/staff-notices'))
   and bool(D408) and len(mig) in (248, 249, 250, 251, 252, 253) and tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 279), f'{len(mig)} · {VER} · 408 {bool(D408)}')


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        raw = urllib.request.urlopen(r, timeout=120).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()


stamp = str(int(time.time()))[-7:]
SEL = f't1279sel{stamp}@x.com'
TAG = f'시험 1279 {stamp}'
ids = lambda rows: [x.get('id') for x in (rows if isinstance(rows, list) else [])]
if API and DB:
    import consent_ok
    psql("DELETE FROM notices WHERE title LIKE '시험 1279 %'")
    psql("UPDATE notice_grades SET is_active = true, name = CASE code WHEN 'BIZ' THEN '사업자 회원' ELSE name END")
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{SEL}', '시험1279', '{pw}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{SEL}'")
    consent_ok.agree(SEL, PW); consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    login = lambda e: call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')
    TS, TB, TL = login('admin@x.com'), login('buyer@x.com'), login(SEL)
    sid_ = ''
    try:
        sid_ = psql(f"INSERT INTO hlt_sellers (code, account_id, type, name, personal, ceo_name, cs_tel, return_addr, status, applied_at, submerchant_id) "
                    f"VALUES ('TN-G{stamp}', '{aid}', 'TENANT', '시험 가게 1279', true, '홍길동', '02-000-0000', '서울 강남구 테헤란로 1', 'ACTIVE', now(), 'SUB-T1279') RETURNING id").splitlines()[0]
        g = lambda who: psql(f"SELECT array_to_string(fn_notice_grades({who}), ',')")
        gn, gb, ga, gs = g('NULL'), g("(SELECT id FROM accounts WHERE email = 'buyer@x.com')"), g("(SELECT id FROM accounts WHERE email = 'admin@x.com')"), g(f"'{aid}'")
        c1 = psql("BEGIN; INSERT INTO notices (title, body, grades) VALUES ('시험 1279 x', 'x', ARRAY[]::text[]); ROLLBACK;")
        c2 = psql("BEGIN; INSERT INTO notices (title, body, grades) VALUES ('시험 1279 x', 'x', ARRAY['VIP']); ROLLBACK;")
        ok('② DB — 로그인 안 함 PUBLIC 만 · 회원 MEMBER(관리자 아님) · 관리자 STAFF · 판매자 SELLER · 빈 등급 · 모르는 등급 막힘',
           gn == 'PUBLIC' and 'MEMBER' in gb.split(',') and 'STAFF' not in gb.split(',') and 'STAFF' in ga.split(',') and 'SELLER' in gs.split(',')
           and 'ck_notices_grades' in c1 and 'ck_notices_grades' in c2, f'{gn} · {gb} · {ga} · {gs}')

        now = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() - 60))
        mk = lambda title, grades, pub=True: call('POST', '/admin/notices', {'title': f'{TAG} {title}', 'body': f'{title} 본문', 'grades': grades, **({'publishedAt': now} if pub else {})}, TS)
        nS, nM, nL, nP, nD = mk('관리자', ['STAFF']), mk('회원', ['MEMBER']), mk('판매자', ['SELLER']), mk('전체', ['PUBLIC']), mk('초안', ['PUBLIC'], False)
        e0 = call('POST', '/admin/notices', {'title': f'{TAG} 등급없음', 'body': 'x'}, TS)
        anon, buyer, seller, admin = ids(call('GET', '/notices')), ids(call('GET', '/notices', None, TB)), ids(call('GET', '/notices', None, TL)), ids(call('GET', '/notices', None, TS))
        staff, staffB = ids(call('GET', '/admin/staff-notices', None, TS)), call('GET', '/admin/staff-notices', None, TB)
        ok('③ 등급별 열람 — 관리자 공지는 운영 화면 「관리자 공지」에만(공개 공지에는 관리자로 봐도 없음 · 회원 403) · 회원 공지 로그인만 · 판매자 공지 판매자만 · 전체 공개는 모두 · 초안은 안 보임 · 등급 없이 등록 400',
           all(x.get('id') for x in (nS, nM, nL, nP, nD)) and nS.get('id') in staff and staffB.get('_err') == 403
           and nS.get('id') not in anon + buyer + seller + admin and nM.get('id') in buyer and nM.get('id') not in anon
           and nL.get('id') in seller and nL.get('id') not in buyer + anon and all(nP.get('id') in x for x in (anon, buyer, seller, admin))
           and nD.get('id') not in anon and e0.get('_err') == 400,
           f"anon {len(anon)} · 관리자공지 {nS.get('id') in staff} · {e0.get('_err')}")
        p1 = call('POST', f"/admin/notices/{nD.get('id')}/publish", None, TS)
        p2 = call('POST', f"/admin/notices/{nD.get('id')}/publish", None, TS)
        ok('③ 초안 「게시」 — 게시하면 보임 · 두 번째 409 NOTICE_PUBLISHED',
           p1.get('ok') is True and nD.get('id') in ids(call('GET', '/notices')) and p2.get('_err') == 409 and p2.get('code') == 'NOTICE_PUBLISHED', f"{p1} · {p2.get('code')}")

        gl = call('GET', '/admin/notice-grades', None, TS)
        off = call('PATCH', '/admin/notice-grades/BIZ', {'isActive': False}, TS)
        e1 = mk('쓰지않음', ['BIZ'])
        ren = call('PATCH', '/admin/notice-grades/BIZ', {'isActive': True, 'name': '사업자'}, TS)
        bname = next((x.get('name') for x in (ren if isinstance(ren, list) else []) if x.get('code') == 'BIZ'), None)
        back = call('PATCH', '/admin/notice-grades/BIZ', {'name': '사업자 회원'}, TS)
        ok('③ 등급 관리 — 7개(코드 · 규칙) · 끄면 새 공지에 422 GRADE_INACTIVE · 다시 켜기 · 이름 바꾸기 · 바꿀 것 없음 422 · 회원 403 · 모르는 등급 404',
           isinstance(gl, list) and len(gl) == 7 and all(x.get('rule') for x in gl) and isinstance(off, list) and e1.get('_err') == 422 and e1.get('code') == 'GRADE_INACTIVE'
           and bname == '사업자' and isinstance(back, list) and call('PATCH', '/admin/notice-grades/BIZ', {}, TS).get('_err') == 422
           and call('GET', '/admin/notice-grades', None, TB).get('_err') == 403 and call('PATCH', '/admin/notice-grades/VIP', {'name': 'x'}, TS).get('_err') == 404,
           f"{len(gl) if isinstance(gl, list) else gl} · {e1.get('code')} · {bname}")

        try:
            from playwright.sync_api import sync_playwright
        except Exception:
            sync_playwright = None
        if sync_playwright and (ADMIN_WEB or SITE):
            seen, perr = {}, []
            try:
                with sync_playwright() as p:
                    b = p.chromium.launch()
                    if ADMIN_WEB:
                        pg = b.new_page(viewport={'width': 1500, 'height': 1000}); pg.on('pageerror', lambda e: perr.append(str(e)[:120])); pg.on('dialog', lambda d: d.dismiss())
                        pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                        pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                        pg.wait_for_selector('[data-state-check]', timeout=30000)
                        seen['staff'] = pg.locator(f'[data-staff-notice="{nS.get("id")}"]').count()
                        pg.goto(ADMIN_WEB + '/#/mainops/content', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                        seen['pick'] = pg.locator('[data-grade-pick]').count()
                        seen['admin'] = pg.locator('[data-notice-grades-admin]').first.get_attribute('data-notice-grades-admin') if pg.locator('[data-notice-grades-admin]').count() else None
                        seen['rowg'] = pg.locator(f'[data-notice-row="{nL.get("id")}"] [data-notice-grades]').first.get_attribute('data-notice-grades') if pg.locator(f'[data-notice-row="{nL.get("id")}"]').count() else None
                        pg.screenshot(path=os.path.join(HERE, 'v1279_content.png'), full_page=True)
                    if SITE:
                        ps = b.new_page(viewport={'width': 1200, 'height': 900}); ps.on('pageerror', lambda e: perr.append(str(e)[:120]))
                        ps.goto(SITE + '/support/notices', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1500)
                        seen['siteP'] = ps.locator(f'[data-site-notice="{nP.get("id")}"]').count()
                        seen['siteM'] = ps.locator(f'[data-site-notice="{nM.get("id")}"]').count()
                        seen['siteS'] = ps.locator(f'[data-site-notice="{nS.get("id")}"]').count()
                        seen['login'] = ps.locator('[data-notice-login]').count()
                    b.close()
            except Exception as ex:
                perr.append(str(ex)[:160])
            ok('④ 화면 — 운영 첫 화면 「관리자 공지」 · 노출 › 메인 운영 › 「콘텐츠」 등급 고르기 · 등급 관리 표 7 · 목록 등급 칸 · 사용자 웹 고객센터 › 공지사항(로그인 안 함 — 전체 공개만 · 회원 · 관리자 공지 없음 · 로그인 안내) · 화면 오류 없음',
               (not ADMIN_WEB or (seen.get('staff') == 1 and (seen.get('pick') or 0) >= 6 and seen.get('admin') == '7' and seen.get('rowg') == 'SELLER'))
               and (not SITE or (seen.get('siteP') == 1 and seen.get('siteM') == 0 and seen.get('siteS') == 0 and seen.get('login') == 1)) and not perr,
               f'{seen} · {perr[:2]}')
        else:
            print('  (화면 · playwright 없음 — ④ 건너뜀)')
    finally:
        psql("DELETE FROM notices WHERE title LIKE '시험 1279 %'")
        psql("UPDATE notice_grades SET is_active = true, name = CASE code WHEN 'BIZ' THEN '사업자 회원' ELSE name END")
        if sid_:
            psql(f"DELETE FROM hlt_sellers WHERE id = '{sid_}'")
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
