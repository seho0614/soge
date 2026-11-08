"""v10.216 (docs/347) — 적용 전후 비교 · 약관 「지금 적용 중(첫 판)」 표시 · AI 알림 제목

  ① (코드) lib.sh state_lines · precheck 적어 둠 · postcheck [11] · 약관 서비스 firstEarly · 약관 화면 · 사전 ko · en · AI 알림 제목 · docs/321 · 문서 347 · 판
  ② (스크립트 · DB) state_lines 13줄 → 적어 둔 뒤 시험 약관 게시 → postcheck [11] 칸만 떼어 돌림: 「바뀜 · 약관 게시 n → n+1」 · 기록 없음 · 24시간 넘음
  ③ (API) 첫 판 · 적힌 시행일 앞(T1216) → /terms/doc · /terms/index firstEarly=true · 앞 판이 있는 약관(T1217)은 false
  ④ (화면) 사용자 웹 약관 전문 T1216 「지금 적용 중(첫 판」
  ⑤ (API) 점검판 처리방침이 첫 판 하나면 시행일을 잠시 앞으로 → 정기 작업 AI 알림 제목 「게시(첫 판 · 적힌 시행일」 → 되돌림
  끝나면 시험 판 · 알림 지움 · 처리방침 시행일 되돌림(두 번 돌려도 같음)
"""
import json, os, re, subprocess, tempfile, time, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); SITE = os.environ.get('SITE')
RES = []
PW = 'sgb-dev-1234'
C1, C2 = 'T1216', 'T1217'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


LIB, PRE, POST = rd('deploy/aws/lib.sh'), rd('deploy/aws/precheck.sh'), rd('deploy/aws/postcheck.sh')
AS, TV, LW = rd('src/modules/identity/auth.service.ts'), rd('site/src/components/terms/TermsViewer.tsx'), rd('src/modules/admin/launch-watch.service.ts')
KO, EN = rd('site/src/i18n/messages/ko/policy.json'), rd('site/src/i18n/messages/en/policy.json')
ok('① 적용 스크립트 — state_lines 13개 · precheck 가 precheck_state.txt 에 적음 · postcheck [11] 적용 전과 비교(보여 주기만 · 24시간)',
   'state_lines() {' in LIB and LIB.count("(select ") >= 13 and "(13, '마이그레이션 적용'" in LIB
   and '> "$DATA_DIR/logs/precheck_state.txt"' in PRE and PRE.index('sl=$(state_lines)') < PRE.index('bad "DB 접속 실패"')
   and 'say ""; say "[11] 적용 전과 비교' in POST and 'if [ "$sage" -gt 24 ]' in POST and 'info "  바뀜 · $k $a → $b"' in POST
   and POST.index('[11] 적용 전과 비교') < POST.index('적용 후 확인 — 통과 $PASS'), '')
try:
    ko, en = json.loads(KO), json.loads(EN)
except Exception:
    ko, en = {}, {}
ok('① 약관 firstEarly — 서비스 두 곳(v_terms_current 같은 판) · 화면 상태 · 전문 판 줄 · 사전 ko · en',
   AS.count('AS "firstEarly"') == 2 and AS.count('EXISTS (SELECT 1 FROM v_terms_current c WHERE c.code = terms.code AND c.version = terms.version)') == 2
   and "if (t.firstEarly) return tr('state.firstEarly', { when });" in TV and "tr(doc.firstEarly ? 'viewer.firstEarly'" in TV
   and '지금 적용 중(첫 판)' in ko.get('state', {}).get('firstEarly', '') and '{when}' in ko.get('state', {}).get('firstEarly', '')
   and '{date}' in ko.get('viewer', {}).get('firstEarly', '') and 'first version' in en.get('state', {}).get('firstEarly', '')
   and '{date}' in en.get('viewer', {}).get('firstEarly', ''), '')
D321 = rd('docs/321_운영반영절차서_공통_v10.202_20261106.md')
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('347_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① AI 알림 제목 「게시(첫 판 · 적힌 시행일」 / 「시행」 · docs/321 [11] 읽는 법 · 문서 347 · 판 v10.216 이상',
   "const how = pv?.early ? `게시(첫 판 · 적힌 시행일 ${pv.day})` : '시행';" in LW and '처리방침 ${r.privacy_ver} ${how}(국외 이전 조항)' in LW
   and '**[11] 적용 전과 비교**' in D321 and bool(DOC)
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 216), f'{DOC} · {rd("VERSION").strip()}')


def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m)
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


def sh(script, data_dir):
    """lib.sh 를 읽고 스크립트 조각을 돌림(운영과 같은 함수 · 점검판 DB)."""
    env = dict(os.environ, DATABASE_URL=DB, DATA_DIR=data_dir)
    r = subprocess.run(['bash', '-c', f'. "{K}/deploy/aws/lib.sh"\n{script}'], capture_output=True, text=True, env=env, timeout=120)
    return r.stdout + r.stderr


if API and DB:
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import consent_ok
    m = re.search(r'(# v10\.216 \(docs/347\) — 적용 전과 비교.*?)\nsay ""\nsay "적용 후 확인', POST, re.S)
    block = m.group(1) if m else 'echo 칸없음'
    psql(f"DELETE FROM terms WHERE code IN ('{C1}', '{C2}')")
    priv = None
    try:
        # ② 적용 전후 비교
        tmp = tempfile.mkdtemp(); os.makedirs(tmp + '/logs')
        sl = sh('state_lines', tmp).strip().split('\n')
        ok('② state_lines — 점검판 DB 에서 13줄 · 이름=값 · 약관 게시 · 오픈 차단 · 간주 모드',
           len(sl) == 13 and all('=' in x for x in sl) and sl[0].startswith('약관 게시=') and any(x.startswith('오픈 차단=') for x in sl)
           and any(x.startswith('간주 모드=') for x in sl), f'{sl[:3]} … {len(sl)}')
        none = sh(block, tmp)
        n0 = psql("SELECT count(*) FROM terms WHERE status = 'PUBLISHED'")
        sh('{ echo "# $(date +%s) $(date \'+%Y-%m-%d %H:%M\') v10.216"; state_lines; } > "$DATA_DIR/logs/precheck_state.txt"', tmp)
        ins = "INSERT INTO terms(code, version, title, body, is_required, effective_from, status) VALUES ('{0}', '{1}', '{2}', E'## 제1조 시험\\n본문', false, {3}, 'PUBLISHED')"
        r0 = (psql(ins.format(C1, '9.9216', '시험 약관 1216', "now() + interval '6 days'"))
              + psql(ins.format(C2, '9.9216', '시험 약관 1217', "now() - interval '1 second'")) + psql(ins.format(C2, '9.9217', '시험 약관 1217', "now() + interval '5 days'")))
        out = sh(block, tmp)
        try:
            n0i = int(n0)
        except ValueError:
            n0i = -9
        same = re.search(r'같음 (\d+)개 · 바뀜 (\d+)개', out)
        ok('② postcheck [11] — 적어 둔 뒤 약관 3판 게시 → 「바뀜 · 약관 게시 n → n+3」 · 첫 판 시행일 전 · 새 판 시행 예정 · 나머지 같음 · 기록 없을 때 안내',
           f'바뀜 · 약관 게시 {n0i} → {n0i + 3}' in out and '바뀜 · 약관 첫 판 시행일 전 ' in out and '바뀜 · 약관 새 판 시행 예정 ' in out
           and same is not None and int(same.group(1)) >= 8 and int(same.group(1)) + int(same.group(2)) == 13
           and '적용 전 기록 없음' in none, f'{out.strip()[:300]} · {none.strip()[:60]} · {r0[:60]}')
        sh('sed -i "1s/^# [0-9]*/# $(( $(date +%s) - 25*3600 ))/" "$DATA_DIR/logs/precheck_state.txt"', tmp)
        old = sh(block, tmp)
        ok('② 24시간 넘은 기록 → 「비교하지 않음」 · 바뀜 줄 없음', '비교하지 않음' in old and '바뀜 · ' not in old, old.strip()[:120])

        # ③ API firstEarly
        d1, d2 = call('GET', f'/terms/doc/{C1}'), call('GET', f'/terms/doc/{C2}')
        ix = call('GET', '/terms/index')
        ix = ix if isinstance(ix, list) else []
        i1 = next((x for x in ix if x.get('code') == C1), {}); i2 = next((x for x in ix if x.get('code') == C2), {})
        ok('③ 첫 판 · 적힌 시행일 앞 → doc · index firstEarly=true(scheduled 도 true) · 앞 판이 있는 약관은 지금 판 9.9216 · firstEarly=false',
           d1.get('firstEarly') is True and d1.get('scheduled') is True and i1.get('firstEarly') is True
           and d2.get('version') == '9.9216' and d2.get('firstEarly') is False and i2.get('firstEarly') is False,
           f"{d1.get('firstEarly')} · {i1.get('firstEarly')} · {d2.get('version')} {d2.get('firstEarly')} · {i2.get('firstEarly')}")

        # ④ 사용자 웹 약관 전문
        if SITE:
            try:
                html = urllib.request.urlopen(SITE + f'/terms/{C1}', timeout=120).read().decode('utf-8', 'replace')
            except Exception as ex:
                html = f'!{ex}'
            ok('④ 사용자 웹 약관 전문 T1216 — 「지금 적용 중(첫 판 · 본문 시행일」 · 「시행 예정」 아님', '지금 적용 중(첫 판 · 본문 시행일' in html, html[:80] if html.startswith('!') else '')

        # ⑤ AI 알림 제목 — 점검판 처리방침이 게시 판 하나 · 잠금 풀림일 때만
        consent_ok.agree('admin@x.com', PW)
        TS = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
        one = psql("SELECT count(*) FROM terms WHERE code = 'PRIVACY' AND status = 'PUBLISHED'") == '1' and psql('SELECT fn_privacy_ai_ready()') == 't'
        if one:
            priv = psql("SELECT version || '|' || effective_from FROM terms WHERE code = 'PRIVACY' AND status = 'PUBLISHED'")
            pv, pe = priv.split('|', 1)
            psql(f"SET sgb.terms_fix = 'on'; UPDATE terms SET effective_from = now() + interval '10 days' WHERE code = 'PRIVACY' AND version = '{pv}'")
            psql("DELETE FROM ops_alerts WHERE alert_code = 'AGENT_LIVE'")
            call('POST', '/admin/jobs', {'job': 'launch_watch'}, TS)
            ttl = psql("SELECT coalesce(max(title), '') || '|' || coalesce(max(detail->>'firstEarly'), '') FROM ops_alerts WHERE alert_code = 'AGENT_LIVE'")
            ok('⑤ 처리방침 첫 판 · 적힌 시행일 앞 → 「AI 사용 가능해짐 — 처리방침 n 게시(첫 판 · 적힌 시행일 MM-DD)(국외 이전 조항)」 · detail.firstEarly',
               f'처리방침 {pv} 게시(첫 판 · 적힌 시행일 ' in ttl and ttl.endswith('|true'), ttl[:160])
        else:
            print('  (점검판 처리방침이 게시 판 하나 · 잠금 풀림이 아님 — ⑤ 건너뜀 · ①이 코드로 확인)')
    finally:
        if priv and '|' in priv:
            pv, pe = priv.split('|', 1)
            psql(f"SET sgb.terms_fix = 'on'; UPDATE terms SET effective_from = '{pe}' WHERE code = 'PRIVACY' AND version = '{pv}'")
            psql("DELETE FROM ops_alerts WHERE alert_code = 'AGENT_LIVE' AND detail->>'firstEarly' = 'true'")
        psql(f"DELETE FROM terms WHERE code IN ('{C1}', '{C2}')")
    back = psql(f"SELECT count(*) FROM terms WHERE code IN ('{C1}', '{C2}')") == '0'
    if priv and '|' in priv:
        back = back and psql(f"SELECT effective_from FROM terms WHERE code = 'PRIVACY' AND version = '{priv.split('|', 1)[0]}'") == priv.split('|', 1)[1]
    ok('되돌림 — 시험 약관 지움 · 처리방침 시행일 원래대로', back, '')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
