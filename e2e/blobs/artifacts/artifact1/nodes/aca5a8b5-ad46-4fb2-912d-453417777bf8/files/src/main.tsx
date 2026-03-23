import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AlertDialogProvider } from './components/AlertDialog'
import { ToastProvider } from './components/Toast'
import './i18n' // 初始化 i18n
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AlertDialogProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </AlertDialogProvider>
  </StrictMode>,
)
