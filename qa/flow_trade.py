"""flow 점검 — 「가입 → 사업자 → 매물 → 거래」 축.  (v10.25 · 2026-10-08)

  T1 회원 가입 → 로그인 → 나의공간
  T2 본인인증 → 사업자 등록 → 운영 승인 → 사업자 회원
  T3 매물 등록 → 검수 → 공개 → 목록 · 검색 · 상세
  T4 문의 → 거래 → 확정 → 대금 신고 → 후기
  T5 소개 요청 등록 → 목록 → 상세
  T6 찜 → 나의공간 관심 → 해제
  T7 신고 접수 → 운영 신고 처리
  T8 뒷정리 (만든 매물 · 요청을 내리고 남긴 자료를 셈)

사용:  cd /home/claude/qa && python3 flow_trade.py        결과 flow_trade.json · 마지막 줄 「통과 n / m · 흐름 k개」

규칙
  · 화면으로 할 수 있는 단계는 화면으로(Playwright · chromium · headless). 화면에 단추가 없는 단계만 API 로 하고 단계 이름에 적습니다.
  · 제품 동작 때문에 안 되는 단계는 실패로 남깁니다. 같은 자료로 더 갈 수 있으면 「API 로 이어감」 단계를 따로 두어 뒤 단계를 확인합니다(실패는 그대로 남음).
  · 한 단계가 실패해 더 갈 수 없으면 남은 단계는 건너뜀(skip)과 까닭을 남깁니다.
  · 매번 새 계정(flw_tr_*@t.local · flw_tr2_*@t.local)을 만들어 씁니다. 기존 계정은 운영자 admin@x.com(승인) · 구매 쪽 person@x.com(문의 · 확정 · 대금 신고 · 후기)만 쓰고 그 계정의 정보는 바꾸지 않습니다.
  · 브라우저는 이 PC 안의 주소(localhost · 127.0.0.1)만 부릅니다 — 바깥 주소(다음 우편번호 등)는 막습니다.
"""
import os, sys, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); sys.path.append(os.environ.get('QA', '/home/claude/qa'))   # v10.31 (w6 사본) — 이 폴더의 flow_lib 먼저
from flow_lib import *
from playwright.sync_api import sync_playwright

TAG = uuid.uuid4().hex[:6]
EM, PW, NAME = f'flw_tr_{TAG}@t.local', 'Sgb-flw-1234!', f'흐름거래{TAG}'
COMP, BRN = f'흐름거래상사{TAG}', str(int(time.time() * 1000))[-10:]
BRN_M = f'{BRN[:3]}-{BRN[3:5]}-***{BRN[8:]}'   # v10.31 (w6 · 10/10 시안) — 운영 화면은 사업자번호를 가려서 보임(가운데 가림)
TITLE = f'흐름시험 사무실 인테리어 소개 {TAG}'
BODY = '금천구 사무실 40평 인테리어 업체를 소개해 주시면 소개비를 드립니다. 시공 이력 확인 가능합니다.'
RTITLE = f'흐름시험 공장 지붕 태양광 시공 업체를 찾습니다 {TAG}'
RBODY = '경기 화성 공장 지붕 500kW 규모입니다. 올해 안에 시공할 업체를 소개받고 싶습니다.'
BUYER = 'person@x.com'
S = {}                       # 흐름 사이에 이어받는 값(계정 id · 매물 id · 거래 id …)
WATCH = []                   # 연 화면마다 (이름, 쪽 오류, 실패한 API 응답)


# ── 작은 도구 ────────────────────────────────────────────────────────────
class Run:
    """단계 실행기 — fn() 은 (ok, 자세한 값) 을 돌려줍니다. 꼭 필요한 단계가 실패하면 뒤 단계는 건너뜀으로 남깁니다."""
    def __init__(self, F, dead=None):
        self.F, self.dead = F, dead
    def do(self, name, how, fn, need=True):
        if self.dead:
            self.F.step(name, how, False, f'하지 못함 — {self.dead}', skip=True); return False
        try:
            ok, detail = fn()
        except Exception as ex:
            ok, detail = False, '시험 실행 중 오류: ' + re.sub(r'\s+', ' ', repr(ex))[:230]
        self.F.step(name, how, ok, detail)
        if not ok and need:
            self.dead = f"{len(self.F.d['steps'])}번 단계가 실패해 이어갈 수 없음"
        return bool(ok)
    def skip(self, name, how, why):
        self.F.step(name, how, False, why, skip=True)


def txt(pg, sel='main'):
    """기다리지 않고 지금 화면의 글을 읽습니다(없으면 빈 글)"""
    try:
        l = pg.locator(sel)
        return l.first.inner_text() if l.count() else ''
    except Exception:
        return ''
one = lambda s: re.sub(r'\s+', ' ', s or '').strip()

def until(cond, sec=20, every=0.5):
    """cond() 가 참이 될 때까지 기다립니다. 마지막 값을 돌려줍니다"""
    t0 = time.time(); v = None
    while time.time() - t0 < sec:
        try: v = cond()
        except Exception: v = None
        if v: return v
        time.sleep(every)
    return v

def new_ctx(b, w=1280, h=900):
    c = b.new_context(viewport={'width': w, 'height': h}, user_agent=UA)
    c.set_default_timeout(20000)
    # 이 PC 안의 주소만 — 바깥 주소(다음 우편번호 스크립트 등)로는 요청을 보내지 않습니다
    c.route('**/*', lambda r: r.continue_() if re.match(r'(https?|wss?)://(localhost|127\.0\.0\.1)[:/]', r.request.url) or r.request.url.startswith(('data:', 'blob:', 'about:')) else r.abort())
    return c

def track(pg, label):
    errs, apis = watch(pg); WATCH.append((label, errs, apis))
    pg.on('dialog', lambda d: d.accept())
    return pg

def has_login(ctx):
    return any(c['name'] == 'sgb_at' for c in ctx.cookies())

def open_site(b, email, pw, label):
    """사용자 웹에 로그인(로그인 폼을 실제로 채움)한 쪽"""
    ctx = new_ctx(b); pg = site_login(ctx, email, pw); track(pg, label)
    until(lambda: has_login(ctx), 20)
    return ctx, pg

def member(b):
    """T1 에서 만든 회원의 쪽 — 로그인이 풀렸으면 다시 로그인합니다"""
    if S.get('mctx') and has_login(S['mctx']): return S['mpg']
    if S.get('mctx'):
        pg = S['mpg']; goto(pg, '/login')
        if pg.locator('input[name=email]').count():
            __import__('consent_ok').agree(EM, PW); pg.fill('input[name=email]', EM); pg.fill('input[name=password]', PW); pg.click('form.auth button')
        until(lambda: has_login(S['mctx']), 20); return pg
    S['mctx'], S['mpg'] = open_site(b, EM, PW, '회원'); return S['mpg']

def bo_open(b, label='운영 화면'):
    ctx = new_ctx(b, 1400, 900); pg = bo_login(ctx, 'admin@x.com'); track(pg, label)
    try: pg.wait_for_selector('.bo-head nav button', timeout=30000)
    except Exception: pass
    return ctx, pg

def flush(R, known=()):
    """이 흐름에서 연 화면들의 쪽 오류 · 실패한 API 응답을 한 단계로 남깁니다. known = 앞 단계에 이미 적은 실패(다시 세지 않음)"""
    errs = [f'{l}: {e}' for l, es, _ in WATCH for e in es]
    apis = [f'{l}: {a}' for l, _, as_ in WATCH for a in as_]
    noted = [a for a in apis if any(k in a for k in known)]
    bad = [a for a in apis if a not in noted]
    for _, es, as_ in WATCH: es.clear(); as_.clear()
    d = f'쪽 오류 {len(errs)} · 뜻하지 않은 실패 응답 {len(bad)}' + (f' · 앞 단계에 적은 실패 {len(noted)}건은 빼고 셈' if noted else '') + (f' — {(errs + bad)[:3]}' if errs or bad else '')
    if R.dead and not errs and not bad:
        R.F.step('이 흐름에서 연 화면에 쪽 오류 · 뜻하지 않은 실패 응답이 없음', '화면', True, d + ' (끝까지 가지 못한 흐름 — 연 화면까지만 봄)'); return
    R.F.step('이 흐름에서 연 화면에 쪽 오류 · 뜻하지 않은 실패 응답이 없음', '화면', not errs and not bad, d)

def bo_queue(bo, rid, gw='MNY'):
    """운영 화면 「검수 큐」에서 관 거르개(gw)를 누른 뒤 — (탭 열림, 화면의 건 수, 같은 때 API 의 건 수, 내 건의 차례(없으면 -1), 화면 글)"""
    tab = bo_tab(bo, '검수 큐'); bo.wait_for_timeout(1500)
    names = {gw, q(f"select name from gwans where code='{gw}'")}
    btns = bo.locator('.bo-main button'); hit = False
    for i in range(btns.count()):
        if btns.nth(i).inner_text().strip() in names:
            btns.nth(i).click(); hit = True; break
    bo.wait_for_timeout(2500)
    st, j = call('GET', f'/admin/reviews?gwanCode={gw}', S['adm'])
    lst = j if isinstance(j, list) else ((j or {}).get('items') or [])
    idx = next((i for i, x in enumerate(lst) if x.get('id') == rid), -1)
    cards = bo.locator('.bo-main article.card').count()
    return tab and hit, cards, len(lst), idx, one(txt(bo, '.bo-main'))[-70:]

def bo_review_step(R, b, rid, what, gw='MNY'):
    """검수 큐에서 그 건을 찾아 승인하는 두 단계 + (화면으로 안 되면) API 로 이어가는 단계. 승인됐으면 True"""
    box = {}
    def see():
        box['ctx'], box['bo'] = bo_open(b, '운영 화면(검수 큐)')
        tab, cards, n_api, idx, tail = bo_queue(box['bo'], rid, gw)
        box.update(cards=cards, idx=idx)
        return tab and cards > 0 and 0 <= idx < cards, f'화면의 검수 건 {cards}개 · 같은 때 API(/admin/reviews?gwanCode={gw})는 {n_api}건(내 건은 {idx + 1 if idx >= 0 else "없음"}번째) · 화면 글 「…{tail}」'
    seen = R.do(f'운영자가 운영 화면 「검수 큐」 탭에서 관 「{gw}」를 누르면 방금 올라온 {what} 검수 건이 목록에 보임', '운영 화면', see, need=False)
    done = False
    if seen:
        def approve():
            bo = box['bo']; bo.locator('.bo-main article.card').nth(box['idx']).click(); bo.wait_for_timeout(1200)
            btn = bo.locator('.bo-main button', has_text=re.compile(r'^\s*승인\s*$')); n = btn.count()
            if n: btn.first.click()
            stt = until(lambda: q(f"select status from review_items where id='{rid}'") == 'APPROVED', 15)
            now = q(f"select status from review_items where id='{rid}'")
            return bool(n and stt), f'승인 단추 {n}개 · 누른 뒤 검수 건 상태 {now}'
        done = R.do(f'그 검수 건을 눌러 열고 「승인」을 누름', '운영 화면', approve, need=False)
    elif not R.dead:
        R.skip('그 검수 건을 눌러 열고 「승인」을 누름', '운영 화면', '하지 못함 — 검수 큐 화면에 건이 하나도 보이지 않아 누를 것이 없음(앞 단계)')
    else:
        R.skip('그 검수 건을 눌러 열고 「승인」을 누름', '운영 화면', f'하지 못함 — {R.dead}')
    try: box['ctx'].close()
    except Exception: pass
    if not done and not R.dead:
        def api_ok():
            st, j = call('PATCH', f'/admin/reviews/{rid}', S['adm'], {'decision': 'APPROVED'})
            return st in (200, 201) and (j or {}).get('status') == 'APPROVED', f'PATCH /admin/reviews/{{id}} → {st} {str(j)[:120]}'
        done = R.do(f'(화면에서 승인할 수 없어 API 로 이어감) 운영자 권한으로 그 {what} 검수 건을 승인', 'API', api_ok)
    return done


# ── T1 ───────────────────────────────────────────────────────────────────
def t1(b):
    F = Flow('T1 회원 가입 → 로그인 → 나의공간', f'새 회원 {EM}'); R = Run(F)
    ctx = new_ctx(b); pg = ctx.new_page(); track(pg, '회원'); S['mctx'], S['mpg'] = ctx, pg

    def s1():
        st = goto(pg, '/signup')
        # v10.31 (w1) — 시안 5단계: 1 가입 유형(3개 · 개인 회원 먼저) → 3 담당자 정보(이름 · 이메일 · 비밀번호 · 확인) → 4 약관 동의
        x = pg.evaluate("""()=>({types:[...document.querySelectorAll('.w1-jop[data-jt]')].map(e=>e.getAttribute('data-jt')+(e.classList.contains('on')?'*':'')),
            steps:[...document.querySelectorAll('.w1-js .t b')].map(e=>e.innerText.trim())})""")
        pg.locator('.w1-jop[data-jt=PERSONAL]').click(); pg.locator('.w1-jnav .w1-jb.p').click()
        fields = pg.evaluate("()=>[...document.querySelectorAll('.w1-jp input')].filter(e=>e.type!=='checkbox').map(e=>e.id)")
        S['types'] = x['types']
        return (st == 200 and len(x['types']) == 3 and x['types'][0] == 'PERSONAL*' and len(x['steps']) == 5
                and all(f in fields for f in ['j-nm', 'j-em', 'j-pw', 'j-pw2']),
                f"응답 {st} · 가입 유형 {x['types']} · 단계 {x['steps']} · 담당자 칸 {fields}")
    R.do('사용자 웹 「회원가입」(/signup)을 열면 5단계 · 가입 유형 3가지(개인 회원 먼저) · 담당자 정보(이름 · 이메일 · 비밀번호 · 확인) 칸이 보임', '화면', s1)

    def s2():
        pg.fill('#j-nm', NAME); pg.fill('#j-em', EM); pg.fill('#j-pw', PW); pg.fill('#j-pw2', PW)
        pg.locator('.w1-jnav .w1-jb.p').click(); pg.wait_for_selector('[data-consent]', timeout=10000)
        labs = pg.locator('[data-consent] .w1-ag'); n = labs.count()
        req = sum(1 for i in range(n) if '[필수]' in labs.nth(i).inner_text())
        S['terms_on_signup'] = (n, req)
        pg.locator('[data-consent-all]').check()
        on = pg.locator('[data-consent-term]:checked').count()
        return n >= 1 and req >= 1 and on == n, f'가입 4단계 동의 칸 {n}개(필수 {req}) · 전체 동의 후 켜진 칸 {on}개'
    R.do('가입 4단계에서 필수 약관에 동의함(전체 동의 + 약관마다 체크 칸)', '화면', s2, need=False)

    def s3():
        pg.locator('.w1-jnav .w1-jb.p').click(); pg.locator('.w1-jnav .w1-jb.a').click()
        try: pg.wait_for_url('**/signup/done**', timeout=30000)
        except Exception: pass
        ok = '/signup/done' in pg.url and has_login(ctx) and pg.locator('a[href="/verify"]').count() >= 1
        return ok, f'도착 {pg.url.replace(SITE, "")} · 로그인 쿠키 {"있음" if has_login(ctx) else "없음"} · 오류 글 「{one(txt(pg, ".w1-err"))}」'
    R.do('「개인 회원」으로 담당자 정보(이름 · 이메일 · 비밀번호 영문 · 숫자 · 특수문자 10자 이상)를 채우고 약관 동의 → 「가입 신청하기」 → 가입 완료 화면(/signup/done · 「본인인증 하기」)으로 넘어가고 로그인된 상태', '화면', s3)

    def s4():
        r = rows(f"select a.id, a.name, a.account_type, a.status, (select string_agg(role, ',' order by role) from account_roles where account_id = a.id) from accounts a where a.email = '{EM}'")
        if not r: return False, 'accounts 에 행이 없음'
        S['aid'] = r[0][0]; S['tok'] = login(EM, PW)
        return r[0][1] == NAME and r[0][2] == 'INDIVIDUAL' and r[0][3] == 'ACTIVE' and r[0][4] == 'MEMBER', f'accounts id {r[0][0][:8]}… · 이름 {r[0][1]} · 유형 {r[0][2]} · 상태 {r[0][3]} · 역할 {r[0][4]}'
    R.do('accounts 에 방금 가입한 회원의 행이 생김(이름 · 개인 유형 · 사용 중 · 역할 MEMBER)', 'DB', s4)

    def s5():
        st = goto(pg, '/terms/agree'); labs = pg.locator('main label.fld.row, main label.w1-agr'); n = labs.count(); req = 0   # v10.31 (w1) — 동의 줄 class w1-agr
        for i in range(n):
            if '[필수]' in labs.nth(i).inner_text():
                labs.nth(i).locator('input[type=checkbox]').check(); req += 1
        pg.locator('main button.btn-primary', has_text='동의하고 계속').click()
        msg = until(lambda: one(txt(pg, 'main .ok-note')) or one(txt(pg, 'main .notice.warn')), 20) or ''
        S['req_terms'] = req
        head = one(txt(pg, "main .page-head .hint"))
        # v10.27 (G-188) — 가입 때 이미 모두 동의함 → 머리글 「모두 동의하셨습니다」 · 다시 보내도 오류 없이 「기록되었습니다」(같은 동의는 다시 쓰지 않음)
        return st == 200 and req >= 1 and '기록되었습니다' in msg and '모두 동의하셨습니다' in head, f'약관 {n}개 중 필수 {req}개 체크 → 안내 「{msg[:60]}」 · 화면 머리글 「{head}」'
    R.do('「약관 동의」 화면(/terms/agree — 주소로 직접 엶): 가입 때 이미 동의해 「모두 동의하셨습니다」 · 필수 약관을 체크하고 「동의하고 계속」을 눌러도 오류 없음', '화면', s5, need=False)

    def s6():
        want = q("select count(*) from terms where status='PUBLISHED' and is_required and audience='ALL'"); pub = q("select count(*) from terms where status='PUBLISHED' and not is_notice and audience='ALL'")   # v10.31 (D090) 가입 대상 = 전체 대상 약관      # v10.28 (G-218) — 알림(위탁)은 동의 · 거부를 남기지 않음
        got = q(f"select count(*) from term_agreements a join terms t on t.code=a.term_code and t.version=a.term_version where a.account_id='{S['aid']}' and a.agreed and t.is_required")
        allr = q(f"select count(*) from term_agreements where account_id='{S['aid']}'")
        # v10.27 (G-188) — 가입 때 발행 약관마다 한 줄(동의 · 거부) · 필수는 모두 동의 · 같은 판에 두 줄 없음
        return got == want and allr == pub and int(got) >= 1, f'term_agreements — 필수 동의 {got}행(발행된 필수 약관 {want}개) · 전체 {allr}행(발행 약관 {pub}개)'
    R.do('term_agreements — 가입 때 발행 약관마다 한 줄 · 필수 약관은 모두 「동의」(약관 동의 화면에서 다시 눌러도 줄이 늘지 않음)', 'DB', s6, need=False)

    def s7():
        st = goto(pg, '/my'); cards = pg.locator('[data-my-menu] a').count()      # v10.27 (G-195) — 나의공간: 프로필 · 요약 · 바로가기
        return st == 200 and pg.url.rstrip('/').endswith('/my') and '나의공간' in txt(pg, 'main h1') and cards >= 5, f'응답 {st} · 제목 「{one(txt(pg, "main h1"))}」 · 메뉴 카드 {cards}개 · 안내 「{one(txt(pg, "main .notice-act"))[:50]}」'
    R.do('머리줄 「나의공간」(/my)이 열림 — 로그인 화면으로 보내지 않고 메뉴 카드가 보임', '화면', s7)

    def s8():
        body = txt(pg, 'body')
        return NAME in body, f'/my 화면 글 어디에도 내 이름 「{NAME}」 · 이메일이 없음(메뉴 카드와 「지금 막혀 있는 단계」 안내뿐). 시안의 나의공간(SB-MYP-DSH-010)은 「프로필 · 요약 타일 4 · 메뉴」' if NAME not in body else f'내 이름 「{NAME}」이 보임'
    R.do('나의공간(/my)에 내 이름이 보임', '화면', s8, need=False)

    def s9():
        pg.locator('main a[href="/my/account"]').first.click()
        try: pg.wait_for_url('**/my/account', timeout=20000)
        except Exception: pass
        pg.wait_for_timeout(500)
        v = pg.locator('main input[name=name]').first.input_value() if pg.locator('main input[name=name]').count() else ''
        return v == NAME, f'도착 {pg.url.replace(SITE, "")} · 이름 칸 「{v}」 · 이메일 표시 「{one(txt(pg, "main"))[one(txt(pg, "main")).find("flw"):][:16]}」'
    R.do('나의공간의 「프로필 · 사업자 정보 수정」 카드를 누르면 이름 칸에 내 이름이 들어 있음', '화면', s9, need=False)

    def s10():
        goto(pg, '/my'); n_my = pg.locator('header button, .hd button', has_text='로그아웃').count() + pg.locator('header a, .hd a', has_text='로그아웃').count()
        hd = one(txt(pg, 'header.pc-hd .pc-hr'))   # v10.29 — 공통 머리줄 header.hd → header.pc-hd(오른쪽 .hd-right → .pc-hr)
        goto(pg, '/community')
        btn = until(lambda: pg.locator('button.b2-out').count(), 20)
        if not btn: return False, f'소개광장 머리줄에 「로그아웃」이 나타나지 않음 · /my 머리줄 「{hd}」'
        pg.locator('button.b2-out').first.click()
        out = until(lambda: not has_login(ctx), 20)
        hdr = until(lambda: '로그인' in one(' '.join(pg.locator('.b2-login, .b2-join').all_inner_texts())), 10)
        return bool(out and hdr), f'/my 머리줄의 로그아웃 단추 {n_my}개(머리줄 글 「{hd}」 — 로그인해도 「로그인 · 회원가입」 그대로) → 소개광장 머리줄 「로그아웃」 누름 → 쿠키 {"지워짐" if out else "남음"} · 머리줄 「{one(" ".join(pg.locator(".b2-login, .b2-join").all_inner_texts()))}」'
    R.do('로그아웃 — 나의공간 · 소개장터 머리줄에는 「로그아웃」 단추가 없어 소개광장(/community) 머리줄의 「로그아웃」을 누름 → 로그인 전 모양으로 바뀜', '화면', s10)

    def s11():
        goto(pg, '/my')
        return '/login' in pg.url, f'로그아웃 뒤 /my → {pg.url.replace(SITE, "")}'
    R.do('로그아웃한 뒤 나의공간(/my)을 열면 로그인 화면으로 보냄', '화면', s11, need=False)

    def s12():
        if '/login' not in pg.url: goto(pg, '/login')
        pg.fill('input[name=email]', EM); pg.fill('input[name=password]', 'wrong-password-' + TAG); pg.click('form.auth button')
        msg = until(lambda: one(txt(pg, 'form.auth .form-error')), 20) or ''
        return '올바르지 않습니다' in msg and not has_login(ctx) and '/login' in pg.url, f'안내 「{msg}」 · 로그인 쿠키 {"있음" if has_login(ctx) else "없음"} · 머문 곳 {pg.url.replace(SITE, "")}'
    R.do('로그인 화면(/login)에서 틀린 비밀번호를 넣으면 「이메일 또는 비밀번호가 올바르지 않습니다」 — 로그인되지 않음', '화면', s12, need=False)

    def s13():
        st, j = call('POST', '/auth/login', body={'email': EM, 'password': 'wrong-password-' + TAG})
        return st in (401, 403, 422) and not (j or {}).get('accessToken'), f'POST /auth/login(틀린 비밀번호) → {st} {(j or {}).get("code")} · 토큰 {"나옴" if (j or {}).get("accessToken") else "없음"}'
    R.do('서버도 틀린 비밀번호를 거절함(토큰을 주지 않음)', 'API', s13, need=False)

    def s14():
        if '/login' not in pg.url: goto(pg, '/login')
        __import__('consent_ok').agree(EM, PW); pg.fill('input[name=email]', EM); pg.fill('input[name=password]', PW); pg.click('form.auth button')
        ok = until(lambda: has_login(ctx) and '/login' not in pg.url, 30)
        land = q("select value from site_settings where key='site.landing_after_login'")
        return bool(ok), f'도착 {pg.url.replace(SITE, "")} (운영 설정 site.landing_after_login={land}) · 로그인 쿠키 {"있음" if has_login(ctx) else "없음"}'
    R.do('맞는 비밀번호로 다시 로그인 → 운영이 정한 도착 화면으로 넘어가고 로그인된 상태', '화면', s14)

    def s15():
        st = goto(pg, '/my'); a = pg.url.replace(SITE, '')
        goto(pg, '/my/account'); v = pg.locator('main input[name=name]').first.input_value() if pg.locator('main input[name=name]').count() else ''
        return st == 200 and a.rstrip('/') == '/my' and v == NAME, f'/my 응답 {st}(머문 곳 {a}) · 프로필 화면 이름 칸 「{v}」'
    R.do('다시 로그인한 뒤 나의공간(/my)이 열리고 프로필 화면에 내 이름이 그대로 있음', '화면', s15, need=False)
    flush(R)
    return R


# ── T2 ───────────────────────────────────────────────────────────────────
def t2(b, prev):
    F = Flow('T2 본인인증 → 사업자 등록 → 운영 승인 → 사업자 회원', f'회원 {EM} · 운영자 admin@x.com')
    R = Run(F, None if S.get('aid') and not prev.dead else 'T1 에서 회원 가입 · 로그인이 끝나지 않음')
    pg = member(b) if not R.dead else None

    def s1():
        st = goto(pg, '/verify'); li = pg.locator('ol.steps > li'); a = one(li.nth(0).inner_text()) if li.count() else ''
        return st == 200 and '필요' in a and pg.locator('.verify button.cta-primary').count() == 1, f'1번 칸 「{a[:60]}」 · 「PASS 로 본인인증」 단추 {pg.locator(".verify button.cta-primary").count()}개'
    R.do('「인증」 화면(/verify)에 「1. 본인인증 — 필요」와 「PASS 로 본인인증」 단추가 보임', '화면', s1)

    def s2():
        pg.click('.verify button.cta-primary')
        stub = until(lambda: '연동 준비 중' in txt(pg, '.verify .stub-note') or '완료' in one(txt(pg, 'ol.steps > li:nth-child(1) .step-state')), 20)
        done = until(lambda: '완료' in one(txt(pg, 'ol.steps > li:nth-child(1) .step-state')), 20)
        return bool(done), f'1번 칸 상태 「{one(txt(pg, "ol.steps > li:nth-child(1) .step-state"))}」 · 「{one(txt(pg, "ol.steps > li:nth-child(1) .ok-note"))}」 · 오류 글 「{one(txt(pg, ".verify .form-error"))}」 (개발 환경 — 실제 PASS 가 아닌 시험 응답)'
    R.do('「PASS 로 본인인증」을 누름(개발 환경은 시험 응답) → 1번 칸이 「완료」로 바뀜', '화면', s2)

    def s3():
        r = rows(f"select a.identity_verified_at is not null, coalesce(v.provider,'-'), coalesce(v.result,'-'), coalesce(v.raw::text,'-') from accounts a left join identity_verifications v on v.account_id = a.id where a.id = '{S['aid']}'")
        n = q(f"select count(*) from identity_verifications where account_id='{S['aid']}'")
        return bool(r) and r[0][0] == 't' and n == '1' and r[0][2] == 'SUCCESS', f'accounts.identity_verified_at {"있음" if r and r[0][0] == "t" else "없음"} · identity_verifications {n}행 {r[0][1:] if r else ""}'
    R.do('accounts 에 본인인증 시각이 찍히고 identity_verifications 에 기록 1행(시험 응답 표시)', 'DB', s3)

    def s4():
        st0 = goto(pg, '/biz/register'); h = one(txt(pg, 'main h1'))
        goto(pg, '/verify'); pg.locator('ol.steps a[href="/my/business"]').first.click()
        try: pg.wait_for_url('**/my/business', timeout=20000)
        except Exception: pass
        f = pg.evaluate("()=>[...document.querySelectorAll('main form.auth input[name]')].map(e=>e.name)")
        return pg.url.rstrip('/').endswith('/my/business') and f == ['bizRegNo', 'companyName', 'ceoName'], f'도착 {pg.url.replace(SITE, "")} · 칸 {f} · 참고: /biz/register 는 사업자 등록이 아니라 「{h}」(소개창업 매물 등록) 화면({st0})'
    R.do('인증 화면 2번 칸의 「사업자 정보 등록」을 누르면 「사업자 전환」 화면(/my/business)의 신청 폼이 열림', '화면', s4)

    def s5():
        pg.fill('main form.auth input[name=bizRegNo]', BRN); pg.fill('main form.auth input[name=companyName]', COMP); pg.fill('main form.auth input[name=ceoName]', NAME)
        pg.click('main form.auth button.cta-primary')
        msg = until(lambda: one(txt(pg, 'main .result .ok-note')) or one(txt(pg, 'main form.auth .form-error')), 25) or ''
        return '신청이 접수되었습니다' in msg, f'안내 「{msg[:50]}」 · 「{one(txt(pg, "main .result .stub-note"))[:44]}」 · 사업장 주소는 비워 둠(「주소 검색」이 바깥 서비스(다음 우편번호)를 불러 누르지 않음 · 직접 입력 칸은 읽기 전용)'
    R.do('사업자등록번호 · 상호 · 대표자명을 채우고 「사업자 인증 신청」을 누름 → 「신청이 접수되었습니다」', '화면', s5)

    def s6():
        r = rows(f"select id, biz_reg_no, company_name, ceo_name, verified_at is null, coalesce(nts_status,'-') from businesses where account_id='{S['aid']}'")
        if not r: return False, 'businesses 에 행이 없음'
        S['bid'] = r[0][0]
        rv = rows(f"select status, decision_mode from review_items where target_type='BUSINESS' and target_id='{S['bid']}'")
        return r[0][1] == BRN and r[0][2] == COMP and r[0][4] == 't', f'businesses {r[0][1]} · {r[0][2]} · 대표 {r[0][3]} · 승인 전(verified_at 비어 있음) · 국세청 {r[0][5]} · 검수 건 {rv}'
    R.do('businesses 에 신청한 사업자 행이 생김(번호 · 상호 · 아직 승인 전)', 'DB', s6)

    def s7():
        st, j = call('GET', '/me/summary', S['tok']); roles = ((j or {}).get('principal') or {}).get('roles') or []
        goto(pg, '/my/business'); again = pg.locator('main form.auth input[name=bizRegNo]').count()
        goto(pg, '/verify'); b2 = one(txt(pg, 'ol.steps > li:nth-child(2) .step-state'))
        return 'BIZ_OWNER' not in roles and '완료' not in b2, f'역할 {roles} · 인증 화면 2번 칸 「{b2}」 · 사업자 전환 화면을 다시 열면 {"빈 신청 폼이 다시 보임(「심사 중」 안내 없음)" if again else "신청 폼이 보이지 않음"}'
    R.do('운영 승인 전에는 사업자 회원이 아님(역할 MEMBER 뿐 · 인증 화면 2번 칸이 「완료」가 아님)', '화면', s7, need=False)

    box = {}
    def s8():
        box['ctx'], box['bo'] = bo_open(b, '운영 화면(사업자 인증)'); bo = box['bo']
        tab = bo_tab(bo, '사업자 인증')
        card = until(lambda: bo.locator('.bo-main .card.row', has_text=COMP).count(), 20)
        t = one(bo.locator('.bo-main .card.row', has_text=COMP).first.inner_text()) if card else ''
        return bool(tab and card == 1 and BRN_M in t and BRN not in t), f'(사업자번호는 가려서 {BRN_M}) 탭 열림 {tab} · 승인 대기 {one(txt(bo, ".bo-main h3.sec"))} · 내 신청 줄 「{t[:70]}」'
    R.do('운영자가 운영 화면에 로그인해 「사업자 인증」 탭을 열면 「승인 대기」에 방금 신청한 상호 · 가린 사업자번호(가운데 ***)가 보임', '운영 화면', s8)

    def s9():
        bo = box['bo']; bo.locator('.bo-main .card.row', has_text=COMP).first.locator('button.btn-ok').click()
        gone = until(lambda: q(f"select verified_at is not null from businesses where id='{S['bid']}'") == 't' and bo.locator('.bo-main .card.row', has_text=COMP).count() == 0 and bo.locator('.bo-main table.tbl tbody tr', has_text=COMP).count() == 1, 30)
        row = one(bo.locator('.bo-main table.tbl tbody tr', has_text=COMP).first.inner_text()) if bo.locator('.bo-main table.tbl tbody tr', has_text=COMP).count() else ''
        return bool(gone) and bool(row) and '대기' not in row, f'승인 대기에서 {"사라짐" if gone else "남아 있음"} · 전체 표 「{row}」 · 오류 글 「{one(txt(bo, ".bo-main .form-error"))}」'
    R.do('그 줄의 「승인」을 누름 → 승인 대기에서 사라지고 전체 표에 인증 날짜가 찍힘', '운영 화면', s9, need=False)

    def s10():
        r = rows(f"select verified_at is not null from businesses where id='{S['bid']}'")
        ro = rows(f"select role, coalesce((select email from accounts where id = granted_by), '-') from account_roles where account_id='{S['aid']}' order by role")
        left = q(f"select status from review_items where target_type='BUSINESS' and target_id='{S['bid']}'")
        S['biz_ok'] = bool(r) and r[0][0] == 't' and any(x[0] == 'BIZ_OWNER' for x in ro)
        return S['biz_ok'], f'businesses.verified_at {"있음" if r and r[0][0] == "t" else "없음"} · account_roles {ro} · 참고: 이 사업자의 검수 큐 건(review_items)은 승인 뒤에도 {left or "없음"}'
    R.do('businesses 에 승인 시각이 찍히고 account_roles 에 BIZ_OWNER 가 붙음(승인한 운영자 기록)', 'DB', s10)

    def s11():
        st, j = call('GET', '/me/summary', S['tok']); p = (j or {}).get('principal') or {}
        return st == 200 and 'BIZ_OWNER' in (p.get('roles') or []) and bool(p.get('businessVerifiedAt')), f"GET /me/summary → {st} · 역할 {p.get('roles')} · businessVerifiedAt {str(p.get('businessVerifiedAt'))[:19]} · 막힌 단계 {(j or {}).get('blockedBy')}"
    R.do('그 회원의 로그인 정보(내 요약)에 역할 BIZ_OWNER 와 사업자 인증 시각이 실림 — 다시 로그인하지 않아도 반영', 'API', s11)

    def s12():
        goto(pg, '/verify'); b2 = one(txt(pg, 'ol.steps > li:nth-child(2) .step-state'))
        goto(pg, '/my/business'); h = one(txt(pg, 'main h1')); note = one(txt(pg, 'main .ok-note'))
        goto(pg, '/my'); act = one(txt(pg, 'main .notice-act'))
        return b2 == '완료' and '사업자 인증 완료' in h, f'인증 화면 2번 칸 「{b2}」 · 사업자 정보 화면 「{h}」 「{note[:40]}」 · 나의공간 안내 「{act[:40]}」'
    R.do('회원 화면에 반영 — 인증 화면 2번 칸 「완료」 · 사업자 정보 화면 「사업자 인증 완료」', '화면', s12, need=False)
    try: box['ctx'].close()
    except Exception: pass
    flush(R)
    return R


# ── T3 ───────────────────────────────────────────────────────────────────
def t3(b, prev):
    F = Flow('T3 매물 등록 → 검수 → 공개 → 목록 · 검색 · 상세', f'사업자 회원 {EM} · 운영자 admin@x.com · 로그인하지 않은 방문자')
    R = Run(F, None if S.get('biz_ok') else 'T2 에서 사업자 회원(BIZ_OWNER)이 되지 못함')
    pg = member(b) if not R.dead else None

    def s1():
        # v10.31 (w1) — 시안 「상품/서비스 등록하기」 5구역 폼: 관(select) → 업종(등급으로 묶음) · 등급 자동
        st = goto(pg, '/register'); pg.wait_for_timeout(800)
        gw = pg.evaluate("()=>[...document.querySelectorAll('#f-gwan option')].map(e=>e.innerText.trim()).filter(Boolean)")
        pg.select_option('#f-gwan', 'MNY')
        opts = until(lambda: pg.locator('#f-cat option').count(), 15) or 0
        secs = pg.evaluate("()=>[...document.querySelectorAll('.w1-fsec .fh3')].map(e=>e.innerText.trim())")
        return st == 200 and opts >= 5 and len(secs) == 5, f'관 {gw} · 「소개장터」 고름 → 업종 {opts}개 · 구역 {secs}'
    R.do('「등록」 화면(/register)에서 관 「소개장터」를 고르면 시안 5구역 등록 폼(기본 정보 · 상세 설명 · 소개 조건 · 지역 · 거래 및 운영 정보)이 보임', '화면', s1)

    def s2():
        pg.select_option('#f-cat', label='인테리어 · 시공')
        pg.fill('#f-title', TITLE); pg.fill('#f-intro', '흐름 시험 한줄 소개'); pg.fill('#f-desc', BODY)
        pg.fill('#f-fee', '500000'); pg.select_option('#f-support', index=1); pg.fill('#f-hours', '평일 10:00 ~ 18:00')
        pg.evaluate("""()=>{const set=(el,v)=>{const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d.set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));};
          for (const [s,v] of [['.addr input.addr-zip','06234'],['.addr input.addr-road','서울 강남구 테헤란로 1']]) { const el=document.querySelector(s); el.removeAttribute('readonly'); set(el,v); }}""")
        pg.fill('#f-sales', '8,000만원 내외'); pg.select_option('#f-wish', index=1)
        pg.click('[data-fdone=reg]')
        try: pg.wait_for_url('**/my/listings**', timeout=30000)
        except Exception: pass
        u = pg.url.replace(SITE, '')
        return u.startswith('/my/listings'), f'도착 {u} ({"자동 승인" if "published=1" in u else "검수 요청" if "review=1" in u else "?"}) · 오류 글 「{one(txt(pg, ".w1-err"))}」'
    R.do('업종 「인테리어 · 시공」 · 상품/서비스명 · 한줄 소개 · 상세 설명 · 소개비 500,000원 · 계약 지원 · 문의 시간 · 주소 · 월매출 · 희망조건을 채우고 「등록완료」 → 「내 리스팅」(부담 주체는 업종에 따라 자동 — categories.fee_bearer)', '화면', s2)

    def s3():
        r = rows(f"select id, status, gwan_code, desired_fee, fee_bearer, (select name from categories where id = category_id) from listings where owner_account_id='{S['aid']}' and title='{TITLE}'")
        if len(r) != 1: return False, f'listings 에 내 매물이 {len(r)}행'
        S['lid'] = r[0][0]
        rv = rows(f"select id, status, decision_mode, coalesce(nullif(array_to_string(manual_reasons, ','), ''), '-') from review_items where target_type='LISTING' and target_id='{S['lid']}' order by submitted_at desc limit 1")
        S['lrid'] = rv[0][0] if rv else None; S['lauto'] = r[0][1] == 'PUBLISHED'
        fb = rows("select coalesce(fee_bearer,'SELLER') from categories where gwan_code='MNY' and name='인테리어 · 시공'")   # v10.31 (w1) — 부담 주체는 업종(categories.fee_bearer)에 따라 자동(없으면 SELLER)
        return r[0][2] == 'MNY' and r[0][3] == '500000' and r[0][4] == (fb[0][0] if fb else 'SELLER') and r[0][1] in ('IN_REVIEW', 'PUBLISHED') and bool(rv), f'listings {r[0][0][:8]}… · 상태 {r[0][1]} · {r[0][2]} · {r[0][5]} · 소개비 {r[0][3]} · {r[0][4]} / review_items {rv[0][1:] if rv else "없음"}'
    R.do('listings 에 매물 행이 생기고(소개장터 · 500,000원 · 매도인 부담) review_items 에 검수 건이 생김', 'DB', s3)

    def s4():
        goto(pg, '/my/listings'); row = one(pg.locator('[data-my-listings] .my-lrow', has_text=TITLE).first.inner_text()) if pg.locator('[data-my-listings] .my-lrow', has_text=TITLE).count() else ''
        want = '노출' if S['lauto'] else '검수'
        return want in row, f'내 리스팅의 그 줄 「{row[:80]}」'
    R.do('「내 리스팅」(/my/listings)에 방금 올린 매물과 지금 상태가 보임', '화면', s4, need=False)

    if not R.dead and S.get('lauto'):
        rv_now = rows(f"select status, decision_mode from review_items where id='{S['lrid']}'")
        R.F.step('자동 승인됨 — 자동검수를 통과해 사람 검수 없이 바로 공개(검수 큐에 올 건이 없음)', 'DB', True, f'review_items {rv_now}')
        R.skip('운영자가 운영 화면 「검수 큐」 탭에서 관 「MNY」를 누르면 방금 올라온 매물 검수 건이 목록에 보임', '운영 화면', '해당 없음 — 자동 승인되어 검수 큐에 올 건이 없음')
        R.skip('그 검수 건을 눌러 열고 「승인」을 누름', '운영 화면', '해당 없음 — 자동 승인됨')
    else:
        if not R.dead:
            rv_now = rows(f"select status, decision_mode, coalesce(nullif(array_to_string(manual_reasons, ','), ''), '-') from review_items where id='{S['lrid']}'")
            R.F.step('사람 검수 대상임 — 자동 승인되지 않고 검수 큐로 감(까닭이 기록됨)', 'DB', bool(rv_now) and rv_now[0][0] == 'QUEUED' and rv_now[0][1] == 'MANUAL', f'review_items {rv_now} — FIRST_LISTING = 새 사업자의 첫 등록은 사람이 봄(자동검수 규칙 manual_first_listing)')
        bo_review_step(R, b, S.get('lrid'), '매물')

    def s8():
        r = rows(f"select status, published_at is not null from listings where id='{S['lid']}'")
        rv = rows(f"select status, decision_mode, coalesce((select email from accounts where id = decision_by), '-') from review_items where id='{S['lrid']}'")
        S['pub'] = bool(r) and r[0][0] == 'PUBLISHED'
        return S['pub'] and r[0][1] == 't' and rv[0][0] == 'APPROVED', f'listings 상태 {r[0][0]} · 공개 시각 {"있음" if r[0][1] == "t" else "없음"} / review_items {rv[0]}'
    R.do('listings 가 PUBLISHED(공개 시각 찍힘) · review_items 가 APPROVED', 'DB', s8)

    def s9():
        goto(pg, '/my/listings'); row = pg.locator('[data-my-listings] .my-lrow', has_text=TITLE)
        t = one(row.first.inner_text()) if row.count() else ''; link = row.first.locator(f'a[href="/money/{S["lid"]}"]').count() if row.count() else 0
        return '노출' in t and link == 1, f'내 리스팅의 그 줄 「{t[:70]}」 · 「보기」 링크 {link}개'
    R.do('등록자의 「내 리스팅」에 「노출 중」과 「보기」 링크가 보임', '화면', s9, need=False)

    actx = new_ctx(b) if not R.dead else None
    apg = track(actx.new_page(), '방문자') if actx else None
    S['actx'], S['apg'] = actx, apg

    def s10():
        # v10.31 (w2 시안) — 목록 기본 정렬이 「소개비순」(12개씩)이라 같은 소개비(500,000원) 매물이 많으면(다른 시험이 남긴 E2E · 상세시험 매물 9건) 순서가 정해지지 않아
        #   2쪽으로 밀릴 수 있음 → 「최신」 정렬(?sort=new)로 봄 · 목록은 60초 기억(revalidate 60)이라 90초까지 다시 엶
        def see():
            st = goto(apg, '/money/list?sort=new'); return st == 200 and apg.locator(f'main a[href="/money/{S["lid"]}"]').count() >= 1
        ok = until(see, 90, 5)
        card = one(apg.locator(f'main a[href="/money/{S["lid"]}"]').first.inner_text()) if ok else ''
        return bool(ok) and TITLE in card and ('500,000원' in card or '50만원' in card), f'소개장터 목록(/money/list)의 내 매물 카드 「{card[:90]}」'
    R.do('로그인하지 않은 방문자가 소개장터 목록(/money/list · 최신순)을 열면 그 매물 카드가 보임(제목 · 소개비 500,000원)', '화면', s10, need=False)

    def s11():
        goto(apg, '/money/list'); word = f'인테리어 소개 {TAG}'
        # v10.31 (w1 시안) — 머리줄 검색은 돋보기 단추(.pc-hsch) → 검색 팝업(#spopq)
        # v10.40 (대표 지시 2026-10-14) — 결과는 팝업에서 보고(결과 화면으로 가지 않음) · 결과 줄을 누르면 그 자리(매물 상세)로
        def find():
            goto(apg, '/money/list')
            apg.locator('header .pc-hsch').first.click(); apg.wait_for_selector('#spopq', timeout=10000)
            apg.fill('#spopq', word); apg.wait_for_timeout(1500)
            row = apg.locator('.pc-spop #spopbd button.it', has_text=TITLE)
            return row.first if row.count() else None
        row = until(find, 60, 5)
        if row: row.click(); apg.wait_for_url(f'**/money/{S["lid"]}', timeout=15000)
        ok = bool(row) and apg.url.endswith(f'/money/{S["lid"]}') and TITLE in txt(apg, 'main')
        return ok, f'머리줄 검색 칸에 「{word}」 → 팝업 결과에 내 매물 {"있음" if row else "없음"} → 누름 → {urllib.parse.unquote(apg.url.replace(SITE, ""))}'
    R.do('머리줄 검색 칸에 제목의 낱말을 넣으면 검색 팝업 결과에 그 매물이 보이고 · 누르면 그 매물 상세로(v10.40)', '화면', s11, need=False)

    def s12():
        goto(apg, '/money/list'); a = apg.locator(f'main a[href="/money/{S["lid"]}"]')
        if a.count(): a.first.click()
        try: apg.wait_for_url(f'**/money/{S["lid"]}', timeout=20000)
        except Exception: goto(apg, f'/money/{S["lid"]}')
        apg.wait_for_timeout(600)
        x = apg.evaluate("""()=>{const t=s=>{const e=document.querySelector(s); return e?(e.innerText||'').replace(/\\s+/g,' ').trim():''};
            return {title:t('.gw-dtt'), fee:t('.gw-dtprice'), prof:t('.gw-dtprof'), desc:t('.gw-dsec .gw-body') || t('.gw-dsec'), bar:[...document.querySelectorAll('.gw-abar > a, .gw-abar > button')].map(e=>(e.innerText||'').trim())}}""")   # v10.29 이후 상세 틀(gw-dt*)
        st = apg.evaluate("fetch(location.href).then(r=>r.status)")
        return st == 200 and x['title'] == TITLE and ('500,000원' in x['fee'] or '50만원' in x['fee']) and COMP in x['prof'] and '사업자 인증' in x['prof'] and '인테리어 업체를 소개해' in x['desc'] and len(x['bar']) == 5, f"응답 {st} · 제목 「{x['title'][:30]}」 · {x['fee']} · 등록자 「{x['prof'][:40]}」 · 맨 아래 줄 {x['bar']}"
    R.do('목록의 카드를 누르면 매물 상세(/money/{id})가 열림 — 제목 · 소개비 · 등록자 상호와 「사업자 인증」 · 본문 · 맨 아래 줄 단추 5개', '화면', s12, need=False)
    flush(R)
    return R


# ── T4 ───────────────────────────────────────────────────────────────────
def t4(b):
    F = Flow('T4 문의 → 거래 → 확정 → 대금 신고 → 후기', f'구매 쪽 사업자 회원 {BUYER} · 판매 쪽(매물 등록자) {EM}')
    R = Run(F, None if S.get('pub') else 'T3 에서 매물이 공개되지 못함')
    box = {}
    if not R.dead:
        S['pid'] = q(f"select id from accounts where email='{BUYER}'"); S['pname'] = q(f"select name from accounts where email='{BUYER}'")
        box['bctx'], box['pb'] = open_site(b, BUYER, None, '구매자'); box['ps'] = member(b)
    pb, ps = box.get('pb'), box.get('ps'); lid = S.get('lid')

    def s1():
        goto(pb, f'/money/{lid}'); pb.wait_for_timeout(500)
        go = one(txt(pb, '.gw-abar .gw-go'))
        if '1:1 문의 시작' not in go: return False, f'맨 아래 줄의 문의 단추가 「{go}」 — 구매 쪽 계정이 문의할 수 없는 상태'
        pb.locator('.gw-abar .gw-go').click()
        try: pb.wait_for_url(f'**/chat/{lid}', timeout=30000)
        except Exception: pass
        return pb.url.rstrip('/').endswith(f'/chat/{lid}') and TITLE in txt(pb, 'main'), f'단추 「{go}」 → {pb.url.replace(SITE, "")[:20]}… · 옆 칸 「{one(txt(pb, ".chat-item h2"))[:30]}」 · 대화 창 「{one(txt(pb, ".chat-log"))[:20]}」'
    R.do(f'구매 쪽 사업자 회원({BUYER})이 로그인해 그 매물 상세의 「1:1 문의 시작」을 누르면 문의방(/chat/{{매물 id}})이 열림', '화면', s1)

    MSG = f'견적 문의드립니다. 이번 달 착공 가능할까요? ({TAG})'
    def s2():
        pb.fill('form.chat-input textarea', MSG); pb.click('form.chat-input button')
        ok = until(lambda: MSG in txt(pb, '.chat-log'), 25)
        return bool(ok), f'대화 창 「{one(txt(pb, ".chat-log"))[:70]}」 · 오류 글 「{one(txt(pb, ".chat .form-error"))}」'
    R.do('문의 글을 적고 「보내기」를 누름 → 대화 창에 보낸 글이 보임', '화면', s2)

    def s3():
        r = rows(f"select id, status, counterpart_id from conversations where target_type='LISTING' and target_id='{lid}' and initiator_id='{S['pid']}'")
        if len(r) != 1: return False, f'conversations {len(r)}행'
        S['cid'] = r[0][0]; m = rows(f"select body, masked from messages where conversation_id='{S['cid']}'")
        return r[0][1] == 'OPEN' and r[0][2] == S['aid'] and len(m) == 1 and m[0][0] == MSG, f'conversations 상태 {r[0][1]} · 상대 = 매물 등록자 {r[0][2] == S["aid"]} · messages {len(m)}행 「{m[0][0][:30] if m else ""}」'
    R.do('conversations 에 그 매물의 대화(문의한 사람 → 등록자)가 생기고 messages 에 글 1행', 'DB', s3)

    def s4():
        goto(ps, f'/chat/{lid}'); log = one(txt(ps, '.chat-log')); btns = [t for t in ps.locator('main button, main a').all_inner_texts() if '거래' in t]
        st, j = call('POST', f"/conversations/{S['cid']}/deal", S['tok']); S['did'] = (j or {}).get('dealId') or (j or {}).get('id')
        return st in (200, 201) and bool(S['did']), f'POST /conversations/{{id}}/deal(판매 쪽 사업자 회원 토큰) → {st} · 거래 id {str(S["did"])[:8]}… · 참고: 등록자가 문의방(/chat/{{매물 id}})을 열면 대화 창 「{log[:16]}」(받은 문의 {"보임" if MSG in log else "보이지 않음"}) · 그 화면의 거래 단추 {len(btns)}개'
    R.do('거래 생성 — 사용자 웹(문의방 · 소개 내역)에 「거래 만들기」 단추가 없어 API 로 함(판매 쪽 사업자 회원 권한)', 'API', s4)

    def s5():
        d = rows(f"select status, buyer_account_id, seller_account_id, listing_id, coalesce(introducer_account_id::text,'-'), coalesce(attributed_code,'-') from deals where id='{S['did']}'")
        cv = q(f"select status from conversations where id='{S['cid']}'")
        return bool(d) and d[0][0] == 'INQUIRY' and d[0][1] == S['pid'] and d[0][2] == S['aid'] and d[0][3] == lid and cv == 'DEAL_CREATED', f'deals 상태 {d[0][0]} · 구매 = {BUYER} {d[0][1] == S["pid"]} · 판매 = 등록자 {d[0][2] == S["aid"]} · 소개자 {"없음" if d[0][4] == "-" else d[0][4][:8]} · 대화 상태 {cv}'
    R.do('deals 에 거래 행이 생김(문의 중 · 구매 = 문의한 사람 · 판매 = 매물 등록자) · 대화는 「거래 생성됨」', 'DB', s5)

    def s6():
        st, j = call('POST', f"/deals/{S['did']}/fee", S['tok'], {'amount': 500000}); n = q(f"select count(*) from fee_agreements where deal_id='{S['did']}'")
        return st == 422 and n == '0', f'POST /deals/{{id}}/fee → {st} {(j or {}).get("code")} 「{(j or {}).get("message", "")[:44]}」 · fee_agreements {n}행'
    R.do('소개비 제안은 정책상 꺼져 있어 거절됨(422 가 정상) — 소개비 약정 행이 생기지 않음', 'API', s6, need=False)

    def confirm(pg, who, want):
        def f():
            goto(pg, '/my/deals'); link = pg.locator(f'main a[href="/deal/{S["did"]}/confirm"]').count()
            st = goto(pg, f"/deal/{S['did']}/confirm"); h = one(txt(pg, 'main h1'))
            pg.locator('main button.cta-primary', has_text='거래 성사 확인').click()
            msg = until(lambda: one(txt(pg, 'main p.notice[role=status]')) or one(txt(pg, 'main .form-error')), 25) or ''
            # v10.31 — 누른 뒤 화면을 새로 그려도(확인 n/2 · 단추 빠짐) 결과 글이 남아 있어야 함(전: 새로 그리면 글이 사라져 시험이 때에 따라 놓침 — 화면 결함으로 고침)
            pg.wait_for_timeout(2500); cn = one(txt(pg, 'main .w1-cfm .cn')); still = one(txt(pg, 'main p.notice[role=status]')); btn = pg.locator('main button.cta-primary', has_text='거래 성사 확인').count()
            n = '2 / 2' if '확정' in want else '1 / 2'
            return st == 200 and want in msg and want in still and n in cn and btn == 0, f'「소개 내역」에 확정 화면으로 가는 링크 {link}개 → 주소로 직접 엶({h}) · 「거래 성사 확인」 누름(확인 창 수락) → 「{msg}」 · 다시 그린 뒤 「{cn}」 · 결과 글 {"남음" if want in still else "사라짐"} · 단추 {btn}개'
        return f
    R.do('구매 쪽이 「성사 확정」 화면(/deal/{id}/confirm)에서 「거래 성사 확인」을 누름 → 「상대방 확인을 기다립니다」', '화면', confirm(pb, '구매', '상대방 확인을 기다립니다'))

    def s8():
        c = rows(f"select party, source from deal_confirmations where deal_id='{S['did']}' order by party"); stt = q(f"select status from deals where id='{S['did']}'")
        return c == [['BUYER', 'MANUAL']] and stt == 'INQUIRY', f'deal_confirmations {c} · deals 상태 {stt}(한쪽만 확인 — 아직 확정 아님)'
    R.do('deal_confirmations 에 구매 쪽 확인 1행 — 거래는 아직 확정 전', 'DB', s8)

    R.do('판매 쪽(매물 등록자)이 같은 화면에서 「거래 성사 확인」을 누름 → 「양측이 확인해 거래가 확정되었습니다」', '화면', confirm(ps, '판매', '거래가 확정되었습니다'))

    def s10():
        d = rows(f"select status, confirmed_at is not null, coalesce(confirm_mode,'-') from deals where id='{S['did']}'"); n = q(f"select count(*) from deal_confirmations where deal_id='{S['did']}'")
        S['confirmed'] = bool(d) and d[0][0] == 'CONFIRMED'
        return S['confirmed'] and d[0][1] == 't' and n == '2', f'deals 상태 {d[0][0]} · 확정 시각 {"있음" if d[0][1] == "t" else "없음"} · 방식 {d[0][2]} · 확인 {n}행'
    R.do('deals 가 CONFIRMED(확정 시각 · 양쪽 확인 방식) · 확인 2행', 'DB', s10)

    def s11():
        # v10.31 (w3 시안) — 소개 내역은 표(tr[data-deal-row])
        goto(ps, '/my/deals'); a = one(txt(ps, 'main table')); goto(pb, '/my/deals'); bfirst = one(pb.locator('tr[data-deal-row]').first.inner_text()) if pb.locator('tr[data-deal-row]').count() else ''
        acts = ps.evaluate("()=>[...document.querySelectorAll('tr[data-deal-row] a')].map(e=>e.innerText.trim()+'→'+e.getAttribute('href'))")
        nb = pb.locator('tr[data-deal-row]', has_text='성사 확정').count()
        return '성사 확정' in a and nb >= 1, f'판매 쪽 소개 내역 「{a[:40]}」 · 구매 쪽 맨 위 줄 「{bfirst[:40]}」(성사 확정 {nb}줄) · 판매 쪽 그 줄의 링크 {acts} (대금 신고 · 후기 화면으로 가는 링크는 없음)'
    R.do('양쪽의 「소개 내역」(/my/deals)에 그 거래가 「성사 확정」으로 보임', '화면', s11, need=False)

    def s12():
        st = goto(pb, f"/deal/{S['did']}/payment")
        pb.select_option('main form.auth select[name=method]', 'BANK_TRANSFER'); pb.fill('main form.auth textarea[name=memo]', f'흐름 시험 {TAG}')
        pb.click('main form.auth button.cta-primary')
        msg = until(lambda: one(txt(pb, 'main .result .ok-note')) or one(txt(pb, 'main form.auth .form-error')), 25) or ''
        return st == 200 and '신고되었습니다' in msg, f'지급 방식 「계좌 이체」 · 메모 입력 → 「지급 신고」 누름 → 「{msg}」 (금액 · 계좌 칸은 없음 — 플랫폼이 대금을 만지지 않음)'
    R.do('구매 쪽이 「대금 지급 신고」 화면(/deal/{id}/payment — 소개 내역에 링크가 없어 주소로 직접 엶)에서 지급 방식 · 메모를 넣고 「지급 신고」를 누름', '화면', s12)

    def s13():
        r = rows(f"select method, coalesce(memo,''), reported_by from deal_payment_records where deal_id='{S['did']}'"); stt = q(f"select status from deals where id='{S['did']}'")
        return len(r) == 1 and r[0][0] == 'BANK_TRANSFER' and TAG in r[0][1] and r[0][2] == S['pid'] and stt == 'CONFIRMED', f'deal_payment_records {len(r)}행 {r[0][:2] if r else ""} · 신고한 사람 = 구매 쪽 {bool(r) and r[0][2] == S["pid"]} · deals 상태 {stt}(확정 그대로)'
    R.do('deal_payment_records 에 지급 신고 1행(방식 · 메모 · 신고한 사람) — 금액 · 계좌는 저장하지 않음', 'DB', s13)

    def s14():
        st = goto(pb, f"/deal/{S['did']}/review")
        pb.locator('main .stars button').nth(3).click(); on = pb.locator('main .stars button.on').count()
        pb.fill('main form.auth textarea[name=body]', f'소통이 빠르고 조건에 맞는 곳을 소개받았습니다. 흐름 시험 {TAG}')
        pb.click('main form.auth button.cta-primary')
        try: pb.wait_for_url('**/my/deals', timeout=30000)
        except Exception: pass
        return st == 200 and on == 4 and pb.url.rstrip('/').endswith('/my/deals'), f'별 {on}개 · 내용 입력 → 「후기 등록」 누름 → {pb.url.replace(SITE, "")[:30]} · 오류 글 「{one(txt(pb, "main form.auth .form-error"))}」'
    R.do('구매 쪽이 「후기 작성」 화면(/deal/{id}/review — 주소로 직접 엶)에서 별 4개 · 내용을 넣고 「후기 등록」을 누름 → 「소개 내역」으로 돌아옴', '화면', s14)

    def s15():
        r = rows(f"select author_id, target_id, rating, coalesce(body,'-') from deal_reviews where deal_id='{S['did']}'")
        return len(r) == 1 and r[0][0] == S['pid'] and r[0][1] == S['aid'] and r[0][2] == '4' and TAG in r[0][3], f'deal_reviews {len(r)}행 · 쓴 사람 = 구매 쪽 {bool(r) and r[0][0] == S["pid"]} · 대상 = 매물 등록자 {bool(r) and r[0][1] == S["aid"]} · 평점 {r[0][2] if r else ""}'
    R.do('deal_reviews 에 후기 1행(쓴 사람 = 구매 쪽 · 대상 = 매물 등록자 · 평점 4)', 'DB', s15)

    def s16():
        apg = S.get('apg') or track(new_ctx(b).new_page(), '방문자'); mask = ([*(S['pname'] or '회')][0]) + '○○'
        def see():
            goto(apg, f'/money/{lid}'); apg.wait_for_timeout(400)
            return apg.locator('.gw-revs .gw-rv2').count() >= 1
        ok = until(see, 40, 4)
        head = one(txt(apg, '.gw-dgrid h4')); rev = one(apg.locator('.gw-revs .gw-rv2').first.inner_text()) if ok else ''
        return bool(ok) and '1' in head and '4' in head and mask in rev and TAG in rev and (S['pname'] or '') not in rev.replace(mask, ''), f'상세의 후기 머리 「{head}」 · 「{rev[:70]}」(작성자는 첫 글자만 「{mask}」)'
    R.do('로그인하지 않은 방문자가 그 매물 상세를 열면 「소개자 후기 1 · 평균 4」와 방금 쓴 후기가 보임(작성자 이름은 첫 글자만)', '화면', s16, need=False)
    flush(R)
    try: box['bctx'].close()
    except Exception: pass
    return R


# ── T5 ───────────────────────────────────────────────────────────────────
def t5(b):
    F = Flow('T5 소개 요청 등록 → 목록 → 상세', f'회원 {EM}(본인인증 완료) · 운영자 admin@x.com')
    R = Run(F, None if S.get('aid') and q(f"select identity_verified_at is not null from accounts where id='{S.get('aid')}'") == 't' else 'T1 · T2 에서 가입 · 본인인증이 끝나지 않음')
    pg = member(b) if not R.dead else None

    def s1():
        # v10.31 (w1) — 시안 소개받기 목록의 3단추 「소개받고 싶어요」 → 「소개받기 등록하기」 4구역 폼
        st = goto(pg, '/request'); pg.locator('.gw-tabs a', has_text='소개받고 싶어요').first.click()
        try: pg.wait_for_url('**/request/new', timeout=20000)
        except Exception: pass
        secs = pg.evaluate("()=>[...document.querySelectorAll('.w1-fsec .fh3')].map(e=>e.innerText.trim())")
        return st == 200 and pg.url.rstrip('/').endswith('/request/new') and len(secs) == 4, f'목록 응답 {st} → 「소개받고 싶어요」 누름 → {pg.url.replace(SITE, "")} · 구역 {secs}'
    R.do('「소개받기」 목록(/request)의 「소개받고 싶어요」를 누르면 등록 폼(/request/new)이 열림', '화면', s1)

    def s2():
        # v10.31 — 등록 폼이 아직 수화(hydration)되기 전에 칸을 채우고 누르면 React 가 나중에 값을 처음으로 되돌리거나 누름을 늦게 되살립니다
        #   (23:21 회차 — 누른 지 27초 뒤에 요청이 생겨 25초 기다림을 넘김). 단추에 React 처리기가 붙은 뒤에 채웁니다
        try: pg.wait_for_function("()=>{const b=document.querySelector('[data-fdone=reqn]'); return !!b && Object.keys(b).some(k=>k.startsWith('__reactProps'))}", timeout=30000)
        except Exception: pass
        pg.select_option('#f-gwan', 'MNY'); pg.select_option('#f-cat', index=1)
        pg.fill('#f-title', RTITLE); pg.fill('#f-desc', RBODY); pg.fill('#f-fee', '300000'); pg.fill('#f-hours', '평일 10:00 ~ 18:00')
        pg.evaluate("""()=>{const set=(el,v)=>{const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d.set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));};
          for (const [s,v] of [['.addr input.addr-zip','06234'],['.addr input.addr-road','서울 강남구 테헤란로 1']]) { const el=document.querySelector(s); el.removeAttribute('readonly'); set(el,v); }}""")
        pg.wait_for_timeout(800); warn = one(' '.join(pg.locator('.w1-fsec .w1-jc').all_inner_texts()))
        pg.click('[data-fdone=reqn]')
        S['rqid'] = until(lambda: q(f"select id from requests where owner_account_id='{S['aid']}' and title='{RTITLE}'"), 40)
        pg.wait_for_timeout(2500)
        return bool(S['rqid']), f'관 · 업종 · 제목 · 내용 · 예상 소개비 · 문의 시간 · 주소 입력(제한업종 안내 「{warn[:20]}」) → 「등록완료」 → 도착 {pg.url.replace(SITE, "")[:22]}… · 오류 글 「{one(txt(pg, ".w1-err"))[:40]}」'
    R.do('소개받기 등록 폼의 필수 칸(관 · 업종 · 제목 · 상세 내용 · 예상 소개비 · 문의 가능 시간 · 희망 지역 주소)을 채우고 「등록완료」를 누름', '화면', s2)

    def s3():
        r = rows(f"select status, gwan_code, coalesce(category_id::text,'-'), coalesce(offered_fee::text,'-') from requests where id='{S['rqid']}'")
        rv = rows(f"select id, status, decision_mode, coalesce(nullif(array_to_string(manual_reasons, ','), ''), '-') from review_items where target_type='REQUEST' and target_id='{S['rqid']}'")
        S['rrid'] = rv[0][0] if rv else None; S['rauto'] = bool(r) and r[0][0] == 'PUBLISHED'
        return bool(r) and r[0][1] == 'MNY' and r[0][0] in ('IN_REVIEW', 'PUBLISHED') and bool(rv), f'requests 상태 {r[0][0]} · {r[0][1]} · 업종 {"없음" if r[0][2] == "-" else r[0][2][:8]} · 제시 소개비 {"없음" if r[0][3] == "-" else r[0][3]} / review_items {rv[0][1:] if rv else "없음"}'
    R.do('requests 에 요청 행이 생기고 review_items 에 검수 건이 생김', 'DB', s3)

    def s4():
        u = pg.url.replace(SITE, ''); st = pg.evaluate("fetch(location.href).then(r=>r.status)"); body = one(txt(pg, 'main'))
        ok = st == 200 and '없는 주소' not in body
        return ok, f'「등록하기」 뒤 도착한 화면 {u[:16]}… 응답 {st} · 화면 글 「{body[:40]}」' + ('' if ok else ' — 폼이 방금 만든 요청의 상세로 보내는데, 상세는 승인(공개)된 요청만 보여 줘 검수 중인 요청은 「없는 주소」가 됨')
    R.do('등록 직후 도착한 화면이 정상임(접수 안내 또는 요청 상세가 보임)', '화면', s4, need=False)

    if not R.dead and S.get('rauto'):
        R.F.step('자동 승인됨 — 사람 검수 없이 바로 공개', 'DB', True, '')
        R.skip('운영자가 운영 화면 「검수 큐」 탭에서 관 「MNY」를 누르면 방금 올라온 요청 검수 건이 목록에 보임', '운영 화면', '해당 없음 — 자동 승인됨')
        R.skip('그 검수 건을 눌러 열고 「승인」을 누름', '운영 화면', '해당 없음 — 자동 승인됨')
    else:
        bo_review_step(R, b, S.get('rrid'), '요청')

    def s8():
        stt = q(f"select status from requests where id='{S['rqid']}'"); rv = q(f"select status from review_items where id='{S['rrid']}'")
        S['rpub'] = stt == 'PUBLISHED'
        return S['rpub'] and rv == 'APPROVED', f'requests 상태 {stt} · review_items {rv}'
    R.do('requests 가 PUBLISHED · review_items 가 APPROVED', 'DB', s8)

    def s9():
        def see():
            st = goto(pg, '/request'); return st == 200 and pg.locator(f'main a[href="/request/{S["rqid"]}"]').count() >= 1
        ok = until(see, 40, 4); card = one(pg.locator(f'main a[href="/request/{S["rqid"]}"]').first.inner_text()) if ok else ''
        return bool(ok) and RTITLE in card, f'소개받기 목록의 내 요청 카드 「{card[:70]}」'
    R.do('「소개받기」 목록(/request)에 그 요청이 보임', '화면', s9, need=False)

    def s10():
        a = pg.locator(f'main a[href="/request/{S["rqid"]}"]')
        if a.count(): a.first.click()
        try: pg.wait_for_url(f'**/request/{S["rqid"]}', timeout=20000)
        except Exception: goto(pg, f'/request/{S["rqid"]}')
        ok = until(lambda: RTITLE in txt(pg, 'main h1'), 20, 2)
        # v10.31 (w1 시안 요청 상세) — 본문은 첫 판(.w1-panel) 안 · 등록 시각은 「등록 N시간 전」 줄(p.w1-nt3) · 옆 칸은 제시 소개비(.w1-bigfee)
        when = pg.evaluate("()=>{const p=[...document.querySelectorAll('main p.w1-nt3')].find(e=>/^등록 /.test(e.innerText.trim())); if(p) return p.innerText.trim().slice(3); const dt=[...document.querySelectorAll('dt')].find(e=>e.innerText.trim()==='등록'); return dt&&dt.nextElementSibling?dt.nextElementSibling.innerText.trim():''}")
        body_ok = '500kW' in txt(pg, 'main .w1-panel') or '500kW' in txt(pg, 'main .detail-body')
        return bool(ok) and body_ok and bool(when), f'제목 「{one(txt(pg, "main h1"))[:34]}」 · 본문 {"보임" if body_ok else "없음"} · 등록 「{when}」 · 옆 칸 「{one(txt(pg, "main .w1-bigfee")) or one(txt(pg, "main .detail-side"))[:24]}」'
    R.do('목록의 카드를 누르면 요청 상세(/request/{id})가 열림 — 제목 · 본문 · 등록 시각', '화면', s10, need=False)
    flush(R)
    return R


# ── T6 · T7 ──────────────────────────────────────────────────────────────
def t6(b):
    F = Flow('T6 찜 → 나의공간 관심 → 해제', '새 개인 회원(둘째 계정 flw_tr2_*) — 매물 등록자가 아닌 사람')
    R = Run(F, None if S.get('pub') else 'T3 에서 매물이 공개되지 못함'); lid = S.get('lid'); box = {}

    def s1():
        em2, pw2, tok2, id2 = signup('flw_tr2', f'흐름관심{TAG}'); S.update(em2=em2, pw2=pw2, id2=id2)
        if not id2: return False, '둘째 계정을 만들지 못함'
        box['ctx'], box['pg'] = open_site(b, em2, pw2, '둘째 회원'); S['c2'], S['p2'] = box['ctx'], box['pg']
        F.d['who'] = f'새 개인 회원 {em2} — 매물 등록자가 아닌 사람'
        return has_login(box['ctx']), f'가입(API) {em2} · 로그인 화면에서 로그인 → 쿠키 {"있음" if has_login(box["ctx"]) else "없음"}'
    R.do('(준비) 관심을 담을 둘째 회원을 새로 만들고(가입은 API) 사용자 웹 로그인 화면에서 로그인', 'API', s1)

    BAR = '.gw-abar > a, .gw-abar > button'      # v10.29 이후 상세 맨 아래 줄
    bar0 = lambda pg: one(pg.locator(BAR).nth(0).inner_text()) if pg.locator(BAR).count() else ''
    likes = lambda pg: (re.search(r'관심 (\d+)', one(txt(pg, '.gw-dtmeta'))) or [None, '-1'])[1]

    def s2():
        pg = box['pg']; goto(pg, f'/money/{lid}'); pg.wait_for_timeout(500); a, n0 = bar0(pg), likes(pg); S['like0'] = q(f"select like_count from listings where id='{lid}'")
        pg.locator(BAR).nth(0).click()
        ok = until(lambda: '관심 담김' in bar0(pg), 20); pg.wait_for_timeout(800)
        return bool(ok) and '관심 담기' in a and int(likes(pg)) == int(n0) + 1, f'「{a}」 누름 → 「{bar0(pg)}」 · 화면의 관심 수 {n0} → {likes(pg)} · 안내 「{one(txt(pg, ".gw-barmsg"))}」'
    R.do('매물 상세 맨 아래 줄의 「♡ 관심 담기」를 누름 → 「♥ 관심 담김」으로 바뀌고 관심 수가 1 늘어남', '화면', s2)

    def s3():
        r = rows(f"select target_type, target_id from favorites where account_id='{S['id2']}'"); lc = q(f"select like_count from listings where id='{lid}'")
        return r == [['LISTING', lid]] and int(lc) == int(S['like0']) + 1, f'favorites {len(r)}행(그 매물 {bool(r) and r[0][1] == lid}) · listings.like_count {S["like0"]} → {lc}'
    R.do('favorites 에 그 회원 · 그 매물 1행 · 매물의 관심 수(like_count) +1', 'DB', s3)

    def s4():
        pg = box['pg']; goto(pg, '/my'); menu = pg.locator('a[href="/my/likes"]').count()
        st = goto(pg, '/my/likes'); card = pg.locator(f'main a[href="/money/{lid}"]')
        # v10.31 (나의공간 관심 목록 — 시안 표: 제목 · 번호 칸 + 「보기」 · 「1:1 문의 ›」 단추) — 카드 대신 그 매물로 가는 「보기」가 있는 줄의 글자를 봄
        row = pg.locator(f'main tr:has(a[href="/money/{lid}"])')
        t = one(row.first.inner_text()) if row.count() else (one(card.first.inner_text()) if card.count() else '')
        return st == 200 and TITLE in t, f'나의공간(/my)에 「관심 목록」으로 가는 메뉴 {menu}개 → 주소(/my/likes)로 엶 · 「{one(txt(pg, "main h1"))}」 카드 「{t[:60]}」'
    R.do('나의공간의 「관심 목록」(/my/likes)에 그 매물 카드가 보임', '화면', s4, need=False)

    def s5():
        pg = box['pg']; card = pg.locator(f'main a[href="/money/{lid}"]')
        if card.count(): card.first.click()
        try: pg.wait_for_url(f'**/money/{lid}', timeout=20000)
        except Exception: goto(pg, f'/money/{lid}')
        kept = until(lambda: '관심 담김' in bar0(pg), 15); a = bar0(pg)
        pg.locator(BAR).nth(0).click()
        ok = until(lambda: '관심 담기' in bar0(pg), 20); pg.wait_for_timeout(800)
        return bool(kept and ok), f'관심 목록의 카드를 눌러 상세로 → 「{a}」(담긴 채) → 다시 누름 → 「{bar0(pg)}」 · 화면의 관심 수 {likes(pg)}'
    R.do('관심 목록의 카드를 눌러 상세로 가서 「♥ 관심 담김」을 다시 누름(해제) → 「♡ 관심 담기」로 돌아옴', '화면', s5)

    def s6():
        n = q(f"select count(*) from favorites where account_id='{S['id2']}'"); lc = q(f"select like_count from listings where id='{lid}'")
        return n == '0' and lc == S['like0'], f'favorites {n}행 · listings.like_count {lc}(처음 {S["like0"]})'
    R.do('favorites 에서 그 행이 지워지고 매물의 관심 수가 처음 값으로 돌아옴', 'DB', s6)

    def s7():
        pg = box['pg']; st = goto(pg, '/my/likes')
        return st == 200 and pg.locator(f'main a[href="/money/{lid}"]').count() == 0 and '없습니다' in txt(pg, 'main'), f'관심 목록 「{one(txt(pg, "main"))[:40]}」'
    R.do('「관심 목록」(/my/likes)에서 그 매물이 사라짐(「관심 등록한 매물이 없습니다」)', '화면', s7, need=False)
    flush(R)
    return R


def t7(b):
    F = Flow('T7 신고 접수 → 운영 신고 처리', f'신고자 = 둘째 회원 {S.get("em2", "flw_tr2_*")} · 운영자 admin@x.com')
    R = Run(F, None if S.get('pub') and S.get('p2') else 'T3 에서 매물이 공개되지 못했거나 T6 의 둘째 회원을 만들지 못함'); lid = S.get('lid'); pg = S.get('p2'); box = {}
    DETAIL = f'흐름 시험 신고 {TAG} — 실제 문제는 없습니다.'; RES = f'흐름 시험 — 확인 결과 문제 없음 ({TAG})'

    def s1():
        goto(pg, f'/money/{lid}'); pg.locator('.gw-abar a.gw-rp').click()
        try: pg.wait_for_url(f'**/report/listing/{lid}', timeout=20000)
        except Exception: pass
        t = one(txt(pg, 'main')); link = pg.locator('main a[href="/verify"]').count()
        return pg.url.rstrip('/').endswith(f'/report/listing/{lid}') and '본인인증이 필요합니다' in t and link == 1 and pg.locator('main .opts button').count() == 0, f'「신고」 누름 → {pg.url.replace(SITE, "")[:24]}… · 「{t[t.find("본인인증이"):][:44]}」 · 「인증하러 가기」 링크 {link}개 · 신고 폼은 아직 없음'
    R.do('둘째 회원이 매물 상세 맨 아래 줄의 「신고」를 누르면 신고 화면이 열리고, 본인인증 전이라 「본인인증이 필요합니다」 안내가 보임', '화면', s1)

    def s2():
        pg.locator('main a[href="/verify"]').first.click()
        try: pg.wait_for_url('**/verify', timeout=20000)
        except Exception: pass
        pg.click('.verify button.cta-primary')
        ok = until(lambda: '완료' in one(txt(pg, 'ol.steps > li:nth-child(1) .step-state')), 25)
        db = q(f"select identity_verified_at is not null from accounts where id='{S['id2']}'")
        return bool(ok) and db == 't', f'「인증하러 가기」 → /verify → 「PASS 로 본인인증」(시험 응답) → 1번 칸 「{one(txt(pg, "ol.steps > li:nth-child(1) .step-state"))}」 · DB 본인인증 시각 {"있음" if db == "t" else "없음"}'
    R.do('「인증하러 가기」를 눌러 본인인증(개발 환경은 시험 응답)을 마침', '화면', s2)

    def s3():
        st = goto(pg, f'/report/LISTING/{lid}'); opts = pg.locator('main .opts button').all_inner_texts()
        pg.locator('main .opts button', has_text='업종이 맞지 않음').first.click(); pg.fill('main textarea.inp', DETAIL)
        pg.locator('main button.btn-primary', has_text='신고하기').click()
        try: pg.wait_for_url('**/my/reports**', timeout=30000)
        except Exception: pass
        # v10.29 이후 내 신고 내역은 나의공간 표(table.my-tb2 · 머리 설명 .my-pgh p) — 옛 table.tbl · p.lead 를 따라가지 못하던 것
        try: pg.wait_for_selector('main table.my-tb2 tbody tr, main .my-pgh', timeout=15000)
        except Exception: pass
        TR = 'main table.my-tb2 tbody tr'
        row = one(pg.locator(TR).first.inner_text()) if pg.locator(TR).count() else ''
        return st == 200 and len(opts) >= 3 and '/my/reports' in pg.url and '접수됨' in row, f'/report/LISTING/{{id}} 응답 {st} · 사유 단추 {len(opts)}개 → 「업종이 맞지 않음」 + 자세히 입력 → 「신고하기」 → {pg.url.replace(SITE, "")} · 「{one(txt(pg, "main .my-pgh p"))}」 · 줄 「{row}」 · 오류 글 「{one(txt(pg, "main .form-error"))}」'
    R.do('신고 화면(/report/LISTING/{id})에서 사유 「업종이 맞지 않음」을 고르고 자세한 내용을 적어 「신고하기」를 누름 → 「내 신고 내역」에 「접수됨」', '화면', s3)

    def s4():
        r = rows(f"select id, target_type, target_id, reason_code, coalesce(detail,''), state from reports where reporter_id='{S['id2']}'")
        if len(r) != 1: return False, f'reports {len(r)}행'
        S['rpid'] = r[0][0]
        return r[0][1] == 'LISTING' and r[0][2] == lid and r[0][3] == 'WRONG_CAT' and r[0][4] == DETAIL and r[0][5] == 'OPEN', f'reports 1행 · {r[0][1]} · 그 매물 {r[0][2] == lid} · 사유 {r[0][3]} · 상태 {r[0][5]} · 내용 「{r[0][4][:24]}」'
    R.do('reports 에 신고 1행(대상 = 그 매물 · 사유 · 내용 · 상태 OPEN)', 'DB', s4)

    def s5():
        box['ctx'], box['bo'] = bo_open(b, '운영 화면(신고 처리)'); bo = box['bo']; tab = bo_tab(bo, '신고 처리')
        n = until(lambda: bo.locator('.bo-main table.tbl tbody tr', has_text=TAG).count(), 20)
        t = one(bo.locator('.bo-main table.tbl tbody tr', has_text=TAG).first.inner_text()) if n else ''
        return bool(tab and n == 1 and '업종이 맞지 않음' in t), f'탭 열림 {tab} · 「{one(txt(bo, ".bo-main p.hint"))[:30]}」 · 내 신고 줄 「{t[:80]}」'
    R.do('운영자가 운영 화면 「신고 처리」 탭을 열면 그 신고(대상 · 사유 · 내용)가 목록에 보임', '운영 화면', s5, need=False)

    def s6():
        bo = box['bo']; row = bo.locator('.bo-main table.tbl tbody tr', has_text=TAG).first
        row.locator('button.btn-sm', has_text='처리').click(); bo.wait_for_timeout(500)
        bo.fill('.bo-main table.tbl textarea', RES); bo.locator('.bo-main table.tbl button', has_text='아닙니다 (기각)').click()
        ok = until(lambda: q(f"select state from reports where id='{S['rpid']}'") == 'DISMISSED', 12)
        msg = one(' '.join(bo.locator('.bo-main table.tbl p.dim').all_inner_texts())); bad = [a for _, _, as_ in WATCH for a in as_ if '/admin/reports/' in a]
        now = q(f"select state from reports where id='{S['rpid']}'")
        resp = re.sub(r'[0-9a-f]{8}-[0-9a-f-]{27}', '{id}', bad[-1]) if bad else '정상'
        return bool(ok), f'「처리」 → 처리 내용 입력 → 「아닙니다 (기각)」 누름 → 화면 안내 「{msg[:36]}」 · 응답 {resp} · DB 상태 {now}' + ('' if ok else '(그대로) — 이 단추만 로그인 토큰 없이 요청을 보내 서버가 거절함(목록 조회는 토큰을 실어 정상)')
    done = R.do('그 줄의 「처리」를 눌러 처리 내용을 적고 「아닙니다 (기각)」을 누름 → 처리되어 목록에서 사라짐', '운영 화면', s6, need=False) if not R.dead and S.get('rpid') and box.get('bo') else (R.skip('그 줄의 「처리」를 눌러 처리 내용을 적고 「아닙니다 (기각)」을 누름 → 처리되어 목록에서 사라짐', '운영 화면', f'하지 못함 — {R.dead or "신고 처리 탭을 열지 못함"}') or False)
    try: box['ctx'].close()
    except Exception: pass

    if not done and not R.dead:
        def api_ok():
            st, j = call('PATCH', f"/admin/reports/{S['rpid']}/resolve", S['adm'], {'state': 'DISMISSED', 'resolution': RES})
            return st == 200 and (j or {}).get('state') == 'DISMISSED', f'PATCH /admin/reports/{{id}}/resolve(운영자 토큰) → {st} {str(j)[:100]}'
        R.do('(화면의 처리 단추가 거절되어 API 로 이어감) 운영자 권한으로 그 신고를 기각 처리', 'API', api_ok)

    def s8():
        r = rows(f"select state, coalesce(resolution,''), coalesce((select email from accounts where id = handled_by),''), handled_at is not null from reports where id='{S['rpid']}'"); stt = q(f"select status from listings where id='{lid}'")
        return r[0][0] == 'DISMISSED' and r[0][1] == RES and r[0][2] == 'admin@x.com' and r[0][3] == 't' and stt == 'PUBLISHED', f'reports 상태 {r[0][0]} · 처리 내용 「{r[0][1][:24]}」 · 처리한 사람 {r[0][2]} · 처리 시각 {"있음" if r[0][3] == "t" else "없음"} · 매물은 그대로 {stt}'
    R.do('reports 가 DISMISSED(처리 내용 · 처리한 운영자 · 처리 시각) — 매물은 그대로 공개', 'DB', s8)

    def s9():
        def see():
            goto(pg, '/my/reports'); return '기각됨' in txt(pg, 'main table.my-tb2')
        ok = until(see, 20, 3); row = one(pg.locator('main table.my-tb2 tbody tr').first.inner_text()) if pg.locator('main table.my-tb2 tbody tr').count() else ''
        day = q(f"select to_char(created_at at time zone 'Asia/Seoul','YYYY-MM-DD') || ' / UTC ' || to_char(created_at at time zone 'UTC','YYYY-MM-DD') from reports where id='{S['rpid']}'")
        return bool(ok) and RES in row, f'내 신고 내역의 줄 「{row[:90]}」 · 「{one(txt(pg, "main p.lead"))}」 · 참고: 신고 날짜는 한국 시각 {day}'
    R.do('신고한 회원의 「내 신고 내역」(/my/reports)에 「기각됨」과 처리 내용이 보임', '화면', s9, need=False)
    flush(R, known=('/admin/reports/',))
    return R


# ── T8 뒷정리 ─────────────────────────────────────────────────────────────
def t8(b, snap):
    F = Flow('T8 뒷정리 — 만든 매물 · 요청 내리기 · 남긴 자료 확인', '운영자 admin@x.com(운영 API) · DB'); R = Run(F)
    lid, rq = S.get('lid'), S.get('rqid')

    def c1():
        if not lid: return True, '만든 매물이 없음'
        stt = q(f"select status from listings where id='{lid}'")
        if stt == 'PUBLISHED':
            st, j = call('POST', f"/admin/auto-review/samples/{S['lrid']}", S['adm'], {'correct': False, 'memo': f'흐름 시험 뒷정리 — 시험 매물 노출 중단 ({TAG})'}); how = f'POST /admin/auto-review/samples/{{검수 건 id}} (부적정 기록 → 노출 중단) → {st}'
        elif stt == 'IN_REVIEW':
            st, j = call('PATCH', f"/admin/reviews/{S['lrid']}", S['adm'], {'decision': 'REJECTED', 'reasonCode': 'OTHER', 'memo': f'흐름 시험 뒷정리 ({TAG})'}); how = f'PATCH /admin/reviews/{{id}} 반려 → {st}'
        else: how = '이미 내려가 있음'
        now = q(f"select status from listings where id='{lid}'"); pub = call('GET', f'/listings/{lid}')[0]
        return now in ('SUSPENDED', 'REJECTED', 'ARCHIVED') and pub == 404, f'{how} · listings 상태 {stt} → {now} · 공개 상세 API {pub}'
    R.do('시험 매물을 내림 — 등록자가 자기 매물을 내리는 화면 · API 가 없어 운영 API(표본 감사 「부적정」 = 노출 중단)로 함', 'API', c1, need=False)

    def c2():
        if not lid: return True, '만든 매물이 없음'
        st, j = call('GET', '/listings?gwanCode=MNY&limit=50'); cards = ((j or {}).get('organic') or []) + ((j or {}).get('promoted') or [])
        pg = S.get('apg') or track(new_ctx(b).new_page(), '방문자'); code = goto(pg, f'/money/{lid}')
        return not any(c.get('id') == lid for c in cards) and code == 404, f'목록 API 에 그 매물 {"있음" if any(c.get("id") == lid for c in cards) else "없음"} · 방문자가 상세 주소를 열면 응답 {code}(「{one(txt(pg, "main"))[:10]}」)'
    R.do('내린 매물이 소개장터 목록에서 빠지고 상세 주소는 「없는 주소」(404)가 됨', '화면', c2, need=False)

    def c3():
        if not rq: return True, '만든 요청이 없음'
        stt = q(f"select status from requests where id='{rq}'")
        if stt == 'IN_REVIEW' and S.get('rrid'):
            st, j = call('PATCH', f"/admin/reviews/{S['rrid']}", S['adm'], {'decision': 'REJECTED', 'reasonCode': 'OTHER', 'memo': f'흐름 시험 뒷정리 ({TAG})'}); how = f'운영 API 반려 → {st}'
        elif stt == 'PUBLISHED':
            code, err = sql(f"update requests set status='ARCHIVED' where id='{rq}' and status='PUBLISHED'"); how = f'요청을 닫는 API · 화면이 없어 DB 에서 ARCHIVED 로 바꿈(종료 {code} {err[:40]})'
        else: how = '이미 내려가 있음'
        now = q(f"select status from requests where id='{rq}'"); pub = call('GET', f'/requests/{rq}')[0]
        lst = call('GET', '/requests?limit=50')[1] or []
        return now in ('ARCHIVED', 'REJECTED') and pub == 404 and not any(x.get('id') == rq for x in lst), f'{how} · requests 상태 {stt} → {now} · 공개 상세 API {pub} · 목록 API 에 {"있음" if any(x.get("id") == rq for x in lst) else "없음"}'
    R.do('시험 요청을 내림 — 요청을 닫는 API 가 없어 뒷정리 SQL(상태 ARCHIVED)로 함 → 목록 · 상세에서 빠짐', 'DB', c3, need=False)

    def c4():
        now = rows(f"select name, md5(password_hash), status, account_type, identity_verified_at::text, (select string_agg(role, ',' order by role) from account_roles where account_id = a.id), (select count(*) from favorites where account_id = a.id) from accounts a where email='{BUYER}'")
        return now == snap, f'{BUYER} 의 이름 · 비밀번호 · 상태 · 유형 · 본인인증 시각 · 역할 · 찜 수가 시작할 때와 {"같음" if now == snap else "다름: " + str(now)[:120]}'
    R.do(f'기존 계정 {BUYER} 의 정보(이름 · 비밀번호 · 상태 · 역할 · 찜)가 시작할 때와 같음', 'DB', c4, need=False)

    def c5():
        a, a2, did = S.get('aid') or '00000000-0000-0000-0000-000000000000', S.get('id2') or '00000000-0000-0000-0000-000000000000', S.get('did') or '00000000-0000-0000-0000-000000000000'
        n = lambda s: q(s) or '0'
        left = {'새 계정': n(f"select count(*) from accounts where id in ('{a}','{a2}')"), '약관 동의': n(f"select count(*) from term_agreements where account_id='{a}'"),
                '사업자': n(f"select count(*) from businesses where account_id='{a}' and verified_at is not null"),
                '사업자 검수 건(QUEUED)': n(f"select count(*) from review_items r join businesses b on b.id = r.target_id where b.account_id='{a}' and r.target_type='BUSINESS' and r.status='QUEUED'"),
                '매물': n(f"select status from listings where owner_account_id='{a}' limit 1"), '요청': n(f"select status from requests where owner_account_id='{a}' limit 1"),
                '대화': n(f"select count(*) from conversations where target_id='{lid or a}'"), '거래': n(f"select status from deals where id='{did}'"),
                '확인': n(f"select count(*) from deal_confirmations where deal_id='{did}'"), '대금 신고': n(f"select count(*) from deal_payment_records where deal_id='{did}'"),
                '후기': n(f"select count(*) from deal_reviews where deal_id='{did}'"), '신고': n(f"select state from reports where reporter_id='{a2}' limit 1"),
                '찜': n(f"select count(*) from favorites where account_id in ('{a}','{a2}')"), '열린 신고': n(f"select count(*) from reports where reporter_id='{a2}' and state in ('OPEN','QUEUED')")}
        S['left'] = left
        return left['찜'] == '0' and left['열린 신고'] == '0' and left['매물'] in ('0', 'SUSPENDED', 'REJECTED', 'ARCHIVED') and left['요청'] in ('0', 'ARCHIVED', 'REJECTED'), ' · '.join(f'{k} {v}' for k, v in left.items())
    R.do('남긴 자료 — 새 계정 2개와 그 사업자 · 대화 · 거래 · 확인 · 대금 신고 · 후기 · 처리된 신고는 남고, 공개된 매물 · 요청 · 찜 · 열린 신고는 남지 않음', 'DB', c5, need=False)
    return R


# ── 실행 ─────────────────────────────────────────────────────────────────
def main():
    S['adm'] = login('admin@x.com')
    snap = rows(f"select name, md5(password_hash), status, account_type, identity_verified_at::text, (select string_agg(role, ',' order by role) from account_roles where account_id = a.id), (select count(*) from favorites where account_id = a.id) from accounts a where email='{BUYER}'")
    with sync_playwright() as p:
        b = p.chromium.launch()
        try:
            r1 = t1(b); r2 = t2(b, r1); t3(b, r2); t4(b); t5(b); t6(b); t7(b)
        except Exception as ex:
            import traceback; traceback.print_exc()
            Flow('실행 중 오류').step('시험 도구가 끝까지 돌지 못함', 'API', False, repr(ex)[:280])
        finally:
            try:
                S['adm'] = login('admin@x.com') or S['adm']
                t8(b, snap)
            except Exception as ex:
                import traceback; traceback.print_exc()
                Flow('T8 뒷정리 — 실행 중 오류').step('뒷정리를 끝내지 못함', 'API', False, repr(ex)[:280])
            b.close()
    finish('trade')


if __name__ == '__main__':
    main()
