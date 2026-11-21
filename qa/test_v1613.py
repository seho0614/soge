"""v10.613 (docs/755) ㉙ 법인카드 사용 즉시 알림 — 회계 › 카드 사용 알림(bzx-card-notice)
  ① (코드) D261 카드 한도 셈 재사용 · 쓰는 사람 알림 · 규칙 · 사흘 뒤 SKIPPED · 정기 작업 · 화면 · 트리거 · 문서 755 · 판
  ② (API · DB) 카드 줄 → 트리거 대기 2줄 · 꺼짐이면 안 보냄 · 켬 → SENT · 큰 금액 + 한도 넘김 · 모르는 카드 · 회원 알림 1 · 운영 알림 · 권한(지급 담당 200 · ADMIN 403) · 기준 바꾸기 SUPER 만
  ③ (화면) 카드 사용 알림 탭 · 줄 · 스위치 상자
  (두 번 돌아도 통과 — 「시험1613-」 올린 기록 · 카드 줄 · 대기 · 별표 끝 4자리 한도 · 알림은 replica 로 지움 · 설정은 되돌림)
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



def migr_has(text):
    """18차 SQL 은 메인이 마이그레이션 번호를 붙임(D292 ~) — 번호 없이 모든 마이그레이션에서 글자를 찾음"""
    d = os.path.join(K, 'prisma', 'migrations')
    if not os.path.isdir(d):
        return False
    for x in sorted(os.listdir(d)):
        p = os.path.join(d, x, 'migration.sql')
        if os.path.exists(p) and text in open(p, encoding='utf-8').read():
            return True
    return False


def job(name, tok):
    return call('POST', '/admin/jobs', {'job': name}, tok)


STAMP = int(time.time()) % 1000000
KST = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
TODAY = KST.strftime('%Y-%m-%d')
def day(n):
    return (KST + datetime.timedelta(days=n)).strftime('%Y-%m-%d')


"""시험 몸통"""
CN, CT, JB = rd('src/modules/bzx/card-notice.ts'), rd('src/modules/bzx/bzx.controller.ts'), rd('src/modules/bzx/jobs.ts')
UI, AP, MN = rd('web/src/app/admin/Bzx.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
ok('① 코드 — D261 카드 한도 셈 재사용(cardUsage) · 쓰는 사람 알림 BZX_CARD_USE · 규칙(큰 금액 · 주말 · 공휴일 · 한도 없음 · 넘김) · 꺼진 동안 사흘 뒤 SKIPPED · 정기 작업',
   all(f in CN for f in ("from '../acct/cardlimit'", 'cardUsage(db, ym)', "'BZX_CARD_USE'", 'public_holidays', "'bzx.card_notify'", "'bzx.card_big_amount'", "interval '3 days'"))
   and 'cardNoticeJob(db)' in JB and "@Get('card-notices')" in CT and "@Roles('SUPER', 'PAYOUT')" in CT, f"{len(CN)}")
ok('① 화면 · SQL · 문서 — 회계 › 카드 사용 알림(bzx-card-notice · SB-ADM-BZX-040 · SUPER · 지급 담당) · 카드 줄 트리거 · 문서 755 · 판',
   'export function BzxCardNotices' in UI and "['bzx-card-notice', '카드 사용 알림']" in MN and "screen: 'SB-ADM-BZX-040'" in MN and "'bzx-card-notice': ['SUPER', 'PAYOUT']" in AP
   and '"SB-ADM-BZX-040"' in SJ and migr_has('CREATE TRIGGER trg_bzx_card_txn_notice AFTER INSERT ON public.acct_card_txns') and migr_has("('bzx.card_notify', 'off'")
   and '즉시' in doc('755_') and VT >= (10, 613), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    SID = psql("SELECT id FROM accounts WHERE email = 'admin@x.com'")
    pe, pid = mk_staff(f'1613p{STAMP % 97}', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    ae, aid = mk_staff(f'1613a{STAMP % 97}', 'ADMIN'); consent_ok.agree(ae, PW); TA = login(ae)
    tail, tail2 = f'*{STAMP % 1000:03d}', f'**{STAMP % 97:02d}'   # 별표로 시작 — 실제 카드 끝 4자리와 겹치지 않게
    old = {k: getset(k) for k in ('bzx.card_notify', 'bzx.card_big_amount')}
    T0 = psql("SELECT now()")
    def clean():
        psql("SET session_replication_role = replica; "
             f"DELETE FROM ops_alerts WHERE alert_code = 'BZX_CARD_USE' AND raised_at >= '{T0}'::timestamptz - interval '1 minute'; "
             f"DELETE FROM notifications WHERE event_code = 'BZX_CARD_USE' AND account_id = '{SID}' AND body LIKE '%시험1613%'; "
             "DELETE FROM bzx_card_notices WHERE txn_id IN (SELECT t.id FROM acct_card_txns t JOIN acct_card_uploads u ON u.id = t.upload_id WHERE u.filename LIKE '시험1613-%'); "
             "DELETE FROM acct_card_txns WHERE upload_id IN (SELECT id FROM acct_card_uploads WHERE filename LIKE '시험1613-%'); "
             "DELETE FROM acct_card_uploads WHERE filename LIKE '시험1613-%'; "
             f"DELETE FROM acct_card_limits WHERE card_tail IN ('{tail}', '{tail2}');")
    clean()
    try:
        setting('bzx.card_notify', 'off', '1613'); setting('bzx.card_big_amount', '500000', '1613')
        lim = psql(f"INSERT INTO acct_card_limits (card_tail, name, holder_id, monthly_limit, active) VALUES ('{tail}', '시험카드1613', '{SID}', 100000, true)")
        up = psql(f"INSERT INTO acct_card_uploads (filename, card, rows_total, rows_added, rows_dup) VALUES ('시험1613-{STAMP}.csv', '시험', 2, 2, 0) RETURNING id").split('\n')[0]
        ins = psql(f"INSERT INTO acct_card_txns (upload_id, used_on, merchant, amount, card_tail, row_hash) VALUES "
                   f"({up}, '{TODAY}', '시험1613 가맹점', 600000, '{tail}', md5('a{STAMP}') || md5('b{STAMP}')), "
                   f"({up}, '{TODAY}', '시험1613 모르는 카드', 12000, '{tail2}', md5('c{STAMP}') || md5('d{STAMP}'))")
        q0 = psql(f"SELECT string_agg(n.state || ':' || coalesce(n.holder_id::text, '-'), ',' ORDER BY n.amount DESC) FROM bzx_card_notices n JOIN acct_card_txns t ON t.id = n.txn_id WHERE t.upload_id = {up or 0}")
        j0 = job('bzx_frequent', TS)
        q1 = psql(f"SELECT string_agg(n.state, ',') FROM bzx_card_notices n JOIN acct_card_txns t ON t.id = n.txn_id WHERE t.upload_id = {up or 0}")
        ok('② 카드 줄이 들어오면 트리거가 대기 2줄(쓰는 사람은 한도에 정한 사람 · 모르는 카드는 없음) · 스위치 꺼짐이면 정기 작업이 보내지 않음',
           '!' not in lim + ins and q0 == f'PENDING:{SID},PENDING:-' and q1 == 'PENDING,PENDING', f"{lim[-60:]} {ins[-60:]} {q0} {q1} {(j0.get('detail') or {}).get('cards') if isinstance(j0.get('detail'), dict) else j0}")
        setting('bzx.card_notify', 'on', '1613')
        run = call('POST', '/admin/bzx/card-notices/run', None, TP)
        rules = psql(f"SELECT string_agg(array_to_string(n.rules, '+') || '/' || n.state, ',' ORDER BY n.amount DESC) FROM bzx_card_notices n JOIN acct_card_txns t ON t.id = n.txn_id WHERE t.upload_id = {up or 0}")
        nt = psql(f"SELECT count(*) FROM notifications WHERE event_code = 'BZX_CARD_USE' AND account_id = '{SID}' AND created_at >= '{T0}' AND body LIKE '%시험1613 가맹점%'")
        al = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'BZX_CARD_USE' AND raised_at >= '{T0}' AND detail::text LIKE '%{tail}%'")
        r1, r2 = (rules.split(',') + ['', ''])[:2]
        ok('② 켜고 지금 보내기(지급 담당) → 둘 다 SENT · 큰 금액 + 한도 넘김 · 모르는 카드 NO_LIMIT · 쓰는 사람 회원 알림 1 · 운영 알림(살펴볼 사용)',
           run.get('on') is True and run.get('sent', 0) >= 2 and 'BIG' in r1 and 'OVER' in r1 and r1.endswith('/SENT') and 'NO_LIMIT' in r2 and r2.endswith('/SENT') and nt == '1' and al == '1',
           f"{run} {rules} {nt} {al}")
        lst = call('GET', '/admin/bzx/card-notices', None, TP)
        mine = [x for x in lst.get('items') or [] if x.get('tail') in (tail, tail2)]
        la = call('GET', '/admin/bzx/card-notices', None, TA)
        sb = call('PUT', '/admin/bzx/card-notices/settings', {'bigAmount': 5000, 'reason': '시험 1613'}, TS)
        sp = call('PUT', '/admin/bzx/card-notices/settings', {'bigAmount': 1000000, 'reason': '시험 1613'}, TP)
        so = call('PUT', '/admin/bzx/card-notices/settings', {'bigAmount': 1000000, 'reason': '시험 1613'}, TS)
        ok('② 목록(지급 담당) 우리 2줄 · 운영 관리자(ADMIN) 403 · 큰 금액 기준 5,000 은 400 · 기준 바꾸기는 SUPER 만(지급 담당 403) · SUPER 200',
           len(mine) == 2 and la.get('_err') == 403 and sb.get('_err') == 400 and sp.get('_err') == 403 and so.get('ok') is True and getset('bzx.card_big_amount') == '1000000',
           f"{len(mine)} {la.get('_err')} {sb.get('_err')} {sp.get('_err')} {so}")
        if ADMIN_WEB:
            def chk(pg, seen):
                pg.wait_for_selector('[data-bzx-cn]', timeout=30000); pg.wait_for_timeout(800)
                seen['rows'] = pg.locator('[data-bzx-cn-row]').count()
                seen['sw'] = pg.locator('[data-bzx-switches]').count()
            res3 = admin_page('/#/bzx-card-notice', chk)
            if res3 is None:
                print('  (playwright 없음 — ③ 건너뜀)')
            else:
                seen, perr = res3
                ok('③ 화면 — 회계 › 카드 사용 알림 · 줄 2 이상 · 스위치 상자 · 화면 오류 없음', (seen.get('rows') or 0) >= 2 and seen.get('sw') == 1 and not perr, f"{seen} {perr[:2]}")
    finally:
        clean()
        for k, v in old.items():
            setting(k, v or ('off' if k == 'bzx.card_notify' else '500000'), '1613 되돌림')
        rm_role(pid, '1613p'); rm_role(aid, '1613a')
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
