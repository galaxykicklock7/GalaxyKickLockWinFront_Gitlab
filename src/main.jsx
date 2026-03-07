import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Global handler for unhandled promise rejections
// Silently handle AbortErrors to prevent console spam
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason?.name === 'AbortError' || event.reason?.name === 'TimeoutError') {
    // Prevent the error from showing in console
    event.preventDefault();
    // Optionally log in dev mode only
    if (import.meta.env.DEV) {
      console.log('Caught AbortError (request was cancelled)');
    }
  }
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
