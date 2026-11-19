"""v10.404 (D248 · docs/541) PG 정산 맞추기
  ① (코드) D248 PG 정산 표 · 가드 · 설정 · 정기 작업 · API · 전표 PG_SETTLE · 화면 · 문서
  ② (API · DB) CSV 올리기 — 머리줄 찾기 · 같은 파일 다시 「이미 있음」 · 못 읽은 줄 · 자동 맞춤 · 내용 고치기 · 지우기 DB 가 막음
  ③ (API) 맞춤 · 전표 — 금액 다른 전표 422 · 이미 맞춘 전표 409 · 맞출 것 없음 사유 · PG_SETTLE 줄 · 전표 뒤 풀기 409
  ④ (정기 작업) 안 들어온 결제 ACCT_PG_UNSETTLED 하루 하나
  ⑤ (화면) 회계 › PG 정산
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


import glob
def mig(prefix):
    fs = sorted(glob.glob(os.path.join(K, 'prisma/migrations', prefix + '_*', 'migration.sql')))
    return open(fs[0], encoding='utf-8').read() if fs else ''


M48 = mig('D248')
AC, UI, AP, MN = rd('src/modules/acct/acct.controller.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
SRC = rd('src/modules/acct/sources.ts')
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
PG = rd('src/modules/acct/pgsettle.ts')
ok('① 코드 — D248 PG 정산 표(같은 줄 한 번 · 내용 못 고침 · 금액 확인) · 설정 · 정기 작업 acct_pg_check · API 4 · 감사 · 전표 PG_SETTLE · 화면 · 메뉴 · 명세 · 문서 541 · 판 v10.404',
   'CREATE TABLE IF NOT EXISTS public.acct_pg_txns' in M48 and 'row_hash     text NOT NULL UNIQUE' in M48 and 'ACCT_PG_MISMATCH' in M48 and "'acct.pg_unsettled_days'" in M48
   and "('acct_pg_check', 1440, 9, 25," in M48 and "@Post('pg/upload')" in AC and "@Get('pg')" in AC and "@Post('pg/:id/match')" in AC and "@Post('pg/auto-match')" in AC
   and "@Audit('ACCT_PG_MATCH', 'SETTING')" in AC and 'export function readPgCsv' in PG and "name: 'PG_SETTLE'" in PG and 'PG_SOURCES' in SRC
   and 'export function AcctPg' in UI and "{tab === 'acct-pg' && <AcctPg />}" in AP and "['acct-pg', 'PG 정산']" in MN
   and '"SB-ADM-ACC-190"' in SJ and 'PG' in doc('541_') and VT >= (10, 404), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1404', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    ym, d0 = kst.strftime('%Y-%m'), kst.strftime('%Y-%m-%d')
    old = (kst - datetime.timedelta(days=30)).strftime('%Y-%m-%d')
    stamp = int(time.time()) % 1000000
    amt = 70000 + stamp % 9000                 # 다른 시험 · 두 번째 돌림과 겹치지 않는 금액
    amt2, amt3 = amt + 13, amt + 29
    fee, fv = 1980, 180
    keys = [f't1404a-{stamp}', f't1404b-{stamp}', f't1404c-{stamp}']
    def mk_entry(key, day, n, replica=False):
        rp = 'SET session_replication_role = replica; ' if replica else ''
        return psql(f"{rp}BEGIN; WITH e AS (INSERT INTO acct_entries (entry_date, source, source_key, memo, evidence) VALUES ('{day}', 'TEST_PG', '{key}', '시험 1404', 'CARD_PG') RETURNING id) "
                    f"INSERT INTO acct_lines (entry_id, role, debit, credit) SELECT id, 'PG_RECV', {n}, 0 FROM e UNION ALL SELECT id, 'REV_SUB', 0, {n} FROM e; COMMIT; "
                    f"SELECT id FROM acct_entries WHERE source = 'TEST_PG' AND source_key = '{key}'").splitlines()[-1]
    try:
        e1 = mk_entry(keys[0], d0, amt)
        e2 = mk_entry(keys[1], d0, amt2 + 1)                 # 금액이 1원 다른 전표(맞추면 DB 가 막음)
        csv = ('PG 정산 내역\n'
               '승인일자,정산일자,거래번호,결제수단,결제금액,수수료,수수료부가세,정산금액\n'
               f'{d0},{d0},TID1404A{stamp},카드,"{amt:,}",{fee},{fv},"{amt - fee:,}"\n'
               f'{d0.replace("-", "")},{d0.replace("-", "")},TID1404B{stamp},카드,{amt2},0,0,{amt2}\n'
               f'날짜아님,,,,abc,,,\n')
        up = call('POST', '/admin/acct/pg/upload', {'csv': csv, 'filename': f't1404-{stamp}.csv', 'pgName': '시험PG'}, TP)
        up2 = call('POST', '/admin/acct/pg/upload', {'csv': csv}, TP)
        bad = call('POST', '/admin/acct/pg/upload', {'csv': '아무 글\n1,2,3\n'}, TP)
        mem = call('POST', '/admin/acct/pg/upload', {'csv': csv}, TB)
        ta = psql(f"SELECT id FROM acct_pg_txns WHERE pg_key = 'TID1404A{stamp}'")
        tb = psql(f"SELECT id FROM acct_pg_txns WHERE pg_key = 'TID1404B{stamp}'")
        ma = psql(f"SELECT coalesce(match_kind, '') || '|' || coalesce(entry_id::text, '') FROM acct_pg_txns WHERE id = {ta or 0}")
        x1 = psql(f"UPDATE acct_pg_txns SET gross = 1 WHERE id = {ta or 0}")
        x2 = psql(f"DELETE FROM acct_pg_txns WHERE id = {ta or 0}")
        ok('② CSV — 머리줄(2번째 줄) 찾기 · 새로 2 · 못 읽음 1 · 같은 파일 다시 올리면 이미 있음 2 · 후보 하나인 줄 자동 맞춤 · 머리줄 없으면 422 · 회원 403 · 내용 고치기 · 지우기 DB 가 막음',
           up.get('added') == 2 and up.get('bad') == 1 and up2.get('added') == 0 and up2.get('dup') == 2 and (up.get('autoMatched') or 0) >= 1
           and ma == f'ENTRY|{e1}' and bad.get('code') == 'PG_CSV_HEAD' and mem.get('_err') == 403 and 'ACCT_PG' in x1 and 'ACCT_PG' in x2,
           f"{ {k: up.get(k) for k in ('added', 'dup', 'bad', 'autoMatched')} } · 다시 {up2.get('added')}/{up2.get('dup')} · {ma} (전표 {e1}) · {bad.get('code')} · {mem.get('_err')} · {x1[-30:]} · {x2[-30:]}")

        mm = call('POST', f'/admin/acct/pg/{tb}/match', {'entryId': e2}, TP)
        used = call('POST', f'/admin/acct/pg/{tb}/match', {'entryId': e1}, TP)
        ig0 = call('POST', f'/admin/acct/pg/{tb}/match', {'ignore': True, 'note': ''}, TP)
        ig1 = call('POST', f'/admin/acct/pg/{tb}/match', {'ignore': True, 'note': '시험 결제'}, TP)
        call('POST', '/admin/acct/journal/run', None, TS)
        st = psql(f"SELECT string_agg(l.role || ':' || l.debit || ':' || l.credit, ',' ORDER BY l.role) FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id WHERE e.source = 'PG_SETTLE' AND e.source_key = '{ta}'")
        nb = psql(f"SELECT count(*) FROM acct_entries WHERE source = 'PG_SETTLE' AND source_key = '{tb}'")
        cl = call('POST', f'/admin/acct/pg/{ta}/match', {'clear': True, 'note': '시험 풀기'}, TP)
        mon = call('GET', f'/admin/acct/pg?ym={ym}', None, TP)
        want = ','.join(sorted([f'CASH:{amt - fee}:0', f'EXP_FEE:{fee - fv}:0', f'PG_RECV:0:{amt}', f'VAT_IN:{fv}:0']))
        ok('③ 맞춤 · 전표 — 금액 다른 전표 422 · 이미 맞춘 전표 409 · 맞출 것 없음 사유 없으면 422 · 있으면 됨 · 맞춘 줄만 PG_SETTLE(보통예금 · 지급수수료 · 부가세대급금 / PG 정산 받을 돈) · 맞출 것 없음 줄은 전표 없음 · 전표 뒤 풀기 409 · 그 달 합계',
           mm.get('code') == 'ACCT_PG_MISMATCH' and used.get('code') == 'PG_ENTRY_USED' and ig0.get('code') == 'PG_REASON' and ig1.get('matchKind') == 'IGNORE'
           and st == want and nb == '0' and cl.get('code') == 'PG_BOOKED' and (mon.get('count') or {}).get('total', 0) >= 2,
           f"{mm.get('code')} · {used.get('code')} · {ig0.get('code')} {ig1.get('matchKind')} · {st} (기대 {want}) · B 전표 {nb} · {cl.get('code')} · {mon.get('count')}")

        e3 = mk_entry(keys[2], old, amt3, replica=True)       # 30일 전 PG 정산 받을 돈(맞춘 PG 줄 없음 · 마감한 달일 수 있어 replica)
        j1 = call('POST', '/admin/jobs', {'job': 'acct_pg_check'}, TS)
        j2 = call('POST', '/admin/jobs', {'job': 'acct_pg_check'}, TS)
        na = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'ACCT_PG_UNSETTLED' AND detail->>'day' = '{d0}'")
        un = call('GET', f'/admin/acct/pg?ym={ym}', None, TP)
        ok('④ 안 들어온 결제 — 30일 전 PG 정산 받을 돈 전표가 목록에 · 정기 작업 두 번 돌려도 오늘 알림 하나',
           (any(x.get('entryId') == e3 for x in un.get('unsettled') or []) or (un.get('count') or {}).get('unsettled', 0) >= 50) and na == '1' and not j1.get('_err') and not j2.get('_err'),
           f"안 들어옴 {(un.get('count') or {}).get('unsettled')} · 알림 {na} · {j1.get('_err') or ''}{j2.get('_err') or ''}")
    finally:
        ks = ','.join(f"'{k}'" for k in keys)
        psql(f"SET session_replication_role = replica; "
             f"DELETE FROM acct_lines WHERE entry_id IN (SELECT e.id FROM acct_entries e WHERE (e.source = 'TEST_PG' AND e.source_key IN ({ks})) OR (e.source = 'PG_SETTLE' AND e.source_key IN (SELECT id::text FROM acct_pg_txns WHERE pg_key LIKE 'TID1404%{stamp}'))); "
             f"DELETE FROM acct_entries WHERE (source = 'TEST_PG' AND source_key IN ({ks})) OR (source = 'PG_SETTLE' AND source_key IN (SELECT id::text FROM acct_pg_txns WHERE pg_key LIKE 'TID1404%{stamp}')); "
             f"DELETE FROM acct_pg_txns WHERE pg_key LIKE 'TID1404%{stamp}'")
        psql(f"UPDATE ops_alerts SET resolved_at = now(), resolve_note = '시험 1404 정리' WHERE alert_code = 'ACCT_PG_UNSETTLED' AND resolved_at IS NULL AND detail->>'day' = '{d0}'")
        rm_role(pid, '1404')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-acct-pg]', timeout=30000)
            seen['pg'] = pg.locator('[data-acct-pg]').count()
            seen['file'] = pg.locator('[data-acct-pg-file]').count()
            seen['count'] = pg.locator('[data-acct-pg-count]').count()
        res = admin_page('/#/acct-pg', chk)
        if res is None: print('  (playwright 없음 — ⑤ 건너뜀)')
        else:
            seen, perr = res
            ok('⑤ 화면 — 회계 › PG 정산 · 올리기 단추 · 합계 줄 · 화면 오류 없음',
               seen.get('pg') == 1 and seen.get('file') == 1 and seen.get('count') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ~ ⑤ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
