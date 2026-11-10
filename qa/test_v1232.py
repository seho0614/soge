"""v10.232 (docs/371) — 운영 알림 한꺼번에 확인

  ① (코드) 서비스 ackBulk(풀린 것 · 6 · 24 · 72시간 넘은 INFO · WARN · CRITICAL 늘 뺌 · 확인 안 한 것만 · 미리 보기) ·
     API GET ack-bulk/preview · POST ack-bulk(ADMIN · SUPER · 감사 OPS_ALERT_ACK_BULK) · 화면 한 줄 · 명세 · 영어 · 문서 371
  ② (API · DB) 회원 403 · 잘못된 범위 422 ACK_BULK_SCOPE · 시험 알림(직접 만듦 · 이번 실행 표시) — 미리 보기 수 = DB ·
     풀린 것만 확인 · 오래된 INFO · WARN 만 확인 · CRITICAL · 새 것 · 이미 확인한 것 그대로 · 메모 · 감사 기록 · 끝에 시험 알림 「풀림」으로 정리
  ③ (화면) 「운영 알림」 종류별 표 위 「한꺼번에 확인」 한 줄 · 단추 둘 · 시간 고르기
"""
import json, os, re, subprocess, time, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []
PW = 'sgb-dev-1234'
RPW = 'sgb-test-1234'      # ops@t.local(ADMIN)


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ──────────────────────────────────────────────────────────────
SV, CT = rd('src/modules/admin/ops-alerts.service.ts'), rd('src/modules/admin/ops-review.controller.ts')
ok('① 서비스 · API — 풀린 것 · 6 · 24 · 72시간 · CRITICAL 늘 뺌 · 확인 안 한 것만 · 미리 보기 · ADMIN · SUPER · 감사',
   'async ackBulk(scope: string, hours?: number, note?: string, preview = false)' in SV and "severity <> 'CRITICAL'" in SV and 'acknowledged_at IS NULL' in SV
   and "'ACK_BULK_SCOPE'" in SV and '[6, 24, 72].includes(hours ?? -1)' in SV and 'make_interval(hours => $1::int)' in SV
   and "@Get('ops-alerts/ack-bulk/preview')" in CT and "@Post('ops-alerts/ack-bulk')" in CT and "@Audit('OPS_ALERT_ACK_BULK', 'OPS_ALERT')" in CT
   and CT.index("@Post('ops-alerts/ack-bulk')") < CT.index("@Post('ops-alerts/:id/ack')") and 'export class OpsAlertAckBulkResultDto' in CT, '')
OA = rd('web/src/app/admin/OpsAlerts.tsx')
EN = rd('src/common/i18n/server-text.en.ts')
SJ = json.loads(rd('spec/screens.json') or '{"screens":[]}'); sc = {s['id']: s for s in SJ.get('screens', [])}
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('371_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 화면 · 명세 · 영어 · 문서 371 · 판 v10.232 이상',
   'data-ack-bulk=""' in OA and 'data-ack-bulk-resolved=""' in OA and 'data-ack-bulk-older=""' in OA and 'data-ack-bulk-hours=""' in OA
   and "/admin/ops-alerts/ack-bulk/preview?" in OA
   and {'GET /admin/ops-alerts/ack-bulk/preview', 'POST /admin/ops-alerts/ack-bulk'} <= set(sc.get('SB-ADM-OPS-010', {}).get('apis', []))
   and '"풀린 것(resolved) 또는 6 · 24 · 72시간 넘은 것(older)만 고를 수 있습니다."' in EN and '"{0}건을 확인하게 됩니다(CRITICAL 은 빼고)."' in EN
   and bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 232), f'{DOC} · {rd("VERSION").strip()}')


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
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


# ── ② API · DB ──────────────────────────────────────────────────────────
if API and DB:
    import sys
    sys.path.insert(0, HERE)
    import consent_ok
    for e in ('admin@x.com', 'buyer@x.com'): consent_ok.agree(e, PW)
    TS = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    TA = call('POST', '/auth/login', {'email': 'ops@t.local', 'password': RPW}).get('accessToken')
    TB = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW}).get('accessToken')
    tag = f't1232-{int(time.time())}'
    t0 = psql("SELECT now()")
    # 시험 알림(ops_alerts 는 (alert_code, raised_at) 고유 — 같은 종류는 시각을 1초씩 달리): 풀린 WARN · 풀린 CRITICAL · 30시간 전 INFO · 30시간 전 WARN · 30시간 전 CRITICAL · 방금 WARN · 30시간 전 이미 확인한 WARN
    ins = psql("INSERT INTO ops_alerts (alert_code, severity, raised_at, title, resolved_at, acknowledged_at) VALUES "
         f"('T1232_RES', 'WARN', now() - interval '1 hour', '{tag} res-warn', now(), NULL), "
         f"('T1232_RES', 'CRITICAL', now() - interval '1 hour' - interval '1 second', '{tag} res-crit', now(), NULL), "
         f"('T1232_OLD', 'INFO', now() - interval '30 hours', '{tag} old-info', NULL, NULL), "
         f"('T1232_OLD', 'WARN', now() - interval '30 hours' - interval '1 second', '{tag} old-warn', NULL, NULL), "
         f"('T1232_OLD', 'CRITICAL', now() - interval '30 hours' - interval '2 seconds', '{tag} old-crit', NULL, NULL), "
         f"('T1232_NEW', 'WARN', now(), '{tag} new-warn', NULL, NULL), "
         f"('T1232_OLD', 'WARN', now() - interval '30 hours' - interval '3 seconds', '{tag} old-acked', NULL, now() - interval '29 hours')")
    ok('② 시험 알림 7건 넣음(같은 종류는 시각을 1초씩 달리 — ops_alerts 고유 (alert_code, raised_at))', not ins.startswith('!'), ins[:160])
    st = lambda: psql(f"SELECT string_agg(split_part(title, ' ', 2) || '=' || (acknowledged_at IS NOT NULL)::text, ',' ORDER BY id) FROM ops_alerts WHERE title LIKE '{tag} %'")
    try:
        rb = call('POST', '/admin/ops-alerts/ack-bulk', {'scope': 'resolved'}, TB)
        rx = call('POST', '/admin/ops-alerts/ack-bulk', {'scope': 'older', 'hours': 5}, TA)
        rp = call('GET', '/admin/ops-alerts/ack-bulk/preview?scope=older&hours=7', None, TA)
        ok('② 회원 403 · 잘못된 범위 422 ACK_BULK_SCOPE(본문 hours 5 · 미리 보기 hours 7)',
           rb.get('_err') == 403 and rx.get('_err') in (400, 422) and (rp.get('_err'), rp.get('code')) == (422, 'ACK_BULK_SCOPE'),
           f"{rb.get('_err')} · {rx.get('_err')} {rx.get('code')} · {rp.get('_err')} {rp.get('code')}")
        db_res = psql("SELECT count(*) FROM ops_alerts WHERE acknowledged_at IS NULL AND severity <> 'CRITICAL' AND resolved_at IS NOT NULL")
        pv = call('GET', '/admin/ops-alerts/ack-bulk/preview?scope=resolved', None, TA)
        same = st()
        r1 = call('POST', '/admin/ops-alerts/ack-bulk', {'scope': 'resolved', 'note': f'{tag} 풀린 것 정리'}, TA)
        s1 = st()
        ok('② 풀린 것 — 미리 보기 수 = DB · 미리 보기는 바꾸지 않음 · 풀린 WARN 만 확인(풀린 CRITICAL 그대로)',
           pv.get('count') == int(db_res or -1) and int(db_res or 0) >= 1 and same.startswith('res-warn=false') and r1.get('count') == int(db_res)
           and s1 == 'res-warn=true,res-crit=false,old-info=false,old-warn=false,old-crit=false,new-warn=false,old-acked=true',
           f"{pv.get('count')}/{db_res} · {r1.get('count')} · {s1}")
        db_old = psql("SELECT count(*) FROM ops_alerts WHERE acknowledged_at IS NULL AND severity <> 'CRITICAL' AND raised_at < now() - interval '24 hours'")
        pv2 = call('GET', '/admin/ops-alerts/ack-bulk/preview?scope=older&hours=24', None, TA)
        r2 = call('POST', '/admin/ops-alerts/ack-bulk', {'scope': 'older', 'hours': 24, 'note': f'{tag} 오래된 것'}, TA)
        s2 = st()
        notes = psql(f"SELECT string_agg(coalesce(ack_note, '-'), '|' ORDER BY id) FROM ops_alerts WHERE title LIKE '{tag} %' AND acknowledged_at > now() - interval '1 hour'")
        ok('② 24시간 넘은 INFO · WARN — 미리 보기 수 = DB · INFO · WARN 만 확인 · CRITICAL · 새 것 · 이미 확인한 것 그대로 · 메모',
           pv2.get('count') == int(db_old or -1) and r2.get('count') == int(db_old or -1) and r2.get('hours') == 24
           and s2 == 'res-warn=true,res-crit=false,old-info=true,old-warn=true,old-crit=false,new-warn=false,old-acked=true'
           and notes == f'{tag} 풀린 것 정리|{tag} 오래된 것|{tag} 오래된 것', f"{pv2.get('count')}/{db_old} · {r2.get('count')} · {s2} · {notes}")
        time.sleep(1)
        aud = psql(f"SELECT count(*) FROM audit.audit_logs WHERE action = 'OPS_ALERT_ACK_BULK' AND occurred_at >= '{t0}'")
        r3 = call('POST', '/admin/ops-alerts/ack-bulk', {'scope': 'older', 'hours': 24}, TA)
        ok('② 감사 기록 2건(미리 보기는 남지 않음) · 다시 누르면 0건', aud == '2' and r3.get('count') == 0, f'{aud} · {r3.get("count")}')
    finally:
        psql(f"UPDATE ops_alerts SET resolved_at = coalesce(resolved_at, now()), resolve_note = coalesce(resolve_note, '시험 알림 정리(test_v1232)') WHERE title LIKE '{tag} %'")

    # ── ③ 화면 ──
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if ADMIN_WEB and sync_playwright:
        errs = []
        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = b.new_page(viewport={'width': 1400, 'height': 900})
            pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
            pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
            pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
            pg.goto(ADMIN_WEB + '/#/ops-alerts', wait_until='networkidle', timeout=120000)
            pg.reload(wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
            box = pg.locator('[data-ack-bulk]')
            seen = (box.count(), pg.locator('[data-ack-bulk-resolved]').count(), pg.locator('[data-ack-bulk-older]').count(),
                    pg.locator('[data-ack-bulk-hours] option').count(), 'CRITICAL 은 빼고' in (box.inner_text() if box.count() else ''))
            pg.screenshot(path=os.path.join(HERE, 'v1232_ack_bulk.png'), full_page=False)
            b.close()
        ok('③ 「운영 알림」 한꺼번에 확인 한 줄 · 단추 둘 · 시간 3개 · 화면 오류 없음', seen == (1, 1, 1, 3, True) and not errs, f'{seen} · {errs[:2]}')
    else:
        print('  (운영 화면 · playwright 없음 — ③ 건너뜀)')
else:
    print('  (API · DB 없음 — ② · ③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
