"""v10.514 (D276 · docs/652) ㊻ 매물 ② 매물 만료 · 연장 — 대표 결정 11/20 「매물 만료는 관리자가 지정한다. 등록 확정 시 기간을 지정, 기본은 6개월.」
  ① (코드) 만료일 표(lsx_listing_expiry · 매물 줄 안 고침) · 게시 트리거 기본 6개월(다시 게시 때 남은 날짜 그대로) · 처음 적용(게시일 + 6개월 · 지났으면 + 30일) · 검수 승인 칸(expiryMonths · expiresOn · 안 보내면 기본) ·
       연장은 운영자만(사유 · 감사) · 회원은 연장 요청 · 만료되면 내림(ARCHIVED · 지우지 않음) · 스위치 처음 off · 옛 승인 흐름 글자 그대로
  ② (DB · API) 게시 트리거 기본 · 다시 게시 그대로(되돌리는 트랜잭션) · 검수 승인 3개월 · 틀린 날짜 422(승인 되돌아감) · 연장 요청 · 두 번째 409 · 운영 승인(새 날짜 · 알림) · 운영 날짜 바꾸기 ·
       스위치 켜고 만료 → 내림 · 알림 · 내용 그대로면 되살림 → 바로 게시 · 내용이 바뀌면 → 검수 대기(대표 결정 11/20 ②) — 모두 되돌림
  ③ (화면) 검수 › 매물 만료 · 연장
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



def lsx_pick():
    """점검판의 게시 매물 하나 · 그 주인(시드 계정 · 비밀번호 PW) — 시험은 이 매물의 줄만 바꾸고 끝에 되돌림"""
    row = psql("SELECT l.id || '|' || a.email || '|' || l.gwan_code || '|' || coalesce(l.published_at::text, '') || '|' || l.version FROM listings l JOIN accounts a ON a.id = l.owner_account_id "
               "WHERE l.status = 'PUBLISHED' AND NOT l.is_priority_exposed AND a.status = 'ACTIVE' AND a.email LIKE '%@x.com' "
               "AND NOT EXISTS (SELECT 1 FROM lsx_bump_live b WHERE b.listing_id = l.id) ORDER BY l.published_at DESC NULLS LAST, l.id LIMIT 1")
    p = (row.split('\n')[0] if row and not row.startswith('!') else '').split('|')
    return (p + ['', '', '', '', ''])[:5]


def exp_snap(lid):
    """만료 줄 그대로 적어 둠(되돌리기용) — 없으면 ''"""
    return psql(f"SELECT coalesce((SELECT expires_at::text || '|' || set_kind || '|' || coalesce(warned_for::text, '') || '|' || coalesce(expired_at::text, '') FROM lsx_listing_expiry WHERE listing_id = '{lid}'), '')")


def exp_restore(lid, snap):
    if not lid:
        return
    if not snap:
        psql(f"DELETE FROM lsx_listing_expiry WHERE listing_id = '{lid}';")
        return
    e, k, w, x = (snap.split('|') + ['', '', '', ''])[:4]
    wv = f"'{w}'" if w else 'NULL'; xv = f"'{x}'" if x else 'NULL'
    psql(f"INSERT INTO lsx_listing_expiry (listing_id, expires_at, set_kind, warned_for, expired_at) VALUES ('{lid}', '{e}', '{k}', {wv}, {xv}) "
         f"ON CONFLICT (listing_id) DO UPDATE SET expires_at = EXCLUDED.expires_at, set_kind = EXCLUDED.set_kind, warned_for = EXCLUDED.warned_for, expired_at = EXCLUDED.expired_at, expired_fp = NULL;")


LSX_KEYS = ['lsx.saved_search', 'lsx.saved_search_max', 'lsx.expiry', 'lsx.expiry_default_months', 'lsx.expiry_warn_days', 'lsx.bump_mode', 'lsx.bump_free_count',
            'lsx.bump_period_days', 'lsx.bump_min_hours', 'lsx.bump_price', 'lsx.bump_effect_hours', 'lsx.ai_summary', 'lsx.ai_summary_model', 'lsx.ai_summary_batch']
M76 = migr('D276_')
SRC = {f: rd(f'src/modules/lsx/{f}.ts') for f in ('common', 'saved', 'expiry', 'bump', 'summary', 'jobs', 'lsx.controller')}
stamp = int(time.time()) % 1000000

DTO, RS, DC = rd('src/modules/review/review.dto.ts'), rd('src/modules/review/review.service.ts'), rd('web/src/app/admin/ReviewDecide.tsx')
ok('① D276 만료 — 표 lsx_listing_expiry(매물 줄 칸 안 더함) · 게시 트리거 trg_lsx_expiry_default(기본 lsx.expiry_default_months · 남은 날짜 그대로) · 처음 적용 6개월 · 지났으면 30일 · 기록 쌓기만 · 연장 요청 열린 것 하나',
   'CREATE TABLE IF NOT EXISTS public.lsx_listing_expiry' in M76 and 'ALTER TABLE public.listings' not in M76 and 'trg_lsx_expiry_default AFTER INSERT OR UPDATE OF status ON public.listings' in M76
   and "key = 'lsx.expiry_default_months'" in M76 and 'IF v_old IS NOT NULL AND v_old > now() THEN' in M76 and "interval '6 months'" in M76 and "now() + interval '30 days'" in M76
   and 'trg_lsx_expiry_log_ro' in M76 and "uq_lsx_extend_open ON public.lsx_extend_requests (listing_id) WHERE state = 'REQUESTED'" in M76, '')
ok('① 검수 승인 칸 — expiryMonths(1 · 3 · 6 · 12) · expiresOn(날짜) · 같은 트랜잭션 · 옛 승인 글자 그대로(aiAgreed · AI_NOT_MATCH · 결정 단추)',
   'expiryMonths?: number;' in DTO and 'expiresOn?: string;' in DTO and '@IsIn([1, 3, 6, 12])' in DTO and 'aiAgreed?: boolean;' in DTO
   and "if (nextStatus === 'PUBLISHED') await lsxApplyDecideExpiry(this.db, item.targetId, actorId" in RS and "code: 'AI_NOT_MATCH'" in RS and 'aiReferenced: aiAgreed' in RS
   and '<LsxExpiryPick value={lsxExp} onChange={setLsxExp} />' in DC and "decide('APPROVED', true)" in DC and "decide('REJECTED', aiReject)" in DC and '(aiReject && !aiConfirm)' in DC, '')
E = SRC['expiry']
ok('① 서버 — 연장은 운영자만(사유 · 감사 LSX_EXPIRY_SET · LSX_EXTEND_DECIDE) · 회원은 요청만 · 만료 내림은 ARCHIVED(지우지 않음) · 스위치 꺼지면 내리지 않음 · 많이 내리면 운영 알림',
   "@Audit('LSX_EXPIRY_SET', 'LISTING')" in SRC['lsx.controller'] and "@Audit('LSX_EXTEND_DECIDE'" in SRC['lsx.controller'] and "UPDATE listings SET status = 'ARCHIVED' WHERE id = $1 AND status = 'PUBLISHED'" in E
   and "if (!s.expiry) return { skipped: 'OFF'" in E and 'LSX_EXPIRE_BATCH' in E and 'DELETE FROM listings' not in E and 'requestExtend' in E and 'EXPIRY_MAX_MONTHS = 36' in SRC['common'], '')
ok('① 다시 게시 — 내용이 바뀌었을 때만 검수(대표 결정 11/20 ②) · 내릴 때 지문 expired_fp · 요청 때 req_fp · 같으면 바로 게시 · 다르거나 모르면 IN_REVIEW + ReviewRepository.enqueue(기존 흐름) · 재검수 중이면 날짜만',
   'CREATE OR REPLACE FUNCTION public.fn_lsx_listing_fp(p_id uuid)' in M76 and 'expired_fp  text' in M76 and 'req_fp          text' in M76
   and 'expired_fp = fn_lsx_listing_fp(listing_id)' in E and 'fn_lsx_listing_fp($1))' in E and 'if (baseFp && fp?.now_fp === baseFp)' in E
   and "new ReviewRepository(db).enqueue({ targetType: 'LISTING'" in E and "kind, new_at, actor_id, reason) VALUES ($1, 'QUEUED'" in E and "if (wantRestore && l.status === 'IN_REVIEW')" in E, '')
ok('① 연결 — 메뉴 lsx-expiry · 역할(검수 담당 포함) · 화면 SB-ADM-LSX-010 · SB-MYP-LSX-020 · 검수 상세 API 연결 · 문서 652 · 판 v10.514',
   "['lsx-expiry', '매물 만료 · 연장']" in rd('web/src/lib/adminMenu.ts') and "'lsx-expiry': ['ADMIN', 'SUPER', 'REVIEWER']" in rd('web/src/App.tsx')
   and '"SB-ADM-LSX-010"' in SJ and '"SB-MYP-LSX-020"' in SJ and '"PUT /admin/lsx/expiry/{id}"' in SJ and '"GET /admin/lsx/overview"' in SJ and '대표 결정' in doc('652_') and VT >= (10, 514), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    lid, oem, gwan, pub0, ver0 = lsx_pick()
    snap = exp_snap(lid) if lid else ''
    before = {k: getset(k) for k in ('lsx.expiry', 'lsx.expiry_warn_days')}
    t0 = psql("SELECT clock_timestamp()")
    rid = ''
    newreg = ''
    try:
        if not lid:
            print('  (게시 매물 없음 — ② 건너뜀)')
        else:
            consent_ok.agree(oem, PW); TO = login(oem)
            # 게시 트리거 — 되돌리는 트랜잭션(공유 자료 안 남음)
            tr = psql(f"BEGIN; UPDATE listings SET status = 'ARCHIVED' WHERE id = '{lid}'; DELETE FROM lsx_listing_expiry WHERE listing_id = '{lid}'; "
                      f"UPDATE listings SET status = 'PUBLISHED' WHERE id = '{lid}'; "
                      f"SELECT set_kind || '|' || (expires_at > now() + interval '179 days' AND expires_at < now() + interval '186 days')::text FROM lsx_listing_expiry WHERE listing_id = '{lid}'; ROLLBACK;")
            keep = psql(f"BEGIN; INSERT INTO lsx_listing_expiry (listing_id, expires_at, set_kind) VALUES ('{lid}', now() + interval '40 days', 'ADMIN') "
                        f"ON CONFLICT (listing_id) DO UPDATE SET expires_at = EXCLUDED.expires_at, set_kind = 'ADMIN'; "
                        f"UPDATE listings SET status = 'ARCHIVED' WHERE id = '{lid}'; UPDATE listings SET status = 'PUBLISHED' WHERE id = '{lid}'; "
                        f"SELECT set_kind || '|' || (expires_at < now() + interval '41 days')::text FROM lsx_listing_expiry WHERE listing_id = '{lid}'; ROLLBACK;")
            # 검수 승인 칸 — 검수 줄을 직접 넣고(그 매물 · 검수 중) 승인 · 끝에 매물 상태 · 게시 시각 되돌림
            psql(f"UPDATE listings SET status = 'IN_REVIEW' WHERE id = '{lid}';")
            rid = psql(f"INSERT INTO review_items (target_type, target_id, gwan_code, submitted_by, sla_due_at) SELECT 'LISTING', id, gwan_code, owner_account_id, now() + interval '1 day' FROM listings WHERE id = '{lid}' RETURNING id").split('\n')[0]
            rst = psql(f"SELECT status FROM review_items WHERE id = '{rid}'")
            if rst in ('QUEUED', 'IN_PROGRESS'):
                bad = call('PATCH', f'/admin/reviews/{rid}', {'decision': 'APPROVED', 'expiresOn': '2000-01-01'}, TS)
                still = psql(f"SELECT status FROM listings WHERE id = '{lid}'")
                good = call('PATCH', f'/admin/reviews/{rid}', {'decision': 'APPROVED', 'expiryMonths': 3}, TS)
                ex3 = psql(f"SELECT set_kind || '|' || (expires_at > now() + interval '88 days' AND expires_at < now() + interval '93 days')::text FROM lsx_listing_expiry WHERE listing_id = '{lid}'")
                ok('② 검수 승인 — 틀린 날짜 422 LSX_EXPIRY_RANGE(승인 되돌아감 · 검수 중 그대로) · 3개월 → 만료일 · 검수 승인 표시',
                   bad.get('_err') == 422 and bad.get('code') == 'LSX_EXPIRY_RANGE' and still == 'IN_REVIEW' and good.get('targetStatus') == 'PUBLISHED' and ex3 == 'REVIEW|true', f"{bad.get('code')} {still} {str(good)[:60]} {ex3}")
            else:
                ex6 = psql(f"SELECT (expires_at > now() + interval '170 days')::text FROM lsx_listing_expiry WHERE listing_id = '{lid}'")
                ok('② 자동 승인으로 게시 — 기본 만료일(옛 흐름 그대로)', ex6 == 'true', f'{rst} {ex6}')
            pubv = ("'" + pub0 + "'") if pub0 else 'published_at'
            psql(f"SET session_replication_role = replica; UPDATE listings SET status = 'PUBLISHED', published_at = {pubv} WHERE id = '{lid}';")
            ok('② 게시 트리거 — 기본 6개월(DEFAULT) · 다시 게시할 때 남은 날짜 그대로', tr == 'DEFAULT|true' and keep == 'ADMIN|true', f'{tr} {keep}')
            # 회원 연장 요청 → 운영 승인
            rq = call('POST', f'/me/lsx/listings/{lid}/extend-request', {'months': 3, 'note': '시험 1514'}, TO)
            rq2 = call('POST', f'/me/lsx/listings/{lid}/extend-request', {'months': 1}, TO)
            rqo = call('POST', f'/me/lsx/listings/{lid}/extend-request', {'months': 3}, TS)
            lst = call('GET', '/admin/lsx/expiry?view=REQUESTS', None, TS)
            dec = call('POST', f"/admin/lsx/extend-requests/{rq.get('requestId')}/decide", {'approve': True, 'reason': '시험 1514 승인'}, TS)
            dec2 = call('POST', f"/admin/lsx/extend-requests/{rq.get('requestId')}/decide", {'approve': True, 'reason': '시험 1514 다시'}, TS)
            nok = psql(f"SELECT count(*) FROM notifications n JOIN listings l ON l.owner_account_id = n.account_id WHERE l.id = '{lid}' AND n.event_code = 'LSX_EXTEND_OK' AND n.created_at >= '{t0}'")
            ok('② 연장 요청 — 회원 요청 · 두 번째 409 LSX_EXTEND_OPEN · 남의 매물 403/404 · 운영 목록 · 승인(새 날짜 · 알림) · 다시 409 LSX_EXTEND_DONE',
               bool(rq.get('requestId')) and rq2.get('code') == 'LSX_EXTEND_OPEN' and rqo.get('_err') in (403, 404) and any(str(r.get('listingId')) == lid for r in lst.get('rows') or [])
               and dec.get('state') == 'APPROVED' and bool(dec.get('expiresAt')) and dec2.get('code') == 'LSX_EXTEND_DONE' and nok == '1', f"{str(rq)[:60]} {rq2.get('code')} {dec.get('state')} {dec2.get('code')} {nok}")
            badd = call('PUT', f'/admin/lsx/expiry/{lid}', {'expiresOn': '2000-01-01', 'reason': '시험 1514'}, TS)
            nor = call('PUT', f'/admin/lsx/expiry/{lid}', {'months': 1, 'reason': 'x'}, TS)
            mem = call('PUT', f'/admin/lsx/expiry/{lid}', {'months': 1, 'reason': '시험 1514'}, TO)
            ok('② 운영 날짜 바꾸기 — 지난 날짜 422 · 사유 짧음 400 · 회원은 403(연장은 운영자만)', badd.get('code') == 'LSX_EXPIRY_RANGE' and nor.get('_err') == 400 and mem.get('_err') == 403,
               f"{badd.get('code')} {nor.get('_err')} {mem.get('_err')}")
            # 스위치 켜고 만료 → 내림 → 되살림(다른 매물이 하루 안에 끝나거나 지났으면 건너뜀 — 남의 매물을 건드리지 않게)
            others = psql(f"SELECT count(*) FROM lsx_listing_expiry e JOIN listings l ON l.id = e.listing_id WHERE l.status = 'PUBLISHED' AND e.listing_id <> '{lid}' AND e.expires_at <= now() + interval '1 day'")
            if others == '0':
                setting('lsx.expiry_warn_days', '1', '1514'); setting('lsx.expiry', 'on', '1514')
                psql(f"UPDATE lsx_listing_expiry SET expires_at = now() - interval '1 minute' WHERE listing_id = '{lid}';")
                call('POST', '/admin/jobs', {'job': 'lsx_daily'}, TS); call('POST', '/admin/jobs', {'job': 'lsx_daily'}, TS)
                gone = psql(f"SELECT l.status || '|' || (e.expired_at IS NOT NULL)::text FROM listings l JOIN lsx_listing_expiry e ON e.listing_id = l.id WHERE l.id = '{lid}'")
                nexp = psql(f"SELECT count(*) FROM notifications n JOIN listings l ON l.owner_account_id = n.account_id WHERE l.id = '{lid}' AND n.event_code = 'LSX_EXPIRED' AND n.created_at >= '{t0}'")
                tools = call('GET', '/me/lsx/listings', None, TO)
                back = call('PUT', f'/admin/lsx/expiry/{lid}', {'months': 1, 'reason': '시험 1514 되살림', 'restore': True}, TS)
                now_st = psql(f"SELECT status FROM listings WHERE id = '{lid}'")
                ok('② 스위치 켬 — 날짜 지난 매물 내림(ARCHIVED · 지우지 않음 · 내용 지문 · 두 번 돌려도 알림 하나) · 매물 관리 도구에 보임 · 내용 그대로면 운영 되살림 → 바로 게시(검수 없음)',
                   gone == 'ARCHIVED|true' and nexp == '1' and any(i.get('id') == lid and i.get('expiredByDate') for i in tools.get('items') or [])
                   and back.get('restored') is True and back.get('queued') is False and now_st == 'PUBLISHED', f"{gone} {nexp} {str(back)[:80]} {now_st}")
                # 대표 결정 11/20 ② — 만료 뒤 내용(지역)이 바뀌면 되살림이 검수 대기로
                psql(f"UPDATE lsx_listing_expiry SET expires_at = now() - interval '1 minute' WHERE listing_id = '{lid}';")
                call('POST', '/admin/jobs', {'job': 'lsx_daily'}, TS)
                fp1 = psql(f"SELECT coalesce(expired_fp, '') FROM lsx_listing_expiry WHERE listing_id = '{lid}'")
                newreg = psql(f"SELECT code FROM regions WHERE is_active AND code NOT IN (SELECT region_code FROM listing_regions WHERE listing_id = '{lid}') ORDER BY sort_order, code LIMIT 1")
                if newreg and not newreg.startswith('!'):
                    psql(f"INSERT INTO listing_regions (listing_id, region_code) VALUES ('{lid}', '{newreg}') ON CONFLICT DO NOTHING;")
                ri0 = psql(f"SELECT count(*) FROM review_items WHERE target_id = '{lid}' AND submitted_at >= '{t0}'")
                back2 = call('PUT', f'/admin/lsx/expiry/{lid}', {'months': 1, 'reason': '시험 1514 내용 바뀜', 'restore': True}, TS)
                ri1 = psql(f"SELECT count(*) FROM review_items WHERE target_id = '{lid}' AND submitted_at >= '{t0}'")
                st2 = psql(f"SELECT status FROM listings WHERE id = '{lid}'")
                qlog = psql(f"SELECT count(*) FROM lsx_expiry_log WHERE listing_id = '{lid}' AND kind = 'QUEUED' AND created_at >= '{t0}'")
                ok('② 만료 뒤 내용이 바뀌면 되살림 → 검수 대기(기존 검수 흐름 · 검수 줄 하나 · 기록 QUEUED · 자동검수가 승인하면 게시)',
                   len(fp1) == 32 and bool(newreg) and back2.get('queued') is True and int(ri1 or 0) == int(ri0 or 0) + 1 and qlog == '1'
                   and st2 in ('IN_REVIEW', 'PUBLISHED') and (back2.get('restored') is True) == (st2 == 'PUBLISHED'), f"{fp1} {newreg} {str(back2)[:100]} {ri0}->{ri1} {st2} {qlog}")
            else:
                print(f'  (다른 매물 {others}건이 하루 안에 끝남 — 만료 작업 시험 건너뜀)')
    finally:
        for k, v in before.items():
            setting(k, v or None, '1514 되돌림')
        if lid:
            psql(f"SET session_replication_role = replica; UPDATE listings SET status = 'PUBLISHED' WHERE id = '{lid}' AND status <> 'PUBLISHED'; "
                 f"DELETE FROM lsx_extend_requests WHERE listing_id = '{lid}' AND created_at >= '{t0}'; DELETE FROM lsx_expiry_log WHERE listing_id = '{lid}' AND created_at >= '{t0}'; "
                 f"DELETE FROM notifications WHERE event_code IN ('LSX_EXTEND_OK', 'LSX_EXTEND_NO', 'LSX_EXPIRED', 'LSX_EXPIRY_SOON') AND created_at >= '{t0}' "
                 f"AND account_id = (SELECT owner_account_id FROM listings WHERE id = '{lid}');")
            if pub0:
                psql(f"SET session_replication_role = replica; UPDATE listings SET published_at = '{pub0}' WHERE id = '{lid}';")
            if newreg and not str(newreg).startswith('!'):
                psql(f"DELETE FROM listing_regions WHERE listing_id = '{lid}' AND region_code = '{newreg}';")
            psql(f"SET session_replication_role = replica; DELETE FROM review_events WHERE review_item_id IN (SELECT id FROM review_items WHERE target_id = '{lid}' AND submitted_at >= '{t0}'); "
                 f"DELETE FROM review_items WHERE target_id = '{lid}' AND submitted_at >= '{t0}';")
            exp_restore(lid, snap)
            psql(f"SET session_replication_role = replica; DELETE FROM ops_alerts WHERE alert_code = 'LSX_EXPIRE_BATCH' AND raised_at >= '{t0}';")
    if ADMIN_WEB:
        r = admin_page('/#/lsx-expiry', lambda pg, seen: seen.update(n=pg.locator('[data-lsx-expiry]').count(), v=pg.locator('[data-lsx-view]').count(), g=pg.locator('[data-lsx-grace]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 검수 › 매물 만료 · 연장(보기 단추 5 · 유예 단추 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('v') == 5 and seen.get('g') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
