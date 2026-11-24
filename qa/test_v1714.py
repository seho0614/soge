"""v10.714 (docs/822) 점검 중 운영자 미리 보기 — 운영자(ADMIN · SUPER 로그인)는 점검 중에도 관 화면 그대로 + 띠 · 손님은 안내
  ① (코드) [gwan] · 소개리드 · 허브 me() · staff · MoneyMain · GwanLanding staff 넘김 · 띠 data-gwan-maint="staff"
  ④ 문서 822 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

GP, LD, EP, MM, GL = rd('site/src/app/[gwan]/page.tsx'), rd('site/src/app/lead/page.tsx'), rd('site/src/app/earn/page.tsx'), rd('site/src/components/money/MoneyMain.tsx'), rd('site/src/components/gwan/GwanLanding.tsx')
ok('① 관 화면 — 점검 중 운영자 확인(me · ADMIN · SUPER) · 손님만 안내 · 운영자 띠 · 새 관 404 건너뜀', "const staff = !!viewer?.roles?.some((r) => r === 'ADMIN' || r === 'SUPER');" in GP
   and 'if (mt?.running && !staff) return' in GP and 'data-gwan-maint="staff"' in GP and 'if (!staff && !on.some(' in GP, '')
ok('① 소개장터 · 안심 · 창업 · 소개리드 · 허브 — staff 면 닫힘 화면 건너뜀', 'staff={staff}' in GP and "if (!staff && ((gw && !gw.isActive)" in MM and 'const stopped = !staff &&' in GL
   and 'if (mt?.running && !staff) return' in LD and 'if (mt?.running && !staff) return' in EP, '')

d = doc('822_')
ok('④ 문서 822', all(w in d for w in ('운영자', '점검 중', '그대로')), str(len(d)))
ok('④ VERSION v10.714 이상', VT >= (10, 714), VER)
done()
