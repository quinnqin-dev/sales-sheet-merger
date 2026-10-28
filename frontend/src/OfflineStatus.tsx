import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useI18n } from './i18n';
export function OfflineStatus({running}:{running:boolean}) {
 const {t}=useI18n();
 const [waiting,setWaiting]=useState<ServiceWorker|null>(null),[dismissed,setDismissed]=useState(false);
 const [offlineReady,setOfflineReady]=useState(false);
 const mayReload=useRef(false),busy=useRef(running);busy.current=running;
 useEffect(()=>{
  if(!('serviceWorker' in navigator)||!import.meta.env.PROD)return;
  let live=true;
  const controller=()=>{if(mayReload.current&&!busy.current)location.reload();};
  navigator.serviceWorker.addEventListener('controllerchange',controller);
  const check=(reg:ServiceWorkerRegistration)=>{
   if(reg.waiting&&navigator.serviceWorker.controller&&live){setWaiting(reg.waiting);setDismissed(false);}
  };
  void navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(reg=>{
   check(reg);reg.addEventListener('updatefound',()=>{reg.installing?.addEventListener('statechange',()=>check(reg));});
   void navigator.serviceWorker.ready.then(()=>{if(live)setOfflineReady(true);});
  }).catch(()=>{/* Registration may be unavailable in private browsing or on the first offline visit. */});
  return ()=>{live=false;navigator.serviceWorker.removeEventListener('controllerchange',controller);};
 },[]);
 if(waiting&&!dismissed)return <div className="offline-banner" role="status">
  <span>{t(running?'offline.updateBusy':'offline.updateAvailable')}</span>
  <button className="btn secondary" disabled={running} onClick={()=>{if(busy.current)return;mayReload.current=true;waiting.postMessage({type:'ACTIVATE_UPDATE'});}}>{t('offline.refresh')}</button>
  <button className="icon-btn" aria-label={t('ui.dismissNotification')} onClick={()=>setDismissed(true)}><X size={16}/></button>
 </div>;
 return offlineReady?<div className="offline-ready" role="status">{t('offline.ready')}</div>:null;
}
