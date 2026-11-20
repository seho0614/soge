"""v10.526 (D279 · docs/664) ㊾ 매물 2 ③ 매물 동영상(짧은 영상 1개 · 검수 뒤 공개)
  ① (코드) 파일 용도 LISTING_VIDEO(ck_files_purpose = D269 목록 + 1 · MP4 50MB · fn_file_can_read 그대로) · 길이는 MP4 머리 · 살아 있는 영상 1개 · 공개 조건 · 붙은 파일 지움 막음 · 회원 화면 · 사전
  ② (DB · API) 기존 파일 올리기 길로 MP4 3개(5초 · 99초 · 머리 없음) · 꺼짐 422 · 붙이기 · 409 · 422 TOO_LONG · UNREADABLE · FILE · 검수 · 공개 주소 · 파일 지움 422 · 빼기 — 영상 줄 지움 · 올린 파일은 replica 로 DELETED
  ③ (화면) 검수 › 매물 동영상
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

import hashlib, struct
VD, FD, FS = LSY['video'], rd('src/modules/file/file.dto.ts'), rd('src/modules/file/file.service.ts')
D269_PURPOSES = ['OWNERSHIP_DOC', 'MARKETING_MATERIAL', 'PARTNER_GUIDE', 'PRODUCT_IMAGE', 'PARTNER_MEDIA', 'LISTING_IMAGE', 'REQUEST_IMAGE', 'INQUIRY_ATTACHMENT',
                 'BROKER_DOC', 'NOTICE_ATTACHMENT', 'ACCT_EVIDENCE', 'CORP_DOC', 'HR_DOC', 'LGL_DOC']
CK = (re.search(r'ADD CONSTRAINT ck_files_purpose(.*?);', M79, re.S) or [None, ''])[1] if re.search(r'ADD CONSTRAINT ck_files_purpose', M79) else ''
KO, EN = rd('site/src/i18n/messages/ko/lsy.json'), rd('site/src/i18n/messages/en/lsy.json')
try:
    KJ, EJ = json.loads(KO or '{}'), json.loads(EN or '{}')
except Exception:
    KJ, EJ = {}, {}

ok('① 파일 용도 LISTING_VIDEO — ck_files_purpose 는 D269 목록 그대로 + LISTING_VIDEO · MP4 50MB · 서버 목록 · 올리는 사람(회원) · fn_file_can_read 는 다시 쓰지 않음',
   all(f"'{p}'" in CK for p in D269_PURPOSES) and "'LISTING_VIDEO'" in CK and "('LISTING_VIDEO', 'video/mp4', 52428800, 'mp4')" in M79
   and "'LGL_DOC', 'LISTING_VIDEO'] as const;" in FD and "LISTING_VIDEO: ['MEMBER', 'BIZ_OWNER', 'BIZ_STAFF']," in FS
   and 'FUNCTION public.fn_file_can_read' not in M79, '')
ok('① 서버 — 길이는 MP4 머리(moov › mvhd)로 · 보낸 값 안 믿음 · 매물마다 살아 있는 영상 1개 · 승인한 것만 · 게시 중 · 스위치 · 5분 주소 · 붙은 파일 지움 막음',
   "find((b) => b.type === 'moov')" in VD and "find((b) => b.type === 'mvhd')" in VD and 'meta.durationMs > s.videoMaxSec * 1000' in VD
   and "uq_lsy_video_live ON public.lsy_listing_videos (listing_id) WHERE state IN ('PENDING', 'APPROVED')" in M79
   and "v.state = 'APPROVED' AND l.status = 'PUBLISHED' AND f.status = 'READY'" in VD and 'if (!s.video) return { video: null };' in VD and ', 300);' in VD
   and 'trg_lsy_video_file_guard' in M79 and 'trg_lsy_video_guard' in M79, '')
ok('① 회원 화면 — 상세에 승인한 동영상 · 나의공간 동영상 · 사진 점검 · 사전 ko · en 열쇠 같음(값은 글자만) · 연결(화면 목록 · 문서 664 · 판 v10.526)',
   '<ListingVideo listingId={item.id} />' in rd('site/src/app/[gwan]/[id]/page.tsx') and re.search(r'mbx, lsx, lsy\b[^}]*};', rd('site/src/i18n/messages/index.ts'))
   and bool(KJ) and set(KJ) == set(EJ) and all(isinstance(v, str) for v in list(KJ.values()) + list(EJ.values()))
   and rd('site/src/app/my/listing-video/page.tsx') and '"SB-MYP-LSY-010"' in SJ and '"GET /site/lsy/listings/{id}/video"' in SJ
   and '"SB-ADM-LSY-030"' in SJ and doc('664_') and VT >= (10, 526), VER)


def box(t, payload):
    return struct.pack('>I', 8 + len(payload)) + t + payload


def mp4(dur_ms, moov=True):
    """시험용 작은 MP4 — ftyp(isom) · moov(mvhd 길이 · trak/tkhd 640 × 360) · mdat"""
    ftyp = box(b'ftyp', b'isom' + struct.pack('>I', 512) + b'isomiso2mp41')
    mvhd = box(b'mvhd', bytes(4) + struct.pack('>IIII', 0, 0, 1000, dur_ms) + bytes(80))
    tkhd = box(b'tkhd', bytes(4) + struct.pack('>IIIII', 0, 0, 1, 0, dur_ms) + bytes(8) + bytes(8) + bytes(36) + struct.pack('>II', 640 << 16, 360 << 16))
    moovb = box(b'moov', mvhd + box(b'trak', tkhd))
    return ftyp + (moovb if moov else b'') + box(b'mdat', bytes(2048 + dur_ms % 97))


def upload_mp4(tok, data, name):
    r = call('POST', '/files', {'purpose': 'LISTING_VIDEO', 'name': name, 'contentType': 'video/mp4', 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}, tok)
    if not r.get('fileId'):
        return None, r
    url = r.get('uploadUrl') or ''
    if url.startswith('/'):
        url = re.sub(r'/api/v1/?$', '', API) + url
    hd = dict(r.get('headers') or {})
    hd.setdefault('Content-Type', 'video/mp4')
    try:
        urllib.request.urlopen(urllib.request.Request(url, data=data, headers=hd, method=r.get('method') or 'PUT'), timeout=60).read()
    except Exception as ex:
        return r['fileId'], {'_err': getattr(ex, 'code', 0)}
    return r['fileId'], call('POST', f"/files/{r['fileId']}/complete", {}, tok)


if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    before = {k: getset(k) for k in ('lsy.video', 'lsy.video_max_sec', 'lsy.video_max_mb')}
    v0 = first(psql("SELECT coalesce(max(id), 0) FROM lsy_listing_videos")) or '0'
    v0 = int(v0) if v0.isdigit() else 0
    lid, oem, oid = pick_listing("AND NOT EXISTS (SELECT 1 FROM lsy_listing_videos v WHERE v.listing_id = l.id AND v.state IN ('PENDING', 'APPROVED'))")
    fids = []
    try:
        if not lid:
            print('  (시드 회원의 게시 매물이 없음 — ② 건너뜀)')
        else:
            setting('lsy.video', 'off', '1526'); setting('lsy.video_max_sec', '60', '1526'); setting('lsy.video_max_mb', '30', '1526')
            consent_ok.agree(oem, PW)
            TO = login(oem)
            f1, c1 = upload_mp4(TO, mp4(5000), f't1526_{stamp}_a.mp4')
            f2, c2 = upload_mp4(TO, mp4(99000), f't1526_{stamp}_b.mp4')
            f3, c3 = upload_mp4(TO, mp4(4000, moov=False), f't1526_{stamp}_c.mp4')
            fids = [x for x in (f1, f2, f3) if x]
            off = call('POST', f'/me/lsy/listings/{lid}/video', {'fileId': f1}, TO)
            setting('lsy.video', 'on', '1526')
            pub0 = call('GET', f'/site/lsy/listings/{lid}/video', None)
            att = call('POST', f'/me/lsy/listings/{lid}/video', {'fileId': f1}, TO)
            same = call('POST', f'/me/lsy/listings/{lid}/video', {'fileId': f1}, TO)
            long_ = call('POST', f'/me/lsy/listings/{lid}/video', {'fileId': f2}, TO)
            unread = call('POST', f'/me/lsy/listings/{lid}/video', {'fileId': f3}, TO)
            bogus = call('POST', f'/me/lsy/listings/{lid}/video', {'fileId': '00000000-0000-4000-8000-000000000000'}, TO)
            mine = call('GET', '/me/lsy/videos', None, TO)
            pub_pending = call('GET', f'/site/lsy/listings/{lid}/video', None)
            ok('② 붙이기 — 스위치 꺼짐 422 LSY_VIDEO_OFF · 꺼짐이면 공개 없음 · 5초 영상 붙임(서버가 잰 길이 5) · 같은 영상 409 · 99초 422 TOO_LONG · 머리 없음 422 UNREADABLE · 남의 · 없는 파일 422 · 확인 전 공개 없음',
               c1.get('status') == 'READY' and off.get('code') == 'LSY_VIDEO_OFF' and pub0.get('video') is None and att.get('state') == 'PENDING'
               and abs(float(att.get('durationSec') or 0) - 5.0) < 0.01 and same.get('code') == 'LSY_VIDEO_SAME' and long_.get('code') == 'LSY_VIDEO_TOO_LONG'
               and unread.get('code') == 'LSY_VIDEO_UNREADABLE' and bogus.get('code') == 'LSY_VIDEO_FILE' and pub_pending.get('video') is None
               and any(x.get('id') == lid and x.get('videoState') == 'PENDING' for x in mine.get('items') or []),
               f"{c1.get('status')} {off.get('code')} {att} {same.get('code')} {long_.get('code')} {unread.get('code')} {bogus.get('code')}")
            vid = att.get('id')
            lst = call('GET', '/admin/lsy/videos?state=PENDING', None, TS)
            rej_short = call('POST', f'/admin/lsy/videos/{vid}/decide', {'approve': False, 'reason': 'x'}, TS)
            okd = call('POST', f'/admin/lsy/videos/{vid}/decide', {'approve': True}, TS)
            again = call('POST', f'/admin/lsy/videos/{vid}/decide', {'approve': False, 'reason': '시험 1526 다시'}, TS)
            pub = call('GET', f'/site/lsy/listings/{lid}/video', None)
            del_file = call('DELETE', f'/files/{f1}', None, TO)
            rm = call('DELETE', f'/me/lsy/listings/{lid}/video', None, TO)
            rm2 = call('DELETE', f'/me/lsy/listings/{lid}/video', None, TO)
            pub_after = call('GET', f'/site/lsy/listings/{lid}/video', None)
            revive = psql(f"UPDATE lsy_listing_videos SET state = 'APPROVED' WHERE id = {int(vid or 0)}")
            ok('② 검수 · 공개 — 운영 대기 목록 · 짧은 반려 사유 422 · 승인 · 다시 결정 409 · 승인 뒤 공개 주소(5분) · 붙은 파일 지우기 422 LSY_VIDEO_IN_USE · 빼기 · 두 번째 404 · 뺀 뒤 공개 없음 · 끝난 줄 되살림 DB 가 막음',
               any(str(r.get('id')) == str(vid) for r in lst.get('rows') or []) and rej_short.get('code') == 'LSY_REASON' and okd.get('state') == 'APPROVED'
               and again.get('code') == 'LSY_VIDEO_STATE' and bool((pub.get('video') or {}).get('url')) and del_file.get('code') == 'LSY_VIDEO_IN_USE'
               and rm.get('ok') is True and rm2.get('_err') == 404 and pub_after.get('video') is None and 'LSY_VIDEO_STATE' in revive,
               f"{rej_short.get('code')} {okd.get('state')} {again.get('code')} {str(pub)[:80]} {del_file.get('code')} {rm2.get('_err')} {revive[-40:]}")
    finally:
        for k, v in before.items():
            setting(k, v or None, '1526 되돌림')
        if lid:
            psql(f"DELETE FROM lsy_listing_videos WHERE id > {v0} AND listing_id = '{lid}';")
        if fids:
            ids = ','.join(f"'{x}'" for x in fids)
            psql(f"BEGIN; SET LOCAL session_replication_role = replica; UPDATE files SET status = 'DELETED' WHERE id IN ({ids}); COMMIT;")
    if ADMIN_WEB:
        r = admin_page('/#/lsy-videos', lambda pg, seen: seen.update(n=pg.locator('[data-lsy-videos]').count(), st=pg.locator('[data-lsy-video-state]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 검수 › 매물 동영상(상태 단추 5 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('st') == 5 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
