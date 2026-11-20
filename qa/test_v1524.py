"""v10.524 (D279 · docs/662) ㊾ 매물 2 ① 중복 매물 자동 탐지
  ① (코드) 설정 14개 서버 정규식 = DB 무늬 · 스위치 처음 꺼짐 · 사진 지문(SHA-256) · 글자 두 개 묶음 겹침 · 같은 연락처 · 기준 넘은 짝 · 나중 매물 기존 검수 대기(상태 그대로) · 결정한 짝 막음 · 연결 · 이름 규칙
  ② (DB · API) 한눈에 · 설정 400 · 꺼짐이면 작업 OFF · 거꾸로 된 짝 막음 · 짝 목록 · 짝 보기(전화 끝 4자리) · 결정 400 · 409 · DB 막음 · 404 · 지금 보기 — 만든 줄 모두 지움
  ③ (화면) 검수 › 매물 중복 의심
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


def first(s):
    return (s.split('\n')[0] if s and not s.startswith('!') else '')


def pick_listing(extra=''):
    """점검판의 게시 매물 하나 · 주인(시드 계정 · 비밀번호 PW) — 시험은 이 매물에 자기 줄만 더하고 끝에 지움"""
    row = first(psql("SELECT l.id || '|' || a.email || '|' || a.id FROM listings l JOIN accounts a ON a.id = l.owner_account_id "
                     "WHERE l.status = 'PUBLISHED' AND a.status = 'ACTIVE' AND a.email LIKE '%@x.com' " + extra +
                     " ORDER BY l.published_at DESC NULLS LAST, l.id LIMIT 1"))
    return (row.split('|') + ['', '', ''])[:3]


def run_job(name, t):
    return call('POST', '/admin/jobs', {'job': name}, t)


M79 = migr('D279_')
LSY = {f: rd(f'src/modules/lsy/{f}.ts') for f in ('common', 'dup', 'photo', 'video', 'triage', 'jobs', 'lsy.controller')}
MN, AP, SCH, WK, AM = rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'), rd('src/app.module.ts')
stamp = int(time.time()) % 1000000

LSY_KEYS = ['lsy.dup_detect', 'lsy.dup_threshold', 'lsy.dup_window_days', 'lsy.dup_queue', 'lsy.photo_check', 'lsy.photo_ai', 'lsy.photo_min_px', 'lsy.photo_batch',
            'lsy.video', 'lsy.video_max_mb', 'lsy.video_max_sec', 'lsy.report_triage', 'lsy.report_ai', 'lsy.ai_model']
SRV_PAT = dict(re.findall(r"'(lsy\.[a-z_]+)': '([^']*)'", LSY['common']))
DB_ROWS = re.findall(r"\('(lsy\.[a-z_]+)', '([^']*)', 'ADMIN', '[^']*', false, '([^']*)', '[^']*'\)", M79)
DB_PAT = {k: p for k, _, p in DB_ROWS}
DB_VAL = {k: v for k, v, _ in DB_ROWS}
DP = LSY['dup']

ok('① 설정 14개 — 서버 정규식 = DB value_pattern(규칙 2) · 스위치 모두 처음 꺼짐(dup_queue 만 on · 탐지가 켜졌을 때만) · 처음 값이 무늬에 맞음',
   sorted(SRV_PAT) == sorted(LSY_KEYS) and SRV_PAT == DB_PAT
   and all(DB_VAL.get(k) == 'off' for k in ('lsy.dup_detect', 'lsy.photo_check', 'lsy.photo_ai', 'lsy.video', 'lsy.report_triage', 'lsy.report_ai'))
   and DB_VAL.get('lsy.dup_queue') == 'on' and all(re.fullmatch(DB_PAT[k], DB_VAL[k]) for k in DB_PAT), f"{len(SRV_PAT)} {len(DB_PAT)}")
ok('① 서버 — 사진 지문(files.sha256) · 글자 두 개 묶음 겹침(pg_trgm 안 씀) · 같은 연락처 3종 · 기준 넘은 짝만 · 결정한 짝 그대로 · 나중 매물 기존 검수 대기(상태 그대로) · 40초 예산',
   'f.sha256 = ANY($4::text[])' in DP and 'export function dupJaccard' in DP and 'similarity(' not in DP and "'SAME_OWNER'" in DP and "'SAME_PHONE'" in DP
   and "'SAME_TEXT_PHONE'" in DP and 'if (score < s.dupThreshold) continue;' in DP and "WHERE lsy_dup_pairs.state = 'PENDING'" in DP
   and 'new ReviewRepository(db).enqueue' in DP and "UPDATE listings" not in DP and 'BUDGET_MS = 40_000' in DP, '')
ok('① D279 — lsy_dup_pairs(a < b · 짝 하나 · 결정은 사유 필수 · 결정한 짝 고침 막음) · 정기 작업 lsy_hourly · 권한 시드 · 연결(메뉴 · 화면 · 컨트롤러 · 작업 · 문서 662 · 판 v10.524)',
   'CREATE TABLE IF NOT EXISTS public.lsy_dup_pairs' in M79 and 'CHECK (a_id < b_id)' in M79 and 'uq_lsy_dup_pair ON public.lsy_dup_pairs (a_id, b_id)' in M79
   and 'trg_lsy_dup_guard' in M79 and "('lsy_hourly', 60," in M79 and "('lsy-dups', '매물 중복 의심', 'admrev'" in M79
   and "['lsy-dups', '매물 중복 의심']" in MN and "'lsx-saved', ['lsy-dups', 'lsy-photos', 'lsy-videos']" in MN and "{tab === 'lsy-dups' && <LsyDups />}" in AP
   and 'LsyController' in AM and "case 'lsy_hourly'" in SCH and "'lsy_hourly'," in WK and '"SB-ADM-LSY-010"' in SJ and doc('662_') and VT >= (10, 524), VER)
ok('① 이름 규칙 — 새 칸에 INV-9 · INV-11 감시 낱말 없음 · RAISE 글자에 % 없음 · SQL 주석 안에 /* 없음',
   not re.search(r'\b\w*(deduct|commission|platform_fee|withhold|take_rate|account_no|bank_code|pg_provider|pg_tid|escrow|vaccount|card_no)\w*\s+(text|integer|bigint|numeric|uuid|boolean)', M79)
   and not re.search(r"RAISE EXCEPTION '[^']*%", M79) and all('/*' not in c for c in re.findall(r'/\*(.*?)\*/', M79, re.S)), '')

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    lid, oem, oid = pick_listing()
    lid2 = first(psql(f"SELECT id FROM listings WHERE status = 'PUBLISHED' AND id <> '{lid or '00000000-0000-0000-0000-000000000000'}' ORDER BY published_at DESC NULLS LAST, id LIMIT 1"))
    p0 = first(psql("SELECT coalesce(max(id), 0) FROM lsy_dup_pairs")) or '0'
    p0 = int(p0) if p0.isdigit() else 0
    before = {k: getset(k) for k in ('lsy.dup_detect',)}
    scan_before = first(psql(f"SELECT count(*) FROM lsy_dup_scans WHERE listing_id = '{lid}'")) if lid else '0'
    try:
        ov = call('GET', '/admin/lsy/overview', None, TS)
        bad_set = call('PUT', '/admin/lsy/settings', {'dupThreshold': 40, 'reason': '시험 1524'}, TS)
        no_reason = call('PUT', '/admin/lsy/settings', {'dupThreshold': 80}, TS)
        ok('② 한눈에 · 설정 — 설정 14칸 · 숫자 · 범위 밖 400 · 사유 없음 400',
           isinstance(ov.get('settings'), dict) and 'dupThreshold' in ov['settings'] and isinstance(ov.get('counts'), dict)
           and bad_set.get('_err') == 400 and no_reason.get('_err') == 400, f"{bad_set.get('_err')} {no_reason.get('_err')}")
        setting('lsy.dup_detect', 'off', '1524')
        jr = run_job('lsy_hourly', TS)
        ok('② 정기 작업 lsy_hourly — 스위치 꺼짐이면 아무것도 안 함(OFF)',
           (jr.get('detail') or {}).get('dup', {}).get('skipped') == 'OFF' and (jr.get('detail') or {}).get('photo', {}).get('skipped') == 'OFF', str(jr)[:200])
        if not lid or not lid2:
            print('  (게시 매물 두 개가 없음 — 짝 시험 건너뜀)')
        else:
            a, b = sorted([lid, lid2])
            have = first(psql(f"SELECT count(*) FROM lsy_dup_pairs WHERE a_id = '{a}' AND b_id = '{b}'"))
            if have != '0':
                print('  (그 두 매물 짝이 이미 있음 — 짝 시험 건너뜀)')
            else:
                rev = psql(f"INSERT INTO lsy_dup_pairs (a_id, b_id, newer_id, score, text_score) VALUES ('{b}', '{a}', '{a}', 90, 80)")
                pid = first(psql(f"INSERT INTO lsy_dup_pairs (a_id, b_id, newer_id, score, text_score, photo_shared, contact) VALUES ('{a}', '{b}', '{b}', 91, 70, 1, 'SAME_OWNER') RETURNING id"))
                lst = call('GET', '/admin/lsy/dups?state=PENDING', None, TS)
                det = call('GET', f'/admin/lsy/dups/{pid}', None, TS)
                d_short = call('POST', f'/admin/lsy/dups/{pid}/decide', {'verdict': 'SAME', 'reason': 'x'}, TS)
                d_bad = call('POST', f'/admin/lsy/dups/{pid}/decide', {'verdict': 'MAYBE', 'reason': '시험 1524'}, TS)
                d_ok = call('POST', f'/admin/lsy/dups/{pid}/decide', {'verdict': 'SAME', 'reason': '시험 1524 같은 매물'}, TS)
                d_again = call('POST', f'/admin/lsy/dups/{pid}/decide', {'verdict': 'DIFFERENT', 'reason': '시험 1524 다시'}, TS)
                guard = psql(f"UPDATE lsy_dup_pairs SET score = 10 WHERE id = {int(pid or 0)}")
                nf = call('GET', '/admin/lsy/dups/999999999', None, TS)
                scan_nf = call('POST', '/admin/lsy/dups/scan', {'listingId': '00000000-0000-4000-8000-000000000000'}, TS)
                scan = call('POST', '/admin/lsy/dups/scan', {'listingId': lid}, TS)
                ok('② DB — 거꾸로 된 짝(a > b) 막음 · 짝 목록 · 짝 보기(두 매물 · 사진 · 전화는 끝 4자리만)',
                   '!' in rev and any(str(r.get('id')) == str(pid) for r in lst.get('rows') or [])
                   and (det.get('a') or {}).get('id') == a and (det.get('b') or {}).get('id') == b and 'phone' not in json.dumps(det.get('a') or {}).replace('phoneTail', ''),
                   f"{rev[-60:]} {det.get('score')}")
                ok('② 결정 — 사유 짧음 400 · 모르는 결정 400 · 같은 매물 · 다시 결정 409 LSY_DUP_STATE · DB 도 결정한 짝 고침 막음 · 없는 짝 404 · 없는 매물 지금 보기 404 · 지금 보기',
                   d_short.get('_err') == 400 and d_bad.get('_err') == 400 and d_ok.get('state') == 'SAME' and d_again.get('code') == 'LSY_DUP_STATE'
                   and 'LSY_DUP_STATE' in guard and nf.get('_err') == 404 and scan_nf.get('_err') == 404 and scan.get('ok') is True,
                   f"{d_short.get('_err')} {d_bad.get('_err')} {d_ok.get('state')} {d_again.get('code')} {guard[-40:]} {scan}")
    finally:
        for k, v in before.items():
            setting(k, v or None, '1524 되돌림')
        psql(f"DELETE FROM lsy_dup_pairs WHERE id > {p0};")
        if lid and scan_before == '0':
            psql(f"DELETE FROM lsy_dup_scans WHERE listing_id = '{lid}';")
    if ADMIN_WEB:
        r = admin_page('/#/lsy-dups', lambda pg, seen: seen.update(n=pg.locator('[data-lsy-dups]').count(), st=pg.locator('[data-lsy-dup-state]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 검수 › 매물 중복 의심(상태 단추 3 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('st') == 3 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
