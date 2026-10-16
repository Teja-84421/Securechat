import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { api } from './api';
import { initViewport } from './viewport';
import { registerServiceWorker } from './pwa';
import './install'; // starts listening for the "install app" prompt as early as possible
import './index.css';

initViewport();
registerServiceWorker();
// Free hosting puts the server to sleep when it's idle; a tiny request now wakes it up while the page is being read
api.googleConfig().catch(() => {});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
