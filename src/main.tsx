import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import WebCodecsRecorder from './WebCodecsRecorder.tsx';
import './index.css';

const isHeadless = new URLSearchParams(window.location.search).has('headless-record');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isHeadless ? <WebCodecsRecorder /> : <App />}
  </StrictMode>,
);
