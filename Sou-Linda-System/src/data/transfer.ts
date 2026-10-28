/** File operations use the notebook's SQLite database; browser storage is not authoritative. */
import { api, apiBlob, dataChanged, mutate } from './api';

export type ImportKind = 'variants' | 'sales';
export type ExportKind = ImportKind | 'expenses';
export type ExportFormat = 'csv' | 'xlsx';
export const VARIANT_HEADERS = ['modelo','categoria','sku','talle','color','costo','pvp','mayorista','stock','stock_minimo'] as const;
export const SALE_HEADERS = ['id_externo','fecha','sku','cantidad','precio_unitario','costo_unitario','canal','medio_pago','envio','packaging','descuento','comision_porcentaje','cliente','cliente_id','fecha_cobro'] as const;
export const REQUIRED_HEADERS: Record<ImportKind, readonly string[]> = {
  variants:['modelo','sku','talle','color','costo','pvp','mayorista','stock'],
  sales:['id_externo','fecha','sku','cantidad','precio_unitario','canal','medio_pago'],
};
export interface UploadedFile { fileName: string; contentBase64: string }
export interface InspectedFile extends UploadedFile { headers: string[]; firstRows: Record<string,string>[]; rowCount: number }
export interface ImportPreview { previewId: string; headers: string[]; rows: Record<string,string>[]; rowCount: number; errors: string[]; warnings: string[]; documentCount: number; ready: boolean; expiresInSeconds: number }
export interface BackupValidation { counts: Record<string,number>; schemaVersion: number; formatVersion: number }
export interface RestoreResult { counts: Record<string,number>; previousBackup: string }
export interface ImportResult { count: number; ids: string[] }

const stamp = () => new Date().toISOString().replaceAll(':','-').replace(/\.\d{3}Z$/, 'Z');
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}
export async function downloadBackup(): Promise<void> {
  download(await apiBlob('/backup'), `sou-linda-backup-${stamp()}.json`);
  dataChanged();
}
export async function downloadSQLiteBackup(): Promise<void> {
  download(await apiBlob('/backup/sqlite'), `sou-linda-base-${stamp()}.sqlite3`);
  dataChanged();
}
export const validateBackup = (content: string): Promise<BackupValidation> => api('/backup/validate', {method:'POST',body:JSON.stringify({content})});
async function replaceDatabase<T>(path: string, payload: unknown): Promise<T> {
  // Pause draft autosave before sending a destructive request. Validation alone
  // never sends this event, so choosing an invalid file cannot interrupt the POS.
  window.dispatchEvent(new Event('sadi:database-restoring'));
  try {
    const result = await api<T>(path, {method:'POST',body:JSON.stringify(payload)});
    window.dispatchEvent(new Event('sadi:database-replaced'));
    dataChanged();
    return result;
  } catch (error) {
    // The server keeps its previous database on failure; reload that draft and
    // release the UI pause instead of leaving the POS permanently disabled.
    window.dispatchEvent(new Event('sadi:database-restore-failed'));
    throw error;
  }
}
export async function restoreBackup(content: string, confirmed: boolean): Promise<RestoreResult> {
  return replaceDatabase<RestoreResult>('/backup/restore', {content, confirmed});
}
export async function clearDemoData(confirmation: string): Promise<{cleared:boolean;previousBackup:string}> {
  return replaceDatabase('/demo/clear', {confirmation});
}
export async function readImportFile(file: File): Promise<InspectedFile> {
  if (!/\.(csv|xlsx)$/i.test(file.name)) throw new Error('Elegí un archivo CSV o Excel .xlsx.');
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('El archivo está vacío o supera 10 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  const upload = {fileName:file.name,contentBase64:btoa(binary)};
  const inspected = await api<{headers:string[];firstRows:Record<string,string>[];rowCount:number}>('/imports/inspect', {method:'POST',body:JSON.stringify(upload)});
  return {...upload,...inspected};
}
export const previewImport = (file: UploadedFile, kind: ImportKind, mapping: Record<string,string>, sourceAccount: string): Promise<ImportPreview> =>
  api('/imports/preview', {method:'POST',body:JSON.stringify({...file,kind,mapping,sourceAccount})});
export const commitImport = (preview: ImportPreview, acknowledgeWarnings: boolean): Promise<ImportResult> =>
  mutate('/imports/apply', {previewId:preview.previewId,acknowledgeWarnings});
export async function downloadTemplate(kind: ImportKind): Promise<void> {
  download(await apiBlob(`/templates/${kind}`), `plantilla-${kind}.csv`);
}
export async function exportTable(kind: ExportKind, format: ExportFormat): Promise<void> {
  download(await apiBlob(`/exports?kind=${encodeURIComponent(kind)}&format=${encodeURIComponent(format)}`), `sou-linda-${kind}.${format}`);
}
