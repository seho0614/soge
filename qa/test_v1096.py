"""v10.96 시험 — 리팩토링 3차(admin · me 서비스 나누기 · partner 컨트롤러 4개 → 파일 4개 · health-shop DTO 분리 · docs/154)

  KIT=… python3 -I test_v1096.py

  ① 서비스 — 옮긴 함수가 새 파일에만 · this.X() 가 그 클래스 안 · 컨트롤러가 부르는 함수가 그 서비스에 공개로 · 주입 이름이 메서드와 겹치지 않음 · app.module
  ② 컨트롤러 — partner 파일마다 컨트롤러 하나 · DTO 는 partner.dto.ts · health-shop.dto.ts 에 한 번씩 · DTO 이름이 src 전체에서 겹치지 않음
  ③ 나누지 않은 것 — billing.service · recurring-batch.service 그대로(함수 목록)
"""
import glob, os, re

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
    body = text[text.find('export class '):]
    return {m.group(1): ('private' in m.group(0)) for m in MEM.finditer(body)}


A = 'src/modules/admin/'; Mm = 'src/modules/me/'
PLAN = [
    (A + 'admin.service.ts', 'AdminService', A + 'admin-review.service.ts', 'AdminReviewService',
     ['badges', 'badgeHistory', 'autoReviewReasons', 'autoReviewRate', 'auditSamples', 'auditSummary', 'resample', 'recordAudit', 'reviewReasons']),
    (A + 'admin.service.ts', 'AdminService', A + 'admin-member.service.ts', 'AdminMemberService',
     ['businesses', 'rejectBusiness', 'setAccountStatus', 'liftPostingSuspension', 'verifyBusiness', 'accounts', 'accountCounts', 'account']),
    (Mm + 'me.service.ts', 'MeService', Mm + 'me-activity.service.ts', 'MeActivityService', ['listings', 'deals', 'conversations', 'contracts', 'favorites']),
    (Mm + 'me.service.ts', 'MeService', Mm + 'me-money.service.ts', 'MeMoneyService', ['settlements', 'settlementsDue', 'markTaxInvoice']),
    (Mm + 'me.service.ts', 'MeService', Mm + 'me-notify.service.ts', 'MeNotifyService', ['notifications', 'markRead', 'notificationPrefs', 'setNotificationPref', 'inquiries', 'disputes']),
]
APP = rd('src/app.module.ts')
for f1, c1, f2, c2, moved in PLAN:
    t1, t2 = rd(f1), rd(f2); m1, m2 = members(t1), members(t2)
    ok(f'① {c2} — 옮긴 함수 {len(moved)}개는 새 파일에만', f'export class {c2} ' in t2 and all(x in m2 and x not in m1 for x in moved), ' '.join(x for x in moved if x in m1 or x not in m2))
    ok(f'① app.module 에 {c2}', re.search(rf'import \{{ {c2} \}} from', APP) and re.search(rf'\b{c2},', APP), '')
for f in [A + 'admin.service.ts', A + 'admin-review.service.ts', A + 'admin-member.service.ts', Mm + 'me.service.ts', Mm + 'me-activity.service.ts', Mm + 'me-money.service.ts', Mm + 'me-notify.service.ts']:
    t = rd(f); m = members(t)
    bad = sorted(x for x in set(re.findall(r'this\.(\w+)\(', t)) if x not in m and x not in ('db',))
    ok(f'① {os.path.basename(f)} — this.X() 가 이 클래스 안', not bad, ' '.join(bad))
ok('① SWITCH_RULES 와 스위치 검사는 AdminService 에 그대로(본문의 AdminService.SWITCH_RULES)', 'static readonly SWITCH_RULES' in rd(A + 'admin.service.ts') and 'AdminService.SWITCH_RULES[key]' in rd(A + 'admin.service.ts'), '')
ok('① contractSides 는 계약 함수와 같은 파일(me-activity)', 'export function contractSides(' in rd(Mm + 'me-activity.service.ts') and 'contractSides' not in rd(Mm + 'me.service.ts'), '')

CTL = [(A + 'admin.controller.ts', {'admin': A + 'admin.service.ts', 'memberSvc': A + 'admin-member.service.ts', 'reviewSvc': A + 'admin-review.service.ts'}),
       (A + 'admin-ops.controller.ts', {'svc': A + 'admin.service.ts', 'reviewSvc': A + 'admin-review.service.ts'}),
       (Mm + 'me.controller.ts', {'svc': Mm + 'me.service.ts', 'activity': Mm + 'me-activity.service.ts', 'money': Mm + 'me-money.service.ts', 'notify': Mm + 'me-notify.service.ts'})]
for f, props in CTL:
    t = rd(f); own = set(re.findall(r'^  (?:async )?(\w+)\(', t, re.M))
    bad = []
    for p, sf in props.items():
        m = members(rd(sf))
        for meth in set(re.findall(rf'this\.{p}\.(\w+)\(', t)):
            if meth not in m or m[meth]: bad.append(f'{p}.{meth}')
    ok(f'① {os.path.basename(f)} — 부르는 함수가 그 서비스에 공개로 · 주입 이름이 메서드와 안 겹침', not bad and not (set(props) & own), ' '.join(bad) or ' '.join(set(props) & own))

P = 'src/modules/partner/'
for f, c in ((P + 'partner.controller.ts', 'PartnerController'), (P + 'partner-admin.controller.ts', 'PartnerAdminController'),
             (P + 'qualification.controller.ts', 'QualificationController'), (P + 'broker-admin.controller.ts', 'BrokerAdminController')):
    t = rd(f)
    ok(f'② {os.path.basename(f)} — 컨트롤러 {c} 하나 · DTO 정의 없음', re.findall(r'^export class (\w+Controller)\b', t, re.M) == [c] and not re.search(r'^export class \w+Dto\b', t, re.M), '')
    ok(f'② app.module 이 {c} 를 {os.path.basename(f)} 에서', f"import {{ {c} }} from './modules/partner/{os.path.basename(f)[:-3]}';" in APP, '')
pd = rd(P + 'partner.dto.ts'); hd = rd('src/modules/health/health-shop.dto.ts')
ok('② partner.dto.ts — DTO 12개 · 컨트롤러 없음', len(re.findall(r'^export class \w+Dto\b', pd, re.M)) == 12 and 'Controller' not in re.sub(r'/\*[\s\S]*?\*/', '', pd), '')
ok('② health-shop.dto.ts — DTO 14개 + RETURN_REASONS · 컨트롤러 파일에 DTO 없음', len(re.findall(r'^export class \w+Dto\b', hd, re.M)) == 14 and 'export const RETURN_REASONS' in hd
   and not re.search(r'^export class \w+Dto\b', rd('src/modules/health/health-shop.controller.ts'), re.M), '')
seen = {}
for p in glob.glob(os.path.join(K, 'src/**/*.ts'), recursive=True):
    for m in re.finditer(r'^export class (\w+Dto)\b', open(p, encoding='utf-8').read(), re.M):
        seen.setdefault(m.group(1), []).append(p)
dup = [k for k, v in seen.items() if len(v) > 1]
ok('② DTO 이름이 src 전체에서 겹치지 않음', not dup, ' '.join(dup))

bs = members(rd('src/modules/billing/billing.service.ts')); rb = members(rd('src/modules/billing/recurring-batch.service.ts'))
ok('③ billing.service 는 나누지 않음(subscribe · quota · issueCodes · codes 같이)', all(x in bs for x in ('subscribe', 'quota', 'issueCodes', 'insertCode', 'codes', 'activeSub')), '')
ok('③ recurring-batch.service 는 나누지 않음(chargeDue · reconcileNow …)', all(x in rb for x in ('chargeDue', 'reconcileNow', 'chargeOne', 'reconcilePending')), '')

_v = tuple(int(x) for x in re.findall(r'\d+', rd('VERSION')))
ok('VERSION v10.96 이상', _v >= (10, 96), '.'.join(map(str, _v)))
bad = [x for x in RES if not x[0]]
print(f'\n결과 — 통과 {len(RES) - len(bad)} · 실패 {len(bad)}')
raise SystemExit(1 if bad else 0)
