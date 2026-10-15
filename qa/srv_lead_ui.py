"""10/2 서버 기능 — 상담 신청 · 리드 배정 (lead · D008 → D018) 화면 검증.

v10.11 — 상담 신청이 「로그인 없이 · 휴대폰 확인 · 인증업체 1곳」으로 바뀐 데 맞췄습니다.

사이트(신청자 · 파트너)와 BO(운영 ops@t.local ADMIN)를 Playwright 로 실제 로그인해 버튼까지 누릅니다.

  1. 사이트 /consult            상담 신청 → 인증번호 확인 → 1곳 전달 → 「내 상담 신청」 (연락처 받아 간 업체)
  2. 사이트 /partner/leads      배정 건 → 「연락처 열기」(과금) → 연락처 표시 → 「연락처 보기」
  3. BO 파트너 › 리드 배정       후보 · 탈락 사유 → 고른 업체에 보내기 → 거두고 다시 보내기 → 지금 배정 돌리기 → 신청 종료
  4. BO 자격 심사 › 인증 상세    국토부 대조 출처 · 「국토부 다시 조회」(설정 없으면 잠김)

사용: API=http://localhost:3023 BO=http://localhost:5206 SITE=http://localhost:5205 python3 srv_lead_ui.py
"""
import json, os, subprocess, sys, time, uuid, urllib.request
from playwright.sync_api import sync_playwright
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from flow_lib import bo_tab as _bo_tab, bo_tab_names as _bo_tab_names   # v10.29 — 운영 화면 묶음 메뉴(묶음 단추 → .ad-snb 탭)
API = os.environ.get('API', 'http://localhost:3023').rstrip('/').removesuffix('/api/v1')
BO = os.environ.get('BO', 'http://localhost:5206').rstrip('/')
SITE = os.environ.get('SITE', 'http://localhost:5205').rstrip('/')
DB = 'postgresql://sgb:sgb@localhost:5432/sgb'
q = lambda s: subprocess.run(['psql', DB, '-tAc', s], capture_output=True, text=True).stdout.strip().split('\n')[0]
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:200]})
    print('ok  ' if ok else 'FAIL', step, str(detail)[:150], file=sys.stderr)

def call(m, p, tok=None, body=None):
    h = {'content-type': 'application/json', 'Idempotency-Key': uuid.uuid4().hex}
    if tok: h['authorization'] = 'Bearer ' + tok
    req = urllib.request.Request(API + '/api/v1' + p, method=m,
        data=json.dumps(body).encode() if body is not None else (b'{}' if m in ('POST', 'PATCH') else None), headers=h)
    try: r = urllib.request.urlopen(req, timeout=30); st = r.status; raw = r.read()
    except urllib.error.HTTPError as e: st = e.code; raw = e.read()
    try: return st, json.loads(raw) if raw else None
    except Exception: return st, None
login = lambda e, pw='sgb-dev-1234': call('POST', '/auth/login', body={'email': e, 'password': pw})[1]['accessToken']
ADM = login('admin@x.com'); OPS = login('ops@t.local', 'sgb-test-1234')
tag = uuid.uuid4().hex[:6]
SIDO, GU = '제주', f'리드{tag}'   # 신청서의 시 · 도는 17개 중에서 고릅니다 — 시군구를 시험마다 새로 만들어 시험 업체만 걸리게 합니다
CLEAN = q("select id from categories where code='CSL_CLEANING'")

def member(prefix):
    e = f'{prefix}_{tag}@t.local'
    call('POST', '/auth/signup', body={'email': e, 'password': 'sgb-test-1234', 'name': f'{prefix}화면', 'agreedTerms': []})
    return e, login(e, 'sgb-test-1234')

def partner(prefix, company):
    e, T = member(prefix)
    call('POST', '/verifications/identity', T, {'provider': 'PASS'})
    st, j = call('POST', '/businesses', T, {'bizRegNo': str(uuid.uuid4().int)[-8:] + '01', 'companyName': f'{company}{tag}', 'ceoName': '김화면', 'sido': '서울', 'sigungu': '금천구'})
    bid = (j or {}).get('businessId')
    call('PATCH', f'/admin/businesses/{bid}/verify', ADM, {})
    T = login(e, 'sgb-test-1234')
    pid = call('POST', '/partner/apply', T)[1]['id']
    call('POST', f'/admin/partners/{pid}/approve', ADM)
    # v10.31 (W5 D070) — 리드 이용료가 선불 충전으로 바뀌어 잔액 0인 업체에는 상담이 배정되지 않습니다 → 시험 결제(스텁) 30만 원(srv_lead.py · fix_1028 과 같은 방법)
    subprocess.run(['psql', DB, '-qc', f"DO $w5$ DECLARE v_id uuid; BEGIN INSERT INTO lead_cash_charges(partner_id, order_id, amount, bonus_rate, bonus_amount) VALUES ('{pid}', 'lc-ui' || replace(gen_random_uuid()::text,'-',''), 300000, 0, 0) RETURNING id INTO v_id; PERFORM fn_lead_cash_charge_done(v_id, 'stub_ui_' || v_id::text, 'STUB', true, NULL); END $w5$"], capture_output=True)
    s = call('POST', '/partner/services', T, {'title': f'{company} 청소', 'body': '화면 시험 — 청소 상담', 'categoryId': CLEAN})[1]
    call('POST', f"/admin/partners/services/{s['id']}/review", OPS, {'approve': True})
    call('POST', '/partner/regions', T, {'regions': [{'sido': SIDO, 'sigungu': GU}]})
    call('POST', '/partner/axes', T, {'axes': ['CONSULT']})                      # D018 상담 축 입점 — 신청 · 운영 승인
    aid = q(f"select id from mal_partner_axes where business_id='{bid}' and axis='CONSULT'")
    call('POST', f'/admin/partner-axes/{aid}/decide', OPS, {'approve': True})
    return {'email': e, 'tok': T, 'pid': pid, 'company': f'{company}{tag}', 'bid': bid}

def consult_api(tok, memo):
    """API 로 상담 신청 + 인증번호 확인(개발 응답 devCode). 리드 번호를 돌려줍니다."""
    st, j = call('POST', '/consult/requests', tok, {'categoryId': CLEAN, 'sido': SIDO, 'sigungu': GU, 'memo': memo,
        'name': '김신청', 'phone': '010-' + str(uuid.uuid4().int)[-4:] + '-' + str(uuid.uuid4().int)[-4:], 'email': 'consult.test@example.com', 'agree': True})
    st, v = call('POST', f"/consult/requests/{j['id']}/verify", tok, {'code': j['devCode']})
    return v['leadId']

def bo_login(pg, email, pw):
    pg.goto(BO); pg.wait_for_timeout(600)
    __import__('consent_ok').agree(email, pw); pg.fill('input[name=email]', email); pg.fill('input[name=password]', pw)
    pg.click('form button[type=submit]'); pg.wait_for_timeout(1500)
def bo_tab(pg, name, sub=None):
    _bo_tab(pg, name); pg.wait_for_timeout(1200)   # v10.29 — 묶음 단추 → .ad-snb 탭
    if sub: pg.locator('.subtabs button', has_text=sub).first.click(); pg.wait_for_timeout(1500)
main = lambda pg: pg.evaluate("document.querySelector('.bo-main').innerText")
def site_login(pg, email, pw):
    pg.goto(SITE + '/login'); __import__('consent_ok').agree(email, pw); pg.fill('input[name=email]', email); pg.fill('input[name=password]', pw)
    pg.click('form.auth button'); pg.wait_for_timeout(2000)
body = lambda pg: pg.evaluate("document.querySelector('main') ? document.querySelector('main').innerText : document.body.innerText")

P1 = partner('lui1', 'UI청소가'); P2 = partner('lui2', 'UI청소나')
PS = {P1['pid']: P1, P2['pid']: P2}
REQ_E, REQ = member('luireq')
PHONE = '010-' + str(uuid.uuid4().int)[-4:] + '-' + str(uuid.uuid4().int)[-4:]

with sync_playwright() as p:
    b = p.chromium.launch()
    prompts = []
    def on_dialog(d):
        if d.type == 'prompt': d.accept(prompts.pop(0) if prompts else '')
        else: d.accept()

    # ── 1. 사이트 상담 신청 (로그인한 채) ─────────────────────────────
    c1 = b.new_context(); sp = c1.new_page(); sp.on('dialog', on_dialog)
    site_login(sp, REQ_E, 'sgb-test-1234')
    sp.goto(SITE + '/consult', wait_until='networkidle')
    opts = sp.locator('select[name=categoryId] option').all_inner_texts()
    rec('UI-1-1 /consult 신청서 업종 = 상담 신청을 받는 20종(법률 · 세무 제외) · 자격 업종 표시', len(opts) == 20 and any('자격 업체만' in o for o in opts)
        and not any('법률' in o or '세무' in o for o in opts), opts[:6])
    sp.select_option('select[name=categoryId]', CLEAN)
    sp.select_option('select[name=sido]', SIDO); sp.fill('input[name=sigungu]', GU)
    sp.fill('textarea[name=memo]', f'다음 달 투룸 입주 청소 — 화면 시험 {tag}')
    sp.fill('input[name=name]', '김신청'); sp.fill('input[name=phone]', PHONE); sp.fill('input[name=email]', 'consult.test@example.com')
    sp.locator('form.mal-form [data-csl-otp], form.mal-form button[type=submit]').first.click(); sp.wait_for_timeout(1200)
    t = body(sp)
    rec('UI-1-2 동의 없이 신청 → 화면이 막고 사유 표시 · 서버에 신청 없음', '동의해야 신청할 수 있습니다' in t
        and q(f"select count(*) from consult_requests cr join accounts a on a.id=cr.requester_account_id where a.email='{REQ_E}'") == '0', t[-160:])
    sp.check('input[name=agree]')
    sp.locator('form.mal-form [data-csl-otp], form.mal-form button[type=submit]').first.click()
    sp.wait_for_selector('[data-consult-verify]', timeout=15000)
    code = sp.locator('[data-dev-code]').get_attribute('data-dev-code')
    rid = sp.locator('[data-consult-verify]').get_attribute('data-consult-verify')
    rec('UI-1-2b 「인증번호 받고 신청」 → 휴대폰 확인 단계 · 확인 전에는 리드 없음', bool(code) and len(code) == 6
        and q(f"select state||'|'||(lead_id is null) from consult_requests where id='{rid}'") == 'PENDING_VERIFY|true', (code, rid))
    sp.fill('input[name=otp]', '000000' if code != '000000' else '111111')
    sp.locator('form.mal-form button[type=submit]').click(); sp.wait_for_timeout(1500)
    rec('UI-1-2c 틀린 인증번호 → 서버 사유가 화면에', '인증번호가 맞지 않습니다' in body(sp), body(sp)[-120:])
    sp.fill('input[name=otp]', code)
    sp.locator('form.mal-form button[type=submit]').click()
    sp.wait_for_selector('[data-consult-done]', timeout=15000); sp.wait_for_timeout(1500)
    L = q(f"select l.id from leads l join accounts a on a.id=l.requester_account_id where a.email='{REQ_E}'")
    done = sp.locator('[data-consult-done]')
    t = body(sp)
    rec('UI-1-3 확인 → 전달 화면 · 인증업체 1곳에 배분', L and done.get_attribute('data-consult-done') == L and done.get_attribute('data-consult-state') == 'DELIVERED'
        and q(f"select count(*) from lead_deliveries where lead_id='{L}'") == '1' and '1곳' in t, t[:200])
    art = sp.locator(f'[data-consult="{L}"]')
    rec('UI-1-4 「내 상담 신청」에 상태 · 보낸 곳 · 받아 간 업체 없음', art.count() == 1 and '업체 1곳에 보냄' in art.inner_text() and '아직 없음' in art.inner_text(), art.inner_text()[:150] if art.count() else '')
    PX = PS[q(f"select partner_id from lead_deliveries where lead_id='{L}'")]

    # ── 2. 사이트 파트너 — 열람 · 연락처 ─────────────────────────────
    c2 = b.new_context(); pp = c2.new_page(); pp.on('dialog', on_dialog)
    site_login(pp, PX['email'], 'sgb-test-1234')
    pp.goto(SITE + '/partner/leads', wait_until='networkidle')
    did = q(f"select id from lead_deliveries where lead_id='{L}' and partner_id='{PX['pid']}'")
    art = pp.locator(f'[data-delivery="{did}"]')
    t = art.inner_text() if art.count() else ''
    rec('UI-2-1 파트너 리드 목록에 실제 배정 건 (업종 · 열람 기한 · 연락처 없음)', '청소' in t and '까지 열람' in t and PHONE[-4:] not in t, t[:150])
    art.locator('button', has_text='연락처 열기').click(); pp.wait_for_timeout(2500)
    t = art.inner_text()
    rec('UI-2-2 「연락처 열기」 → 이용료 · 연락처 표시', '김신청' in t and PHONE[-4:] in t and q(f"select amount::int from lead_fees where delivery_id='{did}'") == '3000', t[:150])
    pp.goto(SITE + '/partner/leads', wait_until='networkidle')
    art = pp.locator(f'[data-delivery="{did}"]')
    rec('UI-2-3 다시 들어오면 「열람함 · 3,000원」 · 연락처는 숨김', '3,000원' in art.inner_text() and PHONE[-4:] not in art.inner_text(), art.inner_text()[:120])
    art.locator('button', has_text='연락처 보기').click(); pp.wait_for_timeout(1500)
    rec('UI-2-4 「연락처 보기」 → 다시 표시 · 열람 기록 2건', PHONE[-4:] in art.inner_text()
        and q(f"select count(*) from audit.pii_access_logs where lead_id='{L}'") == '2', art.inner_text()[:120])
    sp.goto(SITE + '/consult', wait_until='networkidle')
    art = sp.locator(f'[data-consult="{L}"]')
    rec('UI-1-5 신청자 화면에 연락처를 받아 간 업체 표시', PX['company'] in art.inner_text(), art.inner_text()[:160])

    # ── 3. BO 리드 배정 ────────────────────────────────────────────
    P3 = partner('lui3', 'UI청소다')
    c3 = b.new_context(); pg = c3.new_page(); pg.on('dialog', on_dialog)
    bo_login(pg, 'ops@t.local', 'sgb-test-1234')
    bo_tab(pg, '파트너', '리드 배정')
    rec('UI-3-1 BO 「리드 배정」 탭 (SB-ADM-PTN-090) · 설정 안내(한 건에 1곳 · 최대 1곳)', pg.locator('.subtabs button[data-screen="SB-ADM-PTN-090"]').count() == 1
        and '등급 가중치' in main(pg) and '1곳(최대 1곳)' in main(pg).replace('\n', ''), main(pg)[150:330])
    pg.locator('.acts button', has_text='전체').first.click()
    card = pg.locator(f'[data-lead="{L}"]')
    # v10.22 — 「전체」 목록은 줄마다 보낼 수 있는 업체 수를 계산해 자료가 쌓이면 느려집니다(개발 DB 리드 602건 · 200줄에 2.4초 · G-142).
    #          정해 둔 1.8초가 아니라 그 신청 카드가 나올 때까지 기다립니다.
    try: card.wait_for(state='visible', timeout=30000)
    except Exception: pass
    pg.wait_for_timeout(300)
    rec('UI-3-2 신청 카드 — 업종 · 상태 · 보낸 수(1/1곳) · 보낼 수 있는 업체 수', card.count() == 1 and '보냄 1/1곳' in card.inner_text() and '보낼 수 있는 업체 2곳' in card.inner_text(), card.inner_text()[:200] if card.count() else '')
    card.locator('button', has_text='후보 · 배정').click(); pg.wait_for_timeout(1800)
    t = card.inner_text()
    rec('UI-3-3 후보 표 — 이미 배정함 · 보낼 수 있음 · 배정 현황(열람)', '이미 배정함' in t and '보낼 수 있음' in t and '열람(과금)' in t, t[:200])
    card.locator(f'[data-candidate="{P3["pid"]}"] input[type=checkbox]').check()
    card.locator('button', has_text='고른 업체에 보내기').click(); pg.wait_for_timeout(2000)
    rec('UI-3-4 이미 1곳이 받은 신청에 「고른 업체에 보내기」 → 서버가 막고 사유 표시(최대 1곳)', '최대 1곳' in main(pg)
        and q(f"select count(*) from lead_deliveries where lead_id='{L}'") == '1', main(pg)[:160])
    vd = did
    rec('UI-3-6 열람한 배정에는 거두기 칸이 없음', card.locator(f'[data-delivery="{vd}"] input[type=checkbox]').count() == 0, '')
    L2 = consult_api(REQ, f'화면 시험 {tag} 두번째 청소 상담')
    d2 = q(f"select id from lead_deliveries where lead_id='{L2}'"); p2 = q(f"select partner_id from lead_deliveries where lead_id='{L2}'")
    pg.reload(); pg.wait_for_timeout(1200); bo_tab(pg, '파트너', '리드 배정')
    pg.locator('.acts button', has_text='전체').first.click(); pg.wait_for_timeout(1800)
    card = pg.locator(f'[data-lead="{L2}"]')
    card.locator('button', has_text='후보 · 배정').click(); pg.wait_for_timeout(1800)
    card.locator(f'[data-delivery="{d2}"] input[type=checkbox]').check()
    prompts.append('업체 휴무로 연락 불가 — 화면 시험')
    card.locator('button', has_text='고른 배정 거두고 다시 보내기').click(); pg.wait_for_timeout(2500)
    rec('UI-3-5 거두고 다시 보내기 → 회수 · 순번대로 다른 1곳(REASSIGN) · 같은 때 받은 곳은 1곳', q(f"select state from lead_deliveries where id='{d2}'") == 'REVOKED'
        and q(f"select count(*)||'|'||min(assign_mode) from lead_deliveries where lead_id='{L2}' and state='DELIVERED' and partner_id<>'{p2}'") == '1|REASSIGN', main(pg)[:150])
    pg.locator('button', has_text='지금 배정 돌리기').click(); pg.wait_for_timeout(2000)
    rec('UI-3-7 「지금 배정 돌리기」 → 결과 문구', '새 배정' in main(pg) and '미배정 전환' in main(pg), main(pg)[:200])
    pg.reload(); pg.wait_for_timeout(1200); bo_tab(pg, '파트너', '리드 배정')
    pg.locator('.acts button', has_text='전체').first.click(); pg.wait_for_timeout(1800)
    card = pg.locator(f'[data-lead="{L2}"]')
    card.locator('button', has_text='후보 · 배정').click(); pg.wait_for_timeout(1500)
    prompts.append('장난 신청 — 화면 시험 종료')
    card.locator('button', has_text='신청 종료').click(); pg.wait_for_timeout(2000)
    rec('UI-3-8 신청 종료 → CLOSED · 안 연 배정 회수', q(f"select assign_state from leads where id='{L2}'") == 'CLOSED'
        and q(f"select count(*) from lead_deliveries where lead_id='{L2}' and state='DELIVERED'") == '0', main(pg)[:120])

    # ── 1b. 사이트 비로그인 신청 — 받을 업체가 없는 지역 ─────────────────
    c4 = b.new_context(); gp = c4.new_page()
    gp.goto(SITE + '/mal/consult/CSL_CLEANING/apply', wait_until='networkidle')      # v10.24 — 신청서 주소가 …/apply 로 옮겨졌습니다(/mal/consult/코드 는 업종 상세)
    rec('UI-5-1 비로그인 /mal/consult/CSL_CLEANING/apply → 신청서(업종 고정) · 로그인 화면으로 튕기지 않음', '/login' not in gp.url
        and gp.locator('select[name=categoryId]').count() == 0 and gp.locator('input[name=phone]').count() == 1 and '청소 상담 신청' in body(gp), gp.url)
    gp.fill('input[name=name]', '박비회원'); gp.fill('input[name=phone]', '010-' + str(uuid.uuid4().int)[-4:] + '-' + str(uuid.uuid4().int)[-4:]); gp.fill('input[name=email]', 'consult.test@example.com')
    gp.select_option('select[name=sido]', SIDO); gp.fill('input[name=sigungu]', f'없는{tag}')
    gp.check('input[name=agree]')
    gp.locator('form.mal-form [data-csl-otp], form.mal-form button[type=submit]').first.click()
    gp.wait_for_selector('[data-consult-verify]', timeout=15000)
    gp.fill('input[name=otp]', gp.locator('[data-dev-code]').get_attribute('data-dev-code'))
    rid2 = gp.locator('[data-consult-verify]').get_attribute('data-consult-verify')
    gp.locator('form.mal-form button[type=submit]').click()
    gp.wait_for_selector('[data-consult-done]', timeout=15000)
    rec('UI-5-2 비로그인 신청 · 그 지역에 받을 업체 없음 → 「받을 업체가 없습니다」 · 전달 안 함', gp.locator('[data-consult-done]').get_attribute('data-consult-state') == 'NO_PARTNER'
        and '받을 업체가 없습니다' in body(gp) and q(f"select state||'|'||(lead_id is null)||'|'||(requester_account_id is null) from consult_requests where id='{rid2}'") == 'NO_PARTNER|true|true', body(gp)[:160])
    c4.close()

    # ── 4. BO 중개사 인증 상세 — 대조 출처 · 다시 조회 ───────────────
    e, T = member('luibrk')
    call('POST', '/verifications/identity', T, {'provider': 'PASS'})
    bid = call('POST', '/businesses', T, {'bizRegNo': str(uuid.uuid4().int)[-10:], 'companyName': f'UI중개{tag}', 'ceoName': '김화면', 'sido': '서울', 'sigungu': '금천구'})[1]['businessId']
    call('PATCH', f'/admin/businesses/{bid}/verify', ADM, {})
    bv = call('POST', '/partner/broker', login(e, 'sgb-test-1234'), {'licenseNo': f'11545-2026-{tag[:5]}', 'officeName': f'UI공인중개사{tag}', 'ceoName': '김화면'})[1]['id']
    bo_tab(pg, '자격 심사', '중개사 인증 심사')
    pg.locator(f'[data-broker="{bv}"] button', has_text='보기').click(); pg.wait_for_timeout(1500)
    btn = pg.locator('button', has_text='국토부 다시 조회')
    t = main(pg)
    rec('UI-4-1 인증 상세 — 간주 출처 · 사유 · 「국토부 다시 조회」 잠김(연동 미설정)', '간주 모드' in t and '국토부 대조를 하지 않았습니다' in t
        and btn.count() == 1 and btn.is_disabled(), t[:200])
    call('POST', f'/admin/brokers/{bv}/decide', ADM, {'state': 'REJECTED', 'reason': '시험 정리(srv_lead_ui)'})      # 뒷정리 — 심사 대기가 쌓이지 않게(G-207)
    c1.close(); c2.close(); c3.close()

json.dump(R, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'srv_lead_ui.json'), 'w'), ensure_ascii=False, indent=1)
print(f"통과 {sum(r['ok'] for r in R)} / {len(R)}")
