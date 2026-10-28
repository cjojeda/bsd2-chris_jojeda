/** The browser never owns the primary database. SQLite stays on the notebook. */
import { api } from './api';
import type { Snapshot } from '../domain/types';
export const readSnapshot = ():Promise<Snapshot> => api('/snapshot');
