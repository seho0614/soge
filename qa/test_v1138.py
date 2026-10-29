"""v10.138 시험 — AI 검수 보조 2단계 「가안」(D134 · docs/206 · 설계 docs/196 2-2)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1138.py

  ① 코드 — 정렬(sort=ai) · 「AI 의견과 같게 확인」(aiAgreed · AI 의견과 같을 때만 · 아니면 422) · ai_referenced · 감사 표시
     · 반려 사유 미리 채움 + 확인 표시 전에는 반려 단추 잠김 · 관별 일치율 · D134 · 172 · 서버 안내 영어 · 판
  ② (API) AI 의견 순 정렬 · 다른 결정에 aiAgreed 422 · AI 승인 제안과 같게 승인 → 사람 결정 + ai_referenced + 감사 · 반려 제안 그대로 반려
     · 관별 일치율에 참고 결정 수 · 운영 권한 그대로 — 시험이 만든 검수 건은 지움
  ④ (운영 화면) 정렬 단추 · AI 승인 제안 줄에만 「AI 의견과 같게 확인」 · 상세에서 반려 사유 미리 채움 · 확인 전 반려 잠김
"""
import json, os, re, subprocess, urllib.error, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


# ── ① 코드 ─────────────────────────────────────────────────────────────
DTO = rd('src/modules/review/review.dto.ts'); SV = rd('src/modules/review/review.service.ts'); RP = rd('src/modules/review/review.repository.ts')
ok('① 정렬 sort=ai — 승인 · 사유 없음 → 승인 → 모름 → 반려 → 의견 없음 · 같은 칸은 SLA 순 · 대기 건만 · 200건',
   "@IsIn(['sla', 'ai'])" in DTO and "WHEN 'UNSURE' THEN 2 WHEN 'REJECT' THEN 3 ELSE 4 END, ri.sla_due_at ASC" in RP
   and "const byAi = sort === 'ai' && status !== 'REJECTED';" in SV and 'byAi ? 200 : 50' in SV, '')
ok('① 「AI 의견과 같게 확인」 — AI 최근 의견과 같은 결정일 때만(아니면 422 AI_NOT_MATCH) · ai_referenced · 감사 aiReferenced · 결정자는 사람',
   'aiAgreed?: boolean;' in DTO and "code: 'AI_NOT_MATCH'" in SV and 'ai_referenced = $6' in RP and 'aiReferenced: aiAgreed' in SV
   and 'decision_by = $3' in RP, '')
Q = rd('web/src/app/admin/ReviewQueue.tsx'); DC = rd('web/src/app/admin/ReviewDecide.tsx')
ok('① 검수 대기 — 정렬 단추(SLA 순 · AI 의견 순) · AI 승인 제안 줄에만 「AI 의견과 같게 확인」(확인 창)',
   'data-rq-sort="ai"' in Q and "it.aiSuggestion === 'APPROVE'" in Q and 'data-ai-agree={it.id}' in Q and "qs.set('sort', 'ai')" in Q and 'window.confirm(' in Q, '')
ok('① 검수 상세 — AI 반려 제안이면 사유 코드만 미리 채움 · 「사유를 확인했습니다」 전에는 반려 잠김 · AI 승인 제안이면 같게 확인 단추',
   'data-ai-reason-confirm' in DC and '(aiReject && !aiConfirm)' in DC and "decide('REJECTED', aiReject)" in DC and 'data-ai-agree-detail' in DC
   and "decide('APPROVED', true)" in DC, '')
AS = rd('src/modules/agent/agent.service.ts'); ST = rd('web/src/app/admin/ailearn/AgentStatus.tsx')
ok('① 관별 일치율(v_ai_review_agreement_gwan) — 상태 응답 · 운영 화면 표', 'v_ai_review_agreement_gwan' in AS and 'agreementByGwan' in AS and 'data-agent-agreement-gwan' in ST, '')
D = rd('prisma/migrations/D134_review_ai_assist/migration.sql')
mig = sorted(x for x in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', x)))
ok('① D134 — ai_referenced 칸(기본 false) · 관별 일치율 보기 · 지우는 문장 없음 · 172',
   'ADD COLUMN IF NOT EXISTS ai_referenced boolean NOT NULL DEFAULT false' in D and 'CREATE OR REPLACE VIEW public.v_ai_review_agreement_gwan' in D
   and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE)\b', D) and (len(mig), mig[-1]) in ((172, 'D134_review_ai_assist'), (173, 'D135_agent_chat_drafts'), (174, 'D136_mail_admin'), (175, 'D137_identity_nice'), (176, 'D138_alimtalk'), (177, 'D139_esign'), (178, 'D140_integ_tests'), (179, 'D141_safenum'), (180, 'D142_open_ready')), f'{len(mig)} · {mig[-1]}')
ok('① 자동 승인 없음 — AI 가 결정하는 길이 없음(#7 · #15)', "SET status = 'APPROVED'" not in rd('src/modules/agent/review-shadow.service.ts')
   and 'decision_mode' not in D, '')
ok('① 서버 안내 영어(AI_NOT_MATCH)', '"AI 의견과 다른 결정입니다 — 「AI 의견과 같게 확인」 없이 결정해 주십시오.":' in rd('src/common/i18n/server-text.en.ts'), '')
ok('① 판 v10.138 이상', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 138), rd('VERSION').strip())


def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m)
    try:
        return json.load(urllib.request.urlopen(r, timeout=60))
    except urllib.error.HTTPError as e:
        try: body = json.loads(e.read().decode('utf-8', 'replace'))
        except Exception: body = {}
        return {'_err': e.code, 'code': body.get('code') or (body.get('error') or {}).get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip()


def make_items():
    """시험용 검수 건 5개(사업자 확인 · 없는 대상 — 승인해도 바뀌는 자료 없음) + AI 의견. 순서: 반려 · 모름 · 승인(사유 있음) · 승인 · 의견 없음"""
    rc = psql("SELECT code FROM review_reason_codes WHERE is_active AND category NOT IN ('BANNED','RESTRICTED') ORDER BY sort_order LIMIT 1") \
        or psql("SELECT code FROM review_reason_codes WHERE is_active ORDER BY sort_order LIMIT 1")
    ids = psql("""WITH s AS (SELECT id FROM accounts WHERE email = 'seller@x.com')
                  INSERT INTO review_items (target_type, target_id, gwan_code, submitted_by, sla_due_at)
                  SELECT 'BUSINESS', gen_random_uuid(), 'MNY', s.id, now() + make_interval(hours => g) FROM s, generate_series(1, 5) g
                  RETURNING id""").splitlines()
    plan = [('REJECT', [rc]), ('UNSURE', None), ('APPROVE', [rc]), ('APPROVE', None), (None, None)]
    for i, (sug, codes) in zip(ids, plan):
        if sug:
            arr = "ARRAY['" + "','".join(codes) + "']" if codes else 'NULL'
            psql(f"INSERT INTO ai_review_opinions (review_item_id, suggestion, reason_codes, note, model, engine) VALUES ('{i}', '{sug}', {arr}, '시험 1138', 'claude-haiku-5-5', 'MOCK')")
    return ids, rc


def drop_items(ids):
    if not ids: return
    L = ','.join(f"'{i}'" for i in ids)
    psql(f"DELETE FROM ai_review_opinions WHERE review_item_id IN ({L}); DELETE FROM review_events WHERE review_item_id IN ({L}); DELETE FROM review_items WHERE id IN ({L});")


if API and DB:
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': 'sgb-dev-1234'})['accessToken']
    TB = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': 'sgb-dev-1234'}).get('accessToken')
    ids, rc = [], ''
    try:
        ids, rc = make_items()
        ok('② 시험 검수 건 5개 · AI 의견 4개 만듦(자동 승인으로 빠지지 않음)', len(ids) == 5
           and psql(f"SELECT count(*) FROM review_items WHERE id IN ({','.join(repr(i) for i in ids)}) AND status IN ('QUEUED','IN_PROGRESS')") == '5', f'{len(ids)} · 사유 {rc}')
        q = call('GET', '/admin/reviews?sort=ai&gwanCode=MNY', t=T_)
        mine = [x['id'] for x in q.get('items', []) if x['id'] in ids]
        want = [ids[3], ids[2], ids[1], ids[0], ids[4]]
        ok('② AI 의견 순 — 승인(사유 없음) → 승인(사유 있음) → 모름 → 반려 → 의견 없음 · 다음 쪽 없음', mine == want and q.get('nextCursor') is None,
           f'{[ids.index(x) for x in mine]}')
        q2 = call('GET', '/admin/reviews?gwanCode=MNY', t=T_)
        mine2 = [x['id'] for x in q2.get('items', []) if x['id'] in ids]
        ok('② 기본은 지금처럼 SLA 순', mine2 == ids, f'{[ids.index(x) for x in mine2]}')
        bad = call('PATCH', f'/admin/reviews/{ids[0]}', {'decision': 'APPROVED', 'aiAgreed': True}, T_)
        none = call('PATCH', f'/admin/reviews/{ids[4]}', {'decision': 'APPROVED', 'aiAgreed': True}, T_)
        ok('② AI 의견과 다른 결정 · 의견 없는 건에 「같게 확인」 → 422 AI_NOT_MATCH(처리 안 됨)', bad.get('_err') == 422 and none.get('_err') == 422
           and psql(f"SELECT count(*) FROM review_items WHERE id IN ('{ids[0]}','{ids[4]}') AND status IN ('QUEUED','IN_PROGRESS')") == '2', f"{bad.get('_err')} {bad.get('code')} · {none.get('_err')}")
        ob = call('PATCH', f'/admin/reviews/{ids[3]}', {'decision': 'APPROVED', 'aiAgreed': True}, TB)
        ok('② 일반 회원은 검수 못 함(403 · 권한 그대로)', ob.get('_err') == 403, str(ob)[:80])
        mark = psql("SELECT coalesce(max(occurred_at), '-infinity')::text FROM audit.audit_logs")
        a = call('PATCH', f'/admin/reviews/{ids[3]}', {'decision': 'APPROVED', 'aiAgreed': True}, T_)
        row = psql(f"SELECT status || ':' || ai_referenced || ':' || (decision_by = (SELECT id FROM accounts WHERE email = 'admin@x.com'))::text FROM review_items WHERE id = '{ids[3]}'")
        aud = psql(f"SELECT after_data->>'aiReferenced' FROM audit.audit_logs WHERE occurred_at > '{mark}' AND action = 'REVIEW_APPROVED' AND target_type = 'BUSINESS' ORDER BY occurred_at DESC LIMIT 1")
        ok('② AI 승인 제안과 같게 확인 → 사람(admin) 승인 · ai_referenced true · 감사 aiReferenced true', not a.get('_err') and row == 'APPROVED:true:true' and aud == 'true', f'{row} · 감사 {aud}')
        p = call('PATCH', f'/admin/reviews/{ids[1]}', {'decision': 'APPROVED'}, T_)
        ok('② 보통 승인은 ai_referenced false(지금과 같음)', not p.get('_err') and psql(f"SELECT ai_referenced FROM review_items WHERE id = '{ids[1]}'") == 'f', '')
        nr = call('PATCH', f'/admin/reviews/{ids[0]}', {'decision': 'REJECTED', 'aiAgreed': True}, T_)
        ok('② 반려는 사유 없이 안 됨(AI 의견과 같아도)', nr.get('_err') in (400, 409, 422) and psql(f"SELECT status FROM review_items WHERE id = '{ids[0]}'") in ('QUEUED', 'IN_PROGRESS'), str(nr.get('_err')))
        rj = call('PATCH', f'/admin/reviews/{ids[0]}', {'decision': 'REJECTED', 'reasonCode': rc, 'aiAgreed': True}, T_)
        ok('② AI 반려 제안 사유 그대로 반려(검수자) → ai_referenced true', not rj.get('_err') and psql(f"SELECT status || ':' || ai_referenced FROM review_items WHERE id = '{ids[0]}'") == 'REJECTED:true', str(rj)[:80])
        st = call('GET', '/admin/agent/status', t=T_)
        g = [x for x in st.get('agreementByGwan', []) if x.get('gwanCode') == 'MNY']
        ok('② 관별 일치율 — MNY 줄에 사람 결정 · 일치 · AI 의견 참고 결정 수', g and g[0]['decided'] >= 3 and g[0]['agreed'] >= 2 and g[0]['referenced'] >= 2, str(g)[:160])
    finally:
        drop_items(ids)

# ── ④ 운영 화면 ────────────────────────────────────────────────────────
if ADMIN_WEB and API and DB:
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if sync_playwright:
        ids = []
        try:
            ids, rc = make_items()
            with sync_playwright() as p:
                b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1400, 'height': 1000}); pg.on('dialog', lambda d: d.accept())
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', 'sgb-dev-1234'); pg.click('button[type=submit]'); pg.wait_for_timeout(1500)
                pg.goto(ADMIN_WEB + '/#/queue', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                if pg.locator('[data-rq-gwan="MNY"]').count(): pg.locator('[data-rq-gwan="MNY"]').first.click(); pg.wait_for_timeout(1500)
                srt = pg.locator('[data-rq-sort="ai"]')
                ok('④ 정렬 단추(AI 의견 순)', srt.count() == 1, str(srt.count()))
                if srt.count(): srt.click(); pg.wait_for_timeout(2000)
                order = pg.locator('[data-review]').evaluate_all('els => els.map(e => e.getAttribute("data-review"))')
                mine = [x for x in order if x in ids]
                ok('④ AI 의견 순으로 줄이 바뀜', mine[:2] == [ids[3], ids[2]], f'{[ids.index(x) for x in mine]}')
                agree = [x for x in ids if pg.locator(f'[data-ai-agree="{x}"]').count()]
                ok('④ 「AI 의견과 같게 확인」은 AI 승인 제안 줄에만', set(agree) == {ids[2], ids[3]}, f'{[ids.index(x) for x in agree]}')
                pg.screenshot(path=os.path.join(HERE, 'v1138_review_ai_sort.png'), full_page=False)
                pg.locator(f'[data-review="{ids[0]}"]').first.click(); pg.wait_for_timeout(2500)
                filled = pg.locator(f'[data-ai-reason-filled="{rc}"]').count() == 1
                rej = pg.locator('button.btn-no', has_text='반려')
                locked = rej.count() == 1 and rej.is_disabled()
                if pg.locator('[data-ai-reason-confirm]').count(): pg.locator('[data-ai-reason-confirm]').check(); pg.wait_for_timeout(300)
                ok('④ 상세 — AI 반려 사유 미리 채움 · 확인 표시 전 반려 잠김 → 표시하면 풀림', filled and locked and rej.is_enabled(), f'채움 {filled} · 잠김 {locked}')
                pg.screenshot(path=os.path.join(HERE, 'v1138_review_ai_reason.png'), full_page=False)
                b.close()
        finally:
            drop_items(ids)

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
