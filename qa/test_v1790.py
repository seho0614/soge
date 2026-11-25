"""v10.790 (docs/905) 사내 웹메일 W1-2 — 공용 메일함 운영 API · 메일함별 권한 · 열람 기록 · 답장
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb python3 test_v1790.py
  ① (코드) API 6 · 메일함마다 업무 권한 · 열람 기록 · 답장 보내는 주소 = 공용 주소 · 바이러스 첨부 막음 · smtp 선택 칸 · 명세 · 문서 905
  ② (API) 목록(메일함 4 · 새 메일) · 한 통(본문 · 첨부 · 확인 안 됨 표시) · 열면 VIEW 기록 · 맡기기 · 끝냄 · 다시 열기 · 답장 준비 안 됨 422 · 첨부 Base64 · 바이러스 422
  (시험 메일은 스스로 넣고 시작 시각 뒤만 봄 — 두 번 돌아도 통과)
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

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


def login(e):
    return call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')



MA, MC, SM = rd('src/modules/support/mailbox-admin.ts'), rd('src/modules/support/mailbox.controller.ts'), rd('src/common/mail/smtp.ts')
SC = rd('spec/screens.json')
ok('① API 6 · 메일함마다 업무 권한(effective · VIEW) · 열람 기록 · 답장 from = 공용 주소 · In-Reply-To · 바이러스 첨부 막음',
   all(f"'{p}'" in MC for p in ('admin/mailbox/messages', 'admin/mailbox/messages/:id', 'admin/mailbox/messages/:id/assign', 'admin/mailbox/messages/:id/state', 'admin/mailbox/messages/:id/reply', 'admin/mailbox/attachments/:id'))
   and 'eff.has(`${b.task_key}:VIEW`)' in MA and "await log(db, id, 'VIEW')" in MA and 'from: m.address' in MA and "throw new PolicyViolation('MAIL_VIRUS'" in MA
   and "throw new PolicyViolation('MAIL_NOT_READY'" in MA and '"POST /admin/mailbox/messages/{id}/reply"' in SC, '')
ok('① smtp 선택 칸(from · fromName · inReplyTo · references) — 비우면 설정 그대로 · 줄바꿈 막음 · 머리 꼴 검사', 'const addr = m.from ?? cfg.from;' in SM and 'MSGID_RE.test(m.inReplyTo)' in SM
   and '/[\\r\\n]/.test(sender)' in SM and doc('905_') != '' and VT >= (10, 790), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    T = login('admin@x.com')
    sid = str(int(time.time() * 1000))[-9:]
    box = psql("SELECT id FROM mail_boxes WHERE address = 'privacy@sogaebank.com'")
    mid = psql(f"""INSERT INTO mail_messages (box_id, direction, ses_message_id, from_addr, from_name, to_addrs, subject, text_body, html_body, has_content, spf, dkim, dmarc, header_msgid, thread_key)
                  VALUES ({box}, 'IN', 'ses-t1790-{sid}', 'hong@example.com', '홍길동', ARRAY['privacy@sogaebank.com'], '시험 1790 열람 요청 {sid}', '안녕하세요', '<p>안녕</p>', true, 'FAIL', 'FAIL', 'FAIL', 'm{sid}@example.com', 'm{sid}@example.com') RETURNING id""").splitlines()[0]
    aid = psql(f"INSERT INTO mail_attachments (message_id, filename, content_type, size_bytes, data) VALUES ({mid}, 'a.txt', 'text/plain', 5, convert_to('hello', 'UTF8')) RETURNING id").splitlines()[0]
    vmid = psql(f"""INSERT INTO mail_messages (box_id, direction, ses_message_id, from_addr, subject, has_content, virus, state) VALUES ({box}, 'IN', 'ses-t1790v-{sid}', 'bad@example.com', '시험 1790 바이러스 {sid}', true, 'FAIL', 'SPAM') RETURNING id""").splitlines()[0]
    vaid = psql(f"INSERT INTO mail_attachments (message_id, filename, content_type, size_bytes, data) VALUES ({vmid}, 'v.exe', 'application/octet-stream', 1, '\\x00') RETURNING id").splitlines()[0]
    L = call('GET', '/admin/mailbox/messages?q=' + urllib.parse.quote(f'1790 열람 요청 {sid}') + '&state=NEW', None, T)
    rows = L.get('items') or []
    ok('② 목록 — 메일함 4(SUPER) · 넣은 메일 · 새 메일 · 첨부 1', len(L.get('boxes') or []) == 4 and len(rows) == 1 and rows[0].get('id') == mid and rows[0].get('attachments') == 1 and rows[0].get('state') == 'NEW', json.dumps(L, ensure_ascii=False)[:300])
    D = call('GET', f'/admin/mailbox/messages/{mid}', None, T)
    views = psql(f"SELECT count(*) FROM mail_access_log WHERE message_id = {mid} AND action = 'VIEW'")
    ok('② 한 통 — 본문 · HTML · 첨부 목록 · 보낸 사람 확인 안 됨 · 열면 VIEW 기록', D.get('textBody') == '안녕하세요' and D.get('htmlBody') == '<p>안녕</p>' and len(D.get('attachments') or []) == 1
       and D.get('senderUnverified') is True and D.get('virusBlocked') is False and views == '1', f"{D.get('_err')} · views {views}")
    me = psql("SELECT id FROM accounts WHERE email = 'admin@x.com'")
    a1 = call('POST', f'/admin/mailbox/messages/{mid}/assign', {'assignee': me}, T)
    s1 = call('POST', f'/admin/mailbox/messages/{mid}/state', {'state': 'DONE'}, T)
    st1 = psql(f"SELECT state || '|' || (done_at IS NOT NULL) FROM mail_messages WHERE id = {mid}")
    s2 = call('POST', f'/admin/mailbox/messages/{mid}/state', {'state': 'NEW'}, T)
    st2 = psql(f"SELECT state || '|' || (done_at IS NULL) FROM mail_messages WHERE id = {mid}")
    bad = call('POST', f'/admin/mailbox/messages/{mid}/state', {'state': 'SENT'}, T)
    ok('② 맡기기 → ASSIGNED · 끝냄 → DONE(done_at) · 다시 열기 → 맡은 사람 있어 ASSIGNED · 틀린 상태 400',
       a1.get('state') == 'ASSIGNED' and s1.get('state') == 'DONE' and st1 == 'DONE|true' and s2.get('state') == 'ASSIGNED' and st2 == 'ASSIGNED|true' and bad.get('_err') == 400, f'{a1} {s1} {st1} {s2} {st2} {bad}')
    r1 = call('POST', f'/admin/mailbox/messages/{mid}/reply', {'body': '답장 시험'}, T)
    r0 = call('POST', f'/admin/mailbox/messages/{mid}/reply', {'body': 'x'}, T)
    ok('② 답장 — 점검판은 메일 준비 안 됨 422 MAIL_NOT_READY · 너무 짧음 422 MAIL_REPLY_LENGTH', r1.get('code') == 'MAIL_NOT_READY' and r0.get('code') == 'MAIL_REPLY_LENGTH', f'{r1} {r0}')
    g1 = call('GET', f'/admin/mailbox/attachments/{aid}', None, T)
    g2 = call('GET', f'/admin/mailbox/attachments/{vaid}', None, T)
    logs = psql(f"SELECT string_agg(DISTINCT action, ',' ORDER BY action) FROM mail_access_log WHERE message_id = {mid}")
    ok('② 첨부 Base64 · DOWNLOAD 기록 · 바이러스 메일 첨부 422 MAIL_VIRUS · 기록 종류', g1.get('dataBase64') == 'aGVsbG8=' and g2.get('code') == 'MAIL_VIRUS'
       and set((logs or '').split(',')) >= {'VIEW', 'ASSIGN', 'DONE', 'REOPEN', 'DOWNLOAD'}, f'{g1.get("filename")} {g2} {logs}')
    del_try = psql(f"DELETE FROM mail_access_log WHERE message_id = {mid}")
    ok('② 열람 기록 지우기 — DB 가 막음', 'MAIL_LOG_APPEND_ONLY' in del_try, del_try[-80:])
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
