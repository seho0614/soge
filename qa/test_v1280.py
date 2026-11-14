"""v10.280 ~ 282 (D211 · docs/410) — 공지 고치기 · 내리기 · 새 공지 알림 · 예약 게시 · 게시 기간

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 SITE=http://localhost:15174 python3 test_v1280.py

  ① (코드) D211(끝 시각 · 고친 기록 · 요율 공지 잠금 · 알림 칸 · 받을 사람 · 정기 작업) · API(고치기 · 내리기 · 다시 게시 · 고친 기록 · 받을 사람 수) ·
     공지 읽는 곳 끝 시각 거름 · AI 상담은 전체 공개 공지만 · 화면 · 명세 · 문서 410 · 마이그레이션 249 · 판 v10.282
  ② (DB) 게시한 요율 공지 — 본문 · 끝 시각 · 등급 · 지우기 막힘(고정은 됨) · 고친 기록 고치기 막힘 · 끝 시각은 게시 뒤
  ③ (API v10.280) 게시 공지 고치기 — 사유 없으면 422 · 고친 기록 · 내리기 → 안 보임 · 다시 게시 → 보임 · 초안 내리기 409 · 요율 공지 409 NOTICE_LOCKED · 회원 403
  ④ (API v10.281) 알림 — 판매자 등급 공지 게시 → 그 판매자 「내 알림」 · 회원은 안 받음 · 받는 사람 수 · 전체 공개 422 · 알림 끈 사람 뺌 · 다시 게시해도 두 번 안 감
  ⑤ (API v10.282) 예약 → 안 보임(상태 SCHEDULED) → 시각 지남 + 정기 작업 notice_schedule → 보임 · 알림 · 끝 날짜 지나면 안 보임(ENDED) · 끝 날짜가 게시보다 앞 422
  ⑥ (화면) 운영 화면 노출 › 메인 운영 › 「콘텐츠」 상태 · 알림 칸 · 고치기(요율 공지는 잠금 안내) · 내리기 · 고친 기록 · 게시 방법(지금 · 예약 · 초안) · 끝 날짜 · 알림 고르기
  만든 시험 공지는 끝내 두고(고친 기록이 있어 지우지 않음) 판매자 · 알림 · 설정은 지움(두 번 돌아도 통과).
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


VER = rd('VERSION').strip()
M11 = rd('prisma/migrations/D211_notice_manage/migration.sql')
SS, SC, SD = rd('src/modules/site/site.service.ts'), rd('src/modules/site/site.controller.ts'), rd('src/modules/site/site.dto.ts')
PS, HS, MS, AC = rd('src/modules/public/public.service.ts'), rd('src/modules/health/health-seller.service.ts'), rd('src/modules/site/main.service.ts'), rd('src/modules/agent/agent-chat.service.ts')
SCH, WC = rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')
MO, EN = rd('web/src/app/admin/MainOps.tsx'), rd('src/common/i18n/server-text.en.ts')
SCR = rd('spec/screens.json')
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []
D410 = next((open(os.path.join(K, 'docs', x), encoding='utf-8').read() for x in docs if x.startswith('410_')), '')
mig = [d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isfile(os.path.join(K, 'prisma/migrations', d, 'migration.sql'))] if os.path.isdir(os.path.join(K, 'prisma/migrations')) else []
BAD = re.compile(r'\b(DELETE FROM|DROP TABLE|DROP FUNCTION|TRUNCATE)\b')
ENDS = '(ends_at IS NULL OR ends_at > now())'

ok('① D211 — 끝 시각 · 내린 사유 · 고친 기록(쌓기만) · 요율 공지 잠금 · 알림 칸 · NOTICE_PUBLISHED(수신 거부 가능) · 받을 사람 · 한 번만 보냄 · 정기 작업 10분 · 지우는 문장 없음',
   'ADD COLUMN IF NOT EXISTS ends_at' in M11 and 'CREATE TABLE IF NOT EXISTS public.notice_revisions' in M11 and 'trg_notice_revision_guard' in M11
   and 'trg_notice_lock_guard' in M11 and 'NTCL:' in M11 and 'ck_notices_period' in M11 and "('NOTICE_PUBLISHED', '새 공지', true" in M11
   and 'FUNCTION public.fn_notice_audience(p_grades text[])' in M11 and "NOT ('PUBLIC' = ANY(p_grades))" in M11 and "array_remove(p_grades, 'STAFF')" in M11
   and 'n.notified_at IS NOT NULL' in M11 and "('notice_schedule', 10," in M11 and not BAD.search(M11), '')
ok('① API — 고치기(게시 중이면 사유) · 내리기(예약은 초안으로) · 다시 게시 · 고친 기록 · 받을 사람 수 · 알림 · 끝 시각 검사 · 요율 공지 409',
   all(x in SS for x in ('async updateNotice(', 'async unpublishNotice(', 'async noticeRevisions(', 'async noticeAudience(', "'REASON_REQUIRED'", "'NOTICE_LOCKED'",
                         "'NOTICE_NOT_LIVE'", "'NOTIFY_NO_AUDIENCE'", "'BAD_PERIOD'", 'fn_notice_notify($1::uuid)', "'REPUBLISH'"))
   and all(x in SC for x in ("@Patch('notices/:id')", "@Post('notices/:id/unpublish')", "@Get('notices/:id/revisions')", "@Get('notices/audience')", "@Audit('NOTICE_UPDATE', 'NOTICE')", "@Audit('NOTICE_UNPUBLISH', 'NOTICE')"))
   and 'class UpdateNoticeDto' in SD and 'class NoticeReasonDto' in SD and '@IsDateString() endsAt?' in SD, '')
ok('① 읽는 곳 — 공개 공지 · 판매자센터 · 관리자 공지 · 메인 공지 · AI 상담 모두 끝 시각 거름 · AI 상담은 전체 공개만 · 정기 작업 notice_schedule · 영어 문구',
   ENDS in PS and ENDS in HS and ENDS in SS and 'ends_at AS "endsAt"' in MS and ENDS in AC and "'PUBLIC' = ANY(grades)" in AC
   and "case 'notice_schedule':" in SCH and 'fn_notice_notify_due()' in SCH and "'notice_schedule'," in WC
   and '"공지를 찾을 수 없습니다.": ' in EN and '"게시한 수수료율 변경 공지는 고치거나 내릴 수 없습니다 — 입점 약관 제17조 4항 공지 기록": ' in EN, '')
ok('① 화면 · 명세 · 문서 — 상태 · 알림 칸 · 고치기 · 내리기 · 고친 기록 · 게시 방법 · 끝 날짜 · 알림 고르기 · 명세 4개 · 문서 410 · 마이그레이션 249 · 판 v10.282',
   all(x in MO for x in ('data-notice-status=', 'data-notice-notify=', 'data-notice-edit=', 'data-notice-down=', 'data-notice-revs=', 'data-notice-locked',
                         'data-mode="schedule"', 'data-notice-end', 'data-notice-notify-pick', 'data-notice-rev-list=', '/admin/notices/audience?grades='))
   and all(f'"{a}"' in SCR for a in ('GET /admin/notices/audience', 'PATCH /admin/notices/{id}', 'POST /admin/notices/{id}/unpublish', 'GET /admin/notices/{id}/revisions'))
   and bool(D410) and len(mig) in (249, 250, 251, 252, 253, 254, 255) and tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 282), f'{len(mig)} · {VER} · 410 {bool(D410)}')


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        raw = urllib.request.urlopen(r, timeout=120).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()


stamp = str(int(time.time()))[-7:]
SEL = f't1280sel{stamp}@x.com'
TAG = f'시험 1280 {stamp}'
ADM_Q = '/admin/notices?q=' + urllib.parse.quote(TAG)   # 공지가 쌓이면 초안이 50줄 밖으로 밀림 — 이 시험 공지만 찾음
iso = lambda sec: time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + sec))
ids = lambda rows: [x.get('id') for x in (rows if isinstance(rows, list) else [])]
if API and DB:
    import consent_ok
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{SEL}', '시험1280', '{pw}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{SEL}'")
    consent_ok.agree(SEL, PW); consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    login = lambda e: call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')
    TS, TB, TL = login('admin@x.com'), login('buyer@x.com'), login(SEL)
    sid_, rate_nid, rate_sid = '', '', ''
    mine = lambda: psql(f"SELECT count(*) FROM notifications WHERE account_id = '{aid}' AND event_code = 'NOTICE_PUBLISHED' AND title LIKE '새 공지 — {TAG}%'")
    try:
        sid_ = psql(f"INSERT INTO hlt_sellers (code, account_id, type, name, personal, ceo_name, cs_tel, return_addr, status, applied_at, submerchant_id) "
                    f"VALUES ('TN-H{stamp}', '{aid}', 'TENANT', '시험 가게 1280', true, '홍길동', '02-000-0000', '서울 강남구 테헤란로 1', 'ACTIVE', now(), 'SUB-T1280') RETURNING id").splitlines()[0]

        # ② DB — 게시한 요율 공지 잠금
        rate_nid = psql(f"INSERT INTO notices (gwan_code, title, body, grades) VALUES ('HLT', '{TAG} 요율', 'x', ARRAY['SELLER']) RETURNING id").splitlines()[0]
        rate_sid = psql(f"INSERT INTO hlt_rate_schedules (scope, target, to_rate, effective_at, reason, notice_id) VALUES ('SELLER', '{sid_}', 20, now() + interval '40 days', '시험 1280 잠금', '{rate_nid}') RETURNING id").splitlines()[0]
        d0 = psql(f"UPDATE notices SET body = '초안은 고침' WHERE id = '{rate_nid}'")
        psql(f"UPDATE notices SET published_at = now() WHERE id = '{rate_nid}'")
        d1 = psql(f"UPDATE notices SET body = 'y' WHERE id = '{rate_nid}'")
        d2 = psql(f"UPDATE notices SET ends_at = now() + interval '1 day' WHERE id = '{rate_nid}'")
        d3 = psql(f"UPDATE notices SET grades = ARRAY['PUBLIC'] WHERE id = '{rate_nid}'")
        d4 = psql(f"BEGIN; DELETE FROM notices WHERE id = '{rate_nid}'; ROLLBACK;")
        d5 = psql(f"UPDATE notices SET is_pinned = false WHERE id = '{rate_nid}'")
        tmp = psql(f"INSERT INTO notices (title, body, published_at) VALUES ('{TAG} 기간', 'x', now()) RETURNING id").splitlines()[0]
        d6 = psql(f"UPDATE notices SET ends_at = published_at - interval '1 hour' WHERE id = '{tmp}'")
        d7 = psql(f"BEGIN; INSERT INTO notice_revisions (notice_id, action, before) VALUES ('{tmp}', 'EDIT', '{{}}'); UPDATE notice_revisions SET reason = 'x' WHERE notice_id = '{tmp}'; ROLLBACK;")
        ok('② DB — 게시한 요율 공지: 본문 · 끝 시각 · 등급 · 지우기 막힘(초안 때 고치기 · 고정은 됨) · 끝 시각은 게시 뒤 · 고친 기록은 고칠 수 없음',
           '!' not in d0 and all('NTCL' in x for x in (d1, d2, d3, d4)) and '!' not in d5 and 'ck_notices_period' in d6 and 'NTCR' in d7,
           f'{d1[-40:]} · {d6[-30:]} · {d7[-30:]}')

        # ③ v10.280 고치기 · 내리기
        live = call('POST', '/admin/notices', {'title': f'{TAG} 회원', 'body': '회원 공지', 'grades': ['MEMBER'], 'publishedAt': iso(-60)}, TS)
        lid = live.get('id')
        e1 = call('PATCH', f'/admin/notices/{lid}', {'title': f'{TAG} 회원 고침'}, TS)
        u1 = call('PATCH', f'/admin/notices/{lid}', {'title': f'{TAG} 회원 고침', 'reason': '오타 고침'}, TS)
        revs = call('GET', f'/admin/notices/{lid}/revisions', None, TS)
        seen1 = lid in ids(call('GET', '/notices', None, TB))
        e2 = call('POST', f'/admin/notices/{lid}/unpublish', {'reason': 'x'}, TS)
        dn = call('POST', f'/admin/notices/{lid}/unpublish', {'reason': '잘못 올림'}, TS)
        seen2 = lid in ids(call('GET', '/notices', None, TB))
        row = next((x for x in call('GET', ADM_Q, None, TS) if x.get('id') == lid), {})
        rp = call('POST', f'/admin/notices/{lid}/publish', None, TS)
        seen3 = lid in ids(call('GET', '/notices', None, TB))
        draft = call('POST', '/admin/notices', {'title': f'{TAG} 초안', 'body': 'x', 'grades': ['PUBLIC']}, TS)
        e3 = call('POST', f"/admin/notices/{draft.get('id')}/unpublish", {'reason': '초안 내리기'}, TS)
        e4 = call('PATCH', f'/admin/notices/{rate_nid}', {'body': '바꿈', 'reason': '바꿔 봄'}, TS)
        e5 = call('POST', f'/admin/notices/{rate_nid}/unpublish', {'reason': '내려 봄'}, TS)
        pin = call('PATCH', f'/admin/notices/{rate_nid}', {'isPinned': True, 'reason': '고정'}, TS)
        e6 = call('PATCH', f'/admin/notices/{lid}', {'title': 'xx', 'reason': '회원'}, TB)
        ok('③ 고치기 · 내리기 — 사유 없으면 422 REASON_REQUIRED · 고친 기록 1(전 제목) · 내리기 사유 짧으면 400 · 내리면 회원도 안 보임(TAKEN_DOWN · 사유) · 다시 게시하면 보임 · 초안 내리기 409 · 요율 공지 고치기 · 내리기 409 NOTICE_LOCKED(고정은 됨) · 회원 403',
           bool(lid) and e1.get('code') == 'REASON_REQUIRED' and u1.get('ok') is True and isinstance(revs, list) and len(revs) == 1 and revs[0].get('before', {}).get('title') == f'{TAG} 회원'
           and seen1 and e2.get('_err') == 400 and dn.get('ok') is True and not seen2 and row.get('status') == 'TAKEN_DOWN' and row.get('endedReason') == '잘못 올림'
           and rp.get('ok') is True and seen3 and e3.get('code') == 'NOTICE_NOT_LIVE' and e4.get('code') == 'NOTICE_LOCKED' and e5.get('code') == 'NOTICE_LOCKED'
           and pin.get('ok') is True and e6.get('_err') == 403,
           f"{e1.get('code')} · revs {len(revs) if isinstance(revs, list) else revs} · {row.get('status')} · {e3.get('code')} · {e4.get('code')} · {e5.get('code')} · {pin}")

        # ④ v10.281 알림
        au = call('GET', '/admin/notices/audience?grades=SELLER', None, TS)
        aup = call('GET', '/admin/notices/audience?grades=PUBLIC,SELLER', None, TS)
        e7 = call('POST', '/admin/notices', {'title': f'{TAG} 전체알림', 'body': 'x', 'grades': ['PUBLIC'], 'notify': True}, TS)
        n1 = call('POST', '/admin/notices', {'title': f'{TAG} 판매자알림', 'body': '판매자 알림 본문', 'grades': ['SELLER'], 'publishedAt': iso(-60), 'notify': True}, TS)
        c1 = mine()
        buyer_got = psql(f"SELECT count(*) FROM notifications n JOIN accounts a ON a.id = n.account_id WHERE a.email = 'buyer@x.com' AND n.title LIKE '새 공지 — {TAG}%'")
        link = psql(f"SELECT link_url FROM notifications WHERE account_id = '{aid}' AND title LIKE '새 공지 — {TAG}%' LIMIT 1")
        call('POST', f"/admin/notices/{n1.get('id')}/unpublish", {'reason': '알림 두 번 시험'}, TS)
        call('POST', f"/admin/notices/{n1.get('id')}/publish", None, TS)
        c2 = mine()
        psql(f"INSERT INTO notification_preferences (account_id, event_code, channel, enabled) VALUES ('{aid}', 'NOTICE_PUBLISHED', 'INAPP', false)")
        au2 = call('GET', '/admin/notices/audience?grades=SELLER', None, TS)
        n2 = call('POST', '/admin/notices', {'title': f'{TAG} 끈사람', 'body': 'x', 'grades': ['SELLER'], 'publishedAt': iso(-60), 'notify': True}, TS)
        c3 = mine()
        psql(f"DELETE FROM notification_preferences WHERE account_id = '{aid}' AND event_code = 'NOTICE_PUBLISHED'")
        ok('④ 새 공지 알림 — 판매자 등급 공지 → 그 판매자 「내 알림」 1(/support/notices) · 회원은 안 받음 · 받는 사람 수 · 전체 공개 422 NOTIFY_NO_AUDIENCE · 다시 게시해도 한 번 · 알림 끈 사람 뺌',
           (au.get('count') or 0) >= 1 and au.get('sendable') is True and aup.get('sendable') is False and aup.get('count') == 0
           and e7.get('code') == 'NOTIFY_NO_AUDIENCE' and (n1.get('notified') or 0) >= 1 and c1 == '1' and buyer_got == '0' and link == '/support/notices'
           and c2 == '1' and au2.get('count') == au.get('count') - 1 and c3 == '1' and n2.get('id'),
           f"{au} · {e7.get('code')} · n1 {n1.get('notified')} · {c1}/{c2}/{c3} · buyer {buyer_got}")

        # ⑤ v10.282 예약 · 끝 날짜
        sc = call('POST', '/admin/notices', {'title': f'{TAG} 예약', 'body': '예약 본문', 'grades': ['SELLER'], 'publishedAt': iso(3600), 'notify': True}, TS)
        scid = sc.get('id')
        hid1 = scid in ids(call('GET', '/notices', None, TL))
        st1 = next((x.get('status') for x in call('GET', ADM_Q, None, TS) if x.get('id') == scid), None)
        c4 = mine()
        psql(f"UPDATE notices SET published_at = now() - interval '1 minute' WHERE id = '{scid}'")
        j = call('POST', '/admin/jobs', {'job': 'notice_schedule'}, TS)
        hid2 = scid in ids(call('GET', '/notices', None, TL))
        c5 = mine()
        en = call('POST', '/admin/notices', {'title': f'{TAG} 끝', 'body': 'x', 'grades': ['PUBLIC'], 'publishedAt': iso(-7200), 'endsAt': iso(-3600 * 1.5)}, TS)
        en_seen = en.get('id') in ids(call('GET', '/notices'))
        st2 = next((x.get('status') for x in call('GET', ADM_Q, None, TS) if x.get('id') == en.get('id')), None)
        e8 = call('POST', '/admin/notices', {'title': f'{TAG} 거꾸로', 'body': 'x', 'grades': ['PUBLIC'], 'publishedAt': iso(3600), 'endsAt': iso(60)}, TS)
        sc2 = call('POST', '/admin/notices', {'title': f'{TAG} 예약풀기', 'body': 'x', 'grades': ['PUBLIC'], 'publishedAt': iso(7200)}, TS)
        un = call('POST', f"/admin/notices/{sc2.get('id')}/unpublish", {'reason': '예약 취소'}, TS)
        st3 = next((x.get('status') for x in call('GET', ADM_Q, None, TS) if x.get('id') == sc2.get('id')), None)
        ok('⑤ 예약 게시 · 끝 날짜 — 예약은 안 보임(SCHEDULED · 알림 아직) → 시각 지남 + 정기 작업 notice_schedule → 보임 · 알림 1 · 끝 날짜 지난 공지 안 보임(ENDED) · 끝이 게시보다 앞 422 BAD_PERIOD · 예약 내리기는 초안으로',
           bool(scid) and not hid1 and st1 == 'SCHEDULED' and c4 == c3 and '_err' not in j and hid2 and int(c5 or 0) == int(c3 or 0) + 1
           and bool(en.get('id')) and not en_seen and st2 == 'ENDED' and e8.get('code') == 'BAD_PERIOD' and un.get('ok') is True and st3 == 'DRAFT',
           f'{st1} · job {str(j)[:60]} · {hid2} · {c4}→{c5} · {st2} · {e8.get("code")} · {st3}')

        try:
            from playwright.sync_api import sync_playwright
        except Exception:
            sync_playwright = None
        if sync_playwright and ADMIN_WEB:
            seen, perr = {}, []
            try:
                with sync_playwright() as p:
                    b = p.chromium.launch()
                    pg = b.new_page(viewport={'width': 1500, 'height': 1000}); pg.on('pageerror', lambda e: perr.append(str(e)[:120])); pg.on('dialog', lambda d: d.dismiss())
                    pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                    pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                    pg.wait_for_selector('[data-state-check]', timeout=30000)
                    pg.goto(ADMIN_WEB + '/#/mainops/content', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                    row_ = lambda i: pg.locator(f'[data-notice-row="{i}"]')
                    seen['live'] = row_(lid).first.get_attribute('data-notice-status') if row_(lid).count() else None
                    seen['notify'] = row_(n1.get('id')).locator('[data-notice-notify]').first.get_attribute('data-notice-notify') if row_(n1.get('id')).count() else None
                    seen['down'] = pg.locator(f'[data-notice-down="{lid}"]').count()
                    seen['rateDown'] = pg.locator(f'[data-notice-down="{rate_nid}"]').count()
                    seen['mode'] = pg.locator('[data-mode]').count()
                    seen['end'] = pg.locator('[data-notice-end]').count()
                    pg.locator(f'[data-notice-revs="{lid}"]').first.click(); pg.wait_for_timeout(1200)
                    seen['revs'] = pg.locator('[data-notice-rev-list]').first.get_attribute('data-notice-rev-list') if pg.locator('[data-notice-rev-list]').count() else None
                    pg.locator(f'[data-notice-edit="{lid}"]').first.click(); pg.wait_for_timeout(600)
                    seen['reason'] = pg.locator('[data-edit-reason]').count()
                    if pg.locator(f'[data-notice-edit="{rate_nid}"]').count():
                        pg.locator(f'[data-notice-edit="{rate_nid}"]').first.click(); pg.wait_for_timeout(600)
                    seen['locked'] = pg.locator('[data-notice-locked]').count()
                    pg.locator('[data-grade-pick="PUBLIC"]').first.check(); pg.wait_for_timeout(300)
                    seen['notifyOff'] = pg.locator('[data-notice-notify-pick]').first.is_disabled()
                    pg.screenshot(path=os.path.join(HERE, 'v1280_content.png'), full_page=True)
                    b.close()
            except Exception as ex:
                perr.append(str(ex)[:160])
            ok('⑥ 화면 — 노출 › 메인 운영 › 「콘텐츠」 상태(게시 중) · 알림 칸(보냄) · 내리기(요율 공지는 없음) · 고친 기록 펼침 · 고치기 사유 칸 · 요율 공지 잠금 안내 · 게시 방법 3 · 끝 날짜 · 전체 공개면 알림 못 고름 · 화면 오류 없음',
               seen.get('live') == 'LIVE' and seen.get('notify') == 'sent' and seen.get('down') == 1 and seen.get('rateDown') == 0 and seen.get('mode') == 3
               and seen.get('end') == 1 and seen.get('revs') not in (None, '0') and seen.get('reason') == 1 and seen.get('locked') == 1 and seen.get('notifyOff') is True and not perr,
               f'{seen} · {perr[:2]}')
        else:
            print('  (화면 · playwright 없음 — ⑥ 건너뜀)')
    finally:
        # 시험 공지는 끝냄(고친 기록이 있어 지우지 않음) · 게시한 요율 공지는 잠겨 그대로(고정만 풂)
        psql(f"UPDATE notices SET is_pinned = false, notify = false WHERE title LIKE '시험 1280 %'")
        psql(f"UPDATE notices SET ends_at = now() WHERE title LIKE '시험 1280 %' AND published_at IS NOT NULL AND published_at <= now() AND ends_at IS NULL "
             f"AND NOT EXISTS (SELECT 1 FROM hlt_rate_schedules r WHERE r.notice_id = notices.id OR r.cancel_notice_id = notices.id)")
        psql(f"UPDATE notices SET published_at = NULL WHERE title LIKE '시험 1280 %' AND published_at > now()")
        if rate_sid:
            psql(f"UPDATE hlt_rate_schedules SET status = 'CANCELED', canceled_at = now(), cancel_reason = '시험 1280 정리' WHERE id = '{rate_sid}' AND status = 'SCHEDULED'")
        psql(f"DELETE FROM notification_preferences WHERE account_id = '{aid}'")
        psql(f"DELETE FROM notifications WHERE account_id = '{aid}'")
        if sid_:
            psql(f"DELETE FROM hlt_sellers WHERE id = '{sid_}'")
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
