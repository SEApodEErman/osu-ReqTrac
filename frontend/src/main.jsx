import React from 'react';
import ReactDOM from 'react-dom/client';
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill';
import flagFontUrl from 'country-flag-emoji-polyfill/dist/TwemojiCountryFlags.woff2?url';
import App from './App';
import './index.css';

// Windows has no flag emoji and shows two letters instead. Load the bundled
// Twemoji flag font only where flags are missing (never from a CDN).
polyfillCountryFlagEmojis('Twemoji Country Flags', flagFontUrl);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
