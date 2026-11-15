"""v10.302 (D218 · docs/423) — 요율 공지 안 읽은 판매자 자동 다시 알림 시험
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb python3 test_v1302.py

  ① (코드) 설정 hlt.rate_auto_remind_days(0 · 0 ~ 30) · hlt_rate_reminds.auto · fn_hlt_rate_auto_remind(시행 n일 전 · 게시한 공지 · 안 펼친 대상만 · 예약마다 자동 한 번 ·
     24시간 안 사람 알림이면 건너뜀 · 보낸 곳 없으면 기록 안 함) · 정기 작업 hlt_rate_schedule 이 부름 · 운영 알림 RATE_AUTO_REMIND(INFO) · 바꾸기 SUPER ·
     운영 화면 「자동 다시 알림」 줄 · 다시 알림 「(자동 n)」 · 영어 · 문서 423 · 판 v10.302
  ② (설정) ADMIN 만인 사람 403 RATE_REMIND_SETTING_SUPER · 31 은 형식 오류 · 0(끔)이면 작업이 보내지 않음
  ③ (작업) 7일로 — S1(5일 뒤 · A 안 읽음) A 에게 「[다시 알림]」 한 번 · 기록 auto · 사람 없음 · REMIND 연결 · S2(5일 뒤 · D 읽음) 보낼 곳 없어 기록 없음 ·
     S3(20일 뒤) 아직 · S4(5일 뒤 · 사람이 1시간 전 다시 알림) 건너뜀 · 운영 알림 RATE_AUTO_REMIND · 한 번 더 돌려도 그대로 · 목록 autoReminds 1 · autoRemindDays 7 ·
     자동 뒤 24시간 안 사람 다시 알림 409 REMIND_TOO_SOON
  끝나면 설정 0 · 예약 취소 · 판매자 · 알림 · 역할 지움 — 두 번 돌아도 통과.
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
RES = []
PW = 'sgb-dev-1234'
KEY = 'hlt.rate_auto_remind_days'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


VER = rd('VERSION').strip()
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []
D423 = next((open(os.path.join(K, 'docs', x), encoding='utf-8').read() for x in docs if x.startswith('423_')), '')
M18 = rd('prisma/migrations/D218_rate_read_snaps_auto_remind/migration.sql')
SC, AS = rd('src/worker/scheduler.service.ts'), rd('src/modules/admin/admin.service.ts')
RS, HW, ST = rd('src/modules/health/health-rate-schedule.service.ts'), rd('web/src/app/admin/HealthTypeRates.tsx'), rd('src/common/i18n/server-text.en.ts')
ok('① DB — 설정 0(끔 · 0 ~ 30) · reminds.auto · fn_hlt_rate_auto_remind(n일 전 · 게시 공지 · 안 펼친 대상 · 자동 한 번 · 24시간 · 보낸 곳 있을 때만 기록 · REMIND 연결)',
   "('hlt.rate_auto_remind_days', '0', 'ADMIN'" in M18 and "'^([0-9]|[12][0-9]|30)$'" in M18 and 'ADD COLUMN IF NOT EXISTS auto boolean NOT NULL DEFAULT false' in M18
   and 'FUNCTION public.fn_hlt_rate_auto_remind(OUT schedules integer, OUT sent integer)' in M18 and 'IF days <= 0 THEN RETURN; END IF;' in M18
   and 'x.effective_at <= now() + make_interval(days => days)' in M18 and 'm.schedule_id = x.id AND m.auto' in M18 and "m.at > now() - interval '24 hours'" in M18
   and 'IF v > 0 THEN' in M18 and "SELECT id, r.id, 'REMIND' FROM ins" in M18 and 'NOT EXISTS (SELECT 1 FROM notice_reads nr WHERE nr.notice_id = r.notice_id' in M18, '')
ok('① 서버 · 화면 — 작업이 부름 · RATE_AUTO_REMIND(INFO) · SUPER 만 · 목록 autoReminds · autoRemindDays · 화면 줄 · 「(자동 n)」 · 영어 · 문서 423 · 판 v10.302',
   'SELECT * FROM fn_hlt_rate_auto_remind()' in SC and "'RATE_AUTO_REMIND', 'INFO'" in SC and "key === 'hlt.rate_auto_remind_days'" in AS and "'RATE_REMIND_SETTING_SUPER'" in AS
   and '"autoReminds"' in RS and '"autoRemindDays"' in RS and 'data-rate-auto-remind={days}' in HW and '(자동 ${r.autoReminds})' in HW
   and '"요율 공지 자동 다시 알림은 최고 관리자(SUPER)만 바꿀 수 있습니다.":' in ST and KEY in D423 and tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 302), VER)


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=180).read()
        return json.loads(body) if body else {}
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
TAG = f'시험 1302 {stamp}'
KS = ('A', 'D', 'E', 'F')
EM = {k: f't1302{k.lower()}{stamp}@x.com' for k in KS}
ADM = f't1302adm{stamp}@x.com'
if API and DB:
    import consent_ok
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    acc = {}
    for k, e_ in list(EM.items()) + [('ADM', ADM)]:
        psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{e_}', '시험1302{k}', '{pw}', now()) ON CONFLICT DO NOTHING")
        consent_ok.agree(e_, PW)
        acc[k] = psql(f"SELECT id FROM accounts WHERE email = '{e_}'")
    psql(f"BEGIN; SELECT set_config('app.role_reason', '{TAG}', true); INSERT INTO account_roles (account_id, role) VALUES ('{acc['ADM']}', 'ADMIN') ON CONFLICT DO NOTHING; COMMIT;")
    consent_ok.agree('admin@x.com', PW)
    login = lambda e: call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')
    TS, TA = login('admin@x.com'), login(ADM)
    TD = login(EM['D'])
    T0 = psql("SELECT now()")
    sid, sch, nts = {}, {}, []
    try:
        for k in KS:
            sid[k] = psql(f"INSERT INTO hlt_sellers (code, account_id, type, name, personal, ceo_name, cs_tel, return_addr, status, applied_at, submerchant_id) "
                          f"VALUES ('TN-R{k}{stamp}', '{acc[k]}', 'TENANT', '시험 가게 1302{k}', true, '홍길동', '02-000-0000', '서울 강남구 테헤란로 1', 'ACTIVE', now(), 'SUB-R{k}{stamp}') RETURNING id").splitlines()[0]
        for s_, k, days in (('S1', 'A', 5), ('S2', 'D', 5), ('S3', 'E', 20), ('S4', 'F', 5)):
            n_ = psql(f"INSERT INTO notices (gwan_code, title, body, grades, published_at) VALUES ('HLT', '{TAG} {s_} 공지', '요율 본문', ARRAY['SELLER'], now() - interval '1 minute') RETURNING id").splitlines()[0]
            nts.append(n_)
            sch[s_] = psql(f"INSERT INTO hlt_rate_schedules (scope, target, from_rate, to_rate, effective_at, reason, created_at, notice_id) "
                           f"VALUES ('SELLER', '{sid[k]}', 10, 20, now() + interval '{days} days', '{TAG} {s_}', now() - interval '40 days', '{n_}') RETURNING id").splitlines()[0]
        rdD = call('POST', f'/me/health/seller/notices/{nts[1]}/read', None, TD)
        psql(f"INSERT INTO hlt_rate_reminds (schedule_id, sent, by_account, at) VALUES ('{sch['S4']}', 1, '{acc['ADM']}', now() - interval '1 hour')")

        # ② 설정
        na = call('PATCH', '/admin/site-settings', {'key': KEY, 'value': '7', 'reason': f'{TAG} ADMIN'}, TA)
        bad = call('PATCH', '/admin/site-settings', {'key': KEY, 'value': '31', 'reason': f'{TAG} 형식'}, TS)
        z = call('PATCH', '/admin/site-settings', {'key': KEY, 'value': '0', 'reason': f'{TAG} 끔'}, TS)
        j0 = call('POST', '/admin/jobs', {'job': 'hlt_rate_schedule'}, TS)
        a0 = psql(f"SELECT count(*) FROM hlt_rate_reminds WHERE schedule_id = '{sch['S1']}' AND auto")
        ok('② 설정 — ADMIN 만인 사람 403 RATE_REMIND_SETTING_SUPER · 31 은 형식 오류 · 0(끔)이면 작업이 보내지 않음',
           na.get('_err') == 403 and na.get('code') == 'RATE_REMIND_SETTING_SUPER' and bad.get('_err') in (400, 422) and '_err' not in z and '_err' not in j0 and a0 == '0',
           f"{na.get('_err')} {na.get('code')} · {bad.get('_err')} {bad.get('code')} · {z.get('_err')} · {str(j0)[:50]} · {a0}")

        # ③ 작업
        on = call('PATCH', '/admin/site-settings', {'key': KEY, 'value': '7', 'reason': f'{TAG} 켬'}, TS)
        j1 = call('POST', '/admin/jobs', {'job': 'hlt_rate_schedule'}, TS)
        q = lambda s_: psql(f"SELECT count(*) || '|' || coalesce(sum(sent), 0) || '|' || count(by_account) FROM hlt_rate_reminds WHERE schedule_id = '{sch[s_]}' AND auto")
        r1, r2, r3, r4 = q('S1'), q('S2'), q('S3'), q('S4')
        nA = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{acc['A']}' AND title = '[다시 알림] 판매 수수료율 변경 예정 안내'")
        lk = psql(f"SELECT count(*) FROM hlt_rate_notifications WHERE schedule_id = '{sch['S1']}' AND kind = 'REMIND'")
        nOther = psql(f"SELECT count(*) FROM notifications WHERE account_id IN ('{acc['D']}', '{acc['E']}', '{acc['F']}') AND title LIKE '[다시 알림]%'")
        al = psql(f"SELECT count(*) || '|' || coalesce(max(severity), '') || '|' || coalesce(max(title), '') FROM ops_alerts WHERE alert_code = 'RATE_AUTO_REMIND' AND raised_at >= '{T0}'")
        ok('③ 7일 — S1 A 에게 「[다시 알림]」 1 · 기록 auto 1 · 보냄 1 · 사람 없음 · REMIND 연결 1 · S2(모두 읽음) · S3(20일 뒤) · S4(1시간 전 사람 알림) 기록 · 알림 없음 · 운영 알림 RATE_AUTO_REMIND INFO',
           rdD.get('ok') and '_err' not in on and '_err' not in j1 and r1 == '1|1|0' and nA == '1' and lk == '1' and r2 == '0|0|0' and r3 == '0|0|0' and r4 == '0|0|0'
           and nOther == '0' and al.split('|')[0] not in ('', '0') and '|INFO|' in al and '「요율 변경 예정」' in al,
           f"{str(j1)[:50]} · S1 {r1} · S2 {r2} · S3 {r3} · S4 {r4} · A {nA} · 연결 {lk} · 다른 {nOther} · {al[:80]}")
        j2 = call('POST', '/admin/jobs', {'job': 'hlt_rate_schedule'}, TS)
        r1b = q('S1')
        nA2 = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{acc['A']}' AND title = '[다시 알림] 판매 수수료율 변경 예정 안내'")
        lst = call('GET', '/admin/health/rate-schedules', None, TS)
        l1 = next((x for x in (lst if isinstance(lst, list) else []) if x.get('id') == sch['S1']), {})
        mr = call('POST', f"/admin/health/rate-schedules/{sch['S1']}/remind", None, TS)
        ok('③ 한 번 더 돌려도 자동은 그대로 1 · A 알림 1 · 목록 autoReminds 1 · reminds 1 · autoRemindDays 7 · 자동 뒤 24시간 안 사람 다시 알림 409 REMIND_TOO_SOON',
           '_err' not in j2 and r1b == '1|1|0' and nA2 == '1' and l1.get('autoReminds') == 1 and l1.get('reminds') == 1 and l1.get('autoRemindDays') == 7
           and mr.get('_err') == 409 and mr.get('code') == 'REMIND_TOO_SOON', f"{r1b} · {nA2} · { {k: l1.get(k) for k in ('autoReminds', 'reminds', 'autoRemindDays')} } · {mr.get('code')}")
    finally:
        call('PATCH', '/admin/site-settings', {'key': KEY, 'value': '0', 'reason': f'{TAG} 정리'}, TS)
        if psql(f"SELECT value FROM site_settings WHERE key = '{KEY}'") != '0':
            psql(f"UPDATE site_settings SET value = '0' WHERE key = '{KEY}'")
        for s_ in sch.values():
            psql(f"UPDATE hlt_rate_schedules SET status = 'CANCELED', canceled_at = now(), cancel_reason = '시험 1302 정리' WHERE id = '{s_}' AND status = 'SCHEDULED'")
        for n_ in nts:
            psql(f"UPDATE notices SET is_pinned = false WHERE id = '{n_}'")
        psql(f"DELETE FROM notifications WHERE account_id IN (SELECT id FROM accounts WHERE email IN ({', '.join(repr(e_) for e_ in EM.values())}))")
        for s_ in sid.values():
            psql(f"DELETE FROM hlt_sellers WHERE id = '{s_}'")
        psql(f"BEGIN; SELECT set_config('app.role_reason', '{TAG} 정리', true); DELETE FROM account_roles WHERE account_id = (SELECT id FROM accounts WHERE email = '{ADM}') AND role = 'ADMIN'; COMMIT;")
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
