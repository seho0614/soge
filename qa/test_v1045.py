"""v10.45 시험 — 큰 서비스 파일 나누기(동작 그대로)

  KIT=… python3 test_v1045.py

  recurring.service  →  recurring.service · recurring-refund.service(구독 환불) · payout-account.service(정산 계좌 · 1원 인증)
  partner.service    →  partner.service(파트너 본인) · partner-admin.service(운영 adm*)

  ① 옮긴 함수가 새 파일에 정확히 한 번 · 옛 파일에 남지 않음
  ② 서비스 안의 this.X 가 모두 그 클래스에 있음(옮기다 빠뜨린 도우미 없음) · 쓰는 이름이 모두 import 됨
  ③ 컨트롤러 · 배치가 부르는 this.<서비스>.<함수> 가 그 서비스에 있고 private 이 아님
  ④ 새 서비스가 app.module 에 등록됨 · 새 서비스는 옛 서비스를 부르지 않음(순환 없음)
  동작이 같은지는 통합 검정(통과 · 안전 · SQL 대조 수가 줄지 않음)이 봅니다.
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


B = 'src/modules/billing/'
P = 'src/modules/partner/'
PLAN = {
    B + 'recurring-refund.service.ts': ['refundView', 'lastRefund', 'refundEligible', 'refund', 'processRefund', 'refundDone',
                                        'notifyRefund', 'refundFail', 'refundUnknown', 'reconcileRefunds'],
    B + 'payout-account.service.ts': ['payoutAccounts', 'addPayoutAccount', 'verifyPayoutAccount'],
    P + 'partner-admin.service.ts': ['notifyPartner', 'admList', 'admCards', 'admDocs', 'admDetail', 'admApprove', 'admReject',
                                     'admPendingServices', 'admReviewService', 'admVoidFee', 'admVoidRequests',
                                     'admAcceptVoidRequest', 'admDismissVoidRequest', 'admFees'],
}
OLD = {B + 'recurring-refund.service.ts': B + 'recurring.service.ts', B + 'payout-account.service.ts': B + 'recurring.service.ts',
       P + 'partner-admin.service.ts': P + 'partner.service.ts'}
STAY = {B + 'recurring.service.ts': ['registerBillingKey', 'myBillingKey', 'removeBillingKey', 'mySubscription', 'cancel', 'resume',
                                     'invoices', 'chargeDue', 'reconcileNow', 'chargeOne', 'policy', 'updatePolicy', 'review'],
        P + 'partner.service.ts': ['mine', 'apply', 'dashboard', 'leads', 'viewLead', 'disputeFee', 'myDisputes', 'myBroker', 'applyBroker']}

# ①
for f, names in PLAN.items():
    s = rd(f)
    ok(f'파일 있음 {f}', bool(s), '')
    m, old = methods(s), methods(rd(OLD[f]))
    bad = [n for n in names if len(m.get(n, [])) != 1]
    ok(f'옮긴 함수 {len(names)}개가 새 파일에 한 번씩 — {os.path.basename(f)}', not bad, ' · '.join(bad))
    left = [n for n in names if n in old]
    ok(f'옛 파일에 남지 않음 — {os.path.basename(OLD[f])}', not left, ' · '.join(left))
for f, names in STAY.items():
    miss = [n for n in names if n not in methods(rd(f))]
    ok(f'남을 함수는 그대로 — {os.path.basename(f)}', not miss, ' · '.join(miss))
ok('BatchResult 는 recurring.service 에 · 환불 쪽은 형식만 가져옴',
   'export interface BatchResult' in rd(B + 'recurring.service.ts')
   and "import type { BatchResult } from './recurring.service';" in rd(B + 'recurring-refund.service.ts'), '')

# ②
SVC = [B + 'recurring.service.ts', B + 'recurring-refund.service.ts', B + 'payout-account.service.ts',
       P + 'partner.service.ts', P + 'partner-admin.service.ts']
for f in SVC:
    s = rd(f)
    used = set(re.findall(r'this\.(\w+)', s))
    miss = sorted(used - members(s))
    ok(f'this.X 가 모두 클래스 안에 — {os.path.basename(f)}', not miss, ' · '.join(miss))

# ②-2 쓰는 이름이 모두 불러와졌거나 선언됨 — 10/16 realcheck: 옮기면서 import 에서 StubPaymentProvider 를 빼 API 가 뜨지 못함
#      (통합 검정의 API 시험은 형식 검사 없이 돌아 통과 · 개발 서버는 형식 검사를 해서 멈춤)
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
    ok(f'쓰는 이름이 모두 import · 선언됨 — {os.path.basename(f)}', not miss, ' · '.join(miss))

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


for f in [B + 'recurring.controller.ts', P + 'partner.controller.ts', 'src/worker/scheduler.service.ts', B + 'recurring.service.ts']:
    n, bad = calls_ok(f)
    ok(f'부르는 함수가 그 서비스에 있음(공개) — {os.path.basename(f)} {n}곳', n and not bad, ' · '.join(bad))
rc = rd(B + 'recurring.controller.ts')
ok('회원 환불 · 정산 계좌 API 가 새 서비스로',
   'this.refunds.refund(dto.reason)' in rc and 'this.refunds.refundEligible()' in rc and 'this.payout.verifyPayoutAccount(id, dto.code)' in rc, '')
pc = rd(P + 'partner.controller.ts')
ok('운영 파트너 컨트롤러가 PartnerAdminService 로',
   re.search(r'export class PartnerAdminController \{\s*constructor\(private readonly svc: PartnerAdminService\)', pc) is not None, '')

# ④
am = rd('src/app.module.ts')
for c in ('RecurringRefundService', 'PayoutAccountService', 'PartnerAdminService'):
    ok(f'app.module 에 {c}', re.search(r'\n\s+[^\n]*\b' + c + r'\b,', am) is not None and f'import {{ {c} }}' in am, '')
cyc = [f for f in (B + 'recurring-refund.service.ts', B + 'payout-account.service.ts', P + 'partner-admin.service.ts')
       if re.search(r"^import (?!type ).*from '\./(recurring|partner)\.service'", rd(f), re.M)]
ok('새 서비스가 옛 서비스를 불러오지 않음(순환 없음)', not cyc, ' · '.join(cyc))

_v = tuple(int(x) for x in re.findall(r'\d+', rd('VERSION')))
ok('VERSION v10.45 이상', _v >= (10, 45), '.'.join(map(str, _v)))
ok('문서 94', any(f.startswith('94_') for f in os.listdir(os.path.join(K, 'docs'))), '')

n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
