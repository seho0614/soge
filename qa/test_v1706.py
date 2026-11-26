"""v10.706 (D323 · docs/814) 관 점검 시간 예약 — 시작에 관을 닫고 · 예약 게시 · 끝에 다시 엶(열려 있던 관만)
  ① (코드) D323 표 · 겹침 막음 트리거 · 2시간 · 정기 작업 gwan_maint(1분 · 이름 3곳) · 서비스 tick · 컨트롤러(SUPER) · 화면 「관 점검 시간」
  ② (DB) 겹침 GWAN_MAINT_OVERLAP · 2시간 넘음 막힘
  ③ (API) 회원 403 · 3시간 422 · BIZ 점검(지금 ~ 10분) → 작업 → BIZ 닫힘 · RUNNING · 공개 안내 running · 사용자 웹 /biz 점검 안내 → 지금 끝내기 → BIZ 다시 열림 · DONE · 겹침 422 · 시작 전 취소 — 끝나면 지움 · BIZ 처음대로(늘 혼자)
  ④ 문서 814 · 판
"""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

M = rd('prisma/migrations/D323_gwan_maint_layout_log/migration.sql')
SV, CT, SC, WC, SP = (rd('src/modules/site/gwan-maint.service.ts'), rd('src/modules/site/gwan-maint.controller.ts'), rd('src/worker/scheduler.service.ts'),
                      rd('src/worker/worker.controller.ts'), rd('web/src/app/admin/SitePages.tsx'))
ok('① D323 — 점검 표 · 2시간 · 겹침 트리거 · 정기 작업 1분 · 권한 주소 · 지우는 문장 없음',
   all(w in M for w in ('CREATE TABLE IF NOT EXISTS public.gwan_maintenances', "ends_at <= starts_at + interval '2 hours'", 'GWAN_MAINT_OVERLAP:', "VALUES ('gwan_maint', 1,",
                        "('POST', '/admin/gwan-maintenances/{id}/end', 'gwan-ux', 'EDIT')")) and 'DELETE FROM' not in M, '')
ok('① 서버 — tick(시작에 닫고 was_open · 예약 게시 · 끝에 열려 있던 관만 다시 엶 · 못 열면 WARN) · 취소 · 지금 끝내기 · 정기 작업 이름 3곳',
   all(w in SV for w in ('async tick(', "UPDATE gwans SET is_active = false WHERE code = $1", "UPDATE gwans SET is_active = true WHERE code = $1 AND NOT is_active", 'this.layouts.publishDue()',
                         'this.pages.publishDue()', "'GWAN_MAINT_REOPEN_FAIL', 'WARN'", 'async cancel(', 'async end(', 'async publicStatus('))
   and "case 'gwan_maint':" in SC and "| 'gwan_maint'" in SC and "'gwan_maint'," in WC and CT.count("@Roles('SUPER')") >= 3 and "@Get('gwans/:code/maintenance')" in CT, '')
ok('① 화면 — 페이지 목록 맨 위 「관 점검 시간」(관 · 시작 · 길이 15 ~ 120분 · 안내 글 · 예약 · 취소 · 지금 끝내기)',
   all(w in SP for w in ('function Maint(', 'data-gwan-maint-form', '[15, 30, 60, 90, 120]', 'data-gwan-maint-create', 'data-gwan-maint-end', '<Maint isSuper={isSuper} />')), '')

if up():
    ok('② DB — 겹침 막힘 · 2시간 넘음 막힘', 'GWAN_MAINT_OVERLAP' in psql("BEGIN; INSERT INTO gwan_maintenances (gwan_code, starts_at, ends_at) VALUES ('LED', now() + interval '5 days', now() + interval '5 days 1 hour'); "
                                                                   "INSERT INTO gwan_maintenances (gwan_code, starts_at, ends_at) VALUES ('LED', now() + interval '5 days 30 minutes', now() + interval '5 days 90 minutes'); ROLLBACK;")
       and 'gwan_maint_span' in psql("BEGIN; INSERT INTO gwan_maintenances (gwan_code, starts_at, ends_at) VALUES ('LED', now(), now() + interval '3 hours'); ROLLBACK;"), '')
    biz_was = psql("SELECT is_active FROM gwans WHERE code = 'BIZ'")
    mark = psql("SELECT coalesce(max(id), 0) FROM gwan_maintenances")
    try:
        import consent_ok
        consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
        TS, TB = login('admin@x.com'), login('buyer@x.com')
        iso = lambda s: time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + s))
        b403 = call('POST', '/admin/gwan-maintenances', {'gwanCode': 'BIZ', 'startsAt': iso(60), 'endsAt': iso(600)}, TB)
        e3h = call('POST', '/admin/gwan-maintenances', {'gwanCode': 'BIZ', 'startsAt': iso(60), 'endsAt': iso(60 + 3 * 3600)}, TS)
        ok('③ 회원 403 · 3시간 422 GWAN_MAINT_TIME', b403.get('_err') == 403 and e3h.get('code') == 'GWAN_MAINT_TIME', f"{b403.get('_err')} {e3h.get('code')}")
        m1 = call('POST', '/admin/gwan-maintenances', {'gwanCode': 'BIZ', 'startsAt': iso(0), 'endsAt': iso(600), 'note': '시험 1706 점검'}, TS)
        ov = call('POST', '/admin/gwan-maintenances', {'gwanCode': 'BIZ', 'startsAt': iso(120), 'endsAt': iso(300)}, TS)
        jb = call('POST', '/admin/jobs', {'job': 'gwan_maint'}, TS)
        st = next((r for r in call('GET', '/admin/gwan-maintenances?gwanCode=BIZ', None, TS) if r.get('id') == m1.get('id')), {})
        pb = call('GET', '/gwans/BIZ/maintenance')
        ok('③ 점검 예약 → 작업 → BIZ 닫힘 · RUNNING · 시작 때 열려 있었음 · 공개 안내 running · 겹침 422', m1.get('status') == 'SCHEDULED' and ov.get('code') == 'GWAN_MAINT_OVERLAP'
           and psql("SELECT is_active FROM gwans WHERE code = 'BIZ'") == 'f' and st.get('status') == 'RUNNING' and st.get('wasOpen') is (biz_was == 't')
           and (pb.get('running') or {}).get('note') == '시험 1706 점검', f"{m1.get('status')} {ov.get('code')} {jb.get('detail', jb)} {st.get('status')} {pb.get('running')}")
        if SITE:
            s1, h1 = page_until('/biz', lambda h: 'data-gwan-maint="running"' in h and '시험 1706 점검' in h)
            ok('③ 사용자 웹 /biz — 점검 안내(관 화면 대신)', s1 == 200 and 'data-gwan-maint="running"' in h1 and '시험 1706 점검' in h1, str(s1))
        # 11/25 묶음 7 — 서버 「지금 끝내기」는 끝 시각을 greatest(시작 + 1초, 지금)으로 둠 · 시작 1초 안이면 다시 열기가 다음 정기 작업(1분)으로 밀림
        #   (빠른 점검판에서 RUNNING 으로 실패 · 서비스 고침은 다음 묶음 첫 판) — 시작 뒤 1.5초 지나서 끝냄
        time.sleep(1.5)
        en = call('POST', f"/admin/gwan-maintenances/{m1.get('id')}/end", None, TS)
        ok('③ 지금 끝내기 → DONE · BIZ 처음대로(열려 있던 관이면 다시 열림) · 공개 안내 없음', en.get('status') == 'DONE' and psql("SELECT is_active FROM gwans WHERE code = 'BIZ'") == biz_was
           and call('GET', '/gwans/BIZ/maintenance').get('running') is None, f"{en.get('status')} {en.get('reopenError')}")
        m2 = call('POST', '/admin/gwan-maintenances', {'gwanCode': 'BIZ', 'startsAt': iso(7200), 'endsAt': iso(7800)}, TS)
        c2 = call('POST', f"/admin/gwan-maintenances/{m2.get('id')}/cancel", None, TS)
        c3 = call('POST', f"/admin/gwan-maintenances/{m1.get('id')}/cancel", None, TS)
        ok('③ 시작 전 취소 · 끝난 것 취소 422', c2.get('status') == 'CANCELED' and c3.get('code') == 'GWAN_MAINT_STATE', f"{c2.get('status')} {c3.get('code')}")
    finally:
        psql(f"DELETE FROM gwan_maintenances m WHERE m.id > {int(mark or 0)} AND NOT EXISTS (SELECT 1 FROM gwan_open_log l WHERE l.maint_id = m.id)")   # v10.727 (D325) 관 열기 · 닫기 기록(쌓기만)이 가리키는 점검은 남김
        if biz_was == 't':
            psql("UPDATE gwans SET is_active = true WHERE code = 'BIZ' AND NOT is_active")
        ok('③ 끝 — 시험 점검 지움 · BIZ 처음대로', psql(f"SELECT count(*) FROM gwan_maintenances m WHERE m.id > {int(mark or 0)} AND NOT EXISTS (SELECT 1 FROM gwan_open_log l WHERE l.maint_id = m.id)") == '0' and psql("SELECT is_active FROM gwans WHERE code = 'BIZ'") == biz_was, '')
else:
    print('API · DB 없음 — ② · ③ 건너뜀')

d = doc('814_')
ok('④ 문서 814 — 점검 시간 · 2시간 · 다시 엶 · 예약 게시', all(w in d for w in ('점검 시간', '2시간', '다시 엶', '예약 게시', 'D323')), str(len(d)))
ok('④ VERSION v10.706 이상', VT >= (10, 706), VER)
done()
