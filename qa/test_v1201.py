"""v10.201 시험 — 하루 요약 텔레그램 · 운영자 낯선 로그인 알림 · 약관 법무 검토 묶음(D179 · docs/318)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1201.py

  ① 코드 — D179(설정 2 · 트리거 · 급한 알림 대상에 STAFF_LOGIN_NEW · 지우는 문장 없음 · 217) · 하루 요약 텔레그램(메일과 따로 · 꺼짐 · 준비 안 됨 · 오픈 차단 줄) ·
     운영 알림 화면 하루 요약 줄 · 「운영자 낯선 로그인」 이름 · 법무 검토 묶음(API · DTO · 읽기만 · 화면 단추 · 화면 목록) · 문서 · 판
  ② (DB) 낯선 로그인 — 30일 안 첫 로그인 · 새 IP 대역 · 새 브라우저만 · 같은 곳 · 실패 · 회원 · 꺼짐은 없음 · 메일 · 텔레그램 고르는 함수에 들어감(한 묶음 안에서 · 되돌림)
  ③ (API · 화면) 운영 역할 계정 로그인 → 알림 한 번(두 번째 같은 곳은 없음) · 회원 로그인은 없음 · 하루 요약 작업 → 텔레그램 까닭(NO_TOKEN · 꺼지면 OFF) ·
     mail-status 의 push.digest · 법무 검토 묶음(SUPER · ADMIN 403 · 초안 수 · 〔미확정〕 · 게시판과 바뀐 줄 · 스크립트 없음) · 운영 알림 하루 요약 줄 · 약관 내려받기 단추
"""
import json, os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
HERE = os.path.dirname(os.path.abspath(__file__))
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
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
M = rd('prisma/migrations/D179_staff_login_digest_push/migration.sql')
ok('① D179 — 설정 ops.staff_login_alert · ops.telegram_digest(on · ADMIN) · login_history 트리거(운영 역할 · 성공 · 30일 · IP 대역 · 브라우저 · 예외 삼킴 · clock_timestamp) · 메일 · 텔레그램 대상에 STAFF_LOGIN_NEW · 지우는 문장 없음 · 217',
   "('ops.staff_login_alert', 'on', 'ADMIN'," in M and "('ops.telegram_digest', 'on', 'ADMIN'," in M and M.count("'^(on|off)$'") == 2
   and 'CREATE TRIGGER trg_staff_login_watch AFTER INSERT ON public.login_history' in M and "IF NOT NEW.ok THEN RETURN NEW; END IF;" in M
   and "r.role IN ('SUPER', 'ADMIN', 'REVIEWER', 'PAYOUT', 'PARTNER_MAL', 'PARTNER_AFF')" in M and "h.at > now() - interval '30 days'" in M
   and 'EXCEPTION WHEN OTHERS THEN' in M and "VALUES ('STAFF_LOGIN_NEW', 'WARN', clock_timestamp()," in M
   and M.count("'ORDER_OPEN_EXPIRED', 'STAFF_LOGIN_NEW'))") == 2 and 'FUNCTION public.fn_ops_alert_mail_pending()' in M and 'FUNCTION public.fn_ops_alert_push_pending()' in M
   and M.count('o.acknowledged_at IS NULL AND o.resolved_at IS NULL') == 2
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|DROP FUNCTION|TRUNCATE)\b', M) and len(mig) >= 217 and 'D179_staff_login_digest_push' in mig,
   f'{len(mig)} · {mig[-1]}')
SC = rd('src/worker/scheduler.service.ts'); OS_ = rd('src/modules/admin/ops-alerts.service.ts')
ok('① 하루 요약 텔레그램 — 메일 다음 따로 · 설정 꺼지면 OFF · 준비 안 되면 까닭 · 오픈 차단 줄 · DAILY_DIGEST 기록에 pushed · pushReason · mail-status push.digest',
   'const dp = await this.digestPush(d.text);' in SC and SC.index('mailed = !!m.ok;') < SC.index('const dp = await this.digestPush(d.text);')
   and '{ ...d, mailed, pushed: dp.pushed, pushReason: dp.reason }' in SC and "key = 'ops.telegram_digest'" in SC
   and "return { pushed: false, reason: 'OFF' };" in SC and 'if (!st.ready) return { pushed: false, reason: st.reason };' in SC
   and 'FROM v_open_blockers' in SC and "alert_code = 'DAILY_DIGEST' ORDER BY id DESC LIMIT 1" in OS_ and "digest: { on: dg?.sw === 'on'" in OS_, '')
OX = rd('web/src/app/admin/OpsAlerts.tsx')
ok('① 운영 알림 화면 — 텔레그램 줄에 하루 요약(받음 · 마지막 · SUPER 끄기 · 받기) · 「운영자 낯선 로그인」 이름 · 설명에 운영자 낯선 로그인',
   'data-push-digest=' in OX and 'data-push-digest-flip=""' in OX and "key: 'ops.telegram_digest'" in OX
   and "STAFF_LOGIN_NEW: '운영자 낯선 로그인'" in OX and '백업 실패 · 운영자 낯선 로그인)' in OX, '')
TS_ = rd('src/modules/catalog/terms.service.ts'); TC = rd('src/modules/catalog/terms.controller.ts'); TD = rd('src/modules/catalog/terms.dto.ts')
RP = rd('src/modules/catalog/terms-review-pack.ts'); TP = rd('web/src/app/admin/TermsPanel.tsx'); SJ = rd('spec/screens.json')
ok('① 법무 검토 묶음 — GET /admin/terms/review-pack(SUPER · DTO) · 게시 안 된 판(초안 · 법무 검토)만 · 지금 게시판과 줄 비교 · 〔미확정〕 · 바깥 글꼴 · 스크립트 없음 · 화면 단추 · 화면 목록',
   "@Get('terms/review-pack')" in TC and '@ApiOkResponse({ type: ReviewPackDto })' in TC and "@Roles('SUPER')" in TC
   and 'export class ReviewPackDto' in TD and TD.index('export class ReviewPackItemDto') < TD.index('export class ReviewPackDto')
   and "WHERE status IN ('DRAFT', 'LEGAL_REVIEW')" in TS_ and "t.status = 'PUBLISHED'" in TS_ and 'buildReviewPack(terms, day)' in TS_
   and 'export function lineDiff(' in RP and "filter((m) => m !== '〔시행일〕')" in RP and '<script' not in RP and 'https://' not in RP
   and '(주)한국바이오헬스케어 소개뱅크 사업부' in RP and "'/admin/terms/review-pack'" in TP and 'data-terms-pack-btn=""' in TP and 'link.download = r.fileName' in TP
   and '"GET /admin/terms/review-pack"' in SJ, '')
ok('① 문서 · 판 — docs/318 · VERSION v10.201 이상',
   any(f.startswith('318_') for f in os.listdir(os.path.join(K, 'docs')))
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 201), rd('VERSION').strip())


# ── ② · ③ DB · API ────────────────────────────────────────────────────
def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m)
    try:
        raw = urllib.request.urlopen(r, timeout=120).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b'{}')
        except Exception:
            body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return r.stdout.strip() if not r.returncode else ('!' + r.stderr.strip()[:200])


ADMU, SUPU, MEMU = 't1201adm@x.com', 'admin@x.com', 'buyer@x.com'
if API and DB:
    # ── ② 낯선 로그인 — 한 묶음 안에서 · 되돌림 ──────────────────────────
    A_, B_ = '00000000-0000-0000-0000-00000a001201', '00000000-0000-0000-0000-00000b001201'
    g = psql("BEGIN; "
             f"INSERT INTO accounts (id, email, name, status, password_hash) VALUES ('{A_}', 't1201db_a@x.com', 'T', 'ACTIVE', 'x'), ('{B_}', 't1201db_b@x.com', 'M', 'ACTIVE', 'x'); "
             f"SELECT set_config('app.role_reason', '시험 T1201', true); INSERT INTO account_roles (account_id, role) VALUES ('{A_}', 'REVIEWER'); "
             "UPDATE site_settings SET value = 'on' WHERE key = 'ops.staff_login_alert'; "
             "UPDATE ops_alerts SET mailed_at = coalesce(mailed_at, now() - interval '2 hours'), pushed_at = coalesce(pushed_at, now() - interval '2 hours'); "
             f"INSERT INTO login_history (account_id, ok, ip_masked, ua_kind) VALUES ('{A_}', true, '121.168.*.*', 'Chrome · Windows'); "
             f"INSERT INTO login_history (account_id, ok, ip_masked, ua_kind) VALUES ('{A_}', true, '121.168.*.*', 'Chrome · Windows'); "
             f"INSERT INTO login_history (account_id, ok, ip_masked, ua_kind) VALUES ('{A_}', true, '211.36.*.*', 'Chrome · Windows'); "
             f"INSERT INTO login_history (account_id, ok, ip_masked, ua_kind) VALUES ('{A_}', true, '211.36.*.*', 'Safari · iOS'); "
             f"INSERT INTO login_history (account_id, ok, ip_masked, ua_kind) VALUES ('{A_}', false, '1.2.*.*', '프로그램'); "
             f"INSERT INTO login_history (account_id, ok, ip_masked, ua_kind) VALUES ('{B_}', true, '9.9.*.*', 'Chrome'); "
             f"SELECT 'W:' || string_agg(detail->>'why', ',' ORDER BY id) FROM ops_alerts WHERE alert_code = 'STAFF_LOGIN_NEW' AND detail->>'accountId' = '{A_}'; "
             f"SELECT 'B:' || count(*) FROM ops_alerts WHERE alert_code = 'STAFF_LOGIN_NEW' AND detail->>'accountId' = '{B_}'; "
             f"SELECT 'T:' || title FROM ops_alerts WHERE alert_code = 'STAFF_LOGIN_NEW' AND detail->>'accountId' = '{A_}' ORDER BY id LIMIT 1; "
             "SELECT 'M:' || count(*) FROM fn_ops_alert_mail_pending() WHERE alert_code = 'STAFF_LOGIN_NEW'; "
             "SELECT 'P:' || count(*) FROM fn_ops_alert_push_pending() WHERE alert_code = 'STAFF_LOGIN_NEW'; "
             "UPDATE site_settings SET value = 'off' WHERE key = 'ops.staff_login_alert'; "
             f"INSERT INTO login_history (account_id, ok, ip_masked, ua_kind) VALUES ('{A_}', true, '5.5.*.*', 'Edge · Windows'); "
             f"SELECT 'O:' || count(*) FROM ops_alerts WHERE alert_code = 'STAFF_LOGIN_NEW' AND detail->>'accountId' = '{A_}'; ROLLBACK;")
    L = g.splitlines()
    ok('② 낯선 로그인 — 30일 안 첫 로그인 · 새 IP 대역 · 새 브라우저만(같은 곳 · 실패 · 회원 · 꺼짐은 없음) · 이메일 앞 두 글자 · 메일 · 텔레그램 고르는 함수에 셋',
       'W:FIRST,NEW_IP,NEW_UA' in L and 'B:0' in L and 'M:3' in L and 'P:3' in L and 'O:3' in L
       and any(x.startswith('T:운영자 낯선 로그인 — t1***@x.com(REVIEWER) · 121.168.*.* · Chrome · Windows') for x in L), g.replace('\n', ' ')[:220])

    # ── ③ API · 화면 ──────────────────────────────────────────────────
    import sys
    sys.path.insert(0, HERE)
    import consent_ok
    pw = psql(f"SELECT password_hash FROM accounts WHERE email = '{MEMU}'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{ADMU}', '시험운영1201', '{pw}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{ADMU}'")
    mid = psql(f"SELECT id FROM accounts WHERE email = '{MEMU}'")
    sw0 = psql("SELECT coalesce((SELECT quote_literal(value) FROM site_settings WHERE key = 'ops.staff_login_alert'), 'NULL')")
    dg0 = psql("SELECT coalesce((SELECT quote_literal(value) FROM site_settings WHERE key = 'ops.telegram_digest'), 'NULL')")
    t0 = psql('SELECT now()')
    draft_made = False
    try:
        psql("UPDATE site_settings SET value = 'on' WHERE key IN ('ops.staff_login_alert', 'ops.telegram_digest')")
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 T1201', true); INSERT INTO account_roles(account_id, role) VALUES ('{aid}', 'ADMIN') ON CONFLICT DO NOTHING; COMMIT;")
        psql(f"DELETE FROM login_history WHERE account_id = '{aid}'")
        psql(f"DELETE FROM ops_alerts WHERE alert_code = 'STAFF_LOGIN_NEW' AND detail->>'accountId' = '{aid}'")
        n0 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'STAFF_LOGIN_NEW' AND detail->>'accountId' = '{aid}'")
        TA = call('POST', '/auth/login', {'email': ADMU, 'password': PW}).get('accessToken')   # 30일 안 첫 로그인
        n1 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'STAFF_LOGIN_NEW' AND detail->>'accountId' = '{aid}'")
        call('POST', '/auth/login', {'email': ADMU, 'password': PW})   # 같은 곳(같은 IP · 같은 브라우저 이름) 다음 로그인
        n2 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'STAFF_LOGIN_NEW' AND detail->>'accountId' = '{aid}'")
        for e in (ADMU, SUPU): consent_ok.agree(e, PW)   # 동의 도우미는 브라우저 이름이 달라 「처음 보는 브라우저」가 날 수 있음 — 세지 않음
        TA = call('POST', '/auth/login', {'email': ADMU, 'password': PW}).get('accessToken')
        why = psql(f"SELECT detail->>'why' || '|' || (detail->>'roles') || '|' || coalesce(detail->>'ip', '') FROM ops_alerts WHERE alert_code = 'STAFF_LOGIN_NEW' AND detail->>'accountId' = '{aid}' ORDER BY id LIMIT 1")
        m0 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'STAFF_LOGIN_NEW' AND detail->>'accountId' = '{mid}'")
        consent_ok.agree(MEMU, PW)
        call('POST', '/auth/login', {'email': MEMU, 'password': PW})
        m1 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'STAFF_LOGIN_NEW' AND detail->>'accountId' = '{mid}'")
        TS = call('POST', '/auth/login', {'email': SUPU, 'password': PW}).get('accessToken')
        ok('③ 운영자 낯선 로그인 — ADMIN 계정 30일 안 첫 로그인 → 알림 1 · 같은 곳 다음 로그인은 없음 · 역할 · IP 대역(앞 두 마디) · 회원 로그인은 없음',
           n0 == '0' and n1 == '1' and n2 == '1' and why.startswith('FIRST|ADMIN|') and why.split('|')[-1].endswith('*') and m0 == m1 and bool(TA) and bool(TS),
           f'{n0} {n1} {n2} · {why} · {m0} {m1}')

        # 하루 요약 텔레그램 — 점검판은 봇 토큰 없음 → NO_TOKEN · 끄면 OFF
        d1 = call('POST', '/admin/jobs', {'job': 'launch_digest'}, TS)
        r1 = psql("SELECT coalesce(detail->>'pushed', '') || '|' || coalesce(detail->>'pushReason', '') FROM ops_alerts WHERE alert_code = 'DAILY_DIGEST' ORDER BY id DESC LIMIT 1")
        ms1 = ((call('GET', '/admin/ops-alerts/mail-status', None, TS) or {}).get('push') or {}).get('digest') or {}
        s1 = call('PATCH', '/admin/site-settings', {'key': 'ops.telegram_digest', 'value': 'off'}, TS)
        d2 = call('POST', '/admin/jobs', {'job': 'launch_digest'}, TS)
        r2 = psql("SELECT coalesce(detail->>'pushed', '') || '|' || coalesce(detail->>'pushReason', '') FROM ops_alerts WHERE alert_code = 'DAILY_DIGEST' ORDER BY id DESC LIMIT 1")
        ms2 = ((call('GET', '/admin/ops-alerts/mail-status', None, TS) or {}).get('push') or {}).get('digest') or {}
        s3 = call('PATCH', '/admin/site-settings', {'key': 'ops.telegram_digest', 'value': 'maybe'}, TS)
        psql("UPDATE site_settings SET value = 'on' WHERE key = 'ops.telegram_digest'")
        ok('③ 하루 요약 텔레그램 — 봇 토큰 없으면 안 보냄(pushReason NO_TOKEN) · 끄면 OFF · mail-status push.digest(받음 · 마지막) · on/off 말고는 거절',
           not d1.get('_err') and r1 == 'false|NO_TOKEN' and ms1.get('on') is True and (ms1.get('last') or {}).get('reason') == 'NO_TOKEN'
           and not s1.get('_err') and not d2.get('_err') and r2 == 'false|OFF' and ms2.get('on') is False and (ms2.get('last') or {}).get('reason') == 'OFF' and bool(s3.get('_err')),
           f'{d1.get("_err")} {r1} · {ms1} · {s1.get("_err")} {r2} · {ms2} · {s3.get("_err")}')

        # 법무 검토 묶음 — 게시판이 있는 약관에 시험 초안(한 줄 더함)을 두고 비교 줄 확인
        pub = psql("SELECT code || '|' || version FROM terms WHERE status = 'PUBLISHED' AND effective_from <= now() AND coalesce(body, '') <> '' ORDER BY code LIMIT 1")
        pcode = pub.split('|')[0] if '|' in pub else ''
        if pcode:
            body = psql(f"SELECT body FROM terms WHERE code = '{pcode}' AND status = 'PUBLISHED' AND effective_from <= now() ORDER BY effective_from DESC LIMIT 1")
            pv = call('PUT', f'/admin/terms/{pcode}', {'version': '9.120', 'title': 'T1201 시험 약관 초안입니다', 'body': body + '\n\n제99조(시험) 〔시험 칸〕 이 줄은 시험입니다.', 'changeNote': '시험 T1201'}, TS)
            draft_made = not pv.get('_err')
        rp = call('GET', '/admin/terms/review-pack', None, TS)
        ra = call('GET', '/admin/terms/review-pack', None, TA)
        nd = psql("SELECT count(DISTINCT code) FROM terms WHERE status IN ('DRAFT', 'LEGAL_REVIEW')")
        it = {x.get('code'): x for x in (rp.get('items') or [])}
        mine = it.get(pcode) or {}
        html = rp.get('html') or ''
        ok('③ 법무 검토 묶음 — SUPER 200 · ADMIN 403 · 게시 안 된 약관마다 한 건 · 시험 초안은 게시판과 비교해 더한 줄(빈 줄 · 시험 줄) · 뺀 줄 0 · 〔미확정〕 · HTML(한 파일 · 스크립트 · 바깥 주소 없음) · 파일 이름',
           draft_made and ra.get('_err') == 403 and len(it) == int(nd or -1) and mine.get('version') == '9.120' and mine.get('baseVersion')
           and mine.get('added') in (1, 2) and mine.get('removed') == 0 and '〔시험 칸〕' in (mine.get('holes') or [])
           and html.startswith('<!doctype html>') and '<script' not in html.lower() and 'https://' not in html and 'class="l add"' in html and '<mark>〔시험 칸〕</mark>' in html
           and re.fullmatch(r'sogaebank_terms_legal_review_\d{8}\.html', rp.get('fileName') or '') is not None,
           f'{pub} · {ra.get("_err")} · {len(it)}/{nd} · {mine} · {rp.get("fileName")}')

        if ADMIN_WEB:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1400, 'height': 1000}, accept_downloads=True); pg = ctx.new_page(); errs = []
                pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', SUPU); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
                pg.goto(ADMIN_WEB + '/#/ops-alerts', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                h1 = pg.evaluate("() => (document.querySelector('[data-push-digest]')?.getAttribute('data-push-digest') ?? '') + '|' + !!document.querySelector('[data-push-digest-flip]') + '|' + (document.querySelector('[data-push-digest]')?.textContent ?? '')")
                pg.goto(ADMIN_WEB + '/#/siteinfo', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                fname = ''
                try:
                    with pg.expect_download(timeout=30000) as dl:
                        pg.click('[data-terms-pack-btn]')
                    fname = dl.value.suggested_filename
                except Exception as e:
                    fname = '!' + str(e)[:80]
                pg.wait_for_timeout(1000)
                h2 = pg.evaluate("() => (document.querySelector('[data-terms-result]')?.getAttribute('data-terms-result') ?? '') + '|' + (document.querySelector('[data-terms-result]')?.textContent ?? '')")
                b.close()
            ok('③ 화면 — 운영 알림 텔레그램 줄의 하루 요약(받음 · 마지막 못 보냄 · 끄기 단추) · 약관 「법무 검토용 내려받기」 → 파일 내려받음 · 결과 글 · 오류 없음',
               h1.startswith('on|true|') and '하루 요약' in h1 and '못 보냄' in h1 and re.fullmatch(r'sogaebank_terms_legal_review_\d{8}\.html', fname) is not None
               and h2.startswith('ok|') and '법무 검토 묶음' in h2 and not errs, f'{h1[:90]} · {fname} · {h2[:80]} · {errs[:2]}')
    finally:
        if draft_made: psql(f"DELETE FROM terms WHERE code = '{pcode}' AND version = '9.120'")
        psql(f"UPDATE site_settings SET value = {sw0} WHERE key = 'ops.staff_login_alert'")
        psql(f"UPDATE site_settings SET value = {dg0} WHERE key = 'ops.telegram_digest'")
        psql(f"DELETE FROM ops_alerts WHERE alert_code = 'STAFF_LOGIN_NEW' AND detail->>'accountId' = '{aid}' AND raised_at >= '{t0}'")

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
