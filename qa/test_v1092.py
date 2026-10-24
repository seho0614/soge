"""v10.92 시험 — 리팩토링 2차(서버 서비스 3 · 운영 화면 3 나누기 · docs/147)

  KIT=… python3 -I test_v1092.py

  ① 서버 — 나눈 함수가 새 파일에 한 번씩(같이 쓰는 assertParty · uuid · me 는 두 곳) · this.X 가 그 클래스 안 · 쓰는 이름이 모두 import
  ② 컨트롤러 — 부르는 함수가 그 서비스에 있음(공개) · app.module 등록
  ③ 운영 화면 — 진입점이 하위 폴더를 부름 · 화면 파일이 내보냄 · JSX 가 든 파일은 .tsx · AiLearn 이 이름 6개를 다시 내보냄
"""
import os, re

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


MEM = re.compile(r'^  (?:(?:async|private|public|static|readonly|get)\s+)*([A-Za-z_]\w*)\s*[(=:<]', re.M)


def members(text):
    c = text.find('export class ')
    body = text[c:]
    return {m.group(1): ('private' in m.group(0)) for m in MEM.finditer(body)}


PLAN = {
    'affiliate': ('src/modules/affiliate/affiliate.service.ts', 'AffiliateService', 'src/modules/affiliate/affiliate-admin.service.ts', 'AffiliateAdminService',
                  ['applications', 'decideApplication', 'adminProducts', 'createProduct', 'updateProduct', 'goals', 'setGoal', 'materialQueue', 'createMaterial',
                   'adminGuides', 'createGuide', 'updateGuide', 'reviewMaterial', 'adminSettlements', 'runSettle'], ['me']),
    'deal': ('src/modules/deal/deal.service.ts', 'DealService', 'src/modules/deal/deal-contract.service.ts', 'DealContractService',
             ['contractOf', 'sideOf', 'contractState', 'saveContractDraft', 'nudgeContract', 'agreeContract', 'counterContract', 'signContract2', 'fulfilContract',
              'cancelContract', 'contractHistory', 'contractTemplates', 'contractTemplate', 'requestESign', 'esignStatus'], ['assertParty']),
    'partner-center': ('src/modules/partner/partner-center.service.ts', 'PartnerCenterService', 'src/modules/partner/partner-center-admin.service.ts', 'PartnerCenterAdminService',
                       ['admSetLeadGrade', 'admChangeRequests', 'admDecideChange', 'admInvoices', 'admRunInvoices', 'admIssueInvoice', 'admRules', 'admSetBonusRate', 'admSetGradeRule'],
                       ['uuid', 'me']),
}
APP = rd('src/app.module.ts')
for key, (f1, c1, f2, c2, moved, dup) in PLAN.items():
    t1, t2 = rd(f1), rd(f2)
    m1, m2 = members(t1), members(t2)
    ok(f'① {key} — 새 클래스 {c2}', f'export class {c2} ' in t2 and f'export class {c1} ' in t1, '')
    ok(f'① {key} — 옮긴 함수 {len(moved)}개는 새 파일에만', all(x in m2 and x not in m1 for x in moved), ' '.join(x for x in moved if x in m1 or x not in m2))
    ok(f'① {key} — 같이 쓰는 {"·".join(dup)} 는 두 곳', all(x in m1 and x in m2 for x in dup), '')
    for f, t, m in ((f1, t1, m1), (f2, t2, m2)):
        calls = set(re.findall(r'this\.(\w+)\(', t))
        bad = sorted(x for x in calls if x not in m and x not in ('db', 'actors', 'attribution', 'log'))
        ok(f'① {os.path.basename(f)} — this.X() 가 모두 이 클래스 안', not bad, ' '.join(bad))
        body = re.sub(r'^import[^;]+;', '', t, flags=re.M)
        imported = set()
        for im in re.finditer(r'import\s*(?:type\s*)?\{([^}]*)\}', t):
            imported |= {x.strip().split(' as ')[-1] for x in im.group(1).split(',') if x.strip()}
        for nm in ('Injectable', 'DatabaseService', 'RequestCtx', 'NotFound', 'Forbidden', 'PolicyViolation', 'StateConflict', 'AppError', 'PartnerActorService',
                   'AttributionEngine', 'resolveESignProvider', 'resolveBankVerifyProvider', 'maskBizNo', 'normSido', 'affTouchHash', 'createHash', 'createHmac', 'randomBytes'):
            if re.search(r'(?<![\w.])' + nm + r'\b', body) and nm not in imported:
                ok(f'① {os.path.basename(f)} — {nm} import', False, '빠짐')
    ok(f'② {key} — app.module 에 {c2} 등록', re.search(rf'import \{{ {c2} \}} from', APP) and re.search(rf'\b{c2}\b[^\n]*(,|\n)', APP.split('providers')[-1] if 'providers' in APP else APP), '')

for ctl, prop, f2, c2, key in (('src/modules/affiliate/affiliate.controller.ts', 'admin', 'src/modules/affiliate/affiliate-admin.service.ts', 'AffiliateAdminService', 'affiliate'),
                               ('src/modules/deal/deal.controller.ts', 'contracts', 'src/modules/deal/deal-contract.service.ts', 'DealContractService', 'deal')):
    t = rd(ctl); m2 = members(rd(f2)); m1 = members(rd(PLAN[key][0]))
    used2 = set(re.findall(rf'this\.{prop}\.(\w+)\(', t))
    first = re.findall(r'this\.(?:svc|service)\.(\w+)\(', t)
    ok(f'② {os.path.basename(ctl)} — this.{prop}.X 가 {c2} 의 공개 함수', used2 and all(x in m2 and not m2[x] for x in used2), ' '.join(sorted(used2)))
    ok(f'② {os.path.basename(ctl)} — 남은 호출은 원래 서비스의 공개 함수', all(x in m1 and not m1[x] for x in first), ' '.join(x for x in first if x not in m1))
    own = set(re.findall(r'^  (?:async )?(\w+)\(', t, re.M))
    ok(f'② {os.path.basename(ctl)} — 주입 이름 {prop} 이 컨트롤러 메서드 이름과 겹치지 않음(v10.86 leads · v10.92 contract)', prop not in own, '')
    ok(f'② {os.path.basename(ctl)} — 옮긴 함수 수 = 컨트롤러가 새 서비스로 부르는 수', len(used2) == len([x for x in PLAN[key][4] if x not in ('contractOf', 'sideOf')]), str(len(used2)))
t = rd('src/modules/partner/partner-center.controller.ts')
adm = t[t.find('export class PartnerCenterAdminController'):]
ok('② PartnerCenterAdminController — PartnerCenterAdminService 를 받음 · adm* 9개', 'private readonly svc: PartnerCenterAdminService' in adm and len(set(re.findall(r'this\.svc\.(adm\w+)\(', adm))) == 9, '')
rest = t[:t.find('export class PartnerCenterAdminController')]
ok('② 파트너 화면 · 이행 컨트롤러는 PartnerCenterService 그대로 · adm 호출 없음', 'this.svc.adm' not in rest and rest.count('private readonly svc: PartnerCenterService') == 2, '')

W = 'web/src/app/admin/'
for entry, sub, files in (('Affiliates.tsx', 'affiliates', ['Applications', 'Products', 'Goals', 'Materials', 'Guides', 'Settlements']),
                          ('HealthProducts.tsx', 'healthproducts', ['Products', 'Edit', 'Ingredients', 'Categories', 'Promos'])):
    e = rd(W + entry)
    ok(f'③ {entry} — 하위 폴더 {sub}/ 를 부름', all(f"from './{sub}/{x}'" in e for x in files), '')
    for x in files:
        ok(f'③ {sub}/{x}.tsx — {x} 를 내보냄', re.search(rf'^export function {x}\b', rd(f'{W}{sub}/{x}.tsx'), re.M), '')
for sub in ('affiliates', 'healthproducts', 'ailearn'):
    d = os.path.join(K, W, sub)
    ts = [f for f in os.listdir(d) if f.endswith('.ts')] if os.path.isdir(d) else []
    ok(f'③ {sub}/ — .ts 파일에 JSX 없음', not [f for f in ts if re.search(r'return\s*\(\s*<|<[A-Z]\w*[\s/>]', open(os.path.join(d, f), encoding='utf-8').read())], ' '.join(ts))
a = rd(W + 'AiLearn.tsx')
names = ['SearchParser', 'SearchDict', 'ClassifyLearn', 'SegmentLearn', 'SegmentPreview', 'RiskLearn']
ok('③ AiLearn.tsx — 이름 6개를 다시 내보냄(AiOps.tsx 그대로)', all(re.search(rf'export \{{[^}}]*\b{x}\b[^}}]*\}} from', a) for x in names)
   and "from './AiLearn'" in rd(W + 'AiOps.tsx'), '')

_v = tuple(int(x) for x in re.findall(r'\d+', rd('VERSION')))
ok('VERSION v10.92 이상', _v >= (10, 92), '.'.join(map(str, _v)))
bad = [x for x in RES if not x[0]]
print(f'\n결과 — 통과 {len(RES) - len(bad)} · 실패 {len(bad)}')
raise SystemExit(1 if bad else 0)
