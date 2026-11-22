"""v10.618 (docs/761) 참 · 거짓 입력은 모두 받은 값 그대로 검사(@StrictBoolean) — 그냥 @IsBoolean() 179곳 바꿈
  ① (코드) src 에 그냥 @IsBoolean() 0곳(strict-boolean.ts 설명 글 빼고) · @StrictBoolean() 260곳 이상 ·
     쓰는 파일은 모두 import · class-validator import 에 쓰지 않는 IsBoolean 남지 않음 · 문서 761 · 판
  ② (API 가 있을 때) PUT /me/grw/digest — enabled "false"(글자) → 400 VALIDATION_ERROR · enabled false(참 · 거짓) → 400 아님
     (예전에는 "false" 가 true 로 바뀌어 통과했음)
  (읽기 · 내 설정 하나만 — 두 번 돌아도 통과)
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


VER = rd('VERSION').strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))

# ── ① 코드 ─────────────────────────────────────────────
bare, strict, noimp, leftover = [], 0, [], []
for root, _, files in os.walk(os.path.join(K, 'src')):
    for fn in files:
        if not fn.endswith('.ts'):
            continue
        fp = os.path.join(root, fn)
        rel = os.path.relpath(fp, K)
        t = open(fp, encoding='utf-8').read()
        if fn == 'strict-boolean.ts':
            continue
        for i, line in enumerate(t.split('\n'), 1):
            if '@IsBoolean()' in line:
                bare.append(f'{rel}:{i}')
        n = t.count('@StrictBoolean()')
        strict += n
        if n and not re.search(r"import\s*\{[^}]*\bStrictBoolean\b[^}]*\}\s*from\s*'[./]+(?:[^']*/)?common/strict-boolean'", t):
            noimp.append(rel)
        m = re.search(r"import\s*\{([^}]*)\}\s*from\s*'class-validator'", t)
        if m and re.search(r'\bIsBoolean\b', m.group(1)) and len(re.findall(r'\bIsBoolean\b', t)) == 1:
            leftover.append(rel)
ok('① 그냥 @IsBoolean() 0곳(받은 값 그대로 검사만)', not bare, ' '.join(bare[:6]))
ok('① @StrictBoolean() 260곳 이상', strict >= 260, str(strict))
ok('① @StrictBoolean() 쓰는 파일은 모두 common/strict-boolean 을 import', not noimp, ' '.join(noimp[:6]))
ok('① class-validator import 에 쓰지 않는 IsBoolean 이 남지 않음', not leftover, ' '.join(leftover[:6]))
d761 = doc('761_')
ok('① 문서 761 — StrictBoolean · 179곳 · 400', all(w in d761 for w in ('StrictBoolean', '179', '400')), str(len(d761)))
ok('① VERSION v10.618 이상', VT >= (10, 618), VER)


# ── ② API ─────────────────────────────────────────────
def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=60).read()
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
    tok = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW}).get('accessToken')
    ok('② buyer 로그인', bool(tok))
    if tok:
        before = call('GET', '/me/grw/digest', None, tok)
        r1 = call('PUT', '/me/grw/digest', {'enabled': 'false'}, tok)
        ok('② enabled "false"(글자) → 400 VALIDATION_ERROR', r1.get('_err') == 400 and r1.get('code') == 'VALIDATION_ERROR', json.dumps(r1, ensure_ascii=False)[:160])
        r2 = call('PUT', '/me/grw/digest', {'enabled': False}, tok)
        ok('② enabled false(참 · 거짓) → 입력 검사 통과(400 아님)', r2.get('_err') != 400, json.dumps(r2, ensure_ascii=False)[:160])
        after = call('GET', '/me/grw/digest', None, tok)
        ok('② 설정 읽기 정상(500 없음)', after.get('_err') is None and before.get('_err') is None, json.dumps(after, ensure_ascii=False)[:120])
else:
    print('  (API 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
