import { useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useGMStore } from '../stores/gmStore'
import { useGameStore } from '../stores/gameStore'
import { CollapsibleSection } from './CollapsibleSections'
import { formatSettingChange, formatEventChange } from '../../../api/types'
import type { GMMessage, CollectorResult } from '../types'

function GMMessageBubble({ message }: { message: GMMessage }) {
  const { t } = useTranslation('game')
  const approveChanges = useGMStore(s => s.approveChanges)
  const rejectChanges = useGMStore(s => s.rejectChanges)
  const currentPhase = useGameStore(s => s.currentPhase)

  if (message.role === 'user') {
    return (
      <div className="gm-message gm-message-user">
        <div className="gm-bubble gm-bubble-user">
          {message.content}
        </div>
      </div>
    )
  }

  // Assistant message
  const isStreaming = message.phase && message.phase !== 'done' && message.phase !== 'error'
  const hasChanges = message.proposedChanges &&
    ((message.proposedChanges.stateChanges?.length || 0) > 0 || message.proposedChanges.settingChanges.length > 0 || (message.proposedChanges.eventChanges?.length || 0) > 0)

  // Don't allow approval while game is updating state
  const isGameBusy = currentPhase === 'generating-story' || currentPhase === 'updating-state'

  return (
    <div className="gm-message gm-message-assistant">
      <div className="gm-bubble gm-bubble-assistant">
        {/* Phase indicator */}
        {isStreaming && (
          <div className="gm-phase-indicator">
            {message.phase === 'collecting' && `🎯 ${t('ink.gm.phaseCollecting')}`}
            {message.phase === 'reasoning' && `🧠 ${t('ink.gm.phaseReasoning')}`}
            {message.phase === 'thinking' && `💭 ${t('ink.gm.phaseThinking')}`}
            {message.phase === 'analyzing' && `✍️ ${t('ink.gm.phaseAnalyzing')}`}
          </div>
        )}

        {/* Collector results (reuse gameplay-style rendering with documents) */}
        {message.collectorResults && message.collectorResults.length > 0 && (() => {
          const selectedCount = message.collectorResults.filter(r => r.selected).length
          const totalDocs = message.collectorResults.reduce((sum, entity) =>
            sum + (entity.documents?.filter(d => d.selected).length || 0), 0
          )
          return (
            <CollapsibleSection
              sectionId={`gm-collector-${message.id}`}
              title={t('ink.sections.ragCollection')}
              autoCollapsed={message.phase === 'done' || message.phase === 'analyzing'}
              icon="🎯"
              badge={t('ink.sections.ragBadge', { selectedCount, totalDocs })}
              generatingIndicator={message.phase === 'collecting'}
              className="collector-section"
            >
              {message.collectorOutline && (
                <div className="collector-outline">{message.collectorOutline}</div>
              )}
              {message.collectorResults.map((result: CollectorResult, idx: number) => (
                <div key={idx} className={`collector-item ${result.selected ? 'selected' : 'rejected'}`}>
                  <div className="collector-entity">
                    {result.selected ? '✅' : '❌'} {result.entity_id}
                  </div>
                  {result.thinking && <div className="collector-thinking">{result.thinking}</div>}
                  {result.documents && result.documents.length > 0 && (
                    <div className="collector-docs">
                      {result.documents.map((doc, docIdx: number) => (
                        <div key={docIdx} className={`doc-item ${doc.selected ? 'selected' : ''}`}>
                          <div className="doc-path">
                            {doc.selected ? '📄' : '⬜'} {doc.path}
                            {doc.flag_is_thinking_instruction && <span className="doc-phase-badge thinking">💭 {t('ink.sections.phaseThinking')}</span>}
                            {doc.flag_is_writing_instruction && <span className="doc-phase-badge writing">✍️ {t('ink.sections.phaseWriting')}</span>}
                            {doc.flag_is_updating_instruction && <span className="doc-phase-badge updating">🔄 {t('ink.sections.phaseUpdating')}</span>}
                          </div>
                          {doc.thinking && <div className="doc-thinking">{doc.thinking}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </CollapsibleSection>
          )
        })()}

        {/* Reasoning */}
        {message.reasoning && (
          <CollapsibleSection
            sectionId={`gm-reasoning-${message.id}`}
            title={t('ink.sections.reasoning')}
            autoCollapsed={!!message.content}
            icon="🧠"
            className="reasoning-section"
          >
            <pre>{message.reasoning}</pre>
          </CollapsibleSection>
        )}

        {/* Thinking */}
        {message.thinking && (
          <CollapsibleSection
            sectionId={`gm-thinking-${message.id}`}
            title={t('ink.sections.thinking')}
            autoCollapsed={!!message.content}
            icon="💭"
            className="thinking-section"
          >
            <pre>{message.thinking}</pre>
          </CollapsibleSection>
        )}

        {/* Analysis content */}
        {message.content && (
          <div className="gm-analysis">{message.content}</div>
        )}

        {/* Error */}
        {message.phase === 'error' && !message.content && (
          <div className="gm-error">{t('ink.gm.error')}</div>
        )}

        {/* Proposed changes */}
        {hasChanges && (
          <div className="gm-changes">
            <div className="gm-changes-header">📝 {t('ink.gm.proposedChanges')}</div>

            {message.proposedChanges!.stateChanges?.length > 0 && (
              <div className="gm-changes-group">
                <div className="gm-changes-label">{t('ink.gm.stateChanges')}</div>
                {message.proposedChanges!.stateChanges.map((change, idx) => (
                  <div key={idx} className="change-item">
                    <span className="change-bullet">•</span>
                    <span className="change-text">{change}</span>
                  </div>
                ))}
              </div>
            )}

            {message.proposedChanges!.settingChanges.length > 0 && (
              <div className="gm-changes-group">
                <div className="gm-changes-label">{t('ink.gm.settingChanges')}</div>
                {message.proposedChanges!.settingChanges.map((change, idx) => (
                  <div key={idx} className="change-item">
                    <span className="change-bullet">•</span>
                    <span className="change-text">{formatSettingChange(change)}</span>
                  </div>
                ))}
              </div>
            )}

            {message.proposedChanges!.eventChanges && message.proposedChanges!.eventChanges.length > 0 && (
              <div className="gm-changes-group">
                <div className="gm-changes-label">🎬 {t('ink.gm.eventChanges')}</div>
                {message.proposedChanges!.eventChanges.map((change, idx) => (
                  <div key={idx} className="change-item">
                    <span className="change-bullet">•</span>
                    <span className="change-text">{formatEventChange(change)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Approval buttons */}
            {message.approvalStatus === 'pending' && (
              <div className="gm-approval-buttons">
                <button
                  className="gm-btn gm-btn-approve"
                  onClick={() => approveChanges(message.id)}
                  disabled={isGameBusy}
                  title={isGameBusy ? t('ink.gm.gameBusy') : ''}
                >
                  ✅ {t('ink.gm.approve')}
                </button>
                <button
                  className="gm-btn gm-btn-reject"
                  onClick={() => rejectChanges(message.id)}
                >
                  ❌ {t('ink.gm.reject')}
                </button>
              </div>
            )}

            {/* Applying spinner */}
            {message.approvalStatus === 'applying' && (
              <div className="gm-status gm-status-applying">
                ⏳ {t('ink.gm.applying')}
              </div>
            )}

            {/* Applied success */}
            {message.approvalStatus === 'applied' && (
              <div className="gm-status gm-status-applied">
                ✅ {t('ink.gm.applied')}
                {message.applyResult && (
                  <CollapsibleSection
                    sectionId={`gm-result-${message.id}`}
                    title={t('ink.gm.executionDetails')}
                    autoCollapsed={true}
                    icon="📋"
                  >
                    {message.applyResult.audit && <pre>{message.applyResult.audit}</pre>}
                    {message.applyResult.results?.map((r, idx) => (
                      <div key={idx} className={`call-result ${r.success ? 'success' : 'failed'}`}>
                        {r.success ? '✅' : '❌'} [{r.service}]
                        {r.args && <pre className="call-args">{JSON.stringify(r.args, null, 2)}</pre>}
                        {r.error && <div className="call-error">{r.error}</div>}
                      </div>
                    ))}
                  </CollapsibleSection>
                )}
              </div>
            )}

            {/* Apply failed */}
            {message.approvalStatus === 'apply-failed' && (
              <div className="gm-status gm-status-failed">
                ❌ {t('ink.gm.applyFailed')}
                {message.applyResult?.error && (
                  <div className="gm-error-detail">{message.applyResult.error}</div>
                )}
                <button
                  className="gm-btn gm-btn-retry"
                  onClick={() => approveChanges(message.id)}
                  disabled={isGameBusy}
                >
                  🔄 {t('ink.error.retry')}
                </button>
              </div>
            )}

            {/* Rejected */}
            {message.approvalStatus === 'rejected' && (
              <div className="gm-status gm-status-rejected">
                ⛔ {t('ink.gm.rejected')}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function GMChat() {
  const { t } = useTranslation('game')
  const messages = useGMStore(s => s.messages)
  const inputText = useGMStore(s => s.inputText)
  const setInputText = useGMStore(s => s.setInputText)
  const sendMessage = useGMStore(s => s.sendMessage)
  const isGenerating = useGMStore(s => s.isGenerating)
  const clearChat = useGMStore(s => s.clearChat)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = useCallback(() => {
    if (inputText.trim() && !isGenerating) {
      sendMessage()
    }
  }, [inputText, isGenerating, sendMessage])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  return (
    <div className="gm-chat">
      {/* Chat header */}
      <div className="gm-chat-header">
        <span>🎮 {t('ink.gm.title')}</span>
        {messages.length > 0 && (
          <button
            className="gm-clear-btn"
            onClick={clearChat}
            disabled={isGenerating}
            title={t('ink.gm.clearChat')}
          >
            🗑️
          </button>
        )}
      </div>

      {/* Messages area */}
      <div className="gm-chat-messages">
        {messages.length === 0 && (
          <div className="gm-empty-state">
            <div className="gm-empty-icon">🎮</div>
            <div className="gm-empty-text">{t('ink.gm.emptyHint')}</div>
          </div>
        )}

        {messages.map((msg) => (
          <GMMessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="gm-chat-input">
        <textarea
          ref={textareaRef}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('ink.gm.inputPlaceholder')}
          disabled={isGenerating}
          rows={2}
        />
        <button
          className="gm-send-btn"
          onClick={handleSend}
          disabled={!inputText.trim() || isGenerating}
        >
          {isGenerating ? '⏳' : '➤'}
        </button>
      </div>
    </div>
  )
}
