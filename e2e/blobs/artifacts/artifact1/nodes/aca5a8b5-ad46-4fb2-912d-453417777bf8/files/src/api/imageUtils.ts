/**
 * Image Utilities
 *
 * Handles image file reading, compression/resizing, and IndexedDB persistence.
 * Images are stored in IndexedDB (not localStorage) to avoid size limits.
 */

import i18next from 'i18next'
import type { UploadedFile } from './types'

// ============================================================================
// Constants
// ============================================================================

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp']
export const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.gif,.webp'

const MAX_DIMENSION = 1536
const MAX_SIZE_BYTES = 5 * 1024 * 1024 // 5MB after compression

const DB_NAME = 'copilot-images'
const DB_VERSION = 1
const STORE_NAME = 'images'

// ============================================================================
// Image Reading & Compression
// ============================================================================

/**
 * Read an image file, optionally resize if too large, and return as UploadedFile.
 */
export async function readImageFile(file: File): Promise<UploadedFile> {
    const originalDataUrl = await fileToDataUrl(file)
    const mimeType = file.type || 'image/png'

    // Load image to get dimensions
    const img = await loadImage(originalDataUrl)
    const { width, height } = img

    let resultDataUrl = originalDataUrl
    let resultSize = file.size

    // Resize if exceeds max dimension
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const scale = MAX_DIMENSION / Math.max(width, height)
        const newWidth = Math.round(width * scale)
        const newHeight = Math.round(height * scale)

        const canvas = document.createElement('canvas')
        canvas.width = newWidth
        canvas.height = newHeight
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, newWidth, newHeight)

        // Use JPEG for photos (smaller), keep PNG for transparency
        const outputType = mimeType === 'image/png' ? 'image/png' : 'image/jpeg'
        const quality = outputType === 'image/jpeg' ? 0.85 : undefined
        resultDataUrl = canvas.toDataURL(outputType, quality)
        resultSize = dataUrlToSize(resultDataUrl)
    }

    // If still too large, try lower quality JPEG
    if (resultSize > MAX_SIZE_BYTES) {
        const canvas = document.createElement('canvas')
        const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height))
        canvas.width = Math.round(width * scale)
        canvas.height = Math.round(height * scale)
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

        for (const q of [0.7, 0.5, 0.3]) {
            resultDataUrl = canvas.toDataURL('image/jpeg', q)
            resultSize = dataUrlToSize(resultDataUrl)
            if (resultSize <= MAX_SIZE_BYTES) break
        }

        if (resultSize > MAX_SIZE_BYTES) {
            throw new Error(i18next.t('common:imageTooLarge', { size: MAX_SIZE_BYTES / 1024 / 1024 }))
        }
    }

    return {
        name: file.name,
        content: '', // Images don't use text content
        type: 'image',
        size: resultSize,
        uploadedAt: Date.now(),
        dataUrl: resultDataUrl,
        mimeType,
    }
}

function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
    })
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('Failed to load image'))
        img.src = src
    })
}

function dataUrlToSize(dataUrl: string): number {
    // data:image/...;base64, prefix then base64 data
    const base64 = dataUrl.split(',')[1] || ''
    return Math.ceil(base64.length * 3 / 4)
}

// ============================================================================
// IndexedDB Storage
// ============================================================================

interface StoredImage {
    name: string
    dataUrl: string
    mimeType: string
    size: number
    uploadedAt: number
}

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'name' })
            }
        }
    })
}

export async function saveImageToDB(file: UploadedFile): Promise<void> {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const record: StoredImage = {
        name: file.name,
        dataUrl: file.dataUrl || '',
        mimeType: file.mimeType || 'image/png',
        size: file.size,
        uploadedAt: file.uploadedAt,
    }
    store.put(record)
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
    })
}

export async function loadAllImagesFromDB(): Promise<UploadedFile[]> {
    try {
        const db = await openDB()
        const tx = db.transaction(STORE_NAME, 'readonly')
        const store = tx.objectStore(STORE_NAME)
        const request = store.getAll()
        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                const records = request.result as StoredImage[]
                resolve(records.map(r => ({
                    name: r.name,
                    content: '',
                    type: 'image' as const,
                    size: r.size,
                    uploadedAt: r.uploadedAt,
                    dataUrl: r.dataUrl,
                    mimeType: r.mimeType,
                })))
            }
            request.onerror = () => reject(request.error)
        })
    } catch (e) {
        console.error('Failed to load images from IndexedDB:', e)
        return []
    }
}

export async function removeImageFromDB(filename: string): Promise<void> {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.delete(filename)
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
    })
}

export async function clearAllImagesFromDB(): Promise<void> {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.clear()
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
    })
}
