"""crawl_site.py 의 결과(site_crawl.json)를 한 줄로 — 쪽 수 · 응답 코드 · 스크립트 오류(pageerror) · API 실패 · 오류 문구."""
import json, sys, os
from collections import Counter
f = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'site_crawl.json')
P = json.load(open(f, encoding='utf8'))['pages']; c = Counter(str(x['status']) for x in P)
# 일부러 404 가 나야 하는 쪽 — 없는 초대 주소(/i/invalid-token-check · 역할 5) · v10.31(w1) 남의 매물 수정 화면(/listings/{id}/edit — 매물 주인 intro 말고는 404 · 주인 아님을 드러내지 않음)
EXP = lambda x: x['route'] == '/i/{token}' or (x['route'] == '/listings/{id}/edit' and x['role'] not in ('intro', 'guest'))
n404 = [x for x in P if str(x['status']) == '404']; odd = [f"{x['role']} {x['url']}" for x in n404 if not EXP(x)]
miss = [f"{x['role']} {x['url']} {x['status']}" for x in P if EXP(x) and str(x['status']) != '404']
e = [x for x in P if x['errors']]
print('쪽 %d — %s · 404 중 의도 %d(없는 초대 · 남의 매물 수정) · 뜻밖의 404 %d%s · 스크립트 오류 %d쪽 · API 실패 %d쪽 · 오류 문구 %d쪽%s' % (len(P), ' · '.join('%s %d' % kv for kv in sorted(c.items())), len(n404) - len(odd), len(odd), (' ' + str(odd[:4] + miss[:4])) if odd or miss else '', len(e), sum(1 for x in P if x['api_fail']), sum(1 for x in P if x['bad_text']),
      (' — ' + ', '.join(sorted(set('%s %s' % (x['role'], x['url']) for x in e))[:6])) if e else ''))
