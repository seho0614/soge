"""v10.690 ~ 694 (D320 · docs/801) 담당자 알림 · 페이지 공개 범위 · 검색엔진 설정 · 업종 CSV 내려받기 · 관별 주간 보고
  ① (코드) D320 · notifyManager · 회원만 403 · 검색 · 사이트 지도 뺌 · update 칸 · gwanWeeklyJob(owner_todo_weekly 가 부름) · check-acl gwan-pages · 화면 · 사용자 웹 · 영어
  ② (DB) 첫 화면 MEMBER 막힘 · 설명 161자 막힘 · 그림 주소 //x 막힘(되돌림)
  ③ (API) 회원만 → 손님 403 GWAN_PAGE_LOGIN · 로그인 200 · 사이트 검색에서 빠짐 · 첫 화면 MEMBER 422 · 검색엔진 칸 저장 → 공개 응답 · 사이트 지도에서 빠짐
       · 담당자 배정 문의 → GWAN_INQUIRY_ASSIGNED 한 줄 — 끝나면 지움 · 담당자 되돌림
  ④ 문서 801 · 판
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb' if os.path.isdir(KIT + '/sgb') else KIT
API = os.environ.get('API'); DB = os.environ.get('DB'); SITE = os.environ.get('SITE')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


def doc(prefix):
    d = os.path.join(K, 'docs')
    return next((open(os.path.join(d, x), encoding='utf-8').read() for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith(prefix)), '')


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=120).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()

# v10.705 (docs/813) 관이 열려 있으면 관 페이지를 만들거나 고칠 수 없음 → 고치는 부르기만 소개장터(MNY)를 잠깐 닫았다 다시 엶(이 시험은 늘 혼자 · reg_solo_force)
_call_open = call


def call(m_, p, b=None, t=None):
    if m_ != 'GET' and re.match(r'^/admin/(gwan-pages|gwans/MNY/pages|gwan-fragments/\d+/republish)', p):
        psql("UPDATE gwans SET is_active = false WHERE code = 'MNY'")
        try:
            return _call_open(m_, p, b, t)
        finally:
            psql("UPDATE gwans SET is_active = true WHERE code = 'MNY' AND NOT is_active")
    return _call_open(m_, p, b, t)



def login(e):
    return call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')


def _up():   # 서버 · DB 가 응답할 때만 ② · ③(미리 검사는 닿지 않는 주소로 돎)
    try:
        urllib.request.urlopen(API + '/health', timeout=5); api = True
    except Exception:
        api = False
    return api, bool(DB) and psql('SELECT 1') == '1'


API_UP, DB_UP = _up() if API and DB else (False, False)
VER = rd('VERSION').strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))

# ── ① 코드 ─────────────────────────────────────────────────────────────
M0 = rd('prisma/migrations/D320_gwan_page_visibility_seo/migration.sql')
GS, PS, SC = rd('src/modules/site/gwan-pages.service.ts'), rd('src/modules/public/public.service.ts'), rd('src/worker/scheduler.service.ts')
ok('① D320 · 서버 — 공개 범위(첫 화면 ALL 만) · 검색엔진 칸 · 설정 ops.gwan_weekly · 회원만 403 · 검색 · 사이트 지도 뺌 · 담당자 알림 · 주간 보고',
   'gwan_pages_visibility_check' in M0 and "(slug <> 'home' OR visibility = 'ALL')" in M0 and 'seo_description' in M0 and "'ops.gwan_weekly', 'on'" in M0
   and "Forbidden('GWAN_PAGE_LOGIN'" in GS and "p.visibility = 'ALL'   /* v10.691" in GS and "p.visibility = 'ALL' AND NOT p.noindex" in PS
   and 'private async notifyManager(' in PS and "'GWAN_INQUIRY_ASSIGNED'" in PS and 'gwanWeeklyJob(this.db, this.mail)' in SC and "'GWAN_WEEKLY'" in rd('src/modules/site/gwan-weekly.ts')
   and "'gwan-pages'," in rd('scripts/check-acl.js'), '')
GP, CA, SI, SG = rd('web/src/app/admin/gwans/GwanPages.tsx'), rd('web/src/app/admin/Categories.tsx'), rd('site/src/app/[gwan]/info/[slug]/page.tsx'), rd('site/src/app/[gwan]/page.tsx')
ok('① 화면 — 공개 범위 · 검색엔진 상자 · 업종 CSV 내려받기(넣기와 같은 앞 세 칸) · 회원만 로그인 안내 · 직접 쓴 설명 · 그림 · noindex',
   'function PageMeta(' in GP and 'data-gwan-page-visibility' in GP and 'data-gwan-page-noindex' in GP and 'function CsvExport(' in CA
   and "'업종 이름,업종 코드,직업안정법," in CA and 'data-gwan-page-login' in SI and 'r.page.seoDescription ||' in SI and 'home?.seoImage ||' in SG and 'home?.noindex' in SG, '')
ok('① 영어 2', all(k in rd('src/common/i18n/server-text.en.ts') for k in ('첫 화면은 누구나 보게만 둘 수 있습니다.', '회원만 볼 수 있는 페이지입니다 — 로그인하십시오.')), '')

# ── ② DB ───────────────────────────────────────────────────────────────
if DB and DB_UP:
    d0 = psql("BEGIN; INSERT INTO gwan_pages (gwan_code, slug, title, seo_description) VALUES ('MNY', 'zz-v1', 'x', repeat('가', 161)); ROLLBACK;")
    d2 = psql("BEGIN; INSERT INTO gwan_pages (gwan_code, slug, title, seo_image) VALUES ('MNY', 'zz-v2', 'x', '//evil.example'); ROLLBACK;")
    d3 = psql("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'gwan_pages_visibility_check'")
    ok('② DB — 첫 화면 MEMBER 막힘(CHECK) · 설명 161자 · 그림 //주소 막힘', "slug <> 'home'" in d3 and 'gwan_pages_seo_check' in d0 and 'gwan_pages_seo_check' in d2, f'{d3[:60]} | {d0[-40:]} | {d2[-40:]}')

# ── ③ API ──────────────────────────────────────────────────────────────
if API and DB and API_UP and DB_UP:
    stamp = time.strftime('%H%M%S')
    slug, word = f'zv{stamp}', f'비밀안내{stamp}'
    was = psql("SELECT coalesce(string_agg(account_id::text, ',' ORDER BY sort_order), '') FROM gwan_managers WHERE gwan_code = 'MNY'")
    iq = None
    try:
        import consent_ok
        consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
        TS_, TB = login('admin@x.com'), login('buyer@x.com')
        pg = call('POST', '/admin/gwans/MNY/pages', {'slug': slug, 'title': f'회원 안내 {stamp}'}, TS_); pid = pg.get('id')
        call('PATCH', f'/admin/gwan-pages/{pid}', {'blocks': [{'type': 'TEXT', 'body': f'{word} 회원만 봅니다'}]}, TS_)
        call('POST', f'/admin/gwan-pages/{pid}/publish', None, TS_)
        v1 = call('PATCH', f'/admin/gwan-pages/{pid}', {'visibility': 'MEMBER', 'seoDescription': '직접 쓴 설명', 'seoImage': '/site/page-images/x', 'noindex': True}, TS_)
        g0 = call('GET', f'/gwans/MNY/pages/{slug}')
        g1 = call('GET', f'/gwans/MNY/pages/{slug}', None, TB)
        sr = call('GET', '/gwan-pages/search?' + urllib.parse.urlencode({'q': word}))
        sm = call('GET', '/site/sitemap-entries')
        ok('③ 회원만 — 손님 403 GWAN_PAGE_LOGIN · 회원 200(설명 · 그림 · 끔 칸) · 검색 · 사이트 지도에서 빠짐',
           v1.get('visibility') == 'MEMBER' and g0.get('code') == 'GWAN_PAGE_LOGIN' and g1.get('seoDescription') == '직접 쓴 설명' and g1.get('noindex') is True
           and isinstance(sr, list) and not any(x.get('slug') == slug for x in sr) and not any(x.get('slug') == slug for x in (sm.get('pages') or [])),
           f"{v1.get('visibility')} · {g0.get('code')} · {g1.get('seoDescription')} · {len(sr) if isinstance(sr, list) else sr}")
        hm = psql("SELECT id FROM gwan_pages WHERE slug = 'home' LIMIT 1")
        if hm:
            h1 = call('PATCH', f'/admin/gwan-pages/{hm}', {'visibility': 'MEMBER'}, TS_)
            ok('③ 첫 화면 MEMBER 422 GWAN_PAGE_VISIBILITY', h1.get('code') == 'GWAN_PAGE_VISIBILITY', str(h1.get('code')))
        aid = psql("SELECT id FROM accounts WHERE email = 'admin@x.com'")
        call('PUT', '/admin/gwans/MNY/managers', {'accountIds': [aid]}, TS_)
        q = call('POST', '/inquiries', {'category': 'HOWTO', 'title': f'담당 알림 {stamp}', 'body': '관 페이지에서 왔습니다', 'email': f't1690{stamp}@x.com', 'sourceGwan': 'MNY', 'sourcePage': slug})
        iq = q.get('id')
        n = '0'
        for _ in range(10):
            n = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'GWAN_INQUIRY_ASSIGNED' AND detail->>'inquiryId' = '{iq}'")
            if n == '1': break
            time.sleep(1)
        ok('③ 담당자 배정 문의 → GWAN_INQUIRY_ASSIGNED 한 줄(본문 · 연락처 없음)', n == '1'
           and psql(f"SELECT (title NOT LIKE '%t1690%')::text FROM ops_alerts WHERE alert_code = 'GWAN_INQUIRY_ASSIGNED' AND detail->>'inquiryId' = '{iq}'") == 'true', n)
    finally:
        psql(f"SET session_replication_role = replica; DELETE FROM gwan_page_versions WHERE page_id IN (SELECT id FROM gwan_pages WHERE slug = '{slug}'); DELETE FROM gwan_pages WHERE slug = '{slug}';")
        psql(f"DELETE FROM ops_alerts WHERE (alert_code = 'GWAN_INQUIRY_ASSIGNED' AND detail->>'inquiryId' = '{iq or ''}') OR (alert_code LIKE 'GWAN_PAGE_%' AND detail->>'slug' = '{slug}')")
        psql(f"DELETE FROM inquiries WHERE email = 't1690{stamp}@x.com'")
        psql("DELETE FROM gwan_managers WHERE gwan_code = 'MNY'")
        if was:
            for i, a in enumerate(was.split(',')):
                psql(f"INSERT INTO gwan_managers (gwan_code, account_id, sort_order) VALUES ('MNY', '{a}', {i}) ON CONFLICT DO NOTHING")
        ok('③ 끝 — 페이지 · 문의 · 알림 지움 · 담당자 되돌림', psql(f"SELECT (SELECT count(*) FROM gwan_pages WHERE slug = '{slug}') + (SELECT count(*) FROM inquiries WHERE email = 't1690{stamp}@x.com')") == '0'
           and psql("SELECT coalesce(string_agg(account_id::text, ',' ORDER BY sort_order), '') FROM gwan_managers WHERE gwan_code = 'MNY'") == was, '')
else:
    print('API · DB 없음 — ③ 건너뜀')

# ── ④ 문서 · 판 ─────────────────────────────────────────────────────────
d801 = doc('801_')
ok('④ 문서 801 — 담당자 알림 · 공개 범위 · 검색엔진 · CSV 내려받기 · 주간 보고 · D320',
   all(w in d801 for w in ('GWAN_INQUIRY_ASSIGNED', '공개 범위', '검색엔진에 안 나오게', 'CSV 로 내려받기', 'GWAN_WEEKLY', 'D320')), str(len(d801)))
ok('④ VERSION v10.690 이상', VT >= (10, 690), VER)

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
