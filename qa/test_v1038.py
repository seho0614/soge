"""v10.38 시험 — 파트너센터 계정 기준 전환(P2P 마무리 · D096)

  API=http://localhost:3000/api/v1 SITE=http://localhost:5174 DB=postgresql://sgb:sgb@localhost:5432/sgb python3 test_v1038.py

  돌릴 때마다 새 시험 회원 2명을 만듭니다(V1038-…@t.local — 본인인증 개인 1 · 본인인증 안 한 개인 1 · 사업자 정보 없음).
  ★ 개발 DB 에 시험 입점 · 축 · 공인중개사 신청 · 빠른 매칭 · 리드 이용료 세금계산서 줄을 만듭니다(「V1038」).
"""
import os, json, uuid, subprocess, urllib.request, urllib.error, urllib.parse
from playwright.sync_api import sync_playwright

API = os.environ.get('API', 'http://localhost:3000/api/v1')
SITE = os.environ.get('SITE', 'http://localhost:5174')
DB = os.environ.get('DB', 'postgresql://sgb:sgb@localhost:5432/sgb')
TAG = uuid.uuid4().hex[:6]
PW = 'sgb-test-1234'
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def sql(q):
    r = subprocess.run(['psql', DB, '-X', '-tA', '-v', 'ON_ERROR_STOP=1', '-c', q], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else 'ERR:' + r.stderr.strip()[:200]


def call(method, path, token=None, body=None, idem=False):
    h = {'content-type': 'application/json', **({'authorization': 'Bearer ' + token} if token else {})}
    if idem: h['Idempotency-Key'] = uuid.uuid4().hex
    path = urllib.parse.quote(path, safe='/?=&:-_.')
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b'null')
        except Exception: return e.code, None


def login(email, pw):
    return call('POST', '/auth/login', body={'email': email, 'password': pw})[1]['accessToken']


def mk(email, name, verified):
    return sql(f"""INSERT INTO accounts (email, password_hash, name, account_type, status, identity_verified_at)
                   VALUES ('{email}', crypt('{PW}', gen_salt('bf', 10)), '{name}', 'INDIVIDUAL', 'ACTIVE', {'now()' if verified else 'NULL'}) RETURNING id""").splitlines()[0]


E1, E2 = f'v1038-{TAG}@t.local', f'v1038n-{TAG}@t.local'
pid_ = mk(E1, f'개인파트너{TAG[:3]}', True)
nid_ = mk(E2, f'미인증{TAG[:3]}', False)
__import__('consent_ok').agree(E1, PW); __import__('consent_ok').agree(E2, PW)
t1, t2 = login(E1, PW), login(E2, PW)
ta = login('admin@x.com', 'sgb-dev-1234')
ok('전제 — 시험 회원 2명 · 사업자 정보 없음', sql(f"select count(*) from businesses where account_id in ('{pid_}','{nid_}')") == '0', f'{pid_[:8]} · {nid_[:8]}')

# ① 읽기는 만들지 않음
st, d = call('GET', '/partner/axes', t1)
ok('축 입점 상태 읽기 — 신청 전 빈 목록 · 개인 활동 정보를 만들지 않음', st == 200 and d == [] and sql(f"select count(*) from businesses where account_id='{pid_}'") == '0', f'{st} {d}')

# ② 본인인증 안 한 개인 — 신청 막힘(인증 규칙) · 줄 만들지 않음
st, d = call('POST', '/partner/apply', t2)
ok('입점 신청 — 본인인증 전 개인은 422 IDENTITY_REQUIRED(사업자 요구 아님)', st == 422 and (d or {}).get('code') == 'IDENTITY_REQUIRED', f'{st} {str(d)[:100]}')
st, d = call('POST', '/partner/axes', t2, {'axes': ['EQUIP']})
ok('축 입점 — 본인인증 전 개인은 422 IDENTITY_REQUIRED', st == 422 and (d or {}).get('code') == 'IDENTITY_REQUIRED', f'{st} {str(d)[:100]}')
ok('본인인증 전 개인 — 개인 활동 정보가 생기지 않음', sql(f"select count(*) from businesses where account_id='{nid_}'") == '0', '')

# ③ 본인인증 개인 — 입점 신청
st, d = call('POST', '/partner/apply', t1)
ok('입점 신청 — 본인인증 개인(사업자 정보 없음)이 신청(전: 422 BUSINESS_REQUIRED)', st in (200, 201) and (d or {}).get('status') == 'APPLIED', f'{st} {str(d)[:120]}')
row = sql(f"select kind||'|'||coalesce(biz_reg_no,'-')||'|'||coalesce(verified_at::text,'-')||'|'||company_name from businesses where account_id='{pid_}'")
ok('개인 활동 정보 — PERSON · 사업자등록번호 없음 · 사업자 인증 없음 · 이름 = 회원 이름', row == f'PERSON|-|-|개인파트너{TAG[:3]}', row)
st, d = call('POST', '/partner/apply', t1)
ok('입점 신청 두 번 — 409 ALREADY_APPLIED · 줄 하나', st == 409 and sql(f"select count(*) from businesses where account_id='{pid_}'") == '1', f'{st}')

# ④ 사업자 인증 판정에 섞이지 않음
st, d = call('GET', '/me/summary', t1)
bv = ((d or {}).get('principal') or {}).get('businessVerifiedAt', 'x') if isinstance(d, dict) else 'x'
st2, d2 = call('GET', '/me/account', t1)
ok('사업자 인증 판정 — 개인 활동 정보는 사업자 인증이 아님(요약 · 내 계정 사업자 칸 비어 있음)', st == 200 and bv is None and st2 == 200 and (d2 or {}).get('business') is None, f'me/summary {st} bv={bv} · me/account business={(d2 or {}).get("business")}')
st, d = call('GET', f'/admin/businesses?q=개인파트너{TAG[:3]}', ta)
rows_ = d if isinstance(d, list) else (d or {}).get('items', [])
ok('운영 사업자 신청 목록 — 개인 활동 정보는 나오지 않음', st == 200 and not [x for x in rows_ if x.get('accountId') == pid_], f'{st} 찾은 줄 {len(rows_)}(이 회원 것 0)')
ok('개인 활동 정보에 사업자 인증을 넣을 수 없음(DB 제약)', 'ck_businesses_person' in sql(f"update businesses set verified_at=now() where account_id='{pid_}' and kind='PERSON'"), '')
st, d = call('GET', f'/admin/accounts?q=개인파트너{TAG[:3]}', ta)
items = d if isinstance(d, list) else (d or {}).get('items', [])
ok('운영 회원 목록 — 한 줄 · 사업자 칸 없음', st == 200 and len(items) == 1 and items[0].get('companyName') is None, f'{st} {len(items)}')

# ⑤ 운영 심사 — 개인 · 활동 자격(본인인증)
pid = sql(f"select p.id from partners p join businesses b on b.id=p.business_id where b.account_id='{pid_}'")
st, d = call('GET', '/admin/partners', ta)
me_row = next((x for x in (d or []) if x.get('id') == pid), None) if isinstance(d, list) else None
ok('운영 파트너 목록 — 개인 표시 · 활동 자격 있음(본인인증)', me_row is not None and me_row.get('personal') is True and me_row.get('actorOk') is True and me_row.get('bizVerified') is False, str(me_row)[:160])
st, d = call('POST', f'/admin/partners/{pid}/approve', ta)
ok('입점 승인 — 개인 파트너 ACTIVE(전: PERM 인증된 사업자만)', st in (200, 201) and (d or {}).get('status') == 'ACTIVE', f'{st} {str(d)[:100]}')
st, d = call('GET', '/partner/dashboard', t1)
ok('파트너센터 홈 — 개인 파트너 활동 중', st == 200 and d.get('applied') and d.get('status') == 'ACTIVE', f"{st} {d.get('status')}")
r = sql(f"""BEGIN; UPDATE accounts SET identity_verified_at = NULL WHERE id='{nid_}';
  INSERT INTO businesses (account_id, kind, company_name, ceo_name) VALUES ('{nid_}','PERSON','x','x');
  INSERT INTO partners (business_id) SELECT id FROM businesses WHERE account_id='{nid_}' AND kind='PERSON';
  UPDATE partners SET status='ACTIVE', approved_at=now(), approved_by='{pid_}' WHERE business_id IN (SELECT id FROM businesses WHERE account_id='{nid_}'); ROLLBACK;""")
ok('활동 게이트 — 본인인증 없는 개인 활동 정보는 ACTIVE 불가(DB)', 'PERM' in r, r[:120])

# ⑥ 축 입점 · 공인중개사 인증
st, d = call('POST', '/partner/axes', t1, {'axes': ['EQUIP', 'CONSULT']})
ok('안심소개 축 입점 신청 — 개인(전: BUSINESS_REQUIRED)', st in (200, 201) and {x.get('axis') for x in (d or [])} >= {'EQUIP', 'CONSULT'}, f'{st} {str(d)[:120]}')
st, d = call('POST', '/partner/broker', t1, {'licenseNo': f'11680-2026-{TAG[:5]}', 'officeName': f'V1038 개인중개 {TAG}', 'ceoName': f'개인파트너{TAG[:3]}'})
ok('공인중개사 인증 신청 — 개인(전: 409 BUSINESS_REQUIRED)', st in (200, 201) and (d or {}).get('ok'), f'{st} {str(d)[:120]}')
ok('같은 줄 — 입점 · 축 · 중개사가 개인 활동 정보 한 줄 아래', sql(f"""select (select count(distinct business_id) from (select business_id from partners union all select business_id from mal_partner_axes union all select business_id from broker_verifications) x
   where business_id in (select id from businesses where account_id='{pid_}'))""") == '1', '')
st, d = call('POST', '/partner/broker', t2, {'licenseNo': '11680-2026-00001', 'officeName': 'x', 'ceoName': 'x'})
ok('공인중개사 인증 — 본인인증 전 개인은 막힘(IDENTITY_REQUIRED)', st in (409, 422) and (d or {}).get('code') == 'IDENTITY_REQUIRED', f'{st} {str(d)[:100]}')
ok('부동산 축 승인 — 공인중개사 인증 없이는 여전히 막힘(인증 규칙 유지)', 'AXIS_BROKER' in sql(f"BEGIN; INSERT INTO mal_partner_axes (business_id, axis, state) SELECT id,'RE','APPROVED' FROM businesses WHERE account_id='{pid_}'; ROLLBACK;"), '')

# ⑦ 인력대행 빠른 매칭 회신
st, d = call('POST', '/biz/quick', login('member@t.local', PW), {'when': 'WEEK', 'headcount': 2, 'task': f'V1038 피킹 {TAG}', 'place': '경기 김포시 운양동'})
qid = (d or {}).get('id')
ok('빠른 매칭 요청 올리기(시험 준비)', st in (200, 201) and qid, f'{st} {str(d)[:100]}')
st, d = call('POST', f'/biz/quick/{qid}/offer', t2)
ok('빠른 매칭 회신 — 본인인증 전 개인은 403 IDENTITY_REQUIRED', st == 403 and (d or {}).get('code') == 'IDENTITY_REQUIRED', f'{st} {str(d)[:100]}')
st, d = call('POST', f'/biz/quick/{qid}/offer', t1)
ok('빠른 매칭 회신 — 본인인증 개인(전: 403 역할 BIZ_OWNER)', st in (200, 201) and (d or {}).get('ok'), f'{st} {str(d)[:100]}')
st, d = call('GET', '/biz/quick', t1)
mine = next((x for x in (d or []) if x.get('id') == qid), {}) if isinstance(d, list) else {}
ok('빠른 매칭 목록 — 회신함 표시', mine.get('offered') is True, str(mine)[:120])

# ⑧ 세금계산서 — 개인 파트너는 국세청 전송 대상 아님
ym = '2001-01'
iid = sql(f"INSERT INTO lead_cash_invoices (partner_id, ym, total, supply, vat) VALUES ('{pid}', '{ym}', 11000, 10000, 1000) ON CONFLICT (partner_id, ym) DO UPDATE SET ym=EXCLUDED.ym RETURNING id").splitlines()[0]
st, d = call('POST', f'/admin/etax/lead-cash/{iid}/send', ta, {})
ok('세금계산서 전송 — 개인 파트너는 422 ETAX_PERSON_BUYER(영수증으로 갈음 안내)', st == 422 and (d or {}).get('code') == 'ETAX_PERSON_BUYER', f'{st} {str(d)[:120]}')
ok('노출료 세금계산서 줄 — 공급받는 자 사업자등록번호 비울 수 있음(개인)', sql("select is_nullable from information_schema.columns where table_name='consult_directory_invoices' and column_name='buyer_biz_no'") == 'YES', '')
ok('파트너 이용약관 — 파트너 = 사업자 또는 본인인증 개인 · 개인은 영수증', sql("select count(*) from terms where code='PARTNER' and status<>'ARCHIVED' and body like '%본인인증을 마친 개인%' and body like '%현금영수증으로 갈음%'") != '0', sql("select string_agg(version||':'||status,' ') from terms where code='PARTNER'"))

# ⑨ 사업자 파트너는 그대로
biz_acc = sql("select b.account_id from partners p join businesses b on b.id=p.business_id where b.kind='BUSINESS' and b.verified_at is not null and p.status='ACTIVE' limit 1")
ok('사업자 파트너 — 쓰던 사업자 줄 그대로(fn_actor_business)', sql(f"select fn_actor_business('{biz_acc}', true) = (select p.business_id from partners p join businesses b on b.id=p.business_id where b.account_id='{biz_acc}' limit 1)") == 't'
   and sql(f"select count(*) from businesses where account_id='{biz_acc}' and kind='PERSON'") == '0', biz_acc[:8])

# ⑩ 화면 — 개인 파트너
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1280, 'height': 900}); pg = ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(SITE + '/login'); pg.fill('#lg-mail', E1); pg.fill('#lg-pw', PW); pg.locator('#lg-pw').press('Enter'); pg.wait_for_timeout(2500)
    def text(path):
        pg.goto(SITE + path); pg.wait_for_timeout(1500)
        return pg.inner_text('main') if pg.locator('main').count() else pg.inner_text('body')
    t = text('/partner/apply')
    ok('입점 신청 화면 — 「본인인증 완료 · 개인으로 신청」 · 「사업자 인증이 먼저」 없음', '개인으로 신청' in t and '사업자 인증이 먼저' not in t, '')
    t = text('/partner/business')
    ok('사업자 정보 탭 — 「개인으로 활동」 · 사업자 인증은 선택', '개인으로 활동' in t and '선택' in t, '')
    t = text('/partner/settlement')
    ok('정산 화면 — 개인 파트너에게 열림(「사업자 인증이 필요합니다」 없음)', '사업자 인증이 필요합니다' not in t and '본인인증이 필요합니다' not in t, '')
    t = text('/partner/listings')
    ok('내 매물 — 축 입점 상태가 보임(「사업자 인증이 먼저」 없음)', '사업자 인증이 먼저' not in t and '본인인증이 먼저' not in t, '')
    t = text('/my/broker')
    ok('공인중개사 인증 화면 — 개인에게 신청서(「사업자 인증이 먼저 필요합니다」 없음)', '사업자 인증이 먼저 필요합니다' not in t, '')
    t = text('/my/business')
    ok('사업자 전환 화면 — 지금 하실 수 있는 것에 「파트너 입점 · 공인중개사 인증」', '파트너 입점 · 공인중개사 인증 · 자격 심사 신청' in t, '')
    ok('쪽 스크립트 오류 없음', not errs, '; '.join(errs)[:200])
    ctx2 = b.new_context(viewport={'width': 1280, 'height': 900}); pg = ctx2.new_page()
    pg.goto(SITE + '/login'); pg.fill('#lg-mail', E2); pg.fill('#lg-pw', PW); pg.locator('#lg-pw').press('Enter'); pg.wait_for_timeout(2500)
    pg.goto(SITE + '/partner'); pg.wait_for_timeout(1500)
    t = pg.inner_text('main') if pg.locator('main').count() else pg.inner_text('body')
    ok('파트너센터 — 본인인증 전 개인에게 「본인인증이 먼저」(사업자 요구 아님)', '본인인증이 먼저' in t and '사업자 인증이 먼저' not in t, '')
    b.close()

sql(f"DELETE FROM lead_cash_invoices WHERE id='{iid}'")
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
