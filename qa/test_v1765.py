"""v10.765 (D328 · docs/873) 내 알림에서 관 점검 알림 끄기
  ① notify_code · 정책 줄 · fn_notice_notify(D223 그대로 + 종류 · 끈 사람 빼기) · 점검 공지 GWAN_MAINT
  ③ 정책 줄 · 함수 본문
  ④ 문서 873 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

M, MS, D223 = rd('prisma/migrations/D328_pages_ops_more3/migration.sql'), rd('src/modules/site/gwan-maint.service.ts'), rd('prisma/migrations/D223_notice_link_seller/migration.sql')
keep = ["fn_notice_audience(n.grades)", "'notice.notify_batch'", "'notice.notify_confirm_min'", "'/health/seller/center/notices#n-'", "'/community?board=NOTICE#n-'", "'NOTICE_NOTIFY_DONE'", "notified_count = total"]
ok('① 표 · 함수 · 서버', "CHECK (notify_code IN ('NOTICE_PUBLISHED', 'GWAN_MAINT'))" in M and "VALUES ('GWAN_MAINT', '관 점검 안내', true, false, NULL)" in M and all(x in M and x in D223 for x in keep)
   and "coalesce(n.notify_code, 'NOTICE_PUBLISHED')" in M and "np.channel = 'INAPP' AND NOT np.enabled" in M and "$6, 'GWAN_MAINT') RETURNING id::text AS id" in MS, '')
if up():
    pol = psql("SELECT optout_allowed FROM notification_event_policies WHERE event_code = 'GWAN_MAINT'")
    fn = psql("SELECT position('notify_code' IN prosrc) > 0 FROM pg_proc WHERE proname = 'fn_notice_notify'")
    ok('③ 정책 줄 · 함수에 notify_code', pol == 't' and fn == 't', f'{pol} {fn}')

d = doc('873_')
ok('④ 문서 873', all(w in d for w in ('관 점검 안내',)), str(len(d)))
ok('④ VERSION v10.765 이상', VT >= (10, 765), VER)
done()
