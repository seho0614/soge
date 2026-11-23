"""v10.680 ~ 684 (D318 · docs/799) 관 담당자 · 문의 블록 · 새 관 공유 미리보기 · 하루 요약 관 숫자 · 초안 고친 기록
  ① (코드) D318 · 서버(managers · createInquiry 출처 · INQUIRY · draftLog · gwanDigestLines) · 화면 · 사용자 웹(문의 블록 · 출처 넘김 · openGraph) · 영어 · screens.json
  ② (DB) 문의 출처 모양 — 페이지만 있고 관 없음 막힘 · 틀린 관 코드 막힘(되돌림)
  ③ (API) MNY 담당자 저장(admin@x.com) · 운영 역할 없는 계정 422 · 문의 블록 저장 · 출처 붙은 문의 → 첫째 담당자가 처음 담당 · 없는 관 출처는 안 붙음
       · 초안 저장 기록(바뀐 블록 수 · 제목 바뀜) · 하루 요약에 「관별」 줄 — 끝나면 담당자 되돌림 · 페이지 · 문의 지움
  ④ 문서 799 · 판
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
M8 = rd('prisma/migrations/D318_gwan_managers_inquiry_source_draft_log/migration.sql')
ok('① D318 — 관 담당자 · 문의 출처(모양 CHECK) · 초안 기록 · 권한 주소 3 · 지우는 문장 없음',
   'gwan_managers' in M8 and 'source_gwan text' in M8 and 'inquiries_source_fmt' in M8 and 'gwan_page_draft_log' in M8 and M8.count("'/admin/gwan") == 3
   and not re.search(r'\b(DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN)\b', M8), str(len(M8)))
SS, PS, IA, GS, LW = (rd('src/modules/site/site.service.ts'), rd('src/modules/public/public.service.ts'), rd('src/modules/support/inquiry-admin.service.ts'),
                      rd('src/modules/site/gwan-pages.service.ts'), rd('src/modules/admin/launch-watch.service.ts'))
ok('① 서버 — 담당자(운영 역할만 · 5명) · 문의 출처 · 첫째 담당자 · 답변함 출처 · INQUIRY 블록 · 초안 기록 · 하루 요약 관 줄',
   'async putManagers(' in SS and 'GWAN_MANAGER_ROLE' in SS and 'source_gwan, source_page, assignee_id' in PS and 'i.source_gwan AS "sourceGwan"' in IA
   and "case 'INQUIRY'" in GS and 'INSERT INTO gwan_page_draft_log' in GS and 'async draftLog(' in GS and 'async gwanDigestLines(' in LW and 'this.gwanDigestLines()' in LW, '')
GSet, GP, ID = rd('web/src/app/admin/gwans/GwanSettings.tsx'), rd('web/src/app/admin/gwans/GwanPages.tsx'), rd('web/src/app/admin/InquiryDesk.tsx')
SB, SN, IF, SG = rd('site/src/components/gwan/GwanBlocks.tsx'), rd('site/src/app/support/new/page.tsx'), rd('site/src/components/InquiryForm.tsx'), rd('site/src/app/[gwan]/page.tsx')
ok('① 화면 — 관 담당자 상자 · 문의 받기 블록 · 초안 고친 기록 · 답변함 출처 · 사용자 웹 문의 단추 · 출처 넘김 · 새 관 openGraph',
   'function Managers(' in GSet and 'data-gwan-managers' in GSet and "['INQUIRY', '문의 받기']" in GP and 'function DraftLog(' in GP and 'data-inquiry-source' in ID
   and 'data-gwan-inquiry' in SB and '/support/new?' in SB and 'source={' in SN and 'sourceGwan: source.gwan' in IF and 'openGraph: { title, description: desc, url' in SG, '')
ok('① 영어 2 · screens.json(담당자 · 초안 기록)',
   '관 담당자는 운영 역할(ADMIN · SUPER)이 있는 계정만 됩니다.' in rd('src/common/i18n/server-text.en.ts')
   and all(a in rd('spec/screens.json') for a in ('PUT /admin/gwans/{code}/managers', 'GET /admin/gwan-pages/{id}/draft-log')), '')

# ── ② DB ───────────────────────────────────────────────────────────────
if DB and DB_UP:
    d1 = psql("BEGIN; INSERT INTO inquiries (category, title, body, email, source_page) VALUES ('ETC', 'x', 'xxxxx', 't@x.com', 'guide'); ROLLBACK;")
    d2 = psql("BEGIN; INSERT INTO inquiries (category, title, body, email, source_gwan) VALUES ('ETC', 'x', 'xxxxx', 't@x.com', 'mny'); ROLLBACK;")
    ok('② DB — 출처 페이지만 · 틀린 관 코드 막힘', 'inquiries_source_fmt' in d1 and 'inquiries_source_fmt' in d2, f'{d1[-50:]} | {d2[-50:]}')

# ── ③ API ──────────────────────────────────────────────────────────────
if API and DB and API_UP and DB_UP:
    stamp = time.strftime('%H%M%S')
    slug = f'zm{stamp}'
    was = psql("SELECT coalesce(string_agg(account_id::text, ',' ORDER BY sort_order), '') FROM gwan_managers WHERE gwan_code = 'MNY'")
    try:
        import consent_ok
        consent_ok.agree('admin@x.com', PW)
        TS_ = login('admin@x.com')
        aid = psql("SELECT id FROM accounts WHERE email = 'admin@x.com'")
        bid = psql("SELECT id FROM accounts WHERE email = 'buyer@x.com'")
        m1 = call('PUT', '/admin/gwans/MNY/managers', {'accountIds': [aid]}, TS_)
        m2 = call('PUT', '/admin/gwans/MNY/managers', {'accountIds': [aid, bid]}, TS_)
        ok('③ 담당자 — admin 저장 · 운영 역할 없는 buyer 섞으면 422',
           [x.get('accountId') for x in (m1.get('items') or [])] == [aid] and m2.get('code') == 'GWAN_MANAGER_ROLE', f"{len(m1.get('items') or [])} · {m2.get('code')}")
        pg = call('POST', '/admin/gwans/MNY/pages', {'slug': slug, 'title': '시험 문의'}, TS_); pid = pg.get('id')
        s1 = call('PATCH', f'/admin/gwan-pages/{pid}', {'blocks': [{'type': 'INQUIRY', 'title': '궁금하세요?', 'body': '물어보세요', 'label': '문의', 'category': 'NOPE'}]}, TS_)
        iq = (s1.get('blocks') or [{}])[0]
        ok('③ 문의 블록 저장 — 틀린 유형은 HOWTO', iq.get('type') == 'INQUIRY' and iq.get('category') == 'HOWTO', str(iq))
        q1 = call('POST', '/inquiries', {'category': 'HOWTO', 'title': f'시험 문의 {stamp}', 'body': '관 페이지에서 왔습니다', 'email': f't1680{stamp}@x.com', 'sourceGwan': 'MNY', 'sourcePage': slug})
        q2 = call('POST', '/inquiries', {'category': 'HOWTO', 'title': f'시험 문의2 {stamp}', 'body': '없는 관에서 왔습니다', 'email': f't1680{stamp}@x.com', 'sourceGwan': 'ZZZQ'})
        r1 = psql(f"SELECT source_gwan || '|' || coalesce(source_page, '') || '|' || coalesce(assignee_id::text, '') FROM inquiries WHERE id = '{q1.get('id')}'")
        r2 = psql(f"SELECT coalesce(source_gwan, '-') FROM inquiries WHERE id = '{q2.get('id')}'")
        ok('③ 출처 붙은 문의 — 관 · 페이지 · 첫째 담당자 · 없는 관은 출처 없음', r1 == f'MNY|{slug}|{aid}' and r2 == '-', f'{r1} · {r2}')
        call('PATCH', f'/admin/gwan-pages/{pid}', {'title': '시험 문의 고침', 'blocks': [{'type': 'INQUIRY', 'title': '바뀜', 'label': '문의', 'category': 'ETC'}, {'type': 'TEXT', 'body': '더함'}]}, TS_)
        lg = call('GET', f'/admin/gwan-pages/{pid}/draft-log', None, TS_)
        ok('③ 초안 고친 기록 — 최근 줄: 블록 2 · 바뀐 2 · 제목 바뀜', isinstance(lg, list) and len(lg) >= 2 and lg[0].get('blocks') == 2 and lg[0].get('changed') == 2 and lg[0].get('titleChanged') is True,
           str(lg[:1]))
        dg = call('GET', '/admin/launch-watch/digest', None, TS_)
        ok('③ 하루 요약 지금 보기 — 「관별」 줄', '관별' in str(dg.get('text') or ''), str(dg.get('_err') or (dg.get('text') or '')[-120:]))
    finally:
        psql(f"SET session_replication_role = replica; DELETE FROM gwan_page_versions WHERE page_id IN (SELECT id FROM gwan_pages WHERE slug = '{slug}'); DELETE FROM gwan_pages WHERE slug = '{slug}';")
        psql(f"DELETE FROM inquiries WHERE email = 't1680{stamp}@x.com'")
        psql("DELETE FROM gwan_managers WHERE gwan_code = 'MNY'")
        if was:
            for i, a in enumerate(was.split(',')):
                psql(f"INSERT INTO gwan_managers (gwan_code, account_id, sort_order) VALUES ('MNY', '{a}', {i}) ON CONFLICT DO NOTHING")
        ok('③ 끝 — 페이지 · 문의 지움 · 담당자 되돌림', psql(f"SELECT (SELECT count(*) FROM gwan_pages WHERE slug = '{slug}') + (SELECT count(*) FROM inquiries WHERE email = 't1680{stamp}@x.com')") == '0'
           and psql("SELECT coalesce(string_agg(account_id::text, ',' ORDER BY sort_order), '') FROM gwan_managers WHERE gwan_code = 'MNY'") == was, '')
else:
    print('API · DB 없음 — ③ 건너뜀')

# ── ④ 문서 · 판 ─────────────────────────────────────────────────────────
d799 = doc('799_')
ok('④ 문서 799 — 담당자 · 문의 받기 · 공유 미리보기 · 관별 · 초안 고친 기록 · D318',
   all(w in d799 for w in ('관 담당자', '문의 받기', '공유 미리보기', '관별', '초안 고친 기록', 'D318')), str(len(d799)))
ok('④ VERSION v10.680 이상', VT >= (10, 680), VER)

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
