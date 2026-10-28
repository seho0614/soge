"""v10.143 시험 — 전자계약 연동 틀(D139 · docs/217 · 설계 docs/216)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e SITE=http://localhost:15174 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1143.py

  ① 코드 — D139(요청 · 웹훅 기록 표 · 대기 하나 · 키 이름 · 설정 · 배치 · 지우는 문장 없음 · 177) · 업체 HTTP 틀(빠진 설정 · 상태 이름 바꾸기) ·
     지문 · 웹훅 서명(HMAC · 시각 · timingSafeEqual) · 지문 다르면 안 올림 · 계약 단추 잠금 · 화면 안 서명 막기 · 파기 시 취소 · API · 공개 웹훅 구역 ·
     rawBody · 배치 · 방식 SUPER · 화면 목록 · 사용자 웹 · 운영 화면 · 사전 · 영어 · 연동 목록 · 판
  ② (API · MOCK — 밖으로 보내지 않음) 처음 STUB · 권한 · HTTP 키 없이 422 · 합의 전 409 · 화면 안 서명 409 · 요청(지문 · 내 주소) · 두 번 눌러도 하나 ·
     요청 중 합의 409 · 남의 계약 403 · 웹훅 서명 틀림 401 · 한쪽 서명 · 취소 · 지문 다름 FAILED · 거절 · 같은 알림 한 번 · 방식 바꾸기 막힘 · 만료(배치) ·
     양측 서명 → SIGNED(업체 시각 · 이력 · 체결 알림) · 운영 상태 · 목록(연락처 없음) · STUB 이면 가짜 서명 403 — 끝나면 설정 되돌림
  ③ (사용자 웹) 내 계약 화면 「전자서명」 상자 · 서명하러 가기 → 가짜 서명 화면 → 돌아옴 / (운영 화면) 외부 연동 › 「전자계약」
"""
import hashlib, hmac, json, os, re, subprocess, time, urllib.error, urllib.request, uuid

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB'); SITE = os.environ.get('SITE')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []
MOCK_SECRET = 'sgb-mock-esign-webhook-secret'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
D = rd('prisma/migrations/D139_esign/migration.sql')
mig = sorted(x for x in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', x)))
ok('① D139 — 요청 표(지문 64자 · 상태 6) · 대기 하나(부분 유일) · 웹훅 기록(본문 없음) · 키 이름 웹훅 비밀값 · 설정(STUB · 7) · 배치 esign_poll · 지우는 문장 없음 · 177 이상',
   'CREATE TABLE IF NOT EXISTS public.esign_documents' in D and 'CREATE TABLE IF NOT EXISTS public.esign_events' in D
   and "ON public.esign_documents (contract_id) WHERE state = 'PENDING'" in D and "doc_hash ~ '^[0-9a-f]{64}$'" in D
   and "('ESIGN','ESIGN_WEBHOOK_SECRET')" in D and "'ALIMTALK_SENDER_KEY', 'ESIGN_WEBHOOK_SECRET') THEN" in D
   and "('esign.provider', 'STUB'" in D and "('esign.expire_days', '7'" in D and "VALUES ('esign_poll', 10," in D and 'payload' not in D
   and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE|DROP COLUMN)\b', D) and len(mig) >= 177 and 'D139_esign' in mig, f'{len(mig)} · {mig[-1]}')
PV = rd('src/modules/deal/esign.provider.ts'); SV = rd('src/modules/deal/esign.service.ts')
ok('① 업체 HTTP 틀 — 빠진 설정(키 · 웹훅 비밀값 · 주소) · 경로 · 응답 칸 위치 · 상태 이름 바꾸기 · 모르는 상태는 아무것도 안 바꿈 · 키만으로 실제로 안 감',
   "['ESIGN_API_KEY', 'ESIGN_WEBHOOK_SECRET', 'ESIGN_URL']" in PV and 'ESIGN_STATE_MAP' in PV and "COMPLETED: 'SIGNED'" in PV
   and "errorKind: 'BAD_RESPONSE', error: `모르는 상태" in PV and 'class RealESign' not in PV and 'return new StubESign();' in PV, '')
ok('① 지문 · 웹훅 서명 — SHA-256(양식 · 판 · 조건 · 계약 · 정렬) · HMAC-SHA256(시각.본문) · 5분 · timingSafeEqual · 같은 알림 한 번 · HTTP 는 업체에 다시 조회',
   "createHash('sha256')" in SV and "createHmac('sha256', secret).update(`${ts}.${raw}`" in SV and 'SIG_SKEW_SEC = 300' in SV and 'timingSafeEqual(cand, mac)' in SV
   and 'ON CONFLICT (provider, event_id) WHERE sig_ok AND NOT duplicate' in SV and "mode === 'HTTP' ? await new HttpESign().status(d.doc_id!)" in SV, '')
ok('① 반영 — 대기 중만 · 지문 다르면 FAILED(HASH_MISMATCH) · 거절 · 만료 · 취소는 합의 그대로(서명 기록 비움) · 양측이면 SIGNED(업체 시각) · 웹훅 본문 · 연락처 저장 안 함',
   "if (d.state !== 'PENDING') return `ALREADY_${d.state}`" in SV and "error_kind = 'HASH_MISMATCH'" in SV and "signed_by_buyer_at = CASE WHEN state = 'AGREED' THEN NULL" in SV
   and "state = 'SIGNED', esign_stub = false" in SV and 'INSERT INTO esign_events (provider, event_id, doc_id, kind, sig_ok' in SV, '')
CS = rd('src/modules/deal/deal-contract.service.ts')
ok('① 계약 — 요청 중 합의 · 수정 · 임시 저장 막힘(3곳) · 켜면 화면 안 서명 막힘 · 파기 시 요청 취소 · 상태에 방식',
   CS.count('await this.esign.assertNotInProgress(c.id);') == 3 and 'await this.esign.assertInAppSignAllowed();' in CS
   and 'await this.esign.cancelForContract(c.id, me);' in CS and "mode: esignMode, pending: esignMode !== 'STUB'" in CS, '')
EC = rd('src/modules/deal/esign.controller.ts'); DC = rd('src/modules/deal/deal.controller.ts')
routes = re.findall(r"@(Get|Post)\('([^']+)'\)\n(?:  @HttpCode\(200\)\n)?(?:  @Roles\(([^)]*)\))?", EC)
ok('① API — 회원 4개(요청 · 상태 · 취소 · 가짜 서명) · 웹훅(로그인 없음) · 운영 2개 · 감사 · 옛 경로는 deal.controller 에서 뺌',
   sorted(routes) == sorted([('Post', 'deals/:id/contract/esign', "'MEMBER', 'BIZ_OWNER', 'BIZ_STAFF'"), ('Get', 'deals/:id/contract/esign', "'MEMBER', 'BIZ_OWNER', 'BIZ_STAFF'"),
                             ('Post', 'deals/:id/contract/esign/cancel', "'MEMBER', 'BIZ_OWNER', 'BIZ_STAFF'"), ('Post', 'deals/:id/contract/esign/mock-sign', "'MEMBER', 'BIZ_OWNER', 'BIZ_STAFF'"),
                             ('Post', 'webhooks/esign', ''), ('Get', 'status', "'ADMIN', 'SUPER'"), ('Get', 'documents', "'ADMIN', 'SUPER'")])
   and "@Audit('CONTRACT_ESIGN', 'DEAL')" in EC and "@Audit('CONTRACT_ESIGN_CANCEL', 'DEAL')" in EC and "@Post('deals/:id/contract/esign')" not in DC
   and "'webhooks'," in rd('scripts/check-acl.js'), str(routes))
ok('① 웹훅 본문 그대로(rawBody) · 배치 esign_poll 등록(스케줄러 · 작업 목록)', "NestFactory.create(AppModule, { rawBody: true })" in rd('src/main.ts')
   and "case 'esign_poll'" in rd('src/worker/scheduler.service.ts') and "'esign_poll'," in rd('src/worker/worker.controller.ts'), '')
AD = rd('src/modules/admin/admin.service.ts')
ok('① 방식 — esign.* SUPER · MOCK 운영 서버 422 · HTTP 설정 없이 422 · 대기 중 요청 있으면 못 바꿈', "key.startsWith('esign.')" in AD
   and "'ESIGN_KEYS_MISSING'" in AD and "'ESIGN_PENDING_EXISTS'" in AD and "key === 'esign.provider'" in AD, '')
SC = json.loads(rd('spec/screens.json') or '{"screens":[]}')
scr = {s['id']: s for s in SC['screens']}
ok('① 화면 목록 — 계약서 화면에 취소 · 가짜 서명 · 웹훅 · 외부 연동에 운영 2개', all(a in scr.get('SB-MYP-CTR-020', {}).get('apis', []) for a in
   ['POST /deals/{id}/contract/esign/cancel', 'POST /deals/{id}/contract/esign/mock-sign', 'POST /webhooks/esign'])
   and all(a in scr.get('SB-ADM-SIT-080', {}).get('apis', []) for a in ['GET /admin/esign/status', 'GET /admin/esign/documents']), '')
CF = rd('site/src/app/my/contracts/[id]/ContractForm.tsx'); MP = rd('site/src/app/contract/mock-sign/page.tsx'); MC = rd('site/src/components/EsignMockSign.tsx')
ok('① 사용자 웹 — 켜면 「서명」 단추 대신 전자서명 상자(요청 · 서명하러 가기 · 취소 · 상태) · 요청 중 조건 잠금 · 가짜 서명 화면(로그인)',
   'function EsignBox' in CF and all(x in CF for x in ('data-esign-request', 'data-esign-go', 'data-esign-cancel', 'data-esign-box'))
   and '{!esignOn && (' in CF and 'const locked = esignOn' in CF and "redirect(`/login?next=" in MP and 'data-mock-esign-ok' in MC, '')
KO = json.loads(rd('site/src/i18n/messages/ko/myDeal.json') or '{}'); EN_ = json.loads(rd('site/src/i18n/messages/en/myDeal.json') or '{}')
def keys(o, p=''):
    return {p + k for k, v in o.items() for k in ([k] if not isinstance(v, dict) else [])} | {x for k, v in o.items() if isinstance(v, dict) for x in keys(v, p + k + '.')}
ok('① 사전 — esign · esignMock 한국어 · 영어 같은 키', bool(KO.get('esign')) and keys({'esign': KO.get('esign', {}), 'm': KO.get('esignMock', {})}) == keys({'esign': EN_.get('esign', {}), 'm': EN_.get('esignMock', {})}), '')
AP = rd('web/src/app/admin/EsignPanel.tsx')
ok('① 운영 화면 — 외부 연동 「전자계약」(준비 줄 · 웹훅 주소 · 30일 · 목록 · SUPER 만 단추)', '<EsignPanel />' in rd('web/src/app/admin/Integrations.tsx')
   and all(x in AP for x in ('data-esign-panel', 'data-esign-row', 'data-esign-webhook-url', 'data-esign-stats', 'data-esign-docs', 'data-esign-set')) and "tokenRoles().includes('SUPER')" in AP, '')
RG = rd('src/common/integration/registry.ts'); SS = rd('src/common/integration/secret.service.ts'); EV = rd('deploy/aws/env.production.example')
EN = rd('src/common/i18n/server-text.en.ts')
ok('① 연동 목록 · 키 목록 · .env 예시 · 영어 문장', "'ESIGN_WEBHOOK_SECRET', 'ESIGN_URL'" in RG and "name: 'ESIGN_WEBHOOK_SECRET'" in SS and 'ESIGN_URL=' in EV
   and all(m in EN for m in ('"진행 중인 전자서명 요청이 없습니다."', '"서명 검사에 실패했습니다."', '"이 계약은 전자서명으로 체결합니다 — 「전자서명 요청」을 누르십시오."')), '')
ok('① 판 v10.143 이상', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 143), rd('VERSION').strip())


def call(m, p, b=None, t=None, raw=None, headers=None):
    hd = {'content-type': 'application/json', **(headers or {})}
    if t: hd['Authorization'] = 'Bearer ' + t
    data = raw if raw is not None else (json.dumps(b).encode() if b is not None else None)
    r = urllib.request.Request(API + p, data=data, headers=hd, method=m)
    try:
        return json.load(urllib.request.urlopen(r, timeout=60))
    except urllib.error.HTTPError as e:
        try: body = json.loads(e.read().decode('utf-8', 'replace'))
        except Exception: body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip()


def hook(body, secret=MOCK_SECRET, ts=None):
    raw = json.dumps(body, ensure_ascii=False).encode()
    ts = str(ts or int(time.time()))
    sig = hmac.new(secret.encode(), ts.encode() + b'.' + raw, hashlib.sha256).hexdigest()
    return call('POST', '/webhooks/esign', raw=raw, headers={'x-esign-timestamp': ts, 'x-esign-signature': sig})


SETS = ['esign.provider', 'esign.expire_days']
SELLERS = ('intro@x.com', 'seller@x.com')
PW = 'sgb-dev-1234'
if API and DB:
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW})['accessToken']
    before = {k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'") for k in SETS}
    mark = psql("SELECT now()::text")
    setv = lambda k, v, t=T_: call('PATCH', '/admin/site-settings', {'key': k, 'value': v}, t)
    had_role = psql("SELECT count(*) FROM account_roles r JOIN accounts a ON a.id = r.account_id WHERE a.email = 'seller@x.com' AND r.role = 'ADMIN'") != '0'
    did = None; BT = ST = None
    try:
        setv('esign.provider', 'STUB')
        s0 = call('GET', '/admin/esign/status', t=T_)
        ok('② 처음 — STUB · 키 2개 없음 · 웹훅 주소 · 값 칸 없음', s0.get('provider') == 'STUB' and [k['set'] for k in s0.get('keys', [])] == [False, False]
           and str(s0.get('webhookUrl', '')).endswith('/api/v1/webhooks/esign') and 'value' not in json.dumps(s0.get('keys')), str(s0)[:160])

        # 준비 — 판매 쪽(매물 등록자 · 본인인증) 매물에 새 구매 회원이 문의 → 거래 → 계약서 발급
        row = None
        for se in SELLERS:
            row = psql(f"""SELECT l.id FROM listings l JOIN accounts a ON a.id = l.owner_account_id JOIN categories c ON c.id = l.category_id
                            WHERE a.email = '{se}' AND l.status = 'PUBLISHED' AND NOT fn_is_realty_category(c.id) AND NOT fn_category_no_intro(c.id)
                            ORDER BY l.created_at LIMIT 1""")
            if row: SELLER = se; break
        LID = row
        ST = call('POST', '/auth/login', {'email': SELLER, 'password': PW}).get('accessToken') if LID else None
        em = f'v1143_{uuid.uuid4().hex[:6]}@t.local'
        sj = call('POST', '/auth/signup', {'email': em, 'password': 'Sgb-v1143-1234!', 'name': '전자계약 시험', 'agreedTerms': []})
        BT = sj.get('accessToken')
        req = call('GET', '/terms/required', t=BT)
        items = [{'code': x['code'], 'agreed': True} for x in (req if isinstance(req, list) else []) if x.get('isRequired') and not x.get('agreed')]
        if items: call('POST', '/terms/agree', {'items': items}, BT)
        call('POST', '/verifications/identity', {'provider': 'PASS'}, BT)
        cv = call('POST', '/conversations', {'targetType': 'LISTING', 'targetId': LID, 'message': '전자계약 시험 문의입니다. 가능할까요?'}, BT) if LID else {}
        dj = call('POST', f"/conversations/{cv.get('conversationId')}/deal", None, ST) if cv.get('conversationId') else {}
        did = dj.get('dealId') or dj.get('id')
        if did: call('POST', f'/deals/{did}/contract', {}, ST)
        TERMS = {'amount': 1430000, 'dueDate': time.strftime('%Y-%m-%d', time.localtime(time.time() + 14 * 86400)), 'kind': 'GOODS'}
        st0 = call('GET', f'/deals/{did}/contract/state', t=BT) if did else {}
        ok('② (준비) 매물 · 새 구매 회원 · 문의 · 거래 · 계약서 발급', bool(LID and BT and ST and did) and st0.get('state') in ('DRAFT', 'SENT'), f'{SELLER if LID else "매물 없음"} · {str(did)[:8]} · {st0.get("state")}')

        if did:
            psql(f"INSERT INTO account_roles(account_id, role) SELECT id, 'ADMIN' FROM accounts WHERE email = 'seller@x.com' ON CONFLICT DO NOTHING;")
            AT = call('POST', '/auth/login', {'email': 'seller@x.com', 'password': PW}).get('accessToken')
            ok('② 권한 — 회원 403 · 운영(ADMIN) 보기만(방식 바꾸기 403)', call('GET', '/admin/esign/status', t=BT).get('_err') == 403
               and 'provider' in call('GET', '/admin/esign/status', t=AT) and setv('esign.provider', 'MOCK', AT).get('code') == 'INTEG_SETTING_SUPER', '')
            if not had_role:
                psql("DELETE FROM account_roles WHERE role = 'ADMIN' AND account_id = (SELECT id FROM accounts WHERE email = 'seller@x.com');")
            h = setv('esign.provider', 'HTTP')
            ok('② HTTP — 키 · 웹훅 비밀값 · 주소 없이 422 ESIGN_KEYS_MISSING', h.get('code') == 'ESIGN_KEYS_MISSING', str(h)[:120])
            ok('② MOCK 으로(점검판)', setv('esign.provider', 'MOCK').get('_err') is None and call('GET', '/admin/esign/status', t=T_).get('configured') is True, '')

            r0 = call('POST', f'/deals/{did}/contract/esign', {}, BT)
            ok('② 합의 전 요청 409 NOT_AGREED', r0.get('code') == 'NOT_AGREED', str(r0)[:100])
            call('POST', f'/deals/{did}/contract/agree', {'terms': TERMS}, ST); call('POST', f'/deals/{did}/contract/agree', {'terms': TERMS}, BT)
            s1 = call('GET', f'/deals/{did}/contract/state', t=BT)
            sg = call('POST', f'/deals/{did}/contract/sign', {}, BT)
            ok('② 양측 합의(AGREED) · 상태에 방식 MOCK · 화면 안 「서명」 409 ESIGN_REQUIRED', s1.get('state') == 'AGREED' and (s1.get('esign') or {}).get('mode') == 'MOCK'
               and sg.get('code') == 'ESIGN_REQUIRED', f"{s1.get('state')} · {s1.get('esign')} · {sg.get('code')}")

            q1 = call('POST', f'/deals/{did}/contract/esign', {}, BT)
            q2 = call('POST', f'/deals/{did}/contract/esign', {}, ST)
            cid = psql(f"SELECT id FROM deal_contracts WHERE deal_id = '{did}' ORDER BY issued_at DESC LIMIT 1")
            ok('② 요청 — PENDING · 지문 64자 · 내 서명 주소(매수 · 내 쪽만) · 두 번 눌러도 대기 하나 · 계약에 문서 id',
               q1.get('state') == 'PENDING' and re.fullmatch(r'[0-9a-f]{64}', q1.get('docHash') or '') and 'role=BUYER' in (q1.get('mySignUrl') or '')
               and 'role=SELLER' in (q2.get('mySignUrl') or '') and q2.get('docHash') == q1.get('docHash')
               and psql(f"SELECT count(*) FROM esign_documents WHERE contract_id = '{cid}' AND state = 'PENDING'") == '1'
               and psql(f"SELECT esign_doc_id LIKE 'MOCK-%' FROM deal_contracts WHERE id = '{cid}'") == 't', str(q1)[:160])
            ag = call('POST', f'/deals/{did}/contract/agree', {'terms': {**TERMS, 'amount': 1500000}}, BT)
            ok('② 요청 중 조건 바꾸기 409 ESIGN_IN_PROGRESS', ag.get('code') == 'ESIGN_IN_PROGRESS', str(ag)[:100])
            ok('② 남의 계약 — 상태 · 요청 403', call('GET', f'/deals/{did}/contract/esign', t=T_).get('_err') == 403 and call('POST', f'/deals/{did}/contract/esign', {}, T_).get('_err') == 403, '')
            doc1 = psql(f"SELECT doc_id FROM esign_documents WHERE contract_id = '{cid}' AND state = 'PENDING'")
            bad = hook({'eventId': 'e-bad', 'documentId': doc1, 'status': 'COMPLETED'}, secret='wrong-secret')
            old = hook({'eventId': 'e-old', 'documentId': doc1, 'status': 'COMPLETED'}, ts=int(time.time()) - 900)
            ok('② 웹훅 서명 틀림 · 시각 15분 전 — 401 ESIGN_BAD_SIGNATURE · 기록(검사 실패) · 아무것도 안 바뀜', bad.get('code') == 'ESIGN_BAD_SIGNATURE' and old.get('_err') == 401
               and psql(f"SELECT count(*) FROM esign_events WHERE doc_id = '{doc1}' AND NOT sig_ok") == '2'
               and psql(f"SELECT state FROM esign_documents WHERE doc_id = '{doc1}'") == 'PENDING', f"{bad} · {old.get('_err')}")
            m1 = call('POST', f'/deals/{did}/contract/esign/mock-sign', {'action': 'SIGN'}, BT)
            ok('② 가짜 서명(매수) — 대기 그대로 · 매수 서명 시각 · 계약은 AGREED · 매수 서명 기록', m1.get('result') == 'PENDING' and bool(m1.get('buyerSignedAt')) and not m1.get('sellerSignedAt')
               and psql(f"SELECT state || '|' || (signed_by_buyer_at IS NOT NULL) || '|' || (signed_by_seller_at IS NULL) FROM deal_contracts WHERE id = '{cid}'") == 'AGREED|true|true', str(m1)[:140])
            sw = setv('esign.provider', 'STUB')
            ok('② 대기 중 요청이 있으면 방식 바꾸기 422 ESIGN_PENDING_EXISTS', sw.get('code') == 'ESIGN_PENDING_EXISTS', str(sw)[:100])
            cc = call('POST', f'/deals/{did}/contract/esign/cancel', {}, ST)
            ok('② 요청 취소 — CANCELLED · 계약 AGREED · 서명 기록 비움 · 문서 id 비움 · 다시 취소 409', cc.get('state') == 'CANCELLED'
               and psql(f"SELECT state || '|' || (signed_by_buyer_at IS NULL) || '|' || (esign_doc_id IS NULL) FROM deal_contracts WHERE id = '{cid}'") == 'AGREED|true|true'
               and call('POST', f'/deals/{did}/contract/esign/cancel', {}, ST).get('code') == 'ESIGN_NOT_PENDING', str(cc)[:120])

            call('POST', f'/deals/{did}/contract/esign', {}, BT)
            doc2 = psql(f"SELECT doc_id FROM esign_documents WHERE contract_id = '{cid}' AND state = 'PENDING'")
            now = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            hm = hook({'eventId': 'e-hash-' + doc2, 'documentId': doc2, 'status': 'COMPLETED', 'documentHash': '0' * 64,
                       'signers': [{'externalId': 'BUYER', 'signedAt': now}, {'externalId': 'SELLER', 'signedAt': now}]})
            ok('② 다시 요청 → 업체 지문이 다른 「완료」 — FAILED(HASH_MISMATCH) · 계약은 AGREED · 서명 기록 비움', hm.get('result') == 'HASH_MISMATCH'
               and psql(f"SELECT state || '|' || error_kind FROM esign_documents WHERE doc_id = '{doc2}'") == 'FAILED|HASH_MISMATCH'
               and psql(f"SELECT state || '|' || (signed_by_buyer_at IS NULL) FROM deal_contracts WHERE id = '{cid}'") == 'AGREED|true', str(hm)[:120])

            call('POST', f'/deals/{did}/contract/esign', {}, ST)
            doc3 = psql(f"SELECT doc_id FROM esign_documents WHERE contract_id = '{cid}' AND state = 'PENDING'")
            rj = hook({'eventId': 'e-rej-' + doc3, 'documentId': doc3, 'status': 'DECLINED'})
            dup = hook({'eventId': 'e-rej-' + doc3, 'documentId': doc3, 'status': 'DECLINED'})
            ok('② 거절(업체 DECLINED) — REJECTED · 같은 알림 다시 오면 중복(한 번만 처리)', rj.get('result') == 'REJECTED' and dup.get('duplicate') is True
               and psql(f"SELECT state FROM esign_documents WHERE doc_id = '{doc3}'") == 'REJECTED'
               and psql(f"SELECT count(*) FROM esign_events WHERE event_id = 'e-rej-{doc3}' AND duplicate") == '1', f'{rj} · {dup}')

            call('POST', f'/deals/{did}/contract/esign', {}, BT)
            doc4 = psql(f"SELECT doc_id FROM esign_documents WHERE contract_id = '{cid}' AND state = 'PENDING'")
            psql(f"UPDATE esign_documents SET expires_at = now() - interval '1 minute' WHERE doc_id = '{doc4}'")
            jb = call('POST', '/admin/jobs', {'job': 'esign_poll'}, T_)
            ok('② 만료 — 배치 esign_poll 이 기한 지난 요청을 EXPIRED · 계약 AGREED', (jb.get('detail') or {}).get('expired', 0) >= 1
               and psql(f"SELECT state FROM esign_documents WHERE doc_id = '{doc4}'") == 'EXPIRED'
               and psql(f"SELECT state FROM deal_contracts WHERE id = '{cid}'") == 'AGREED', str(jb)[:140])

            q5 = call('POST', f'/deals/{did}/contract/esign', {}, BT)
            doc5 = psql(f"SELECT doc_id FROM esign_documents WHERE contract_id = '{cid}' AND state = 'PENDING'")
            browser_signed = False
            if SITE:
                try:
                    from playwright.sync_api import sync_playwright
                except Exception:
                    sync_playwright = None
                if sync_playwright:
                    with sync_playwright() as p:
                        b = p.chromium.launch(); cx = b.new_context(viewport={'width': 1280, 'height': 1000})
                        host = re.sub(r'^https?://', '', SITE).split(':')[0]
                        cx.add_cookies([{'name': 'sgb_at', 'value': BT, 'domain': host, 'path': '/'}])
                        pg = cx.new_page()
                        pg.goto(f'{SITE}/my/contracts/{did}', wait_until='networkidle', timeout=120000)
                        try: pg.wait_for_selector('[data-esign-box][data-esign-state="PENDING"]', timeout=30000)
                        except Exception: pass
                        box = pg.locator('[data-esign-box]')
                        go = pg.locator('[data-esign-go]')
                        ok('③ 내 계약 화면 — 「전자서명」 상자(서명 대기) · 「서명하러 가기」 · 화면 안 「서명」 단추 없음', box.count() == 1 and box.get_attribute('data-esign-state') == 'PENDING'
                           and go.count() == 1 and pg.get_by_role('button', name=re.compile('^서명하기$')).count() == 0, box.inner_text()[:100] if box.count() else '없음')
                        pg.screenshot(path=os.path.join(HERE, 'v1143_contract_box.png'))
                        if go.count():
                            go.click(); pg.wait_for_url('**/contract/mock-sign**', timeout=60000); pg.wait_for_selector('[data-mock-esign-ok]', timeout=30000)
                            pg.screenshot(path=os.path.join(HERE, 'v1143_mock_sign.png'))
                            pg.click('[data-mock-esign-ok]'); pg.wait_for_url(f'**/my/contracts/{did}', timeout=60000)
                            browser_signed = psql(f"SELECT buyer_signed_at IS NOT NULL FROM esign_documents WHERE doc_id = '{doc5}'") == 't'
                            ok('③ 서명하러 가기 → 가짜 서명 화면 → 「서명하기」 → 내 계약으로 돌아옴 · 매수 서명 기록', browser_signed, pg.url[-60:])
                        b.close()
            if not browser_signed:
                call('POST', f'/deals/{did}/contract/esign/mock-sign', {'action': 'SIGN'}, BT)
            m2 = call('POST', f'/deals/{did}/contract/esign/mock-sign', {'action': 'SIGN'}, ST)
            ok('② 양측 서명 → SIGNED · 계약 SIGNED(서명 시각 = 업체 값) · 이력 「전자서명 완료」 · 체결 알림 · 지문 그대로',
               m2.get('result') == 'SIGNED' and m2.get('state') == 'SIGNED' and m2.get('docHash') == q5.get('docHash')
               and psql(f"SELECT state || '|' || (signed_by_buyer_at = (SELECT buyer_signed_at FROM esign_documents WHERE doc_id = '{doc5}')) FROM deal_contracts WHERE id = '{cid}'") == 'SIGNED|true'
               and psql(f"SELECT count(*) FROM contract_revisions WHERE contract_id = '{cid}' AND memo LIKE '양측 전자서명 완료%'") == '1'
               and int(psql(f"SELECT count(*) FROM notifications WHERE event_code = 'CONTRACT_ESIGN_DONE' AND created_at >= '{mark}'") or 0) >= 2, str(m2)[:160])
            late = hook({'eventId': 'e-late-' + doc5, 'documentId': doc5, 'status': 'DECLINED'})
            ok('② 끝난 요청에 늦게 온 알림 — 바꾸지 않음(ALREADY_SIGNED)', late.get('result') == 'ALREADY_SIGNED', str(late)[:100])

            stt = call('GET', '/admin/esign/status', t=T_); dl = call('GET', '/admin/esign/documents?days=1', t=T_)
            l30 = stt.get('last30') or {}
            dj_ = json.dumps(dl, ensure_ascii=False)
            ok('② 운영 상태 · 목록 — 요청 5 이상 · 체결 1 이상 · 실패 까닭(HASH_MISMATCH) · 웹훅 서명 틀림 2 이상 · 목록에 연락처 · 서명 주소 없음',
               l30.get('requested', 0) >= 5 and l30.get('signed', 0) >= 1 and 'HASH_MISMATCH' in {r['reason'] for r in l30.get('reasons', [])}
               and (stt.get('webhook') or {}).get('badSignature', 0) >= 2 and len(dl.get('rows', [])) >= 5 and 'mock-sign' not in dj_ and '@' not in dj_ and 'phone' not in dj_, str(l30)[:160])
            setv('esign.provider', 'STUB')
            ms = call('POST', f'/deals/{did}/contract/esign/mock-sign', {'action': 'SIGN'}, BT)
            wh = hook({'eventId': 'e-off', 'documentId': doc5, 'status': 'COMPLETED'})
            ok('② STUB 이면 가짜 서명 403 MOCK_ONLY · 웹훅은 받기만(ESIGN_OFF)', ms.get('code') == 'MOCK_ONLY' and wh.get('ignored') == 'ESIGN_OFF', f'{ms} · {wh}')
    finally:
        for k, v in before.items():
            psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}';")
        if not had_role:
            psql("DELETE FROM account_roles WHERE role = 'ADMIN' AND account_id = (SELECT id FROM accounts WHERE email = 'seller@x.com');")
    ok('② 되돌림 — 설정 · seller 운영 권한', all(psql(f"SELECT value FROM site_settings WHERE key = '{k}'") == v for k, v in before.items())
       and (had_role or psql("SELECT count(*) FROM account_roles r JOIN accounts a ON a.id = r.account_id WHERE a.email = 'seller@x.com' AND r.role = 'ADMIN'") == '0'), '')

# ── ③ 운영 화면 ───────────────────────────────────────────────────────
if ADMIN_WEB:
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if sync_playwright:
        with sync_playwright() as p:
            b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1400, 'height': 1000})
            pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
            pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(1500)
            pg.goto(ADMIN_WEB + '/#/integrations', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
            box = pg.locator('[data-esign-panel]')
            ok('③ 외부 연동 › 「전자계약」 — 준비 네 줄 · 웹훅 주소 · 30일 · 요청 목록 · 방식 단추', box.count() == 1 and box.locator('[data-esign-row]').count() == 4
               and box.locator('[data-esign-webhook-url]').count() == 1 and box.locator('[data-esign-stats]').count() == 1 and box.locator('[data-esign-docs]').count() == 1
               and box.locator('[data-esign-set]').count() >= 2, box.inner_text()[:120] if box.count() else '없음')
            ok('③ 연동 키 목록에 「웹훅 비밀값」', pg.get_by_text('웹훅 비밀값').count() >= 1, '')
            if box.count(): box.scroll_into_view_if_needed()
            pg.screenshot(path=os.path.join(HERE, 'v1143_esign_panel.png'), full_page=False)
            b.close()

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
