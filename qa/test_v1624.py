"""v10.624 (docs/767) GROUPS 로 바꾸기 전 점검표 — 「판정 방식」 상자(직원 · 권한 › 업무별 권한)
  ① (코드) perm-mode.ts modeView checklist 5줄(꼭 3 · 권장 2) · compareHours · enforce · groupsReady 는 꼭 3줄 그대로(서버가 막는 조건 안 바뀜) ·
     StaffPerm.tsx 점검표 · 권장 줄 아직이면 GROUPS 전 한 번 더 물음 · 문서 767 · 판
  ② (API 가 있을 때) SUPER GET /admin/perm/mode — checklist 키 5개 · need 꼭 3 · groupsReady = 꼭 3줄 모두 통과와 같음 · 회원 403
  (읽기만 — 두 번 돌아도 통과)
"""
import json, os, re, sys, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb' if os.path.isdir(KIT + '/sgb') else KIT
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
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


PM, SP = rd('src/modules/admin/perm-mode.ts'), rd('web/src/app/admin/StaffPerm.tsx')
KEYS = ('unmapped', 'diff24', 'roleChecks', 'compare24', 'enforceOn')
ok('① modeView — checklist 5줄 · compareHours · enforce · groupsReady 조건 그대로',
   all(f"key: '{k}'" in PM for k in KEYS) and 'checklist, compareHours, enforce:' in PM
   and 'groupsReady: um.unmapped === 0 && d.diff24 === 0 && PGX_OPEN.length === 0' in PM, '')
ok('① 화면 — 점검표(data-perm-mode-check · data-perm-check) · 권장 아직이면 GROUPS 전 confirm',
   'data-perm-mode-check=' in SP and 'data-perm-check={c.key}' in SP and "to === 'GROUPS' ? (m.data?.checklist ?? []).filter((c) => !c.need && !c.ok)" in SP, '')
D = doc('767_')
ok('① 문서 767 — 점검표 · COMPARE · 24시간', all(w in D for w in ('점검표', 'COMPARE', '24시간')), str(len(D)))
VER = rd('VERSION').strip()
ok('① VERSION v10.624 이상', tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 624), VER)


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=120).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code')}


try:
    urllib.request.urlopen(API + '/health', timeout=10).read()
    alive = True
except Exception:
    alive = False
if alive:
    __import__('consent_ok').agree_seed()
    lg = lambda e: call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')
    TS, TB = lg('admin@x.com'), lg('buyer@x.com')
    v = call('GET', '/admin/perm/mode', None, TS)
    cl = v.get('checklist') or []
    got = {c.get('key'): c for c in cl}
    need_ok = all(got.get(k, {}).get('ok') for k in ('unmapped', 'diff24', 'roleChecks'))
    ok('② SUPER — checklist 키 5개 · 꼭 3 · groupsReady = 꼭 3줄 통과',
       tuple(got) == KEYS and sum(1 for c in cl if c.get('need')) == 3 and bool(v.get('groupsReady')) == need_ok and 'compareHours' in v,
       json.dumps({k: (c.get('ok'), c.get('detail')) for k, c in got.items()}, ensure_ascii=False)[:200])
    b = call('GET', '/admin/perm/mode', None, TB)
    ok('② 회원 403', b.get('_err') == 403, str(b)[:80])
else:
    print('  (API 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
