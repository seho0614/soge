"""시안 v10.18 — 「내 구독」(해지 · 환불 상태) · 운영 「결제 · 환불 확인 필요」 점검. 파일(file://)로 열어 실제로 누릅니다. 결과: proto_bill.json

  A. 구성          제목 v10.18 · 화면 수는 그대로(새 화면 없음) · 두 자리가 보임
  B. 내 구독        자동 갱신 해지 → 안내 · 해지 철회 · 환불(사유 필수) → 환불 완료 / 환불 결과 확인 중 → 다시 확인 / 환불 실패
  C. 확인 필요      목록 · 「지금 대조」로 닫히는 것과 남는 것(금액 불일치 · 결과 불명확 요청)
  D. 누르는 것 전부  두 화면의 버튼을 하나씩 눌러 무반응 0 · 오류 0
  E. 390px         가로 넘침 없음

사용:  python3 proto_bill.py          PROTO=/path/proto.html (기본 킷의 spec/proto.html) · BASE=/path/SGB_Prototype_v10_17.html (앞 판 · 기본 /mnt/user-data/outputs)
"""
import json, os, re, sys
from playwright.sync_api import sync_playwright

_kit = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sgb')
K = os.environ.get('KIT') or (_kit if os.path.isdir(os.path.join(_kit, 'spec')) else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
FILE = os.environ.get('PROTO', K + '/spec/proto.html')
BASE = os.environ.get('BASE', '/mnt/user-data/outputs/SGB_Prototype_v10_17.html')      # 앞 판(화면 목록 비교용)
P = 'file://' + FILE
OUT = os.path.dirname(os.path.abspath(__file__))
R = []
def rec(step, ok, detail=''):
    # v10.31 — 앞 판 시안(BASE)이 이 작업 환경에 없으면 그것과 견주는 단계는 「건너뜀」(통과로 세지 않음 · 전에는 None 과 견줘 실패로 셈)
    if not ok and not os.path.exists(BASE) and ('앞 판' in step or '기준 판' in step) and 'None' in str(detail):
        R.append({'step': step, 'ok': False, 'skip': True, 'detail': f'앞 판 시안 없음 — {BASE}'}); print('SKIP', step, file=sys.stderr); return
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print('ok  ' if ok else 'FAIL', step, '' if ok else str(detail)[:220], file=sys.stderr)

CLEAN = "document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove())"
NOTOAST = "(()=>{const t=document.getElementById('toast'); if(t){t.classList.remove('on'); t.innerHTML=''}})()"
def paint(pg, k):
    pg.evaluate("location.hash=''"); pg.wait_for_timeout(120); pg.evaluate("k=>__VIEW.paint(k)", k); pg.wait_for_timeout(250); pg.evaluate(CLEAN); pg.evaluate(NOTOAST)
def click(pg, sel):
    pg.evaluate(CLEAN); pg.click(sel); pg.wait_for_timeout(150); pg.evaluate(CLEAN)
cnt = lambda pg, sel: pg.locator(sel).count()
def flash(pg, of):
    return pg.evaluate("(of)=>{const f=document.querySelector('#screen [data-pb-flash][data-pb-of=\"'+of+'\"]');return f?[f.getAttribute('data-pb-flash'),f.textContent.trim()]:null}", of)
def refund_state(pg):
    return pg.evaluate("(()=>{const f=document.querySelector('#screen [data-pb-refund]');return f?[f.getAttribute('data-pb-refund'),f.textContent.trim()]:null})()")
def acts(pg): return pg.eval_on_selector_all('#screen [data-pb-box="my"] [data-pb]', 'e=>e.map(x=>x.getAttribute("data-pb"))')

def main():
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 900}); errs = []
        pg.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
        pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
        pg.on('dialog', lambda d: d.accept())
        pg.goto(P); pg.wait_for_timeout(1600); pg.evaluate(CLEAN)

        # ── A ──
        title = open(FILE, encoding='utf-8').read(3000).split('<title>')[1].split('</title>')[0]
        rec('A-1 파일 제목 v10.18 · 「내 구독」 · 「결제 · 환불 확인 필요」 표기', bool(re.search(r'v10\.(1[8-9]|[2-9]\d)', title)) and '내 구독' in title and '확인 필요' in title, title[:100])
        keys = pg.evaluate("Object.keys(__VIEW.screens)")
        base_keys = None
        if os.path.exists(BASE):
            pb = b.new_page(); pb.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
            pb.goto('file://' + BASE); pb.wait_for_timeout(1500); base_keys = pb.evaluate("Object.keys(__VIEW.screens)"); pb.close()
        rec('A-2 화면 목록은 앞 판(v10.17) + v10.22 의 새 화면 4장 + v10.24 의 새 화면 1장 + v10.26 의 새 화면 1장 + v10.27 의 새 화면 1장(약관 전문 · 없앤 화면 없음)', base_keys is not None and sorted(keys) == sorted(list(base_keys) + ['bjob', 'bsvc', 'bpol', 'bedu', 'malcsld', 'admhpr'] + __import__('v1027_changes').NEW) and 'mysub' in keys and 'admbil' in keys, (len(keys), base_keys and len(base_keys)))
        paint(pg, 'mysub')
        t = pg.inner_text('#screen')
        rec('A-3 마이 「구독 · 소개코드」에 「내 구독」 — 요금제 · 상태 · 이용 기간 · 자동 갱신 · 다음 청구', cnt(pg, '#screen [data-pb-box="my"]') == 1 and all(x in t for x in ('내 구독', '이용 중', '이용 기간', '자동 갱신', '다음 청구')), t[:200])
        rec('A-4 그 아래 기존 내용(현재 요금제 · 요금제 3종 · 결제 내역)은 그대로', '현재 요금제' in t and '결제 내역' in t and cnt(pg, '#screen .plans .plan') == 3, cnt(pg, '#screen .plans .plan'))

        # ── B ──
        rec('B-1 처음: 「자동 갱신 해지」 · 「환불 신청」 · 사유 입력칸', acts(pg) == ['cancel', 'refund'] and cnt(pg, '#screen [data-pbv="reason"]') == 1, acts(pg))
        click(pg, '#screen [data-pb="cancel"]')
        t = pg.inner_text('#screen [data-pb-box="my"]'); f = flash(pg, 'my')
        rec('B-2 「자동 갱신 해지」 → 「해지 예약」 안내 · 다음 청구 「청구 예정 없음」 · 버튼이 「해지 철회」로', '해지 예약' in t and '청구 예정 없음' in t and f and f[0] == 'ok' and '청구되지 않습니다' in f[1] and acts(pg) == ['resume', 'refund'], (f, acts(pg)))
        click(pg, '#screen [data-pb="resume"]')
        t = pg.inner_text('#screen [data-pb-box="my"]')
        rec('B-3 「해지 철회」 → 자동 갱신으로 · 안내 사라짐', '해지 예약' not in t and cnt(pg, '#screen [data-pb-notice]') == 0 and acts(pg) == ['cancel', 'refund'], acts(pg))
        click(pg, '#screen [data-pb="refund"]')
        f = flash(pg, 'my')
        rec('B-4 환불 사유 없이 「환불 신청」 → 보내지 않고 「환불 사유를 적어 주십시오」', f and f[0] == 'err' and '사유' in f[1] and refund_state(pg) is None, f)
        # 결제사 응답 없음 → 환불 결과 확인 중
        pg.fill('#screen [data-pbv="reason"]', '시안 시험'); pg.select_option('#screen [data-pbv="pg"]', 'lost')
        click(pg, '#screen [data-pb="refund"]')
        rs = refund_state(pg); t = pg.inner_text('#screen [data-pb-box="my"]')
        rec('B-5 결제사 응답 없음 → 「환불 결과 확인 중」 · 이용 · 갱신이 멈춘다는 안내 · 「환불 완료」라고 하지 않음', rs and rs[0] == 'UNKNOWN' and '환불 결과 확인 중' in rs[1] and '멈춥니다' in t and '환불 완료' not in rs[1], rs)
        rec('B-6 확인 중에는 「환불 결과 다시 확인」만(해지 · 새 환불 신청 없음)', acts(pg) == ['recheck'], acts(pg))
        click(pg, '#screen [data-pb="recheck"]')
        rs = refund_state(pg); f = flash(pg, 'my')
        rec('B-7 아직 응답 없음 → 그대로 「확인 중」(완료로 넘기지 않음)', rs and rs[0] == 'UNKNOWN' and f and f[0] == 'err', (rs, f))
        pg.select_option('#screen [data-pbv="pg"]', 'ok'); click(pg, '#screen [data-pb="recheck"]')
        rs = refund_state(pg); t = pg.inner_text('#screen [data-pb-box="my"]')
        rec('B-8 결제사가 답하면 「환불 완료」 · 「이용 중인 구독이 없습니다」 · 해지 · 환불 버튼 없음', rs and rs[0] == 'SUCCEEDED' and '환불 완료' in rs[1] and '이용 중인 구독이 없습니다' in t and acts(pg) == ['reset'], (rs, acts(pg)))
        click(pg, '#screen [data-pb="reset"]')
        rec('B-9 「처음 상태로」 → 다시 처음 화면', acts(pg) == ['cancel', 'refund'] and refund_state(pg) is None, acts(pg))
        # 거절 → 환불 실패
        pg.fill('#screen [data-pbv="reason"]', '시안 시험'); pg.select_option('#screen [data-pbv="pg"]', 'deny')
        click(pg, '#screen [data-pb="refund"]')
        rs = refund_state(pg); t = pg.inner_text('#screen [data-pb-box="my"]')
        rec('B-10 결제사 거절 → 「환불 실패」 · 구독은 그대로(이용 중) · 다시 신청할 수 있음', rs and rs[0] == 'FAILED' and '환불 실패' in rs[1] and '이용 중' in t and 'refund' in acts(pg), (rs, acts(pg)))
        # 정상 → 환불 완료
        pg.select_option('#screen [data-pbv="pg"]', 'ok'); click(pg, '#screen [data-pb="refund"]')
        rs = refund_state(pg)
        rec('B-11 다시 신청(정상) → 「환불 완료」', rs and rs[0] == 'SUCCEEDED', rs)
        click(pg, '#screen [data-pb="reset"]')

        # ── C ──
        paint(pg, 'admbil')
        t = pg.inner_text('#screen')
        rows = pg.eval_on_selector_all('#screen [data-pb-box="adm"] [data-pb-row]', 'e=>e.map(x=>[x.getAttribute("data-pb-row"), x.textContent])')
        rec('C-1 운영 「청구 현황」에 「결제 · 환불 확인 필요」 4건 — 청구 2 · 환불 1 · 요청 1', [r[0] for r in rows] == ['inv', 'inv', 'ref', 'req'] and '확인 필요' in t, [r[0] for r in rows])
        rec('C-2 금액이 다르게 승인된 청구는 「자동으로 닫지 않습니다」 표시', any('금액이 다르게 승인됨' in r[1] for r in rows), [r[1][:40] for r in rows])
        rec('C-3 그 아래 기존 내용(청구 정책 · 청구 실패 · 오늘 시도)은 그대로', all(x in t for x in ('청구 정책', '청구 실패', '오늘 시도')))
        click(pg, '#screen [data-pb="reconcile"]')
        rows = pg.eval_on_selector_all('#screen [data-pb-box="adm"] [data-pb-row]', 'e=>e.map(x=>x.getAttribute("data-pb-row"))'); f = flash(pg, 'adm')
        rec('C-4 「지금 대조」 → 결제사에 조회해 닫히는 2건은 사라지고, 금액 불일치 · 결과 불명확 요청 2건은 남음', rows == ['inv', 'req'] and f and f[0] == 'ok' and '2건' in f[1], (rows, f))
        click(pg, '#screen [data-pb="reconcile"]')
        f = flash(pg, 'adm')
        rec('C-5 다시 대조 → 자동으로 닫을 것이 없다고 알림(남은 것을 지우지 않음)', f and f[0] == 'err' and cnt(pg, '#screen [data-pb-row]') == 2, f)
        click(pg, '#screen [data-pb="rreset"]')
        rec('C-6 「처음 상태로」 → 4건', cnt(pg, '#screen [data-pb-row]') == 4)

        # ── D ──
        dead = []
        for scr_key, box in (('mysub', 'my'), ('admbil', 'adm')):
            paint(pg, scr_key)
            n = cnt(pg, f'#screen [data-pb-box="{box}"] [data-pb]')
            for i in range(n):
                paint(pg, scr_key)
                before = pg.inner_html('#screen')
                pg.locator(f'#screen [data-pb-box="{box}"] [data-pb]').nth(i).click(); pg.wait_for_timeout(120)
                if pg.inner_html('#screen') == before: dead.append((scr_key, i))
        rec('D-1 두 자리의 버튼을 하나씩 — 무반응 0 · 오류 0', not dead and not errs, (dead, errs[:2]))

        # ── E ──
        pg.set_viewport_size({'width': 390, 'height': 800})
        ov = []
        for k in ('mysub', 'admbil'):
            paint(pg, k)
            w = pg.evaluate("(()=>{const b=document.querySelector('#screen [data-pb-box]');return b?b.scrollWidth-b.clientWidth:-1})()")
            ov.append((k, w))
        rec('E-1 390px — 두 자리 안에서 가로 넘침 없음', all(0 <= w <= 1 for _, w in ov), ov)
        b.close()

if __name__ == '__main__':
    try: main()
    except Exception as ex:
        import traceback; traceback.print_exc(); rec('실행 중 오류', False, repr(ex)[:300])
    ok = sum(1 for r in R if r['ok'] and not r.get('skip')); sk = sum(1 for r in R if r.get('skip'))
    json.dump({'items': R, 'pass': ok, 'total': len(R)}, open(os.path.join(OUT, 'proto_bill.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'통과 {ok} / {len(R) - sk}' + (f' · 건너뜀 {sk}(앞 판 시안 파일 없음)' if sk else ''))
