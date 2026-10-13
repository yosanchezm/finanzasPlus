import { Banknote, Car, CircleHelp, Handshake, HandCoins, House, Landmark, Users } from 'lucide-react';
import { formatDate } from '../../shared/lib/format';

/** Loan kinds the create wizard offers (cards arrive with their own flow). */
export const DEBT_KINDS = [
  { value: 'consumer', label: 'Consumo', icon: Banknote, hint: 'Libre inversión u otro crédito de consumo' },
  { value: 'vehicle', label: 'Vehículo', icon: Car, hint: 'Crédito para carro o moto' },
  { value: 'mortgage', label: 'Hipotecario', icon: House, hint: 'Vivienda, en pesos' },
  { value: 'libranza', label: 'Libranza', icon: Landmark, hint: 'Cuota descontada de la nómina' },
  { value: 'leasing', label: 'Leasing', icon: HandCoins, hint: 'Cuotas con un pago final grande' },
  { value: 'family', label: 'Familiar', icon: Users, hint: 'Préstamo de un familiar o amigo, con o sin intereses' },
  { value: 'informal', label: 'Informal', icon: Handshake, hint: 'Sin plan de cuotas: solo llevas el saldo' },
  { value: 'other', label: 'Otro', icon: CircleHelp, hint: 'Pagos irregulares que defines tú' },
];

export const kindInfo = (kind) => DEBT_KINDS.find((item) => item.value === kind) ?? { value: kind, label: 'Deuda', icon: CircleHelp };

const percent = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });

/** "28,32 % E.A." or "Sin intereses". */
export const formatEa = (eaPercent) => (eaPercent > 0 ? `${percent.format(eaPercent)} % E.A.` : 'Sin intereses');

/** Short date ("5 nov") of a stored YYYY-MM-DD, free of time-zone drift. */
export const formatDueDate = (isoDate) => formatDate(`${isoDate}T12:00:00`);
