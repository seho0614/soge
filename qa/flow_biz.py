#!/usr/bin/env python3
"""flow 점검 — 구독 결제 · 소개코드 · 파트너센터 · 제휴 · 운영 설정 반영  (v10.25 · 2026-10-08)

  cd /home/claude/qa && python3 flow_biz.py        → flow_biz.json · 마지막 줄 「통과 n / m · 흐름 6개」

  B1 요금제 고르기 → 결제 → 내 구독              새 사업자 회원(flw_bz_*)
  B2 해지 → 다시 이용 → 환불 신청 → 운영 확인      B1 의 회원 · 구독을 그대로 이어받음 (끝: 구독 해지 상태)
  B3 소개코드 발급 → 코드로 들어옴 → 기록          새 일반 회원(flw_rc_*) · 비로그인 방문자
  B4 파트너 입점 신청 → 운영 심사 → 서비스 등록    새 사업자 회원(flw_pt_*) · 운영자
  B5 제휴 소개링크 → 유입 → 소개몰 주문 → 수익     운영자 · intro@x.com · 새 구매 회원(flw_af_*)
  B6 운영 설정 → 사용자 화면 반영                  운영자 · 비로그인 방문자 (설정 sns.x — 끝에 처음 값으로)

규칙(FLOW_BRIEF.md)
  · 화면으로 할 수 있는 단계는 화면으로. 화면에 그 단추가 없으면 「단추가 있음」 단계를 실패로 남기고, 흐름은 API 로 이어 갑니다(단계 이름에 적음).
  · 실패는 실패로 남깁니다. 앞 단계가 막혀 더 갈 수 없는 단계는 건너뜀(skip)으로 남깁니다.
  · 만든 주문은 취소 · 승인으로 재고를 되돌리고, 바꾼 설정 · 시험 제휴상품 · 링크는 치웁니다. 새 계정(flw_*@t.local)은 남습니다.
  · intro@x.com 의 구독 · 기존 계정의 정보는 건드리지 않습니다(B5 에서 intro 는 시험 링크 1개를 만들고, 끝에 지웁니다).
"""
import traceback, uuid
from flow_lib import *
from playwright.sync_api import sync_playwright

TAG = uuid.uuid4().hex[:6]
VIEW = {'width': 1280, 'height': 900}
CLEAN = []                                  # 어디서 멈추든 마지막에 돌릴 뒷정리


def adm(): return login('admin@x.com')
def sq(s): return re.sub(r'\s+', ' ', str(s or '')).strip()
def _dot(d):      # 2026-11-08 → 2026. 11. 8. (서버가 안내 글에 쓰는 한국 날짜 모양)
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})', d or ''); return f'{m.group(1)}. {int(m.group(2))}. {int(m.group(3))}.' if m else d
def mtext(pg): return text(pg, 'main') if pg.locator('main').count() else text(pg)
def yn(b, y='있음', n='없음'): return '확인하지 못함' if b is None else (y if b else n)


def wait_for(pg, cond, sec=15, gap=400):
    """cond() 가 참이 될 때까지 기다립니다(그 값을 돌려줌 · 끝내 아니면 None)"""
    t0 = time.time()
    while True:
        try:
            v = cond()
            if v: return v
        except Exception:
            pass
        if time.time() - t0 > sec: return None
        pg.wait_for_timeout(gap)


class Watch:
    """그 쪽(page)의 쪽 오류 · 실패한 API 응답 — new() 는 지난번 뒤로 새로 생긴 것만"""
    def __init__(self, pg, allow=()):
        self.errs, self.apis = watch(pg); self.i = self.j = 0; self.allow = tuple(allow)
    def new(self):
        e = self.errs[self.i:]; a = [x for x in self.apis[self.j:] if not any(k in x for k in self.allow)]
        self.i, self.j = len(self.errs), len(self.apis)
        return e + a


def chk(w, cond, detail):
    """화면 단계의 결과 — 조건이 맞고, 그 사이 쪽 오류 · 실패한 요청이 없어야 통과"""
    bad = w.new() if w else []
    return (bool(cond) and not bad), (str(detail) + (f' · 화면 오류/실패한 요청 {bad[:3]}' if bad else ''))


class Run:
    """한 흐름의 단계 실행 — 앞 단계가 막히면(stop) 뒤 단계는 건너뜀으로 남깁니다"""
    def __init__(self, F): self.F = F; self.block = None
    def stop(self, why): self.block = self.block or why
    def skip(self, name, how, why): self.F.step(name, how, False, f'건너뜀 — {why}', skip=True)
    def step(self, name, how, fn, need=True):
        if need and self.block:
            self.skip(name, how, self.block); return None
        try:
            ok, detail = fn()
        except Exception as ex:
            ok, detail = False, f'단계 실행 중 멈춤({type(ex).__name__}): {sq(str(ex))[:220]}'
        return self.F.step(name, how, ok, detail)


def s_open(br, email=None, pw=None):
    """사용자 웹 창 하나 — email 이 있으면 로그인 폼을 실제로 채워 로그인합니다. (ctx, page, Watch, 확인 창 글 목록)"""
    ctx = br.new_context(user_agent=UA, viewport=VIEW)
    if email:
        pg = site_login(ctx, email, pw)
        for _ in range(30):
            if any(c['name'] == 'sgb_at' for c in ctx.cookies()): break
            pg.wait_for_timeout(500)
        assert any(c['name'] == 'sgb_at' for c in ctx.cookies()), f'{email} 화면 로그인이 되지 않음'
    else:
        pg = ctx.new_page()
    dl = []
    pg.on('dialog', lambda d: (dl.append(d.message), d.accept()))
    return ctx, pg, Watch(pg), dl


def bo_open(br, email='admin@x.com'):
    """운영 화면 창 — (ctx, page, Watch)"""
    ctx = br.new_context(viewport={'width': 1400, 'height': 900})
    pg = bo_login(ctx, email)
    assert wait_for(pg, lambda: pg.locator('.bo-head nav button').count() > 3, 20), '운영 화면 로그인이 되지 않음'
    pg.on('dialog', lambda d: d.accept())
    return ctx, pg, Watch(pg)


def new_biz(prefix, name, company):
    """새 사업자 회원 — 가입 → 본인인증(시험) → 사업자 등록 → 운영자의 사업자 승인 (e2e.py 1 ~ 2번 단락)"""
    em, pw, tok, aid = signup(prefix, name)
    st1, _ = call('POST', '/verifications/identity', tok, {'provider': 'PASS'})
    st2, j2 = 0, None
    for _ in range(3):
        brn = str(int(time.time() * 1000))[-10:]
        st2, j2 = call('POST', '/businesses', tok, {'bizRegNo': brn, 'companyName': company, 'ceoName': '김흐름', 'sido': '서울', 'sigungu': '금천구'})
        if st2 != 409: break
        time.sleep(0.4)
    bid = (j2 or {}).get('businessId') or (j2 or {}).get('id') or q(f"select id from businesses where account_id='{aid}'")
    st3, _ = call('PATCH', f'/admin/businesses/{bid}/verify', adm(), {})
    tok = login(em, pw)
    st4, j4 = call('GET', '/me/summary', tok)
    pr = (j4 or {}).get('principal') or {}
    ok = bool(aid) and st1 < 300 and st2 < 300 and st3 < 300 and 'BIZ_OWNER' in (pr.get('roles') or []) and bool(pr.get('businessVerifiedAt'))
    return {'em': em, 'pw': pw, 'tok': tok, 'aid': aid, 'bid': bid, 'name': name, 'company': company, 'ok': ok,
            'detail': f"{em} · 가입 → 본인인증 {st1} → 사업자 등록 {st2} → 운영 승인 {st3} · 역할 {pr.get('roles')} · 사업자 인증 {'됨' if pr.get('businessVerifiedAt') else '안 됨'}"}


_PROTO = []
def proto():
    if not _PROTO:
        try: _PROTO.append(open(KIT + '/spec/proto.html', encoding='utf8').read())
        except Exception: _PROTO.append('')
    return _PROTO[0]
def proto_has(needle, fn=None):
    """시안(spec/proto.html)에 그 글이 있는가(fn 을 주면 그 화면 함수 안에서만) — 읽기만. 시안을 못 읽으면 None"""
    s = proto()
    if not s: return None
    if fn:
        i = s.find(f'function {fn}(')
        if i < 0: return None
        j = s.find('\nfunction ', i + 10); s = s[i:j if j > 0 else i + 6000]
    return needle in s
def src_read(rel):
    try: return open(os.path.join(KIT, rel), encoding='utf8').read()
    except Exception: return ''


def src_count(sub, pattern):
    """제품 서버 소스(읽기만)에서 pattern 이 나오는 횟수"""
    n = 0
    for root, _, files in os.walk(os.path.join(KIT, sub)):
        for f in files:
            if f.endswith('.ts'):
                try: n += len(re.findall(pattern, open(os.path.join(root, f), encoding='utf8').read(), flags=re.I))
                except Exception: pass
    return n
def writers(): return src_count('src', r'(insert\s+into|update|delete\s+from)\s+partner_(orders|revenues)\b')
def health_refs(): return src_count('src/modules/health', r'partner_(orders|links|revenues)|affiliate')


def close(*ctxs):
    for c in ctxs:
        try:
            if c: c.close()
        except Exception:
            pass


# ════════════════════════════════════════════════════════════════════
# B1 요금제 고르기 → 결제 → 내 구독
# ════════════════════════════════════════════════════════════════════
def b1(br, S):
    F = Flow('B1 요금제 고르기 → 결제 → 내 구독', '새 사업자 회원 · 운영자 admin@x.com'); R = Run(F); X = {}
    try:
        def prep():
            m = new_biz('flw_bz', f'흐름구독{TAG}', f'흐름구독상사{TAG}'); X['m'] = S['m'] = m
            F.d['who'] = f"새 사업자 회원 {m['em']} (이름 「{m['name']}」) · 운영자 admin@x.com"
            return m['ok'], m['detail']
        if not R.step('(준비) 새 사업자 회원을 만듦 — 가입 → 본인인증(시험) → 사업자 등록 → 운영자의 사업자 승인', 'API', prep):
            R.stop('새 사업자 회원을 만들지 못함')

        def s_my():
            m = X['m']; ctx, pg, w, dl = s_open(br, m['em'], m['pw']); X.update(ctx=ctx, pg=pg, w=w, dl=dl)
            goto(pg, '/my'); t = sq(mtext(pg))
            a = pg.locator('a[href="/my/subscription"]', has_text='구독 시작하기')
            has = a.count() > 0
            if has:
                a.first.click(); pg.wait_for_url('**/my/subscription', timeout=20000)
                try: pg.wait_for_load_state('networkidle', timeout=15000)
                except Exception: pass
            else:
                goto(pg, '/my/subscription')
            return chk(w, has and pg.url.endswith('/my/subscription'), f"나의공간 안내 「{t[6:60]}」 → 누른 뒤 주소 {pg.url.replace(SITE, '')}")
        if R.step('로그인 → 나의공간(/my)의 「구독 시작하기」를 누름 → 요금제 화면(/my/subscription)이 열림', '화면', s_my) is False and not X.get('pg'):
            R.stop('사용자 웹에 로그인하지 못함')

        def s_plans():
            pg, w = X['pg'], X['w']
            st, plans = call('GET', '/subscription-plans'); t = sq(mtext(pg)); X['plan_text'] = t
            want = [(p['name'], '무료' if not int(p['monthlyPrice']) else f"{int(p['monthlyPrice']):,}원") for p in (plans or [])]
            X['price'] = next((int(p['monthlyPrice']) for p in (plans or []) if p['code'] == 'STANDARD'), 0)
            ok = st == 200 and len(want) >= 2 and all(n in t and pr in t for n, pr in want) and '환불은 결제 당일에만 가능합니다' in t
            return chk(w, ok, f"화면의 요금제 {' · '.join(n + ' ' + pr for n, pr in want)} (요금제 API 와 같음) · 환불 조건 안내 {'있음' if '환불은 결제 당일에만 가능합니다' in t else '없음'}")
        R.step('요금제 화면에 요금제 3종의 이름 · 월 요금과 「환불은 결제 당일에만」 안내가 보임', '화면', s_plans)

        def s_button():
            pg, w = X['pg'], X['w']
            ctl = lambda: [sq(x) for x in pg.eval_on_selector_all('main button, main a, main input[type=radio], main select',
                           "els => els.map(e => (e.innerText || e.getAttribute('aria-label') || e.value || '').trim())") if sq(x)]
            pat = re.compile(r'구독하기|결제하기|결제|이 요금제|요금제 ?(변경|올리기|선택)|선택|시작하기|가입하기|신청')
            c1 = ctl(); goto(pg, '/my/subscription/upgrade'); c2 = ctl()
            found = [c for c in c1 + c2 if pat.search(c)]
            hint = '결제 연동은 준비 중입니다' in X.get('plan_text', '')
            proto = proto_has('이 요금제로</button>')
            return chk(w, bool(found), f"/my/subscription 의 단추 {c1 or '없음'} · /my/subscription/upgrade 의 단추 {c2 or '없음'} · 화면 맨 아래 안내 「결제 연동은 준비 중입니다 — PG 계약 후 이용할 수 있습니다」 {'있음' if hint else '없음'}"
                       f" · 시안(구독 · 소개코드)에는 요금제마다 「이 요금제로」 단추가 {yn(proto)}")
        R.step('요금제 화면(/my/subscription · /my/subscription/upgrade)에 요금제를 골라 결제를 시작하는 단추가 있음', '화면', s_button)

        def s_card():
            pg, w, dl = X['pg'], X['w'], X['dl']
            goto(pg, '/my/payment'); del dl[:]
            pg.locator('button', has_text='카드 등록하기').click()
            shown = lambda: '뒤 4자리만 보관합니다' in mtext(pg) or pg.locator('main [data-pay-card]').count() > 0   # v10.29~31 시안 — 「등록된 카드 · 카드사 ****1234」 칸(data-pay-card)
            now = wait_for(pg, shown, 20)
            btn = pg.eval_on_selector_all('main button', "els => els.map(e => e.innerText.trim() + (e.disabled ? '(눌리지 않음)' : ''))")
            if not now: goto(pg, '/my/payment')                 # 다시 열어도 보이는지
            t = sq(mtext(pg)); later = shown()
            in_db = q(f"select count(*) from billing_keys where account_id='{X['m']['aid']}' and status='ACTIVE'")
            ok = (bool(now) or later) and any('실제 카드가 등록되지 않습니다' in d for d in dl) and '지금은 연동 전이라 실제 결제가 일어나지 않습니다' in t
            m = re.search(r'카드 (\S+) 번호 ([•\s\d]+)', t) or re.search(r'등록된 카드 (\S+ \*{4}[•\d]{4})', t)
            seen = f"「{m.group(0)[:40]}」" if m else ('「등록된 결제 수단이 없습니다」가 그대로' if '등록된 결제 수단이 없습니다' in t else '카드 표가 보이지 않음')
            why = ''
            if not ok:
                _, kj = call('GET', '/me/billing-key', login(X['m']['em'], X['m']['pw'])); src = src_read('site/src/app/my/payment/page.tsx')
                why = f" — 서버 응답(GET /me/billing-key)의 항목 {sorted((kj or {}).keys())} · 화면 소스가 읽는 항목 registered {yn('k?.registered' in src)} · brand {yn('k.brand' in src)} · last4 {yn('k.last4' in src)}"
            return chk(w, ok, f"확인 창 「{sq(dl[0])[:42] if dl else '없음'}」 → 누른 뒤 단추 {btn} → {'바로 ' if now else '화면을 다시 열어도 '}{seen} · DB 의 사용 중 결제 수단 {in_db}건{why}")
        R.step('결제 수단 화면(/my/payment)에서 「카드 등록하기」를 누름 → 연동 전 안내 확인 창 → 시험 카드가 등록되어 보임', '화면', s_card)

        def d_card():
            r = rows(f"select status, coalesce(card_company,'-'), coalesce(card_last4,'-'), billing_key from billing_keys where account_id='{X['m']['aid']}'")
            return len(r) == 1 and r[0][0] == 'ACTIVE', f"billing_keys {len(r)}행 · {r[0] if r else '-'} (카드 번호는 저장하지 않고 청구용 열쇠 · 뒤 4자리만)"
        R.step('결제 수단이 DB(billing_keys)에 「사용 중」으로 1건 저장됨', 'DB', d_card)

        def s_sub():
            m = X['m']; pk = 'stub_' + uuid.uuid4().hex; oid = f'flw-sub-{TAG}-{uuid.uuid4().hex[:6]}'
            st, j = call('POST', '/subscriptions', m['tok'], {'planCode': 'STANDARD', 'paymentKey': pk, 'orderId': oid}); j = j or {}
            X.update(pk=pk, oid=oid, sub=j.get('subscriptionId')); S['sub'] = X['sub']
            return st in (200, 201) and j.get('status') == 'ACTIVE' and j.get('planCode') == 'STANDARD' and bool(X['sub']), \
                f"POST /subscriptions (스탠다드 · 시험 결제 키 stub_… · 주문번호 {oid}) → {st} · 상태 {j.get('status')} · 기간 {str(j.get('currentPeriodStart'))[:10]} ~ {str(j.get('currentPeriodEnd'))[:10]} {j.get('message') or ''}"
        if not R.step('(화면에 결제 단추가 없어 API 로) 스탠다드 요금제를 고르고 시험 결제로 구독을 시작함', 'API', s_sub):
            R.stop('구독이 만들어지지 않음')

        def d_sub():
            s = rows(f"""select plan_code, status, extract(day from current_period_end - current_period_start)::int, coalesce(cancel_at::text,'-'),
                         to_char(current_period_end at time zone 'Asia/Seoul','YYYY-MM-DD') from subscriptions where id='{X['sub']}'""")
            i = rows(f"select amount, status, is_stub, coalesce(payment_key,'-'), coalesce(order_id,'-') from subscription_invoices where subscription_id='{X['sub']}'")
            X['next'] = S['next'] = s[0][4] if s else ''
            ok = bool(s) and s[0][:4] == ['STANDARD', 'ACTIVE', '30', '-'] and len(i) == 1 and i[0] == [str(X['price']), 'PAID', 't', X['pk'], X['oid']]
            return ok, f"subscriptions: 요금제 {s[0][0]} · 상태 {s[0][1]} · 기간 {s[0][2]}일 · 해지 예약 {s[0][3]} / subscription_invoices {len(i)}건: 금액 {i[0][0] if i else '-'} · 상태 {i[0][1] if i else '-'} · 시험 결제 표식(is_stub) {i[0][2] if i else '-'} · 주문번호 {i[0][4] if i else '-'}"
        R.step('DB — 구독(subscriptions: 스탠다드 · 이용 중 · 30일)과 청구서(subscription_invoices: 금액 · 결제 완료 · 「시험 결제」 표식)가 생김', 'DB', d_sub)

        def s_mysub():
            pg, w = X['pg'], X['w']
            goto(pg, '/my/subscription'); wait_for(pg, lambda: pg.locator('[data-sub-manage]').count() == 1, 15)
            box = sq(text(pg, '[data-sub-manage]')); S['price'] = X['price']
            need = ['스탠다드', f"월 {X['price']:,}원", '상태 이용 중', '자동 갱신 자동 갱신', f"다음 청구 {X['next']}"]
            miss = [k for k in need if k not in box]
            return chk(w, not miss and pg.locator('[data-act=cancel]').count() == 1, f"「내 구독」: {box[:150]}{' · 빠진 것 ' + str(miss) if miss else ''} · 이 화면에 「시험 결제」 표시는 {'있음' if '시험 결제' in box else '없음'}")
        R.step('내 구독 화면(/my/subscription)의 「내 구독」에 요금제 · 월 요금 · 이용 중 · 자동 갱신 · 다음 결제일이 보임', '화면', s_mysub)

        def a_detail():
            m = X['m']; st, d = call('GET', '/me/subscription/detail', m['tok']); st2, inv = call('GET', '/me/subscription/invoices', m['tok']); d = d or {}
            i0 = (inv or [{}])[0] if isinstance(inv, list) else {}
            ok = st == 200 and d.get('subscribed') is True and d.get('planCode') == 'STANDARD' and d.get('autoRenew') is True and bool(d.get('nextChargeAt')) and d.get('hasBillingKey') is True \
                and st2 == 200 and isinstance(inv, list) and len(inv) == 1 and int(i0.get('amount') or 0) == X['price'] and i0.get('status') == 'PAID'
            return ok, f"내 구독 상세: 요금제 {d.get('planName')} · 자동 갱신 {d.get('autoRenew')} · 다음 결제 {str(d.get('nextChargeAt'))[:10]} · 결제 수단 {d.get('hasBillingKey')} · 안내 {d.get('notice')} / 청구 내역 {len(inv) if isinstance(inv, list) else '-'}건 · {i0.get('amount')}원 · {i0.get('status')}"
        R.step('내 구독 상세 · 청구 내역 응답(GET /me/subscription/detail · /invoices)이 화면 · DB 와 같음', 'API', a_detail)

        def s_my2():
            pg, w = X['pg'], X['w']
            goto(pg, '/my'); t = sq(mtext(pg))
            return chk(w, '구독 시작하기' not in t and '나의공간' in t,      # v10.27 (G-195) — 첫 화면 제목 「나의공간」
                        f"나의공간 첫 줄 「{t[6:70]}」")
        R.step('나의공간(/my)에서 「구독 시작하기 — 지금 이 단계에서 막혀 있습니다」 안내가 사라짐', '화면', s_my2)
    except Exception:
        F.step('시험 도구가 멈춤', 'API', False, sq(traceback.format_exc())[-280:])
    S.update(ctx=X.get('ctx'), pg=X.get('pg'), w=X.get('w'), dl=X.get('dl'))


# ════════════════════════════════════════════════════════════════════
# B2 해지 → 다시 이용 → 환불 신청 → 운영 확인
# ════════════════════════════════════════════════════════════════════
def b2(br, S):
    m, sub, pg, w, dl = S.get('m'), S.get('sub'), S.get('pg'), S.get('w'), S.get('dl')
    F = Flow('B2 해지 → 다시 이용 → 환불 신청 → 운영 확인', f"B1 의 사업자 회원 {m['em'] if m else '(만들지 못함)'} · 운영자 admin@x.com"); R = Run(F); X = {}
    REASON = f'흐름 시험 {TAG} — 단순 변심'
    intro_sub = lambda: rows("""select s.id, s.plan_code, s.status, coalesce(s.cancel_at::text,'-') from subscriptions s join accounts a on a.id=s.account_id
                                where a.email='intro@x.com' order by s.created_at, s.id""")
    intro0 = intro_sub()
    if not (m and sub and pg): R.stop('B1 에서 구독이 만들어지지 않아 이어 갈 구독이 없음')
    price, nxt = S.get('price', 0), S.get('next', '')
    subrow = lambda: rows(f"select status, coalesce(cancel_at::text,'-'), coalesce(refunded_at::text,'-') from subscriptions where id='{sub}'")[0]
    try:
        def s_cancel():
            goto(pg, '/my/subscription'); del dl[:]
            pg.locator('[data-act=cancel]').click()
            done = wait_for(pg, lambda: pg.locator('[data-act=resume]').count() == 1, 25)
            box = sq(text(pg, '[data-sub-manage]'))
            ok = bool(done) and any('이미 결제한 기간은 그대로 이용' in d for d in dl) and (f'해지 예약되었습니다. {nxt}까지 이용할 수 있고 이후 청구되지 않습니다' in box or f'해지 예약되었습니다. {_dot(nxt)}까지 이용할 수 있고 이후 청구되지 않습니다' in box) \
                and '다음 청구 청구 예정 없음' in box and '상태 이용 중' in box and pg.locator('[data-act=cancel]').count() == 0
            return chk(w, ok, f"확인 창 「{sq(dl[0])[:60] if dl else '없음'}」 → 화면: {box[box.find('자동 갱신'):][:150]}")
        R.step('내 구독에서 「자동 갱신 해지」를 누름 → 확인 창 → 「해지 예약 · 기간 끝까지 이용 · 이후 청구 없음」 안내 · 단추가 「해지 철회」로 바뀜', '화면', s_cancel)

        def d_cancel():
            s = subrow(); return s[0] == 'ACTIVE' and s[1] != '-', f"subscriptions: 상태 {s[0]}(기간 끝까지 이용) · 해지 예약 시각 {s[1][:19]}"
        R.step('DB — 구독은 「이용 중」 그대로이고 해지 예약 시각(cancel_at)이 찍힘', 'DB', d_cancel)

        def s_resume():
            pg.locator('[data-act=resume]').click()
            done = wait_for(pg, lambda: pg.locator('[data-act=cancel]').count() == 1, 25)
            box = sq(text(pg, '[data-sub-manage]'))
            ok = bool(done) and '자동 갱신 자동 갱신' in box and f'다음 청구 {nxt}' in box and '해지 예약' not in box and pg.locator('[data-act=resume]').count() == 0
            return chk(w, ok, f"화면: {box[box.find('자동 갱신'):][:120]}")
        R.step('「해지 철회」(다시 이용)를 누름 → 자동 갱신으로 돌아오고 다음 결제일이 다시 보임', '화면', s_resume)

        def d_resume():
            s = subrow(); return s[0] == 'ACTIVE' and s[1] == '-', f"subscriptions: 상태 {s[0]} · 해지 예약 시각 {s[1]}"
        R.step('DB — 해지 예약 시각이 지워지고 구독은 「이용 중」', 'DB', d_resume)

        def s_elig():
            t = sq(mtext(pg))
            ok = '환불은 결제 당일에만 가능합니다' in t and '한 건이라도 열람하시면 당일이어도 환불되지 않습니다' in t \
                and pg.locator('[data-act=refund]').count() == 1 and pg.locator('[data-sub-manage] [name=refundReason]').count() == 1
            return chk(w, ok, f"안내 「환불은 결제 당일에만 가능합니다」 {yn('환불은 결제 당일에만 가능합니다' in t)} · 「한 건이라도 열람하시면 당일이어도 환불되지 않습니다」 {yn('한 건이라도 열람하시면 당일이어도 환불되지 않습니다' in t)} · 「환불 신청」 단추 {pg.locator('[data-act=refund]').count()}개 · 사유 입력란 {pg.locator('[data-sub-manage] [name=refundReason]').count()}개")
        R.step('환불 가능 여부 안내 — 화면에 환불 조건(결제 당일 · 열람 전) 글과 「환불 신청」 단추 · 사유 입력란이 보임', '화면', s_elig)

        def a_elig():
            st, j = call('GET', '/me/subscription/refund-eligible', login(m['em'], m['pw'])); j = j or {}
            return st == 200 and j.get('eligible') is True, f"GET /me/subscription/refund-eligible → {st} · 가능 {j.get('eligible')} · 「{j.get('reason')}」 · 결제한 날 {j.get('paidOn')} · 이용 {j.get('used')}건"
        R.step('환불 가능 여부 응답 — 결제 당일 · 이용 0건이라 「환불 가능합니다」', 'API', a_elig)

        def s_noreason():
            pg.locator('[data-act=refund]').click(); pg.wait_for_timeout(1200)
            msg = sq(text(pg, '[data-sub-msg]')); n = q(f"select count(*) from subscription_refunds where subscription_id='{sub}'")
            return chk(w, '환불 사유를 적어 주십시오' in msg and n == '0', f"화면 안내 「{msg}」 · 환불 요청 {n}건(보내지 않음)")
        R.step('사유를 비운 채 「환불 신청」을 누름 → 「환불 사유를 적어 주십시오」 안내만 나오고 신청은 들어가지 않음', '화면', s_noreason)

        def s_refund():
            del dl[:]
            pg.fill('[data-sub-manage] [name=refundReason]', REASON)
            pg.locator('[data-act=refund]').click()
            done = wait_for(pg, lambda: pg.locator('[data-refund-state]').count() > 0 and '이용 중인 구독이 없습니다' in text(pg, '[data-sub-manage]'), 40)
            st = pg.get_attribute('[data-refund-state]', 'data-refund-state') if pg.locator('[data-refund-state]').count() else None
            box = sq(text(pg, '[data-sub-manage]'))
            ok = bool(done) and st == 'SUCCEEDED' and '환불 완료' in box and f'{price:,}원' in box and '실제 환불이 아닙니다' in box \
                and any('결제 취소가 확인되면 구독이 바로 끝납니다' in d for d in dl) and all(pg.locator(f'[data-act={a}]').count() == 0 for a in ('cancel', 'resume', 'refund', 'refund-check'))
            return chk(w, ok, f"확인 창 「{sq(dl[0])[:50] if dl else '없음'}」 → 화면: {box[:170]}")
        R.step('사유를 적고 「환불 신청」을 누름 → 확인 창 → 「환불 완료 · 금액」 · 「연동 전(시험)이라 실제 환불이 아닙니다」 · 「이용 중인 구독이 없습니다」', '화면', s_refund)

        def d_refund():
            r = rows(f"select id, state, amount, reason, is_stub, coalesce(completed_at::text,'-') from subscription_refunds where subscription_id='{sub}'")
            i = rows(f"select status, coalesce(refunded_at::text,'-') from subscription_invoices where subscription_id='{sub}'")
            s = subrow(); X['rid'] = r[0][0] if r else None
            ok = len(r) == 1 and r[0][1:5] == ['SUCCEEDED', str(price), REASON, 't'] and r[0][5] != '-' and len(i) == 1 and i[0][0] == 'REFUNDED' and i[0][1] != '-' and s[0] == 'CANCELLED' and s[2] != '-'
            return ok, f"subscription_refunds {len(r)}건: 상태 {r[0][1] if r else '-'} · {r[0][2] if r else '-'}원 · 사유 「{r[0][3] if r else '-'}」 · 시험 표식 {r[0][4] if r else '-'} / 청구서 {i[0][0] if i else '-'} / 구독 {s[0]} · 환불 시각 {s[2][:19]}"
        if not R.step('DB — 환불 요청(subscription_refunds: 완료 · 금액 · 사유 · 시험 표식) 1건 · 청구서 「환불됨」 · 구독 「해지」', 'DB', d_refund) or not X.get('rid'):
            R.stop('환불 요청이 만들어지지 않음')

        def o_billing():
            bctx, bo, bw = bo_open(br); X.update(bctx=bctx, bo=bo, bw=bw)
            tab = bo_tab(bo, '청구')
            wait_for(bo, lambda: bo.locator('[data-billing-review]').count() == 1 and any(k in text(bo, '[data-billing-review]') for k in ('없습니다', '구분')), 30)
            t = sq(text(bo, '[data-billing-review]')); rid8 = X['rid'][:8]
            n = re.search(r'확인 필요 (\d+)', t)
            return chk(bw, tab and '결제 · 환불 확인 필요' in t and rid8 not in t, f"「결제 · 환불 확인 필요」 칸 {yn('결제 · 환불 확인 필요' in t)} · 지금 {n.group(1) if n else '?'}건 — 그 안에 이 환불({rid8}…) {yn(rid8 in t)}{'' if rid8 in t else ' (남아 있는 것은 다른 시험의 것)'}. 이 칸은 끝나지 않은 청구 · 환불만 보여 줌(Billing.tsx)")
        R.step('운영 화면 「청구」 탭의 「결제 · 환불 확인 필요」 — 시험 결제 환불은 곧바로 끝나 「확인이 필요한 것」으로 남지 않음', '운영 화면', o_billing)

        def o_audit():
            bo, bw = X['bo'], X['bw']
            tab = bo_tab(bo, '감사')
            # v10.32 — 감사 기록(SB-ADM-AUD-020)은 시안대로 따로 열림: 「감사」의 「기록 보기」 → #/gov-audit/logs
            wait_for(bo, lambda: bo.locator('.bo-main [data-audit-logs]').count() == 1 or bo.locator('.bo-main input[aria-label="행위"]').count() == 1, 40)
            if bo.locator('.bo-main input[aria-label="행위"]').count() == 0: bo.locator('.bo-main [data-audit-logs]').click()
            wait_for(bo, lambda: bo.locator('.bo-main input[aria-label="행위"]').count() == 1, 40)
            bo.fill('.bo-main input[aria-label="행위"]', 'SUBSCRIPTION_REFUND')
            bo.locator('.bo-main form.search-row button', has_text='기록 보기').click()
            row = bo.locator('.bo-main tr', has_text='SUBSCRIPTION_REFUND').filter(has_text=m['name'])
            got = wait_for(bo, lambda: row.count() >= 1, 25)
            t = sq(row.first.inner_text()) if got else ''
            return chk(bw, tab and bool(got), f"감사 기록 줄: 「{t[:110]}」" if got else '그 회원 이름의 SUBSCRIPTION_REFUND 줄이 보이지 않음')
        R.step('운영 화면 「감사」 탭 › 감사 기록에서 행위 「SUBSCRIPTION_REFUND」로 찾음 → 그 회원의 환불 신청 기록이 보임', '운영 화면', o_audit)

        def d_end():
            s = subrow(); live = q(f"select count(*) from subscriptions where account_id='{m['aid']}' and status in ('ACTIVE','PAST_DUE')")
            i1 = intro_sub()
            return s[0] == 'CANCELLED' and live == '0' and i1 == intro0 and len(intro0) >= 1, f"시험 구독 {s[0]} · 그 회원의 살아 있는 구독 {live}건 · intro@x.com 구독 {len(i1)}건 {'처음과 같음' if i1 == intro0 else '달라짐 ' + str(i1)[:80]}"
        R.step('끝 상태 — 시험 구독은 해지(환불로 끝남) 상태로 두고, intro@x.com 의 구독은 처음과 같음', 'DB', d_end, need=not (m and sub))
    except Exception:
        F.step('시험 도구가 멈춤', 'API', False, sq(traceback.format_exc())[-280:])
    finally:
        close(X.get('bctx'), S.get('ctx'))


# ════════════════════════════════════════════════════════════════════
# B3 소개코드 발급 → 코드로 들어옴 → 기록
# ════════════════════════════════════════════════════════════════════
def b3(br, S):
    F = Flow('B3 소개코드 발급 → 코드로 들어옴 → 기록', '소개자(새 일반 회원) · 다른 방문자(로그인 안 함)'); R = Run(F); X = {}
    # v10.31 (합침 · w3 D060 · 10/10 시안 기준) — 무료 요금제(BASIC) 포함 소개코드 0건이면 첫 코드도 「건당 30,000원」 시험 결제(스텁)로 받습니다.
    #   기대값은 요금제 값(DB)을 따릅니다 — 1건 이상이면 예전 흐름(무료로 받고 둘째 매물에서 결제 안내) 그대로.
    FREE = int(q("select included_codes from subscription_plans where code='BASIC'") or 0)
    try:
        def prep():
            t0 = time.time()
            while q("select value from site_settings where key='refcode.scope'") != 'listing' and time.time() - t0 < 150: time.sleep(5)
            waited = round(time.time() - t0); scope = q("select value from site_settings where key='refcode.scope'")
            if waited >= 5: time.sleep(35)          # 다른 시험이 잠깐 바꿨다 되돌린 경우 — 사용자 웹이 설정을 30초 기억
            em, pw, tok, aid = signup('flw_rc', f'흐름소개자{TAG}')
            st, _ = call('POST', '/verifications/identity', tok, {'provider': 'PASS'})
            X['u'] = {'em': em, 'pw': pw, 'aid': aid}
            F.d['who'] = f'소개자(새 일반 회원) {em} · 다른 방문자(로그인 안 함)'
            return bool(aid) and st < 300 and scope == 'listing', f"{em} · 가입 → 본인인증 {st} · 운영 설정 「소개코드 범위」 = {scope}(매물별){' · 다른 시험이 바꿔 둔 값을 ' + str(waited) + '초 기다림' if waited >= 5 else ''}"
        if not R.step('(준비) 소개할 새 일반 회원을 만듦 — 가입 → 본인인증(시험)', 'API', prep): R.stop('소개자 회원을 만들지 못함')

        def s_give():
            u = X['u']; ctx, pg, w, dl = s_open(br, u['em'], u['pw']); X.update(ctx=ctx, pg=pg, w=w)
            goto(pg, '/mall/give'); t = sq(mtext(pg))
            quota = sq(text(pg, '[data-my-quota]'))
            qok = (f'0 / {FREE}건 사용' in quota) if FREE > 0 else ('무료 소개코드 없음 · 건당 30,000원' in quota)
            ok = '소개할 매물 상세의 「소개코드 공유」를 누릅니다' in t and qok and '아직 받은 소개코드가 없습니다' in t and '추가하거나' in t
            return chk(w, ok, f"안내 「소개할 매물 상세의 「소개코드 공유」를 누릅니다」 {yn('소개할 매물 상세의 「소개코드 공유」를 누릅니다' in t)} · 추가 요금 안내 {yn('추가하거나' in t)} · 「{quota[:70]}」 · 「아직 받은 소개코드가 없습니다」 {yn('아직 받은 소개코드가 없습니다' in t)}")
        if R.step('소개하기 안내 화면(/mall/give) — 받는 방법 · ' + (f'무료 포함 건수(월 {FREE}건)와 추가 요금 안내 · 「이번 달 0 / {FREE}건 사용」' if FREE > 0 else '추가 요금 안내 · 내 요금제 「무료 소개코드 없음 · 건당 30,000원」') + ' · 받은 코드 없음', '화면', s_give) is False and not X.get('pg'):
            R.stop('사용자 웹에 로그인하지 못함')

        def s_open_listing():
            pg, w, u = X['pg'], X['w'], X['u']
            pg.locator('a[href="/mall"]', has_text='매물 보러 가기').first.click(); pg.wait_for_url('**/mall', timeout=20000)
            try: pg.wait_for_load_state('networkidle', timeout=15000)
            except Exception: pass
            hrefs = pg.eval_on_selector_all('a[href^="/mall/"]', 'els => els.map(e => e.getAttribute("href"))')
            if not any(re.fullmatch(r'/mall/[0-9a-f-]{36}', h or '') for h in hrefs):
                # v10.31 (합침 · w2 P11) — 안심소개 첫 화면은 시안 3축의 기본 축(기계 · 설비 · 시설)입니다. 그 축에 매물이 없으면 「전체 목록」(/mall/list)에서 고릅니다
                goto(pg, '/mall/list'); X['mlist'] = '/mall/list'
                hrefs = pg.eval_on_selector_all('a[href^="/mall/"]', 'els => els.map(e => e.getAttribute("href"))')
            ids = []
            for h in hrefs:
                if re.fullmatch(r'/mall/[0-9a-f-]{36}', h or '') and h[6:] not in ids: ids.append(h[6:])
            good = set()
            if ids:
                inl = ','.join(f"'{i}'" for i in ids)
                good = {r[0] for r in rows(f"""select l.id from listings l join categories c on c.id=l.category_id where l.id in ({inl}) and l.status='PUBLISHED'
                                              and l.gwan_code='MAL' and not fn_category_no_intro(c.id) and l.owner_account_id <> '{u['aid']}'""")}
            pick = [i for i in ids if i in good][:2]
            assert len(pick) == 2, f'안심소개 목록에서 소개할 수 있는 매물 2건을 찾지 못함(목록 {len(ids)}건)'
            X['L1'], X['L2'] = pick; X['T1'] = q(f"select title from listings where id='{pick[0]}'")
            pg.locator(f'a[href="/mall/{pick[0]}"]').first.click(); pg.wait_for_url(f'**/mall/{pick[0]}', timeout=20000)
            wait_for(pg, lambda: pg.locator('[data-refshare-open]').count() == 1, 20)
            box = sq(text(pg, '[data-refshare]'))
            want = f'이번 달 새 매물 {FREE}건은 무료' if FREE > 0 else '무료 소개코드 없이 건당 30,000원'
            return chk(w, pg.locator('[data-refshare-open]').count() == 1 and '매물마다 따로' in box and want in box, f"매물 「{X['T1']}」 상세 · 「소개코드 공유」 칸: {box[:110]}")
        if not R.step('「매물 보러 가기」를 누름 → 안심소개 목록에서 매물 하나를 눌러 상세로 → 「소개코드 공유」 칸이 보임', '화면', s_open_listing): R.stop('소개할 매물 상세를 열지 못함')

        def s_issue():
            pg, w = X['pg'], X['w']
            pg.click('[data-refshare-open]'); pg.wait_for_selector('[data-refshare-code],[data-refshare-pay],[data-refshare-msg]', timeout=25000)
            if FREE == 0 and pg.locator('[data-refshare-pay]').count():
                X['pay0'] = sq(text(pg, '[data-refshare-pay]'))      # 「무료 소개코드 없음 · 건당 30,000원」 → 시험 결제(스텁)
                pg.click('[data-refshare-paybtn]'); pg.wait_for_selector('[data-refshare-code]', timeout=25000)
            code = pg.get_attribute('[data-refshare-code]', 'data-refshare-code') if pg.locator('[data-refshare-code]').count() else None
            link = pg.get_attribute('[data-refshare-link]', 'data-refshare-link') if pg.locator('[data-refshare-link]').count() else None
            X.update(code=code, link=link)
            if FREE == 0:
                p0 = X.get('pay0', '')
                return chk(w, bool(code) and link == f"{SITE}/mall/{X['L1']}?ref={code}" and '무료 소개코드 없음' in p0 and '30,000원' in p0,
                           f"결제 안내 「{p0[:70]}」 → 시험 결제 → 내 소개코드 {code} · 공유 주소 {link}")
            return chk(w, bool(code) and link == f"{SITE}/mall/{X['L1']}?ref={code}" and pg.locator('[data-refshare-pay]').count() == 0, f"내 소개코드 {code} · 공유 주소 {link} · 결제 안내 {yn(pg.locator('[data-refshare-pay]').count() > 0, '나옴', '없음(무료 포함분)')}")
        if not R.step('「소개코드 공유」를 누름 → ' + ('결제 없이(포함 건수 안)' if FREE > 0 else '「무료 소개코드 없음 · 건당 30,000원」 안내 → 시험 결제(스텁)로') + ' 내 소개코드와 공유 주소(매물 주소?ref=코드)가 나옴', '화면', s_issue): R.stop('소개코드가 발급되지 않음')

        def d_issue():
            u = X['u']
            r = rows(f"select code, coalesce(listing_id::text,'-'), is_extra, coalesce(revoked_at::text,'-') from referral_codes where owner_account_id='{u['aid']}'")
            pay = q(f"select count(*) from referral_code_payments where account_id='{u['aid']}'")
            sub = rows(f"select plan_code, status from subscriptions where account_id='{u['aid']}'")
            ok = len(r) == 1 and r[0] == [X['code'], X['L1'], 'f' if FREE > 0 else 't', '-'] and pay == ('0' if FREE > 0 else '1') and sub == [['BASIC', 'ACTIVE']]
            return ok, f"referral_codes {len(r)}건: 코드 {r[0][0] if r else '-'} · 그 매물에 묶임 {r[0][1] == X['L1'] if r else '-'} · 추가(유료) {r[0][2] if r else '-'} / 추가 결제 {pay}건 / 구독 {sub}(무료 베이직이 열림)"
        R.step('DB — 소개코드(referral_codes) 1건: 그 매물에 묶임 · ' + ('무료(추가 결제 없음)' if FREE > 0 else '추가(시험 결제 1건)') + ' · 무료 베이직 구독이 함께 열림', 'DB', d_issue)

        def s_second():
            pg, w = X['pg'], X['w']
            goto(pg, X.get('mlist', '/mall')); pg.locator(f'a[href="/mall/{X["L2"]}"]').first.click(); pg.wait_for_url(f'**/mall/{X["L2"]}', timeout=20000)
            wait_for(pg, lambda: pg.locator('[data-refshare-open]').count() == 1, 20)
            pg.click('[data-refshare-open]'); pg.wait_for_selector('[data-refshare-code],[data-refshare-pay],[data-refshare-msg]', timeout=25000)
            pay = sq(text(pg, '[data-refshare-pay]')) if pg.locator('[data-refshare-pay]').count() else ''
            btn = sq(text(pg, '[data-refshare-paybtn]')) if pg.locator('[data-refshare-paybtn]').count() else ''
            ok = (f'이번 달 무료 소개코드({FREE}건)를 모두 받았습니다' in pay if FREE > 0 else '무료 소개코드 없음' in pay) and '30,000원' in btn and pg.locator('[data-refshare-code]').count() == 0
            return chk(w, ok, f"안내 「{pay[:90]}」 · 단추 「{btn}」 · 코드 {yn(pg.locator('[data-refshare-code]').count() > 0, '나옴', '나오지 않음')}")
        R.step('다른 매물에서 「소개코드 공유」를 누름 → 포함 건수를 넘어 「추가 1건 30,000원 결제」 안내만 나오고 코드는 발급되지 않음(결제는 하지 않음)', '화면', s_second)

        def d_second():
            n = q(f"select count(*) from referral_codes where owner_account_id='{X['u']['aid']}'"); pay = q(f"select count(*) from referral_code_payments where account_id='{X['u']['aid']}'")
            return n == '1' and pay == ('0' if FREE > 0 else '1'), f"referral_codes {n}건 · 추가 결제 {pay}건"
        R.step('DB — 소개코드는 여전히 1건(결제 안내만 보고 돌아섬)', 'DB', d_second)

        def s_list():
            pg, w = X['pg'], X['w']
            goto(pg, '/mall/give'); li = pg.locator(f'li[data-code="{X["code"]}"]'); t = sq(li.inner_text()) if li.count() else ''
            quota = sq(text(pg, '[data-my-quota]'))
            ok = li.count() == 1 and X['T1'] in t and X['link'] in t and '유입 0회' in t and ((f'1 / {FREE}건 사용' in quota) if FREE > 0 else ('무료 소개코드 없음 · 건당 30,000원' in quota))
            return chk(w, ok, f"내 소개코드 줄: 「{t[:62]} … {X['link'][-18:]}」 · 「{quota[quota.find('이번 달'):][:40]}」")
        R.step('소개하기 안내 화면(/mall/give)의 「내 소개코드」에 그 코드 · 매물 제목 · 공유 주소 · 유입 0회가 보이고 「1 / 1건 사용」으로 바뀜', '화면', s_list)

        def s_visit():
            vctx, vp, vw, _ = s_open(br); X.update(vctx=vctx, vp=vp, vw=vw)
            st = goto(vp, X['link']); ck = {c['name']: c['value'] for c in vctx.cookies()}; X['vis'] = ck.get('sgb_visitor')
            t = sq(mtext(vp))
            ok = st == 200 and X['T1'] in t and ck.get('sgb_ref') == X['code'] and bool(X['vis'])
            return chk(vw, ok, f"응답 {st} · 매물 「{X['T1']}」 상세 {yn(X['T1'] in t, '열림', '보이지 않음')} · 방문자에게 기억된 소개코드(쿠키 sgb_ref) {ck.get('sgb_ref')} · 방문자 표식 {str(X['vis'])[:8]}…")
        if not R.step('다른 방문자(로그인 안 함)가 그 공유 주소로 들어옴 → 매물 상세가 열리고 소개코드가 방문자에게 기억됨', '화면', s_visit): R.stop('방문자가 공유 주소로 들어오지 못함')

        def d_visit():
            got = wait_for(X['vp'], lambda: q(f"select count(*) from attribution_events where code='{X['code']}' and visitor_key='{X['vis']}'") == '1', 10)
            r = rows(f"""select channel, source, coalesce(landing_url,'-'), extract(day from expires_at - occurred_at)::int, coalesce(account_id::text,'-')
                         from attribution_events where code='{X['code']}'""")
            ok = bool(got) and len(r) == 1 and r[0][0] == 'WEB' and r[0][1] == 'INTRO' and f"ref={X['code']}" in r[0][2] and r[0][3] == '90'
            return ok, f"attribution_events {len(r)}건: 경로 {r[0][0] if r else '-'} · 구분 {r[0][1] if r else '-'} · 들어온 주소 {r[0][2][-22:] if r else '-'} · 유효 {r[0][3] if r else '-'}일"
        R.step('DB — 유입 기록(attribution_events) 1건: 그 코드 · 그 방문자 · 들어온 주소 · 90일 유효', 'DB', d_visit)

        def s_again():
            vp, vw = X['vp'], X['vw']
            goto(vp, X['link']); vp.reload(wait_until='networkidle'); vp.wait_for_timeout(1500)
            n = q(f"select count(*) from attribution_events where code='{X['code']}'")
            return chk(vw, n == '1', f"두 번 더 연 뒤 attribution_events {n}건")
        R.step('같은 방문자가 같은 주소를 다시 열고 새로고침 → 유입 기록은 그대로 1건(같은 방문자는 24시간에 한 번)', '화면', s_again)

        def s_touch():
            pg, w = X['pg'], X['w']
            goto(pg, '/mall/give'); li = pg.locator(f'li[data-code="{X["code"]}"]')
            n = li.locator('[data-touches]').get_attribute('data-touches') if li.count() else None
            return chk(w, n == '1', f"내 소개코드 {X['code']} 의 유입 {n}회")
        R.step('소개자의 소개하기 안내 화면(/mall/give)에 그 코드의 「유입 1회」가 보임', '화면', s_touch)
    except Exception:
        F.step('시험 도구가 멈춤', 'API', False, sq(traceback.format_exc())[-280:])
    finally:
        close(X.get('ctx'), X.get('vctx'))


# ════════════════════════════════════════════════════════════════════
# B4 파트너 입점 신청 → 운영 심사 → 서비스 등록
# ════════════════════════════════════════════════════════════════════
def b4(br, S):
    F = Flow('B4 파트너 입점 신청 → 운영 심사 → 서비스 등록', '새 사업자 회원 · 운영자 admin@x.com'); R = Run(F); X = {}
    TITLE = f'흐름 시험 사무실 청소 {TAG}'; BODY = '사무실 · 상가 정기 청소를 합니다. 주 1회 방문 기준이며 작업 뒤 사진을 보내 드립니다.'
    REGIONS = [{'sido': '제주', 'sigungu': '서귀포시'}, {'sido': '제주', 'sigungu': '제주시'}]
    try:
        def prep():
            m = new_biz('flw_pt', f'흐름입점{TAG}', f'흐름입점상사{TAG}'); X['m'] = m
            F.d['who'] = f"새 사업자 회원 {m['em']} (업체 「{m['company']}」) · 운영자 admin@x.com"
            return m['ok'], m['detail']
        if not R.step('(준비) 새 사업자 회원을 만듦 — 가입 → 본인인증(시험) → 사업자 등록 → 운영자의 사업자 승인', 'API', prep): R.stop('새 사업자 회원을 만들지 못함')

        def s_before():
            m = X['m']; ctx, pg, w, dl = s_open(br, m['em'], m['pw']); X.update(ctx=ctx, pg=pg, w=w)
            goto(pg, '/partner'); t = sq(mtext(pg))
            links = pg.eval_on_selector_all('main a', 'els => els.map(e => e.innerText.trim() + "→" + e.getAttribute("href"))')
            return chk(w, '파트너 신청을 먼저 해주십시오' in t, f"화면 「{t[:75]}」 · 이 화면의 단추 {links} — 입점 신청(/partner/apply)으로 가는 단추는 {'있음' if any('/partner/apply' in x for x in links) else '없음'}")
        if R.step('파트너센터(/partner)를 엶 — 신청 전이라 「파트너 신청을 먼저 해주십시오」 안내가 보임', '화면', s_before) is False and not X.get('pg'):
            R.stop('사용자 웹에 로그인하지 못함')

        def s_apply():
            pg, w, m = X['pg'], X['w'], X['m']
            goto(pg, '/partner/apply'); t0_ = sq(mtext(pg))
            pg.locator('button', has_text='입점 신청하기').click()
            done = wait_for(pg, lambda: '접수되었습니다. 영업일 기준' in mtext(pg), 25)
            t = sq(mtext(pg))
            ns = lambda x: re.sub(r'\s+', '', x)   # v10.31 (w5 시안 단계 칸) — 단계 이름과 상태가 붙은 칸으로 그려져 사이 빈칸이 없음 → 빈칸을 빼고 견줌
            ok = '1.본인·사업자확인사업자인증완료' in ns(t0_) and bool(done) and '2.입점신청접수됨' in ns(t) and '3.운영승인심사중' in ns(t)
            return chk(w, ok, f"누르기 전 「1. 본인 · 사업자 확인 — 사업자 인증 완료 · 2. 입점 신청 대기」 {yn('1.본인·사업자확인사업자인증완료' in re.sub(r'\s+', '', t0_) and '2.입점신청대기' in re.sub(r'\s+', '', t0_), '맞음', '다름')} → 누른 뒤 「{t[t.find('2. 입점 신청'):][:14]}」 · 「{t[t.find('3. 운영 승인'):][:15]}」 · 「접수되었습니다. 영업일 기준 1~2일 안에 결과를 알려 드립니다」 {yn(done)}")
        if not R.step('입점 신청 화면(/partner/apply) — 1단계 본인 · 사업자 확인 「사업자 인증 완료」 확인 → 「입점 신청하기」를 누름 → 2단계 「접수됨」 · 3단계 「심사 중」', '화면', s_apply): R.stop('입점 신청이 접수되지 않음')

        def d_apply():
            r = rows(f"select p.id, p.status, p.grade from partners p where p.business_id='{X['m']['bid']}'"); X['pid'] = r[0][0] if r else None
            return len(r) == 1 and r[0][1] == 'APPLIED', f"partners {len(r)}행 · 상태 {r[0][1] if r else '-'}(심사 대기) · 등급 {r[0][2] if r else '-'}"
        if not R.step('DB — 파트너(partners) 행이 「심사 대기」로 생김', 'DB', d_apply) or not X.get('pid'): R.stop('파트너 신청 행이 없음')

        def o_approve():
            bctx, bo, bw = bo_open(br); X.update(bctx=bctx, bo=bo, bw=bw)
            tab = bo_tab(bo, '파트너', '입점 신청 (T-01)')
            card = bo.locator(f'[data-partner="{X["pid"]}"]'); wait_for(bo, lambda: card.count() == 1, 25)
            t = sq(card.inner_text()) if card.count() else ''
            card.locator('button', has_text='승인').click()
            wait_for(bo, lambda: q(f"select status from partners where id='{X['pid']}'") == 'ACTIVE', 20)
            msg = sq(text(bo, '.bo-main .form-ok'))
            return chk(bw, tab and X['m']['company'] in t and '사업자 인증 완료' in t and '승인했습니다' in msg, f"신청 카드 「{t[:70]}」 → 「승인」 → 안내 「{msg[:60]}」")
        if not R.step('운영 화면 「파트너 › 입점 신청 (T-01)」에 그 업체가 「사업자 인증 완료」로 보임 → 「승인」을 누름', '운영 화면', o_approve): R.stop('운영 화면에서 입점을 승인하지 못함')

        def d_approve():
            r = rows(f"select status, coalesce(approved_at::text,'-'), coalesce((select email from accounts where id=approved_by),'-') from partners where id='{X['pid']}'")[0]
            return r[0] == 'ACTIVE' and r[1] != '-' and r[2] == 'admin@x.com', f"partners: 상태 {r[0]}(활동) · 승인 시각 {r[1][:19]} · 승인한 사람 {r[2]}"
        R.step('DB — 파트너 상태가 「활동」으로 바뀌고 승인 시각 · 승인한 운영자가 남음', 'DB', d_approve)

        def s_center():
            pg, w, m = X['pg'], X['w'], X['m']
            goto(pg, '/partner/apply'); t0_ = sq(mtext(pg))
            a = pg.locator('a[href="/partner"]', has_text='파트너센터로 가기')
            has = a.count() > 0
            if has:
                a.first.click(); pg.wait_for_url('**/partner', timeout=20000)
                try: pg.wait_for_load_state('networkidle', timeout=15000)
                except Exception: pass
            else:
                goto(pg, '/partner')
            t = sq(mtext(pg))
            # v10.31 (w5 시안) — 단계 칸은 이름 · 상태가 붙어 그려짐(빈칸 없이 견줌) · 파트너센터 첫 화면은 업체 카드(.pt-prof: 상호 · 「운영중」 · 등급 브론즈) + 「막혀 있는 것 N건」 표
            ns = lambda x: re.sub(r'\s+', '', x)
            prof = sq(text(pg, 'main [data-ptn-prof]'))
            ok = '3.운영승인승인' in ns(t0_) and has and m['company'] in prof and '운영중' in prof and '등급 브론즈' in prof and '승인된 서비스 없음' in t and '활동 지역 없음' in t
            return chk(w, ok, f"입점 신청 화면 「3. 운영 승인 · 승인」 {yn('3.운영승인승인' in ns(t0_))} · 「파트너센터로 가기」 {yn(has)} → 파트너센터 업체 카드 「{prof[:70]}」 · 막힌 것 「승인된 서비스 없음」 {yn('승인된 서비스 없음' in t)} · 「활동 지역 없음」 {yn('활동 지역 없음' in t)}")
        R.step('입점 신청 화면의 3단계가 「승인」으로 바뀜 → 「파트너센터로 가기」를 누름 → 파트너센터(/partner)가 열리고 막힌 것 2가지(서비스 · 지역)를 알려 줌', '화면', s_center)

        def s_service():
            pg, w = X['pg'], X['w']
            goto(pg, '/partner/services'); links = pg.eval_on_selector_all('main a, main button', 'els => els.map(e => e.innerText.trim())')
            X['svc_links'] = links
            goto(pg, '/partner/services/new')
            # v10.31 (W5 D072 · 시안 scPtnReg) — 위에는 업종별 등록 위자드, 개발의 간단 등록(서비스명 · 설명)은 아래 접힌 「간단 등록」에 남음 → 펼쳐서 씀
            pg.locator('main details.pt-fset > summary', has_text='간단 등록').first.click()
            box = pg.locator('main details.pt-fset[open]').first
            box.locator('input').first.fill(TITLE); box.locator('textarea').first.fill(BODY)
            box.locator('button', has_text='검수 요청').click()
            done = wait_for(pg, lambda: pg.url.endswith('/partner/services') and TITLE in mtext(pg), 30)
            t = sq(mtext(pg)); i = t.find(TITLE)
            # v10.31 (W5 시안 내 서비스 표 — 상태 꼬리표 「검수대기」 · 「본사 검수 대기 — …」 · 노출중)
            row = sq(pg.locator('main tr', has_text=TITLE).first.inner_text()) if pg.locator('main tr', has_text=TITLE).count() else ''
            return chk(w, bool(done) and '검수대기' in row, f"「내 서비스」 화면의 단추 {links or '없음'} — 서비스 등록으로 가는 단추 {yn(any('등록' in x for x in links))}(시안의 내 서비스에는 「✚ 서비스 등록」 단추 {yn(proto_has('✚ 서비스 등록</button>'), '있음', '없음')}) → 주소로 열어 등록 → 내 서비스 줄 「{t[i:i + 45] if i >= 0 else '보이지 않음'}」")
        if not R.step('서비스 등록 화면(/partner/services/new — 파트너센터 · 내 서비스에 이 화면으로 가는 단추가 없어 주소를 직접 엶)에 서비스명 · 설명을 적고 「검수 요청」 → 내 서비스에 「검수 중」', '화면', s_service):
            R.stop('서비스가 등록되지 않음')

        def d_service():
            r = rows(f"select id, status, title from partner_services where partner_id='{X['pid']}'"); X['sid'] = r[0][0] if r else None
            return len(r) == 1 and r[0][1] == 'IN_REVIEW' and r[0][2] == TITLE, f"partner_services {len(r)}행 · 상태 {r[0][1] if r else '-'}(검수 중) · 「{r[0][2] if r else '-'}」"
        if not R.step('DB — 서비스(partner_services) 행이 「검수 중」으로 생김', 'DB', d_service) or not X.get('sid'): R.stop('서비스 행이 없음')

        def o_review():
            bo, bw = X['bo'], X['bw']
            tab = bo_tab(bo, '파트너', '서비스 검수 (T-02)')
            card = bo.locator(f'[data-service="{X["sid"]}"]'); wait_for(bo, lambda: card.count() == 1, 25)
            t = sq(card.inner_text()) if card.count() else ''
            card.locator('button', has_text='승인').click()
            wait_for(bo, lambda: q(f"select status from partner_services where id='{X['sid']}'") == 'APPROVED', 20)
            msg = sq(text(bo, '.bo-main .form-ok'))
            return chk(bw, tab and TITLE in t and X['m']['company'] in t and '승인했습니다' in msg, f"검수 카드 「{t[:75]}」 → 「승인」 → 안내 「{msg[:60]}」")
        R.step('운영 화면 「파트너 › 서비스 검수 (T-02)」에 그 서비스(업체 · 제출 시각 · 본문)가 보임 → 「승인」을 누름', '운영 화면', o_review)

        def d_review():
            s = q(f"select status from partner_services where id='{X['sid']}'"); return s == 'APPROVED', f'partner_services 상태 {s}(승인)'
        R.step('DB — 서비스 상태가 「승인」으로 바뀜', 'DB', d_review)

        def s_svc_ok():
            pg, w = X['pg'], X['w']
            goto(pg, '/partner/services'); t = sq(mtext(pg))
            row = sq(pg.locator('main tr', has_text=TITLE).first.inner_text()) if pg.locator('main tr', has_text=TITLE).count() else ''
            # v10.31 (W5 시안) — 승인된 서비스는 「노출중」 꼬리표 · 승인된 것이 생기면 「승인된 서비스가 없어 리드가 오지 않습니다」 안내가 사라짐(전: 「승인 1 / 1건」 머리 글)
            return chk(w, '노출중' in row and '승인된 서비스가 없어' not in t, f"줄 「{row[:60]}」 · 「승인된 서비스가 없어 …」 안내 {yn('승인된 서비스가 없어' in t)}")
        R.step('내 서비스 화면(/partner/services)에 그 서비스가 「노출중」(승인)으로 보이고 「승인된 서비스가 없어 …」 안내가 사라짐', '화면', s_svc_ok)

        def s_region_ui():
            pg, w = X['pg'], X['w']
            goto(pg, '/partner/regions'); t = sq(mtext(pg))
            ctl = pg.eval_on_selector_all('main input, main select, main button, main form, main [role=checkbox], main [role=switch]', 'els => els.map(e => e.tagName)')
            return chk(w, len(ctl) > 0, f"화면 「{t[6:68]}」 · 입력란 · 단추 {len(ctl)}개{'' if ctl else ' — 지역을 켜라고 안내하지만 켤 수단이 화면에 없음'} · 시안의 「서비스 지역」 화면에 단추 {yn(proto_has('<button', 'scPtnRegion'))}(켠 · 꺼둔 지역 표시)")
        R.step('활동 지역 화면(/partner/regions)에 지역을 고르고 저장하는 입력란 · 단추가 있음', '화면', s_region_ui)

        def a_region():
            m = X['m']; st, j = call('POST', '/partner/regions', login(m['em'], m['pw']), {'regions': REGIONS})
            return st in (200, 201) and (j or {}).get('regions') == 2, f"POST /partner/regions (제주 서귀포시 · 제주 제주시) → {st} {j}"
        R.step('(화면에 저장 단추가 없어 API 로) 활동 지역 2곳을 저장함', 'API', a_region)

        def d_region():
            r = rows(f"select sido, sigungu from partner_regions where partner_id='{X['pid']}' order by 1, 2")
            return r == [['제주', '서귀포시'], ['제주', '제주시']], f'partner_regions {len(r)}행 · {r}'
        R.step('DB — 활동 지역(partner_regions) 2행이 저장됨', 'DB', d_region)

        def s_ready():
            pg, w, m = X['pg'], X['w'], X['m']
            goto(pg, '/partner/regions'); t1 = sq(mtext(pg))
            # v10.31 (W5 D070 · 10/10 시안 「잔액이 0이면 상담을 못 받습니다」) — 서비스 · 지역을 풀어도 선불 잔액이 0이면 「리드 이용료 잔액 없음」 1건이 남음
            goto(pg, '/partner'); t0 = sq(mtext(pg)); left1 = '막혀 있는 것 1건' in t0 and '리드 이용료 잔액 없음' in t0
            # → 시험 결제(스텁)로 10만 원 충전(srv_lead_ui 와 같은 길) 뒤 다시 봄
            tok = login(m['em'], m['pw']); st, c = call('POST', '/partner/cash/charges', tok, {'amount': 100000})
            st2 = call('POST', '/partner/cash/charges/confirm', tok, {'orderId': (c or {}).get('orderId'), 'paymentKey': 'stub_' + uuid.uuid4().hex, 'amount': 100000})[0]
            goto(pg, '/partner'); t2 = sq(mtext(pg))
            ok = '현재 2개 지역에서 리드를 받습니다' in t1 and '제주 서귀포시' in t1 and '제주 제주시' in t1 and left1 and st2 in (200, 201) and '리드를 받을 수 있는 상태입니다' in t2 and re.search(r'리드 수신\s*정상', t2)
            return chk(w, ok, f"활동 지역 「{t1[t1.find('현재'):][:48]}」 · 충전 전 파트너센터 「막혀 있는 것 1건 · 리드 이용료 잔액 없음」 {yn(left1)} → 시험 결제 충전 {st} · {st2} → 「{t2[t2.find('리드를 받을'):][:40]}」 · 리드 수신 정상 {yn(bool(re.search(r'리드 수신\s*정상', t2)))}")
        R.step('활동 지역 화면에 저장한 2곳이 보임 → 파트너센터에 「리드 이용료 잔액 없음」 1건만 남음(선불 · D070) → 시험 결제(스텁)로 충전하면 「리드를 받을 수 있는 상태입니다 · 리드 수신 정상」', '화면', s_ready)
    except Exception:
        F.step('시험 도구가 멈춤', 'API', False, sq(traceback.format_exc())[-280:])
    finally:
        close(X.get('ctx'), X.get('bctx'))


# ════════════════════════════════════════════════════════════════════
# B5 제휴 소개링크 → 유입 → 소개몰 주문 → 수익
# ════════════════════════════════════════════════════════════════════
def b5(br, S):
    F = Flow('B5 제휴 소개링크 → 유입 → 소개몰 주문 → 수익', '운영자 admin@x.com · 제휴 파트너 intro@x.com · 구매 회원(새 회원)'); R = Run(F); X = {}
    PCODE, PNAME, LABEL = f'FLW-{TAG.upper()}', f'흐름 시험 제휴상품 {TAG}', f'흐름 시험 {TAG}'
    stock = lambda: int(q(f"select stock from hlt_products where code='{X['hp']}'") or -1)

    def wipe():
        """시험 제휴상품 · 그 상품의 링크를 지웁니다(주문이 걸려 지울 수 없으면 판매 중단으로)"""
        pid = q(f"select id from affiliate_products where code='{PCODE}'")
        if not pid: return
        # v10.27 (G-190) — 클릭 · 제휴 주문 귀속 기록이 걸린 링크는 지울 수 없음(기록 보존) → 링크는 끄고 상품은 판매 중단
        rl, _ = sql(f"delete from partner_links where product_id='{pid}'")
        if rl: sql(f"update partner_links set is_active=false where product_id='{pid}'")
        rc, _ = sql(f"delete from affiliate_products where id='{pid}'")
        if rc: sql(f"update affiliate_products set status='STOPPED' where id='{pid}'")
    CLEAN.append(wipe)

    try:
        def o_product():
            # 다른 흐름 시험(flow_mall)이 BIKE-01 의 재고를 0 까지 사 보는 단계가 있어, 재고 검사가 느슨한 쪽(RED-30)을 먼저 고릅니다
            X['hp'] = q("select code from hlt_products where status='ON_SALE' and stock >= 3 order by (code='RED-30') desc, (code<>'BIKE-01') desc, stock desc, code limit 1")
            assert X['hp'], '소개몰에 지금 파는 상품이 없음'
            X['hname'] = q(f"select name from hlt_products where code='{X['hp']}'"); X['land'] = f"/health/p/{X['hp']}"
            others = rows("select name, landing_url from affiliate_products where status='ON_SALE' order by created_at")
            bctx, bo, bw = bo_open(br); X.update(bctx=bctx, bo=bo, bw=bw)
            tab = bo_tab(bo, '제휴', '제휴상품 · 단가')
            box = bo.locator('.bo-main .card.pad').filter(has=bo.locator('button', has_text='상품 등록'))
            wait_for(bo, lambda: box.count() == 1, 25)
            for lab, val in (('코드', PCODE), ('상품명', PNAME), ('건당 수수료', '1000'), ('광고주', '흐름 시험'), ('랜딩 주소', X['land'])):
                box.locator('label', has_text=lab).locator('input').fill(val)
            box.locator('button', has_text='상품 등록').click()
            X['prod'] = wait_for(bo, lambda: q(f"select id from affiliate_products where code='{PCODE}'"), 20)
            msg1 = sq(text(bo, '.bo-main .form-ok'))
            sel = bo.locator(f'select[aria-label="{PCODE} 상태"]'); wait_for(bo, lambda: sel.count() == 1, 20)
            sel.select_option('ON_SALE')
            on = wait_for(bo, lambda: q(f"select status from affiliate_products where code='{PCODE}'") == 'ON_SALE', 20)
            return chk(bw, tab and bool(X['prod']) and bool(on), f"기존 판매 중 제휴상품 {len(others)}종의 도착 주소 {', '.join(u for _, u in others[:2])} ({yn(all(u.startswith('http') for _, u in others), '모두 바깥 주소', '우리 사이트 안 주소 있음')}) → 소개몰 상품 「{X['hname']}」({X['land']})을 도착 주소로 시험 상품 {PCODE} 등록(안내 「{msg1[:10]}」) → 상태 「판매중」")
        if not R.step('(준비) 운영 화면 「제휴 › 제휴상품 · 단가」에서 소개몰 상품 화면을 도착 주소로 하는 제휴상품을 등록하고 「판매중」으로 바꿈', '운영 화면', o_product) or not X.get('prod'):
            R.stop('시험 제휴상품을 등록하지 못함')

        def d_product():
            r = rows(f"select status, commission, landing_url from affiliate_products where id='{X['prod']}'")
            return r == [['ON_SALE', '1000', X['land']]], f"affiliate_products: 상태 {r[0][0] if r else '-'} · 건당 수수료 {r[0][1] if r else '-'}원 · 도착 주소 {r[0][2] if r else '-'}"
        R.step('DB — 제휴상품(affiliate_products) 행: 판매중 · 건당 수수료 · 도착 주소', 'DB', d_product)

        def s_link():
            ctx, pg, w, _ = s_open(br, 'intro@x.com'); X.update(ictx=ctx, ipg=pg, iw=w)
            goto(pg, '/partners/links')
            opts = pg.eval_on_selector_all('form.p2form select[name=productId] option', 'els => els.map(e => e.innerText.trim())')
            pg.select_option('form.p2form select[name=productId]', X['prod']); pg.fill('form.p2form input[name=label]', LABEL)
            pg.locator('form.p2form button', has_text='링크 만들기').click()
            wait_for(pg, lambda: pg.locator('form.p2form .ok-note').count() + pg.locator('form.p2form .form-error').count() > 0, 25)
            note = sq(text(pg, 'form.p2form .ok-note')) or sq(text(pg, 'form.p2form .form-error'))
            r = rows(f"select id, code from partner_links where label='{LABEL}'")
            if r: X['link'], X['code'] = r[0]
            return chk(w, len(r) == 1 and '링크를 만들었습니다' in note and X.get('code', '?') in note, f"고를 수 있는 상품 {len(opts) - 1}종 → 「{PNAME}」 · 이름 「{LABEL}」 → 안내 「{note[:50]}」")
        if not R.step('intro@x.com 이 내 소개링크 화면(/partners/links)에서 그 상품을 고르고 쓸 곳 이름을 적어 「링크 만들기」를 누름 → 코드 안내', '화면', s_link) or not X.get('link'):
            R.stop('소개링크가 만들어지지 않음')

        def d_link():
            r = rows(f"""select l.is_active, l.product_id, a.email from partner_links l join partners p on p.id=l.partner_id join businesses b on b.id=p.business_id
                         join accounts a on a.id=b.account_id where l.id='{X['link']}'""")
            return r == [['t', X['prod'], 'intro@x.com']], f"partner_links: 코드 {X['code']} · 사용 중 {r[0][0] if r else '-'} · 주인 {r[0][2] if r else '-'}"
        R.step('DB — 소개링크(partner_links) 행: 그 상품 · intro@x.com 의 것 · 사용 중', 'DB', d_link)

        def s_share():
            pg, w = X['ipg'], X['iw']
            goto(pg, '/partners/links'); row = pg.locator(f'tr[data-link-code="{X["code"]}"]'); t = sq(row.inner_text()) if row.count() else ''
            X['url'] = row.locator('[data-testid=share-url]').inner_text().strip() if row.count() else ''
            return chk(w, X['url'] == f"{SITE}/r/{X['code']}" and '사용 중' in t and PNAME in t, f"목록 줄 「{t[:110]}」")
        if not R.step('내 소개링크 목록에 새 링크가 「사용 중」으로 보이고 뿌릴 공유 주소(사이트/r/코드)가 적혀 있음', '화면', s_share): R.stop('공유 주소를 얻지 못함')

        def a_buyer():
            em, pw, tok, aid = signup('flw_af', f'흐름제휴구매{TAG}')
            st1, _ = call('POST', '/verifications/identity', tok, {'provider': 'PASS'})
            st2, a = call('POST', '/me/health/addresses', tok, {'label': '흐름 시험', 'receiver': '흐름구매', 'phone': '010-1111-2222', 'zipcode': '08500', 'addr1': '서울 금천구 가산디지털1로 1'})
            X['b'] = {'em': em, 'pw': pw, 'aid': aid}
            F.d['who'] = f'운영자 admin@x.com · 제휴 파트너 intro@x.com · 구매 회원(새 회원) {em}'
            return bool(aid) and st1 < 300 and st2 < 300, f'{em} · 가입 → 본인인증 {st1} → 배송지 등록 {st2}'
        if not R.step('(준비) 링크로 들어올 다른 회원을 만듦 — 가입 → 본인인증(시험) → 배송지 등록', 'API', a_buyer): R.stop('구매 회원을 만들지 못함')

        def s_visit():
            b = X['b']; ctx, vp, vw, _ = s_open(br, b['em'], b['pw']); X.update(vctx=ctx, vp=vp, vw=vw)
            X['s0'] = stock(); X['t0'] = q("select now()::text")
            st = goto(vp, X['url'])
            buy = wait_for(vp, lambda: vp.locator('main [data-options] [data-buynow]').count() == 1, 25); t = sq(mtext(vp))
            ok = st == 200 and vp.url == SITE + X['land'] and X['hname'] in t and bool(buy)
            return chk(vw, ok, f"{X['url'].replace(SITE, '')} → 도착 {vp.url.replace(SITE, '')} (응답 {st}) · 상품 「{X['hname']}」 {yn(X['hname'] in t, '보임', '보이지 않음')} · 「바로구매」 단추 {yn(buy)}{'' if buy else ' · 화면 「' + t[:90] + '」 · 재고 ' + str(stock())}")
        if not R.step('그 회원이 공유 주소를 엶 → 소개몰 상품 화면에 도착함', '화면', s_visit): R.stop('공유 주소로 소개몰 상품 화면에 도착하지 못함')

        def d_click():
            got = wait_for(X['vp'], lambda: q(f"select count(*) from partner_link_clicks where link_id='{X['link']}'") == '1', 10)
            st = rows(f"select clicks, orders from partner_link_stats where link_id='{X['link']}'")
            n = q(f"select count(*) from partner_link_clicks where link_id='{X['link']}'")
            return bool(got) and st == [['1', '0']], f"partner_link_clicks {n}건 · partner_link_stats 클릭 {st[0][0] if st else '-'} · 주문 {st[0][1] if st else '-'}"
        R.step('DB — 유입(클릭) 기록: partner_link_clicks 1건 · 그날 집계(partner_link_stats) 클릭 1', 'DB', d_click)

        def s_clicks():
            pg, w = X['ipg'], X['iw']
            goto(pg, '/partners/links'); cell = sq(pg.locator(f'tr[data-link-code="{X["code"]}"] td.num').nth(1).inner_text())
            return chk(w, cell == '1 / 1', f'그 링크의 클릭(오늘 / 누적) 「{cell}」')
        R.step('intro@x.com 의 내 소개링크 목록에 그 링크의 클릭 수가 「1 / 1」(오늘 / 누적)로 보임', '화면', s_clicks)

        def s_order():
            vp, vw = X['vp'], X['vw']
            vp.locator('main [data-options] [data-buynow]').click(); vp.wait_for_url('**/health/order', timeout=30000)
            cbs = vp.locator('.hlt-chk input[type=checkbox]'); wait_for(vp, lambda: cbs.count() == 2, 20)
            ncb = cbs.count()
            for i in range(ncb): cbs.nth(i).check()
            btn = vp.locator('button.cta-primary'); wait_for(vp, lambda: btn.is_enabled(), 15)
            b1t = sq(btn.inner_text()); btn.click(); vp.wait_for_url('**/health/order/pay**', timeout=30000)
            X['no'] = re.search(r'[?&]no=([^&]+)', vp.url).group(1)
            pay = vp.locator('button.cta-primary', has_text='시험 결제'); wait_for(vp, lambda: pay.count() == 1 and pay.is_enabled(), 20)
            b2t = sq(pay.inner_text()); pay.click(); vp.wait_for_url('**/health/order/done**', timeout=40000)
            done = wait_for(vp, lambda: '결제가 완료되었습니다' in mtext(vp), 20); t = sq(mtext(vp))
            return chk(vw, bool(done) and X['no'] in t and '시험 결제' in t and '결제 완료' in t, f"「바로구매」 → 주문서(동의 {ncb}가지) 「{b1t}」 → 결제 「{b2t}」 → 「결제가 완료되었습니다」 {yn(done)} · 주문번호 {X['no']} · 「시험 결제」 표시 {yn('시험 결제' in t)}")
        if not R.step('그 회원이 도착한 상품에서 「바로구매」 → 주문서에서 동의하고 결제하기 → 「시험 결제」 단추 → 주문 완료 화면', '화면', s_order): R.stop('소개몰 주문 · 결제가 끝나지 않음')

        def d_order():
            o = rows(f"select status, total, coalesce(pay_method,'-') from hlt_orders where order_no='{X['no']}'")
            p = rows(f"select p.state, p.stub, p.amount from hlt_payments p join hlt_orders o on o.id=p.order_id where o.order_no='{X['no']}' and p.state='PAID'")
            it = rows(f"select pr.code, i.qty from hlt_order_items i join hlt_orders o on o.id=i.order_id join hlt_products pr on pr.id=i.product_id where o.order_no='{X['no']}'")
            ok = len(o) == 1 and o[0][0] == 'PAID' and len(p) == 1 and p[0][1] == 't' and p[0][2] == o[0][1] and it == [[X['hp'], '1']]
            return ok, f"hlt_orders {X['no']}: 상태 {o[0][0] if o else '-'} · {o[0][1] if o else '-'}원 / hlt_payments: {p[0][0] if p else '-'} · 시험 결제 {p[0][1] if p else '-'} / 상품 {it} / 재고 {X['s0']} → {stock()}"
        R.step('DB — 소개몰 주문(hlt_orders: 결제 완료)과 결제(hlt_payments: 시험 결제)가 생기고 재고가 1 줄어듦', 'DB', d_order)

        def s_attr():
            pg, w = X['ipg'], X['iw']
            goto(pg, '/partners/orders'); t = sq(mtext(pg))
            goto(pg, '/partners/revenues'); X['rev_empty'] = '아직 발생한 수익이 없습니다' in mtext(pg)
            goto(pg, '/partners/links'); cell = sq(pg.locator(f'tr[data-link-code="{X["code"]}"] td.num').nth(2).inner_text())
            return chk(w, X['no'] in t, f"주문/고객현황: {'주문번호 ' + X['no'] + ' 있음' if X['no'] in t else '「아직 들어온 주문이 없습니다」' if '아직 들어온 주문이 없습니다' in t else t[-60:]} · 내 소개링크의 주문 수 「{cell}」 · 화면 안내 「클릭 후 72시간 안에 주문해야 수수료가 붙습니다」 {yn('클릭 후 72시간 안에 주문해야 수수료가 붙습니다' in t)}")
        a1 = R.step('intro@x.com 의 주문/고객현황(/partners/orders)에 그 주문이 「내 링크로 들어온 주문」으로 보임', '화면', s_attr)

        def d_attr():
            n = q(f"select count(*) from partner_orders where link_id='{X['link']}' or product_id='{X['prod']}' or order_no='{X['no']}'"); tot = q('select count(*) from partner_orders')
            X['attr'] = int(n or 0) >= 1
            return X['attr'], f"partner_orders 에 이 링크 · 상품 · 주문번호의 행 {n}건(표 전체 {tot}건) · partner_revenues {q('select count(*) from partner_revenues')}건 — 제품 서버 소스(src/**/*.ts)에서 이 두 표에 쓰는(INSERT · UPDATE) 곳 {writers()}곳 · 소개몰 주문 소스(health-shop.service.ts)에 제휴 · 링크를 보는 곳 {health_refs()}곳"
        a2 = R.step('DB — 제휴 주문(partner_orders)에 그 주문이 이 링크 · intro@x.com 의 것으로 귀속됨', 'DB', d_attr)

        if X.get('attr'):
            def s_rev():
                pg, w = X['ipg'], X['iw']
                goto(pg, '/partners/revenues'); t = sq(mtext(pg)); n = q(f"select count(*) from partner_revenues r join partner_orders o on o.id=r.order_id where o.link_id='{X['link']}'")
                return chk(w, int(n or 0) >= 1, f'수익관리 화면 「{t[-90:]}」 · partner_revenues {n}건')
            R.step('수익관리(/partners/revenues)와 DB(partner_revenues)에 그 주문의 수수료가 잡힘', '화면', s_rev)
        elif not R.block:
            R.skip('수익관리(/partners/revenues)와 DB(partner_revenues)에 그 주문의 수수료가 잡힘', '화면', f"제휴 주문으로 귀속되지 않아 수익이 생길 수 없음(수익관리 화면의 「아직 발생한 수익이 없습니다」 {yn(X.get('rev_empty'))} · partner_revenues {q('select count(*) from partner_revenues')}건)")
        else:
            R.skip('수익관리(/partners/revenues)와 DB(partner_revenues)에 그 주문의 수수료가 잡힘', '화면', R.block)
    except Exception:
        F.step('시험 도구가 멈춤', 'API', False, sq(traceback.format_exc())[-280:])

    # ── 되돌리기 — 앞에서 어디까지 갔든, 만든 것이 있으면 치웁니다 ──
    try:
        b = X.get('b')
        live = [r[0] for r in rows(f"select order_no from hlt_orders where account_id='{b['aid']}' and status <> 'CANCELED' order by created_at")] if b else []
        if live:
            def a_cancel():
                tok = login(b['em'], b['pw']); out = []
                for no in live:
                    st1, j1 = call('POST', '/me/health/returns', tok, {'orderNo': no, 'kind': 'CANCEL', 'reason': 'CHANGE_MIND'})
                    rid = (j1 or {}).get('id') or q(f"select r.id from hlt_returns r join hlt_orders o on o.id=r.order_id where o.order_no='{no}' order by r.created_at desc limit 1")
                    st2, j2 = call('POST', f'/admin/health/returns/{rid}/decide', adm(), {'state': 'APPROVED'})
                    out.append((no, st1, st2, sq((j2 or {}).get('note'))[:70]))
                return all(o[1] < 300 and o[2] < 300 for o in out), f'취소 신청 → 운영 승인: {out}'
            R.step('(되돌리기) 그 회원이 주문 취소를 신청하고 운영자가 승인함 — POST /me/health/returns → POST /admin/health/returns/{id}/decide', 'API', a_cancel, need=False)

            def d_cancel():
                o = rows(f"""select o.order_no, o.status, coalesce(o.restocked_at::text,'-'), coalesce((select state from hlt_returns r where r.order_id=o.id order by created_at desc limit 1),'-')
                             from hlt_orders o where o.account_id='{b['aid']}' order by o.created_at""")
                s1 = stock(); other = q(f"""select count(*) from hlt_order_items i join hlt_orders o on o.id=i.order_id join hlt_products pr on pr.id=i.product_id
                                            where pr.code='{X['hp']}' and o.account_id <> '{b['aid']}' and (o.created_at >= '{X['t0']}' or o.restocked_at >= '{X['t0']}')""")
                mine = all(x[1] == 'CANCELED' and x[2] != '-' for x in o)
                ok = mine and (s1 == X['s0'] or int(other or 0) > 0)
                return ok, f"주문 {[(x[0], x[1], x[3]) for x in o]} · 재고 되돌린 시각 {'있음' if mine else '없음'} · 재고 처음 {X['s0']} → 지금 {s1}{' (같은 시간에 다른 시험의 이 상품 주문 ' + other + '건 — 내 주문 분은 되돌아옴)' if s1 != X['s0'] else ' (처음과 같음)'}"
            R.step('DB — 주문이 「취소」로 바뀌고(시험 결제 환불) 재고가 처음 값으로 돌아옴', 'DB', d_cancel, need=False)
        else:
            R.skip('(되돌리기) 그 회원이 주문 취소를 신청하고 운영자가 승인함', 'API', '만들어진 소개몰 주문이 없음')
            R.skip('DB — 주문이 「취소」로 바뀌고 재고가 처음 값으로 돌아옴', 'DB', '만들어진 소개몰 주문이 없음')

        if X.get('attr'):
            def d_rev2():
                r = rows(f"select o.state, o.commission, (select coalesce(sum(amount),0) from partner_revenues v where v.order_id=o.id) from partner_orders o where o.link_id='{X['link']}'")
                return bool(r) and r[0][0] == 'CANCELED', f'partner_orders 상태 · 수수료 · 수익 합계 {r}'
            R.step('주문을 취소한 뒤 제휴 주문 · 수익이 어떻게 바뀌는지 — 제휴 주문이 「취소」로 바뀜', 'DB', d_rev2, need=False)
        else:
            R.skip('주문을 취소한 뒤 제휴 주문 · 수익이 어떻게 바뀌는지', 'DB', '제휴 주문 · 수익 행이 처음부터 생기지 않아 바뀔 것이 없음(취소 전후 모두 partner_orders · partner_revenues 0건)')

        if q(f"select count(*) from affiliate_products where code='{PCODE}'") != '0':
            def d_wipe():
                wipe()
                p = rows(f"select status from affiliate_products where code='{PCODE}'"); l = q(f"select count(*) from partner_links where label='{LABEL}'")
                c = q(f"select count(*) from partner_link_clicks where link_id='{X.get('link') or '00000000-0000-0000-0000-000000000000'}'")
                la = q(f"select count(*) from partner_links where label='{LABEL}' and is_active")
                ok = (not p or p == [['STOPPED']]) and la == '0'
                return ok, f"시험 제휴상품 {len(p)}건{' (기록이 걸려 판매 중단으로 둠)' if p else ''} · 시험 링크 {l}건(켜진 것 {la}) · 그 클릭 기록 {c}건(지우지 않는 기록)"
            R.step('(뒷정리) 시험 제휴상품은 지우거나 판매 중단 · 시험 소개링크는 지우거나 끔 — 클릭 · 귀속 기록은 남김(G-190)', 'DB', d_wipe, need=False)
        else:
            R.skip('(뒷정리) 시험 제휴상품과 시험 소개링크를 지움', 'DB', '만들어진 시험 제휴상품이 없음')
    except Exception:
        F.step('되돌리기 중 시험 도구가 멈춤', 'API', False, sq(traceback.format_exc())[-280:])
    finally:
        close(X.get('bctx'), X.get('ictx'), X.get('vctx'))


# ════════════════════════════════════════════════════════════════════
# B6 운영 설정 → 사용자 화면 반영
# ════════════════════════════════════════════════════════════════════
def b6(br, S):
    F = Flow('B6 운영 설정 → 사용자 화면 반영', '운영자 admin@x.com · 방문자(로그인 안 함)'); R = Run(F); X = {}
    KEY, NAME, NEW = 'sns.x', '엑스(X)', f'https://x.com/sogaebank_flow_{TAG}'
    cur = lambda: q(f"select coalesce(value,'') from site_settings where key='{KEY}'")
    V0 = cur()
    def restore():
        if cur() != V0: call('PATCH', '/admin/site-settings', adm(), {'key': KEY, 'value': V0})
    CLEAN.append(restore)
    sns = lambda pg: pg.evaluate("[...document.querySelectorAll('.home-sns [data-sns]')].map(x => [x.tagName, x.dataset.sns, x.getAttribute('href'), x.getAttribute('target'), x.getAttribute('rel')])")
    mine = lambda pg: next((s for s in sns(pg) if s[1] == KEY), None)
    state = lambda s: '없음' if not s else ('「준비 중」(눌리지 않음)' if s[0] == 'SPAN' else f'링크 {s[2]}')

    def ttl():
        m = re.search(r"'/site-settings/public',\s*(\d+)", src_read('site/src/app/page.tsx')); return m.group(1) if m else '확인하지 못함'

    def until(pg, want, limit=200):
        """메인을 다시 열어 그 아이콘이 want 상태가 될 때까지 — (됐는가, 걸린 초, 마지막 상태)"""
        t0 = time.time(); s = None
        while True:
            goto(pg, '/'); s = mine(pg)
            if s and ((s[2] or '') == want): return True, round(time.time() - t0), s
            if time.time() - t0 > limit: return False, round(time.time() - t0), s
            pg.wait_for_timeout(6000)
    try:
        def s_first():
            ctx, g, w, _ = s_open(br); X.update(gctx=ctx, g=g, gw=w)
            goto(g, '/'); a = sns(g); s = mine(g)
            return chk(w, len(a) == 4 and bool(s) and (s[2] or '') == V0, f"아이콘 {len(a)}개 {[x[1][4:] + ('(링크)' if x[0] == 'A' else '(준비 중)') for x in a]} · {NAME} 처음 상태 {state(s)} · 설정 처음 값 「{V0}」")
        R.step('사용자 웹 메인 맨 아래(바닥줄)에 사회관계망 아이콘 4개가 보임 — 엑스(X) 아이콘의 처음 상태를 적어 둠', '화면', s_first)

        def o_change():
            bctx, bo, bw = bo_open(br); X.update(bctx=bctx, bo=bo, bw=bw)
            bo_tab(bo, '메인 운영'); bo.wait_for_timeout(1200); in_main = '사회관계망' in text(bo, '.bo-main')
            tab = bo_tab(bo, '법정 고지'); bo.wait_for_selector('[data-sns-settings]', timeout=25000)
            guide = sq(text(bo, '[data-sns-settings]'))
            inp = bo.locator(f'[data-sns-settings] input[name="{KEY}"]'); inp.fill(NEW); inp.blur()
            X['t_set'] = time.time()
            saved = wait_for(bo, lambda: cur() == NEW, 20)
            wait_for(bo, lambda: '연결됨' in text(bo, f'[data-sns-settings] p:has(input[name="{KEY}"])'), 10)
            row = sq(text(bo, f'[data-sns-settings] p:has(input[name="{KEY}"])'))
            return chk(bw, tab and bool(saved) and '연결됨' in row, f"「메인 운영」 탭에 사회관계망 칸 {'있음' if in_main else '없음'} → 「법정 고지」 탭 「사회관계망 주소」의 {NAME} 칸에 {NEW} 입력 → 「{row}」 · 화면 안내 「저장한 뒤 1분쯤 지나 메인에 반영됩니다」 {'있음' if '1분쯤' in guide else '없음'}")
        if not R.step('운영 화면 — 사회관계망 주소 칸은 「메인 운영」이 아니라 「법정 고지」 탭에 있음. 엑스(X) 주소를 새 주소로 바꿈(칸을 벗어나면 저장) → 「연결됨」', '운영 화면', o_change):
            R.stop('운영 화면에서 설정을 바꾸지 못함')

        def d_change():
            r = rows(f"select value, coalesce((select email from accounts where id=updated_by),'-') from site_settings where key='{KEY}'")
            return r and r[0][0] == NEW, f"site_settings {KEY} = {r[0][0] if r else '-'} · 바꾼 사람 {r[0][1] if r else '-'}"
        R.step('DB — 운영 설정(site_settings sns.x)이 새 주소로 저장됨', 'DB', d_change)

        def a_public():
            st, j = call('GET', '/site-settings/public'); v = (j or {}).get(KEY)
            return st == 200 and v == NEW, f"GET /site-settings/public → {st} · {KEY} = {v} (서버 응답에는 바로 반영)"
        R.step('공개 설정 응답(GET /site-settings/public)에 새 주소가 바로 나옴', 'API', a_public)

        def s_reflect():
            g, w = X['g'], X['gw']
            ok, sec, s = until(g, NEW); sec_all = round(time.time() - X['t_set'])
            return chk(w, ok and s[0] == 'A' and s[3] == '_blank' and 'noopener' in (s[4] or ''), f"저장 뒤 {sec_all}초{'' if ok else '가 지나도'} 메인 바닥줄 {NAME} 아이콘 = {state(s)} · 새 창으로 열림 {yn(bool(s) and s[3] == '_blank', '맞음', '아님')} — 사용자 웹 메인이 이 설정을 기억하는 시간(소스 site/src/app/page.tsx): {ttl()}초")
        R.step('사용자 웹 메인 바닥줄의 엑스(X) 아이콘이 새 주소로 바뀜 — 메인을 다시 열어 가며 반영되기까지 걸린 시간을 잼', '화면', s_reflect)

        def o_back():
            bo, bw = X['bo'], X['bw']
            inp = bo.locator(f'[data-sns-settings] input[name="{KEY}"]'); inp.fill(V0); inp.blur()
            X['t_back'] = time.time()
            saved = wait_for(bo, lambda: cur() == V0, 20); bo.wait_for_timeout(1200)
            row = sq(text(bo, f'[data-sns-settings] p:has(input[name="{KEY}"])'))
            return chk(bw, bool(saved) and (('연결됨' in row) == bool(V0)), f"{NAME} 칸을 처음 값 「{V0}」 으로 되돌림 → 「{row}」")
        R.step('(되돌리기) 운영 화면 「법정 고지」에서 엑스(X) 주소를 처음 값으로 되돌림', '운영 화면', o_back, need=not X.get('bo'))
    except Exception:
        F.step('시험 도구가 멈춤', 'API', False, sq(traceback.format_exc())[-280:])
    try:
        restore()
        def d_back():
            v = cur(); return v == V0, f"site_settings {KEY} = 「{v}」 (처음 값 「{V0}」 과 {'같음' if v == V0 else '다름'})"
        R.step('DB — 운영 설정이 처음 값과 같음', 'DB', d_back, need=False)

        if X.get('g') and X.get('t_set'):
            def s_back():
                g, w = X['g'], X['gw']
                ok, sec, s = until(g, V0); sec_all = round(time.time() - X.get('t_back', time.time()))
                return chk(w, ok and ((s[0] == 'A') == bool(V0)), f"되돌린 뒤 {sec_all}초{'' if ok else '가 지나도'} 메인 바닥줄 {NAME} 아이콘 = {state(s)} · 처음 상태와 {yn(ok, '같음', '다름')}")
            R.step('사용자 웹 메인 바닥줄의 엑스(X) 아이콘이 처음 상태로 돌아옴', '화면', s_back, need=False)
        else:
            R.skip('사용자 웹 메인 바닥줄의 엑스(X) 아이콘이 처음 상태로 돌아옴', '화면', '설정을 바꾸지 못해 되돌릴 것이 없음')
    except Exception:
        F.step('되돌리기 중 시험 도구가 멈춤', 'API', False, sq(traceback.format_exc())[-280:])
    finally:
        close(X.get('gctx'), X.get('bctx'))


def main():
    S = {}
    only = [a.upper() for a in sys.argv[1:]]                  # 예: python3 flow_biz.py B3 B6 — 고른 흐름만(만들 때 쓰는 용도 · 결과 파일은 전부 돌렸을 때만 씀)
    try:
        with sync_playwright() as p:
            br = p.chromium.launch()
            for name, fn in (('B1', b1), ('B2', b2), ('B3', b3), ('B4', b4), ('B5', b5), ('B6', b6)):
                if only and name not in only and not (name == 'B1' and 'B2' in only): continue
                try:
                    fn(br, S)
                except Exception:
                    print('흐름이 멈춤', name, traceback.format_exc(), file=sys.stderr)
            br.close()
    finally:
        for f in CLEAN:
            try: f()
            except Exception as ex: print('뒷정리 실패', ex, file=sys.stderr)
    if only:
        steps = [s for f in FLOWS for s in f['steps']]; bad = [s for s in steps if not s['ok'] and not s.get('skip')]
        print(f"(일부만 실행 — 결과 파일은 쓰지 않음) 통과 {len(steps) - len(bad)} / {len(steps)} · 흐름 {len(FLOWS)}개")
    else:
        finish('biz')


if __name__ == '__main__':
    main()
