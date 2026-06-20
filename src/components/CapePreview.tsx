import { useEffect, useRef } from 'react'

export function CapePreview({ url, name }: { url: string; name: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !url) return
    const context = canvas.getContext('2d')
    if (!context) return

    const image = new Image()
    image.onload = () => {
      const unitX = image.naturalWidth / 64
      const unitY = image.naturalHeight / 32
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.imageSmoothingEnabled = false
      context.drawImage(
        image,
        unitX,
        unitY,
        unitX * 10,
        unitY * 16,
        0,
        0,
        canvas.width,
        canvas.height,
      )
    }
    image.src = url
    return () => {
      image.onload = null
    }
  }, [url])

  return <canvas ref={canvasRef} className="cape-preview" width={50} height={80} aria-label={`${name} cape preview`} />
}
