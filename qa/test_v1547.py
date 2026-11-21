"""v10.547 (docs/685) 서류 보관 기한 관리 — 대표 11/20 「(55) ② 서류 보관 기한 관리」
  ① (코드) D285 보관 기간 표(용도 4 · 법정 최소 · 근거 고칠 수 없음) · 대장(만료일 트리거) · 파기 기록(쌓기만) · 법정 보관(보존) 지우기 막음 · 대장 맞추기 · 알림 sfx.retention_alert off · 정기 작업 sfx_daily · 서버 · 메뉴 · 화면 · 문서 685
  ② (API · DB) 표 4줄 · 법정 최소 밑 422 · 운영 관리자 403 · 대장 맞추기 · 만료 전 파기 409 · 기준일 고치기 · 보존 까닭 없음 422 · 보존이면 파기 409 · 파일 지우기 DB 가 막음 · 확인 글자 틀림 422 · 파기 · 다시 409 · 파기 기록 고치기 · 지우기 막음 · 개월 바꾸면 만료일 다시 셈 · 정기 작업 알림 한 번 · 권한 주소 · 되돌림
  ③ (화면) 사무 › 서류 보관 기한
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


def callh(m_, p, b=None, t=None, h=None):
    """call 과 같되 머리글(X-Device-Mark 등)을 더함"""
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    hd.update(h or {})
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


M85 = migr('D285_')
CT = rd('src/modules/sfx/sfx.controller.ts')
UI = rd('web/src/app/admin/Sfx.tsx')
MN = rd('web/src/lib/adminMenu.ts')
AP = rd('web/src/App.tsx')
SJ = rd('spec/screens.json')
T0 = psql("SELECT clock_timestamp()::text") if (API and DB) else ''

import uuid

RT = rd('src/modules/sfx/retention.ts')
WK, SC = rd('src/worker/worker.controller.ts'), rd('src/worker/scheduler.service.ts')

ok('① 코드 — D285 보관 기간 표(HR_DOC · LGL_DOC · ACCT_EVIDENCE · CORP_DOC · 법정 최소) · 대장(만료일 트리거 · 보존 · 끝난 줄 못 고침) · 파기 기록(쌓기만) · 보존 서류 지우기 막음 · 대장 맞추기 · 알림 off · 작업 sfx_daily 05:20 · 서버 파기(「파기」 입력 · SUPER) · 메뉴 사무 · 화면 SFX-020 · 문서 685 · 판 v10.547',
   'CREATE TABLE IF NOT EXISTS public.sfx_retention_rules' in M85 and "('HR_DOC', '인사 서류(의무교육 증빙 · 지원자 서류)', 'HR_DOC', 36, 36," in M85
   and "('ACCT_EVIDENCE', '회계 증빙(매입 · 경비 영수증 · 계산서)', 'ACCT_EVIDENCE', 60, 60," in M85 and "('LGL_DOC', '법무 서류(인허가 · 계약 검토 · 사건 · 보험)', 'LGL_DOC', 120, 120," in M85
   and 'CONSTRAINT ck_sfx_ret_rule_min CHECK (months >= min_months)' in M85 and 'CREATE TABLE IF NOT EXISTS public.sfx_doc_retention' in M85
   and 'CREATE TABLE IF NOT EXISTS public.sfx_doc_destructions' in M85 and 'trg_sfx_files_hold_guard' in M85 and 'FUNCTION public.fn_sfx_retention_sync()' in M85
   and "('sfx.retention_alert', 'off'" in M85 and "('sfx_daily', 1440, 5, 20" in M85 and "'sfx_daily'," in WK and "case 'sfx_daily':" in SC
   and "String(v.confirm ?? '').trim() !== '파기'" in RT and "@Post('retention/:fileId/destroy')" in CT and "@Roles('SUPER')" in CT and 'export function SfxRetention' in UI
   and "'admoff')?.tabs, 'corp-docs', ['sfx-retention']" in MN and "<SfxRetention isSuper={roles.includes('SUPER')} />" in AP
   and '"SB-ADM-SFX-020"' in SJ and '파기' in doc('685_') and VT >= (10, 547), VER)


def mk_file(owner, tag):
    fid = str(uuid.uuid4())
    psql(f"INSERT INTO files (id, owner_account_id, purpose, original_name, content_type, size_bytes, storage_provider, storage_key) "
         f"VALUES ('{fid}', '{owner}', 'HR_DOC', '시험{tag}_수료증.pdf', 'application/pdf', 100, 'LOCAL', 'hr_doc/2020/01/{fid}.pdf')")
    psql(f"UPDATE files SET status = 'READY', detected_type = 'application/pdf', sha256 = '{'b' * 64}', completed_at = now() WHERE id = '{fid}'")
    return fid


if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    stamp = int(time.time()) % 100000
    al0, ad0 = getset('sfx.retention_alert'), getset('sfx.retention_alert_days')
    owner = psql("SELECT id FROM accounts WHERE email = 'admin@x.com'")
    f1 = f2 = ''
    sid = ''
    try:
        se, sid = mk_staff(f'1547a{stamp % 83}', 'ADMIN'); consent_ok.agree(se, PW); TA = login(se)
        f1, f2 = mk_file(owner, '1547a'), mk_file(owner, '1547b')
        rules = call('GET', '/admin/sfx/retention/rules', None, TS)
        hr = next((x for x in rules.get('rules') or [] if x.get('code') == 'HR_DOC'), {})
        rmin = call('PUT', '/admin/sfx/retention/rules/HR_DOC', {'months': 12}, TS)
        rnone = call('PUT', '/admin/sfx/retention/rules/HR_DOC', {}, TS)
        r403 = call('PUT', '/admin/sfx/retention/rules/HR_DOC', {'months': 40}, TA)
        sy = call('POST', '/admin/sfx/retention/sync', {}, TS)
        led = psql(f"SELECT base_date = (now() AT TIME ZONE 'Asia/Seoul')::date AND expires_on = (base_date + interval '36 months')::date FROM sfx_doc_retention WHERE file_id = '{f1}'")
        early = call('POST', f'/admin/sfx/retention/{f1}/destroy', {'reason': '시험 1547 이른 파기', 'confirm': '파기'}, TS)
        bd = call('PUT', f'/admin/sfx/retention/{f1}', {'baseDate': '2020-01-01', 'reason': '시험 1547 기준일'}, TS)
        bfut = call('PUT', f'/admin/sfx/retention/{f1}', {'baseDate': '2099-01-01', 'reason': '시험 1547 미래'}, TS)
        hnr = call('PUT', f'/admin/sfx/retention/{f1}', {'hold': True, 'reason': '시험 1547 보존'}, TS)
        hok = call('PUT', f'/admin/sfx/retention/{f1}', {'hold': True, 'holdReason': '시험 1547 소송 보존', 'reason': '시험 1547 보존'}, TS)
        dhold = call('POST', f'/admin/sfx/retention/{f1}/destroy', {'reason': '시험 1547 보존 중 파기', 'confirm': '파기'}, TS)
        fdel = psql(f"UPDATE files SET status = 'DELETED' WHERE id = '{f1}'")
        hoff = call('PUT', f'/admin/sfx/retention/{f1}', {'hold': False, 'reason': '시험 1547 보존 풀기'}, TS)
        dconf = call('POST', f'/admin/sfx/retention/{f1}/destroy', {'reason': '시험 1547 파기', 'confirm': '삭제'}, TS)
        d403 = call('POST', f'/admin/sfx/retention/{f1}/destroy', {'reason': '시험 1547 파기', 'confirm': '파기'}, TA)
        dok = call('POST', f'/admin/sfx/retention/{f1}/destroy', {'reason': '시험 1547 보관 기한 지남', 'confirm': '파기'}, TS)
        st = psql(f"SELECT f.status || '|' || d.state FROM files f JOIN sfx_doc_retention d ON d.file_id = f.id WHERE f.id = '{f1}'")
        nm = psql(f"SELECT name_masked FROM sfx_doc_destructions WHERE file_id = '{f1}'")
        dagain = call('POST', f'/admin/sfx/retention/{f1}/destroy', {'reason': '시험 1547 다시', 'confirm': '파기'}, TS)
        logdel = psql(f"DELETE FROM sfx_doc_destructions WHERE file_id = '{f1}'")
        logupd = psql(f"UPDATE sfx_doc_destructions SET reason = '바꿈' WHERE file_id = '{f1}'")
        dl = call('GET', '/admin/sfx/retention/destroyed', None, TS)
        e0 = psql(f"SELECT expires_on::text FROM sfx_doc_retention WHERE file_id = '{f2}'")
        rm = call('PUT', '/admin/sfx/retention/rules/HR_DOC', {'months': 48}, TS)
        e1 = psql(f"SELECT (expires_on = (base_date + interval '48 months')::date)::text FROM sfx_doc_retention WHERE file_id = '{f2}'")
        call('PUT', '/admin/sfx/retention/rules/HR_DOC', {'months': 36}, TS)
        call('PUT', f'/admin/sfx/retention/{f2}', {'baseDate': '2020-01-01', 'reason': '시험 1547 알림'}, TS)
        setting('sfx.retention_alert', 'on', '1547'); setting('sfx.retention_alert_days', '30', '1547')
        j1 = call('POST', '/admin/jobs', {'job': 'sfx_daily'}, TS)
        a1 = psql(f"SELECT alerted_on IS NOT NULL FROM sfx_doc_retention WHERE file_id = '{f2}'")
        oa1 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'SFX_RETENTION_DUE' AND raised_at >= '{T0}'::timestamptz")
        call('POST', '/admin/jobs', {'job': 'sfx_daily'}, TS)
        oa2 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'SFX_RETENTION_DUE' AND raised_at >= '{T0}'::timestamptz")
        lst = call('GET', '/admin/sfx/retention?due=over', None, TS)
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE pattern <> '/admin/help/tab' AND task_key = 'sfx-retention'")
        ok('② 서류 보관 — 표 4 · HR_DOC 36(최소 36) · 최소 밑 422 · 빈 칸 422 · 운영 관리자 403 · 대장 맞추기(기준일 오늘 · 36개월) · 만료 전 파기 409 · 기준일 2020 → 만료 2023 · 미래 기준일 422 · 보존 까닭 없음 422 · 보존 · 보존 중 파기 409 · 파일 지우기 DB 막음 · 확인 글자 422 · 운영 관리자 파기 403 · 파기(파일 DELETED · 대장 DESTROYED · 가린 이름) · 다시 409 · 기록 지우기 · 고치기 막음 · 파기 기록 목록 · 개월 48 → 만료일 다시 셈 · 정기 작업 알림 한 번 · 지남 목록 · 권한 주소 7',
           len(rules.get('rules') or []) == 4 and hr.get('months') == 36 and hr.get('minMonths') == 36
           and rmin.get('_err') == 422 and rmin.get('code') == 'SFX_RET_MIN' and rnone.get('code') == 'SFX_RET_NOTHING' and r403.get('_err') == 403
           and sy.get('ok') and led == 't' and early.get('_err') == 409 and early.get('code') == 'SFX_RET_NOT_DUE'
           and bd.get('expiresOn') == '2023-01-01' and bfut.get('code') in ('SFX_RET_BASE', 'VALIDATION_ERROR') and hnr.get('code') == 'SFX_RET_HOLD_REASON'
           and hok.get('hold') is True and dhold.get('code') == 'SFX_RET_HOLD' and '법정 보관' in fdel and hoff.get('hold') is False
           and dconf.get('code') == 'SFX_RET_CONFIRM' and d403.get('_err') == 403 and dok.get('ok') is True and st == 'DELETED|DESTROYED'
           and nm.startswith('시험') and nm.endswith('***.pdf') and dagain.get('code') == 'SFX_RET_STATE' and '!' in logdel and '!' in logupd
           and any(x.get('fileId') == f1 for x in dl.get('rows') or []) and e0 and e1 == 'true'
           and j1.get('_err') is None and a1 == 't' and oa1 != '0' and oa1 == oa2 and any(x.get('fileId') == f2 for x in lst.get('rows') or []) and rmap == '7',
           f"{len(rules.get('rules') or [])} {hr.get('months')} · {rmin.get('code')} {rnone.get('code')} {r403.get('_err')} · {sy} {led} · {early.get('code')} {bd.get('expiresOn')} {bfut.get('code')} {hnr.get('code')} {hok.get('hold')} {dhold.get('code')} {fdel[-60:]} · "
           f"{dconf.get('code')} {d403.get('_err')} {dok.get('ok')} {st} {nm} {dagain.get('code')} · {e1} · {j1.get('detail')} {a1} {oa1}/{oa2} {rmap}")
    finally:
        setting('sfx.retention_alert', al0 or 'off', '1547 되돌림'); setting('sfx.retention_alert_days', ad0 or '30', '1547 되돌림')
        psql("UPDATE sfx_retention_rules SET months = 36 WHERE code = 'HR_DOC' AND months <> 36")
        fl = ','.join(f"'{x}'" for x in (f1, f2) if x) or "'00000000-0000-0000-0000-000000000000'"
        psql(f"BEGIN; SET LOCAL session_replication_role = replica; "
             f"UPDATE files SET status = 'DELETED', deleted_at = now() WHERE id IN ({fl}); "
             f"DELETE FROM sfx_doc_destructions WHERE file_id IN ({fl}); "
             f"DELETE FROM sfx_doc_retention WHERE file_id IN ({fl}) OR created_at >= '{T0}'::timestamptz; "
             f"DELETE FROM ops_alerts WHERE alert_code IN ('SFX_RETENTION_DUE', 'SFX_RETENTION_REMOVE_FAIL') AND raised_at >= '{T0}'::timestamptz; COMMIT;")
        if sid:
            rm_role(sid, '1547')
        ok('② 되돌림 — 시험 파일 DELETED · 대장 · 파기 기록 · 알림 지움 · 스위치 · 개월 처음 값',
           psql(f"SELECT count(*) FROM sfx_doc_retention WHERE file_id IN ({fl})") == '0' and getset('sfx.retention_alert') == (al0 or 'off')
           and psql("SELECT months FROM sfx_retention_rules WHERE code = 'HR_DOC'") == '36', getset('sfx.retention_alert'))
    if ADMIN_WEB:
        r = admin_page('/#/sfx-retention', lambda pg, seen: seen.update(n=pg.locator('[data-sfx-retention]').count(), rules=pg.get_attribute('[data-sfx-ret-rules]', 'data-sfx-ret-rules')))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 사무 › 서류 보관 기한(보관 기간 표 4줄 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('rules') == '4' and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
