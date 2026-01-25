export { 
  VersionDAG, 
  createVersionDAG, 
  createVersionDAGWithStore,
  createVersionDAGWithDatabase,
} from './dag.js'

export { 
  VersionStore, 
  VersionDatabase,
  type RefNodeRecord,
  type ChildrenRecord,
  type CheckpointRecord,
  type CheckpointDataRecord,
  type MetaRecord,
} from './store.js'
