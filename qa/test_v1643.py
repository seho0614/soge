"""v10.643 (D308 · docs/787) 새 업종 추가 — 운영 화면에서 「승인 대기」로 만들고 다른 관리자가 승인
  ① (코드) D308 fn_category_guard(허브 · LED 넣기 막음 · 관 바꾸기 막음 · 만든 사람 승인 막음) · POST /admin/categories(ADMIN · SUPER · 감사 CATEGORY_CREATE) ·
     승인 때 approved_by · 승인 칸 부담 주체 · 화면 「새 업종 추가」 · screens.json · 새 관 만들기 안내 글
  ② (DB) EARN · LED 에 넣기 → CATEGORY_GWAN_NOT_ALLOWED · 관 바꾸기 → CATEGORY_GWAN_LOCKED · 같은 사람 승인 → CATEGORY_SAME_PERSON(실제로 · 되돌림)
  ③ (API) 시험 관리자(ADMIN)가 만듦 → PENDING · requested_by · 같은 코드 409 · MAL 축 없음 422 · 허브 422 · 만든 사람이 승인 422 CATEGORY_SAME_PERSON ·
     다른 관리자(admin@x.com) 승인 → APPROVED · approved_by · 부담 주체 · 감사 CATEGORY_CREATE — 끝나면 업종 · 시험 계정 지움(업종 먼저)
  ④ 문서 787 · 판
  (두 번 돌아도 통과 — 코드에 시각을 붙임)
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb' if os.path.isdir(KIT + '/sgb') else KIT
API = os.environ.get('API'); DB = os.environ.get('DB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


def doc(prefix):
    d = os.path.join(K, 'docs')
    return next((open(os.path.join(d, x), encoding='utf-8').read() for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith(prefix)), '')


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=120).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()


def login(e):
    return call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')


VER = rd('VERSION').strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))

MG, DT, SV, CT, UI, GN, SJ = (rd('prisma/migrations/D308_category_create_two_person/migration.sql'), rd('src/modules/catalog/catalog.dto.ts'),
                              rd('src/modules/catalog/catalog.service.ts'), rd('src/modules/catalog/catalog.controller.ts'),
                              rd('web/src/app/admin/Categories.tsx'), rd('web/src/app/admin/gwans/GwanNew.tsx'), rd('spec/screens.json'))
ok('① D308 — fn_category_guard 세 규칙 · BEFORE INSERT OR UPDATE · 지우는 문장 없음 · 퍼센트 없음',
   all(w in MG for w in ('CATEGORY_GWAN_NOT_ALLOWED:', 'CATEGORY_GWAN_LOCKED:', 'CATEGORY_SAME_PERSON:', 'BEFORE INSERT OR UPDATE ON public.categories', "NEW.gwan_code = 'LED'", 'NEW.requested_by IS NOT NULL'))
   and not re.search(r'^\s*(DELETE|TRUNCATE|DROP TABLE)', MG, re.M | re.I) and '%' not in MG, '')
ok('① API — POST admin/categories(ADMIN · SUPER · 감사 CATEGORY_CREATE · 409 · 422) · CreateCategoryDto(코드 형식 · MAL 축)',
   "@Post('admin/categories')" in CT and "@Audit('CATEGORY_CREATE', 'CATEGORY')" in CT and 'class CreateCategoryDto' in DT and '/^[A-Z][A-Z0-9_]{2,39}$/' in DT
   and "'CATEGORY_AXIS_REQUIRED'" in SV and "'CATEGORY_EXISTS'" in SV and "VALUES ($1, $2, $3, 'PENDING'" in SV, '')
ok('① 승인 때 approved_by = 지금 관리자 · 목록에 만든 사람', "approved_by = CASE WHEN $2 = 'APPROVED' THEN $7::uuid" in SV and 'AS "requestedByName"' in SV, '')
ok('① 화면 — 새 업종 추가(허브 · LED 빼고) · 승인 칸 부담 주체 · 만든 사람 표시 · screens.json · 새 관 안내',
   all(w in UI for w in ('function NewCategory', "!g.isHub && g.code !== 'LED'", 'data-cat-new-save', 'data-cat-bearer', '이 분은 승인할 수 없음')) and '"POST /admin/categories"' in SJ
   and '「새 업종 추가」' in GN, '')

if API and DB:
    stamp = str(int(time.time()))[-6:]
    db_hub = psql("BEGIN; INSERT INTO categories (gwan_code, code, name, labor_law_flag) VALUES ('EARN', 'T1643H', '시험', 'NOT_APPLICABLE'); ROLLBACK;")
    db_led = psql("BEGIN; INSERT INTO categories (gwan_code, code, name, labor_law_flag) VALUES ('LED', 'T1643L', '시험', 'NOT_APPLICABLE'); ROLLBACK;")
    db_mv = psql("BEGIN; UPDATE categories SET gwan_code = 'BIZ' WHERE id = (SELECT id FROM categories WHERE gwan_code = 'MNY' LIMIT 1); ROLLBACK;")
    db_same = psql("BEGIN; WITH a AS (SELECT id FROM accounts WHERE email = 'admin@x.com'), c AS (INSERT INTO categories (gwan_code, code, name, labor_law_flag, requested_by) "
                   f"SELECT 'MNY', 'T1643S{stamp}', '시험', 'NOT_APPLICABLE', id FROM a RETURNING id) "
                   "UPDATE categories SET status = 'APPROVED', approved_by = (SELECT id FROM a), approved_at = now() WHERE id = (SELECT id FROM c); ROLLBACK;")
    ok('② DB — 허브(EARN) · LED 넣기 · 관 바꾸기 · 같은 사람 승인 모두 막힘(되돌림)',
       'CATEGORY_GWAN_NOT_ALLOWED' in db_hub and 'CATEGORY_GWAN_NOT_ALLOWED' in db_led and 'CATEGORY_GWAN_LOCKED' in db_mv and 'CATEGORY_SAME_PERSON' in db_same,
       ' | '.join(x[-50:] for x in (db_hub, db_led, db_mv, db_same)))

    # 시험 관리자(ADMIN) — 만든 사람
    em = f't1643a{stamp}@x.com'
    h = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{em}', '시험1643', '{h}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{em}'")
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 1643', true); INSERT INTO account_roles (account_id, role) VALUES ('{aid}', 'ADMIN') ON CONFLICT DO NOTHING; COMMIT;")
    import consent_ok
    consent_ok.agree(em, PW); consent_ok.agree('admin@x.com', PW)
    TA, TS = login(em), login('admin@x.com')
    code = f'MNY_T1643{stamp}'
    try:
        c1 = call('POST', '/admin/categories', {'gwanCode': 'MNY', 'code': code, 'name': f'시험업종{stamp}', 'laborLawFlag': 'NOT_APPLICABLE', 'laborLawMemo': '시험 1643'}, TA)
        c2 = call('POST', '/admin/categories', {'gwanCode': 'MNY', 'code': code, 'name': '두 번', 'laborLawFlag': 'NOT_APPLICABLE'}, TA)
        c3 = call('POST', '/admin/categories', {'gwanCode': 'MAL', 'code': f'MAL_T1643{stamp}', 'name': '축 없음', 'laborLawFlag': 'NOT_APPLICABLE'}, TA)
        c4 = call('POST', '/admin/categories', {'gwanCode': 'EARN', 'code': f'EARN_T1643{stamp}', 'name': '허브', 'laborLawFlag': 'NOT_APPLICABLE'}, TA)
        c5 = call('POST', '/admin/categories', {'gwanCode': 'MNY', 'code': 'bad code', 'name': 'x', 'laborLawFlag': 'NOT_APPLICABLE'}, TA)
        row = psql(f"SELECT status || '|' || (requested_by = '{aid}')::text FROM categories WHERE gwan_code = 'MNY' AND code = '{code}'")
        ok('③ 만들기 — PENDING · requested_by = 만든 관리자 · 같은 코드 409 · MAL 축 없음 422 · 허브 422 · 코드 형식 400',
           c1.get('status') == 'PENDING' and row == 'PENDING|true' and c2.get('_err') == 409 and c2.get('code') == 'CATEGORY_EXISTS'
           and c3.get('_err') == 422 and c3.get('code') == 'CATEGORY_AXIS_REQUIRED' and c4.get('_err') == 422 and c4.get('code') == 'CATEGORY_GWAN_NOT_ALLOWED' and c5.get('_err') == 400,
           f"{c1.get('status')} {row} · {c2.get('_err')} {c2.get('code')} · {c3.get('code')} · {c4.get('code')} · {c5.get('_err')}")
        cid = c1.get('id')
        s1 = call('PATCH', f'/admin/categories/{cid}', {'status': 'APPROVED', 'laborLawFlag': 'NOT_APPLICABLE'}, TA)
        s2 = call('PATCH', f'/admin/categories/{cid}', {'status': 'APPROVED', 'laborLawFlag': 'NOT_APPLICABLE', 'feeBearer': 'SELLER'}, TS)
        aft = psql(f"SELECT c.status || '|' || coalesce(c.fee_bearer, '') || '|' || (c.approved_by = a.id)::text FROM categories c, accounts a WHERE c.id = '{cid}' AND a.email = 'admin@x.com'")
        ok('③ 만든 사람이 승인 → 422 CATEGORY_SAME_PERSON · 다른 관리자 승인 → APPROVED · 부담 주체 SELLER · approved_by',
           s1.get('_err') == 422 and s1.get('code') == 'CATEGORY_SAME_PERSON' and s2.get('status') == 'APPROVED' and aft == 'APPROVED|SELLER|true',
           f"{s1.get('_err')} {s1.get('code')} · {s2.get('status')} {aft}")
        au = psql(f"SELECT count(*) FROM audit.audit_logs WHERE action = 'CATEGORY_CREATE' AND occurred_at > now() - interval '10 minutes'")
        lst = call('GET', '/admin/categories', None, TS)
        mine = next((x for x in lst if x.get('id') == cid), {}) if isinstance(lst, list) else {}
        ok('③ 감사 CATEGORY_CREATE · 목록에 만든 사람 이름', au not in ('', '0') and not au.startswith('!') and mine.get('requestedByName') == '시험1643', f'{au} {mine.get("requestedByName")}')
    finally:
        psql(f"SET session_replication_role = replica; DELETE FROM category_grades WHERE category_id IN (SELECT id FROM categories WHERE code LIKE '%T1643%'); "
             f"DELETE FROM categories WHERE code LIKE '%T1643%';")
        from qa_helpers import drop_accounts_sql
        psql(drop_accounts_sql(f"email = '{em}'"))
    left = psql("SELECT count(*) FROM categories WHERE code LIKE '%T1643%'")
    ok('③ 끝 — 시험 업종 · 계정 지움', left == '0' and psql(f"SELECT count(*) FROM accounts WHERE email = '{em}'") == '0', left)
else:
    print('API · DB 없음 — ② · ③ 건너뜀')

d787 = doc('787_')
ok('④ 문서 787 — 승인 대기 · 다른 관리자 · CATEGORY_SAME_PERSON · D308', all(w in d787 for w in ('승인 대기', '다른 관리자', 'CATEGORY_SAME_PERSON', 'D308')), str(len(d787)))
ok('④ VERSION v10.643 이상', VT >= (10, 643), VER)

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
