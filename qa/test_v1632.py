"""v10.632 (docs/776) 도움말 저장 크기(KB) · HELP_TOO_BIG · 413 PAYLOAD_TOO_LARGE
  ① (코드) HELP_MAX_BYTES 95KB · helpTooBig 를 설명서 · 운영 화면 도움말 저장이 함께 씀 · 읽기 응답 maxBytes · bytes ·
     db-error.filter 413 · 영어 글 · 두 화면 KB 표시 · 저장 막음 · 문서 776 · 판
  ② (API) 운영 화면 도움말(4만 자 한도) 한글 32,800자(약 98KB) → 422 HELP_TOO_BIG(글자 한도 안) · 120KB 본문 → 413 PAYLOAD_TOO_LARGE(500 아님) ·
     읽기 maxBytes 97280 · 판 수 그대로(저장 안 됨)
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
HS, TH = rd('src/modules/help/help.service.ts'), rd('src/modules/sec2/tab-help.ts')
FL, EN = rd('src/common/db-error.filter.ts'), rd('src/common/i18n/server-text.en.ts')
HM, SH = rd('web/src/app/admin/HelpManual.tsx'), rd('web/src/app/admin/ScxHelp.tsx')

# ── ① 코드 ─────────────────────────────────────────────
ok('① help.service — HELP_MAX_BYTES = 95 * 1024 · helpTooBig(HELP_TOO_BIG · bytes · maxBytes) · 설명서 저장이 부름 · 읽기 maxBytes · bytes',
   'export const HELP_MAX_BYTES = 95 * 1024;' in HS and "new PolicyViolation('HELP_TOO_BIG'" in HS and "helpTooBig(text, '설명서');" in HS
   and 'maxBytes: HELP_MAX_BYTES' in HS and 'bytes: helpBytes(r.body)' in HS)
ok('① tab-help — 운영 화면 도움말 저장도 helpTooBig · 읽기 maxBytes · bytes',
   "helpTooBig(text, '도움말');" in TH and 'maxBytes: HELP_MAX_BYTES' in TH and 'bytes: helpBytes(d.body)' in TH
   and "import { HelpService, HELP_MAX_BYTES, helpBytes, helpTooBig } from '../help/help.service';" in TH)
msg = '보내는 글이 너무 큽니다(100KB 까지) — 줄이거나 나눠서 저장하십시오.'
ok('① db-error.filter — entity.too.large · 413 → 413 PAYLOAD_TOO_LARGE · 영어 글',
   "(err as any)?.type === 'entity.too.large'" in FL and "send(413, { code: 'PAYLOAD_TOO_LARGE'" in FL and f'"{msg}"' in EN)
ok('① 두 화면 — KB 표시(data-help-bytes · data-scx-help-size) · 넘으면 저장 막음(TextEncoder)',
   'data-help-bytes={bytes}' in HM and 'const big = bytes > maxBytes;' in HM and 'const over = chars > maxChars || big;' in HM
   and 'data-scx-help-size={b}' in SH and SH.count('new TextEncoder().encode(') >= 2)
d776 = doc('776_')
ok('① 문서 776 — HELP_TOO_BIG · PAYLOAD_TOO_LARGE · 95KB · 100KB', all(w in d776 for w in ('HELP_TOO_BIG', 'PAYLOAD_TOO_LARGE', '95KB', '100KB')), str(len(d776)))
ok('① VERSION v10.632 이상', VT >= (10, 632), VER)


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
    __import__('consent_ok').agree('admin@x.com', PW)
    tok = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    ok('② SUPER 로그인', bool(tok))
    if tok:
        g0 = call('GET', '/admin/help/guide', None, tok)
        m0 = call('GET', '/admin/help/manual', None, tok)
        text = '### 시험 절 T1632\n' + ('가나다라마바사아자차' * 3300)[:32800]
        nbytes = len(text.encode('utf-8'))
        s1 = call('POST', '/admin/help/guide', {'body': text, 'note': '시험 T1632'}, tok)
        big = b'{"body": "' + ('가' * 41000).encode('utf-8') + b'"}'
        s2 = call('POST', '/admin/help/guide', None, tok, raw=big)
        g1 = call('GET', '/admin/help/guide', None, tok)
        ok('② 읽기 — maxBytes 97280(도움말 · 설명서) · 지금 판 bytes',
           g0.get('maxBytes') == 97280 and m0.get('maxBytes') == 97280 and isinstance((g0.get('current') or {}).get('bytes'), int),
           f"{g0.get('maxBytes')} {m0.get('maxBytes')} {(g0.get('current') or {}).get('bytes')}")
        ok('② 한글 32,800자(약 98KB · 4만 자 안) → 422 HELP_TOO_BIG(bytes · maxBytes)',
           s1.get('_err') == 422 and s1.get('code') == 'HELP_TOO_BIG' and (s1.get('details') or {}).get('maxBytes') == 97280 and nbytes > 97280 and len(text) < 40000,
           f"{nbytes} {json.dumps(s1, ensure_ascii=False)[:160]}")
        ok('② 120KB 본문 → 413 PAYLOAD_TOO_LARGE(500 아님)', s2.get('_err') == 413 and s2.get('code') == 'PAYLOAD_TOO_LARGE', json.dumps(s2, ensure_ascii=False)[:160])
        ok('② 판 수 그대로(저장 안 됨)', len(g1.get('versions') or []) == len(g0.get('versions') or []) and (g1.get('current') or {}).get('version') == (g0.get('current') or {}).get('version'),
           f"{len(g0.get('versions') or [])} → {len(g1.get('versions') or [])}")
else:
    print('  (API 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
