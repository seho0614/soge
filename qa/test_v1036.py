"""v10.36 시험 — ① 소개장터 개인 회원 등록 허용(D094)  ② 운영 화면 「로그인 후 첫 화면」 저장(소개몰 · 신규 가입자)

  API=http://localhost:3000/api/v1 SITE=http://localhost:5174 BO=http://127.0.0.1:5173 DB=postgresql://sgb:sgb@localhost:5432/sgb python3 test_v1036.py

  ★ 개발 DB 에 시험 매물(제목 「V1036 …」)을 만듭니다. 랜딩 설정은 끝에 처음 값으로 되돌립니다.
"""
import os, json, uuid, subprocess, urllib.request, urllib.error
from playwright.sync_api import sync_playwright

API = os.environ.get('API', 'http://localhost:3000/api/v1')
SITE = os.environ.get('SITE', 'http://localhost:5174')
BO = os.environ.get('BO', 'http://127.0.0.1:5173')
DB = os.environ.get('DB', 'postgresql://sgb:sgb@localhost:5432/sgb')
TAG = uuid.uuid4().hex[:6]
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def sql(q):
    r = subprocess.run(['psql', DB, '-X', '-tA', '-v', 'ON_ERROR_STOP=1', '-c', q], capture_output=True, text=True)
    return (r.stdout.strip(), r.stderr.strip(), r.returncode)


def call(method, path, token=None, body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'content-type': 'application/json', **({'authorization': 'Bearer ' + token} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b'null')
        except Exception: return e.code, None


def login(email, pw):
    return call('POST', '/auth/login', body={'email': email, 'password': pw})[1]['accessToken']


def cat_of(gwan, extra=''):
    return sql(f"select id from categories where gwan_code='{gwan}' and status='APPROVED' and restricted_code is null {extra} order by name limit 1")[0]


orig = dict(l.split('|', 1) for l in sql("select key, value from site_settings where key like 'site.landing%'")[0].splitlines())

# ── ① DB 게이트 (트랜잭션 안에서 넣고 되돌림) ─────────────────────────
person = sql("select id from accounts where email='member@t.local'")[0]
for g, expect_ok in (('MNY', True), ('BIZ', True)):   # v10.37 (D095 · P2P) — 모든 관 개인 허용
    c = cat_of(g)
    out, err, rc = sql(f"BEGIN; INSERT INTO listings (gwan_code, category_id, owner_account_id, title, status) VALUES ('{g}', '{c}', '{person}', 'V1036 DB {g}', 'IN_REVIEW'); ROLLBACK;")
    ok(f'DB 게이트 — 개인(PERSONAL) 계정의 {g} 매물 넣기 {"허용" if expect_ok else "막힘"}', (rc == 0) == expect_ok, (err.splitlines() or ['통과'])[0][:120])

# ── ① API ────────────────────────────────────────────────────────────
tm = login('member@t.local', 'sgb-test-1234')
body = lambda g, c: {'gwanCode': g, 'categoryId': c, 'title': f'V1036 API {g} {TAG}', 'body': '소개장터 개인 등록 시험 본문입니다.', 'desiredFee': 100000}
st, d = call('POST', '/listings', tm, body('MNY', cat_of('MNY')))
ok('API — 개인 회원(MEMBER)이 소개장터 등록', st in (200, 201) and d and d.get('listingId'), f'{st} {str(d)[:120]}')
lid = d.get('listingId') if isinstance(d, dict) else None
for g in ('MAL', 'BIZ'):
    st, d = call('POST', '/listings', tm, body(g, cat_of(g, "and coalesce(axis,'') = 'EQUIP'" if g == 'MAL' else "")))   # 안심소개는 기계 · 설비 축(부동산은 공인중개사 · 소유 확인이 따로)
    ok(f'API — 개인 회원이 {g} 등록도 됨(v10.37 · P2P)', st in (200, 201) and d and d.get('listingId'), f'{st} {str(d)[:120]}')
if lid:
    v = sql(f"select version, category_id from listings where id='{lid}'")[0].split('|')
    st, d = call('PATCH', f'/listings/{lid}', tm, {'version': int(v[0]), 'gwanCode': 'MNY', 'categoryId': v[1], 'title': f'V1036 API MNY 수정 {TAG}', 'body': '소개장터 개인 등록 시험 본문 수정입니다.'})
    ok('API — 개인 등록자가 자기 소개장터 매물 수정', st in (200, 201), f'{st} {str(d)[:100]}')
    st, d = call('POST', f'/listings/{lid}/archive', tm)
    ok('API — 개인 등록자가 자기 소개장터 매물 내리기', st in (200, 201) and d and d.get('status') == 'ARCHIVED', f'{st} {str(d)[:100]}')
ts = login('seller@x.com', 'sgb-dev-1234')
st, d = call('POST', '/listings', ts, body('BIZ', cat_of('BIZ')))
ok('API — 인증 사업자는 소개창업 등록 그대로 됨', st in (200, 201), f'{st} {str(d)[:100]}')

# ── 화면 ─────────────────────────────────────────────────────────────
with sync_playwright() as p:
    b = p.chromium.launch()

    def site_login(email, pw):
        __import__('consent_ok').agree(email, pw)   # 필수 약관 재동의를 먼저(이 시험의 대상이 아님 — consent_ok.py 머리말)
        ctx = b.new_context(viewport={'width': 1280, 'height': 900}); pg = ctx.new_page()
        pg.goto(SITE + '/login'); pg.fill('#lg-mail', email); pg.fill('#lg-pw', pw)
        pg.locator('#lg-pw').press('Enter'); pg.wait_for_timeout(2500)
        return ctx, pg

    # ① 개인 회원 등록 화면
    ctx, pg = site_login('member@t.local', 'sgb-test-1234')
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(SITE + '/register'); pg.wait_for_timeout(1500)
    gw = pg.evaluate("()=>[...document.querySelectorAll('#f-gwan option')].map(e=>e.value).filter(Boolean)")
    ok('화면 — 개인 회원 /register 에 등록 폼(모든 관 · v10.37 P2P)', sorted(gw) == ['BIZ', 'MAL', 'MNY'] and pg.locator('[data-reg-locked]').count() == 0, f'관 {gw}')
    pg.select_option('#f-gwan', 'MNY')
    pg.wait_for_function("()=>document.querySelectorAll('#f-cat option').length>1", timeout=15000)
    pg.select_option('#f-cat', index=1)
    title = f'V1036 화면 소개장터 {TAG}'
    pg.fill('#f-title', title); pg.fill('#f-intro', '개인 회원 소개장터 등록'); pg.fill('#f-desc', '개인 회원이 소개장터에 올리는 시험 상세 설명입니다.')
    pg.fill('#f-fee', '300000'); pg.select_option('#f-support', index=1); pg.fill('#f-hours', '평일 10:00 ~ 18:00')
    pg.evaluate("""()=>{const set=(el,v)=>{const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d.set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));};
      for (const [s,v] of [['.addr input.addr-zip','06234'],['.addr input.addr-road','서울 강남구 테헤란로 1']]) { const el=document.querySelector(s); el.removeAttribute('readonly'); set(el,v); }}""")
    pg.fill('#f-sales', '5000'); pg.select_option('#f-wish', index=1)
    pg.click('[data-fdone=reg]')
    try: pg.wait_for_url('**/my/listings**', timeout=30000)
    except Exception: pass
    row = sql(f"select l.gwan_code, l.status, a.email from listings l join accounts a on a.id=l.owner_account_id where l.title='{title}'")[0]
    err_txt = pg.locator('.w1-err').all_inner_texts() if pg.locator('.w1-err').count() else []
    ok('화면 — 개인 회원이 「등록완료」 → 내 등록 리스팅 · DB 에 소개장터 매물', pg.url.startswith(SITE + '/my/listings') and row.startswith('MNY|') and row.endswith('member@t.local'),
       f'도착 {pg.url.replace(SITE, "")} · DB {row or "없음"} · 오류 {err_txt}')
    ok('화면 — 쪽 스크립트 오류 없음(개인 등록)', not errs, '; '.join(errs)[:200])
    ctx.close()

    # ① 사업자 회원은 전과 같음
    ctx, pg = site_login('seller@x.com', 'sgb-dev-1234')
    pg.goto(SITE + '/register'); pg.wait_for_timeout(1500)
    gw = pg.evaluate("()=>[...document.querySelectorAll('#f-gwan option')].map(e=>e.value).filter(Boolean)")
    ok('화면 — 사업자 회원 /register 는 전과 같음(관 3개)', sorted(gw) == ['BIZ', 'MAL', 'MNY'], f'관 {gw}')
    ctx.close()

    # ② 운영 화면 — 로그인 후 첫 화면
    ctx = b.new_context(viewport={'width': 1400, 'height': 1000}); pg = ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(BO + '/'); pg.fill('input[name=email]', 'ops@t.local'); pg.fill('input[name=password]', 'sgb-test-1234')
    pg.click('form button[type=submit]'); pg.wait_for_timeout(2500)
    pg.goto(BO + '/#/gwans'); pg.wait_for_timeout(2500)
    sel = pg.locator('select[aria-label="로그인 후 랜딩"]')
    ok('운영 화면 — 관 관리에 「로그인 후 첫 화면」 고르기', sel.count() == 1, f'고르기 {sel.count()}')
    opts = sel.evaluate("e=>[...e.options].map(o=>o.value)") if sel.count() else []
    sel.select_option('HLT'); pg.get_by_role('button', name='저장', exact=True).click(); pg.wait_for_timeout(2000)
    v = sql("select value from site_settings where key='site.landing_after_login'")[0]
    flash = ' '.join(pg.locator('.flash, [role=status], [role=alert]').all_inner_texts())[:120]
    ok('운영 화면 — 소개몰을 로그인 후 첫 화면으로 저장(전: 「형식에 맞지 않습니다」)', v == 'HLT', f'고르기 {opts} · DB {v} · 알림 「{flash}」')
    row_txt = pg.locator('table[data-gwan-list] tr', has_text='소개몰').inner_text()
    ok('운영 화면 — 목록의 소개몰 줄에 「랜딩」 표시', '랜딩' in row_txt, row_txt.replace('\n', ' ')[:120])
    # 신규 가입자
    pg.locator('label', has_text='신규 가입자 첫 화면으로 지정').locator('input[type=checkbox]').check(); pg.wait_for_timeout(500)
    shown_before = sel.input_value()
    sel.select_option('MAL'); pg.get_by_role('button', name='저장', exact=True).click(); pg.wait_for_timeout(2000)
    v2 = sql("select value from site_settings where key='site.landing_new_member'")[0]
    row_txt = pg.locator('table[data-gwan-list] tr', has_text='안심소개').inner_text()
    shown_after = sel.input_value()
    ok('운영 화면 — 신규 가입자 첫 화면 저장 → DB · 목록 「신규 가입자」 · 고르기에 저장한 값', v2 == 'MAL' and '신규 가입자' in row_txt and shown_after == 'MAL',
       f'켜기 전 표시 「{shown_before}」(저장 값 {orig.get("site.landing_new_member")}) · DB {v2} · 줄 「{row_txt.replace(chr(10), " ")[:80]}」 · 고르기 {shown_after}')
    pg.locator('label', has_text='신규 가입자 첫 화면으로 지정').locator('input[type=checkbox]').uncheck(); pg.wait_for_timeout(500)
    ok('운영 화면 — 체크를 끄면 기존 회원 값(소개몰)을 다시 보여 줌', sel.input_value() == 'HLT', f'고르기 {sel.input_value()}')
    ok('운영 화면 — 쪽 스크립트 오류 없음', not errs, '; '.join(errs)[:200])
    ctx.close()

    # ② 사용자 웹 — 로그인하면 소개몰로
    ctx, pg = site_login('member@t.local', 'sgb-test-1234')
    pg.goto(SITE + '/login'); pg.wait_for_timeout(2500)
    ok('사용자 웹 — 로그인한 채 /login 을 열면 저장한 첫 화면(소개몰 /health)으로 감', pg.url.rstrip('/').endswith('/health'), pg.url.replace(SITE, ''))
    ctx.close()
    b.close()

# 되돌리기
for k, val in orig.items():
    # HERO(신규 가입자 기본값)는 관이 아니라 트리거(fn_landing_gwan_guard)가 막으므로 검정 DB 관리자 권한으로 트리거를 끄고 되돌립니다
    sql(f"SET session_replication_role = replica; UPDATE site_settings SET value = $${val}$$ WHERE key = '{k}'")
back = sql("select string_agg(key||'='||value, ' ') from site_settings where key like 'site.landing%'")[0]
print(f'되돌림: {back}')
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
