import { afterEach,describe,expect,it,vi } from 'vitest';

afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
describe('sesión local y límites de reintento',()=>{
  it('comparte la sesión simultánea y envía CSRF en la escritura',async()=>{
    const fetchMock=vi.fn().mockImplementation(async(path:string)=>new Response(JSON.stringify(path==='/api/session'?{csrfToken:'secret'}:{ok:true}),{status:200}));
    vi.stubGlobal('fetch',fetchMock);
    const {api}=await import('../src/data/api');
    await Promise.all([api('/snapshot'),api('/reports/monthly')]);
    expect(fetchMock.mock.calls.filter(call=>call[0]==='/api/session')).toHaveLength(1);
    await api('/sales',{method:'POST',body:'{}'});
    const options=fetchMock.mock.calls.at(-1)![1];
    expect(options.headers['X-SADI-CSRF']).toBe('secret');
    expect(options.credentials).toBe('same-origin');
    expect(options.cache).toBe('no-store');
  });
  it('no repite una operación financiera ante un error de sesión',async()=>{
    const fetchMock=vi.fn().mockResolvedValueOnce(new Response('{"csrfToken":"secret"}')).mockResolvedValueOnce(new Response('{"detail":"Sesión terminada"}',{status:401}));
    vi.stubGlobal('fetch',fetchMock);
    const {api}=await import('../src/data/api');
    await expect(api('/sales',{method:'POST',body:'{}'})).rejects.toThrow('Sesión terminada');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
