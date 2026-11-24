"""v10.782 (D329 · docs/890) 결제(토스) 준비 상태
  ① (코드) pgReadiness(키 값 없이 · test/live · 짝 · 간주 · 순서) · 컨트롤러 · 화면 · 토스 연결 코드는 이미 있음
  ③ (API) 칸 · 회원 403
  ④ 문서 890 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SS, IC, UI, PP = rd('src/common/integration/secret.service.ts'), rd('src/modules/site/integration-keys.controller.ts'), rd('web/src/app/admin/IntegrationKeys.tsx'), rd('src/modules/billing/payment.provider.ts')
ok('① 서버 · 화면 · 이미 있는 토스 코드', 'async pgReadiness()' in SS and "v.startsWith('test_') ? 'TEST'" in SS and "@Get('integration-keys/pg-readiness')" in IC and 'function PgReady(' in UI
   and 'export class TossPaymentProvider' in PP and 'process.env.TOSS_SECRET_KEY' in SS, '')
if up():
    import consent_ok
    consent_ok.agree('super@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    r = call('GET', '/admin/integration-keys/pg-readiness', None, login('super@x.com'))
    ok('③ 칸 · 회원 403', all(k in r for k in ('secretMode', 'clientMode', 'paired', 'provider', 'assumePayment', 'steps')) and len(r.get('steps', [])) == 5
       and call('GET', '/admin/integration-keys/pg-readiness', None, login('buyer@x.com')).get('_err') == 403, str(r)[:200])

d = doc('890_')
ok('④ 문서 890', all(w in d for w in ('토스', '시험 키')), str(len(d)))
ok('④ VERSION v10.782 이상', VT >= (10, 782), VER)
done()
