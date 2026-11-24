"""v10.767 (docs/875) 정기 작업 연속 실패 알림 — 이미 있음(ops.job_fail_streak)
  ① D307 설정 · 함수
  ④ 문서 875 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

D307 = rd('prisma/migrations/D307_job_fail_streak_perm_compare_daily/migration.sql')
ok('① 이미 있음 — 설정 2 ~ 10 · CRITICAL', "('ops.job_fail_streak', '3', 'ADMIN'" in D307 and "'^(0|[2-9]|10)$'" in D307 and "CASE WHEN unk THEN 'WARN' ELSE 'CRITICAL' END" in D307, '')

d = doc('875_')
ok('④ 문서 875', all(w in d for w in ('ops.job_fail_streak', '2')), str(len(d)))
ok('④ VERSION v10.767 이상', VT >= (10, 767), VER)
done()
