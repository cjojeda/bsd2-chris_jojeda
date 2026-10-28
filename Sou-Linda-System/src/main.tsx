import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import MobileReports from './pages/MobileReports';
import AgileApp from './alternative/AgileApp';
import './styles.css';
if(window.isSecureContext && 'serviceWorker' in navigator && !location.pathname.startsWith('/mobile')) registerSW({ immediate: true, onOfflineReady() { window.dispatchEvent(new Event('sadi:offline-ready')); }, onNeedRefresh() { window.dispatchEvent(new Event('sadi:update-ready')); }, onRegisterError() { console.warn('No se pudo instalar la interfaz local.'); } });
class ErrorBoundary extends React.Component<{children:React.ReactNode}, {error:boolean}> {
  state = {error:false};
  static getDerivedStateFromError(){return {error:true};}
  render(){return this.state.error ? <main className="fatal"><h1>No pudimos abrir Sou Linda System</h1><p>Recargá la aplicación y verificá que el motor local continúe abierto en la notebook.</p><button className="btn btn-primary" onClick={()=>location.reload()}>Recargar</button></main> : this.props.children;}
}
const path=location.pathname.replace(/\/$/,'');
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary>{path==='/mobile'?<MobileReports/>:path==='/agil'?<AgileApp/>:<App/>}</ErrorBoundary></React.StrictMode>);
