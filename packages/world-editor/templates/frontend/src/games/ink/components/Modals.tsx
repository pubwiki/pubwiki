import { useTranslation } from 'react-i18next'
import { useGameStore } from '../stores/gameStore'
import { useModalStore } from '../stores/modalStore'
import { isStoryTurn, isPlayerActionTurn } from '../types'
import type { StoryTurn, PlayerActionTurn } from '../types'

export function PublishModal() {
  const { t } = useTranslation('game')
  const inkTurns = useGameStore(s => s.inkTurns)
  
  const {
    publishModalOpen,
    publishStartTurn,
    publishEndTurn,
    publishing,
    closePublishModal,
    setPublishStartTurn,
    setPublishEndTurn,
    setPublishing
  } = useModalStore()
  
  if (!publishModalOpen) return null
  
  const storyTurns = inkTurns.filter((t): t is StoryTurn => isStoryTurn(t) && t.generationPhase === 'done')
  
  const handlePublish = async () => {
    const selectedTurns = storyTurns.slice(publishStartTurn, publishEndTurn + 1)
    
    if (selectedTurns.length === 0) {
      alert(t('publish.noChaptersSelected'))
      return
    }
    
    setPublishing(true)
    try {
      // 构建文章内容数组
      const content: Array<{
        type: "text",
        id: string,
        text: string,
      } | {
        type: "game_ref",
        textId: string,
        checkpointId: string,
      }> = []
      
      // 去除段落开头的【A1】等标记
      const stripMarkers = (text: string) => text.replace(/^【[A-Za-z0-9]+】\s*/gm, '')

      for (let idx = 0; idx < selectedTurns.length; idx++) {
        const turn = selectedTurns[idx]
        const textBlockId = `turn-${turn.id}`

        const chapterTitle = turn.chapterHint || t('publish.chapterDefault', { num: publishStartTurn + idx + 1 })
        let chapterContent = `## ${chapterTitle}\n\n`

        // 添加玩家行动
        if (turn.relatedActionId != null) {
          const actionTurn = inkTurns.find(
            (t): t is PlayerActionTurn => isPlayerActionTurn(t) && t.id === turn.relatedActionId
          )
          if (actionTurn) {
            chapterContent += `> ${actionTurn.playerAction}\n\n`
          }
        }

        if (turn.content) {
          chapterContent += stripMarkers(turn.content) + '\n\n'
        }
        if (turn.contentPart2) {
          chapterContent += stripMarkers(turn.contentPart2) + '\n\n'
        }
        
        content.push({
          type: "text",
          id: textBlockId,
          text: chapterContent.trim(),
        })
        
        if (turn.checkpointId) {
          content.push({
            type: "game_ref",
            textId: textBlockId,
            checkpointId: turn.checkpointId,
          })
        }
      }

      console.log('Publishing article with content:', content)
      
      const result = await window.PublishArticle({
        content,
      })
      
      if (result.success) {
        alert(t('publish.success', { articleId: result.articleId || t('common:unknown') }))
        closePublishModal()
      } else {
        alert(t('publish.failed', { error: result.error || t('common:unknown') }))
      }
    } catch (e) {
      console.error('Failed to publish article:', e)
      alert(t('publish.failed', { error: (e as Error).message }))
    } finally {
      setPublishing(false)
    }
  }
  
  return (
    <div className="game-modal-overlay" onClick={closePublishModal}>
      <div className="game-modal publish-modal" onClick={(e) => e.stopPropagation()}>
        <div className="game-modal-header">
          <h2>{t('publish.title')}</h2>
          <button className="game-modal-close" onClick={closePublishModal}>✕</button>
        </div>
        <div className="game-modal-content" style={{ padding: '1.5rem' }}>
          <div className="publish-form-group">
            <label>{t('publish.selectRange')}</label>
            <div className="publish-range">
              <div>
                <label>{t('publish.from')}</label>
                <select
                  value={publishStartTurn}
                  onChange={(e) => setPublishStartTurn(parseInt(e.target.value))}
                  className="publish-select-small"
                >
                  {storyTurns.map((turn, idx) => (
                    <option key={turn.id} value={idx}>
                      {idx + 1}. {turn.chapterHint || t('publish.chapterDefault', { num: idx + 1 })}
                    </option>
                  ))}
                </select>
                <label>{t('publish.chapter')}</label>
              </div>
              <div>
                <label>{t('publish.to')}</label>
                <select
                  value={publishEndTurn}
                  onChange={(e) => setPublishEndTurn(parseInt(e.target.value))}
                  className="publish-select-small"
                >
                  {storyTurns.map((turn, idx) => (
                    <option key={turn.id} value={idx} disabled={idx < publishStartTurn}>
                      {idx + 1}. {turn.chapterHint || t('publish.chapterDefault', { num: idx + 1 })}
                    </option>
                  ))}
                </select>
                <label>{t('publish.chapter')}</label>
              </div>
            </div>
            <div className="publish-range-hint">
              {t('publish.chapterCount', { count: publishEndTurn - publishStartTurn + 1 })}
            </div>
          </div>
          
          <div className="publish-preview">
            <h4>{t('publish.previewList')}</h4>
            <div className="publish-chapter-list">
              {storyTurns.slice(publishStartTurn, publishEndTurn + 1).map((turn, idx) => (
                <div key={turn.id} className="publish-chapter-item">
                  <span className="chapter-number">{publishStartTurn + idx + 1}</span>
                  <span className="chapter-title">{turn.chapterHint || t('publish.chapterDefault', { num: publishStartTurn + idx + 1 })}</span>
                  {turn.checkpointId && <span className="has-checkpoint" title={t('publish.hasCheckpoint')}></span>}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="game-modal-footer" style={{ padding: '1rem 1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem', borderTop: '1px solid #d1cec7' }}>
          <button 
            className="btn-cancel" 
            onClick={closePublishModal}
            disabled={publishing}
          >
            {t('common:cancel')}
          </button>
          <button 
            className="btn-primary" 
            onClick={handlePublish}
            disabled={publishing}
          >
            {publishing ? t('publish.publishing') : t('publish.next')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ThinkingModal() {
  const { t } = useTranslation('game')
  const { thinkingModalOpen, thinkingModalContent, closeThinkingModal } = useModalStore()
  
  if (!thinkingModalOpen) return null
  
  return (
    <div className="game-modal-overlay" onClick={closeThinkingModal}>
      <div className="game-modal" onClick={(e) => e.stopPropagation()}>
        <div className="game-modal-header">
          <h3>{t('modals.thinking')}</h3>
          <button className="game-modal-close" onClick={closeThinkingModal}>✕</button>
        </div>
        <div className="game-modal-content">
          {thinkingModalContent}
        </div>
      </div>
    </div>
  )
}

interface PreviewStoryModalProps {
  isOpen: boolean
  onClose: () => void
  content: string
  onConfirm: () => void
}

export function PreviewStoryModal({ isOpen, onClose, content, onConfirm }: PreviewStoryModalProps) {
  const { t } = useTranslation(['game', 'common'])
  if (!isOpen) return null
  
  return (
    <div className="game-modal-overlay" onClick={onClose}>
      <div className="game-modal preview-story-modal" onClick={(e) => e.stopPropagation()}>
        <div className="game-modal-header">
          <h3>{t('modals.storyPreview')}</h3>
          <button className="game-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="game-modal-content">
          <div className="preview-content">
            {content}
          </div>
        </div>
        <div className="game-modal-footer" style={{ padding: '1rem 1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem', borderTop: '1px solid #d1cec7' }}>
          <button className="btn-cancel" onClick={onClose}>{t('common:cancel')}</button>
          <button className="btn-primary" onClick={onConfirm}>{t('common:confirm')}</button>
        </div>
      </div>
    </div>
  )
}

interface ConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  message: string
  onConfirm: () => void
}

export function ConfirmModal({ isOpen, onClose, message, onConfirm }: ConfirmModalProps) {
  const { t } = useTranslation(['game', 'common'])
  if (!isOpen) return null

  return (
    <div className="game-modal-overlay" onClick={onClose}>
      <div className="game-modal confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="game-modal-header">
          <h3>{t('modals.confirm')}</h3>
          <button className="game-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="game-modal-content">
          <p>{message}</p>
        </div>
        <div className="game-modal-footer" style={{ padding: '1rem 1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem', borderTop: '1px solid #d1cec7' }}>
          <button className="btn-cancel" onClick={onClose}>{t('common:cancel')}</button>
          <button className="btn-primary" onClick={onConfirm}>{t('common:confirm')}</button>
        </div>
      </div>
    </div>
  )
}

export function PublishCheckpointModal() {
  const { t } = useTranslation(['game', 'common'])
  const {
    publishCheckpointModalOpen,
    publishCheckpointId,
    publishCheckpointListed,
    publishingCheckpoint,
    closePublishCheckpointModal,
    setPublishCheckpointListed,
    setPublishingCheckpoint,
  } = useModalStore()

  if (!publishCheckpointModalOpen || !publishCheckpointId) return null

  const handlePublish = async () => {
    setPublishingCheckpoint(true)
    try {
      const result = await window.PublishCheckpoint({
        checkpointId: publishCheckpointId,
        isListed: publishCheckpointListed,
      })
      if (result.success) {
        alert(t('game:ink.publishCheckpoint.success'))
        closePublishCheckpointModal()
      } else {
        alert(t('game:ink.publishCheckpoint.failed', { error: result.error || '' }))
      }
    } catch (e) {
      alert(t('game:ink.publishCheckpoint.failed', { error: (e as Error).message }))
    } finally {
      setPublishingCheckpoint(false)
    }
  }

  return (
    <div className="game-modal-overlay" onClick={closePublishCheckpointModal}>
      <div className="game-modal confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="game-modal-header">
          <h3>{t('game:ink.publishCheckpoint.modalTitle')}</h3>
          <button className="game-modal-close" onClick={closePublishCheckpointModal}>✕</button>
        </div>
        <div className="game-modal-content">
          <div className="publish-form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={publishCheckpointListed}
                onChange={(e) => setPublishCheckpointListed(e.target.checked)}
              />
              {t('game:ink.publishCheckpoint.isListed')}
            </label>
            <p style={{ fontSize: '0.85rem', opacity: 0.6, marginTop: '0.4rem' }}>
              {publishCheckpointListed
                ? t('game:ink.publishCheckpoint.listedHint')
                : t('game:ink.publishCheckpoint.unlistedHint')
              }
            </p>
          </div>
        </div>
        <div className="game-modal-footer" style={{ padding: '1rem 1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem', borderTop: '1px solid #d1cec7' }}>
          <button
            className="btn-cancel"
            onClick={closePublishCheckpointModal}
            disabled={publishingCheckpoint}
          >
            {t('common:cancel')}
          </button>
          <button
            className="btn-primary"
            onClick={handlePublish}
            disabled={publishingCheckpoint}
          >
            {publishingCheckpoint ? t('game:ink.publishCheckpoint.publishing') : t('game:ink.publishCheckpoint.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
