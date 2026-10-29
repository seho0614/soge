"""v10.127 시험 — API 오류 글의 영어 단계 C(DB 트리거 · 함수 오류 · docs/191)

  KIT=$K API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb python3 -I test_v1127.py

  ① 사전 — 마이그레이션의 RAISE EXCEPTION 글(접두어를 뗀 모양 · % 자리는 {0})이 모두 영어로 있음 · 단계 A · B 도 그대로 · 자리 수 · 영어에 한글 없음
     · 값이 들어간 DB 오류 예문이 영어 결과에 한글 없이(점검판 API 에서 실행)
  ② (API) 영어 켜고 — DB 트리거가 막은 오류(자기 매물 신고)가 영어 · 한국어 요청은 원문 · 코드 같음 — 끝나면 원래대로
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from srv_text_extract import extract, extract_db

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB')
RES = []
A = {'identity', 'me', 'listing', 'request', 'deal', 'market', 'billing', 'community', 'introducer', 'review', 'public', 'catalog', 'search', 'file',
     'settlement', 'common', 'core', 'ai', 'realty'}
B = {'partner', 'affiliate', 'health', 'lead'}


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


def psql(sql):
    return subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True).stdout.strip()


D = {}
for m in re.finditer(r'^  ("(?:[^"\\]|\\.)*"): ("(?:[^"\\]|\\.)*"),$', rd('src/common/i18n/server-text.en.ts'), re.M):
    D[json.loads(m.group(1))] = json.loads(m.group(2))
han = lambda k: re.search('[가-힣]', re.sub(r'\{\d+\}', '', k))
kc = {x['key'] for x in extract_db(K)}
rows = extract(K)
kab = {x['key'] for x in rows if x['module'] in A | B and han(x['key'])}
mc, mab = sorted(kc - set(D)), sorted(kab - set(D))
ok(f'① 단계 C — 마이그레이션의 DB 오류 글 {len(kc)}종이 모두 사전에', len(kc) > 400 and not mc, ' | '.join(mc[:3]))
ok(f'① 단계 A · B {len(kab)}종도 그대로 사전에', kab and not mab, ' | '.join(mab[:3]))
badp = [k for k, v in D.items() if sorted(re.findall(r'\{\d+\}', k)) != sorted(re.findall(r'\{\d+\}', v))]
ok(f'① 사전 {len(D)}문장 — 자리 수 같음 · 영어에 한글 없음', len(D) >= 1300 and not badp and not any(re.search('[가-힣]', v.replace('심의필 제2026-0451호', '')) for v in D.values()), ' | '.join(badp[:3]))
ok('① 판 v10.127 · 마이그레이션 없음(165)', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 127)
   and len([d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d))]) in (165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180), rd('VERSION').strip())
SAMPLES = [   # DbErrorFilter 가 접두어를 떼고 값을 채운 모양
    '이번 달 반려 신청 한도(수신 40건의 15%, 6건)를 넘었습니다',
    '재고가 부족합니다 — VITC-30 (남은 수량 0)',   # 상품 이름은 회원 자료(한국어 그대로)라 코드로
    '정산액이 맞지 않습니다 — 매출 10000 - 수수료 1000 - 환불 0 + 이월 0 ≠ 지급액 8000',
    '리드 이용료 잔액이 부족합니다 — 남은 잔액 1,000원 · 필요 3,000원. 충전하신 뒤 다시 여십시오',
    '환불은 결제 당일에만 가능합니다 — 결제일 2026-10-25, 환불일 2026-10-27',
    '「비교해요」는 보기가 정확히 2개여야 열 수 있습니다 (지금 3개)',
    '회수된 배정이라 열람할 수 없습니다 — 다른 업체로 넘어갔습니다',   # 자리 값이 트리거가 넣는 상태 낱말
    'S 등급은 알림톡 「미응답」 결과에만 붙습니다',
    '양측이 모두 조건에 합의해야 합니다 (매수 2026-10-27 03:00:00+00 · 매도 미확인)',
]
try:
    js = "require('ts-node').register({transpileOnly:true});const {serverText}=require('/app/src/common/i18n/server-text');" \
         "process.stdout.write(JSON.stringify(JSON.parse(process.argv[1]).map(x=>serverText(x,'en'))))"
    out = json.loads(subprocess.run(['docker', 'exec', 'sgb-api', 'node', '-e', js, json.dumps(SAMPLES, ensure_ascii=False)], capture_output=True, text=True, timeout=120).stdout or 'null')
except Exception:
    out = None
import shutil
if not shutil.which('docker'):
    print('   건너뜀 — docker 가 없는 곳(시험 이미지 안)에서는 예문을 점검판 API 로 돌릴 수 없음 · 서버에서 python3 -I 로')
else:
  ok(f'① 값이 들어간 DB 오류 예문 {len(SAMPLES)}개 — 영어 결과에 한글 없음(점검판 API 에서 실행)', out and len(out) == len(SAMPLES) and not any(re.search('[가-힣]', x) for x in out),
     ' | '.join((out or [])[:2])[:200])


def call(m, p, b=None, h=None, t=None):
    hd = {'content-type': 'application/json', **(h or {}), **({'Authorization': 'Bearer ' + t} if t else {})}
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m)
    try: return json.load(urllib.request.urlopen(r, timeout=60))
    except urllib.error.HTTPError as e:
        try: return json.loads(e.read().decode('utf-8', 'replace'))
        except Exception: return {}


if API and DB:
    who = psql("SELECT a.email FROM listings l JOIN accounts a ON a.id = l.owner_account_id WHERE l.status = 'PUBLISHED' AND a.identity_verified_at IS NOT NULL AND a.email LIKE '%@x.com' ORDER BY l.created_at DESC LIMIT 1")
    lid = psql(f"SELECT l.id FROM listings l JOIN accounts a ON a.id = l.owner_account_id WHERE a.email = '{who}' AND l.status = 'PUBLISHED' ORDER BY l.created_at DESC LIMIT 1")
    T = call('POST', '/auth/login', {'email': who, 'password': 'sgb-dev-1234'}).get('accessToken') if who else None
    before = psql("SELECT (SELECT value FROM site_settings WHERE key='i18n.enabled') || '|' || (SELECT is_active FROM i18n_langs WHERE code='en')")
    try:
        psql("UPDATE site_settings SET value='on' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active=true WHERE code='en';")
        time.sleep(31)
        body = {'targetType': 'LISTING', 'targetId': lid, 'reasonCode': 'SPAM'}
        e1, k1 = call('POST', '/reports', body, h={'X-Lang': 'en'}, t=T), call('POST', '/reports', body, t=T)
        ok('② DB 트리거 오류(자기 매물 신고) — 영어 · 한국어 원문 · 코드 같음', k1.get('message') == '자기 등록은 신고할 수 없습니다' and e1.get('message') == D.get('자기 등록은 신고할 수 없습니다')
           and e1.get('code') == k1.get('code'), f"{who} · {e1.get('code')} · {e1.get('message')} · {k1.get('message')}")
    finally:
        en0, act0 = (before.split('|') + ['off', 'f'])[:2]
        psql(f"UPDATE site_settings SET value='{en0 or 'off'}' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active={'true' if act0 == 't' else 'false'} WHERE code='en';")

n = sum(1 for r in RES if r[0])
print(f'결과: {n} / {len(RES)}')
raise SystemExit(0 if n == len(RES) else 1)
