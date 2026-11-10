"""v10.222 (D192 · docs/357) — 파트너 · 판매자 심사 알림 · 제휴 파트너 약관 대상 · 정지 사유 보임 · 입점 약관 바로 동의

  ① (코드) D192(fn_term_applies 제휴 자격 · 알림 종류 10) · 안심 승인 · 정지 · 다시 열기 알림 · 제휴 승인 · 반려 · 정지 · 다시 열기 알림 ·
     판매자 승인 · 반려 알림 · 정지 사유(suspendReason) · 파트너 홈 막힘 줄 · 신청 화면 정지 · 탈퇴 칸 · 입점 신청 화면 약관 동의 · 알림 명세 · 문서 357
  ② (API · DB) 제휴만 신청한 회원 → 파트너 약관 대상 · 제휴 반려 · 승인 · 정지 · 다시 열기 알림 / 안심 승인 · 정지(사유 · 홈 막힘 줄 · 「입점 심사」 아님) · 다시 열기 알림 /
     판매자 반려 · 승인 알림 / 입점 약관 미게시면 동의 422 NOT_PUBLISHED
  ③ (화면) 정지된 파트너의 /partner/apply — 「정지」 · 사유 · 「심사 중」 아님 / /health/seller — 약관 동의 칸(체크 · 단추)
  자료: 시험 회원은 매번 새 이메일 · 설정은 원래대로(두 번 돌려도 같음)
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
M = rd('prisma/migrations/D192_partner_notice/migration.sql')
ok('① D192 — fn_term_applies 가 제휴 자격(aff_status 신청 · 활동 · 정지)도 봄 · 알림 종류 10(수신 거부 불가) · 지우는 문장 없음',
   "OR p.aff_status IN ('APPLIED','ACTIVE','SUSPENDED'))" in M and all(f"('{c}'," in M for c in (
       'PARTNER_APPROVED', 'PARTNER_REJECTED', 'PARTNER_SUSPENDED', 'PARTNER_RESUMED', 'AFF_APPROVED', 'AFF_REJECTED', 'AFF_SUSPENDED', 'AFF_RESUMED',
       'SELLER_APPROVED', 'SELLER_REJECTED')) and 'ON CONFLICT (event_code) DO NOTHING' in M and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE)\b', M), '')
PA, AA, HT = rd('src/modules/partner/partner-admin.service.ts'), rd('src/modules/affiliate/affiliate-admin.service.ts'), rd('src/modules/health/health-tenant.service.ts')
ok('① 알림 — 안심 승인 · 정지 · 다시 열기 · 제휴 승인 · 반려 · 정지 · 다시 열기(링크 /partners) · 판매자 승인(판매자센터) · 반려(사유)',
   "'PARTNER_APPROVED'" in PA and "'PARTNER_SUSPENDED'" in PA and "'PARTNER_RESUMED'" in PA
   and all(f"'{c}'" in AA for c in ('AFF_APPROVED', 'AFF_REJECTED', 'AFF_SUSPENDED', 'AFF_RESUMED')) and "'/partners'" in AA
   and "'SELLER_APPROVED'" in HT and "'SELLER_REJECTED'" in HT and "'/health/seller/center'" in HT, '')
PAC, PS, AP = rd('src/modules/partner/partner-actor.service.ts'), rd('src/modules/partner/partner.service.ts'), rd('site/src/app/partner/apply/page.tsx')
ok('① 정지 사유 — forMember suspendReason · 파트너 홈 막힘 줄(정지 · 탈퇴 · 심사는 APPLIED 일 때만) · 신청 화면 정지 · 탈퇴 칸(「심사 중」은 APPLIED 만)',
   """CASE WHEN p.status = 'SUSPENDED' THEN p.suspended_reason END AS "suspendReason\"""" in PAC and "what: '안심소개 자격 정지'" in PS and "what: '안심소개 탈퇴'" in PS
   and "const reviewing = applied && d?.status === 'APPLIED';" in AP and 'data-partner-state="SUSPENDED"' in AP and 'data-partner-state="WITHDRAWN"' in AP, '')
SA = rd('site/src/components/health/SellerApply.tsx')
ko = json.loads(rd('site/src/i18n/messages/ko/hlt.json') or '{}').get('tenant', {}); en = json.loads(rd('site/src/i18n/messages/en/hlt.json') or '{}').get('tenant', {})
kp = json.loads(rd('site/src/i18n/messages/ko/partner.json') or '{}').get('apply', {}); ep = json.loads(rd('site/src/i18n/messages/en/partner.json') or '{}').get('apply', {})
ok('① 입점 신청 화면 — 약관 동의 칸(체크 · 단추 · POST /terms/agree HLT_SELLER · 다시 읽음) · 사전 ko · en(약관 · 정지 글)',
   "'/api/v1/terms/agree'" in SA and "items: [{ code: 'HLT_SELLER', agreed: true }]" in SA and 'data-tenant-agree-chk=""' in SA and 'data-tenant-agree=""' in SA
   and all(ko.get(k) and en.get(k) for k in ('termsRead', 'agreeChk', 'agreeBtn')) and all(kp.get(k) and ep.get(k) for k in ('suspended', 'susTitle', 'susFix', 'withdrawn', 'wdNote')), '')
NJ = json.loads(rd('spec/notifications.json') or '{}'); ev = {e.get('code'): e for e in NJ.get('events', [])}
SJ = json.loads(rd('spec/screens.json') or '{"screens":[]}'); sid = {s['id']: s for s in SJ.get('screens', [])}
ok('① 명세 — 알림 10종(수신 거부 불가 · 도착 화면) · 입점 신청 화면 API 에 POST /terms/agree',
   all(ev.get(c, {}).get('optout') is False and ev.get(c, {}).get('screen') for c in ('PARTNER_APPROVED', 'PARTNER_SUSPENDED', 'AFF_APPROVED', 'AFF_REJECTED', 'SELLER_APPROVED', 'SELLER_REJECTED'))
   and 'POST /terms/agree' in sid.get('SB-HLT-SEL-010', {}).get('apis', []), '')
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('357_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 문서 357 · 판 v10.222 이상', bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 222), f'{DOC} · {rd("VERSION").strip()}')


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
AFF, MAL, SEL = f't1222aff{stamp}@x.com', f't1222mal{stamp}@x.com', f't1222sel{stamp}@x.com'
seen = {}
if API and DB:
    import sys
    sys.path.insert(0, HERE)
    import consent_ok
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    for e in (AFF, MAL, SEL):
        psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{e}', '시험1222', '{pw}', now()) ON CONFLICT DO NOTHING")
        consent_ok.agree(e, PW)
    ids = {e: psql(f"SELECT id FROM accounts WHERE email = '{e}'") for e in (AFF, MAL, SEL)}
    login = lambda e: call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')
    consent_ok.agree('admin@x.com', PW)
    TS, TA, TM, TL = login('admin@x.com'), login(AFF), login(MAL), login(SEL)
    nt = lambda e, code: psql(f"SELECT count(*) || '|' || coalesce(max(body), '') FROM notifications WHERE account_id = '{ids[e]}' AND event_code = '{code}'")
    t0 = psql("SELECT coalesce(value, 'off') FROM site_settings WHERE key = 'mall.tenant_apply'")
    try:
        # 제휴만 신청 → 파트너 약관 대상
        f0 = psql(f"SELECT fn_term_applies('{ids[AFF]}', 'PARTNER')")
        a1 = call('POST', '/partner/affiliate/apply', {}, TA)
        pid = psql(f"SELECT p.id FROM partners p JOIN businesses b ON b.id = p.business_id WHERE b.account_id = '{ids[AFF]}'")
        f1 = psql(f"SELECT fn_term_applies('{ids[AFF]}', 'PARTNER') || '|' || (SELECT status FROM partners WHERE id = '{pid}')")
        ok('② 제휴만 신청한 회원(안심 NONE) — 파트너 이용약관 대상이 됨(전: 아님) · 신청 전은 대상 아님',
           a1.get('affStatus') == 'APPLIED' and f0 == 'f' and f1 == 't|NONE', f'{f0} · {f1}')
        d1 = call('POST', f'/admin/affiliates/applications/{pid}/decide', {'state': 'REJECTED', 'reason': '활동 계획을 적어 주십시오'}, TS)
        n1 = nt(AFF, 'AFF_REJECTED')
        call('POST', '/partner/affiliate/apply', {}, TA)
        d2 = call('POST', f'/admin/affiliates/applications/{pid}/decide', {'state': 'APPROVED'}, TS)
        n2 = nt(AFF, 'AFF_APPROVED')
        s1 = call('POST', f'/admin/affiliates/partners/{pid}/suspend', {'reason': '시험 정지 1222'}, TS); n3 = nt(AFF, 'AFF_SUSPENDED')
        r1 = call('POST', f'/admin/affiliates/partners/{pid}/resume', {'reason': '시험 다시 1222'}, TS); n4 = nt(AFF, 'AFF_RESUMED')
        link = psql(f"SELECT string_agg(DISTINCT link_url, ',') FROM notifications WHERE account_id = '{ids[AFF]}' AND event_code LIKE 'AFF_%'")
        ok('② 제휴 반려(사유 담김) · 다시 신청 · 승인 · 정지(사유) · 다시 열기 — 알림 각 1건 · 링크 /partners',
           d1.get('ok') is True and d2.get('ok') is True and s1.get('ok') is True and r1.get('ok') is True
           and n1.startswith('1|') and '활동 계획을 적어 주십시오' in n1 and n2.startswith('1|') and n3.startswith('1|') and '시험 정지 1222' in n3 and n4.startswith('1|') and link == '/partners',
           f'{n1[:40]} · {n2[:10]} · {n3[:40]} · {n4[:10]} · {link}')

        # 안심소개 — 승인 · 정지 · 다시 열기
        m1 = call('POST', '/partner/apply', {}, TM)
        mp = psql(f"SELECT p.id FROM partners p JOIN businesses b ON b.id = p.business_id WHERE b.account_id = '{ids[MAL]}'")
        ap = call('POST', f'/admin/partners/{mp}/approve', {}, TS); k1 = nt(MAL, 'PARTNER_APPROVED')
        su = call('POST', f'/admin/partners/{mp}/suspend', {'reason': '서류 확인 중 1222'}, TS); k2 = nt(MAL, 'PARTNER_SUSPENDED')
        dsh = call('GET', '/partner/dashboard', None, TM)
        blk = [x.get('what') for x in (dsh.get('blocked') or [])]
        ok('② 안심 승인 알림 · 정지 알림(사유) · 파트너 홈 — status SUSPENDED · suspendReason · 막힘 줄 「안심소개 자격 정지」(「입점 심사」 아님)',
           m1.get('status') == 'APPLIED' and ap.get('status') == 'ACTIVE' and k1.startswith('1|') and su.get('status') == 'SUSPENDED' and k2.startswith('1|') and '서류 확인 중 1222' in k2
           and dsh.get('status') == 'SUSPENDED' and dsh.get('suspendReason') == '서류 확인 중 1222' and '안심소개 자격 정지' in blk and '입점 심사' not in blk, f'{k2[:40]} · {blk}')
        seen['suspended'] = True
        pol = psql("SELECT count(*) FROM notification_event_policies WHERE event_code IN ('PARTNER_APPROVED','PARTNER_REJECTED','PARTNER_SUSPENDED','PARTNER_RESUMED','AFF_APPROVED','AFF_REJECTED','AFF_SUSPENDED','AFF_RESUMED','SELLER_APPROVED','SELLER_REJECTED') AND NOT optout_allowed")
        ok('② 알림 종류 10 — 정책 줄 · 수신 거부 불가(PARTNER_REJECTED 도 이제 줄 있음)', pol == '10', pol)

        # 판매자 — 반려 · 승인 알림
        sid_ = psql(f"INSERT INTO hlt_sellers (code, account_id, type, name, personal, ceo_name, cs_tel, return_addr, status, applied_at) "
                    f"VALUES ('TN-T1222{stamp[-3:]}', '{ids[SEL]}', 'TENANT', '시험 가게 1222', true, '홍길동', '02-000-0000', '서울 강남구 테헤란로 1', 'PENDING', now()) RETURNING id").splitlines()[0]
        rj = call('POST', f'/admin/health/sellers/{sid_}/reject', {'reason': '통신판매업 번호를 확인해 주십시오'}, TS); j1 = nt(SEL, 'SELLER_REJECTED')
        psql(f"UPDATE hlt_sellers SET status = 'PENDING', reject_reason = NULL, reviewed_at = NULL, reviewed_by = NULL WHERE id = '{sid_}'")
        av = call('POST', f'/admin/health/sellers/{sid_}/approve', {}, TS); j2 = nt(SEL, 'SELLER_APPROVED')
        lk = psql(f"SELECT link_url FROM notifications WHERE account_id = '{ids[SEL]}' AND event_code = 'SELLER_APPROVED' LIMIT 1")
        ok('② 판매자 반려 알림(사유) · 승인 알림(판매자센터 링크)', rj.get('status') == 'REJECTED' and j1.startswith('1|') and '통신판매업 번호를' in j1
           and av.get('status') == 'ACTIVE' and j2.startswith('1|') and lk == '/health/seller/center', f'{j1[:40]} · {j2[:10]} · {lk}')
        cur = psql("SELECT count(*) FROM v_terms_current WHERE code = 'HLT_SELLER'")
        ag = call('POST', '/terms/agree', {'items': [{'code': 'HLT_SELLER', 'agreed': True}]}, TA)
        ok('② 입점 약관 바로 동의 — 지금 개발판은 약관 미게시라 422 NOT_PUBLISHED(게시되면 같은 API 로 동의)',
           (cur == '0' and ag.get('code') == 'NOT_PUBLISHED') or (cur == '1' and ag.get('_err') is None), f'{cur} · {ag}')
        r2 = call('POST', f'/admin/partners/{mp}/resume', {'reason': '확인 끝 1222'}, TS); k3 = nt(MAL, 'PARTNER_RESUMED')
        ok('② 안심 다시 열기 알림', r2.get('status') == 'ACTIVE' and k3.startswith('1|'), k3[:40])
        psql(f"UPDATE partners SET status = 'SUSPENDED', suspended_reason = '화면 시험 1222' WHERE id = '{mp}'")   # ③ 화면 시험용 — 끝에 되돌림
    except Exception as ex:
        ok('② 진행 중 예외 없음', False, str(ex)[:200])

    # ── ③ 화면 ──
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if SITE and sync_playwright:
        errs = []
        try:
            with sync_playwright() as p:
                b = p.chromium.launch()
                for w in (1400, 390):
                    pg = b.new_page(viewport={'width': w, 'height': 900})
                    pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                    pg.goto(SITE + '/login', wait_until='networkidle', timeout=120000)
                    pg.fill('input[name=email]', MAL); pg.fill('input[name=password]', PW); pg.click('form.auth button'); pg.wait_for_timeout(2500)
                    pg.goto(SITE + '/partner/apply', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(800)
                    box = pg.locator('[data-partner-state="SUSPENDED"]')
                    s3 = pg.locator('ol.pt-nsteps > li').nth(2)
                    seen[f'apply{w}'] = (box.count(), '화면 시험 1222' in (box.inner_text() if box.count() else ''), int('심사 중' in (s3.inner_text() if s3.count() else '심사 중')))
                    if w == 1400: pg.screenshot(path=os.path.join(HERE, 'v1222_partner_suspended.png'), full_page=False)
                    pg.close()
                psql("UPDATE site_settings SET value = 'on' WHERE key = 'mall.tenant_apply'")
                pg = b.new_page(viewport={'width': 1400, 'height': 900})
                pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                pg.goto(SITE + '/login', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', AFF); pg.fill('input[name=password]', PW); pg.click('form.auth button'); pg.wait_for_timeout(2500)
                pg.goto(SITE + '/health/seller', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(800)
                chk, btn = pg.locator('[data-tenant-agree-chk]'), pg.locator('[data-tenant-agree]')
                dis0 = btn.is_disabled() if btn.count() else None
                if chk.count(): chk.check()
                dis1 = btn.is_disabled() if btn.count() else None
                seen['agree'] = (chk.count(), btn.count(), dis0, dis1)
                pg.screenshot(path=os.path.join(HERE, 'v1222_seller_agree.png'), full_page=False)
                b.close()
        except Exception as ex:
            errs.append(str(ex)[:200])
        finally:
            psql(f"UPDATE site_settings SET value = '{t0 or 'off'}' WHERE key = 'mall.tenant_apply'")
        for w in (1400, 390):
            ok(f'③ {w}px 정지된 파트너 /partner/apply — 「정지」 칸 · 사유 보임 · 「심사 중」 없음', seen.get(f'apply{w}') == (1, True, 0), str(seen.get(f'apply{w}')))
        ok('③ /health/seller — 입점 약관 동의 칸(체크 전 단추 꺼짐 · 체크하면 켜짐) · 화면 오류 없음', seen.get('agree') == (1, 1, True, False) and not errs, f"{seen.get('agree')} · {errs[:2]}")
    else:
        ok('③ 화면 — playwright · SITE 필요', False, 'playwright 또는 SITE 없음')
    psql(f"UPDATE partners SET status = 'ACTIVE', suspended_reason = NULL WHERE business_id IN (SELECT id FROM businesses WHERE account_id = '{ids[MAL]}') AND status = 'SUSPENDED'")
    ok('끝 — 되돌림(입점 신청 받기 처음 값)', psql("SELECT coalesce(value, 'off') FROM site_settings WHERE key = 'mall.tenant_apply'") == (t0 or 'off'), t0)

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
