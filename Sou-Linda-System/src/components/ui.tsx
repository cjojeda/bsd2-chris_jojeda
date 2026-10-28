import { Children, cloneElement, isValidElement, useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react';
import { PackageOpen, X } from 'lucide-react';
export function Modal({title,onClose,children,wide=false}:{title:string;onClose:()=>void;children:ReactNode;wide?:boolean}){
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(()=>{const el=dialog.current;el?.showModal();return()=>el?.close();},[]);
  return <dialog ref={dialog} className={`modal ${wide?'modal-wide':''}`} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget)onClose();}} aria-label={title}><div className="modal-heading"><h2>{title}</h2><button className="icon-btn" aria-label="Cerrar ventana" onClick={onClose}><X size={20}/></button></div><div className="modal-body">{children}</div></dialog>;
}
export function Field({label,children,hint}:{label:string;children:ReactNode;hint?:string}){
  const id=useId();
  const controls=Children.map(children,child=>{
    if(!isValidElement(child)||!['input','select','textarea'].includes(String(child.type)))return child;
    const element=child as ReactElement<Record<string,unknown>>;
    return cloneElement(element,{'aria-labelledby':element.props['aria-label']?undefined:id,'aria-describedby':hint?`${id}-hint`:undefined});
  });
  return <label className="field"><span id={id}>{label}</span>{controls}{hint&&<small id={`${id}-hint`}>{hint}</small>}</label>;
}
export function EmptyState({title,detail,action}:{title:string;detail:string;action?:ReactNode}){return <div className="empty"><div className="empty-icon"><PackageOpen size={28}/></div><h3>{title}</h3><p>{detail}</p>{action}</div>;}
