import React, { useState, useEffect, useCallback, useRef } from 'react'
import './Toast.css'

// ============================================================================
// Toast 通知组件
// ============================================================================

type ToastType = 'success' | 'info' | 'error'

interface ToastItem {
  id: number
  message: string
  type: ToastType
  exiting?: boolean
}

let nextId = 0
const MAX_TOASTS = 3
const DEFAULT_DURATION = 2000

let addToastFunction: ((message: string, type?: ToastType, duration?: number) => void) | null = null

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const removeToast = useCallback((id: number) => {
    // Start exit animation
    setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t))
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 200)
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
  }, [])

  const addToast = useCallback((message: string, type: ToastType = 'info', duration: number = DEFAULT_DURATION) => {
    const id = nextId++
    setToasts(prev => {
      const next = [...prev, { id, message, type }]
      // Keep only the latest MAX_TOASTS
      if (next.length > MAX_TOASTS) {
        const removed = next.shift()
        if (removed) {
          const timer = timersRef.current.get(removed.id)
          if (timer) {
            clearTimeout(timer)
            timersRef.current.delete(removed.id)
          }
        }
      }
      return next
    })

    const timer = setTimeout(() => {
      removeToast(id)
      timersRef.current.delete(id)
    }, duration)
    timersRef.current.set(id, timer)
  }, [removeToast])

  useEffect(() => {
    addToastFunction = addToast
    return () => { addToastFunction = null }
  }, [addToast])

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach(timer => clearTimeout(timer))
      timersRef.current.clear()
    }
  }, [])

  return (
    <>
      {children}
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map(toast => (
            <div
              key={toast.id}
              className={`toast toast-${toast.type} ${toast.exiting ? 'toast-exit' : ''}`}
              onClick={() => removeToast(toast.id)}
            >
              <span className="toast-icon">
                {toast.type === 'success' && '✓'}
                {toast.type === 'info' && 'ℹ'}
                {toast.type === 'error' && '✕'}
              </span>
              <span className="toast-message">{toast.message}</span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export const showToast = (message: string, type?: ToastType, duration?: number) => {
  if (addToastFunction) {
    addToastFunction(message, type, duration)
  } else {
    console.warn('ToastProvider not mounted')
  }
}
