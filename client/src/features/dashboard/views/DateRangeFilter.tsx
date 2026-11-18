import s from '@/styles/features/dashboard/views/views.module.css';

export interface DateRange { from: string; to: string }

export function DateRangeFilter({ range, onChange }: { range: DateRange; onChange: (r: DateRange) => void }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span className={s.muted} style={{ fontSize: 12 }}>Date range</span>
      <input
        type="date"
        className={s.filterInput}
        style={{ flex: 'none', minWidth: 0, width: 140, padding: '5px 9px' }}
        value={range.from}
        max={range.to || undefined}
        onChange={e => onChange({ ...range, from: e.target.value })}
      />
      <span className={s.muted} style={{ fontSize: 12 }}>to</span>
      <input
        type="date"
        className={s.filterInput}
        style={{ flex: 'none', minWidth: 0, width: 140, padding: '5px 9px' }}
        value={range.to}
        min={range.from || undefined}
        onChange={e => onChange({ ...range, to: e.target.value })}
      />
      {(range.from || range.to) && (
        <button type="button" className={s.linkMini} onClick={() => onChange({ from: '', to: '' })}>
          Clear
        </button>
      )}
    </span>
  );
}
