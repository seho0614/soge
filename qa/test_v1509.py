"""v10.509 (D275 · docs/647) 감사 · 접속 기록 장기 보관 — 대표 11/20 「㊺ ①」 · 「감사 · 접속기록은 3년 보관」
  ① (코드) 월 묶음(gzip · sha256) · 목록 지문(앞 묶음 + 감사 사슬 머리) · 감사 OPX_ARCHIVE_BUNDLE · 보관 36개월(최소 12 · 서버 무늬 = DB 무늬) · 파기 기록 뒤 지움 · DB 정리 함수(확인 끝난 달만) · S3 없으면 디스크 · 메뉴 · 화면 OPX-010 · 문서 647
  ② (API · DB) 상태(꺼짐 · 36 · 최소 12 · 「디스크 밖 보관 아님」/꺼짐 경고) · 꺼진 채 「지금 돌리기」 409 · 보관 개월 11 막음 · 12 됨(되돌림) · 정리 함수 막음(확인 전 · 정리 꺼짐) · 확인 뒤 정리 · 다시 정리 막음 · 개인정보 접속기록 지우기는 정리 표시 없으면 막힘 · 묶음 줄 고치기 막음 · 회원 403
  ③ (화면) 위험감지 › 기록 장기 보관
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


M75 = migr('D275_')
stamp = int(time.time()) % 1000000
AR, OC, MN, AP, UI, JB = (rd('src/modules/opx/archive.ts'), rd('src/modules/opx/opx.controller.ts'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'),
                          rd('web/src/app/admin/Opx.tsx'), rd('src/worker/scheduler.service.ts'))
ok('① 코드 — D275 opx_archive_bundles(sha256 · 목록 지문 · 쌓기만) · opx_archive_events · fn_opx_purge_month(확인 끝난 달 · 줄 수 같음) · 감사 지우기 막기(정리 표시만 허용) · 보관 36(무늬 12 ~ 120 = 서버 KEEP_MONTHS_RE) · DB 정리 처음 0 · S3 처음 off · 묶음 · 목록 지문 · 감사 OPX_ARCHIVE_BUNDLE · 파기 OPX_ARCHIVE_DISPOSE · 정기 작업 opx_archive · 메뉴 · 화면 OPX-010 · 문서 647 · 판 v10.509',
   'CREATE TABLE IF NOT EXISTS public.opx_archive_bundles' in M75 and 'trg_opx_archive_bundles_ro' in M75 and 'CREATE OR REPLACE FUNCTION public.fn_opx_purge_month' in M75
   and "public.fn_opx_purge_ok('AUDIT', OLD.occurred_at)" in M75 and "IF m < 13 THEN RETURN false;" in M75 and "e.kind = 'S3_PUT' AND e.ok) THEN RETURN false;" in M75
   and 'BEFORE TRUNCATE ON audit.audit_logs FOR EACH STATEMENT' in M75 and 'BEFORE TRUNCATE ON audit.pii_access_logs FOR EACH STATEMENT' in M75
   and 'BEFORE TRUNCATE ON public.site_setting_changes FOR EACH STATEMENT' in M75 and "e.kind = 'S3_PUT' AND e.ok)\n        AND NOT EXISTS" in AR and "('opx.archive_keep_months', '36'" in M75 and "'^(1[2-9]|[2-9][0-9]|1[01][0-9]|120)$'" in M75
   and "('opx.archive_db_purge_months', '0'" in M75 and "('opx.archive_s3', 'off'" in M75 and "('opx.archive', 'off'" in M75
   and 'KEEP_MONTHS_RE = /^(1[2-9]|[2-9][0-9]|1[01][0-9]|120)$/' in AR and 'export function manifestOf' in AR and "'OPX_ARCHIVE_BUNDLE'" in AR and "'OPX_ARCHIVE_DISPOSE'" in AR
   and 'BACKUP_S3_BUCKET' in AR and "'backup', 'log-archive'" in AR and "case 'opx_archive'" in JB and "@Get('archive')" in OC
   and "['opx-archive', '기록 장기 보관']" in MN and "{tab === 'opx-archive' && <OpxArchive />}" in AP and 'export function OpxArchive' in UI
   and '"SB-ADM-OPX-010"' in SJ and '3년' in doc('647_') and VT >= (10, 509), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    keep0, purge0 = getset('opx.archive_keep_months'), getset('opx.archive_db_purge_months')
    on0 = getset('opx.archive')
    bid = pid = ''
    mon = f"{1990 + stamp % 9}-{(stamp // 9) % 12 + 1:02d}"   # 아주 옛 달(기록이 없을 달 · 다시 돌려도 다른 달일 수 있음)
    try:
        setting('opx.archive', 'off', '1509')
        mb = call('GET', '/admin/opx/archive', None, TB)
        st = call('GET', '/admin/opx/archive', None, TS)
        run = call('POST', '/admin/opx/archive/run', {}, TS)
        k11 = setting('opx.archive_keep_months', '11', '1509')
        k12 = setting('opx.archive_keep_months', '12', '1509'); v12 = getset('opx.archive_keep_months')
        setting('opx.archive_keep_months', keep0 or '36', '1509 되돌림')
        p12 = setting('opx.archive_db_purge_months', '12', '1509')
        # 시험 묶음 한 줄(기록 없는 옛 달 · 설정 바뀐 기록 · 0줄)
        psql(f"SET session_replication_role = replica; DELETE FROM opx_archive_events WHERE bundle_id IN (SELECT id FROM opx_archive_bundles WHERE source = 'SETTING' AND month = '{mon}-01'); DELETE FROM opx_archive_bundles WHERE source = 'SETTING' AND month = '{mon}-01';")
        bid = psql(f"INSERT INTO opx_archive_bundles (source, month, rows, file_name, bytes, sha256, manifest_hash) VALUES ('SETTING', '{mon}-01', 0, 'setting_{mon}.jsonl.gz', 20, repeat('a', 64), encode(sha256(convert_to('t1509-{stamp}', 'UTF8')), 'hex')) RETURNING id").split('\n')[0]
        upd = psql(f"UPDATE opx_archive_bundles SET rows = 1 WHERE id = {int(bid or 0)}")
        setting('opx.archive_db_purge_months', '0', '1509')
        off = psql(f"BEGIN; SELECT fn_opx_purge_month({int(bid or 0)}); ROLLBACK;")
        setting('opx.archive_db_purge_months', '13', '1509')
        nov = psql(f"BEGIN; SELECT fn_opx_purge_month({int(bid or 0)}); ROLLBACK;")
        psql(f"INSERT INTO opx_archive_events (bundle_id, kind, ok, detail) VALUES ({int(bid or 0)}, 'VERIFY', true, '{{\"t\": 1509}}')")
        nos3 = psql(f"BEGIN; SELECT fn_opx_purge_month({int(bid or 0)}); ROLLBACK;")   # 보안 검토 B-2 — S3 올림 없으면 막음
        psql(f"INSERT INTO opx_archive_events (bundle_id, kind, ok, detail) VALUES ({int(bid or 0)}, 'S3_PUT', true, '{{\"t\": 1509}}')")
        pg1 = psql(f"SELECT fn_opx_purge_month({int(bid or 0)})")
        pg2 = psql(f"SELECT fn_opx_purge_month({int(bid or 0)})")
        aid = psql("SELECT id FROM accounts WHERE email = 'admin@x.com'")
        pid = psql(f"INSERT INTO audit.pii_access_logs (actor_account_id, access_type, reason, target_type, occurred_at) VALUES ('{aid}', 'VIEW', '시험 1509', 'ACCOUNT', '{mon}-15 12:00+09') RETURNING id").split('\n')[0]
        d1 = psql(f"DELETE FROM audit.pii_access_logs WHERE id = {int(pid or 0)}")
        d2 = psql(f"BEGIN; SELECT set_config('app.opx_purge', 'PII:{mon}', true); DELETE FROM audit.pii_access_logs WHERE id = {int(pid or 0)}; COMMIT;")   # B-1 — 표시만으로는 막힘(그 달 묶음 없음)
        left1 = psql(f"SELECT count(*) FROM audit.pii_access_logs WHERE id = {int(pid or 0)}")
        psql(f"SET session_replication_role = replica; DELETE FROM opx_archive_events WHERE bundle_id IN (SELECT id FROM opx_archive_bundles WHERE source = 'PII' AND month = '{mon}-01'); DELETE FROM opx_archive_bundles WHERE source = 'PII' AND month = '{mon}-01';")
        pbid = psql(f"INSERT INTO opx_archive_bundles (source, month, rows, file_name, bytes, sha256, manifest_hash) VALUES ('PII', '{mon}-01', 1, 'pii_{mon}.jsonl.gz', 20, repeat('b', 64), encode(sha256(convert_to('t1509p-{stamp}', 'UTF8')), 'hex')) RETURNING id").split('\n')[0]
        psql(f"INSERT INTO opx_archive_events (bundle_id, kind, ok, detail) VALUES ({int(pbid or 0)}, 'VERIFY', true, '{{\"t\": 1509}}')")
        d3 = psql(f"BEGIN; SELECT set_config('app.opx_purge', 'PII:{mon}', true); DELETE FROM audit.pii_access_logs WHERE id = {int(pid or 0)}; COMMIT;")   # 확인만 · S3 없음 → 막힘
        psql(f"INSERT INTO opx_archive_events (bundle_id, kind, ok, detail) VALUES ({int(pbid or 0)}, 'S3_PUT', true, '{{\"t\": 1509}}')")
        d4 = psql(f"BEGIN; SELECT set_config('app.opx_purge', 'PII:{mon}', true); DELETE FROM audit.pii_access_logs WHERE id = {int(pid or 0)}; COMMIT;")   # 조건 모두 → 지움
        left = psql(f"SELECT count(*) FROM audit.pii_access_logs WHERE id = {int(pid or 0)}")
        trn = psql("BEGIN; TRUNCATE audit.pii_access_logs; ROLLBACK;")   # B-4 — 통째 비우기 막음
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE task_key = 'opx-archive'")
        ok('② 기록 장기 보관 — 회원 403 · 꺼짐 · 보관 36(최소 12) · 경고 · 꺼진 채 돌리기 409 · 보관 11 막음 · 12 됨 · 정리 12 막음(13부터) · 묶음 줄 고치기 막음 · 정리 꺼짐 막음 · 확인 전 막음 · S3 올림 없으면 막음 · 확인 · S3 뒤 정리 0줄 · 다시 막음 · 접속기록 지우기 표시 없으면 막힘 · 표시만(묶음 없음) 막힘 · 확인만 막힘 · 확인 + S3 면 지움 · 통째 비우기 막음 · 권한 주소 4',
           mb.get('_err') == 403 and st.get('on') is False and st.get('keepMonths') == int(keep0 or 36) and st.get('minMonths') == 12 and any('꺼져' in w for w in st.get('warnings') or [])
           and run.get('_err') == 409 and run.get('code') == 'OPX_ARCHIVE_OFF' and '!' in k11 and '!' not in k12 and v12 == '12' and '!' in p12 and 'append-only' in upd
           and '!' in off and '꺼져' in off and '!' in nov and '복원 확인' in nov and '!' in nos3 and 'S3' in nos3 and pg1 == '0' and '!' in pg2 and '!' in d1 and '!' in d2 and left1 == '1' and '!' in d3 and '!' not in d4 and left == '0'
           and '!' in trn and 'TRUNCATE' in trn and rmap == '4',
           f"{mb.get('_err')} {st.get('on')} {st.get('keepMonths')} {st.get('minMonths')} {st.get('warnings')} · {run.get('_err')} {run.get('code')} · {k11[-40:]} {k12[-20:]} {v12} {p12[-30:]} {upd[-30:]} · {off[-40:]} {nov[-40:]} {nos3[-40:]} {pg1} {pg2[-40:]} · {d1[-40:]} {d2[-40:]} {left1} {d3[-40:]} {d4[-40:]} {left} {trn[-40:]} · {rmap}")
    finally:
        setting('opx.archive_keep_months', keep0 or '36', '1509 되돌림'); setting('opx.archive_db_purge_months', purge0 or '0', '1509 되돌림'); setting('opx.archive', on0 or 'off', '1509 되돌림')
        if bid.isdigit():
            psql(f"SET session_replication_role = replica; DELETE FROM opx_archive_events WHERE bundle_id = {bid}; DELETE FROM opx_archive_bundles WHERE id = {bid};")
        psql(f"SET session_replication_role = replica; DELETE FROM opx_archive_events WHERE bundle_id IN (SELECT id FROM opx_archive_bundles WHERE source = 'PII' AND month = '{mon}-01'); DELETE FROM opx_archive_bundles WHERE source = 'PII' AND month = '{mon}-01';")
        if pid.isdigit():
            psql(f"SET session_replication_role = replica; DELETE FROM audit.pii_access_logs WHERE id = {pid};")
    if ADMIN_WEB:
        r = admin_page('/#/opx-archive', lambda pg, seen: seen.update(n=pg.locator('[data-opx-archive]').count(), warn=pg.locator('[data-opx-archive-warn]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 위험감지 › 기록 장기 보관(경고 줄 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('warn', 0) >= 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
