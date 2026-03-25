import React, { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import './AlertDialog.css'

// ============================================================================
// Alert Dialog
// ============================================================================

interface AlertDialogProps {
  message: string
  onClose: () => void
}

const AlertDialog: React.FC<AlertDialogProps> = ({ message, onClose }) => {
  const { t } = useTranslation('common')
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  return (
    <div className="alert-dialog-overlay" onClick={onClose}>
      <div className="alert-dialog-content" onClick={(e) => e.stopPropagation()}>
        <div className="alert-dialog-message">{message}</div>
        <div className="alert-dialog-actions">
          <button className="alert-dialog-button" onClick={onClose}>
            {t('confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Confirm Dialog
// ============================================================================

interface ConfirmDialogProps {
  message: string
  onConfirm: () => void
  onCancel: () => void
  confirmText?: string
  cancelText?: string
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ 
  message, 
  onConfirm, 
  onCancel,
  confirmText,
  cancelText
}) => {
  const { t } = useTranslation('common')
  const resolvedConfirmText = confirmText || t('confirm')
  const resolvedCancelText = cancelText || t('cancel')
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel()
      }
    }
    
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onCancel])

  return (
    <div className="alert-dialog-overlay" onClick={onCancel}>
      <div className="alert-dialog-content confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="alert-dialog-message">{message}</div>
        <div className="alert-dialog-actions">
          <button className="alert-dialog-button cancel-button" onClick={onCancel}>
            {resolvedCancelText}
          </button>
          <button className="alert-dialog-button" onClick={onConfirm}>
            {resolvedConfirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Choice Dialog (多选项弹框)
// ============================================================================

interface ChoiceOption<T> {
  value: T
  label: string
  icon?: string
  description?: string
}

interface ChoiceDialogProps<T> {
  title: string
  options: ChoiceOption<T>[]
  onSelect: (value: T) => void
  onCancel: () => void
}

function ChoiceDialog<T>({ title, options, onSelect, onCancel }: ChoiceDialogProps<T>) {
  const { t } = useTranslation('common')
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel()
      }
    }
    
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onCancel])

  return (
    <div className="alert-dialog-overlay" onClick={onCancel}>
      <div className="alert-dialog-content choice-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="choice-dialog-title">{title}</div>
        <div className="choice-dialog-options">
          {options.map((option, index) => (
            <button
              key={index}
              className="choice-option-button"
              onClick={() => onSelect(option.value)}
            >
              {option.icon && <span className="choice-option-icon">{option.icon}</span>}
              <span className="choice-option-label">{option.label}</span>
              {option.description && (
                <span className="choice-option-desc">{option.description}</span>
              )}
            </button>
          ))}
        </div>
        <div className="alert-dialog-actions">
          <button className="alert-dialog-button cancel-button" onClick={onCancel}>
            {t('cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Prompt Dialog (输入框弹框)
// ============================================================================

interface PromptDialogProps {
  message: string
  defaultValue?: string
  placeholder?: string
  onConfirm: (value: string) => void
  onCancel: () => void
  confirmText?: string
  cancelText?: string
}

const PromptDialog: React.FC<PromptDialogProps> = ({
  message,
  defaultValue = '',
  placeholder,
  onConfirm,
  onCancel,
  confirmText,
  cancelText
}) => {
  const { t } = useTranslation('common')
  const resolvedConfirmText = confirmText || t('confirm')
  const resolvedCancelText = cancelText || t('cancel')
  const [value, setValue] = useState(defaultValue)
  const inputRef = React.useRef<HTMLInputElement>(null)

  useEffect(() => {
    // 自动聚焦输入框
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel()
      } else if (e.key === 'Enter') {
        onConfirm(value)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onCancel, onConfirm, value])

  return (
    <div className="alert-dialog-overlay" onClick={onCancel}>
      <div className="alert-dialog-content prompt-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="alert-dialog-message">{message}</div>
        <input
          ref={inputRef}
          type="text"
          className="prompt-dialog-input"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="alert-dialog-actions">
          <button className="alert-dialog-button cancel-button" onClick={onCancel}>
            {resolvedCancelText}
          </button>
          <button className="alert-dialog-button" onClick={() => onConfirm(value)}>
            {resolvedConfirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// 全局弹框管理
// ============================================================================

let showAlertFunction: ((message: string) => void) | null = null
let showConfirmFunction: ((message: string, options?: ConfirmOptions) => Promise<boolean>) | null = null
let showChoiceFunction: (<T>(title: string, options: ChoiceOption<T>[]) => Promise<T | null>) | null = null
let showPromptFunction: ((message: string, options?: PromptOptions) => Promise<string | null>) | null = null

interface ConfirmOptions {
  confirmText?: string
  cancelText?: string
}

interface ConfirmState {
  message: string
  options?: ConfirmOptions
  resolve: (value: boolean) => void
}

interface ChoiceState<T = unknown> {
  title: string
  options: ChoiceOption<T>[]
  resolve: (value: T | null) => void
}

interface PromptOptions {
  defaultValue?: string
  placeholder?: string
  confirmText?: string
  cancelText?: string
}

interface PromptState {
  message: string
  options?: PromptOptions
  resolve: (value: string | null) => void
}

export const AlertDialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [alertState, setAlertState] = useState<{ message: string } | null>(null)
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const [choiceState, setChoiceState] = useState<ChoiceState | null>(null)
  const [promptState, setPromptState] = useState<PromptState | null>(null)

  useEffect(() => {
    showAlertFunction = (message: string) => {
      setAlertState({ message })
    }
    
    showConfirmFunction = (message: string, options?: ConfirmOptions): Promise<boolean> => {
      return new Promise((resolve) => {
        setConfirmState({ message, options, resolve })
      })
    }

    showChoiceFunction = <T,>(title: string, options: ChoiceOption<T>[]): Promise<T | null> => {
      return new Promise((resolve) => {
        setChoiceState({ title, options: options as ChoiceOption<unknown>[], resolve: resolve as (value: unknown) => void })
      })
    }

    showPromptFunction = (message: string, options?: PromptOptions): Promise<string | null> => {
      return new Promise((resolve) => {
        setPromptState({ message, options, resolve })
      })
    }
    
    return () => {
      showAlertFunction = null
      showConfirmFunction = null
      showChoiceFunction = null
      showPromptFunction = null
    }
  }, [])

  const handleConfirm = useCallback(() => {
    if (confirmState) {
      confirmState.resolve(true)
      setConfirmState(null)
    }
  }, [confirmState])

  const handleCancel = useCallback(() => {
    if (confirmState) {
      confirmState.resolve(false)
      setConfirmState(null)
    }
  }, [confirmState])

  const handleChoiceSelect = useCallback((value: unknown) => {
    if (choiceState) {
      choiceState.resolve(value)
      setChoiceState(null)
    }
  }, [choiceState])

  const handleChoiceCancel = useCallback(() => {
    if (choiceState) {
      choiceState.resolve(null)
      setChoiceState(null)
    }
  }, [choiceState])

  const handlePromptConfirm = useCallback((value: string) => {
    if (promptState) {
      promptState.resolve(value)
      setPromptState(null)
    }
  }, [promptState])

  const handlePromptCancel = useCallback(() => {
    if (promptState) {
      promptState.resolve(null)
      setPromptState(null)
    }
  }, [promptState])

  return (
    <>
      {children}
      {alertState && (
        <AlertDialog 
          message={alertState.message} 
          onClose={() => setAlertState(null)} 
        />
      )}
      {confirmState && (
        <ConfirmDialog
          message={confirmState.message}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
          confirmText={confirmState.options?.confirmText}
          cancelText={confirmState.options?.cancelText}
        />
      )}
      {choiceState && (
        <ChoiceDialog
          title={choiceState.title}
          options={choiceState.options}
          onSelect={handleChoiceSelect}
          onCancel={handleChoiceCancel}
        />
      )}
      {promptState && (
        <PromptDialog
          message={promptState.message}
          defaultValue={promptState.options?.defaultValue}
          placeholder={promptState.options?.placeholder}
          onConfirm={handlePromptConfirm}
          onCancel={handlePromptCancel}
          confirmText={promptState.options?.confirmText}
          cancelText={promptState.options?.cancelText}
        />
      )}
    </>
  )
}

// 导出全局方法
export const showAlert = (message: string) => {
  if (showAlertFunction) {
    showAlertFunction(message)
  } else {
    console.warn('AlertDialogProvider not mounted, falling back to native alert')
    alert(message)
  }
}

export const showConfirm = (message: string, options?: ConfirmOptions): Promise<boolean> => {
  if (showConfirmFunction) {
    return showConfirmFunction(message, options)
  } else {
    console.warn('AlertDialogProvider not mounted, falling back to native confirm')
    return Promise.resolve(confirm(message))
  }
}

export const showChoice = <T,>(title: string, options: ChoiceOption<T>[]): Promise<T | null> => {
  if (showChoiceFunction) {
    return showChoiceFunction(title, options)
  } else {
    console.warn('AlertDialogProvider not mounted')
    return Promise.resolve(null)
  }
}

export const showPrompt = (message: string, options?: PromptOptions): Promise<string | null> => {
  if (showPromptFunction) {
    return showPromptFunction(message, options)
  } else {
    console.warn('AlertDialogProvider not mounted, falling back to native prompt')
    return Promise.resolve(prompt(message, options?.defaultValue ?? ''))
  }
}

export type { ChoiceOption, PromptOptions }
