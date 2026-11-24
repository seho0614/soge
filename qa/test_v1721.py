"""v10.721 (D325 · docs/829) 점검 시간 반복
  ① (코드) gwan_maint_repeats · fillRepeats(7일 · 겹치면 건너뜀 · 한 번만) · 멈춤(시작 안 한 것 취소) · 화면
  ③ (API) LED 반복 → 점검 생김 · 다시 만들어도 한 번 · 멈춤 → 취소 — 끝나면 지움(늘 혼자)
  ④ 문서 829 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

M, SV, SP = rd('prisma/migrations/D325_pages_ops_bundle/migration.sql'), rd('src/modules/site/gwan-maint.service.ts'), rd('web/src/app/admin/SitePages.tsx')
ok('① 표 · 서버 · 화면', 'CREATE TABLE IF NOT EXISTS public.gwan_maint_repeats' in M and 'gwan_maint_repeat_slot_uq' in M and 'private async fillRepeats()' in SV and 'ON CONFLICT (repeat_id, starts_at)' in SV and 'data-gwan-maint-repeat-create' in SP, '')
if up():
    mark = psql("SELECT coalesce(max(id), 0) FROM gwan_maint_repeats"); mm = psql("SELECT coalesce(max(id), 0) FROM gwan_maintenances")
    try:
        import consent_ok
        consent_ok.agree('admin@x.com', PW)
        TS = login('admin@x.com')
        rp = call('POST', '/admin/gwan-maint-repeats', {'gwanCode': 'LED', 'dow': int(time.strftime('%w', time.gmtime(time.time() + 9 * 3600 + 2 * 86400))), 'atKst': '04:10', 'minutes': 15, 'note': '시험 1721'}, TS)
        n1 = psql(f"SELECT count(*) FROM gwan_maintenances WHERE repeat_id = {int(rp.get('id') or 0)}")
        call('POST', '/admin/jobs', {'job': 'gwan_maint'}, TS)
        n2 = psql(f"SELECT count(*) FROM gwan_maintenances WHERE repeat_id = {int(rp.get('id') or 0)}")
        st = call('POST', f"/admin/gwan-maint-repeats/{rp.get('id')}/stop", None, TS)
        n3 = psql(f"SELECT count(*) FROM gwan_maintenances WHERE repeat_id = {int(rp.get('id') or 0)} AND canceled_at IS NULL")
        ok('③ 반복 → 점검 1개 이상 · 작업 다시 돌려도 같은 수 · 멈춤 → 남은 것 취소', int(n1 or 0) >= 1 and n1 == n2 and st.get('stopped') is True and n3 == '0', f'{n1} {n2} {n3}')
    finally:
        psql(f"DELETE FROM gwan_maintenances WHERE id > {int(mm or 0)}; DELETE FROM gwan_maint_repeats WHERE id > {int(mark or 0)}")

d = doc('829_')
ok('④ 문서 829', all(w in d for w in ('반복', '7일')), str(len(d)))
ok('④ VERSION v10.721 이상', VT >= (10, 721), VER)
done()
