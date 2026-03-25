/**
 * Editor UI State Store
 * 
 * Persists UI state (expanded paths, selected items, scroll positions) across tab switches.
 * Uses Zustand with localStorage persistence.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ============================================================================
// State Interfaces
// ============================================================================

interface SettingDocsUIState {
  expandedPaths: string[]
  selectedPath: string | null
  scrollTop: number
}

interface CreaturesUIState {
  selectedIndex: number | null
  expandedSections: string[]
  scrollTop: number
}

interface RegionsUIState {
  selectedIndex: number | null
  expandedLocations: Record<number, boolean>
  scrollTop: number
}

interface OrganizationsUIState {
  selectedIndex: number | null
  scrollTop: number
}

interface WorldUIState {
  expandedSections: string[]
  scrollTop: number
}

interface StoryHistoryUIState {
  viewingIndex: number | null
  editingIndex: number | null
  scrollTop: number
}

// ============================================================================
// Store Interface
// ============================================================================

interface EditorUIStore {
  // Per-editor UI state
  settingDocs: SettingDocsUIState
  creatures: CreaturesUIState
  regions: RegionsUIState
  organizations: OrganizationsUIState
  world: WorldUIState
  storyHistory: StoryHistoryUIState

  // Setting Documents Actions
  setSettingDocsExpanded: (paths: string[]) => void
  toggleSettingDocsExpanded: (path: string) => void
  setSettingDocsSelected: (path: string | null) => void
  setSettingDocsScroll: (scrollTop: number) => void

  // Creatures Actions
  setCreaturesSelected: (index: number | null) => void
  setCreaturesExpandedSections: (sections: string[]) => void
  toggleCreaturesSection: (section: string) => void
  setCreaturesScroll: (scrollTop: number) => void

  // Regions Actions
  setRegionsSelected: (index: number | null) => void
  toggleRegionsLocation: (regionIndex: number) => void
  setRegionsScroll: (scrollTop: number) => void

  // Organizations Actions
  setOrganizationsSelected: (index: number | null) => void
  setOrganizationsScroll: (scrollTop: number) => void

  // World Actions
  toggleWorldSection: (section: string) => void
  setWorldScroll: (scrollTop: number) => void

  // Story History Actions
  setStoryHistoryViewing: (index: number | null) => void
  setStoryHistoryEditing: (index: number | null) => void
  setStoryHistoryScroll: (scrollTop: number) => void

  // Global Actions
  resetAllState: () => void
}

// ============================================================================
// Default States
// ============================================================================

const defaultSettingDocs: SettingDocsUIState = {
  expandedPaths: [],
  selectedPath: null,
  scrollTop: 0
}

const defaultCreatures: CreaturesUIState = {
  selectedIndex: null,
  expandedSections: ['basic', 'identity'],
  scrollTop: 0
}

const defaultRegions: RegionsUIState = {
  selectedIndex: null,
  expandedLocations: {},
  scrollTop: 0
}

const defaultOrganizations: OrganizationsUIState = {
  selectedIndex: null,
  scrollTop: 0
}

const defaultWorld: WorldUIState = {
  expandedSections: [],
  scrollTop: 0
}

const defaultStoryHistory: StoryHistoryUIState = {
  viewingIndex: null,
  editingIndex: null,
  scrollTop: 0
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useEditorUIStore = create<EditorUIStore>()(
  persist(
    (set, get) => ({
      // Initial states
      settingDocs: defaultSettingDocs,
      creatures: defaultCreatures,
      regions: defaultRegions,
      organizations: defaultOrganizations,
      world: defaultWorld,
      storyHistory: defaultStoryHistory,

      // Setting Documents Actions
      setSettingDocsExpanded: (paths) => set((state) => ({
        settingDocs: { ...state.settingDocs, expandedPaths: paths }
      })),

      toggleSettingDocsExpanded: (path) => set((state) => {
        const current = state.settingDocs.expandedPaths
        const isExpanded = current.includes(path)
        return {
          settingDocs: {
            ...state.settingDocs,
            expandedPaths: isExpanded
              ? current.filter(p => p !== path)
              : [...current, path]
          }
        }
      }),

      setSettingDocsSelected: (path) => set((state) => ({
        settingDocs: { ...state.settingDocs, selectedPath: path }
      })),

      setSettingDocsScroll: (scrollTop) => set((state) => ({
        settingDocs: { ...state.settingDocs, scrollTop }
      })),

      // Creatures Actions
      setCreaturesSelected: (index) => set((state) => ({
        creatures: { ...state.creatures, selectedIndex: index }
      })),

      setCreaturesExpandedSections: (sections) => set((state) => ({
        creatures: { ...state.creatures, expandedSections: sections }
      })),

      toggleCreaturesSection: (section) => set((state) => {
        const current = state.creatures.expandedSections
        const isExpanded = current.includes(section)
        return {
          creatures: {
            ...state.creatures,
            expandedSections: isExpanded
              ? current.filter(s => s !== section)
              : [...current, section]
          }
        }
      }),

      setCreaturesScroll: (scrollTop) => set((state) => ({
        creatures: { ...state.creatures, scrollTop }
      })),

      // Regions Actions
      setRegionsSelected: (index) => set((state) => ({
        regions: { ...state.regions, selectedIndex: index }
      })),

      toggleRegionsLocation: (regionIndex) => set((state) => ({
        regions: {
          ...state.regions,
          expandedLocations: {
            ...state.regions.expandedLocations,
            [regionIndex]: !state.regions.expandedLocations[regionIndex]
          }
        }
      })),

      setRegionsScroll: (scrollTop) => set((state) => ({
        regions: { ...state.regions, scrollTop }
      })),

      // Organizations Actions
      setOrganizationsSelected: (index) => set((state) => ({
        organizations: { ...state.organizations, selectedIndex: index }
      })),

      setOrganizationsScroll: (scrollTop) => set((state) => ({
        organizations: { ...state.organizations, scrollTop }
      })),

      // World Actions
      toggleWorldSection: (section) => set((state) => {
        const current = state.world.expandedSections
        const isExpanded = current.includes(section)
        return {
          world: {
            ...state.world,
            expandedSections: isExpanded
              ? current.filter(s => s !== section)
              : [...current, section]
          }
        }
      }),

      setWorldScroll: (scrollTop) => set((state) => ({
        world: { ...state.world, scrollTop }
      })),

      // Story History Actions
      setStoryHistoryViewing: (index) => set((state) => ({
        storyHistory: { ...state.storyHistory, viewingIndex: index }
      })),

      setStoryHistoryEditing: (index) => set((state) => ({
        storyHistory: { ...state.storyHistory, editingIndex: index }
      })),

      setStoryHistoryScroll: (scrollTop) => set((state) => ({
        storyHistory: { ...state.storyHistory, scrollTop }
      })),

      // Global Actions
      resetAllState: () => set({
        settingDocs: defaultSettingDocs,
        creatures: defaultCreatures,
        regions: defaultRegions,
        organizations: defaultOrganizations,
        world: defaultWorld,
        storyHistory: defaultStoryHistory
      })
    }),
    {
      name: 'editor-ui-state',
      // Only persist essential state, skip scroll positions
      partialize: (state) => ({
        settingDocs: {
          expandedPaths: state.settingDocs.expandedPaths,
          selectedPath: state.settingDocs.selectedPath,
          scrollTop: 0
        },
        creatures: {
          selectedIndex: state.creatures.selectedIndex,
          expandedSections: state.creatures.expandedSections,
          scrollTop: 0
        },
        regions: {
          selectedIndex: state.regions.selectedIndex,
          expandedLocations: state.regions.expandedLocations,
          scrollTop: 0
        },
        organizations: {
          selectedIndex: state.organizations.selectedIndex,
          scrollTop: 0
        },
        world: {
          expandedSections: state.world.expandedSections,
          scrollTop: 0
        },
        storyHistory: {
          viewingIndex: null,
          editingIndex: null,
          scrollTop: 0
        }
      })
    }
  )
)
