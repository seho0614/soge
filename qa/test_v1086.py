"""v10.86 시험 — 리팩토링(동작 그대로 · 파일만 나눔)

  KIT=… python3 test_v1086.py

  A. 서버 서비스 나누기
     health-shop.service  →  health-catalog · health-checkout · health-payment · health-return · health-settle (+ health-shop.shared)
     recurring.service    →  recurring.service(회원) · recurring-batch.service(배치) · recurring-admin.service(운영 조회 · 정책)
     partner.service      →  partner.service(핵심) · partner-lead.service(리드) · partner-money.service(이용료 · 정산) (+ partner-shared)
  B. 운영 화면 나누기 — Gwans · Qualifications · Partners 를 폴더로
  C. 사용자 웹 정리 — SignupWizard · SearchPopup

  ① 옮긴 함수가 새 파일에 정확히 한 번 · 옛 파일이 없어짐
  ② this.X 가 모두 그 클래스에 있음 · 쓰는 이름이 모두 import · 선언됨
  ③ 컨트롤러 · 배치가 부르는 this.<서비스>.<함수> 가 그 서비스에 있고 private 이 아님
  ④ 새 서비스가 app.module 에 등록됨
  동작이 같은지는 통합 검정 · 기능 점검(흐름 · 화면 · 탭)이 봅니다.
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


DECL = re.compile(r'^  (private |public |protected )?(static )?(async )?(get )?(\w+)\s*(?:<[^(]*?>)?\s*\(', re.M)   # query<T>( 같은 형식 인자 포함


def methods(s):
    """클래스 안(두 칸 들여쓰기) 함수 선언 — {이름: private 여부}"""
    out = {}
    for m in DECL.finditer(s):
        if m.group(5) in ('if', 'for', 'while', 'switch', 'catch', 'constructor', 'return'):
            continue
        out.setdefault(m.group(5), []).append(bool(m.group(1) and m.group(1).strip() == 'private'))
    return out


def members(s):
    """this.X 로 쓸 수 있는 이름 — 함수 · 생성자 매개변수 · 필드"""
    names = set(methods(s))
    for c in re.findall(r'constructor\(([^)]*)\)', s):
        names |= set(re.findall(r'(?:private|public|protected)\s+readonly\s+(\w+)', c))
    names |= set(re.findall(r'^  (?:private |public |protected )?readonly (\w+)', s, re.M))
    return names



PLAN = {
    'src/modules/health/health-catalog.service.ts': ['products', 'product', 'productImage', 'categories', 'ingredients', 'ingredient', 'suggest', 'concerns', 'concern', 'promos'],
    'src/modules/health/health-checkout.service.ts': ['order', 'resolveLines', 'myOrders', 'myOrder', 'addresses', 'addAddress', 'myAddress', 'setDefaultAddress', 'deleteAddress', 'cart', 'addToCart', 'setQty', 'setLineQty', 'ackPrices', 'shipments'],
    'src/modules/health/health-payment.service.ts': ['assertNoCancelRequest', 'pay', 'orderName', 'confirmPay', 'tossWebhook', 'applyLookup'],
    'src/modules/health/health-return.service.ts': ['requestReturn', 'myReturns', 'myExchange', 'payExchangeFee', 'confirmExchangeFee', 'refundExchangeFee', 'retryExchangeFeeRefund', 'convertExchange', 'adminReturns', 'decideReturn', 'refundDeduction', 'refund'],
    'src/modules/health/health-settle.service.ts': ['hltSellers', 'hltSettlements', 'closeSettlement', 'commissionRates'],
    'src/modules/billing/recurring.service.ts': ['registerBillingKey', 'myBillingKey', 'removeBillingKey', 'mySubscription', 'cancel', 'resume', 'invoices'],
    'src/modules/billing/recurring-batch.service.ts': ['setting', 'classify', 'chargeDue', 'reconcileNow', 'chargeOne', 'settlePaid', 'settleFailed', 'markUnpaid', 'reconcileOne', 'reconcilePending', 'applyFreeReservations', 'expireCancelled', 'notifyFailure', 'recordAttempt'],
    'src/modules/billing/recurring-admin.service.ts': ['policy', 'updatePolicy', 'attemptsToday', 'noticeMissing', 'overdue', 'review'],
    'src/modules/partner/partner.service.ts': ['apply', 'dashboard', 'services', 'addService', 'regions', 'setRegions', 'myReviews', 'myStats', 'myTrust', 'myNotices', 'readNotices', 'myBroker', 'applyBroker'],
    'src/modules/partner/partner-lead.service.ts': ['leads', 'leadContact', 'viewLead'],
    'src/modules/partner/partner-money.service.ts': ['fees', 'disputeFee', 'myDisputes', 'mySettlement', 'myPricing', 'myRewards'],
}

# ① A
for f, names in PLAN.items():
    s = rd(f)
    m = methods(s)
    bad = [n for n in names if len(m.get(n, [])) != 1]
    ok(f'A① 함수 {len(names)}개가 한 번씩 — {os.path.basename(f)}', s and not bad, ' · '.join(bad))
ok('A① 옛 health-shop.service.ts 없어짐', not rd('src/modules/health/health-shop.service.ts'), '')
old_ref = []
for root, ds, fs in os.walk(os.path.join(K, 'src')):
    for fn in fs:
        if fn.endswith('.ts') and "from './health-shop.service'" in open(os.path.join(root, fn), encoding='utf-8').read():
            old_ref.append(fn)
ok('A① 옛 파일을 불러오는 곳 없음', not old_ref, ' · '.join(old_ref))

# ② A
SVC = list(PLAN) + ['src/modules/health/health-shop.shared.ts', 'src/modules/partner/partner-shared.ts']
for f in PLAN:
    s = rd(f)
    miss = sorted(set(re.findall(r'this\.(\w+)', s)) - members(s))
    ok(f'A② this.X 가 모두 클래스 안에 — {os.path.basename(f)}', not miss, ' · '.join(miss))
GLOBALS = {'Promise', 'Number', 'String', 'Date', 'Error', 'Set', 'Map', 'Object', 'JSON', 'Math', 'Array', 'Boolean', 'RegExp',
           'Record', 'NonNullable', 'Partial', 'Buffer', 'BigInt', 'Intl', 'Symbol', 'Infinity', 'NaN'}


def undefined_names(s):
    code = re.sub(r'/\*[\s\S]*?\*/|//[^\n]*', '', s)
    code = re.sub(r"`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"", '""', code)
    imp = set()
    for m in re.finditer(r'import (?:type )?\{([^}]*)\}', s):
        imp |= {x.strip().split(' as ')[-1] for x in m.group(1).split(',') if x.strip()}
    decl = set(re.findall(r'(?:class|interface|const|let|function|type|enum)\s+(\w+)', code))
    used = set(re.findall(r'\b([A-Z][a-z][A-Za-z0-9_]*)\b', code))
    return sorted(used - imp - decl - GLOBALS)



for f in SVC:
    miss = undefined_names(rd(f))
    ok(f'A② 쓰는 이름이 모두 import · 선언됨 — {os.path.basename(f)}', not miss, ' · '.join(miss))

# ③ 주입받은 서비스 이름 → 파일
CLS = {}
for root, ds, fs in os.walk(os.path.join(K, 'src')):
    for fn in fs:
        if fn.endswith('.service.ts'):
            p = os.path.join(root, fn)
            for c in re.findall(r'export class (\w+)', open(p, encoding='utf-8').read()):
                CLS[c] = os.path.relpath(p, K)


def calls_ok(f):
    s, bad, n = rd(f), [], 0
    for seg in re.split(r'(?=export class )', s):
        inj = {}
        for c in re.findall(r'constructor\(([^)]*)\)', seg):
            inj.update(dict(re.findall(r'readonly\s+(\w+)\s*:\s*(\w+)', c)))
        for var, meth in re.findall(r'this\.(\w+)\.(\w+)\s*\(', seg):
            if var not in inj or inj[var] not in CLS:
                continue
            n += 1
            m = methods(rd(CLS[inj[var]]))
            if meth not in m or all(m[meth]):
                bad.append(f'{var}.{meth}')
    return n, sorted(set(bad))



for f in ['src/modules/health/health-shop.controller.ts', 'src/modules/billing/recurring.controller.ts',
          'src/modules/partner/partner.controller.ts', 'src/worker/scheduler.service.ts']:
    n, bad = calls_ok(f)
    ok(f'A③ 부르는 함수가 그 서비스에 있음(공개) — {os.path.basename(f)} {n}곳', n and not bad, ' · '.join(bad))
ok('A③ 건강몰 컨트롤러 — svc 없이 서비스 5개', 'this.svc.' not in rd('src/modules/health/health-shop.controller.ts'), '')

# ④ A
am = rd('src/app.module.ts')
for c in ('HealthCatalogService', 'HealthCheckoutService', 'HealthPaymentService', 'HealthReturnService', 'HealthSettleService',
          'RecurringBatchService', 'RecurringAdminService', 'PartnerLeadService', 'PartnerMoneyService'):
    ok(f'A④ app.module 에 {c}', re.search(r'\n\s+[^\n]*\b' + c + r'\b,', am) is not None and f'import {{ {c} }}' in am, '')
ok('A④ app.module 에 HealthShopService 없음', 'HealthShopService' not in am, '')

# B · C — 화면 파일 나누기
FRONT = {
    'web/src/app/admin/Gwans.tsx': ['gwans/GwanList.tsx', 'gwans/GwanNew.tsx', 'gwans/GwanSettings.tsx', 'gwans/GwanScope.tsx', 'gwans/shared.ts'],
    'web/src/app/admin/Qualifications.tsx': ['quals/BrokerQueue.tsx', 'quals/BrokerDetail.tsx', 'quals/CategoryMaster.tsx', 'quals/Categories.tsx',
                                             'quals/MedicalView.tsx', 'quals/shared.tsx'],
    'web/src/app/admin/Partners.tsx': ['partners/PartnerDetail.tsx', 'partners/PartnerList.tsx', 'partners/Apply.tsx', 'partners/Services.tsx',
                                       'partners/Rejects.tsx', 'partners/Wallet.tsx', 'partners/shared.ts'],
    'site/src/components/auth/SignupWizard.tsx': ['signup/StepType.tsx', 'signup/StepBiz.tsx', 'signup/StepPerson.tsx', 'signup/StepTerms.tsx',
                                                  'signup/StepProfile.tsx', 'signup/rules.ts'],
    'site/src/components/search/SearchPopup.tsx': ['search-data.ts'],
}
def undefined_front(s):
    """화면 파일용 — 기본 import(import X from) · 점 뒤 이름(React.ReactNode) · 정규식 · JSX 글 속 낱말은 빼고 봄"""
    code = re.sub(r'/\*[\s\S]*?\*/|(?<![:\'"])//[^\n]*', '', s)
    code = re.sub(r"`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\\n])*'|\"(?:\\.|[^\"\\\n])*\"", '""', code)
    code = re.sub(r'/(?:\\.|\[[^\]]*\]|[^/\n\\])+/[gimsuy]*(?=\s*[.,;)])', '//', code)   # 정규식
    code = re.sub(r'>[^<>{}]*<', '><', code)   # JSX 글
    imp = set(re.findall(r'import\s+(\w+)\s+from', s))
    for m in re.finditer(r'(?:import|export) (?:type )?\{([^}]*)\}', s):
        imp |= {x.strip().replace('type ', '').split(' as ')[-1].strip() for x in m.group(1).split(',') if x.strip()}
    decl = set(re.findall(r'(?:class|interface|const|let|function|type|enum)\s+(\w+)', code))
    used = set(re.findall(r'(?<![.\w])([A-Z][a-z][A-Za-z0-9_]*)\b', code))
    return sorted(used - imp - decl - WEB)


WEB = GLOBALS | {'React', 'HTMLInputElement', 'HTMLDivElement', 'HTMLElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'KeyboardEvent',
                 'MouseEvent', 'Omit', 'Pick', 'ReturnType', 'AbortController', 'AbortSignal', 'URLSearchParams', 'FormData', 'Blob', 'File', 'Response', 'URL', 'Event'}
for entry, subs in FRONT.items():
    base = os.path.dirname(entry)
    e = rd(entry)
    for sub in subs:
        p = os.path.join(base, sub)
        s = rd(p)
        ok(f'{"B" if entry.startswith("web") else "C"}① 파일 있음 — {p}', bool(s), '')
        if sub.endswith('.tsx') and sub.split('/')[-1][0].isupper():
            comp = os.path.basename(sub)[:-4]
            ok(f'  내보냄 export function {comp}', f'export function {comp}(' in s, '')
        miss = undefined_front(s)
        ok(f'  쓰는 이름이 모두 import · 선언됨 — {os.path.basename(p)}', not miss, ' · '.join(miss))
    miss = undefined_front(e)
    ok(f'진입점 쓰는 이름이 모두 import · 선언됨 — {os.path.basename(entry)}', not miss, ' · '.join(miss))
    ok(f'진입점이 줄었음 — {os.path.basename(entry)} {e.count(chr(10))}줄', e.count(chr(10)) < 330, '')
ok('C 가입 화면 — 밖에서 쓰던 형식 이름 그대로(SignupType · JoinTerm)',
   "export type { SignupType, JoinTerm } from './signup/rules';" in rd('site/src/components/auth/SignupWizard.tsx'), '')
ok('C 검색 팝업 — 밖에서 쓰던 이름 그대로(SCOPES · logSearch · searchHref · SearchScope)',
   "export { SCOPES, logSearch, searchHref, type SearchScope } from './search-data';" in rd('site/src/components/search/SearchPopup.tsx'), '')

_v = tuple(int(x) for x in re.findall(r'\d+', rd('VERSION')))
ok('VERSION v10.86 이상', _v >= (10, 86), '.'.join(map(str, _v)))
ok('문서 140', any(f.startswith('140_') for f in os.listdir(os.path.join(K, 'docs'))), '')

n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
