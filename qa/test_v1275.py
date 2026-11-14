"""v10.275 ~ v10.277 (D208 · docs/406) — 판매수수료율 인상 예약(입점 약관 제17조 4항)

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1275.py

  ① (코드) D208(예약 표 · 31일 검사 · 고칠 수 없음 · 판정 함수 · 요율 함수 칸마다 예약 · 시행 함수 · 정기 작업) · API(예약 · 목록 · 취소) ·
     정기 작업 hlt_rate_schedule · 운영 화면(요율 변경 예정 · 미리보기 시행일) · 판매자센터 알림 글(한 · 영) · 명세 · 문서 406 · 마이그레이션 246 · 판 v10.277
  ② (DB · 되돌림) 시행 시각 지난 예약은 요율 함수가 바로 씀 · 31일 안 막힘 · 대상마다 하나 · 고치기 · 지우기 · 시행 뒤 취소 막힘 · 시행 → 표 · 기록 · APPLIED
  ③ (API) 유형 요율 올림 — 시행일 없으면 422 NOTICE_REQUIRED · 이른 날 422 · 맞으면 예약(지금 요율 그대로 · 알림 · 판매자센터 표시 · 목록) · 같은 대상 409 ·
     취소(사유 422 · 알림 · 두 번째 409) · 판매자 요율 올림도 예약 · 내림은 바로 · 갈래 올림 422 · 미리보기 needsNotice · 회원 403
  ④ (작업) hlt_rate_schedule 실행 — 오류 없음
  ⑤ (화면) 소개몰 › 소개몰 정산 › 「요율 변경 예정」 상자 — 예약 줄 · 취소 단추 · 화면 오류 없음
  만든 예약은 모두 취소(지울 수 없음) · 판매자 · 상품 · 알림은 지움(두 번 돌아도 통과).
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
M8 = rd('prisma/migrations/D208_hlt_rate_schedules/migration.sql')
RS = rd('src/modules/health/health-rate-schedule.service.ts')
SV, CT = rd('src/modules/health/health-settle.service.ts'), rd('src/modules/health/health-seller.controller.ts')
MS, MC = rd('src/modules/health/health-seller-manage.service.ts'), rd('src/modules/health/health-seller-manage.controller.ts')
SS = rd('src/modules/health/health-seller.service.ts')
SC, WK, AM = rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'), rd('src/app.module.ts')
TR, HS, HL = rd('web/src/app/admin/HealthTypeRates.tsx'), rd('web/src/app/admin/HealthSettle.tsx'), rd('web/src/app/admin/HealthSellers.tsx')
CE = rd('site/src/components/health/SellerCenter.tsx')
SCR = rd('spec/screens.json')
EN = rd('src/common/i18n/server-text.en.ts')
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []
D406 = next((open(os.path.join(K, 'docs', x), encoding='utf-8').read() for x in docs if x.startswith('406_')), '')
mig = [d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isfile(os.path.join(K, 'prisma/migrations', d, 'migration.sql'))] if os.path.isdir(os.path.join(K, 'prisma/migrations')) else []
BAD = re.compile(r'\b(DELETE FROM|DROP TABLE|DROP FUNCTION|TRUNCATE)\b')


def msgs(lang):
    try:
        return json.load(open(os.path.join(K, f'site/src/i18n/messages/{lang}/hlt.json'), encoding='utf-8')).get('center', {})
    except Exception:
        return {}


MK, ME = msgs('ko'), msgs('en')
KEYS = ('rateSched', 'rateSchedSeller', 'rateSchedType', 'rateSchedCategory', 'rateNext')

ok('① D208 — 예약 표(범위 3 · 대상마다 예정 하나 · 시행일 = 예약한 날 + 31일 0시 이후 · 고칠 수 없음 · 지울 수 없음) · 판정 · 칸 · 요율 · 시행 함수 · 정기 작업 00:05 · 지우는 문장 없음',
   'CREATE TABLE IF NOT EXISTS public.hlt_rate_schedules' in M8 and "CHECK (scope IN ('SELLER', 'TYPE', 'CATEGORY'))" in M8
   and "(created_at AT TIME ZONE 'Asia/Seoul')::date + 31" in M8 and "uq_hlt_rate_sched_open ON public.hlt_rate_schedules(scope, target) WHERE status = 'SCHEDULED'" in M8
   and 'HLTS: 요율 예약 기록은 지울 수 없습니다' in M8 and 'HLTS: 요율 예약 내용은 고칠 수 없습니다' in M8 and 'HLTS: 시행 시각이 지난 예약은 취소할 수 없습니다' in M8
   and 'FUNCTION public.fn_hlt_rate_notice(' in M8 and 'FUNCTION public.fn_hlt_rate_sched_sellers(' in M8 and 'FUNCTION public.fn_hlt_rate_layer(' in M8
   and "fn_hlt_rate_layer('SELLER', s.id::text, s.commission_rate)" in M8 and "fn_hlt_rate_layer('TYPE', t.seller_type, t.rate)" in M8
   and "fn_hlt_rate_layer('CATEGORY', p_category_code," in M8 and 'FUNCTION public.fn_hlt_rate_sched_apply()' in M8
   and "VALUES ('hlt_rate_schedule', 1440, 0, 5, NULL, true," in M8 and not BAD.search(M8), '')
ok('① API — 판단은 DB 한 곳(fn_hlt_rate_notice) · 판매자 · 유형 · 갈래 바꾸기가 모두 guard 를 거침 · 시행일 422 두 가지 · 같은 대상 409 · 목록 · 취소(감사) · 판매자센터 · 정기 작업 · 영어 사전',
   'FROM fn_hlt_rate_notice($1, $2, $3::numeric)' in RS and "'NOTICE_REQUIRED'" in RS and "'NOTICE_TOO_SHORT'" in RS and "'RATE_SCHEDULED'" in RS and "'SCHEDULE_CLOSED'" in RS
   and "this.rates.guard('SELLER'" in MS and "this.rates.guard('TYPE'" in SV and "this.rates.guard('CATEGORY'" in SV and 'needsNotice: nt.needsNotice' in SV
   and "@Get('admin/health/rate-schedules')" in CT and "@Post('admin/health/rate-schedules/:id/cancel')" in CT and "@Audit('HLT_RATE_SCHEDULE_CANCEL'" in CT
   and 'effectiveDate?: string' in MC and 'rateSchedules: await this.rateSched.forSeller(s.id)' in SS
   and "case 'hlt_rate_schedule':" in SC and "'hlt_rate_schedule'" in SC.split('export interface JobResult')[0] and "'hlt_rate_schedule'," in WK
   and 'HealthRateScheduleService,' in AM and '"예약을 취소했습니다 — 판매자 {0}곳에 알렸습니다.":' in EN, '')
ok('① 화면 — 운영 「요율 변경 예정」(취소) · 미리보기가 올림이면 시행일을 물음 · 세 곳이 시행일을 보냄 · 판매자센터 예정 글(한 · 영 같은 칸) · 명세 2 · 문서 406 · 마이그레이션 246 · 판 v10.277 이상',
   'export function HealthRateSchedules(' in TR and 'data-rate-schedules=' in TR and 'data-rate-schedule-cancel=' in TR and 'return { effectiveDate: d };' in TR
   and '<HealthRateSchedules ' in HS and 'rate, ...p' in HS and 'reason: reason.trim(), ...p' in HL and 'reason: reason.trim(), ...p' in TR
   and 'data-rate-schedule-notice=' in CE and all(MK.get(k) and ME.get(k) for k in KEYS) and all(sorted(re.findall(r'\{\w+\}', MK[k])) == sorted(re.findall(r'\{\w+\}', ME[k])) for k in KEYS if MK.get(k) and ME.get(k))
   and all(f'"{a}"' in SCR for a in ('GET /admin/health/rate-schedules', 'POST /admin/health/rate-schedules/{id}/cancel'))
   and bool(D406) and len(mig) in (246, 247, 248, 249, 250, 251, 252, 253) and tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 277), f'{len(mig)} · {VER} · 406 {bool(D406)}')


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


def psql_f(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At'], input=sql, capture_output=True, text=True)
    return r.stdout.strip() + '\n' + r.stderr.strip()


def cancel_mine():   # 이 시험이 만든 예정 예약은 모두 취소(지울 수 없음 — 다른 시험이 409 를 보지 않게)
    psql("UPDATE hlt_rate_schedules SET status = 'CANCELED', canceled_at = now(), cancel_reason = '시험 1275 정리' "
         "WHERE status = 'SCHEDULED' AND reason LIKE '%1275%' AND effective_at > now()")


stamp = str(int(time.time()))[-7:]
SEL = f't1275sel{stamp}@x.com'
CODE = f'TN-R{stamp}'
if API and DB:
    import consent_ok
    cancel_mine()
    psql("UPDATE hlt_seller_type_rates SET rate = NULL")
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{SEL}', '시험1275', '{pw}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{SEL}'")
    consent_ok.agree(SEL, PW); consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    login = lambda e: call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')
    TS, TL, TB = login('admin@x.com'), login(SEL), login('buyer@x.com')
    nt = lambda code: psql(f"SELECT count(*) FROM notifications WHERE account_id = '{aid}' AND event_code = '{code}'")
    EARLY = psql("SELECT to_char((now() AT TIME ZONE 'Asia/Seoul')::date + 31, 'YYYY-MM-DD')")
    SHORT = psql("SELECT to_char((now() AT TIME ZONE 'Asia/Seoul')::date + 10, 'YYYY-MM-DD')")
    sid_ = ''
    try:
        sid_ = psql(f"INSERT INTO hlt_sellers (code, account_id, type, name, personal, ceo_name, cs_tel, return_addr, status, applied_at, submerchant_id) "
                    f"VALUES ('{CODE}', '{aid}', 'TENANT', '시험 가게 1275', true, '홍길동', '02-000-0000', '서울 강남구 테헤란로 1', 'ACTIVE', now(), 'SUB-T1275') RETURNING id").splitlines()[0]
        cat = psql("SELECT id FROM categories WHERE gwan_code = 'HLT' AND code = 'HLT_FUNC'")
        psql(f"INSERT INTO hlt_products (code, name, price, stock, status, seller_id, review_state, category_id) VALUES ('{CODE}-A', '시험 상품 1275', 10000, 5, 'DRAFT', '{sid_}', 'APPROVED', '{cat}')")

        # ② DB — 한 트랜잭션에서 보고 되돌림
        fc0 = psql("SELECT coalesce((SELECT rate FROM hlt_commission_rates WHERE category_code = 'HLT_FUNC'), (SELECT rate FROM hlt_commission_rates WHERE category_code = '*'), 10)")
        o = psql_f(f"""BEGIN;
SELECT 'a' || fn_hlt_rate_for('{sid_}', 'HLT_FUNC');
INSERT INTO hlt_rate_schedules (scope, target, to_rate, effective_at, reason, created_at) VALUES ('SELLER', '{sid_}', 20, now() - interval '1 hour', '시험 1275 시행', now() - interval '40 days');
SELECT 'b' || fn_hlt_rate_for('{sid_}', 'HLT_FUNC');
SAVEPOINT s1; INSERT INTO hlt_rate_schedules (scope, target, to_rate, effective_at, reason) VALUES ('TYPE', 'TENANT', 9, now() + interval '20 days', '시험 1275 짧음'); ROLLBACK TO s1;
SAVEPOINT s2; INSERT INTO hlt_rate_schedules (scope, target, to_rate, effective_at, reason) VALUES ('SELLER', '{sid_}', 21, now() + interval '40 days', '시험 1275 둘째'); ROLLBACK TO s2;
SAVEPOINT s3; UPDATE hlt_rate_schedules SET to_rate = 22 WHERE target = '{sid_}'; ROLLBACK TO s3;
SAVEPOINT s4; DELETE FROM hlt_rate_schedules WHERE target = '{sid_}'; ROLLBACK TO s4;
SAVEPOINT s5; UPDATE hlt_rate_schedules SET status = 'CANCELED', cancel_reason = '늦은 취소' WHERE target = '{sid_}'; ROLLBACK TO s5;
SELECT 'c' || fn_hlt_rate_sched_apply();
SELECT 'd' || commission_rate || '|' || (SELECT status FROM hlt_rate_schedules WHERE target = '{sid_}') || '|' || (SELECT count(*) FROM hlt_seller_rate_changes WHERE seller_id = '{sid_}' AND reason LIKE '예약 시행 — %')
   || '|' || (SELECT count(*) FROM notifications WHERE account_id = '{aid}' AND event_code = 'SELLER_RATE_CHANGED') FROM hlt_sellers WHERE id = '{sid_}';
ROLLBACK;""")
        L = dict((x[0], x[1:]) for x in o.splitlines() if x[:1] in 'abcd' and not x.startswith(('ERROR', 'DETAIL', 'CONTEXT')))
        errs = re.findall(r'ERROR:\s+(.{0,40})', o)
        ok('② DB — 시행 지난 예약을 요율 함수가 바로 씀(갈래 → 20) · 31일 안 막힘 · 대상마다 하나 · 고치기 · 지우기 · 시행 뒤 취소 막힘 · 시행 → 표 20 · APPLIED · 기록 · 알림(되돌림)',
           float(L.get('a') or 0) == float(fc0) and float(L.get('b') or 0) == 20 and L.get('c') == '1' and (L.get('d') or '').startswith('20.00|APPLIED|1|1')
           and len(errs) == 5 and 'hlt_rate_sched_notice_31d' in o and 'uq_hlt_rate_sched_open' in o and o.count('HLTS:') >= 3
           and psql(f"SELECT count(*) FROM hlt_rate_schedules WHERE target = '{sid_}'") == '0', f'{L} · {[e[:30] for e in errs]}')

        # ③ API — 유형 요율 올림(우리 가게는 판매자 요율 없음 → 영향받음)
        imp = call('GET', '/admin/health/rate-impact?scope=TYPE&key=TENANT&rate=13', None, TS)
        t0 = call('PATCH', '/admin/health/type-rates/TENANT', {'rate': 13, 'reason': '시험 1275 유형'}, TS)
        t1 = call('PATCH', '/admin/health/type-rates/TENANT', {'rate': 13, 'reason': '시험 1275 유형', 'effectiveDate': SHORT}, TS)
        n0 = nt('SELLER_RATE_SCHEDULED')
        t2 = call('PATCH', '/admin/health/type-rates/TENANT', {'rate': 13, 'reason': '시험 1275 유형', 'effectiveDate': EARLY}, TS)
        n1 = nt('SELLER_RATE_SCHEDULED')
        t3 = call('PATCH', '/admin/health/type-rates/TENANT', {'rate': 5, 'reason': '시험 1275 유형 둘째'}, TS)
        now_rate = psql("SELECT coalesce(rate::text, '-') FROM hlt_seller_type_rates WHERE seller_type = 'TENANT'")
        ctr = call('GET', '/me/health/seller/center', None, TL)
        lst = call('GET', '/admin/health/rate-schedules', None, TS)
        mine = next((x for x in (lst if isinstance(lst, list) else []) if x.get('id') == t2.get('id')), {})
        ok('③ 유형 요율 올림 — 미리보기 needsNotice · 가장 이른 날 · 시행일 없음 422 NOTICE_REQUIRED · 이른 날 422 NOTICE_TOO_SHORT · 맞으면 예약(지금 요율 비어 있는 채) · 판매자 알림 · 같은 대상 409',
           imp.get('needsNotice') is True and imp.get('increase') is True and (imp.get('affected') or 0) >= 1 and imp.get('earliest') == EARLY
           and t0.get('_err') == 422 and t0.get('code') == 'NOTICE_REQUIRED' and t1.get('_err') == 422 and t1.get('code') == 'NOTICE_TOO_SHORT'
           and t2.get('scheduled') is True and t2.get('effectiveDate') == EARLY and (t2.get('notified') or 0) >= 1 and int(n1) - int(n0) == 1
           and t3.get('_err') == 409 and t3.get('code') == 'RATE_SCHEDULED' and now_rate == '-',
           f"{ {k: imp.get(k) for k in ('increase', 'affected', 'needsNotice', 'earliest')} } · {t0.get('code')} · {t1.get('code')} · {t2} · {t3.get('code')} · {now_rate} · 알림 {n0}->{n1}")
        rs = ctr.get('rateSchedules') if isinstance(ctr, dict) else None
        ok('③ 판매자센터 · 목록 — 예정 변경(유형 · 13% · 시행일) · 운영 목록 SCHEDULED(대상 이름 · 알린 수) · 회원 403',
           isinstance(rs, list) and any(r.get('scope') == 'TYPE' and float(r.get('toRate') or 0) == 13 and r.get('effectiveDate') == EARLY for r in rs)
           and mine.get('status') == 'SCHEDULED' and mine.get('label') == '일반 입점' and (mine.get('notified') or 0) >= 1
           and call('GET', '/admin/health/rate-schedules', None, TB).get('_err') == 403, f"{rs} · {mine.get('status')} · {mine.get('label')}")

        # ⑤ 화면 — 예약이 있는 동안 「요율 변경 예정」
        try:
            from playwright.sync_api import sync_playwright
        except Exception:
            sync_playwright = None
        if ADMIN_WEB and sync_playwright:
            seen, perr = {}, []
            try:
                with sync_playwright() as p:
                    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 1000})
                    pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
                    pg.on('dialog', lambda d: d.dismiss())
                    pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                    pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                    pg.wait_for_selector('[data-state-check]', timeout=30000)
                    pg.goto(ADMIN_WEB + '/#/hlt-settle', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                    box = pg.locator('[data-rate-schedules]')
                    seen['n'] = box.first.get_attribute('data-rate-schedules') if box.count() else None
                    seen['text'] = box.first.inner_text()[:400] if box.count() else ''
                    seen['cancel'] = pg.locator(f'[data-rate-schedule-cancel="{t2.get("id")}"]').count()
                    pg.screenshot(path=os.path.join(HERE, 'v1275_schedules.png'), full_page=True)
                    b.close()
            except Exception as ex:
                perr.append(str(ex)[:160])
            ok('⑤ 운영 화면 소개몰 › 소개몰 정산 › 「요율 변경 예정」 — 예정 줄(일반 입점 · 13% · 시행일) · 취소 단추 · 화면 오류 없음',
               seen.get('n') not in (None, '0') and '요율 변경 예정' in seen.get('text', '') and EARLY in seen.get('text', '') and seen.get('cancel') == 1 and not perr,
               f"{seen.get('n')} · {seen.get('cancel')} · {seen.get('text', '')[:80]} · {perr[:2]}")
        else:
            print('  (운영 화면 · playwright 없음 — ⑤ 건너뜀)')

        c0 = call('POST', f"/admin/health/rate-schedules/{t2.get('id')}/cancel", {'reason': ' '}, TS)
        k0 = nt('SELLER_RATE_SCHEDULE_CANCELED')
        c1 = call('POST', f"/admin/health/rate-schedules/{t2.get('id')}/cancel", {'reason': '시험 1275 취소'}, TS)
        c2 = call('POST', f"/admin/health/rate-schedules/{t2.get('id')}/cancel", {'reason': '시험 1275 취소'}, TS)
        k1 = nt('SELLER_RATE_SCHEDULE_CANCELED')
        ctr2 = call('GET', '/me/health/seller/center', None, TL)
        ok('③ 취소 — 사유 없음 422 · 취소(판매자 알림) · 두 번째 409 SCHEDULE_CLOSED · 판매자센터에서 사라짐 · 기록은 CANCELED 로 남음',
           c0.get('_err') == 422 and c1.get('status') == 'CANCELED' and (c1.get('notified') or 0) >= 1 and int(k1) - int(k0) == 1 and c2.get('_err') == 409 and c2.get('code') == 'SCHEDULE_CLOSED'
           and not [r for r in (ctr2.get('rateSchedules') or []) if r.get('scope') == 'TYPE'] and psql(f"SELECT status FROM hlt_rate_schedules WHERE id = '{t2.get('id')}'") == 'CANCELED',
           f"{c0.get('code')} · {c1} · {c2.get('code')}")

        # 판매자 요율 — 올림은 예약 · 내림은 바로 · 갈래 올림도 예약이 필요
        s0 = call('POST', f'/admin/health/sellers/{sid_}/commission', {'rate': 15, 'reason': '시험 1275 판매자'}, TS)
        s1 = call('POST', f'/admin/health/sellers/{sid_}/commission', {'rate': 15, 'reason': '시험 1275 판매자', 'effectiveDate': EARLY}, TS)
        r15 = psql(f"SELECT coalesce(commission_rate::text, '-') FROM hlt_sellers WHERE id = '{sid_}'")
        if s1.get('id'):
            call('POST', f"/admin/health/rate-schedules/{s1.get('id')}/cancel", {'reason': '시험 1275 취소'}, TS)
        s2 = call('POST', f'/admin/health/sellers/{sid_}/commission', {'rate': 5, 'reason': '시험 1275 내림'}, TS)
        r5 = psql(f"SELECT coalesce(commission_rate::text, '-') FROM hlt_sellers WHERE id = '{sid_}'")
        psql(f"UPDATE hlt_sellers SET commission_rate = NULL WHERE id = '{sid_}'")
        fc = psql("SELECT coalesce((SELECT rate FROM hlt_commission_rates WHERE category_code = 'HLT_FUNC'), 10)")
        g0 = call('PATCH', '/admin/health/commission-rates/HLT_FUNC', {'rate': float(fc) + 2, 'note': '시험 1275'}, TS)
        ok('③ 판매자 요율 — 올림 시행일 없음 422 · 시행일 있으면 예약(지금 그대로) · 내림은 바로(5%) · 갈래 올림도 422 NOTICE_REQUIRED(그 갈래 상품이 있는 판매자)',
           s0.get('code') == 'NOTICE_REQUIRED' and s1.get('scheduled') is True and r15 == '-' and s2.get('ok') is True and s2.get('to') == 5 and r5 == '5.00'
           and g0.get('_err') == 422 and g0.get('code') == 'NOTICE_REQUIRED', f"{s0.get('code')} · {s1.get('scheduled')} · {r15} · {s2.get('to')} · {r5} · {g0.get('code')}")

        j = call('POST', '/admin/jobs', {'job': 'hlt_rate_schedule'}, TS)
        ok('④ 정기 작업 hlt_rate_schedule — 실행 오류 없음 · 일정 매일 00:05',
           '_err' not in j and psql("SELECT at_hour || ':' || at_minute || ':' || every_min FROM job_schedules WHERE job = 'hlt_rate_schedule'") == '0:5:1440', str(j)[:120])
    finally:
        cancel_mine()
        psql("UPDATE hlt_seller_type_rates SET rate = NULL")
        if sid_:
            psql(f"DELETE FROM hlt_products WHERE seller_id = '{sid_}'")
            psql(f"DELETE FROM hlt_seller_rate_changes WHERE seller_id = '{sid_}'")
            psql(f"DELETE FROM hlt_sellers WHERE id = '{sid_}'")
        psql(f"DELETE FROM notifications WHERE account_id IN (SELECT id FROM accounts WHERE email = '{SEL}')")
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
