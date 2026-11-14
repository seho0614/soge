"""v10.241 ~ v10.243 (D201 · docs/381) — 대표 할 일 직접 확인 줄 「끝남」 기록 · 정기 점검 기한 줄 · 시행일 앞 약관 안내

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1241.py

  ① (코드) D201 audit.owner_todo_marks(쌓기만 · fn_block_write) · 서비스 mark(SUPER · 메모 5자) · API · 쌓기만 목록 · 정기 점검 3줄 ·
     termsSoon · termsAlerts · 정기 작업 TERMS_EFFECTIVE_SOON · _TODAY · 하루 요약 줄 · 화면 「적기」 · 명세 · 영어 · 문서 381 · 판 v10.243 이상
  ② (API) 대표 할 일 15줄 · 직접 확인 3줄 manual · ADMIN 403 · 잘못된 줄 · 메모 짧음 400 · SUPER 끝남 → ✓ 끝남 · 다시 아직 → ○ · 고치기 · 지우기 막힘 · 감사 기록
  ③ (API) 정기 점검 3줄이 DB(지난달 · 지난 분기 점검 · 열린 권리 요청)와 맞음
  ④ (정기 작업) 시험 약관 2개(첫 판 2일 뒤 · 새 판 오늘 · 판 번호 9.x — 1.0 게시 판은 DB 가 못 지우게 함) → 하루 요약 줄 · TERMS_EFFECTIVE_SOON 1 · _TODAY 1 · 다시 돌려도 그대로(판마다 한 번)
  ⑤ (화면) 대표 할 일 15줄 · 직접 확인 줄 「적기」 · 끝남으로
  두 번 돌아도 통과 — 기록은 지울 수 없어 「가장 최근 줄」만 봄 · 시험 약관 · 시험 알림은 지움.
"""
import json, os, re, subprocess, time, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB = os.environ.get('ADMIN_WEB')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []
PW = 'sgb-dev-1234'          # admin@x.com(SUPER)
RPW = 'sgb-test-1234'        # ops@t.local(ADMIN)


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ──────────────────────────────────────────────────────────────
MIG = rd('prisma/migrations/D201_owner_todo_marks/migration.sql')
OT, CT, LW, SC = (rd('src/modules/admin/owner-todo.service.ts'), rd('src/modules/admin/launch-watch.controller.ts'),
                  rd('src/modules/admin/launch-watch.service.ts'), rd('src/worker/scheduler.service.ts'))
ST, EN, DBS = rd('web/src/app/admin/StateCheck.tsx'), rd('src/common/i18n/server-text.en.ts'), rd('src/db/database.service.ts')
SJ = json.loads(rd('spec/screens.json') or '{"screens":[]}')
ok('① D201 — audit.owner_todo_marks(plans · legal · ebs · 메모 5 ~ 500자) · 고치기 · 지우기 막음 · 지우는 문장 없음 · 쌓기만 목록',
   'CREATE TABLE IF NOT EXISTS audit.owner_todo_marks' in MIG and "item_key IN ('plans', 'legal', 'ebs')" in MIG and 'BETWEEN 5 AND 500' in MIG
   and 'BEFORE DELETE OR UPDATE ON audit.owner_todo_marks' in MIG and 'fn_block_write' in MIG and 'DROP TABLE' not in MIG and 'DELETE FROM' not in MIG
   and "'audit.owner_todo_marks'" in DBS, '')
ok('① 직접 확인 적기 — 서비스 mark(줄 · 끝남 · 메모 검사) · POST owner-todo/mark SUPER · 감사 OWNER_TODO_MARK · 가장 최근 줄 · 명세 · 영어',
   'async mark(key: unknown, done: unknown, note: unknown)' in OT and "'OWNER_TODO_KEY'" in OT and "'OWNER_TODO_NOTE'" in OT and 'DISTINCT ON (m.item_key)' in OT
   and "@Post('owner-todo/mark')" in CT and "@Audit('OWNER_TODO_MARK', 'OWNER_TODO')" in CT
   and any('POST /admin/launch-watch/owner-todo/mark' in s.get('apis', []) for s in SJ.get('screens', []))
   and all(k in EN for k in ('"직접 확인 줄(요금제 · 법무 · EBS)만 적을 수 있습니다."', '"메모를 5 ~ 500자로 적어 주십시오."', '"끝남으로 적었습니다."')), '')
ok('① 정기 점검 3줄 — 지난달 개인정보 접속기록 · 지난 분기 운영자 권한 · 기한 2일 안 권리 요청 · 탭',
   all(f"key: '{k}'" in OT for k in ('pii-review', 'role-review', 'privacy-due')) and "go: 'privacy-requests'" in OT
   and 'audit.pii_reviews' in OT and 'audit.role_reviews' in OT, '')
ok('① 약관 시행 안내 — termsSoon(0 ~ 3일) · termsAlerts(판마다 한 번) · 정기 작업 SOON · TODAY(INFO) · 하루 요약 줄 · 운영 알림 이름',
   'async termsSoon()' in LW and 'BETWEEN 0 AND 3' in LW and 'async termsAlerts()' in LW and '...termsLine(await this.termsSoon())' in LW
   and "this.alert('TERMS_EFFECTIVE_SOON', 'INFO'" in SC and "this.alert('TERMS_EFFECTIVE_TODAY', 'INFO'" in SC
   and "TERMS_EFFECTIVE_SOON: '약관 시행 3일 안'" in rd('web/src/app/admin/OpsAlerts.tsx'), '')
ok('① 화면 — 직접 확인 줄 「적기」(SUPER) · 끝남으로 · 다시 아직', 'data-owner-mark=' in ST and 'data-owner-mark-done=' in ST and 'data-owner-mark-undo=' in ST
   and "/admin/launch-watch/owner-todo/mark" in ST, '')
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('381_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 문서 381 · 판 v10.243 이상', bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 243), f'{DOC} · {rd("VERSION").strip()}')


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


if API and DB:
    import sys
    sys.path.insert(0, HERE)
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    TA = call('POST', '/auth/login', {'email': 'ops@t.local', 'password': RPW}).get('accessToken')
    t0 = psql("SELECT now()")
    todo = lambda: call('GET', '/admin/launch-watch/owner-todo', None, TS)

    # ── ② 직접 확인 적기 ──
    d0 = todo(); r0 = {r['key']: r for r in d0.get('rows', [])}
    man = [r['key'] for r in d0.get('rows', []) if r.get('manual')]
    ok('② 대표 할 일 15줄 · 직접 확인 3줄(manual) · 전체 15 · 끝남 = ✓ 인 줄 수',
       len(r0) in (15, 19) and d0.get('total') in (15, 19) and man in (['plans', 'legal', 'ebs'], ['plans', 'legal', 'ebs', 'rate-legal']) and d0.get('done') == sum(1 for r in d0.get('rows', []) if r.get('done') is True),
       f"{d0.get('done')} / {d0.get('total')} · {man}")
    ra = call('POST', '/admin/launch-watch/owner-todo/mark', {'key': 'plans', 'done': True, 'note': '시험 1241 금액 확정'}, TA)
    r1 = call('POST', '/admin/launch-watch/owner-todo/mark', {'key': 'channels', 'done': True, 'note': '시험 1241 잘못된 줄'}, TS)
    r2 = call('POST', '/admin/launch-watch/owner-todo/mark', {'key': 'plans', 'done': True, 'note': '짧음'}, TS)
    ok('② 적기 — ADMIN 403 · 자동 줄 400 · 메모 4자 400(입력 검사 VALIDATION_ERROR)', ra.get('_err') == 403 and r1.get('_err') == 400 and r2.get('_err') == 400 and r1.get('code') == r2.get('code') == 'VALIDATION_ERROR',
       f"{ra.get('_err')} · {r1.get('_err')} {r1.get('code')} · {r2.get('_err')} {r2.get('code')}")
    r3 = call('POST', '/admin/launch-watch/owner-todo/mark', {'key': 'plans', 'done': True, 'note': '시험 1241 요금제 금액 확정'}, TS)
    d1 = todo(); p1 = {r['key']: r for r in d1.get('rows', [])}.get('plans', {})
    ok('② SUPER 끝남 → 요금제 줄 ✓ 끝남 · 메모 · 누가 · 끝남 수 +1(전에 끝남이 아니었으면)',
       r3.get('ok') is True and p1.get('done') is True and p1.get('manual') is True and '시험 1241 요금제 금액 확정' in p1.get('now', '') and p1.get('now', '').startswith('끝남 — ')
       and (p1.get('mark') or {}).get('done') is True and d1.get('done') == d0.get('done') + (0 if r0.get('plans', {}).get('done') is True else 1),
       f"{p1.get('now', '')[:80]} · {d0.get('done')} → {d1.get('done')}")
    r4 = call('POST', '/admin/launch-watch/owner-todo/mark', {'key': 'plans', 'done': False, 'note': '시험 1241 금액 다시 정함'}, TS)
    p2 = {r['key']: r for r in todo().get('rows', [])}.get('plans', {})
    ok('② 다시 아직 → ○ 아직(done false) · 가장 최근 줄이 상태', r4.get('ok') is True and p2.get('done') is False and p2.get('now', '').startswith('다시 아직 — '),
       p2.get('now', '')[:80])
    up = psql("UPDATE audit.owner_todo_marks SET note = '고침 시험' WHERE id = (SELECT max(id) FROM audit.owner_todo_marks)")
    de = psql("DELETE FROM audit.owner_todo_marks WHERE id = (SELECT max(id) FROM audit.owner_todo_marks)")
    time.sleep(1)
    aud = psql(f"SELECT count(*) FROM audit.audit_logs WHERE action = 'OWNER_TODO_MARK' AND occurred_at >= '{t0}'")
    nn = psql(f"SELECT count(*) FROM audit.owner_todo_marks WHERE marked_at >= '{t0}' AND note LIKE '시험 1241%'")
    ok('② 기록은 고치기 · 지우기 막힘 · 쌓인 줄 2 · 감사 기록 OWNER_TODO_MARK 2(성공한 것만)', up.startswith('!') and de.startswith('!') and nn == '2' and aud == '2',
       f'고치기 {up[:50]} · 지우기 {de[:30]} · 줄 {nn} · 감사 {aud}')

    # ── ③ 정기 점검 3줄 ──
    rr = {r['key']: r for r in todo().get('rows', [])}
    pm = psql("SELECT to_char((date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') - interval '1 month'), 'YYYY-MM') || '|' || "
              "EXISTS (SELECT 1 FROM audit.pii_reviews WHERE month = (date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') - interval '1 month')::date)")
    pq = psql("SELECT EXISTS (SELECT 1 FROM audit.role_reviews WHERE quarter = (date_trunc('quarter', now() AT TIME ZONE 'Asia/Seoul') - interval '3 months')::date)")
    pr = psql("SELECT count(*) FILTER (WHERE status IN ('OPEN','EXTENDED')) || '|' || count(*) FILTER (WHERE status IN ('OPEN','EXTENDED') AND due_on - (now() AT TIME ZONE 'Asia/Seoul')::date <= 2) FROM privacy_requests")
    mon, mdone = (pm.split('|') + ['', ''])[:2]
    ro, rs = (pr.split('|') + ['', ''])[:2]
    a, b, c = rr.get('pii-review', {}), rr.get('role-review', {}), rr.get('privacy-due', {})
    ok('③ 정기 점검 3줄 — DB 와 맞음(지난달 · 지난 분기 점검 · 열린 권리 요청 · 기한 2일 안) · 기한 날짜 · 보러 가기 탭',
       a.get('done') is (mdone in ('t', 'true')) and mon in a.get('now', '') and (a.get('done') or '기한 ' in a.get('now', '')) and a.get('go') == 'pii-review'
       and b.get('done') is (pq in ('t', 'true')) and (b.get('done') or '기한 ' in b.get('now', '')) and b.get('go') == 'role-review'
       and c.get('done') is (rs == '0') and (('열린 요청 없음' in c.get('now', '')) if ro == '0' else f'열린 요청 {ro}' in c.get('now', '')) and c.get('go') == 'privacy-requests',
       f"{a.get('now')} · {b.get('now')} · {c.get('now')} · DB {pm} {pq} {pr}")

    # ── ④ 시행일 앞 약관 안내 ──
    clean = lambda: (psql(f"DELETE FROM ops_alerts WHERE alert_code IN ('TERMS_EFFECTIVE_SOON', 'TERMS_EFFECTIVE_TODAY') AND detail->'keys' ?| array['T1241A:9.1', 'T1241B:9.1']"),
                     psql("DELETE FROM terms WHERE code IN ('T1241A', 'T1241B')"))
    try:
        clean()
        ins = psql("""INSERT INTO terms(code, version, title, body, is_required, effective_from, status, display_order) VALUES
          ('T1241A', '9.1', '시험약관가', '시험 본문', false, ((now() AT TIME ZONE 'Asia/Seoul')::date + 2)::timestamp AT TIME ZONE 'Asia/Seoul' + interval '1 hour', 'PUBLISHED', 9998),
          ('T1241B', '9.0', '시험약관나', '시험 본문', false, now() - interval '30 days', 'PUBLISHED', 9999),
          ('T1241B', '9.1', '시험약관나', '시험 본문 2', false, ((now() AT TIME ZONE 'Asia/Seoul')::date)::timestamp AT TIME ZONE 'Asia/Seoul', 'PUBLISHED', 9999)""")
        dg = call('GET', '/admin/launch-watch/digest', None, TS).get('text') or ''
        line = next((l for l in dg.splitlines() if l.startswith('약관 시행 예정(3일 안)')), '')
        ok('④ 하루 요약 — 「약관 시행 예정(3일 안)」 줄 · 첫 판 2일 뒤(본문 시행일) · 새 판 오늘(앞 판이 바뀜)',
           not ins.startswith('!') and (('시험약관가 9.1' in line and '2일 뒤 · 첫 판' in line and '시험약관나 9.1' in line and '오늘 · 새 판' in line) or '종 —' in line),
           line[:200] or ins[:120])
        job = lambda: call('POST', '/admin/jobs', {'job': 'launch_digest'}, TS)
        cnt = lambda: psql("SELECT alert_code || ':' || severity || ':' || (detail->>'keys') FROM ops_alerts WHERE alert_code IN ('TERMS_EFFECTIVE_SOON', 'TERMS_EFFECTIVE_TODAY') "
                           "AND detail->'keys' ?| array['T1241A:9.1', 'T1241B:9.1'] ORDER BY alert_code")
        j1 = job(); c1 = cnt()
        ttl = psql("SELECT alert_code || ' ' || title FROM ops_alerts WHERE alert_code IN ('TERMS_EFFECTIVE_SOON', 'TERMS_EFFECTIVE_TODAY') AND detail->'keys' ?| array['T1241A:9.1', 'T1241B:9.1'] ORDER BY alert_code")
        ok('④ 정기 작업(하루 요약) — TERMS_EFFECTIVE_SOON(시험약관가) 1 · _TODAY(시험약관나 9.1) 1 · INFO · 제목',
           j1.get('_err') is None and len(c1.splitlines()) == 2 and 'TERMS_EFFECTIVE_SOON:INFO' in c1 and 'T1241A:9.1' in c1.splitlines()[0]
           and 'TERMS_EFFECTIVE_TODAY:INFO' in c1.splitlines()[1] and 'T1241B:9.1' in c1.splitlines()[1]
           and '첫 판이라 동의 기준은 그대로' in ttl and '오늘 시행 — 약관' in ttl and '새 판은 그날부터 지금 판' in ttl, f'{c1} · {ttl[:200]}')
        time.sleep(1.2)
        job(); c2 = cnt()
        ok('④ 다시 돌려도 그대로(약관 · 판마다 한 번)', c2 == c1, c2)
    finally:
        clean()
    ok('④ 정리 — 시험 약관 · 시험 알림 없음', psql("SELECT count(*) FROM terms WHERE code IN ('T1241A', 'T1241B')") == '0', '')

    # ── ⑤ 화면 ──
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if ADMIN_WEB and sync_playwright:
        errs = []
        with sync_playwright() as p:
            b_ = p.chromium.launch()
            pg = b_.new_page(viewport={'width': 1400, 'height': 900})
            pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
            pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
            pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
            rows = pg.locator('[data-owner-row]').count()
            marks = pg.locator('[data-owner-mark]').count()
            pg.click('[data-owner-mark="ebs"]')
            pg.fill('[data-owner-mark-form="ebs"] input[name=owner-note]', '시험 1241 화면 EBS 예약 확인')
            pg.click('[data-owner-mark-done="ebs"]'); pg.wait_for_timeout(2500)
            st = pg.locator('[data-owner-row="ebs"]').get_attribute('data-owner-state')
            txt = pg.locator('[data-owner-row="ebs"]').inner_text()
            b_.close()
        ok('⑤ 화면 — 대표 할 일 15줄 · 「적기」 3개 · EBS 끝남으로 → ✓ 끝남 · 화면 오류 없음',
           rows in (15, 19) and marks in (3, 4) and st == 'done' and '✓ 끝남' in txt and '시험 1241 화면 EBS' in txt and not errs, f'{rows} · {marks} · {st} · {txt[:80]} · {errs[:2]}')
    else:
        print('  (운영 화면 · playwright 없음 — ⑤ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
