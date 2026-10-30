"""v10.139 시험 — AI 상담 4단계 신청서 초안(D135 · docs/209 · 설계 docs/208)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e SITE=http://localhost:15174 -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1139.py
  (② ③ ⑤ 는 API 를 시험 엔진으로 띄운 점검판에서 — AGENT_PROVIDER=MOCK)

  ① 코드 — 초안 도구 2개(회원 번호 칸 없음 · 분쟁 없음) · 초안 서비스에 접수(INSERT inquiries · hlt_returns) 길 없음 · 내 정보 조회가 켜져야 ·
     한 질문 1개 · 대화와 한 거래로 저장 · 지시문 「접수 아님」 · D135(표 · 조회 기록 도구 7개 · 스위치 꺼짐 · 지우는 문장 없음) · 173 ·
     초안 읽기 API(본인 · 7일 · 제출 전) · 신청 API 의 agentDraftId · 사용자 웹 카드 · 신청 화면 채움 · 운영 화면 스위치 · 숫자 · 판
  ② (API · MOCK) 초안 스위치 꺼짐 → 초안 없음 / 켜짐 → 반품 초안(본인 주문 · 끝 4자리) · 문의 초안 · 없는 주문은 초안 없음 · 비회원 없음 ·
     **AI 대화만으로 접수 0건** · 초안 읽기는 본인만 · 화면에서 제출하면 「제출됨」 · 판정은 그대로 · 7일 지나면 내용 비움 · 운영 화면 줄 · 숫자
  ③ (DB) 대화를 지우면 초안도 지워짐
  ④ (운영 화면) 「AI 스위치」에 「AI 상담 — 신청서 초안」 줄
  ⑤ (사용자 웹) /support/new?draft= · /my/health/returns/new?o=&draft= 가 초안으로 채워짐(본인만)
"""
import json, os, re, subprocess, urllib.error, urllib.parse, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB'); SITE = os.environ.get('SITE')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


def get(o, k):
    for p in k.split('.'):
        o = o.get(p) if isinstance(o, dict) else None
    return o


# ── ① 코드 ────────────────────────────────────────────────────────────
DS = rd('src/modules/agent/agent-draft.service.ts'); C = rd('src/modules/agent/agent-chat.service.ts'); P_ = rd('src/modules/agent/agent.provider.ts')
TB = DS.split('export const DRAFT_TOOLS')[1].split('export const DRAFT_NAMES')[0] if 'export const DRAFT_TOOLS' in DS else ''
ok('① 초안 도구 2개 · 입력에 회원 번호 칸 없음 · 문의 유형에 분쟁(DISPUTE) 없음',
   "name: 'draft_inquiry'" in TB and "name: 'draft_return'" in TB and TB.count('input_schema') == 2 and not re.search(r'account_?id|member_?id', TB, re.I)
   and "export const DRAFT_CATEGORIES = ['DEAL', 'SETTLE', 'ACCOUNT', 'ETC'];" in DS, '')
ok('① 초안 서비스에 접수하는 길이 없음(INSERT inquiries · hlt_returns · 신청 API 호출 없음)',
   not re.search(r'INSERT INTO (public\.)?(inquiries|hlt_returns)', DS) and 'me/health/returns' not in DS and "'/inquiries'" not in DS
   and not re.search(r'INSERT INTO (public\.)?(inquiries|hlt_returns)', C.split('async handoff(')[0]), '')
ok('① 반품 초안 — 본인 주문에서 끝 4자리로 · 하나일 때만 · 전체 주문번호는 AI 결과에 없음',
   "WHERE account_id = $1 AND right(order_no, 4) = $2" in DS and 'orders.length !== 1' in DS
   and 'orderNo' not in DS.split("result: { ok: true, kind: 'HLT_RETURN'")[1].split('}')[0], '')
ok('① 상담 — 내 정보 조회 + 초안 스위치일 때만 · 한 질문 1개 · 대화와 한 거래로 저장 · 조회 기록에도 남김 · 글은 가림',
   "const draftsOn = lookupOn && (await this.setting('agent.chat.drafts.enabled')) === 'on';" in C and '!drafts.length' in C
   and 'INSERT INTO agent_drafts' in C and C.index('INSERT INTO agent_drafts') > C.index('await this.db.transaction(async () => {   // 상담')
   and 'this.drafter.prepare(u.name, u.input ?? {}, me!, redactChat)' in C and 'drafts: drafts.map((d) => d.card)' in C, '')
ok('① 지시문 — 초안은 접수 아님 · 접수됐다고 말하지 않음 · 분쟁 · 신고는 넘김 / 꺼짐이면 3단계 문장 그대로',
   'nothing is submitted, canceled, or decided' in C and 'Never say the request was submitted or accepted' in C and 'Disputes and reports are not drafted' in C
   and 'changing, canceling, or applying for anything (you can only read)' in C, '')
ok('① 시험 엔진 — 「초안」 낱말이면 초안 도구(받았을 때만)', "'draft_return'" in P_ and "'draft_inquiry'" in P_ and 'input.tools!.some((t) => t.name === name)' in P_, '')
D = rd('prisma/migrations/D135_agent_chat_drafts/migration.sql')
mig = sorted(x for x in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', x)))
ok('① D135 — agent_drafts(대화와 함께 지움 · 7일) · 조회 기록 도구 7개 · 스위치 꺼짐 · 지우는 문장 없음 · 173',
   'CREATE TABLE IF NOT EXISTS public.agent_drafts' in D and 'ON DELETE CASCADE' in D and "interval '7 days'" in D
   and "'draft_inquiry','draft_return'" in D and "('agent.chat.drafts.enabled', 'off'" in D and 'ON CONFLICT (key) DO NOTHING' in D
   and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE)\b', D) and (len(mig), mig[-1]) in ((173, 'D135_agent_chat_drafts'), (174, 'D136_mail_admin'), (175, 'D137_identity_nice'), (176, 'D138_alimtalk'), (177, 'D139_esign'), (178, 'D140_integ_tests'), (179, 'D141_safenum'), (180, 'D142_open_ready'), (181, 'D143_files_move'), (182, 'D144_open_date'), (183, 'D145_agent_privacy_gate'), (184, 'D146_switch_locks'), (185, 'D147_mail_lock'), (186, 'D148_alimtalk_etax_lock'), (187, 'D149_privacy_ai_ready')), f'{len(mig)} · {mig[-1]}')
CT = rd('src/modules/agent/agent.controller.ts')
ok('① 초안 읽기 API — 로그인 회원 · 본인 · 7일 · 제출 전 · 처음 열면 「열어 봄」',
   "@Get('me/agent/drafts/:id')" in CT and "@Roles('MEMBER'" in CT.split("@Get('me/agent/drafts/:id')")[1][:400]
   and 'account_id = $2 AND expires_at > now() AND submitted_at IS NULL' in DS and 'opened_at = coalesce(opened_at, now())' in DS, '')
PD = rd('src/modules/public/public.dto.ts'); HD = rd('src/modules/health/health-shop.dto.ts')
PS = rd('src/modules/public/public.service.ts'); HR = rd('src/modules/health/health-return.service.ts')
ok('① 신청 API — 선택 칸 agentDraftId · 접수 뒤 「제출됨」만(본인 · 같은 종류 · 한 번) · 판정 · 검사는 그대로',
   'agentDraftId?: string;' in PD and 'agentDraftId?: string;' in HD and "markSubmitted(input.agentDraftId, 'INQUIRY'" in PS
   and "markSubmitted(d.agentDraftId, 'HLT_RETURN'" in HR and HR.index('markSubmitted') > HR.index('fn_hlt_return_judge')
   and 'WHERE id = $1 AND account_id = $2 AND kind = $3 AND submitted_at IS NULL' in DS, '')
AC = rd('site/src/components/common/AiChat.tsx'); SN = rd('site/src/app/support/new/page.tsx'); RN = rd('site/src/app/my/health/returns/new/page.tsx')
IF = rd('site/src/components/InquiryForm.tsx'); RF = rd('site/src/components/health/ReturnForm.tsx')
ok('① 사용자 웹 — 상담 창 초안 카드(사이트 안 주소만) · 신청 화면이 초안으로 채움(반품은 같은 주문일 때만) · 제출은 지금 단추',
   'data-ai-draft={d.kind}' in AC and 'internal(d.href)' in AC and '/me/agent/drafts/' in SN and '/me/agent/drafts/' in RN
   and 'draft.fields.orderNo === no' in RN and 'data-ai-draft-filled' in IF and 'data-ai-draft-filled' in RF
   and 'agentDraftId: draft.id' in IF and 'agentDraftId: draft.id' in RF, '')
M = 'site/src/i18n/messages/'
J = lambda lang, ns: json.loads(rd(f'{M}{lang}/{ns}.json') or '{}')
keys = [('aiChat', 'draftInquiry'), ('aiChat', 'draftReturn'), ('aiChat', 'draftNote'), ('aiChat', 'draftOpen'), ('forms', 'inq.aiDraft'), ('order', 'ret.aiDraft')]
miss = [f'{lang}:{ns}.{k}' for lang in ('ko', 'en') for ns, k in keys if not get(J(lang, ns), k)]
ok('① 사전 — 새 문장 6개 ko · en', not miss, str(miss))
SW = rd('web/src/app/admin/ailearn/AgentSwitches.tsx'); STX = rd('web/src/app/admin/ailearn/AgentStatus.tsx')
ok('① 운영 화면 — 「AI 상담 — 신청서 초안」 스위치(켜기 전 확인) · 초안 · 엶 · 제출 수',
   "key: 'agent.chat.drafts.enabled'" in SW and 'docs/209' in SW and 'data-stat="drafts"' in STX and 'data-stat="drafts-submitted"' in STX, '')
ok('① 서버 안내 영어 — 「초안이 없습니다.」', '"초안이 없습니다."' in rd('src/common/i18n/server-text.en.ts'), '')
ok('① 판 v10.139 이상', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 139), rd('VERSION').strip())


def call(m, p, b=None, t=None, h=None):
    hd = {'content-type': 'application/json', **(h or {})}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m)
    try:
        return json.load(urllib.request.urlopen(r, timeout=120))
    except urllib.error.HTTPError as e:
        try: body = json.loads(e.read().decode('utf-8', 'replace'))
        except Exception: body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip()


def page(path, token):
    req = urllib.request.Request(SITE + path, headers={'Cookie': f'sgb_at={token}', 'User-Agent': 'test_v1139'})
    try: h = urllib.request.urlopen(req, timeout=120).read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e: h = e.read().decode('utf-8', 'replace')
    return re.sub(r'<script[\s\S]*?</script>', '', h)


BUYER = 'buyer@x.com'
if API and DB:
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': 'sgb-dev-1234'})['accessToken']
    BT = call('POST', '/auth/login', {'email': BUYER, 'password': 'sgb-dev-1234'})['accessToken']
    ST = call('POST', '/auth/login', {'email': 'seller@x.com', 'password': 'sgb-dev-1234'})['accessToken']
    BID = psql(f"SELECT id FROM accounts WHERE email = '{BUYER}'")
    prov = call('GET', '/admin/i18n/jobs?size=1', t=T_).get('provider')
    KEYS = ['agent.enabled', 'agent.chat.enabled', 'agent.chat.member_lookup.enabled', 'agent.chat.drafts.enabled', 'agent.monthly_cap_usd',
            'agent.member_daily_limit', 'agent.guest_daily_limit', 'agent.guest_daily_total', 'agent.guest_daily_per_ip']
    before = {k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'") for k in KEYS}
    Sx = lambda k, v: psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}';")
    HV = {'X-Visitor-Key': 'test1139-visitor-aaaa'}
    made_inq = []
    made_order = []   # 점검판 새 DB 에는 buyer 의 진행 주문이 없음 — 시험이 만들고 끝나면 지움
    clean = lambda: psql(f"DELETE FROM agent_conversations WHERE channel = 'SITE_CHAT' AND (guest_key LIKE 'test1139%' OR account_id = '{BID}'); "
                         f"DELETE FROM agent_chat_usage WHERE who IN ('A:{BID}', 'V:test1139-visitor-aaaa', 'G:ALL') OR who LIKE 'I:%';")
    count = lambda: psql(f"SELECT (SELECT count(*) FROM inquiries WHERE account_id = '{BID}') || '/' || "
                         f"(SELECT count(*) FROM hlt_returns r JOIN hlt_orders o ON o.id = r.order_id WHERE o.account_id = '{BID}')")
    try:
        clean()
        tail = psql(f"SELECT right(order_no, 4) FROM hlt_orders WHERE account_id = '{BID}' AND status NOT IN ('CANCELED','RETURNED') "
                    f"GROUP BY 1 HAVING count(*) = 1 ORDER BY 1 LIMIT 1")
        if not tail and psql("SELECT count(*) FROM hlt_orders WHERE right(order_no, 4) = 'Z7Q1'") == '0':
            made_order.append(psql(f"INSERT INTO hlt_orders (order_no, account_id, goods_amount, total, status) VALUES ('HTV1139Z7Q1', '{BID}', 10000, 10000, 'PAID') RETURNING id").splitlines()[0])
            tail = 'Z7Q1'
        order_no = psql(f"SELECT order_no FROM hlt_orders WHERE account_id = '{BID}' AND right(order_no, 4) = '{tail}' AND status NOT IN ('CANCELED','RETURNED')") if tail else ''
        none_tail = next((x for x in ('9Z9Z', 'Z0Z0', 'QQQQ') if psql(f"SELECT count(*) FROM hlt_orders WHERE account_id = '{BID}' AND right(order_no, 4) = '{x}'") == '0'), 'QQQQ')
        if prov != 'MOCK':
            ok('② API 가 시험 엔진(MOCK)으로 떠 있음 — 아니면 ② 건너뜀', False, f'provider={prov}')
        elif not tail:
            ok('② 시험 회원(buyer)에게 끝 4자리가 하나뿐인 진행 주문이 있음 — 아니면 ② 건너뜀', False, '')
        else:
            for k, v in (('agent.enabled', 'on'), ('agent.chat.enabled', 'on'), ('agent.monthly_cap_usd', '5'), ('agent.member_daily_limit', '50'),
                         ('agent.guest_daily_limit', '50'), ('agent.guest_daily_total', '300'), ('agent.guest_daily_per_ip', '300'),
                         ('agent.chat.member_lookup.enabled', 'on'), ('agent.chat.drafts.enabled', 'off')):
                Sx(k, v)
            n0 = count()
            Q_RET = f'주문 {tail} 취소 신청서 초안 만들어 주세요. 단순 변심이에요.'   # 시험 주문은 발송 전(PAID) — 취소
            r = call('POST', '/agent/chat', {'message': Q_RET}, t=BT)
            ok('② 초안 스위치 꺼짐 — 초안 없음(3단계 조회만)', r.get('drafts') == [] and psql(f"SELECT count(*) FROM agent_drafts WHERE account_id = '{BID}'") == '0', str(r)[:140])
            ra = call('PATCH', '/admin/site-settings', {'key': 'agent.chat.drafts.enabled', 'value': 'on'}, BT)
            ok('② 초안 스위치는 SUPER 만(일반 회원 403)', ra.get('_err') == 403, str(ra)[:80])
            rs = call('PATCH', '/admin/site-settings', {'key': 'agent.chat.drafts.enabled', 'value': 'on'}, T_)
            ok('② 초안 스위치 켜기(SUPER) · 상태 응답에 drafts', rs.get('value') == 'on' and get(call('GET', '/admin/agent/status', t=T_), 'switches.drafts') is True, str(rs)[:80])
            r = call('POST', '/agent/chat', {'message': Q_RET}, t=BT)
            d = (r.get('drafts') or [{}])[0]
            ok('② 반품 초안 — 카드 1개 · 본인 주문(끝 4자리로 찾음) · 신청 화면 주소', len(r.get('drafts') or []) == 1 and d.get('kind') == 'HLT_RETURN'
               and d.get('href', '').startswith('/my/health/returns/new?o=') and f'&draft={d.get("id")}' in d.get('href', '') and order_no in urllib.parse.unquote(d.get('href', '')), str(r)[:200])
            row = psql(f"SELECT kind || '|' || (fields->>'orderNo') || '|' || (fields->>'kind') || '|' || (fields->>'reason') FROM agent_drafts WHERE id = '{d.get('id')}'")
            ok('② 초안 줄 — 종류 · 주문 · 신청 종류 · 사유', row == f'HLT_RETURN|{order_no}|CANCEL|CHANGE_MIND', row)
            tc = psql(f"SELECT tool || ':' || rows_returned || ':' || array_to_string(fields, ',') FROM agent_tool_calls WHERE account_id = '{BID}' AND tool = 'draft_return'")
            ok('② 조회 기록에 초안 도구(전체 주문번호 칸 없음 · 끝 4자리만)', tc.startswith('draft_return:1:') and 'orderNo' not in tc and 'orderTail' in tc, tc)
            r2 = call('POST', '/agent/chat', {'message': f'주문 {none_tail} 교환 초안 부탁해요'}, t=BT)
            ok('② 없는 주문 끝 4자리 — 초안 없음(조회 기록 0건)', r2.get('drafts') == [] and psql(f"SELECT count(*) FROM agent_tool_calls WHERE account_id = '{BID}' AND tool = 'draft_return' AND rows_returned = 0") == '1', str(r2)[:120])
            r3 = call('POST', '/agent/chat', {'message': '정산 문의 초안 써 주세요. 소개비가 아직 안 들어왔어요.'}, t=BT)
            d3 = (r3.get('drafts') or [{}])[0]
            ok('② 문의 초안 — 카드 1개 · 유형 SETTLE · /support/new?draft=', d3.get('kind') == 'INQUIRY' and d3.get('href') == f'/support/new?draft={d3.get("id")}'
               and psql(f"SELECT fields->>'category' FROM agent_drafts WHERE id = '{d3.get('id')}'") == 'SETTLE', str(r3)[:160])
            g = call('POST', '/agent/chat', {'message': '문의 초안 써 주세요'}, h=HV)
            ok('② 비회원 — 초안 없음', g.get('drafts') == [] and g.get('answer', '').startswith('[시험 엔진]'), str(g)[:100])
            ok('② **AI 대화만으로는 접수 0건**(문의 · 반품 줄 수 그대로)', count() == n0, f'{n0} → {count()}')
            # 초안 읽기 — 본인만 · 처음 열면 「열어 봄」
            v = call('GET', f'/me/agent/drafts/{d3.get("id")}', t=BT)
            other = call('GET', f'/me/agent/drafts/{d3.get("id")}', t=ST)
            anon = call('GET', f'/me/agent/drafts/{d3.get("id")}')
            ok('② 초안 읽기 — 본인 200(칸) · 다른 회원 404 · 로그인 없음 401/403 · 「열어 봄」 적음',
               get(v, 'fields.category') == 'SETTLE' and other.get('_err') == 404 and anon.get('_err') in (401, 403)
               and psql(f"SELECT opened_at IS NOT NULL FROM agent_drafts WHERE id = '{d3.get('id')}'") == 't', f"{str(v)[:80]} · {other.get('_err')} · {anon.get('_err')}")
            # ⑤ 사용자 웹 — 신청 화면이 초안으로 채워짐(본인만)
            if SITE:
                h1 = page(f'/support/new?draft={d3.get("id")}', BT)
                h2 = page(f'/support/new?draft={d3.get("id")}', ST)
                ttl = get(v, 'fields.title') or ''
                ok('⑤ /support/new?draft= — 본인은 「AI 초안으로 채움」 띠 · 제목 채움 / 다른 회원은 빈 화면', 'data-ai-draft-filled' in h1 and ttl[:10] in h1
                   and 'data-ai-draft-filled' not in h2, f'제목 {ttl[:20]} · 본인 {"data-ai-draft-filled" in h1} · 남 {"data-ai-draft-filled" in h2}')
                h3 = page(d.get('href', ''), BT)
                form = 'hlt-ret32' in h3
                ok('⑤ /my/health/returns/new?o=&draft= — 신청 양식이 열리면 「AI 초안으로 채움」 띠(판정으로 막힌 주문이면 양식 없음 · 지금과 같음)',
                   ('data-ai-draft-filled' in h3) if form else ('data-ai-draft-filled' not in h3), f'양식 {form}')
            # 화면에서 제출 → 「제출됨」 · 판정은 그대로
            sub = call('POST', '/inquiries', {'category': 'SETTLE', 'title': get(v, 'fields.title') or '시험', 'body': get(v, 'fields.body') or '시험 문의입니다', 'agentDraftId': d3.get('id')}, t=BT)
            if sub.get('id'): made_inq.append(sub['id'])
            st = psql(f"SELECT (submitted_at IS NOT NULL)::text || '|' || coalesce(submitted_ref, '') FROM agent_drafts WHERE id = '{d3.get('id')}'")
            ok('② 화면에서 문의 제출(agentDraftId) — 접수 1건 · 초안 「제출됨」 · 접수 번호 · 제출 뒤 초안 읽기 404',
               bool(sub.get('id')) and st == f"true|{sub.get('id')}" and call('GET', f'/me/agent/drafts/{d3.get("id")}', t=BT).get('_err') == 404, f'{str(sub)[:80]} · {st}')
            spoof = call('POST', '/inquiries', {'category': 'ETC', 'title': '남의 초안', 'body': '남의 초안 번호로 낸 문의', 'agentDraftId': d.get('id')}, t=ST)
            if spoof.get('id'): made_inq.append(spoof['id'])
            ok('② 남의 초안 번호로 제출 — 접수는 되지만 그 초안은 「제출됨」이 아님', bool(spoof.get('id'))
               and psql(f"SELECT submitted_at IS NULL FROM agent_drafts WHERE id = '{d.get('id')}'") == 't', str(spoof)[:80])
            rr = call('POST', '/me/health/returns', {'orderNo': order_no, 'kind': 'CANCEL', 'reason': 'CHANGE_MIND', 'agentDraftId': d.get('id')}, t=BT)
            sub2 = psql(f"SELECT (submitted_at IS NOT NULL)::text FROM agent_drafts WHERE id = '{d.get('id')}'")
            ok('② 화면에서 반품 제출 — 판정은 지금 그대로(통과면 접수 · 「제출됨」 / 막히면 422 · 초안 그대로)',
               (bool(rr.get('id')) and sub2 == 'true') or (rr.get('_err') in (409, 422) and sub2 == 'false'), f"{str(rr)[:100]} · 제출됨 {sub2}")
            if rr.get('id'):
                psql(f"DELETE FROM hlt_returns WHERE id = '{rr['id']}';")
            # 7일 지난 초안 — 읽기 404 · 배치가 내용 비움
            r4 = call('POST', '/agent/chat', {'message': '계정 문의 초안 부탁해요. 로그인이 안 돼요.'}, t=BT)
            d4 = (r4.get('drafts') or [{}])[0].get('id')
            psql(f"UPDATE agent_drafts SET expires_at = now() - interval '1 minute' WHERE id = '{d4}';")
            gone = call('GET', f'/me/agent/drafts/{d4}', t=BT)
            job = call('POST', '/admin/jobs', {'job': 'agent_chat_purge'}, T_)
            ok('② 7일 지난 초안 — 읽기 404 · 배치 agent_chat_purge 가 내용만 비움(줄 · 숫자는 남음)', gone.get('_err') == 404
               and psql(f"SELECT fields = '{{}}'::jsonb FROM agent_drafts WHERE id = '{d4}'") == 't' and (get(job, 'detail.draftsCleared') or 0) >= 1, f"{gone.get('_err')} · {str(job)[:120]}")
            cid = psql(f"SELECT conversation_id FROM agent_drafts WHERE id = '{d3.get('id')}'")
            msgs = call('GET', f'/admin/agent/chats/{cid}', t=T_)
            ok('② 운영 화면 대화 — 「조회」 줄에 draft_inquiry · 1건', isinstance(msgs, list) and any(x['role'] == 'tool' and x['body'].startswith('draft_inquiry · 1건') for x in msgs),
               str([(x.get('role'), (x.get('body') or '')[:30]) for x in msgs] if isinstance(msgs, list) else msgs)[:200])
            stx = call('GET', '/admin/agent/chats/stats?days=7', t=T_)
            ok('② 「답 · 넘김 비율」에 초안 · 엶 · 제출 수 · 조회 수에는 초안 도구가 안 섞임', (stx.get('drafts') or 0) >= 3 and (stx.get('draftsOpened') or 0) >= 1
               and (stx.get('draftsSubmitted') or 0) >= 1 and (stx.get('lookups') or 0) == int(psql("SELECT count(*) FROM agent_tool_calls WHERE called_at >= now() - interval '7 days' AND tool LIKE 'my\\_%'") or 0),
               f"초안 {stx.get('drafts')} · 엶 {stx.get('draftsOpened')} · 제출 {stx.get('draftsSubmitted')} · 조회 {stx.get('lookups')}")
            # ③ 대화를 지우면 초안도
            psql(f"DELETE FROM agent_conversations WHERE id = '{cid}';")
            ok('③ 대화를 지우면 초안도 지워짐', psql(f"SELECT count(*) FROM agent_drafts WHERE conversation_id = '{cid}'") == '0', '')
    finally:
        for k, val in before.items():
            psql(f"UPDATE site_settings SET value = '{val}' WHERE key = '{k}';")
        for i in made_inq:
            psql(f"DELETE FROM inquiries WHERE id = '{i}';")
        for o in made_order:
            psql(f"DELETE FROM hlt_returns WHERE order_id = '{o}'; DELETE FROM hlt_orders WHERE id = '{o}';")
        clean()

# ── ④ 운영 화면(브라우저) ──────────────────────────────────────────────
if ADMIN_WEB:
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if sync_playwright:
        with sync_playwright() as p:
            b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1400, 'height': 1000})
            pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
            pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', 'sgb-dev-1234'); pg.click('button[type=submit]'); pg.wait_for_timeout(1500)
            pg.goto(ADMIN_WEB + '/#/ai-ops/agent', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
            row = pg.locator('[data-agent-switch="agent.chat.drafts.enabled"]')
            ok('④ 「AI 스위치」에 「AI 상담 — 신청서 초안」 줄 · 꺼짐 · 켜기 단추(SUPER)', row.count() == 1 and '신청서 초안' in row.inner_text() and '꺼짐' in row.inner_text()
               and row.locator('button', has_text='켜기').count() == 1, row.inner_text()[:80] if row.count() else '없음')
            ok('④ 「답 · 넘김 비율」에 신청서 초안 숫자', pg.locator('[data-stat="drafts"]').count() == 1, '')
            pg.screenshot(path=os.path.join(HERE, 'v1139_drafts.png'), full_page=False)
            b.close()

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
