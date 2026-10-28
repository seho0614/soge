"""v10.44 시험 — 외부 연동 틀 통일(동작 그대로) · 알림톡 판단 수정

  KIT=… python3 test_v1044.py

  ① 흩어진 판단 SQL 이 남아 있지 않음(assume.broker · assume.etax · ALIMTALK 상태) · 공통 함수로 바뀜
  ② 「줄 없을 때」 기본값이 전과 같음(broker false · etax true)
  ③ 오류 종류 한 벌(etax · bank 가 IntegrationErrorKind 를 이어받음)
  ④ 목록표 10개 · 대조 검정이 통합 검정 · npm 명령에 들어 있음 · 운영 .env 예시에 ALIMTALK_KEY · SAFENUM_KEY
  ⑤ 알림톡 — ALIMTALK_KEY 가 없으면 준비 안 됨
  DB 와의 대조(목록표 ↔ integrations ↔ assume.*)는 통합 검정의 「외부 연동 목록 대조」 단계가 합니다.
"""
import json, os, re

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


src = {}
for root, ds, fs in os.walk(os.path.join(K, 'src')):
    ds[:] = [d for d in ds if d not in ('generated',)]
    for f in fs:
        if f.endswith('.ts'):
            p = os.path.join(root, f); src[os.path.relpath(p, K)] = open(p, encoding='utf-8').read()

# ①
inline = [f for f, s in src.items() if re.search(r"key = 'assume\.(broker|etax)'", s)]
ok('assume.broker · etax 를 직접 묻는 SQL 없음', not inline, ' · '.join(inline))
alim = [f for f, s in src.items() if "WHERE code = 'ALIMTALK'" in s]
ok('ALIMTALK 상태를 직접 묻는 SQL 없음', not alim, ' · '.join(alim))
sw = rd('src/common/integration/switches.ts')
ok('공통 함수 assumeOn · integrationLive', 'export async function assumeOn' in sw and 'export async function integrationLive' in sw, '')

# ②
calls = re.findall(r"assumeOn\(this\.db, '(\w+)', (true|false)\)", ''.join(src.values()))
ok('broker 기본값 false(4곳)', calls.count(('broker', 'false')) == 4 and ('broker', 'true') not in calls, str(calls))
ok('etax 기본값 true(1곳)', calls.count(('etax', 'true')) == 1 and ('etax', 'false') not in calls, '')
ok('줄은 있는데 값이 비면 꺼짐(전과 같음)', 'return r ? !!r.on : whenMissing' in sw, '')

# ③
ok('EtaxErrorKind = IntegrationErrorKind', 'export type EtaxErrorKind = IntegrationErrorKind;' in rd('src/modules/etax/etax.adapter.ts'), '')
ok('BankErrorKind 이어받음', "export type BankErrorKind = IntegrationErrorKind | 'HOLDER_MISMATCH' | 'CODE_MISMATCH';" in rd('src/modules/billing/bank-verify.provider.ts'), '')

# ④
reg = rd('src/common/integration/registry.ts')
codes = re.findall(r"\{ code: '(\w+)'", reg)
# v10.46 — 뒤 판에서 연동을 더할 수 있게(MAP · D099) 「v10.44 의 10개가 모두 그대로 있음 · 겹침 없음」으로 봅니다. 개수는 판마다 그 판 시험이 봅니다(test_v1046)
ok('목록표 10개', {'PASS', 'BANK', 'NTS', 'PG', 'ALIMTALK', 'SAFENUM', 'ESIGN', 'BROKER', 'ETAX', 'MAIL'} <= set(codes) and len(codes) == len(set(codes)), ' · '.join(codes))
ok('대조 검정이 통합 검정에', 'scripts/check-integrations.ts' in rd('scripts/verify-all.sh'), '')
ok('npm run check:integrations', 'check-integrations.ts' in json.loads(rd('package.json') or '{}').get('scripts', {}).get('check:integrations', ''), '')
env = rd('deploy/aws/env.production.example')
ok('운영 .env 예시에 ALIMTALK_KEY · SAFENUM_KEY', 'ALIMTALK_KEY=' in env and 'SAFENUM_KEY=' in env, '')
miss = [k for k in re.findall(r"secretEnv: '(\w+)'", reg) if not re.search(r'\b' + k + '=', env)]
ok('목록표의 키 이름이 모두 운영 .env 예시에', not miss, ' · '.join(miss))

# ⑤
cs = rd('src/modules/partner/consult.service.ts')
ok('알림톡 — 키 없으면 준비 안 됨(v10.142 부터 AlimtalkService.ready — 방식 · 키 · 승인 템플릿 · 켜기 · test_v1142)', ("if (!process.env.ALIMTALK_KEY?.trim()) return false;" in cs and "return integrationLive(this.db, 'ALIMTALK');" in cs) or "return this.alimtalk.ready('CONSULT_OTP');" in cs, '')

_v = tuple(int(x) for x in re.findall(r'\d+', rd('VERSION')))
ok('VERSION v10.44 이상', _v >= (10, 44), '.'.join(map(str, _v)))
ok('문서 93', any(f.startswith('93_') for f in os.listdir(os.path.join(K, 'docs'))), '')

n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
