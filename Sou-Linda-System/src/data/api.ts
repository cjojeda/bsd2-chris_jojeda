let csrfToken: string | null = null;
let sessionRequest: Promise<void> | null = null;

async function ensureSession() {
  if (csrfToken) return;
  if (!sessionRequest) sessionRequest = fetch('/api/session', {credentials:'same-origin',cache:'no-store'})
    .then(async response => { if (!response.ok) throw new Error('Abrí Sou Linda System desde la notebook para administrar el negocio.'); const data = await response.json(); if(typeof data.csrfToken!=='string'||!data.csrfToken)throw new Error('La sesión local no es válida. Recargá la aplicación.');csrfToken = data.csrfToken; })
    .finally(()=>{sessionRequest=null;});
  return sessionRequest;
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  await ensureSession();
  const response = await fetch(`/api${path}`, { ...options, credentials:'same-origin', cache:'no-store', headers: { ...(options.body instanceof FormData ? {} : {'Content-Type':'application/json'}), 'X-SADI-CSRF':csrfToken!, ...options.headers } });
  if (!response.ok) {
    if(response.status===401)csrfToken=null;
    const data=await response.json().catch(()=>({detail:'No se pudo completar la operación.'}));
    throw new Error(typeof data.detail==='string'?data.detail:'Revisá los datos de la operación.');
  }
  return response.status===204?undefined as T:response.json();
}
export async function apiBlob(path:string,options:RequestInit={}):Promise<Blob>{
  await ensureSession();
  const response=await fetch(`/api${path}`,{...options,credentials:'same-origin',cache:'no-store',headers:{'X-SADI-CSRF':csrfToken!,...options.headers}});
  if(!response.ok){const data=await response.json().catch(()=>({detail:'No se pudo generar el archivo.'}));throw new Error(typeof data.detail==='string'?data.detail:'No se pudo generar el archivo.');}
  return response.blob();
}
export function dataChanged(){window.dispatchEvent(new Event('sadi:data-changed'));}
export async function mutate<T>(path:string,payload:unknown):Promise<T>{const result=await api<T>(path,{method:'POST',body:JSON.stringify(payload)});dataChanged();return result;}
