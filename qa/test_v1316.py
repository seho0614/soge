"""v10.316 (docs/441) — 법무 회신 → 약관 고치기 시험
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1316.py

  ① (코드) 주제 → 약관(LEGAL_TOPIC_TERM) · 회신 줄 termCode · 게시 준비 「법무 회신」 항목 · 화면 「이 약관 고치기」 · 고치기 칸 위 답 · 문서 441 · 판 v10.316
  ② (API) 입점 약관 물음에 「고쳐야 함」 → 입점 약관 1.0 게시 준비 「법무 회신」 아직 · 줄 termCode HLT_SELLER · 그 밖 주제는 termCode 없음
  ③ (화면) 「법무 회신」 그 줄 「이 약관 고치기」 → 입점 약관 「고치기」 열림 · 칸 위에 그 답
  ④ (API) 같은 물음에 「맞음」 → 「법무 회신」 아직이 풀림(마지막에 늘 「맞음」을 적어 둠 — 다른 시험 · 두 번째 실행에 지장 없음)
  쌓기만이라 시험 줄은 남음 — 입점 약관 물음 11 ~ 20 · 확인한 사람 「시험 1316 …」.
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


TS_, TD, TP, D441 = rd('src/modules/catalog/terms.service.ts'), rd('src/modules/catalog/terms.dto.ts'), rd('web/src/app/admin/TermsPanel.tsx'), doc('441_')
ok('① 서버 — 주제 → 약관(요율 인상 공지 방식 · 입점 약관 → HLT_SELLER · 처리방침 → PRIVACY · 그 밖 없음) · 회신 줄 termCode · 게시 준비 「법무 회신」(물음마다 가장 최근 답 · 고쳐야 함이면 todo · 없으면 info) · DTO',
   "export const LEGAL_TOPIC_TERM: Record<string, string | null> = { RATE_NOTICE: 'HLT_SELLER', PRIVACY: 'PRIVACY', HLT_SELLER: 'HLT_SELLER', OTHER: null };" in TD
   and "items.push({ key: 'legal', label: '법무 회신', state: lg.fix ? 'todo' : lg.answered ? 'ok' : 'info'," in TS_ and 'termCode: LEGAL_TOPIC_TERM[r.topic] ?? null' in TS_
   and 'ORDER BY topic, q_no, created_at DESC, id DESC) l`, [lt]);' in TS_ and 'termCode!: string | null;' in TD, '')
ok('① 화면 · 문서 — 지금 답이 「고쳐야 함」인 줄에만 「이 약관 고치기」 · 가장 높은 초안(없으면 새 판) 「고치기」 · 칸 위 「법무 회신 — …」 · 문서 441 · 판 v10.316',
   "r.latest && r.answer === 'FIX' && r.termCode" in TP and 'data-legal-fix=' in TP and 'function fixFromLegal(' in TP and 'data-term-legal-note' in TP
   and 'same.find((u) => editable(u.status)) ?? same[0]' in TP and '이 약관 고치기' in D441 and VT >= (10, 316), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    stamp = str(int(time.time()))[-7:]
    TS = login('admin@x.com')
    today = psql("SELECT to_char((now() AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD')")
    WHO = f'시험 1316 {stamp}'
    qn = int(stamp) % 10 + 11
    has10 = psql("SELECT count(*) FROM terms WHERE code = 'HLT_SELLER' AND version = '1.0'") == '1'
    pre = call('GET', '/admin/terms/HLT_SELLER/publish-ready?version=1.0', None, TS)
    try:
        f1 = call('POST', '/admin/terms/legal-replies', {'topic': 'HLT_SELLER', 'qNo': qn, 'answer': 'FIX', 'opinion': f'제{qn}조 문구 고칠 것 {stamp}', 'reviewer': WHO, 'repliedOn': today}, TS)
        r1 = call('GET', '/admin/terms/HLT_SELLER/publish-ready?version=1.0', None, TS)
        lg1 = next((x for x in r1.get('items') or [] if x.get('key') == 'legal'), {})
        g = call('GET', '/admin/terms/legal-replies', None, TS)
        mine = [x for x in g.get('rows') or [] if x.get('reviewer') == WHO]
        oth = [x for x in g.get('rows') or [] if x.get('topic') == 'OTHER']
        rn = [x for x in g.get('rows') or [] if x.get('topic') == 'RATE_NOTICE']
        ok('② API — 입점 약관 물음 「고쳐야 함」 → 입점 약관 1.0 게시 준비 「법무 회신」 todo(「입점 약관 n번」) · ready false · 줄 termCode HLT_SELLER · 그 밖 termCode 없음 · 요율 공지 HLT_SELLER',
           has10 and f1.get('ok') and lg1.get('state') == 'todo' and f'입점 약관 {qn}번' in (lg1.get('text') or '') and r1.get('ready') is False
           and len(mine) == 1 and mine[0].get('termCode') == 'HLT_SELLER' and all(x.get('termCode') is None for x in oth) and all(x.get('termCode') == 'HLT_SELLER' for x in rn),
           f"has10 {has10} · pre {next((x.get('state') for x in pre.get('items') or [] if x.get('key') == 'legal'), None)} · {lg1} · mine {[(x.get('answer'), x.get('termCode')) for x in mine]} · 그 밖 {len(oth)}")
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
                    btn = pg.locator(f'[data-legal-fix="HLT_SELLER:{qn}:HLT_SELLER"]')
                    seen['btn'] = btn.count()
                    seen['otherBtn'] = pg.locator('[data-legal-fix^="OTHER:"]').count()
                    if btn.count():
                        btn.first.click(); pg.wait_for_timeout(1200)
                        ed = pg.locator('[data-term-editor^="HLT_SELLER:"]')
                        seen['editor'] = ed.count()
                        note = pg.locator('[data-term-legal-note]')
                        seen['note'] = note.inner_text() if note.count() else ''
                    b.close()
            except Exception as e:
                seen['err'] = str(e)[:200]
            ok('③ 화면 — 그 줄에 「이 약관 고치기」(그 밖 주제 줄에는 없음) · 누르면 입점 약관 「고치기」 열림 · 칸 위 「법무 회신 — 입점 약관 n번 · 고쳐야 함 …」',
               seen.get('btn') == 1 and seen.get('otherBtn') == 0 and seen.get('editor') == 1 and f'입점 약관 {qn}번' in seen.get('note', '') and str(stamp) in seen.get('note', ''), f'{seen}')
        else:
            print('  (운영 화면 · playwright 없음 — ③ 건너뜀)')
    finally:
        f2 = call('POST', '/admin/terms/legal-replies', {'topic': 'HLT_SELLER', 'qNo': qn, 'answer': 'OK', 'reviewer': WHO, 'repliedOn': today}, TS)
    r2 = call('GET', '/admin/terms/HLT_SELLER/publish-ready?version=1.0', None, TS)
    lg2 = next((x for x in r2.get('items') or [] if x.get('key') == 'legal'), {})
    fixLeft = psql("SELECT count(*) FROM (SELECT DISTINCT ON (topic, q_no) answer FROM legal_replies WHERE topic IN ('HLT_SELLER', 'RATE_NOTICE') ORDER BY topic, q_no, created_at DESC, id DESC) l WHERE answer = 'FIX'")
    ok('④ API — 같은 물음에 「맞음」 → 「법무 회신」 todo 풀림(다른 「고쳐야 함」이 없으면 ok) · 옛 답 남음',
       f2.get('ok') and ((lg2.get('state') == 'ok') if fixLeft == '0' else (lg2.get('state') == 'todo' and f'입점 약관 {qn}번' not in (lg2.get('text') or ''))),
       f'{lg2} · 남은 고쳐야 함 {fixLeft}')
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
