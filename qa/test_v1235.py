"""v10.235 (docs/375) — 외부 연동 예상일 지남

  ① (코드) integrationOverdue(IP 신청일 + 기간 · LIVE 아님 · 비어 있으면 뺌) · 하루 요약 때 하루 한 번 한 건(INTEGRATION_OVERDUE · WARN) ·
     풀림(resolveAlerts) · 연동 목록 dueOn · overdue · DTO · 화면 예상일 칸 · IP 신청일 칸 · 알림 이름 · 문서 375 · 판 v10.235 이상
  ② (API · DB) 연동 값을 적어 두고 → LIVE 아닌 연동은 신청일을 오늘로(지남 없음) · 전자계약(ESIGN)만 10주 전 신청 · 2주 →
     목록 overdue 는 ESIGN 하나 · dueOn = 8주 전(한국 날짜) · 하루 요약 → 알림 1건(WARN · 이름 · 「일 지남」 · items 1) ·
     한 번 더 → 그대로 1건 · ESIGN 신청일을 오늘로 → 지켜보기 → 「풀림」 · 끝에 연동 값 되돌림 · 시험 알림 지움
  ③ (화면) 외부 연동 표 「예상일」 칸 · ESIGN 「지남」 빨간 글씨 · IP 신청일 칸
"""
import json, os, re, subprocess, time, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ──────────────────────────────────────────────────────────────
LW, SC = rd('src/modules/admin/launch-watch.service.ts'), rd('src/worker/scheduler.service.ts')
ok('① 셈 · 알림 · 풀림 — IP 신청일 + 기간 · LIVE 아님 · 비면 뺌 · 하루 한 번 한 건 WARN · 지난 연동 0 이면 풀림',
   'async integrationOverdue()' in LW and "status <> 'LIVE' AND ip_requested_at IS NOT NULL AND lead_time_weeks IS NOT NULL" in LW
   and 'ip_requested_at + make_interval(weeks => lead_time_weeks) < now()' in LW
   and "if (!(await this.integrationOverdue()).length) await run('INTEGRATION_OVERDUE', '예상일 지난 외부 연동이 없어짐');" in LW
   and 'const io = await this.launchWatch.integrationOverdue();' in SC and "await this.alert('INTEGRATION_OVERDUE', 'WARN'," in SC
   and "alert_code = 'INTEGRATION_OVERDUE' AND (raised_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date" in SC
   and SC.index("case 'launch_digest'") < SC.index('const io = await this.launchWatch.integrationOverdue();'), '')
SS, DT = rd('src/modules/site/site.service.ts'), rd('src/modules/site/site.dto.ts')
IT, OA = rd('web/src/app/admin/Integrations.tsx'), rd('web/src/app/admin/OpsAlerts.tsx')
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('375_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 목록 · DTO · 화면 · 알림 이름 · 문서 375 · 판 v10.235 이상',
   'AS "dueOn"' in SS and 'IS TRUE AS overdue' in SS and 'dueOn!: string | null;' in DT and 'overdue!: boolean;' in DT
   and '<th>예상일</th>' in IT and 'data-int-due={r.code}' in IT and 'data-int-requested={r.code}' in IT and "patch(r.code, { ipRequestedAt: e.target.value })" in IT
   and "INTEGRATION_OVERDUE: '외부 연동 예상일 지남'" in OA
   and bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 235), f'{DOC} · {rd("VERSION").strip()}')


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        raw = urllib.request.urlopen(r, timeout=180).read()
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
    consent_ok.agree('admin@x.com', PW)
    TS = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    t0 = psql("SELECT now()")
    # 연동 값을 적어 둠(끝에 되돌림)
    saved = psql("SELECT json_agg(json_build_object('c', code, 'r', ip_requested_at, 'w', lead_time_weeks) ORDER BY code) FROM integrations")
    ok('② 연동 값 적어 둠', not saved.startswith('!') and saved.startswith('['), saved[:80])
    rows = json.loads(saved) if saved.startswith('[') else []
    esign = psql("SELECT status FROM integrations WHERE code = 'ESIGN'")
    try:
        # 오늘 생긴 같은 알림을 치움(하루 한 번 규칙 — 같은 날 다시 돌려도 새로 남게)
        psql("DELETE FROM ops_alerts WHERE alert_code = 'INTEGRATION_OVERDUE' AND (raised_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date")
        u1 = psql("UPDATE integrations SET ip_requested_at = now() WHERE status <> 'LIVE'")
        u2 = psql("UPDATE integrations SET ip_requested_at = now() - interval '10 weeks', lead_time_weeks = 2 WHERE code = 'ESIGN' AND status <> 'LIVE'")
        ok('② 준비 — LIVE 아닌 연동 신청일 오늘 · ESIGN 만 10주 전 · 2주(ESIGN 이 LIVE 가 아니어야 함)', not u1.startswith('!') and not u2.startswith('!') and esign not in ('LIVE', ''), f'{esign} · {u1}{u2}')
        li = call('GET', '/admin/integrations', None, TS)
        li = li if isinstance(li, list) else []
        od = [x['code'] for x in li if x.get('overdue')]
        want = psql("SELECT to_char((now() - interval '8 weeks') AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')")
        es = next((x for x in li if x['code'] == 'ESIGN'), {})
        ok('② 목록 — 지남은 ESIGN 하나 · dueOn = 8주 전(한국 날짜) · 신청일 없는 연동 dueOn 은 비거나 날짜',
           od == ['ESIGN'] and es.get('dueOn') == want and all(isinstance(x.get('overdue'), bool) for x in li), f'{od} · {es.get("dueOn")}/{want}')
        j1 = call('POST', '/admin/jobs', {'job': 'launch_digest'}, TS)
        a1 = psql("SELECT count(*) || '|' || max(severity) || '|' || max(detail->'items'->0->>'code') || '|' || (max(title) LIKE '%일 지남%')::text || '|' || jsonb_array_length(max(detail::text)::jsonb->'items') FROM ops_alerts WHERE alert_code = 'INTEGRATION_OVERDUE' AND raised_at >= '" + t0 + "'")
        nm = psql("SELECT name FROM integrations WHERE code = 'ESIGN'")
        tt = psql("SELECT title FROM ops_alerts WHERE alert_code = 'INTEGRATION_OVERDUE' AND raised_at >= '" + t0 + "' ORDER BY id DESC LIMIT 1")
        ok('② 하루 요약 → 알림 1건 · WARN · ESIGN · 「일 지남」 · items 1 · 제목에 연동 이름', a1 == '1|WARN|ESIGN|true|1' and nm in tt, f"{j1.get('_err')} · {a1} · {tt[:80]}")
        call('POST', '/admin/jobs', {'job': 'launch_digest'}, TS)
        a2 = psql("SELECT count(*) FROM ops_alerts WHERE alert_code = 'INTEGRATION_OVERDUE' AND raised_at >= '" + t0 + "'")
        ok('② 한 번 더 돌려도 그대로 1건(하루 한 번)', a2 == '1', a2)
        call('POST', '/admin/jobs', {'job': 'launch_watch'}, TS)
        r0 = psql("SELECT count(*) FILTER (WHERE resolved_at IS NULL) FROM ops_alerts WHERE alert_code = 'INTEGRATION_OVERDUE' AND raised_at >= '" + t0 + "'")
        psql("UPDATE integrations SET ip_requested_at = now() WHERE code = 'ESIGN'")
        call('POST', '/admin/jobs', {'job': 'launch_watch'}, TS)
        r1 = psql("SELECT count(*) FILTER (WHERE resolved_at IS NULL) || '|' || max(resolve_note) FROM ops_alerts WHERE alert_code = 'INTEGRATION_OVERDUE' AND raised_at >= '" + t0 + "'")
        ok('② 지난 연동이 있으면 풀리지 않음 · 없어지면 지켜보기가 「풀림」', r0 == '1' and r1 == '0|예상일 지난 외부 연동이 없어짐', f'{r0} · {r1}')
        # ③ 화면은 지남이 보이게 ESIGN 을 다시 10주 전으로
        psql("UPDATE integrations SET ip_requested_at = now() - interval '10 weeks', lead_time_weeks = 2 WHERE code = 'ESIGN' AND status <> 'LIVE'")
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
                pg.goto(ADMIN_WEB + '/#/integrations', wait_until='networkidle', timeout=120000)
                pg.reload(wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                cell = pg.locator('[data-int-due="ESIGN"]')
                seen = (pg.locator('th', has_text='예상일').count() >= 1, cell.count(), cell.first.get_attribute('data-overdue') if cell.count() else None,
                        '지남' in (cell.first.inner_text() if cell.count() else ''), pg.locator('[data-int-requested="ESIGN"]').count())
                pg.screenshot(path=os.path.join(HERE, 'v1235_integrations.png'), full_page=False)
                b.close()
            ok('③ 외부 연동 표 「예상일」 · ESIGN 「지남」 · IP 신청일 칸 · 화면 오류 없음', seen == (True, 1, '1', True, 1) and not errs, f'{seen} · {errs[:2]}')
        else:
            print('  (운영 화면 · playwright 없음 — ③ 건너뜀)')
    finally:
        for x in rows:
            r = 'NULL' if x['r'] is None else f"'{x['r']}'::timestamptz"
            w = 'NULL' if x['w'] is None else str(int(x['w']))
            psql(f"UPDATE integrations SET ip_requested_at = {r}, lead_time_weeks = {w} WHERE code = '{x['c']}'")
        back = psql("SELECT json_agg(json_build_object('c', code, 'r', ip_requested_at, 'w', lead_time_weeks) ORDER BY code) FROM integrations")
        ok('② 연동 값 되돌림', json.loads(back) == rows if back.startswith('[') else False, '')
        psql("DELETE FROM ops_alerts WHERE alert_code = 'INTEGRATION_OVERDUE' AND raised_at >= '" + t0 + "'")
else:
    print('  (API · DB 없음 — ② · ③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
