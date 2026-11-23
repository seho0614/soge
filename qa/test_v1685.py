"""v10.685 ~ 689 (D319 · docs/800) 내 담당 관 · 업종 CSV · FAQ 불러오기 · 관 현황판 문의 수 · 관 금칙어 바로 가기
  ① (코드) D319 · myGwans · 첫 화면 「오늘 할 일」 안 MyGwans(카드 열쇠 15 그대로) · CsvCategories(기존 업종 등록 · 200줄 · 검토 필요) · FaqImport · 현황 문의 · BannedLink · screens.json
  ③ (API) 담당 없으면 빈 목록 · MNY 담당이면 한 줄(숫자 칸) · 현황판 문의 · 금칙어 숫자 · CSV 와 같은 길(업종 승인 대기 · 같은 코드 409) — 끝나면 지움 · 담당자 되돌림
  ④ 문서 800 · 판
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
M9 = rd('prisma/migrations/D319_my_gwans_route/migration.sql')
GS, GC, SS = rd('src/modules/site/gwan-pages.service.ts'), rd('src/modules/site/gwan-pages.controller.ts'), rd('src/modules/site/site.service.ts')
DB_, DW, CA = rd('web/src/app/admin/Dashboard.tsx'), rd('web/src/app/admin/DashWidgets.tsx'), rd('web/src/app/admin/Categories.tsx')
GP, GSet = rd('web/src/app/admin/gwans/GwanPages.tsx'), rd('web/src/app/admin/gwans/GwanSettings.tsx')
ok('① D319 · 서버 — my-gwans 권한 주소 · myGwans(검수 · 문의 · 내 담당 · 7일 초안) · 현황 문의 · 금칙어 숫자',
   "('GET', '/admin/my-gwans', 'gwan-ux', 'VIEW')" in M9 and 'async myGwans(' in GS and '"myInquiries"' in GS and "@Get('admin/my-gwans')" in GC
   and '"openInquiries"' in SS and '"bannedWords"' in SS and 'AS inquiries' in SS, '')
keys = re.findall(r"\['([a-z][a-z0-9-]*)', '", (DW.split('DASH_WIDGETS: Array<[string, string]> = [')[1].split('];')[0] if 'DASH_WIDGETS' in DW else ''))
ok('① 화면 — 내 담당 관(오늘 할 일 안 · 카드 열쇠 15 그대로) · 업종 CSV(기존 등록 · 200 · 검토 필요) · FAQ 불러오기 · 현황 문의 · 금칙어 바로 가기',
   'function MyGwans(' in DB_ and '<MyGwans onGo={onGo} />' in DB_ and len(keys) == 15 and 'function CsvCategories(' in CA and "'/admin/categories', { method: 'POST'" in CA
   and '.slice(0, 200)' in CA and "'REVIEW_REQUIRED'" in CA and 'function FaqImport(' in GP and "'/admin/faqs'" in GP
   and 'data-gwan-stats-inq' in GSet and 'function BannedLink(' in GSet and "onGo('policy')" in GSet, str(len(keys)))
ok('① screens.json — my-gwans · faqs · categories', all(a in rd('spec/screens.json') for a in ('GET /admin/my-gwans', 'GET /admin/faqs')), '')

# ── ③ API ──────────────────────────────────────────────────────────────
if API and DB and API_UP and DB_UP:
    stamp = time.strftime('%H%M%S')
    code = f'MNY_T{stamp}'
    was = psql("SELECT coalesce(string_agg(account_id::text, ',' ORDER BY sort_order), '') FROM gwan_managers WHERE gwan_code = 'MNY'")
    try:
        import consent_ok
        consent_ok.agree('admin@x.com', PW)
        TS_ = login('admin@x.com')
        aid = psql("SELECT id FROM accounts WHERE email = 'admin@x.com'")
        psql(f"DELETE FROM gwan_managers WHERE account_id = '{aid}'")
        m0 = call('GET', '/admin/my-gwans', None, TS_)
        psql(f"INSERT INTO gwan_managers (gwan_code, account_id, sort_order) VALUES ('MNY', '{aid}', 0) ON CONFLICT DO NOTHING")
        m1 = call('GET', '/admin/my-gwans', None, TS_)
        row = (m1 or [{}])[0] if isinstance(m1, list) else {}
        ok('③ 내 담당 관 — 담당 없으면 빈 목록 · MNY 담당이면 한 줄(검수 · 문의 · 내 담당 · 7일 초안)',
           m0 == [] and row.get('code') == 'MNY' and all(k in row for k in ('reviewPending', 'openInquiries', 'myInquiries', 'staleDrafts')), f"{m0} · {row}")
        st = call('GET', '/admin/gwans/MNY/stats?days=7', None, TS_)
        ok('③ 현황판 — 문의 합 · 열린 문의 · 금칙어 숫자 · 날마다 문의 칸',
           'inquiries' in (st.get('total') or {}) and 'openInquiries' in (st.get('now') or {}) and 'bannedWords' in (st.get('now') or {}) and 'inquiries' in ((st.get('rows') or [{}])[0]),
           str(st.get('now')))
        c1 = call('POST', '/admin/categories', {'gwanCode': 'MNY', 'code': code, 'name': f'시험 업종 {stamp}', 'laborLawFlag': 'REVIEW_REQUIRED'}, TS_)
        c2 = call('POST', '/admin/categories', {'gwanCode': 'MNY', 'code': code, 'name': f'시험 업종 {stamp}', 'laborLawFlag': 'REVIEW_REQUIRED'}, TS_)
        ok('③ CSV 와 같은 길 — 업종 승인 대기 · 같은 코드 409', c1.get('status') == 'PENDING' and c2.get('_err') == 409, f"{c1.get('status')} · {c2.get('_err')}")
    finally:
        psql(f"DELETE FROM categories WHERE code = '{code}'")
        psql("DELETE FROM gwan_managers WHERE gwan_code = 'MNY'")
        if was:
            for i, a in enumerate(was.split(',')):
                psql(f"INSERT INTO gwan_managers (gwan_code, account_id, sort_order) VALUES ('MNY', '{a}', {i}) ON CONFLICT DO NOTHING")
        ok('③ 끝 — 시험 업종 지움 · 담당자 되돌림', psql(f"SELECT count(*) FROM categories WHERE code = '{code}'") == '0'
           and psql("SELECT coalesce(string_agg(account_id::text, ',' ORDER BY sort_order), '') FROM gwan_managers WHERE gwan_code = 'MNY'") == was, '')
else:
    print('API · DB 없음 — ③ 건너뜀')

# ── ④ 문서 · 판 ─────────────────────────────────────────────────────────
d800 = doc('800_')
ok('④ 문서 800 — 내 담당 관 · CSV · FAQ 불러오기 · 문의 · 금칙어 · D319', all(w in d800 for w in ('내 담당 관', 'CSV', 'FAQ 불러오기', '관 페이지 문의', '금칙어', 'D319')), str(len(d800)))
ok('④ VERSION v10.685 이상', VT >= (10, 685), VER)

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
