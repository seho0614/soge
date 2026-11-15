"""v10.311 (docs/434) — 법무 검토 묶음 부록 「요율 인상 공지 방식」 시험
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb python3 test_v1311.py

  ① (코드) 부록(7단계 · 물음 5 · 제17조 4항 · 요율 표 · 지금 값) · 바깥 주소 · 스크립트 없음 · rateNotice · 화면 결과 줄 · 문서 434 · 판 v10.311
  ② (API) GET /admin/terms/review-pack — 부록이 끝에 · 글 · 숫자가 DB 와 같음 · 약관 표 그대로
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

TS_, RN, TP, TD, D434 = rd('src/modules/catalog/terms.service.ts'), rd('src/modules/catalog/terms-rate-notice-pack.ts'), rd('web/src/app/admin/TermsPanel.tsx'), rd('src/modules/catalog/terms.dto.ts'), doc('434_')
ok('① 서버 · 화면 — 묶음 끝 부록(7단계 · 물음 5 · 제17조 4항 글 · 요율 표 대조 · 지금 설정 · 숫자) · 바깥 주소 · 스크립트 없음 · rateNotice · 화면 결과 줄 · 문서 434 · 판 v10.311',
   'buildReviewPack(terms, day)' in TS_ and 'withRateNotice(html, rateNoticeSection(rn))' in TS_ and 'private async rateNoticeInfo()' in TS_ and 'NOTICE_DAYS' in TS_
   and 'export function rateNoticeSection(x: RateNoticeInfo)' in RN and RN.count("    ['") == 7 and '<script' not in RN and 'https://' not in RN
   and 'rateNotice!: boolean' in TD and "r.rateNotice ? ' · 맨 끝 부록 「요율 인상 공지 방식」" in TP and '법무에 묻는 것' in D434 and VT >= (10, 311), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    before = psql(TERMS_MD5)
    r = call('GET', '/admin/terms/review-pack', None, TS)
    h = r.get('html') or ''
    sec = h[h.find('<section class="term" id="rate-notice">'):]
    days = psql("SELECT coalesce(value, '0') FROM site_settings WHERE key = 'hlt.rate_auto_remind_days'") or '0'
    tot = psql("SELECT count(*) FROM hlt_rate_schedules")
    ok('② 묶음 — rateNotice · 부록이 </body> 바로 앞 · 맨 위 안내 한 줄 · 제17조 4항 글 · 7단계 · 물음 5 · 요율 표(1.0 두 줄) · 지금 자동 다시 알림 설정 · 예약 수 · 시행일 계산 31일 · 바깥 주소 · 스크립트 없음 · 약관 그대로',
       r.get('rateNotice') is True and h.rstrip().endswith('</html>') and sec and h.find('id="rate-notice"') < h.rfind('</body>')
       and '맨 끝 부록: 요율 인상 공지 방식' in h and '4. 회사가 요율을 올릴 때에는 시행일 30일 전에 공지하고 개별 통지하며' in sec
       and all(x in sec for x in ('<td>예약</td>', '<td>공지</td>', '<td>개별 통지</td>', '<td>읽음</td>', '<td>다시 알림</td>', '<td>시행</td>', '<td>취소</td>'))
       and sec.count('□ 맞음') == 5 and sec.count('<td>브랜드 직영관</td>') >= 1 and sec.count('<td>일반 입점</td>') >= 1
       and (('시행 ' + days + '일 전') in sec if days != '0' else '자동은 시행 n일 전에 한 번(지금: 꺼짐)' in sec) and f'요율 예약 {tot}건' in sec and '+ 31일' in sec
       and '<script' not in h and 'https://' not in h and psql(TERMS_MD5) == before,
       f"{r.get('rateNotice')} · 부록 {len(sec)}자 · 물음 {sec.count('□ 맞음')} · 예약 {tot} · 설정 {days} · {r.get('_err')}")
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
