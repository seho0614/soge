import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/sgb-tokens.css';
import './styles/sgb-buttons.css';
import './styles/erp.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
