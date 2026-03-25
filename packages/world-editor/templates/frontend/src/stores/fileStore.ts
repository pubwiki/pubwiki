import { create } from 'zustand'
import type { UploadedFile } from '../api/types'
import {
  initCopilotDB,
  loadUploadedFiles,
  addUploadedFile as svcAddFile,
  removeUploadedFile as svcRemoveFile,
  clearUploadedFiles as svcClearFiles,
} from '../api/copilotService'

interface FileState {
  files: UploadedFile[]
  initialized: boolean
  initFiles: () => Promise<void>
  addFile: (file: UploadedFile) => void
  removeFile: (filename: string) => void
  clearFiles: () => void
}

export const useFileStore = create<FileState>()((set) => ({
  files: [],
  initialized: false,

  initFiles: async () => {
    await initCopilotDB()
    set({ files: [...loadUploadedFiles()], initialized: true })
  },

  addFile: (file) => {
    svcAddFile(file)
    set({ files: [...loadUploadedFiles()] })
  },

  removeFile: (filename) => {
    svcRemoveFile(filename)
    set({ files: [...loadUploadedFiles()] })
  },

  clearFiles: () => {
    svcClearFiles()
    set({ files: [] })
  },
}))

/** Non-hook version for use in callbacks */
export function getFilesSnapshot(): UploadedFile[] {
  return useFileStore.getState().files
}
