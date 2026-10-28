import { useEffect, useReducer, useState } from 'react';
import { readSnapshot } from '../data/db';
import type { Snapshot } from '../domain/types';

export function useNotebookData() {
  const [data,setData]=useState<Snapshot|null>(null);
  const [error,setError]=useState('');
  const [revision,retry]=useReducer((n:number)=>n+1,0);
  useEffect(()=>{
    let active=true,inFlight=false,refreshAgain=false;
    const refresh=async()=>{
      if(inFlight){refreshAgain=true;return;}
      inFlight=true;
      try{const snapshot=await readSnapshot();if(active){setData(snapshot);setError('');}}
      catch(e){if(active)setError(e instanceof TypeError?'No se pudo conectar con la notebook. Verificá que el motor de Sou Linda System siga abierto.':e instanceof Error?e.message:'No se pudieron leer los datos del negocio.');}
      finally{inFlight=false;if(active&&refreshAgain){refreshAgain=false;void refresh();}}
    };
    const visibleRefresh=()=>{if(document.visibilityState!=='hidden')void refresh();};
    void refresh();
    window.addEventListener('sadi:data-changed',visibleRefresh);
    window.addEventListener('focus',visibleRefresh);
    document.addEventListener('visibilitychange',visibleRefresh);
    const interval=setInterval(visibleRefresh,10000);
    return()=>{active=false;clearInterval(interval);window.removeEventListener('sadi:data-changed',visibleRefresh);window.removeEventListener('focus',visibleRefresh);document.removeEventListener('visibilitychange',visibleRefresh);};
  },[revision]);
  return {data,error,retry};
}
