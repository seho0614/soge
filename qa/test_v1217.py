"""v10.217 (docs/349) — postcheck 상태 주소 기다림 · apply 스냅샷 물음 늘 · 약관 게시일 표시

  ① (코드) postcheck [2] 30초 기다림 · [10] 게시일 · apply [3] 올릴 것 없을 때 스냅샷 이름 물음 · 약관 서비스 publishedAt 두 곳 · 약관 화면 · 운영 화면 약관 표 · 사전 ko · en · docs/321 · 347 바로잡음 · 문서 349 · 판
  ② (스크립트) postcheck [2] 칸만 떼어 6초 뒤 열리는 가짜 상태 주소 → 「6초 기다림」+ 통과 · 안 열리면(HEALTH_WAIT=3) 실패 「(3초 기다림)」
  ③ (스크립트) apply [3] 칸만 떼어 올릴 것 0 — 이름 · skip · 대답 없음 · ASSUME_YES=1 네 갈래 모두 진행 · 셈 안 바뀜
  ④ (API · 화면) 게시 시각이 있는 첫 판(T1218) · 없는 판(T1219) → /terms/doc · /terms/index publishedAt · 사용자 웹 「2026-11-08 게시」 · 이용안내 표 「발행 2026-11-08 · 지금 적용 중(첫 판)」 · 운영 화면 약관 표 「게시 2026-11-08 18:05」
  끝나면 시험 약관 지움(두 번 돌려도 같음)
"""
import json, os, re, socket, subprocess, threading, time, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); SITE = os.environ.get('SITE'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'
C1, C2 = 'T1218', 'T1219'
PUB = '2026-11-08 09:05:00+00'   # 한국 시간 2026-11-08 18:05


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


AP, POST = rd('deploy/aws/apply.sh'), rd('deploy/aws/postcheck.sh')
AS, TV, TP = rd('src/modules/identity/auth.service.ts'), rd('site/src/components/terms/TermsViewer.tsx'), rd('web/src/app/admin/TermsPanel.tsx')
try:
    ko, en = json.loads(rd('site/src/i18n/messages/ko/policy.json')), json.loads(rd('site/src/i18n/messages/en/policy.json'))
except Exception:
    ko, en = {}, {}
ok('① 적용 스크립트 — postcheck [2] 3초마다 30초(HEALTH_WAIT) · 기다림 줄 · [10] 게시일 · apply [3] 올릴 것 없을 때 스냅샷 이름 물음(info · 진행) · 있을 때 yes 물음 그대로',
   'hw=0; while ! echo "$h" | grep -q \'"db":true\' && [ "$hw" -lt "${HEALTH_WAIT:-30}" ]; do sleep 3;' in POST and '초 기다림(API 가 뜨는 중이었음)' in POST
   and "coalesce(' · 게시 ' || to_char(published_at AT TIME ZONE 'Asia/Seoul', 'MM-DD'), '')" in POST
   and 'RDS 스냅샷 이름을 입력' in AP and 'info "RDS 스냅샷 — $sn (적어 둠)"' in AP and 'RDS 스냅샷을 방금 만들었습니까? 만들었으면 yes 를 입력' in AP
   and AP.index('RDS 스냅샷 이름을 입력') < AP.index('RDS 스냅샷을 방금 만들었습니까?')
   and all(subprocess.run(['bash', '-n', os.path.join(K, f)]).returncode == 0 for f in ('deploy/aws/apply.sh', 'deploy/aws/postcheck.sh')), '')
ok('① 약관 게시일 — 서비스 두 곳 publishedAt · 사용자 웹 판 줄 · 상태 글 · 운영 화면 약관 표 · 사전 ko · en',
   AS.count('published_at AS "publishedAt"') == 2 and "tr('viewer.published', { date:" in TV and "tr('state.firstEarlyPub', { when, pub:" in TV
   and 'data-term-published={t.publishedAt}' in TP and '게시 {pubKst(t.publishedAt)}' in TP
   and '{date} 게시' in ko.get('viewer', {}).get('published', '') and '{pub}' in ko.get('state', {}).get('firstEarlyPub', '')
   and 'published' in en.get('viewer', {}).get('published', '') and '{pub}' in en.get('state', {}).get('firstEarlyPub', ''), '')
D321, D347 = rd('docs/321_운영반영절차서_공통_v10.202_20261106.md'), rd('docs/347_적용전후비교_첫판적용중표시_AI알림제목_v10.216_20261108.md')
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('349_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① docs/321 [2] 기다림 · [3] 올릴 것 없음 물음 · docs/347 바로잡음 · 문서 349 · 판 v10.217 이상',
   '**[2] 상태 주소**(v10.217 부터)' in D321 and '[3] 올릴 것 없음(v10.217)' in D321 and '바로잡음(11/9 · docs/349)' in D347 and bool(DOC)
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 217), f'{DOC} · {rd("VERSION").strip()}')


def lib_sh(script, env_add=None, stdin=None, timeout=120):
    """lib.sh 를 읽고 스크립트 조각을 돌림(운영과 같은 ok · bad · info)."""
    env = dict(os.environ, **(env_add or {}))
    r = subprocess.run(['bash', '-c', f'. "{K}/deploy/aws/lib.sh"\n{script}\necho "셈 $PASS $FAIL $WARN"'],
                       input=stdin, capture_output=True, text=True, env=env, timeout=timeout)
    return r.stdout + r.stderr


# ② postcheck [2] 상태 주소 기다림(점검판 없이도 돎)
m = re.search(r'(h=\$\(curl -s --max-time 10 "\$API/api/v1/health"\)\n.*?bad "상태 주소"[^\n]*)\n', POST, re.S)
hblock = m.group(1) if m else 'echo 칸없음'


class H(BaseHTTPRequestHandler):
    def do_GET(self):
        b = b'{"status":"ok","db":true,"version":"v10.217"}'
        self.send_response(200); self.send_header('content-type', 'application/json'); self.send_header('content-length', str(len(b))); self.end_headers(); self.wfile.write(b)

    def log_message(self, *a):
        pass


s0 = socket.socket(); s0.bind(('127.0.0.1', 0)); port = s0.getsockname()[1]; s0.close()
srv = {}


def late():
    time.sleep(6)
    srv['s'] = HTTPServer(('127.0.0.1', port), H)
    srv['s'].serve_forever()


threading.Thread(target=late, daemon=True).start()
t0 = time.time()
out = lib_sh(hblock, {'API': f'http://127.0.0.1:{port}'})
took = time.time() - t0
w = re.search(r'상태 주소 — (\d+)초 기다림', out)
ok('② postcheck [2] — 6초 뒤 열리는 상태 주소 → 「n초 기다림(API 가 뜨는 중이었음)」(6 ~ 12초) + 통과 · 셈 통과 1 · 실패 0',
   w is not None and 6 <= int(w.group(1)) <= 12 and '통과  상태 주소' in out and '셈 1 0 0' in out, f'{out.strip()[-200:]} · {took:.0f}초')
if srv.get('s'):
    srv['s'].shutdown()
s1 = socket.socket(); s1.bind(('127.0.0.1', 0)); dead = s1.getsockname()[1]; s1.close()
out2 = lib_sh(hblock, {'API': f'http://127.0.0.1:{dead}', 'HEALTH_WAIT': '3'})
ok('② 끝내 응답 없음(HEALTH_WAIT=3) → 실패 「응답 없음 (3초 기다림)」 · 셈 실패 1', '실패  상태 주소 — 응답 없음 (3초 기다림)' in out2 and '셈 0 1 0' in out2, out2.strip()[-160:])

# ③ apply [3] 올릴 것 0 — 스냅샷 이름 물음(화면이 아닌 입력)
m = re.search(r'(if \[ "\$PEND" = "0" \]; then\n.*?)\nelse\n', AP, re.S)
ablock = (m.group(1) + '\nfi') if m else 'echo 칸없음'
base = {'PEND': '0', 'DONE': '226'}
a1 = lib_sh('PEND=0; DONE=226\n' + ablock, stdin='sgb-before-v10-217-20261109\n')
a2 = lib_sh('PEND=0; DONE=226\n' + ablock, stdin='skip\n')
a3 = lib_sh('PEND=0; DONE=226\n' + ablock, stdin='')
a4 = lib_sh('PEND=0; DONE=226\n' + ablock, {'ASSUME_YES': '1'}, stdin='')
ok('③ apply [3] 올릴 것 0 — 이름 → 「RDS 스냅샷 — 이름 (적어 둠)」 · skip · 대답 없음 → 「만들지 않음」 · ASSUME_YES=1 → 건너뜀 · 넷 다 멈추지 않고 셈 통과 1 그대로',
   'RDS 스냅샷 — sgb-before-v10-217-20261109 (적어 둠)' in a1 and 'RDS 스냅샷 — 만들지 않음(skip)' in a2 and 'RDS 스냅샷 — 만들지 않음(대답 없음)' in a3
   and 'ASSUME_YES=1 — 스냅샷 이름 물음을 건너뜁니다' in a4 and all('셈 1 0 0' in a and '올릴 것이 없습니다 (적용됨 226)' in a for a in (a1, a2, a3, a4)),
   ' | '.join(x.strip().split('\n')[-2][:60] for x in (a1, a2, a3, a4)))


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


def page(url):
    try:
        return urllib.request.urlopen(url, timeout=120).read().decode('utf-8', 'replace')
    except Exception as ex:
        return f'!{ex}'


if API and DB:
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import consent_ok
    psql(f"DELETE FROM terms WHERE code IN ('{C1}', '{C2}')")
    try:
        ins = "INSERT INTO terms(code, version, title, body, is_required, effective_from, status, published_at) VALUES ('{0}', '{1}', '{2}', E'## 제1조 시험\\n본문', false, now() + interval '6 days', 'PUBLISHED', {3})"
        r0 = psql(ins.format(C1, '9.9218', '시험 약관 1218', f"'{PUB}'")) + psql(ins.format(C2, '9.9219', '시험 약관 1219', 'NULL'))
        d1, d2 = call('GET', f'/terms/doc/{C1}'), call('GET', f'/terms/doc/{C2}')
        ix = call('GET', '/terms/index'); ix = ix if isinstance(ix, list) else []
        i1 = next((x for x in ix if x.get('code') == C1), {}); i2 = next((x for x in ix if x.get('code') == C2), {})
        ok('④ API — 게시 시각 있는 판 → doc · index publishedAt(2026-11-08T09:05) · firstEarly · 없는 판은 null',
           str(d1.get('publishedAt') or '').startswith('2026-11-08T09:05') and str(i1.get('publishedAt') or '').startswith('2026-11-08T09:05')
           and d1.get('firstEarly') is True and 'publishedAt' in d2 and d2.get('publishedAt') is None and i2.get('publishedAt') is None,
           f"{d1.get('publishedAt')} · {i1.get('publishedAt')} · {d2.get('publishedAt', '칸없음')} · {r0[:80]}")
        if SITE:
            h1, h2, g = page(SITE + f'/terms/{C1}'), page(SITE + f'/terms/{C2}'), page(SITE + '/guide')
            ok('④ 사용자 웹 — 약관 전문 「2026-11-08 게시 · 지금 적용 중(첫 판 · 본문 시행일」 · 게시 시각 없는 판은 「게시」 없음 · 이용안내 표 「발행 2026-11-08 · 지금 적용 중(첫 판)」',
               re.search(r'2026-11-08 게시(<!-- -->)?</span>(<!-- -->)? · 지금 적용 중\(첫 판 · 본문 시행일', h1) is not None or ('2026-11-08 게시' in h1 and '지금 적용 중(첫 판 · 본문 시행일' in h1)
               and 'data-term-published' not in h2 and '지금 적용 중(첫 판 · 본문 시행일' in h2
               and '발행 2026-11-08 · 지금 적용 중(첫 판)' in g,
               f"{'게시' if '2026-11-08 게시' in h1 else h1[:60]} · {'data-term-published' in h2} · {'발행 2026-11-08' in g}")
        if ADMIN_WEB:
            try:
                from playwright.sync_api import sync_playwright
            except Exception:
                sync_playwright = None
            seen, errs = {}, []
            if sync_playwright:
                consent_ok.agree('admin@x.com', PW)
                try:
                    with sync_playwright() as p:
                        b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 1000})
                        pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                        pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                        pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                        pg.wait_for_selector('[data-state-check]', timeout=30000)
                        pg.goto(ADMIN_WEB + '/#/terms', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                        r1 = pg.locator(f'[data-term-row="{C1}:9.9218"]'); r2 = pg.locator(f'[data-term-row="{C2}:9.9219"]')
                        seen['t1'] = r1.inner_text() if r1.count() else ''
                        seen['p1'] = r1.locator('[data-term-published]').count() if r1.count() else -1
                        seen['p2'] = r2.locator('[data-term-published]').count() if r2.count() else -1
                        b.close()
                except Exception as ex:
                    errs.append(str(ex)[:160])
            ok('④ 운영 화면 약관 표 — 게시 시각 있는 판 「게시 2026-11-08 18:05」(한국 시간) · 없는 판은 안 보임',
               seen.get('p1') == 1 and '게시 2026-11-08 18:05' in seen.get('t1', '') and seen.get('p2') == 0 and not errs, f"{seen} · {errs[:2]}")
    finally:
        psql(f"DELETE FROM terms WHERE code IN ('{C1}', '{C2}')")
    ok('되돌림 — 시험 약관 지움', psql(f"SELECT count(*) FROM terms WHERE code IN ('{C1}', '{C2}')") == '0', '')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
