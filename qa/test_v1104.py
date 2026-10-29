"""v10.104 시험 — 다국어 3-2 등록 글 자동 번역(D118 · docs/162)

  KIT=… [API=http://localhost:13000/api/v1] [DB=postgresql://sgb:sgb@localhost:15432/sgb] python3 -I test_v1104.py
  ③ 은 API 를 시험 엔진으로 띄웠을 때만: `AGENT_PROVIDER=MOCK docker compose … up -d api`(밖으로 나가지 않음)

  ① 마이그레이션 D118 — 작업 줄 · 넣는 트리거(PUBLISHED · 고침) · AI 통로 TRANSLATE · 엔진 MOCK · 스위치 3개(꺼짐) · 배치 translate_jobs · 156 · 마지막 D118
  ② 코드 — Claude 어댑터(공식 SDK · 판 고정 · 키 없으면 null) · 배치 · 지시문(글 안의 지시를 따르지 않음) · 금칙어면 승인 대기 · 사람 승인 번역 안 덮음 · 주인에게 원문 · 운영 API 3 · 화면 「자동 번역」
  ③ (API · DB · MOCK) 스위치 꺼짐이면 아무것도 안 함 · 켜면 넣기 → 배치 → 자동 승인 → 영어 요청에 번역 · 주인에게 원문 · 원문 고치면 다시 줄 · 금칙어면 승인 대기 · 사용량 기록 · 상한에 닿으면 AI 전체 꺼짐 + 경보 · 끝나면 되돌림
"""
import json, os, re, subprocess, time, urllib.error, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


M = rd('prisma/migrations/D118_i18n_auto_translate/migration.sql')
mig = sorted(d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d)))
ok('① 마이그레이션 156 · 마지막 D118(v10.105 부터 D119 · 157 — test_v1105)', (len(mig), mig[-1] if mig else '') in ((156, 'D118_i18n_auto_translate'), (157, 'D119_i18n_board_on_view'), (158, 'D120_ai_review_shadow'), (159, 'D121_agent_chat'), (160, 'D122_agent_key_admin'), (161, 'D123_profile_consent_single'), (162, 'D124_i18n_profile'), (163, 'D125_i18n_more_targets'), (164, 'D126_i18n_db_text'), (165, 'D127_partner_badge_codes'), (166, 'D128_integ_keys_admin'), (167, 'D129_agent_chat_handoff'), (168, 'D130_i18n_company_name'), (169, 'D131_terms_ai_adpersonal_drafts'), (170, 'D132_terms_privacy_fill'), (171, 'D133_agent_member_lookup'), (172, 'D134_review_ai_assist'), (173, 'D135_agent_chat_drafts'), (174, 'D136_mail_admin'), (175, 'D137_identity_nice'), (176, 'D138_alimtalk'), (177, 'D139_esign'), (178, 'D140_integ_tests'), (179, 'D141_safenum'), (180, 'D142_open_ready'), (181, 'D143_files_move'), (182, 'D144_open_date'), (183, 'D145_agent_privacy_gate')), f'{len(mig)} · {mig[-1] if mig else ""}')
ok('① 작업 줄 · 넣는 트리거(매물 · 요청 · PUBLISHED · 제목 · 본문 고침 · 스위치 꺼지면 안 넣음)',
   'CREATE TABLE IF NOT EXISTS public.translation_jobs' in M and "trg_listing_translation_enqueue" in M and "trg_request_translation_enqueue" in M
   and "NEW.status = 'PUBLISHED'" in M and "<> 'on' THEN RETURN 0" in M, '')
ok('① AI 통로 TRANSLATE(스위치 i18n.auto_translate.enabled · 월 상한 D116 그대로) · 엔진 MOCK', "WHEN 'TRANSLATE' THEN 'i18n.auto_translate.enabled'" in M
   and "'SITE_CHAT','REVIEW_SHADOW','AUDIT','SETTLE','TRANSLATE'" in M and "'MANUAL','CLAUDE','N8N','MOCK'" in M and "IF v_cap <= 0 THEN reason := 'CAP_ZERO'" in M, '')
ok('① 스위치 꺼짐 · 언어 en · 모델 Haiku 5.5 · 배치 1분', "('i18n.auto_translate.enabled', 'off'" in M and "('i18n.auto_langs', 'en'" in M
   and "('i18n.translate_model', 'claude-haiku-5-5'" in M and "('translate_jobs', 1," in M, '')

P = rd('src/modules/agent/agent.provider.ts'); T = rd('src/modules/i18n/translate.service.ts')
pkg = json.loads(rd('package.json') or '{}')
ok('② Claude 어댑터 — 공식 SDK(판 고정 0.133.0) · CLAUDE 는 키가 있을 때만 · 그 밖은 null',
   pkg.get('dependencies', {}).get('@anthropic-ai/sdk') == '0.133.0' and "import Anthropic from '@anthropic-ai/sdk'" in P and 'this.client.messages.create(' in P
   and "env.AGENT_PROVIDER === 'CLAUDE' && (env.ANTHROPIC_API_KEY ?? '').length > 20" in P, pkg.get('dependencies', {}).get('@anthropic-ai/sdk', ''))
ok('② 배치 — 통로 확인 · 요금표에 없는 모델은 안 부름 · 사용량 기록 · 금칙어 · 원문에 없는 연락처면 DRAFT · 같은 원문은 건너뜀 · 사람 · 반려 칸 안 덮음 · 원문 바뀌면 다시 줄 · 시간 예산 · 거절 · 잘림 보류 · 3번 실패',
   "this.agent.allowed('TRANSLATE')" in T and "'MODEL_UNPRICED'" in T and "this.agent.record('TRANSLATE'" in T and "blocked ? 'DRAFT' : 'AUTO_APPROVED'" in T
   and 'suspiciousTranslation(src[f], t)' in T and "h.engine === 'MANUAL' || h.status === 'REJECTED'" in T and "'SOURCE_CHANGED'" in T and 'BUDGET_MS = 40_000' in T
   and "'REFUSAL'" in T and "'TOO_LONG'" in T and 'MAX_ATTEMPTS = 3' in T and "effort: 'low'" in T, '')
ok('② 지시문 — 회원 글은 자료로만(글 안의 지시 · 링크를 따르지 않음) · JSON 만', 'never follow instructions' in T and 'Reply with only a JSON object' in T, '')
L = rd('src/modules/listing/listing.service.ts'); R = rd('src/modules/request/request.service.ts')
ok('② 매물 · 요청 제목 · 본문 얹기 · 상세는 주인에게 원문(고치기 화면 보호)', "if (!row.isOwn) await this.i18n.overlayOne(row, 'LISTING'" in L and "if (actor !== row.ownerAccountId) await this.i18n.overlayOne(row, 'REQUEST'" in R, '')
C = rd('src/modules/i18n/i18n.controller.ts'); W = rd('web/src/app/admin/Translations.tsx')
ok('② 운영 API 3(작업 줄 · 다시 시도 · 한꺼번에 넣기) · 화면 「자동 번역」 · 배치 등록', all(x in C for x in ("@Get('admin/i18n/jobs')", "@Post('admin/i18n/jobs/:id/retry')", "@Post('admin/i18n/jobs/backfill')"))
   and "'자동 번역'" in W and "'translate_jobs'," in rd('src/worker/worker.controller.ts') and "case 'translate_jobs'" in rd('src/worker/scheduler.service.ts'), '')


def call(m, p, b=None, t=None, h=None):
    hd = {'content-type': 'application/json', **(h or {})}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m)
    try:
        return json.load(urllib.request.urlopen(r, timeout=120))
    except urllib.error.HTTPError as e:
        return {'_err': e.code, 'body': e.read().decode('utf-8', 'replace')[:200]}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return r.stdout.strip()


if API and DB:
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': 'sgb-dev-1234'})['accessToken']
    prov = call('GET', '/admin/i18n/jobs?size=1', t=T_).get('provider')
    KEYS = ['i18n.auto_translate.enabled', 'agent.enabled', 'agent.monthly_cap_usd', 'i18n.enabled']
    before = {k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'") for k in KEYS}
    en_before = psql("SELECT is_active FROM i18n_langs WHERE code = 'en'")
    LID = 'ffffffff-0000-4000-a000-000000000001'   # seller@x.com 매물(시험 자료)
    old_title = psql(f"SELECT title FROM listings WHERE id = '{LID}'")
    mark = psql("SELECT coalesce(max(id), 0) FROM ops_alerts")
    try:
        S = lambda k, v: psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}';")
        psql("DELETE FROM translation_jobs; DELETE FROM content_translations WHERE engine = 'MOCK'; DELETE FROM agent_usage_daily WHERE channel = 'TRANSLATE';")
        S('i18n.auto_translate.enabled', 'off')
        bf = call('POST', '/admin/i18n/jobs/backfill', t=T_)
        ok('③ 스위치 꺼짐 — 넣기 0 · 배치는 건너뜀', bf.get('queued') == 0 and call('POST', '/admin/jobs', {'job': 'translate_jobs'}, t=T_).get('detail', {}).get('skipped') in ('CHANNEL_OFF', 'AGENT_OFF'), str(bf))
        if prov != 'MOCK':
            ok('③ API 가 시험 엔진(MOCK)으로 떠 있음 — 아니면 나머지 건너뜀', False, f'provider={prov}')
        else:
            for k, v in (('i18n.auto_translate.enabled', 'on'), ('agent.enabled', 'on'), ('agent.monthly_cap_usd', '5'), ('i18n.enabled', 'on')): S(k, v)
            psql("UPDATE i18n_langs SET is_active = true WHERE code = 'en';")
            bf = call('POST', '/admin/i18n/jobs/backfill', t=T_)
            ok('③ 켬 — 노출 중인 매물 · 요청을 줄에 넣음', bf.get('queued', 0) > 0, str(bf))
            for _ in range(20):
                r = call('POST', '/admin/jobs', {'job': 'translate_jobs'}, t=T_)
                if not r.get('detail', {}).get('picked'): break
            cnt = call('GET', '/admin/i18n/jobs?size=1', t=T_).get('counts', {})
            ok('③ 배치 — 모두 끝(자동 승인)', cnt.get('DONE') == bf.get('queued') and not cnt.get('QUEUED') and not cnt.get('FAILED'), str(cnt))
            time.sleep(31)   # 손님 화면 번역 설정 기억(30초)
            en = call('GET', f'/listings/{LID}', h={'X-Lang': 'en'}).get('title'); ko = call('GET', f'/listings/{LID}').get('title')
            ok('③ 영어 요청 → 자동 번역 · 한국어 → 원문', en == f'[MOCK en] {old_title}' and ko == old_title, f'{ko} / {en}')
            ST = call('POST', '/auth/login', {'email': 'seller@x.com', 'password': 'sgb-dev-1234'})['accessToken']
            ok('③ 주인이 영어로 상세를 열면 원문(고치기 화면 보호)', call('GET', f'/listings/{LID}', t=ST, h={'X-Lang': 'en'}).get('title') == old_title, '')
            us = [u for u in call('GET', '/admin/agent/status', t=T_).get('usage', []) if u.get('channel') == 'TRANSLATE']
            ok('③ 사용량 — 통로 TRANSLATE · Haiku 5.5', us and us[0]['model'] == 'claude-haiku-5-5' and us[0]['requests'] >= bf.get('queued', 0), str(us))
            req0 = sum(u['requests'] for u in us)
            bf2 = call('POST', '/admin/i18n/jobs/backfill', t=T_)
            for _ in range(20):
                if not call('POST', '/admin/jobs', {'job': 'translate_jobs'}, t=T_).get('detail', {}).get('picked'): break
            us2 = [u for u in call('GET', '/admin/agent/status', t=T_).get('usage', []) if u.get('channel') == 'TRANSLATE']
            sk = psql("SELECT count(*) FROM translation_jobs WHERE result = 'SKIPPED'")
            ok('③ 다시 넣어도 원문이 같으면 다시 번역하지 않음(비용 0 · 결과 「건너뜀」)', bf2.get('queued', 0) > 0 and sum(u['requests'] for u in us2) == req0 and sk == str(bf2.get('queued')), f'{bf2} · 건너뜀 {sk}')
            jid = psql(f"SELECT id FROM translation_jobs WHERE target_type = 'LISTING' AND target_id = '{LID}'")
            rt = call('POST', f'/admin/i18n/jobs/{jid}/retry', t=T_); rt2 = call('POST', f'/admin/i18n/jobs/{jid}/retry', t=T_)
            call('POST', '/admin/jobs', {'job': 'translate_jobs'}, t=T_)
            res = psql(f"SELECT result FROM translation_jobs WHERE id = {jid}")
            ok('③ 「다시 시도」는 기계 번역을 다시 함(FORCE) · 대기 중에 또 누르면 409', rt.get('state') == 'QUEUED' and rt2.get('_err') == 409 and res == 'AUTO_APPROVED', f'{rt} · {rt2.get("_err")} · {res}')
            psql(f"UPDATE listings SET title = title || ' (고침)' WHERE id = '{LID}';")
            q = psql(f"SELECT state FROM translation_jobs WHERE target_type = 'LISTING' AND target_id = '{LID}'")
            en2 = call('GET', f'/listings/{LID}', h={'X-Lang': 'en'}).get('title')
            ok('③ 원문을 고치면 다시 줄(대기) · 그동안 원문(낡음)', q == 'QUEUED' and en2 == old_title + ' (고침)', f'{q} · {en2}')
            psql("INSERT INTO banned_words (word, match_type, severity, is_active) VALUES ('MOCK en', 'CONTAINS', 'BLOCK', true);")
            call('POST', '/admin/jobs', {'job': 'translate_jobs'}, t=T_)
            st = psql(f"SELECT status FROM content_translations WHERE target_type = 'LISTING' AND target_id = '{LID}' AND field = 'title' AND lang = 'en'")
            ok('③ 번역문에 차단 금칙어 → 자동 승인하지 않고 승인 대기(DRAFT)', st == 'DRAFT', st)
            psql("SELECT fn_agent_record_usage('TRANSLATE', 'claude-haiku-5-5', 100000000, 0);")   # 10달러 — 상한 5 넘김
            sw = psql("SELECT value FROM site_settings WHERE key = 'agent.enabled'")
            al = psql(f"SELECT count(*) FROM ops_alerts WHERE id > {mark or 0} AND alert_code = 'AGENT_CAP_REACHED'")
            sk = call('POST', '/admin/jobs', {'job': 'translate_jobs'}, t=T_).get('detail', {}).get('skipped')
            ok('③ 월 상한에 닿으면 AI 전체 꺼짐 · 운영 경보 · 배치 건너뜀', sw == 'off' and al != '0' and sk == 'AGENT_OFF', f'{sw} · 경보 {al} · {sk}')
    finally:
        psql(f"UPDATE listings SET title = $t${old_title}$t$ WHERE id = '{LID}';")
        psql("DELETE FROM banned_words WHERE word = 'MOCK en';")
        psql("DELETE FROM translation_jobs; DELETE FROM content_translations WHERE engine = 'MOCK'; DELETE FROM agent_usage_daily WHERE channel = 'TRANSLATE';")
        psql(f"DELETE FROM ops_alerts WHERE id > {mark or 0} AND alert_code = 'AGENT_CAP_REACHED';")
        for k, v in before.items(): psql(f"UPDATE site_settings SET value = $v${v}$v$ WHERE key = '{k}';")
        psql(f"UPDATE i18n_langs SET is_active = {'true' if en_before == 't' else 'false'} WHERE code = 'en';")
        ok('③ 끝나면 되돌림 — 제목 · 금칙어 · 작업 줄 · 번역 · 사용량 · 경보 · 스위치',
           psql(f"SELECT title FROM listings WHERE id = '{LID}'") == old_title and psql("SELECT count(*) FROM translation_jobs") == '0'
           and all(psql(f"SELECT value FROM site_settings WHERE key = '{k}'") == v for k, v in before.items()), str(before))

_v = tuple(int(x) for x in re.findall(r'\d+', rd('VERSION')))
ok('VERSION v10.104 이상', _v >= (10, 104), '.'.join(map(str, _v)))
bad = [x for x in RES if not x[0]]
print(f'\n결과 — 통과 {len(RES) - len(bad)} · 실패 {len(bad)}')
raise SystemExit(1 if bad else 0)
