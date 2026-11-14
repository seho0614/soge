"""v10.297 (D217 · docs/416) — 요율 알림 메일 · 문자 대기열 시험 · 운영 화면 발송 현황

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1297.py

  ① (코드) D217 hlt_rate_notifications(예약 · 알림 · 종류) · 예약 · 취소 · 다시 알림 때 묶음 · 발송 현황 API · 목록 한 줄 · 운영 화면 「발송 현황」 · 화면 연결
  ② (API · 정기 작업) 요율 예약 → 판매자 알림 묶임(SCHEDULE) · 발송 전 「아직」 · notify_dispatch(메일 켬 · 문자 준비 안 됨 · 조용한 시간 끔)
     → 메일 대기(또는 보냄) · 문자 실패(사유) · 발송 현황 · 목록 숫자 · 취소 알림도 묶임(CANCEL) · 없는 예약 404 · 회원 403
  ③ (화면) 소개몰 › 소개몰 정산 › 「요율 변경 예정」 — 「발송 현황」 → 메일 · 문자 표 · 화면 오류 없음
  예약은 취소 · 판매자 · 알림은 지움 · 설정은 되돌림(두 번 돌아도 통과).
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB, SITE = os.environ.get('ADMIN_WEB'), os.environ.get('SITE')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''



VER = rd('VERSION').strip()
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []
D416 = next((open(os.path.join(K, 'docs', x), encoding='utf-8').read() for x in docs if x.startswith('416_')), '')
verok = lambda n: tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, n)
M17 = rd('prisma/migrations/D217_notice_files_translate_rate_send/migration.sql')
RS, CT = rd('src/modules/health/health-rate-schedule.service.ts'), rd('src/modules/health/health-seller.controller.ts')
HW, SCR = rd('web/src/app/admin/HealthTypeRates.tsx'), rd('spec/screens.json')
ok('① D217 — hlt_rate_notifications(알림 id · 예약 · 종류 SCHEDULE · CANCEL · REMIND · 알림 지우면 같이)',
   'CREATE TABLE IF NOT EXISTS public.hlt_rate_notifications' in M17 and "CHECK (kind IN ('SCHEDULE', 'CANCEL', 'REMIND'))" in M17
   and 'REFERENCES public.notifications(id) ON DELETE CASCADE' in M17, '')
ok('① 서버 — 예약 · 취소 · 다시 알림 때 묶음 · 발송 현황(보냄 · 대기 · 실패 · 아직 · 주소 없음 · 사유 · 채널) · 목록 한 줄 · GET …/send-status · 화면 연결',
   "this.notifySellers(row.id, 'SCHEDULE'," in RS and "this.notifySellers(id, 'CANCEL'," in RS and "await this.link(id, 'REMIND'," in RS and 'async sendStatus(scheduleId: string)' in RS
   and '"emailWaiting"' in RS and '"smsNone"' in RS and 'AS "sendFailed"' in RS and "@Get('admin/health/rate-schedules/:id/send-status')" in CT
   and '"GET /admin/health/rate-schedules/{id}/send-status"' in SCR, '')
ok('① 화면 — 「요율 변경 예정」 알린 판매자 칸에 알림 · 메일 · 문자 · 실패 · 「발송 현황」 표 · 문서 416 · 판 v10.297',
   'data-rate-send=' in HW and 'data-rate-send-open=' in HW and 'data-rate-send-status=' in HW and "data-rate-send-row={c}" in HW and '발송 현황' in D416 and verok(297), f'{VER}')

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



def cancel_mine():
    psql("UPDATE hlt_rate_schedules SET status = 'CANCELED', canceled_at = now(), cancel_reason = '시험 1297 정리' "
         "WHERE status = 'SCHEDULED' AND reason LIKE '%1297%' AND effective_at > now()")


stamp = str(int(time.time()))[-7:]
SEL = f't1297sel{stamp}@x.com'
CODE = f'TN-Q{stamp}'
if API and DB:
    import consent_ok
    cancel_mine()
    psql("UPDATE hlt_seller_type_rates SET rate = NULL")
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{SEL}', '시험1297', '{pw}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{SEL}'")
    ph = psql(f"UPDATE accounts SET phone = '0101297{stamp[-4:]}' WHERE id = '{aid}'")
    consent_ok.agree(SEL, PW); consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    login = lambda e: call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    EFF = psql("SELECT to_char((now() AT TIME ZONE 'Asia/Seoul')::date + 40, 'YYYY-MM-DD')")
    KEYS = ['notify.email_verified', 'notify.sms_ready', 'notify.alimtalk_ready', 'notify.quiet_start', 'notify.quiet_end']
    before = {k: psql(f"SELECT coalesce(value, '<NULL>') FROM site_settings WHERE key = '{k}'") for k in KEYS}
    sid_, made, sch = '', [], ''
    my = lambda ch: psql(f"SELECT d.status || '|' || coalesce(d.failed_reason, '') FROM notification_deliveries d JOIN hlt_rate_notifications h ON h.notification_id = d.notification_id "
                        f"JOIN notifications n ON n.id = h.notification_id WHERE h.schedule_id = '{sch}' AND n.account_id = '{aid}' AND d.channel = '{ch}'")
    try:
        sid_ = psql(f"INSERT INTO hlt_sellers (code, account_id, type, name, personal, ceo_name, cs_tel, return_addr, status, applied_at, submerchant_id) "
                    f"VALUES ('{CODE}', '{aid}', 'TENANT', '시험 가게 1297', true, '홍길동', '02-000-0000', '서울 강남구 테헤란로 1', 'ACTIVE', now(), 'SUB-T1297') RETURNING id").splitlines()[0]
        cat = psql("SELECT id FROM categories WHERE gwan_code = 'HLT' AND code = 'HLT_FUNC'")
        psql(f"INSERT INTO hlt_products (code, name, price, stock, status, seller_id, review_state, category_id) VALUES ('{CODE}-A', '시험 상품 1297', 10000, 5, 'DRAFT', '{sid_}', 'APPROVED', '{cat}')")
        t1 = call('PATCH', '/admin/health/type-rates/TENANT', {'rate': 13, 'reason': '시험 1297 발송', 'effectiveDate': EFF}, TS)
        sch = t1.get('id') or ''
        if t1.get('noticeId'):
            made.append(t1['noticeId'])
        lk = psql(f"SELECT count(*) || '|' || count(*) FILTER (WHERE kind = 'SCHEDULE') FROM hlt_rate_notifications WHERE schedule_id = '{sch}'") if sch else ''
        mine = psql(f"SELECT count(*) FROM hlt_rate_notifications h JOIN notifications n ON n.id = h.notification_id WHERE h.schedule_id = '{sch}' AND n.account_id = '{aid}' AND n.event_code = 'SELLER_RATE_SCHEDULED'") if sch else ''
        s0 = call('GET', f'/admin/health/rate-schedules/{sch}/send-status', None, TS) if sch else {}
        N = t1.get('notified') or 0
        ok('② API — 요율 예약 → 판매자 알림이 예약에 묶임(모두 SCHEDULE · 내 판매자 1) · 발송 전 — 내 알림 = 알린 수 · 메일 · 문자는 「아직」 또는 「주소 없음」',
           bool(sch) and N >= 1 and lk == f'{N}|{N}' and mine == '1' and s0.get('inapp') == N
           and s0.get('emailWaiting', 0) + s0.get('emailNone', 0) + s0.get('emailQueued', 0) + s0.get('emailSent', 0) + s0.get('emailFailed', 0) == N
           and my('EMAIL') == '' and my('SMS') == '', f"{N} · {lk} · {mine} · {s0} · phone {ph!r}")
        for k, v in (('notify.email_verified', 'on'), ('notify.sms_ready', 'off'), ('notify.alimtalk_ready', 'off')):
            psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}'")
        psql("UPDATE site_settings SET value = NULL WHERE key IN ('notify.quiet_start', 'notify.quiet_end')")
        dr = {}
        for _ in range(10):
            dr = call('POST', '/admin/jobs', {'job': 'notify_dispatch'}, TS)
            if my('EMAIL'):
                break
        e_, s_ = my('EMAIL'), my('SMS')
        s1 = call('GET', f'/admin/health/rate-schedules/{sch}/send-status', None, TS)
        lst = call('GET', '/admin/health/rate-schedules', None, TS)
        row = next((x for x in (lst if isinstance(lst, list) else []) if x.get('id') == sch), {})
        ok('② 정기 작업 notify_dispatch — 메일 켬 → 메일 대기(또는 보냄) · 문자 준비 안 됨 → 실패(사유 「SMS 채널이 준비되지 않았습니다」)',
           e_.split('|')[0] in ('QUEUED', 'SENT') and s_ == 'FAILED|SMS 채널이 준비되지 않았습니다', f'{e_} · {s_} · {str(dr)[:160]}')
        ok('② 발송 현황 — 메일 대기 · 보냄 ≥ 1 · 문자 실패 ≥ 1 · 실패 사유 줄 · 채널(메일 켜짐 · 문자 준비 안 됨) · 목록 한 줄(알림 · 실패)',
           s1.get('emailQueued', 0) + s1.get('emailSent', 0) >= 1 and s1.get('smsFailed', 0) >= 1 and any(f.get('channel') == 'SMS' and f.get('n', 0) >= 1 for f in s1.get('fails') or [])
           and (s1.get('channels') or {}).get('EMAIL') is True and (s1.get('channels') or {}).get('SMS') is False
           and row.get('sendTotal') == N and row.get('sendFailed', 0) >= 1, f"{ {k: s1.get(k) for k in ('emailQueued', 'emailSent', 'smsFailed', 'channels', 'fails')} } · {row.get('sendTotal')}/{row.get('sendFailed')}")
        bad = call('GET', '/admin/health/rate-schedules/00000000-0000-4000-8000-000000000000/send-status', None, TS)
        mem = call('GET', f'/admin/health/rate-schedules/{sch}/send-status', None, TB)
        ok('② 없는 예약 404 NOT_FOUND · 회원 403', bad.get('_err') == 404 and bad.get('code') == 'NOT_FOUND' and mem.get('_err') == 403, f"{bad.get('_err')} {bad.get('code')} · {mem.get('_err')}")

        if ADMIN_WEB:
            try:
                from playwright.sync_api import sync_playwright
            except Exception:
                sync_playwright = None
            if sync_playwright:
                seen, perr = {}, []
                try:
                    with sync_playwright() as p:
                        b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1600, 'height': 1000})
                        pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
                        pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                        pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                        pg.wait_for_selector('[data-state-check]', timeout=30000)
                        pg.goto(ADMIN_WEB + '/#/hlt-settle', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                        sel = f'[data-rate-send-open="{sch}"]'
                        seen['btn'] = pg.locator(sel).count()
                        if seen['btn']:
                            pg.click(sel); pg.wait_for_timeout(2000)
                        box = f'[data-rate-send-status="{sch}"]'
                        seen['box'] = pg.locator(box).count()
                        seen['rows'] = pg.locator(f'{box} [data-rate-send-row]').count()
                        seen['sms'] = pg.locator(f'{box} [data-rate-send-row="SMS"]').get_attribute('data-rate-send-ready') if seen['rows'] else None
                        seen['fails'] = pg.locator(f'{box} [data-rate-send-fails]').count()
                        pg.screenshot(path=os.path.join(HERE, 'v1297_send.png'))
                        b.close()
                except Exception as ex:
                    perr.append(str(ex)[:160])
                ok('③ 화면 — 소개몰 › 소개몰 정산 › 「요율 변경 예정」 「발송 현황」 → 내 알림 · 메일 · 문자 3줄 · 문자 준비 안 됨 · 실패 사유 · 화면 오류 없음',
                   seen.get('btn') == 1 and seen.get('box') == 1 and seen.get('rows') == 3 and seen.get('sms') == 'off' and seen.get('fails') == 1 and not perr, f'{seen} · {perr[:2]}')
            else:
                print('  (화면 · playwright 없음 — ③ 건너뜀)')

        cx = call('POST', f'/admin/health/rate-schedules/{sch}/cancel', {'reason': '시험 1297 취소'}, TS)
        lk2 = psql(f"SELECT count(*) FILTER (WHERE kind = 'CANCEL') FROM hlt_rate_notifications WHERE schedule_id = '{sch}'")
        s2 = call('GET', f'/admin/health/rate-schedules/{sch}/send-status', None, TS)
        ok('② 취소 알림도 같은 예약에 묶임(CANCEL · 알린 수만큼) · 발송 현황 내 알림이 그만큼 늚',
           cx.get('ok') is True and lk2 == str(cx.get('notified')) and s2.get('inapp') == N + (cx.get('notified') or 0), f"{cx.get('notified')} · {lk2} · {s2.get('inapp')}")
    finally:
        for k, v in before.items():
            psql(f"UPDATE site_settings SET value = NULL WHERE key = '{k}'" if v == '<NULL>' else f"UPDATE site_settings SET value = $v${v}$v$ WHERE key = '{k}'")
        cancel_mine()
        psql("UPDATE hlt_seller_type_rates SET rate = NULL")
        for x in made:
            psql(f"UPDATE notices SET is_pinned = false WHERE id = '{x}'")
            psql(f"UPDATE notices SET published_at = NULL WHERE id = '{x}' AND (published_at IS NULL OR published_at > now())")
        if sid_:
            psql(f"DELETE FROM hlt_products WHERE seller_id = '{sid_}'")
            psql(f"DELETE FROM hlt_seller_rate_changes WHERE seller_id = '{sid_}'")
            psql(f"DELETE FROM hlt_sellers WHERE id = '{sid_}'")
        psql(f"DELETE FROM notifications WHERE account_id IN (SELECT id FROM accounts WHERE email = '{SEL}')")
        ok('② 끝나면 되돌림 — 알림 설정 5개', all(psql(f"SELECT coalesce(value, '<NULL>') FROM site_settings WHERE key = '{k}'") == v for k, v in before.items()), str(before))
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
