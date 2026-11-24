"""v10.656 ~ 659 (D313 · docs/794) 관 페이지 후속 — 표 블록 · 언어판 · 사이트맵 · 검색엔진 정보 · 안 쓰는 그림 정리
  ① (코드) 서버 TABLE 검사 · 운영 화면 표 편집(붙여 넣기) · 사용자 웹 표 · HTML 표 ↔ 표 블록 · D313 · 언어판 · 화면 언어 판 · sitemap · 메타 · 안 쓰는 그림 · 영어 · screens.json
  ② (DB) 한국어판 없이 언어판 → GWAN_PAGE_LANG_KO · 같은 주소 다른 언어 됨(되돌림) · 고유 조건 (관 · 주소 · 언어)
  ③ (API) 시험 페이지(소개장터) — 표 저장 · 칸 9개 422 · 영어판 만들기(한국어판 초안 복사) · 게시 → X-Lang en 이면 영어판 · 없으면 한국어판 · 안 쓰는 그림 200 · ADMIN 정리 403 · sitemap-entries pages · gwans — 끝나면 지움
  ④ 문서 794 · 판
  (두 번 돌아도 통과 — 주소에 시각을 붙임)
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.request
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


VER = rd('VERSION').strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))

def callx(m_, p, b=None, t=None, lang=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    if lang:
        hd['X-Lang'] = lang
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


VER = rd('VERSION').strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))
MG = rd('prisma/migrations/D313_gwan_page_lang/migration.sql')
SV, CT = rd('src/modules/site/gwan-pages.service.ts'), rd('src/modules/site/gwan-pages.controller.ts')
GP, PH, BL = rd('web/src/app/admin/gwans/GwanPages.tsx'), rd('web/src/app/admin/gwans/pageHtml.ts'), rd('site/src/components/gwan/GwanBlocks.tsx')
SM, IP, PS = rd('site/src/app/sitemap.ts'), rd('site/src/app/[gwan]/info/[slug]/page.tsx'), rd('src/modules/public/public.service.ts')
EN, SJ = rd('src/common/i18n/server-text.en.ts'), rd('spec/screens.json')

ok('① 표 블록(v10.656) — 서버 칸 8 · 줄 50 · 편집(붙여 넣기) · 사용자 웹 표 · HTML 표 ↔ 표 블록',
   "case 'TABLE':" in SV and '표의 칸(열)은 1 ~ 8개' in SV and 'function TableForm' in GP and 'data-gwan-page-table-paste' in GP
   and "case 'TABLE':" in BL and "data-block=\"TABLE\"" in PH and "tag === 'table' || kind === 'TABLE'" in PH and '표(table) — 글로 옮겨 적으십시오' not in PH, '')
ok('① 언어판(v10.657) — D313 lang · 고유 (관 · 주소 · 언어) · 한국어판 먼저 · 복사해 시작 · 화면 언어 판 · 번역판 만들기',
   'ADD COLUMN IF NOT EXISTS lang' in MG and 'gwan_pages_slug_lang_uniq' in MG and 'GWAN_PAGE_LANG_KO' in MG
   and not re.search(r'\b(DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN)\b', MG, re.I) and not re.search(r"RAISE EXCEPTION\s+'[^']*%", MG)
   and "SELECT draft, show_in_menu, sort_order FROM gwan_pages WHERE gwan_code = $1 AND slug = $2 AND lang = 'ko'" in SV and 'ORDER BY (p.lang = $3) DESC LIMIT 1' in SV
   and 'data-gwan-page-translate' in GP, '')
ok('① 사이트맵 · 검색엔진 정보(v10.658) · 안 쓰는 그림(v10.659)',
   'e.pages ?? []' in SM and '/info/${p.slug}' in SM and 'e.gwans ?? []' in SM and 'canonical' in IP and 'openGraph' in IP and "p.lang = 'ko' AND p.slug <> 'home'" in PS
   and 'async unusedImages' in SV and 'async purgeImages' in SV and "@Post('admin/gwan-pages/images/purge')\n  @HttpCode(200)\n  @ApiBearerAuth() @Roles('SUPER')" in CT
   and 'function UnusedImages' in GP and 'data-gwan-page-purge' in GP, '')
ok('① 영어 · screens.json', '"한국어판을 먼저 만드십시오 — 언어판은 한국어판을 복사해 번역합니다."' in EN and 'GET /admin/gwan-pages/images/unused' in SJ, '')

if API and DB:
    l1 = psql("BEGIN; INSERT INTO gwan_pages (gwan_code, slug, title, lang) VALUES ('MNY', 'zz-lang-x', 'x', 'en'); ROLLBACK;")
    l2 = psql("BEGIN; INSERT INTO gwan_pages (gwan_code, slug, title) VALUES ('MNY', 'zz-lang-y', 'x'); INSERT INTO gwan_pages (gwan_code, slug, title, lang) VALUES ('MNY', 'zz-lang-y', 'y', 'en') RETURNING lang; ROLLBACK;")
    uq = psql("SELECT count(*) FROM pg_constraint WHERE conname = 'gwan_pages_slug_lang_uniq'") + '|' + psql("SELECT count(*) FROM pg_constraint WHERE conname = 'gwan_pages_slug_uniq'")
    ok('② DB — 한국어판 없이 언어판 GWAN_PAGE_LANG_KO · 한국어판 있으면 됨 · 고유 조건 바뀜', 'GWAN_PAGE_LANG_KO' in l1 and '\nen' in ('\n' + l2) and uq == '1|0', f"{(re.search(r'GWAN_PAGE_[A-Z_]+', l1) or [l1[-30:]])[0]} · {l2[-20:]!r} · {uq}")

    stamp = str(int(time.time()))[-6:]
    slug, em = f'zl{stamp}', f't1656a{stamp}@x.com'
    en_on = psql("SELECT count(*) FROM i18n_langs WHERE code = 'en'") == '1'
    try:
        h = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
        psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{em}', '시험1656', '{h}', now()) ON CONFLICT DO NOTHING")
        aid = psql(f"SELECT id FROM accounts WHERE email = '{em}'")
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 1656', true); INSERT INTO account_roles (account_id, role) VALUES ('{aid}', 'ADMIN') ON CONFLICT DO NOTHING; COMMIT;")
        import consent_ok
        consent_ok.agree(em, PW); consent_ok.agree('admin@x.com', PW)
        TA, TS_ = login(em), login('admin@x.com')
        ko = call('POST', '/admin/gwans/MNY/pages', {'slug': slug, 'title': '시험 표'}, TA)
        pid = ko.get('id')
        t1 = call('PATCH', f'/admin/gwan-pages/{pid}', {'blocks': [{'type': 'TABLE', 'head': ['항목', '값'], 'rows': [['가', '1'], ['나', '2']], 'caption': '단위 원'}]}, TA)
        t2 = call('PATCH', f'/admin/gwan-pages/{pid}', {'blocks': [{'type': 'TABLE', 'head': [str(i) for i in range(9)], 'rows': [['x'] * 9]}]}, TA)
        ok('③ 표 — 저장(2줄 · 아래 글) · 칸 9개 422', len(t1.get('blocks', [{}])[0].get('rows', [])) == 2 and t2.get('_err') == 422, f"{len(t1.get('blocks', [{}])[0].get('rows', []))} · {t2.get('_err')}")
        call('POST', f'/admin/gwan-pages/{pid}/publish', None, TS_)
        if en_on:
            en = call('POST', '/admin/gwans/MNY/pages', {'slug': slug, 'title': 'Test table', 'lang': 'en'}, TA)
            eid = en.get('id')
            call('PATCH', f'/admin/gwan-pages/{eid}', {'blocks': [{'type': 'TEXT', 'body': 'English page'}]}, TA)
            p0 = callx('GET', f'/gwans/MNY/pages/{slug}', lang='en')
            call('POST', f'/admin/gwan-pages/{eid}/publish', None, TS_)
            p1 = callx('GET', f'/gwans/MNY/pages/{slug}', lang='en')
            p2 = callx('GET', f'/gwans/MNY/pages/{slug}')
            ok('③ 언어판 — 한국어판 초안 복사로 시작 · 영어판 게시 전엔 한국어판 · 게시 뒤 X-Lang en 이면 영어판 · 한국어 화면은 한국어판',
               en.get('lang') == 'en' and en.get('blocks', [{}])[0].get('type') == 'TABLE' and p0.get('lang') == 'ko' and p1.get('lang') == 'en' and p1.get('title') == 'Test table' and p2.get('lang') == 'ko',
               f"{en.get('lang')} {en.get('blocks', [{}])[0].get('type')} · {p0.get('lang')} → {p1.get('lang')} · {p2.get('lang')}")
        un = call('GET', '/admin/gwan-pages/images/unused?days=30', None, TA)
        pg = call('POST', '/admin/gwan-pages/images/purge', {'ids': []}, TA)
        sm = call('GET', '/site/sitemap-entries')
        ok('③ 안 쓰는 그림 200 · ADMIN 정리 403 · sitemap-entries pages(시험 페이지 있음) · gwans',
           'count' in un and pg.get('_err') == 403 and any(x.get('slug') == slug for x in sm.get('pages', [])) and isinstance(sm.get('gwans'), list),
           f"{un.get('count')} · {pg.get('_err')} · {len(sm.get('pages', []))} · {len(sm.get('gwans', []) or [])}")
    finally:
        psql(f"SET session_replication_role = replica; DELETE FROM gwan_page_versions WHERE page_id IN (SELECT id FROM gwan_pages WHERE slug = '{slug}'); DELETE FROM gwan_pages WHERE slug = '{slug}';")
        from qa_helpers import drop_accounts_sql
        psql(drop_accounts_sql(f"email = '{em}'"))
    left = psql(f"SELECT (SELECT count(*) FROM gwan_pages WHERE slug = '{slug}') + (SELECT count(*) FROM accounts WHERE email = '{em}')")
    ok('③ 끝 — 시험 페이지 · 계정 지움', left == '0', left)
else:
    print('API · DB 없음 — ② · ③ 건너뜀')

d794 = doc('794_')
ok('④ 문서 794 — 표 · 언어판 · 사이트맵 · 안 쓰는 그림 · D313', all(w in d794 for w in ('표 블록', '언어판', 'sitemap', '안 쓰는 그림', 'D313')), str(len(d794)))
ok('④ VERSION v10.656 이상', VT >= (10, 656), VER)

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
