"""v10.34 (2026-10-11 대표 결정 · D093) — 국세청 전자세금계산서 전송: 연결 자리(어댑터) + 간주 모드

  S. 설정 · 연동 표   integrations ETAX(NOT_STARTED · 오픈 차단 · 키 이름 ETAX_KEY) · assume.etax(기본 on) · 오픈 체크리스트 · 상태 API(키 값 없음)
  A. 간주 발행       assume.etax on → 「간주 발행」(ISSUED · ASSUMED · 승인번호 없음 · 「간주-문서번호」) · 업체 화면엔 내부 번호 없음
  M. 손으로 번호     연동 전 임시 방식(MANUAL) — 전송 · 다시 보내기 막힘(중복 발행)
  C. 간주 끄기       ETAX_URL 없는 서버(3000) → 422 ETAX_NOT_CONFIGURED · 줄 그대로
  H. http 어댑터     시험이 스스로 띄운 가짜 업체 서버(빈 포트 · 3141~) + 그 주소를 ETAX_URL 로 둔 API(빈 포트 · 3142~)
                     성공(승인번호 24자리) · 거절 · 5xx · 키 틀림 · 형식 틀린 승인번호 · 다시 보내기 · 시간 초과 뒤 다시 보내기(중복 발행 없음) ·
                     승인 대기 → 상태 조회 · 동시에 두 번 · 취소(수정 발행) · 간주 줄을 연동 뒤 실제 전송
  P. 권한           운영(ADMIN · SUPER)만 — 업체 · 검수 · 지급 담당 · 비로그인 403
  G. 감사 · DB       감사 기록(ETAX_SEND · RESEND · REFRESH · CANCEL · 키 없음) · 전송 기록 append-only · 승인번호 · 문서 번호 고정 · 간주에 승인번호 금지

  시험 자료: 매 실행마다 새 업체 1곳(시험용 · 법률 정액 노출 1회차 + 연장 1회차) + 그 업체의 리드 이용료 발행 요청 줄(시험용 · 2025년 달들).
            끝에 노출을 종료하고 assume.etax 를 on 으로 되돌립니다. 세금계산서 줄 · 전송 기록 · 감사 기록은 지울 수 없어 남습니다.
사용: python3 qa/test_v1034_etax.py      (API=http://localhost:3000 · DB=postgresql://sgb:sgb@localhost:5432/sgb · SGB=…/sgb)
"""
import json, urllib.request, subprocess, uuid, sys, os, datetime, socket, threading, time, re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from concurrent.futures import ThreadPoolExecutor

API = (os.environ.get('API') or 'http://localhost:3000').rstrip('/').removesuffix('/api/v1')
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:5432/sgb'
SGB = os.environ.get('SGB') or next((d for d in (os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sgb'), '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb') if os.path.isdir(d)), '')  # v10.34 — 작업 사본(/home/claude/qa)에서 돌려도 킷을 찾게
R = []

def psql(s):
    return subprocess.run(['psql', '-X', DB, '-tAc', s], capture_output=True, text=True)
q = lambda s: psql(s).stdout.strip().split('\n')[0]

def call(m, p, tok=None, body=None, base=None):
    h = {'content-type': 'application/json', 'Idempotency-Key': uuid.uuid4().hex}
    if tok: h['authorization'] = 'Bearer ' + tok
    req = urllib.request.Request((base or API) + '/api/v1' + p, method=m,
        data=json.dumps(body).encode() if body is not None else (b'{}' if m in ('POST', 'PATCH') else None), headers=h)
    try: r = urllib.request.urlopen(req, timeout=30); st = r.status; raw = r.read()
    except urllib.error.HTTPError as e: st = e.code; raw = e.read()
    try: js = json.loads(raw) if raw else None
    except Exception: js = None
    return st, js

def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:240]})
    print('ok  ' if ok else 'FAIL', step, str(detail)[:150], file=sys.stderr)

def login(e, pw='sgb-dev-1234'):
    return call('POST', '/auth/login', body={'email': e, 'password': pw})[1]['accessToken']

def free_port(prefer):
    for p in [prefer] + list(range(prefer + 10, prefer + 60)):
        s = socket.socket()
        try: s.bind(('127.0.0.1', p)); s.close(); return p
        except OSError: s.close()
    raise SystemExit('빈 포트 없음')

ADM = login('admin@x.com'); OPS = login('ops@t.local', 'sgb-test-1234')
REV = login('reviewer@t.local', 'sgb-test-1234'); PAY = login('payout@t.local', 'sgb-test-1234')
tag = uuid.uuid4().hex[:6]
FEE_KEY = 'directory.monthly_fee'

# ── 시험 업체(법률 정액 노출을 켤 수 있는) — test_v1033_directory 와 같은 순서 ──────────────
def member(prefix):
    e = f'{prefix}_{tag}@t.local'
    call('POST', '/auth/signup', body={'email': e, 'password': 'sgb-test-1234', 'name': f'{prefix}시험', 'agreedTerms': []})
    return e, login(e, 'sgb-test-1234')

def partner(prefix, company):
    e, T = member(prefix)
    call('POST', '/verifications/identity', T, {'provider': 'PASS'})
    st, j = call('POST', '/businesses', T, {'bizRegNo': str(uuid.uuid4().int)[-10:], 'companyName': f'{company}{tag}', 'ceoName': '김시험', 'sido': '서울', 'sigungu': '금천구'})
    bid = (j or {}).get('businessId')
    call('PATCH', f'/admin/businesses/{bid}/verify', ADM, {})
    T = login(e, 'sgb-test-1234')
    st, pj = call('POST', '/partner/apply', T)
    call('POST', f"/admin/partners/{pj['id']}/approve", ADM)
    call('POST', '/partner/axes', T, {'axes': ['CONSULT']})
    ax = q(f"select id from mal_partner_axes where business_id='{bid}' and axis='CONSULT'")
    call('POST', f'/admin/partner-axes/{ax}/decide', OPS, {'approve': True})
    qid = q(f"insert into qualification_reviews(business_id, category_code, doc_no) values ('{bid}','LEGAL','LAW34-{prefix}-{tag}') returning id")
    call('POST', f'/admin/qualifications/{qid}/lookup', OPS); call('POST', f'/admin/qualifications/{qid}/decide', OPS, {'approve': True})
    return {'tok': T, 'bid': bid, 'pid': pj['id'], 'company': f'{company}{tag}', 'bizno': q(f"select biz_reg_no from businesses where id='{bid}'")}

def setting(key, value):
    return call('PATCH', '/admin/site-settings', OPS, {'key': key, 'value': value})

today = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=9)).date()

# ── 가짜 업체(ASP) 서버 — 시험이 스스로 띄우고 끕니다 ───────────────────────
FAKE = {'mode': 'ok', 'key': 'etax-test-key', 'docs': {}, 'issue_calls': {}, 'last_body': None, 'last_auth': None, 'seq': 0, 'gets': 0}
LOCK = threading.Lock()
def approval():
    with LOCK:
        FAKE['seq'] += 1
        return f"{today.strftime('%Y%m%d')}{FAKE['seq'] + int(tag, 16) % 10**9:016d}"  # 가짜 서버 안에서만 쓰는 시험 번호(24자리)

class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def out(self, code, obj):
        raw = json.dumps(obj).encode()
        self.send_response(code); self.send_header('content-type', 'application/json'); self.send_header('content-length', str(len(raw))); self.end_headers()
        try: self.wfile.write(raw)
        except Exception: pass
    def auth(self):
        FAKE['last_auth'] = self.headers.get('Authorization')
        if self.headers.get('Authorization') != 'Bearer ' + FAKE['key']:
            self.out(401, {'code': 'AUTH', 'message': '인증 키가 맞지 않습니다(시험)'}); return False
        return True
    def do_GET(self):
        if not self.auth(): return
        m = re.match(r'^/invoices/([^/]+)$', self.path)
        FAKE['gets'] += 1
        d = FAKE['docs'].get(m.group(1)) if m else None
        self.out(200, d) if d else self.out(404, {'code': 'NOT_FOUND', 'message': '문서 없음'})
    def do_POST(self):
        n = int(self.headers.get('content-length') or 0); body = json.loads(self.rfile.read(n) or b'{}')
        if not self.auth(): return
        m = re.match(r'^/invoices/([^/]+)/cancel$', self.path)
        if m:
            d = FAKE['docs'].get(m.group(1))
            if not d or d.get('result') != 'SENT': return self.out(409, {'code': 'NOT_SENT', 'message': '보낸 문서가 아님'})
            d['result'] = 'CANCELED'; d['amendApprovalNo'] = approval(); d['cancelReason'] = body.get('reason')
            return self.out(200, d)
        if self.path != '/invoices': return self.out(404, {})
        k = body.get('docKey'); FAKE['last_body'] = body
        with LOCK: FAKE['issue_calls'][k] = FAKE['issue_calls'].get(k, 0) + 1
        if k in FAKE['docs']: return self.out(409, {'code': 'DUPLICATE', 'message': '이미 있는 문서 번호'})
        mode = FAKE['mode']
        if mode == 'reject': return self.out(400, {'code': 'E_BUYER', 'message': '공급받는 자 사업자번호를 확인하십시오(시험)'})
        if mode == 'down': return self.out(503, {'code': 'MAINT', 'message': '점검 중(시험)'})
        if mode == 'badno': return self.out(200, {'result': 'SENT', 'approvalNo': '12345'})
        if mode == 'pending':
            FAKE['docs'][k] = {'result': 'PENDING'}; return self.out(200, {'result': 'PENDING'})
        FAKE['docs'][k] = {'result': 'SENT', 'approvalNo': approval()}
        if mode == 'slow': time.sleep(3.0)            # 업체는 발행했는데 응답이 늦음(API 제한 1.5초)
        if mode == 'slowish': time.sleep(0.6)
        return self.out(200, FAKE['docs'][k])

FPORT = free_port(3141)
fake = ThreadingHTTPServer(('127.0.0.1', FPORT), Fake)
threading.Thread(target=fake.serve_forever, daemon=True).start()
APORT = free_port(3142)
env = dict(os.environ, DATABASE_URL=DB, JWT_SECRET='docker-test-secret-0123456789abcdef', JOB_TOKEN='docker-test-job-token-0123456789abcdef',
           ENC_KEY='docker-dev-enc-key-0123456789abcdef', NODE_ENV='development', PORT=str(APORT),
           ETAX_URL=f'http://127.0.0.1:{FPORT}', ETAX_KEY=FAKE['key'], ETAX_TIMEOUT_MS='1500')
api2 = subprocess.Popen(['node', 'dist/main.js'], cwd=SGB, env=env, stdout=open(f'/tmp/etax_api_{APORT}.log', 'w'), stderr=subprocess.STDOUT)
B2 = f'http://127.0.0.1:{APORT}'
for _ in range(90):
    try: urllib.request.urlopen(B2 + '/api/v1/health', timeout=2); break
    except Exception: time.sleep(1)

INV = lambda kind, iid, act: f'/admin/etax/{kind}/{iid}/{act}'
def dcol(iid, c='etax_status'): return q(f"select coalesce({c}::text,'') from consult_directory_invoices where id='{iid}'")
def lcol(iid, c='etax_status'): return q(f"select coalesce({c}::text,'') from lead_cash_invoices where id='{iid}'")
def logs(iid): return psql(f"select action||'|'||adapter||'|'||result||'|'||coalesce(error_kind,'') from etax_send_log where invoice_id='{iid}' order by id").stdout.split()
def audit_n(action, target): return int(q(f"select count(*) from audit.audit_logs where action='{action}' and target_id='{target}'") or 0)

fee0 = q(f"select value from site_settings where key='{FEE_KEY}'")
if fee0 != '300000': setting(FEE_KEY, '300000')
P = partner('e34', '전자세금시험법무')
st, mine = call('POST', '/partner/directory', P['tok'], {'categoryCode': 'CSL_LEGAL', 'displayName': f'시험34 전자세금 법률{tag}',
                                                         'intro': 'v10.34 시험용 — 실제 사무소가 아닙니다', 'contactPhone': '02-0000-3434', 'sido': '서울'})
EID = next(x for x in mine if x['categoryCode'] == 'CSL_LEGAL')['id']
call('POST', f'/admin/directory/{EID}/activate', OPS, {'paidFrom': str(today), 'months': 1, 'paymentRef': f'v10.34 시험 {tag}'})
call('POST', f'/partner/directory/{EID}/renew', P['tok'], {'months': 1})
call('POST', f'/admin/directory/{EID}/renew/confirm', OPS, {'paymentRef': f'v10.34 연장 시험 {tag}'})
D1, D2 = psql(f"select i.id from consult_directory_invoices i join consult_directory_periods p on p.id=i.period_id where i.entry_id='{EID}' order by p.seq").stdout.split()
# 리드 이용료 발행 요청 — 시험용 줄(달마다 한 줄 · 110,000 = 100,000 + 10,000)
L = {}
for i, name in enumerate(['A', 'NOCFG', 'OK', 'REJ', 'TMO', 'DOWN', 'BAD', 'PEND', 'RACE', 'AUTH'], start=1):
    L[name] = q(f"insert into lead_cash_invoices(partner_id, ym, total, supply, vat) values ('{P['pid']}', '2025-{i:02d}', 110000, 100000, 10000) returning id")

try:
    # ── S. 설정 · 연동 표 ────────────────────────────────────────────
    print('== S. 설정 · 연동 표 ==', file=sys.stderr)
    rec('S-1 integrations ETAX — 전자세금계산서 · NOT_STARTED · 오픈 차단 · 키 이름 ETAX_KEY · 업체 미정',
        q("select name||'|'||status||'|'||blocks_open||'|'||secret_key_name||'|'||coalesce(provider,'-')||'|'||secret_registered from integrations where code='ETAX'") == '전자세금계산서|NOT_STARTED|true|ETAX_KEY|-|false')
    rec('S-2 설정 assume.etax 기본 on · on/off 형식 · 공개 범위 GLOBAL', q("select value||'|'||value_pattern||'|'||scope from site_settings where key='assume.etax'") == 'on|^(on|off)$|GLOBAL')
    ob = psql("select kind||'|'||item from v_open_blockers where item in ('assume.etax','전자세금계산서')").stdout.split()
    rec('S-3 오픈 체크리스트 — 「간주 모드 켜짐」 assume.etax · 외부 연동 「전자세금계산서」(연동 뒤 off 필수 목록)', sorted(ob) == ['ASSUME|assume.etax', 'INTEGRATION|전자세금계산서'], ob)
    st, it = call('GET', '/admin/integrations', ADM)
    e = next((x for x in it or [] if x['code'] == 'ETAX'), {})
    rec('S-4 운영 「외부 연동」 표에 ETAX 줄(키 값 없이 이름 · 등록 여부만)', st == 200 and e.get('secretKeyName') == 'ETAX_KEY' and e.get('blocksOpen') is True and 'ETAX_KEY' in json.dumps(e), e)
    st, s = call('GET', '/admin/etax/status', OPS)
    rec('S-5 상태 API(3000 · 키 없음) — 간주 · 어댑터 assume · 키 미등록', st == 200 and s['assume'] is True and s['adapter'] == 'assume' and s['keySet'] is False and s['keyName'] == 'ETAX_KEY', s)
    st, s2 = call('GET', '/admin/etax/status', OPS, base=B2)
    rec('S-6 상태 API(키 있는 서버) — 키 등록됨이지만 값은 응답에 없음(가림) · 업체 주소는 호스트만',
        st == 200 and s2['keySet'] is True and FAKE['key'] not in json.dumps(s2, ensure_ascii=False) and s2['urlHost'] == f'127.0.0.1:{FPORT}', s2)

    # ── A. 간주 발행 ─────────────────────────────────────────────────
    print('== A. 간주 발행 ==', file=sys.stderr)
    st, j = call('POST', INV('directory', D1, 'send'), OPS)
    rec('A-1 간주 모드에서 「발행」 → 200 · 발행됨(ISSUED) · 전송 상태 ASSUMED · 승인번호 없음 · 발행 번호 칸 「간주-SGB-D-…」',
        st == 200 and j['state'] == 'ISSUED' and j['etaxStatus'] == 'ASSUMED' and j['assumed'] is True and j['approvalNo'] is None
        and j['invoiceNo'] == '간주-' + j['docKey'] and re.match(r'^SGB-D-\d{6}-[0-9a-f]{10}$', j['docKey'] or '') and j['adapter'] == 'assume', (st, j))
    rec('A-2 DB — 승인번호 칸 비어 있음(지어내지 않음) · 발행 방식 ASSUMED · 전송 기록 1줄(assume · ASSUMED)',
        dcol(D1, 'etax_approval_no') == '' and dcol(D1, 'etax_mode') == 'ASSUMED' and logs(D1) == ['ISSUE|assume|ASSUMED|'], logs(D1))
    st, j = call('POST', INV('directory', D1, 'send'), OPS)
    st2, j2 = call('POST', INV('directory', D1, 'resend'), OPS)
    rec('A-3 간주 줄 다시 「발행」 → 409 ETAX_ALREADY_ASSUMED · 간주 모드 중 「다시 보내기」 → 409 ETAX_STILL_ASSUMED',
        st == 409 and j['code'] == 'ETAX_ALREADY_ASSUMED' and st2 == 409 and j2['code'] == 'ETAX_STILL_ASSUMED', (st, j, st2, j2))
    st, mi = call('GET', '/partner/directory/invoices', P['tok'])
    me = next((x for x in mi or [] if x['id'] == D1), {})
    st2, sl = call('GET', '/partner/settlement', P['tok'])
    srow = [x for x in (sl or {}).get('invoices', []) if x['kind'] == 'DIRECTORY' and x.get('etaxStatus') == 'ASSUMED']
    rec('A-4 업체 화면 — 「간주」 사실 그대로(etaxStatus ASSUMED) · 내부 번호(간주-…)는 번호 칸에 싣지 않음 · 문서 번호 · 실패 사유 칸 없음',
        st == 200 and me.get('etaxStatus') == 'ASSUMED' and me.get('invoiceNo') is None and me.get('approvalNo') is None and 'docKey' not in me and 'etaxError' not in me
        and len(srow) == 1 and srow[0]['invoiceNo'] is None, (me, srow))
    st, j = call('POST', f'/admin/directory/invoices/{D1}/issue', OPS, {'invoiceNo': f'T34-{tag}-x', 'issuedOn': str(today)})
    rec('A-5 간주 발행된 줄에 손으로 번호 → 409(발행 요청 상태 아님)', st == 409, (st, j))
    st, j = call('POST', INV('lead-cash', L['A'], 'send'), OPS)
    rec('A-6 리드 이용료 줄도 같은 규칙 — 간주 발행 · 「간주-SGB-L-…」 · 승인번호 없음', st == 200 and j['kind'] == 'LEAD_CASH' and j['etaxStatus'] == 'ASSUMED'
        and j['invoiceNo'].startswith('간주-SGB-L-') and j['approvalNo'] is None and lcol(L['A'], 'state') == 'ISSUED', (st, j))

    # ── M. 손으로 번호(연동 전 임시) ──────────────────────────────────
    print('== M. 손으로 번호 ==', file=sys.stderr)
    st, j = call('POST', f'/admin/directory/invoices/{D2}/issue', OPS, {'invoiceNo': f'T34-{tag}-2', 'issuedOn': str(today)})
    rec('M-1 손으로 번호 넣기 → 발행됨 · 발행 방식 MANUAL(간주 · 전송과 구분) · 전송 상태 없음', st < 300 and j['state'] == 'ISSUED' and j['etaxMode'] == 'MANUAL' and dcol(D2) == '', (st, j))
    st, j = call('POST', INV('directory', D2, 'send'), OPS)
    st2, j2 = call('POST', INV('directory', D2, 'resend'), OPS)
    rec('M-2 손으로 넣은 줄 「발행」 · 「다시 보내기」 → 409 ETAX_MANUAL(중복 발행 막음)', st == 409 and j['code'] == 'ETAX_MANUAL' and st2 == 409 and j2['code'] == 'ETAX_MANUAL', (st, j, st2))
    o1 = psql(f"BEGIN; update consult_directory_invoices set etax_mode='ASP' where id='{D2}'; ROLLBACK;")
    o2 = psql(f"BEGIN; update lead_cash_invoices set etax_mode='MANUAL', etax_status='SENDING', etax_doc_key='x' where id='{L['NOCFG']}'; ROLLBACK;")
    rec('M-3 DB — 손으로 넣은 줄을 전송 줄로 바꾸기 거부(ETAX_MANUAL) · MANUAL 인데 전송 상태 → 제약 거부', 'ETAX_MANUAL' in o1.stderr and '_etax' in o2.stderr, (o1.stderr.strip()[:80], o2.stderr.strip()[:80]))

    # ── C. 간주를 끄고 업체 연동이 없을 때 ────────────────────────────
    print('== C. 간주 끄기 · 연동 없음 ==', file=sys.stderr)
    st, _ = setting('assume.etax', 'off')
    st1, s = call('GET', '/admin/etax/status', OPS)
    st2, j = call('POST', INV('lead-cash', L['NOCFG'], 'send'), OPS)
    rec('C-1 assume.etax off · ETAX_URL 없는 서버 → 상태 어댑터 없음 · 「발행」 422 ETAX_NOT_CONFIGURED · 줄 그대로(조용히 간주로 돌지 않음)',
        st < 300 and s['assume'] is False and s['adapter'] is None and st2 == 422 and j['code'] == 'ETAX_NOT_CONFIGURED'
        and lcol(L['NOCFG']) == '' and lcol(L['NOCFG'], 'state') == 'REQUESTED', (st1, s.get('adapter'), st2, j))

    # ── H. http 어댑터 + 가짜 서버 ────────────────────────────────────
    print('== H. http 어댑터 ==', file=sys.stderr)
    FAKE['mode'] = 'ok'
    st, j = call('POST', INV('lead-cash', L['OK'], 'send'), OPS, base=B2)
    b = FAKE['last_body'] or {}
    appr = (FAKE['docs'].get(j.get('docKey')) or {}).get('approvalNo', '') if st == 200 else ''
    rec('H-1 성공 → SENT · 승인번호 24자리(화면 8-8-8) · 발행됨 · 발행 번호 = 승인번호', st == 200 and j['etaxStatus'] == 'SENT' and j['state'] == 'ISSUED'
        and j['approvalNo'] == f'{appr[:8]}-{appr[8:16]}-{appr[16:]}' and j['invoiceNo'] == j['approvalNo'] and lcol(L['OK'], 'etax_approval_no') == appr and len(appr) == 24, (st, j))
    sname = q("select value from site_settings where key='footer.company_name'"); sno = q("select value from site_settings where key='footer.biz_reg_no'")
    rec('H-2 업체로 간 내용 — 키는 Authorization 헤더 · 공급자 = 운영 법인 · 공급받는 자 = 업체 · 금액 · 같은 문서 번호',
        FAKE['last_auth'] == 'Bearer ' + FAKE['key'] and b.get('docKey') == j.get('docKey') and b['supplier']['name'] == sname and b['supplier']['bizNo'] == sno.replace('-', '')
        and b['buyer']['bizNo'] == P['bizno'].replace('-', '') and b['buyer']['name'] == P['company'] and (b['supplyAmount'], b['taxAmount'], b['totalAmount']) == (100000, 10000, 110000)
        and b['writeDate'] == str(today) and '리드 이용료 2025-03' in b['items'][0]['name'], {k: b.get(k) for k in ('docKey', 'supplier', 'buyer', 'totalAmount')})
    st, j2 = call('POST', INV('lead-cash', L['OK'], 'send'), OPS, base=B2)
    st3, j3 = call('POST', INV('lead-cash', L['OK'], 'resend'), OPS, base=B2)
    st4, j4 = call('POST', f"/admin/partner-center/lead-cash-invoices/{L['OK']}/issue", OPS, {'invoiceNo': 'X', 'issuedOn': str(today)})
    rec('H-3 중복 발행 막기 — 보낸 줄 「발행」 · 「다시 보내기」 409 ETAX_ALREADY_SENT · 손으로 번호 409 · 업체 발행 요청은 1번뿐',
        st == 409 and j2['code'] == 'ETAX_ALREADY_SENT' and st3 == 409 and j3['code'] == 'ETAX_ALREADY_SENT' and st4 == 409 and FAKE['issue_calls'].get(j['docKey']) == 1, (st, st3, st4))

    FAKE['mode'] = 'reject'
    st, j = call('POST', INV('lead-cash', L['REJ'], 'send'), OPS, base=B2)
    rec('H-4 업체 거절(400) → 200 으로 결과 · FAILED · 실패 사유(업체 문구) · 시각 · 시도 1 · 발행 요청 그대로', st == 200 and j['etaxStatus'] == 'FAILED'
        and '사업자번호를 확인' in (j['etaxError'] or '') and j['state'] == 'REQUESTED' and j['attempts'] == 1 and j['resultAt'] and j['approvalNo'] is None, (st, j))
    st, j2 = call('POST', INV('lead-cash', L['REJ'], 'send'), OPS, base=B2)
    st3, j3 = call('POST', f"/admin/partner-center/lead-cash-invoices/{L['REJ']}/issue", OPS, {'invoiceNo': f'T34-{tag}-r', 'issuedOn': str(today)})
    rec('H-5 실패한 줄 「발행」 → 409 ETAX_USE_RESEND · 손으로 번호 → 409 ETAX_IN_PROGRESS', st == 409 and j2['code'] == 'ETAX_USE_RESEND' and st3 == 409 and j3['code'] == 'ETAX_IN_PROGRESS', (st, j2, st3, j3))
    FAKE['mode'] = 'ok'
    st, j = call('POST', INV('lead-cash', L['REJ'], 'resend'), OPS, base=B2)
    rec('H-6 다시 보내기 → 먼저 상태 조회(업체에 없음) → 발행 → SENT · 시도 2 · 같은 문서 번호', st == 200 and j['etaxStatus'] == 'SENT' and j['attempts'] == 2
        and logs(L['REJ']) == ['ISSUE|http|FAILED|HTTP_4XX', 'STATUS|http|NOT_FOUND|', 'ISSUE|http|SENT|'], (st, j.get('etaxStatus'), logs(L['REJ'])))

    FAKE['mode'] = 'slow'
    t0 = time.time(); st, j = call('POST', INV('lead-cash', L['TMO'], 'send'), OPS, base=B2); dt = time.time() - t0
    key_tmo = j.get('docKey')
    rec('H-7 시간 초과(업체는 발행 · 응답 3초 > 제한 1.5초) → FAILED · 「시간 초과」 사유 · 기록 TIMEOUT · 화면은 오래 멈추지 않음',
        st == 200 and j['etaxStatus'] == 'FAILED' and '시간 초과' in (j['etaxError'] or '') and logs(L['TMO']) == ['ISSUE|http|FAILED|TIMEOUT'] and dt < 3.0, (st, j.get('etaxError'), round(dt, 2)))
    time.sleep(1.8); FAKE['mode'] = 'ok'
    st, j = call('POST', INV('lead-cash', L['TMO'], 'resend'), OPS, base=B2)
    rec('H-8 시간 초과 뒤 다시 보내기 → 상태 조회로 이미 발행된 문서를 찾아 SENT — 업체 발행 요청은 1번뿐(중복 발행 없음) · 문서 번호 그대로',
        st == 200 and j['etaxStatus'] == 'SENT' and FAKE['issue_calls'].get(key_tmo) == 1 and j['docKey'] == key_tmo
        and j['approvalNo'].replace('-', '') == FAKE['docs'][key_tmo]['approvalNo'] and logs(L['TMO'])[-1] == 'STATUS|http|SENT|', (st, j.get('etaxStatus'), FAKE['issue_calls'].get(key_tmo), logs(L['TMO'])))

    FAKE['mode'] = 'down'
    st, j = call('POST', INV('lead-cash', L['DOWN'], 'send'), OPS, base=B2)
    rec('H-9 업체 장애(503) → FAILED · 「장애」 사유 · 기록 UPSTREAM', st == 200 and j['etaxStatus'] == 'FAILED' and '장애' in (j['etaxError'] or '') and logs(L['DOWN']) == ['ISSUE|http|FAILED|UPSTREAM'], (st, j.get('etaxError')))
    FAKE['mode'] = 'badno'
    st, j = call('POST', INV('lead-cash', L['BAD'], 'send'), OPS, base=B2)
    rec('H-10 업체가 「발행됨」인데 승인번호 형식이 아님(12345) → FAILED · 승인번호 저장 안 함(지어낸 · 잘못 읽은 번호 거부)', st == 200 and j['etaxStatus'] == 'FAILED'
        and '24자리' in (j['etaxError'] or '') and lcol(L['BAD'], 'etax_approval_no') == '' and j['state'] == 'REQUESTED', (st, j.get('etaxError')))
    FAKE['mode'] = 'ok'; FAKE['key'] = 'other-key'
    st, j = call('POST', INV('lead-cash', L['AUTH'], 'send'), OPS, base=B2)
    FAKE['key'] = 'etax-test-key'
    rec('H-11 키가 틀림(401) → FAILED · 「인증 실패 — 키 · 발신 IP」 사유 · 키 값은 사유에 없음', st == 200 and j['etaxStatus'] == 'FAILED' and '인증 실패' in (j['etaxError'] or '')
        and 'etax-test-key' not in json.dumps(j, ensure_ascii=False), (st, j.get('etaxError')))

    FAKE['mode'] = 'pending'
    st, j = call('POST', INV('lead-cash', L['PEND'], 'send'), OPS, base=B2)
    st2, j2 = call('POST', INV('lead-cash', L['PEND'], 'send'), OPS, base=B2)
    st3, j3 = call('POST', INV('lead-cash', L['PEND'], 'resend'), OPS, base=B2)
    rec('H-12 업체 접수 · 국세청 승인 대기 → SENDING · 그동안 「발행」 · 「다시 보내기」 → 409 ETAX_IN_FLIGHT', st == 200 and j['etaxStatus'] == 'SENDING' and j['state'] == 'REQUESTED'
        and st2 == 409 and j2['code'] == 'ETAX_IN_FLIGHT' and st3 == 409 and j3['code'] == 'ETAX_IN_FLIGHT', (st, j.get('etaxStatus'), st2, st3))
    FAKE['docs'][j['docKey']] = {'result': 'SENT', 'approvalNo': approval()}
    st, j = call('POST', INV('lead-cash', L['PEND'], 'refresh'), OPS, base=B2)
    rec('H-13 「상태 조회」 → 승인번호를 받아 SENT · 발행됨', st == 200 and j['etaxStatus'] == 'SENT' and j['state'] == 'ISSUED' and j['approvalNo'], (st, j))
    st, j = call('POST', INV('lead-cash', L['PEND'], 'refresh'), OPS, base=B2)
    rec('H-14 보낸 줄 「상태 조회」 → 409 ETAX_NOTHING_TO_CHECK', st == 409 and j['code'] == 'ETAX_NOTHING_TO_CHECK', (st, j))

    FAKE['mode'] = 'slowish'
    with ThreadPoolExecutor(2) as ex:
        res = list(ex.map(lambda _: call('POST', INV('lead-cash', L['RACE'], 'send'), OPS, base=B2), range(2)))
    codes = sorted(r[0] for r in res)
    k_race = lcol(L['RACE'], 'etax_doc_key')
    rec('H-15 같은 줄을 동시에 두 번 「발행」 → 하나만 보냄(200 · 409) · 업체 발행 요청 1번 · 시도 1', codes == [200, 409] and FAKE['issue_calls'].get(k_race) == 1
        and lcol(L['RACE'], 'etax_attempts') == '1' and lcol(L['RACE']) == 'SENT', (codes, [r[1].get('code') for r in res], FAKE['issue_calls'].get(k_race)))
    FAKE['mode'] = 'ok'

    st, j = call('POST', INV('lead-cash', L['OK'], 'cancel'), OPS, {'reason': '짧음'}, base=B2)
    st2, j2 = call('POST', INV('lead-cash', L['REJ'], 'cancel'), OPS, {'reason': '공급받는 자 정보 오기 — 수정 발행(시험)'})
    rec('H-16 취소 · 수정 발행 — 사유 5자 미만 400 · 키 없는 서버(3000)에서는 422 ETAX_NOT_CONFIGURED', st == 400 and st2 == 422 and j2['code'] == 'ETAX_NOT_CONFIGURED', (st, st2, j2))
    st, j = call('POST', INV('lead-cash', L['OK'], 'cancel'), OPS, {'reason': '공급받는 자 정보 오기 — 수정 발행(시험)'}, base=B2)
    st2, j2 = call('POST', INV('lead-cash', L['OK'], 'resend'), OPS, base=B2)
    rec('H-17 취소 → CANCELED · 수정세금계산서 승인번호 · 원래 승인번호 그대로 · 다시 보내기 409', st == 200 and j['etaxStatus'] == 'CANCELED' and j['amendApprovalNo']
        and j['approvalNo'] and st2 == 409 and j2['code'] == 'ETAX_ALREADY_SENT', (st, j, st2))
    st, j = call('POST', INV('lead-cash', L['NOCFG'], 'cancel'), OPS, {'reason': '보내지 않은 줄 취소 시도'}, base=B2)
    rec('H-18 보내지 않은 줄 취소 → 409 ETAX_NOT_SENT', st == 409 and j['code'] == 'ETAX_NOT_SENT', (st, j))

    st, j = call('POST', INV('directory', D1, 'resend'), OPS, base=B2)
    rec('H-19 연동 뒤 간주 발행 줄 「다시 보내기」 → 실제 전송 SENT(승인번호) · 발행 번호 칸(간주-…)은 그대로 · 방식 ASP', st == 200 and j['etaxStatus'] == 'SENT'
        and j['approvalNo'] and j['invoiceNo'].startswith('간주-') and j['etaxMode'] == 'ASP' and FAKE['issue_calls'].get(j['docKey']) == 1, (st, j))
    b = FAKE['last_body'] or {}
    rec('H-20 노출료 줄 내용 — 공급자 = 발행 요청 때 기록한 운영 법인 · 품목 「법률 · 세무 정액 노출료 1회차(기간)」 · 990,000 아님(1개월 330,000)',
        b.get('docKey') == j.get('docKey') and b['supplier']['name'] == sname and '법률 · 세무 정액 노출료 1회차' in b['items'][0]['name'] and b['totalAmount'] == 330000, b.get('items'))
    st, mi = call('GET', '/partner/directory/invoices', P['tok'])
    me = next((x for x in mi or [] if x['id'] == D1), {})
    st2, sl = call('GET', '/partner/settlement', P['tok'])
    lc = next((x for x in sl['invoices'] if x['kind'] == 'LEAD_CASH' and x['month'] == '2025-03'), {})
    rec('H-21 업체 화면 — 보낸 줄은 발행됨 · 번호 칸 = 국세청 승인번호(8-8-8)', me.get('etaxStatus') == 'SENT' and me.get('invoiceNo') == j['approvalNo']
        and lc.get('etaxStatus') == 'CANCELED' and re.match(r'^\d{8}-\d{8}-\d{8}$', lc.get('approvalNo') or ''), (me.get('invoiceNo'), lc))

    # ── P. 권한 ──────────────────────────────────────────────────────
    print('== P. 권한 ==', file=sys.stderr)
    paths = [('GET', '/admin/etax/status'), ('POST', INV('lead-cash', L['NOCFG'], 'send')), ('POST', INV('lead-cash', L['NOCFG'], 'resend')),
             ('POST', INV('lead-cash', L['NOCFG'], 'refresh')), ('POST', INV('lead-cash', L['NOCFG'], 'cancel'))]
    got = {who: [call(m, p, t, {'reason': '권한 시험 사유입니다'} if p.endswith('cancel') else None)[0] for m, p in paths]
           for who, t in (('업체', P['tok']), ('검수', REV), ('지급', PAY), ('비로그인', None))}
    rec('P-1 운영(ADMIN · SUPER)만 — 업체 · 검수(REVIEWER) · 지급(PAYOUT) · 비로그인 → 전부 403', all(v == [403] * 5 for v in got.values()) and lcol(L['NOCFG']) == '', got)
    st, _ = call('GET', '/admin/etax/status', ADM)
    st2, j2 = call('POST', '/admin/etax/settlement/' + D1 + '/send', OPS)
    st3, _ = call('POST', '/admin/etax/directory/nope/send', OPS)
    rec('P-2 SUPER 도 됨 · 대상 아닌 종류(소개자 정산 세금계산서 등) 404 · 번호 형식 아님 404', st == 200 and st2 == 404 and st3 == 404, (st, st2, st3))

    # ── G. 감사 · DB ─────────────────────────────────────────────────
    print('== G. 감사 · DB ==', file=sys.stderr)
    time.sleep(0.5)
    a = {'send_D1': audit_n('ETAX_SEND', D1), 'resend_D1': audit_n('ETAX_RESEND', D1), 'resend_REJ': audit_n('ETAX_RESEND', L['REJ']),
         'refresh_PEND': audit_n('ETAX_REFRESH', L['PEND']), 'cancel_OK': audit_n('ETAX_CANCEL', L['OK'])}
    rec('G-1 감사 기록 — 발행 · 다시 보내기 · 상태 조회 · 취소(성공한 요청마다 · 대상 = 세금계산서 줄)', a == {'send_D1': 1, 'resend_D1': 1, 'resend_REJ': 1, 'refresh_PEND': 1, 'cancel_OK': 1}, a)
    rec('G-2 감사 기록 · 전송 기록에 키 값 없음', q("select count(*) from audit.audit_logs where action like 'ETAX_%' and after_data::text like '%etax-test-key%'") == '0'
        and q("select count(*) from etax_send_log where coalesce(error,'') like '%etax-test-key%'") == '0')
    o1 = psql(f"BEGIN; update etax_send_log set result='SENT' where invoice_id='{L['REJ']}'; ROLLBACK;")
    o2 = psql(f"BEGIN; delete from etax_send_log where invoice_id='{L['REJ']}'; ROLLBACK;")
    rec('G-3 전송 기록은 고치거나 지울 수 없음(append-only)', 'append-only' in o1.stderr and 'append-only' in o2.stderr, (o1.stderr.strip()[:60],))
    o1 = psql(f"BEGIN; update lead_cash_invoices set etax_approval_no='{'1' * 24}' where id='{L['TMO']}'; ROLLBACK;")
    o2 = psql(f"BEGIN; update lead_cash_invoices set etax_doc_key='SGB-L-000000-0000000000' where id='{L['TMO']}'; ROLLBACK;")
    o3 = psql(f"BEGIN; update lead_cash_invoices set etax_status='FAILED' where id='{L['TMO']}'; ROLLBACK;")
    rec('G-4 DB — 승인번호 · 문서 번호 바꾸기 거부(ETAX_FIXED) · 보낸 줄을 실패로 되돌리기 거부(ETAX_SENT)',
        'ETAX_FIXED' in o1.stderr and 'ETAX_FIXED' in o2.stderr and 'ETAX_SENT' in o3.stderr, (o1.stderr.strip()[:50], o2.stderr.strip()[:50], o3.stderr.strip()[:50]))
    o1 = psql(f"BEGIN; update lead_cash_invoices set etax_approval_no='{'2' * 24}' where id='{L['A']}'; ROLLBACK;")
    o2 = psql(f"BEGIN; update lead_cash_invoices set etax_approval_no='12345' where id='{L['NOCFG']}'; ROLLBACK;")
    rec('G-5 DB — 간주 줄에 승인번호 넣기 거부 · 24자리 아닌 승인번호 거부(제약)', '_etax' in o1.stderr and '_etax' in o2.stderr, (o1.stderr.strip()[:60], o2.stderr.strip()[:60]))
    o = psql(f"BEGIN; update consult_directory_invoices set supply = 1 where id='{D1}'; ROLLBACK;")
    rec('G-6 v10.33 가드 그대로 — 발행된 노출료 줄의 금액 고치기 거부(DIRECTORY_INVOICE_ISSUED) · 전송 결과 칸만 기록 가능',
        'DIRECTORY_INVOICE_ISSUED' in o.stderr and dcol(D1) == 'SENT', o.stderr.strip()[:80])
    rec('G-7 소개자 발행 정산 세금계산서(settlements.tax_invoice_*)는 손대지 않음 — etax 칸 없음',
        q("select count(*) from information_schema.columns where table_name='settlements' and column_name like 'etax%'") == '0')
finally:
    setting('assume.etax', 'on')
    call('POST', f'/admin/directory/{EID}/end', OPS, {'reason': 'v10.34 시험 끝 — 시험용 노출 종료'})
    api2.terminate()
    try: api2.wait(10)
    except Exception: api2.kill()
    fake.shutdown()
rec('Z-1 시험 뒤 정리 — assume.etax on 으로 되돌림 · 시험 노출 종료 · 시험 API · 가짜 서버 끔',
    q("select value from site_settings where key='assume.etax'") == 'on' and q(f"select state from consult_directory_entries where id='{EID}'") == 'ENDED' and api2.poll() is not None)

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'test_v1034_etax.json')
json.dump({'tag': tag, 'entry': EID, 'directory': [D1, D2], 'leadCash': L, 'fakePort': FPORT, 'apiPort': APORT, 'results': R}, open(out, 'w'), ensure_ascii=False, indent=1)
print(f"통과 {sum(r['ok'] for r in R)} / {len(R)}")
