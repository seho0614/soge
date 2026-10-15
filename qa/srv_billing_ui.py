"""구독 해지 · 환불 — 사용자 웹 「내 구독」(SB-MYP-SUB-010 /my/subscription) 실측 (Playwright · 실제 로그인 · 클릭) (v10.18 · D022)

화면이 서버의 세 가지 환불 상태(환불 완료 · 환불 결과 확인 중 · 환불 실패)와 해지 결과를 그대로 보여 주는지 봅니다.
평소의 개발 환경(SITE 5174 → API 3000 · 결제 열쇠 없는 스텁 방식)에서 돕니다. 결제사 장애 상황은 srv_billing.py 가 봅니다.

사용:  python3 srv_billing_ui.py        (SITE=http://localhost:5174 API=http://localhost:3000 DB=postgresql://sgb:sgb@localhost:5432/sgb)
결과:  srv_billing_ui.json · 캡처 web_sub_manage_{1280,390}.png
"""
import json, os, subprocess, sys, urllib.request, uuid
from playwright.sync_api import sync_playwright

SITE = os.environ.get('SITE', 'http://localhost:5174').rstrip('/')
API = os.environ.get('API', 'http://localhost:3000').rstrip('/')
B = API if API.endswith('/api/v1') else API + '/api/v1'
DB = os.environ.get('DB', 'postgresql://sgb:sgb@localhost:5432/sgb')
OUT = os.path.dirname(os.path.abspath(__file__))
PW = 'sgb-test-1234'
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
BAD = ['Application error', 'Internal Server Error', 'Unhandled Runtime Error']
R = []
SUBS = []


def rec(name, ok, detail=''):
    R.append({'step': name, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print('ok  ' if ok else 'FAIL', name, '' if ok else str(detail)[:240], file=sys.stderr)


def q(sql):
    r = subprocess.run(['psql', DB, '-v', 'ON_ERROR_STOP=1', '-tAc', sql], capture_output=True, text=True)
    if r.returncode: raise RuntimeError(r.stderr.strip()[:300])
    return r.stdout.strip().split('\n')[0]


def call(m, p, tok=None, body=None):
    h = {'content-type': 'application/json', 'Idempotency-Key': uuid.uuid4().hex, 'User-Agent': UA}
    if tok: h['authorization'] = 'Bearer ' + tok
    data = json.dumps(body).encode() if body is not None else (b'{}' if m in ('POST', 'PATCH') else None)
    try:
        r = urllib.request.urlopen(urllib.request.Request(B + p, method=m, data=data, headers=h), timeout=30)
        return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'null')


def member(prefix, subscribe=True):
    """사업자 회원 하나. subscribe — 오늘 결제한 유료 구독(스텁 승인)"""
    e = f'{prefix}_{uuid.uuid4().hex[:8]}@t.local'
    st, j = call('POST', '/auth/signup', body={'email': e, 'password': PW, 'name': '구독화면'})
    assert st < 300, (st, j)
    aid = q(f"select id from accounts where email='{e}'")
    q(f"insert into account_roles(account_id, role) values ('{aid}','BIZ_OWNER') on conflict do nothing")
    tok = call('POST', '/auth/login', body={'email': e, 'password': PW})[1]['accessToken']
    u = {'email': e, 'aid': aid, 'tok': tok}
    if subscribe:
        st, j = call('POST', '/subscriptions', tok, {'planCode': 'STANDARD', 'paymentKey': 'tpk_' + uuid.uuid4().hex[:18], 'orderId': 'ord_' + uuid.uuid4().hex[:18]})
        assert st < 300, (st, j)
        u['sub'] = j['subscriptionId']; SUBS.append(u['sub'])
    return u


def open_refund(u, state):
    """환불 요청을 직접 만들어 원하는 상태로 둡니다(결제사 답을 못 받은 뒤 · 거절된 뒤의 화면)"""
    q(f"""insert into subscription_refunds(subscription_id, invoice_id, account_id, amount, reason)
          select s.id, i.id, s.account_id, i.amount, '화면 시험' from subscriptions s
            join subscription_invoices i on i.subscription_id = s.id and i.status = 'PAID' where s.id = '{u['sub']}'""")
    if state == 'UNKNOWN':
        q(f"update subscription_refunds set state='UNKNOWN', pg_status='NO_RESPONSE', failure_reason='결제사 응답을 받지 못했습니다' where subscription_id='{u['sub']}'")
    if state == 'FAILED':
        q(f"update subscription_refunds set state='FAILED', failure_code='NOT_CANCELABLE_PAYMENT', failure_reason='취소 할 수 없는 결제 입니다.' where subscription_id='{u['sub']}'")


def login(ctx, email):
    pg = ctx.new_page()
    pg.goto(SITE + '/login', wait_until='networkidle')
    __import__('consent_ok').agree(email, PW); pg.fill('input[name=email]', email); pg.fill('input[name=password]', PW)
    pg.locator('button', has_text='로그인').last.click()
    pg.wait_for_timeout(2500)
    ok = any(c['name'] == 'sgb_at' for c in ctx.cookies())
    pg.close()
    return ok


def session(br, u, width=1280):
    ctx = br.new_context(user_agent=UA, viewport={'width': width, 'height': 900})
    assert login(ctx, u['email']), '로그인 실패'
    pg = ctx.new_page()
    errs = []
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('dialog', lambda d: d.accept())
    return ctx, pg, errs


def go(pg):
    r = pg.goto(SITE + '/my/subscription', wait_until='networkidle')
    return r


def box(pg): return pg.locator('[data-sub-manage]')


def txt(pg, sel):
    loc = pg.locator(sel)
    return loc.first.inner_text().strip() if loc.count() else ''


def sub(u): return q(f"select status || '|' || coalesce(cancel_at::text,'') || '|' || coalesce(refunded_at::text,'') from subscriptions where id='{u['sub']}'").split('|')


def main():
    with sync_playwright() as p:
        br = p.chromium.launch()

        # 1. 구독이 없는 회원 — 관리 구역이 없어야 합니다(빈 상자를 띄우지 않음)
        u = member('ui0', subscribe=False)
        ctx, pg, errs = session(br, u)
        r = go(pg)
        rec('U-1 구독 없는 회원: 화면 200 · 「내 구독」 구역 없음 · 콘솔 오류 0', r.status == 200 and box(pg).count() == 0 and not errs and not any(b in pg.content() for b in BAD), (r.status, box(pg).count(), errs[:2]))
        ctx.close()

        # 2. 구독 회원 — 상태 · 버튼
        u = member('ui1')
        ctx, pg, errs = session(br, u)
        r = go(pg)
        t = box(pg).inner_text() if box(pg).count() else ''
        rec('U-2 구독 회원: 「내 구독」에 요금제 · 상태(이용 중) · 자동 갱신 · 다음 청구일이 보임', r.status == 200 and '스탠다드' in t and '이용 중' in t and '자동 갱신' in t and '다음 청구' in t and not errs, (t[:200], errs[:2]))
        rec('U-3 버튼: 「자동 갱신 해지」 · 「환불 신청」(오늘 결제 · 미이용이라 가능)', pg.locator('[data-act=cancel]').count() == 1 and pg.locator('[data-act=refund]').count() == 1 and pg.locator('[data-act=resume]').count() == 0,
            [pg.locator(f'[data-act={a}]').count() for a in ('cancel', 'resume', 'refund', 'refund-check')])
        pg.screenshot(path=os.path.join(OUT, 'web_sub_manage_1280.png'), full_page=True)

        # 3. 해지 → 철회
        pg.locator('[data-act=cancel]').click(); pg.wait_for_timeout(2500)
        s = sub(u); t = box(pg).inner_text()
        rec('U-4 「자동 갱신 해지」 → DB 에 해지 시각 · 화면에 「해지 예약」 안내 · 버튼이 「해지 철회」로', s[0] == 'ACTIVE' and s[1] and '해지 예약' in t and pg.locator('[data-act=resume]').count() == 1 and pg.locator('[data-act=cancel]').count() == 0, (s, t[:200]))
        pg.locator('[data-act=resume]').click(); pg.wait_for_timeout(2500)
        s = sub(u)
        rec('U-5 「해지 철회」 → 해지 시각이 지워지고 자동 갱신으로 돌아옴', not s[1] and pg.locator('[data-act=cancel]').count() == 1, s)

        # 4. 환불 — 사유 없이는 보내지 않음 → 사유를 쓰면 환불 완료
        pg.locator('[data-act=refund]').click(); pg.wait_for_timeout(800)
        n0 = q(f"select count(*) from subscription_refunds where subscription_id='{u['sub']}'")
        rec('U-6 환불 사유를 비우면 요청을 보내지 않고 안내', n0 == '0' and '사유' in txt(pg, '[data-sub-msg]'), (n0, txt(pg, '[data-sub-msg]')))
        pg.fill('[data-sub-manage] [name=refundReason]', '화면 시험 — 단순 변심')
        pg.locator('[data-act=refund]').click(); pg.wait_for_timeout(3000)
        s = sub(u); t = pg.locator('[data-refund-state]').first.inner_text() if pg.locator('[data-refund-state]').count() else ''
        st = pg.locator('[data-refund-state]').first.get_attribute('data-refund-state') if pg.locator('[data-refund-state]').count() else None
        rec('U-7 사유를 쓰고 「환불 신청」 → 화면 「환불 완료」 · DB 구독 CANCELLED · 청구서 REFUNDED', st == 'SUCCEEDED' and '환불 완료' in t and s[0] == 'CANCELLED' and s[2]
            and q(f"select status from subscription_invoices where subscription_id='{u['sub']}'") == 'REFUNDED', (st, t[:120], s))
        rec('U-8 연동 전(스텁)임을 밝힘 — 「실제 환불이 아닙니다」', '실제 환불이 아닙니다' in t, t[:160])
        rec('U-9 환불로 끝난 뒤에는 해지 · 환불 버튼이 없음 · 콘솔 오류 0', all(pg.locator(f'[data-act={a}]').count() == 0 for a in ('cancel', 'resume', 'refund', 'refund-check')) and not errs, errs[:3])
        ctx.close()

        # 5. 환불 결과 확인 중 — 결제사 답을 받지 못한 뒤의 화면
        u = member('ui2'); open_refund(u, 'UNKNOWN')
        ctx, pg, errs = session(br, u)
        go(pg)
        st = pg.locator('[data-refund-state]').first.get_attribute('data-refund-state') if pg.locator('[data-refund-state]').count() else None
        t = box(pg).inner_text() if box(pg).count() else ''
        rec('U-10 환불 결과 확인 중: 화면에 「환불 결과 확인 중」 · 이용 · 갱신이 멈춘다는 안내', st == 'UNKNOWN' and '환불 결과 확인 중' in t and '멈춥니다' in t, (st, t[:240]))
        rec('U-11 확인 중에는 「환불 결과 다시 확인」만 — 해지 · 새 환불 신청 버튼 없음(같은 환불을 두 번 넣지 않게)', pg.locator('[data-act=refund-check]').count() == 1 and pg.locator('[data-act=refund]').count() == 0,
            [pg.locator(f'[data-act={a}]').count() for a in ('cancel', 'resume', 'refund', 'refund-check')])
        pg.locator('[data-act=refund-check]').click(); pg.wait_for_timeout(3000)
        st = pg.locator('[data-refund-state]').first.get_attribute('data-refund-state') if pg.locator('[data-refund-state]').count() else None
        n = q(f"select count(*) || '/' || max(state) from subscription_refunds where subscription_id='{u['sub']}'")
        rec('U-12 「환불 결과 다시 확인」 → 결제사에 확인해 「환불 완료」 · 환불 요청은 그대로 1건', st == 'SUCCEEDED' and n == '1/SUCCEEDED' and sub(u)[0] == 'CANCELLED', (st, n))
        ctx.close()

        # 6. 환불 실패 — 결제사가 거절한 뒤의 화면
        u = member('ui3'); open_refund(u, 'FAILED')
        ctx, pg, errs = session(br, u)
        go(pg)
        st = pg.locator('[data-refund-state]').first.get_attribute('data-refund-state') if pg.locator('[data-refund-state]').count() else None
        t = box(pg).inner_text() if box(pg).count() else ''
        rec('U-13 환불 실패: 화면에 「환불 실패」 · 구독은 그대로(이용 중) · 다시 신청할 수 있음', st == 'FAILED' and '환불 실패' in t and '이용 중' in t and pg.locator('[data-act=refund]').count() == 1, (st, t[:240]))
        ctx.close()

        # 7. 결제 실패(PAST_DUE) 회원도 해지할 수 있음
        u = member('ui4')
        q(f"update subscriptions set status='PAST_DUE' where id='{u['sub']}'")
        ctx, pg, errs = session(br, u, width=390)
        go(pg)
        t = box(pg).inner_text() if box(pg).count() else ''
        rec('U-14 결제 실패 회원: 상태 「결제 실패」 · 「자동 갱신 해지」 버튼이 있음', '결제 실패' in t and pg.locator('[data-act=cancel]').count() == 1, t[:200])
        pg.locator('[data-act=cancel]').click(); pg.wait_for_timeout(2500)
        s = sub(u); t = box(pg).inner_text()
        rec('U-15 해지 → 「더 청구하지 않습니다」 안내 · DB 에 해지 시각', s[0] == 'PAST_DUE' and s[1] and '청구하지 않습니다' in t, (s, t[:200]))
        ov = pg.evaluate('() => document.documentElement.scrollWidth - document.documentElement.clientWidth')
        rec('U-16 390px 에서 가로 넘침 없음 · 콘솔 오류 0', ov <= 1 and not errs, (ov, errs[:2]))
        pg.screenshot(path=os.path.join(OUT, 'web_sub_manage_390.png'), full_page=True)
        ctx.close()
        br.close()


if __name__ == '__main__':
    try:
        main()
    except Exception as ex:
        import traceback; traceback.print_exc()
        rec('실행 중 오류', False, repr(ex)[:300])
    finally:
        ids = ','.join(f"'{s}'" for s in SUBS)
        if ids:
            try: q(f"update subscriptions set cancel_at = coalesce(cancel_at, now()) where id in ({ids}) and status in ('ACTIVE','PAST_DUE')")
            except Exception as ex: print('cleanup', ex, file=sys.stderr)
    ok = sum(1 for r in R if r['ok'])
    json.dump({'items': R, 'pass': ok, 'total': len(R)}, open(os.path.join(OUT, 'srv_billing_ui.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'통과 {ok} / {len(R)}')
