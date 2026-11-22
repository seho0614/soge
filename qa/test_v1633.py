"""v10.633 (docs/777) 매물 CSV 일괄 등록 미리보기만 본문 300KB
  ① (코드) security-headers.ts 이 주소에만 300KB · 이름 감싼 함수(lsqBulkBody) · 413 · 400 · 영어 글 · 문서 777 · 판
  ② (API) 로그인 토큰 받음(본문 읽기 함정) · 150KB CSV → 413 아님(꺼져 있으면 409 LSQ_BULK_OFF · 켜져 있으면 판정) · 310KB → 413 PAYLOAD_TOO_LARGE ·
     다른 주소 120KB → 413(그대로 100KB)
  (저장되지 않는 요청만 — 두 번 돌아도 통과)
"""
import json, os, re, sys, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb' if os.path.isdir(KIT + '/sgb') else KIT
API = os.environ.get('API') or ''
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
SH = rd('src/common/security-headers.ts'); EN = rd('src/common/i18n/server-text.en.ts')

# ── ① 코드 ─────────────────────────────────────────────
ok('① security-headers — 이 주소만 300KB · 이름 감싼 함수 · express.json 을 그대로 app.use 하지 않음',
   "const parseBulkJson = express.json({ limit: '300kb' });" in SH and "app.use('/api/v1/lsq/me/bulk/preview'," in SH
   and 'function lsqBulkBody(req: Request, res: Response, next: NextFunction) { parseBulkJson(req, res, next); }' in SH
   and not re.search(r"app\.use\([^)]*express\.json\(", SH))
ok('① 넘으면 413 PAYLOAD_TOO_LARGE · 깨지면 400 · 영어 글 2줄',
   "res.status(413).json({ code: 'PAYLOAD_TOO_LARGE'" in SH and "res.status(400).json({ code: 'VALIDATION_ERROR'" in SH
   and '"보내는 글이 너무 큽니다(CSV 200KB 까지) — 나눠서 올리십시오."' in EN and '"CSV 본문을 읽지 못했습니다."' in EN)
d777 = doc('777_')
ok('① 문서 777 — 300KB · 200KB · 100KB · lsqBulkBody', all(w in d777 for w in ('300KB', '200KB', '100KB', 'lsqBulkBody')), str(len(d777)))
ok('① VERSION v10.633 이상', VT >= (10, 633), VER)

# ── ② API ─────────────────────────────────────────────
def call(m_, p, b=None, t=None, raw=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    data = raw if raw is not None else (json.dumps(b, ensure_ascii=False).encode('utf-8') if b is not None else None)
    r = urllib.request.Request(API + p, data=data, headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=120).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'details': bd.get('details')}


try:
    alive = bool(API) and urllib.request.urlopen(API + '/health', timeout=10).status == 200
except Exception:
    alive = False

if alive:
    __import__('consent_ok').agree_seed()
    tok = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW}).get('accessToken')
    ok('② buyer 로그인(전체 JSON 본문 읽기가 살아 있음)', bool(tok))
    if tok:
        row = 'MNY,카페,시험 T1633 역세권 카페 양도합니다,월 매출 안정,"평일 방문 상담",62000000,3000000,SELLER,경기도,수원시\n'
        head = 'gwan,category,title,summary,body,price,deposit,side,sido,sigungu\n'
        csv150 = head + row * (150 * 1024 // len(row.encode('utf-8')))
        r1 = call('POST', '/lsq/me/bulk/preview', {'csv': csv150[:199000], 'fileName': 't1633.csv'}, tok)
        big = b'{"csv": "' + ('가' * 106000).encode('utf-8') + b'"}'
        r2 = call('POST', '/lsq/me/bulk/preview', None, tok, raw=big)
        other = b'{"enabled": "' + ('a' * 125000).encode('utf-8') + b'"}'
        r3 = call('PUT', '/me/grw/digest', None, tok, raw=other)
        ok('② 150KB 남짓 CSV → 본문은 받음(413 · 500 아님 · 꺼짐 409 또는 판정)',
           r1.get('_err') not in (413, 500) and (r1.get('_err') in (409, 422) or 'jobId' in r1), f"{len(csv150[:199000].encode('utf-8'))} {json.dumps(r1, ensure_ascii=False)[:160]}")
        ok('② 310KB → 413 PAYLOAD_TOO_LARGE', r2.get('_err') == 413 and r2.get('code') == 'PAYLOAD_TOO_LARGE', json.dumps(r2, ensure_ascii=False)[:160])
        ok('② 다른 주소 120KB → 413(그대로 100KB · 500 아님)', r3.get('_err') == 413 and r3.get('code') == 'PAYLOAD_TOO_LARGE', json.dumps(r3, ensure_ascii=False)[:160])
else:
    print('  (API 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
