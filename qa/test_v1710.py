"""v10.710 (D324 · docs/818) 점검 시간 손님 미리 알림 — 상단 고정 공지(지금 ~ 점검 끝) · 회원 알림(공지 알림 길) · 취소 · 지금 끝내기면 공지 내림
  ① (코드) D324 announce · notice_id · create(공지 · 끝 = 점검 끝 · notify) · cancel · end → dropNotice · 화면 고르기 2
  ③ (API) LED 점검(1시간 뒤 · 미리 알림 · 회원 알림) → 공지(상단 고정 · PUBLIC · 끝 = 점검 끝 · notify) · 공개 공지 목록에 보임 → 취소 → 공지 내림(끝 지금) — 끝나면 지움(늘 혼자)
  ④ 문서 818 · 판
"""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

M, SV, SP = rd('prisma/migrations/D324_maint_notice_publish_requests/migration.sql'), rd('src/modules/site/gwan-maint.service.ts'), rd('web/src/app/admin/SitePages.tsx')
ok('① D324 · 서버 — announce · notice_id · 공지(상단 고정 · PUBLIC · 끝 = 점검 끝 · notify) · 취소 · 지금 끝내기 → 공지 내림',
   'ADD COLUMN IF NOT EXISTS notice_id uuid REFERENCES public.notices(id)' in M and "VALUES ($1, $2, $3, true, now(), $4, $5, ARRAY['PUBLIC'], $6)" in SV
   and "await this.dropNotice(id, '점검 취소');" in SV and "await this.dropNotice(id, '점검 일찍 끝남');" in SV and 'private async dropNotice(' in SV, '')
ok('① 화면 — 「손님에게 미리 알림」 · 「회원 알림도」(미리 알림일 때만) · 목록 「공지함」', 'data-gwan-maint-announce' in SP and 'data-gwan-maint-notify' in SP and 'disabled={!f.announce}' in SP and '공지함' in SP, '')

if up():
    mark = psql("SELECT coalesce(max(id), 0) FROM gwan_maintenances")
    nid = ''
    try:
        import consent_ok
        consent_ok.agree('admin@x.com', PW)
        TS = login('admin@x.com')
        iso = lambda s: time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + s))
        m = call('POST', '/admin/gwan-maintenances', {'gwanCode': 'LED', 'startsAt': iso(3600), 'endsAt': iso(5400), 'note': '시험 1710', 'announce': True, 'notifyMembers': True}, TS)
        nid = m.get('noticeId') or ''
        n = psql(f"SELECT is_pinned || '|' || (grades = ARRAY['PUBLIC'])::text || '|' || notify || '|' || (abs(extract(epoch FROM ends_at - '{iso(5400)}'::timestamptz)) < 5)::text || '|' || (title LIKE '[점검 안내]%')::text FROM notices WHERE id = '{nid}'") if nid else ''
        ok('③ 미리 알림 — 공지(상단 고정 · PUBLIC · 회원 알림 · 끝 = 점검 끝 · 「[점검 안내]」)', m.get('announce') is True and n == 'true|true|true|true|true', f"{m.get('announce')} {nid} {n}")
        pub = call('GET', '/notices')
        ok('③ 공개 공지 목록에 보임', isinstance(pub, list) and any(str(x.get('id')) == nid for x in pub), str(len(pub) if isinstance(pub, list) else pub))
        c = call('POST', f"/admin/gwan-maintenances/{m.get('id')}/cancel", None, TS)
        ok('③ 취소 → 공지 내림(끝 = 지금 · 사유)', c.get('status') == 'CANCELED' and psql(f"SELECT (ends_at <= now() + interval '5 seconds')::text || '|' || coalesce(ended_reason, '') FROM notices WHERE id = '{nid}'") == 'true|점검 취소', '')
    finally:
        psql(f"DELETE FROM gwan_maintenances WHERE id > {int(mark or 0)}")
        if nid:
            psql(f"DELETE FROM notification_deliveries WHERE notification_id IN (SELECT id FROM notifications WHERE payload->>'noticeId' = '{nid}'); DELETE FROM notices WHERE id = '{nid}'")
        ok('③ 끝 — 시험 점검 · 공지 지움', psql(f"SELECT count(*) FROM gwan_maintenances WHERE id > {int(mark or 0)}") == '0', '')
else:
    print('API · DB 없음 — ③ 건너뜀')

d = doc('818_')
ok('④ 문서 818 — 미리 알림 · 상단 고정 공지 · 회원 알림 · 내림', all(w in d for w in ('미리 알림', '상단 고정', '회원 알림', '내림', 'D324')), str(len(d)))
ok('④ VERSION v10.710 이상', VT >= (10, 710), VER)
done()
