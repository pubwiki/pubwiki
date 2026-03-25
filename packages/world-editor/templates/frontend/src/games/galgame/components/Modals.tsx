import { useTranslation } from 'react-i18next'
import { useGameStore } from '../stores/gameStore'
import { useModalStore } from '../stores/modalStore'
import { isGalStoryTurn } from '../types'
import type { GalStoryTurn } from '../types'

export function PublishModal() {
  const { t } = useTranslation('game')
  const galTurns = useGameStore(s => s.galTurns)

  const {
    publishModalOpen,
    publishStartTurn,
    publishEndTurn,
    publishTitle,
    publishVisibility,
    publishing,
    closePublishModal,
    setPublishStartTurn,
    setPublishEndTurn,
    setPublishTitle,
    setPublishVisibility,
    setPublishing
  } = useModalStore()

  if (!publishModalOpen) return null

  const storyTurns = galTurns.filter((t): t is GalStoryTurn => isGalStoryTurn(t) && t.generationPhase === 'done')

  const handlePublish = async () => {
    const selectedTurns = storyTurns.slice(publishStartTurn, publishEndTurn + 1)

    if (selectedTurns.length === 0) {
      alert(t('publish.noChaptersSelected'))
      return
    }

    setPublishing(true)
    try {
      const content: Array<{
        type: "text",
        id: string,
        text: string,
      } | {
        type: "game_ref",
        textId: string,
        checkpointId: string,
      }> = []

      for (let idx = 0; idx < selectedTurns.length; idx++) {
        const turn = selectedTurns[idx]
        const textBlockId = `turn-${turn.id}`

        const chapterTitle = turn.chapterTitle || t('publish.chapterDefault', { num: publishStartTurn + idx + 1 })
        let chapterContent = `## ${chapterTitle}\n\n`

        // 将对话转为文本格式
        for (const d of (turn.story || [])) {
          if (d.speaker_creature_id) {
            chapterContent += `**${d.speaker_display_name}**: ${d.dialogue}\n\n`
          } else {
            chapterContent += `*${d.dialogue}*\n\n`
          }
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

      const result = await window.PublishArticle({
        title: publishTitle || undefined,
        content,
        visibility: publishVisibility
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
    <div className="modal-overlay" onClick={closePublishModal}>
      <div className="modal-content publish-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t('publish.title')}</h2>
          <button className="modal-close" onClick={closePublishModal}>✕</button>
        </div>
        <div className="modal-body">
          <div className="publish-form-group">
            <label>{t('publish.articleTitle')}</label>
            <input
              type="text"
              value={publishTitle}
              onChange={(e) => setPublishTitle(e.target.value)}
              placeholder={t('publish.titlePlaceholder')}
              className="publish-input"
            />
          </div>

          <div className="publish-form-group">
            <label>{t('publish.visibility')}</label>
            <select
              value={publishVisibility}
              onChange={(e) => setPublishVisibility(e.target.value as any)}
              className="publish-select"
            >
              <option value="PUBLIC">{t('publish.public')}</option>
              <option value="UNLISTED">{t('publish.unlisted')}</option>
              <option value="PRIVATE">{t('publish.private')}</option>
            </select>
          </div>

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
                      {idx + 1}. {turn.chapterTitle || t('publish.chapterDefault', { num: idx + 1 })}
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
                      {idx + 1}. {turn.chapterTitle || t('publish.chapterDefault', { num: idx + 1 })}
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
                  <span className="chapter-title">{turn.chapterTitle || t('publish.chapterDefault', { num: publishStartTurn + idx + 1 })}</span>
                  {turn.checkpointId && <span className="has-checkpoint" title={t('publish.hasCheckpoint')}>💾</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-cancel" onClick={closePublishModal} disabled={publishing}>
            {t('common:cancel')}
          </button>
          <button className="btn-primary" onClick={handlePublish} disabled={publishing}>
            {publishing ? t('publish.publishing') : t('publish.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
