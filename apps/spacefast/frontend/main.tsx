import React from 'react';
import { createRoot } from 'react-dom/client';
import '@wordpress/components/build-style/style.css';
import '@wordpress/dataviews/build-style/style.css';
import './styles.css';
import App from './App';

const container = document.getElementById('root');
if (!container) throw new Error('Application mount point is missing.');
createRoot(container).render(<React.StrictMode><App /></React.StrictMode>);
