"""v10.105 시험 — 다국어 3-3 소개광장 글 · 댓글 볼 때 번역(D119 · docs/163)

  KIT=… [API=http://localhost:13000/api/v1] [SITE=http://localhost:15174] [DB=postgresql://sgb:sgb@localhost:15432/sgb] python3 -I test_v1105.py
  ③ 은 API 를 시험 엔진으로 띄웠을 때만: `AGENT_PROVIDER=MOCK docker compose … up -d api`(밖으로 나가지 않음)

  ① 마이그레이션 D119 — 통로 BOARD(스위치 i18n.board_on_view) · 하루 횟수 표 · 한도 함수 · 횟수 설정 2 · 157 · 마지막 D119
  ② 코드 — 누를 때만 번역(POST …/translate) · 통로 · 횟수 · 요금표 확인 · 같은 원문 건너뜀 · 금칙어 · 연락처 칸은 저장 안 함 · MACHINE · 글쓴이 · 댓글 쓴이에게 원문 · 원문 보기 · 화면 단추
  ③ (API · DB · MOCK) 꺼짐이면 막힘 · 켜면 번역 보기 → 저장 → 「기계 번역」 · 한국어 · 원문 보기 · 글쓴이는 원문 · 다시 눌러도 비용 0 · 하루 한도 · 금칙어 칸 원문 · 사용량 BOARD · (SITE) 영어 화면에 표시 · 끝나면 되돌림
"""
import json, os, re, subprocess, time, urllib.error, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); SITE = os.environ.get('SITE'); DB = os.environ.get('DB')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


M = rd('prisma/migrations/D119_i18n_board_on_view/migration.sql')
mig = sorted(d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d)))
ok('① 마이그레이션 157 · 마지막 D119(v10.106 부터 D120 · 158 — test_v1106)', (len(mig), mig[-1] if mig else '') in ((157, 'D119_i18n_board_on_view'), (158, 'D120_ai_review_shadow'), (159, 'D121_agent_chat'), (160, 'D122_agent_key_admin'), (161, 'D123_profile_consent_single'), (162, 'D124_i18n_profile'), (163, 'D125_i18n_more_targets'), (164, 'D126_i18n_db_text'), (165, 'D127_partner_badge_codes'), (166, 'D128_integ_keys_admin'), (167, 'D129_agent_chat_handoff'), (168, 'D130_i18n_company_name'), (169, 'D131_terms_ai_adpersonal_drafts'), (170, 'D132_terms_privacy_fill'), (171, 'D133_agent_member_lookup')), f'{len(mig)} · {mig[-1] if mig else ""}')
ok('① 통로 BOARD(i18n.board_on_view) · 하루 횟수 표 · 한도 함수 · 회원 30 · 비회원 10', "WHEN 'BOARD' THEN 'i18n.board_on_view'" in M and 'board_translate_usage' in M
   and 'WHERE board_translate_usage.n < p_limit' in M and "('i18n.board_daily_member', '30'" in M and "('i18n.board_daily_guest', '10'" in M, '')
B = rd('src/modules/i18n/board-translate.service.ts'); CS = rd('src/modules/community/community.service.ts')
ok('② 번역 보기 — 언어 · 통로 · 하루 횟수 · 요금표 확인 · 같은 원문 건너뜀 · 금칙어 · 연락처 칸 저장 안 함 · MACHINE · 사용량 BOARD',
   "this.agent.allowed('BOARD')" in B and 'fn_board_translate_take' in B and "'MODEL_UNPRICED'" in B and 'NOT is_stale' in B
   and 'suspiciousTranslation(x.src, text)' in B and "'MACHINE'" in B and "this.agent.record('BOARD'" in B, '')
ok('② 손님 화면 — 글쓴이 · 댓글 쓴이에게 원문 · 원문 보기(orig) · 「번역 보기」 여부 · 목록 제목', "if (!p.mine && !orig) await this.i18n.overlayOne(post, 'POST'" in CS
   and "comments.filter((c: any) => !c.mine && !c.hidden), 'COMMENT'" in CS and 'i18nAvailable' in CS and 'this.board3.pending(id, lang)' in CS and 'rows.filter((r) => !r._mine)' in CS and CS.count('await this.overlayTitles(rows);') == 2, '')
P = rd('site/src/app/community/[id]/page.tsx')
ok('② 사용자 웹 — 「기계 번역」 · 원문 보기 · 번역 보기 단추(누를 때만)', "t('mt.label')" in P and '?orig=1' in P and '<TranslateButton postId=' in P
   and "fetch(`/api/v1/community/posts/${postId}/translate`" in rd('site/src/components/community/TranslateButton.tsx'), '')
ok('② 기계 번역은 게시판(글 · 댓글)에만 나감(3-1 overlay)', "['POST', 'COMMENT'].includes(type) ? LIVE" in rd('src/modules/i18n/i18n.service.ts'), '')


def call(m, p, b=None, t=None, h=None):
    hd = {'content-type': 'application/json', **(h or {})}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m)
    try:
        return json.load(urllib.request.urlopen(r, timeout=120))
    except urllib.error.HTTPError as e:
        try: return {'_err': e.code, **json.loads(e.read().decode('utf-8', 'replace'))}
        except Exception: return {'_err': e.code}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('   psql 오류:', r.stderr.strip()[:300])
    return r.stdout.strip()


if API and DB:
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': 'sgb-dev-1234'})['accessToken']
    prov = call('GET', '/admin/i18n/jobs?size=1', t=T_).get('provider')
    KEYS = ['i18n.board_on_view', 'agent.enabled', 'agent.monthly_cap_usd', 'i18n.enabled', 'i18n.board_daily_guest', 'i18n.board_daily_guest_total']
    before = {k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'") for k in KEYS}
    en_before = psql("SELECT is_active FROM i18n_langs WHERE code = 'en'")
    # 시험 글 3개(person@x.com) · 글마다 댓글 2개(buyer@x.com) — 끝나면 지움
    TAG = 'T1105'
    ids = psql(f"""WITH a AS (SELECT id FROM accounts WHERE email = 'person@x.com'), b AS (SELECT id FROM accounts WHERE email = 'buyer@x.com'),
                     p AS (INSERT INTO posts (board, title, body, author_id, state)
                           SELECT 'QNA', '{TAG} 질문 ' || g, '{TAG} 소개 받는 방법이 궁금합니다. 본문 ' || g, (SELECT id FROM a), 'PUBLISHED' FROM generate_series(1, 3) g RETURNING id)
                   SELECT string_agg(id::text, ',') FROM p""")
    psql(f"UPDATE posts SET state = 'PUBLISHED' WHERE title LIKE '{TAG} %';")   # 첫 글은 검수 대기로 들어감(DB) — 운영 승인과 같은 상태로
    for pid_ in ids.split(','):
        psql(f"""INSERT INTO post_comments (post_id, author_id, body) SELECT '{pid_}', id, '{TAG} 댓글 ' || g || ' 입니다' FROM accounts, generate_series(1, 2) g WHERE email = 'buyer@x.com'""")
    posts = [[x, 'person@x.com'] for x in ids.split(',') if x]
    VK = 'test1105visitorkey'; EN = {'X-Lang': 'en'}
    try:
        S = lambda k, v: psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}';")
        psql("DELETE FROM content_translations WHERE engine = 'MOCK' AND target_type IN ('POST','COMMENT'); DELETE FROM board_translate_usage; DELETE FROM agent_usage_daily WHERE channel = 'BOARD';")
        ok('③ 시험할 글 3개(댓글 있는 공개 글)', len(posts) == 3, str(len(posts)))
        S('i18n.board_on_view', 'off')
        r0 = call('POST', f'/community/posts/{posts[0][0]}/translate', h={**EN, 'X-Visitor-Key': VK})
        ok('③ 꺼짐 — 번역 보기 막힘', r0.get('_err') in (409, 422), str(r0.get('_err')))
        if prov != 'MOCK':
            ok('③ API 가 시험 엔진(MOCK)으로 떠 있음 — 아니면 나머지 건너뜀', False, f'provider={prov}')
        else:
            for k, v in (('i18n.board_on_view', 'on'), ('agent.enabled', 'on'), ('agent.monthly_cap_usd', '5'), ('i18n.enabled', 'on'), ('i18n.board_daily_guest', '2')): S(k, v)
            psql("UPDATE i18n_langs SET is_active = true WHERE code = 'en';")
            time.sleep(31)   # 번역 설정 기억(30초)
            pid, author = posts[0]
            ko = call('GET', f'/community/posts/{pid}'); g0 = call('GET', f'/community/posts/{pid}', h=EN)
            ok('③ 켬 + 영어 — 「번역 보기」 가능 · 아직 번역 없음 · 한국어 응답엔 표시 칸 없음', g0.get('i18nAvailable') is True and not g0.get('translated') and 'i18nAvailable' not in ko, '')
            r1 = call('POST', f'/community/posts/{pid}/translate', h={**EN, 'X-Visitor-Key': VK})
            ok('③ 번역 보기 → 저장', r1.get('ok') and r1.get('translated', 0) >= 2, str(r1))
            g1 = call('GET', f'/community/posts/{pid}', h=EN)
            ok('③ 영어 — 제목 · 본문 · 댓글이 기계 번역 · 「기계 번역」 표시', g1.get('translated') and g1['title'] == f"[MOCK en] {ko['title']}"
               and any(c.get('translated') for c in g1.get('comments', [])), g1.get('title', ''))
            ok('③ 한국어 · 원문 보기(orig=1)는 원문', call('GET', f'/community/posts/{pid}').get('title') == ko['title']
               and call('GET', f'/community/posts/{pid}?orig=1', h=EN).get('title') == ko['title'], '')
            AT = call('POST', '/auth/login', {'email': author, 'password': 'sgb-dev-1234'}).get('accessToken')
            ok('③ 글쓴이가 영어로 열면 원문', AT and call('GET', f'/community/posts/{pid}', t=AT, h=EN).get('title') == ko['title'], author)
            lst = call('GET', '/community/board?size=50', h=EN).get('items', [])
            ok('③ 목록 제목도 기계 번역', any(x.get('title') == f"[MOCK en] {ko['title']}" for x in lst), '')
            u1 = psql("SELECT coalesce(sum(requests), 0) FROM agent_usage_daily WHERE channel = 'BOARD'")
            r2 = call('POST', f'/community/posts/{pid}/translate', h={**EN, 'X-Visitor-Key': VK})
            u2 = psql("SELECT coalesce(sum(requests), 0) FROM agent_usage_daily WHERE channel = 'BOARD'")
            ok('③ 다시 눌러도 번역 0 · 비용 0(횟수도 안 씀) · 사용량 BOARD 1건', r2.get('translated') == 0 and u1 == u2 == '1'
               and psql(f"SELECT n FROM board_translate_usage WHERE who = 'V:{VK}'") == '1', f'{r2} · {u1}/{u2}')
            psql("INSERT INTO banned_words (word, match_type, severity, is_active) VALUES ('MOCK en', 'CONTAINS', 'BLOCK', true);")
            r3 = call('POST', f'/community/posts/{posts[1][0]}/translate', h={**EN, 'X-Visitor-Key': VK})
            ok('③ 번역문에 차단 금칙어 → 저장하지 않음(원문 그대로)', r3.get('translated') == 0 and r3.get('held', 0) >= 2
               and not call('GET', f'/community/posts/{posts[1][0]}', h=EN).get('translated'), str(r3))
            u3 = psql("SELECT coalesce(sum(requests), 0) FROM agent_usage_daily WHERE channel = 'BOARD'")
            r3b = call('POST', f'/community/posts/{posts[1][0]}/translate', h={**EN, 'X-Visitor-Key': 'test1105other01'})
            ok('③ 금칙어에 걸린 칸은 승인 대기로 남아 다시 부르지 않음(비용 0)', r3b.get('translated') == 0 and r3b.get('note')
               and psql("SELECT coalesce(sum(requests), 0) FROM agent_usage_daily WHERE channel = 'BOARD'") == u3
               and psql(f"SELECT count(*) FROM content_translations WHERE target_type = 'POST' AND target_id = '{posts[1][0]}' AND status = 'DRAFT'") == '2', str(r3b))
            psql("DELETE FROM banned_words WHERE word = 'MOCK en';")
            psql(f"""INSERT INTO post_comments (post_id, author_id, body) SELECT '{pid}', id, '{TAG} 나중 댓글입니다' FROM accounts WHERE email = 'buyer@x.com'""")
            g2 = call('GET', f'/community/posts/{pid}', h=EN)
            r6 = call('POST', f'/community/posts/{pid}/translate', h={**EN, 'X-Visitor-Key': 'test1105other02'})
            ok('③ 나중에 달린 댓글 → 「번역 보기」 다시 · 눌러서 그 댓글만 번역', g2.get('i18nAvailable') is True and r6.get('translated') == 1, f"{g2.get('i18nAvailable')} · {r6}")
            ol = [x for x in call('GET', '/community/board?size=50', t=AT, h=EN).get('items', []) if x.get('id') == pid]
            ok('③ 글쓴이의 목록 제목은 원문', ol and ol[0].get('title') == ko['title'], str(ol[:1]))
            S('i18n.board_daily_guest_total', psql("SELECT n FROM board_translate_usage WHERE who = 'G:ALL'"))
            r7 = call('POST', f'/community/posts/{posts[2][0]}/translate', h={**EN, 'X-Visitor-Key': 'test1105other03'})
            ok('③ 비회원 전체 하루 상한(방문자 키를 바꿔도) → 422 · 개인 횟수는 되돌림', r7.get('_err') == 422 and '비회원' in r7.get('message', '')
               and psql("SELECT coalesce(max(n), 0) FROM board_translate_usage WHERE who = 'V:test1105other03'") == '0', str(r7.get('message')))
            r4 = call('POST', f'/community/posts/{posts[2][0]}/translate', h={**EN, 'X-Visitor-Key': VK})
            ok('③ 비회원 하루 한도(2회) 넘으면 422', r4.get('_err') == 422 and r4.get('code') == 'BOARD_TRANSLATE_LIMIT', str(r4.get('code')))
            r5 = call('POST', f'/community/posts/{posts[2][0]}/translate', h=EN)
            ok('③ 비회원인데 방문자 키가 없으면 422', r5.get('_err') == 422, str(r5.get('code')))
            if SITE:
                for _ in range(30):   # 사용자 웹의 언어 목록 캐시(60초)가 켜짐을 볼 때까지
                    if '<html lang="en"' in urllib.request.urlopen(urllib.request.Request(SITE + '/login', headers={'Cookie': 'sgb_lang=en'}), timeout=60).read().decode('utf-8', 'replace'): break
                    time.sleep(5)
                h = urllib.request.urlopen(urllib.request.Request(SITE + f'/community/{pid}', headers={'Cookie': 'sgb_lang=en'}), timeout=120).read().decode('utf-8', 'replace')
                hk = re.sub(r'<script[\s\S]*?</script>', '', urllib.request.urlopen(urllib.request.Request(SITE + f'/community/{pid}'), timeout=120).read().decode('utf-8', 'replace'))   # 보이는 글자만(사전은 스크립트 안에 실림)
                ok('③ 사용자 웹 — 영어는 기계 번역 · 표시 · 원문 보기 · 한국어는 원문 · 표시 없음', '[MOCK en]' in h and 'Machine translation' in h and '?orig=1' in h
                   and '[MOCK en]' not in hk and '기계 번역' not in hk, str(['[MOCK en]' in h, 'Machine translation' in h, '?orig=1' in h, '[MOCK en]' in hk, '기계 번역' in hk, re.search(r'<html[^>]*>', h).group(0)]))
    finally:
        psql("DELETE FROM banned_words WHERE word = 'MOCK en';")
        psql(f"DELETE FROM posts WHERE title LIKE '{TAG} %';")
        psql("DELETE FROM content_translations WHERE engine = 'MOCK' AND target_type IN ('POST','COMMENT'); DELETE FROM board_translate_usage; DELETE FROM agent_usage_daily WHERE channel = 'BOARD';")
        for k, v in before.items(): psql(f"UPDATE site_settings SET value = $v${v}$v$ WHERE key = '{k}';")
        psql(f"UPDATE i18n_langs SET is_active = {'true' if en_before == 't' else 'false'} WHERE code = 'en';")
        ok('③ 끝나면 되돌림 — 번역 · 횟수 · 사용량 · 금칙어 · 스위치', psql("SELECT count(*) FROM board_translate_usage") == '0'
           and all(psql(f"SELECT value FROM site_settings WHERE key = '{k}'") == v for k, v in before.items()), str(before))

_v = tuple(int(x) for x in re.findall(r'\d+', rd('VERSION')))
ok('VERSION v10.105 이상', _v >= (10, 105), '.'.join(map(str, _v)))
bad = [x for x in RES if not x[0]]
print(f'\n결과 — 통과 {len(RES) - len(bad)} · 실패 {len(bad)}')
raise SystemExit(1 if bad else 0)
