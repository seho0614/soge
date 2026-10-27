"""AI 에이전트 기능 점검(인계 메모 4절 15 · 점검 1 ~ 10) — 운영 화면 「AI 스위치」(v10.129)로 켜는 실제 순서대로 끝까지

  점검판 전용 · API 를 시험 엔진(AGENT_PROVIDER=MOCK)으로 띄운 뒤(밖으로 나가지 않음 · 비용 0):
  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 ai_agent_check.py

  0 처음 — 모두 꺼짐 · 통로마다 「전체 꺼짐」 · 손님 화면 AI 상담 없음
  1 · 2 AI 키 칸 · 키 확인(시험 엔진은 밖으로 안 나감) · 엔진 표시
  3 상한 · 전체 · 기능을 「AI 스위치」 화면에서 켬(최고 관리자 · 확인 창)
  4 등록 글 자동 번역 · 5 소개광장 볼 때 번역 · 6 AI 검수 보조(의견만) · 7 AI 상담 — 각각 실제로 부르고 사용량이 쌓임
  8 월 상한에 닿으면 전체 꺼짐 · 경보 · 그대로 다시 켜기는 막힘 → 상한을 올리면 켜짐
  9 모두 끄기 → 손님 화면 단추 사라짐 · 부르지 않음
  10 처리방침 · 고지 — 사람이 확인(여기서는 안내만)
  끝나면 설정 · 언어를 처음대로 되돌림
"""
import json, os, subprocess, time, urllib.error, urllib.request

API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
EN = {'X-Lang': 'en'}


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def call(m, p, b=None, t=None, h=None):
    hd = {'content-type': 'application/json', **(h or {})}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m)
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


KEYS = ('agent.enabled', 'agent.monthly_cap_usd', 'agent.chat.enabled', 'agent.review_shadow.enabled', 'i18n.auto_translate.enabled', 'i18n.board_on_view', 'i18n.enabled')
was = {k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'") for k in KEYS}
en_was = psql("SELECT is_active FROM i18n_langs WHERE code = 'en'")
mark_alert = psql("SELECT coalesce(max(id), 0) FROM ops_alerts") or '0'
T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': 'sgb-dev-1234'})['accessToken']
st = call('GET', '/admin/agent/status', t=T_)
if st.get('keySource') != 'MOCK':
    print('!! API 가 시험 엔진(MOCK)이 아닙니다 — AGENT_PROVIDER=MOCK 로 띄운 뒤 다시(실제 키로 부르지 않으려고 멈춤)'); raise SystemExit(2)

try:
    # 0 처음 — 모두 꺼짐
    for k in KEYS[:-1]: psql(f"UPDATE site_settings SET value = '{'0' if k == 'agent.monthly_cap_usd' else 'off'}' WHERE key = '{k}';")
    psql("UPDATE site_settings SET value = 'on' WHERE key = 'i18n.enabled'; UPDATE i18n_langs SET is_active = true WHERE code = 'en';")   # 4 · 5 는 영어 화면이 있어야 보임
    psql("DELETE FROM agent_usage_daily WHERE day = current_date;")
    st = call('GET', '/admin/agent/status', t=T_)
    ok('0 처음 — 전체 꺼짐 · 통로 모두 「부를 수 없음」 · 손님 화면 AI 상담 없음',
       st.get('enabled') is False and all(not c['ok'] for c in st.get('channels', [])) and call('GET', '/agent/chat/status').get('enabled') is False, str([c['reason'] for c in st.get('channels', [])]))

    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 1400, 'height': 1100}); pg.on('dialog', lambda d: d.accept())
        pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
        pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', 'sgb-dev-1234'); pg.click('button[type=submit]'); pg.wait_for_timeout(1500)

        def agent_page():
            # 같은 주소(# 뒤만 같음)로 goto 하면 다시 읽지 않아 옛 상태가 보임 — 새로 읽기
            if '#/ai-ops/agent' in pg.url: pg.reload(wait_until='networkidle', timeout=120000)
            else: pg.goto(ADMIN_WEB + '/#/ai-ops/agent', wait_until='networkidle', timeout=120000)
            pg.wait_for_timeout(2000)
            return pg.locator('[data-agent-switches]')

        box = agent_page()
        # 1 · 2 키 · 엔진
        key = pg.locator('[data-agent-key]')
        ok('1 「AI 키」 칸이 있음(최고 관리자)', key.count() == 1, '')
        kt = call('POST', '/admin/agent/key/test', t=T_)
        ok('1 키 확인 — 시험 엔진은 밖으로 나가지 않음(운영에서는 「키 확인 성공 — 모델 N개」)', kt.get('ok') is True and 'MOCK' in (kt.get('message') or ''), kt.get('message', '')[:60])
        ok('2 엔진 표시', 'MOCK' in pg.locator('[data-agent-engine]').inner_text(), pg.locator('[data-agent-engine]').inner_text()[:40])

        # 3 화면에서 켜기 — 상한 → 전체 → 기능 4개
        def flip(k):
            box.locator(f'[data-agent-switch="{k}"] button').click(); pg.wait_for_timeout(1500)
        cap = box.locator('[data-agent-cap]'); cap.locator('input').fill('5'); cap.locator('button', has_text='저장').click(); pg.wait_for_timeout(1500)
        flip('agent.enabled')
        for k in ('i18n.auto_translate.enabled', 'i18n.board_on_view', 'agent.review_shadow.enabled', 'agent.chat.enabled'): flip(k)
        now = {k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'") for k in KEYS[:-1]}
        ok('3 「AI 스위치」 화면에서 상한 $5 · 전체 · 기능 4개 켬', now == {'agent.enabled': 'on', 'agent.monthly_cap_usd': '5', 'agent.chat.enabled': 'on',
           'agent.review_shadow.enabled': 'on', 'i18n.auto_translate.enabled': 'on', 'i18n.board_on_view': 'on'}, str(now))
        st = call('GET', '/admin/agent/status', t=T_)
        ok('3 통로 「부를 수 있음」', all(c['ok'] for c in st.get('channels', []) if c['channel'] in ('REVIEW_SHADOW', 'SITE_CHAT')), str([(c['channel'], c['ok']) for c in st.get('channels', [])]))

        # 4 등록 글 자동 번역
        psql("DELETE FROM translation_jobs; DELETE FROM content_translations WHERE engine = 'MOCK';")
        bf = call('POST', '/admin/i18n/jobs/backfill', t=T_)
        for _ in range(20):
            if not call('POST', '/admin/jobs', {'job': 'translate_jobs'}, t=T_).get('detail', {}).get('picked'): break
        cnt = call('GET', '/admin/i18n/jobs?size=1', t=T_).get('counts', {})
        ok('4 등록 글 자동 번역 — 노출 중인 글을 줄에 넣고 모두 번역', bf.get('queued', 0) > 0 and cnt.get('DONE') == bf.get('queued') and not cnt.get('FAILED'), f'{bf} · {cnt}')

        # 5 소개광장 볼 때 번역
        pid = psql("SELECT id FROM posts WHERE state = 'PUBLISHED' ORDER BY created_at DESC LIMIT 1")
        r5 = call('POST', f'/community/posts/{pid}/translate', h={**EN, 'X-Visitor-Key': 'aicheck-visitor-0001'})
        g5 = call('GET', f'/community/posts/{pid}', h=EN)
        ok('5 소개광장 볼 때 번역 — 「번역 보기」를 누르면 영어', pid and r5.get('_err') is None and '[MOCK en]' in (g5.get('title') or ''), f"{r5.get('_err') or 'ok'} · {str(g5.get('title'))[:40]}")

        # 6 AI 검수 보조
        rid = psql("""SELECT id FROM review_items WHERE status IN ('QUEUED','IN_PROGRESS') AND target_type IN ('LISTING','REQUEST')
                       ORDER BY sla_due_at, id LIMIT 1""")
        for _ in range(10):
            if not call('POST', '/admin/jobs', {'job': 'review_shadow'}, t=T_).get('detail', {}).get('picked'): break
        op = psql(f"SELECT count(*) FROM ai_review_opinions WHERE review_item_id = '{rid}'") if rid else ''
        st6 = psql(f"SELECT status FROM review_items WHERE id = '{rid}'") if rid else ''
        ok('6 AI 검수 보조 — 의견만 붙고 검수 상태는 그대로(사람이 결정)', (not rid) or (op not in ('', '0') and st6 in ('QUEUED', 'IN_PROGRESS')), f'검수 대기 {rid or "없음"} · 의견 {op} · 상태 {st6}')

        # 7 AI 상담
        cs = call('GET', '/agent/chat/status', h={'X-Visitor-Key': 'aicheck-visitor-0001'})
        a7 = call('POST', '/agent/chat', {'message': '소개비는 언제 받나요?'}, h={'X-Visitor-Key': 'aicheck-visitor-0001'})
        chats = call('GET', '/admin/agent/chats', t=T_)
        ok('7 AI 상담 — 손님 화면에 켜짐 · 답이 옴 · 운영 화면 상담 목록에 남음', cs.get('enabled') is True and a7.get('_err') is None and bool(chats if isinstance(chats, list) else (chats.get('items') or chats.get('total'))),
           f"켜짐 {cs.get('enabled')} · {str(a7)[:60]}")
        us = {u['channel'] for u in call('GET', '/admin/agent/status', t=T_).get('usage', [])}
        # 검수 보조는 시험 엔진이면 AI 를 부르지 않고 「[시험 엔진] 의견 없음」만 남김(review-shadow.service) — 운영에서는 REVIEW_SHADOW 도 쌓임
        ok('4 ~ 7 이번 달 사용량에 통로별로 쌓임(번역 · 볼 때 번역 · 상담 · 검수 보조는 운영 엔진에서)', {'TRANSLATE', 'BOARD', 'SITE_CHAT'} <= us, str(sorted(us)))

        # 8 월 상한
        psql("SELECT fn_agent_record_usage('SITE_CHAT', 'claude-haiku-5-5', 100000000, 0);")   # 상한 $5 를 넘김
        sw = psql("SELECT value FROM site_settings WHERE key = 'agent.enabled'")
        al = psql(f"SELECT count(*) FROM ops_alerts WHERE id > {mark_alert} AND alert_code = 'AGENT_CAP_REACHED'")
        ok('8 월 상한에 닿으면 AI 전체가 저절로 꺼짐 · 운영 경보', sw == 'off' and al not in ('', '0'), f'{sw} · 경보 {al}')
        box = agent_page()
        flip('agent.enabled'); pg.wait_for_timeout(1500)
        msg = box.inner_text()
        ok('8 상한을 그대로 두고 다시 켜기 → 막힘(「이번 달 비용보다 큰 월 상한」 안내)', psql("SELECT value FROM site_settings WHERE key = 'agent.enabled'") == 'off' and '이번 달 비용' in msg,
           next((l for l in msg.split('\n') if '이번 달 비용' in l), '')[:80])
        cost = float(call('GET', '/admin/agent/status', t=T_).get('monthCostUsd') or 0)
        cap = box.locator('[data-agent-cap]'); cap.locator('input').fill(str(int(cost) + 10)); cap.locator('button', has_text='저장').click(); pg.wait_for_timeout(1500)
        flip('agent.enabled')
        ok('8 상한을 올리면 다시 켜짐', psql("SELECT value FROM site_settings WHERE key = 'agent.enabled'") == 'on', f'상한 ${int(cost) + 10}')
        pg.screenshot(path=os.environ.get('SGB_QA_OUT', '.') + '/ai_check_switches.png', full_page=False)

        # 9 모두 끄기
        for k in ('agent.chat.enabled', 'agent.review_shadow.enabled', 'i18n.board_on_view', 'i18n.auto_translate.enabled', 'agent.enabled'): flip(k)
        off = all(psql(f"SELECT value FROM site_settings WHERE key = '{k}'") == 'off' for k in KEYS[:-1] if k != 'agent.monthly_cap_usd')
        sk = call('POST', '/admin/jobs', {'job': 'translate_jobs'}, t=T_).get('detail', {}).get('skipped')
        ok('9 화면에서 모두 끄기 → 손님 화면 AI 상담 없음 · 배치 건너뜀', off and call('GET', '/agent/chat/status').get('enabled') is False and sk in ('AGENT_OFF', 'CHANNEL_OFF'), f'{off} · {sk}')
        b.close()
    print('   10 처리방침 · 고지(docs/176 · 170 §2 · 165 §2) — 대표 · 법무 확인. 운영에서 AI 를 켜기 전에 반드시.')
finally:
    for k, v in was.items(): psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}';")
    psql(f"UPDATE i18n_langs SET is_active = {'true' if en_was == 't' else 'false'} WHERE code = 'en';")
    psql("DELETE FROM agent_usage_daily WHERE day = current_date;")

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
