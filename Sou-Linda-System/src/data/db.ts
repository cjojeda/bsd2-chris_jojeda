/** The browser never owns the primary database. SQLite stays on the notebook. */
import { api } from './api';
import type { Snapshot } from '../domain/types';
import { configureCurrency } from '../domain/format';
export const readSnapshot = async():Promise<Snapshot> => {
  const snapshot=await api<Snapshot>('/snapshot');
  const code=snapshot.settings.find(setting=>setting.key==='currency')?.value??'ARS';
  if(code!=='PYG'&&code!=='ARS')throw new Error('La base tiene una moneda no compatible. No se reinterpretaron sus importes.');
  configureCurrency(code);
  return snapshot;
};
