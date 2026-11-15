"""v10.314 (D219 · docs/438) — 법무 회신 적기 시험
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1314.py

  ① (코드) D219 legal_replies · GET · POST · 감사 · DTO · 영어 · 대표 할 일 줄 · 화면 칸 · 문서 438 · 판 v10.314
  ② (API) 적기 · 같은 물음 다시 → 지금 답 · 6번 · 내일 422 · 잘못된 답 400 · ADMIN 403 · DB 고치기 막힘 · 감사
  ③ (대표 할 일) rate-legal 줄 「법무 회신 n/5」(요율 공지 답이 있을 때) · 20줄
  ④ (화면) 「법무 회신」 칸
  쌓기만이라 시험 줄은 남음 — 주제 OTHER · 물음 11 ~ 20 · 확인한 사람 「시험 1314 …」로 실제 기록과 구분 · 두 번 돌아도 통과.
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


def doc(prefix):
    d = os.path.join(K, 'docs')
    return next((open(os.path.join(d, x), encoding='utf-8').read() for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith(prefix)), '')


VER = rd('VERSION').strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=180).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()


def admin_account(tag, stamp):
    """ADMIN(최고 관리자 아님) 시험 계정 — 남겨 두어도 두 번째 실행에 지장 없음"""
    import consent_ok
    em = f't{tag}adm{stamp}@x.com'
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{em}', '시험{tag}', '{pw}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{em}'")
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag}', true); INSERT INTO account_roles (account_id, role) VALUES ('{aid}', 'ADMIN') ON CONFLICT DO NOTHING; COMMIT;")
    consent_ok.agree(em, PW)
    return em, aid


def login(e):
    return call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')


TERMS_MD5 = "SELECT md5(string_agg(code || version || status || coalesce(body, ''), '|' ORDER BY code, version)) FROM terms"

M19, TS_, TC, TD = rd('prisma/migrations/D219_legal_replies/migration.sql'), rd('src/modules/catalog/terms.service.ts'), rd('src/modules/catalog/terms.controller.ts'), rd('src/modules/catalog/terms.dto.ts')
OT, TP, RN, D438 = rd('src/modules/admin/owner-todo.service.ts'), rd('web/src/app/admin/TermsPanel.tsx'), rd('src/modules/catalog/terms-rate-notice-pack.ts'), doc('438_')
ok('① DB · 서버 — D219 legal_replies(주제 4 · 물음 1 ~ 20 · 답 3 · 쌓기만 · 재실행 안전 · 지우는 문장 없음) · GET · POST(SUPER · 감사 LEGAL_REPLY · 오늘까지 · 부록 물음 1 ~ 5) · DTO · 영어',
   "CHECK (topic IN ('RATE_NOTICE', 'PRIVACY', 'HLT_SELLER', 'OTHER'))" in M19 and 'CHECK (q_no BETWEEN 1 AND 20)' in M19 and "CHECK (answer IN ('OK', 'FIX', 'NOTE'))" in M19
   and 'EXECUTE FUNCTION public.fn_append_only_guard()' in M19 and 'CREATE TABLE IF NOT EXISTS public.legal_replies' in M19 and 'DELETE' not in M19.upper().replace('BEFORE UPDATE OR DELETE', '')
   and "@Get('terms/legal-replies')" in TC and "@Post('terms/legal-replies')" in TC and "@Audit('LEGAL_REPLY', 'TERM')" in TC
   and "'REPLIED_ON_FUTURE'" in TS_ and "'LEGAL_Q_RANGE'" in TS_ and 'export const RATE_NOTICE_QUESTIONS: readonly string[]' in RN
   and TD.index('export class LegalReplyDto') < TD.index('export class LegalRepliesDto') and TD.index('export class LegalTopicSumDto') < TD.index('export class LegalRepliesDto')
   and '"답한 날은 오늘(한국 날짜)까지만 적을 수 있습니다.":' in rd('src/common/i18n/server-text.en.ts'), '')
ok('① 대표 할 일 · 화면 — rate-legal 줄에 「법무 회신 a/5」(줄 수 · 직접 확인 그대로) · 「약관」 맨 아래 「법무 회신」 칸 · 확인 창 · 지난 답 · 문서 438 · 판 v10.314',
   "(r.key === 'rate-legal' ? legalNote : '')" in OT and "FROM legal_replies WHERE topic = 'RATE_NOTICE'" in OT and "export const MANUAL_KEYS = ['plans', 'legal', 'ebs', 'rate-legal'] as const;" in OT
   and 'data-terms-legal=' in TP and 'data-legal-save' in TP and "useApi<LegalReplies>('/admin/terms/legal-replies')" in TP
   and 'D219' in D438 and VT >= (10, 314), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    stamp = str(int(time.time()))[-7:]
    ADM, _ = admin_account('1314', stamp)
    TS, TA = login('admin@x.com'), login(ADM)
    today = psql("SELECT to_char((now() AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD')")
    tomorrow = psql("SELECT to_char((now() AT TIME ZONE 'Asia/Seoul')::date + 1, 'YYYY-MM-DD')")
    WHO = f'시험 1314 {stamp}'
    q5 = 5   # 부록 물음 수 — 이 시험은 OTHER 주제의 높은 번호를 써서 다른 시험 · 실제 기록과 겹치지 않게 함
    qn = int(stamp) % 10 + 11
    p1 = call('POST', '/admin/terms/legal-replies', {'topic': 'OTHER', 'qNo': qn, 'answer': 'FIX', 'opinion': '제4조 고칠 것', 'reviewer': WHO, 'repliedOn': today}, TS)
    p2 = call('POST', '/admin/terms/legal-replies', {'topic': 'OTHER', 'qNo': qn, 'answer': 'OK', 'reviewer': WHO, 'repliedOn': today}, TS)
    g = call('GET', '/admin/terms/legal-replies', None, TS)
    mine = [x for x in g.get('rows') or [] if x.get('reviewer') == WHO]
    e1 = call('POST', '/admin/terms/legal-replies', {'topic': 'RATE_NOTICE', 'qNo': 6, 'answer': 'OK', 'reviewer': WHO, 'repliedOn': today}, TS)
    e2 = call('POST', '/admin/terms/legal-replies', {'topic': 'OTHER', 'qNo': qn, 'answer': 'OK', 'reviewer': WHO, 'repliedOn': tomorrow}, TS)
    e3 = call('POST', '/admin/terms/legal-replies', {'topic': 'OTHER', 'qNo': qn, 'answer': 'MAYBE', 'reviewer': WHO, 'repliedOn': today}, TS)
    e4 = call('POST', '/admin/terms/legal-replies', {'topic': 'OTHER', 'qNo': qn, 'answer': 'OK', 'reviewer': WHO, 'repliedOn': today}, TA)
    e5 = call('GET', '/admin/terms/legal-replies', None, TA)
    up = psql(f"UPDATE legal_replies SET answer = 'NOTE' WHERE reviewer = '{WHO}'")
    au = psql(f"SELECT count(*) FROM audit.audit_logs WHERE action = 'LEGAL_REPLY' AND occurred_at > now() - interval '10 minutes'")
    ok('② API — 적기 2번(같은 물음 FIX → OK) · 새 줄이 지금 답(latest) · 옛 답 남음 · 부록 6번 422 LEGAL_Q_RANGE · 내일 422 REPLIED_ON_FUTURE · 잘못된 답 400 · ADMIN 403 · DB 고치기 막힘 · 감사 기록',
       p1.get('ok') and p2.get('ok') and len(mine) == 2 and mine[0].get('answer') == 'OK' and mine[0].get('latest') is True and mine[1].get('latest') is False
       and mine[1].get('opinion') == '제4조 고칠 것' and g.get('rateNoticeQuestions') == q5
       and e1.get('_err') == 422 and e1.get('code') == 'LEGAL_Q_RANGE' and e2.get('_err') == 422 and e2.get('code') == 'REPLIED_ON_FUTURE'
       and e3.get('_err') == 400 and e4.get('_err') == 403 and e5.get('_err') == 403 and '!' in up and 'APND' in up and au not in ('', '0') and not au.startswith('!'),
       f"{[ (x.get('answer'), x.get('latest')) for x in mine]} · {e1.get('code')} {e2.get('code')} {e3.get('_err')} {e4.get('_err')} {e5.get('_err')} · up {up[-60:]} · 감사 {au}")
    before = call('GET', '/admin/launch-watch/owner-todo', None, TS)
    rl0 = next((r for r in before.get('rows') or [] if r.get('key') == 'rate-legal'), {})
    n0 = int(psql("SELECT count(DISTINCT q_no) FROM legal_replies WHERE topic = 'RATE_NOTICE'") or 0)
    ok('③ 대표 할 일 — 「요율 인상 공지 방식을 법무에 알리기」 줄 · 직접 확인 그대로 · 요율 공지 답이 있으면 「법무 회신 n/5」 · 없으면 붙지 않음 · 전체 20줄',
       rl0.get('manual') is True and before.get('total') == 20 and ((f'법무 회신 {n0}/5' in (rl0.get('now') or '')) if n0 else ('법무 회신' not in (rl0.get('now') or ''))),
       f"{rl0.get('now')} · n0 {n0} · total {before.get('total')}")
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if ADMIN_WEB and sync_playwright:
        seen = {}
        try:
            with sync_playwright() as p:
                b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 1000})
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                pg.goto(ADMIN_WEB + '/#/terms', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                box = pg.locator('[data-terms-legal]')
                seen['box'] = box.count()
                seen['topicRate'] = box.locator('[data-terms-legal-topic^="RATE_NOTICE:"]').count() if box.count() else 0
                seen['mine'] = box.locator(f'[data-legal-row^="OTHER:{qn}:OK:latest"]').count() if box.count() else 0
                seen['saveOff'] = box.locator('[data-legal-save]').is_disabled() if box.count() else None
                b.close()
        except Exception as e:
            seen['err'] = str(e)[:200]
        ok('④ 화면 — 「약관」 맨 아래 「법무 회신」 칸 · 요율 공지 주제 수 · 시험이 적은 지금 답 줄 · 확인한 사람 비면 「적기」 잠김',
           seen.get('box') == 1 and seen.get('topicRate') == 1 and seen.get('mine', 0) >= 1 and seen.get('saveOff') is True, f'{seen}')
    else:
        print('  (운영 화면 · playwright 없음 — ④ 건너뜀)')
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
