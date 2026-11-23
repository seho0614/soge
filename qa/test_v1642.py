"""v10.642 (docs/786) 관 설정 › 오픈 점검 — 허브 관 · 리드관 「업종 1종 이상 승인」 표시
  ① (코드) 관 상세 API(site.service gwans) 에 isHub · childGwans · childCategories · consultCategories · DTO · 운영 화면 categoryCheck ·
     오픈 체크리스트(admin-v31 gwanOpenCheck) 허브 = 해당 없음 · 리드관 = 안심소개 상담 축(MAL · CONSULT) — fn_gwan_open_guard · updateGwan 과 같은 기준
  ② (API) GET /admin/gwans/EARN — isHub · 하위 관 수 = DB · GET /admin/gwans/LED — consultCategories = DB 상담 업종 수 · 다른 관은 null
     GET /admin/gwans/EARN/open-check — CATEGORY · FEE_BEARER 통과 「해당 없음 — 허브 관」 · LED — 「상담 업종 N종」
  ③ 문서 786 · 판
  (읽기만 · 두 번 돌아도 통과)
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb' if os.path.isdir(KIT + '/sgb') else KIT
API = os.environ.get('API'); DB = os.environ.get('DB')
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

SS, DT, SH, GS, AV = (rd('src/modules/site/site.service.ts'), rd('src/modules/site/site.dto.ts'), rd('web/src/app/admin/gwans/shared.ts'),
                      rd('web/src/app/admin/gwans/GwanSettings.tsx'), rd('src/modules/admin/admin-v31.service.ts'))
ok('① 관 상세 — childGwans · childCategories · LED 만 consultCategories(MAL · CONSULT) · DTO 4칸',
   all(w in SS for w in ('AS "childGwans"', 'AS "childCategories"', "CASE WHEN g.code = 'LED'", "c.axis='CONSULT'", 'AS "consultCategories"'))
   and all(w in DT for w in ('isHub!: boolean', 'childGwans!: number', 'childCategories!: number', 'consultCategories!: number | null')), '')
ok('① 운영 화면 — categoryCheck(허브 해당 없음 · 리드관 상담 업종) 를 오픈 점검 · 업종 탭에서 씀',
   'export function categoryCheck(g: Gwan)' in SH and '해당 없음 — 허브 관' in SH and "['업종 1종 이상 승인', ...categoryCheck(g)]" in GS and 'data-cat-basis=' in GS, '')
ok('① 오픈 체크리스트 — 리드관은 MAL · CONSULT 로 셈 · 허브는 CATEGORY · FEE_BEARER 해당 없음(통과)',
   "($1 = 'LED' AND gwan_code = 'MAL' AND axis = 'CONSULT')" in AV and 'const hub = !!g.isHub' in AV and "detail: '해당 없음 — 허브 관'" in AV and '상담 업종 ${n(\'cats\')}종' in AV, '')

if API and DB:
    T = login('admin@x.com')
    e, l, m = call('GET', '/admin/gwans/EARN', None, T), call('GET', '/admin/gwans/LED', None, T), call('GET', '/admin/gwans/MNY', None, T)
    kids = psql("SELECT count(*) FROM gwans WHERE parent_code = 'EARN'")
    kcat = psql("SELECT count(*) FROM categories c JOIN gwans g ON g.code = c.gwan_code WHERE g.parent_code = 'EARN' AND c.status = 'APPROVED'")
    lc = psql("SELECT count(*) FROM categories WHERE gwan_code = 'MAL' AND axis = 'CONSULT' AND status = 'APPROVED'")
    ok('② GET /admin/gwans/EARN — isHub · 하위 관 · 하위 승인 업종 = DB', e.get('isHub') is True and str(e.get('childGwans')) == kids and str(e.get('childCategories')) == kcat,
       f"{e.get('isHub')} {e.get('childGwans')}/{kids} {e.get('childCategories')}/{kcat} {e.get('_err')}")
    ok('② GET /admin/gwans/LED — consultCategories = 상담 축 승인 업종 · MNY 는 null', str(l.get('consultCategories')) == lc and m.get('consultCategories') is None and 'consultCategories' in m,
       f"{l.get('consultCategories')}/{lc} · {m.get('consultCategories', '없음')}")
    oe, ol = call('GET', '/admin/gwans/EARN/open-check', None, T), call('GET', '/admin/gwans/LED/open-check', None, T)
    ce = {c['key']: c for c in oe.get('checks', [])}; cl = {c['key']: c for c in ol.get('checks', [])}
    ok('② 오픈 체크리스트 EARN — 업종 · 부담 주체 통과(해당 없음 — 허브 관)', ce.get('CATEGORY', {}).get('ok') is True and '해당 없음 — 허브 관' in ce.get('CATEGORY', {}).get('detail', '')
       and ce.get('FEE_BEARER', {}).get('ok') is True, str(ce.get('CATEGORY')) + str(oe.get('_err', '')))
    ok('② 오픈 체크리스트 LED — 「상담 업종 N종」 · 통과 여부 = 상담 업종 있음', cl.get('CATEGORY', {}).get('detail', '').startswith(f'상담 업종 {lc}종') and cl.get('CATEGORY', {}).get('ok') == (int(lc or 0) > 0),
       str(cl.get('CATEGORY')))
else:
    print('API · DB 없음 — ② 건너뜀')

d786 = doc('786_')
ok('③ 문서 786 — 허브 · 리드관 · 해당 없음', all(w in d786 for w in ('허브', '리드관', '해당 없음', 'MAL · CONSULT')), str(len(d786)))
ok('③ VERSION v10.642 이상', VT >= (10, 642), VER)

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
