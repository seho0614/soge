"""v10.775 (D329 · docs/883) 운영자 2단계 인증 이날부터 필수 · 등록 안내
  ① (코드) admin.mfa_from 설정 · settings() 날짜 · remind · 켜기와 같은 등록 먼저 · 화면
  ③ (API) remind 칸 · 회원 403 · 설정 줄 비어 있음
  ④ 문서 883 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

MS, MC, AS, UI, M = rd('src/modules/identity/mfa.service.ts'), rd('src/modules/identity/mfa.controller.ts'), rd('src/modules/admin/admin.service.ts'), rd('web/src/app/admin/MyMfa.tsx'), rd('prisma/migrations/D329_bundle5_open_prep/migration.sql')
ok('① 서버 · 화면', "'admin.mfa_from'" in M and "if (from && mode !== 'ALL'" in MS and 'async remind()' in MS and "'MFA_ENROLL_REMIND'" in MS and "@Post('admin/mfa/remind')" in MC
   and "(key === 'admin.mfa_from' && (value ?? '').trim())" in AS and 'function MfaFromBox(' in UI and 'data-mfa-remind' in UI, '')
if up():
    import consent_ok
    consent_ok.agree('super@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    r = call('POST', '/admin/mfa/remind', None, login('super@x.com'))
    ok('③ remind 칸 · 회원 403 · 설정 비어 있음', all(k in r for k in ('notEnrolled', 'sent', 'skipped')) and call('POST', '/admin/mfa/remind', None, login('buyer@x.com')).get('_err') == 403
       and psql("SELECT coalesce(value, '') FROM site_settings WHERE key = 'admin.mfa_from'") == '', str(r))

d = doc('883_')
ok('④ 문서 883', all(w in d for w in ('이날부터', '알림')), str(len(d)))
ok('④ VERSION v10.775 이상', VT >= (10, 775), VER)
done()
