"""v10.647 ~ 649 (D310 · docs/792) 새 관 후속 — 주소 표시 · 관 이름 번역 · 시세 · 공급처 · 메인 카드 · CSV 대량 등록
  ① (코드) 운영 화면 주소 표시(서브도메인 대신 /g/<코드>) · D310 번역 대상 GWAN · 서버 · 번역 화면 · 공개 /gwans 번역 · 시세 · 공급처 · 메인 카드 · CSV
  ② (DB) 번역 대상 CHECK 에 GWAN · fn_i18n_source('GWAN', 'MNY', 'name') = 관 이름
  ③ (API) GET /admin/i18n/catalog?targetType=GWAN · 공개 /gwans(isHub)
  ④ 문서 792 · 판
  (읽기만 — 두 번 돌아도 같음)
"""
import json, os, re, subprocess, sys, urllib.error, urllib.request
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

VER = rd('VERSION').strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))
MG = rd('prisma/migrations/D310_i18n_gwan_name/migration.sql')
GL, GS, GN = rd('web/src/app/admin/gwans/GwanList.tsx'), rd('web/src/app/admin/gwans/GwanSettings.tsx'), rd('web/src/app/admin/gwans/GwanNew.tsx')
IS, IC, TR, CS = rd('src/modules/i18n/i18n.service.ts'), rd('src/modules/i18n/i18n.controller.ts'), rd('web/src/app/admin/Translations.tsx'), rd('src/modules/catalog/catalog.service.ts')
PS, SU, SI = rd('site/src/app/price-stats/page.tsx'), rd('site/src/app/supplier/page.tsx'), rd('site/src/app/supplier/[id]/page.tsx')
HV, SC, BK = rd('site/src/components/home/HomeView.tsx'), rd('site/src/components/home/Sections.tsx'), rd('src/modules/lsq/bulk.ts')

ok('① 주소 표시 — 서브도메인 대신 사용자 웹 주소(/g/<코드>) · 허브 주소 없음',
   '.sogaebank.com`' not in GL and 'g/${c.toLowerCase()}' in GL and '사용자 웹 주소' in GS and 'GWAN_WEB_PATH' in GS and '서브도메인' not in GN, '')
ok('① D310 — 번역 대상 GWAN · fn_i18n_source GWAN · 앞 판(D130) 상호 그대로 · 지우는 문장 없음',
   "'GWAN'" in MG and "'legal.direct_notice','footer.company_name'" in MG and "WHEN 'GWAN' THEN" in MG and "WHEN 'GWAN_FORM' THEN" in MG and not re.search(r'\b(DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN)\b', MG, re.I), str(len(MG)))
ok('① 관 이름 번역 — 서버 칸 · 원문 목록 · 대상 목록 · 번역 화면 · 공개 /gwans 덮어씀',
   "GWAN: ['name', 'description']" in IS and "GWAN: { from: 'gwans s'" in IS and "'GWAN'];" in IC and "GWAN: '관 이름'" in TR and "'AD_PLACEMENT', 'GWAN'] as const" in TR
   and "overlay(rows as Array<Record<string, any>>, 'GWAN'" in CS, '')
ok('① 시세 · 공급처 · 메인 카드 · CSV 대량 등록에 켠 새 관',
   'extra.map((g) => <option' in PS and 'const extra = q.gwan && !GWAN[q.gwan]' in SU and 'const back =' in SI
   and ('extra={_gwans.filter(' in HV or 'extra={newCards(_gwans' in HV) and 'more.map((g) =>' in SC and "NOT is_hub AND code NOT IN ('HLT', 'LED')" in BK, '')

if API and DB:
    ck = psql("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'content_translations_target_type_check'")
    src = psql("SELECT src FROM fn_i18n_source('GWAN', 'MNY', 'name')")
    nm = psql("SELECT name FROM gwans WHERE code = 'MNY'")
    ok('② DB — 번역 대상 CHECK 에 GWAN · fn_i18n_source(GWAN, MNY, name) = 관 이름', "'GWAN'" in ck and src == nm and nm != '', f'{src} · {nm}')
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    cat = call('GET', '/admin/i18n/catalog?targetType=GWAN&lang=en&size=50', None, T_)
    items = cat.get('items', []) if isinstance(cat, dict) else []
    pub = call('GET', '/gwans')
    ok('③ API — 번역 원문 목록 GWAN(MNY 있음) · 공개 /gwans 200 · isHub 칸',
       any('MNY' in json.dumps(x, ensure_ascii=False) for x in items) and isinstance(pub, list) and pub and 'isHub' in pub[0],
       f"{len(items)} · {cat.get('_err', '') if isinstance(cat, dict) else ''} · {len(pub) if isinstance(pub, list) else pub}")
else:
    print('API · DB 없음 — ② · ③ 건너뜀')

d792 = doc('792_')
ok('④ 문서 792 — 사용자 웹 주소 · 관 이름 · D310', all(w in d792 for w in ('사용자 웹 주소', '관 이름', 'D310', '/g/')), str(len(d792)))
ok('④ VERSION v10.647 이상', VT >= (10, 647), VER)

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
