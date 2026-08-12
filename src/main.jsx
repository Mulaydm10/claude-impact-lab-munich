import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { TrustStoreProvider } from './store/TrustStoreContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <TrustStoreProvider>
      <App />
    </TrustStoreProvider>
  </StrictMode>,
)
