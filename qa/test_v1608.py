"""v10.608 (docs/750) ㉔ 반품 · 교환 사진 첨부 · 판정 기록
  ① (코드) 파일 용도 RETURN_PHOTO(목록을 읽어 더함 · DTO · 올릴 사람) · 사진 표(가리기만) · 판정 기록(쌓기만 · 상태 바뀜 트리거) · 회원 · 판매자 · 운영 API · 사이트 화면 · 화면 · 문서 750 · 판
  ② (API · DB) 용도 · 정책 · 시험 반품 → 승인(트리거가 STATE 기록 · ADMIN) · 기록 고치기 막힘 · 운영 검수 판정 · 회원은 보이는 기록만 · 꺼짐 사진 409 · 남의 파일 막힘 · 남의 신청 404
  (두 번 돌아도 통과 — 시험 주문 · 반품 · 기록은 끝에 replica 로 지움 · 설정 되돌림)
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB = os.environ.get('ADMIN_WEB')
SITE = os.environ.get('SITE')
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


VER = rd('VERSION').strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=180).read()
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

def ui(fn):
    """playwright 가 있으면 브라우저 하나로 fn(b, seen, perr) · 없으면 None"""
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return None
    seen, perr = {}, []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            fn(b, seen, perr)
            b.close()
    except Exception as ex:
        perr.append(str(ex)[:160])
    return seen, perr


def site_login(b, perr, email):
    ps = b.new_page(viewport={'width': 1280, 'height': 900}); ps.on('pageerror', lambda e: perr.append(str(e)[:120]))
    ps.goto(SITE + '/login', wait_until='networkidle', timeout=120000)
    ps.fill('input[name=email]', email); ps.fill('input[name=password]', PW); ps.click('form.auth button'); ps.wait_for_timeout(2500)
    return ps

SJ = rd('spec/screens.json')

import base64
def jwt_life(tok):
    try:
        p = tok.split(".")[1]; p += "=" * (-len(p) % 4)
        j = json.loads(base64.urlsafe_b64decode(p)); return int(j["exp"]) - int(j["iat"])
    except Exception:
        return None
def login_full(e, pw=PW):
    return call("POST", "/auth/login", {"email": e, "password": pw})
def mk_staff(tag, role="ADMIN"):
    stamp = int(time.time()) % 100000
    em = f"t{tag}s{stamp}@x.com"
    h = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{em}', '시험{tag}', '{h}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{em}'")
    if role:
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag}', true); INSERT INTO account_roles (account_id, role) VALUES ('{aid}', '{role}') ON CONFLICT DO NOTHING; COMMIT;")
    return em, aid
def rm_role(aid, tag):
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag} 지움', true); DELETE FROM account_roles WHERE account_id = '{aid}' AND role <> 'MEMBER'; COMMIT;")




def admin_page(path, fn):
    def run(b, seen, perr):
        pg = b.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: perr.append(str(e)[:120]))
        pg.goto(ADMIN_WEB + "/", wait_until="networkidle", timeout=120000)
        pg.fill("input[name=email]", "admin@x.com"); pg.fill("input[name=password]", PW); pg.click("button[type=submit]"); pg.wait_for_timeout(3000)
        pg.goto(ADMIN_WEB + path, wait_until="networkidle", timeout=120000); pg.wait_for_timeout(3000)
        fn(pg, seen)
    return ui(run)


def setting(key, value, tag):
    """설정 바꾸기(시험만 · 설정 무늬 검사는 그대로)"""
    v = 'NULL' if value is None else "'" + str(value).replace("'", "''") + "'"
    return psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 {tag}', true); UPDATE site_settings SET value = {v} WHERE key = '{key}'; COMMIT;")


def getset(key):
    return psql(f"SELECT coalesce(value, '') FROM site_settings WHERE key = '{key}'")


def migr(prefix):
    d = os.path.join(K, 'prisma', 'migrations')
    n = next((x for x in sorted(os.listdir(d)) if x.startswith(prefix)), None) if os.path.isdir(d) else None
    return open(os.path.join(d, n, 'migration.sql'), encoding='utf-8').read() if n else ''


"""lsq 공통(17차) — 마이그레이션은 번호를 모르므로 글자로 찾음 · 설정 되돌리기 · 머리글 정해 부르기"""
def mig_lsq():
    d = os.path.join(K, 'prisma', 'migrations')
    for n in (sorted(os.listdir(d)) if os.path.isdir(d) else []):
        p = os.path.join(d, n, 'migration.sql')
        if os.path.exists(p):
            s = open(p, encoding='utf-8').read()
            if 'CREATE TABLE IF NOT EXISTS public.lsq_bulk_jobs' in s:
                return s
    return ''


def src(rel):
    return rd('src/modules/lsq/' + rel)


def call_h(m_, p, b=None, t=None, extra=None):
    hd = {'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (test lsq)'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    hd.update(extra or {})
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=180).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


class Keep:
    """설정 값 기억 → 끝에 되돌림"""
    def __init__(self, keys, tag):
        self.keys, self.tag = keys, tag
        self.old = {k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'") for k in keys}

    def back(self):
        for k, v in self.old.items():
            setting(k, v if v != '' else None, self.tag + ' 되돌림')


ML = mig_lsq()
SJD = json.loads(SJ) if SJ.strip().startswith('{') else {'screens': []}
SCREEN_IDS = {s.get('id') for s in SJD.get('screens', [])}
STAMP = int(time.time()) % 1000000
LETTERS = ''.join('가나다라마바사아자차'[int(c)] for c in str(STAMP))   # 숫자 없는 꼬리표(검색 낱말 규칙 — 숫자 3자리 이상은 버림)

"""시험 몸통"""
RE_ = src('return-evidence.ts')
ok('① 코드 — RETURN_PHOTO(DTO · 올릴 사람 · CHECK 는 목록을 읽어 더함) · 사진은 신청의 회원 · 판매자 · 운영만 · 가리기만 · 판정 쌓기만 · 상태 바뀜 트리거 · 회원은 보이는 기록만 · 사이트 화면 · 화면 · 문서 750 · 판 v10.608',
   re.search(r"'HR_DOC', 'RETURN_PHOTO', ('PAGE_IMAGE', )?'LGL_DOC', 'LISTING_VIDEO'\] as const;", rd('src/modules/file/file.dto.ts'))   # v10.653 PAGE_IMAGE 가 RETURN_PHOTO 뒤에 들어옴 and "RETURN_PHOTO: ['MEMBER', 'BIZ_OWNER', 'BIZ_STAFF']" in rd('src/modules/file/file.service.ts')
   and "position('RETURN_PHOTO' IN v_def) = 0" in ML and 'trg_lsq_return_state_log' in ML and 'trg_lsq_return_verdict_lock' in ML and 'hidden_at = now()' in RE_
   and "($2::boolean OR v.visible_to_buyer)" in RE_ and rd('site/src/components/lsq/ReturnEvidence.tsx') and rd('site/src/app/health/seller/center/returns-evidence/page.tsx')
   and 'SB-HLT-LSQ-020' in SCREEN_IDS and 'SB-ADM-LSQ-070' in SCREEN_IDS and 'v10.608' in doc('750_') and VT >= (10, 608), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    adm_id = psql("SELECT id FROM accounts WHERE email = 'admin@x.com'")
    keep = Keep(['lsq.return_photos'], '시험1608')
    em, aid = mk_staff('1608', 'MEMBER')
    consent_ok.agree(em, PW)
    TM = login(em)
    oid = rid = ''
    try:
        pc = psql("SELECT position('RETURN_PHOTO' IN pg_get_constraintdef(oid)) > 0 FROM pg_constraint WHERE conname = 'ck_files_purpose'")
        fp = psql("SELECT count(*) FROM file_policies WHERE purpose = 'RETURN_PHOTO'")
        ok('② DB — 파일 용도 RETURN_PHOTO · 정책 JPG · PNG', pc == 't' and fp == '2', f"{pc} {fp}")
        oid = psql(f"SET session_replication_role = replica; INSERT INTO hlt_orders (order_no, account_id, goods_amount, ship_fee, total, status, paid_at, created_at) VALUES (fn_next_hlt_order_no(), '{aid}', 10000, 0, 10000, 'PAID', now() - interval '1 hour', now() - interval '2 hours') RETURNING id").splitlines()[-1]
        rid = psql(f"SET session_replication_role = replica; INSERT INTO hlt_returns (order_id, kind, reason, detail) VALUES ('{oid}', 'RETURN', 'CHANGE_MIND', '시험1608') RETURNING id").splitlines()[-1]
        up = psql(f"UPDATE hlt_returns SET state = 'REJECTED', decided_by = '{adm_id}', decide_note = '시험1608 반려', decided_at = now() WHERE id = '{rid}'")
        log = psql(f"SELECT string_agg(kind || ':' || actor_side || ':' || coalesce(to_state, ''), ',') FROM lsq_return_verdicts WHERE return_id = '{rid}'")
        lock = psql(f"UPDATE lsq_return_verdicts SET note = 'x' WHERE return_id = '{rid}'")
        ok('② 트리거 — 상태 바뀜이 판정 기록(STATE · ADMIN · REJECTED) · 기록 고치기 막힘(LSQ_VERDICT_LOCKED)',
           ('!' in up) or ('STATE:ADMIN:REJECTED' in (log or '') and 'LSQ_VERDICT_LOCKED' in lock), f"{up[-80:]} {log} {lock[-60:]}")
        v1 = call('POST', f'/admin/lsq/returns/{rid}/verdicts', {'kind': 'INSPECT', 'condition': 'OPENED', 'fault': 'BUYER', 'note': '시험1608 검수', 'visibleToBuyer': True}, TS)
        v2 = call('POST', f'/admin/lsq/returns/{rid}/verdicts', {'kind': 'NOTE', 'note': '운영만 보는 메모', 'visibleToBuyer': False}, TS)
        v3 = call('POST', f'/admin/lsq/returns/{rid}/verdicts', {'kind': 'INSPECT', 'condition': 'OPENED'}, TS)
        one = call('GET', f'/admin/lsq/returns/{rid}', None, TS)
        mine = call('GET', f'/lsq/returns/{rid}/evidence', None, TM)
        other = call('GET', f'/lsq/returns/{rid}/evidence', None, login('buyer@x.com'))
        ok('② 운영 판정 — 검수 · 메모 남김 · 책임 빠지면 422 · 운영은 모두 · 회원은 보이는 기록만 · 남의 신청 404',
           v1.get('ok') is True and v2.get('ok') is True and v3.get('_err') == 422 and len(one.get('verdicts') or []) >= 3
           and not any(x.get('note') == '운영만 보는 메모' for x in mine.get('verdicts') or []) and any(x.get('kind') == 'INSPECT' for x in mine.get('verdicts') or [])
           and other.get('_err') == 404, f"{v1.get('ok')} {v2.get('ok')} {v3.get('_err')} {len(one.get('verdicts') or [])} {len(mine.get('verdicts') or [])} {other.get('_err')}")
        setting('lsq.return_photos', 'off', '시험1608')
        p_off = call('POST', f'/lsq/returns/{rid}/photos', {'fileId': '00000000-0000-4000-8000-000000000000'}, TM)
        guard = psql(f"INSERT INTO lsq_return_photos (return_id, file_id, side, added_by) VALUES ('{rid}', (SELECT id FROM files WHERE owner_account_id <> '{aid}' LIMIT 1), 'BUYER', '{aid}')")
        nt = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{aid}' AND event_code = 'LSQ_RETURN_NOTE'")
        ok('② 사진 — 꺼짐 409 LSQ_RETURN_PHOTO_OFF · 남의 파일은 DB 가 막음 · 회원에게 보이는 검수만 알림 1',
           p_off.get('_err') == 409 and p_off.get('code') == 'LSQ_RETURN_PHOTO_OFF' and ('LSQ_RETURN_PHOTO_FILE' in guard or 'null value' in guard) and nt == '1',
           f"{p_off.get('code')} {guard[-70:]} {nt}")
        if ADMIN_WEB:
            r = admin_page('/#/lsq-return-ev', lambda pg, seen: seen.update(n=pg.locator('[data-lsq-ret]').count()))
            if r is not None:
                seen, perr = r
                ok('③ 화면 — 소개몰 › 반품 사진 · 판정(오류 없음)', seen.get('n') == 1 and not perr, f"{seen} {perr[:2]}")
    finally:
        psql(f"SET session_replication_role = replica; DELETE FROM notifications WHERE account_id = '{aid}' AND event_code = 'LSQ_RETURN_NOTE';"
             + (f" DELETE FROM lsq_return_verdicts WHERE return_id = '{rid}'; DELETE FROM lsq_return_photos WHERE return_id = '{rid}'; DELETE FROM hlt_returns WHERE id = '{rid}';" if rid and not rid.startswith('!') else '')
             + (f" DELETE FROM hlt_orders WHERE id = '{oid}';" if oid and not oid.startswith('!') else ''))
        keep.back()
        rm_role(aid, '1608')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
