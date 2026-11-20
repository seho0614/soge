"""v10.504 (D273 · docs/642) 회원 간 1:1 대화 — 대표 11/20 「㊸ 회원 2 ④」
  ① (코드) 대화 · 글 · 신고 · 열람 기록 · 정리 기록 · 당사자 트리거 · 글 고치기 · 지우기 막음 · 설정 mbx.dm(처음 off) · 감지 · 열람 사유 + 개인정보 접속기록 · 메뉴 mbx-dm · 화면 · 사전 · 문서 642
  ② (API · DB) 문의 근거(시험이 만든 conversations 두 줄) · 열기 · 남 403 · DB 막음 · 보내기 · 알림 묶음 · 감지 WARN · MASK · BLOCK · 수 제한 · 차단 · 신고 · 운영 열람(사유) · 조치 닫기 · 보관 정리 — 시험 데이터는 replica 로 지움
  ③ (화면) 회원 › 회원 대화 신고 · 사용자 웹 나의공간 › 회원 대화
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


def mk_member(tag):
    """시험 회원(본인인증 · MEMBER) — 이메일에 시각을 넣어 두 번 돌아도 새 사람"""
    em, aid = mk_staff(tag, 'MEMBER')
    import consent_ok
    consent_ok.agree(em, PW)
    return em, aid, login(em)


M73 = migr('D273_')
stamp = int(time.time()) % 1000000
MB = {k: rd(f'src/modules/mbx/{k}.ts') for k in ('common', 'recent', 'compare', 'price', 'dm', 'jobs', 'mbx.controller')}
MN, AP, WC, SC = rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('src/worker/worker.controller.ts'), rd('src/worker/scheduler.service.ts')
KO = json.loads(rd('site/src/i18n/messages/ko/mbx.json') or '{}')
EN = json.loads(rd('site/src/i18n/messages/en/mbx.json') or '{}')

NJ = json.loads(rd('spec/notifications.json') or '{}'); ev = {e.get('code'): e for e in NJ.get('events', [])}
ok('① 코드 — D273 대화 · 글 · 신고 · 열람 기록 · 정리 기록 표 · 당사자 트리거(근거 DEAL · INQUIRY) · 글 고치기 · 지우기 막음(app.mbx_purge) · 신고 처리 뒤 고치지 않음 · 열람 기록 쌓기만 · 설정 mbx.dm off · 감지 MASK · 보관 365 · 알림 MBX_DM_NEW · 감지(전화 · 메일 · 계좌 · 플랫폼 밖) · 열람 사유 + 개인정보 접속기록 · 응답 감사 없음 · 메뉴 mbx-dm · 화면 MYP-MBX-040 · 050 · ADM-MBX-020 · 사전 room · 문서 642(처리방침 고칠 곳 · 법무) · 판 v10.504',
   'CREATE TABLE IF NOT EXISTS public.mbx_dm_threads' in M73 and 'CREATE TABLE IF NOT EXISTS public.mbx_dm_messages' in M73 and 'CREATE TABLE IF NOT EXISTS public.mbx_dm_reports' in M73
   and 'trg_mbx_dm_thread_guard' in M73 and 'trg_mbx_dm_msg_guard' in M73 and "current_setting('app.mbx_purge', true)" in M73 and 'trg_mbx_dm_report_guard' in M73
   and 'trg_mbx_dm_admin_views_ro' in M73 and "('mbx.dm', 'off'" in M73 and "('mbx.dm_pattern_mode', 'MASK'" in M73 and "('mbx.dm_retention_days', '365'" in M73
   and "('MBX_DM_NEW', '회원 대화 새 글', true" in M73 and ev.get('MBX_DM_NEW', {}).get('optout') is True
   and all(c in MB['dm'] for c in ("'PHONE'", "'EMAIL'", "'ACCOUNT'", "OFF_PLATFORM")) and 'audit.pii_access_logs' in MB['dm'] and 'mbx_dm_admin_views' in MB['dm']
   and "@Post('dm/reports/:id/open')" in MB['mbx.controller'] and "@Audit('MBX_DM_OPEN_REPORTED'" not in MB['mbx.controller']
   and "['mbx-dm', '회원 대화 신고']" in MN and "{tab === 'mbx-dm' && <MbxDmReports />}" in AP
   and all(f'"{x}"' in SJ for x in ('SB-MYP-MBX-040', 'SB-MYP-MBX-050', 'SB-ADM-MBX-020'))
   and 'warnMask' in (KO.get('room') or {}) and 'warnMask' in (EN.get('room') or {}) and '처리방침 고칠 곳' in doc('642_') and '법무' in doc('642_') and VT >= (10, 504), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    ea, A, TA = mk_member('1504a')
    eb, B, TB = mk_member('1504b')
    ec, Cc, TC = mk_member('1504c')
    ad = mk_staff('1504d', 'ADMIN'); consent_ok.agree(ad[0], PW); TD = login(ad[0])
    keys = ('mbx.dm', 'mbx.dm_pattern_mode', 'mbx.dm_rate_per_min', 'mbx.dm_retention_days')
    old = {k: getset(k) for k in keys}
    convs, threads = [], []
    try:
        lid = psql("SELECT id FROM listings WHERE status = 'PUBLISHED' ORDER BY published_at DESC NULLS LAST, id LIMIT 1")
        conv = psql(f"INSERT INTO conversations (target_type, target_id, initiator_id, counterpart_id) VALUES ('LISTING', '{lid}', '{A}', '{B}') RETURNING id").split('\n')[0]
        conv2 = psql(f"INSERT INTO conversations (target_type, target_id, initiator_id, counterpart_id) VALUES ('LISTING', '{lid}', '{Cc}', '{A}') RETURNING id").split('\n')[0]
        convs += [conv, conv2]
        setting('mbx.dm', 'off', '1504'); setting('mbx.dm_pattern_mode', 'MASK', '1504'); setting('mbx.dm_rate_per_min', '10', '1504')
        off = call('POST', '/me/dm', {'basisType': 'INQUIRY', 'basisId': conv, 'side': 'COUNTERPART'}, TA)
        setting('mbx.dm', 'on', '1504')
        o1 = call('POST', '/me/dm', {'basisType': 'INQUIRY', 'basisId': conv, 'side': 'COUNTERPART'}, TA)
        tid = o1.get('id') or ''; threads.append(tid)
        o2 = call('POST', '/me/dm', {'basisType': 'INQUIRY', 'basisId': conv, 'side': 'INITIATOR'}, TB)
        oc = call('POST', '/me/dm', {'basisType': 'INQUIRY', 'basisId': conv, 'side': 'COUNTERPART'}, TC)
        selfs = call('POST', '/me/dm', {'basisType': 'INQUIRY', 'basisId': conv, 'side': 'INITIATOR'}, TA)
        gc = call('GET', f'/me/dm/{tid}', None, TC)
        lo, hi = sorted([A, Cc])
        dbg = psql(f"INSERT INTO mbx_dm_threads (basis_type, basis_id, a_id, b_id, created_by) VALUES ('INQUIRY', '{conv}', '{lo}', '{hi}', '{A}')")
        pt = call('GET', '/me/dm/partners', None, TA)
        ptxt = json.dumps(pt, ensure_ascii=False)
        s1 = call('POST', f'/me/dm/{tid}/messages', {'body': f'시험 1504 안녕하세요-{stamp}'}, TA)
        s2 = call('POST', f'/me/dm/{tid}/messages', {'body': '시험 1504 두 번째'}, TA)
        nb = psql(f"SELECT count(*) || '|' || coalesce(max(link_url), '') FROM notifications WHERE account_id = '{B}' AND event_code = 'MBX_DM_NEW'")
        db_ = call('GET', f'/me/dm/{tid}', None, TB)
        rd_ = psql(f"SELECT count(*) FROM mbx_dm_messages WHERE thread_id = '{tid}' AND sender_id = '{A}' AND read_at IS NOT NULL")
        w1 = call('POST', f'/me/dm/{tid}/messages', {'body': '시험 1504 010-1234-5678 로 연락 주세요'}, TA)
        w2 = call('POST', f'/me/dm/{tid}/messages', {'body': '시험 1504 010-1234-5678 로 연락 주세요', 'confirm': True}, TA)
        mk = psql(f"SELECT masked::text || '|' || (body LIKE '%1234-5678%')::text || '|' || array_to_string(hit_codes, ',') FROM mbx_dm_messages WHERE id = {int(w2.get('id') or 0)}")
        setting('mbx.dm_pattern_mode', 'WARN', '1504')
        w3 = call('POST', f'/me/dm/{tid}/messages', {'body': '시험 1504 메일 t1504@example.com', 'confirm': True}, TA)
        raw = psql(f"SELECT masked::text || '|' || (body LIKE '%t1504@example.com%')::text FROM mbx_dm_messages WHERE id = {int(w3.get('id') or 0)}")
        setting('mbx.dm_pattern_mode', 'BLOCK', '1504')
        w4 = call('POST', f'/me/dm/{tid}/messages', {'body': '시험 1504 국민은행 123456-12-123456', 'confirm': True}, TA)
        w5 = call('POST', f'/me/dm/{tid}/messages', {'body': '시험 1504 카톡으로 직거래 해요', 'confirm': True}, TA)
        setting('mbx.dm_pattern_mode', 'MASK', '1504')
        ck = call('POST', '/me/dm/check', {'body': '국민은행 123456-12-123456 로 직접 입금'}, TA)
        ckc = sorted(r.get('code') for r in ck.get('reasons') or [])
        up = psql(f"UPDATE mbx_dm_messages SET body = '바꿈' WHERE thread_id = '{tid}'")
        dl = psql(f"DELETE FROM mbx_dm_messages WHERE thread_id = '{tid}'")
        setting('mbx.dm_rate_per_min', '1', '1504')
        rt = call('POST', f'/me/dm/{tid}/messages', {'body': '시험 1504 빨리'}, TA)
        setting('mbx.dm_rate_per_min', '10', '1504')
        bk = call('POST', f'/me/dm/{tid}/block', {'on': True}, TB)
        sb = call('POST', f'/me/dm/{tid}/messages', {'body': '시험 1504 차단 뒤'}, TA)
        ub = call('POST', f'/me/dm/{tid}/block', {'on': False}, TA)
        ub2 = call('POST', f'/me/dm/{tid}/block', {'on': False}, TB)
        r0 = call('POST', f'/me/dm/{tid}/report', {'reason': 'OTHER'}, TA)
        r1 = call('POST', f'/me/dm/{tid}/report', {'reason': 'OFF_PLATFORM', 'detail': '시험 1504 계좌로 보내라 함'}, TA)
        rid = str(r1.get('id') or '')
        r2 = call('POST', f'/me/dm/{tid}/report', {'reason': 'FRAUD'}, TA)
        rc = call('POST', f'/me/dm/{tid}/report', {'reason': 'FRAUD'}, TC)
        al = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'MBX_DM_REPORT' AND detail->>'reportId' = '{rid}' AND resolved_at IS NULL")
        am = call('GET', '/admin/mbx/dm/reports', None, TA)
        ar = call('GET', '/admin/mbx/dm/reports?state=OPEN', None, TS)
        arow = next((x for x in ar.get('items') or [] if x.get('id') == rid), {})
        artxt = json.dumps(arow, ensure_ascii=False)
        v0 = call('POST', f'/admin/mbx/dm/reports/{rid}/open', {'reason': 'x'}, TS)
        v404 = call('POST', '/admin/mbx/dm/reports/999999999999/open', {'reason': '시험 1504 없는 신고'}, TS)
        v1 = call('POST', f'/admin/mbx/dm/reports/{rid}/open', {'reason': '시험 1504 신고 처리 — 직접 입금 유도 확인'}, TS)
        vw = psql(f"SELECT count(*) FROM mbx_dm_admin_views WHERE report_id = {int(rid or 0)}")
        pii = psql(f"SELECT count(*) FROM audit.pii_access_logs WHERE target_account_id = '{B}' AND reason LIKE '회원 대화 신고 열람(신고 {rid})%'")
        aud = psql(f"SELECT count(*) FROM audit.audit_logs WHERE after_data::text LIKE '%시험 1504 안녕하세요-{stamp}%'")
        vro = psql(f"DELETE FROM mbx_dm_admin_views WHERE report_id = {int(rid or 0)}")
        dc = call('POST', f'/admin/mbx/dm/reports/{rid}/decide', {'result': 'UPHELD', 'note': '시험 1504 직접 입금 유도 — 대화 닫음', 'lock': True}, TS)
        dc2 = call('POST', f'/admin/mbx/dm/reports/{rid}/decide', {'result': 'DISMISSED', 'note': '시험 1504 다시'}, TS)
        lk = call('POST', f'/me/dm/{tid}/messages', {'body': '시험 1504 닫힌 뒤'}, TB)
        al2 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'MBX_DM_REPORT' AND detail->>'reportId' = '{rid}' AND resolved_at IS NULL")
        ru = psql(f"UPDATE mbx_dm_reports SET decide_note = '바꿈' WHERE id = {int(rid or 0)}")
        ps0 = call('PUT', '/admin/mbx/settings', {'dm': True, 'reason': '시험 1504 운영 관리자'}, TD)
        ps1 = call('PUT', '/admin/mbx/settings', {'retentionDays': 10, 'reason': '시험 1504'}, TS)
        ok('② 회원 대화 — 꺼짐 422 · 문의 근거로 열기 · 상대가 열어도 같은 대화 · 남 403 · 나와는 422 · 남 읽기 403 · DB 가 남 막음 · 상대 목록(계정 번호 없음) · 보내기 · 새 글 알림 30분 묶음 1 · 읽음 · 전화 경고 422 → 가려 저장(PHONE) · WARN 그대로 · BLOCK 계좌 422 · 플랫폼 밖 표현은 BLOCK 이어도 확인 뒤 보냄 · 확인 API(계좌 · 플랫폼 밖) · DB 고치기 · 지우기 막음 · 분당 422',
           off.get('code') == 'MBX_OFF' and o1.get('created') is True and o2.get('id') == tid and o2.get('created') is False and oc.get('_err') == 403 and selfs.get('code') == 'MBX_DM_SELF'
           and gc.get('_err') == 403 and 'MBX_DM' in dbg and '!' in dbg and any(x.get('basisId') == conv and x.get('threadId') == tid for x in pt.get('items') or []) and B not in ptxt
           and s1.get('mine') is True and s2.get('mine') is True and nb == f'1|/my/messages/{tid}' and len(db_.get('messages') or []) == 2 and rd_ == '2'
           and w1.get('code') == 'MBX_DM_WARN' and w2.get('masked') is True and mk.startswith('true|false|') and 'PHONE' in mk
           and w3.get('masked') is False and raw == 'false|true' and w4.get('code') == 'MBX_DM_BLOCKED' and w5.get('mine') is True
           and ckc == ['ACCOUNT', 'OFF_PLATFORM'] and ck.get('warn') is True and 'MBX_DM' in up and 'MBX_DM' in dl and rt.get('code') == 'MBX_DM_RATE',
           f"{off.get('code')} {o1.get('created')} {o2.get('created')} {oc.get('_err')} {selfs.get('code')} {gc.get('_err')} db[{dbg[-30:]}] 계정번호 {B in ptxt} · {s1.get('mine')} {s2.get('mine')} 알림 {nb[:4]} 읽음 {len(db_.get('messages') or [])} {rd_} · "
           f"{w1.get('code')} {w2.get('masked')} {mk} · {w3.get('masked')} {raw} · {w4.get('code')} {w5.get('mine') or w5.get('code')} · {ckc} · {up[-20:]} {dl[-20:]} · {rt.get('code')}")
        ok('② 차단 · 신고 · 운영 열람 — 차단 뒤 보내기 409 · 남이 풀기 409 · 차단한 사람 풂 · 그 밖 422 · 신고 · 다시 409 · 남 신고 403 · 운영 알림 1 · 회원 403 · 목록(글 없음 · 김OO) · 사유 짧음 400 · 없는 신고 404 · 열람(글 · 기록 1 · 개인정보 접속기록 1 · 감사 기록에 글 없음) · 열람 기록 지우기 막음 · 조치 닫기 · 다시 처리 409 · 닫힌 대화 409 · 알림 풀림 · 처리한 신고 DB 막음 · 설정 ADMIN 403 · 범위 400',
           bk.get('blocked') is True and sb.get('code') == 'MBX_DM_BLOCKED_BY' and ub.get('_err') == 409 and ub2.get('blocked') is False
           and r0.get('code') == 'MBX_DM_REASON' and r1.get('ok') is True and r2.get('code') == 'MBX_DM_REPORTED' and rc.get('_err') == 403 and al == '1'
           and am.get('_err') == 403 and arow.get('reasonLabel') and arow.get('reported', '').endswith('OO') and '안녕하세요' not in artxt
           and v0.get('_err') == 400 and v404.get('_err') == 404 and len(v1.get('messages') or []) >= 4 and vw == '1' and pii == '1' and aud == '0' and '!' in vro
           and dc.get('locked') is True and dc2.get('code') == 'MBX_DECIDED' and lk.get('code') == 'MBX_DM_LOCKED' and al2 == '0' and 'MBX_DM' in ru
           and ps0.get('_err') == 403 and ps1.get('_err') == 400,
           f"{bk.get('blocked')} {sb.get('code')} {ub.get('_err')} {ub2.get('blocked')} · {r0.get('code')} {r1.get('ok')} {r2.get('code')} {rc.get('_err')} 알림 {al} · {am.get('_err')} {arow.get('reasonLabel')} {arow.get('reported')} · "
           f"{v0.get('_err')} {v404.get('_err')} 글 {len(v1.get('messages') or [])} 기록 {vw} 접속 {pii} 감사 {aud} {vro[-20:]} · {dc.get('locked')} {dc2.get('code')} {lk.get('code')} {al2} {ru[-20:]} · {ps0.get('_err')} {ps1.get('_err')}")
        # 보관 정리 — 신고 없는 두 번째 대화(C · A)의 오래된 글 · 빈 대화는 지우고, 처리한 지 얼마 안 된 신고 대화는 남김
        o3 = call('POST', '/me/dm', {'basisType': 'INQUIRY', 'basisId': conv2, 'side': 'INITIATOR'}, TA)
        t2 = o3.get('id') or ''; threads.append(t2)
        call('POST', f'/me/dm/{t2}/messages', {'body': '시험 1504 오래된 글'}, TA)
        psql(f"SET session_replication_role = replica; UPDATE mbx_dm_messages SET created_at = now() - interval '400 days' WHERE thread_id IN ('{t2}', '{tid}'); "
             f"UPDATE mbx_dm_threads SET last_message_at = now() - interval '400 days', created_at = now() - interval '400 days' WHERE id IN ('{t2}', '{tid}');")
        before = int(psql('SELECT count(*) FROM mbx_purges') or 0)
        jb = call('POST', '/admin/jobs', {'job': 'mbx_daily'}, TS)
        left2 = psql(f"SELECT (SELECT count(*) FROM mbx_dm_messages WHERE thread_id = '{t2}') || '|' || (SELECT count(*) FROM mbx_dm_threads WHERE id = '{t2}')")
        left1 = psql(f"SELECT count(*) FROM mbx_dm_messages WHERE thread_id = '{tid}'")
        after = int(psql('SELECT count(*) FROM mbx_purges') or 0)
        ok('② 보관 정리 — 신고 없는 오래된 글 · 빈 대화 지움 · 처리한 지 180일 안 신고 대화는 남김 · 정리 기록 +1',
           not jb.get('_err') and left2 == '0|0' and int(left1 or 0) >= 4 and after == before + 1, f"{jb.get('_err') or 'ok'} {left2} {left1} {before}→{after}")
    finally:
        ids = ','.join(f"'{x}'" for x in threads if x)
        if ids:
            psql(f"SET session_replication_role = replica; DELETE FROM mbx_dm_admin_views WHERE thread_id IN ({ids}); "
                 f"DELETE FROM ops_alerts WHERE alert_code = 'MBX_DM_REPORT' AND detail->>'reportId' IN (SELECT id::text FROM mbx_dm_reports WHERE thread_id IN ({ids})); "
                 f"DELETE FROM mbx_dm_reports WHERE thread_id IN ({ids}); DELETE FROM mbx_dm_messages WHERE thread_id IN ({ids}); DELETE FROM mbx_dm_threads WHERE id IN ({ids});")
        psql(f"SET session_replication_role = replica; DELETE FROM mbx_dm_threads WHERE a_id IN ('{A}', '{B}', '{Cc}') OR b_id IN ('{A}', '{B}', '{Cc}');")
        psql(f"SET session_replication_role = replica; DELETE FROM audit.pii_access_logs WHERE target_account_id = '{B}' AND reason LIKE '회원 대화 신고 열람%'; "
             f"DELETE FROM notifications WHERE account_id IN ('{A}', '{B}', '{Cc}') AND event_code = 'MBX_DM_NEW';")
        cids = ','.join(f"'{x}'" for x in convs if x)
        if cids:
            psql(f"DELETE FROM conversations WHERE id IN ({cids})")
        for k, v in old.items():
            setting(k, v, '1504 되돌림')
        for x, tag in ((A, '1504a'), (B, '1504b'), (Cc, '1504c'), (ad[1], '1504d')):
            rm_role(x, tag)
    if ADMIN_WEB:
        r = admin_page('/#/mbx-dm', lambda pg, seen: seen.update(n=pg.locator('[data-mbx-dm-reports]').count(), tabs=pg.locator('[data-mbx-dm-tab]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 회원 › 회원 대화 신고(상태 단추 4 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('tabs') == 4 and not perr, f"{seen} {perr[:2]}")
    if SITE:
        def run(b, seen, perr):
            ps = site_login(b, perr, 'buyer@x.com')
            ps.goto(SITE + '/my/messages', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1500)
            seen['scr'] = ps.locator('[data-screen="SB-MYP-MBX-040"]').count()
        r = ui(run)
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 사용자 웹 나의공간 › 회원 대화', seen.get('scr') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
