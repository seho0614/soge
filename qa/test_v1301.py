"""v10.301 (D218 · docs/422) — 요율 시행 때 공지 열람 기록 고정 시험
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1301.py

  ① (코드) D218 hlt_rate_read_snaps(쌓기만 · fn_append_only_guard) · fn_hlt_rate_sched_freeze · fn_hlt_rate_sched_apply 가 요율을 바꾸기 전에 굳힘 ·
     reads(view=frozen · 409 READS_NOT_FROZEN) · CSV 「기준」 · 「시행 전 읽음」 · 운영 화면 「시행 때 기록(고정)」 ↔ 「지금」 · 영어 사전 · 문서 422 · 판 v10.301
  ② (작업) 시행 30초 전 예약 두 건 — S1 판매자 A(시행 전에 펼침) · B(대상 아님 · 펼침) / S2 판매자 C(시행 뒤에 펼침)
     → 시행 전 frozen 409 → 시각이 지나 정기 작업 hlt_rate_schedule → APPLIED · reads_frozen_at · S1 「시행 전 읽음 1 / 대상 1 · 대상 밖 1」 ·
     S2 「0 / 1 · 안 읽음 1」(시행 뒤에 펼친 것은 안 셈) · 고정 뒤 A 가 또 펼쳐도 고정 기록은 그대로(지금 보기만 2) · 고치기 · 지우기 막힘 · 다시 굳히기 0 · 목록 readsFrozenAt
  ③ (CSV) view=frozen — 머리 「기준」 · 「시행 전 읽음 / 대상 1 / 1」 · 열 「시행 전 읽음」 · 파일 이름 -frozen · 감사 view=frozen · 고정 안 된 예약 409
  ④ (화면) 소개몰 › 소개몰 정산 › 「요율 변경 예정」 S1 「읽음 기록」 → 처음부터 「시행 때 기록」 · 단추 2개 · 2줄 · 1/1 → 「지금」 · 자동 다시 알림 줄
  판매자는 고정 기록이 가리켜 지울 수 없어 폐점(CLOSED · 사유)으로 둠 · 알림 · 바꾼 기록 · 역할은 지움 — 두 번 돌아도 통과.
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
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []
D422 = next((open(os.path.join(K, 'docs', x), encoding='utf-8').read() for x in docs if x.startswith('422_')), '')
M18 = rd('prisma/migrations/D218_rate_read_snaps_auto_remind/migration.sql')
RS, CT = rd('src/modules/health/health-rate-schedule.service.ts'), rd('src/modules/health/health-seller.controller.ts')
HW, ST = rd('web/src/app/admin/HealthTypeRates.tsx'), rd('src/common/i18n/server-text.en.ts')
ok('① DB — hlt_rate_read_snaps(쌓기만) · reads_frozen_at · fn_hlt_rate_sched_freeze(한 번만 · 시행 전 읽음 = 처음 ≤ 시행 시각) · apply 가 요율을 바꾸기 전에 굳힘',
   'CREATE TABLE IF NOT EXISTS public.hlt_rate_read_snaps' in M18 and 'EXECUTE FUNCTION public.fn_append_only_guard()' in M18
   and 'ADD COLUMN IF NOT EXISTS reads_frozen_at timestamptz' in M18 and 'coalesce(nr.first_at <= r.effective_at, false)' in M18
   and 'IF NOT FOUND OR r.reads_frozen_at IS NOT NULL THEN RETURN 0; END IF;' in M18
   and M18.find('PERFORM fn_hlt_rate_sched_freeze(r.id);') != -1 and M18.find('PERFORM fn_hlt_rate_sched_freeze(r.id);') < M18.find("IF r.scope = 'SELLER' THEN", M18.find('FUNCTION public.fn_hlt_rate_sched_apply')),
   '')
ok('① 서버 · 화면 — reads(view=frozen · 409 READS_NOT_FROZEN) · CSV 「기준」 · 「시행 전 읽음」 · -frozen · 두 API ?view · 화면 「시행 때 기록(고정)」 ↔ 「지금」 · 영어 · 문서 422 · 판 v10.301',
   "async reads(scheduleId: string, view: 'now' | 'frozen' = 'now')" in RS and "'READS_NOT_FROZEN'" in RS and 'FROM hlt_rate_read_snaps p WHERE p.schedule_id = $1::uuid' in RS
   and "'시행 전 읽음'" in RS and "-frozen" in RS and CT.count("@ApiQuery({ name: 'view', required: false, enum: ['now', 'frozen']") == 2
   and CT.count("view === 'frozen' ? 'frozen' : 'now'") == 2 and 'data-rate-reads-view={rd.d.view}' in HW and 'data-rate-reads-view-btn="frozen"' in HW
   and 'data-rate-reads-view-btn="now"' in HW and '/reads?view=${v}' in HW and '"시행 때 굳힌 열람 기록이 없습니다 — v10.301 이후 시행된 예약부터 남습니다.":' in ST
   and '시행 때 기록' in D422 and 'hlt_rate_read_snaps' in D422 and tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 301), VER)


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
TAG = f'시험 1301 {stamp}'
EM = {k: f't1301{k.lower()}{stamp}@x.com' for k in ('A', 'B', 'C')}
CODE = {k: f'TN-F{k}{stamp}' for k in ('A', 'B', 'C')}
if API and DB:
    import consent_ok
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    acc = {}
    for k, e_ in EM.items():
        psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{e_}', '시험1301{k}', '{pw}', now()) ON CONFLICT DO NOTHING")
        consent_ok.agree(e_, PW)
        acc[k] = psql(f"SELECT id FROM accounts WHERE email = '{e_}'")
    consent_ok.agree('admin@x.com', PW)
    login = lambda e: call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')
    TS = login('admin@x.com')
    TK = {k: login(e_) for k, e_ in EM.items()}
    sid, sch, nts = {}, {}, []
    try:
        for k in ('A', 'B', 'C'):
            sid[k] = psql(f"INSERT INTO hlt_sellers (code, account_id, type, name, personal, ceo_name, cs_tel, return_addr, status, applied_at, submerchant_id) "
                          f"VALUES ('{CODE[k]}', '{acc[k]}', 'TENANT', '{'=' if k == 'B' else ''}시험 가게 1301{k}', true, '홍길동', '02-000-0000', '서울 강남구 테헤란로 1', 'ACTIVE', now(), 'SUB-{CODE[k]}') RETURNING id").splitlines()[0]
        for k, tgt in (('S1', 'A'), ('S2', 'C')):
            n_ = psql(f"INSERT INTO notices (gwan_code, title, body, grades, published_at) VALUES ('HLT', '{TAG} {k} 공지', '요율 본문', ARRAY['SELLER'], now() - interval '1 minute') RETURNING id").splitlines()[0]
            nts.append(n_)
            sch[k] = psql(f"INSERT INTO hlt_rate_schedules (scope, target, from_rate, to_rate, effective_at, reason, created_at, notice_id) "
                          f"VALUES ('SELLER', '{sid[tgt]}', 10, 20, now() + interval '30 seconds', '{TAG} {k}', now() - interval '40 days', '{n_}') RETURNING id").splitlines()[0]
        sch['S3'] = psql(f"INSERT INTO hlt_rate_schedules (scope, target, from_rate, to_rate, effective_at, reason) "
                         f"VALUES ('SELLER', '{sid['B']}', 10, 20, now() + interval '40 days', '{TAG} S3') RETURNING id").splitlines()[0]
        n1, n2 = nts
        e0 = call('GET', f"/admin/health/rate-schedules/{sch['S1']}/reads?view=frozen", None, TS)
        ra = call('POST', f'/me/health/seller/notices/{n1}/read', None, TK['A'])
        rb = call('POST', f'/me/health/seller/notices/{n1}/read', None, TK['B'])
        wait = float(psql(f"SELECT greatest(0, extract(epoch FROM effective_at - now())) FROM hlt_rate_schedules WHERE id = '{sch['S1']}'") or 30)
        time.sleep(wait + 3)
        rc = call('POST', f'/me/health/seller/notices/{n2}/read', None, TK['C'])   # 시행 시각 뒤에 펼침 — 고정 기록에서 「시행 전 읽음」이 아님
        j = call('POST', '/admin/jobs', {'job': 'hlt_rate_schedule'}, TS)
        st = psql(f"SELECT string_agg(status || ':' || (reads_frozen_at IS NOT NULL)::text, ',' ORDER BY reason) FROM hlt_rate_schedules WHERE id IN ('{sch['S1']}', '{sch['S2']}')")
        f1 = call('GET', f"/admin/health/rate-schedules/{sch['S1']}/reads?view=frozen", None, TS)
        f2 = call('GET', f"/admin/health/rate-schedules/{sch['S2']}/reads?view=frozen", None, TS)
        by1 = {x.get('code'): x for x in f1.get('rows') or []}
        by2 = {x.get('code'): x for x in f2.get('rows') or []}
        ok('② 시행 전 frozen 409 READS_NOT_FROZEN → 정기 작업 뒤 APPLIED · 굳힘 · S1 시행 전 읽음 1 / 대상 1 · 대상 밖 1(B 「펼침만」) · A 줄 시행 전 읽음 · 횟수 1',
           e0.get('_err') == 409 and e0.get('code') == 'READS_NOT_FROZEN' and ra.get('ok') and rb.get('ok') and '_err' not in j and st == 'APPLIED:true,APPLIED:true'
           and f1.get('view') == 'frozen' and bool(f1.get('frozenAt')) and f1.get('read') == 1 and f1.get('target') == 1 and f1.get('unread') == 0 and f1.get('outsideRead') == 1
           and by1.get(CODE['A'], {}).get('readBefore') is True and by1.get(CODE['A'], {}).get('reads') == 1 and by1.get(CODE['A'], {}).get('target') is True
           and by1.get(CODE['B'], {}).get('target') is False and by1.get(CODE['B'], {}).get('readBefore') is True and set(by1) == {CODE['A'], CODE['B']},
           f"{e0.get('code')} · {str(j)[:60]} · {st} · { {k: f1.get(k) for k in ('view', 'frozenAt', 'read', 'target', 'unread', 'outsideRead', '_err', 'code')} } · {by1}")
        ok('② S2 — C 는 시행 뒤에 펼쳐 「시행 전 읽음」 아님 → 0 / 1 · 안 읽음 1(처음 펼친 때는 남음)',
           rc.get('ok') and f2.get('read') == 0 and f2.get('target') == 1 and f2.get('unread') == 1
           and by2.get(CODE['C'], {}).get('readBefore') is False and bool(by2.get(CODE['C'], {}).get('firstAt')), f"{ {k: f2.get(k) for k in ('read', 'target', 'unread', '_err')} } · {by2}")
        call('POST', f'/me/health/seller/notices/{n1}/read', None, TK['A'])
        nw = call('GET', f"/admin/health/rate-schedules/{sch['S1']}/reads", None, TS)
        f1b = call('GET', f"/admin/health/rate-schedules/{sch['S1']}/reads?view=frozen", None, TS)
        an = {x.get('code'): x for x in nw.get('rows') or []}.get(CODE['A'], {})
        af = {x.get('code'): x for x in f1b.get('rows') or []}.get(CODE['A'], {})
        up = psql(f"UPDATE hlt_rate_read_snaps SET reads = 99 WHERE schedule_id = '{sch['S1']}'")
        de = psql(f"DELETE FROM hlt_rate_read_snaps WHERE schedule_id = '{sch['S1']}'")
        again = psql(f"SELECT fn_hlt_rate_sched_freeze('{sch['S1']}')")
        lst = call('GET', '/admin/health/rate-schedules', None, TS)
        l1 = next((x for x in (lst if isinstance(lst, list) else []) if x.get('id') == sch['S1']), {})
        ok('② 고정 뒤 A 가 또 펼침 → 「지금」 횟수 2 · 고정 기록은 1 그대로 · 고치기 · 지우기 APND 막힘 · 다시 굳히기 0 · 목록 readsFrozenAt · 「지금」 view now',
           nw.get('view') == 'now' and an.get('reads') == 2 and af.get('reads') == 1 and 'APND' in up and 'APND' in de and again == '0' and bool(l1.get('readsFrozenAt')),
           f"{an.get('reads')} · {af.get('reads')} · {up[-60:]} · {de[-40:]} · {again} · {l1.get('readsFrozenAt')}")

        # ③ CSV
        tk = __import__('export_ticket').get(TS, 'RATE_READS')   # v10.366 (D238) 내려받기 승인 — 409 는 번호를 쓰지 않으므로 먼저
        nf = call('GET', f"/admin/health/rate-schedules/{sch['S3']}/reads/export?view=frozen&ticket={tk}", None, TS)
        cv = call('GET', f"/admin/health/rate-schedules/{sch['S1']}/reads/export?view=frozen&ticket={tk}", None, TS)
        au = psql(f"SELECT coalesce(max(after_data->>'view'), '') || '|' || count(*) FROM audit.audit_logs WHERE action = 'HLT_RATE_READS_EXPORT' AND target_id = '{sch['S1']}'")
        lines = (cv.get('csv') or '').lstrip('﻿').split('\r\n')
        ok('③ CSV view=frozen — 「기준,시행 때 기록(고정 · …)」 · 「시행 전 읽음 / 대상,1 / 1」 · 열 「시행 때 대상 … 시행 전 읽음」 · A 줄 끝 「예」 · B \'= · -frozen · 감사 view=frozen · 고정 안 된 예약 409',
           any(l.startswith('기준,시행 때 기록(고정 · ') for l in lines) and '시행 전 읽음 / 대상,1 / 1' in lines
           and '판매자 코드,상호,판매자 상태,시행 때 대상,처음 펼침(한국),마지막 펼침(한국),펼친 횟수,예약 안내 알림(한국),다시 알림,메일 · 문자,시행 전 읽음' in lines
           and any(l.startswith(f"{CODE['A']},시험 가게 1301A,") and l.endswith(',예') for l in lines)
           and any(l.startswith(f"{CODE['B']},'=시험 가게 1301B,") for l in lines)
           and (cv.get('filename') or '').endswith('-frozen.csv') and au.startswith('frozen|') and nf.get('_err') == 409 and nf.get('code') == 'READS_NOT_FROZEN',
           f"{lines[:3]} · {cv.get('filename')} · {au} · {nf.get('code')}")

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
                        seen['auto'] = pg.locator('[data-rate-auto-remind]').count()
                        sel = f'[data-rate-reads-open="{sch["S1"]}"]'
                        seen['btn'] = pg.locator(sel).count()
                        if seen['btn']:
                            pg.click(sel); pg.wait_for_timeout(2000)
                        box = f'[data-rate-reads="{sch["S1"]}"]'
                        seen['view'] = pg.locator(f'{box} [data-rate-reads-view]').get_attribute('data-rate-reads-view') if pg.locator(f'{box} [data-rate-reads-view]').count() else None
                        seen['vbtn'] = pg.locator(f'{box} [data-rate-reads-view-btn]').count()
                        seen['rows'] = pg.locator(f'{box} [data-rate-reads-row]').count()
                        seen['sum'] = pg.locator(f'{box} [data-rate-reads-sum]').get_attribute('data-rate-reads-sum') if pg.locator(box).count() else None
                        pg.screenshot(path=os.path.join(HERE, 'v1301_frozen.png'))
                        if seen['vbtn']:
                            pg.click(f'{box} [data-rate-reads-view-btn="now"]'); pg.wait_for_timeout(2000)
                            seen['view2'] = pg.locator(f'{box} [data-rate-reads-view]').get_attribute('data-rate-reads-view')
                        b.close()
                except Exception as ex:
                    perr.append(str(ex)[:160])
                ok('④ 화면 — S1 「읽음 기록」 → 처음부터 「시행 때 기록」 · 단추 2 · 2줄 · 1/1 → 「지금」 누르면 now · 자동 다시 알림 줄 · 화면 오류 없음',
                   seen.get('btn') == 1 and seen.get('view') == 'frozen' and seen.get('vbtn') == 2 and seen.get('rows') == 2 and seen.get('sum') == '1/1'
                   and seen.get('view2') == 'now' and seen.get('auto') == 1 and not perr, f'{seen} · {perr[:2]}')
            else:
                print('  (화면 · playwright 없음 — ④ 건너뜀)')
    finally:
        if sch.get('S3'):
            psql(f"UPDATE hlt_rate_schedules SET status = 'CANCELED', canceled_at = now(), cancel_reason = '시험 1301 정리' WHERE id = '{sch['S3']}' AND status = 'SCHEDULED'")
        for k in ('S1', 'S2'):   # 시행 시각 전에 실패했으면 남지 않게 취소(시각이 지났으면 취소가 막혀 시행됨)
            if sch.get(k):
                psql(f"UPDATE hlt_rate_schedules SET status = 'CANCELED', canceled_at = now(), cancel_reason = '시험 1301 정리' WHERE id = '{sch[k]}' AND status = 'SCHEDULED' AND effective_at > now()")
        for n_ in nts:
            psql(f"UPDATE notices SET is_pinned = false WHERE id = '{n_}'")
        psql(f"DELETE FROM notifications WHERE account_id IN (SELECT id FROM accounts WHERE email IN ({', '.join(repr(e_) for e_ in EM.values())}))")
        for k, s_ in sid.items():
            psql(f"DELETE FROM hlt_seller_rate_changes WHERE seller_id = '{s_}'")
            if psql(f"DELETE FROM hlt_sellers WHERE id = '{s_}'").find('!') != -1:   # 고정 기록이 가리킴 — 폐점으로 둠
                psql(f"UPDATE hlt_sellers SET status = 'CLOSED', status_reason = '시험 1301 정리' WHERE id = '{s_}' AND status <> 'CLOSED'")
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
