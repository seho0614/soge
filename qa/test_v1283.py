"""v10.283 ~ 285 (D212 · docs/411) — 요율 공지 열람 확인 · 대표 할 일 새 줄 · 공지 대량 알림 안전장치

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1283.py

  ① (코드) D212(읽음 기록 · 다시 알림 기록 · rate-legal · 알림 기준 설정 2 · 받은 사람 표 · 나눠 보내기 · NOTICE_NOTIFY_DONE) · API · 화면 · 명세 · 문서 411 · 마이그레이션 250 · 판 v10.285
  ② (DB) 다시 알림 기록은 고칠 수 없음 · 대표 할 일 rate-legal 적기 가능 · 설정 2개
  ③ (API v10.283) 요율 공지 — 읽음 0 / 대상 1 → 다시 알림 1곳 → 24시간 안 409 REMIND_TOO_SOON → 판매자가 펼침 → 읽음 1 / 1 ·
     공지 게시 안 한 예약 409 REMIND_NOT_READY · 대상 없음 409 ALL_READ · 판매자에게 안 보이는 공지 404 · 판매자 아님 403
  ④ (API v10.284) 대표 할 일 — 새 4줄(type-rates · privacy-11 · rate-notice · rate-legal) · rate-legal 직접 확인 「적기」
  ⑤ (API v10.285) 받는 사람이 기준 이상 → 확인 문구 없으면 422 NOTIFY_CONFIRM_REQUIRED · 있으면 한 번에 기준 수만 · 「보내는 중」 · 정기 작업이 나머지 ·
     같은 사람 두 번 없음 · 다 보내면 운영 알림 NOTICE_NOTIFY_DONE · 받는 사람 수 API needsConfirm
  ⑥ (화면) 노출 › 메인 운영 › 「콘텐츠」 「공지 알림 기준」 · 소개몰 › 「소개몰 정산」 › 「요율 변경 예정」 읽음 n / 대상 m
  설정은 처음대로 · 예약은 취소 · 시험 공지는 끝냄(두 번 돌아도 통과).
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.request

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
M12 = rd('prisma/migrations/D212_notice_reads_bulk/migration.sql')
RS, HS, HC = rd('src/modules/health/health-rate-schedule.service.ts'), rd('src/modules/health/health-seller.service.ts'), rd('src/modules/health/health-seller.controller.ts')
OT, LW = rd('src/modules/admin/owner-todo.service.ts'), rd('src/modules/admin/launch-watch.controller.ts')
SS, SC, SD = rd('src/modules/site/site.service.ts'), rd('src/modules/site/site.controller.ts'), rd('src/modules/site/site.dto.ts')
MO, TR, CEN, EN = rd('web/src/app/admin/MainOps.tsx'), rd('web/src/app/admin/HealthTypeRates.tsx'), rd('site/src/components/health/SellerCenter.tsx'), rd('src/common/i18n/server-text.en.ts')
SCR = rd('spec/screens.json')
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []
D411 = next((open(os.path.join(K, 'docs', x), encoding='utf-8').read() for x in docs if x.startswith('411_')), '')
mig = [d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isfile(os.path.join(K, 'prisma/migrations', d, 'migration.sql'))] if os.path.isdir(os.path.join(K, 'prisma/migrations')) else []
BAD = re.compile(r'\b(DELETE FROM|DROP TABLE|DROP FUNCTION|TRUNCATE)\b')

ok('① D212 — notice_reads · hlt_rate_reminds(쌓기만) · rate-legal · 설정 2(1000 · 2000) · notice_notified · 나눠 보내기 · NOTICE_NOTIFY_DONE · 지우는 문장 없음',
   'CREATE TABLE IF NOT EXISTS public.notice_reads' in M12 and 'CREATE TABLE IF NOT EXISTS public.hlt_rate_reminds' in M12 and 'trg_hlt_rate_reminds_guard' in M12
   and "'rate-legal'" in M12 and "('notice.notify_confirm_min', '1000'" in M12 and "('notice.notify_batch', '2000'" in M12
   and 'CREATE TABLE IF NOT EXISTS public.notice_notified' in M12 and 'LIMIT batch' in M12 and "'NOTICE_NOTIFY_DONE'" in M12 and not BAD.search(M12), '')
ok('① API — 판매자 공지 읽음 · 읽음 n / 대상 m · 다시 알림(24시간 · 기록 · 감사) · 대표 할 일 4줄 · rate-legal 적기 · 확인 문구 422 · 게시 확인 문구',
   'async readNotice(' in HS and "@Post('me/health/seller/notices/:id/read')" in HC and "@Post('admin/health/rate-schedules/:id/remind')" in HC
   and "@Audit('HLT_RATE_NOTICE_REMIND', 'HLT_COMMISSION')" in HC and 'async remind(' in RS and "'REMIND_TOO_SOON'" in RS and "'ALL_READ'" in RS and "'REMIND_NOT_READY'" in RS
   and '"noticeReads"' in RS and all(f"key: '{k}'" in OT for k in ('type-rates', 'privacy-11', 'rate-notice', 'rate-legal'))
   and "'rate-legal']" in LW and "'NOTIFY_CONFIRM_REQUIRED'" in SS and "'모두에게 알림'" in SS and 'class NoticePublishDto' in SD and 'NoticePublishDto' in SC, '')
ok('① 화면 · 명세 · 문서 — 판매자센터 펼치면 읽음 · 읽음 칸 · 다시 알림 단추 · 보내는 중 · 확인 문구 · 공지 알림 기준 · 명세 2 · 영어 · 문서 411 · 마이그레이션 250 · 판 v10.285',
   'markRead(x.id)' in CEN and '/notices/${id}/read' in CEN and 'data-rate-notice-reads=' in TR and 'data-rate-notice-remind=' in TR
   and "'sending'" in MO and 'askBulk' in MO and 'data-notice-notify-limits' in MO and 'data-notice-limit=' in MO
   and '"POST /admin/health/rate-schedules/{id}/remind"' in SCR and '"POST /me/health/seller/notices/{id}/read"' in SCR
   and '"다시 알림은 24시간에 한 번만 보낼 수 있습니다.": ' in EN and bool(D411) and len(mig) in (250, 251, 252, 253) and tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 285),
   f'{len(mig)} · {VER} · 411 {bool(D411)}')


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        raw = urllib.request.urlopen(r, timeout=180).read()
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
SEL = f't1283sel{stamp}@x.com'
TAG = f'시험 1283 {stamp}'
T0 = psql('SELECT now()')
iso = lambda sec: time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + sec))
sched = lambda rows, i: next((x for x in (rows if isinstance(rows, list) else []) if x.get('id') == i), {})
if API and DB:
    import consent_ok
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{SEL}', '시험1283', '{pw}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{SEL}'")
    consent_ok.agree(SEL, PW); consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    login = lambda e: call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')
    TS, TB, TL = login('admin@x.com'), login('buyer@x.com'), login(SEL)
    sid_, schs, bulk_id = '', [], ''
    old = {k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'") for k in ('notice.notify_confirm_min', 'notice.notify_batch')}
    try:
        sid_ = psql(f"INSERT INTO hlt_sellers (code, account_id, type, name, personal, ceo_name, cs_tel, return_addr, status, applied_at, submerchant_id) "
                    f"VALUES ('TN-J{stamp}', '{aid}', 'TENANT', '시험 가게 1283', true, '홍길동', '02-000-0000', '서울 강남구 테헤란로 1', 'ACTIVE', now(), 'SUB-T1283') RETURNING id").splitlines()[0]

        def mk_sched(scope, target, published):
            nid = psql(f"INSERT INTO notices (gwan_code, title, body, grades, published_at) VALUES ('HLT', '{TAG} 요율 {scope}', '요율 본문', ARRAY['SELLER'], "
                       f"{'now()' if published else 'NULL'}) RETURNING id").splitlines()[0]
            sid = psql(f"INSERT INTO hlt_rate_schedules (scope, target, to_rate, effective_at, reason, notice_id) VALUES ('{scope}', '{target}', 20, now() + interval '40 days', '시험 1283', '{nid}') RETURNING id").splitlines()[0]
            schs.append(sid)
            return sid, nid

        s1, n1 = mk_sched('SELLER', sid_, True)
        s2, _ = mk_sched('CATEGORY', f'Z1283{stamp}', True)
        s3, _ = mk_sched('CATEGORY', f'Y1283{stamp}', False)

        # ②
        d1 = psql(f"INSERT INTO hlt_rate_reminds (schedule_id, sent) VALUES ('{s3}', 0) RETURNING id")
        d2 = psql(f"UPDATE hlt_rate_reminds SET sent = 9 WHERE schedule_id = '{s3}'")
        d3 = psql("SELECT count(*) FROM site_settings WHERE key IN ('notice.notify_confirm_min', 'notice.notify_batch')")
        ok('② DB — 다시 알림 기록 고치기 막힘(APND) · 알림 기준 설정 2개',
           '!' not in d1 and 'APND' in d2 and d3 == '2', f'{d2[-50:]} · {d3}')

        # ③ v10.283
        l0 = sched(call('GET', '/admin/health/rate-schedules', None, TS), s1)
        r1 = call('POST', f'/admin/health/rate-schedules/{s1}/remind', None, TS)
        got = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{aid}' AND title = '[다시 알림] 판매 수수료율 변경 예정 안내'")
        r2 = call('POST', f'/admin/health/rate-schedules/{s1}/remind', None, TS)
        rd1 = call('POST', f'/me/health/seller/notices/{n1}/read', None, TL)
        rd2 = call('POST', f'/me/health/seller/notices/{n1}/read', None, TL)
        reads = psql(f"SELECT reads FROM notice_reads WHERE notice_id = '{n1}' AND account_id = '{aid}'")
        l1 = sched(call('GET', '/admin/health/rate-schedules', None, TS), s1)
        r3 = call('POST', f'/admin/health/rate-schedules/{s3}/remind', None, TS)
        r4 = call('POST', f'/admin/health/rate-schedules/{s2}/remind', None, TS)
        hidden = psql(f"INSERT INTO notices (title, body, grades, published_at) VALUES ('{TAG} 회원', 'x', ARRAY['MEMBER'], now()) RETURNING id").splitlines()[0]
        rd3 = call('POST', f'/me/health/seller/notices/{hidden}/read', None, TL)
        rd4 = call('POST', f'/me/health/seller/notices/{n1}/read', None, TB)
        ok('③ 요율 공지 열람 — 읽음 0 / 대상 1 → 다시 알림 1곳(알림 1) → 24시간 안 409 REMIND_TOO_SOON → 판매자가 펼침(두 번 → 횟수 2) → 읽음 1 / 1 · 다시 알림 1번 · '
           '공지 안 한 예약 409 REMIND_NOT_READY · 대상 없음 409 ALL_READ · 안 보이는 공지 404 · 판매자 아님 403',
           l0.get('noticeReads') == 0 and l0.get('affectedNow') == 1 and r1.get('sent') == 1 and got == '1' and r2.get('code') == 'REMIND_TOO_SOON'
           and rd1.get('ok') is True and rd2.get('ok') is True and reads == '2' and l1.get('noticeReads') == 1 and l1.get('reminds') == 1 and bool(l1.get('remindedAt'))
           and r3.get('code') == 'REMIND_NOT_READY' and r4.get('code') == 'ALL_READ' and rd3.get('_err') == 404 and rd4.get('_err') == 403,
           f"{l0.get('noticeReads')}/{l0.get('affectedNow')} · {r1} · {r2.get('code')} · reads {reads} · {l1.get('noticeReads')} · {r3.get('code')} · {r4.get('code')} · {rd3.get('_err')} · {rd4.get('_err')}")

        # ④ v10.284
        td = call('GET', '/admin/launch-watch/owner-todo', None, TS)
        rows = {r['key']: r for r in td.get('rows', [])}
        m1 = call('POST', '/admin/launch-watch/owner-todo/mark', {'key': 'rate-legal', 'done': True, 'note': '시험 1283 법무에 알림'}, TS)
        td2 = call('GET', '/admin/launch-watch/owner-todo', None, TS)
        rl = next((r for r in td2.get('rows', []) if r.get('key') == 'rate-legal'), {})
        m2 = call('POST', '/admin/launch-watch/owner-todo/mark', {'key': 'rate-legal', 'done': False, 'note': '시험 1283 처음대로'}, TS)
        ok('④ 대표 할 일 — 새 4줄(입점 유형 요율 · 처리방침 1.1 · 요율 공지 빠뜨림 · 법무 알림) · 전체 19 · rate-legal 직접 확인 → 「적기」 끝남',
           all(k in rows for k in ('type-rates', 'privacy-11', 'rate-notice', 'rate-legal')) and rows.get('rate-legal', {}).get('manual') is True
           and td.get('total') == 19 and rows.get('type-rates', {}).get('go') == 'hlt-settle' and rows.get('rate-notice', {}).get('done') in (True, False)
           and m1.get('_err') is None and rl.get('done') is True and m2.get('_err') is None,
           f"{td.get('total')} · {[k for k in ('type-rates', 'privacy-11', 'rate-notice', 'rate-legal') if k in rows]} · {rl.get('done')}")

        # ⑤ v10.285
        psql("UPDATE site_settings SET value = '1' WHERE key = 'notice.notify_confirm_min'")
        psql("UPDATE site_settings SET value = '1' WHERE key = 'notice.notify_batch'")
        au = call('GET', '/admin/notices/audience?grades=MEMBER', None, TS)
        e1 = call('POST', '/admin/notices', {'title': f'{TAG} 대량', 'body': '대량 알림 본문', 'grades': ['MEMBER'], 'publishedAt': iso(-60), 'notify': True}, TS)
        b1 = call('POST', '/admin/notices', {'title': f'{TAG} 대량', 'body': '대량 알림 본문', 'grades': ['MEMBER'], 'publishedAt': iso(-60), 'notify': True, 'notifyConfirm': '모두에게 알림'}, TS)
        bulk_id = b1.get('id') or ''
        row1 = next((x for x in call('GET', '/admin/notices', None, TS) if x.get('id') == bulk_id), {})
        psql("UPDATE site_settings SET value = '100000' WHERE key = 'notice.notify_batch'")
        j = call('POST', '/admin/jobs', {'job': 'notice_schedule'}, TS)
        row2 = next((x for x in call('GET', '/admin/notices', None, TS) if x.get('id') == bulk_id), {})
        dup = psql(f"SELECT count(*) FROM (SELECT account_id FROM notifications WHERE event_code = 'NOTICE_PUBLISHED' AND title = '새 공지 — {TAG} 대량' GROUP BY account_id HAVING count(*) > 1) x")
        tot = psql(f"SELECT count(*) FROM notifications WHERE event_code = 'NOTICE_PUBLISHED' AND title = '새 공지 — {TAG} 대량'")
        nn = psql(f"SELECT count(*) FROM notice_notified WHERE notice_id = '{bulk_id}'") if bulk_id else ''
        al = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'NOTICE_NOTIFY_DONE' AND raised_at >= '{T0}' AND title LIKE '%{TAG} 대량%'")
        ok('⑤ 대량 알림 — 받는 수 needsConfirm · 확인 문구 없으면 422 NOTIFY_CONFIRM_REQUIRED · 있으면 한 번에 1명 · 「보내는 중」 · 정기 작업이 나머지 · 같은 사람 두 번 없음 · 받은 사람 표 = 보낸 수 · 운영 알림 NOTICE_NOTIFY_DONE 1',
           au.get('needsConfirm') is True and au.get('confirmText') == '모두에게 알림' and e1.get('code') == 'NOTIFY_CONFIRM_REQUIRED'
           and b1.get('notified') == 1 and row1.get('notifying') is True and row1.get('notifiedAt') is None and '_err' not in j
           and bool(row2.get('notifiedAt')) and row2.get('notifiedCount') == int(tot or 0) and int(tot or 0) >= 2 and dup == '0' and nn == tot and al == '1',
           f"{au.get('needsConfirm')} · {e1.get('code')} · first {b1.get('notified')} · {row1.get('notifying')} · total {tot} · notified {row2.get('notifiedCount')} · dup {dup} · alert {al}")

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
                    seen['todo'] = pg.locator('[data-owner-row="rate-legal"]').count()
                    pg.goto(ADMIN_WEB + '/#/mainops/content', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                    seen['limits'] = pg.locator('[data-notice-limit]').count()
                    pg.goto(ADMIN_WEB + '/#/hlt-settle', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(3000)
                    seen['reads'] = pg.locator(f'[data-rate-notice-reads="1/1"]').count()
                    pg.screenshot(path=os.path.join(HERE, 'v1283_settle.png'), full_page=True)
                    b.close()
            except Exception as ex:
                perr.append(str(ex)[:160])
            ok('⑥ 화면 — 첫 화면 대표 할 일 rate-legal 줄 · 「콘텐츠」 공지 알림 기준 2칸 · 「소개몰 정산」 「요율 변경 예정」 읽음 1 / 대상 1 · 화면 오류 없음',
               seen.get('todo') == 1 and seen.get('limits') == 2 and (seen.get('reads') or 0) >= 1 and not perr, f'{seen} · {perr[:2]}')
        else:
            print('  (화면 · playwright 없음 — ⑥ 건너뜀)')
    finally:
        for k, v in old.items():
            psql(f"UPDATE site_settings SET value = '{v or ('1000' if k.endswith('min') else '2000')}' WHERE key = '{k}'")
        for s_ in schs:
            psql(f"UPDATE hlt_rate_schedules SET status = 'CANCELED', canceled_at = now(), cancel_reason = '시험 1283 정리' WHERE id = '{s_}' AND status = 'SCHEDULED'")
        psql(f"UPDATE notices SET is_pinned = false, notify = false WHERE title LIKE '시험 1283 %'")
        psql(f"UPDATE notices SET ends_at = now() WHERE title LIKE '시험 1283 %' AND published_at IS NOT NULL AND published_at <= now() AND ends_at IS NULL "
             f"AND NOT EXISTS (SELECT 1 FROM hlt_rate_schedules r WHERE r.notice_id = notices.id OR r.cancel_notice_id = notices.id)")
        psql(f"DELETE FROM notifications WHERE title = '새 공지 — {TAG} 대량' OR account_id = '{aid}'")
        if sid_:
            psql(f"DELETE FROM hlt_sellers WHERE id = '{sid_}'")
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
