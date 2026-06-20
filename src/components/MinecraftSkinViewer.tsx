import { useEffect, useRef } from 'react'
import { IdleAnimation, SkinViewer } from 'skinview3d'

interface MinecraftSkinViewerProps {
  skinUrl?: string
  variant?: 'classic' | 'slim'
  name?: string
}

export function MinecraftSkinViewer({ skinUrl, variant = 'classic', name }: MinecraftSkinViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !skinUrl) return

    const animation = new IdleAnimation()
    animation.speed = 0.75
    const viewer = new SkinViewer({
      canvas,
      width: Math.max(220, canvas.clientWidth || 280),
      height: Math.max(320, canvas.clientHeight || 430),
      skin: skinUrl,
      model: variant === 'slim' ? 'slim' : 'default',
      animation,
      enableControls: true,
      zoom: 0.82,
      fov: 48
    })
    viewer.autoRotate = true
    viewer.autoRotateSpeed = 0.35
    viewer.controls.enablePan = false
    viewer.controls.minDistance = 28
    viewer.controls.maxDistance = 70

    const resize = () => {
      const width = Math.max(220, canvas.clientWidth)
      const height = Math.max(320, canvas.clientHeight)
      viewer.setSize(width, height)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()

    return () => {
      observer.disconnect()
      viewer.dispose()
    }
  }, [skinUrl, variant, name])

  if (!skinUrl) {
    return (
      <div className="skin-placeholder skin-placeholder--model" aria-label="No skin available">
        <span /><span /><span /><span />
      </div>
    )
  }

  return <canvas ref={canvasRef} className="minecraft-skin-viewer" aria-label={`${name || 'Minecraft'} 3D skin preview`} />
}
