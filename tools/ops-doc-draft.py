#!/usr/bin/env python3
"""운영 절차서 초안 만들기 (v10.298 · sgb-core docs/417)

  python3 tools/ops-doc-draft.py <지금 운영 킷.zip> <올릴 킷.zip> [-o 초안.md] [--no <쓰지 않는 문서 번호>,...]

  - 킷 두 개(지금 운영 판 · 올릴 판)를 **읽기만** 해서 운영 적용 절차서(docs/409 모양) 초안을 씁니다.
  - 기계로 채우는 것: 킷 이름 · 만든 시각 · 커밋 · sha256(zip · tar.gz) · 새 마이그레이션 목록 · precheck 기대 줄 ① ·
    스냅샷 필요 여부 · 적용 스크립트(deploy/ · 패키지 목록 · 잠금 파일 · .env.example) 바뀜 · 두 킷 차이 ·
    그 사이 판 문서(sgb/docs/NNN_…_v10.X…)들의 「바뀐 것」 표와 「운영 적용」 줄 · 명령 블록(3-0 ~ 3-4)
  - 사람이 채울 것은 〔채울 것: …〕 로 남깁니다(postcheck 숫자 · 화면 확인 순서 · 되돌리기 설명 · 하지 말 것 · 대표 할 일).
  - 마지막에 문서 안 64자 sha 가 모두 올릴 킷 sha 와 같은지 스스로 대조합니다(옛 절차서 베끼기 함정).
  - 운영 서버 · DB · 네트워크에 닿지 않습니다. 킷은 임시 폴더에 풀고 끝나면 지웁니다.
"""
import argparse, hashlib, os, re, shutil, sys, tempfile, time, zipfile

VER_RE = re.compile(r'v10[._](\d+)(?:[-_~](\d{3}))?(?!\d)')


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def ver_num(v):
    m = re.search(r'v10\.(\d+)', v or '')
    return int(m.group(1)) if m else -1


def unpack(zpath, dest):
    with zipfile.ZipFile(zpath) as z:
        for n in z.namelist():   # 킷 밖으로 나가는 이름은 풀지 않음
            if n.startswith('/') or '..' in n.split('/'):
                raise SystemExit(f'킷 안 이상한 경로: {n}')
        z.extractall(dest)
    tops = [d for d in os.listdir(dest) if os.path.isdir(os.path.join(dest, d))]
    if len(tops) != 1:
        raise SystemExit(f'킷 맨 위 폴더가 하나가 아님: {tops}')
    return os.path.join(dest, tops[0])


def files_under(root, sub=''):
    base = os.path.join(root, sub)
    out = {}
    if not os.path.isdir(base):
        return out
    for dp, _, fs in os.walk(base):
        for f in fs:
            p = os.path.join(dp, f)
            out[os.path.relpath(p, root)] = p
    return out


def same(a, b):
    with open(a, 'rb') as x, open(b, 'rb') as y:
        return x.read() == y.read()


def migrations(sgb):
    d = os.path.join(sgb, 'prisma', 'migrations')
    if not os.path.isdir(d):
        return {}
    return {m: os.path.join(d, m, 'migration.sql') for m in sorted(os.listdir(d))
            if os.path.isfile(os.path.join(d, m, 'migration.sql'))}


def read(p):
    try:
        with open(p, encoding='utf-8') as f:
            return f.read().strip()
    except OSError:
        return ''


def section(md, word):
    """'## n. <word>…' 아래 다음 '## ' 전까지"""
    m = re.search(r'^## [0-9]+\. *' + re.escape(word) + r'.*$', md, re.M)
    if not m:
        return ''
    rest = md[m.end():]
    n = re.search(r'^## ', rest, re.M)
    return (rest[:n.start()] if n else rest).strip()


def version_docs(docs_dir, lo, hi, skip):
    out = []
    if not os.path.isdir(docs_dir):
        return out
    for f in sorted(os.listdir(docs_dir)):
        m0 = re.match(r'^(\d{3})_', f)
        if not m0 or not f.endswith('.md') or '운영적용' in f or m0.group(1) in skip:
            continue
        m = VER_RE.search(f)
        if not m:
            continue
        a = int(m.group(1)); b = int(m.group(2)) if m.group(2) else a
        if lo < b and a <= hi:
            out.append((m0.group(1), f, a, b))
    return out


def group(paths):
    g = {}
    for p in sorted(paths):
        parts = p.split('/')
        top = '/'.join(parts[:2]) if parts[0] == 'sgb' and len(parts) > 2 else parts[0]
        if parts[0] == 'sgb' and len(parts) > 3 and parts[1] in ('src', 'web', 'site'):
            top = '/'.join(parts[:3])
        g.setdefault(top, []).append(p)
    return g


def main():
    ap = argparse.ArgumentParser(description='운영 절차서 초안 만들기 (킷 두 개 → 초안 .md)')
    ap.add_argument('old'); ap.add_argument('new')
    ap.add_argument('-o', '--out', default='-')
    ap.add_argument('--no', default='', help='쓰지 않는 옛 운영 절차서 번호(쉼표) — 머리말에 적음')
    ap.add_argument('--doc', default='〔번호〕', help='이 절차서 번호(예: 418)')
    a = ap.parse_args()
    for p in (a.old, a.new):
        if not (os.path.isfile(p) and p.endswith('.zip')):
            raise SystemExit(f'킷 zip 이 아님: {p}')
    tmp = tempfile.mkdtemp(prefix='opsdraft_')
    try:
        o_root, n_root = unpack(a.old, os.path.join(tmp, 'o')), unpack(a.new, os.path.join(tmp, 'n'))
        o_sgb, n_sgb = os.path.join(o_root, 'sgb'), os.path.join(n_root, 'sgb')
        ov, nv = read(os.path.join(o_sgb, 'VERSION')), read(os.path.join(n_sgb, 'VERSION'))
        if ver_num(nv) <= ver_num(ov):
            raise SystemExit(f'올릴 판({nv})이 지금 판({ov})보다 높지 않음')
        kit = os.path.basename(a.new)[:-4]
        tar = a.new[:-4] + '.tar.gz'
        zsha = sha256(a.new); tsha = sha256(tar) if os.path.isfile(tar) else ''
        commits = read(os.path.join(n_root, 'KIT_COMMITS.txt')) or '〔채울 것: KIT_COMMITS.txt 없음〕'
        made = time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime(os.path.getmtime(a.new)))
        om, nm = migrations(o_sgb), migrations(n_sgb)
        new_m = [m for m in nm if m not in om]
        chg_m = [m for m in nm if m in om and not same(om[m], nm[m])]
        gone_m = [m for m in om if m not in nm]
        # 적용 스크립트 · 패키지
        dep_keys = ['sgb/deploy', 'sgb/package.json', 'sgb/package-lock.json', 'sgb/web/package.json', 'sgb/web/package-lock.json',
                    'sgb/site/package.json', 'sgb/site/package-lock.json', 'sgb/.env.example']
        of, nf = files_under(o_root), files_under(n_root)
        is_doc = lambda p: p.startswith('sgb/docs/') or p.endswith('.md')
        is_mig = lambda p: p.startswith('sgb/prisma/migrations/')
        changed = [p for p in nf if p in of and not same(of[p], nf[p])]
        added = [p for p in nf if p not in of]
        removed = [p for p in of if p not in nf]
        dep = [p for p in changed + added + removed if any(p == k or p.startswith(k + '/') for k in dep_keys)]
        svc = lambda ps: [p for p in ps if p.startswith('sgb/') and not is_doc(p) and not is_mig(p)]
        ads = [p for p in changed + added + removed if p.startswith('sgb-ads/') and not is_doc(p)]
        qa = [p for p in changed + added + removed if not p.startswith(('sgb/', 'sgb-ads/'))]
        docs = version_docs(os.path.join(n_sgb, 'docs'), ver_num(ov), ver_num(nv), set(x for x in a.no.split(',') if x))
        snap = bool(new_m)
        vo, vn = ov, nv
        snapname = f"sgb-before-{vn.replace('.', '-')}-<적용하는 날 YYYYMMDD>"
        L = []
        w = L.append
        w(f'# {a.doc}. 운영 적용 — {vo} → {vn} 한 번에 ({time.strftime("%Y-%m-%d")})')
        w('')
        w(f'> 🛈 **초안 — tools/ops-doc-draft.py 가 킷 두 개로 만듦.** 〔채울 것〕을 모두 채우고 4-1 화면 확인을 실제 메뉴(adminMenu.ts)와 맞춘 뒤 docs/ 에 올립니다.')
        w(f'> 운영은 지금 **{vo}** 입니다(〔채울 것: 적용 시각 · 문서 · 대표 화면 확인〕). 이 문서로 **{vn}** 을 한 번에 올립니다'
          + (f"({' · '.join('v10.%d%s · docs/%s' % (x[2], ('~%d' % x[3]) if x[3] != x[2] else '', x[0]) for x in docs)})" if docs else '') + '.'
          + (f" **docs/{' · '.join(a.no.split(','))} 는 쓰지 않습니다.**" if a.no else ''))
        w(f"> - **마이그레이션 {len(new_m)}개({len(om)} → {len(nm)})" + (' — RDS 스냅샷 꼭 만듭니다.**' if snap else ' — 스냅샷은 skip 가능(apply 가 물으면 skip).**'))
        w('> - 공통 순서 · 기대 줄 읽는 법 · 멈췄을 때는 **docs/321(공통 절차서)** 을 따릅니다. 이 문서에는 **이번 판에서 다른 것만** 적습니다.')
        w('> - 하는 사람: ubuntu 사용자(사람). **대표 승인 뒤에** 합니다. 명령은 **한 블록씩** 칩니다.')
        w('> - ⚠ **3-1 은 집 PC PowerShell 에서 칩니다** — 운영 서버(ubuntu)에서 치면 `scp` · `certutil` 이 없어 실패합니다.')
        w('')
        w('## 1. 한눈에')
        w('')
        w('| 항목 | 값 |')
        w('|---|---|')
        w(f'| 올릴 킷 | `{kit}.zip` — **`~/kits/release/`**({made} · {commits}' + (f' · tar.gz 는 `{kit}.tar.gz`' if tsha else ' · tar.gz 없음') + ') |')
        w(f'| 킷 sha256 | zip `{zsha}`' + (f' · tar.gz `{tsha}`' if tsha else '') + '. 이 문서는 킷을 만든 뒤에 써서 **킷 안에는 없음** — 이 저장소 판이 기준 |')
        w(f"| 올릴 마이그레이션 | **{len(new_m)}개**" + (' — ' + ' · '.join(f'`{m}`' for m in new_m) if new_m else '') + ' 〔채울 것: 지우는 문장 없음 · 재실행 안전 확인〕 |')
        w(f"| precheck 기대 줄 | ① `적용됨 {len(om)} · 새 킷의 파일 {len(nm)} · 올릴 것 {len(new_m)} · 바뀐 파일 {len(chg_m)}`"
          + (' · 올릴 것 이름 ' + ' · '.join(m.split('_')[0] for m in new_m) if new_m else '')
          + ' ② [4] `판 보관 폴더: 〔채울 것〕`(「되돌린 상태」 줄이 **없어야 함**) ③ [5] 〔채울 것: 오픈 차단 · 약관 줄〕 ④ [6] 「sgb 따로 있는 파일」 · 「사용자 웹 — 누구나 열림 · 운영 화면 — 허용 IP 만」 |')
        w(f"| apply 기대 줄 | 3단계 올릴 것 {len(new_m)}개 → 「RDS 스냅샷을 방금 만들었습니까?」 → " + ('`yes`(이름을 물으면 3-2 이름)' if snap else '`skip`') +
          f" → `적용 {len(new_m)} · 기존 {len(om)} · 변경감지 0` → `{len(nm)} / {len(nm)}` → 설치 · 빌드 → 기동 확인 → 〔채울 것: 옛 판 정리 줄〕 → postcheck 실패 0 |")
        w(f"| 스냅샷 이름 | `{snapname}`" + (' (**꼭 만듦**)' if snap else ' (마이그레이션 없음 — skip 가능)') + ' |')
        if dep:
            w('| 적용 스크립트 | ⚠ **바뀜** — ' + ' · '.join(f'`{p}`' for p in sorted(dep)) + ' 〔채울 것: 무엇이 왜 바뀌었는지 · 운영 `.env` · Nginx 할 일〕 |')
        else:
            w(f'| 적용 스크립트 | **바뀌지 않음** — `deploy/` 전체 · `package.json` · 잠금 파일 · `.env.example` 모두 {vo} 과 같음. **운영 `.env` · Nginx 는 고치지 않음.** |')
        w('| postcheck 기대 | 〔채울 것: 통과 · 실패 0 · 확인 · [2] 올린 판 · [11] 같음 · 바뀜〕 |')
        if chg_m or gone_m:
            w(f"| ⛔ 멈출 것 | 옛 마이그레이션이 바뀜 {chg_m} · 없어짐 {gone_m} — **이대로 적용하지 않음**(변경감지) |")
        w('')
        w(f'### 두 킷 차이 ({vo} 킷 ↔ {vn} 킷)')
        w('')
        w('| 무엇 | 결과 |')
        w('|---|---|')
        sc, sa, sr = svc(changed), svc(added), svc(removed)
        w(f'| 서비스 쪽(`sgb/` · 문서 뺌) | 바뀜 {len(sc)} · 새것 {len(sa)} · 없어짐 {len(sr)} · 새 마이그레이션 {len(new_m)} |')
        for top, ps in group(sc + sa + sr).items():
            w(f"| `{top}` | " + ' · '.join(('새 ' if p in sa else '지움 ' if p in sr else '') + '`' + p[len(top) + 1:] + '`' for p in ps[:30])
              + (f' · … 외 {len(ps) - 30}' if len(ps) > 30 else '') + ' |')
        w(f"| 광고 플랫폼(`sgb-ads/`) | {'바뀜 ' + str(len(ads)) if ads else '바뀌지 않음'} |")
        w(f'| 점검 도구(qa · docker 등 · 운영에 안 감) | 바뀜 {len(qa)} |')
        w('| 개발 서버 점검 | 〔채울 것: 판마다 풀 리퀘스트 번호 · realcheck · 기능 점검 · 회귀 수〕 |')
        w('')
        w('## 2. 무엇이 바뀌나')
        w('')
        if not docs:
            w('〔채울 것: 판 문서를 찾지 못함 — sgb/docs/NNN_…_v10.X… 이름 확인〕')
        for num, f, x, y in docs:
            md = read(os.path.join(n_sgb, 'docs', f))
            body = section(md, '바뀐 것')
            w(f'### docs/{num} — v10.{x}' + (f' ~ {y}' if y != x else '') + f' (`{f}`)')
            w('')
            w(body if body else '〔채울 것: 「바뀐 것」 절 없음〕')
            w('')
        w('## 3. 순서')
        w('')
        w('> ⚠ **한 블록씩 칩니다.** 되돌리기 명령은 5절에만 있습니다 — 적용 중에는 치지 마십시오.')
        w('')
        w('### 3-0. 운영 판 확인 (ubuntu · 읽기만)')
        w('')
        w('```bash')
        w(f'cat ~/sgb/VERSION          # {vo} (그 밖이면 멈추고 알려 주십시오)')
        w('pm2 ls                     # 3개 online')
        w('ls ~/sgb-releases          # 〔채울 것〕')
        w('df -h / | tail -1          # 여유 3GB 이상')
        w('free -m | head -2          # 사용 가능(available) 1GB 이상')
        w('```')
        w('')
        w('### 3-1. 킷 받기 · 올리기 — ⚠ **집 PC PowerShell** (운영 서버 아님)')
        w('')
        w('```powershell')
        w(f'scp sgb-dev:~/kits/release/{kit}.zip C:\\sgb\\')
        w(f'certutil -hashfile C:\\sgb\\{kit}.zip SHA256')
        w(f'#  기대: {zsha}   (다르면 멈추고 Claude 에게)')
        w(f'scp -i C:\\sgb_key\\sgb-key.pem C:\\sgb\\{kit}.zip ubuntu@3.37.95.217:~/')
        w('```')
        w('')
        w('### 3-1 ②. 풀기 · 적용 전 점검 (ubuntu)')
        w('')
        w('```bash')
        w(f'cd ~ && unzip -q -o {kit}.zip')
        w(f'cat ~/{kit}/sgb/VERSION        # {vn}')
        w(f'bash ~/{kit}/sgb/deploy/aws/precheck.sh')
        w('```')
        w('')
        w(f'**여기서 멈추고 precheck 결과를 확인합니다.** 1절 기대 줄과 다르면 적용하지 마십시오. 특히 「적용됨」이 {len(om)} 이 아니거나 「올릴 것」이 {len(new_m)} 이 아니거나 「바뀐 파일」이 0 이 아니거나 「되돌린 상태」 줄이 나오면 멈춥니다. 3-3 은 **24시간 안에** 하십시오.')
        w('')
        w('### 3-2. RDS 스냅샷' + (' (꼭 만듦)' if snap else ' (skip 가능)'))
        w('')
        w('```')
        w(f"AWS 콘솔 → RDS → sgb-db → 작업 → 스냅샷 생성 → 이름 {snapname.replace('<적용하는 날 YYYYMMDD>', 'YYYYMMDD')} → 「사용 가능」까지")
        w('```')
        w('')
        w(f'마이그레이션 {len(new_m)}개가 DB 를 바꾸므로 건너뛰지 않습니다.' if snap else '마이그레이션이 없어 DB 가 바뀌지 않습니다 — apply 가 이름을 물으면 `skip`.')
        w('')
        w('### 3-3. 적용 (ubuntu)')
        w('')
        w('```bash')
        w(f'bash ~/{kit}/sgb/deploy/aws/apply.sh')
        w('```')
        w('')
        w('- 빌드가 실패하면 apply 가 **교체 전에 멈추고 지금 판(' + vo + ')이 그대로 돕니다.** 출력을 보내 주십시오.')
        w('- 실패가 나오면 **다른 명령을 치지 말고** 출력을 보내 주십시오.')
        w('- 〔채울 것: 마이그레이션 NOTICE 가 나오면 무엇인지〕')
        w('')
        w('### 3-4. 적용 후 정리 (ubuntu)')
        w('')
        w('```bash')
        w(f'cat ~/sgb/VERSION                                # {vn}')
        w(f'ls ~/sgb-releases                                # {vo}_… · {vn}_…')
        w(f'rm -rf ~/{kit} ~/{kit}.zip')
        w('df -h / | tail -1')
        w('```')
        w('')
        w('## 4. 적용 직후')
        w('')
        w('### 4-1. 화면 확인 (PC 브라우저 · Ctrl + F5 · 집 또는 사무실 IP)')
        w('')
        w('〔채울 것: 아래 판 문서의 「운영 적용」 줄을 메뉴 › 탭 › 하위 탭 › 상자 순서 표로 · 저장 · 게시 · 켜기는 누르지 않게〕')
        w('')
        for num, f, x, y in docs:
            body = section(read(os.path.join(n_sgb, 'docs', f)), '운영 적용')
            if body:
                w(f'- docs/{num} (v10.{x}' + (f' ~ {y}' if y != x else '') + '):')
                for ln in body.splitlines():
                    w('  ' + ln if ln.strip() else '')
        w('')
        w('## 5. 되돌리기')
        w('')
        w('| 상황 | 할 일 |')
        w('|---|---|')
        w(f'| 화면이 이상함 | `bash ~/sgb/deploy/aws/rollback.sh` → `yes` — 프로그램이 **{vo}** 로 돌아갑니다. **DB 는 그대로** 〔채울 것: 옛 판이 새 표 · 칸을 어떻게 다루는지〕 |')
        if snap:
            w(f"| DB 까지 되돌려야 함 | 3-2 스냅샷 `{snapname.replace('<적용하는 날 YYYYMMDD>', 'YYYYMMDD')}` 로 복원 — Claude 에게 먼저 알려 주십시오(복원 뒤 생긴 주문 · 가입이 사라짐) |")
        w(f'| 되돌린 뒤 다시 {vn} 로 | `bash ~/sgb/deploy/aws/rollback.sh` 를 한 번 더 → `yes` |')
        w('')
        w('## 6. 하지 말 것')
        w('')
        w('- 3-1 을 운영 서버(ubuntu) 창에서 치기' + (' · 스냅샷 없이 3-3' if snap else ''))
        w('- 〔채울 것: 적용 확인 중 누르지 말 것(저장 · 게시 · 켜기)〕')
        w('- 운영에서 `verify` · `attack` · `db:seed` · `open-prep.sh apply` · `publish-terms.sh` · `npm run terms:publish`')
        w('- 목록을 보기 전 `cleanup.sh --apply` · 실패가 없는데 `pm2 restart`')
        w('')
        w('## 7. 확인하지 못한 것')
        w('')
        w('| 무엇 | 까닭 |')
        w('|---|---|')
        w(f'| 운영 판({vo}) · 디스크 · 메모리 · 판 보관 폴더 | sgbdev 는 운영 서버를 볼 수 없음 — 3-0 으로 확인 |')
        w('| 〔채울 것〕 | 운영 DB 를 볼 수 없음 |')
        w('')
        w('## 8. 적용 뒤 대표 할 일')
        w('')
        w('1. 〔채울 것〕')
        text = '\n'.join(L) + '\n'
        # 스스로 대조 — 문서 안 64자 값은 모두 올릴 킷 sha 여야 함
        shas = set(re.findall(r'\b[0-9a-f]{64}\b', text))
        bad = shas - {zsha, tsha}
        todo = text.count('〔채울 것')
        if a.out == '-':
            sys.stdout.write(text)
        else:
            with open(a.out, 'w', encoding='utf-8') as f:
                f.write(text)
        print(f'초안: {a.out} · {vo} → {vn} · 마이그레이션 {len(new_m)}개({len(om)} → {len(nm)}) · 스냅샷 {"필요" if snap else "skip 가능"} · '
              f'적용 스크립트 {"바뀜 " + str(len(dep)) if dep else "그대로"} · 판 문서 {len(docs)}개 · 채울 곳 {todo} · sha 대조 {"맞음" if not bad else "다름 " + str(sorted(bad))}',
              file=sys.stderr)
        return 3 if bad else (2 if chg_m or gone_m else 0)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
