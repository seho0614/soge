"""v10.145 시험 — 050 안심번호 틀(D141 · docs/221 · 설계 docs/218)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e SITE=http://localhost:15174 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1145.py

  ① 코드 — D141(칸 더함 · 통화 알림 한 번 · 웹훅 기록 · 키 이름 · 설정 · 배치 · 지우는 문장 없음 · 179) · 번호 받기(로그인 · 본인 · 업종 · 휴대폰 · 하루 · 다시 씀 · 소개코드) ·
     웹훅(HMAC · 5분 · 같은 알림 한 번 · 건 번호 해시 · 통화 시각 기준) · 돌려주기 · API · 공개 웹훅 구역 · 방식 SUPER · 화면 목록 · 사용자 웹 · 운영 화면 · 사전 · 영어 · 판
  ② (API · MOCK) 처음 NONE → 「준비 중」 409 · HTTP 설정 없이 422 · MOCK · 손님 403 · 본인 매물 422 · 휴대폰 없음 409 · 받기 · 다시 씀 · 가짜 통화 → 통화 기록(해시) ·
     웹훅 서명 틀림 401 · 웹훅 통화 · 같은 알림 한 번 · 모르는 번호 · 하루 한도 · 돌려주기 배치 · 운영 상태 · 통화 기록(번호 없음) — 끝나면 되돌림
  ③ (사용자 웹) 매물 상세 「전화하기」 → 050 번호 / (운영 화면) 외부 연동 › 「안심번호」
"""
import hashlib, hmac, json, os, re, subprocess, time, urllib.error, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB'); SITE = os.environ.get('SITE')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []
PW = 'sgb-dev-1234'
MOCK_SECRET = 'sgb-mock-safenum-webhook-secret'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
D = rd('prisma/migrations/D141_safenum/migration.sql')
mig = sorted(x for x in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', x)))
ok('① D141 — 번호 칸(회원 · 방식 · 업체 id) · 통화 기록 칸(알림 번호 한 번) · 웹훅 기록 · 키 이름 · 설정(NONE · 24 · 10) · 배치 · 지우는 문장 없음 · 179 이상',
   'ALTER TABLE public.safe_numbers ADD COLUMN IF NOT EXISTS account_id uuid' in D and 'ON public.call_logs (provider, event_id) WHERE event_id IS NOT NULL' in D
   and 'CREATE TABLE IF NOT EXISTS public.safenum_events' in D and "('SAFENUM','SAFENUM_WEBHOOK_SECRET')" in D and "'ESIGN_WEBHOOK_SECRET', 'SAFENUM_WEBHOOK_SECRET') THEN" in D
   and "('safenum.provider', 'NONE'" in D and "('safenum.hours', '24'" in D and "('safenum.daily', '10'" in D and "VALUES ('safenum_release', 60," in D
   and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE|DROP COLUMN)\b', D) and len(mig) >= 179 and 'D141_safenum' in mig, f'{len(mig)} · {mig[-1]}')
ok('① 통화 → 소개 기록 — 같은 회원 · 코드가 24시간 안에 다시 걸면 소개 기록은 건너뜀(ATTR_DUP 로 통화 기록 · 웹훅이 실패하지 않게)',
   'CREATE OR REPLACE FUNCTION public.fn_attribute_call()' in D and "e.code = sn.code AND e.visitor_key = vk AND e.source = 'INTRO'" in D
   and "NEW.occurred_at - interval '24 hours'" in D and "'CALL', NEW.occurred_at, NEW.occurred_at + interval '90 days'" in D)
SV = rd('src/modules/listing/safenum.service.ts')
ok('① 번호 받기 — 꺼짐 409 SAFENUM_OFF(지금 글) · 본인 · 업종 · 휴대폰 · 하루 한도 · 같은 회원 · 매물 다시 씀 · 소개코드 묶음 · 업체 실패 502',
   all(f"'{c}'" in SV for c in ('SAFENUM_OFF', 'OWN_TARGET', 'SAFENUM_NOT_ALLOWED', 'SAFENUM_NO_PHONE', 'SAFENUM_DAILY_LIMIT', 'SAFENUM_FAILED'))
   and 'this.attribution.resolveForListing(me, listingId)' in SV and "expires_at > now() + interval '10 minutes'" in SV and "m === 'MOCK' && !isProd() ? 'MOCK' : 'NONE'" in SV, '')
ok('① 웹훅 — HMAC(시각.본문) · 5분 · timingSafeEqual · 같은 알림 한 번(call_logs 유일) · 건 번호 해시(fn_enc_key) · 통화 시각 기준 번호 찾기 · 돌려주기 배치',
   "createHmac('sha256', secret).update(`${ts}.${raw}`" in SV and 'SIG_SKEW_SEC = 300' in SV and 'timingSafeEqual(cand, mac)' in SV
   and 'ON CONFLICT (provider, event_id) WHERE event_id IS NOT NULL DO NOTHING' in SV and "encode(hmac($2::text, fn_enc_key(), 'sha256'), 'hex')" in SV
   and "issued_at <= coalesce($3::timestamptz, now())" in SV and 'async release(' in SV and "case 'safenum_release'" in rd('src/worker/scheduler.service.ts')
   and "'safenum_release'," in rd('src/worker/worker.controller.ts'), '')
CT = rd('src/modules/listing/safenum.controller.ts')
routes = re.findall(r"@(Get|Post)\('([^']+)'\)\n(?:  @HttpCode\(200\)\n)?(?:  @Roles\(([^)]*)\))?", CT)
ok('① API — 회원 2개 · 웹훅(로그인 없음) · 운영 2개 · 감사', sorted(routes) == sorted([('Post', 'listings/:id/safe-number', "'MEMBER', 'BIZ_OWNER', 'BIZ_STAFF'"),
   ('Post', 'listings/:id/safe-number/mock-call', "'MEMBER', 'BIZ_OWNER', 'BIZ_STAFF'"), ('Post', 'webhooks/safenum', ''), ('Get', 'status', "'ADMIN', 'SUPER'"), ('Get', 'calls', "'ADMIN', 'SUPER'")])
   and "@Audit('SAFENUM_ISSUE', 'LISTING')" in CT, str(routes))
AD = rd('src/modules/admin/admin.service.ts')
ok('① 방식 — safenum.* SUPER · MOCK 운영 서버 422 · HTTP 설정 없이 422', "key.startsWith('safenum.')" in AD and "'SAFENUM_KEYS_MISSING'" in AD and "key === 'safenum.provider'" in AD, '')
SC = json.loads(rd('spec/screens.json') or '{"screens":[]}')
scr = {s['id']: s for s in SC['screens']}
ok('① 화면 목록 — 매물 상세 3곳 · 외부 연동 2개', all('POST /listings/{id}/safe-number' in scr.get(i, {}).get('apis', []) for i in ('SB-MNY-DTL-010', 'SB-MAL-DTL-010', 'SB-BIZ-DTL-010'))
   and all(a in scr.get('SB-ADM-SIT-080', {}).get('apis', []) for a in ['GET /admin/safenum/status', 'GET /admin/safenum/calls']), '')
GD = rd('site/src/components/gwan/GwDetailClient.tsx')
KO = json.loads(rd('site/src/i18n/messages/ko/detail.json') or '{}').get('profile', {}); EN_ = json.loads(rd('site/src/i18n/messages/en/detail.json') or '{}').get('profile', {})
ok('① 사용자 웹 — 「전화하기」 → 번호 받기 · tel: 링크 · 쓰는 시간 · 시험 가짜 통화 · 로그인 안내 · 사전 한국어 · 영어 같은 키', 'data-safenum-call' in GD and 'data-safenum-number' in GD
   and '/safe-number/mock-call' in GD and '<GwProfileActions id={item.id} loggedIn={!!viewer} />' in rd('site/src/app/[gwan]/[id]/page.tsx')
   and set(KO) == set(EN_) and {'callLogin', 'callNumber', 'callNote', 'mockCall'} <= set(KO), '')
AP = rd('web/src/app/admin/SafenumPanel.tsx')
ok('① 운영 화면 — 「안심번호」(준비 줄 · 웹훅 주소 · 30일 · 통화 기록 · SUPER 만 단추)', '<SafenumPanel />' in rd('web/src/app/admin/Integrations.tsx')
   and all(x in AP for x in ('data-safenum-panel', 'data-safenum-row', 'data-safenum-webhook-url', 'data-safenum-stats', 'data-safenum-calls', 'data-safenum-set')), '')
RG = rd('src/common/integration/registry.ts'); SS = rd('src/common/integration/secret.service.ts'); EV = rd('deploy/aws/env.production.example'); EN = rd('src/common/i18n/server-text.en.ts')
ok('① 연동 목록 · 키 목록 · .env 예시 · 영어 문장', "'SAFENUM_WEBHOOK_SECRET', 'SAFENUM_URL'" in RG and "name: 'SAFENUM_WEBHOOK_SECRET'" in SS and 'SAFENUM_URL=' in EV
   and all(m in EN for m in ('"본인 매물에는 전화할 수 없습니다."', '"전화 연결 번호는 하루 {0}번까지 받을 수 있습니다. 1:1 문의를 이용해 주십시오."')), '')
ok('① 판 v10.145 이상', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 145), rd('VERSION').strip())


def call(m, p, b=None, t=None, raw=None, headers=None):
    hd = {'content-type': 'application/json', **(headers or {})}
    if t: hd['Authorization'] = 'Bearer ' + t
    data = raw if raw is not None else (json.dumps(b).encode() if b is not None else None)
    r = urllib.request.Request(API + p, data=data, headers=hd, method=m)
    try:
        return json.load(urllib.request.urlopen(r, timeout=60))
    except urllib.error.HTTPError as e:
        try: body = json.loads(e.read().decode('utf-8', 'replace'))
        except Exception: body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip()


def hook(body, secret=MOCK_SECRET, ts=None):
    raw = json.dumps(body, ensure_ascii=False).encode()
    ts = str(ts or int(time.time()))
    sig = hmac.new(secret.encode(), ts.encode() + b'.' + raw, hashlib.sha256).hexdigest()
    return call('POST', '/webhooks/safenum', raw=raw, headers={'x-safenum-timestamp': ts, 'x-safenum-signature': sig})


SETS = ['safenum.provider', 'safenum.daily']
if API and DB:
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW})['accessToken']
    BT = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW})['accessToken']
    before = {k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'") for k in SETS}
    mark = psql("SELECT now()::text")
    setv = lambda k, v, t=T_: call('PATCH', '/admin/site-settings', {'key': k, 'value': v}, t)
    row = psql("""SELECT l.id || '|' || a.email || '|' || coalesce(a.phone, '') FROM listings l JOIN accounts a ON a.id = l.owner_account_id
                   WHERE l.status = 'PUBLISHED' AND a.email IN ('intro@x.com', 'seller@x.com') AND NOT coalesce(fn_category_no_intro(l.category_id), false)
                   ORDER BY l.created_at LIMIT 1""")
    LID, OWNER, PHONE0 = (row.split('|') + ['', '', ''])[:3] if row else ('', '', '')
    OT = call('POST', '/auth/login', {'email': OWNER, 'password': PW}).get('accessToken') if OWNER else None
    try:
        setv('safenum.provider', 'NONE')
        off = call('POST', f'/listings/{LID}/safe-number', {}, BT)
        ok('② (준비) 매물 · 처음 NONE → 409 SAFENUM_OFF(지금 「준비 중」 글)', bool(LID) and off.get('code') == 'SAFENUM_OFF' and '준비 중' in (off.get('message') or ''), f'{OWNER} · {off}')
        h = setv('safenum.provider', 'HTTP')
        ok('② HTTP — 키 · 웹훅 비밀값 · 주소 없이 422 SAFENUM_KEYS_MISSING', h.get('code') == 'SAFENUM_KEYS_MISSING', str(h)[:120])
        ok('② MOCK 으로(점검판)', setv('safenum.provider', 'MOCK').get('_err') is None and call('GET', '/admin/safenum/status', t=T_).get('configured') is True, '')
        guest = call('POST', f'/listings/{LID}/safe-number', {})
        own = call('POST', f'/listings/{LID}/safe-number', {}, OT)
        ok('② 손님 403 · 본인 매물 422 OWN_TARGET', guest.get('_err') in (401, 403) and own.get('code') == 'OWN_TARGET', f"{guest.get('_err')} · {own.get('code')}")
        psql(f"UPDATE accounts SET phone = NULL WHERE email = '{OWNER}'")
        np_ = call('POST', f'/listings/{LID}/safe-number', {}, BT)
        ok('② 등록자 휴대폰 없음 409 SAFENUM_NO_PHONE', np_.get('code') == 'SAFENUM_NO_PHONE', str(np_)[:100])
        psql(f"UPDATE accounts SET phone = '01055551234' WHERE email = '{OWNER}'")
        n1 = call('POST', f'/listings/{LID}/safe-number', {}, BT)
        n2 = call('POST', f'/listings/{LID}/safe-number', {}, BT)
        vno = re.sub(r'\D', '', n1.get('number') or '')
        ok('② 번호 받기 — 0500 가짜 번호 · 24시간 · 같은 회원 · 매물은 다시 씀(1행)', vno.startswith('0500') and n1.get('mode') == 'MOCK' and n1.get('reused') is False
           and n2.get('reused') is True and n2.get('number') == n1.get('number')
           and psql(f"SELECT count(*) FROM safe_numbers WHERE target_id = '{LID}' AND provider = 'MOCK' AND issued_at >= '{mark}'") == '1'
           and psql(f"SELECT round(extract(epoch FROM expires_at - issued_at) / 3600) FROM safe_numbers WHERE virtual_no = '{vno}'") == '24', f'{n1} · {n2.get("reused")}')
        mc = call('POST', f'/listings/{LID}/safe-number/mock-call', {'durationSec': 65}, BT)
        ok('② 가짜 통화 → 통화 기록 1행(건 번호 해시 · 65초)', mc.get('result') == 'LOGGED'
           and psql(f"SELECT duration_sec || '|' || (caller_hash ~ '^[0-9a-f]{{64}}$') FROM call_logs cl JOIN safe_numbers sn ON sn.id = cl.safe_number_id WHERE sn.virtual_no = '{vno}'") == '65|true', str(mc))
        bad = hook({'eventId': 'sn-bad', 'virtualNumber': vno, 'durationSec': 10}, secret='wrong')
        ok('② 웹훅 서명 틀림 401 SAFENUM_BAD_SIGNATURE · 기록', bad.get('code') == 'SAFENUM_BAD_SIGNATURE'
           and psql(f"SELECT count(*) FROM safenum_events WHERE event_id = 'sn-bad' AND NOT sig_ok") == '1', str(bad))
        ev = f'sn-{int(time.time())}'
        w1 = hook({'eventId': ev, 'virtualNumber': vno, 'callerNumber': '01099998888', 'durationSec': 120, 'endedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
        w2 = hook({'eventId': ev, 'virtualNumber': vno, 'callerNumber': '01099998888', 'durationSec': 120})
        w3 = hook({'eventId': ev + 'x', 'virtualNumber': '050099999999', 'durationSec': 5})
        ok('② 웹훅 통화 — 기록 · 같은 알림 한 번(중복) · 모르는 번호는 받기만 · 건 번호 원문 저장 안 함', w1.get('result') == 'LOGGED' and w2.get('duplicate') is True and w3.get('result') == 'UNKNOWN_NUMBER'
           and psql(f"SELECT count(*) FROM call_logs WHERE event_id = '{ev}'") == '1' and psql("SELECT count(*) FROM call_logs WHERE caller_hash LIKE '%01099998888%'") == '0', f'{w1} · {w2} · {w3}')
        setv('safenum.daily', '1')
        lim = None
        other = psql(f"""SELECT l.id FROM listings l WHERE l.status = 'PUBLISHED' AND l.owner_account_id = (SELECT id FROM accounts WHERE email = '{OWNER}')
                          AND l.id <> '{LID}' AND NOT coalesce(fn_category_no_intro(l.category_id), false) LIMIT 1""")
        if other:
            lim = call('POST', f'/listings/{other}/safe-number', {}, BT)
        ok('② 하루 한도 — 다른 매물 새 번호 422 SAFENUM_DAILY_LIMIT', (lim or {}).get('code') == 'SAFENUM_DAILY_LIMIT' if other else True, str(lim)[:100] if other else '등록자의 다른 매물 없음 — 건너뜀')
        psql(f"UPDATE safe_numbers SET expires_at = now() - interval '1 minute' WHERE virtual_no = '{vno}'")
        jb = call('POST', '/admin/jobs', {'job': 'safenum_release'}, T_)
        ok('② 돌려주기 배치 — 기한 지난 번호 released', (jb.get('detail') or {}).get('released', 0) >= 1
           and psql(f"SELECT released_at IS NOT NULL FROM safe_numbers WHERE virtual_no = '{vno}'") == 't', str(jb)[:120])
        stt = call('GET', '/admin/safenum/status', t=T_); cl = call('GET', '/admin/safenum/calls?days=1', t=T_)
        cj = json.dumps(cl, ensure_ascii=False)
        ok('② 운영 상태 · 통화 기록 — 발급 1 이상 · 통화 2 이상 · 서명 틀림 1 이상 · 기록에 전화번호 없음(050 끝 4자리만)',
           (stt.get('last30') or {}).get('issued', 0) >= 1 and (stt.get('last30') or {}).get('calls', 0) >= 2 and (stt.get('webhook') or {}).get('badSignature', 0) >= 1
           and len(cl.get('rows', [])) >= 2 and vno not in cj and '01055551234' not in cj, str(stt.get('last30'))[:120])
        if SITE:
            try:
                from playwright.sync_api import sync_playwright
            except Exception:
                sync_playwright = None
            if sync_playwright:
                setv('safenum.daily', '10')
                gw = psql(f"SELECT lower(gwan_code) FROM listings WHERE id = '{LID}'")
                path = {'mny': 'money', 'mal': 'mall', 'biz': 'biz'}.get(gw, 'money')
                with sync_playwright() as p:
                    b = p.chromium.launch(); cx = b.new_context(viewport={'width': 1280, 'height': 1000})
                    host = re.sub(r'^https?://', '', SITE).split(':')[0]
                    cx.add_cookies([{'name': 'sgb_at', 'value': BT, 'domain': host, 'path': '/'}])
                    pg = cx.new_page(); pg.goto(f'{SITE}/{path}/{LID}', wait_until='networkidle', timeout=120000)
                    btn = pg.locator('[data-safenum-call]')
                    if btn.count(): btn.first.click()
                    try: pg.wait_for_selector('[data-safenum-number]', timeout=30000)
                    except Exception: pass
                    nn = pg.locator('[data-safenum-number]')
                    ok('③ 매물 상세 「전화하기」 → 050 번호 · 누르면 거는 링크 · 시험 가짜 통화 단추', nn.count() == 1 and (nn.get_attribute('href') or '').startswith('tel:0500')
                       and pg.locator('[data-safenum-mockcall]').count() == 1, f'/{path}/{LID[:8]} · ' + (nn.inner_text() if nn.count() else (pg.locator('[data-safenum-msg]').inner_text() if pg.locator('[data-safenum-msg]').count() else '없음')))
                    pg.screenshot(path=os.path.join(HERE, 'v1145_call.png'))
                    b.close()
    finally:
        for k, v in before.items():
            psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}';")
        if OWNER:
            psql(f"UPDATE accounts SET phone = {('NULL' if not PHONE0 else repr(PHONE0))} WHERE email = '{OWNER}';")
        psql(f"UPDATE safe_numbers SET released_at = now(), release_note = 'test_v1145' WHERE issued_at >= '{mark}' AND released_at IS NULL;")
    ok('② 되돌림 — 설정 · 등록자 휴대폰 · 시험 번호 돌려줌', all(psql(f"SELECT value FROM site_settings WHERE key = '{k}'") == v for k, v in before.items())
       and psql(f"SELECT coalesce(phone, '') FROM accounts WHERE email = '{OWNER}'") == PHONE0
       and psql(f"SELECT count(*) FROM safe_numbers WHERE issued_at >= '{mark}' AND released_at IS NULL") == '0', '')

# ── ③ 운영 화면 ───────────────────────────────────────────────────────
if ADMIN_WEB:
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if sync_playwright:
        with sync_playwright() as p:
            b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1400, 'height': 1000})
            pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
            pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(1500)
            pg.goto(ADMIN_WEB + '/#/integrations', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
            box = pg.locator('[data-safenum-panel]')
            ok('③ 외부 연동 › 「안심번호」 — 준비 네 줄 · 웹훅 주소 · 30일 · 통화 기록 · 방식 단추', box.count() == 1 and box.locator('[data-safenum-row]').count() == 4
               and box.locator('[data-safenum-webhook-url]').count() == 1 and box.locator('[data-safenum-stats]').count() == 1 and box.locator('[data-safenum-calls]').count() == 1
               and box.locator('[data-safenum-set]').count() >= 2, box.inner_text()[:120] if box.count() else '없음')
            if box.count(): box.scroll_into_view_if_needed()
            pg.screenshot(path=os.path.join(HERE, 'v1145_safenum_panel.png'), full_page=False)
            b.close()

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
