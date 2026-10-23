"""flow 점검 — 안심소개 상담 신청 · 소개광장 · 「이건 어때?」 투표  (v10.25 · 2026-10-08)   결과: flow_plaza.json

  P1 상담 축 → 업종 상세 → 신청서 → 인증 → 접수      비로그인 방문자가 화면으로 신청 → DB consult_requests · leads · lead_deliveries
  P2 리드 배정 → 파트너 열람                          P1 의 리드 → 운영 화면(자동 배정 확인) → 파트너센터 열람(이용료) → 운영 화면에서 종료
  P3 소개광장 글쓰기 → 검수 → 목록 → 상세 → 댓글      새 회원의 첫 글 → 검수 → 승인 → 목록 · 검색 → 상세 → 댓글 · 답글 → 삭제 (G-173 확인)
  P4 투표 참여 → 결과 → 다시 참여 막힘                 운영 화면에서 투표 만들기 · 열기 → 방문자 투표 → 결과 → 다시 투표 막힘 → 하루 한도 → 감춤
  P5 신고 → 글 가림                                   글 신고(화면 · API 가 없어 건너뜀) → 운영 API 로 가림 → 「가려진 글」 자리 → 글쓴이에게 사유

지키는 것
  · 제품 코드는 읽기만 합니다. 단계의 ok 는 실제로 본 값으로만 정합니다(실패는 실패로 남김).
  · 상담을 받는 인증업체는 이 시험이 새로 만듭니다(flw_*@t.local · 청소 · 제주 「흐름xxxxxx」).
    시연용 시드 업체(소개사 intro@x.com)로 열람하면 이용료(3,000원)가 지워지지 않고 쌓여 미납 한도(300,000원)에 닿습니다 —
    한도를 넘으면 그 업체가 받는 20업종이 모두 「준비 중」이 됩니다. 그래서 시드 업체에는 손대지 않습니다.
  · 끝에 치웁니다 — 리드는 종료, 글은 삭제, 투표는 감춤, 시험 업체의 활동 지역은 신청서에서 고를 수 없는 「시험도」로 옮김.
    계정 · 업체(flw_*) · 열람 이용료 1건(시험 업체 앞 3,000원) · 넣은 표 · 달린 댓글은 남습니다(지우는 길이 없음).
  · 공용 설정은 바꾸지 않습니다(투표의 하루 한도는 지금 값만큼 실제로 투표해서 확인).
  · 다른 시험과 같이 돌아도 되게, 만든 것은 모두 이번 실행의 표식(TAG) · id 로만 찾습니다.

사용:  cd /home/claude/qa && python3 flow_plaza.py
"""
import hashlib, random, traceback
from flow_lib import *
from playwright.sync_api import sync_playwright
import time as _time
def until(cond, sec=20, every=0.5):      # v10.27 — 조건이 참이 될 때까지 기다림(flow_trade 와 같은 것)
    end = _time.time() + sec
    while _time.time() < end:
        try:
            v = cond()
            if v: return v
        except Exception: pass
        _time.sleep(every)
    return None

TAG = uuid.uuid4().hex[:6]
FPW = 'Sgb-flw-1234!'                      # signup() 이 만드는 계정의 비밀번호
GU = f'흐름{TAG}'                          # 시 · 군 · 구 — 시험마다 새 이름이라 이 시험이 만든 업체만 받습니다
SIDO = '제주'
CODE = 'CSL_CLEANING'
norm = lambda s: re.sub(r'\s+', ' ', s or '').strip()
S = {}                                     # 흐름 사이에 넘기는 값(리드 번호 · 업체 · 글 번호 …)


class Flw:
    """단계를 차례로 돌립니다. must 단계가 실패하면 남은 단계는 「건너뜀」과 까닭을 남깁니다(always 단계는 그래도 돕니다)."""
    def __init__(self, name, who=''):
        self.F = Flow(name, who); self.stop = None
    def who(self, w): self.F.d['who'] = w
    def step(self, name, how, fn, must=False, always=False):
        if self.stop and not always:
            self.F.step(name, how, False, f'건너뜀 — 앞 단계 「{self.stop}」가 되지 않아 이어 갈 수 없음', skip=True); return False
        try:
            r = fn(); ok, detail = r if isinstance(r, tuple) else (r, '')
        except Exception as ex:
            ok, detail = False, '시험 중 예외 — ' + norm(repr(ex))[:240]
        if ok == 'skip':
            self.F.step(name, how, False, detail, skip=True); return False
        self.F.step(name, how, ok, detail)
        if must and not ok and not self.stop: self.stop = name[:28] + ('…' if len(name) > 28 else '')
        return bool(ok)
    def skip(self, name, how, why): self.F.step(name, how, False, why, skip=True)


def dialogs(pg):
    """확인 창 · 입력 창을 받아 줍니다. box['next'] 에 넣어 둔 글을 입력 창에 차례로 넣습니다."""
    box = {'next': [], 'seen': []}
    def on(d):
        box['seen'].append((d.type, d.message[:70]))
        if d.type == 'prompt': d.accept(box['next'].pop(0) if box['next'] else '')
        else: d.accept()
    pg.on('dialog', on)
    return box

W_ALL = []                                 # (이름, errs, apis) — 흐름 끝에 쪽 오류 · 실패 응답을 봅니다
def watched(pg, name):
    e, a = watch(pg); W_ALL.append((name, e, a)); return pg

def clean(W, start, allow=()):
    """이 흐름에서 연 쪽들의 쪽 오류 · 실패한 API 응답(뜻한 것 제외)"""
    def fn():
        bad = []
        for name, errs, apis in W_ALL[start:]:
            for x in errs: bad.append(f'{name}: 쪽 오류 {x[:80]}')
            for x in apis:
                if not any(re.search(p, x) for p in allow): bad.append(f'{name}: {x}')
        return not bad, bad[:4] if bad else f'쪽 {len(W_ALL) - start}개 · 쪽 오류 0 · 뜻하지 않은 실패 응답 0'
    W.step('이 흐름에서 연 화면들 — 쪽 오류(스크립트 오류)와 뜻하지 않은 실패 응답(4xx · 5xx)이 없음', '화면', fn, always=True)

def ctx_new(b, w=1366, h=900):
    return b.new_context(viewport={'width': w, 'height': h}, user_agent=UA)      # 「headless」가 든 이름은 투표가 자동 프로그램으로 봅니다

def login_site(ctx, email, pw, name):
    pg = site_login(ctx, email, pw)
    for _ in range(10):
        if '/login' not in pg.url: break
        pg.wait_for_timeout(1000)
    return watched(pg, name)

def bo_main(pg): return text(pg, '.bo-main')

def exact_btn(scope, label):
    """글자가 꼭 같은 단추(「승인」이 「승인됨」에 걸리지 않게)"""
    loc = scope.locator('button')
    for i in range(loc.count()):
        if loc.nth(i).inner_text().strip() == label: return loc.nth(i)
    return None


# ══════════════════════════════════════════════════════════════════════════════════════════
def p1(b):
    W = Flw('P1 상담 축 → 업종 상세 → 신청서 → 인증 → 접수', '신청자: 로그인하지 않은 방문자 · 받는 업체: 이 시험이 새로 만드는 인증업체 · 운영자 admin@x.com')
    w0 = len(W_ALL)
    ADM = S['ADM']
    CLEAN = q(f"select id from categories where code='{CODE}' and gwan_code='MAL'")
    PHONE = '010-' + ''.join(random.choice('0123456789') for _ in range(4)) + '-' + ''.join(random.choice('0123456789') for _ in range(4))
    DIG = PHONE.replace('-', ''); NAME = f'홍흐름{TAG[:3]}'
    MEMO = f'다음 달 투룸 입주 청소 견적 — 흐름 점검 {TAG}'
    S.update(phone=PHONE, name=NAME, clean=CLEAN)

    def prep():
        em, pw, tok, aid = signup('flw', '흐름업체')
        r = [call('POST', '/verifications/identity', tok, {'provider': 'PASS'})[0]]
        st, j = call('POST', '/businesses', tok, {'bizRegNo': str(uuid.uuid4().int)[-10:], 'companyName': f'흐름청소{TAG}', 'ceoName': '김흐름', 'sido': SIDO, 'sigungu': GU}); r.append(st)
        bid = (j or {}).get('businessId')
        r.append(call('PATCH', f'/admin/businesses/{bid}/verify', ADM, {})[0])
        tok = login(em, pw)
        st, j = call('POST', '/partner/apply', tok); r.append(st); pid = (j or {}).get('id')
        r.append(call('POST', f'/admin/partners/{pid}/approve', ADM)[0])
        st, sv = call('POST', '/partner/services', tok, {'title': f'흐름청소{TAG} 입주 청소', 'body': '흐름 점검용 청소 상담 서비스입니다.', 'categoryId': CLEAN}); r.append(st)
        r.append(call('POST', f"/admin/partners/services/{(sv or {}).get('id')}/review", ADM, {'approve': True})[0])
        r.append(call('POST', '/partner/regions', tok, {'regions': [{'sido': SIDO, 'sigungu': GU}]})[0])
        r.append(call('POST', '/partner/axes', tok, {'axes': ['CONSULT']})[0])
        axid = q(f"select id from mal_partner_axes where business_id='{bid}' and axis='CONSULT'")
        r.append(call('POST', f'/admin/partner-axes/{axid}/decide', ADM, {'approve': True})[0])
        # v10.31 (W5 · D070) — 리드 이용료 선불: 잔액이 있어야 배정 · 열람됩니다. 시험 결제(스텁) 100,000원
        st, c = call('POST', '/partner/cash/charges', tok, {'amount': 100000}); r.append(st)
        r.append(call('POST', '/partner/cash/charges/confirm', tok, {'orderId': (c or {}).get('orderId'), 'paymentKey': 'stub_' + uuid.uuid4().hex, 'amount': 100000})[0])
        S.update(p_email=em, p_pw=pw, p_tok=tok, pid=pid, bid=bid, company=f'흐름청소{TAG}')
        W.who(f'신청자: 로그인하지 않은 방문자 · 받는 업체: 이 시험이 새로 만든 인증업체 「흐름청소{TAG}」({em}) · 운영자 admin@x.com')
        return all(200 <= x < 300 for x in r) and bool(pid), f'{em} · 업체 「흐름청소{TAG}」 · 응답 {r}'
    W.step(f'(준비) 상담을 받을 인증업체를 새로 만듦 — 가입 · 본인인증 · 사업자 인증 · 파트너 승인 · 청소 서비스 승인 · 활동 지역({SIDO} {GU}) · 상담 축 입점 승인. '
           '시연용 업체(소개사)로 열람하면 이용료가 지워지지 않고 쌓여서 따로 만듦', 'API', prep, must=True)

    def elig():
        r = rows(f"select e.partner_id from v_consult_eligible_partner e where e.category_id='{CLEAN}' and e.sido='{SIDO}' and e.sigungu='{GU}'")
        return r == [[S['pid']]], f'청소 · {SIDO} {GU} 를 받을 수 있는 업체 {len(r)}곳'
    W.step(f'DB — 「청소 · {SIDO} {GU}」 상담을 받을 수 있는 업체가 방금 만든 한 곳뿐임(v_consult_eligible_partner)', 'DB', elig, must=True)

    ctx = ctx_new(b); pg = watched(ctx.new_page(), 'P1 방문자')

    def axis():
        st = goto(pg, '/mall')
        tab = pg.locator('a.mal-axt[href="/mall?axis=consult"], a.gw-axt[href="/mall?axis=consult"]')   # v10.29~31 — 관 화면 틀의 축 단추는 .gw-axt
        if tab.count() != 1: return False, f'/mall {st} · 「생활 · 금융 상담」 축 단추 {tab.count()}개'
        tab.click(); pg.wait_for_url('**/mall?axis=consult', timeout=20000); pg.wait_for_selector('.mal-row[data-csl]', timeout=20000)
        n = pg.locator('.mal-row[data-csl]').count()
        api_n = len(call('GET', '/consult/categories')[1] or [])
        row = pg.locator(f'.mal-row[data-csl="{CODE}"]')
        links = [[norm(a.inner_text()), a.get_attribute('href')] for a in row.locator('.mal-row-r a').all()]
        ok = st == 200 and n == api_n and n > 0 and links == [['상세 보기', f'/mal/consult/{CODE}'], ['상담 신청', f'/mal/consult/{CODE}/apply']]
        return ok, f'업종 줄 {n}개(API {api_n}) · 청소 줄의 단추 {links}'
    W.step('안심소개(/mall)에서 「생활 · 금융 상담」 축을 누름 → 상담 업종 목록 · 청소 줄에 「상세 보기」 「상담 신청」', '화면', axis, must=True)

    def detail():
        pg.locator(f'.mal-row[data-csl="{CODE}"] .mal-row-r a', has_text='상세 보기').click()
        pg.wait_for_url(f'**/mal/consult/{CODE}', timeout=20000); pg.wait_for_selector(f'[data-consult-detail="{CODE}"]', timeout=20000)
        t = norm(text(pg, 'main'))
        cells = {norm(c.locator('.k').inner_text()): norm(c.locator('.v').inner_text()) for c in pg.locator('.mal-cd-stats .cell').all()}
        regs = [norm(x) for x in pg.locator('.mal-cd-regions li b').all_inner_texts()]
        steps = [norm(x) for x in pg.locator('.mal-cd-steps li b').all_inner_texts()]
        cnt = re.match(r'(\d[\d,]*)곳', cells.get('받을 수 있는 인증업체', ''))
        ok = (norm(text(pg, 'h1')) == '청소' and cnt and int(cnt.group(1).replace(',', '')) >= 1 and SIDO in regs and len(steps) == 3
              and '상담 신청' in steps[0] and '휴대폰 확인' in steps[1] and '연락' in steps[2] and pg.locator('input[name=phone]').count() == 0
              and '1곳에만 전달' in t)
        return ok, f"제목 {text(pg, 'h1')!r} · {cells} · 받는 지역 {regs} · 진행 순서 {steps}"
    W.step('청소 줄의 「상세 보기」를 누름 → 업종 상세(이름 · 받을 수 있는 인증업체 수 · 받는 지역에 제주 · 진행 순서 3단계 · 「1곳에만 전달」 안내)', '화면', detail, must=True)

    def to_form():
        pg.locator('.mal-cd-bar a.mal-cd-go').click()
        pg.wait_for_url(f'**/mal/consult/{CODE}/apply', timeout=20000); pg.wait_for_selector('form.mal-form input[name=phone]', timeout=20000)
        have = {s: pg.locator(f'form.mal-form {s}').count() for s in ('input[name=name]', 'input[name=phone]', 'select[name=sido]', 'input[name=sigungu]', 'textarea[name=memo]', 'input[name=agree]')}
        return all(v == 1 for v in have.values()) and '청소 상담 신청' in text(pg, 'h1') and '/login' not in pg.url, f"제목 {text(pg, 'h1')!r} · 칸 {have}"
    W.step('맨 아래 「상담 신청」을 누름 → 신청서(이름 · 휴대폰 · 지역 · 상담 내용 · 동의) · 로그인하라고 하지 않음', '화면', to_form, must=True)

    def no_agree():
        pg.fill('input[name=name]', NAME); pg.fill('input[name=phone]', PHONE); pg.fill('input[name=email]', 'consult.test@example.com')
        pg.select_option('select[name=sido]', SIDO); pg.fill('input[name=sigungu]', GU); pg.fill('textarea[name=memo]', MEMO)
        pg.locator('form.mal-form [data-csl-otp], form.mal-form button[type=submit]').first.click(); pg.wait_for_timeout(1200)   # v10.31 (w2 시안 CSL-030) — 한 장 신청서: 휴대폰 칸 옆 「인증번호 받기」(data-csl-otp) → 맨 아래 「상담 신청」(submit)
        msg = norm(text(pg, 'form.mal-form [role=alert]'))
        n = q(f"select count(*) from consult_requests where phone_hash='{hashlib.sha256(DIG.encode()).hexdigest()}'")
        return '동의해야 신청할 수 있습니다' in msg and n == '0' and pg.locator('[data-consult-verify]').count() == 0, f'안내 {msg!r} · 서버의 신청 {n}건'
    W.step(f'이름 · 휴대폰 · 지역({SIDO} {GU}) · 상담 내용을 적고, 동의에 표시하지 않은 채 「인증번호 받고 신청」 → 화면이 막고 까닭을 알림 · 서버에 신청이 생기지 않음', '화면', no_agree)

    def submit():
        pg.check('input[name=agree]')
        pg.locator('form.mal-form [data-csl-otp], form.mal-form button[type=submit]').first.click()
        pg.wait_for_selector('[data-consult-verify]', timeout=25000)
        S['rid'] = pg.locator('[data-consult-verify]').get_attribute('data-consult-verify')
        dev = pg.locator('[data-dev-code]'); S['otp'] = dev.get_attribute('data-dev-code') if dev.count() else ''
        return bool(S['rid']) and bool(re.fullmatch(r'\d{6}', S['otp'] or '')), f"신청 번호 {S['rid']} · 화면에 보인 인증번호 {len(S['otp'] or '')}자리"
    W.step('동의에 표시하고 「인증번호 받고 신청」 → 휴대폰 확인 단계(인증번호 6자리 — 개발 환경이라 화면에 보임)', '화면', submit, must=True)

    def db_req():
        r = rows(f"""select state, (lead_id is null)::text, (verified_at is null)::text, octet_length(contact_enc), position(convert_to('{DIG}','UTF8') in contact_enc),
                            position(convert_to('{NAME}','UTF8') in contact_enc), phone_hash, sido, coalesce(sigungu,''), (requester_account_id is null)::text, consent_version
                       from consult_requests where id='{S['rid']}'""")
        if not r: return False, '행이 없음'
        x = r[0]
        ok = (x[0] == 'PENDING_VERIFY' and x[1] == 'true' and x[2] == 'true' and int(x[3]) > 0 and x[4] == '0' and x[5] == '0'
              and x[6] == hashlib.sha256(DIG.encode()).hexdigest() and x[7] == SIDO and x[8] == GU and x[9] == 'true' and bool(x[10]))
        leads = q(f"select count(*) from leads where sigungu='{GU}'")
        return ok and leads == '0', f'상태 {x[0]} · 리드 없음 {x[1]} · 암호문 {x[3]}바이트(전화번호 · 이름 원문 없음: {x[4] == "0" and x[5] == "0"}) · 전화 해시 {x[6][:10]}…(sha256 과 같음: {x[6] == hashlib.sha256(DIG.encode()).hexdigest()}) · 동의 판 {x[10]} · 리드 {leads}건'
    W.step('DB — consult_requests 한 줄: 「확인 대기」(PENDING_VERIFY) · 리드는 아직 없음 · 전화번호 · 이름은 암호문(contact_enc)으로, 전화번호 찾기용은 해시(phone_hash)로만 저장', 'DB', db_req)

    def wrong():
        bad = '000000' if S['otp'] != '000000' else '111111'
        pg.fill('[data-consult-verify] input[name=otp]', bad)
        pg.locator('[data-consult-verify] button[type=submit]').click(); pg.wait_for_selector('[data-consult-verify] [role=alert]', timeout=15000)
        msg = norm(text(pg, '[data-consult-verify] [role=alert]'))
        st = q(f"select state||'|'||otp_tries from consult_requests where id='{S['rid']}'")
        return '인증번호가 맞지 않습니다' in msg and st == 'PENDING_VERIFY|1', f'안내 {msg!r} · DB {st}'
    W.step('틀린 인증번호를 넣음 → 「인증번호가 맞지 않습니다」 · 접수되지 않음(시도 1회로 기록)', '화면', wrong)

    def verify():
        pg.fill('[data-consult-verify] input[name=otp]', S['otp'])
        pg.locator('[data-consult-verify] button[type=submit]').click()
        pg.wait_for_selector('[data-consult-done]', timeout=25000)
        dn = pg.locator('[data-consult-done]'); state = dn.get_attribute('data-consult-state'); lid = dn.get_attribute('data-consult-done')
        t = norm(dn.inner_text())
        if state == 'DELIVERED': S['lead'] = lid
        return state == 'DELIVERED' and '청소 상담 신청을 전달했습니다' in t and f'접수번호 {lid[:8].upper()}' in t, f'상태 {state} · {t[:110]}'
    W.step('화면에 보인 인증번호를 넣고 「확인하고 신청 완료」 → 접수 완료 화면(「청소 상담 신청을 전달했습니다」 · 접수번호)', '화면', verify, must=True)

    def db_done():
        x = rows(f"select state, (verified_at is not null)::text, coalesce(lead_id::text,''), coalesce(partner_id::text,''), (otp_hash is null)::text from consult_requests where id='{S['rid']}'")[0]
        return x == ['DELIVERED', 'true', S['lead'], S['pid'], 'true'], f'상태 {x[0]} · 확인 시각 있음 {x[1]} · 리드 {x[2][:8]} · 받은 업체가 준비한 업체 {x[3] == S["pid"]} · 인증번호 해시 지움 {x[4]}'
    W.step('DB — consult_requests: 「전달」(DELIVERED) · 확인 시각 · 리드 번호가 접수 화면의 번호와 같음 · 받은 업체 = 준비한 업체', 'DB', db_done)

    def db_lead():
        x = rows(f"""select l.category_id::text, l.sido, coalesce(l.sigungu,''), l.assign_state, l.source, l.summary, (l.summary ~ '01[016789][-. ]?[0-9]{{3,4}}[-. ]?[0-9]{{4}}')::text,
                            (l.requester_account_id is null)::text, (l.contact_enc is null)::text from leads l where l.id='{S['lead']}'""")
        if not x: return False, 'leads 행이 없음'
        x = x[0]
        c = rows(f"""select (phone_enc is not null)::text, position(convert_to('{DIG}','UTF8') in phone_enc), (name_enc is not null)::text, position(convert_to('{NAME}','UTF8') in name_enc),
                            (phone_hash = md5('{DIG}'))::text, (purged_at is null)::text from pii.lead_contacts where lead_id='{S['lead']}'""")
        okc = bool(c) and c[0] == ['true', '0', 'true', '0', 'true', 'true']
        ok = x[0] == CLEAN and x[1] == SIDO and x[2] == GU and x[3] == 'ASSIGNED' and x[6] == 'false' and x[7] == 'true' and DIG not in x[5] and NAME not in x[5]
        return ok and okc, f'청소 · {x[1]} {x[2]} · {x[3]} · 출처 {x[4]} · 요약 {x[5][:40]!r}(전화 · 이름 없음) · leads.contact_enc 비어 있음 {x[8]} · pii.lead_contacts {c[0] if c else "없음"}'
    W.step('DB — leads 한 줄: 청소 · 제주 · 「배정 완료」(ASSIGNED) · 요약에 전화번호 · 이름 없음 / 연락처는 pii.lead_contacts 에 암호문(전화 · 이름 원문 없음)', 'DB', db_lead)

    def db_deliv():
        r = rows(f"""select d.id, d.partner_id, d.state, d.assign_mode, (d.viewed_at is null)::text, round(extract(epoch from (d.expires_at - d.delivered_at))/3600)::int,
                            (select count(*) from lead_fees f where f.delivery_id = d.id) from lead_deliveries d where d.lead_id='{S['lead']}'""")
        ttl = q("select fn_lead_setting_int('lead.assign.view_ttl_hours', 24)")
        if len(r) == 1: S['did'] = r[0][0]
        ok = len(r) == 1 and r[0][1] == S['pid'] and r[0][2] == 'DELIVERED' and r[0][3] == 'AUTO' and r[0][4] == 'true' and str(r[0][5]) == ttl and r[0][6] == '0'
        return ok, f'배정 {len(r)}건 · ' + (f'업체가 준비한 업체 {r[0][1] == S["pid"]} · {r[0][2]} · 방식 {r[0][3]} · 열람 기한 {r[0][5]}시간(설정 {ttl}) · 이용료 {r[0][6]}건' if r else '')
    W.step('DB — lead_deliveries 한 줄: 받은 업체는 준비한 업체 1곳 · 자동 배정(AUTO) · 아직 열지 않음(DELIVERED) · 열람 기한 24시간 · 이용료 없음', 'DB', db_deliv, must=True)

    def back():
        a = pg.locator('[data-consult-done] a.mal-btn', has_text='안심소개로')
        if a.count() != 1: return False, f'「안심소개로」 {a.count()}개'
        a.click(); pg.wait_for_url('**/mall?axis=consult', timeout=20000)
        return pg.locator('.mal-row[data-csl]').count() > 0, pg.url
    W.step('접수 완료 화면의 「안심소개로」를 누름 → 상담 업종 목록으로 돌아감', '화면', back)

    clean(W, w0, allow=[r'^422 POST /consult/requests/[0-9a-f-]+/verif'])        # 틀린 인증번호(뜻한 것) — watch 가 주소를 60자에서 자릅니다
    ctx.close()


# ══════════════════════════════════════════════════════════════════════════════════════════
def p2(b):
    W = Flw('P2 리드 배정 → 파트너 열람', f"운영자 admin@x.com · 인증업체 {S.get('p_email', '(P1 에서 만들지 못함)')}(P1 에서 만든 「{S.get('company', '')}」)")
    w0 = len(W_ALL)
    if not S.get('lead') or not S.get('did'):
        W.stop = 'P1 의 접수(리드 · 배정)'
    L = S.get('lead', ''); D = S.get('did', ''); PHONE = S.get('phone', ''); NAME = S.get('name', '')
    fee = q(f"select coalesce(c.lead_fee, (select value::numeric from site_settings where key='lead.default_fee'))::int from categories c where c.id='{S.get('clean', '00000000-0000-0000-0000-000000000000')}'") if S.get('clean') else ''
    won = f'{int(fee):,}원' if fee else '?원'

    bctx = ctx_new(b, 1440, 900); P = {}
    def bo_open(reload=False):
        if 'bo' not in P:
            P['bo'] = watched(bo_login(bctx, 'admin@x.com'), 'P2 운영 화면'); P['dlg'] = dialogs(P['bo'])
        elif reload:
            P['bo'].reload(); P['bo'].wait_for_timeout(1500)
        bo = P['bo']
        if not bo_tab(bo, '파트너', '리드 배정'): raise RuntimeError('「파트너 › 리드 배정」 탭을 찾지 못함')
        bo.locator('.bo-main .acts button', has_text='배정 완료').first.click()
        card = bo.locator(f'[data-lead="{L}"]')
        card.wait_for(state='visible', timeout=40000); bo.wait_for_timeout(400)
        return bo, card

    def bo_card():
        bo, card = bo_open()
        t = norm(card.inner_text())
        return '청소' in t and f'{SIDO} {GU}' in t and '배정 완료' in t and '보냄 1/1곳' in t and '열람 0' in t, t[:170]
    W.step('운영 화면 「파트너 › 리드 배정」에서 「배정 완료」를 누름 → P1 의 신청 카드가 보임(청소 · 제주 · 「배정 완료」 · 보냄 1/1곳 · 열람 0)', '운영 화면', bo_card)

    def bo_auto():
        bo = P['bo']; card = bo.locator(f'[data-lead="{L}"]')
        card.locator('button', has_text='후보 · 배정').click()
        row = card.locator(f'tr[data-delivery="{D}"]'); row.wait_for(state='visible', timeout=30000)
        t = norm(row.inner_text())
        n = card.locator('tr[data-delivery]').count()
        return n == 1 and S['company'] in t and '받음 · 미열람' in t and '자동' in t, f'배정 현황 {n}줄 · {t[:120]}'
    W.step('카드의 「후보 · 배정」을 누름 → 배정 현황: 받은 업체 = P1 에서 만든 업체 · 「받음 · 미열람」 · 방식 「자동」 — 운영자가 손대지 않아도 접수와 함께 1곳에 자동 배정됨', '운영 화면', bo_auto)

    pctx = ctx_new(b)
    def p_notice():
        pp = login_site(pctx, S['p_email'], S['p_pw'], 'P2 인증업체'); P['pp'] = pp; P['pdlg'] = dialogs(pp)
        if '/login' in pp.url: return False, '로그인하지 못함 ' + pp.url
        goto(pp, '/my/notifications')
        t = norm(text(pp, 'main')); go = pp.locator('main a[href="/partner/leads"]')
        db = rows(f"select event_code, title, link_url from notifications where account_id=(select account_id from businesses where id='{S['bid']}') and event_code='LEAD_DELIVERED'")
        if go.count() != 1: return False, f'알림 화면에 상담 신청으로 가는 「바로가기」 {go.count()}개 · DB 알림 {db}'
        ok = '새 상담 신청이 왔습니다' in t and f'청소 · {SIDO} {GU}' in t and '이용료' in t and PHONE not in t and NAME not in t and len(db) == 1
        go.click(); pp.wait_for_url('**/partner/leads', timeout=20000)
        return ok, t[:150]
    W.step('인증업체 계정으로 로그인 → 알림(/my/notifications)에 「새 상담 신청이 왔습니다」(청소 · 제주 · 24시간 안에 열지 않으면 다른 업체로 · 열 때 이용료)가 와 있음 → 「바로가기」를 누르면 상담 신청 목록으로 감', '화면', p_notice, must=True)

    def p_list():
        pp = P['pp']
        goto(pp, '/partner')
        a = pp.locator('a[href="/partner/leads"]')
        if a.count() < 1: return False, '파트너센터에 「상담 신청」 메뉴가 없음'
        a.first.click(); pp.wait_for_url('**/partner/leads', timeout=20000)
        art = pp.locator(f'[data-delivery="{D}"]'); art.wait_for(state='visible', timeout=20000)
        t = norm(art.inner_text()); whole = text(pp, 'main')
        ok = '청소' in t and f'{SIDO} {GU}' in t and '까지 열람' in t and art.locator('button', has_text='연락처 열기').count() == 1 and PHONE not in whole and PHONE[-4:] not in t and NAME not in whole
        return ok, t[:170]
    W.step('파트너센터(/partner)의 「상담 신청」 메뉴로 들어가도 같은 목록 → 배정받은 건이 보임(청소 · 제주 · 열람 기한 · 「연락처 열기」) · 신청자 이름 · 전화번호는 아직 안 보임', '화면', p_list, must=True)

    def p_view():
        pp = P['pp']; art = pp.locator(f'[data-delivery="{D}"]')
        art.locator('button', has_text='연락처 열기').click()
        art.locator('[data-contact]').wait_for(state='visible', timeout=25000)
        t = norm(art.inner_text()); asked = [m for ty, m in P['pdlg']['seen'] if ty == 'confirm']
        return NAME in t and PHONE in t and '열람함' in t and any('이용료' in m for m in asked), f'확인 창 {asked[-1:]} · {t[:110]}'
    W.step('「연락처 열기」를 누름(이용료가 붙는다는 확인 창에서 확인) → 신청자 이름 · 전화번호가 보임', '화면', p_view, must=True)

    def db_view():
        d = rows(f"select state, (viewed_at is not null)::text from lead_deliveries where id='{D}'")[0]
        # v10.31 (W5 D070 · 10/10 시안 기준) — 리드 이용료가 후불 청구(PENDING) → 선불 잔액에서 열람 때 바로 차감(BILLED · settle_mode PREPAID · 보너스 먼저)
        f = rows(f"select amount::int, state, partner_id, coalesce(settle_mode,''), coalesce(bonus_part,0) + coalesce(paid_part,0) from lead_fees where delivery_id='{D}'")
        S['fee_ok'] = len(f) == 1
        ok = d == ['VIEWED', 'true'] and len(f) == 1 and str(f[0][0]) == fee and f[0][1] == 'BILLED' and f[0][3] == 'PREPAID' and str(f[0][4]) == fee and f[0][2] == S['pid']
        return ok, f'배정 {d[0]} · 이용료 {len(f)}건' + (f' · {int(f[0][0]):,}원 · {f[0][1]} · {f[0][3]} · 보너스+유상 차감 {f[0][4]} · 그 업체 앞 {f[0][2] == S["pid"]}' if f else '') + f' · 기대 금액 {won}(업종 단가 또는 설정 lead.default_fee)'
    W.step(f'DB — lead_deliveries: 「열람」(VIEWED) · 열람 시각 / lead_fees: 이용료 {won} 1건 — 선불 잔액에서 바로 차감(BILLED · PREPAID · 보너스 + 유상 = {won})', 'DB', db_view)

    def db_pii():
        r = rows(f"select access_type, (actor_account_id = (select account_id from businesses where id='{S['bid']}'))::text from audit.pii_access_logs where lead_id='{L}'")
        return len(r) == 1 and r[0] == ['VIEW', 'true'], f'열람 기록 {len(r)}건 {r[:2]}'
    W.step('DB — 연락처를 푼 기록(audit.pii_access_logs)이 그 업체 계정으로 1건 남음', 'DB', db_pii)

    def p_again():
        pp = P['pp']; goto(pp, '/partner/leads')
        art = pp.locator(f'[data-delivery="{D}"]'); art.wait_for(state='visible', timeout=20000)
        t = norm(art.inner_text())
        # v10.31 (W5 시안 상담 줄 — 상태 꼬리표 「확인 완료」 · 「확인비용 N원」)
        return '확인 완료' in t and f'확인비용 {won}' in t and PHONE not in t and NAME not in t and art.locator('button', has_text='연락처 보기').count() == 1 and art.locator('button', has_text='연락처 열기').count() == 0, t[:150]
    W.step(f'「상담 신청」 목록을 다시 엶 → 「확인 완료 · 확인비용 {won}」 · 연락처는 다시 가려지고 「연락처 보기」 단추만 있음(다시 「열기」로 이용료가 또 붙지 않음)', '화면', p_again)

    def p_fees():
        pp = P['pp']; goto(pp, '/partner')
        # v10.31 (W5 · 10/10 시안 기준) — 주소 /partner/cash · 선불 잔액(총 잔액 · 유상 잔액 · 등급 할인) · 사용 내역에 「리드 확인 -금액」
        a = pp.locator('a[href="/partner/cash"]')
        if a.count() < 1: return False, '파트너센터에 「리드 이용료」 메뉴가 없음'
        a.first.click(); pp.wait_for_url('**/partner/cash', timeout=20000); pp.wait_for_selector('main [data-cash-sum]', timeout=20000)
        top = norm(text(pp, 'main [data-cash-sum]')); trs = [norm(x) for x in pp.locator('main table.pt-tb2').first.locator('tbody tr').all_inner_texts()]
        hit = [x for x in trs if '리드 확인' in x and f'-{int(fee or 0):,}' in x.replace(' ', '')]      # 사용 내역 금액 칸은 「-3,000」(원 없음)
        return '총 잔액' in top and '유상 잔액' in top and len(hit) == 1, f'{top[:70]} · 표 {hit[:1] or trs[:1]}'
    W.step(f'파트너센터 「리드 이용료」 → 선불 잔액 3칸 · 사용 내역에 이 건 1줄(리드 확인 -{won})', '화면', p_fees)

    def bo_viewed():
        bo, card = bo_open(reload=True)
        t = norm(card.inner_text())
        card.locator('button', has_text='후보 · 배정').click()
        row = card.locator(f'tr[data-delivery="{D}"]'); row.wait_for(state='visible', timeout=30000)
        rt = norm(row.inner_text())
        return '열람 1' in t and '열람(과금)' in rt and row.locator('input[type=checkbox]').count() == 0, f'{t[:90]} · 배정 줄 {rt[:70]}'
    W.step('운영 화면을 새로 엶 → 그 카드에 「열람 1」 · 배정 현황 「열람(과금)」 · 열람한 배정에는 거두기 칸이 없음', '운영 화면', bo_viewed)

    def bo_close():
        if not L: return 'skip', '리드가 만들어지지 않아 종료할 것이 없음'
        if q(f"select assign_state from leads where id='{L}'") == 'CLOSED': return True, '이미 종료됨'
        try:
            bo, card = bo_open(reload=True)
            card.locator('button', has_text='후보 · 배정').click()
            btn = card.locator('button', has_text='신청 종료'); btn.wait_for(state='visible', timeout=30000)
            P['dlg']['next'].append(f'flow_plaza 흐름 점검 신청 — 시험 뒤 정리 {TAG}')
            btn.click()
            for _ in range(30):
                if q(f"select assign_state from leads where id='{L}'") == 'CLOSED': break
                bo.wait_for_timeout(500)
            st = q(f"select assign_state from leads where id='{L}'")
            asked = [m for ty, m in P['dlg']['seen'] if ty == 'prompt']
            return st == 'CLOSED', f'DB {st} · 입력 창 {asked[-1:]}'
        except Exception as ex:
            S['close_ui_err'] = norm(repr(ex))[:160]
            return False, '운영 화면에서 종료하지 못함 — ' + S['close_ui_err']
    W.step('(정리) 운영 화면의 그 카드에서 「신청 종료」를 누르고 사유를 적음(화면이 POST /admin/leads/{id}/close 를 부름) → 종료', '운영 화면', bo_close, always=True)

    def api_close():
        if not L: return 'skip', '리드가 만들어지지 않아 종료할 것이 없음'
        if q(f"select assign_state from leads where id='{L}'") == 'CLOSED': return 'skip', '운영 화면에서 이미 종료되어 운영 API 를 따로 부르지 않음'
        st, j = call('POST', f'/admin/leads/{L}/close', S['ADM'], {'reason': f'flow_plaza 흐름 점검 신청 — 시험 뒤 정리 {TAG}'})
        return st < 300, f'응답 {st} {str(j)[:120]}'
    if S.get('lead') and q(f"select assign_state from leads where id='{L}'") != 'CLOSED':
        W.step('(정리) 운영 화면에서 종료되지 않아 운영 API POST /admin/leads/{id}/close 로 종료', 'API', api_close, always=True)

    def db_close():
        if not L: return 'skip', '리드가 만들어지지 않음'
        x = rows(f"select assign_state, coalesce(close_reason,''), (closed_at is not null)::text, (closed_by = (select id from accounts where email='admin@x.com'))::text from leads where id='{L}'")[0]
        left = q(f"select count(*) from lead_deliveries where lead_id='{L}' and state='DELIVERED'")
        f = rows(f"select amount::int, state from lead_fees where delivery_id='{D}'")
        keep = (len(f) == 1 and f[0][1] == 'BILLED') if S.get('fee_ok') else len(f) == 0      # v10.31 선불 — 차감된 그대로(BILLED)
        return x[0] == 'CLOSED' and TAG in x[1] and x[2] == 'true' and x[3] == 'true' and left == '0' and keep, f'{x[0]} · 사유 {x[1][:40]!r} · 종료한 사람 admin {x[3]} · 열지 않은 배정 {left}건 · 이용료 {f}'
    W.step('DB — leads: 「종료」(CLOSED) · 사유 · 종료한 사람 · 열지 않은 배정 0건 · 이미 열람해 생긴 이용료는 그대로 남음(무효가 되지 않음)', 'DB', db_close, always=True)

    def park():
        if not S.get('pid'): return 'skip', '업체가 만들어지지 않음'
        st, j = call('POST', '/partner/regions', S['p_tok'], {'regions': [{'sido': '시험도', 'sigungu': GU}]})
        left = q(f"select count(*) from v_consult_eligible_partner e where e.partner_id='{S['pid']}' and e.sido='{SIDO}'")
        now = rows(f"select sido, sigungu from partner_regions where partner_id='{S['pid']}'")
        return st < 300 and left == '0' and now == [['시험도', GU]], f'응답 {st} · 그 업체의 활동 지역 {now} · 제주에서 받을 수 있는 업체로 남은 줄 {left}'
    W.step('(정리) 시험 업체의 활동 지역을 신청서에서 고를 수 없는 「시험도」로 옮김 — 「청소」 상세의 제주 업체 수가 시험 전과 같아지고 다시 배정받지 않음(업체를 내리는 API 가 없어 지역만 옮김 · 업체 수 전체는 1곳 늚)', 'API', park, always=True)

    clean(W, w0)
    bctx.close(); pctx.close()


# ══════════════════════════════════════════════════════════════════════════════════════════
def p3(b):
    W = Flw('P3 소개광장 글쓰기 → 검수 → 목록 → 상세 → 댓글', '글쓴이 · 댓글 쓰는 사람: 이 시험이 새로 만드는 회원 2명 · 운영자 admin@x.com · 로그인하지 않은 방문자')
    w0 = len(W_ALL)
    KW = f'flw{TAG}'                                              # 글에만 있는 낱말 — 검색 · 찾기에 씁니다
    TITLE = f'{KW} 소개비 세금계산서는 누가 끊나요'
    BODY = f'흐름 점검 글입니다 {TAG}. 소개로 거래가 성사되면 세금계산서는 누가 발행하는지 궁금합니다.'
    CMT = f'댓글입니다 {TAG} — 보통 판매자가 발행합니다.'
    REPLY = f'답글입니다 {TAG} — 알려 주셔서 고맙습니다.'
    P = {}

    def prep():
        a = signup('flw', '박글쓴'); c = signup('flw', '최댓글')
        S.update(a_email=a[0], a_pw=a[1], a_tok=a[2], a_id=a[3], c_email=c[0], c_pw=c[1], c_tok=c[2], c_id=c[3])
        W.who(f'글쓴이 {a[0]}(새 회원 「박글쓴」) · 댓글 쓰는 사람 {c[0]}(새 회원 「최댓글」) · 운영자 admin@x.com · 로그인하지 않은 방문자')
        return bool(a[2] and a[3] and c[2] and c[3]), f'{a[0]} · {c[0]}'
    W.step('(준비) 새 회원 두 명을 만듦 — 글쓴이 「박글쓴」 · 댓글 쓸 사람 「최댓글」', 'API', prep, must=True)

    actx = ctx_new(b); gctx = ctx_new(b); cctx = ctx_new(b); bctx = ctx_new(b, 1440, 900)
    g = watched(gctx.new_page(), 'P3 방문자')

    def to_write():
        ap = login_site(actx, S['a_email'], S['a_pw'], 'P3 글쓴이'); P['a'] = ap; P['adlg'] = dialogs(ap)
        if '/login' in ap.url: return False, '로그인하지 못함 ' + ap.url
        goto(ap, '/community')
        ap.locator('a.plz-write').click(); ap.wait_for_url('**/community/write', timeout=20000); ap.wait_for_selector('form.cmu-editor', timeout=20000)
        return norm(text(ap, '.plz-body h1')) == '글쓰기' and '첫 글은 확인 후 올라갑니다' in text(ap, 'form.cmu-editor'), ap.url
    W.step('글쓴이로 로그인 → 소개광장(/community) 목록 아래 「글쓰기」를 누름 → 글쓰기 화면(「첫 글은 확인 후 올라갑니다」 안내)', '화면', to_write, must=True)

    def write():
        ap = P['a']; f = ap.locator('form.cmu-editor')
        f.locator('input.inp').first.fill(TITLE); f.locator('textarea.inp').first.fill(BODY)
        f.locator('input.inp').first.click()      # v10.31 (w1) — 시안처럼 추천 단추 없이: 내용 칸을 벗어나면 저절로 읽음
        try: ap.wait_for_selector('.cmu-guess', timeout=15000); guess = norm(text(ap, '.cmu-guess'))[:70]
        except Exception: guess = '(추천 결과가 나오지 않음)'
        f.locator('.cmu-opt[data-board=TRADE]').click()
        f.locator('.p2act button.p2primary').click()
        ap.wait_for_url(re.compile(r'/community/[0-9a-f-]{36}\?posted='), timeout=25000); ap.wait_for_selector('.plz-post', timeout=20000)
        S['post'] = re.search(r'/community/([0-9a-f-]{36})', ap.url).group(1)
        t = norm(text(ap, '.plz-body'))
        ok = 'posted=PENDING' in ap.url and '첫 글이라 확인 후 다른 분들께 보입니다' in t and '검수 중 · 나만 보임' in t and norm(text(ap, '.plz-post h1')) == TITLE and BODY in t
        return ok, f'{ap.url.split("/community/")[1][:60]} · 추천 {guess!r}'
    W.step('제목 · 내용을 쓰면(내용 칸을 벗어날 때 저절로 읽음) → 「업종 이야기」 칩을 고르고 「올리기」 → 글 상세로 넘어가 「첫 글이라 확인 후 다른 분들께 보입니다」 · 「검수 중 · 나만 보임」', '화면', write, must=True)

    def db_state(want, extra=''):
        def fn():
            x = rows(f"select state, board, author_id, comment_count{extra} from posts where id='{S['post']}'")[0]
            return x[0] == want and x[1] == 'TRADE' and x[2] == S['a_id'], f'상태 {x[0]} · 게시판 {x[1]} · 글쓴이 맞음 {x[2] == S["a_id"]} · 댓글 수 {x[3]}'
        return fn
    W.step('DB — posts 한 줄: 「검수 대기」(PENDING) · 업종 이야기(TRADE) · 글쓴이', 'DB', db_state('PENDING'))

    def find(pg, kw=None, want=None):
        """검색 칸에 낱말을 넣고 찾습니다 → (줄 수, 줄 글)"""
        if '/community' not in pg.url or pg.locator('.plz-find input[name=q]').count() == 0: goto(pg, '/community')
        pg.fill('.plz-find input[name=q]', kw or KW); pg.press('.plz-find input[name=q]', 'Enter')
        pg.wait_for_url(re.compile(r'[?&]q=' + (kw or KW)), timeout=20000); pg.wait_for_load_state('networkidle')
        pg.wait_for_selector('.plz-found', timeout=20000)
        trs = [norm(x) for x in pg.locator('table.plz-tbl tbody tr').all_inner_texts()]
        return len(trs), trs

    def pending_guest():
        st = goto(g, f"/community/{S['post']}")
        t = norm(text(g, '.plz-body')); html = g.content()
        n, _ = find(g)
        return st == 200 and '검수 중인 글' in t and '검수 중입니다' in t and TITLE not in html and BODY[:20] not in html and n == 0, f'상세 {t[:60]!r} · 제목 · 본문 안 보임 {TITLE not in html and BODY[:20] not in html} · 검색 {n}건'
    W.step('검수 중 — 로그인하지 않은 사람이 그 글 주소를 열면 「검수 중인 글」만 보이고 제목 · 본문은 없음 · 목록 검색에도 나오지 않음', '화면', pending_guest)

    def pending_mine():
        n, trs = find(P['a'])
        return n == 1 and TITLE in trs[0] and '검수 중 · 나만 보임' in trs[0], f'{n}건 {trs[:1]}'
    W.step('글쓴이 자신이 목록에서 찾으면 그 글이 「검수 중 · 나만 보임」 표시와 함께 보임(글이 사라진 것처럼 보이지 않음)', '화면', pending_mine)

    def approve():
        bo = watched(bo_login(bctx, 'admin@x.com'), 'P3 운영 화면'); P['bo'] = bo; dialogs(bo)
        if not bo_tab(bo, '소개광장 검수'): return False, '「소개광장 검수」 탭을 찾지 못함'
        row = bo.locator('.bo-main table.tbl tbody tr', has_text=TITLE)
        row.first.wait_for(state='visible', timeout=30000)
        t = norm(row.first.inner_text())
        btn = exact_btn(row.first, '승인')
        if not btn: return False, '「승인」 단추가 없음 · ' + t[:100]
        btn.click()
        for _ in range(30):
            if q(f"select state from posts where id='{S['post']}'") == 'PUBLISHED': break
            bo.wait_for_timeout(500)
        bo.wait_for_timeout(1200)
        gone = bo.locator('.bo-main table.tbl tbody tr', has_text=TITLE).count() == 0
        return '박글쓴' in t and 'TRADE' in t and gone and q(f"select state from posts where id='{S['post']}'") == 'PUBLISHED', f'검수 줄 {t[:90]!r} · 승인 뒤 대기 표에서 빠짐 {gone}'
    W.step('운영 화면 「소개광장 검수」 → 「첫 글 검수」 표에 그 글(제목 · 작성자 이름 「박글쓴」)이 있음 → 「승인」을 누름 → 대기 표에서 빠짐', '운영 화면', approve, must=True)
    W.step('DB — posts: 「공개」(PUBLISHED)', 'DB', db_state('PUBLISHED'))

    def list_guest():
        st = goto(g, '/community')
        trs = g.locator('table.plz-tbl tbody tr', has_text=TITLE)
        if trs.count() != 1: return False, f'/community {st} · 1쪽에서 그 글 {trs.count()}줄'
        cells = [norm(x) for x in trs.first.locator('td').all_inner_texts()]
        html = g.content()
        return cells[1] == '업종 이야기' and cells[2] == '박OO' and '박글쓴' not in html and bool(re.fullmatch(r'20\d\d\.\d\d\.\d\d', cells[3])), f'줄 {cells}'
    W.step('로그인하지 않은 사람 — 소개광장 목록 1쪽에 그 글이 보임 · 분류 「업종 이야기」 · 작성자는 「박OO」(이름 전체는 화면 어디에도 없음)', '화면', list_guest)

    def search_guest():
        n, trs = find(g)
        found = norm(text(g, '.plz-found'))
        return n == 1 and TITLE in trs[0] and '1건' in found, f'{found!r} · {trs[:1]}'
    W.step('검색 칸에 그 글의 낱말을 넣고 찾음 → 「검색 결과 1건」 · 그 글 한 줄', '화면', search_guest)

    def detail_guest():
        g.locator('table.plz-tbl tbody tr td a', has_text=TITLE).first.click()
        g.wait_for_url(f"**/community/{S['post']}", timeout=20000); g.wait_for_selector('.plz-post', timeout=20000)
        meta = norm(text(g, '.plz-post .plz-meta')); body = norm(text(g, '.plz-post .doc-body'))
        ok = (norm(text(g, '.plz-post h1')) == TITLE and body == norm(BODY) and '박OO' in meta and '조회' in meta and '박글쓴' not in g.content()
              and g.locator('form.cmu-cform').count() == 0 and g.locator('.plz-body a[href="/login"]').count() >= 1 and '아직 댓글이 없습니다' in text(g, '.plz-body'))
        n_form = g.locator('form.cmu-cform').count(); n_login = g.locator('.plz-body a[href="/login"]').count()
        return ok, f'작성자 줄 {meta!r} · 댓글 칸 {n_form}개 · 로그인 안내 {n_login}개'
    W.step('검색 결과에서 제목을 누름 → 글 상세(제목 · 본문 · 작성자 「박OO」 · 조회 수) · 로그인하지 않으면 댓글 칸 대신 「로그인하시면 댓글을 다실 수 있습니다」', '화면', detail_guest, must=True)

    def comment():
        cp = login_site(cctx, S['c_email'], S['c_pw'], 'P3 댓글 회원'); P['c'] = cp
        if '/login' in cp.url: return False, '로그인하지 못함 ' + cp.url
        goto(cp, f"/community/{S['post']}")
        f = cp.locator('form.cmu-cform').last
        f.locator('textarea[name=body]').fill(CMT); f.locator('button.p2primary').click()
        cp.locator('.cmu-cmt', has_text=CMT).first.wait_for(state='visible', timeout=25000)
        t = norm(cp.locator('.cmu-cmt', has_text=CMT).first.inner_text())
        return t.startswith('최OO') and '최댓글' not in cp.content() and '댓글 1' in text(cp, '.plz-body') and cp.locator('.plz-body .p2act a', has_text='수정').count() == 0, f'{t[:70]!r} · 남의 글이라 수정 · 삭제 단추 없음 {cp.locator(".plz-body .p2act a", has_text="수정").count() == 0}'
    W.step('다른 회원(최댓글)이 로그인해 그 글에 댓글을 씀 → 댓글이 「최OO」 이름으로 보임 · 「댓글 1」 · 남의 글이라 수정 · 삭제 단추는 없음', '화면', comment, must=True)

    def db_cmt():
        r = rows(f"select id, author_id, (parent_id is null)::text, state from post_comments where post_id='{S['post']}' order by created_at")
        cc = q(f"select comment_count from posts where id='{S['post']}'")
        if len(r) >= 1: S['cmt'] = r[0][0]
        return len(r) == 1 and r[0][1] == S['c_id'] and r[0][2] == 'true' and cc == '1', f'댓글 {len(r)}건 · 글의 댓글 수 {cc}'
    W.step('DB — post_comments 1건(쓴 사람 = 최댓글) · 글의 댓글 수(comment_count) 1', 'DB', db_cmt)

    def reply():
        ap = P['a']; goto(ap, f"/community/{S['post']}")
        tg = ap.locator('.plz-body button.link-btn', has_text='답글')
        if tg.count() != 1: return False, f'「답글」 단추 {tg.count()}개'
        tg.click()
        f = ap.locator('form.cmu-cform', has=ap.locator('textarea[aria-label="답글"]'))
        f.locator('textarea').fill(REPLY); f.locator('button.p2primary').click()
        re_ = ap.locator('.cmu-cmt.re', has_text=REPLY); re_.first.wait_for(state='visible', timeout=25000)
        t = norm(re_.first.inner_text())
        order = [norm(x)[:12] for x in ap.locator('.cmu-cmt').all_inner_texts()]
        return t.startswith('박OO') and '댓글 2' in text(ap, '.plz-body') and len(order) == 2 and order[0].startswith('최OO'), f'답글 {t[:60]!r} · 순서 {order}'
    W.step('글쓴이가 그 댓글의 「답글」을 눌러 답글을 씀 → 댓글 바로 아래 들여쓴 답글(「박OO」) · 「댓글 2」', '화면', reply)

    def db_reply():
        r = rows(f"select coalesce(parent_id::text,''), author_id from post_comments where post_id='{S['post']}' order by created_at")
        cc = q(f"select comment_count from posts where id='{S['post']}'")
        n, trs = find(g)
        return len(r) == 2 and r[1][0] == S.get('cmt') and r[1][1] == S['a_id'] and cc == '2' and n == 1 and '[2]' in trs[0], f'댓글 {len(r)}건 · 답글의 윗댓글이 그 댓글 {len(r) == 2 and r[1][0] == S.get("cmt")} · 댓글 수 {cc} · 목록 줄 {trs[:1]}'
    W.step('DB — 답글의 윗댓글(parent_id)이 그 댓글 · 댓글 수 2 / 목록에서 제목 옆에 [2] 가 보임', 'DB', db_reply)

    def delete():
        if not S.get('post'): return 'skip', '글이 만들어지지 않아 지울 것이 없음'
        if q(f"select state from posts where id='{S['post']}'") == 'DELETED': return True, '이미 지워짐'
        if 'a' not in P: return False, '글쓴이 화면이 열리지 않음'
        ap = P['a']; goto(ap, f"/community/{S['post']}")
        btn = exact_btn(ap.locator('.plz-body .p2act').first, '삭제')
        if not btn: return False, '「삭제」 단추가 없음'
        btn.click(); ap.wait_for_url('**/community?deleted=1', timeout=25000); ap.wait_for_load_state('networkidle')
        asked = [m for ty, m in P['adlg']['seen'] if ty == 'confirm']
        note = norm(text(ap, '.plz-body .ok-note'))
        return '글을 지웠습니다' in note and any('지우시겠습니까' in m for m in asked), f'확인 창 {asked[-1:]} · 안내 {note!r}'
    W.step('글쓴이가 자기 글에서 「삭제」를 누름(확인 창에서 확인) → 목록으로 돌아가고 「글을 지웠습니다. 달린 댓글은 남습니다.」', '화면', delete, always=True)

    def api_delete():
        st, j = call('DELETE', f"/me/community/posts/{S['post']}", S['a_tok'])
        return st < 300 and (j or {}).get('ok') is not False, f'응답 {st} {str(j)[:100]}'
    if S.get('post') and q(f"select state from posts where id='{S['post']}'") != 'DELETED':
        W.step('(정리) 화면에서 지워지지 않아 글쓴이의 API DELETE /me/community/posts/{id} 로 지움', 'API', api_delete, always=True)

    def db_del():
        if not S.get('post'): return 'skip', '글이 만들어지지 않음'
        x = rows(f"select state, (hidden_at is not null)::text, (select count(*) from post_comments c where c.post_id = p.id) from posts p where id='{S['post']}'")[0]
        return x[0] == 'DELETED', f'상태 {x[0]} · 지운 시각 있음 {x[1]} · 달린 댓글 {x[2]}건은 남음'
    W.step('DB — posts: 「삭제」(DELETED — 줄을 없애지 않고 상태만 바꿈) · 달린 댓글은 남음', 'DB', db_del, always=True)

    def gone():
        n1, _ = find(g)
        st = goto(g, '/community'); on1 = g.locator('table.plz-tbl tbody tr', has_text=TITLE).count()
        n2, _ = find(P['a']) if 'a' in P else (0, [])
        return n1 == 0 and on1 == 0 and n2 == 0, f'방문자 검색 {n1}건 · 목록 1쪽 {on1}줄 · 글쓴이 검색 {n2}건'
    W.step('목록 · 검색에서 그 글이 사라짐(로그인하지 않은 사람 · 글쓴이 모두)', '화면', gone)

    def g173():
        st = goto(g, f"/community/{S['post']}")
        html = g.content(); t = norm(text(g, '.plz-body'))
        see_t = TITLE in html; see_b = BODY[:24] in html; see_c = CMT[:12] in html
        api = call('GET', f"/community/posts/{S['post']}")[1] or {}
        return (not see_t and not see_b), (f'삭제한 글 주소가 {st} 로 열리고 제목 보임 {see_t} · 본문 보임 {see_b} · 댓글 보임 {see_c}. '
            f'API GET /community/posts/{{id}} 도 state={api.get("state")} 인 글의 title · body 를 그대로 내려줌(G-173 · src/modules/community/community.service.ts:116-156 post() 가 HIDDEN · PENDING 만 가르고 DELETED 는 가르지 않음)' if see_t or see_b
            else f'{st} · 제목 · 본문이 보이지 않음 · 화면 {t[:60]!r}')
    W.step('삭제 뒤 로그인하지 않은 사람이 그 글 주소(/community/{id})를 엶 → 제목 · 본문이 보이지 않아야 함', '화면', g173)

    clean(W, w0)
    for c in (actx, gctx, cctx, bctx): c.close()


# ══════════════════════════════════════════════════════════════════════════════════════════
def p4(b):
    W = Flw('P4 투표 참여 → 결과 → 다시 참여 막힘', '운영자 admin@x.com · 로그인하지 않은 방문자 2명(서로 다른 브라우저)')
    w0 = len(W_ALL)
    TITLE = f'흐름 점검 {TAG} 소개받아 살 때 무엇을 먼저 보시나요?'
    HOME0 = sorted(r[0] for r in rows('select id from v_poll_home'))
    SET0 = {k: q(f"select coalesce(value,'') from site_settings where key='{k}'") for k in ('poll.guest_vote', 'poll.guest_ip_daily_limit')}
    P = {}
    row = lambda: f'[data-polls-admin] tr[data-poll="{S["poll"]}"]'
    card = lambda: f'.poll-card[data-poll="{S["poll"]}"]'
    votes = lambda: int(q(f"select count(*) from poll_votes where poll_id='{S['poll']}'"))
    def res(pg, sel=None):
        """카드의 보기별 결과 — {보기: '50% · 1표'}"""
        out = {}
        for li in pg.locator((sel or card()) + ' ul li').all():
            lab = norm(li.locator('.poll-ol span').first.inner_text()) if li.locator('.poll-ol span').count() else norm(li.inner_text())
            out[lab] = norm(li.locator('em').inner_text()) if li.locator('em').count() else ''
        return out

    bctx = ctx_new(b, 1440, 900); v1 = ctx_new(b); v2 = ctx_new(b)

    def create():
        bo = watched(bo_login(bctx, 'admin@x.com'), 'P4 운영 화면'); P['bo'] = bo; P['dlg'] = dialogs(bo)
        if not bo_tab(bo, '이건 어때? 투표'): return False, '「이건 어때? 투표」 탭을 찾지 못함'
        bo.wait_for_selector('[data-poll-create]', timeout=30000)
        bo.select_option('select[name=poll-kind]', 'ASK'); bo.fill('input[name=poll-title]', TITLE)
        bo.fill('input[name=poll-desc]', '흐름 점검용 투표입니다 — 시험이 끝나면 감춥니다.')
        bo.fill('textarea[name=poll-options]', '가격 | 싸면 좋다\n품질\n사후 관리')
        if not bo.is_checked('input[name=poll-home]'): bo.check('input[name=poll-home]')
        bo.locator('[data-poll-create] button').click()
        for _ in range(40):
            S['poll'] = q(f"select id from polls where title='{TITLE}'")
            if S['poll']: break
            bo.wait_for_timeout(500)
        if not S.get('poll'): return False, '투표가 만들어지지 않음 · ' + norm(bo_main(bo))[:120]
        bo.wait_for_selector(row(), timeout=20000)
        t = norm(bo.locator(row()).inner_text())
        return bo.get_attribute(row(), 'data-state') == 'DRAFT' and '준비 중' in t and '궁금해요' in t, t[:120]
    W.step('운영 화면 「이건 어때? 투표」에서 새 투표를 만듦(궁금해요 · 제목 · 보기 3개 · 메인에 내기) → 목록에 「준비 중」으로 생김', '운영 화면', create, must=True)

    def db_draft():
        x = rows(f"select state, kind, show_on_home::text, sort, (select count(*) from poll_options o where o.poll_id = p.id), (select string_agg(label, ',' order by sort) from poll_options o where o.poll_id = p.id) from polls p where id='{S['poll']}'")[0]
        return x[:5] == ['DRAFT', 'ASK', 'true', '0', '3'] and x[5] == '가격,품질,사후 관리' and votes() == 0, f'{x} · 표 {votes()}'
    W.step('DB — polls 한 줄: 「준비 중」(DRAFT) · 보기 3개(가격 · 품질 · 사후 관리) · 표 0', 'DB', db_draft)

    def not_yet():
        a = watched(v1.new_page(), 'P4 방문자①'); P['a'] = a
        st = goto(a, '/community/polls')
        return st == 200 and a.locator(card()).count() == 0 and call('GET', f"/community/polls/{S['poll']}")[0] == 404, f'/community/polls {st} · 그 투표 카드 {a.locator(card()).count()}개'
    W.step('「준비 중」일 때는 사용자 화면(/community/polls)에 그 투표가 나오지 않음', '화면', not_yet)

    def open_():
        bo = P['bo']; btn = exact_btn(bo.locator(row()), '열기')
        if not btn: return False, '「열기」 단추가 없음'
        btn.click()
        bo.wait_for_selector(row() + '[data-state="OPEN"]', timeout=20000)
        t = norm(bo.locator(row()).inner_text())
        return '진행 중' in t and '나가는 중' in t, t[:140]
    W.step('운영 화면에서 그 투표의 「열기」를 누름 → 「진행 중」 · 메인에 「나가는 중」', '운영 화면', open_, must=True)
    W.step('DB — polls: 「진행 중」(OPEN) · 연 시각이 기록됨', 'DB', lambda: (q(f"select state||'|'||(opened_at is not null)::text from polls where id='{S['poll']}'") == 'OPEN|true', q(f"select state||'|'||(opened_at is not null)::text from polls where id='{S['poll']}'")))

    def wait_guest_on():
        for _ in range(45):                                   # 다른 시험이 「로그인 회원만」으로 잠깐 바꿔 둘 수 있습니다 — 처음 값으로 돌아올 때까지 기다립니다
            if q("select coalesce((select value from site_settings where key='poll.guest_vote'),'on')") == 'on': return True
            time.sleep(2)
        return False

    def user_list():
        a = P['a']
        goto(a, '/community'); a.locator('.plz-tabs a[data-polls-tab]').click(); a.wait_for_url('**/community/polls', timeout=20000)
        a.wait_for_selector(card(), timeout=20000)
        c = a.locator(card()); t = norm(c.inner_text())
        ok = (c.get_attribute('data-voted') == '0' and norm(c.locator('h2').inner_text()) == TITLE and norm(c.locator('[data-total]').inner_text()) == '0명 참여'
              and c.locator('[data-vote]').count() == 1 and '%' not in t and '진행 중' in t and c.locator('[data-opt]').count() == 3)
        return ok, t[:130]
    W.step('방문자 ① — 소개광장의 「이건 어때? 투표」 탭을 누름 → 새 투표가 보임(진행 중 · 보기 3개 · 0명 참여 · 「투표하기」 · 비율은 투표 전이라 안 보임)', '화면', user_list, must=True)

    def home():
        h = watched(v1.new_page(), 'P4 방문자① 메인'); P['h'] = h
        st = goto(h, '/')
        c = h.locator(f'.home-pl[data-poll="{S["poll"]}"]')
        if c.count() != 1:
            now = h.evaluate("[...document.querySelectorAll('.home-pl')].map(x => x.dataset.kind + ':' + x.querySelector('h3').textContent.trim().slice(0, 14))")
            return False, f'메인 {st} · 그 투표 카드 {c.count()}장 · 지금 메인 카드 {now}'
        return norm(c.locator('h3').inner_text()) == TITLE and c.get_attribute('data-kind') == 'ASK' and c.get_attribute('data-voted') == '0', norm(c.inner_text())[:110]
    W.step('메인(/) 「이건 어때?」의 「궁금해요」 카드에도 그 투표가 나옴(순서가 가장 앞선 열린 투표)', '화면', home)

    def vote1():
        if not wait_guest_on(): return False, '설정 poll.guest_vote 가 90초 동안 off — 다른 시험이 바꿔 둔 것으로 보여 투표하지 못함'
        a = P['a']
        d = v1.new_page(); P['dup'] = watched(d, 'P4 방문자① 둘째 창')          # 투표 전에 같은 브라우저의 다른 창으로 열어 둡니다(뒤에서 다시 투표해 봄)
        goto(d, '/community/polls'); d.wait_for_selector(card() + ' [data-vote]', timeout=20000)
        a.locator(card() + ' .poll-opt', has_text='품질').click()
        on = a.locator(card() + ' li.on').count()
        a.locator(card() + ' [data-vote]').click(); a.wait_for_selector(card() + '[data-voted="1"]', timeout=20000)
        c = a.locator(card()); r = res(a)
        ok = (on == 1 and norm(c.locator('[data-done]').inner_text()) == '투표했습니다' and norm(c.locator('[data-total]').inner_text()) == '1명 참여'
              and r == {'가격': '0% · 0표', '품질': '100% · 1표', '사후 관리': '0% · 0표'} and c.locator('[data-vote]').count() == 0 and '투표했습니다' in norm(text(a, card() + ' .poll-msg')))
        return ok, f'{norm(c.locator("[data-total]").inner_text())} · {r} · 안내 {norm(text(a, card() + " .poll-msg"))!r}'
    W.step('방문자 ① 이 보기 「품질」을 고르고 「투표하기」를 누름 → 「투표했습니다」 · 1명 참여 · 품질 100% · 1표 · 투표 단추가 사라짐', '화면', vote1, must=True)

    def db_vote():
        ck = [c for c in v1.cookies() if c['name'] == 'sgb_visitor']
        r = rows(f"select coalesce(v.visitor_key,''), (v.account_id is null)::text, length(coalesce(v.ip_hash,'')), o.label from poll_votes v join poll_options o on o.id = v.option_id where v.poll_id='{S['poll']}'")
        if ck: S['vk'] = ck[0]['value']
        return len(r) == 1 and len(ck) == 1 and r[0] == [ck[0]['value'], 'true', '64', '품질'], f'표 {len(r)}건 · 방문자 키가 쿠키와 같음 {bool(r and ck) and r[0][0] == ck[0]["value"]} · 계정 없음 {r[0][1] if r else ""} · 주소 해시 {r[0][2] if r else ""}자 · 고른 보기 {r[0][3] if r else ""}'
    W.step('DB — poll_votes 1건: 계정 없이 방문자 키(브라우저 쿠키 sgb_visitor 와 같은 값) · 고른 보기 「품질」 · 인터넷 주소는 원문 없이 해시로만', 'DB', db_vote)

    def vote2():
        if not wait_guest_on(): return False, '설정 poll.guest_vote 가 off'
        z = watched(v2.new_page(), 'P4 방문자②'); P['z'] = z
        goto(z, '/community/polls'); z.wait_for_selector(card(), timeout=20000)
        c = z.locator(card()); before = (c.get_attribute('data-voted'), norm(c.locator('[data-total]').inner_text()), '%' in norm(c.inner_text()))
        z.locator(card() + ' .poll-opt', has_text='가격').click(); z.locator(card() + ' [data-vote]').click(); z.wait_for_selector(card() + '[data-voted="1"]', timeout=20000)
        r = res(z); tot = norm(c.locator('[data-total]').inner_text())
        return before == ('0', '1명 참여', False) and tot == '2명 참여' and r == {'가격': '50% · 1표', '품질': '50% · 1표', '사후 관리': '0% · 0표'}, f'투표 전 {before} → {tot} · {r}'
    W.step('방문자 ②(다른 브라우저)에게는 「1명 참여」로 보이고 아직 투표할 수 있음 → 「가격」에 투표 → 2명 참여 · 가격 50% · 품질 50% 로 결과가 바뀜', '화면', vote2)

    def db_by():
        r = rows(f"select o.label, count(*) from poll_votes v join poll_options o on o.id = v.option_id where v.poll_id='{S['poll']}' group by 1 order by 1")
        keys = q(f"select count(distinct visitor_key) from poll_votes where poll_id='{S['poll']}'")
        return r == [['가격', '1'], ['품질', '1']] and keys == '2', f'보기별 {r} · 방문자 키 {keys}가지'
    W.step('DB — poll_votes 2건(가격 1 · 품질 1) · 방문자 키가 서로 다름', 'DB', db_by)

    def reload1():
        a = P['a']; a.reload(wait_until='networkidle'); a.wait_for_selector(card(), timeout=20000)
        c = a.locator(card()); r = res(a); n = votes()
        want = {'가격': '50% · 1표', '품질': '50% · 1표', '사후 관리': '0% · 0표'} if n == 2 else {'가격': '0% · 0표', '품질': '100% · 1표', '사후 관리': '0% · 0표'}
        mine = norm(c.locator('li.on').inner_text()) if c.locator('li.on').count() == 1 else ''
        return c.get_attribute('data-voted') == '1' and c.locator('[data-vote]').count() == 0 and r == want and mine.startswith('품질') and norm(c.locator('[data-total]').inner_text()) == f'{n}명 참여', f'{norm(c.locator("[data-total]").inner_text())} · {r} · 내가 고른 보기 {mine[:10]!r}'
    W.step('방문자 ① 이 새로 고침 → 「투표했습니다」 그대로 · 투표 단추 없음 · 내가 고른 「품질」 표시 · 결과는 지금 표 수대로(2명 · 50% / 50%)', '화면', reload1)

    def again():
        d = P['dup']; n0 = votes()
        if d.locator(card() + ' [data-vote]').count() != 1: return False, '투표 전에 열어 둔 창에 투표 단추가 없음'
        d.locator(card() + ' .poll-opt', has_text='사후 관리').click(); d.locator(card() + ' [data-vote]').click()
        d.wait_for_selector(card() + ' .poll-msg', timeout=20000)
        msg = norm(text(d, card() + ' .poll-msg')); d.wait_for_timeout(1200)
        c = d.locator(card()); r = res(d)
        return '이미 투표하셨습니다' in msg and votes() == n0 and c.get_attribute('data-voted') == '1' and c.locator('[data-vote]').count() == 0 and r.get('사후 관리') == '0% · 0표', f'안내 {msg!r} · 표 {n0} → {votes()} · 그 창도 「투표했습니다」로 바뀜 {c.get_attribute("data-voted") == "1"}'
    W.step('방문자 ① 이 투표 전에 열어 둔 다른 창에서 다른 보기를 골라 다시 「투표하기」 → 「이미 투표하셨습니다」 · 표가 늘지 않고 그 창도 결과 화면으로 바뀜', '화면', again)

    def db_votes():
        r = rows(f"select o.label, count(*) from poll_votes v join poll_options o on o.id = v.option_id where v.poll_id='{S['poll']}' group by 1 order by 1")
        mine = q(f"select count(*) from poll_votes where poll_id='{S['poll']}' and visitor_key='{S.get('vk', '-')}'")
        return r == [['가격', '1'], ['품질', '1']] and mine == '1', f'보기별 {r} · 방문자 ① 의 표 {mine}건'
    W.step('DB — poll_votes 는 2건 그대로(가격 1 · 품질 1) · 방문자 ① 의 표는 1건뿐', 'DB', db_votes)

    def bo_count():
        bo = P['bo']; bo.reload(); bo.wait_for_timeout(1500)
        if not bo_tab(bo, '이건 어때? 투표'): return False, '탭을 찾지 못함'
        bo.wait_for_selector(row(), timeout=30000)
        t = norm(bo.locator(row()).inner_text()); n = norm(bo.locator(row() + ' td:nth-child(4)').inner_text())
        return n == str(votes()) == '2' and '가격 1표(50%) · 품질 1표(50%) · 사후 관리 0표(0%)' in t, f'참여 {n} · {t[:120]}'
    W.step('운영 화면을 새로 엶 → 그 투표의 참여 2 · 보기별 「가격 1표(50%) · 품질 1표(50%) · 사후 관리 0표(0%)」(실제 표 수 그대로)', '운영 화면', bo_count)

    LIM = int(SET0['poll.guest_ip_daily_limit']) if re.fullmatch(r'[1-9]\d{0,2}', SET0['poll.guest_ip_daily_limit']) else 5
    extra = []
    def fill_limit():
        if LIM > 8: return 'skip', f'하루 한도가 {LIM}표로 커서(8표 넘음) 이 시험에서는 채우지 않음'
        if not wait_guest_on(): return False, '설정 poll.guest_vote 가 off'
        need = LIM - votes()
        for i in range(need):
            c = ctx_new(b); extra.append(c); z = watched(c.new_page(), f'P4 방문자 {i + 3}번째')
            goto(z, '/community/polls'); z.wait_for_selector(card() + ' [data-vote]', timeout=20000)
            z.locator(card() + ' .poll-opt', has_text='사후 관리').click(); z.locator(card() + ' [data-vote]').click()
            z.wait_for_selector(card() + '[data-voted="1"], ' + card() + ' .poll-msg.err', timeout=20000)
            if z.locator(card()).get_attribute('data-voted') != '1': return False, f'{i + 3}번째 방문자의 투표가 들어가지 않음 — ' + norm(text(z, card() + ' .poll-msg'))
            P['last'] = z
        tot = norm(P['last'].locator(card() + ' [data-total]').inner_text()) if need > 0 else ''
        same = q(f"select count(distinct ip_hash)||'|'||count(*) from poll_votes where poll_id='{S['poll']}' and account_id is null")
        return votes() == LIM and tot == f'{LIM}명 참여' and same == f'1|{LIM}', f'{need}명이 더 투표 → {tot} · {res(P["last"]) if need > 0 else ""} · DB 표 {votes()}건(주소 해시 가짓수|표 수 = {same})'
    W.step(f'하루 한도 — 방문자가 {LIM}명이 될 때까지 서로 다른 브라우저(같은 인터넷 주소)로 「사후 관리」에 차례로 투표 → {LIM}명 참여 · DB 에 같은 주소 해시로 {LIM}건', '화면', fill_limit)

    def over_limit():
        if LIM > 8: return 'skip', f'하루 한도가 {LIM}표로 커서 채우지 않음'
        if votes() != LIM: return 'skip', f'앞 단계에서 표를 한도({LIM})까지 채우지 못함(지금 {votes()}건)'
        c = ctx_new(b); extra.append(c); z = watched(c.new_page(), 'P4 한도를 넘는 방문자')
        goto(z, '/community/polls'); z.wait_for_selector(card() + ' [data-vote]', timeout=20000)
        z.locator(card() + ' .poll-opt', has_text='가격').click(); z.locator(card() + ' [data-vote]').click()
        z.wait_for_selector(card() + ' .poll-msg', timeout=20000); z.wait_for_timeout(600)
        msg = norm(text(z, card() + ' .poll-msg'))
        ok = f'오늘 넣을 수 있는 표 수({LIM}건)를 넘었습니다' in msg and '로그인하면 투표할 수 있습니다' in msg and votes() == LIM and z.locator(card()).get_attribute('data-voted') == '0'
        return ok, f'안내 {msg!r} · 표 {votes()}건 그대로'
    W.step(f'하루 한도 — 그 다음 방문자(같은 인터넷 주소 · 새 브라우저)가 투표하면 막힘: 「같은 인터넷 주소에서 오늘 넣을 수 있는 표 수({LIM}건)를 넘었습니다 — 로그인하면 투표할 수 있습니다」 · 표가 늘지 않음', '화면', over_limit)

    def hide():
        if not S.get('poll'): return 'skip', '투표가 만들어지지 않아 감출 것이 없음'
        if q(f"select state from polls where id='{S['poll']}'") == 'HIDDEN': return True, '이미 감춤'
        try:
            bo = P['bo']
            if bo.locator(row()).count() == 0:
                bo.reload(); bo.wait_for_timeout(1500); bo_tab(bo, '이건 어때? 투표'); bo.wait_for_selector(row(), timeout=30000)
            P['dlg']['next'].append(f'흐름 점검 자료 정리 {TAG}')
            exact_btn(bo.locator(row()), '감추기').click()
            bo.wait_for_selector(row() + '[data-state="HIDDEN"]', timeout=20000)
            t = norm(bo.locator(row()).inner_text())
            return '감춤' in t and f'감춘 사유: 흐름 점검 자료 정리 {TAG}' in t, t[:130]
        except Exception as ex:
            return False, '운영 화면에서 감추지 못함 — ' + norm(repr(ex))[:160]
    W.step('(정리) 운영 화면에서 그 투표의 「감추기」를 누르고 사유를 적음 → 「감춤」 · 감춘 사유가 줄에 보임', '운영 화면', hide, always=True)

    def api_hide():
        st, j = call('PATCH', f"/admin/community/polls/{S['poll']}", S['ADM'], {'state': 'HIDDEN', 'hiddenReason': f'흐름 점검 자료 정리 {TAG}'})
        return st < 300, f'응답 {st} {str(j)[:100]}'
    if S.get('poll') and q(f"select state from polls where id='{S['poll']}'") != 'HIDDEN':
        W.step('(정리) 운영 화면에서 감춰지지 않아 운영 API PATCH /admin/community/polls/{id} 로 감춤', 'API', api_hide, always=True)

    def db_hidden():
        if not S.get('poll'): return 'skip', '투표가 만들어지지 않음'
        x = rows(f"select state, coalesce(hidden_reason,'') from polls where id='{S['poll']}'")[0]
        return x[0] == 'HIDDEN' and TAG in x[1], f'{x} · 넣은 표 {votes()}건은 남음(표는 지울 수 없음)'
    W.step('DB — polls: 「감춤」(HIDDEN) · 사유 저장 · 넣은 표는 그대로 남음', 'DB', db_hidden, always=True)

    def after():
        if not S.get('poll'): return 'skip', '투표가 만들어지지 않음'
        a = P.get('a') or watched(v1.new_page(), 'P4 방문자①')
        goto(a, '/community/polls'); n_list = a.locator(card()).count()
        goto(a, '/'); n_home = a.locator(f'.home-pl[data-poll="{S["poll"]}"]').count()
        shown = sorted(a.evaluate("[...document.querySelectorAll('.home-pl')].map(x => x.dataset.poll)"))
        home_now = sorted(r[0] for r in rows('select id from v_poll_home'))
        set_now = {k: q(f"select coalesce(value,'') from site_settings where key='{k}'") for k in SET0}
        st = call('GET', f"/community/polls/{S['poll']}")[0]
        return n_list == 0 and n_home == 0 and st == 404 and home_now == HOME0 and shown == HOME0 and set_now == SET0, f'목록 {n_list} · 메인 {n_home} · 메인 카드가 처음 3건과 같음 {shown == HOME0} · 투표 설정 처음 값 그대로 {set_now == SET0} {set_now}'
    W.step('감춘 뒤 사용자 화면 — 투표 목록 · 메인에서 그 투표가 사라지고 메인의 세 장이 처음의 투표로 돌아옴 · 투표 설정(비로그인 허용 · 하루 한도)은 처음 값 그대로', '화면', after, always=True)

    clean(W, w0, allow=[r'^409 POST /community/polls/[0-9a-f-]+/vote', r'^422 POST /community/polls/[0-9a-f-]+/vote'])      # 다시 투표(409) · 하루 한도(422) — 뜻한 것
    for c in [bctx, v1, v2] + extra: c.close()


# ══════════════════════════════════════════════════════════════════════════════════════════
def p5(b):
    W = Flw('P5 신고 → 글 가림', '글쓴이 · 신고하려는 사람: 이 시험이 새로 만드는 회원 2명 · 운영자 admin@x.com · 로그인하지 않은 방문자')
    w0 = len(W_ALL)
    KW = f'flr{TAG}'
    TITLE = f'{KW} 권리금 계약서에 꼭 넣을 것'
    BODY = f'흐름 점검 글입니다 {TAG}. 권리금 계약서에 꼭 넣어야 하는 조항이 무엇인지 궁금합니다.'
    REASON = f'흐름 점검 — 신고 확인 중 가림 {TAG}'
    P = {}

    def prep():
        a = signup('flw', '정가림'); r = signup('flw', '한신고')
        S.update(h_email=a[0], h_pw=a[1], h_tok=a[2], h_id=a[3], r_email=r[0], r_pw=r[1], r_tok=r[2])
        W.who(f'글쓴이 {a[0]}(새 회원 「정가림」) · 신고하려는 사람 {r[0]}(새 회원 「한신고」 · 본인인증 함) · 운영자 admin@x.com · 로그인하지 않은 방문자')
        st, j = call('POST', '/me/community/posts', a[2], {'board': 'QNA', 'title': TITLE, 'body': BODY})
        S['hpost'] = (j or {}).get('id')
        st2, j2 = call('POST', f"/admin/community/posts/{S['hpost']}/approve", S['ADM'])
        st3 = call('POST', '/verifications/identity', r[2], {'provider': 'PASS'})[0]          # 신고는 본인인증한 회원만 받습니다
        state = q(f"select state from posts where id='{S['hpost']}'") if S['hpost'] else ''
        return st < 300 and (j or {}).get('state') == 'PENDING' and st2 < 300 and state == 'PUBLISHED' and st3 < 300, f'글쓰기 {st} {(j or {}).get("state")} · 승인 {st2} · DB {state} · 신고할 회원 본인인증 {st3}'
    W.step('(준비) 새 회원 「정가림」이 글을 쓰고(첫 글 → 검수 대기) 운영이 승인해 공개된 글을 만듦 · 신고할 회원 「한신고」는 본인인증까지 마침', 'API', prep, must=True)

    rctx = ctx_new(b); gctx = ctx_new(b); actx = ctx_new(b); bctx = ctx_new(b, 1440, 900)
    g = watched(gctx.new_page(), 'P5 방문자')

    def look_report():
        # v10.27 (G-191) — 글 상세의 「신고」 → 신고 화면(/report/post/{글}) → 사유 고르고 「신고하기」
        rp = login_site(rctx, S['r_email'], S['r_pw'], 'P5 신고하려는 회원'); P['r'] = rp
        st = goto(rp, f"/community/{S['hpost']}")
        seen = norm(text(rp, '.plz-post h1')) == TITLE
        lk = rp.locator('a[data-report-post]')
        if not lk.count(): return False, f'글 상세({st} · 글은 보임 {seen})에 「신고」가 없음'
        href = lk.first.get_attribute('href'); lk.first.click()
        try: rp.wait_for_url(re.compile(r'/report/post/'), timeout=20000)
        except Exception: pass
        rp.wait_for_timeout(800)
        rp.locator('.opts button.opt').first.click(); rp.wait_for_timeout(200)
        ta = rp.locator('textarea.inp')
        if ta.count(): ta.fill(f'흐름 점검 신고 {TAG}')
        rp.locator('button.btn-primary', has_text='신고하기').click()
        n = until(lambda: q(f"select count(*) from reports where target_id='{S['hpost']}'") == '1' or None, 20)
        rc = q(f"select report_count from posts where id='{S['hpost']}'"); stt = q(f"select state from posts where id='{S['hpost']}'")
        S['rep_ui'] = (seen, href, rc, stt)
        return bool(n) and rc == '1' and stt == 'PUBLISHED', f'글 상세 {st} · 「신고」 → {href} → 사유 고르고 「신고하기」 → reports 1건 {bool(n)} · 글의 신고 수 {rc} · 글은 그대로 {stt}(3건부터 가림)'
    W.step('다른 회원(한신고)이 그 글 상세에서 「신고」를 눌러 신고함 → 신고 1건 · 글은 그대로(3건부터 가림)', '화면', look_report)

    def look_comment_report():
        # v10.80 (D110) — 댓글도 신고: 글쓴이가 단 댓글을 다른 회원이 「신고」 → 신고 화면(/report/comment/{댓글}) → 신고 1건 · 댓글은 그대로(3건부터 가림)
        st0, j0 = call('POST', f"/me/community/posts/{S['hpost']}/comments", S['h_tok'], {'body': f'흐름 점검 댓글입니다 {TAG}'})
        S['hcmt'] = cid = (j0 or {}).get('id')
        if not cid: return False, f'댓글 쓰기 {st0} {j0}'
        rp = P['r']; goto(rp, f"/community/{S['hpost']}")
        link = rp.locator(f'a[data-comment-report][href="/report/comment/{cid}"]')
        if link.count() != 1: return False, f'댓글 「신고」 링크 {link.count()}개'
        link.click()
        try: rp.wait_for_url(re.compile(r'/report/comment/'), timeout=20000)
        except Exception: pass
        rp.wait_for_timeout(800)
        lead = norm(text(rp, 'p.lead'))
        rp.locator('.opts button.opt').first.click(); rp.wait_for_timeout(200)
        ta = rp.locator('textarea.inp')
        if ta.count(): ta.fill(f'흐름 점검 댓글 신고 {TAG}')
        rp.locator('button.btn-primary', has_text='신고하기').click()
        n = until(lambda: q(f"select count(*) from reports where target_type='COMMENT' and target_id='{cid}'") == '1' or None, 20)
        x = rows(f"select state, report_count from post_comments where id='{cid}'")[0]
        return bool(n) and x == ['PUBLISHED', '1'] and '소개광장 댓글' in lead, f'댓글 「신고」 → {rp.url[-60:]} · 안내 {lead[:30]!r} · reports 1건 {bool(n)} · 댓글 {x}(3건부터 가림)'
    W.step('다른 회원(한신고)이 글쓴이의 댓글에서 「신고」를 눌러 신고함(v10.80) → 신고 1건 · 댓글은 그대로(3건부터 가림)', '화면', look_comment_report)

    def api_report():
        # 같은 회원의 두 번째 신고는 세지 않음 · 받지 않는 대상 이름(COMMUNITY_POST)은 400
        code = next((x['code'] for x in (call('GET', '/report-reasons')[1] or []) if x['code'] != 'OTHER'), 'OTHER')
        s1, j1 = call('POST', '/reports', S['r_tok'], {'targetType': 'POST', 'targetId': S['hpost'], 'reasonCode': code, 'detail': f'흐름 점검 다시 {TAG}'})
        s2, j2 = call('POST', '/reports', S['r_tok'], {'targetType': 'COMMUNITY_POST', 'targetId': S['hpost'], 'reasonCode': code, 'detail': f'흐름 점검 {TAG}'})
        rc = q(f"select report_count from posts where id='{S['hpost']}'"); stt = q(f"select state from posts where id='{S['hpost']}'")
        # 같은 사람이 같은 건을 다시 신고하면 앞의 신고를 그대로 돌려줌(already) — 1건으로 셈(API 설명)
        return s1 < 300 and (j1 or {}).get('already') is True and s2 == 400 and rc == '1' and stt == 'PUBLISHED', f'같은 회원이 다시 → {s1} already={(j1 or {}).get("already")} · 대상 COMMUNITY_POST → {s2} · 글의 신고 수 {rc} · {stt}'
    W.step('같은 회원이 API 로 다시 신고(POST /reports · 대상 POST) → 앞의 신고를 그대로 돌려줌(already) · 신고 수 그대로 1 · 받지 않는 대상 이름은 400', 'API', api_report)

    def bo_find():
        # v10.79 — v10.72 「글 찾기」 · 「되살리기」(대표 결정 A: 처리 전 신고는 기각 · 신고 수 0 · 신고한 사람에게 알림)를 화면으로.
        #   (전: 운영 화면에 공개 글을 가릴 단추가 없어 「신고된 글」 표에 오르는지만 보고 건너뜀 → v10.72 뒤로는 글이 보여 「시험 한계」 실패)
        bo = watched(bo_login(bctx, 'admin@x.com'), 'P5 운영 화면'); P['bo'] = bo; box = dialogs(bo)
        if not bo_tab(bo, '소개광장 검수'): return False, '「소개광장 검수」 탭을 찾지 못함'
        bo.wait_for_selector('[data-post-finder]', timeout=30000)
        bo.fill('[data-post-finder] input[name=q]', KW); bo.click('[data-post-finder] button[type=submit]')
        row = lambda: bo.locator('[data-post-finder] table.tbl > tbody > tr', has_text=TITLE)
        if not until(lambda: row().count() == 1 or None, 20): return False, f'글 찾기에서 「{KW}」로 그 글을 찾지 못함 · {norm(text(bo, "[data-post-finder]"))[:120]}'
        box['next'].append(f'흐름 점검 화면 감추기 {TAG}')
        btn = exact_btn(row().first, '감추기')
        if not btn: return False, '찾은 줄에 「감추기」 단추가 없음'
        btn.click()
        hid = until(lambda: q(f"select state from posts where id='{S['hpost']}'") == 'HIDDEN' or None, 20)
        bo.select_option('[data-post-finder] select[aria-label="상태"]', '')           # 「모든 상태」 — 감춘 글도 보이게
        if not until(lambda: row().count() == 1 and exact_btn(row().first, '되살리기') or None, 20): return False, f'감춘 뒤 「되살리기」 단추가 없음 · 감춤 {bool(hid)}'
        box['next'].append(f'흐름 점검 화면 되살리기 {TAG}')
        exact_btn(row().first, '되살리기').click()
        back = until(lambda: q(f"select state from posts where id='{S['hpost']}'") == 'PUBLISHED' or None, 20)
        rc = q(f"select report_count from posts where id='{S['hpost']}'")
        rep = q(f"select count(*) filter (where state = 'DISMISSED') || '/' || count(*) from reports where target_type = 'POST' and target_id='{S['hpost']}'")
        rid = q(f"select id from accounts where email='{S['r_email']}'")
        nt = q(f"select count(*) from notifications where account_id='{rid}' and event_code = 'REPORT_RESOLVED'")
        ok = bool(hid) and bool(back) and rc == '0' and rep == '1/1' and nt.isdigit() and int(nt) >= 1
        return ok, f'찾음 1줄 · 「감추기」 → {"감춤" if hid else "안 바뀜"} · 「되살리기」 → {"공개" if back else "안 바뀜"} · 신고 수 {rc} · 신고 기각/전체 {rep} · 신고한 사람 알림 {nt} · 입력 창 {[m for _, m in box["seen"]][:2]}'
    W.step('운영 화면 「소개광장 검수 › 글 찾기」에서 그 글을 찾아 「감추기」(사유) → 감춤 → 「되살리기」(사유) → 공개 · 신고 수 0 · 처리 전 신고는 기각 · 신고한 사람에게 알림(v10.72 결정 A)', '운영 화면', bo_find)

    def api_hide():
        st0, j0 = call('POST', f"/admin/community/posts/{S['hpost']}/hide", S['ADM'], {'reason': '  '})
        mid = q(f"select state from posts where id='{S['hpost']}'")
        st, j = call('POST', f"/admin/community/posts/{S['hpost']}/hide", S['ADM'], {'reason': REASON})
        # v10.27 (G-201) — 사유 없이는 422 REASON_REQUIRED(전에는 201 에 ok:false)
        return st0 == 422 and (j0 or {}).get('code') == 'REASON_REQUIRED' and mid == 'PUBLISHED' and st < 300 and (j or {}).get('ok') is True, f'사유 없이 → {st0} {(j0 or {}).get("code")}(글은 {mid} 그대로) · 사유 적고 → {st} {(j or {}).get("note")!r}'
    W.step('운영자가 그 글을 다시 가림 — 운영 API POST /admin/community/posts/{id}/hide(사유 없이는 거절 · 사유를 적으면 가려짐)', 'API', api_hide, must=True)

    def db_hidden():
        x = rows(f"select state, coalesce(hidden_reason,''), (hidden_at is not null)::text from posts where id='{S['hpost']}'")[0]
        return x == ['HIDDEN', REASON, 'true'], f'{x}'
    W.step('DB — posts: 「가림」(HIDDEN) · 사유 · 가린 시각', 'DB', db_hidden)

    def hidden_guest():
        st = goto(g, f"/community/{S['hpost']}")
        t = norm(text(g, '.plz-body')); html = g.content()
        api = call('GET', f"/community/posts/{S['hpost']}")[1] or {}
        ok = st == 200 and norm(text(g, '.plz-body h1')) == '가려진 글' and '운영 기준에 따라 가려진 글입니다' in t and TITLE not in html and BODY[:20] not in html and REASON not in html and 'title' not in api and 'body' not in api and api.get('hidden') is True
        return ok, f'{st} · 화면 {t[:70]!r} · 제목 · 본문 · 사유가 화면에 없음 {TITLE not in html and BODY[:20] not in html and REASON not in html} · API 응답 칸 {sorted(api)}'
    W.step('로그인하지 않은 사람이 그 글 주소를 엶 → 「가려진 글」 자리만 보임(운영자가 가린 글이라 「운영 기준에 따라 가려진 글입니다」 · v10.76) · 제목 · 본문 · 가린 사유는 화면에도 응답에도 없음', '화면', hidden_guest)

    def hidden_list():
        goto(g, '/community'); g.fill('.plz-find input[name=q]', KW); g.press('.plz-find input[name=q]', 'Enter')
        g.wait_for_url(re.compile(r'[?&]q=' + KW), timeout=20000); g.wait_for_selector('.plz-found', timeout=20000)
        n = g.locator('table.plz-tbl tbody tr').count(); found = norm(text(g, '.plz-found'))
        return n == 0 and '0건' in found, found
    W.step('목록에서 그 글의 낱말로 찾음 → 0건(가려진 글은 목록 · 검색에 나오지 않음)', '화면', hidden_list)

    def hidden_mine():
        ap = login_site(actx, S['h_email'], S['h_pw'], 'P5 글쓴이'); P['a'] = ap; P['adlg'] = dialogs(ap)
        if '/login' in ap.url: return False, '로그인하지 못함'
        goto(ap, f"/community/{S['hpost']}")
        t = norm(text(ap, '.plz-body'))
        return norm(text(ap, '.plz-post h1')) == TITLE and '가려짐' in norm(text(ap, '.plz-post .plz-meta')) and f'가려진 사유: {REASON}' in t and BODY[:20] in t, t[:150]
    W.step('글쓴이가 로그인해 자기 글을 엶 → 글은 그대로 보이고 「가려짐」 표시와 「가려진 사유」가 적혀 있음(왜 가려졌는지 알 수 있음)', '화면', hidden_mine)

    def delete():
        if not S.get('hpost'): return 'skip', '글이 만들어지지 않아 지울 것이 없음'
        if q(f"select state from posts where id='{S['hpost']}'") == 'DELETED': return True, '이미 지워짐'
        try:
            ap = P.get('a')
            if not ap: raise RuntimeError('글쓴이 화면이 열리지 않음')
            goto(ap, f"/community/{S['hpost']}")
            exact_btn(ap.locator('.plz-body .p2act').first, '삭제').click(); ap.wait_for_url('**/community?deleted=1', timeout=25000)
        except Exception as ex:
            st, j = call('DELETE', f"/me/community/posts/{S['hpost']}", S['h_tok'])
            st_db = q(f"select state from posts where id='{S['hpost']}'")
            return False, f'화면에서 지우지 못해 글쓴이의 API 로 지움({st}) · DB {st_db} — ' + norm(repr(ex))[:120]
        st_db = q(f"select state from posts where id='{S['hpost']}'")
        return st_db == 'DELETED', f'DB {st_db}'
    W.step('(정리) 글쓴이가 그 글에서 「삭제」를 누름 → 목록으로 돌아감 · DB posts.state = DELETED(가려진 글도 글쓴이가 지울 수 있음)', '화면', delete, always=True)

    clean(W, w0)
    for c in (rctx, gctx, actx, bctx): c.close()


# ══════════════════════════════════════════════════════════════════════════════════════════
def sweep():
    """어느 흐름이 중간에 멈춰도 만든 것이 남지 않게 한 번 더 봅니다(단계로 적지는 않음 — 흐름 안의 정리 단계가 기록합니다)."""
    ADM = S.get('ADM')
    try:
        if S.get('lead') and q(f"select assign_state from leads where id='{S['lead']}'") != 'CLOSED':
            call('POST', f"/admin/leads/{S['lead']}/close", ADM, {'reason': f'flow_plaza 흐름 점검 신청 — 시험 뒤 정리 {TAG}'})
        if S.get('poll') and q(f"select state from polls where id='{S['poll']}'") != 'HIDDEN':
            call('PATCH', f"/admin/community/polls/{S['poll']}", ADM, {'state': 'HIDDEN', 'hiddenReason': f'흐름 점검 자료 정리 {TAG}'})
        for k, tok in (('post', 'a_tok'), ('hpost', 'h_tok')):
            if S.get(k) and q(f"select state from posts where id='{S[k]}'") != 'DELETED':
                call('DELETE', f"/me/community/posts/{S[k]}", S.get(tok))
    except Exception as ex:
        print('sweep:', repr(ex)[:200], file=sys.stderr)


def main():
    S['ADM'] = login('admin@x.com')
    with sync_playwright() as p:
        b = p.chromium.launch()
        for fn in (p1, p2, p3, p4, p5):
            n0 = len(FLOWS)
            try: fn(b)
            except Exception as ex:
                traceback.print_exc()
                if len(FLOWS) > n0: FLOWS[-1]['steps'].append({'no': len(FLOWS[-1]['steps']) + 1, 'step': '시험 실행 중 예외로 이 흐름이 멈춤', 'how': '화면', 'ok': False, 'detail': norm(repr(ex))[:300]})
        b.close()


if __name__ == '__main__':
    try: main()
    finally:
        sweep()
        finish('plaza')
