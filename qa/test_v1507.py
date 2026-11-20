"""v10.507 (docs/645) 소개광장 활동 배지 · 랭킹 — 대표 11/20 「㊹ ③」
  ① (코드) D274 도움돼요 · 노출 설정 · 월간 점수 · 달 마감 배지 · 공개 랭킹 · 회원 화면(랭킹 · 도움돼요 · 노출 끄기) · 사전 · 메뉴 · 화면 · 문서 645
  ② (API · DB) 꺼짐 · 누르기 · 취소 · 자기 것 막음 · 다시 셈 점수 · 신고된 답변 빠짐 · 노출 끄기 · 지난 달 마감 TOP1 · 한 번만 · 거두기 · 지킴
  ③ (화면) 소개광장 › 활동 배지 · 랭킹  ④ (회원 화면 · SITE 있을 때) /community/ranking
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


def raw(m_, url, data, ct, t=None):
    hd = {'content-type': ct}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    try:
        return urllib.request.urlopen(urllib.request.Request(url, data=data, headers=hd, method=m_), timeout=60).status
    except urllib.error.HTTPError as e:
        return e.code


def new_member(tag):
    """새 회원(본인인증 · 약관 동의) · 토큰"""
    import consent_ok
    em, aid = mk_staff(tag, role=None)
    consent_ok.agree(em, PW)
    return em, aid, login(em)


M74 = migr('D274_')
stamp = int(time.time()) % 1000000
T0 = psql("SELECT now()::text") if (API and DB) else ''
PR, PC, HB, RP, RK, DP, LP, KO, EN, MN, AP, UI = (rd('src/modules/community/plaza-rank.ts'), rd('src/modules/community/plaza-rank.controller.ts'), rd('site/src/components/community/HelpfulButton.tsx'),
                                              rd('site/src/app/community/ranking/page.tsx'), rd('site/src/components/community/RankPref.tsx'), rd('site/src/app/community/[id]/page.tsx'),
                                              rd('site/src/app/community/page.tsx'), rd('site/src/i18n/messages/ko/plaza.json'), rd('site/src/i18n/messages/en/plaza.json'),
                                              rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('web/src/app/admin/PlazaRanking.tsx'))
try:
    KJ, EJ = json.loads(KO or '{}'), json.loads(EN or '{}')
except Exception:
    KJ, EJ = {}, {}
NEWK = ['helpfulBtn', 'rankTitle', 'rankLead', 'rankHide', 'rankShow', 'badgeTOP1', 'badgeWRITER']

ok('① 코드 — D274 도움돼요 표 · 지킴(자기 것 · 공개 글만) · 노출 설정 · 월간 점수 함수(숨김 · 신고 · 공지 · 운영자 빼고 · 하루 상한) · 달 마감 배지 · 거두기만 · 알림 PLZ_BADGE · plaza.ranking off · 정기 작업 plz_badge_month · 공개 랭킹 · 회원 화면(랭킹 · 도움돼요 · 노출 끄기 · 링크) · 사전 글자만 · 메뉴 plz-rank · 화면 MLX-030 · 문서 645 · 판 v10.507',
   'CREATE TABLE IF NOT EXISTS public.plz_helpful_votes' in M74 and 'PLZ_HELPFUL_SELF' in M74 and 'CREATE TABLE IF NOT EXISTS public.plz_rank_prefs' in M74
   and 'FUNCTION public.fn_plz_month_scores' in M74 and "r.state <> 'DISMISSED'" in M74 and "p.board <> 'NOTICE'" in M74 and 'fn_plz_staff' in M74 and 'plaza.daily_cap' in M74
   and 'FUNCTION public.fn_plz_month_close' in M74 and 'trg_plz_badge_guard' in M74 and "('PLZ_BADGE', '소개광장 활동 배지', true" in M74 and "('plaza.ranking', 'off', 'GLOBAL'" in M74
   and "('plz_badge_month', 1440, 3, 30" in M74 and "@Get('community/ranking')" in PC and 'export async function publicRanking' in PR and 'export function HelpfulScope' in HB
   and 'data-screen="SB-HOM-MLX-010"' in RP and 'export function RankPref' in RK and '<HelpfulButton type="COMMENT"' in DP and '<RankingLink />' in LP
   and all(isinstance(KJ.get(k), str) and isinstance(EJ.get(k), str) for k in NEWK)
   and "['plz-rank', '활동 배지 · 랭킹']" in MN and "{tab === 'plz-rank' && <PlazaRanking />}" in AP and 'export function PlazaRanking' in UI
   and '"SB-ADM-MLX-030"' in SJ and '"SB-HOM-MLX-010"' in SJ and '랭킹' in doc('645_') and VT >= (10, 507), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    keys = ('plaza.ranking',)
    s0 = {k: getset(k) for k in keys}
    W = {k: int(getset(k) or d) for k, d in (('plaza.score_post', 3), ('plaza.score_answer', 2), ('plaza.score_comment', 1), ('plaza.score_helpful', 2))}
    aA = aB = pid = cid = rid = ''
    try:
        eA, aA, TA = new_member('1507a')
        eB, aB, TB = new_member('1507b')
        pid = psql(f"INSERT INTO posts (board, author_id, title, body, state) VALUES ('QNA', '{aA}', '시험 1507 질문 {stamp}', '시험 1507 질문 본문입니다 — 지우는 글.', 'PUBLISHED') RETURNING id").split('\n')[0]
        if pid and '!' not in pid:   # 첫 글은 트리거가 검수 대기(PENDING)로 둠 — 시험 글만 공개로
            psql(f"SET session_replication_role = replica; UPDATE posts SET state = 'PUBLISHED' WHERE id = '{pid}';")
        cid = psql(f"INSERT INTO post_comments (post_id, author_id, body) VALUES ('{pid}', '{aB}', '시험 1507 답변입니다') RETURNING id").split('\n')[0]
        setting('plaza.ranking', 'off', '1507')
        r_off = call('GET', '/community/ranking')
        h_off = call('POST', '/me/community/helpful', {'targetType': 'POST', 'targetId': pid}, TB)
        setting('plaza.ranking', 'on', '1507')
        h1 = call('POST', '/me/community/helpful', {'targetType': 'POST', 'targetId': pid}, TB)
        h2 = call('POST', '/me/community/helpful', {'targetType': 'POST', 'targetId': pid}, TB)
        h3 = call('POST', '/me/community/helpful', {'targetType': 'POST', 'targetId': pid}, TB)
        hs = call('POST', '/me/community/helpful', {'targetType': 'POST', 'targetId': pid}, TA)
        hc = call('POST', '/me/community/helpful', {'targetType': 'COMMENT', 'targetId': cid}, TA)
        cnt = call('GET', f'/community/posts/{pid}/helpful', None, TB)
        gu = psql(f"UPDATE plz_helpful_votes SET created_at = now() WHERE voter_id = '{aB}'")
        run = call('POST', '/admin/community/ranking/run', {}, TS)
        sa = psql(f"SELECT posts || '|' || answers || '|' || helpful || '|' || score FROM plz_month_scores WHERE account_id = '{aA}' AND month = date_trunc('month', now() AT TIME ZONE 'Asia/Seoul')::date")
        sb = psql(f"SELECT posts || '|' || answers || '|' || helpful || '|' || score FROM plz_month_scores WHERE account_id = '{aB}' AND month = date_trunc('month', now() AT TIME ZONE 'Asia/Seoul')::date")
        rcode = psql("SELECT code FROM report_reasons ORDER BY sort_order LIMIT 1")
        rid = psql(f"INSERT INTO reports (target_type, target_id, reason_code, reporter_id, state) VALUES ('COMMENT', '{cid}', '{rcode}', '{aA}', 'OPEN') RETURNING id").split('\n')[0]
        call('POST', '/admin/community/ranking/run', {}, TS)
        sb2 = psql(f"SELECT count(*) FROM plz_month_scores WHERE account_id = '{aB}' AND month = date_trunc('month', now() AT TIME ZONE 'Asia/Seoul')::date")
        pub1 = call('GET', '/community/ranking')
        act = call('GET', '/me/community/activity', None, TA)
        pref = call('PUT', '/me/community/rank-pref', {'hide': True}, TA)
        pub2 = call('GET', '/community/ranking')
        act2 = call('GET', '/me/community/activity', None, TA)
        call('PUT', '/me/community/rank-pref', {'hide': False}, TA)
        a403 = call('GET', '/admin/community/ranking', None, TA)
        psql(f"SET session_replication_role = replica; UPDATE posts SET created_at = '2001-01-15 12:00+09' WHERE id = '{pid}'; UPDATE post_comments SET created_at = '2001-01-16 12:00+09' WHERE id = '{cid}';")
        psql(f"SET session_replication_role = replica; DELETE FROM reports WHERE id = '{rid}';")
        psql("SET session_replication_role = replica; DELETE FROM plz_badges WHERE month = '2001-01-01'; DELETE FROM plz_month_closes WHERE month = '2001-01-01'; DELETE FROM plz_month_scores WHERE month = '2001-01-01';")
        cl1 = psql("SELECT fn_plz_month_close('2001-01-01')")
        cl2 = psql("SELECT fn_plz_month_close('2001-01-01')")
        bA = psql(f"SELECT string_agg(badge, ',' ORDER BY badge) FROM plz_badges WHERE month = '2001-01-01' AND account_id = '{aA}'")
        nb = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{aA}' AND event_code = 'PLZ_BADGE'")
        bid = psql(f"SELECT id FROM plz_badges WHERE month = '2001-01-01' AND account_id = '{aA}' ORDER BY id LIMIT 1")
        rv1 = call('POST', f'/admin/community/badges/{bid}/revoke', {'reason': '시험 1507 거두기'}, TS)
        rv2 = call('POST', f'/admin/community/badges/{bid}/revoke', {'reason': '시험 1507 거두기'}, TS)
        gd = psql(f"DELETE FROM plz_badges WHERE id = {bid or 0}")
        adm = call('GET', '/admin/community/ranking?month=2001-01', None, TS)
        badm = call('GET', '/admin/community/ranking?month=2001-13', None, TS)
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE task_key = 'plz-rank'")
        wA, wB = W['plaza.score_post'] + W['plaza.score_helpful'], W['plaza.score_answer'] + W['plaza.score_helpful']
        ok('② 랭킹 · 배지 — 꺼짐(공개 on:false · 도움돼요 422) · 누르기 1 · 취소 0 · 다시 1 · 자기 글 422 · 댓글 도움돼요 · 수 · 내 것 · 고치기 막음 · 다시 셈 → 글쓴이 글 1 도움 1 · 답변자 답변 1 도움 1(점수 규칙대로) · 신고된 답변 빠짐 · 내 활동 · 노출 끄면 공개 랭킹에서 빠짐 · 회원은 운영 403 · 지난 달 마감 → TOP1 · 한 번만 · 배지 알림 · 거두기 · 다시 409 · 지우기 막음 · 운영 달 보기 · 틀린 달 422 · 권한 주소 3',
           bool(pid) and bool(cid) and r_off.get('on') is False and h_off.get('code') == 'PLZ_RANK_OFF' and h1.get('on') is True and h1.get('count') == 1 and h2.get('on') is False and h2.get('count') == 0
           and h3.get('count') == 1 and hs.get('code') == 'PLZ_HELPFUL_SELF' and hc.get('count') == 1 and cnt.get('post') == 1 and (cnt.get('comments') or {}).get(cid) == 1 and f'POST:{pid}' in (cnt.get('mine') or [])
           and 'PLZ_HELPFUL_FIXED' in gu and run.get('members', 0) >= 2 and sa == f'1|0|1|{wA}' and sb == f'0|1|1|{wB}' and sb2 == '0'
           and act.get('score', {}).get('score') == wA and pref.get('hideRank') is True and len(pub2.get('items') or []) == len(pub1.get('items') or []) - 1 and act2.get('hideRank') is True
           and a403.get('_err') == 403 and cl1 != '0' and '!' not in cl1 and cl2 == '0' and 'TOP1' in (bA or '') and int(nb or 0) >= 1 and rv1.get('revoked') is True and rv2.get('_err') == 409
           and 'PLZ_BADGE_KEEP' in gd and len(adm.get('badges') or []) >= 1 and badm.get('code') == 'PLZ_MONTH' and rmap == '3',
           f"{pid[:8]} {cid[:8]} {r_off.get('on')} {h_off.get('code')} {h1} {h2.get('count')} {h3.get('count')} {hs.get('code')} {hc.get('count')} {cnt} · {gu[-30:]} {run} {sa}/{wA} {sb}/{wB} {sb2} · "
           f"{act.get('score')} {pref.get('hideRank')} {len(pub1.get('items') or [])}->{len(pub2.get('items') or [])} {a403.get('_err')} · {cl1} {cl2} {bA} {nb} {rv1} {rv2.get('_err')} {gd[-30:]} {len(adm.get('badges') or [])} {badm.get('code')} {rmap}")
    finally:
        if aA or aB:
            ids = ','.join(f"'{x}'" for x in (aA, aB) if x)
            psql(f"SET session_replication_role = replica; DELETE FROM plz_helpful_votes WHERE voter_id IN ({ids}) OR author_id IN ({ids}); DELETE FROM plz_rank_prefs WHERE account_id IN ({ids}); "
                 f"DELETE FROM plz_badges WHERE account_id IN ({ids}); DELETE FROM plz_month_scores WHERE account_id IN ({ids}); DELETE FROM notifications WHERE account_id IN ({ids});")
            psql("SET session_replication_role = replica; DELETE FROM plz_month_closes WHERE month = '2001-01-01'; DELETE FROM plz_month_scores WHERE month = '2001-01-01'; DELETE FROM plz_badges WHERE month = '2001-01-01';")
        if rid:
            psql(f"SET session_replication_role = replica; DELETE FROM reports WHERE id = '{rid}';")
        if pid:
            psql(f"SET session_replication_role = replica; DELETE FROM post_comments WHERE post_id = '{pid}'; DELETE FROM posts WHERE id = '{pid}';")
        for k, x in s0.items():
            setting(k, x or None, '1507 되돌림')
    if ADMIN_WEB:
        r = admin_page('/#/plz-rank', lambda pg, seen: seen.update(n=pg.locator('[data-plz-rank]').count(), m=pg.locator('[data-plz-month]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 소개광장 › 활동 배지 · 랭킹(달 고르기 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('m') == 1 and not perr, f"{seen} {perr[:2]}")
    if SITE:
        def chk(b, seen, perr):
            pg = b.new_page(viewport={'width': 1280, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
            pg.goto(SITE + '/community/ranking', wait_until='networkidle', timeout=120000)
            seen['scr'] = pg.locator('[data-screen="SB-HOM-MLX-010"]').count()
        r = ui(chk)
        if r is not None:
            seen, perr = r
            ok('④ 회원 화면 — 소개광장 활동 랭킹 열림(꺼져 있으면 안내만 · 화면 오류 없음)', seen.get('scr') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
