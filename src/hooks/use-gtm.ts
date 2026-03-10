import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

declare global {
  interface Window { dataLayer: Record<string, unknown>[]; }
}

let gtmInjected = false;

function injectGTM(containerId: string) {
  if (gtmInjected) return;
  gtmInjected = true;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${containerId}`;
  document.head.insertBefore(script, document.head.firstChild);
  const noscript = document.createElement('noscript');
  const iframe = document.createElement('iframe');
  iframe.src = `https://www.googletagmanager.com/ns.html?id=${containerId}`;
  iframe.height = '0'; iframe.width = '0';
  iframe.style.display = 'none'; iframe.style.visibility = 'hidden';
  noscript.appendChild(iframe);
  document.body.insertBefore(noscript, document.body.firstChild);
}

export function useGTM() {
  const location = useLocation();
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    // GTM container ID can be set via environment or hardcoded
    const containerId = (import.meta as any).env?.VITE_GTM_CONTAINER_ID;
    if (containerId) injectGTM(containerId);
  }, []);

  useEffect(() => {
    if (!window.dataLayer) return;
    window.dataLayer.push({ event: 'page_view', page_path: location.pathname + location.search });
  }, [location.pathname, location.search]);
}
