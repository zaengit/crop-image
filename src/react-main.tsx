import React from 'react'
import { createRoot } from 'react-dom/client'
import './tailwind.css'
import { App } from './App'

// Transitional compatibility for migrated modules that still call React.useState/useRef.
// React itself is bundled by Vite; no CDN or type shim is used.
;(globalThis as any).React = React

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root mount element.')

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
