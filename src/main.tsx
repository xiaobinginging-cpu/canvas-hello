import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './logo-animations.css'
import './text-card-editor.css'
import App from './App.tsx'
import LogoSplash from './components/logo/LogoSplash.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <LogoSplash>
        <App />
      </LogoSplash>
    </BrowserRouter>
  </StrictMode>,
)
