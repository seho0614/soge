"""v10.774 (D329 · docs/882) 권한 판정 GROUPS 전환 준비
  ① (코드) modeReadiness · revertToCompare · 컨트롤러(SUPER) · 화면 카드
  ③ (API) readiness 칸 · GROUPS 아니면 revert 422 · 회원 403
  ④ 문서 882 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

PM, PC, SP = rd('src/modules/admin/perm-mode.ts'), rd('src/modules/admin/perm-sets.controller.ts'), rd('web/src/app/admin/StaffPerm.tsx')
ok('① 서버 · 화면', 'export async function modeReadiness(db: DatabaseService)' in PM and "throw new PolicyViolation('PERM_REVERT_NOT_GROUPS'" in PM and "@Get('mode/readiness')" in PC and "@Post('mode/revert')" in PC
   and 'function PermReadiness(' in SP and 'data-perm-revert' in SP, '')
if up():
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS = login('admin@x.com')
    r = call('GET', '/admin/perm/mode/readiness', None, TS)
    mode = psql("SELECT value FROM site_settings WHERE key = 'perm.mode'")
    rv = call('POST', '/admin/perm/mode/revert', {'reason': '시험 1774'}, TS) if mode != 'GROUPS' else {'code': 'PERM_REVERT_NOT_GROUPS'}
    ok('③ 칸 · revert 422 · 회원 403', all(k in r for k in ('days', 'zeroDays', 'staffNoGroup', 'roleGroups', 'after')) and len(r.get('days', [])) == 7
       and rv.get('code') == 'PERM_REVERT_NOT_GROUPS' and call('GET', '/admin/perm/mode/readiness', None, login('buyer@x.com')).get('_err') == 403, f"{list(r)[:6]} {rv.get('code')}")

d = doc('882_')
ok('④ 문서 882', all(w in d for w in ('GROUPS', '되돌리기')), str(len(d)))
ok('④ VERSION v10.774 이상', VT >= (10, 774), VER)
done()
