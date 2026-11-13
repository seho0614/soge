"""v10.207 시험 — 요금제 금액 · 한도를 운영 화면에서(올린 금액은 새 구독부터) · 기능 점검 고침(D184 · docs/332)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e SITE=http://localhost:15174 -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1207.py

  ① 코드 — D184(묶인 금액 · fn_sub_price · 요금제 바뀌면 풂 · 변경 기록 지우지 못함 · fn_plan_update 규칙 · v_billing_due 가 묶인 금액) ·
     API 2(GET ADMIN · SUPER / PUT SUPER · 감사 PLAN_SAVE) · DTO 가 컨트롤러 앞 · 다시 구독하면 묶음 풂 · 내 구독 금액 · 화면 · 명세 · 영어 사전 ·
     flow_trade 새 머리줄(로그아웃 · 돋보기) · func_check 실패 모아 종료 코드 1 · 문서 332 · 판
  ② (DB) 222 · D184 · 규칙(무료 ↔ 유료 · 무료 열람 · 음수 · 사유 · 없는 요금제) · 변경 기록 지우지 못함 · 요금제 바뀌면 묶음 풂
  ③ (API) 목록 · 올림 → 이용 중 구독에 원래 금액(갱신 청구 금액 · 내 구독 화면) · 내림 → 다음 결제부터 · 다시 올림은 지금 금액에 묶음 ·
         422 · 404 · 회원 403 · 감사 · 변경 기록
  ④ (화면) 청구 현황 › 요금제 3줄 · 고치기 칸
"""
import json, os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
Q = os.path.dirname(os.path.abspath(__file__))
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel, base=None):
    p = os.path.join(base or K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
M = rd('prisma/migrations/D184_plan_admin_price_lock/migration.sql')
ok('① D184 — 묶인 금액 칸 · fn_sub_price(작은 값) · 요금제 바뀌면 풂(트리거) · 변경 기록(지우지 못함) · fn_plan_update(올리면 묶고 내리면 풂 · 무료 ↔ 유료 · 무료 열람 · 음수 · 사유) · v_billing_due 가 묶인 금액 · 지우는 문장 없음',
   'ADD COLUMN IF NOT EXISTS locked_price numeric(14,0)' in M and 'LEAST(p_locked, p_price)' in M
   and 'CREATE TRIGGER trg_sub_lock_clear BEFORE UPDATE OF plan_code ON public.subscriptions' in M
   and 'CREATE TABLE IF NOT EXISTS public.subscription_plan_changes' in M and 'BEFORE UPDATE OR DELETE ON public.subscription_plan_changes' in M
   and 'FUNCTION public.fn_plan_update(p_code text, p jsonb, p_reason text, p_actor uuid)' in M
   and "'PLAN: 무료 요금제와 유료 요금제를 서로 바꿀 수 없습니다.'" in M and 'request.view.free_monthly' in M
   and '(public.fn_sub_price(s.locked_price, s.locked_plan_code, np.code, np.monthly_price))::numeric(14,0) AS amount' in M
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|DROP FUNCTION|TRUNCATE)\b', M), '')
PC = rd('src/modules/billing/plan-admin.controller.ts'); PSV = rd('src/modules/billing/plan-admin.service.ts'); AM = rd('src/app.module.ts')
SP = rd('spec/screens.json'); BS = rd('src/modules/billing/billing.service.ts'); RS = rd('src/modules/billing/recurring.service.ts')
RC = rd('src/modules/billing/recurring.controller.ts'); EN = rd('src/common/i18n/server-text.en.ts')
ok('① API — GET admin/billing/plans(ADMIN · SUPER) · PUT :code(SUPER · 감사 PLAN_SAVE · 응답 스키마) · DTO 가 컨트롤러 앞 · 등록 · 명세 SB-ADM-BIL-010 · 오류 글 영어',
   "@Controller('api/v1/admin/billing/plans')" in PC and "@Roles('ADMIN', 'SUPER')" in PC and "@Roles('SUPER')" in PC and "@Audit('PLAN_SAVE', 'BILLING')" in PC
   and '@ApiOkResponse({ type: PlanListDto })' in PC and '@ApiOkResponse({ type: PlanSaveResultDto })' in PC
   and PC.index('export class PlanSaveResultDto') < PC.index('export class PlanAdminController')
   and 'PlanAdminController,' in AM and 'PlanAdminService,' in AM and '"GET /admin/billing/plans"' in SP and '"PUT /admin/billing/plans/{code}"' in SP
   and 'fn_plan_update($1, $2::jsonb, $3, $4)' in PSV
   and all(f'"{s}"' in EN for s in ('바꾸는 사유를 2 ~ 200자로 적어 주십시오.', '금액 · 건수는 0 이상의 정수로 넣으십시오.', '무료 요금제와 유료 요금제를 서로 바꿀 수 없습니다.')), '')
PP = rd('web/src/app/admin/PlanPanel.tsx'); BL = rd('web/src/app/admin/Billing.tsx'); SM = rd('site/src/components/billing/SubscriptionManage.tsx')
KO = json.loads(rd('site/src/i18n/messages/ko/billing.json') or '{}'); ENW = json.loads(rd('site/src/i18n/messages/en/billing.json') or '{}')
ok('① 다시 구독하면 묶음 풂 · 내 구독 금액 = 묶인 금액(listPrice · priceLocked) · 운영 화면 요금제 표 · 회원 화면 안내(한 · 영)',
   'locked_price = NULL, locked_plan_code = NULL, locked_at = NULL' in BS
   and 'fn_sub_price(s.locked_price, s.locked_plan_code, s.plan_code, p.monthly_price) AS "monthlyPrice"' in RS and '"priceLocked"' in RS
   and 'priceLocked?: boolean' in RC and "useApi<PlanList>('/admin/billing/plans')" in PP and 'data-plans' in PP and '<PlanPanel />' in BL
   and 'data-sub-price-locked' in SM and 'priceLocked' in KO.get('manage', {}) and 'priceLocked' in ENW.get('manage', {}), '')
FT = rd('flow_trade.py', Q); FC = rd('func_check.sh', Q)
ok('① 기능 점검 고침 — flow_trade 로그아웃 · 돋보기가 새 머리줄(header[data-uni-header] · sh-pill · sh-icbtn) · 옛 이름표 없음 · func_check 가 실패를 모아 종료 코드 1',
   "header[data-uni-header] button.sh-pill" in FT and 'header[data-uni-header] button.sh-icbtn[aria-haspopup="dialog"]' in FT
   and "locator('button.b2-out')" not in FT and "locator('header .pc-hsch')" not in FT
   and '기능 점검 집계 | 실패 있음' in FC and FC.rstrip().endswith('[ -z "${BAD:-}" ]'), '')
r = subprocess.run(['bash', '-n', os.path.join(Q, 'func_check.sh')], capture_output=True, text=True)
ok('① 셸 문법 — func_check.sh', r.returncode == 0, r.stderr[:100])
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('332_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 문서 332 · 판 v10.207 이상', bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 207), f'{DOC} · {rd("VERSION").strip()}')


# ── ② · ③ · ④ ─────────────────────────────────────────────────────────
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


SUPU = 'admin@x.com'
COLS = 'monthly_price, included_codes, extra_code_price, proposal_limit, request_views_per_month, listing_slots, priority_slot_count, success_fee'
if API and DB:
    import sys
    sys.path.insert(0, Q)
    import consent_ok
    orig = {}; sub = None
    try:
        # ② DB
        mig = psql("SELECT count(*) || '|' || max(name) FROM schema_migrations")
        ok('② 마이그레이션 222 · 끝 D184(v10.208 부터 223 · D185 — test_v1208)', mig in ('222|D184_plan_admin_price_lock', '223|D185_hlt_open_stock', '224|D186_mail_suppression', '225|D187_town_verify_guard', '226|D188_town_pick_ai', '227|D189_member_recommend', '228|D190_point_cashout', '229|D191_security_watch', '230|D192_partner_notice', '231|D193_seller_manage', '232|D194_partner_withdraw', '233|D195_staff_ip_verify', '234|D196_staff_sms', '235|D197_staff_ip_alert', '236|D198_ops_alert_pending_recent', '237|D199_mall_biz_report', '238|D200_ops_alert_slack', '239|D201_owner_todo_marks', '240|D202_ops_release_log', '241|D203_ops_server_daily_todo_weekly', '242|D204_ops_server_error_days', '243|D205_integration_progress'), mig)
        sel = ', '.join(f"coalesce({x.strip()}::text, 'N')" for x in COLS.split(','))
        for c in ('BASIC', 'STANDARD', 'PRO'):
            orig[c] = psql(f"SELECT concat_ws('|', {sel}) FROM subscription_plans WHERE code = '{c}'")
        rules = [psql(f"BEGIN; SELECT * FROM fn_plan_update('{c}', '{j}', '{r}', NULL); ROLLBACK;") for c, j, r in (
            ('BASIC', '{"monthly_price":1000}', '시험'), ('STANDARD', '{"monthly_price":0}', '시험'), ('BASIC', '{"request_views_per_month":99}', '시험'),
            ('STANDARD', '{"included_codes":-1}', '시험'), ('STANDARD', '{"included_codes":4}', 'x'), ('NOPE1207', '{}', '시험'))]
        want = ('무료 요금제와 유료 요금제', '무료 요금제와 유료 요금제', 'request.view.free_monthly', '0 이상이어야', '사유를 적어', '없는 요금제')
        nochg = psql("BEGIN; DELETE FROM subscription_plan_changes WHERE false; UPDATE subscription_plan_changes SET reason = reason WHERE id = (SELECT max(id) FROM subscription_plan_changes); ROLLBACK;")
        ok('② 규칙 — 무료 → 유료 · 유료 → 무료 · 무료 열람 한도 · 음수 · 사유 · 없는 요금제 모두 막음(PLAN:) · 변경 기록 고치기 막음',
           all(x.startswith('!') and w in x for x, w in zip(rules, want)) and (nochg.startswith('!') or psql('SELECT count(*) FROM subscription_plan_changes') == '0'),
           ' / '.join(x[:50] for x in rules) + f' · {nochg[:60]}')

        acct = psql("SELECT a.id || '|' || a.email FROM accounts a WHERE a.email LIKE '%@x.com' AND a.status = 'ACTIVE' "
                    "AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.account_id = a.id) ORDER BY a.email LIMIT 1")
        aid, aem = (acct.split('|') + [''])[:2]
        sub = psql(f"INSERT INTO subscriptions(account_id, plan_code, status, current_period_start, current_period_end) "
                   f"VALUES ('{aid}', 'STANDARD', 'ACTIVE', now() - interval '20 days', now() + interval '10 days') RETURNING id")
        if sub.startswith('!'): sub = None
        p0 = int(orig['STANDARD'].split('|')[0])

        # ③ API
        consent_ok.agree(SUPU, PW)
        TS = call('POST', '/auth/login', {'email': SUPU, 'password': PW}).get('accessToken')
        TB = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW}).get('accessToken')
        g = call('GET', '/admin/billing/plans', None, TS)
        st = next((p for p in g.get('plans') or [] if p.get('code') == 'STANDARD'), {})
        ok('③ 목록 — 요금제 3개 · 스탠다드 금액 = DB · 이용 중 구독 1 이상(시험 구독) · 칸 이름 · 회원 403',
           len(g.get('plans') or []) >= 3 and st.get('monthlyPrice') == p0 and st.get('subscribers', 0) >= 1
           and all(k in st for k in ('includedCodes', 'extraCodePrice', 'proposalLimit', 'requestViews', 'listingSlots', 'prioritySlots', 'successFee', 'locked'))
           and call('GET', '/admin/billing/plans', None, TB).get('_err') == 403 and sub, f'{st} · sub={sub} {aem}')

        up = call('PUT', '/admin/billing/plans/STANDARD', {'monthly_price': p0 + 10000, 'reason': '시험 1207 올림'}, TS)
        lk = psql(f"SELECT coalesce(locked_price::text, 'N') || '|' || coalesce(locked_plan_code, 'N') || '|' || "
                  f"fn_sub_price(locked_price, locked_plan_code, plan_code, (SELECT monthly_price FROM subscription_plans WHERE code = 'STANDARD'))::text FROM subscriptions WHERE id = '{sub}'")
        due = psql(f"BEGIN; UPDATE subscriptions SET current_period_end = now() - interval '1 minute' WHERE id = '{sub}'; "
                   f"SELECT amount::text FROM v_billing_due WHERE subscription_id = '{sub}'; ROLLBACK;")
        TA = call('POST', '/auth/login', {'email': aem, 'password': PW}).get('accessToken') if aem else None
        if TA: consent_ok.agree(aem, PW); TA = call('POST', '/auth/login', {'email': aem, 'password': PW}).get('accessToken')
        me = call('GET', '/me/subscription/detail', None, TA) if TA else {}
        ok('③ 올림 — 이용 중 구독에 원래 금액이 묶임(locked ≥ 1) · 갱신 청구 금액 = 원래 금액 · 내 구독 화면 금액 = 원래 금액 · 지금 금액 · priceLocked',
           up.get('ok') is True and up.get('locked', 0) >= 1 and lk == f'{p0}|STANDARD|{p0}' and due == str(p0)
           and me.get('monthlyPrice') in (p0, str(p0)) and me.get('listPrice') in (p0 + 10000, str(p0 + 10000)) and me.get('priceLocked') is True,
           f'{up} · {lk} · due={due} · me={ {k: me.get(k) for k in ("monthlyPrice", "listPrice", "priceLocked", "_err")} }')

        dn = call('PUT', '/admin/billing/plans/STANDARD', {'monthly_price': p0 - 10000, 'reason': '시험 1207 내림'}, TS)
        lk2 = psql(f"SELECT coalesce(locked_price::text, 'N') FROM subscriptions WHERE id = '{sub}'")
        due2 = psql(f"BEGIN; UPDATE subscriptions SET current_period_end = now() - interval '1 minute' WHERE id = '{sub}'; "
                    f"SELECT amount::text FROM v_billing_due WHERE subscription_id = '{sub}'; ROLLBACK;")
        up2 = call('PUT', '/admin/billing/plans/STANDARD', {'monthly_price': p0 + 5000, 'reason': '시험 1207 다시 올림'}, TS)
        lk3 = psql(f"SELECT coalesce(locked_price::text, 'N') FROM subscriptions WHERE id = '{sub}'")
        psql(f"UPDATE subscriptions SET plan_code = 'PRO' WHERE id = '{sub}'")
        lk4 = psql(f"SELECT coalesce(locked_price::text, 'N') || '|' || coalesce(locked_plan_code, 'N') FROM subscriptions WHERE id = '{sub}'")
        ok('③ 내림 → 다음 결제부터 새 금액(묶음 풂 · lowered ≥ 1) · 다시 올림 → 그때 금액에 묶음 · 요금제가 바뀌면 묶음 풂',
           dn.get('lowered', 0) >= 1 and lk2 == 'N' and due2 == str(p0 - 10000) and up2.get('locked', 0) >= 1 and lk3 == str(p0 - 10000) and lk4 == 'N|N',
           f'{dn} · {lk2} · {due2} · {up2} · {lk3} · {lk4}')

        e1 = call('PUT', '/admin/billing/plans/BASIC', {'monthly_price': 1000, 'reason': '시험 1207'}, TS)
        e2 = call('PUT', '/admin/billing/plans/STANDARD', {'monthly_price': p0, 'reason': 'x'}, TS)
        e3 = call('PUT', '/admin/billing/plans/STANDARD', {'included_codes': -1, 'reason': '시험 1207'}, TS)
        e4 = call('PUT', '/admin/billing/plans/NOPE1207', {'included_codes': 1, 'reason': '시험 1207'}, TS)
        e5 = call('PUT', '/admin/billing/plans/STANDARD', {'monthly_price': p0, 'reason': '시험 1207'}, TB)
        e6 = call('PUT', '/admin/billing/plans/STANDARD', {'reason': '시험 1207'}, TS)
        ok('③ 막음 — 무료 → 유료 422 PLAN_RULE · 짧은 사유 · 음수 · 바꿀 칸 없음 400/422 · 없는 요금제 404 · 회원 403',
           e1.get('_err') == 422 and e1.get('code') == 'PLAN_RULE' and e2.get('_err') in (400, 422) and e3.get('_err') in (400, 422)
           and e4.get('_err') == 404 and e5.get('_err') == 403 and e6.get('_err') == 422 and e6.get('code') == 'PLAN_VALUE',
           f'{e1} · {e2.get("_err")} · {e3.get("_err")} · {e4.get("_err")} · {e5.get("_err")} · {e6}')

        g2 = call('GET', '/admin/billing/plans', None, TS)
        ch = [c for c in g2.get('changes') or [] if (c.get('reason') or '').startswith('시험 1207')]
        au = psql("SELECT count(*) FROM audit.audit_logs WHERE action = 'PLAN_SAVE' AND occurred_at > now() - interval '10 minutes'")
        ok('③ 변경 기록 3건(사유 · 바꾼 칸 · 누가 · 묶음 · 내림 수) · 감사 PLAN_SAVE',
           len(ch) >= 3 and any('monthly_price' in (c.get('diff') or '') for c in ch) and any(c.get('locked', 0) >= 1 for c in ch)
           and any(c.get('lowered', 0) >= 1 for c in ch) and all(c.get('by') for c in ch) and au.isdigit() and int(au) >= 3,
           f'{ch[:1]} · 감사 {au}')

        # ④ 화면
        errs, seen = [], {}
        try:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                b = p.chromium.launch()
                pg = b.new_page(viewport={'width': 1280, 'height': 900}); pg.on('pageerror', lambda e: errs.append(str(e)[:100]))
                pg.on('dialog', lambda d: d.dismiss())
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', SUPU); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
                pg.goto(ADMIN_WEB + '/#/billing', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(3000)
                seen['rows'] = pg.evaluate("() => document.querySelectorAll('[data-plans] [data-plan]').length")
                seen['price'] = pg.evaluate("() => document.querySelector('[data-plan=\"STANDARD\"] [data-plan-val=\"monthly_price\"]')?.textContent ?? ''")
                pg.click('[data-plan="STANDARD"] [data-plan-edit]'); pg.wait_for_timeout(500)
                seen['fields'] = pg.evaluate("() => document.querySelectorAll('[data-plan=\"STANDARD\"] [data-plan-field]').length")
                seen['reason'] = pg.evaluate("() => !!document.querySelector('[data-plan-reason]') && document.querySelector('[data-plan-save]').disabled")
                seen['changes'] = pg.evaluate("() => document.querySelectorAll('[data-plan-changes] tbody tr').length")
                b.close()
        except Exception as ex:
            errs.append(str(ex)[:120])
        ok('④ 화면 — 청구 현황 › 요금제 3줄 · 스탠다드 금액 · 고치기 → 칸 8개 · 사유 없으면 저장 못 함 · 최근 변경 · 오류 없음',
           seen.get('rows', 0) >= 3 and '원' in seen.get('price', '') and seen.get('fields') == 8 and seen.get('reason') is True
           and seen.get('changes', 0) >= 3 and not errs, f'{seen} · {errs[:2]}')
    finally:
        # 요금제 값은 시험 전 그대로(변경 기록은 지우지 못하는 표라 남음 — 사유 「시험 1207 …」)
        for c, v in orig.items():
            if not v or v.startswith('!'): continue
            vals = ['NULL' if x == 'N' else x for x in v.split('|')]
            psql(f"UPDATE subscription_plans SET ({COLS}) = ({', '.join(vals)}) WHERE code = '{c}'")
        if sub:
            d = psql(f"DELETE FROM subscriptions WHERE id = '{sub}'")
            if d.startswith('!'): psql(f"UPDATE subscriptions SET status = 'CANCELLED', cancel_at = now(), locked_price = NULL, locked_plan_code = NULL WHERE id = '{sub}'")

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
