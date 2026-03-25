/**
 * TransparentImg — Canvas 去白底的 <img> 替代组件
 *
 * 将白色/接近白色的像素变为透明，保留其他颜色不变暗。
 * 使用 offscreen canvas 处理，结果缓存在内存 Map 中避免重复计算。
 */

import { useState, useEffect, useRef, memo } from 'react'

// ── 全局缓存：src → 处理后的 blob URL ──
const cache = new Map<string, string>()

// ── 白底检测阈值 ──
const WHITE_THRESHOLD = 240   // RGB 全部 > 此值视为白色
const EDGE_SOFTNESS = 20      // 过渡带宽度，避免硬边

function removeWhiteBg(src: string): Promise<string> {
  // 缓存命中
  const cached = cache.get(src)
  if (cached) return Promise.resolve(cached)

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) { resolve(src); return }

      ctx.drawImage(img, 0, 0)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const data = imageData.data

      const lo = WHITE_THRESHOLD - EDGE_SOFTNESS

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2]
        const minC = Math.min(r, g, b)

        if (minC > lo) {
          // 在过渡带内：越接近纯白越透明
          if (minC >= WHITE_THRESHOLD) {
            data[i + 3] = 0 // 完全透明
          } else {
            // 线性过渡
            const t = (WHITE_THRESHOLD - minC) / EDGE_SOFTNESS
            data[i + 3] = Math.round(data[i + 3] * t)
          }
        }
        // 非白色像素保持不变
      }

      ctx.putImageData(imageData, 0, 0)

      canvas.toBlob(blob => {
        if (!blob) { resolve(src); return }
        const url = URL.createObjectURL(blob)
        cache.set(src, url)
        resolve(url)
      }, 'image/png')
    }
    img.onerror = () => resolve(src) // fallback 到原图
    img.src = src
  })
}

interface TransparentImgProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string
  /** 是否禁用去白底（默认 false） */
  noProcess?: boolean
}

export const TransparentImg = memo(function TransparentImg({
  src,
  noProcess,
  ...imgProps
}: TransparentImgProps) {
  const [processedSrc, setProcessedSrc] = useState<string>(src)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (noProcess || !src) {
      setProcessedSrc(src)
      return
    }

    // 如果缓存里有，直接用
    const cached = cache.get(src)
    if (cached) {
      setProcessedSrc(cached)
      return
    }

    // 先显示原图，后台处理
    setProcessedSrc(src)
    removeWhiteBg(src).then(url => {
      if (mountedRef.current) setProcessedSrc(url)
    })
  }, [src, noProcess])

  return <img {...imgProps} src={processedSrc} />
})
