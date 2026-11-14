"""v10.291 (docs/414) — 요율 인상 예약 공지 시점 확인 창(지금 · 날짜 정해 · 나중에)

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1291.py

  ① (코드) 확인 창(RateNoticeDialog · 지금 · 날짜(오늘 ~ 시행일 31일 전) · 나중에) · 바꾸기 단추 3곳이 예약 뒤 바로 물음 · 「게시 예약」 표시 · API at · 취소하면 거둠 · 영어 · 문서 414 · 판 v10.291
  ② (API) 날짜 범위 밖 422 NOTICE_AT_RANGE · 형식 400 · 날짜 정해 게시 예약(그날 0시 · 판매자센터에는 아직 없음 · 목록 noticeScheduled) · 다시 정하기 ·
          나가기 전 예약 취소 → 공지 거둠(취소 안내 없음) · 지금 게시 · 두 번째 409 · 회원 403
  ③ (화면) 소개몰 › 소개몰 정산 › 「요율 변경 예정」 「공지 게시」 → 확인 창 → 날짜 정해 공지 → 「게시 예약」
  요율 · 예약은 처음대로(두 번 돌아도 통과).
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
DLG, TR = rd('web/src/app/admin/RateNoticeDialog.tsx'), rd('web/src/app/admin/HealthTypeRates.tsx')
HS, HT = rd('web/src/app/admin/HealthSellers.tsx'), rd('web/src/app/admin/HealthSettle.tsx')
SV, CT = rd('src/modules/health/health-rate-schedule.service.ts'), rd('src/modules/health/health-seller.controller.ts')
EN = rd('src/common/i18n/server-text.en.ts')
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []
D414 = next((open(os.path.join(K, 'docs', x), encoding='utf-8').read() for x in docs if x.startswith('414_')), '')

ok('① 확인 창 — 지금 공지 · 날짜 정해 공지(오늘 ~ 시행일 31일 전) · 나중에(초안) · 바꾸기 단추 3곳(판매자 · 입점 유형 · 갈래)이 예약 뒤 바로 물음 · 「게시 예약」 표시',
   'export function askNoticeTiming(' in DLG and 'data-rate-notice-dialog=' in DLG and 'data-rate-notice-now' in DLG and 'data-rate-notice-at' in DLG
   and 'data-rate-notice-later' in DLG and 'minus(effectiveDate, 31)' in DLG and 'export async function afterSchedule' in TR
   and '.then(afterSchedule)' in TR and '.then(afterSchedule)' in HS and '.then(afterSchedule)' in HT
   and 'data-rate-notice="scheduled"' in TR and 'noticeScheduled' in TR and '게시할까요?' in TR)
ok('① API · 영어 · 문서 · 판 — POST …/notice at(그날 0시 · 범위 422 NOTICE_AT_RANGE) · 날짜 정한 공지는 다시 정하기 · 나가기 전 취소하면 거둠 · 영어 · 문서 414 · 판 v10.291',
   'export class RateNoticeDto' in CT and 'this.rates.publishNotice(id, dto?.at)' in CT and "'NOTICE_AT_RANGE'" in SV
   and "(n.published_at IS NOT NULL AND n.published_at <= now()) AS npub" in SV and '(n.published_at > now()) AS "noticeScheduled"' in SV
   and 'UPDATE notices SET published_at = NULL WHERE id = $1 AND published_at > now()' in SV
   and '"공지 날짜는 오늘({0})부터 {1}까지 정할 수 있습니다 — 시행일({2}) 31일 전까지(입점 약관 제17조 4항).": ' in EN
   and '확인 창' in D414 and tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 291), f'{VER} · 414 {bool(D414)}')


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
    psql("UPDATE hlt_rate_schedules SET status = 'CANCELED', canceled_at = now(), cancel_reason = '시험 1291 정리' "
         "WHERE status = 'SCHEDULED' AND reason LIKE '%1291%' AND effective_at > now()")


day = lambda n: psql(f"SELECT to_char((now() AT TIME ZONE 'Asia/Seoul')::date + {n}, 'YYYY-MM-DD')")
stamp = str(int(time.time()))[-7:]
SEL = f't1291sel{stamp}@x.com'
CODE = f'TN-R{stamp}'
if API and DB:
    import consent_ok
    cancel_mine()
    psql("UPDATE hlt_seller_type_rates SET rate = NULL")
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{SEL}', '시험1291', '{pw}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{SEL}'")
    consent_ok.agree(SEL, PW); consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    login = lambda e: call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')
    TS, TL, TB = login('admin@x.com'), login(SEL), login('buyer@x.com')
    EFF = day(45)          # 시행일 — 공지 마지막 날은 오늘 + 14
    LAST, D3, D5, TODAY = day(14), day(3), day(5), day(0)
    sid_, made = '', []
    try:
        sid_ = psql(f"INSERT INTO hlt_sellers (code, account_id, type, name, personal, ceo_name, cs_tel, return_addr, status, applied_at, submerchant_id) "
                    f"VALUES ('{CODE}', '{aid}', 'TENANT', '시험 가게 1291', true, '홍길동', '02-000-0000', '서울 강남구 테헤란로 1', 'ACTIVE', now(), 'SUB-T1291') RETURNING id").splitlines()[0]
        cat = psql("SELECT id FROM categories WHERE gwan_code = 'HLT' AND code = 'HLT_FUNC'")
        psql(f"INSERT INTO hlt_products (code, name, price, stock, status, seller_id, review_state, category_id) VALUES ('{CODE}-A', '시험 상품 1291', 10000, 5, 'DRAFT', '{sid_}', 'APPROVED', '{cat}')")

        t1 = call('PATCH', '/admin/health/type-rates/TENANT', {'rate': 13, 'reason': '시험 1291 유형', 'effectiveDate': EFF}, TS)
        sid1, nid = t1.get('id') or '', t1.get('noticeId') or ''
        if nid:
            made.append(nid)
        late = call('POST', f'/admin/health/rate-schedules/{sid1}/notice', {'at': day(15)}, TS)
        past = call('POST', f'/admin/health/rate-schedules/{sid1}/notice', {'at': day(-1)}, TS)
        bad = call('POST', f'/admin/health/rate-schedules/{sid1}/notice', {'at': '12/01'}, TS)
        mem = call('POST', f'/admin/health/rate-schedules/{sid1}/notice', {'at': D3}, TB)
        still = psql(f"SELECT published_at IS NULL FROM notices WHERE id = '{nid}'") if nid else ''
        ok('② API — 날짜가 시행일 31일 전보다 늦음 · 어제 → 422 NOTICE_AT_RANGE · 형식 400 · 회원 403 · 공지는 그대로 초안',
           t1.get('scheduled') is True and bool(nid) and late.get('_err') == 422 and late.get('code') == 'NOTICE_AT_RANGE' and past.get('code') == 'NOTICE_AT_RANGE'
           and bad.get('_err') == 400 and mem.get('_err') == 403 and still == 't', f"{late.get('code')} · {past.get('code')} · {bad.get('_err')} · {mem.get('_err')} · {still}")

        a1 = call('POST', f'/admin/health/rate-schedules/{sid1}/notice', {'at': D3}, TS)
        p1 = psql(f"SELECT to_char(published_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') FROM notices WHERE id = '{nid}'")
        lst = call('GET', '/admin/health/rate-schedules', None, TS)
        mine = next((x for x in (lst if isinstance(lst, list) else []) if x.get('id') == sid1), {})
        c1 = call('GET', '/me/health/seller/center', None, TL)
        a2 = call('POST', f'/admin/health/rate-schedules/{sid1}/notice', {'at': LAST}, TS)
        p2 = psql(f"SELECT to_char(published_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') FROM notices WHERE id = '{nid}'")
        ok('② API — 날짜 정해 게시 예약(그날 0시 · 목록 noticeScheduled · 판매자센터에는 아직 없음) · 마지막 날(시행일 31일 전)로 다시 정함',
           a1.get('ok') is True and a1.get('at') == D3 and p1 == f'{D3} 00:00' and mine.get('noticeScheduled') is True
           and not [x for x in (c1.get('notices') or []) if x.get('id') == nid] and a2.get('at') == LAST and p2 == f'{LAST} 00:00',
           f"{a1.get('note', '')[:40]} · {p1} · {mine.get('noticeScheduled')} · {p2}")

        k1 = call('POST', f'/admin/health/rate-schedules/{sid1}/cancel', {'reason': '시험 1291 취소'}, TS)
        w1 = psql(f"SELECT published_at IS NULL FROM notices WHERE id = '{nid}'")
        ok('② API — 공지가 나가기 전 예약 취소 → 게시 예약 공지를 거둠(초안) · 취소 안내 초안은 만들지 않음',
           k1.get('status') == 'CANCELED' and '거뒀습니다' in (k1.get('note') or '') and k1.get('cancelNoticeId') is None and w1 == 't', f"{k1.get('note', '')[-40:]} · {w1}")

        t2 = call('PATCH', '/admin/health/type-rates/TENANT', {'rate': 14, 'reason': '시험 1291 유형 다시', 'effectiveDate': EFF}, TS)
        sid2, nid2 = t2.get('id') or '', t2.get('noticeId') or ''
        if nid2:
            made.append(nid2)
        n1 = call('POST', f'/admin/health/rate-schedules/{sid2}/notice', {}, TS)
        n2 = call('POST', f'/admin/health/rate-schedules/{sid2}/notice', {'at': D5}, TS)
        c2 = call('GET', '/me/health/seller/center', None, TL)
        ok('② API — 지금 게시(오늘 · 판매자센터에 보임) · 두 번째(날짜를 줘도) 409 NOTICE_DONE',
           n1.get('ok') is True and n1.get('kind') == 'SCHEDULE' and n1.get('at') == TODAY and n2.get('_err') == 409 and n2.get('code') == 'NOTICE_DONE'
           and any(x.get('id') == nid2 for x in (c2.get('notices') or [])), f"{n1} · {n2.get('code')}")
        cancel_mine()

        if ADMIN_WEB:
            try:
                from playwright.sync_api import sync_playwright
            except Exception:
                sync_playwright = None
            if sync_playwright:
                t3 = call('PATCH', '/admin/health/type-rates/TENANT', {'rate': 15, 'reason': '시험 1291 화면', 'effectiveDate': EFF}, TS)
                sid3, nid3 = t3.get('id') or '', t3.get('noticeId') or ''
                if nid3:
                    made.append(nid3)
                seen, perr = {}, []
                try:
                    with sync_playwright() as p:
                        b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1600, 'height': 1000})
                        pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
                        pg.on('dialog', lambda d: d.accept())   # 공지 본문 확인 창 「확인」
                        pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                        pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                        pg.wait_for_selector('[data-state-check]', timeout=30000)
                        pg.goto(ADMIN_WEB + '/#/hlt-settle', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                        sel = f'[data-rate-notice-publish="{sid3}"]'
                        seen['btn'] = pg.locator(sel).count()
                        if seen['btn']:
                            pg.click(sel); pg.wait_for_timeout(1200)
                            seen['dialog'] = pg.locator('[data-rate-notice-dialog]').count()
                            if seen['dialog']:
                                pg.check('[data-rate-notice-date-mode]'); pg.fill('[data-rate-notice-at]', D5)
                                pg.screenshot(path=os.path.join(HERE, 'v1291_dialog.png'))
                                pg.click('[data-rate-notice-go]'); pg.wait_for_timeout(2500)
                            seen['closed'] = pg.locator('[data-rate-notice-dialog]').count() == 0
                            seen['badge'] = pg.locator('[data-rate-notice="scheduled"]').count()
                        seen['pub'] = psql(f"SELECT to_char(published_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') FROM notices WHERE id = '{nid3}'") if nid3 else ''
                        b.close()
                except Exception as ex:
                    perr.append(str(ex)[:160])
                ok('③ 화면 — 소개몰 › 소개몰 정산 › 「요율 변경 예정」 「공지 게시」 → 확인 창 → 날짜 정해 공지 → 「게시 예약」 · 그날 0시 · 화면 오류 없음',
                   seen.get('btn') == 1 and seen.get('dialog') == 1 and seen.get('closed') and (seen.get('badge') or 0) >= 1 and seen.get('pub') == f'{D5} 00:00' and not perr,
                   f'{seen} · {perr[:2]}')
            else:
                print('  (화면 · playwright 없음 — ③ 건너뜀)')
    finally:
        cancel_mine()
        psql("UPDATE hlt_seller_type_rates SET rate = NULL")
        for x in made:
            psql(f"UPDATE notices SET is_pinned = false WHERE id = '{x}'")   # 게시한 요율 공지는 잠겨 고정만 풂(D211)
            psql(f"UPDATE notices SET published_at = NULL WHERE id = '{x}' AND (published_at IS NULL OR published_at > now())")   # 나가기 전 시험 공지는 거둠
        if sid_:
            psql(f"DELETE FROM hlt_products WHERE seller_id = '{sid_}'")
            psql(f"DELETE FROM hlt_seller_rate_changes WHERE seller_id = '{sid_}'")
            psql(f"DELETE FROM hlt_sellers WHERE id = '{sid_}'")
        psql(f"DELETE FROM notifications WHERE account_id IN (SELECT id FROM accounts WHERE email = '{SEL}')")
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
