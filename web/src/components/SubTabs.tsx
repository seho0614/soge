/**
 * 화면 안의 하위 탭.
 *
 * 한 탭에 화면 ID 가 여럿 걸린 경우(예: 관 관리 = 목록 · 새 관 · 설정 · 공유 경계)
 * 여기서 나눕니다. 각 항목의 id 는 화면 ID 이며 data-screen 으로 남겨
 * 검정이 어느 화면인지 찾을 수 있게 합니다.
 */
/** out — 누르면 다른 탭으로 옮겨 가는 항목(시안 하위 탭 줄에 있으나 화면은 다른 탭에 있음). data-out 으로 남겨 검정이 상태 전환으로 세지 않게 합니다(v10.31) */
export interface SubTab<K extends string> { key: K; label: string; screen: string; hidden?: boolean; out?: boolean }

export function SubTabs<K extends string>({ tabs, value, onChange }: {
  tabs: SubTab<K>[]; value: K; onChange: (k: K) => void;
}) {
  return (
    <div className="subtabs" role="tablist">
      {tabs.filter((t) => !t.hidden).map((t) => (
        <button key={t.key} role="tab" data-screen={t.screen} data-out={t.out ? '' : undefined}
                aria-selected={value === t.key}
                className={value === t.key ? 'on' : ''}
                onClick={() => onChange(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
