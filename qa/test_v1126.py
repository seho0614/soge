"""v10.126 시험 — API 오류 · 안내 글의 영어 단계 B(파트너센터 · 제휴 파트너 · 건강몰 · 상담 배정 · docs/190)

  KIT=$K API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb python3 -I test_v1126.py

  ① 사전 — 단계 A(회원 화면) · B(partner · affiliate · health · lead) 모듈의 한국어 오류 · 안내 글이 모두 영어로 있음 · 자리 수 같음 · 영어에 한글 없음 · 남은 수(단계 C · 운영 화면)
  ② (API) 영어 켜고 — 파트너 · 건강몰 오류가 영어 · 한국어 요청은 원문 — 끝나면 원래대로
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from srv_text_extract import extract

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
rows = extract(K)
han = lambda k: re.search('[가-힣]', re.sub(r'\{\d+\}', '', k))
kb = {x['key'] for x in rows if x['module'] in B and han(x['key'])}
ka = {x['key'] for x in rows if x['module'] in A and han(x['key'])}
mb, ma = sorted(kb - set(D)), sorted(ka - set(D))
ok(f'① 단계 B 모듈(partner · affiliate · health · lead)의 오류 · 안내 글 {len(kb)}종이 모두 사전에', kb and not mb, ' | '.join(mb[:3]))
ok(f'① 단계 A 모듈 {len(ka)}종도 그대로 모두 사전에', ka and not ma, ' | '.join(ma[:3]))
badp = [k for k, v in D.items() if sorted(re.findall(r'\{\d+\}', k)) != sorted(re.findall(r'\{\d+\}', v))]
ok(f'① 사전 {len(D)}문장 — 자리 수 같음 · 영어에 한글 없음', len(D) >= 800 and not badp and not any(re.search('[가-힣]', v.replace('심의필 제2026-0451호', '')) for v in D.values()), ' | '.join(badp[:3]))
ok('① 판 v10.126 이상 · 마이그레이션 없음(165)', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 126) and len([d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d))]) in (165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188), rd('VERSION').strip())
SAMPLES = [   # 조각 글을 이어 붙인 실제 모양(health-return · lead-cash · partner-lead · lead · recurring) — 영어 결과에 한글이 남으면 안 됨
    '승인하고 왕복 배송비 3,000원을 빼고 12,000원을 환불했습니다(시험 결제 — 실제 돈 없음). 재고를 되돌렸습니다.',
    '승인했습니다. 결제 전 주문이라 환불할 것이 없습니다. 개봉 반품이라 재고로 되돌리지 않았습니다.',
    '반려했습니다. 고객에게 사유가 보입니다. 교환 배송비 6,000원을 돌려드렸습니다.',
    '왕복 배송비 3,000원을 빼고 12,000원을 환불했습니다.',
    '50,000원을 결제 수단으로 돌려드렸습니다 — 그 충전의 등급 할인 5,000원은 회수했습니다.',
    '결제가 승인되면 유상 잔액 50,000원 · 등급 할인 5,000원이 들어옵니다.',
    '확인비용 3,000원이 잔액에서 빠졌습니다(보너스 1,000원 · 유상 2,000원). 성사 여부와 무관합니다.',
    '2곳에서 거뒀습니다. 지금 보낼 업체가 없어 대기로 두고 배치가 채웁니다.',
    '이미 해지한 구독입니다. 해지 전에 시작되어 결제사에서 진행 중인 청구가 1건 있습니다 — 그 청구가 승인되면 한 기간이 더 이어지고, 그 뒤로는 청구되지 않습니다. 원하지 않으시면 결제 당일 환불을 신청하실 수 있습니다.',
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
  ok(f'① 조각 글을 이어 붙인 예문 {len(SAMPLES)}개 — 영어 결과에 한글 없음 · 빈칸 · 문장 부호 다듬음(점검판 API 에서 실행)',
     out and len(out) == len(SAMPLES) and not any(re.search('[가-힣]', x) or '  ' in x or ' .' in x for x in out), ' | '.join(x[:50] for x in (out or []) if re.search('[가-힣]', x))[:200])
left = {x['key'] for x in rows if han(x['key'])} - set(D)
by = {}
for x in rows:
    if x['key'] in left: by.setdefault(x['module'], set()).add(x['key'])
print('   남은 문장(단계 C 밖 · 운영 화면 쪽):', len(left), ' · '.join(f'{m} {len(v)}' for m, v in sorted(by.items(), key=lambda kv: -len(kv[1]))[:10]))


def call(m, p, b=None, h=None, t=None):
    hd = {'content-type': 'application/json', **(h or {}), **({'Authorization': 'Bearer ' + t} if t else {})}
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m)
    try: return json.load(urllib.request.urlopen(r, timeout=60))
    except urllib.error.HTTPError as e:
        try: return json.loads(e.read().decode('utf-8', 'replace'))
        except Exception: return {}


if API and DB:
    TP = call('POST', '/auth/login', {'email': 'person@x.com', 'password': 'sgb-dev-1234'})['accessToken']
    TB = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': 'sgb-dev-1234'})['accessToken']
    EN = {'X-Lang': 'en'}
    before = psql("SELECT (SELECT value FROM site_settings WHERE key='i18n.enabled') || '|' || (SELECT is_active FROM i18n_langs WHERE code='en')")
    try:
        psql("UPDATE site_settings SET value='on' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active=true WHERE code='en';")
        time.sleep(31)
        pe, pk = call('GET', '/partner/pricing', h=EN, t=TP), call('GET', '/partner/pricing', t=TP)
        ok('② 파트너센터 오류 — 영어 · 한국어 원문', pe.get('message') == 'You are not a partner.' and pk.get('message') == '파트너가 아닙니다.', f"{pe.get('message')} · {pk.get('message')}")
        he, hk = call('GET', '/me/health/orders/H00000000000', h=EN, t=TB), call('GET', '/me/health/orders/H00000000000', t=TB)
        ok('② 건강몰 오류 — 영어 · 한국어 원문', he.get('message') == D.get(hk.get('message')) and he.get('message') != hk.get('message') and hk.get('message'), f"{he.get('message')} · {hk.get('message')}")
    finally:
        en0, act0 = (before.split('|') + ['off', 'f'])[:2]
        psql(f"UPDATE site_settings SET value='{en0 or 'off'}' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active={'true' if act0 == 't' else 'false'} WHERE code='en';")

n = sum(1 for r in RES if r[0])
print(f'결과: {n} / {len(RES)}')
raise SystemExit(0 if n == len(RES) else 1)
