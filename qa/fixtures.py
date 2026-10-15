"""시험 준비 — DB 를 새로 만든 뒤(새 설치 · Docker 새 볼륨) 한 번 돌립니다. 여러 번 돌려도 같습니다.

왜 필요한가 (2026-10-02 · v10.13 에서 실측)
  몇몇 점검은 「이미 있는 자료」를 전제로 합니다. 오래 쓰던 개발 DB 에는 그 자료가 쌓여 있어 드러나지 않았는데,
  DB 를 새로 만들자 준비 자료가 없어 실패했습니다(제품 결함이 아니라 시험 전제가 빠진 것).

    1. 건강몰 고민–성분 · 상품–성분 연결   srv_hlt · srv_hlt_ui · srv_proto (고민별 · 성분별)
       → 시드(scripts/seed-realistic.js)도 고쳤습니다. 이미 만든 DB 에는 여기서 채웁니다.
    2. buyer@x.com 의 배송지 1건              fixes_1002 (건강몰 주문)
    3. 제휴 상품 2건(판매 중) + 중지 1건 · intro@x.com 의 소개링크 1건   srv_aff · srv_aff_ui
    4. 안심소개 매물 5건 이상(중개사 인증 사업자 brk_*)   srv_refcode · srv_refcode_ui
       → srv_ptn.py 가 한 번에 1건씩 만듭니다. 모자란 만큼 돌립니다.
    5. 「이건 어때?」 투표 3건                  메인 카드
    6. 소개몰 판매 중 상품의 재고 30 이상      srv_hlt_ui · srv_retship · srv_mall · site_mall (주문 시험이 재고를 씁니다 · v10.25)

사용:  API=http://localhost:3000/api/v1 python3 fixtures.py        DB=postgresql://…/sgb
"""
import json, os, subprocess, sys, uuid, urllib.request, urllib.error

B = os.environ.get('API', 'http://localhost:3000/api/v1')
DB = os.environ.get('DB', 'postgresql://sgb:sgb@localhost:5432/sgb')
HERE = os.path.dirname(os.path.abspath(__file__))
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
R = []

def q(s):
    return subprocess.run(['psql', DB, '-tAc', s], capture_output=True, text=True).stdout.strip().split('\n')[0]

def sql(s):
    p = subprocess.run(['psql', DB, '-v', 'ON_ERROR_STOP=1', '-qc', s], capture_output=True, text=True)
    return p.returncode, (p.stderr or '').strip()

def call(m, p, tok=None, body=None):
    h = {'content-type': 'application/json', 'Idempotency-Key': uuid.uuid4().hex, 'user-agent': UA}
    if tok: h['authorization'] = 'Bearer ' + tok
    data = json.dumps(body).encode() if body is not None else (b'{}' if m in ('POST', 'PATCH') else None)
    req = urllib.request.Request(B + p, method=m, data=data, headers=h)
    try:
        r = urllib.request.urlopen(req, timeout=30); st = r.status; raw = r.read()
    except urllib.error.HTTPError as e:
        st = e.code; raw = e.read()
    try: js = json.loads(raw) if raw else None
    except Exception: js = None
    return st, js

def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:240]})
    print('ok  ' if ok else 'FAIL', step, str(detail)[:160], file=sys.stderr)

def login(e, pw='sgb-dev-1234'):
    return call('POST', '/auth/login', body={'email': e, 'password': pw})[1]['accessToken']

ADM = login('admin@x.com'); SEL = login('intro@x.com'); BUY = login('buyer@x.com')

# ── 1. 건강몰 연결 (D002 와 같은 규칙) ─────────────────────────────────────
rc, err = sql(r"""
INSERT INTO hlt_concern_ingredients (concern_code, ingredient_code, sort)
SELECT v.c, v.i, v.s
  FROM (VALUES ('IMMUNE','PROBIO',1), ('IMMUNE','VITD',3), ('EYE','OMEGA3',2), ('BONE','CALC',1), ('BONE','VITD',2),
               ('GLUCOSE','PROBIO',2), ('FATIGUE','REDGIN',2), ('BRAIN','OMEGA3',2), ('CIRC','OMEGA3',1), ('CIRC','REDGIN',2)) AS v(c, i, s)
 WHERE EXISTS (SELECT 1 FROM ingredients g WHERE g.code = v.i) AND EXISTS (SELECT 1 FROM hlt_concerns k WHERE k.code = v.c)
ON CONFLICT DO NOTHING;
INSERT INTO hlt_product_ingredients (product_id, ingredient_code)
SELECT DISTINCT p.id, g.code
  FROM hlt_products p CROSS JOIN ingredients g
  CROSS JOIN LATERAL unnest(array_prepend(g.name, coalesce(g.aliases, '{}'::text[]))) AS k(key)
 WHERE NOT g.is_excipient AND NOT g.is_group
   /* v10.26 (D027) — 이미 성분이 이어진 상품(견본 등)은 건드리지 않습니다(이름에 다른 성분 낱말이 섞여 있어도 · seed-realistic.js 와 같음) */
   AND NOT EXISTS (SELECT 1 FROM hlt_product_ingredients x WHERE x.product_id = p.id)
   AND char_length(lower(regexp_replace(k.key, '[\s\-·_]', '', 'g'))) >= 2
   AND strpos(lower(regexp_replace(p.name, '[\s\-·_]', '', 'g')), lower(regexp_replace(k.key, '[\s\-·_]', '', 'g'))) > 0
ON CONFLICT DO NOTHING;
UPDATE hlt_product_ingredients pi SET is_main = true
  FROM (SELECT DISTINCT ON (product_id) product_id, ingredient_code FROM hlt_product_ingredients ORDER BY product_id, sort, ingredient_code) f
 WHERE pi.product_id = f.product_id AND pi.ingredient_code = f.ingredient_code
   AND NOT EXISTS (SELECT 1 FROM hlt_product_ingredients m WHERE m.product_id = pi.product_id AND m.is_main);""")
n_ci, n_pi = q('select count(*) from hlt_concern_ingredients'), q('select count(*) from hlt_product_ingredients')
rec(f'1 건강몰 연결 — 고민–성분 {n_ci}건 · 상품–성분 {n_pi}건', rc == 0 and int(n_ci or 0) >= 8 and int(n_pi or 0) >= 4, err)

# ── 2. buyer 배송지 ────────────────────────────────────────────────────────
st, addrs = call('GET', '/me/health/addresses', BUY)
if st == 200 and not addrs:
    call('POST', '/me/health/addresses', BUY, {'label': '집', 'receiver': '김구매', 'phone': '010-1111-2222', 'zipcode': '06000', 'addr1': '서울 강남구 테헤란로 1'})
    st, addrs = call('GET', '/me/health/addresses', BUY)
rec(f'2 buyer@x.com 배송지 {len(addrs or [])}건', st == 200 and len(addrs or []) >= 1, st)

# ── 3. 제휴 상품 · 소개링크 ────────────────────────────────────────────────
WANT = [('FX-SOLAR', '태양광 무료 상담 신청', 50000, 'https://example.com/solar', '세바코리아', 'ON_SALE'),
        ('FX-WATER', '정수기 렌탈 상담 신청', 30000, 'https://example.com/water', '맑은물렌탈', 'ON_SALE'),
        ('FX-STOP', '판매 중지 시험 상품', 10000, 'https://example.com/stopped', '시험 광고주', 'STOPPED')]
for code, name, fee, url, adv, status in WANT:
    if q(f"select count(*) from affiliate_products where code='{code}'") == '0':
        st, j = call('POST', '/admin/affiliates/products', ADM, {'code': code, 'name': name, 'commission': fee, 'landingUrl': url,
                                                                 'advertiser': adv, 'description': '시험 준비 자료(fixtures.py)'})
        if st >= 300: rec(f'3 제휴 상품 {code} 등록', False, (st, j)); continue
    pid = q(f"select id from affiliate_products where code='{code}'")
    if status == 'STOPPED':
        # 중지 상품의 링크(「판매 중 아닌 상품 링크 → 404」 시험) — 판매 중일 때 링크를 만든 뒤 중지합니다
        if q(f"select status from affiliate_products where id='{pid}'") != 'ON_SALE': call('PATCH', f'/admin/affiliates/products/{pid}', ADM, {'status': 'ON_SALE'})
        if q(f"select count(*) from partner_links where product_id='{pid}'") == '0':
            call('POST', '/partner/affiliate/links', SEL, {'productId': pid, 'label': '중지 상품 링크(시험 준비)'})
    if q(f"select status from affiliate_products where id='{pid}'") != status:
        call('PATCH', f'/admin/affiliates/products/{pid}', ADM, {'status': status})
on = q("select count(*) from affiliate_products where status='ON_SALE' and landing_url ~ '^https?://'")
rec(f'3a 제휴 상품 — 판매 중 {on}건 · 중지 {q("select count(*) from affiliate_products where status<>$$ON_SALE$$")}건', int(on or 0) >= 2)
live = "select count(*) from partner_links l join affiliate_products p on p.id=l.product_id join partners t on t.id=l.partner_id join businesses b on b.id=t.business_id join accounts a on a.id=b.account_id where a.email='intro@x.com' and p.status='ON_SALE'"
if q(live) == '0':
    pid = q("select id from affiliate_products where code='FX-SOLAR'")
    st, j = call('POST', '/partner/affiliate/links', SEL, {'productId': pid, 'label': '시험 준비 링크'})
    if st >= 300: rec('3b intro@x.com 소개링크 발급', False, (st, j))
rec(f'3b intro@x.com 의 판매 중 상품 소개링크 {q(live)}건', int(q(live) or 0) >= 1)

# ── 4. 안심소개 매물(중개사 인증 사업자) 5건 ───────────────────────────────
CNT = """select count(*) from listings l join accounts a on a.id=l.owner_account_id join categories c on c.id=l.category_id
  where l.status='PUBLISHED' and l.gwan_code='MAL' and a.email like 'brk_%@t.local' and a.status='ACTIVE' and not fn_category_no_intro(c.id)
    and exists(select 1 from account_roles r where r.account_id=a.id and r.role='BIZ_OWNER')
    and exists(select 1 from businesses b where b.account_id=a.id and b.verified_at is not null)"""
n0 = int(q(CNT) or 0); runs = 0
while int(q(CNT) or 0) < 5 and runs < 6:
    subprocess.run([sys.executable, os.path.join(HERE, 'srv_ptn.py')], capture_output=True, text=True, env={**os.environ, 'API': B}); runs += 1
rec(f'4 안심소개 매물(brk_*) {q(CNT)}건 (전 {n0}건 · srv_ptn.py {runs}회)', int(q(CNT) or 0) >= 5)

# ── 5. 「이건 어때?」 투표 3건 (v10.14 · D021) — 메인 카드에 나가는 것. 시드가 넣지만, 시드를 안 돌린 DB 에는 여기서 넣습니다 ──
if q("select count(*) from polls") == '0':
    _kit = os.path.join(os.path.dirname(HERE), 'sgb')
    K = os.environ.get('KIT') or (_kit if os.path.isdir(os.path.join(_kit, 'scripts')) else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
    subprocess.run(['psql', DB, '-v', 'ON_ERROR_STOP=1', '-qf', os.path.join(K, 'scripts/seed-polls.sql')], capture_output=True, text=True)
n_home = q("select count(*)||'/'||count(distinct kind) from v_poll_home")
rec(f'5 메인에 나가는 투표(종류마다 1건) {n_home}', n_home == '3/3')

# ── 6. 소개몰 재고 (v10.25) — 주문 시험이 돌 때마다 2 ~ 4개씩 줄고(남기는 주문이 있음) 운영 화면에 재고 입력이 아직 없습니다(G-147).
#      v10.25 에서 건강기능식품 · 의료기기가 판매 중지되어 팔리는 상품이 3종으로 줄자 몇 번 만에 바닥났습니다(전수 검정 첫 실행 — srv_hlt_ui · srv_retship 이 「재고가 부족합니다」로 멈춤).
#      판매 중 상품의 재고가 30 미만이면 30 으로 채웁니다(개발 · 시험 DB 에서만 도는 준비 자료입니다 — 서버 적용 길은 이 파일을 부르지 않습니다).
#      v10.26 (D027) — 재고는 옵션에 있습니다(상품의 재고는 옵션 재고의 합 · 상품 행은 직접 고칠 수 없음). 켠 옵션마다 30 으로 채웁니다.
#      단, 견본 p10 의 6개월 옵션은 시안대로 재고 0(품절 옵션 — 「한 달 N원 부터」 · 품절 표시를 보는 시험이 씁니다).
rc, err = sql("""UPDATE hlt_product_options o SET stock = 30 FROM hlt_products p
                  WHERE p.id = o.product_id AND p.status = 'ON_SALE' AND o.is_active AND o.stock < 30
                    AND NOT (p.code = 'p10' AND o.months = 6)""")
low = q("""select count(*)||' / '||coalesce(min(o.stock)::text,'-') from hlt_product_options o join hlt_products p on p.id=o.product_id
           where p.status='ON_SALE' and o.is_active and not (p.code = 'p10' and o.months = 6)""")
rec(f'6 소개몰 재고 — 판매 중 상품의 켠 옵션 수 / 가장 적은 옵션 재고 {low}', rc == 0 and int((low.split(' / ')[0]) or 0) >= 1 and low.split(' / ')[1] not in ('-',) and int(low.split(' / ')[1]) >= 30, err)

json.dump(R, open(os.path.join(HERE, 'fixtures.json'), 'w'), ensure_ascii=False, indent=1)
print(f"준비 {sum(r['ok'] for r in R)} / {len(R)}")
