"""v10.48 시험 — 회원 탈퇴 · 비밀번호 재설정 · 로그인 잠금 · 요청 횟수 제한 · docs/100

  KIT=… python3 -I test_v1048.py

  ① D102 — 표 3개 · 함수 · 설정 5개 · 탈퇴 가드 · 알림 종류 · 감시 보기 · 마이그레이션 140
  ② 쓰는 이름이 모두 import · 선언됨(새 파일 · 고친 파일)
  ③ 등록 — app.module · 화면 목록(screens.json 3개 추가 · API 연결) · 알림 목록 · 권한 표시 · 공개 라우트는 auth 아래
  ④ 로그인 — 잠금 문 · 실패 셈 · 성공 지움 · 계정 유무가 드러나지 않음 · 판 번호(tv)로 옛 증표 무효
  ⑤ 재설정 · 변경 · 탈퇴 — 증표 원문 미저장 · 같은 답 · devLink 는 개발만 · 감사 기록에 증표 없음 · 막는 항목은 DB 한 곳
  ⑥ 화면 — 비밀번호 찾기 · 재설정 · 계정(변경 · 탈퇴 입구) · 탈퇴 · 운영 회원 상세 잠금 풀기 · 접속자 IP 전달
  ⑦ 검정 — 불변식 AUTH-01~19 · 공격 AX-01~10 · 개인정보 파기 배치
  ⑧ 개발 서버(ts-node · strict 끔)에서 뜸 — DTO 선언 순서 · 성공/실패 유니온을 좁혀 읽지 않음
"""
import glob, json, os, re

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


def strip(s):
    return re.sub(r'/\*[\s\S]*?\*/|(?<![:\w])//[^\n]*', '', s)


GLOBALS = {'Promise', 'Number', 'String', 'Date', 'Error', 'Set', 'Map', 'Object', 'JSON', 'Math', 'Array', 'Boolean', 'RegExp',
           'Record', 'NonNullable', 'Partial', 'Buffer', 'BigInt', 'Intl', 'Symbol', 'Infinity', 'NaN', 'Awaited', 'ReturnType',
           'React', 'HTMLDivElement', 'HTMLElement', 'HTMLInputElement', 'HTMLFormElement', 'FormData', 'RequestInit', 'Headers',
           'Readonly', 'Pick', 'Omit', 'Exclude', 'NodeJS'}


def undefined_names(s):
    code = strip(s)
    code = re.sub(r"`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"", '""', code)
    code = re.sub(r'>[^<>{}]*<', '><', code)
    code = re.sub(r'([(,=:!&|?]\s*)/(?:\\.|[^/\n\\])+/[gimsuy]*', r'\1""', code)
    imp = set()
    for m in re.finditer(r'import (?:type )?\{([^}]*)\}', s):
        imp |= {x.strip().replace('type ', '').split(' as ')[-1] for x in m.group(1).split(',') if x.strip()}
    imp |= set(re.findall(r'import (?:\* as )?(\w+)(?:\s*,|\s+from)', s))
    decl = set(re.findall(r'(?:class|interface|const|let|function|type|enum)\s+(\w+)', code))
    used = set(re.findall(r'(?<![.\w])([A-Z][a-z][A-Za-z0-9_]*)\b(?!\s*:)', code))
    return sorted(used - imp - decl - GLOBALS)


# ① D102 ---------------------------------------------------------------------
M = rd('prisma/migrations/D102_auth_account_security/migration.sql')
ok('D102 있음', bool(M), '')
for t in ('auth_throttle', 'password_reset_tokens', 'account_withdrawals'):
    ok(f'표 {t}', f'CREATE TABLE IF NOT EXISTS public.{t}' in M, '')
for f in ('fn_auth_email_key', 'fn_login_gate', 'fn_login_fail', 'fn_login_clear', 'fn_reset_request_allowed',
          'fn_password_reset_issue', 'fn_password_reset_consume', 'fn_purge_auth_records', 'fn_withdraw_blockers',
          'fn_account_withdraw', 'fn_account_withdraw_guard'):
    ok(f'함수 {f}', f'FUNCTION public.{f}(' in M, '')
for k, v in (('auth.login.max_fail', '5'), ('auth.login.lock_minutes', '30'), ('auth.login.ip_fail_per_min', '5'),
             ('auth.reset.per_hour', '5'), ('auth.reset.ttl_minutes', '30')):
    ok(f'설정 {k} = {v}', f"('{k}', '{v}', 'GLOBAL'" in M, '')
ok('설정은 이미 있으면 그대로(ON CONFLICT DO NOTHING)', M.count('ON CONFLICT (key) DO NOTHING') == 1, '')
ok('accounts.token_version (처음 0)', 'ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0' in M, '')
ok('키는 해시만(64자 hex 제약)', "CHECK (key_hash ~ '^[0-9a-f]{64}$')" in M and "CHECK (token_hash ~ '^[0-9a-f]{64}$')" in M, '')
ok('잠금은 이메일만 · 3시간 상한', "key_kind = 'LOGIN_EMAIL' AND locked_until <= last_at + interval '3 hours'" in M, '')
ok('증표 유효 1시간 상한', "expires_at <= created_at + interval '1 hour'" in M, '')
ok('증표 원문 칸 없음', not re.search(r'\n\s+(token|token_plain|raw_token)\s+text', M), '')
ok('이메일 키 = sha256(소문자 · 공백 제거)', "digest(lower(btrim(coalesce(p_email, ''))), 'sha256')" in M, '')
ok('IP 제한은 실패만 셈(성공은 fn_login_clear 가 이메일 기록만 지움)',
   re.search(r"fn_login_clear[\s\S]*?DELETE FROM auth_throttle WHERE key_kind = 'LOGIN_EMAIL'", M) is not None, '')
ok('잠금이 끝나면 다시 1부터', "WHEN t.locked_until IS NOT NULL AND t.locked_until <= now() THEN 1" in M, '')
ok('RETURNS TABLE 함수는 칸 이름 충돌 방지(#variable_conflict)', M.count('#variable_conflict use_column') == 2, '')
ok('증표 쓰기는 한 문장 UPDATE … RETURNING(두 번 못 씀) · 정상 계정만',
   re.search(r"UPDATE password_reset_tokens t SET used_at = now\(\)[\s\S]*?t\.used_at IS NULL AND t\.revoked_at IS NULL[\s\S]*?ac\.status = 'ACTIVE'", M) is not None, '')
ok('새 증표를 주면 그 전 증표 무효', re.search(r'fn_password_reset_issue[\s\S]*?SET revoked_at = now\(\)', M) is not None, '')
bl = re.search(r'FUNCTION public\.fn_withdraw_blockers[\s\S]*?\$\$;', M).group(0)
for c in ('DEAL_OPEN', 'DISPUTE_OPEN', 'SETTLEMENT_OPEN', 'ORDER_OPEN', 'RETURN_OPEN', 'SUB_REFUND_OPEN', 'LEAD_CASH_LEFT', 'LEAD_CASH_REFUND_OPEN'):
    ok(f'탈퇴를 막는 항목 {c}', f"'{c}'" in bl, '')
ok('정산 막음 = 요청 · 승인 · 보류', "s.status IN ('REQUESTED','APPROVED','HELD')" in bl, '')
ok('문의만 한 거래(INQUIRY)는 30일 지나면 막지 않음', "d.status = 'INQUIRY' AND d.created_at > now() - interval '30 days'" in bl, '')
wd = re.search(r'FUNCTION public\.fn_account_withdraw\(p_account[\s\S]*?END \$\$;', M).group(0)
ok('탈퇴 — 구독 자동 결제 멈춤 · 결제 수단 해제 · 증표 무효 · 판 번호 +1',
   'SET cancel_at = coalesce(cancel_at, clock_timestamp())' in wd and "SET status = 'REVOKED'" in wd
   and 'UPDATE password_reset_tokens SET revoked_at' in wd and 'token_version = token_version + 1' in wd, '')
ok('탈퇴 — 기존 규칙(보관 기한 · 상태 · 매물 내림)은 withdrawn_at 으로 그대로', 'SET withdrawn_at = now()' in wd and 'status' not in wd.split('SET withdrawn_at')[1].split(';')[0], '')
ok('탈퇴 가드 트리거(직접 UPDATE 도 막음)', 'CREATE TRIGGER trg_account_withdraw_guard BEFORE UPDATE OF withdrawn_at ON public.accounts' in M, '')
ok('기타 사유는 내용 필수(DB)', "CHECK (reason_code <> 'OTHER' OR length(btrim(coalesce(memo, ''))) >= 2)" in M, '')
ok('알림 종류 2개 · 수신거부 불가', "('PASSWORD_CHANGED', '비밀번호 변경', false" in M and "('LOGIN_LOCKED', '로그인 잠금', false" in M, '')
for v in ('v_auth_lock_overlong', 'v_reset_token_live_overdue', 'v_withdrawn_with_open_items'):
    ok(f'감시 보기 {v} · 「0 이어야 정상」 주석', f'CREATE OR REPLACE VIEW public.{v}' in M and f'COMMENT ON VIEW public.{v}' in M, '')
ok('자료를 지우지 않음(DROP TABLE · DELETE FROM accounts 없음)', 'DROP TABLE' not in M and 'DELETE FROM accounts' not in M, '')
ok('감시 규칙에 걸리는 칸 이름 없음(카드 · 계좌 · 좌표 · 잔액)',
   not re.search(r'\n\s+(\w*(card_?(no|num|pan)|cvc|cvv|expiry|exp_date|account_no|bank_code|escrow|lat|lng|lon)\w*)\s', M), '')
migs = sorted(glob.glob(os.path.join(K, 'prisma/migrations/*/migration.sql')))
ok('마이그레이션 140 이상 · D102 있음', len(migs) >= 140 and any(m.endswith('D102_auth_account_security/migration.sql') for m in migs), str(len(migs)))
ver = tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))[:2] or [0, 0])
ok('VERSION v10.48 이상', ver >= (10, 48), rd('VERSION').strip())

# ② 쓰는 이름 -----------------------------------------------------------------
FILES = ['src/modules/identity/auth-throttle.ts', 'src/modules/identity/account-security.service.ts',
         'src/modules/identity/account-security.controller.ts', 'src/modules/identity/auth.service.ts',
         'src/modules/identity/auth.middleware.ts', 'src/modules/identity/principal.service.ts',
         'site/src/components/auth/PasswordForms.tsx', 'site/src/components/auth/LoginForm.tsx',
         'site/src/app/login/forgot/page.tsx', 'site/src/app/login/reset/page.tsx',
         'site/src/app/my/account/page.tsx', 'site/src/app/my/account/AccountForms.tsx',
         'site/src/app/my/account/withdraw/page.tsx', 'site/src/app/my/account/withdraw/WithdrawForm.tsx',
         'site/src/lib/session.ts', 'web/src/app/admin/Members.tsx']
for f in FILES:
    s = rd(f)
    ok(f'파일 있음 · 이름 모두 선언({f.split("/")[-1]})', bool(s) and not undefined_names(s), ' '.join(undefined_names(s)))

# ③ 등록 ---------------------------------------------------------------------
am = rd('src/app.module.ts')
ok('app.module — 컨트롤러 · 서비스', 'AccountSecurityController,' in am and 'AccountSecurityService,' in am, '')
S = json.loads(rd('spec/screens.json'))
sc = {s['id']: s for s in S['screens']}
for i, u, apis in (('SB-HOM-AUT-040', '/login/forgot', ['POST /auth/password/forgot']),
                   ('SB-HOM-AUT-041', '/login/reset', ['POST /auth/password/reset']),
                   ('SB-MYP-ACC-020', '/my/account/withdraw', ['GET /me/withdraw/check', 'POST /me/withdraw'])):
    ok(f'화면 {i}', i in sc and sc[i]['url'] == u and all(a in sc[i]['apis'] for a in apis), '')
ok('SB-MYP-ACC-010 에 PATCH /me/password', 'PATCH /me/password' in sc['SB-MYP-ACC-010']['apis'], '')
ok('SB-ADM-MBR-020 에 잠금 보기 · 풀기', all(a in sc['SB-ADM-MBR-020']['apis'] for a in
   ('GET /admin/accounts/{id}/login-lock', 'DELETE /admin/accounts/{id}/login-lock')), '')
ok('화면 ID 형식 · 중복 없음', len(sc) == len(S['screens']) and all(re.match(r'^SB-[A-Z]{3}-[A-Z0-9]{3,4}-\d{3}$', k) for k in sc), str(len(sc)))
N = json.loads(rd('spec/notifications.json'))
ev = {e['code']: e for e in N['events']}
ok('알림 목록 — PASSWORD_CHANGED · LOGIN_LOCKED(수신거부 불가 · 도착 화면 실재)',
   all(c in ev and ev[c]['optout'] is False and ev[c]['screen'] in sc for c in ('PASSWORD_CHANGED', 'LOGIN_LOCKED')), '')
cc = rd('src/modules/identity/account-security.controller.ts')
routes = re.findall(r"@(Get|Post|Patch|Delete)\('([^']+)'\)([\s\S]*?)\n  \w+\(", cc)
ok('라우트 7개', len(routes) == 7, str(len(routes)))
for m, p, body in routes:
    if p.startswith('auth/'):
        ok(f'공개 라우트는 auth 아래 · 역할 표시 없음({m} {p})', '@Roles' not in body, '')
    elif p.startswith('admin/'):
        ok(f'운영 라우트는 ADMIN · SUPER ({m} {p})', "@Roles('ADMIN', 'SUPER')" in body, '')
    else:
        ok(f'나의 라우트는 로그인 회원 ({m} {p})', "@Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')" in body, '')
    ok(f'응답 형식 등록({m} {p})', '@ApiOkResponse({ type:' in body, '')
ok('잠금 풀기는 감사 기록', "@Audit('LOGIN_UNLOCK', 'ACCOUNT')" in cc, '')
ok('새 증표를 돌려주는 API 에는 @Audit 없음(증표가 감사 기록에 들어가지 않게)',
   not re.search(r"@Audit\([^)]*\)[\s\S]{0,400}change\(", cc), '')
ok('ACL — auth 는 공개 목록에 있음', "'auth'" in rd('scripts/check-acl.js'), '')

# ④ 로그인 -------------------------------------------------------------------
au = strip(rd('src/modules/identity/auth.service.ts'))
lg = re.search(r'async login\([\s\S]*?\n  \}\n', au).group(0)
ok('로그인 — 문 앞 확인(fn_login_gate) 이 비밀번호 비교보다 먼저', lg.index('fn_login_gate') < lg.index('bcrypt.compare'), '')
ok('로그인 — 틀리면 fn_login_fail · 맞으면 fn_login_clear', 'fn_login_fail' in lg and 'fn_login_clear' in lg, '')
ok('로그인 — 계정 없음 · 비밀번호 틀림은 같은 오류(INVALID_CREDENTIALS)', lg.count("code: 'INVALID_CREDENTIALS'") == 1 and "'ACCOUNT_NOT_FOUND'" not in lg, '')
ok('로그인 — 잠금 423 · IP 429', 'new AccountLocked(' in lg and "'TOO_MANY_ATTEMPTS'" in lg, '')
ok('로그인 — 정지 · 탈퇴 계정은 비밀번호가 맞아야 알림(실패로 세지 않음)', lg.index("'ACCOUNT_INACTIVE'") > lg.index('fn_login_fail'), '')
ok('잠기면 본인에게 알림(LOGIN_LOCKED)', "'LOGIN_LOCKED'" in au, '')
ok('증표에 판 번호(tv) — access · refresh', re.search(r'sub_active: principal\.hasActiveSubscription,\s*tv,', au) is not None and "typ: 'refresh', tv }" in au, '')
ok('refresh — 판 번호가 다르면 거절', re.search(r"async refresh[\s\S]*?tokenVersion \?\? 0\) !== Number\(payload\.tv \?\? 0\)", au) is not None, '')
mw = rd('src/modules/identity/auth.middleware.ts')
ok('미들웨어 — 판 번호가 다르면 비로그인', "(principal.tokenVersion ?? 0) === tv" in mw, '')
pr = rd('src/modules/identity/principal.service.ts')
ok('principal 에 tokenVersion', 'a.token_version' in pr and 'tokenVersion: Number(row.token_version ?? 0)' in pr, '')
ok('가입 · 변경 · 재설정이 같은 비밀번호 규칙(assertStrongPassword)', 'assertStrongPassword(input.password)' in au
   and rd('src/modules/identity/account-security.service.ts').count('assertStrongPassword(') == 2, '')
th = rd('src/modules/identity/auth-throttle.ts')
ok('IP 는 HMAC(날짜 섞음) — 원문 저장 안 함', "createHmac('sha256'" in th and 'ip:${day}:${ip}' in th, '')
ok('접속자 IP = X-Forwarded-For 첫 값(Nginx 가 덮어씀)', "x-forwarded-for'] ?? '').split(',')[0]" in rd('src/core/context.middleware.ts'), '')

# ⑤ 재설정 · 변경 · 탈퇴 -----------------------------------------------------------
sv = strip(rd('src/modules/identity/account-security.service.ts'))
fg = re.search(r'async forgot\([\s\S]*?\n  \}\n', sv).group(0)
ok('찾기 — 계정이 없어도 같은 답(note) · 횟수 제한은 계정 확인보다 먼저',
   'if (!acc) return { ok: true, note };' in fg and fg.index('fn_reset_request_allowed') < fg.index('FROM accounts'), '')
ok('찾기 — 증표는 32바이트 난수 · DB 에는 해시', "randomBytes(32).toString('base64url')" in fg and 'tokenHash(token)' in fg, '')
ok('찾기 — devLink 는 메일 준비 전 · 개발 환경에서만(운영은 MAIL_NOT_READY)',
   "if (!ready && !dev)" in fg and "'MAIL_NOT_READY'" in fg and fg.rindex('devLink') > fg.index('if (ready)'), '')
ok('찾기 — 메일을 못 보내면 그 증표 무효', 'SET revoked_at = now() WHERE token_hash = $1' in fg, '')
rs = re.search(r'async reset\([\s\S]*?\n  \}\n', sv).group(0)
ok('재설정 — 증표 쓰기 · 비밀번호 · 판 번호 · 잠금 해제 · 알림 · 감사를 한 트랜잭션',
   'this.db.transaction' in rs and rs.index('fn_password_reset_consume') < rs.index('token_version = token_version + 1') < rs.index('fn_login_clear'), '')
ok('재설정 — 응답에 계정 id 를 싣지 않음', 'accountId' not in rs.split('return {')[-1], '')
ch = re.search(r'async change\([\s\S]*?\n  \}\n', sv).group(0)
ok('변경 — 지금 비밀번호 확인(틀리면 실패로 셈) · 판 번호 +1 · 새 증표', 'checkPassword(me, current)' in ch and 'token_version + 1' in ch and 'this.auth.issue(me)' in ch, '')
cp = re.search(r'private async checkPassword[\s\S]*?\n  \}\n', sv).group(0)
ok('비밀번호 확인도 잠금 문 · 실패 셈', 'fn_login_gate' in cp and 'fn_login_fail' in cp, '')
wdr = re.search(r'async withdraw\(password[\s\S]*?\n  \}\n', sv).group(0)
ok('탈퇴 — 비밀번호 확인 → 막는 항목(DB) → fn_account_withdraw', wdr.index('checkPassword') < wdr.index('this.blockers(me)') < wdr.index('fn_account_withdraw'), '')
ok('탈퇴 — 막히면 409 WITHDRAW_BLOCKED + 항목', "code: 'WITHDRAW_BLOCKED'" in wdr and 'details: { blockers }' in wdr, '')
ok('탈퇴 사유는 정해진 6개', len(re.findall(r"^  [A-Z_]+: '", rd('src/modules/identity/account-security.service.ts'), re.M)) == 6, '')
ok('감사 기록은 직접 남김(PASSWORD_RESET · PASSWORD_CHANGE · ACCOUNT_WITHDRAW)',
   all(f"'{a}'" in sv for a in ('PASSWORD_RESET', 'PASSWORD_CHANGE', 'ACCOUNT_WITHDRAW')), '')

# ⑥ 화면 ---------------------------------------------------------------------
ses = rd('site/src/lib/session.ts')
ok('서버 액션이 접속자 IP 를 넘김(X-Forwarded-For)', "h['X-Forwarded-For'] = xff" in ses and 'headers: await fwdHeaders()' in ses, '')
for fn in ('forgotPassword', 'resetPassword', 'changePassword', 'withdrawAccount'):
    ok(f'서버 액션 {fn}', f'export async function {fn}(' in ses, '')
ok('재설정 · 탈퇴 뒤 이 브라우저 로그인 지움 · 변경 뒤 새 증표 저장',
   re.search(r'resetPassword[\s\S]*?await logout\(\)', ses) and re.search(r'withdrawAccount[\s\S]*?await logout\(\)', ses)
   and re.search(r'changePassword[\s\S]*?await saveTokens\(', ses), '')
lf = rd('site/src/components/auth/LoginForm.tsx')
ok('로그인 화면 — 비밀번호 찾기 링크 · 잠기면 다시 안내', 'href="/login/forgot"' in lf and "r.code === 'ACCOUNT_LOCKED'" in lf, '')
fp = rd('site/src/app/login/forgot/page.tsx')
ok('찾기 화면 SB-HOM-AUT-040', 'data-screen="SB-HOM-AUT-040"' in fp and '<ForgotForm action={doForgot} />' in fp, '')
rp = rd('site/src/app/login/reset/page.tsx')
ok('재설정 화면 SB-HOM-AUT-041 · token 형식 확인 · referrer 안 보냄',
   'data-screen="SB-HOM-AUT-041"' in rp and "/^[A-Za-z0-9_-]{30,100}$/" in rp and "referrer: 'no-referrer'" in rp, '')
pf = rd('site/src/components/auth/PasswordForms.tsx')
ok('재설정 폼 — 두 칸 같아야 · 규칙 미리 확인', "pw !== pw2" in pf and 'weakPassword(pw)' in pf, '')
ap = rd('site/src/app/my/account/page.tsx')
ok('계정 화면 — 비밀번호 변경 · 탈퇴 입구', '<PasswordForm action={doChangePassword} />' in ap and 'href="/my/account/withdraw"' in ap, '')
wp = rd('site/src/app/my/account/withdraw/page.tsx')
ok('탈퇴 화면 — 막는 항목 표 · 막히면 폼 숨김 · 끝난 뒤 안내', 'c.blockers.map' in wp and 'c.canWithdraw ?' in wp and 'data-withdraw-signed-out' in wp, '')
wf = rd('site/src/app/my/account/withdraw/WithdrawForm.tsx')
ok('탈퇴 폼 — 사유 · 비밀번호 · 확인 체크', 'name="reason"' in wf and 'name="password"' in wf and 'name="agree"' in wf, '')
mb = rd('web/src/app/admin/Members.tsx')
ok('운영 회원 상세 — 잠금 상태 · 잠금 풀기(DELETE)', '<LoginLock id={a.id} />' in mb and "method: 'DELETE'" in mb and 'data-login-unlock' in mb, '')
css = ''.join(open(f, encoding='utf-8').read() for f in glob.glob(os.path.join(K, 'site/src/**/*.css'), recursive=True))
ok('탈퇴 단추 스타일 정의(p2danger)', '.btn-sm.p2danger' in css, '')

# ⑦ 검정 ---------------------------------------------------------------------
vi = rd('scripts/verify-invariants.sh')
ok('불변식 AUTH-01 ~ AUTH-19', all(f'AUTH-{n:02d} ' in vi for n in range(1, 20)), '')
ok('불변식은 ROLLBACK 안에서만(자료 남기지 않음)', 'BEGIN; DO \\$\\$ DECLARE a uuid; t timestamptz; x text; BEGIN $2 END \\$\\$; SELECT \'ok\'; ROLLBACK;' in vi, '')
at = rd('scripts/attack-check.sh')
ok('공격 AX-01 ~ AX-10', all(f'AX-{n:02d} ' in at for n in range(1, 11)), '')
sch = rd('src/worker/scheduler.service.ts')
ok('개인정보 파기 배치가 증표 · 실패 기록도 지움', 'SELECT fn_purge_auth_records() AS n' in sch, '')

# ⑧ ts-node(strict 끔) ------------------------------------------------------------
fwd = []
for f in ('src/modules/identity/account-security.controller.ts',):
    t = rd(f)
    decl = {m.group(1): m.start() for m in re.finditer(r'^(?:export\s+)?class\s+(\w+)', t, re.M)}
    for m in re.finditer(r'^\s+(?:@\w+\([^\n]*\)\s+)*\w+[!?]?:\s*([A-Z]\w+)(?:\[\])?\s*(?:\|\s*(?:null|undefined)\s*)*;', t, re.M):
        if m.group(1) in decl and decl[m.group(1)] > m.start():
            fwd.append(m.group(1))
    for m in re.finditer(r'extends\s+(\w+)', t):
        if m.group(1) in decl and decl[m.group(1)] > m.start():
            fwd.append('extends ' + m.group(1))
    for m in re.finditer(r'type:\s*\[?(\w+Dto)\]?', t):
        if m.group(1) in decl and decl[m.group(1)] > m.start():
            fwd.append('type ' + m.group(1))
ok('DTO 는 쓰기 전에 선언(ts-node 에서 뜸)', not fwd, ' · '.join(fwd))
for f in ('src/modules/identity/account-security.service.ts', 'src/modules/identity/auth.service.ts', 'src/modules/identity/auth-throttle.ts'):
    t = strip(rd(f))
    ok(f'성공/실패 유니온을 좁혀 읽지 않음({f.split("/")[-1]})', not re.search(r'if \(!?\w+\.ok\)[^\n]*\.(kind|code|message)\b', t), '')

doc = rd('docs/100_회원탈퇴_비밀번호재설정_로그인잠금_v10.48_20261020.md')
ok('작업 문서 docs/100 — 규칙 · 구조 · DB · 화면 · 집 PC 확인 · 운영 적용', all(h in doc for h in ('## 1. 정한 규칙', '## 3. DB (D102)', '## 6. 집 PC', '## 7. 운영 적용')), '')

n_ok = sum(1 for r in RES if r[0])
print(f'통과 {n_ok} / {len(RES)}')
