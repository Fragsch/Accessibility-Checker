import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './stil.css';

const wurzel = document.getElementById('wurzel');
if (!wurzel) throw new Error('Der Anker der Oberfläche fehlt im HTML.');

createRoot(wurzel).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
