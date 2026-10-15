"""사용자 웹 미들웨어의 같은 출처(CSRF) 판정 검증 (10/2, G-18).

  SITE=http://localhost:5174 API=http://localhost:3000/api/v1 python3 csrf_check.py
결과: csrf_check.json
"""
import json, os, urllib.request, urllib.error
from urllib.parse import urlparse

SITE = os.environ.get('SITE', 'http://localhost:5174').rstrip('/')
API = os.environ.get('API', 'http://localhost:3000/api/v1').rstrip('/')
R = []

def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print(('ok  ' if ok else 'FAIL'), step, '' if ok else detail)

def post(path, headers):
    h = {'Content-Type': 'application/json'}; h.update(headers)
    req = urllib.request.Request(SITE + path, data=b'{}', headers=h, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return r.status, r.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()

ads = json.load(urllib.request.urlopen(API + '/ads/serve?slot=HERO', timeout=30))
ad = (ads[0] if isinstance(ads, list) else ads).get('id')
P = f'/api/v1/ads/{ad}/impression'
host = urlparse(SITE).netloc

st, b = post(P, {'Origin': SITE})
rec('C-1 브라우저 주소와 같은 Origin → 통과', st < 400 and 'CSRF' not in b, (st, b[:80]))
st, b = post(P, {'Origin': 'https://evil.example'})
rec('C-2 다른 사이트 Origin → 403 CSRF', st == 403 and 'CSRF' in b, (st, b[:80]))
st, b = post(P, {'Origin': f'http://{host}.evil.example'})
rec('C-3 호스트 이름 앞부분만 같은 Origin → 403', st == 403, (st, b[:80]))
st, b = post(P, {'Origin': 'null'})
rec('C-4 Origin: null → 403', st == 403, (st, b[:80]))
st, b = post(P, {'Origin': 'https://sogaebank.example', 'Host': 'sogaebank.example'})
rec('C-5 앞단이 HTTPS 를 끊는 운영(Origin https://도메인 · Host 도메인) → 통과', st < 400 and 'CSRF' not in b, (st, b[:80]))
st, b = post(P, {'Origin': 'https://sogaebank.example', 'X-Forwarded-Host': 'sogaebank.example'})
rec('C-6 앞단이 넘긴 X-Forwarded-Host 와 같은 Origin → 통과', st < 400 and 'CSRF' not in b, (st, b[:80]))
st, b = post(P, {})
rec('C-7 Origin 없는 요청(서버 간 호출) → 기존대로 통과', st < 400, (st, b[:80]))

json.dump(R, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'csrf_check.json'), 'w'), ensure_ascii=False, indent=1)
print(f"통과 {sum(r['ok'] for r in R)} / {len(R)}")
