import SettingsView from './SettingsView';
import { useLegalRates } from './useLegalRates';

/**
 * Data container for Ajustes: loads the household legal rates when the section mounts.
 * Any household member can edit them; the signed-in user is recorded as the actor of each write.
 */
export default function SettingsContainer({ user, onNotify }) {
  const legalRates = useLegalRates({ actorId: user.$id });
  return <SettingsView legalRates={legalRates} onNotify={onNotify} />;
}
