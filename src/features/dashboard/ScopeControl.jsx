import { SegmentedControl } from '../../shared/ui/SegmentedControl';

const SCOPE_OPTIONS = [
  { value: 'total', label: 'Hogar' },
  { value: 'you', label: 'Tú' },
  { value: 'partner', label: 'Pareja' },
];

/** Whose money the views show: the whole household, the signed-in member, or the partner. */
export function ScopeControl({ scope, onScopeChange }) {
  return <SegmentedControl label="Ver datos de" options={SCOPE_OPTIONS} value={scope} onChange={onScopeChange} />;
}
