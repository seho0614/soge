/**
 * v10.29 — 화면 안 상태 거르개(시안 .tabs2 — 「승인 대기 12」처럼 숫자가 붙은 둥근 단추).
 *
 * 하위 탭(SubTabs · .subtabs)과 달리 화면을 바꾸지 않고 같은 목록을 거릅니다.
 * 클래스가 .subtabs 가 아니라 .ad-flt 라서 화면 시험이 하위 탭으로 세지 않습니다.
 */
export function Pills<K extends string>({ items, value, onChange, label, small }: {
  items: [K, string, number?][]; value: K; onChange: (k: K) => void; label?: string; small?: boolean;
}) {
  return (
    <div className={`ad-flt${small ? ' sm' : ''}`} role="tablist" aria-label={label}>
      {items.map(([k, t, n]) => (
        <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'on' : ''}
                onClick={() => onChange(k)} data-pill={k}>
          {t}{n != null && <i>{n.toLocaleString('ko-KR')}</i>}
        </button>
      ))}
    </div>
  );
}
