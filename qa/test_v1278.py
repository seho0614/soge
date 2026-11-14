"""v10.278 (D209 · docs/407) — 수수료율 인상 예약의 별도 공지사항(입점 약관 제17조 4항 「공지」)

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1278.py

  ① (코드) D209(공지 칸 2 · 알림 종류 2 · 지우는 문장 없음) · 예약 때 공지 초안 · 「공지 게시」 API(31일 · 감사) · 취소 안내 초안 · 정기 작업 RATE_NOTICE_MISSING ·
     운영 화면(공지 칸 · 「공지 안 함」 · 「공지 게시」) · 판매자센터 소개몰 공지(한 · 영) · 명세 · 문서 407 · 마이그레이션 247 · 판 v10.278
  ② (API) 예약 → 공지 초안(소개몰 · 게시 안 됨 · 제목에 시행일 · 본문에 요율 · 약관 조항) · 판매자센터에 아직 안 보임 · 「공지 게시」 → 게시(고정) ·
     판매자센터 · 공개 공지에 보임 · 두 번째 409 NOTICE_DONE · 회원 403 · 취소 → 취소 안내 초안 → 게시 · 시행일까지 30일이 안 남으면 422 NOTICE_LATE
  ③ (작업) 하루 지나도 공지 안 한 예약 → 운영 알림 RATE_NOTICE_MISSING(WARN)
  ④ (화면) 소개몰 › 소개몰 정산 › 「요율 변경 예정」 — 「공지 안 함」 · 「공지 게시」 단추 · 화면 오류 없음
  만든 예약은 모두 취소 · 만든 공지는 게시를 거둠 · 판매자 · 상품 · 알림은 지움(두 번 돌아도 통과).
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
M9 = rd('prisma/migrations/D209_hlt_rate_notice/migration.sql')
RS = rd('src/modules/health/health-rate-schedule.service.ts')
CT, SS = rd('src/modules/health/health-seller.controller.ts'), rd('src/modules/health/health-seller.service.ts')
SC = rd('src/worker/scheduler.service.ts')
TR = rd('web/src/app/admin/HealthTypeRates.tsx')
CE = rd('site/src/components/health/SellerCenter.tsx')
SCR = rd('spec/screens.json')
EN = rd('src/common/i18n/server-text.en.ts')
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []
D407 = next((open(os.path.join(K, 'docs', x), encoding='utf-8').read() for x in docs if x.startswith('407_')), '')
mig = [d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isfile(os.path.join(K, 'prisma/migrations', d, 'migration.sql'))] if os.path.isdir(os.path.join(K, 'prisma/migrations')) else []
BAD = re.compile(r'\b(DELETE FROM|DROP TABLE|DROP FUNCTION|TRUNCATE)\b')


def msgs(lang):
    try:
        return json.load(open(os.path.join(K, f'site/src/i18n/messages/{lang}/hlt.json'), encoding='utf-8')).get('center', {})
    except Exception:
        return {}


ok('① D209 — 공지 칸(예약 안내 · 취소 안내 → notices) · 알림 종류 SELLER_RATE_SCHEDULED · SELLER_RATE_SCHEDULE_CANCELED · 지우는 문장 없음',
   'ADD COLUMN IF NOT EXISTS notice_id uuid REFERENCES public.notices(id)' in M9 and 'ADD COLUMN IF NOT EXISTS cancel_notice_id uuid REFERENCES public.notices(id)' in M9
   and "('SELLER_RATE_SCHEDULED'," in M9 and "('SELLER_RATE_SCHEDULE_CANCELED'," in M9 and 'ON CONFLICT (event_code) DO NOTHING' in M9 and not BAD.search(M9), '')
ok('① API — 예약 때 소개몰 공지 초안 · 「공지 게시」(31일 · 422 NOTICE_LATE · 409 NOTICE_DONE · 감사) · 취소 안내 초안 · 정기 작업 RATE_NOTICE_MISSING · 판매자센터 공지 · 영어 사전',
   "VALUES ('HLT', $1, $2, true, NULL, $3" in RS and 'async publishNotice(' in RS and "'NOTICE_LATE'" in RS and "'NOTICE_DONE'" in RS
   and '판매 수수료율 변경 취소 안내' in RS and "@Post('admin/health/rate-schedules/:id/notice')" in CT and "@Audit('HLT_RATE_NOTICE_PUBLISH'" in CT
   and "'RATE_NOTICE_MISSING', 'WARN'" in SC and "WHERE gwan_code = 'HLT' AND published_at IS NOT NULL" in SS
   and '"예약 안내 공지를 게시했습니다.":' in EN, '')
MK, ME = msgs('ko'), msgs('en')
ok('① 화면 · 명세 · 문서 — 「공지 안 함」 · 「공지 게시」 · 본문 확인 창 · 판매자센터 소개몰 공지(한 · 영) · 명세 · 문서 407 · 마이그레이션 247 · 판 v10.278 이상',
   'data-rate-notice="missing"' in TR and 'data-rate-notice-publish=' in TR and '게시할까요?' in TR and 'data-seller-notices=' in CE and MK.get('notices') and ME.get('notices')
   and '"POST /admin/health/rate-schedules/{id}/notice"' in SCR and bool(D407) and len(mig) in (247, 248, 249, 250) and tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 278),
   f'{len(mig)} · {VER} · 407 {bool(D407)}')


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


def cancel_mine():
    psql("UPDATE hlt_rate_schedules SET status = 'CANCELED', canceled_at = now(), cancel_reason = '시험 1278 정리' "
         "WHERE status = 'SCHEDULED' AND reason LIKE '%1278%' AND effective_at > now()")


stamp = str(int(time.time()))[-7:]
SEL = f't1278sel{stamp}@x.com'
CODE = f'TN-N{stamp}'
if API and DB:
    import consent_ok
    cancel_mine()
    psql("UPDATE hlt_seller_type_rates SET rate = NULL")
    T0 = psql("SELECT now()")
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{SEL}', '시험1278', '{pw}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{SEL}'")
    consent_ok.agree(SEL, PW); consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    login = lambda e: call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')
    TS, TL, TB = login('admin@x.com'), login(SEL), login('buyer@x.com')
    EARLY = psql("SELECT to_char((now() AT TIME ZONE 'Asia/Seoul')::date + 31, 'YYYY-MM-DD')")
    sid_, made = '', []
    try:
        sid_ = psql(f"INSERT INTO hlt_sellers (code, account_id, type, name, personal, ceo_name, cs_tel, return_addr, status, applied_at, submerchant_id) "
                    f"VALUES ('{CODE}', '{aid}', 'TENANT', '시험 가게 1278', true, '홍길동', '02-000-0000', '서울 강남구 테헤란로 1', 'ACTIVE', now(), 'SUB-T1278') RETURNING id").splitlines()[0]
        cat = psql("SELECT id FROM categories WHERE gwan_code = 'HLT' AND code = 'HLT_FUNC'")
        psql(f"INSERT INTO hlt_products (code, name, price, stock, status, seller_id, review_state, category_id) VALUES ('{CODE}-A', '시험 상품 1278', 10000, 5, 'DRAFT', '{sid_}', 'APPROVED', '{cat}')")

        # ② 예약 → 공지 초안
        t2 = call('PATCH', '/admin/health/type-rates/TENANT', {'rate': 13, 'reason': '시험 1278 유형', 'effectiveDate': EARLY}, TS)
        nid = t2.get('noticeId') or ''
        if nid:
            made.append(nid)
        nrow = psql(f"SELECT gwan_code || '|' || (published_at IS NULL) || '|' || is_pinned || '|' || title FROM notices WHERE id = '{nid}'") if nid else ''
        nbody = psql(f"SELECT body FROM notices WHERE id = '{nid}'") if nid else ''
        lst = call('GET', '/admin/health/rate-schedules', None, TS)
        mine = next((x for x in (lst if isinstance(lst, list) else []) if x.get('id') == t2.get('id')), {})
        c0 = call('GET', '/me/health/seller/center', None, TL)
        ok('② 예약 → 소개몰 공지 초안(게시 안 됨 · 고정 · 제목에 시행일 · 본문에 13% · 0시 · 제17조 4항) · 목록에 공지 칸(초안 · 늦지 않음) · 판매자센터 공지에는 아직 없음',
           t2.get('scheduled') is True and bool(nid) and nrow == f'HLT|true|true|판매 수수료율 변경 안내({EARLY} 시행)' and '13%' in nbody and '0시' in nbody and '제17조 4항' in nbody
           and mine.get('noticeId') == nid and mine.get('noticePublishedAt') is None and mine.get('noticeLate') is False
           and not [x for x in (c0.get('notices') or []) if x.get('id') == nid], f"{nrow} · {mine.get('noticeLate')} · {nbody[:60]}")

        # ④ 화면 — 게시 전
        try:
            from playwright.sync_api import sync_playwright
        except Exception:
            sync_playwright = None
        if ADMIN_WEB and sync_playwright:
            seen, perr = {}, []
            try:
                with sync_playwright() as p:
                    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1600, 'height': 1000})
                    pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
                    pg.on('dialog', lambda d: d.dismiss())
                    pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                    pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                    pg.wait_for_selector('[data-state-check]', timeout=30000)
                    pg.goto(ADMIN_WEB + '/#/hlt-settle', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                    seen['missing'] = pg.locator('[data-rate-notice="missing"]').count()
                    seen['btn'] = pg.locator(f'[data-rate-notice-publish="{t2.get("id")}"]').count()
                    if seen['btn']:
                        pg.click(f'[data-rate-notice-publish="{t2.get("id")}"]'); pg.wait_for_timeout(1500)   # 확인 창 「취소」 — 게시 안 됨
                    seen['still'] = psql(f"SELECT published_at IS NULL FROM notices WHERE id = '{nid}'") if nid else ''
                    pg.screenshot(path=os.path.join(HERE, 'v1278_notice.png'), full_page=True)
                    b.close()
            except Exception as ex:
                perr.append(str(ex)[:160])
            ok('④ 운영 화면 소개몰 › 소개몰 정산 › 「요율 변경 예정」 — 빨간 「공지 안 함」 · 「공지 게시」 단추 · 확인 창 취소하면 게시 안 됨 · 화면 오류 없음',
               (seen.get('missing') or 0) >= 1 and seen.get('btn') == 1 and seen.get('still') == 't' and not perr, f'{seen} · {perr[:2]}')
        else:
            print('  (운영 화면 · playwright 없음 — ④ 건너뜀)')

        p1 = call('POST', f"/admin/health/rate-schedules/{t2.get('id')}/notice", None, TS)
        p2 = call('POST', f"/admin/health/rate-schedules/{t2.get('id')}/notice", None, TS)
        pm = call('POST', f"/admin/health/rate-schedules/{t2.get('id')}/notice", None, TB)
        c1 = call('GET', '/me/health/seller/center', None, TL)
        pub = call('GET', '/notices', None, TL)   # v10.279 (D210) — 등급 「소개몰 판매자」 공지라 판매자 계정으로 봄
        ok('② 「공지 게시」 — 게시(예약 안내) · 판매자센터 소개몰 공지에 보임 · 공개 공지에 보임 · 두 번째 409 NOTICE_DONE · 회원 403',
           p1.get('ok') is True and p1.get('kind') == 'SCHEDULE' and p2.get('_err') == 409 and p2.get('code') == 'NOTICE_DONE' and pm.get('_err') == 403
           and any(x.get('id') == nid for x in (c1.get('notices') or [])) and any(x.get('id') == nid for x in (pub if isinstance(pub, list) else [])),
           f"{p1} · {p2.get('code')} · {pm.get('_err')}")

        k1 = call('POST', f"/admin/health/rate-schedules/{t2.get('id')}/cancel", {'reason': '시험 1278 취소'}, TS)
        cid = k1.get('cancelNoticeId') or ''
        if cid:
            made.append(cid)
        q1 = call('POST', f"/admin/health/rate-schedules/{t2.get('id')}/notice", None, TS)
        crow = psql(f"SELECT (published_at IS NOT NULL) || '|' || title FROM notices WHERE id = '{cid}'") if cid else ''
        ok('② 공지한 예약을 취소 → 「변경 취소 안내」 초안 → 같은 단추로 게시(CANCEL)',
           k1.get('status') == 'CANCELED' and bool(cid) and q1.get('kind') == 'CANCEL' and crow.startswith('true|판매 수수료율 변경 취소 안내'), f"{k1.get('note', '')[:40]} · {q1} · {crow}")

        # 시행일까지 30일이 안 남은 예약(만든 때를 40일 전으로 넣음) → 422 NOTICE_LATE
        ln = psql("INSERT INTO notices (gwan_code, title, body, is_pinned) VALUES ('HLT', '시험 1278 늦은 공지', 'x', true) RETURNING id").splitlines()[0]
        made.append(ln)
        lid = psql(f"INSERT INTO hlt_rate_schedules (scope, target, to_rate, effective_at, reason, created_at, notice_id) VALUES ('CATEGORY', 'HLT_FUNC', 20, now() + interval '10 days', '시험 1278 늦음', now() - interval '40 days', '{ln}') RETURNING id").splitlines()[0]
        l1 = call('POST', f'/admin/health/rate-schedules/{lid}/notice', None, TS)
        cancel_mine()
        ok('② 시행일까지 30일이 남지 않은 예약 — 422 NOTICE_LATE(취소하고 다시 예약) · 공지는 게시 안 됨',
           l1.get('_err') == 422 and l1.get('code') == 'NOTICE_LATE' and psql(f"SELECT published_at IS NULL FROM notices WHERE id = '{ln}'") == 't', f"{l1.get('code')}")

        # ③ 정기 작업 — 하루 지나도 공지 안 한 예약
        mn = psql("INSERT INTO notices (gwan_code, title, body, is_pinned) VALUES ('HLT', '시험 1278 빠뜨림', 'x', true) RETURNING id").splitlines()[0]
        made.append(mn)
        psql(f"INSERT INTO hlt_rate_schedules (scope, target, to_rate, effective_at, reason, created_at, notice_id) VALUES ('SELLER', '{sid_}', 20, now() + interval '35 days', '시험 1278 빠뜨림', now() - interval '2 days', '{mn}')")
        j = call('POST', '/admin/jobs', {'job': 'hlt_rate_schedule'}, TS)
        al = psql(f"SELECT count(*) || '|' || coalesce(max(severity), '') || '|' || coalesce(max(title), '') FROM ops_alerts WHERE alert_code = 'RATE_NOTICE_MISSING' AND raised_at >= '{T0}'")
        ok('③ 정기 작업 — 하루 지나도 공지 안 한 예약 → 운영 알림 RATE_NOTICE_MISSING(WARN · 위치 안내)',
           '_err' not in j and al.startswith('1|WARN|') and '「요율 변경 예정」' in al, f'{str(j)[:80]} · {al[:90]}')
    finally:
        cancel_mine()
        psql("UPDATE hlt_seller_type_rates SET rate = NULL")
        for x in made:
            psql(f"UPDATE notices SET is_pinned = false WHERE id = '{x}'")   # v10.280 (D211) 게시한 요율 공지는 잠겨 고정만 풂
            psql(f"UPDATE notices SET published_at = NULL WHERE id = '{x}' AND (published_at IS NULL OR published_at > now())")   # 게시 안 한 시험 공지만 거둠
        if sid_:
            psql(f"DELETE FROM hlt_products WHERE seller_id = '{sid_}'")
            psql(f"DELETE FROM hlt_seller_rate_changes WHERE seller_id = '{sid_}'")
            psql(f"DELETE FROM hlt_sellers WHERE id = '{sid_}'")
        psql(f"DELETE FROM notifications WHERE account_id IN (SELECT id FROM accounts WHERE email = '{SEL}')")
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
