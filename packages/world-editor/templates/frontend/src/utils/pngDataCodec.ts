/**
 * PNG 数据编解码器
 * 将 JSON 数据编码到 PNG 图片中，或从 PNG 图片中解码数据
 * 使用 PNG 的 tEXt chunk 来存储自定义数据
 */

import i18next from 'i18next'

// PNG 文件签名
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

// CRC32 查找表
const crcTable: number[] = []
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) {
    if (c & 1) {
      c = 0xedb88320 ^ (c >>> 1)
    } else {
      c = c >>> 1
    }
  }
  crcTable[n] = c
}

// 计算 CRC32
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

// 将数字转为 4 字节大端序
function uint32ToBytes(num: number): Uint8Array {
  return new Uint8Array([
    (num >> 24) & 0xff,
    (num >> 16) & 0xff,
    (num >> 8) & 0xff,
    num & 0xff
  ])
}

// 从 4 字节大端序读取数字
function bytesToUint32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]
  ) >>> 0
}

// 创建 PNG chunk
function createChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type)
  const length = uint32ToBytes(data.length)
  
  // CRC 计算包含 type + data
  const crcData = new Uint8Array(typeBytes.length + data.length)
  crcData.set(typeBytes, 0)
  crcData.set(data, typeBytes.length)
  const crc = uint32ToBytes(crc32(crcData))
  
  // 完整 chunk: length + type + data + crc
  const chunk = new Uint8Array(4 + 4 + data.length + 4)
  chunk.set(length, 0)
  chunk.set(typeBytes, 4)
  chunk.set(data, 8)
  chunk.set(crc, 8 + data.length)
  
  return chunk
}

// 创建 tEXt chunk（用于存储文本数据）
function createTextChunk(keyword: string, text: string): Uint8Array {
  const keywordBytes = new TextEncoder().encode(keyword)
  const textBytes = new TextEncoder().encode(text)
  
  // tEXt 格式: keyword + null + text
  const data = new Uint8Array(keywordBytes.length + 1 + textBytes.length)
  data.set(keywordBytes, 0)
  data[keywordBytes.length] = 0 // null separator
  data.set(textBytes, keywordBytes.length + 1)
  
  return createChunk('tEXt', data)
}

// 生成一个简单的彩色图案 PNG（作为数据载体）
async function generateCarrierImage(width: number, height: number): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  
  // 创建渐变背景
  const gradient = ctx.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, '#667eea')
  gradient.addColorStop(0.5, '#764ba2')
  gradient.addColorStop(1, '#f093fb')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)
  
  // 添加装饰图案
  ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'
  for (let i = 0; i < 20; i++) {
    const x = Math.random() * width
    const y = Math.random() * height
    const size = Math.random() * 30 + 10
    ctx.beginPath()
    ctx.arc(x, y, size, 0, Math.PI * 2)
    ctx.fill()
  }
  
  // 添加标题文字
  ctx.fillStyle = 'white'
  ctx.font = 'bold 24px Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(0, 0, 0, 0.3)'
  ctx.shadowBlur = 4
  ctx.shadowOffsetX = 2
  ctx.shadowOffsetY = 2
  ctx.fillText(i18next.t('editor:pngCodec.gameSave'), width / 2, height / 2 - 20)
  
  ctx.font = '14px Arial, sans-serif'
  ctx.shadowBlur = 2
  const date = new Date().toLocaleString(i18next.language || 'zh-CN')
  ctx.fillText(date, width / 2, height / 2 + 20)
  
  ctx.font = '12px Arial, sans-serif'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
  ctx.fillText(i18next.t('editor:pngCodec.containsGameData'), width / 2, height / 2 + 45)
  
  // 转换为 blob 然后读取为 ArrayBuffer
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to create blob'))
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        resolve(new Uint8Array(reader.result as ArrayBuffer))
      }
      reader.onerror = reject
      reader.readAsArrayBuffer(blob)
    }, 'image/png')
  })
}

// 处理自定义封面图片，转换为 PNG 格式
async function processCustomImage(imageFile: File | Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(imageFile)
    
    img.onload = () => {
      URL.revokeObjectURL(url)
      
      // 创建 canvas 并绘制图片
      const canvas = document.createElement('canvas')
      
      // 限制最大尺寸以避免图片过大
      const maxSize = 800
      let width = img.width
      let height = img.height
      
      if (width > maxSize || height > maxSize) {
        if (width > height) {
          height = Math.round(height * maxSize / width)
          width = maxSize
        } else {
          width = Math.round(width * maxSize / height)
          height = maxSize
        }
      }
      
      canvas.width = width
      canvas.height = height
      
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)
      
      // 在右下角添加小标记
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
      ctx.fillRect(width - 120, height - 24, 120, 24)
      ctx.fillStyle = 'white'
      ctx.font = '12px Arial, sans-serif'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText(i18next.t('editor:pngCodec.containsSaveData'), width - 8, height - 12)
      
      // 转换为 PNG
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to convert image to PNG'))
          return
        }
        const reader = new FileReader()
        reader.onload = () => {
          resolve(new Uint8Array(reader.result as ArrayBuffer))
        }
        reader.onerror = reject
        reader.readAsArrayBuffer(blob)
      }, 'image/png')
    }
    
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }
    
    img.src = url
  })
}
// 解析 PNG chunks
function parsePngChunks(data: Uint8Array): Array<{ type: string; data: Uint8Array; offset: number }> {
  const chunks: Array<{ type: string; data: Uint8Array; offset: number }> = []
  let offset = 8 // 跳过 PNG 签名
  
  while (offset < data.length) {
    const length = bytesToUint32(data, offset)
    const type = new TextDecoder().decode(data.slice(offset + 4, offset + 8))
    const chunkData = data.slice(offset + 8, offset + 8 + length)
    
    chunks.push({ type, data: chunkData, offset })
    offset += 12 + length // 4(length) + 4(type) + length + 4(crc)
  }
  
  return chunks
}

/**
 * 将 JSON 数据编码到 PNG 图片中
 * @param jsonData 要编码的数据
 * @param customImage 可选的自定义封面图片（File 或 Blob）
 * @returns PNG 图片的 Blob
 */
export async function encodeDataToPng(jsonData: unknown, customImage?: File | Blob): Promise<Blob> {
  let pngData: Uint8Array
  
  if (customImage) {
    // 使用自定义图片作为载体
    pngData = await processCustomImage(customImage)
  } else {
    // 生成默认载体图片
    pngData = await generateCarrierImage(400, 300)
  }
  
  // 解析 PNG chunks
  const chunks = parsePngChunks(pngData)
  
  // 找到 IEND chunk 的位置（在它之前插入自定义数据）
  const iendIndex = chunks.findIndex(c => c.type === 'IEND')
  if (iendIndex === -1) {
    throw new Error('Invalid PNG: no IEND chunk')
  }
  
  // 将 JSON 数据压缩并编码为 Base64
  const jsonString = JSON.stringify(jsonData)
  const compressedData = await compressString(jsonString)
  const base64Data = btoa(String.fromCharCode(...new Uint8Array(compressedData)))
  
  // 创建自定义 tEXt chunk
  const customChunk = createTextChunk('GameData', base64Data)
  
  // 重建 PNG：签名 + 原有 chunks（IEND 之前）+ 自定义 chunk + IEND
  const iendOffset = chunks[iendIndex].offset
  const beforeIend = pngData.slice(0, iendOffset)
  const iendChunk = pngData.slice(iendOffset)
  
  const newPng = new Uint8Array(beforeIend.length + customChunk.length + iendChunk.length)
  newPng.set(beforeIend, 0)
  newPng.set(customChunk, beforeIend.length)
  newPng.set(iendChunk, beforeIend.length + customChunk.length)
  
  return new Blob([newPng], { type: 'image/png' })
}

/**
 * 从 PNG 图片中解码 JSON 数据
 * @param pngBlob PNG 图片的 Blob 或 File
 * @returns 解码后的数据，如果没有找到数据则返回 null
 */
export async function decodeDataFromPng(pngBlob: Blob): Promise<unknown | null> {
  const arrayBuffer = await pngBlob.arrayBuffer()
  const data = new Uint8Array(arrayBuffer)
  
  // 验证 PNG 签名
  for (let i = 0; i < 8; i++) {
    if (data[i] !== PNG_SIGNATURE[i]) {
      throw new Error('Invalid PNG file')
    }
  }
  
  // 解析 chunks
  const chunks = parsePngChunks(data)
  
  // 查找自定义数据 chunk
  for (const chunk of chunks) {
    if (chunk.type === 'tEXt') {
      // 解析 tEXt chunk
      const nullIndex = chunk.data.indexOf(0)
      if (nullIndex === -1) continue
      
      const keyword = new TextDecoder().decode(chunk.data.slice(0, nullIndex))
      if (keyword === 'GameData') {
        const base64Data = new TextDecoder().decode(chunk.data.slice(nullIndex + 1))
        
        // Base64 解码
        const binaryString = atob(base64Data)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        
        // 解压缩
        const jsonString = await decompressData(bytes)
        return JSON.parse(jsonString)
      }
    }
  }
  
  return null
}

// 压缩字符串（使用 CompressionStream API）
async function compressString(str: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder()
  const data = encoder.encode(str)
  
  // 检查是否支持 CompressionStream
  if (typeof CompressionStream !== 'undefined') {
    const cs = new CompressionStream('gzip')
    const writer = cs.writable.getWriter()
    writer.write(data)
    writer.close()
    
    const chunks: Uint8Array[] = []
    const reader = cs.readable.getReader()
    
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }
    
    return result.buffer
  } else {
    // 降级：不压缩
    return data.buffer
  }
}

// 解压缩数据
async function decompressData(data: Uint8Array): Promise<string> {
  // 检查是否是 gzip 数据（gzip 魔数：1f 8b）
  if (data[0] === 0x1f && data[1] === 0x8b && typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('gzip')
    const writer = ds.writable.getWriter()
    // 创建新的 ArrayBuffer 来避免类型问题
    const buffer = new ArrayBuffer(data.length)
    new Uint8Array(buffer).set(data)
    writer.write(buffer)
    writer.close()
    
    const chunks: Uint8Array[] = []
    const reader = ds.readable.getReader()
    
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }
    
    return new TextDecoder().decode(result)
  } else {
    // 未压缩数据
    return new TextDecoder().decode(data)
  }
}

/**
 * 检测文件是否是包含游戏数据的 PNG
 */
export async function isPngWithGameData(file: File): Promise<boolean> {
  if (!file.type.includes('png') && !file.name.toLowerCase().endsWith('.png')) {
    return false
  }
  
  try {
    const data = await decodeDataFromPng(file)
    return data !== null
  } catch {
    return false
  }
}

/**
 * 将 PNG Blob 转换为可显示的 Data URL
 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
