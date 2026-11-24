"""v10.768 (D328 · docs/876) 하루 요약 보내는 시각 ops.digest_hour
  ① 설정 · 트리거
  ③ 8 로 바꾸면 launch_digest 8시 · 되돌림(늘 혼자)
  ④ 문서 876 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

M = rd('prisma/migrations/D328_pages_ops_more3/migration.sql')
ok('① 설정 · 트리거', "('ops.digest_hour', '9', 'ADMIN'" in M and 'CREATE TRIGGER trg_digest_hour_sync AFTER INSERT OR UPDATE OF value ON public.site_settings' in M and "WHERE job = 'launch_digest'" in M, '')
if up():
    was = psql("SELECT value FROM site_settings WHERE key = 'ops.digest_hour'") or '9'
    h0 = psql("SELECT at_hour FROM job_schedules WHERE job = 'launch_digest'") or '9'
    try:
        psql("UPDATE site_settings SET value = '8' WHERE key = 'ops.digest_hour'")
        h = psql("SELECT at_hour FROM job_schedules WHERE job = 'launch_digest'")
        ok('③ 8 → 정기 작업 8시', h == '8', str(h))
    finally:
        psql(f"UPDATE site_settings SET value = '{was}' WHERE key = 'ops.digest_hour'")
        psql(f"UPDATE job_schedules SET at_hour = {int(h0)} WHERE job = 'launch_digest'")

d = doc('876_')
ok('④ 문서 876', all(w in d for w in ('ops.digest_hour',)), str(len(d)))
ok('④ VERSION v10.768 이상', VT >= (10, 768), VER)
done()
