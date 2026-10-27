"""v10.125 시험 — API 오류 · 안내 글의 영어(단계 A · 회원 화면 · docs/189)

  KIT=$K API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb python3 -I test_v1125.py

  ① 코드 — 사전(server-text.en.ts) · 옮기는 함수(고정 글 · 값 자리 · 자리 안의 글도) · 응답 출구(사본을 옮김 · /admin 건너뜀) · 오류 출구(main.ts · dev-server.js 둘 다)
     · 언어 켜짐 확인(langIfActive) · 사용자 웹 /my/intro 가 글자 대신 registered 로 · 판
  ② 사전 — 단계 A 모듈(회원 화면)의 한국어 오류 · 안내 글이 모두 영어로 있음 · 자리 수 같음 · 영어에 한글 없음 · 전체 남은 수(단계 B · C 몫)
  ③ (API) 영어 켜고 — 오류(고정 · 값 자리) · 안내가 영어 · 한국어 요청은 원문 · 끄면 원문 · 운영 화면 경로는 원문 — 끝나면 원래대로
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from srv_text_extract import extract

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB')
RES = []
A = {'identity', 'me', 'listing', 'request', 'deal', 'market', 'billing', 'community', 'introducer', 'review', 'public', 'catalog', 'search', 'file',
     'settlement', 'common', 'core', 'ai', 'realty'}


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


def psql(sql):
    return subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True).stdout.strip()


# ① 코드
ST = rd('src/common/i18n/server-text.ts'); IC = rd('src/modules/i18n/server-text.interceptor.ts'); F = rd('src/common/db-error.filter.ts')
ok('① 옮기는 함수 — 한글 없으면 그대로 · 사전에 없으면 원문 · 값 자리 · 자리 안의 글도 옮김 · 안내 칸 5개',
   "if (hit != null) return text === t ? hit : text.replace(t, hit);" in ST and "text.length > 500" in ST and "serverText((m[Number(i) + 1] ?? '').trim(), lang, depth + 1)" in ST and "new Set(['note', 'warning', 'reason', 'message', 'notice'])" in ST, '')
ok('① 응답 출구 — /admin 건너뜀 · 사본을 옮김(캐시 객체 보호) · 등록', "/^\\/api\\/v1\\/admin(\\/|\\?|$)/" in IC and 'structuredClone(body)' in IC and 'proto !== Object.prototype) return body;' in IC
   and 'ServerTextInterceptor' in rd('src/app.module.ts'), '')
ok('① 오류 출구 — 언어 켜짐 확인 뒤 message 만 · /admin 건너뜀 · main.ts · dev-server.js 둘 다 I18nService 를 넘김',
   'serverText(body.message, l)' in F and 'if (!res.headersSent)' in F and "/^\\/api\\/v1\\/admin" in F and 'new DbErrorFilter(app.get(I18nService))' in rd('src/main.ts')
   and 'new DbErrorFilter(app.get(I18nService))' in rd('scripts/dev-server.js') and 'async langIfActive(' in rd('src/modules/i18n/i18n.service.ts'), '')
ok('① 사용자 웹 /my/intro — 서버 글 대신 registered 로 갈래', "matchedRes?.registered === false ? t('intro.regToMatch')" in rd('site/src/app/my/intro/page.tsx')
   and "note.startsWith('지금은')" not in rd('site/src/app/my/intro/page.tsx'), '')
ok('① 판 v10.125 이상', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 125), rd('VERSION').strip())

# ② 사전
D = {}
for m in re.finditer(r'^  ("(?:[^"\\]|\\.)*"): ("(?:[^"\\]|\\.)*"),$', rd('src/common/i18n/server-text.en.ts'), re.M):
    D[json.loads(m.group(1))] = json.loads(m.group(2))
rows = extract(K)
keys_a = {x['key'] for x in rows if x['module'] in A and re.search('[가-힣]', re.sub(r'\{\d+\}', '', x['key']))}
miss = sorted(keys_a - set(D))
ok(f'② 단계 A 모듈의 오류 · 안내 글 {len(keys_a)}종이 모두 사전에', keys_a and not miss, ' | '.join(miss[:3]))
badp = [k for k, v in D.items() if sorted(re.findall(r'\{\d+\}', k)) != sorted(re.findall(r'\{\d+\}', v))]
ok(f'② 사전 {len(D)}문장 — 자리 수 같음 · 영어에 한글 없음', D and not badp and not any(re.search('[가-힣]', v) for v in D.values()), ' | '.join(badp[:3]))
allk = {x['key'] for x in rows if re.search('[가-힣]', re.sub(r'\{\d+\}', '', x['key']))}
left = allk - set(D)
by = {}
for x in rows:
    if x['key'] in left: by.setdefault(x['module'], set()).add(x['key'])
print('   남은 문장(단계 B · C · 운영 화면):', len(left), ' · '.join(f'{m} {len(v)}' for m, v in sorted(by.items(), key=lambda kv: -len(kv[1]))[:10]))


def call(m, p, b=None, h=None, t=None):
    hd = {'content-type': 'application/json', **(h or {}), **({'Authorization': 'Bearer ' + t} if t else {})}
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m)
    try: return json.load(urllib.request.urlopen(r, timeout=60))
    except urllib.error.HTTPError as e:
        try: return json.loads(e.read().decode('utf-8', 'replace'))
        except Exception: return {}


if API and DB:
    T = call('POST', '/auth/login', {'email': 'intro@x.com', 'password': 'sgb-dev-1234'})['accessToken']
    EN = {'X-Lang': 'en'}
    NF = '/listings/00000000-0000-4000-a000-000000000000'
    before = psql("SELECT (SELECT value FROM site_settings WHERE key='i18n.enabled') || '|' || (SELECT is_active FROM i18n_langs WHERE code='en')")
    try:
        psql("UPDATE site_settings SET value='on' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active=true WHERE code='en';")
        time.sleep(31)   # 설정 기억(30초)
        e1, k1 = call('GET', NF, h=EN), call('GET', NF)
        ok('③ 오류(고정 글) — 영어 요청은 영어 · 한국어 요청은 원문 · 코드는 같음', e1.get('message') == 'Listing not found.' and k1.get('message') == '매물을 찾을 수 없습니다.' and e1.get('code') == k1.get('code'),
           f"{e1.get('message')} · {k1.get('message')}")
        e2 = call('GET', NF, h={'Cookie': 'sgb_lang=en'})
        ok('③ 오류 — 브라우저가 직접 부를 때(언어 쿠키)도 영어', e2.get('message') == 'Listing not found.', str(e2.get('message')))
        n1, n0 = call('GET', '/me/introducer/activity', h=EN, t=T).get('note'), call('GET', '/me/introducer/activity', t=T).get('note')
        ok('③ 안내(note) — 영어 · 한국어 원문 · 응답 몸통은 다른 칸 그대로', (n0 is None and n1 is None) or (n1 == D.get(n0) and n0 != n1), f'{n1} · {n0}')
        r = call('POST', '/me/introducer/respond', {'requestId': 'x', 'answer': 'NOPE'}, h=EN, t=T)
        ok('③ 오류(형식 · 정책) — 사전에 있으면 영어 · 없으면 원문(빈칸 없음)', isinstance(r.get('message'), str) and r.get('message'), str(r.get('message'))[:60])
        AD = '/admin/i18n/catalog?targetType=NOTICE&lang=en'   # 운영 권한이 없는 계정 → 403 「권한이 없습니다.」(사전에 있는 글)
        ad = call('GET', AD, h=EN, t=T)
        ok('③ 운영 화면 경로(/admin)는 사전에 있는 글이어도 옮기지 않음', ad.get('code') == 'FORBIDDEN' and ad.get('message') == '권한이 없습니다.' and D.get('권한이 없습니다.'), str(ad.get('message')))
        psql("UPDATE site_settings SET value='off' WHERE key='i18n.enabled';")
        time.sleep(31)
        ok('③ 다국어 꺼짐이면 영어 요청도 원문', call('GET', NF, h=EN).get('message') == '매물을 찾을 수 없습니다.', '')
    finally:
        en0, act0 = (before.split('|') + ['off', 'f'])[:2]
        psql(f"UPDATE site_settings SET value='{en0 or 'off'}' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active={'true' if act0 == 't' else 'false'} WHERE code='en';")

n = sum(1 for r in RES if r[0])
print(f'결과: {n} / {len(RES)}')
raise SystemExit(0 if n == len(RES) else 1)
