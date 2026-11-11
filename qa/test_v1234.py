"""v10.234 (docs/375) — 급한 알림 텔레그램 첫 차례 미리보기

  ① (코드) 글 만들기 buildAlertPush(alert-push.ts · 최대 3통 · 제목 200자) · 정기 작업이 같은 함수 · 서비스 pushPreview(읽기만) ·
     API GET ops-alerts/push-preview(ADMIN · SUPER) · 화면 PushPreview · 명세 · 문서 375 · 판 v10.234 이상
  ② (API · DB) 회원 403 · 시험 알림 60건(CRITICAL · 종류마다 다름 · 긴 제목 · 직접 만듦) — 대기 수 = DB 함수 · 통마다 4,000자 이하 ·
     통 수 1 ~ 3 · 통마다 알림 수 합 = included · 남는 수 = 전체 수 - 보낸 수 · 첫 통 머리 · 마지막 통에만 안내 ·
     읽기만(pushed_at 그대로 · 두 번 불러도 같음) · 끝에 시험 알림 지움
  ③ (화면) 「운영 알림」 텔레그램 줄 「지금 켜면 첫 차례 미리보기」 → 안내 줄 · 통마다 펼치기
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
AP, SC = rd('src/common/telegram/alert-push.ts'), rd('src/worker/scheduler.service.ts')
ok('① 글 만들기 하나 — buildAlertPush(최대 3통 · 제목 200자) · 정기 작업이 같은 함수 · 보내진 통만 「보냄」',
   'export function buildAlertPush(items: PushItem[], backlog: number): PushPlan' in AP and 'export const PUSH_PARTS = 3;' in AP
   and 'export const PUSH_TITLE_MAX = 200;' in AP and "import { buildAlertPush } from '../common/telegram/alert-push';" in SC
   and "const plan = buildAlertPush(items, await this.launchWatch.alertBacklog('push'));" in SC and 'for (const p of plan.parts)' in SC
   and 'const PARTS = 3, TITLE_MAX = 200;' not in SC, '')
SV, CT = rd('src/modules/admin/ops-alerts.service.ts'), rd('src/modules/admin/ops-review.controller.ts')
ok('① 서비스 · API — pushPreview 읽기만(markPushed · send 없음) · GET push-preview · ADMIN · SUPER',
   'async pushPreview()' in SV and 'buildAlertPush(items, backlog)' in SV and "this.launchWatch.alertBacklog('push')" in SV
   and 'markPushed' not in SV[SV.index('async pushPreview()'):SV.index('/** 봇에게 최근 말을 건 대화방')]
   and 'this.telegram.send' not in SV[SV.index('async pushPreview()'):SV.index('/** 봇에게 최근 말을 건 대화방')]
   and "@Get('ops-alerts/push-preview')\n  @Roles('ADMIN', 'SUPER')" in CT and 'pushPreview() { return this.alerts.pushPreview(); }' in CT, '')
OA = rd('web/src/app/admin/OpsAlerts.tsx')
SJ = json.loads(rd('spec/screens.json') or '{"screens":[]}'); sc = {s['id']: s for s in SJ.get('screens', [])}
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('375_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 화면 · 명세 · 문서 375 · 판 v10.234 이상',
   'function PushPreview()' in OA and '<PushPreview />' in OA and 'data-push-preview-load=""' in OA and "api<Preview>('/admin/ops-alerts/push-preview')" in OA
   and 'GET /admin/ops-alerts/push-preview' in sc.get('SB-ADM-OPS-010', {}).get('apis', [])
   and bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 234), f'{DOC} · {rd("VERSION").strip()}')


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
    TA = call('POST', '/auth/login', {'email': 'ops@t.local', 'password': RPW}).get('accessToken')
    TB = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW}).get('accessToken')
    tag = f'T1234-{int(time.time())}'
    # 시험 알림 60건 — CRITICAL · 종류마다 다름(1시간 규칙에 안 걸림) · 제목 185자 넘게(여러 통이 되도록) · 시각도 1초씩 달리
    vals = ', '.join(f"('T1234_A{i:02d}', 'CRITICAL', now() - make_interval(secs => {i}), '{tag} A{i:02d} ' || repeat('가', 185), '{{\"test\":\"v1234\"}}'::jsonb)" for i in range(60))
    ins = psql(f"INSERT INTO ops_alerts (alert_code, severity, raised_at, title, detail) VALUES {vals}")
    ok('② 시험 알림 60건 넣음(종류 · 시각 모두 다름)', not ins.startswith('!'), ins[:160])
    mine = lambda: psql(f"SELECT count(*) FILTER (WHERE pushed_at IS NULL) || '/' || count(*) FROM ops_alerts WHERE title LIKE '{tag} %'")
    try:
        rb = call('GET', '/admin/ops-alerts/push-preview', None, TB)
        ok('② 회원 403', rb.get('_err') == 403, f"{rb.get('_err')}")
        db_pend = psql("SELECT (SELECT count(*) FROM fn_ops_alert_push_pending()) + (SELECT count(*) FROM fn_ops_alert_repush_pending())")
        db_back = psql("SELECT fn_ops_alert_push_backlog()")
        p1 = call('GET', '/admin/ops-alerts/push-preview', None, TA)
        parts = p1.get('parts') or []
        ok('② 대기 수 · 전체 수 = DB 함수 · CRITICAL 50 이상', p1.get('pending') == int(db_pend or -1) and p1.get('backlog') == int(db_back or -1)
           and p1.get('critical', 0) >= 50, f"{p1.get('pending')}/{db_pend} · {p1.get('backlog')}/{db_back} · CRITICAL {p1.get('critical')}")
        ok('② 통 1 ~ 3 · 통마다 4,000자 이하 · chars = 글 길이 · 통마다 알림 수 합 = included',
           1 <= len(parts) <= 3 and p1.get('maxParts') == 3 and p1.get('maxChars') == 4000
           and all(x['chars'] <= 4000 and x['chars'] == len(x['text']) for x in parts) and sum(x['n'] for x in parts) == p1.get('included'),
           f"{len(parts)}통 · {[x['chars'] for x in parts]} · {[x['n'] for x in parts]} · included {p1.get('included')}")
        inc_new = p1.get('included', 0) - p1.get('again', 0)
        ok('② 남는 수 = 전체 수 - 보낸 수(다시 알림 뺌) · 안내 글에 통 수 · 건수',
           p1.get('more') == max(0, p1.get('backlog', 0) - inc_new) and f"{len(parts)}통 · 알림 {p1.get('included')}건" in (p1.get('note') or ''),
           f"more {p1.get('more')} · {p1.get('note')}")
        head_ok = all(x['text'].startswith('[소개뱅크] 급한 운영 알림 ') for x in parts)
        nums_ok = len(parts) == 1 and '(1/1)' not in parts[0]['text'] or all(f'({i + 1}/{len(parts)})' in x['text'].split('\n')[0] for i, x in enumerate(parts))
        tail_ok = '운영 화면 › 운영 알림에서 보고 「확인」을 누르십시오.' in parts[-1]['text'] and all('「확인」을 누르십시오' not in x['text'] for x in parts[:-1])
        more_ok = (f"보내지 못한 알림 {p1.get('more')}건 더" in parts[-1]['text']) if p1.get('more') else ('건 더' not in parts[-1]['text'])
        ok('② 머리 · (k/n) · 안내는 마지막 통만 · 「n건 더」 = more · 제목 200자 안', head_ok and nums_ok and tail_ok and more_ok
           and all(len(l) <= 260 for x in parts for l in x['text'].split('\n')), f'{head_ok} · {nums_ok} · {tail_ok} · {more_ok}')
        has_mine = any(tag in x['text'] for x in parts)
        p2 = call('GET', '/admin/ops-alerts/push-preview', None, TA)
        ok('② 시험 알림이 글에 들어감 · 읽기만(pushed_at 그대로) · 두 번 불러도 같음',
           has_mine and mine() == '60/60' and [x['text'] for x in p2.get('parts') or []] == [x['text'] for x in parts], f'{has_mine} · {mine()}')
    finally:
        dl = psql(f"DELETE FROM ops_alerts WHERE title LIKE '{tag} %' AND detail->>'test' = 'v1234'")
        print(f'  (시험 알림 정리 — {dl})')

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
            btn = pg.locator('[data-push-preview-load]')
            nb = btn.count()
            if nb: btn.first.click(); pg.wait_for_timeout(2500)
            note = pg.locator('[data-push-preview-note]')
            seen = (nb, note.count(), pg.locator('[data-push-preview-part]').count() >= 0, '첫 차례' in (btn.first.inner_text() if nb else '') or '새로' in (btn.first.inner_text() if nb else ''))
            pg.screenshot(path=os.path.join(HERE, 'v1234_push_preview.png'), full_page=False)
            b.close()
        ok('③ 「운영 알림」 텔레그램 줄 미리보기 단추 → 안내 줄 · 화면 오류 없음', seen == (1, 1, True, True) and not errs, f'{seen} · {errs[:2]}')
    else:
        print('  (운영 화면 · playwright 없음 — ③ 건너뜀)')
else:
    print('  (API · DB 없음 — ② · ③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
