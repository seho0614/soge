"""v10.108 시험 — 리팩토링 4차(파트너센터 · 제휴 · 거래 서비스 나눔 · 동작 그대로 · docs/168)

  KIT=… python3 -I test_v1108.py   (코드만 봄 — 동작은 realcheck · 기능 점검)

  ① 새 서비스 4개 — 파일 · 클래스 · 옮긴 함수가 새 파일에만 있고 원본에는 없음 · 함께 쓰는 작은 함수는 원본 그대로 복사
  ② 연결 — app.module 등록 · 컨트롤러 주입(메서드 이름과 겹치지 않는 이름) · 옮긴 함수 호출이 새 서비스로
  ③ 상수 · 공유 — FORM_KO · FORM_STEPS 는 원본에서 export(다른 서비스가 import) · 1원 인증 상수는 affiliate.service 에서 export · codeHash 는 AffiliateService 에 그대로
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


MEM = lambda m: re.compile(rf'^  (?:private |static )*(?:async )?{m}\(', re.M)
SPLITS = [
    ('src/modules/partner/partner-center.service.ts', 'src/modules/partner/partner-service-form.service.ts', 'PartnerServiceFormService',
     'serviceForms serviceDetail updateService suspendService resumeService putBlock putMatrix', 'mine uuid actor'),
    ('src/modules/partner/partner-center.service.ts', 'src/modules/partner/partner-company.service.ts', 'PartnerCompanyService',
     'company requestChange inviteStaff removeStaff myInvites acceptInvite putBrand addSite removeSite', 'mine owner uuid'),
    ('src/modules/affiliate/affiliate.service.ts', 'src/modules/affiliate/affiliate-account.service.ts', 'AffiliateAccountService',
     'setAccount accountForVerify requestVerify confirmVerify', 'partnerId'),
    ('src/modules/deal/deal.service.ts', 'src/modules/deal/conversation.service.ts', 'ConversationService',
     'mask startConversation messages send', ''),
]
for orig, new, cls, moved, helpers in SPLITS:
    O, N = rd(orig), rd(new)
    miss = [m for m in moved.split() if not MEM(m).search(N)]
    left = [m for m in moved.split() if MEM(m).search(O)]
    ok(f'① {cls} — 옮긴 함수 {len(moved.split())}개가 새 파일에만', N and f'export class {cls}' in N and not miss and not left, f'빠짐 {miss} · 원본에 남음 {left}')
    hm = [h for h in helpers.split() if not MEM(h).search(N)]
    ok(f'① {cls} — 작은 함수 복사({helpers or "없음"})', not hm, str(hm))
P = rd('src/modules/partner/partner-center.service.ts')
ok('① PartnerCenterService — 쓰지 않게 된 owner() · actor() 는 지움 · 상담 · 성과 · 전용 트랙은 남음',
   not MEM('owner').search(P) and not MEM('actor').search(P) and all(MEM(m).search(P) for m in 'addMemo memos rejects performance report myFulfillments confirmFulfillment tracks sendQuote addCatalog setCatalog'.split()), '')
D = rd('src/modules/deal/deal.service.ts')
ok('① DealService — 거래 · 소개비 · 계약서 · 서명 · 지급 · 확정 남음', all(MEM(m).search(D) for m in 'createDeal proposeFee agreeFee issueContract sign reportPayment myDeals confirmDeal assertParty'.split()), '')

A = rd('src/app.module.ts')
ok('② app.module — 새 서비스 4개 등록', all(c in A for c in ('PartnerServiceFormService,', 'PartnerCompanyService,', 'ConversationService,', 'AffiliateAccountService,')), '')
PC = rd('src/modules/partner/partner-center.controller.ts'); AC = rd('src/modules/affiliate/affiliate.controller.ts'); DC = rd('src/modules/deal/deal.controller.ts')
ok('② 파트너센터 컨트롤러 — forms · companySvc 주입 · 호출이 새 서비스로', 'private readonly forms: PartnerServiceFormService' in PC and 'private readonly companySvc: PartnerCompanyService' in PC
   and 'this.forms.putMatrix(' in PC and 'this.companySvc.company(' in PC and not re.search(r'this\.svc\.(serviceForms|putMatrix|company|inviteStaff)\(', PC), '')
ok('② 제휴 컨트롤러 — account 주입 · 계좌 · 1원 인증 호출', 'private readonly account: AffiliateAccountService' in AC and 'this.account.requestVerify(' in AC and 'this.svc.requestVerify(' not in AC, '')
ok('② 거래 컨트롤러 — convs 주입 · 대화 호출', 'private readonly convs: ConversationService' in DC and 'this.convs.startConversation(' in DC and 'this.service.send(' not in DC, '')

AF = rd('src/modules/affiliate/affiliate.service.ts'); AA = rd('src/modules/affiliate/affiliate-account.service.ts')
ok('③ FORM_KO · FORM_STEPS 는 partner-center.service 에서 export 그대로', 'export const FORM_KO' in P and 'export const FORM_STEPS' in P
   and "import { FORM_KO, FORM_STEPS } from './partner-center.service';" in rd('src/modules/partner/qualification.service.ts'), '')
ok('③ 1원 인증 상수는 한 곳(affiliate.service export) · codeHash 는 AffiliateService 에', 'export const VERIFY_MAX_TRIES = 5;' in AF and 'const VERIFY_MAX_TRIES' not in AA
   and 'static codeHash(code: string)' in AF and 'AffiliateService.codeHash(' in AA, '')

_v = tuple(int(x) for x in re.findall(r'\d+', rd('VERSION')))
ok('VERSION v10.108 이상', _v >= (10, 108), '.'.join(map(str, _v)))
bad = [x for x in RES if not x[0]]
print(f'\n결과 — 통과 {len(RES) - len(bad)} · 실패 {len(bad)}')
raise SystemExit(1 if bad else 0)
