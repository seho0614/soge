"""v10.650 ~ 652 (D311 · docs/793) 관 페이지 — 새 관 첫 화면 블록 편집 · 관 안 페이지 등록(초안 → 게시 · 판 기록)
  ① (코드) D311 표 2 · 트리거 2 · 권한 주소 · 서버(블록 검사 · 게시 SUPER) · 운영 화면 「관 페이지」 · 사용자 웹 /info/ · 첫 화면 블록 · 영어 · screens.json
  ② (DB) 처음 관 첫 화면 → GWAN_PAGE_HOME · 허브 → GWAN_PAGE_HUB · 게시된 판 고치기 → GWAN_PAGE_VERSION_RO(되돌림)
  ③ (API) 시험 관리자(ADMIN) 가 소개장터에 페이지 → ADMIN 게시 403 · HTML 422 → SUPER 게시 1판 → 공개 200(· 사용자 웹 /money/info/<주소>) → 숨김 → 공개 404 → 되돌리기 → 끝나면 페이지 · 계정 지움
  ④ 문서 793 · 판
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

VER = rd('VERSION').strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))
MG = rd('prisma/migrations/D311_gwan_pages/migration.sql')
SV, CT, AM = rd('src/modules/site/gwan-pages.service.ts'), rd('src/modules/site/gwan-pages.controller.ts'), rd('src/app.module.ts')
GP, GW = rd('web/src/app/admin/gwans/GwanPages.tsx'), rd('web/src/app/admin/Gwans.tsx')
BL, IP, GI, GM = rd('site/src/components/gwan/GwanBlocks.tsx'), rd('site/src/app/[gwan]/info/[slug]/page.tsx'), rd('site/src/app/g/[gwan]/info/[slug]/page.tsx'), rd('site/src/app/[gwan]/page.tsx')
EN, SJ = rd('src/common/i18n/server-text.en.ts'), rd('spec/screens.json')
M12, FD, FS = rd('prisma/migrations/D312_page_image/migration.sql'), rd('src/modules/file/file.dto.ts'), rd('src/modules/file/file.service.ts')
PH = rd('web/src/app/admin/gwans/pageHtml.ts')
ok('① 불러오기 · 내려받기 · HTML 로 편집 · 복사 · 편집 보강(v10.655) — HTML 은 블록으로만 · 판 하나 API',
   'export function htmlToBlocks' in PH and 'export function blocksToHtml' in PH and "'script', 'style', 'iframe'" in PH and "format: 'sgb-gwan-page'" in PH
   and 'function PageTools' in GP and 'data-gwan-page-htmledit-apply' in GP and 'data-gwan-page-undo' in GP and 'data-gwan-page-dup' in GP
   and 'beforeunload' in GP and 'data-gwan-page-mobile' in GP and 'data-gwan-page-diff' in GP and "@Get('admin/gwan-pages/:id/versions/:version')" in CT, '')
ok('① 편집에 사진 추가(v10.654) — 「+ 사진 추가」(여러 장 · 끌어 놓기) · 글에 사진 넣기 · 사진 묶음 블록 · 사용자 웹 그리기',
   'function AddPhotos' in GP and 'multiple' in GP and 'onDrop=' in GP and 'data-gwan-page-textphoto' in GP and "['GALLERY', '사진 묶음']" in GP
   and "case 'GALLERY':" in SV and '글 속 사진은 20장까지' in SV and "case 'GALLERY':" in BL and 'const pic = ' in BL, '')
ok('① 그림 바로 올리기(v10.653 · D312) — PAGE_IMAGE 용도 · 공개 주소 · 편집 화면 파일 고르기',
   "position('PAGE_IMAGE' IN v_def) = 0" in M12 and "'PAGE_IMAGE', 'image/png', 5242880" in M12 and "'PAGE_IMAGE', " in FD and "PAGE_IMAGE: ['ADMIN', 'SUPER']" in FS
   and "@Get('site/page-images/:id')" in CT and "purpose = 'PAGE_IMAGE' AND status = 'READY'" in SV
   and "uploadFile(f, 'PAGE_IMAGE')" in GP and 'data-gwan-page-upload' in GP and 'GET /site/page-images/{id}' in SJ, '')

ok('① D311 — gwan_pages · gwan_page_versions · 첫 화면 새 관만 · 허브 막음 · 판 고치기 막음 · 권한 주소 · 지우는 문장 없음',
   'CREATE TABLE IF NOT EXISTS public.gwan_pages' in MG and 'gwan_page_versions' in MG and 'GWAN_PAGE_HOME' in MG and 'GWAN_PAGE_HUB' in MG
   and 'GWAN_PAGE_VERSION_RO' in MG and "'/admin/gwan-pages/{id}/publish'" in MG
   and not re.search(r'\b(DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN)\b', MG, re.I) and not re.search(r"RAISE EXCEPTION\s+'[^']*%", MG), str(len(MG)))
ok('① 서버 — 블록 8종 검사(HTML · 주소) · 게시 · 숨김 SUPER · 초안 ADMIN · 공개 2 · 등록',
   # v10.656 · 664 표(TABLE) · 동영상(VIDEO)이 끼어도 되게 — PAGE_BLOCKS 안에 처음 9종이 모두 있는지
   all(f"'{k}'" in (re.search(r"PAGE_BLOCKS = \[([^\]]*)\]", SV) or [None, ''])[1] for k in ('HERO', 'TEXT', 'BUTTONS', 'IMAGE', 'GALLERY', 'LISTINGS', 'CATEGORIES', 'NOTICES', 'FAQ'))
   and all(w in SV for w in ('HTML 태그는 쓸 수 없습니다', 'https 주소만'))
   and ("@Post('admin/gwan-pages/:id/publish')\n  @HttpCode(200)\n  @ApiBearerAuth() @Roles('SUPER')" in CT or "@Post('admin/gwan-pages/:id/publish')\n  @HttpCode(200)\n  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')" in CT)   # v10.771 서버 assertPublisher
   and "@Get('gwans/:code/pages/:slug')" in CT
   and '@StrictBoolean()' in CT and 'GwanPagesController' in AM and 'GwanPagesService' in AM, '')
ok('① 운영 화면 「관 페이지」 — ADMIN 도 · 블록 편집 · 게시(SUPER) · 판 기록 · 미리보기',
   "key: 'pages', label: '관 페이지'" in GW and 'data-gwan-page-publish' in GP and 'isSuper &&' in GP and '이 판으로 초안' in GP and 'data-gwan-page-preview' in GP, '')
ok('① 사용자 웹 — 블록 그리기(HTML 없이) · /info/[slug] · /g/ · 새 관 첫 화면 · 메뉴',
   'dangerouslySetInnerHTML' not in BL and 'GwanPageMenu' in BL and '/info/' in BL and "pages/${slug}" in IP and "from '../../../../[gwan]/info/[slug]/page'" in GI
   and '/pages/home' in GM and '{pm}' in GM, '')
ok('① 영어 · screens.json',
   '"블록이 하나도 없어 게시할 수 없습니다."' in EN and '"첫 화면 편집은 운영 화면에서 만든 새 관만 됩니다 — 처음 관은 따로 꾸민 첫 화면을 씁니다."' in EN
   and all(w in SJ for w in ('SB-ADM-PAGE-010', 'SB-HOM-GWN-020', 'POST /admin/gwan-pages/{id}/publish', 'GET /gwans/{code}/pages/{slug}')), '')

if API and DB:
    h1 = psql("BEGIN; INSERT INTO gwan_pages (gwan_code, slug, title) VALUES ('MNY', 'home', 'x'); ROLLBACK;")
    h2 = psql("BEGIN; INSERT INTO gwan_pages (gwan_code, slug, title) VALUES ('EARN', 'guide', 'x'); ROLLBACK;")
    h3 = psql("BEGIN; INSERT INTO gwan_pages (gwan_code, slug, title) VALUES ('MNY', 'zz-ro-test', 'x'); "
              "INSERT INTO gwan_page_versions (page_id, version, title, blocks) SELECT id, 1, 'x', '[]' FROM gwan_pages WHERE gwan_code = 'MNY' AND slug = 'zz-ro-test'; "
              "UPDATE gwan_page_versions SET title = 'y' WHERE page_id = (SELECT id FROM gwan_pages WHERE gwan_code = 'MNY' AND slug = 'zz-ro-test'); ROLLBACK;")
    pick = lambda s: (re.search(r'GWAN_PAGE_[A-Z_]+', s) or [s[-40:]])[0]
    fp = psql("SELECT (pg_get_constraintdef(oid) LIKE '%PAGE_IMAGE%')::text FROM pg_constraint WHERE conname = 'ck_files_purpose'")
    img = call('GET', '/site/page-images/00000000-0000-0000-0000-000000000000')
    ok('② DB · API — 파일 용도에 PAGE_IMAGE · 없는 그림 404', fp == 'true' and img.get('_err') in (404, 409), f"{fp} · {img.get('_err')}")
    ok('② DB — 처음 관 첫 화면 GWAN_PAGE_HOME · 허브 GWAN_PAGE_HUB · 판 고치기 GWAN_PAGE_VERSION_RO(되돌림)',
       'GWAN_PAGE_HOME' in h1 and 'GWAN_PAGE_HUB' in h2 and 'GWAN_PAGE_VERSION_RO' in h3, f'{pick(h1)} · {pick(h2)} · {pick(h3)}')

    stamp = str(int(time.time()))[-6:]
    slug, em = f'zz{stamp}', f't1652a{stamp}@x.com'
    try:
        h = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
        psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{em}', '시험1652', '{h}', now()) ON CONFLICT DO NOTHING")
        aid = psql(f"SELECT id FROM accounts WHERE email = '{em}'")
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 1652', true); INSERT INTO account_roles (account_id, role) VALUES ('{aid}', 'ADMIN') ON CONFLICT DO NOTHING; COMMIT;")
        import consent_ok
        consent_ok.agree(em, PW); consent_ok.agree('admin@x.com', PW)
        TA, TS_ = login(em), login('admin@x.com')
        c = call('POST', '/admin/gwans/MNY/pages', {'slug': slug, 'title': '시험 안내'}, TA)
        pid = c.get('id')
        bad = call('PATCH', f'/admin/gwan-pages/{pid}', {'blocks': [{'type': 'TEXT', 'body': '<script>x</script>'}]}, TA)
        bad2 = call('PATCH', f'/admin/gwan-pages/{pid}', {'blocks': [{'type': 'BUTTONS', 'items': [{'label': '가', 'href': 'javascript:alert(1)'}]}]}, TA)
        up = call('PATCH', f'/admin/gwan-pages/{pid}', {'blocks': [{'type': 'HERO', 'title': '어서 오세요'}, {'type': 'TEXT', 'body': '**굵게** 안내\n- 하나\n- 둘'},
                                                                    {'type': 'FAQ', 'items': [{'q': '질문', 'a': '답'}]}, {'type': 'LISTINGS', 'limit': 3}]}, TA)
        p1 = call('POST', f'/admin/gwan-pages/{pid}/publish', None, TA)
        ok('③ ADMIN — 만들기 · HTML 422 · javascript 주소 422 · 초안 저장 · 게시 403',
           c.get('status') == 'DRAFT' and bad.get('_err') == 422 and bad.get('code') == 'GWAN_PAGE_BLOCK' and bad2.get('_err') == 422
           and len(up.get('blocks', [])) == 4 and up.get('draftChanged') is True and p1.get('_err') == 403,
           f"{c.get('status')} · {bad.get('code')} · {bad2.get('_err')} · {len(up.get('blocks', []))} · {p1.get('_err')}")
        p2 = call('POST', f'/admin/gwan-pages/{pid}/publish', None, TS_)
        pub = call('GET', f'/gwans/MNY/pages/{slug}')
        menu = call('GET', '/gwans/MNY/pages')
        ok('③ SUPER 게시 → 1판 · 공개 페이지(블록 4) · 메뉴에 있음',
           p2.get('status') == 'PUBLISHED' and p2.get('publishedVersion') == 1 and pub.get('version') == 1 and len(pub.get('blocks', [])) == 4
           and isinstance(menu, list) and any(x.get('slug') == slug for x in menu), f"{p2.get('status')} {p2.get('publishedVersion')} · {pub.get('version')} · {len(menu) if isinstance(menu, list) else menu}")
        if SITE:
            try:
                st = urllib.request.urlopen(f'{SITE}/money/info/{slug}', timeout=120).status
            except urllib.error.HTTPError as e:
                st = e.code
            ok('③ 사용자 웹 /money/info/<주소> 200', st == 200, str(st))
        vv = call('GET', f'/admin/gwan-pages/{pid}/versions/1', None, TA)
        vx = call('GET', f'/admin/gwan-pages/{pid}/versions/99', None, TA)
        ok('③ 판 하나(v10.655) — 1판 블록 4 · 없는 판 404', len(vv.get('blocks', [])) == 4 and vx.get('_err') in (404, 409), f"{len(vv.get('blocks', []))} · {vx.get('_err')}")
        hd = call('POST', f'/admin/gwan-pages/{pid}/hide', {'hidden': True}, TS_)
        gone = call('GET', f'/gwans/MNY/pages/{slug}')
        rs = call('POST', f'/admin/gwan-pages/{pid}/restore', {'version': 1}, TA)
        g1 = call('PATCH', f'/admin/gwan-pages/{pid}', {'blocks': [{'type': 'TEXT', 'body': '앞 글\n![사진](/api/v1/site/page-images/x)\n뒷 글'},
                                                                    {'type': 'GALLERY', 'cols': 3, 'items': [{'src': '/a.jpg', 'alt': '가'}, {'src': 'https://x.com/b.png', 'alt': '나'}]}]}, TA)
        g2 = call('PATCH', f'/admin/gwan-pages/{pid}', {'blocks': [{'type': 'TEXT', 'body': '![x](javascript:alert(1))'}]}, TA)
        g3 = call('PATCH', f'/admin/gwan-pages/{pid}', {'blocks': [{'type': 'GALLERY', 'items': [{'src': '/a.jpg'}]}]}, TA)
        ok('③ 사진 — 글 속 사진 · 사진 묶음 저장 · javascript 사진 주소 422 · 설명 없는 사진 422',
           len(g1.get('blocks', [])) == 2 and g1['blocks'][1].get('cols') == 3 and g2.get('_err') == 422 and g3.get('_err') == 422,
           f"{len(g1.get('blocks', []))} · {g2.get('_err')} · {g3.get('_err')}")
        ok('③ 숨김 → 공개 404 · 1판으로 초안(ADMIN)', hd.get('status') == 'HIDDEN' and gone.get('_err') in (404, 409) and len(rs.get('blocks', [])) == 4,
           f"{hd.get('status')} · {gone.get('_err')} · {len(rs.get('blocks', []))}")
    finally:
        psql(f"SET session_replication_role = replica; DELETE FROM gwan_page_versions WHERE page_id IN (SELECT id FROM gwan_pages WHERE slug = '{slug}'); DELETE FROM gwan_pages WHERE slug = '{slug}';")
        from qa_helpers import drop_accounts_sql
        psql(drop_accounts_sql(f"email = '{em}'"))
    left = psql(f"SELECT (SELECT count(*) FROM gwan_pages WHERE slug = '{slug}') + (SELECT count(*) FROM accounts WHERE email = '{em}')")
    ok('③ 끝 — 시험 페이지 · 계정 지움', left == '0', left)
else:
    print('API · DB 없음 — ② · ③ 건너뜀')

d793 = doc('793_')
ok('④ 문서 793 — 첫 화면 · 관 안 페이지 · /info/ · D311 · SUPER', all(w in d793 for w in ('첫 화면', '관 안 페이지', '/info/', 'D311', 'SUPER')), str(len(d793)))
ok('④ VERSION v10.655 이상', VT >= (10, 655), VER)

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
