"""v10.224 (D194 · docs/359) — 파트너 본인 해지 · 축 입점 해지 · 「소개몰 판매자」 탭 · 제휴 판정 4xx · 감사 이름 · 옛 「사업자만」 글

  ① (코드) D194(알림 종류 2) · 축 해지(서비스 · API · 운영 화면) · 본인 해지(서비스 · API · 화면 둘) · 탈퇴 뒤 다시 신청 ·
     제휴 판정 422 · 409 · 감사 AFF_DECIDE · 운영 메뉴 「소개몰」 묶음 · 판매자 탭 · 정산 화면에서 뺌 · 명세(화면 SB-ADM-HSL-010 · API · 알림) · 문구 · 문서 359
  ② (API · DB) 제휴 판정 — 사유 없는 반려 422 · 심사 대기 아님 409 · 승인 감사 AFF_DECIDE /
     축 해지 — 짧은 사유 400 · REVOKED · 알림 · 다시 409 · 다시 신청 PENDING /
     본인 해지 — 남은 돈이 있으면 미리 보이고 409 · 끝나면 WITHDRAWN(안심: 축 해지 · 자동 충전 끔 / 제휴: 링크 끔) · 파트너 약관 대상 아님 · 다시 신청 · 파트너 아니면 403
  ③ (화면) 운영 화면 「소개몰」 묶음 › 「소개몰 판매자」(입점 심사 · 판매자 표) · 「안심소개 입점 심사」 승인 탭 해지 칸 / 파트너센터 계정 탭 · 제휴 정산 화면 해지 칸
  자료: 시험 회원은 매번 새 이메일 · 만든 지갑 · 정산 줄은 끝에 지움(두 번 돌려도 같음)
"""
import json, os, re, subprocess, time, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); SITE = os.environ.get('SITE'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
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
M = rd('prisma/migrations/D194_partner_withdraw/migration.sql')
ok('① D194 — 알림 종류 PARTNER_AXIS_DECIDED · PARTNER_AXIS_REVOKED · 표 · 칸 바꾸지 않음',
   "('PARTNER_AXIS_DECIDED'," in M and "('PARTNER_AXIS_REVOKED'," in M and 'ALTER TABLE' not in M and 'CREATE TABLE' not in M and not re.search(r'\b(DELETE FROM|DROP|TRUNCATE)\b', M), '')
CS, CC, PX = rd('src/modules/partner/consult.service.ts'), rd('src/modules/partner/consult.controller.ts'), rd('web/src/app/admin/PartnerAxes.tsx')
ok('① 축 해지 — APPROVED → REVOKED · 사유 5자 · 알림 · 게시 중 글 수 · API(감사 PARTNER_AXIS_REVOKE) · 해지 축 다시 신청 · 운영 화면 해지 탭 · 단추',
   "SET state = 'REVOKED', reason = $2" in CS and "WHERE id = $1 AND state = 'APPROVED'" in CS and "'PARTNER_AXIS_REVOKED'" in CS and 'openListings' in CS
   and "WHERE mal_partner_axes.state IN ('REJECTED', 'REVOKED')" in CS and "@Post(':id/revoke')" in CC and "@Audit('PARTNER_AXIS_REVOKE', 'PARTNER')" in CC
   and "['REVOKED', '해지']" in PX and 'data-act="revoke"' in PX, '')
WS, WC = rd('src/modules/partner/partner-withdraw.service.ts'), rd('src/modules/partner/partner-withdraw.controller.ts')
ok('① 본인 해지 — 대표 계정만 · 안심(미납 · 유상 잔액 · 환불 · 정산) · 제휴(주문 · 정산) 막음 · 축 해지 · 자동 충전 끔 · 링크 끔 · API(감사 PARTNER_WITHDRAW) · 다시 신청(안심 · 제휴)',
   "throw new Forbidden('NOT_OWNER'" in WS and "state = 'PENDING') AS fees" in WS and 'paid_balance' in WS and "lead_cash_refunds WHERE partner_id = $1 AND state = 'REQUESTED'" in WS
   and "track = 'AFFILIATE'" in WS and "UPDATE lead_cash_wallets SET auto_on = false" in WS and "UPDATE partner_links SET is_active = false" in WS
   and "@Controller('api/v1/partner/withdraw')" in WC and "@Audit('PARTNER_WITHDRAW', 'PARTNER')" in WC and 'PartnerWithdrawController' in rd('src/app.module.ts')
   and "WHERE partners.status IN ('REJECTED', 'NONE', 'WITHDRAWN')" in rd('src/modules/partner/partner.service.ts')
   and "partners.aff_status IN ('REJECTED', 'WITHDRAWN')" in rd('src/modules/affiliate/affiliate.service.ts'), '')
PW_ = rd('site/src/components/partner/PartnerWithdraw.tsx')
kp = json.loads(rd('site/src/i18n/messages/ko/partner.json') or '{}').get('withdraw', {}); ep = json.loads(rd('site/src/i18n/messages/en/partner.json') or '{}').get('withdraw', {})
ok('① 해지 화면 — 파트너센터 계정 탭(대표만 · MAL) · 제휴 정산 화면(AFF) · 막는 것 미리 · 확인 체크 · 사전 ko · en',
   "fetch('/api/v1/partner/withdraw')" in PW_ and 'data-partner-withdraw-blocked=""' in PW_ and 'data-partner-withdraw-chk=""' in PW_
   and '{c.isOwner ? <PartnerWithdraw track="MAL" /> : null}' in rd('site/src/app/partner/business/page.tsx') and '<PartnerWithdraw track="AFF" />' in rd('site/src/app/partners/settlements/page.tsx')
   and set(kp) == set(ep) and len(kp) >= 10, '')
AA, AC = rd('src/modules/affiliate/affiliate-admin.service.ts'), rd('src/modules/affiliate/affiliate.controller.ts')
ok('① 제휴 판정 — 사유 없는 반려 422 REASON_REQUIRED · 심사 대기 아님 409 NOT_APPLIED(전: 200 ok:false) · 감사 이름 AFF_DECIDE(안심 PARTNER_APPROVE 와 따로) · 「사업자 인증을 마친 곳만」 글 고침',
   "throw new PolicyViolation('REASON_REQUIRED', '거절 사유를 적으십시오." in AA and "throw new StateConflict('NOT_APPLIED', '심사 대기 상태가 아닙니다.')" in AA
   and "return { ok: false, note: '심사 대기 상태가 아닙니다.' }" not in AA and "@Audit('AFF_DECIDE', 'PARTNER')" in AC and "@Audit('PARTNER_APPROVE', 'PARTNER')" not in AC
   and '**사업자 인증을 마친 곳만**' not in AC, '')
MN, APP, HS, HT = rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('web/src/app/admin/HealthSettle.tsx'), rd('web/src/app/admin/HealthSellerTab.tsx')
grp = re.search(r"\{ key: 'admhlt',\s+label: '소개몰',\s+tabs: \[([^\]]*)\]", MN)
ok('① 운영 메뉴 — 「소개몰」 묶음(판매자 · 상품 · 주문 · 개봉 반품 · 정산 · 리뷰) · 탭 「소개몰 판매자」(ADMIN · SUPER — 따로 적지 않은 탭) · App 연결 · 정산 화면에서 입점 심사 뺌',
   grp is not None and [x.strip(" '") for x in grp.group(1).split(',')] == ['hlt-sellers', 'hlt-products', 'hlt-orders', 'hlt-open', 'hlt-settle', 'hlt-reviews']
   and "['hlt-sellers', '소개몰 판매자']" in MN and "'hlt-sellers': { title: '소개몰 판매자'" in MN and "{tab === 'hlt-sellers' && <HealthSellerTab />}" in APP
   and "'hlt-sellers'" not in APP.split('const TAB_ROLES')[1].split('};')[0] and '<HealthTenantApply />' in HT and '<HealthSellers />' in HT
   and '<HealthTenantApply />' not in HS and '<HealthSellers />' not in HS, grp.group(1) if grp else '')
SJ = json.loads(rd('spec/screens.json') or '{"screens":[]}'); sid = {s['id']: s for s in SJ.get('screens', [])}
NJ = json.loads(rd('spec/notifications.json') or '{}'); ev = {e.get('code'): e for e in NJ.get('events', [])}
ok('① 명세 — 화면 SB-ADM-HSL-010(ADMIN · SUPER · 판매자 API) · 해지 API(계정 · 제휴 정산 화면) · 축 해지 API · 알림 2종',
   sid.get('SB-ADM-HSL-010', {}).get('roles') == ['ADMIN', 'SUPER'] and 'POST /admin/health/sellers/{id}/status' in sid.get('SB-ADM-HSL-010', {}).get('apis', [])
   and {'GET /partner/withdraw', 'POST /partner/withdraw'} <= set(sid.get('SB-PTC-CTR-610', {}).get('apis', [])) and {'GET /partner/withdraw', 'POST /partner/withdraw'} <= set(sid.get('SB-AFC-STL-010', {}).get('apis', []))
   and 'POST /admin/partner-axes/{id}/revoke' in sid.get('SB-ADM-PTN-020', {}).get('apis', [])
   and all(ev.get(c, {}).get('optout') is False for c in ('PARTNER_AXIS_DECIDED', 'PARTNER_AXIS_REVOKED')), '')
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('359_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 문서 359 · 판 v10.224 이상', bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 224), f'{DOC} · {rd("VERSION").strip()}')


# ── ② API · DB ─────────────────────────────────────────────────────────
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


stamp = str(int(time.time()))[-7:]
PT, NOP = f't1224pt{stamp}@x.com', f't1224no{stamp}@x.com'
seen = {}
if API and DB:
    import sys
    sys.path.insert(0, HERE)
    import consent_ok
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    for e in (PT, NOP):
        psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{e}', '시험1224', '{pw}', now()) ON CONFLICT DO NOTHING")
        consent_ok.agree(e, PW)
    consent_ok.agree('admin@x.com', PW)
    aid = psql(f"SELECT id FROM accounts WHERE email = '{PT}'")
    login = lambda e: call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')
    TS, TP, TN = login('admin@x.com'), login(PT), login(NOP)
    pid = ''
    try:
        # 제휴 판정 — 4xx · 감사 이름
        call('POST', '/partner/affiliate/apply', {}, TP)
        pid = psql(f"SELECT p.id FROM partners p JOIN businesses b ON b.id = p.business_id WHERE b.account_id = '{aid}'")
        t0 = psql("SELECT now()")
        d0 = call('POST', f'/admin/affiliates/applications/{pid}/decide', {'state': 'REJECTED'}, TS)
        d1 = call('POST', f'/admin/affiliates/applications/{pid}/decide', {'state': 'APPROVED'}, TS)
        d2 = call('POST', f'/admin/affiliates/applications/{pid}/decide', {'state': 'APPROVED'}, TS)
        au = psql(f"SELECT string_agg(action, ',') FROM audit.audit_logs WHERE target_id = '{pid}' AND occurred_at >= '{t0}'")
        ok('② 제휴 판정 — 사유 없는 반려 422 REASON_REQUIRED · 승인 ok · 다시 승인 409 NOT_APPLIED(전: 200 ok:false) · 감사 AFF_DECIDE 1줄(실패는 안 남음)',
           d0.get('_err') == 422 and d0.get('code') == 'REASON_REQUIRED' and d1.get('ok') is True and d2.get('_err') == 409 and d2.get('code') == 'NOT_APPLIED' and au == 'AFF_DECIDE',
           f"{d0.get('code')} · {d1.get('ok')} · {d2.get('code')} · {au}")

        # 안심 승인 + 축
        call('POST', '/partner/apply', {}, TP)
        call('POST', f'/admin/partners/{pid}/approve', {}, TS)
        biz = psql(f"SELECT business_id FROM partners WHERE id = '{pid}'")
        ax = psql(f"INSERT INTO mal_partner_axes (business_id, axis, state, source, decided_at) VALUES ('{biz}', 'EQUIP', 'APPROVED', 'ADMIN', now()) "
                  f"ON CONFLICT ON CONSTRAINT mal_partner_axes_business_id_axis_key DO UPDATE SET state = 'APPROVED', decided_at = now() RETURNING id").splitlines()[0]
        v0 = call('POST', f'/admin/partner-axes/{ax}/revoke', {'reason': '짧음'}, TS)
        v1 = call('POST', f'/admin/partner-axes/{ax}/revoke', {'reason': '설비 자격 서류 만료 1224'}, TS)
        v2 = call('POST', f'/admin/partner-axes/{ax}/revoke', {'reason': '설비 자격 서류 만료 1224'}, TS)
        nv = psql(f"SELECT count(*) || '|' || coalesce(max(body), '') FROM notifications WHERE account_id = '{aid}' AND event_code = 'PARTNER_AXIS_REVOKED'")
        ra = call('POST', '/partner/axes', {'axes': ['EQUIP']}, TP)
        st = next((x.get('state') for x in (ra if isinstance(ra, list) else []) if x.get('axis') == 'EQUIP'), None)
        ok('② 축 해지 — 짧은 사유 400 · REVOKED · 게시 중 글 수 · 알림(사유) · 다시 해지 409 NOT_APPROVED · 해지된 축 다시 신청 → PENDING',
           v0.get('_err') == 400 and v1.get('state') == 'REVOKED' and v1.get('openListings') == 0 and v2.get('code') == 'NOT_APPROVED'
           and nv.startswith('1|') and '설비 자격 서류 만료 1224' in nv and st == 'PENDING', f"{v0.get('_err')} · {v1} · {v2.get('code')} · {nv[:40]} · {st}")
        psql(f"UPDATE mal_partner_axes SET state = 'APPROVED', decided_at = now() WHERE id = '{ax}'")

        # 본인 해지 — 막힘
        psql(f"INSERT INTO lead_cash_wallets (partner_id, paid_balance) VALUES ('{pid}', 5000) ON CONFLICT (partner_id) DO UPDATE SET paid_balance = 5000")
        psql(f"INSERT INTO partner_settlements (partner_id, track, period_from, period_to, gross_amount, net_amount) VALUES ('{pid}', 'AFFILIATE', '2020-01-01', '2020-01-31', 1000, 967)")
        ck = call('GET', '/partner/withdraw', None, TP)
        w0 = call('POST', '/partner/withdraw', {'track': 'MAL'}, TP)
        w1 = call('POST', '/partner/withdraw', {'track': 'AFF'}, TP)
        wn = call('POST', '/partner/withdraw', {'track': 'MAL'}, TN)
        ok('② 해지 막힘 — 미리 보기(안심: 유상 잔액 · 제휴: 지급 안 끝난 정산) · 409 PARTNER_OPEN_MONEY 둘 · 파트너 아닌 회원 403 NOT_OWNER',
           (ck.get('mal') or {}).get('can') is False and any('유상 잔액' in x for x in (ck.get('mal') or {}).get('why', []))
           and (ck.get('aff') or {}).get('can') is False and any('제휴 정산' in x for x in (ck.get('aff') or {}).get('why', []))
           and w0.get('code') == 'PARTNER_OPEN_MONEY' and w1.get('code') == 'PARTNER_OPEN_MONEY' and wn.get('code') == 'NOT_OWNER', f"{ck} · {w0.get('code')} · {w1.get('code')} · {wn.get('code')}")

        # ③ 화면 — 해지 칸 · 운영 메뉴 · 축 해지 칸(막힌 상태에서 해지 칸이 「막는 것」을 보여 줌)
        try:
            from playwright.sync_api import sync_playwright
        except Exception:
            sync_playwright = None
        if sync_playwright and (SITE or ADMIN_WEB):
            errs = []
            try:
                with sync_playwright() as p:
                    b = p.chromium.launch()
                    if SITE:
                        for w in (1400, 390):
                            pg = b.new_page(viewport={'width': w, 'height': 900}); pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                            pg.goto(SITE + '/login', wait_until='networkidle', timeout=120000)
                            pg.fill('input[name=email]', PT); pg.fill('input[name=password]', PW); pg.click('form.auth button'); pg.wait_for_timeout(2500)
                            pg.goto(SITE + '/partner/business?tab=acct', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(1500)
                            mal = (pg.locator('[data-partner-withdraw="MAL"]').count(), pg.locator('[data-partner-withdraw="MAL"] [data-partner-withdraw-blocked]').count())
                            if w == 1400: pg.screenshot(path=os.path.join(HERE, 'v1224_partner_withdraw.png'), full_page=True)
                            pg.goto(SITE + '/partners/settlements', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(1500)
                            aff = (pg.locator('[data-partner-withdraw="AFF"]').count(), pg.locator('[data-partner-withdraw="AFF"] [data-partner-withdraw-blocked]').count())
                            seen[f'site{w}'] = (mal, aff)
                            pg.close()
                    if ADMIN_WEB:
                        pg = b.new_page(viewport={'width': 1500, 'height': 1000}); pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                        pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                        pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                        g = pg.locator('[data-group="admhlt"]')
                        tabs = g.get_attribute('data-tabs') if g.count() else ''
                        pg.goto(ADMIN_WEB + '/#/hlt-sellers', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                        seen['tab'] = (tabs, pg.locator('[data-hlt-seller-tab] [data-tenant-apply]').count(), pg.locator('[data-hlt-seller-tab] [data-hlt-sellers]').count(),
                                       pg.locator('[data-hlt-seller-tab] [data-seller-changes]').count())
                        pg.screenshot(path=os.path.join(HERE, 'v1224_admin_hlt_sellers.png'), full_page=False)
                        pg.goto(ADMIN_WEB + '/#/partner-axes', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(1500)
                        pg.locator('[data-axes-state="APPROVED"]').click(); pg.wait_for_timeout(1500)
                        row = pg.locator(f'[data-axis-row="{ax}"]')
                        seen['axes'] = (row.count(), row.locator('[data-act="revoke"]').count(), pg.locator('[data-axes-state="REVOKED"]').count())
                        b.close()
            except Exception as ex:
                errs.append(str(ex)[:200])
            if SITE:
                for w in (1400, 390):
                    ok(f'③ {w}px 파트너센터 계정 탭 · 제휴 정산 — 해지 칸 · 막는 것 보임', seen.get(f'site{w}') == ((1, 1), (1, 1)), str(seen.get(f'site{w}')))
            if ADMIN_WEB:
                t_ = seen.get('tab') or ('', 0, 0, 0)
                ok('③ 운영 화면 「소개몰」 묶음(판매자 먼저 · 6탭) › 「소개몰 판매자」 — 입점 심사 · 판매자 표 · 정보 변경 요청', (t_[0] or '').startswith('|소개몰 판매자|소개몰 상품|') and t_[1:] == (1, 1, 1), str(t_))
                ok('③ 「안심소개 입점 심사」 승인 탭 — 시험 축 줄에 해지 단추 · 「해지」 탭', seen.get('axes') == (1, 1, 1), str(seen.get('axes')))
            ok('③ 화면 오류 없음', not errs, str(errs[:3]))
        else:
            ok('③ 화면 — playwright · SITE · ADMIN_WEB 필요', False, '없음')

        # 본인 해지 — 풀고 나서
        psql(f"UPDATE lead_cash_wallets SET paid_balance = 0, auto_on = false WHERE partner_id = '{pid}'")
        psql(f"UPDATE partner_settlements SET state = 'CARRIED' WHERE partner_id = '{pid}' AND period_from = '2020-01-01'")
        psql(f"INSERT INTO partner_links (partner_id, product_id, code, is_active) SELECT '{pid}', id, 'T1224{stamp}', true FROM affiliate_products ORDER BY id LIMIT 1")
        w2 = call('POST', '/partner/withdraw', {'track': 'MAL', 'reason': '사업 정리'}, TP)
        w3 = call('POST', '/partner/withdraw', {'track': 'AFF'}, TP)
        row = psql(f"SELECT status || '|' || aff_status || '|' || coalesce(suspended_reason, '') FROM partners WHERE id = '{pid}'")
        axs = psql(f"SELECT state FROM mal_partner_axes WHERE id = '{ax}'")
        lk = psql(f"SELECT count(*) FILTER (WHERE is_active) FROM partner_links WHERE partner_id = '{pid}'")
        ta = psql(f"SELECT fn_term_applies('{aid}', 'PARTNER')")
        ok('② 본인 해지 — 안심 WITHDRAWN(사유 「본인 탈퇴 — 사업 정리」 · 축 해지 1) · 제휴 WITHDRAWN(링크 꺼짐) · 파트너 약관 대상 아님',
           w2.get('status') == 'WITHDRAWN' and w2.get('axesRevoked') == 1 and w3.get('status') == 'WITHDRAWN' and (w3.get('linksOff') or 0) >= 0
           and row == 'WITHDRAWN|WITHDRAWN|본인 탈퇴 — 사업 정리' and axs == 'REVOKED' and lk == '0' and ta == 'f', f'{row} · {axs} · {lk} · {ta} · {w2.get("axesRevoked")}')
        a1 = call('POST', '/partner/apply', {}, TP); a2 = call('POST', '/partner/affiliate/apply', {}, TP)
        ok('② 탈퇴 뒤 다시 신청 — 안심 APPLIED · 제휴 APPLIED(심사부터)', a1.get('status') == 'APPLIED' and a2.get('affStatus') == 'APPLIED', f"{a1.get('status')} · {a2.get('affStatus')}")
    except Exception as ex:
        ok('② 진행 중 예외 없음', False, str(ex)[:200])
    finally:
        if pid:
            psql(f"DELETE FROM partner_settlements WHERE partner_id = '{pid}' AND period_from = '2020-01-01'")
            psql(f"DELETE FROM lead_cash_wallets WHERE partner_id = '{pid}' AND paid_balance = 0 AND bonus_balance = 0")
    ok('끝 — 시험 정산 줄 없음', not pid or psql(f"SELECT count(*) FROM partner_settlements WHERE partner_id = '{pid}' AND period_from = '2020-01-01'") == '0', pid)

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
