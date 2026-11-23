"""v10.646 (D309 · docs/791) 새 관을 끝까지 — 운영 화면에서 만든 관을 업종 · 폼 문구 · 허브와 함께 열고 사용자 웹에서 씀
  ① (코드) D309 intro_target · 오픈 뒤 새 관(다른 관 운영 중) · 상위 관은 허브만 · saved_searches 무늬 · 첫 화면 설정 무늬 · 권한 주소 5 ·
     새 관 3 ~ 4자 · 등록 폼 문구 API · 다른 관 업종 가져오기 API · 운영 화면(새 관 · 관 설정 「등록 폼 문구」 · 업종 가져오기) ·
     사용자 웹 GENERIC_GWAN_PATH · /g/[gwan] · 등록 · 요청 · 검색 · 매물 · 요청 · 저장한 검색 DTO 무늬 · 영어 7 · screens.json · 검정 ⑬
  ② (DB) 상위 관 = 허브 아닌 관 → GWAN_PARENT(되돌림) · saved_searches 무늬 · 설정 무늬
  ③ (API) 4자 새 관(상위 EARN · 소개 대상 GOODS) → 폼 문구 없이 열기 422 NO_FORM_COPY → 폼 문구 → 다른 관 업종 가져오기(시험 관리자) →
     admin@x.com 승인 → 열기 → 공개 /gwans · /listings?gwanCode · 저장한 검색 · 사용자 웹 /g/<코드> — 끝나면 관 · 업종 · 계정 지움
  ④ 문서 791 · 판
  (두 번 돌아도 통과 — 관 코드는 돌 때마다 새로 고름)
"""
import json, os, random, re, string, subprocess, sys, time, urllib.error, urllib.request
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


def login(e):
    return call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')


VER = rd('VERSION').strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))
MG = rd('prisma/migrations/D309_new_gwan_full/migration.sql')
SD, SS, SC = rd('src/modules/site/site.dto.ts'), rd('src/modules/site/site.service.ts'), rd('src/modules/site/site.controller.ts')
CD, CS, CC = rd('src/modules/catalog/catalog.dto.ts'), rd('src/modules/catalog/catalog.service.ts'), rd('src/modules/catalog/catalog.controller.ts')
LD, RQ, SV = rd('src/modules/listing/listing.dto.ts'), rd('src/modules/request/request.dto.ts'), rd('src/modules/lsx/saved.ts')
GN, GS, CT = rd('web/src/app/admin/gwans/GwanNew.tsx'), rd('web/src/app/admin/gwans/GwanSettings.tsx'), rd('web/src/app/admin/Categories.tsx')
FM, RG, RN, SP = rd('site/src/lib/format.ts'), rd('site/src/app/register/page.tsx'), rd('site/src/app/request/new/page.tsx'), rd('site/src/app/search/page.tsx')
GP, GI = rd('site/src/app/g/[gwan]/page.tsx'), rd('site/src/app/g/[gwan]/[id]/page.tsx')
EN, SJ, TS = rd('src/common/i18n/server-text.en.ts'), rd('spec/screens.json'), rd('scripts/check-testsafety.sh')

ok('① D309 — intro_target · 오픈 뒤 새 관(다른 관 운영 중) · 상위 관 허브만 · saved_searches · 설정 무늬 · 권한 주소 · 지우는 문장 없음 · 퍼센트 RAISE 없음',
   'intro_target' in MG and 'o.is_active AND NOT o.is_hub' in MG and 'fn_gwan_parent_guard' in MG and 'GWAN_PARENT' in MG
   and 'lsx_saved_searches_gwan_code_fmt' in MG and "'^$|^[A-Z]{3,4}$'" in MG and "'^(HERO|[A-Z]{3,4})?$'" in MG
   and "('PUT', '/admin/gwans/{code}/form-copy/{role}'" in MG and "('POST', '/admin/categories', 'category', 'EDIT')" in MG
   and not re.search(r'\b(DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN)\b', MG, re.I) and not re.search(r"RAISE EXCEPTION\s+'[^']*%", MG), str(len(MG)))
ok('① 서버 — 새 관 3 ~ 4자 · 소개 대상 · 상위 관 · 등록 폼 문구 GET · PUT · 다른 관 업종 가져오기',
   "@Matches(/^[A-Z]{3,4}$/, { message: '관 코드는 영문 대문자 3 ~ 4자입니다.' }) code!" in SD and 'introTarget' in SD and 'parentCode' in SD
   and 'intro_target' in SS and 'parent_code = CASE' in SS and "@Get('gwans/:code/form-copy')" in SC and "@Put('gwans/:code/form-copy/:role')" in SC
   and 'ON CONFLICT (gwan_code, role) DO UPDATE' in SS and "@Post('admin/categories/copy')" in CC and 'copyCategory' in CS and 'CopyCategoryDto' in CD, '')
ok('① 매물 · 요청 · 저장한 검색 — 4관 목록 대신 관 코드 무늬',
   '@Matches(GWAN_RE, GWAN_MSG) gwanCode!' in LD and '@IsIn(GWAN)' not in LD and '@IsIn(GWAN)' not in RQ and 'SAVED_GWAN_RE.test(gwan)' in SV, '')
ok('① 운영 화면 — 새 관 4자 · 상위 관 · 「등록 폼 문구」 탭 · 「다른 관 업종 가져오기」',
   '/^[A-Z]{3,4}$/' in GN and 'maxLength={4}' in GN and 'data-gwan-new-parent' in GN and 'introTarget' in GN
   and "label: '등록 폼 문구'" in GS and 'form-copy/${r}' in GS and 'data-gwan-parent' in GS and 'data-cat-copy' in CT and '/admin/categories/copy' in CT, '')
ok('① 사용자 웹 — GENERIC_GWAN_PATH · /g/[gwan] · 등록 · 요청 · 검색에 새 관 · 허브 뺌',
   'GENERIC_GWAN_PATH' in FM and 'new Proxy(' in FM and 'isFixedGwan' in FM and "from '../../[gwan]/page'" in GP and "from '../../../[gwan]/[id]/page'" in GI
   and 'isFixedGwan(g.code)' in RG and 'isFixedGwan(g.code)' in RN and 'isFixedGwan(g.code)' in SP and 'GENERIC_GWAN_PATH' in TS, '')
ok('① 영어 7 · screens.json 새 주소 3',
   all(w in EN for w in ('관 코드는 영문 대문자 3 ~ 4자입니다.', '같은 관으로는 가져올 수 없습니다.', '상위 관은 허브 관만 고를 수 있습니다.'))
   and all(w in SJ for w in ('POST /admin/categories/copy', 'GET /admin/gwans/{code}/form-copy', 'PUT /admin/gwans/{code}/form-copy/{role}')), '')

if API and DB:
    m = psql("BEGIN; UPDATE gwans SET parent_code = 'MNY' WHERE code = 'BIZ'; ROLLBACK;")
    con = psql("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'lsx_saved_searches_gwan_code_fmt'")
    old = psql("SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.lsx_saved_searches'::regclass AND pg_get_constraintdef(oid) LIKE '%MNY|MAL|BIZ|HLT%'")
    pm = (re.search(r'GWAN_PARENT[^\n]*', m) or [m[-40:]])[0][:50]
    pat = psql("SELECT string_agg(value_pattern, ' | ' ORDER BY key) FROM site_settings WHERE key IN ('site.landing_after_login', 'site.landing_new_member')")
    ok('② DB — 상위 관이 허브 아님 → GWAN_PARENT(되돌림) · saved_searches 무늬 · 옛 4관 CHECK 없음 · 첫 화면 설정 무늬',
       'GWAN_PARENT' in m and '[A-Z]{3,4}' in con and old == '0' and '[A-Z]{3,4}' in pat, f"{pm} · {old} · {pat}")

    while True:
        code = 'Z' + ''.join(random.choice(string.ascii_uppercase) for _ in range(3))
        if psql(f"SELECT count(*) FROM gwans WHERE code = '{code}'") == '0':
            break
    stamp = str(int(time.time()))[-6:]
    em = f't1646a{stamp}@x.com'
    TS_ = login('admin@x.com')
    try:
        h = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
        psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{em}', '시험1646', '{h}', now()) ON CONFLICT DO NOTHING")
        aid = psql(f"SELECT id FROM accounts WHERE email = '{em}'")
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 1646', true); INSERT INTO account_roles (account_id, role) VALUES ('{aid}', 'ADMIN') ON CONFLICT DO NOTHING; COMMIT;")
        import consent_ok
        consent_ok.agree(em, PW); consent_ok.agree('admin@x.com', PW)
        TA, TS_ = login(em), login('admin@x.com')

        c0 = call('POST', '/admin/gwans', {'code': code, 'name': f'시험관{stamp[-3:]}', 'description': '시험 1646', 'introTarget': 'GOODS', 'parentCode': 'EARN'}, TS_)
        bad = call('POST', '/admin/gwans', {'code': 'ab', 'name': '틀림'}, TS_)
        par = call('PATCH', f'/admin/gwans/{code}', {'parentCode': 'MNY'}, TS_)
        g0 = call('GET', f'/admin/gwans/{code}', None, TS_)
        ok('③ 4자 새 관 — 준비중 · 소개 대상 GOODS · 상위 EARN · 틀린 코드 400(한국어) · 허브 아닌 상위 관 422 GWAN_PARENT',
           c0.get('code') == code and c0.get('isActive') is False and g0.get('introTarget') == 'GOODS' and g0.get('parentCode') == 'EARN'
           and bad.get('_err') == 400 and '3 ~ 4자' in str(bad.get('message')) and par.get('_err') == 422 and par.get('code') == 'GWAN_PARENT',
           f"{c0.get('code')} {g0.get('introTarget')} {g0.get('parentCode')} · {bad.get('_err')} · {par.get('_err')} {par.get('code')}")

        src = psql("SELECT id FROM categories WHERE gwan_code = 'MNY' AND status = 'APPROVED' AND restricted_code IS NULL ORDER BY code LIMIT 1")
        cp = call('POST', '/admin/categories/copy', {'fromId': src, 'gwanCode': code}, TA)
        same = call('POST', '/admin/categories/copy', {'fromId': src, 'gwanCode': 'MNY'}, TA)
        o1 = call('PATCH', f'/admin/gwans/{code}', {'isActive': True}, TS_)
        ok('③ 업종 가져오기 — 승인 대기 · 앞머리 새 관 코드 · 같은 관 422 · 승인 업종 없이 열기 422',
           cp.get('status') == 'PENDING' and str(cp.get('code', '')).startswith(code + '_') and same.get('_err') == 422 and same.get('code') == 'CATEGORY_COPY_SAME'
           and o1.get('_err') == 422, f"{cp.get('status')} {cp.get('code')} · {same.get('code')} · {o1.get('code')}")

        ap = call('PATCH', f"/admin/categories/{cp.get('id')}", {'status': 'APPROVED', 'laborLawFlag': 'NOT_APPLICABLE', 'feeBearer': 'SELLER'}, TS_)
        o2 = call('PATCH', f'/admin/gwans/{code}', {'isActive': True}, TS_)
        fc = call('PUT', f'/admin/gwans/{code}/form-copy/OFFER', {'subject': '시험 강의', 'titleHint': '무엇을 가르치는지', 'bodyHint': '대상 · 기간 · 비용'}, TS_)
        fbad = call('PUT', f'/admin/gwans/{code}/form-copy/SELL', {'subject': 'x', 'titleHint': 'x', 'bodyHint': 'x'}, TS_)
        fl = call('GET', f'/admin/gwans/{code}/form-copy', None, TS_)
        o3 = call('PATCH', f'/admin/gwans/{code}', {'isActive': True}, TS_)
        ok('③ 열기 — 폼 문구 없이 422 NO_FORM_COPY → 폼 문구 저장(OFFER) · 틀린 종류 422 → 열림(다른 관 운영 중 · 일괄 오픈 아님)',
           ap.get('status') == 'APPROVED' and o2.get('_err') == 422 and o2.get('code') == 'NO_FORM_COPY' and fc.get('role') == 'OFFER'
           and fbad.get('_err') == 422 and isinstance(fl, list) and len(fl) == 1 and o3.get('isActive') is True and o3.get('openedAt'),
           f"{ap.get('status')} · {o2.get('code')} · {fc.get('role')} · {fbad.get('code')} · {o3.get('isActive')} {str(o3.get('openedAt'))[:10]}")

        pub = call('GET', '/gwans')
        mine = next((x for x in pub if x.get('code') == code), {}) if isinstance(pub, list) else {}
        hub = next((x for x in pub if x.get('code') == 'EARN'), {}) if isinstance(pub, list) else {}
        ls = call('GET', f'/listings?gwanCode={code}&limit=5')
        ss = call('POST', '/me/saved-searches', {'name': '시험1646', 'gwanCode': code}, TA)
        ok('③ 사용자 쪽 — 공개 /gwans 에 새 관(isHub false) · EARN 은 isHub · /listings?gwanCode 200 · 저장한 검색 관 코드 통과(스위치 꺼짐이면 LSX_OFF)',
           mine.get('isHub') is False and (not hub or hub.get('isHub') is True) and '_err' not in ls and ('_err' not in ss or ss.get('code') == 'LSX_OFF'),   # 스위치 lsx.saved_search 꺼짐이면 LSX_OFF(관 무늬는 ② DB 로 봄)
           f"{mine.get('code')} {mine.get('isHub')} · {hub.get('isHub')} · {ls.get('_err', 'ok')} · {ss.get('_err', 'ok')} {ss.get('code', '')}")
        if SITE:
            def st(path):
                try:
                    return urllib.request.urlopen(SITE + path, timeout=120).status
                except urllib.error.HTTPError as e:
                    return e.code
            s1, s2 = st(f'/g/{code.lower()}'), st('/g/zzzq')
            ok('③ 사용자 웹 — /g/<코드> 200 · 없는 관 404', s1 == 200 and s2 == 404, f'{s1} · {s2}')
    finally:
        psql(f"SET session_replication_role = replica; DELETE FROM lsx_saved_searches WHERE gwan_code = '{code}'; "
             f"DELETE FROM category_grades WHERE category_id IN (SELECT id FROM categories WHERE gwan_code = '{code}'); "
             f"DELETE FROM categories WHERE gwan_code = '{code}'; DELETE FROM gwan_form_copy WHERE gwan_code = '{code}'; DELETE FROM gwans WHERE code = '{code}';")
        from qa_helpers import drop_accounts_sql
        psql(drop_accounts_sql(f"email = '{em}'"))
    left = psql(f"SELECT (SELECT count(*) FROM gwans WHERE code = '{code}') + (SELECT count(*) FROM categories WHERE gwan_code = '{code}') + (SELECT count(*) FROM accounts WHERE email = '{em}')")
    ok('③ 끝 — 시험 관 · 업종 · 계정 지움', left == '0', left)
else:
    print('API · DB 없음 — ② · ③ 건너뜀')

d791 = doc('791_')
ok('④ 문서 791 — 등록 폼 문구 · 다른 관 업종 가져오기 · /g/ · D309', all(w in d791 for w in ('등록 폼 문구', '다른 관 업종 가져오기', '/g/', 'D309')), str(len(d791)))
ok('④ VERSION v10.646 이상', VT >= (10, 646), VER)

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
