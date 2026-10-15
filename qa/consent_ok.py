"""v10.28 (재동의) — 화면 시험이 로그인하기 전에 그 회원의 필수 약관 동의를 마쳐 둡니다.

사이트는 필수 약관(새 판 포함)에 동의하지 않은 회원을 로그인 직후 · 로그인이 필요한 화면에서 동의 화면(/terms/agree)으로 보냅니다(10/9 답).
시험 회원은 대부분 API 로 가입하면서 동의 목록을 보내지 않거나(빈 목록), v10.28 의 새 판(D041) 전에 동의해 있어 동의 화면으로 갑니다 —
그 화면을 시험하는 것(fix_1028_ui G)이 아니면, 실제 회원이 동의 화면에서 하는 것과 같은 일(필수 약관 동의 · API)을 먼저 해 둡니다.
쓰는 법(화면 로그인 바로 앞):  __import__('consent_ok').agree(email, password)
API 주소는 환경 값 API(…/api/v1 이든 아니든) — 없으면 http://localhost:3000. 실패해도 시험을 멈추지 않습니다(그 뒤 화면 단계가 판정).
"""
import json, os, urllib.request

def _base():
    a = (os.environ.get('API') or 'http://localhost:3000').rstrip('/')
    return a if a.endswith('/api/v1') else a + '/api/v1'

def _call(m, p, tok=None, body=None):
    h = {'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 consent_ok'}
    if tok: h['authorization'] = 'Bearer ' + tok
    req = urllib.request.Request(_base() + p, method=m, data=json.dumps(body).encode() if body is not None else None, headers=h)
    with urllib.request.urlopen(req, timeout=20) as r: return json.loads(r.read() or b'null')

def agree(email, password):
    """그 회원이 아직 동의하지 않은 필수 약관에 동의(동의 기록 한 줄씩). 동의한 약관 코드 목록을 돌려줍니다."""
    try:
        tok = (_call('POST', '/auth/login', body={'email': email, 'password': password}) or {}).get('accessToken')
        if not tok: return []
        items = [{'code': t['code'], 'agreed': True} for t in (_call('GET', '/terms/required', tok) or []) if t.get('isRequired') and not t.get('agreed')]
        if items: _call('POST', '/terms/agree', tok, {'items': items})
        return [i['code'] for i in items]
    except Exception:
        return []
