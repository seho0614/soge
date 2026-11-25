"""v10.791 (docs/906) 사내 웹메일 W1-3 — 운영 화면 「공용 메일함」 · 격리 틀 · 개인정보 문의 알림
  KIT=<kit> API=… DB=… ADMIN_WEB=http://localhost:15173 python3 test_v1791.py
  ① (코드) 탭 회원 › 1:1 문의 뒤 · 제목 줄 SB-ADM-MAIL-010 · 격리 틀(sandbox 에 allow-scripts · allow-same-origin 없음) · CSP · 그림 막기 · MAIL_PRIVACY_NEW · 문서 906
  ② (화면) 메일함 단추 4 · 시험 메일 줄 → 열면 격리 틀 · 「확인 안 됨」 경고 · 틀 안 스크립트가 돌지 않음
  (시험 메일은 스스로 넣음 — 두 번 돌아도 통과)
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb' if os.path.isdir(KIT + '/sgb') else KIT
API = os.environ.get('API')
DB = os.environ.get('DB')
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



MB, MN, AP, MI = rd('web/src/app/admin/Mailbox.tsx'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('src/common/mail/mail-inbound.ts')
sb = re.search(r'sandbox="([^"]*)"', MB)
ok('① 탭 mailbox(회원 › 1:1 문의 뒤) · 제목 줄 SB-ADM-MAIL-010 · App 연결',
   "['mailbox', '공용 메일함']" in MN and "'inquiries', ['mailbox']" in MN and "screen: 'SB-ADM-MAIL-010'" in MN and "{tab === 'mailbox' && <Mailbox />}" in AP, '')
ok('① 격리 틀 — sandbox 에 allow-scripts · allow-same-origin 없음 · CSP default-src none · 그림은 허락 때만 https · script 지움',
   bool(sb) and 'allow-scripts' not in sb.group(1) and 'allow-same-origin' not in sb.group(1) and "default-src 'none'" in MB
   and 'allowImages ? "img-src https: data: cid:;" : "img-src data: cid:;"' in MB and '<script[\\s\\S]*?<\\/script' in MB, sb.group(1) if sb else '')
ok('① privacy@ 첫 메일 운영 알림 MAIL_PRIVACY_NEW(WARN · clock_timestamp · ON CONFLICT) · 문서 906 · 판', "'MAIL_PRIVACY_NEW', 'WARN'" in MI and 'clock_timestamp()' in MI
   and 'ON CONFLICT (alert_code, raised_at) DO NOTHING' in MI and '격리 틀' in doc('906_') and VT >= (10, 791), VER)

if API and DB and ADMIN_WEB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    sid = str(int(time.time() * 1000))[-9:]
    box = psql("SELECT id FROM mail_boxes WHERE address = 'help@sogaebank.com'")
    mid = psql(f"""INSERT INTO mail_messages (box_id, direction, ses_message_id, from_addr, subject, html_body, has_content, spf, dkim, dmarc)
                  VALUES ({box}, 'IN', 'ses-t1791-{sid}', 'x@example.com', '시험 1791 {sid}', '<p id="hi">본문 1791</p><script>document.title="pwned"</script>', true, 'FAIL', 'FAIL', 'FAIL') RETURNING id""").splitlines()[0]
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    seen = {}
    if sync_playwright:
        try:
            with sync_playwright() as p:
                b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 1000})
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                pg.goto(ADMIN_WEB + '/#/mailbox', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                seen['boxes'] = pg.locator('[data-mailbox-box]').count()
                seen['state'] = pg.locator('[data-mailbox-state]').get_attribute('data-mailbox-state') if pg.locator('[data-mailbox-state]').count() else None
                pg.fill('input[name=mailbox-q]', f'1791 {sid}'); pg.click('[data-mailbox-q-go]'); pg.wait_for_timeout(1500)
                pg.locator(f'[data-mailbox-open="{mid}"]').click(); pg.wait_for_timeout(1500)
                seen['unverified'] = pg.locator('[data-mailbox-unverified]').count()
                fr = pg.locator('[data-mailbox-frame]')
                seen['sandbox'] = fr.get_attribute('sandbox') if fr.count() else None
                f = pg.frame_locator('[data-mailbox-frame]')
                seen['body'] = f.locator('#hi').inner_text(timeout=5000) if fr.count() else None
                seen['title'] = pg.evaluate("document.querySelector('[data-mailbox-frame]').contentDocument ? 'reachable' : 'isolated'")
                b.close()
        except Exception as e:
            seen['err'] = str(e)[:200]
        ok('② 화면 — 메일함 단추 4 · 받기 상태 줄 · 시험 메일 열림 · 확인 안 됨 경고 · 격리 틀(같은 출처 아님 · 스크립트 없음) 안 본문',
           seen.get('boxes') == 4 and bool(seen.get('state')) and seen.get('unverified') == 1 and seen.get('sandbox') is not None and 'allow-scripts' not in (seen.get('sandbox') or '')
           and seen.get('body') == '본문 1791' and seen.get('title') == 'isolated', f'{seen}')
    else:
        print('  (playwright 없음 — ② 건너뜀)')
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
