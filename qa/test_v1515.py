"""v10.515 (D276 · docs/653) ㊻ 매물 ③ 끌어올리기 — 대표 결정 11/20 「상황에 따라 전환 가능 · 관리자가 지정」
  ① (코드) 방식 lsx.bump_mode OFF(처음) · FREE · PAID · 무료 횟수 · 간격(무료 · 유료 같음) · 1회 금액 + 부가세(fn_vat10) · 결제 뒤에만 · 노출 가산은 방식과 상관없이 같은 상한 · 감쇠
       (최신순 정렬 키 greatest(게시, 끌어올린 시각) · 효과 시간 DB 상한 · 앞날 없음) · 다른 정렬 · 우선노출 그대로 · 표시 「끌어올림」 · 「유료 끌어올림」 · 운영 바로잡기(SUPER · 사유 종류 둘 · 대표 결정 11/20) · 환불 SUPER · 전표 2 · 계정 REV_BUMP
  ② (API · DB) OFF 422 · FREE 끌어올림 → 최신순 맨 위 · 표시 · 간격 409 · 무료 횟수 422 · 운영 바로잡기(SUPER · 종류 밖 400 · ADMIN 403 · DB 막음) · PAID 금액 없으면 422 · 결제 없이 422(금액) · 금액 틀림 422 · 시험 결제 승인 · 결제 키 다시 409 · 환불 · DB 상한 · 앞날 막음 — 모두 되돌림
  ③ (화면) 검수 › 끌어올리기
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

RP, BP, SO = rd('src/modules/listing/listing.repository.ts'), SRC['bump'], rd('src/modules/acct/sources.ts')
ok('① 노출 엔진 — 최신순 키만 greatest(게시 시각, 끌어올린 시각) · 기본 목록에만 효과 표 · 다른 정렬 · 우선노출 · 건수 그대로 · 구독 가중치 없음(INV-11) · 표시 bumpLabel',
   "RECENT:   { expr: \"coalesce(greatest(l.published_at, bx.sort_at), 'epoch'::timestamptz)\"" in RP and RP.count('LEFT JOIN lsx_bump_live bx ON bx.listing_id = l.id') == 1
   and "FEE_DESC: { expr: 'coalesce(l.desired_fee, -1)::numeric'" in RP and 'ORDER BY pl.exposure_weight DESC, random()' in RP and "'유료 끌어올림'" in RP
   and 'bumpLabel?: string | null;' in rd('src/modules/listing/listing.dto.ts') and 'exposure_weight' not in BP, '')
ok('① D276 상한 · 감쇠 — 효과 시간 설정(처음 72 · 1 ~ 168) · DB 상한 168시간 · 앞날 막음 · 효과 끝나면 매시간 지움 · 기록 쌓기만 · 결제 줄 환불 칸만',
   "CHECK (until_at > sort_at AND until_at <= sort_at + interval '168 hours')" in M76 and 'trg_lsx_bump_live_guard' in M76 and 'LSX_BUMP_FUTURE' in M76 and 'LSX_BUMP_CAP' in M76
   and "('lsx.bump_effect_hours', '72'" in M76 and 'trg_lsx_bumps_ro' in M76 and 'trg_lsx_bump_payment_guard' in M76 and 'WHERE bl.until_at <= now()' in BP, '')
ok('① 서버 — 방식 3가지 · 무료 횟수(회원마다 기간당) · 간격(무료 · 유료 같음) · 결제 전 막기 · 결제 키 한 번 · 승인 뒤에만 · 부가세 fn_vat10 · 소개비 아님 · 운영 직접 사유 · 환불 SUPER',
   "BUMP_MODES = ['OFF', 'FREE', 'PAID']" in SRC['common'] and "kind = 'FREE' AND created_at > now() - make_interval(days => $2::int)" in BP and "kind <> 'ADMIN'" in BP
   and 'await precheck(db, me, listingId, s);   // 결제 요청 전에' in BP and 'confirmOrRecover(resolvePaymentProvider()' in BP and 'fn_vat10($1)' in BP
   and "orderName: '매물 끌어올리기 1회'" in BP and "@Audit('LSX_ADMIN_BUMP', 'LISTING')" in SRC['lsx.controller'] and "@Roles('SUPER')" in SRC['lsx.controller'], '')
ok('① 운영 바로잡기(대표 결정 11/20 ①) — SUPER 만(서버 @Roles · DB trg_lsx_admin_bump_guard) · 사유 종류 FIX_ERROR · MEMBER_REQUEST 둘(서버 DTO · 서비스 · DB CHECK) + 글 사유 · 감사',
   "ADMIN_BUMP_REASONS = ['FIX_ERROR', 'MEMBER_REQUEST']" in BP and "reason_kind IN ('FIX_ERROR', 'MEMBER_REQUEST')" in M76 and "CHECK ((kind = 'ADMIN') = (reason_kind IS NOT NULL))" in M76
   and 'trg_lsx_admin_bump_guard' in M76 and "r.role = 'SUPER'" in M76 and "@Roles('SUPER')\n  @ApiOperation({ summary: '운영 끌어올리기 — 바로잡기용" in SRC['lsx.controller']
   and '@IsIn(ADMIN_BUMP_REASONS as unknown as string[]) reasonKind!: string;' in SRC['lsx.controller'] and "throw new PolicyViolation('LSX_ADMIN_BUMP_REASON'" in BP, '')
ok('① 전표 — LSX_BUMP_PAID(PG 받을 돈 / 끌어올리기 매출 · 부가세예수금) · LSX_BUMP_REFUND(반대) · 시험 결제는 설정 따름 · sources 끝에 push · 계정 REV_BUMP 초안 · 매출 보고서 목록',
   "name: 'LSX_BUMP_PAID'" in BP and "name: 'LSX_BUMP_REFUND'" in BP and 'fn_acct_stub_ok(p.stub)' in BP and 'ALL_SOURCES.push(...LSX_SOURCES);' in SO
   and "('REV_BUMP', '끌어올리기 매출', 'REVENUE'" in M76 and "'REV_BUMP']" in rd('src/modules/acct/acct-reports.ts'), '')
ok('① 연결 — 메뉴 lsx-bump(운영 · SUPER) · 화면 SB-ADM-LSX-020 · SB-MYP-LSX-020 · 030 · 사이트 표시(GwList · ListingCard · GwCard) · 문서 653 · 판 v10.515',
   "['lsx-bump', '끌어올리기']" in rd('web/src/lib/adminMenu.ts') and "'lsx-bump': ['ADMIN', 'SUPER']" in rd('web/src/App.tsx') and '"SB-ADM-LSX-020"' in SJ and '"SB-MYP-LSX-030"' in SJ
   and 'item.bumpLabel' in rd('site/src/components/gwan/GwList.tsx') and 'item.bumpLabel' in rd('site/src/components/ListingCard.tsx') and 'item.bumpLabel ??' in rd('site/src/components/gwan/GwCard.tsx')
   and '대표 결정' in doc('653_') and VT >= (10, 515), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    lid, oem, gwan, pub0, ver0 = lsx_pick()
    keys = ('lsx.bump_mode', 'lsx.bump_free_count', 'lsx.bump_min_hours', 'lsx.bump_price')
    before = {k: getset(k) for k in keys}
    t0 = psql("SELECT clock_timestamp()")
    b0 = psql("SELECT coalesce(max(id), 0) FROM lsx_bumps") or '0'
    try:
        if not lid:
            print('  (게시 매물 없음 — ② 건너뜀)')
        else:
            consent_ok.agree(oem, PW); TO = login(oem)
            setting('lsx.bump_mode', 'OFF', '1515')
            off = call('POST', f'/me/lsx/listings/{lid}/bump', {}, TO)
            setting('lsx.bump_free_count', '1', '1515'); setting('lsx.bump_min_hours', '1', '1515'); setting('lsx.bump_mode', 'FREE', '1515')
            used0 = psql(f"SELECT count(*) FROM lsx_bumps WHERE account_id = (SELECT owner_account_id FROM listings WHERE id = '{lid}') AND kind = 'FREE' AND created_at > now() - interval '30 days'")
            q = call('GET', f'/me/lsx/listings/{lid}/bump-quote', None, TO)
            b1 = call('POST', f'/me/lsx/listings/{lid}/bump', {}, TO)
            live = psql(f"SELECT (sort_at <= clock_timestamp())::text || '|' || extract(epoch FROM until_at - sort_at)::int FROM lsx_bump_live WHERE listing_id = '{lid}'")
            lst = call('GET', f'/listings?gwanCode={gwan}&sort=RECENT&limit=50', None)
            org = lst.get('organic') or []
            pos = next((i for i, r in enumerate(org) if r.get('id') == lid), -1)
            lab = org[pos].get('bumpLabel') if pos >= 0 else None
            fee = call('GET', f'/listings?gwanCode={gwan}&sort=FEE_DESC&limit=50', None)
            b2 = call('POST', f'/me/lsx/listings/{lid}/bump', {}, TO)
            if used0 == '0':
                ok('② FREE — 끌어올림 · 효과 72시간(기본) · 앞날 아님 · 최신순 맨 위 · 「끌어올림」 표시 · 소개비순엔 표시 없음 · 간격 안 409 LSX_BUMP_TOO_SOON',
                   q.get('mode') == 'FREE' and b1.get('kind') == 'FREE' and live.startswith('true|') and live.split('|')[1] in (str(int(getset('lsx.bump_effect_hours') or 72) * 3600),)
                   and pos == 0 and lab == '끌어올림' and all(not r.get('bumpLabel') for r in (fee.get('organic') or []))
                   and b2.get('_err') == 409 and b2.get('code') == 'LSX_BUMP_TOO_SOON', f"{str(b1)[:60]} {live} {pos} {lab} {b2.get('code')}")
            else:
                print(f'  (그 주인이 이번 기간 무료 끌어올리기를 이미 씀 {used0} — FREE 결과 단언 건너뜀)')
            # 무료 횟수 — 간격 줄을 지우고(시험만) 다시 → 422 LSX_BUMP_FREE_USED
            psql(f"SET session_replication_role = replica; UPDATE lsx_bumps SET created_at = created_at - interval '2 hours' WHERE listing_id = '{lid}' AND id > {int(b0 if str(b0).isdigit() else 0)};")
            b3 = call('POST', f'/me/lsx/listings/{lid}/bump', {}, TO)
            ok('② 무료 횟수(1) 다 쓰면 422 LSX_BUMP_FREE_USED · OFF 면 422 LSX_OFF', b3.get('code') == 'LSX_BUMP_FREE_USED' and off.get('code') == 'LSX_OFF', f"{b3.get('code')} {off.get('code')}")
            ab = call('POST', '/admin/lsx/bumps', {'listingId': lid, 'reasonKind': 'FIX_ERROR', 'reason': '시험 1515 오류 바로잡기'}, TS)
            abk = call('POST', '/admin/lsx/bumps', {'listingId': lid, 'reasonKind': 'PROMOTION', 'reason': '시험 1515 홍보'}, TS)
            abn = call('POST', '/admin/lsx/bumps', {'listingId': lid, 'reason': '시험 1515 종류 없음'}, TS)
            abm = call('POST', '/admin/lsx/bumps', {'listingId': lid, 'reasonKind': 'MEMBER_REQUEST', 'reason': '시험 1515'}, TO)
            sem, said = mk_staff('1515', 'ADMIN'); consent_ok.agree(sem, PW); TA = login(sem)
            aba = call('POST', '/admin/lsx/bumps', {'listingId': lid, 'reasonKind': 'MEMBER_REQUEST', 'reason': '시험 1515 운영 관리자'}, TA)
            dbk = psql(f"BEGIN; INSERT INTO lsx_bumps (listing_id, account_id, kind, sort_at, until_at, actor_id, reason, reason_kind) SELECT id, owner_account_id, 'ADMIN', now(), now() + interval '1 hour', "
                       f"(SELECT account_id FROM account_roles WHERE role = 'SUPER' LIMIT 1), '시험 1515', 'PROMOTION' FROM listings WHERE id = '{lid}'; ROLLBACK;")
            dbs = psql(f"BEGIN; INSERT INTO lsx_bumps (listing_id, account_id, kind, sort_at, until_at, actor_id, reason, reason_kind) SELECT id, owner_account_id, 'ADMIN', now(), now() + interval '1 hour', "
                       f"'{said}', '시험 1515', 'FIX_ERROR' FROM listings WHERE id = '{lid}'; ROLLBACK;")
            dbf = psql(f"BEGIN; INSERT INTO lsx_bumps (listing_id, account_id, kind, sort_at, until_at, reason_kind) SELECT id, owner_account_id, 'FREE', now(), now() + interval '1 hour', 'FIX_ERROR' FROM listings WHERE id = '{lid}'; ROLLBACK;")
            rm_role(said, '1515')
            rk = psql(f"SELECT coalesce(reason_kind, '') FROM lsx_bumps WHERE id = {int(ab.get('bumpId') or 0)}")
            ok('② 운영 바로잡기(대표 결정 11/20 ①) — SUPER · 사유 종류 FIX_ERROR 저장 · 다른 종류 400 · 종류 없음 400 · 회원 403 · 운영 관리자(ADMIN) 403 · DB 도 다른 종류 · SUPER 아님 · 회원 끌어올리기에 종류 막음',
               ab.get('kind') == 'ADMIN' and ab.get('reasonKind') == 'FIX_ERROR' and rk == 'FIX_ERROR' and abk.get('_err') == 400 and abn.get('_err') == 400
               and abm.get('_err') == 403 and aba.get('_err') == 403 and '!' in dbk and 'LSX_ADMIN_BUMP_SUPER' in dbs and '!' in dbf,
               f"{str(ab)[:60]} {abk.get('_err')} {abn.get('_err')} {abm.get('_err')} {aba.get('_err')} {dbk[-60:]} {dbs[-60:]} {dbf[-60:]}")
            # PAID
            np = call('PUT', '/admin/lsx/settings', {'bumpMode': 'PAID', 'bumpPrice': 0, 'reason': '시험 1515'}, TS)
            sp = call('PUT', '/admin/lsx/settings', {'bumpMode': 'PAID', 'bumpPrice': 1000, 'reason': '시험 1515 유료'}, TS)
            spm = call('PUT', '/admin/lsx/settings', {'bumpMode': 'FREE', 'reason': '시험 1515'}, TO)
            psql(f"SET session_replication_role = replica; UPDATE lsx_bumps SET created_at = created_at - interval '2 hours' WHERE listing_id = '{lid}' AND id > {int(b0 if str(b0).isdigit() else 0)};")
            need = call('POST', f'/me/lsx/listings/{lid}/bump', {}, TO)
            amt = 1000 + (100 if psql("SELECT fn_vat_separate(now())::text") == 'true' else 0)
            wrong = call('POST', f'/me/lsx/listings/{lid}/bump', {'paymentKey': f'stub_t1515{stamp}', 'orderId': f'lsxT1515{stamp}', 'amount': amt + 1}, TO)
            paid = call('POST', f'/me/lsx/listings/{lid}/bump', {'paymentKey': f'stub_t1515{stamp}', 'orderId': f'lsxT1515{stamp}', 'amount': amt}, TO)
            psql(f"SET session_replication_role = replica; UPDATE lsx_bumps SET created_at = created_at - interval '2 hours' WHERE listing_id = '{lid}' AND id > {int(b0 if str(b0).isdigit() else 0)};")
            reuse = call('POST', f'/me/lsx/listings/{lid}/bump', {'paymentKey': f'stub_t1515{stamp}', 'orderId': f'lsxT1515b{stamp}', 'amount': amt}, TO)
            plab = next((r.get('bumpLabel') for r in (call('GET', f'/listings?gwanCode={gwan}&sort=RECENT&limit=50', None).get('organic') or []) if r.get('id') == lid), None)
            pid = paid.get('paymentId')
            rfm = call('POST', f'/admin/lsx/bump-payments/{pid}/refund', {'reason': '시험 1515'}, TO) if pid else {}
            rf = call('POST', f'/admin/lsx/bump-payments/{pid}/refund', {'reason': '시험 1515 환불'}, TS) if pid else {}
            rf2 = call('POST', f'/admin/lsx/bump-payments/{pid}/refund', {'reason': '시험 1515 다시'}, TS) if pid else {}
            liveg = psql(f"SELECT count(*) FROM lsx_bump_live bl JOIN lsx_bumps b ON b.id = bl.bump_id WHERE b.payment_id = {int(pid or 0)}")
            ok('② PAID — 금액 0 이면 422 LSX_BUMP_PRICE_UNSET · 설정은 SUPER(회원 403) · 결제 없이 422 LSX_BUMP_PAYMENT_REQUIRED · 금액 틀림 422',
               np.get('code') == 'LSX_BUMP_PRICE_UNSET' and (sp.get('settings') or {}).get('bumpMode') == 'PAID' and spm.get('_err') == 403
               and need.get('code') == 'LSX_BUMP_PAYMENT_REQUIRED' and wrong.get('code') == 'LSX_AMOUNT_MISMATCH', f"{np.get('code')} {spm.get('_err')} {need.get('code')} {wrong.get('code')}")
            if paid.get('kind') == 'PAID':
                ok('② PAID — 시험 결제 승인 뒤 끌어올림 · 「유료 끌어올림」 표시 · 같은 결제 키 409 PAYMENT_KEY_USED · 환불 SUPER(회원 403) · 두 번째 409 · 효과 끝냄',
                   paid.get('amount') == amt and plab == '유료 끌어올림' and reuse.get('code') == 'PAYMENT_KEY_USED' and rfm.get('_err') == 403
                   and rf.get('ok') is True and rf2.get('code') == 'LSX_REFUNDED' and liveg == '0', f"{str(paid)[:80]} {plab} {reuse.get('code')} {rf2.get('code')} {liveg}")
            else:
                print(f"  (시험 결제가 아님 — 결제 단언 건너뜀: {str(paid)[:100]})")
            cap = psql(f"BEGIN; INSERT INTO lsx_bump_live (listing_id, bump_id, kind, sort_at, until_at) SELECT '{lid}', id, 'FREE', now(), now() + interval '200 hours' FROM lsx_bumps WHERE listing_id = '{lid}' LIMIT 1 "
                       f"ON CONFLICT (listing_id) DO UPDATE SET until_at = EXCLUDED.until_at; ROLLBACK;")
            fut = psql(f"BEGIN; INSERT INTO lsx_bump_live (listing_id, bump_id, kind, sort_at, until_at) SELECT '{lid}', id, 'FREE', now() + interval '1 day', now() + interval '2 days' FROM lsx_bumps WHERE listing_id = '{lid}' LIMIT 1 "
                       f"ON CONFLICT (listing_id) DO UPDATE SET sort_at = EXCLUDED.sort_at, until_at = EXCLUDED.until_at; ROLLBACK;")
            ok('② DB — 효과 시간 상한 넘으면 막음 · 앞날 시각 막음', '!' in cap and '!' in fut, f'{cap[-80:]} | {fut[-80:]}')
    finally:
        for k, v in before.items():
            setting(k, v or None, '1515 되돌림')
        if lid:
            psql(f"SET session_replication_role = replica; DELETE FROM lsx_bump_live WHERE listing_id = '{lid}'; "
                 f"DELETE FROM acct_lines WHERE entry_id IN (SELECT id FROM acct_entries WHERE source IN ('LSX_BUMP_PAID', 'LSX_BUMP_REFUND') AND source_key IN (SELECT id::text FROM lsx_bump_payments WHERE listing_id = '{lid}' AND paid_at >= '{t0}')); "
                 f"DELETE FROM acct_entries WHERE source IN ('LSX_BUMP_PAID', 'LSX_BUMP_REFUND') AND source_key IN (SELECT id::text FROM lsx_bump_payments WHERE listing_id = '{lid}' AND paid_at >= '{t0}'); "
                 f"DELETE FROM lsx_bumps WHERE listing_id = '{lid}' AND id > {int(b0 if str(b0).isdigit() else 0)}; DELETE FROM lsx_bump_payments WHERE listing_id = '{lid}' AND order_id LIKE 'lsxT1515%{stamp}';")
    if ADMIN_WEB:
        r = admin_page('/#/lsx-bump', lambda pg, seen: seen.update(n=pg.locator('[data-lsx-bump]').count(), a=pg.locator('[data-lsx-admin-bump]').count(), s=pg.locator('[data-lsx-settings]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 검수 › 끌어올리기(운영 직접 칸 · 설정 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('a') == 1 and seen.get('s') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
