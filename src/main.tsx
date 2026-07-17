import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './glossity-theme.css';

const root = document.getElementById('root');

if (!root) throw new Error('Format Forge could not find its app root.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
