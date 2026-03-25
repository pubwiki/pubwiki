import type { StateData } from '../../../api/types'
import { getGameState } from '../../utils'
import { useRegistryStore } from './registryStore'
import { useCreatureStore } from './creatureStore'
import { useUIStore } from './uiStore'

/**
 * 统一刷新协调器：一次 getGameState() 获取数据，分发给所有 store。
 * refreshCreatures() 使用独立的 ECS 查询，与 state 数据加载并行执行。
 *
 * @param prefetchedData 可选的预取 StateData，传入则跳过 getGameState()
 * @returns StateData（供调用者继续使用，如提取 GameInitialStory）
 */
export async function refreshAllGameData(prefetchedData?: StateData): Promise<StateData | null> {
  const { setIsRefreshing } = useUIStore.getState()
  setIsRefreshing(true)

  try {
    let stateData: StateData | null = prefetchedData ?? null

    if (!stateData) {
      const gameState = await getGameState()
      if (!gameState.success || !gameState.data) {
        console.error('Failed to fetch game state:', gameState.error)
        return null
      }
      stateData = gameState.data
    }

    const { loadRegistries } = useRegistryStore.getState()
    const { loadEntityMaps, refreshCreatures } = useCreatureStore.getState()

    await Promise.all([
      loadRegistries(stateData),
      loadEntityMaps(stateData),
      refreshCreatures(),
    ])

    return stateData
  } catch (e) {
    console.error('refreshAllGameData failed:', e)
    return null
  } finally {
    setIsRefreshing(false)
  }
}
