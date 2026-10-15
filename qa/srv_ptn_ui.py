"""10/2 서버 기능 — 파트너 운영 목록 (ptn) 화면 검증.

BO(운영: ops@t.local ADMIN · admin@x.com SUPER)와 사이트(파트너 · person@x.com)를
Playwright 로 실제 로그인해 버튼까지 누릅니다.

사용: API=http://localhost:3013 BO=http://localhost:5195 SITE=http://localhost:5196 python3 srv_ptn_ui.py
person@x.com 의 중개사 인증은 시험 뒤 원래 상태(신청 없음)로 되돌립니다.
"""
import json, os, subprocess, sys, time, uuid, urllib.request
from playwright.sync_api import sync_playwright
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from flow_lib import bo_tab as _bo_tab, bo_tab_names as _bo_tab_names   # v10.29 — 운영 화면 묶음 메뉴(묶음 단추 → .ad-snb 탭)
API = os.environ.get('API', 'http://localhost:3013').rstrip('/').removesuffix('/api/v1')   # /api/v1 을 붙여 줘도 받습니다
BO = os.environ.get('BO', 'http://localhost:5195').rstrip('/')
SITE = os.environ.get('SITE', 'http://localhost:5196').rstrip('/')
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
ADM = login('admin@x.com')
tag = uuid.uuid4().hex[:6]

def bizuser(prefix, company):
    e = f'{prefix}_{tag}@t.local'
    call('POST', '/auth/signup', body={'email': e, 'password': 'sgb-test-1234', 'name': 'PTN 화면', 'agreedTerms': []})
    T = login(e, 'sgb-test-1234')
    call('POST', '/verifications/identity', T, {'provider': 'PASS'})
    brn = str(int(time.time() * 1000))[-10:]
    st, j = call('POST', '/businesses', T, {'bizRegNo': brn, 'companyName': f'{company}{tag}', 'ceoName': '김화면', 'sido': '서울', 'sigungu': '금천구'})
    bid = (j or {}).get('id') or q(f"select id from businesses where company_name='{company}{tag}'")
    call('PATCH', f'/admin/businesses/{bid}/verify', ADM, {})
    return e, login(e, 'sgb-test-1234')

# 준비: 입점 신청 (실제 API)
eA, PA = bizuser('ptnui', 'UI상사')
pid = call('POST', '/partner/apply', PA)[1]['id']
company = f'UI상사{tag}'

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

REJ = '업태가 신청 업종과 다릅니다 — 업태 정정 후 다시 신청해 주십시오'
with sync_playwright() as p:
    b = p.chromium.launch()
    prompts = []
    def on_dialog(d):
        if d.type == 'prompt': d.accept(prompts.pop(0) if prompts else '')
        else: d.accept()

    # ── 3. 입점 반려 (ADMIN) ─────────────────────────────────────
    c = b.new_context(); pg = c.new_page(); pg.on('dialog', on_dialog)
    bo_login(pg, 'ops@t.local', 'sgb-test-1234')
    bo_tab(pg, '파트너', '입점 신청')
    card = pg.locator(f'[data-partner="{pid}"]')
    rec('UI-3-1 BO 입점 신청 카드 (신청 시각 · 사업자 인증)', card.count() == 1 and '사업자 인증 완료' in card.inner_text(), card.count())
    prompts.append(REJ); card.locator('button', has_text='반려').click(); pg.wait_for_timeout(1500)
    rec('UI-3-2 반려 버튼 → 목록에서 빠지고 반려 표에 사유', pg.locator(f'[data-partner="{pid}"]').count() == 0 and REJ in main(pg)
        and q(f"select status from partners where id='{pid}'") == 'REJECTED', main(pg)[:120])

    # ── 1. 서비스 검수 (ADMIN) — 먼저 승인해야 서비스 등록 가능하므로 입점부터 다시
    c2 = b.new_context(); sp = c2.new_page(); sp.on('dialog', on_dialog)
    site_login(sp, eA, 'sgb-test-1234')
    sp.goto(SITE + '/partner/apply', wait_until='networkidle')
    t = body(sp)
    rec('UI-3-3 사이트 입점 신청 화면에 반려 · 사유', '반려되었습니다' in t and REJ in t, t[:160])
    sp.locator('button', has_text='입점 신청하기').click(); sp.wait_for_timeout(2000)
    rec('UI-3-4 사이트에서 다시 신청 → APPLIED', q(f"select status from partners where id='{pid}'") == 'APPLIED', '')
    c.close()

    c = b.new_context(); pg = c.new_page(); pg.on('dialog', on_dialog)
    bo_login(pg, 'admin@x.com', 'sgb-dev-1234')
    bo_tab(pg, '파트너', '입점 신청')
    pg.locator(f'[data-partner="{pid}"] button', has_text='승인').click(); pg.wait_for_timeout(1500)
    rec('UI-3-5 SUPER 가 BO 에서 승인 → ACTIVE', q(f"select status from partners where id='{pid}'") == 'ACTIVE', main(pg)[:100])

    cat = q("select id from categories where gwan_code='MNY' and status='APPROVED' and restricted_code is null limit 1")
    sids = [call('POST', '/partner/services', PA, {'title': f'{t} {tag}', 'body': '시공 이력 20건 · 하자보증 2년', 'categoryId': cat})[1]['id']
            for t in ('UI 태양광 EPC', 'UI 인테리어')]
    bo_tab(pg, '파트너', '서비스 검수')
    rec('UI-1-1 BO 검수 대기 목록에 새 서비스 2건 (번호 입력칸 없이)', all(pg.locator(f'[data-service="{s}"]').count() == 1 for s in sids)
        and pg.locator('input[placeholder^="00000000"]').count() == 0, sids)
    c.close()
    c = b.new_context(); pg = c.new_page(); pg.on('dialog', on_dialog)
    bo_login(pg, 'ops@t.local', 'sgb-test-1234')
    bo_tab(pg, '파트너', '서비스 검수')
    cd = pg.locator(f'[data-service="{sids[0]}"]')
    rec('UI-1-2 카드에 회사 · 제출 시각 · 본문', company in cd.inner_text() and '제출' in cd.inner_text() and '하자보증' in cd.inner_text(), cd.inner_text()[:120])
    cd.locator('button', has_text='승인').click(); pg.wait_for_timeout(1500)
    rec('UI-1-3 승인 (ADMIN) → APPROVED · 목록에서 빠짐', q(f"select status from partner_services where id='{sids[0]}'") == 'APPROVED'
        and pg.locator(f'[data-service="{sids[0]}"]').count() == 0, '')
    cd = pg.locator(f'[data-service="{sids[1]}"]')
    cd.locator('button', has_text='반려').click(); pg.wait_for_timeout(800)
    rec('UI-1-4 사유 없이 반려 → 화면이 막음', q(f"select status from partner_services where id='{sids[1]}'") == 'IN_REVIEW' and '고쳐야' in main(pg), '')
    cd.locator('select').select_option('R02'); cd.locator('input').fill('시공 사진과 보증 조건을 적어 주십시오')
    cd.locator('button', has_text='반려').click(); pg.wait_for_timeout(1500)
    rec('UI-1-5 반려 (코드 + 사유)', q(f"select status||'|'||reject_reason from partner_services where id='{sids[1]}'").startswith('REJECTED|R02 정보 불충분 — 시공 사진'), '')

    # ── 2. 리드 반려: 파트너가 사이트에서 신청 → BO 인정 · 기각 ──────
    call('POST', '/partner/regions', PA, {'regions': [{'sido': '서울', 'sigungu': '금천구'}]})
    q(f"""with l as (insert into leads(summary,sido,sigungu) select 'UI 리드 {tag} #'||g,'서울','금천구' from generate_series(1,8) g returning id)
          insert into lead_deliveries(lead_id,partner_id) select id,'{pid}' from l""")
    leads = sorted(call('GET', '/partner/leads', PA)[1], key=lambda x: x['summary'])
    # v10.31 (W5 · D070) — 리드 이용료 선불: 열람 전에 시험 결제(스텁)로 충전
    _st, _c = call('POST', '/partner/cash/charges', PA, {'amount': 100000})
    call('POST', '/partner/cash/charges/confirm', PA, {'orderId': (_c or {}).get('orderId'), 'paymentKey': 'stub_' + uuid.uuid4().hex, 'amount': 100000})
    for x in leads[:3]: call('POST', f"/partner/leads/{x['deliveryId']}/view", PA)
    fees = sorted([r for r in call('GET', '/partner/fees', PA)[1]['rows']], key=lambda r: r['id'])
    sp.goto(SITE + '/partner/leads-rejects', wait_until='networkidle')      # v10.31 (W5) — 시안 주소(옛 /partner/rejects 는 여기로 보냄)
    rec('UI-2-1 사이트 반려 신청 폼 (신청 가능 이용료 3건)', sp.locator('#dispute-form select[name=feeId] option').count() == 3, sp.locator('#dispute-form select[name=feeId] option').count())
    sp.locator('#dispute-form select[name=feeId]').select_option(str(fees[0]['id']))
    sp.locator('#dispute-form select[name=reasonCode]').select_option('UNREACHABLE')
    sp.locator('#dispute-form textarea[name=reason]').fill('안내된 번호가 결번입니다. 3회 통화 시도')
    sp.locator('#dispute-form input[name=evidence]').fill('통화 기록 10/1 10:02 · 13:40 · 17:15')
    sp.locator('#dispute-form button', has_text='반려 신청').click(); sp.wait_for_timeout(2500)
    d1 = q(f"select id from lead_fee_disputes where fee_id={fees[0]['id']}")
    rec('UI-2-2 사이트에서 반려 신청 → REQUESTED', d1 and q(f"select state from lead_fee_disputes where id={d1}") == 'REQUESTED', d1)
    sp.locator('#dispute-form select[name=feeId]').select_option(str(fees[1]['id']))
    sp.locator('#dispute-form select[name=reasonCode]').select_option('DUPLICATE')
    sp.locator('#dispute-form textarea[name=reason]').fill('같은 요청을 지난주에 받았습니다')
    sp.locator('#dispute-form button', has_text='반려 신청').click(); sp.wait_for_timeout(2500)
    d2 = q(f"select id from lead_fee_disputes where fee_id={fees[1]['id']}")
    sp.locator('#dispute-form select[name=feeId]').select_option(str(fees[2]['id']))
    sp.locator('#dispute-form textarea[name=reason]').fill('면적이 사실과 다릅니다')
    sp.locator('#dispute-form button', has_text='반려 신청').click(); sp.wait_for_timeout(2500)
    err = sp.locator('#dispute-form .form-error').inner_text() if sp.locator('#dispute-form .form-error').count() else ''
    rec('UI-2-3 월 한도 초과 → 서버 사유가 화면에 보임', d2 and '한도' in err, err)

    bo_tab(pg, '파트너', '리드 반려')
    cd = pg.locator(f'[data-void="{d1}"]')
    txt = cd.inner_text() if cd.count() else ''
    rec('UI-2-4 BO 반려 신청 목록: 회사 · 사유 · 근거 · 월 근거', company in txt and '결번' in txt and '통화 기록' in txt and '수신 8건' in txt, txt[:150])
    cd.locator('select').select_option('RSK-02'); cd.locator('button', has_text='인정').click(); pg.wait_for_timeout(1500)
    rec('UI-2-5 인정 (ADMIN) → 이용료 VOIDED', q(f"select state||'|'||void_rule from lead_fees where id={fees[0]['id']}") == 'VOIDED|RSK-02', '')
    c.close()
    c = b.new_context(); pg = c.new_page(); pg.on('dialog', on_dialog)
    bo_login(pg, 'admin@x.com', 'sgb-dev-1234')
    bo_tab(pg, '파트너', '리드 반려')
    DIS = '요청 내용이 다른 별건입니다 — 중복이 아닙니다'
    prompts.append(DIS); pg.locator(f'[data-void="{d2}"] button', has_text='기각').click(); pg.wait_for_timeout(1500)
    rec('UI-2-6 기각 (SUPER) → DISMISSED · 이용료 유지', q(f"select state from lead_fee_disputes where id={d2}") == 'DISMISSED'
        and q(f"select state from lead_fees where id={fees[1]['id']}") == 'BILLED', '')      # v10.31 (W5) — 선불 차감 = BILLED
    pg.locator('button', has_text='전체 (판정 이력)').click(); pg.wait_for_timeout(1500)
    rec('UI-2-7 전체 탭에 판정자 · 사유', 'ops@t.local' in main(pg) and DIS in main(pg), '')
    sp.goto(SITE + '/partner/leads-rejects', wait_until='networkidle')
    t = sp.locator('#my-disputes').inner_text() if sp.locator('#my-disputes').count() else ''
    rec('UI-2-8 사이트 「반려 · 이의신청」에 인정(확인비용 환급) · 기각 사유 — 10/10 시안 문구', '인정' in t and '환급' in t and DIS in t, t[:160])
    c.close(); c2.close()

    # ── 4. 중개사 인증: person@x.com 신청 → 반려 → 재신청 → 승인 ─────
    c2 = b.new_context(); sp = c2.new_page(); sp.on('dialog', on_dialog)
    site_login(sp, 'person@x.com', 'sgb-dev-1234')
    sp.goto(SITE + '/my/broker', wait_until='networkidle')
    lic = f'11545-2026-{tag[:5]}'
    sp.locator('.card input.inp').first.fill(lic)   # v10.31 (w2 시안 scBrkApp) — 예시 번호 칸 글자가 바뀜 · 첫 칸 = 등록번호
    inputs = sp.locator('.card input.inp')
    inputs.nth(1).fill(f'가산공인중개사{tag}'); inputs.nth(2).fill('대표')
    sp.locator('button', has_text='신청하고 대조하기').click(); sp.wait_for_timeout(2500)
    bv = q("select v.id from broker_verifications v join businesses b on b.id=v.business_id join accounts a on a.id=b.account_id where a.email='person@x.com'")
    rec('UI-4-1 person@x.com 사이트에서 중개사 인증 신청 → PENDING', bv and q(f"select state from broker_verifications where id='{bv}'") == 'PENDING', sp.url)
    c = b.new_context(); pg = c.new_page(); pg.on('dialog', on_dialog)
    bo_login(pg, 'ops@t.local', 'sgb-test-1234')
    bo_tab(pg, '자격 심사', '중개사 인증 심사')
    row = pg.locator(f'[data-broker="{bv}"]')
    rec('UI-4-2 BO 중개사 인증 심사 목록 (broker_verifications)', row.count() == 1 and lic in row.inner_text(), row.inner_text()[:120] if row.count() else '')
    BR = '등록증의 사무소 상호와 다릅니다 — 등록증에 적힌 그대로 입력해 주십시오'
    prompts.append(BR); row.locator('button', has_text='반려').click(); pg.wait_for_timeout(1500)
    rec('UI-4-3 반려 (ADMIN) → REJECTED · 사유', q(f"select state||'|'||reject_reason from broker_verifications where id='{bv}'") == 'REJECTED|' + BR, '')
    sp.goto(SITE + '/my/broker/status', wait_until='networkidle')
    t = body(sp)
    rec('UI-4-4 사이트 인증 상태에 반려 · 사유', '반려' in t and BR in t, t[:160])
    (sp.locator('a', has_text='다시 신청하기') if sp.locator('a', has_text='다시 신청하기').count() else sp.locator('a', has_text='새로 신청')).first.click()   # v10.31 시안 글 「새로 신청」
    try: sp.wait_for_url('**/my/broker', timeout=15000); sp.wait_for_load_state('networkidle')   # v10.31 — 전에는 기다림이 주석 안에 들어가 누른 직후 주소를 봄
    except Exception: pass
    sp.wait_for_timeout(800)
    rec('UI-4-5 「다시 신청하기」 → 신청 폼 (전: 상태 화면으로 되돌아감)', sp.url.endswith('/my/broker') and sp.locator('button', has_text='신청하고 대조하기').count() == 1, sp.url)
    sp.locator('.card input.inp').first.fill(lic)   # v10.31 (w2 시안 scBrkApp) — 예시 번호 칸 글자가 바뀜 · 첫 칸 = 등록번호
    inputs = sp.locator('.card input.inp'); inputs.nth(1).fill(f'가산공인중개사사무소{tag}'); inputs.nth(2).fill('대표')
    sp.locator('button', has_text='신청하고 대조하기').click(); sp.wait_for_timeout(2500)
    rec('UI-4-6 재신청 → PENDING (전: 500)', q(f"select state from broker_verifications where id='{bv}'") == 'PENDING', sp.url)
    c.close()
    c = b.new_context(); pg = c.new_page(); pg.on('dialog', on_dialog)
    bo_login(pg, 'admin@x.com', 'sgb-dev-1234')
    bo_tab(pg, '자격 심사', '중개사 인증 심사')
    pg.locator(f'[data-broker="{bv}"] button', has_text='보기').click(); pg.wait_for_timeout(1500)
    t = main(pg)
    rec('UI-4-7 BO 인증 상세 (SB-ADM-BRK-011): 번호 · 대표 일치 · 계정', lic in t and '사업자 대표와 일치' in t and 'person@x.com' in t, t[:150])
    pg.locator('.bo-main button.btn-ok', has_text='승인').click(); pg.wait_for_timeout(2000)
    rec('UI-4-8 승인 (SUPER) → VERIFIED · 공개 가능', q(f"select state from broker_verifications where id='{bv}'") == 'VERIFIED'
        and q("select fn_is_verified_broker(id) from accounts where email='person@x.com'") == 't' and '부동산 매물 공개 가능' in main(pg), main(pg)[:120])
    sp.goto(SITE + '/my/broker/status', wait_until='networkidle')
    t = body(sp)
    rec('UI-4-9 사이트 인증 상태: 인증 완료 · 공개 가능', '인증 완료' in t and '공개하실 수 있습니다' in t, t[:160])
    c.close(); c2.close()
    b.close()

# person@x.com 은 공용 계정입니다 — 중개사 인증을 원래(신청 없음)로 되돌립니다.
q("delete from broker_verifications v using businesses b, accounts a where b.id=v.business_id and a.id=b.account_id and a.email='person@x.com'")
q("update businesses b set broker_verified_at=null, broker_license_no=null from accounts a where a.id=b.account_id and a.email='person@x.com'")
rec('UI-9 person@x.com 원복 (중개사 인증 없음)', q("select fn_is_verified_broker(id) from accounts where email='person@x.com'") == 'f')

json.dump(R, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'srv_ptn_ui.json'), 'w'), ensure_ascii=False, indent=1)
print(f"통과 {sum(r['ok'] for r in R)} / {len(R)}")
