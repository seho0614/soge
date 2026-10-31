"""v10.164 시험 — 소개광장 동네 인증(GPS 1회 → 행정동만 · 꺼진 채로 · D154 · docs/253)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e SITE=http://localhost:15174 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1164.py

  ① 코드 — D154(좌표 칸 없음 · 이용 기록 수정 금지 · 설정 off · LOCATION 2.0 초안 〔…〕 · 지우는 문장 없음 · 192) · 서버(카카오 좌표 → 행정동 · 감사에 본문 안 남김 ·
     동의 · 꺼짐 · 키 확인 · authorTown) · 사용자 웹(상자 · 배지 · 사전 ko · en) · 명세 · 영어 · docs/253 · 판
  ② (API · DB) 꺼짐 422 TOWN_VERIFY_OFF · 설정은 SUPER 만(ADMIN 403 TOWN_SETTING_SUPER) · 켬 + 약관 미게시 422 TOWN_CONSENT_REQUIRED · 범위 밖 좌표 400 ·
     인증 줄 → /me/town · 소개광장 목록 authorTown(행정동 끝 낱말) · 만료되면 사라짐 · 지우기 · 이용 기록 수정 금지 · 표에 좌표 칸 없음 · 되돌림
  ③ (사용자 웹) 꺼짐이면 「동네 인증」 상자 없음 · 켜면 상자
"""
import json, os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); SITE = os.environ.get('SITE')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(d for d in os.listdir(MD) if os.path.isdir(os.path.join(MD, d)))
M = rd('prisma/migrations/D154_town_verify/migration.sql')
tables = re.findall(r'CREATE TABLE IF NOT EXISTS public\.(member_towns|town_verify_logs) \((.*?)\n\);', M, re.S)
ok('① D154 — member_towns · town_verify_logs 에 좌표 칸 없음 · 이용 기록 수정 · 삭제 금지 · v_member_town_current · 설정 off · LOCATION 2.0 초안(〔…〕) · 지우는 문장 없음 · 192',
   len(tables) == 2 and not any(re.search(r'\b(lat|lng|latitude|longitude|geom|coord|x|y)\b', body) for _, body in tables)
   and 'CREATE TRIGGER trg_town_log_ro BEFORE DELETE OR UPDATE ON public.town_verify_logs' in M and 'CREATE OR REPLACE VIEW public.v_member_town_current' in M
   and "('community.town_verify', 'off'," in M and "'LOCATION', '2.0'" in M and "'DRAFT'" in M and '〔보관 기간〕' in M
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|DROP FUNCTION|TRUNCATE)\b', M) and (len(mig), mig[-1]) in ((192, 'D154_town_verify'),), f'{len(mig)} · {mig[-1]} · 표 {len(tables)}')
KP = rd('src/common/geo/kakao-local.provider.ts'); TS = rd('src/modules/community/town-verify.service.ts'); TC = rd('src/modules/community/town-verify.controller.ts')
CS = rd('src/modules/community/community.service.ts'); AM = rd('src/app.module.ts'); AD = rd('src/modules/admin/admin.service.ts')
ok('① 서버 — 좌표 → 행정동(H) · 꺼짐 · 동의(v_terms_current LOCATION) · 키 · 실패 기록 · 좌표 저장 안 함 · 감사(@Audit) 없음 · authorTown · 모듈 · 설정 SUPER',
   "export async function coordToRegion(" in KP and "'/v2/local/geo/coord2regioncode.json'" in KP and "d.region_type === 'H'" in KP
   and "'TOWN_VERIFY_OFF'" in TS and "'TOWN_CONSENT_REQUIRED'" in TS and "'TOWN_GEO_NOT_READY'" in TS and "'TOWN_NOT_FOUND'" in TS
   and "WHERE t.code = 'LOCATION'" in TS and 'INSERT INTO town_verify_logs' in TS and not re.search(r'\b(lat|lng)\b[^\n]*INSERT', TS)
   and '@Audit' not in TC and "@Post('me/town/verify')" in TC and "@Delete('me/town')" in TC and "@Get('community/town/config')" in TC
   and CS.count('AS "authorTown"') == 3 and 'TownVerifyController' in AM and 'TownVerifyService' in AM and "'TOWN_SETTING_SUPER'" in AD, '')
TV = rd('site/src/components/community/TownVerify.tsx'); CP = rd('site/src/app/community/page.tsx'); DP = rd('site/src/app/community/[id]/page.tsx')
ko = json.loads(rd('site/src/i18n/messages/ko/plaza.json') or '{}').get('town', {}); en = json.loads(rd('site/src/i18n/messages/en/plaza.json') or '{}').get('town', {})
SPEC = json.load(open(os.path.join(K, 'spec/screens.json'), encoding='utf-8')).get('screens') or {}
scr = {x.get('id'): x for x in SPEC} if isinstance(SPEC, list) else SPEC
apis = (scr.get('SB-HOM-CMU-010') or {}).get('apis', [])
EN = rd('src/common/i18n/server-text.en.ts')
ok('① 사용자 웹 — 상자(꺼지면 안 그림 · 위치 한 번 · 약관 안내) · 배지(목록 · 글) · 사전 ko · en 같은 칸 · 명세 4개 · 영어 6개 · docs/253 · 판 v10.164 이상',
   "fetch('/api/v1/community/town/config')" in TV and 'if (!on) return null;' in TV and 'getCurrentPosition' in TV and 'data-town-verify' in TV and 'data-town-badge' in TV
   and '<TownVerify loggedIn=' in CP and '<TownBadge town={p.authorTown} />' in CP and '<TownBadge town={d.authorTown} />' in DP
   and ko and set(ko) == set(en) and all(a in apis for a in ('GET /community/town/config', 'GET /me/town', 'POST /me/town/verify', 'DELETE /me/town'))
   and '"동네 인증이 아직 열리지 않았습니다.":' in EN and '"동네 인증 설정은 최고 관리자(SUPER)만 바꿀 수 있습니다.":' in EN
   and any(f.startswith('253_') for f in os.listdir(os.path.join(K, 'docs'))) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 164), rd('VERSION').strip())


# ── ② API ─────────────────────────────────────────────────────────────
def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m)
    try:
        raw = urllib.request.urlopen(r, timeout=60).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b'{}')
        except Exception:
            body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip()


MEM = 'seller@x.com'; ADM = 'buyer@x.com'; CODE10 = '1168064000'; NAME = '서울특별시 강남구 역삼1동'
setting = lambda: psql("SELECT value FROM site_settings WHERE key = 'community.town_verify'")
if API and DB:
    s0 = setting(); mid = psql(f"SELECT id FROM accounts WHERE email = '{MEM}'")
    post = psql("SELECT p.id || '|' || p.author_id FROM posts p WHERE p.state = 'PUBLISHED' AND p.board <> 'FOOD' AND p.author_id IS NOT NULL ORDER BY p.created_at DESC LIMIT 1")
    pid, pauth = (post.split('|') + [''])[:2]
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    TM = call('POST', '/auth/login', {'email': MEM, 'password': PW}).get('accessToken')
    psql(f"INSERT INTO account_roles(account_id, role) SELECT id, 'ADMIN' FROM accounts WHERE email = '{ADM}' ON CONFLICT DO NOTHING;")
    TA = call('POST', '/auth/login', {'email': ADM, 'password': PW}).get('accessToken')
    try:
        psql("UPDATE site_settings SET value = 'off' WHERE key = 'community.town_verify'")
        c0 = call('GET', '/community/town/config'); r0 = call('POST', '/me/town/verify', {'lat': 37.5, 'lng': 127.03}, TM)
        ok('② 처음 꺼짐 — config enabled=false · 인증 422 TOWN_VERIFY_OFF', c0.get('enabled') is False and c0.get('days') == 30 and r0.get('code') == 'TOWN_VERIFY_OFF', f"{c0} · {r0.get('code')}")
        ra = call('PATCH', '/admin/site-settings', {'key': 'community.town_verify', 'value': 'on'}, TA)
        rs = call('PATCH', '/admin/site-settings', {'key': 'community.town_verify', 'value': 'on'}, T_)
        ok('② 설정은 SUPER 만 — ADMIN 403 TOWN_SETTING_SUPER · SUPER 는 켬', ra.get('code') == 'TOWN_SETTING_SUPER' and setting() == 'on', f"{ra.get('code')} · {setting()}")
        r1 = call('POST', '/me/town/verify', {'lat': 37.5, 'lng': 127.03}, TM)
        r2 = call('POST', '/me/town/verify', {'lat': 51.5, 'lng': -0.12}, TM)
        loc = psql("SELECT count(*) FROM v_terms_current WHERE code = 'LOCATION'")
        ok('② 켬 + 위치기반 약관 미게시 → 422 TOWN_CONSENT_REQUIRED(카카오 부르지 않음) · 한국 밖 좌표 400 · 이용 기록 없음',
           loc == '0' and r1.get('code') == 'TOWN_CONSENT_REQUIRED' and r2.get('_err') == 400 and psql(f"SELECT count(*) FROM town_verify_logs WHERE account_id = '{mid}'") == '0',
           f"{r1.get('code')} · {r2.get('_err')} · LOCATION 지금 판 {loc}")
        psql(f"INSERT INTO member_towns (account_id, adm_code, adm_name, expires_at) VALUES ('{mid}', '{CODE10}', '{NAME}', now() + interval '30 days') ON CONFLICT (account_id) DO UPDATE SET expires_at = EXCLUDED.expires_at")
        if pauth and pauth != mid:
            psql(f"INSERT INTO member_towns (account_id, adm_code, adm_name, expires_at) VALUES ('{pauth}', '{CODE10}', '{NAME}', now() + interval '30 days') ON CONFLICT (account_id) DO UPDATE SET expires_at = EXCLUDED.expires_at")
        m1 = call('GET', '/me/town', t=TM)
        items = (call('GET', '/community/board?size=50') or {}).get('items', [])
        it = next((x for x in items if x.get('id') == pid), {})
        det = call('GET', f'/community/posts/{pid}') if pid else {}
        ok('② 인증 줄 → /me/town(행정동 · 만료일 · 약관 동의 false) · 목록 · 글의 authorTown = 「역삼1동」(시 · 구 없음)',
           (m1.get('town') or {}).get('admCode') == CODE10 and m1.get('consent') is False and m1.get('enabled') is True
           and (not pid or (it.get('authorTown') == '역삼1동' and det.get('authorTown') == '역삼1동')), f"{str(m1)[:90]} · {it.get('authorTown')} · {det.get('authorTown')}")
        psql(f"UPDATE member_towns SET expires_at = now() - interval '1 minute' WHERE account_id IN ('{mid}'{(", '" + pauth + "'") if pauth else ''})")
        m2 = call('GET', '/me/town', t=TM); it2 = next((x for x in (call('GET', '/community/board?size=50') or {}).get('items', []) if x.get('id') == pid), {})
        ok('② 만료(30일 지남) → /me/town 비고 · 배지 사라짐', m2.get('town') is None and (not pid or not it2.get('authorTown')), f"{m2.get('town')} · {it2.get('authorTown')}")
        psql(f"UPDATE member_towns SET expires_at = now() + interval '30 days' WHERE account_id = '{mid}'")
        d1 = call('DELETE', '/me/town', t=TM)
        ok('② 지우기 → removed 1 · 줄 없음', d1.get('removed') == 1 and psql(f"SELECT count(*) FROM member_towns WHERE account_id = '{mid}'") == '0', str(d1))
        psql(f"INSERT INTO town_verify_logs (account_id, adm_code, ok) VALUES ('{mid}', '{CODE10}', true)")
        u = subprocess.run(['psql', DB, '-X', '-q', '-At', '-c', f"UPDATE town_verify_logs SET adm_code = '0000000000' WHERE account_id = '{mid}'"], capture_output=True, text=True)
        cols = psql("SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_name IN ('member_towns', 'town_verify_logs')")
        ok('② 이용 기록은 수정 불가 · 두 표에 좌표 칸 없음', u.returncode != 0 and '위치정보 이용 확인 기록은 수정·삭제할 수 없습니다' in u.stderr
           and not re.search(r'(^|,)(lat|lng|latitude|longitude|x|y|geom|coord)(,|$)', cols), cols)
        if SITE:
            try:
                from playwright.sync_api import sync_playwright
            except Exception:
                sync_playwright = None
            if sync_playwright:
                with sync_playwright() as p:
                    b_ = p.chromium.launch(); pg = b_.new_page(viewport={'width': 1300, 'height': 900})
                    pg.goto(SITE + '/community', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(1500)
                    on_box = pg.locator('[data-town-verify]').count()
                    pg.screenshot(path=os.path.join(HERE, 'v1164_town_box.png'), full_page=False)
                    psql("UPDATE site_settings SET value = 'off' WHERE key = 'community.town_verify'")
                    pg.goto(SITE + '/community', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(1500)
                    off_box = pg.locator('[data-town-verify]').count()
                    b_.close()
                ok('③ 사용자 웹 /community — 켜면 「동네 인증」 상자 · 끄면 없음', on_box == 1 and off_box == 0, f'켬 {on_box} · 끔 {off_box}')
    finally:
        psql(f"UPDATE site_settings SET value = '{s0 or 'off'}' WHERE key = 'community.town_verify'")
        psql(f"DELETE FROM member_towns WHERE account_id IN ('{mid}'{(", '" + pauth + "'") if pauth else ''})")
        psql(f"DELETE FROM account_roles WHERE role = 'ADMIN' AND account_id = (SELECT id FROM accounts WHERE email = '{ADM}');")
    ok('끝 — 되돌림(설정 처음 값 · 인증 줄 없음 · buyer ADMIN 없음)', setting() == (s0 or 'off') and psql(f"SELECT count(*) FROM member_towns WHERE account_id = '{mid}'") == '0', setting())
else:
    print('  (API · DB 없음 — ② · ③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
