import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import './styles/theme.css';
import { Toaster } from './ui/primitives.js';
import { CrtLayer } from './ui/crt.js';
import { InstallPrompt } from './ui/install-prompt.js';
import Landing from './routes/Landing.js';
import AdminLogin from './routes/AdminLogin.js';
import AdminSignup from './routes/AdminSignup.js';
import AdminDashboard from './routes/AdminDashboard.js';
import RoomPage from './routes/RoomPage.js';
import ResultsPage from './routes/ResultsPage.js';
import UiGallery from './routes/UiGallery.js';
import PacmanHarness from './routes/PacmanHarness.js';

/** A route that already claimed focus (autoFocus on the code input) wins. */
function RouteFocus(): null {
  const { pathname } = useLocation();
  React.useEffect(() => {
    const main = document.querySelector('main');
    if (!(main instanceof HTMLElement)) return;
    const active = document.activeElement;
    if (active && active !== document.body && main.contains(active)) return;
    main.setAttribute('tabindex', '-1');
    main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function App() {
  return (
    <BrowserRouter>
      <CrtLayer />
      <Toaster />
      <InstallPrompt />
      <RouteFocus />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin/signup" element={<AdminSignup />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/r/:code" element={<RoomPage />} />
        <Route path="/r/:code/results" element={<ResultsPage />} />
        {/* The visual proof surface, dev only. */}
        {import.meta.env.DEV && <Route path="/ui" element={<UiGallery />} />}
        {import.meta.env.DEV && <Route path="/dev/pacman" element={<PacmanHarness />} />}
        <Route path="*" element={<Landing />} />
      </Routes>
    </BrowserRouter>
  );
}

/*
 * The service worker is what makes the app installable, and it is registered
 * after load so it never competes with the first paint. Dev is excluded: a
 * worker caching a hot-reloading bundle is nothing but confusion.
 */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
