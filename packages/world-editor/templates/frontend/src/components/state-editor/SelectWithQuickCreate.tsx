import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { showPrompt } from '../AlertDialog'

// ============================================================================
// SelectWithQuickCreate - 带快速新建功能的下拉选择器
// ============================================================================

interface SelectWithQuickCreateOption {
  value: string
  label: string
}

interface SelectWithQuickCreateProps {
  value: string
  options: SelectWithQuickCreateOption[]
  onChange: (value: string) => void
  onCreate: (name: string) => string | undefined  // Returns new ID or undefined if cancelled
  placeholder?: string
  createLabel: string  // e.g., "新建组织"
  createPrompt: string // e.g., "请输入组织名称"
  disabled?: boolean
  className?: string
}

export const SelectWithQuickCreate: React.FC<SelectWithQuickCreateProps> = ({
  value,
  options,
  onChange,
  onCreate,
  placeholder,
  createLabel,
  createPrompt,
  disabled = false,
  className = ''
}) => {
  const { t } = useTranslation('editor')
  const [isCreating, setIsCreating] = useState(false)

  const handleCreate = async () => {
    if (isCreating) return
    setIsCreating(true)
    
    try {
      const name = await showPrompt(createPrompt)
      if (name?.trim()) {
        const newId = onCreate(name.trim())
        if (newId) {
          onChange(newId)
        }
      }
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="select-quick-create-wrapper">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className={`select-modern select-with-create ${className}`}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn-quick-create"
        onClick={handleCreate}
        disabled={disabled || isCreating}
        title={createLabel}
      >
        <Plus size={14} />
      </button>
    </div>
  )
}
