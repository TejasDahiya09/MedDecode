import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { AppProviders } from './providers/AppProviders';
import './styles/globals.css';

const root = document.getElementById('root');
if (!root) throw new Error('The application root element is missing.');
createRoot(root).render(<StrictMode><AppProviders><App /></AppProviders></StrictMode>);
