import { inputClass } from '../../../../shared/ui/TextField';
import { cn } from '../../../../shared/ui/cn';
import { CHARGE_PRESETS } from '../wizardModel';

export default function ChargesStep({ charges, dispatch }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">Opcional. Marca lo que el banco suma a cada cuota; no cambia lo que debes de capital.</p>
      {CHARGE_PRESETS.map((preset) => {
        const checked = preset.key in charges;
        const blocked = Boolean(preset.requires) && !(preset.requires in charges);
        return (
          <div key={preset.key} className={cn('flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-1', blocked && 'opacity-60')}>
            <label className="flex min-h-11 flex-1 items-center gap-3 text-sm font-medium text-ink">
              <input
                type="checkbox"
                className="size-5 accent-accent"
                checked={checked}
                disabled={blocked}
                onChange={(event) => dispatch({ type: 'charge', key: preset.key, value: event.target.checked ? (preset.defaultValue ?? '') : null })}
              />
              {preset.label}
            </label>
            {checked && (
              <span className="flex items-center gap-2">
                <input
                  aria-label={`Valor de ${preset.label}`}
                  type="number"
                  step="any"
                  inputMode="decimal"
                  placeholder={preset.placeholder}
                  value={charges[preset.key]}
                  onChange={(event) => dispatch({ type: 'charge', key: preset.key, value: event.target.value })}
                  className={cn(inputClass, 'w-28 px-3 tabular-nums')}
                />
                <span className="text-[13px] text-ink-muted">{preset.unit}</span>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
