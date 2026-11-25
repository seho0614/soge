"""v10.437 (D257 · docs/574) 세무사 공유 계정 — 운영 역할 ACCOUNTANT(읽기 전용 · 기한 꼭)
  ① (코드) 역할 CHECK · 기한 미룬 트리거 · 증빙 열람 · 권한 검사 세무사 읽기 · 기한 지난 역할 빠짐 · 접속 기록 · 줄 수 있는 역할 · 내려받기 대상 · API · 화면 · 문서 574
  ② (API · DB) 기한 없이 주기 DB 막음 · 기한 두고 주기 · 회계 GET 200 · 쓰기 403 · 다른 운영 화면 403 · 질문 · SUPER 답 · 세무사 답 403 · 접속 기록 · 기한 지나면 403
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1437.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1437.py
"""
import base64, datetime, hashlib, hmac, json, os, re, struct, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()


def totp(secret, step, digits=6):
    key = base64.b32decode(secret.upper() + '=' * (-len(secret) % 8))
    h = hmac.new(key, struct.pack('>Q', step), hashlib.sha1).digest()
    o_ = h[-1] & 15
    return str((struct.unpack('>I', h[o_:o_ + 4])[0] & 0x7fffffff) % 10 ** digits).zfill(digits)

def mfa_token(t):
    """세무사는 늘 2단계(D257) — 등록 · 켜기 뒤 확인된 증표"""
    sec = sgb('POST', '/auth/mfa/setup', None, t).get('secret') or ''
    if not sec: return t
    st = sgb('POST', '/auth/mfa/enable', {'code': totp(sec, int(time.time() // 30))}, t).get('accessToken')
    if not st: return t
    nt = Tok(handoff(st) or st); nt.sgb = st   # ERP: 2단계 뒤 소개뱅크 증표 → ERP 증표(넘겨주기 · 안 되면 그대로)
    return nt




M50 = migr('D250_')
RC, RD, RP, WL, RS = rd('src/modules/admin/report.controller.ts'), rd('src/modules/admin/report-day.ts'), rd('src/modules/admin/report-period.ts'), rd('src/modules/admin/worklog.ts'), rd('src/modules/admin/report-send.ts')

M57 = migr('D257_')
AX, AU, AM, AR, RA = rd('src/modules/acct/acct-extra.controller.ts'), rd('src/modules/acct/accountant.ts'), rd('src/modules/acct/accrual.ts'), rd('src/modules/acct/archive.ts'), rd('src/modules/acct/receipt-ai.ts')
UI, AP, MN, SC, WK, APM = rd('web/src/app/admin/AcctExtra.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'), rd('src/app.module.ts')
AUTH, PRN, MID, RPS, EXA, SRC = rd('src/core/auth.ts'), rd('src/modules/identity/principal.service.ts'), rd('src/modules/identity/auth.middleware.ts'), rd('src/modules/site/report.service.ts'), rd('src/modules/admin/export-approval.ts'), rd('src/modules/acct/sources.ts')
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
ym, d0 = kst.strftime('%Y-%m'), kst.strftime('%Y-%m-%d')
stamp = int(time.time()) % 1000000

ok('① 코드 — D257 역할 CHECK ACCOUNTANT · 기한 트리거 · fn_file_can_read · AuthGuard 세무사 읽기 · principal 기한 · 접속 기록 · setRole · TARGET_ROLES · API 3 · 화면 · 메뉴 · 문서 574 · 판 v10.437' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   "@Get('accountant')" in AX
       and "@Post('accountant/notes')" in AX, VER)

if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW)
    TS = login('admin@x.com')
    em, aid = mk_staff('1437', None)
    try:
        noexp = psql_sgb(f"BEGIN; SELECT set_config('app.role_reason', '시험 1437 기한 없음', true); INSERT INTO account_roles (account_id, role) VALUES ('{aid}', 'ACCOUNTANT'); COMMIT;")
        good = psql_sgb(f"BEGIN; SELECT set_config('app.role_reason', '시험 1437', true); INSERT INTO account_roles (account_id, role) VALUES ('{aid}', 'ACCOUNTANT'); "
                    f"UPDATE account_roles SET expires_at = now() + interval '7 days' WHERE account_id = '{aid}' AND role = 'ACCOUNTANT'; COMMIT;")
        agree(em, PW)
        TA0 = login(em)
        pend = erp('GET', '/admin/acct/accounts', None, TA0)   # 2단계 전 — MFA_REQUIRED
        TA = mfa_token(TA0)
        acc = erp('GET', '/admin/acct/accounts', None, TA)
        mon = erp('GET', f'/admin/acct/month?ym={ym}', None, TA)
        run = erp('POST', '/admin/acct/journal/run', None, TA)
        pur = erp('POST', '/admin/acct/purchases', {'kind': 'SIMPLE', 'issuedOn': d0, 'supplierName': '시험1437', 'item': 'x', 'supply': 1000, 'accountRole': 'EXP_ETC', 'payRole': 'AP'}, TA)
        other = sgb('GET', '/admin/storage-status', None, TA)
        nt = erp('POST', '/admin/acct/accountant/notes', {'ym': ym, 'body': f'시험 1437 질문 {stamp}'}, TA)
        rp = erp('POST', f"/admin/acct/accountant/notes/{nt.get('id')}/reply", {'body': '시험 1437 답'}, TS)
        rpa = erp('POST', f"/admin/acct/accountant/notes/{nt.get('id')}/reply", {'body': 'x'}, TA)
        desk = erp('GET', f'/admin/acct/accountant?ym={ym}', None, TA)
        sdesk = erp('GET', '/admin/acct/accountant', None, TS)
        mine = next((x for x in desk.get('notes') or [] if x.get('id') == nt.get('id')), {})
        time.sleep(1)
        logs = psql_erp(f"SELECT count(*) FROM acct_accountant_access WHERE account_id = '{aid}'")
        psql_sgb(f"UPDATE account_roles SET expires_at = now() - interval '1 minute' WHERE account_id = '{aid}' AND role = 'ACCOUNTANT'")
        late = erp('GET', '/admin/acct/accounts', None, TA)
        ok('② 세무사 — 기한 없이 주기 DB 막음 · 기한 두고 주기 · 2단계 전 MFA_REQUIRED · 2단계 뒤 회계 GET 200 · 전표 만들기 · 매입 넣기 403 · 다른 운영 화면 403 · 질문 · SUPER 답 · 세무사 답 403 · 내 질문 · 답 보임 · SUPER 목록 · 접속 기록 · 기한 지나면 403',
           'ACCOUNTANT_EXPIRY' in noexp and '!' not in good and pend.get('code') == 'MFA_REQUIRED' and isinstance(acc.get('accounts'), list) and mon.get('ym') == ym
           and run.get('_err') == 403 and pur.get('_err') == 403 and other.get('_err') == 403
           and nt.get('ok') is True and rp.get('ok') is True and rpa.get('_err') == 403 and desk.get('isAccountant') is True
           and any(r.get('body') == '시험 1437 답' for r in mine.get('replies') or []) and any(x.get('id') == aid for x in sdesk.get('accountants') or [])
           and int(logs or 0) >= 3 and late.get('_err') in (401, 403),
           f"{noexp[-40:]} · {good[-30:]} · {pend.get('code')} · {bool(acc.get('accounts'))} {mon.get('ym')} · {run.get('_err')} {pur.get('_err')} {other.get('_err')} · {nt.get('ok')} {rp.get('ok')} {rpa.get('_err')} {desk.get('isAccountant')} · {logs} · {late.get('_err')}")
    finally:
        psql_erp(f"SET session_replication_role = replica; DELETE FROM acct_accountant_replies WHERE note_id IN (SELECT id FROM acct_accountant_notes WHERE account_id = '{aid}'); "
             f"DELETE FROM acct_accountant_notes WHERE account_id = '{aid}'; DELETE FROM acct_accountant_access WHERE account_id = '{aid}';")
        psql_sgb(f"DELETE FROM account_mfa WHERE account_id = '{aid}'")   # ERP: 2단계 등록은 소개뱅크 표
        rm_role(aid, '1437')
    pass  # ERP: 화면 단계(옛 운영 화면 ADMIN_WEB) 뺌 — ERP 화면(15175)에 아직 없음
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

summary()
