"""v10.219 (D190 · docs/352) — 포인트 출금(현금 지급)
  ① (코드) D190 출금 표 · 잔액 함수 · 신청 · 흐름 트리거 · 2인 원칙 · 지급 대기열 POINT · INV-9 예외 · 추천 보상 현금화 · 설정 2개 ·
     서비스 · 컨트롤러 · 지급 데스크 POINT · 반려 · SUPER 설정 · DB 오류 POINT_RULE · PAYOUT_RULE · 화면 · screens.json · 사전 · 문서
  ② (API · DB) 원천징수율 비어 있으면 막힘 → ADMIN 은 설정 403 · SUPER 가 8.8 → 시험 회원(본인인증 · 확인된 계좌 · 시험 포인트 30,000) ·
     최소 미만 · 잔액 초과 · 확인 안 된 계좌 · 남의 계좌 막힘 · 신청(12,345 → 세금 1,080 · 받는 금액 11,265) · 또 신청 막힘 · 취소 ·
     다시 신청 → SUPER 확정 → SUPER 지급 422 PAYOUT_RULE(2인) → 지급 담당 지급 · ADMIN 지급 403 · 반려(사유) · 잔액 돌아옴 ·
     끝난 줄 고치기 · 지우기 막힘 · INV-9 · INV-11 0 · 회원이 반려 403
  ③ (화면) 나의공간 소개 활동 「포인트 출금」 · 운영 화면 지급 데스크 「포인트 출금 기준」
  시험 회원은 매번 새 이메일(두 번 돌아도 통과) · 원천징수율은 원래대로.
"""
import json, os, re, subprocess, time, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); SITE = os.environ.get('SITE'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'          # admin@x.com(SUPER)
RPW = 'sgb-test-1234'        # seed-test-roles.js — ops@t.local(ADMIN) · payout@t.local(PAYOUT)
TPW = 'Sgb-test-1219!'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


def js(rel):
    try:
        return json.loads(rd(rel))
    except Exception:
        return {}


M = rd('prisma/migrations/D190_point_cashout/migration.sql')
mig = sorted(d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d))) if os.path.isdir(os.path.join(K, 'prisma/migrations')) else []
ok('① D190 — 출금 표(계좌번호 없음) · 잔액 함수 · 신청 트리거(본인인증 · 원천징수율 · 최소 · 처리 중 · 잔액 · 본인 확인 계좌 · 10원 버림) · 흐름(건너뛰기 · 끝난 줄 · 지우기) · 2인 원칙 · 대기열 POINT · INV-9 예외 · 추천 보상 현금화 · 설정 2개 · 지우는 문장 없음',
   'CREATE TABLE IF NOT EXISTS public.point_cashouts' in M and 'fn_point_cashable(p_account uuid)' in M
   and 'trg_point_cashout_new BEFORE INSERT ON public.point_cashouts' in M and 'trg_point_cashout_flow BEFORE UPDATE OR DELETE ON public.point_cashouts' in M
   and 'EXECUTE FUNCTION public.fn_payout_two_person()' in M and "SELECT 'POINT', c.id, 'MEMBER', ac.name," in M
   and "OR p_table ~ '^(point_cashouts)$'" in M and 'floor(NEW.points * NEW.tax_rate / 1000) * 10' in M
   and "UPDATE public.point_rules SET needs_valid = false WHERE code = 'REFERRAL_DIRECT'" in M and "v_rule.points, true, 'invitee '" in M
   and "('point.cashout_min', '10000'" in M and "('point.cashout_tax_rate', '3.3'" in M and 'ux_point_cashouts_open' in M
   and not re.search(r'point_cashouts[^;]*\b(account_no|bank_code)\b', M) and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE)\b', M)
   and 'D190_point_cashout' in mig, f'{len(mig)} · {mig[-1] if mig else ""}')

SV, CT = rd('src/modules/settlement/point-cashout.service.ts'), rd('src/modules/settlement/point-cashout.controller.ts')
PS, PC = rd('src/modules/settlement/payout.service.ts'), rd('src/modules/settlement/payout.controller.ts')
AM, FL, AS = rd('src/app.module.ts'), rd('src/common/db-error.filter.ts'), rd('src/modules/admin/admin.service.ts')
ok('① API — 회원 3개(내 정보 · 신청 · 취소) · 지급 데스크 POINT(확정은 REQUESTED 부터 · 반려 · 출금 기준) · 출금 기준 SUPER · DB 오류 POINT_RULE · PAYOUT_RULE · 모듈',
   "@Controller('api/v1/me/points/cashout')" in CT and "@Post(':id/cancel')" in CT and '@IsUUID() payoutAccountId' in CT
   and "POINT:   { table: 'point_cashouts',      col: 'status' }" in PS and "POINT: 'REQUESTED'" in PS and 'async reject(' in PS and 'pointSetting' in PS
   and "@Post(':kind/:id/reject')" in PC and "@Roles('ADMIN', 'PAYOUT')" in PC and "@Audit('PAYOUT_REJECT', 'SETTLEMENT')" in PC
   and "key.startsWith('point.cashout_')" in AS and "'POINT_SETTING_SUPER'" in AS
   and "code: 'POINT_RULE'" in FL and "code: 'PAYOUT_RULE'" in FL and 'PointCashoutController,' in AM and 'PointCashoutService,' in AM, '')

CB, AP, PY = rd('site/src/app/my/intro/activity/CashoutBox.tsx'), rd('site/src/app/my/intro/activity/page.tsx'), rd('web/src/app/admin/Payouts.tsx')
ok('① 화면 — 나의공간 출금 상자(미리 보기 10원 버림 · 취소) · 지급 데스크 POINT · 반려 · 출금 기준(SUPER)',
   'data-cashout-box=""' in CB and "'/api/v1/me/points/cashout'" in CB and 'Math.floor((points * rate) / 1000) * 10' in CB
   and "apiGetPersonal<Cashout>('/me/points/cashout')" in AP and '<CashoutBox c={cashout} />' in AP
   and "POINT: '포인트 출금'" in PY and '/admin/payouts/point/${r.id}/reject' in PY and 'data-point-setting=' in PY and "key: 'point.cashout_tax_rate'" in PY, '')

SCR = js('spec/screens.json').get('screens', [])
sid = {s['id']: s for s in SCR}
ko, en = js('site/src/i18n/messages/ko/myDeal.json').get('cashout', {}), js('site/src/i18n/messages/en/myDeal.json').get('cashout', {})
flat = lambda d, p='': {k for kk, v in d.items() for k in (flat(v, p + kk + '.') if isinstance(v, dict) else {p + kk})}
EN = rd('src/common/i18n/server-text.en.ts')
ok('① screens.json · 사전 — API 연결 · ko · en 칸 같음 · 서버 글 영어',
   all(a in sid.get('SB-MYP-INT-030', {}).get('apis', []) for a in ('GET /me/points/cashout', 'POST /me/points/cashout', 'POST /me/points/cashout/{id}/cancel'))
   and 'POST /admin/payouts/{kind}/{id}/reject' in sid.get('SB-ADM-PAY-010', {}).get('apis', [])
   and ko and flat(ko) == flat(en) and all(f'"{s}"' in EN for s in ('최소 출금 금액은 {0}원입니다.', '출금할 수 있는 포인트({0})보다 많습니다.', '포인트 출금 기준은 최고 관리자(SUPER)만 바꿀 수 있습니다.')),
   f'{sorted(flat(ko) ^ flat(en))[:4]}')

DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('352_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 문서 352 · 판 v10.219 이상', bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 219), f'{DOC} · {rd("VERSION").strip()}')


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


def login(email, pw):
    return call('POST', '/auth/login', {'email': email, 'password': pw}).get('accessToken')


if API and DB:
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import consent_ok
    stamp = str(int(time.time()))[-7:]
    tax0 = psql("SELECT coalesce(value, '<NULL>') FROM site_settings WHERE key = 'point.cashout_tax_rate'")
    me_email, other_email = f'cash-m-{stamp}@t.local', f'cash-o-{stamp}@t.local'
    try:
        ST, OT, YT = login('admin@x.com', PW), login('ops@t.local', RPW), login('payout@t.local', RPW)
        m = call('POST', '/auth/signup', {'email': me_email, 'password': TPW, 'name': '출금가나'})
        o = call('POST', '/auth/signup', {'email': other_email, 'password': TPW, 'name': '출금다라'})
        MT = m.get('accessToken') or login(me_email, TPW)
        mid = psql(f"SELECT id FROM accounts WHERE email = '{me_email}'"); oid = psql(f"SELECT id FROM accounts WHERE email = '{other_email}'")
        psql(f"UPDATE accounts SET identity_verified_at = now() WHERE id IN ('{mid}', '{oid}')")
        acc_ok = psql(f"INSERT INTO payout_accounts (account_id, bank_name, holder_name, verified, verified_at, account_last4, account_enc, is_default) VALUES ('{mid}', '국민은행', '출금가나', true, now(), '1219', '\\x00', true) RETURNING id")
        acc_no = psql(f"INSERT INTO payout_accounts (account_id, bank_name, holder_name, verified, account_last4, account_enc) VALUES ('{mid}', '신한은행', '출금가나', false, '0000', '\\x00') RETURNING id")
        acc_ot = psql(f"INSERT INTO payout_accounts (account_id, bank_name, holder_name, verified, verified_at, account_last4, account_enc) VALUES ('{oid}', '국민은행', '출금다라', true, now(), '5555', '\\x00') RETURNING id")
        psql("INSERT INTO point_rules (code, name, points, needs_valid, is_active, sort_order) VALUES ('T_CASHOUT_1219', '시험 — 포인트 출금(test_v1219)', 30000, false, false, 99) ON CONFLICT DO NOTHING")
        psql(f"INSERT INTO point_ledger (account_id, rule_code, points, redeemable, memo) VALUES ('{mid}', 'T_CASHOUT_1219', 30000, true, 'test_v1219'), ('{mid}', 'T_CASHOUT_1219', 5000, false, 'test_v1219 잠김')")

        psql("UPDATE site_settings SET value = NULL WHERE key = 'point.cashout_tax_rate'")
        g0 = call('GET', '/me/points/cashout', t=MT)
        r0 = call('POST', '/me/points/cashout', {'points': 10000, 'payoutAccountId': acc_ok}, t=MT)
        sa = call('PATCH', '/admin/site-settings', {'key': 'point.cashout_tax_rate', 'value': '8.8'}, t=OT)
        ss = call('PATCH', '/admin/site-settings', {'key': 'point.cashout_tax_rate', 'value': '8.8', 'reason': 'test_v1219'}, t=ST)
        ok('② 원천징수율 비어 있으면 신청 막힘(TAX_UNSET · 422 POINT_RULE) · ADMIN 은 출금 기준 403 · SUPER 가 8.8',
           g0.get('blocker') == 'TAX_UNSET' and g0.get('taxRate') is None and r0.get('_err') == 422 and r0.get('code') == 'POINT_RULE'
           and sa.get('_err') == 403 and sa.get('code') == 'POINT_SETTING_SUPER' and not ss.get('_err'),
           f"{g0.get('blocker')} · {r0.get('code')} · {sa.get('code')} · {ss.get('_err') or 'ok'}")

        g1 = call('GET', '/me/points/cashout', t=MT)
        bad = {
            'min': call('POST', '/me/points/cashout', {'points': 9999, 'payoutAccountId': acc_ok}, t=MT),
            'over': call('POST', '/me/points/cashout', {'points': 30001, 'payoutAccountId': acc_ok}, t=MT),
            'unverified': call('POST', '/me/points/cashout', {'points': 10000, 'payoutAccountId': acc_no}, t=MT),
            'other': call('POST', '/me/points/cashout', {'points': 10000, 'payoutAccountId': acc_ot}, t=MT),
            'uuid': call('POST', '/me/points/cashout', {'points': 10000, 'payoutAccountId': 'x'}, t=MT),
        }
        ok('② 출금 정보(잔액 30,000 · 잠긴 5,000 빠짐 · 확인된 계좌 1개) · 최소 미만 · 잔액 초과 · 확인 안 된 · 남의 계좌 422 · 잘못된 계좌 번호 400',
           g1.get('cashable') == 30000 and g1.get('min') == 10000 and g1.get('taxRate') == '8.8' and g1.get('blocker') is None
           and [a['id'] for a in g1.get('accounts', [])] == [acc_ok]
           and all(bad[k].get('_err') == 422 and bad[k].get('code') == 'POINT_RULE' for k in ('min', 'over', 'unverified', 'other')) and bad['uuid'].get('_err') == 400,
           f"{g1.get('cashable')} · {len(g1.get('accounts', []))} · {[(k, v.get('_err')) for k, v in bad.items()]}")

        c1 = call('POST', '/me/points/cashout', {'points': 12345, 'payoutAccountId': acc_ok}, t=MT)
        dup = call('POST', '/me/points/cashout', {'points': 10000, 'payoutAccountId': acc_ok}, t=MT)
        x1 = call('POST', f"/me/points/cashout/{c1.get('id')}/cancel", t=MT)
        x2 = call('POST', f"/me/points/cashout/{c1.get('id')}/cancel", t=MT)
        ok('② 신청 12,345 → 원천징수 1,080(10원 미만 버림) · 받는 금액 11,265 · 처리 중 또 신청 422 · 취소 · 다시 취소 422',
           c1.get('withholding') == 1080 and c1.get('netAmount') == 11265 and c1.get('taxRate') == '8.8' and c1.get('status') == 'REQUESTED'
           and dup.get('_err') == 422 and x1.get('status') == 'CANCELED' and x2.get('_err') == 422 and x2.get('code') == 'NOT_CANCELABLE',
           f"{c1.get('withholding')} · {c1.get('netAmount')} · {dup.get('code')} · {x1.get('status')} · {x2.get('code')}")

        c2 = call('POST', '/me/points/cashout', {'points': 12345, 'payoutAccountId': acc_ok}, t=MT)
        cid = c2.get('id')
        desk0 = call('GET', '/admin/payouts', t=ST)
        in_drafts = any(r.get('kind') == 'POINT' and r.get('id') == cid for r in desk0.get('drafts', []))
        cf = call('POST', f'/admin/payouts/point/{cid}/confirm', t=ST)
        desk1 = call('GET', '/admin/payouts', t=YT)
        in_queue = any(r.get('kind') == 'POINT' and r.get('id') == cid and r.get('ready') and r.get('last4') == '1219' and int(r.get('amount') or 0) == 11265 for r in desk1.get('queue', []))
        p_same = call('POST', f'/admin/payouts/point/{cid}/pay', {'ref': 'KB-1219-same'}, t=ST)
        p_admin = call('POST', f'/admin/payouts/point/{cid}/pay', {'ref': 'KB-1219-ops'}, t=OT)
        p_ok = call('POST', f'/admin/payouts/point/{cid}/pay', {'ref': f'KB-1219-{stamp}'}, t=YT)
        g2 = call('GET', '/me/points/cashout', t=MT)
        paid_row = next((r for r in g2.get('requests', []) if r.get('id') == cid), {})
        ok('② 운영 — 확정 전에 신청 · SUPER 확정 → 지급 대기(계좌 뒤 4자리 · 11,265) · 확정한 사람 지급 422 PAYOUT_RULE(2인) · ADMIN 지급 403 · 지급 담당 지급 → 회원 화면 「지급됨」 · 잔액 17,655',
           in_drafts and cf.get('status') == 'CONFIRMED' and in_queue and p_same.get('_err') == 422 and p_same.get('code') == 'PAYOUT_RULE'
           and p_admin.get('_err') == 403 and p_ok.get('status') == 'PAID' and paid_row.get('status') == 'PAID' and g2.get('cashable') == 17655
           and desk1.get('pointSetting', {}).get('taxRate') == '8.8',
           f"{in_drafts} · {cf.get('status')} · {in_queue} · {p_same.get('code')} · {p_admin.get('_err')} · {p_ok.get('status')} · {g2.get('cashable')}")

        c3 = call('POST', '/me/points/cashout', {'points': 10000, 'payoutAccountId': acc_ok}, t=MT)
        rj_mem = call('POST', f"/admin/payouts/point/{c3.get('id')}/reject", {'reason': '회원이 반려'}, t=MT)
        rj_short = call('POST', f"/admin/payouts/point/{c3.get('id')}/reject", {'reason': 'x'}, t=OT)
        rj = call('POST', f"/admin/payouts/point/{c3.get('id')}/reject", {'reason': '예금주 확인 필요(test_v1219)'}, t=OT)
        rj_pt = call('POST', f"/admin/payouts/partner/{c3.get('id')}/reject", {'reason': '종류 다름'}, t=OT)
        g3 = call('GET', '/me/points/cashout', t=MT)
        rrow = next((r for r in g3.get('requests', []) if r.get('id') == c3.get('id')), {})
        ok('② 반려 — 회원 403 · 짧은 사유 400 · ADMIN 반려(사유 남음) · 정산 종류 반려 422 · 잔액 17,655 로 돌아옴',
           rj_mem.get('_err') == 403 and rj_short.get('_err') == 400 and rj.get('status') == 'REJECTED' and rj_pt.get('_err') == 422
           and rrow.get('status') == 'REJECTED' and '예금주' in (rrow.get('closedReason') or '') and g3.get('cashable') == 17655 and g3.get('blocker') is None,
           f"{rj_mem.get('_err')} · {rj_short.get('_err')} · {rj.get('status')} · {rj_pt.get('code')} · {g3.get('cashable')}")

        u1 = psql(f"UPDATE point_cashouts SET paid_ref = 'x' WHERE id = '{cid}'")
        u2 = psql(f"DELETE FROM point_cashouts WHERE id = '{c3.get('id')}'")
        u3 = psql(f"UPDATE point_cashouts SET status = 'CONFIRMED', confirmed_by = '{mid}' WHERE id = '{c3.get('id')}'")
        inv = psql("SELECT (SELECT count(*) FROM v_inv9_violations) || '|' || (SELECT count(*) FROM v_inv11_violations)")
        ok('② DB — 지급 끝난 줄 고치기 · 지우기 · 반려 줄 되살리기 막힘(POINT:) · INV-9 · INV-11 0',
           u1.startswith('!') and 'POINT:' in u1 and u2.startswith('!') and 'POINT:' in u2 and u3.startswith('!') and 'POINT:' in u3 and inv == '0|0',
           f'{u1[:50]} · {u2[:50]} · {inv}')

        try:
            from playwright.sync_api import sync_playwright
        except Exception:
            sync_playwright = None
        if sync_playwright and SITE:
            seen, errs = {}, []
            consent_ok.agree(me_email, TPW)
            try:
                with sync_playwright() as p:
                    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1400, 'height': 1000})
                    pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                    pg.goto(SITE + '/login'); pg.fill('input[name=email]', me_email); pg.fill('input[name=password]', TPW)
                    pg.click('form.auth button'); pg.wait_for_timeout(2000)
                    pg.goto(SITE + '/my/intro/activity', wait_until='networkidle', timeout=120000)
                    seen['box'] = pg.locator('[data-cashout-box]').count()
                    seen['form'] = pg.locator('[data-cashout-form]').count()
                    seen['rows'] = pg.locator('[data-cashout-list] tr[data-cashout-row]').count()
                    seen['paid'] = pg.locator('tr[data-cashout-row="PAID"]').count()
                    if seen['form']:
                        pg.fill('[data-cashout-points]', '12345'); pg.wait_for_timeout(300)
                        seen['preview'] = pg.locator('[data-cashout-preview]').get_attribute('data-cashout-preview')
                    b.close()
            except Exception as ex:
                errs.append(str(ex)[:160])
            ok('③ 나의공간 소개 활동 「포인트 출금」 — 상자 · 신청 칸 · 내 신청 3줄(지급됨 1) · 미리 보기 1080|11265',
               seen.get('box') == 1 and seen.get('form') == 1 and seen.get('rows', 0) >= 3 and seen.get('paid') == 1 and seen.get('preview') == '1080|11265' and not errs,
               f'{seen} · {errs[:2]}')
        if sync_playwright and ADMIN_WEB:
            seen, errs = {}, []
            consent_ok.agree('admin@x.com', PW)
            try:
                with sync_playwright() as p:
                    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 1000})
                    pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                    pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                    pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                    pg.wait_for_selector('[data-state-check]', timeout=30000)
                    pg.goto(ADMIN_WEB + '/#/payouts', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2000)
                    loc = pg.locator('[data-point-setting]')
                    seen['setting'] = loc.get_attribute('data-point-setting') if loc.count() else None
                    seen['edit'] = pg.locator('[data-point-setting] button', has_text='바꾸기').count()
                    seen['paid'] = pg.locator('table.tbl td', has_text='포인트 출금').count()
                    b.close()
            except Exception as ex:
                errs.append(str(ex)[:160])
            ok('③ 운영 화면 지급 데스크 — 「포인트 출금 기준」 8.8 · 바꾸기(SUPER) · 최근 지급에 포인트 출금',
               seen.get('setting') == '8.8' and seen.get('edit') == 1 and seen.get('paid', 0) >= 1 and not errs, f'{seen} · {errs[:2]}')
    finally:
        psql("UPDATE site_settings SET value = " + ("NULL" if tax0 in ('<NULL>', '') else f"'{tax0}'") + " WHERE key = 'point.cashout_tax_rate'")
    ok('되돌림 — 원천징수율 원래대로', psql("SELECT coalesce(value, '<NULL>') FROM site_settings WHERE key = 'point.cashout_tax_rate'") == tax0, tax0)

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
