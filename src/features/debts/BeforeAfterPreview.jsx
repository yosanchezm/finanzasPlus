// Before/after table shared by the plan change dialogs. `rows`: [{ label, before, after }] with display values;
// `children` is a footnote under the table (for example "no installment changes").
export default function BeforeAfterPreview({ rows, children }) {
  return (
    <div role="group" aria-label="Vista previa" className="flex flex-col gap-3 rounded-sm bg-surface-2 p-4">
      <span className="text-[13px] font-semibold text-ink-2">Vista previa: así quedaría, aún no se guardó.</span>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[13px] text-ink-muted">
            <td />
            <th scope="col" className="pb-1 text-right font-medium">Antes</th>
            <th scope="col" className="pb-1 pl-3 text-right font-medium">Después</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, before, after }) => (
            <tr key={label} className="border-t border-[#eef1ed] first:border-t-0">
              <th scope="row" className="py-2 pr-3 text-left font-normal text-ink-muted">{label}</th>
              <td className="py-2 text-right text-ink tabular-nums">{before}</td>
              <td className="py-2 pl-3 text-right font-semibold text-ink tabular-nums">{after}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {children}
    </div>
  );
}
