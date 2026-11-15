/* ---------------------------------------------------------------------
 * v10.311 (docs/434) — 법무 검토 묶음 부록 「요율 인상 공지 방식」(입점 약관 제17조 4항)
 *
 *   요율을 올릴 때 소개뱅크가 실제로 하는 일(예약 · 공지 · 개별 통지 · 읽음 · 다시 알림 · 시행 · 취소)과 남는 기록,
 *   지금 설정 · 숫자, 제17조 2항 요율 표 대조(v10.310), 법무에 물을 것 5가지를 한 칸으로. 읽기만 · 바깥 글꼴 · 스크립트 없음.
 *   ★ 검토를 돕는 자료 — 이 방식이 약관 · 법에 맞는지는 법무가 판단합니다.
 * ------------------------------------------------------------------- */

export interface RateNoticeInfo {
  noticeDays: number;
  autoRemindDays: number;
  clause4: string | null;
  counts: { total: number; scheduled: number; applied: number; canceled: number; noticed: number; reminds: number; autoReminds: number; snaps: number };
  channels: string;
  slots: Array<{ version: string; status: string; label: string; termText: string | null; rate: number | null; note: string }>;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function rateNoticeSection(x: RateNoticeInfo): string {
  const c = x.counts;
  const steps: Array<[string, string, string]> = [
    ['예약', `요율을 올려 영향받는 판매 중 · 정지 판매자가 있으면 바로 바꾸지 않고 예약합니다. 가장 이른 시행일 = 예약한 날(한국) + ${x.noticeDays}일(예약한 날을 빼고 꼬박 30일) — 서버와 DB 검사가 함께 막습니다.`, '예약 기록(고치거나 지울 수 없음)'],
    ['공지', '판매자에게만 보이는 소개몰 공지(맨 위 고정)를 게시합니다. 게시한 날 + 31일이 시행일보다 늦으면 게시가 막힙니다(그때는 예약을 취소하고 다시 정함). 날짜를 정해 그날 0시에 게시할 수도 있습니다.', '공지 · 게시 시각'],
    ['개별 통지', `예약 · 취소 · 시행 때 영향받는 판매자마다 사이트 안 알림을 보내고, 켜진 길로 메일 · 문자도 보냅니다(지금: ${x.channels}).`, '알림 · 발송 기록(보냄 · 대기 · 실패)'],
    ['읽음', '판매자센터에서 공지를 처음 · 마지막으로 펼친 때와 횟수를 남깁니다. 운영 화면에서 판매자별로 보고 CSV 로 내려받을 수 있습니다.', '공지 열람 기록'],
    ['다시 알림', `공지를 안 펼친 대상 판매자에게만 — 운영자가 24시간에 한 번 보낼 수 있고, 자동은 시행 n일 전에 한 번(지금: ${x.autoRemindDays > 0 ? `시행 ${x.autoRemindDays}일 전` : '꺼짐'}).`, '다시 알림 기록'],
    ['시행', '시행일 0시(한국)부터 들어오는 주문에 새 요율을 적용합니다(그 전 주문은 주문 때 요율 그대로). 시행 때 판매자별 열람 기록(시행 전에 읽었는지)을 굳혀 남기고 운영 알림을 냅니다.', '굳힌 열람 기록(고칠 수 없음)'],
    ['취소', '시행 전에만 · 사유를 적고 · 판매자에게 알리고 취소 공지를 게시할 수 있습니다.', '취소 기록'],
  ];
  const qs = [
    '「시행일 30일 전에 공지」를 공지를 게시한 날을 빼고 꼬박 30일(게시한 날 + 31일 ≤ 시행일)로 보는 것이 맞습니까?',
    '개별 통지를 사이트 안 알림 + 켜진 메일 · 문자로 하는 것이 제17조 4항의 「개별 통지」로 충분합니까? 메일 · 문자가 꺼져 있을 때도 그렇습니까?',
    '공지를 펼치지 않은 판매자에게도 시행일부터 새 요율을 적용해도 됩니까(다시 알림 · 열람 기록으로 보완)?',
    '「시행일 이후 접수된 주문부터」를 시행일 0시(한국) 이후 결제된 주문으로 보는 것이 맞습니까?',
    '공지 · 열람 · 발송 기록을 얼마나 보관해야 합니까(지금은 지우지 않음)?',
  ];
  const slotRows = x.slots.map((s) => `<tr><td>${esc(s.version)} · ${esc(s.status)}</td><td>${esc(s.label)}</td><td>${s.termText === null ? '줄 없음' : esc(s.termText)}</td><td>${s.rate === null ? '비어 있음(갈래 요율)' : `${s.rate}%`}</td><td>${esc(s.note)}</td></tr>`).join('');
  return `
<section class="term" id="rate-notice">
  <h2>부록 — 요율 인상 공지 방식 <small>입점 약관 제17조 4항 · 법무 확인 요청</small></h2>
  <table class="meta">
    <tr><th>약관 글</th><td>${x.clause4 ? esc(x.clause4) : '입점 약관 초안에 제17조 4항이 없습니다.'}</td></tr>
    <tr><th>지금까지</th><td>요율 예약 ${c.total}건(예정 ${c.scheduled} · 시행 ${c.applied} · 취소 ${c.canceled}) · 공지 게시 ${c.noticed}건 · 다시 알림 ${c.reminds}번(자동 ${c.autoReminds}) · 굳힌 열람 기록 ${c.snaps}줄</td></tr>
  </table>
  <h3>소개뱅크가 하는 일</h3>
  <table class="sum"><thead><tr><th>단계</th><th>하는 일</th><th>남는 기록</th></tr></thead><tbody>
  ${steps.map(([a, b, d]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td><td>${esc(d)}</td></tr>`).join('\n  ')}
  </tbody></table>
  <h3>제17조 2항 요율 표 ↔ 운영 「입점 유형 요율」</h3>
  <table class="sum"><thead><tr><th>약관 판</th><th>입점 유형</th><th>약관 칸</th><th>운영 요율</th><th>대조</th></tr></thead><tbody>${slotRows || '<tr><td colspan="5">입점 약관이 없습니다.</td></tr>'}</tbody></table>
  <h3>법무에 묻는 것</h3>
  <table class="meta">
  ${qs.map((q, i) => `<tr><th>${i + 1}</th><td>${esc(q)}<br>□ 맞음 &nbsp; □ 고쳐야 함 &nbsp; 의견 ________________________________</td></tr>`).join('\n  ')}
    <tr><th>확인</th><td>확인한 사람 ______ &nbsp; 날짜 ______</td></tr>
  </table>
</section>`;
}

/** 묶음 HTML 의 </body> 앞에 부록을 넣고 맨 위 안내에 한 줄 */
export function withRateNotice(html: string, section: string): string {
  const i = html.lastIndexOf('</body>');
  const body = i < 0 ? html + section : html.slice(0, i) + section + '\n' + html.slice(i);
  return body.replace('</p>\n<table class="sum">', '<br>맨 끝 부록: 요율 인상 공지 방식(입점 약관 제17조 4항) — 법무에 묻는 것 5가지.</p>\n<table class="sum">');
}
