"""v10.199 시험 — 대시보드 칸 누르면 그 화면 · 「주문 받기」 꺼질 시각 · 운영 알림 「풀림」 · 검수 기한 알림 묶기 · 🌐 언어 단추 모든 PC 폭(D177 · docs/314)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1199.py

  ① 코드 — D177(mall.order_open_until · resolved_at · 메일 함수 풀린 것 빼기 · 검수 기한 묶기 · 지우는 문장 없음 · 215) · 켜기 꺼질 시각 ·
     정기 작업(저절로 끄기 · 꺼질 시각 없음 CRITICAL · 풀림) · 배포 점검 · postcheck · 목록 · 화면(칸 링크 · 시각 · 띠) · 🌐 CSS · 문서 · 판
  ② (DB) 검수 기한 알림 — 확인 안 한 줄이 있으면 새 줄 대신 건수만 · 0건이면 풀림 / 풀린 알림은 메일 · 다시 메일에서 빠짐
     (임시 review_items 로 한 묶음 안에서 해 보고 되돌림 — 실제 검수 자료 · 알림은 그대로)
  ③ (API · 화면) 꺼질 시각 직접 못 고침 · 시간 고르기(1 · 2 · 4 · 8 · 24) · 켜면 꺼질 시각 · 지나면 정기 작업이 끔(EXPIRED · 사유) ·
     꺼질 시각 없이 켜짐 = CRITICAL NO_END(한 번) → 끄면 풀림 · 디스크 알림 풀림 · 목록 기본 숨김 / resolved=show · 대시보드 칸 링크 · 띠의 시각
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
M = rd('prisma/migrations/D177_order_until_alert_resolve/migration.sql')
ok('① D177 — 꺼질 시각 설정 · resolved_at · resolve_note · 메일 · 다시 메일 풀린 것 빼기 · 검수 기한 묶기 · 지우는 문장 없음 · 215',
   "('mall.order_open_until', NULL, 'GLOBAL'" in M and 'ADD COLUMN IF NOT EXISTS resolved_at timestamptz' in M and 'ADD COLUMN IF NOT EXISTS resolve_note text' in M
   and M.count('o.acknowledged_at IS NULL AND o.resolved_at IS NULL') == 2 and "'ORDER_OPEN_EXPIRED'))" in M
   and 'CREATE OR REPLACE FUNCTION public.fn_check_sla_alert()' in M and "|| jsonb_build_object('count', n, 'lastSeen', now())" in M
   and "resolve_note = '넘긴 검수가 0건이 됨'" in M
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|DROP FUNCTION|TRUNCATE)\b', M) and len(mig) >= 215 and 'D177_order_until_alert_resolve' in mig,
   f'{len(mig)} · {mig[-1]}')
AS = rd('src/modules/admin/admin.service.ts'); AC = rd('src/modules/admin/admin.controller.ts'); AD = rd('src/modules/admin/admin.dto.ts')
ok('① 켜기 — 꺼질 시각(1 · 2 · 4 · 8 · 24 · 기본 2) · 같은 거래에서 적음 · 끄면 비움 · 직접 고치기 막음(ORDER_UNTIL_AUTO) · DTO hours',
   'static readonly ORDER_OPEN_HOURS = [1, 2, 4, 8, 24];' in AS and 'until = hours ?? 2;' in AS and "new PolicyViolation('ORDER_OPEN_HOURS'" in AS
   and "new PolicyViolation('ORDER_UNTIL_AUTO'" in AS and "WHERE key = 'mall.order_open_until'`, [until, RequestCtx.actorId()]" in AS
   and 'dto.confirm, dto.hours)' in AC and '@IsOptional() @IsInt() @Min(1) @Max(24) hours?: number;' in AD, '')
LW = rd('src/modules/admin/launch-watch.service.ts'); SC = rd('src/worker/scheduler.service.ts')
ok('① 정기 작업 — 꺼질 시각 지나면 끔(사유 · via DB) · 꺼질 시각 없이 1시간 = CRITICAL ORDER_OPEN_NO_END(풀리기 전 한 번) · 꺼지면 풀림 · 풀림 4종',
   'async orderOpenGuard()' in LW and "set_config('app.setting_reason'" in LW and "SET value = 'off', updated_by = NULL" in LW
   and "(g.since_min ?? 0) >= 60 && !g.alerted" in LW and "WHERE alert_code = 'ORDER_OPEN_NO_END' AND resolved_at IS NULL" in LW
   and 'async resolveAlerts(' in LW and all(f"run('{c}'" in LW for c in ('UPLOADS_BACKUP_STALE', 'UPLOADS_BACKUP_FAILED', 'UPLOADS_BACKUP_BAD', 'DISK_LOW'))
   and "this.alert('ORDER_OPEN_EXPIRED', 'WARN'" in SC and "this.alert('ORDER_OPEN_NO_END', 'CRITICAL'" in SC
   and 'this.launchWatch.resolveAlerts(dk.usedPct, dk.limit)' in SC
   and SC.index('orderOpenGuard()') < SC.index('const am = await this.alertMail()')
   and 'AND resolved_at IS NULL AND severity IN' in LW, '')
PC = rd('deploy/aws/postcheck.sh'); DC = rd('scripts/deploy-check.sh'); OA = rd('src/modules/admin/ops-alerts.service.ts')
ok('① 배포 점검 · postcheck · 대시보드 · 목록 — 풀린 CRITICAL 은 셈에서 뺌 · 목록 기본 숨김(resolved=show) · 종류별 풀림 수',
   "severity='CRITICAL' AND acknowledged_at IS NULL AND resolved_at IS NULL" in PC and "severity='CRITICAL' AND acknowledged_at IS NULL AND resolved_at IS NULL;" in DC
   and "acknowledged_at IS NULL AND resolved_at IS NULL) AS critical" in AS
   and "const hideResolved = open && q.resolved !== 'show';" in OA and 'o.resolved_at AS "resolvedAt"' in OA and 'resolvedHidden' in OA
   and all(subprocess.run(['bash', '-n', os.path.join(K, f)]).returncode == 0 for f in ('deploy/aws/postcheck.sh', 'scripts/deploy-check.sh')), '')
LX = rd('web/src/app/admin/LaunchWatch.tsx'); OX = rd('web/src/app/admin/OpsAlerts.tsx'); AX = rd('web/src/App.tsx'); CS = rd('web/src/styles/app.css')
ok('① 화면 — 칸 링크(회원 · 글 검수 · 검수 큐 · 소개몰 주문 · 운영 알림 · 서버 오류 · 아래 상세) · 꺼질 시각 고르기 · 시각 표시 · 띠 · 풀림 · 풀린 것도 보기',
   all(f"'{t}'" in LX for t in ('members', 'community', 'queue', 'hlt-orders', 'ops-alerts', 'server-errors')) and "'@data-slow-top'" in LX and "'@data-csp-top'" in LX
   and 'data-order-open-hours=""' in LX and 'hours: openHours' in LX and 'data-order-until=' in LX and 'a.ad-tile { text-decoration: none; }' in CS
   and 'data-order-live-until=""' in AX and "import { ymdhm } from './lib/act';" in AX
   and 'data-resolved=""' in OX and 'data-show-resolved=""' in OX and "showResolved ? '&resolved=show' : ''" in OX
   and "ORDER_OPEN_NO_END: '주문 받기 꺼질 시각 없음'" in OX, '')
SH = rd('site/src/styles/site-head.css')
ok('① 🌐 언어 단추 — 641px 이상 모든 PC 폭(1441px 이상도) · 마우스를 올리면 지금 언어 · 문서 · 판',
   '@media (min-width: 641px) {\n  .sh-hdr .lang-pick { position: relative; width: 44px;' in SH and '(min-width: 641px) and (max-width: 1440px)' not in SH
   and 'title={items.find((l) => l.code === locale)?.name}' in rd('site/src/i18n/LangSwitch.tsx')
   and any(f.startswith('314_') for f in os.listdir(os.path.join(K, 'docs')))
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 199), rd('VERSION').strip())


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


ADMU, SUPU = 't1199adm@x.com', 'admin@x.com'
WHY = '시험 T1199 시연용 시험 주문'
CONF = '시험 결제 주문을 받습니다'
if API and DB:
    # ── ② 검수 기한 알림 묶기 · 풀림 / 풀린 것은 메일에서 빠짐 ────────────────
    # 임시 review_items(같은 이름 · 이 연결에서만 보임)로 함수가 보는 자료를 바꾸고, 진짜 검수 기한 알림은 잠시 「풀림」으로 둔 뒤 모두 되돌림
    TMP = ("CREATE TEMP TABLE review_items (status text, sla_due_at timestamptz, sla_notified_at timestamptz, submitted_by uuid, target_type text) ON COMMIT DROP; "
           "CREATE TEMP TABLE notifications (account_id uuid, event_code text, title text, body text, link_url text) ON COMMIT DROP; "
           "UPDATE ops_alerts SET resolved_at = now() WHERE alert_code = 'REVIEW_SLA_BREACH' AND resolved_at IS NULL; ")
    g = psql("BEGIN; " + TMP +
             "INSERT INTO review_items (status, sla_due_at) VALUES ('QUEUED', now() - interval '2 hours'), ('QUEUED', now() - interval '3 hours'), ('IN_PROGRESS', now() - interval '5 hours'); "
             "SELECT fn_check_sla_alert(); SELECT pg_sleep(0.02); "
             "INSERT INTO review_items (status, sla_due_at) VALUES ('QUEUED', now() - interval '4 hours'); SELECT fn_check_sla_alert(); "
             "SELECT 'R:' || count(*) || ':' || max(detail->>'count') FROM ops_alerts WHERE alert_code = 'REVIEW_SLA_BREACH' AND resolved_at IS NULL; "
             "DELETE FROM review_items; SELECT fn_check_sla_alert(); "
             "SELECT 'Z:' || count(*) FROM ops_alerts WHERE alert_code = 'REVIEW_SLA_BREACH' AND resolved_at IS NULL; "
             "ROLLBACK;")
    ok('② 검수 기한 알림 — 확인 안 한 줄이 있으면 새 줄 대신 건수만 고침(3 → 4 · 1줄) · 넘긴 검수 0건이면 풀림',
       'R:1:4' in g and 'Z:0' in g, g.replace('\n', ' ')[:120])
    g2 = psql("BEGIN; UPDATE ops_alerts SET mailed_at = coalesce(mailed_at, now() - interval '2 hours'), remailed_at = coalesce(remailed_at, now() - interval '1 hour'); "
              "INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at, mailed_at) VALUES "
              "('TEST_V1199_A', 'CRITICAL', '시험 안 풀림', '{\"test\":\"v1199\"}', now() - interval '14 hours', now() - interval '13 hours'), "
              "('TEST_V1199_B', 'CRITICAL', '시험 풀림', '{\"test\":\"v1199\"}', now() - interval '14 hours 1 minute', now() - interval '13 hours'), "
              "('TEST_V1199_C', 'CRITICAL', '시험 새 안 풀림', '{\"test\":\"v1199\"}', now() - interval '2 minutes', NULL), "
              "('TEST_V1199_D', 'CRITICAL', '시험 새 풀림', '{\"test\":\"v1199\"}', now() - interval '3 minutes', NULL); "
              "UPDATE ops_alerts SET resolved_at = now(), resolve_note = '시험' WHERE detail->>'test' = 'v1199' AND title LIKE '%풀림' AND title NOT LIKE '%안 풀림'; "
              "SELECT 'M:' || coalesce(string_agg(title, '|' ORDER BY title), '') FROM fn_ops_alert_mail_pending(); "
              "SELECT 'A:' || coalesce(string_agg(title, '|' ORDER BY title), '') FROM fn_ops_alert_remail_pending(); ROLLBACK;")
    ok('② 풀린 알림은 메일 · 다시 메일에서 빠짐(확인 안 했어도)', 'M:시험 새 안 풀림' in g2 and 'A:시험 안 풀림' in g2, g2.replace('\n', ' ')[:160])

    # ── ③ API · 화면 ──────────────────────────────────────────────────
    import sys
    sys.path.insert(0, HERE)
    import consent_ok
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{ADMU}', '시험운영1199', '{pw}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{ADMU}'")
    keep = psql("SELECT string_agg(key || '=' || coalesce(value, '') || '=' || updated_at::text, '|' ORDER BY key) FROM site_settings WHERE key IN ('mall.order_open', 'assume.payment', 'mall.order_open_until')")
    t0 = psql('SELECT now()')
    try:
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 T1199', true); INSERT INTO account_roles(account_id, role) VALUES ('{aid}', 'ADMIN') ON CONFLICT DO NOTHING; COMMIT;")
        psql("UPDATE site_settings SET value = 'on' WHERE key = 'assume.payment'")
        psql("UPDATE site_settings SET value = 'off', updated_at = now() WHERE key = 'mall.order_open'")
        psql("UPDATE site_settings SET value = NULL WHERE key = 'mall.order_open_until'")
        for e in (ADMU, SUPU): consent_ok.agree(e, PW)
        TA = call('POST', '/auth/login', {'email': ADMU, 'password': PW}).get('accessToken')
        TS = call('POST', '/auth/login', {'email': SUPU, 'password': PW}).get('accessToken')
        P = lambda t, b: call('PATCH', '/admin/site-settings', b, t)
        sv = lambda k: psql(f"SELECT coalesce((SELECT value FROM site_settings WHERE key = '{k}'), '')")
        call('POST', '/admin/jobs', {'job': 'launch_watch'}, TS)   # 꺼진 상태로 한 번 — 앞서 남은 ORDER_OPEN_NO_END 를 풀어 둠(점검판은 처음에 주문 받기 켜짐)
        r1 = P(TS, {'key': 'mall.order_open_until', 'value': '2099-01-01T00:00:00Z'})
        r2 = P(TS, {'key': 'mall.order_open', 'value': 'on', 'reason': WHY, 'confirm': CONF, 'hours': 3})
        s0 = sv('mall.order_open')
        r3 = P(TS, {'key': 'mall.order_open', 'value': 'on', 'reason': WHY, 'confirm': CONF, 'hours': 1})
        u1 = psql("SELECT round(extract(epoch FROM value::timestamptz - now()) / 60) FROM site_settings WHERE key = 'mall.order_open_until'")
        pub = call('GET', '/site-settings/public')
        lw = call('GET', '/admin/launch-watch', None, TS)
        ok('③ 켜기 — 꺼질 시각 직접 못 고침(422 ORDER_UNTIL_AUTO) · 3시간은 못 고름(422 ORDER_OPEN_HOURS · 그대로 off) · 1시간이면 켜지고 꺼질 시각 ≈ 60분 뒤 · 공개 설정 · 지켜보기',
           r1.get('code') == 'ORDER_UNTIL_AUTO' and r2.get('code') == 'ORDER_OPEN_HOURS' and s0 == 'off' and not r3.get('_err') and sv('mall.order_open') == 'on'
           and u1 in ('59', '60') and pub.get('mall.order_open_until') and lw.get('orderOpenUntil') == pub.get('mall.order_open_until'),
           f'{r1.get("code")} {r2.get("code")} {s0} · {r3.get("_err")} · {u1} · {pub.get("mall.order_open_until")} · {lw.get("orderOpenUntil")}')
        if ADMIN_WEB:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1400, 'height': 1000}); errs = []
                pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', SUPU); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
                v = pg.evaluate("""() => ({
                    gos: [...document.querySelectorAll('[data-launch-watch] a.ad-tile[data-go]')].map(e => e.getAttribute('data-go')),
                    statics: document.querySelectorAll('[data-launch-watch] .ad-tile.static').length,
                    until: document.querySelector('[data-order-until]')?.textContent ?? '',
                    bar: document.querySelector('[data-order-live-until]')?.textContent ?? '' })""")
                pg.click('[data-launch-watch] a.ad-tile[data-go="ops-alerts"]'); pg.wait_for_timeout(2500)
                h1 = pg.evaluate("() => location.hash + '|' + !!document.querySelector('[data-ops-alerts]')")
                pg.goto(ADMIN_WEB + '/#/home', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                pg.click('[data-launch-watch] a.ad-tile[data-go="members"] >> nth=0'); pg.wait_for_timeout(2000)
                h2 = pg.evaluate('() => location.hash')
                b.close()
            need = {'members', 'community', 'queue', 'hlt-orders', 'ops-alerts', 'server-errors'}
            ok('③ 대시보드 — 칸 9개가 화면 링크(회원 2 · 글 검수 · 검수 큐 · 소개몰 주문 3 · 운영 알림 · 서버 오류) · 한도 걸림은 숫자만 · 누르면 그 화면 · 꺼질 시각 · 띠 · 오류 없음',
               need <= set(v['gos']) and sum(1 for x in v['gos'] if x in need) == 9 and v['statics'] >= 1 and '저절로 꺼짐' in v['until'] and '저절로 꺼짐' in v['bar']
               and h1 == '#/ops-alerts|true' and h2 == '#/members' and not errs, f'{v} · {h1} · {h2} · {errs[:2]}')

        # 꺼질 시각이 지난 것처럼(DB 로 시각만 앞당김) → 정기 작업이 끔
        mk = psql('SELECT coalesce(max(id), 0) FROM ops_alerts')
        psql("UPDATE site_settings SET value = to_char((now() - interval '1 minute') AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') WHERE key = 'mall.order_open_until'")
        j1 = call('POST', '/admin/jobs', {'job': 'launch_watch'}, TS)
        ex = psql(f"SELECT count(*) FROM ops_alerts WHERE id > {mk} AND alert_code = 'ORDER_OPEN_EXPIRED'")
        sc = psql(f"SELECT (detail->>'from') || '>' || (detail->>'to') || ':' || (detail->>'via') || ':' || (coalesce(detail->>'reason', '') LIKE '꺼질 시각(%이 지나 저절로 끔%')::text FROM ops_alerts WHERE id > {mk} AND alert_code = 'SETTING_CHANGED' AND detail->>'key' = 'mall.order_open' ORDER BY id DESC LIMIT 1")
        ok('③ 꺼질 시각 지남 → 정기 작업이 주문 받기를 끔 · 꺼질 시각 비움 · ORDER_OPEN_EXPIRED 1건 · 중요 설정 바뀜(on>off · via DB · 사유) · 작업 기록 EXPIRED',
           sv('mall.order_open') == 'off' and sv('mall.order_open_until') == '' and ex == '1' and sc == 'on>off:DB:true'
           and (j1.get('detail') or {}).get('orderGuard') == 'EXPIRED', f'{sv("mall.order_open")} · {ex} · {sc} · {(j1.get("detail") or {}).get("orderGuard")}')

        # 꺼질 시각 없이 켜진 채 2시간(DB 직접 · 옛 길) → CRITICAL 한 번 → 끄면 풀림
        mk = psql('SELECT coalesce(max(id), 0) FROM ops_alerts')
        psql("UPDATE site_settings SET value = 'on', updated_at = now() - interval '2 hours' WHERE key = 'mall.order_open'")
        j2 = call('POST', '/admin/jobs', {'job': 'launch_watch'}, TS)
        j3 = call('POST', '/admin/jobs', {'job': 'launch_watch'}, TS)
        ne = psql(f"SELECT count(*) || ':' || max(severity) FROM ops_alerts WHERE id > {mk} AND alert_code = 'ORDER_OPEN_NO_END'")
        r5 = P(TA, {'key': 'mall.order_open', 'value': 'off'})
        call('POST', '/admin/jobs', {'job': 'launch_watch'}, TS)
        rz = psql(f"SELECT count(*) FILTER (WHERE resolved_at IS NOT NULL) || ':' || count(*) FROM ops_alerts WHERE id > {mk} AND alert_code = 'ORDER_OPEN_NO_END'")
        cr = psql(f"SELECT count(*) FROM ops_alerts WHERE id > {mk} AND alert_code = 'ORDER_OPEN_NO_END' AND severity = 'CRITICAL' AND acknowledged_at IS NULL AND resolved_at IS NULL")
        ok('③ 꺼질 시각 없이 켜진 지 1시간 넘음 → CRITICAL ORDER_OPEN_NO_END 한 번(두 번 돌려도 1) · ADMIN 이 끄면 다음 작업에서 풀림 · 배포 점검 셈에서 빠짐',
           (j2.get('detail') or {}).get('orderGuard') == 'NO_END' and ne == '1:CRITICAL' and not r5.get('_err') and rz == '1:1' and cr == '0',
           f'{(j2.get("detail") or {}).get("orderGuard")} {(j3.get("detail") or {}).get("orderGuard")} · {ne} · {r5.get("_err")} · {rz} · {cr}')

        # 디스크 알림 풀림(점검판 디스크는 기준 85% 아래) · 목록 숨김 / 보기
        psql("INSERT INTO ops_alerts (alert_code, severity, title, detail) VALUES ('DISK_LOW', 'WARN', '시험 디스크 모자람', '{\"test\":\"v1199\", \"level\":\"T\"}')")
        j4 = call('POST', '/admin/jobs', {'job': 'launch_watch'}, TS)
        dz = psql("SELECT coalesce(resolve_note, '-') FROM ops_alerts WHERE detail->>'test' = 'v1199' AND alert_code = 'DISK_LOW'")
        l0 = call('GET', '/admin/ops-alerts?code=DISK_LOW', None, TS)
        l1 = call('GET', '/admin/ops-alerts?code=DISK_LOW&resolved=show', None, TS)
        it = next((x for x in l1.get('items', []) if x.get('title') == '시험 디스크 모자람'), {})
        cd = next((c for c in l0.get('codes', []) if c.get('code') == 'DISK_LOW'), {})
        ok('③ 풀림 — 디스크가 기준 아래면 DISK_LOW 풀림(까닭) · 목록 기본은 숨김(resolvedHidden) · resolved=show 면 resolvedAt · 종류별 풀림 수',
           dz.startswith('디스크 ') and not any(x.get('title') == '시험 디스크 모자람' for x in l0.get('items', [])) and l0.get('resolvedHidden', 0) >= 1
           and it.get('resolvedAt') and it.get('resolveNote') == dz and cd.get('resolved', 0) >= 1,
           f'{(j4.get("detail") or {}).get("resolved")} · {dz} · {l0.get("resolvedHidden")} · {it.get("resolvedAt")} · {cd}')
    finally:
        psql(f"DELETE FROM ops_alerts WHERE (detail->>'test' = 'v1199') OR (alert_code IN ('ORDER_OPEN_NO_END', 'ORDER_OPEN_EXPIRED') AND raised_at >= '{t0}')")
        for kv in (keep or '').split('|'):
            if kv.count('=') >= 2:
                k, v, at = kv.split('=', 2)
                psql(f"UPDATE site_settings SET value = {'NULL' if v == '' else f"'{v}'"}, updated_at = '{at}' WHERE key = '{k}'")

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
