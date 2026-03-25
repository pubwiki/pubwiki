import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { showAlert } from '../AlertDialog'
import type { TypeSchema, ValidationError } from './types'
import { getDefaultValueForSchema, generateUniqueId } from './types'
import type { Attributes, CreatureAttrField } from '../../api/types'
import { DEFAULT_ATTRS } from './types'

// ============================================================================
// 验证提示组件
// ============================================================================

export const ValidationPanel: React.FC<{ errors: ValidationError[] }> = ({ errors }) => {
  const { t } = useTranslation(['common', 'editor'])
  const [collapsed, setCollapsed] = useState(true)
  
  if (errors.length === 0) return null
  
  const errorCount = errors.filter(e => e.severity === 'error').length
  const warningCount = errors.filter(e => e.severity === 'warning').length
  
  return (
    <div className="validation-panel">
      <div 
        className="validation-summary" 
        onClick={() => setCollapsed(!collapsed)}
        style={{ cursor: 'pointer', userSelect: 'none' }}
      >
        <span style={{ marginRight: '8px' }}>{collapsed ? '▶' : '▼'}</span>
        {errorCount > 0 && <span className="error-count">❌ {t('common:errors', { count: errorCount })}</span>}
        {warningCount > 0 && <span className="warning-count">⚠️ {t('common:warnings', { count: warningCount })}</span>}
      </div>
      {!collapsed && (
        <div className="validation-list">
          {errors.slice(0, 10).map((error, index) => (
            <div key={`${error.path}-${error.message}`} className={`validation-item ${error.severity}`}>
              <span className="validation-path">{error.path}</span>
              <span className="validation-message">{error.message}</span>
            </div>
          ))}
          {errors.length > 10 && (
            <div className="validation-more">{t('common:noMoreIssues', { count: errors.length - 10 })}</div>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// 字符串数组编辑器
// ============================================================================

export const StringArrayEditor: React.FC<{
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
}> = ({ values, onChange, placeholder }) => {
  const { t } = useTranslation('editor')
  // 使用稳定的 key 来避免焦点丢失问题
  const [itemKeys] = useState<string[]>(() => values.map(() => generateUniqueId('str')))
  
  const handleAdd = () => {
    itemKeys.push(generateUniqueId('str'))
    onChange([...values, ''])
  }
  
  const handleRemove = (index: number) => {
    itemKeys.splice(index, 1)
    onChange(values.filter((_, i) => i !== index))
  }
  
  return (
    <div className="string-array-editor" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {values.map((value, index) => (
        <div key={itemKeys[index] || `fallback-${index}`} className="array-item" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="text"
            value={value}
            onChange={e => {
              const newValues = [...values]
              newValues[index] = e.target.value
              onChange(newValues)
            }}
            placeholder={placeholder}
            style={{ flex: 1 }}
          />
          <button
            className="btn-remove-inline"
            onClick={() => handleRemove(index)}
            style={{ padding: '0 8px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: 'transparent', border: 'none', opacity: 0.6, transition: 'opacity 0.2s', alignSelf: 'center' }}
            title="Remove"
          >
            ❌
          </button>
        </div>
      ))}
      <button
        className="btn-add-small"
        onClick={handleAdd}
        style={{ alignSelf: 'flex-start', marginTop: '4px' }}
      >
        ➕ {t('commonEditors.addItem')}
      </button>
    </div>
  )
}

export const EquipmentAttributesEditor: React.FC<{
  attributes: Partial<Attributes>
  onChange: (attributes: Partial<Attributes>) => void
  attrFields?: CreatureAttrField[]
}> = ({ attributes, onChange, attrFields }) => {
  const { t } = useTranslation('editor')
  const [newKey, setNewKey] = useState('')
  const [isDuplicateKey, setIsDuplicateKey] = useState(false)

  // 合并：attrFields 定义的字段 + attributes 中已有但不在 attrFields 里的字段
  const allKeys = useMemo(() => {
    const keys = new Set<string>()
    if (attrFields && attrFields.length > 0) {
      attrFields.forEach(f => keys.add(f.field_name))
    }
    Object.keys(attributes).forEach(k => keys.add(k))
    return Array.from(keys)
  }, [attrFields, attributes])

  const getLabel = (key: string) => {
    const field = attrFields?.find(f => f.field_name === key)
    return field ? `${field.field_name} (${field.hint})` : key
  }

  return (
    <div className="attributes-editor">
      <div className="form-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {allKeys.map(key => (
          <div key={key} className="form-group">
            <label>{getLabel(key)}</label>
            <div style={{ display: 'flex', gap: '4px' }}>
              <input
                type="text"
                value={attributes[key] ?? ''}
                onChange={e => {
                  const raw = e.target.value
                  const num = Number(raw)
                  onChange({
                    ...attributes,
                    [key]: raw === '' ? 0 : (!isNaN(num) && raw.trim() !== '' ? num : raw)
                  })
                }}
                style={{ flex: 1 }}
              />
              {/* 允许删除不在 attrFields 定义中的自定义字段 */}
              {(!attrFields || !attrFields.find(f => f.field_name === key)) && (
                <button
                  className="btn-remove-inline"
                  onClick={() => {
                    const newAttrs = { ...attributes }
                    delete newAttrs[key]
                    onChange(newAttrs)
                  }}
                  title={t('common:delete')}
                >❌</button>
              )}
            </div>
          </div>
        ))}
      </div>
      {/* 添加自定义属性 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '8px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={newKey}
            onChange={e => {
              setNewKey(e.target.value)
              setIsDuplicateKey(allKeys.includes(e.target.value.trim()) && e.target.value.trim() !== '')
            }}
            placeholder={t('attributes.addCustomField')}
            className={isDuplicateKey ? 'form-input-error' : undefined}
            style={{ flex: 1 }}
          />
          <button
            className="btn-add-small"
            disabled={!newKey.trim() || isDuplicateKey}
            onClick={() => {
              if (newKey.trim() && !allKeys.includes(newKey.trim())) {
                onChange({ ...attributes, [newKey.trim()]: 0 })
                setNewKey('')
                setIsDuplicateKey(false)
              }
            }}
          >
            ➕
          </button>
        </div>
        {isDuplicateKey && (
          <div className="form-field-error">⚠ {t('validation.duplicateKey')}</div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// 属性编辑器
// ============================================================================

export const AttributesEditor: React.FC<{
  attrs?: Attributes
  onChange: (attrs: Attributes) => void
  attrFields?: CreatureAttrField[]
}> = ({ attrs, onChange, attrFields }) => {
  const { t } = useTranslation('editor')
  const currentAttrs = attrs || DEFAULT_ATTRS

  // 只显示世界实体中定义的属性字段
  const fields = attrFields || []

  if (fields.length === 0) {
    return <div className="paper-bento-empty">{t('attributes.noFieldsDefined', '请先在世界实体中定义属性字段')}</div>
  }

  return (
    <div className="attrs-editor">
      <div className="attrs-card-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {fields.map(field => {
          const key = field.field_name
          const displayName = field.field_display_name || key
          const hint = field.hint

          return (
            <div key={key} className="attr-card" style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div>
                <div style={{ fontWeight: 'var(--paper-font-weight-bold)', color: 'var(--paper-text-primary)' }}>
                  {displayName}
                </div>
                {displayName !== key && (
                  <div style={{ fontFamily: 'monospace', color: 'var(--paper-electric-blue)', fontSize: '12px', marginTop: '2px' }}>
                    {key}
                  </div>
                )}
              </div>
              <input
                className="attr-card-input"
                type="text"
                value={currentAttrs[key] ?? ''}
                onChange={e => {
                  const raw = e.target.value
                  const num = Number(raw)
                  onChange({ ...currentAttrs, [key]: raw === '' ? 0 : (!isNaN(num) && raw.trim() !== '' ? num : raw) })
                }}
                placeholder={hint || key}
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
              {hint && <div style={{ fontSize: '11px', color: 'var(--paper-text-tertiary)', lineHeight: '1.4', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{hint}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ============================================================================
// TypeSchema 可视化编辑器
// ============================================================================

export const TypeSchemaEditor: React.FC<{
  schema: TypeSchema | undefined
  onChange: (schema: TypeSchema | undefined) => void
  depth?: number
}> = ({ schema, onChange, depth = 0 }) => {
  const { t } = useTranslation('editor')
  const typeOptions: Array<{ value: TypeSchema['type'] | 'none'; label: string }> = [
    { value: 'none', label: t('schema.none') },
    { value: 'string', label: t('schema.string') },
    { value: 'number', label: t('schema.number') },
    { value: 'integer', label: t('schema.integer') },
    { value: 'boolean', label: t('schema.boolean') },
    { value: 'object', label: t('schema.object') },
    { value: 'array', label: t('schema.array') },
    { value: 'null', label: t('schema.null') },
  ]

  const currentType = schema?.type || 'none'

  // 使用稳定的 key 映射，避免重命名属性时焦点丢失
  const propertyKeysRef = useRef<Record<string, string>>({})
  
  // 确保每个属性都有一个稳定的 key
  const getStableKey = (propName: string): string => {
    if (!propertyKeysRef.current[propName]) {
      propertyKeysRef.current[propName] = generateUniqueId('prop')
    }
    return propertyKeysRef.current[propName]
  }

  // 处理类型变更
  const handleTypeChange = (newType: string) => {
    if (newType === 'none') {
      onChange(undefined)
      return
    }
    
    const baseSchema: TypeSchema = { type: newType as TypeSchema['type'] }
    
    // 根据类型初始化默认结构
    if (newType === 'object') {
      baseSchema.properties = {}
      baseSchema.required = []
    } else if (newType === 'array') {
      baseSchema.items = { type: 'string' }
    }
    
    // 保留描述
    if (schema?.description) {
      baseSchema.description = schema.description
    }
    
    onChange(baseSchema)
  }

  // 添加对象属性
  const addProperty = () => {
    const newKey = `field_${Object.keys(schema?.properties || {}).length + 1}`
    onChange({
      ...schema,
      properties: {
        ...schema?.properties,
        [newKey]: { type: 'string' }
      }
    })
  }

  // 删除对象属性
  const removeProperty = (key: string) => {
    const newProps = { ...schema?.properties }
    delete newProps[key]
    // 清理稳定 key 映射
    delete propertyKeysRef.current[key]
    const newRequired = schema?.required?.filter(r => r !== key) || []
    onChange({
      ...schema,
      properties: newProps,
      required: newRequired.length > 0 ? newRequired : undefined
    })
  }

  // 重命名属性
  const renameProperty = (oldKey: string, newKey: string) => {
    if (oldKey === newKey || !newKey.trim()) return
    if (schema?.properties?.[newKey]) {
      showAlert(t('schema.propertyExists'))
      return
    }
    const newProps: Record<string, TypeSchema> = {}
    Object.entries(schema?.properties || {}).forEach(([k, v]) => {
      newProps[k === oldKey ? newKey : k] = v
    })
    // 转移稳定 key 映射：旧名称 → 新名称
    const stableId = propertyKeysRef.current[oldKey]
    if (stableId) {
      delete propertyKeysRef.current[oldKey]
      propertyKeysRef.current[newKey] = stableId
    }
    const newRequired = schema?.required?.map(r => r === oldKey ? newKey : r) || []
    onChange({
      ...schema,
      properties: newProps,
      required: newRequired.length > 0 ? newRequired : undefined
    })
  }

  // 更新属性 schema
  const updatePropertySchema = (key: string, propSchema: TypeSchema | undefined) => {
    onChange({
      ...schema,
      properties: {
        ...schema?.properties,
        [key]: propSchema || { type: 'string' }
      }
    })
  }

  // 切换必需属性
  const toggleRequired = (key: string) => {
    const isRequired = schema?.required?.includes(key)
    const newRequired = isRequired
      ? schema?.required?.filter(r => r !== key) || []
      : [...(schema?.required || []), key]
    onChange({
      ...schema,
      required: newRequired.length > 0 ? newRequired : undefined
    })
  }

  // 更新数组 items
  const updateItemsSchema = (itemsSchema: TypeSchema | undefined) => {
    onChange({
      ...schema,
      items: itemsSchema || { type: 'string' }
    })
  }

  // 防止嵌套太深
  const maxDepth = 5
  if (depth > maxDepth) {
    return <div className="schema-depth-limit">{t('schema.depthLimit')}</div>
  }

  return (
    <div className={`type-schema-editor depth-${depth}`}>
      {/* 类型选择 */}
      <div className="schema-type-row">
        <select
          value={currentType}
          onChange={e => handleTypeChange(e.target.value)}
          className="schema-type-select"
        >
          {typeOptions.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        
        {/* 描述输入 */}
        {schema && (
          <input
            type="text"
            className="schema-description"
            value={schema.description || ''}
            onChange={e => onChange({ ...schema, description: e.target.value || undefined })}
            placeholder={t('schema.descriptionPlaceholder')}
          />
        )}
      </div>

      {/* Object 类型：编辑 properties */}
      {schema?.type === 'object' && (
        <div className="schema-properties">
          <div className="schema-section-header">
            <span>{t('schema.objectProperties')}</span>
            <button
              type="button"
              className="btn-add-small"
              onClick={addProperty}
            >
              {t('schema.addProperty')}
            </button>
          </div>
          
          {Object.entries(schema.properties || {}).map(([key, propSchema]) => (
            <div key={getStableKey(key)} className="schema-property-item">
              <div className="property-header">
                <input
                  type="text"
                  className="property-name"
                  defaultValue={key}
                  onBlur={e => {
                    const newKey = e.target.value
                    if (newKey !== key) {
                      renameProperty(key, newKey)
                    }
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      (e.target as HTMLInputElement).blur()
                    }
                  }}
                  placeholder={t('schema.propertyName')}
                />
                <label className="required-checkbox">
                  <input
                    type="checkbox"
                    checked={schema.required?.includes(key) || false}
                    onChange={() => toggleRequired(key)}
                  />
                  {t('schema.required')}
                </label>
                <button
                  type="button"
                  className="btn-remove-inline"
                  onClick={() => removeProperty(key)}
                  title={t('schema.deleteProperty')}
                >
                  ❌
                </button>
              </div>
              <div className="property-schema">
                <TypeSchemaEditor
                  schema={propSchema}
                  onChange={s => updatePropertySchema(key, s)}
                  depth={depth + 1}
                />
              </div>
            </div>
          ))}
          
          {Object.keys(schema.properties || {}).length === 0 && (
            <div className="schema-empty-hint">{t('schema.noProperties')}</div>
          )}
        </div>
      )}

      {/* Array 类型：编辑 items */}
      {schema?.type === 'array' && (
        <div className="schema-array-items">
          <div className="schema-section-header">
            <span>{t('schema.arrayItems')}</span>
          </div>
          <div className="array-items-editor">
            <TypeSchemaEditor
              schema={schema.items}
              onChange={updateItemsSchema}
              depth={depth + 1}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// 基于 Schema 的智能值编辑器
// ============================================================================

export const SchemaValueEditor: React.FC<{
  schema: TypeSchema | undefined
  value: any
  onChange: (value: any) => void
  depth?: number
}> = ({ schema, value, onChange, depth = 0 }) => {
  const { t } = useTranslation('editor')
  // 防止嵌套太深
  const maxDepth = 5
  if (depth > maxDepth) {
    return <div className="schema-depth-limit">⚠️ {t('commonEditors.depthLimit')}</div>
  }

  // 如果没有 schema，使用 SmartValueEditor
  if (!schema || !schema.type) {
    return (
      <SmartValueEditor
        value={value}
        onChange={onChange}
        placeholder={t('commonEditors.freeFormatData')}
      />
    )
  }

  // 根据 schema.type 渲染不同的编辑器
  switch (schema.type) {
    case 'string':
      return (
        <div className="schema-value-editor">
          {schema.description && (
            <div className="schema-value-hint">{schema.description}</div>
          )}
          <input
            type="text"
            value={value || ''}
            onChange={e => onChange(e.target.value || undefined)}
            placeholder={schema.description || t('commonEditors.enterString')}
          />
        </div>
      )

    case 'number':
    case 'integer':
      return (
        <div className="schema-value-editor">
          {schema.description && (
            <div className="schema-value-hint">{schema.description}</div>
          )}
          <input
            type="number"
            value={value ?? ''}
            step={schema.type === 'integer' ? 1 : 'any'}
            onChange={e => {
              const val = e.target.value
              if (val === '') {
                onChange(undefined)
              } else {
                onChange(schema.type === 'integer' ? parseInt(val) : parseFloat(val))
              }
            }}
            placeholder={schema.description || (schema.type === 'integer' ? t('commonEditors.enterInteger') : t('commonEditors.enterNumber'))}
          />
        </div>
      )

    case 'boolean':
      return (
        <div className="schema-value-editor">
          {schema.description && (
            <div className="schema-value-hint">{schema.description}</div>
          )}
          <select
            value={value === true ? 'true' : value === false ? 'false' : ''}
            onChange={e => {
              const val = e.target.value
              onChange(val === 'true' ? true : val === 'false' ? false : undefined)
            }}
          >
            <option value="">{t('commonEditors.notSet')}</option>
            <option value="true">✓ true</option>
            <option value="false">✗ false</option>
          </select>
        </div>
      )

    case 'object':
      const properties = schema.properties || {}
      const currentObj = (typeof value === 'object' && value !== null) ? value : {}
      
      return (
        <div className={`schema-value-editor schema-object depth-${depth}`}>
          {schema.description && (
            <div className="schema-value-hint">{schema.description}</div>
          )}
          <div className="schema-object-fields">
            {Object.entries(properties).map(([key, propSchema]) => {
              const isRequired = schema.required?.includes(key)
              return (
                <div key={key} className="schema-object-field">
                  <label className="schema-field-label">
                    {key}
                    {isRequired && <span className="required-mark">*</span>}
                    {propSchema.description && (
                      <span className="field-description" title={propSchema.description}>
                        ℹ️
                      </span>
                    )}
                  </label>
                  <SchemaValueEditor
                    schema={propSchema}
                    value={currentObj[key]}
                    onChange={newVal => {
                      const newObj = { ...currentObj }
                      if (newVal === undefined) {
                        delete newObj[key]
                      } else {
                        newObj[key] = newVal
                      }
                      // 如果对象为空，返回 undefined
                      onChange(Object.keys(newObj).length > 0 ? newObj : undefined)
                    }}
                    depth={depth + 1}
                  />
                </div>
              )
            })}
            {Object.keys(properties).length === 0 && (
              <div className="schema-empty-hint">{t('commonEditors.noPropertiesDefined')}</div>
            )}
          </div>
        </div>
      )

    case 'array':
      const itemSchema = schema.items || { type: 'string' }
      const currentArray = Array.isArray(value) ? value : []
      
      return (
        <div className={`schema-value-editor schema-array depth-${depth}`}>
          {schema.description && (
            <div className="schema-value-hint">{schema.description}</div>
          )}
          <div className="schema-array-items-list">
            {currentArray.map((item, index) => (
              <div key={`array-item-${index}`} className="schema-array-item">
                <div className="array-item-header">
                  <span className="array-item-index">#{index + 1}</span>
                  <button
                    type="button"
                    className="btn-remove-small"
                    onClick={() => {
                      const newArr = currentArray.filter((_, i) => i !== index)
                      onChange(newArr.length > 0 ? newArr : undefined)
                    }}
                  >
                    ✕
                  </button>
                </div>
                <SchemaValueEditor
                  schema={itemSchema}
                  value={item}
                  onChange={newVal => {
                    const newArr = [...currentArray]
                    newArr[index] = newVal
                    onChange(newArr)
                  }}
                  depth={depth + 1}
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn-add-small"
            onClick={() => {
              const defaultValue = getDefaultValueForSchema(itemSchema)
              onChange([...currentArray, defaultValue])
            }}
          >
            + {t('commonEditors.addArrayItem')}
          </button>
        </div>
      )

    case 'null':
      return (
        <div className="schema-value-editor">
          <span className="schema-null-value">{t('commonEditors.nullValue')}</span>
        </div>
      )

    default:
      return (
        <SmartValueEditor
          value={value}
          onChange={onChange}
          placeholder={t('commonEditors.freeFormatData')}
        />
      )
  }
}

// ============================================================================
// 可视化键值对编辑器 (用于状态效果等无 schema 的数据)
// 支持：string, number, boolean, object (递归), array (递归)
// ============================================================================

type FieldType = 'string' | 'number' | 'boolean' | 'object' | 'array'

const detectType = (value: any): FieldType => {
  if (Array.isArray(value)) return 'array'
  if (value !== null && typeof value === 'object') return 'object'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'string'
}

const getDefaultForType = (type: FieldType): any => {
  if (type === 'number') return 0
  if (type === 'boolean') return false
  if (type === 'object') return {}
  if (type === 'array') return []
  return ''
}

const MAX_KV_DEPTH = 4

// 单个值的内联编辑器（用于 array 的项）
const KVValueEditor: React.FC<{
  value: any
  onChange: (value: any) => void
  depth: number
}> = ({ value, onChange, depth }) => {
  const { t } = useTranslation('editor')
  const fieldType = detectType(value)

  if (depth >= MAX_KV_DEPTH) {
    return (
      <div style={{ padding: '4px 8px', color: 'var(--paper-text-secondary)', fontSize: '0.8rem', fontStyle: 'italic' }}>
        ⚠️ {t('commonEditors.depthLimit')}
      </div>
    )
  }

  if (fieldType === 'object') {
    return <KeyValuePairEditor value={value} onChange={onChange} depth={depth} />
  }

  if (fieldType === 'array') {
    return <KVArrayEditor value={value} onChange={onChange} depth={depth} />
  }

  if (fieldType === 'boolean') {
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <input
          type="checkbox"
          checked={value === true}
          onChange={e => onChange(e.target.checked)}
        />
        <span style={{ fontSize: '0.85rem' }}>{value ? 'true' : 'false'}</span>
      </label>
    )
  }

  return (
    <input
      type={fieldType === 'number' ? 'number' : 'text'}
      value={value ?? ''}
      onChange={e => onChange(fieldType === 'number' ? (e.target.value === '' ? 0 : Number(e.target.value)) : e.target.value)}
      placeholder={t('commonEditors.enterValue')}
      style={{ flex: 1, fontSize: '0.85rem' }}
    />
  )
}

// 数组编辑器
const KVArrayEditor: React.FC<{
  value: any[]
  onChange: (value: any) => void
  depth: number
}> = ({ value, onChange, depth }) => {
  const { t } = useTranslation('editor')
  const arr = Array.isArray(value) ? value : []

  const addItem = () => {
    onChange([...arr, ''])
  }

  const removeItem = (index: number) => {
    const newArr = arr.filter((_, i) => i !== index)
    onChange(newArr.length > 0 ? newArr : [])
  }

  const updateItem = (index: number, newValue: any) => {
    const newArr = [...arr]
    newArr[index] = newValue
    onChange(newArr)
  }

  const updateItemType = (index: number, newType: FieldType) => {
    const newArr = [...arr]
    newArr[index] = getDefaultForType(newType)
    onChange(newArr)
  }

  return (
    <div className="kv-array-editor" style={{ paddingLeft: depth > 0 ? '12px' : 0, borderLeft: depth > 0 ? '2px solid rgba(100, 150, 255, 0.15)' : 'none' }}>
      {arr.length === 0 && (
        <div style={{ padding: '4px 0', color: 'var(--paper-text-secondary)', fontSize: '0.8rem', fontStyle: 'italic' }}>
          {t('commonEditors.emptyArray')}
        </div>
      )}
      {arr.map((item, index) => {
        const itemType = detectType(item)
        const isComplex = itemType === 'object' || itemType === 'array'
        return (
          <div key={index} className="kv-array-item" style={{ marginBottom: '6px' }}>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--paper-text-secondary)', minWidth: '28px' }}>#{index + 1}</span>
              <select
                value={itemType}
                onChange={e => updateItemType(index, e.target.value as FieldType)}
                style={{ width: '80px', fontSize: '0.8rem' }}
              >
                <option value="string">{t('commonEditors.typeString')}</option>
                <option value="number">{t('commonEditors.typeNumber')}</option>
                <option value="boolean">{t('commonEditors.typeBoolean')}</option>
                <option value="object">{t('commonEditors.typeObject')}</option>
                <option value="array">{t('commonEditors.typeArray')}</option>
              </select>
              {!isComplex && (
                <div style={{ flex: 1 }}>
                  <KVValueEditor value={item} onChange={v => updateItem(index, v)} depth={depth + 1} />
                </div>
              )}
              <button
                type="button" className="btn-remove-small"
                onClick={() => removeItem(index)}
              >✕</button>
            </div>
            {isComplex && (
              <div style={{ marginTop: '4px' }}>
                <KVValueEditor value={item} onChange={v => updateItem(index, v)} depth={depth + 1} />
              </div>
            )}
          </div>
        )
      })}
      <button type="button" className="btn-add-small" onClick={addItem} style={{ fontSize: '0.8rem', marginTop: '2px' }}>
        + {t('commonEditors.addArrayItem')}
      </button>
    </div>
  )
}

// 主编辑器
export const KeyValuePairEditor: React.FC<{
  value: any
  onChange: (value: any) => void
  depth?: number
}> = ({ value, onChange, depth = 0 }) => {
  const { t } = useTranslation('editor')

  if (depth >= MAX_KV_DEPTH) {
    return (
      <div style={{ padding: '4px 8px', color: 'var(--paper-text-secondary)', fontSize: '0.8rem', fontStyle: 'italic' }}>
        ⚠️ {t('commonEditors.depthLimit')}
      </div>
    )
  }

  // 将 value 解析为 entries 数组
  const entries: Array<[string, any]> = useMemo(() => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.entries(value)
    }
    return []
  }, [value])

  const updateObj = (newEntries: Array<[string, any]>) => {
    const obj: Record<string, any> = {}
    newEntries.forEach(([k, v]) => { if (k) obj[k] = v })
    onChange(Object.keys(obj).length > 0 ? obj : undefined)
  }

  const addField = () => {
    const key = `field_${entries.length + 1}`
    updateObj([...entries, [key, '']])
  }

  const removeField = (index: number) => {
    updateObj(entries.filter((_, i) => i !== index))
  }

  const updateKey = (index: number, newKey: string) => {
    const newEntries = [...entries]
    newEntries[index] = [newKey, newEntries[index][1]]
    updateObj(newEntries)
  }

  const updateValue = (index: number, newValue: any) => {
    const newEntries = [...entries]
    newEntries[index] = [newEntries[index][0], newValue]
    updateObj(newEntries)
  }

  const updateType = (index: number, newType: FieldType) => {
    const newEntries = [...entries]
    newEntries[index] = [newEntries[index][0], getDefaultForType(newType)]
    updateObj(newEntries)
  }

  return (
    <div className="kv-pair-editor" style={{ paddingLeft: depth > 0 ? '12px' : 0, borderLeft: depth > 0 ? '2px solid rgba(100, 150, 255, 0.15)' : 'none' }}>
      {entries.length === 0 && (
        <div style={{ padding: '8px 0', color: 'var(--paper-text-secondary)', fontSize: '0.85rem', fontStyle: 'italic' }}>
          {t('commonEditors.noFields')}
        </div>
      )}
      {entries.map(([key, val], index) => {
        const fieldType = detectType(val)
        const isComplex = fieldType === 'object' || fieldType === 'array'
        return (
          <div key={index} className="kv-pair-row" style={{ marginBottom: '6px' }}>
            {/* 一行：字段名 + 类型 + 值(简单类型) + 删除 */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="text"
                value={key}
                onChange={e => updateKey(index, e.target.value)}
                placeholder={t('commonEditors.fieldName')}
                style={{ width: '120px', fontFamily: 'monospace', fontSize: '0.85rem' }}
              />
              <select
                value={fieldType}
                onChange={e => updateType(index, e.target.value as FieldType)}
                style={{ width: '90px', fontSize: '0.85rem' }}
              >
                <option value="string">{t('commonEditors.typeString')}</option>
                <option value="number">{t('commonEditors.typeNumber')}</option>
                <option value="boolean">{t('commonEditors.typeBoolean')}</option>
                <option value="object">{t('commonEditors.typeObject')}</option>
                <option value="array">{t('commonEditors.typeArray')}</option>
              </select>
              {/* 简单类型内联编辑 */}
              {!isComplex && (
                <div style={{ flex: 1 }}>
                  <KVValueEditor value={val} onChange={v => updateValue(index, v)} depth={depth + 1} />
                </div>
              )}
              <button
                type="button" className="btn-remove-small"
                onClick={() => removeField(index)}
              >✕</button>
            </div>
            {/* 复杂类型展开为嵌套编辑器 */}
            {isComplex && (
              <div style={{ marginTop: '4px' }}>
                <KVValueEditor value={val} onChange={v => updateValue(index, v)} depth={depth + 1} />
              </div>
            )}
          </div>
        )
      })}
      <button
        type="button"
        className="btn-add-small"
        onClick={addField}
        style={{ marginTop: '4px' }}
      >
        + {t('commonEditors.addField')}
      </button>
    </div>
  )
}

// ============================================================================
// 智能 Value 编辑器
// ============================================================================

export const SmartValueEditor: React.FC<{
  value: any
  onChange: (value: any) => void
  placeholder?: string
}> = ({ value, onChange, placeholder }) => {
  const { t } = useTranslation('editor')
  const [editMode, setEditMode] = useState<'simple' | 'json'>(() => {
    // 初始模式：如果已经是复杂对象，直接使用 JSON 模式
    if (value !== undefined && value !== null && typeof value === 'object') {
      return 'json'
    }
    return 'simple'
  })
  
  // JSON 文本状态
  const [jsonText, setJsonText] = useState<string>(() => {
    if (value !== undefined && value !== null && typeof value === 'object') {
      return JSON.stringify(value, null, 2)
    }
    return '{}'
  })
  
  // JSON 解析错误
  const [jsonError, setJsonError] = useState<string | null>(null)
  
  // 判断是否是简单类型
  const isSimpleType = (val: any): boolean => {
    return val === undefined || val === null || 
           typeof val === 'string' || 
           typeof val === 'number' || 
           typeof val === 'boolean'
  }
  
  // 当外部 value 变化时，同步 jsonText（仅在 JSON 模式）
  React.useEffect(() => {
    if (editMode === 'json' && value !== undefined && value !== null && typeof value === 'object') {
      setJsonText(JSON.stringify(value, null, 2))
    }
  }, [value, editMode])
  
  // 切换到 JSON 模式
  const switchToJsonMode = () => {
    const initialValue = (value !== undefined && value !== null && typeof value === 'object') 
      ? value 
      : {}
    setJsonText(JSON.stringify(initialValue, null, 2))
    setJsonError(null)
    setEditMode('json')
    if (isSimpleType(value)) {
      onChange({})
    }
  }
  
  // 切换到简单模式
  const switchToSimpleMode = () => {
    setEditMode('simple')
    onChange(undefined)
  }
  
  // 应用 JSON 更改
  const applyJsonChanges = () => {
    try {
      const parsed = (new Function(`return ${jsonText}`))()
      onChange(parsed)
      setJsonError(null)
    } catch (e) {
      setJsonError((e as Error).message)
    }
  }
  
  // 格式化 JSON
  const formatJson = () => {
    try {
      const parsed = (new Function(`return ${jsonText}`))()
      setJsonText(JSON.stringify(parsed, null, 2))
      setJsonError(null)
    } catch (e) {
      setJsonError(t('commonEditors.formatFailed', { error: (e as Error).message }))
    }
  }
  
  // 简单类型编辑器
  if (editMode === 'simple') {
    return (
      <div className="smart-value-editor simple">
        <input
          type="text"
          value={value === undefined || value === null ? '' : String(value)}
          onChange={e => {
            const val = e.target.value
            if (val === '') {
              onChange(undefined)
            } else if (!isNaN(Number(val)) && val.trim() !== '') {
              onChange(Number(val))
            } else if (val === 'true') {
              onChange(true)
            } else if (val === 'false') {
              onChange(false)
            } else {
              onChange(val)
            }
          }}
          placeholder={placeholder || t('commonEditors.enterValue')}
        />
        <button
          type="button"
          className="btn-switch-mode"
          onClick={switchToJsonMode}
          title={t('commonEditors.switchToJsonEditor')}
        >
          📦 {t('commonEditors.switchToObject')}
        </button>
      </div>
    )
  }
  
  // JSON 编辑器
  return (
    <div className="smart-value-editor json">
      <div className="json-toolbar">
        <button
          type="button"
          className="btn-switch-mode"
          onClick={switchToSimpleMode}
          title={t('commonEditors.switchToSimpleEditor')}
        >
          🔤 {t('commonEditors.switchToSimple')}
        </button>
        <button
          type="button"
          className="btn-format"
          onClick={formatJson}
          title={t('commonEditors.formatJson')}
        >
          ✨ {t('commonEditors.format')}
        </button>
        <button
          type="button"
          className="btn-apply"
          onClick={applyJsonChanges}
          title={t('commonEditors.applyChanges')}
        >
          ✓ {t('commonEditors.apply')}
        </button>
      </div>
      <textarea
        className="json-editor"
        value={jsonText}
        onChange={e => setJsonText(e.target.value)}
        placeholder={t('commonEditors.enterJsonObject')}
        rows={8}
      />
      {jsonError && (
        <div className="json-error">
          ❌ {jsonError}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Log 编辑器组件
// ============================================================================

export const LogEditor: React.FC<{
  log?: { entries: Array<{ content: string; add_at: string }> }
  onChange: (log: { entries: Array<{ content: string; add_at: string }> }) => void
  title?: string
}> = ({ log, onChange, title }) => {
  const { t } = useTranslation(['editor', 'common'])
  const entries = log?.entries || []

  const addEntry = () => {
    const add_at = new Date().toLocaleString()
    onChange({ entries: [...entries, { content: '', add_at }] })
  }

  const updateEntry = (index: number, field: 'content' | 'add_at', value: string) => {
    const newEntries = [...entries]
    newEntries[index] = { ...newEntries[index], [field]: value }
    onChange({ entries: newEntries })
  }

  const removeEntry = (index: number) => {
    onChange({ entries: entries.filter((_, i) => i !== index) })
  }

  const moveUp = (index: number) => {
    if (index === 0) return
    const newEntries = [...entries]
    ;[newEntries[index - 1], newEntries[index]] = [newEntries[index], newEntries[index - 1]]
    onChange({ entries: newEntries })
  }

  const moveDown = (index: number) => {
    if (index === entries.length - 1) return
    const newEntries = [...entries]
    ;[newEntries[index], newEntries[index + 1]] = [newEntries[index + 1], newEntries[index]]
    onChange({ entries: newEntries })
  }

  return (
    <div className="form-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <label style={{ fontWeight: 600, color: 'var(--paper-text-primary)', fontSize: 'var(--paper-font-size-sm)' }}>{title || t('commonEditors.logTitle')}</label>
        <button type="button" onClick={addEntry} className="btn-add-small">
          ➕ {t('commonEditors.addLog')}
        </button>
      </div>
      {entries.length === 0 && (
        <div style={{ color: '#888', fontStyle: 'italic', padding: '0.5rem' }}>
          {t('commonEditors.noLogs')}
        </div>
      )}
      {entries.map((entry, index) => (
        <div key={`log-${index}-${entry.add_at}`} style={{ 
          marginBottom: '0.5rem', 
          padding: '0.5rem', 
          border: '1px solid #444',
          borderRadius: '4px',
          backgroundColor: '#1e1e1e'
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label style={{ minWidth: '80px', fontSize: '0.9rem', color: '#888' }}>{t('commonEditors.logTimeLabel')}</label>
              <input
                type="text"
                value={entry.add_at}
                onChange={(e) => updateEntry(index, 'add_at', e.target.value)}
                placeholder={t('commonEditors.logTimePlaceholder')}
                style={{ flex: 1 }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
              <label style={{ minWidth: '80px', fontSize: '0.9rem', color: '#888', paddingTop: '0.5rem' }}>{t('commonEditors.logContentLabel')}</label>
              <textarea
                value={entry.content}
                onChange={(e) => updateEntry(index, 'content', e.target.value)}
                placeholder={t('commonEditors.logContentPlaceholder')}
                rows={3}
                style={{ flex: 1, resize: 'vertical' }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <button
                  type="button"
                  onClick={() => moveUp(index)}
                  disabled={index === 0}
                  className="btn btn-sm"
                  title={t('commonEditors.moveUp')}
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveDown(index)}
                disabled={index === entries.length - 1}
                className="btn btn-sm"
                title={t('commonEditors.moveDown')}
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => removeEntry(index)}
                className="btn btn-sm"
                title={t('common:delete')}
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', color: '#ff6b6b' }}
              >
                🗑️
              </button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ============================================================================
// 搜索过滤组件
// ============================================================================

export type SortOrder = 'original' | 'az' | 'za'

export interface SearchFilterProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  totalCount: number
  filteredCount: number
  sortOrder?: SortOrder
  onSortChange?: (order: SortOrder) => void
}

export const SearchFilter: React.FC<SearchFilterProps> = ({
  value, onChange, placeholder, totalCount, filteredCount, sortOrder, onSortChange
}) => {
  const { t } = useTranslation('editor')
  const [internalValue, setInternalValue] = useState(value)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  // 同步外部 value 变化（如清除时）
  useEffect(() => {
    setInternalValue(value)
  }, [value])

  const handleChange = useCallback((newValue: string) => {
    setInternalValue(newValue)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onChange(newValue)
    }, 300)
  }, [onChange])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  return (
    <div className="search-filter-container">
      <input
        type="text"
        className="search-input"
        placeholder={placeholder}
        value={internalValue}
        onChange={e => handleChange(e.target.value)}
      />
      {onSortChange && (
        <select
          className="search-sort-select"
          value={sortOrder || 'original'}
          onChange={e => onSortChange(e.target.value as SortOrder)}
          title={t('commonEditors.sortOrder')}
        >
          <option value="original">{t('commonEditors.sortOriginal')}</option>
          <option value="az">{t('commonEditors.sortAZ')}</option>
          <option value="za">{t('commonEditors.sortZA')}</option>
        </select>
      )}
      {internalValue && (
        <>
          <span className="search-result-count">
            {filteredCount} / {totalCount}
          </span>
          <button
            className="btn-clear-search"
            onClick={() => { setInternalValue(''); onChange(''); }}
            title={t('commonEditors.clearSearch')}
          >
            ✕
          </button>
        </>
      )}
    </div>
  )
}

