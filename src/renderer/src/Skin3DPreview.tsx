import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'

type Vec3 = [number, number, number]
type Point = { x: number; y: number; z: number }
type UvRect = { x: number; y: number; w: number; h: number }
type FaceName = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'
type TextureFaces = Partial<Record<FaceName, UvRect>>
type LocalTransform = (point: Vec3) => Vec3

interface Skin3DPreviewProps {
  skinUrl?: string
  capeUrl?: string
  slim?: boolean
  loading?: boolean
}

interface RenderFace {
  points: Point[]
  uv: UvRect
  image: HTMLImageElement
  shade: number
  depth: number
}

const DEG = Math.PI / 180

function rotatePoint(point: Vec3, yaw: number, pitch: number): Vec3 {
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const x1 = point[0] * cy - point[2] * sy
  const z1 = point[0] * sy + point[2] * cy
  const y1 = point[1] * cp - z1 * sp
  const z2 = point[1] * sp + z1 * cp
  return [x1, y1, z2]
}

function project(point: Vec3, width: number, height: number, zoom: number): Point {
  const camera = 72
  const depth = Math.max(20, camera - point[2])
  const perspective = (camera / depth) * zoom
  return {
    x: width / 2 + point[0] * perspective,
    y: height * 0.56 - (point[1] - 15) * perspective,
    z: point[2]
  }
}

function drawImageTriangle(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  source: [number, number, number, number, number, number],
  destination: [number, number, number, number, number, number]
): void {
  const [sx0, sy0, sx1, sy1, sx2, sy2] = source
  const [dx0, dy0, dx1, dy1, dx2, dy2] = destination
  const denominator = sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1)
  if (Math.abs(denominator) < 0.0001) return

  const a = (dx0 * (sy1 - sy2) + dx1 * (sy2 - sy0) + dx2 * (sy0 - sy1)) / denominator
  const c = (dx0 * (sx2 - sx1) + dx1 * (sx0 - sx2) + dx2 * (sx1 - sx0)) / denominator
  const e = (dx0 * (sx1 * sy2 - sx2 * sy1) + dx1 * (sx2 * sy0 - sx0 * sy2) + dx2 * (sx0 * sy1 - sx1 * sy0)) / denominator
  const b = (dy0 * (sy1 - sy2) + dy1 * (sy2 - sy0) + dy2 * (sy0 - sy1)) / denominator
  const d = (dy0 * (sx2 - sx1) + dy1 * (sx0 - sx2) + dy2 * (sx1 - sx0)) / denominator
  const f = (dy0 * (sx1 * sy2 - sx2 * sy1) + dy1 * (sx2 * sy0 - sx0 * sy2) + dy2 * (sx0 * sy1 - sx1 * sy0)) / denominator

  context.save()
  context.beginPath()
  context.moveTo(dx0, dy0)
  context.lineTo(dx1, dy1)
  context.lineTo(dx2, dy2)
  context.closePath()
  context.clip()
  context.setTransform(a, b, c, d, e, f)
  context.drawImage(image, 0, 0)
  context.restore()
}

function drawFace(context: CanvasRenderingContext2D, face: RenderFace): void {
  const [a, b, c, d] = face.points
  if (!a || !b || !c || !d) return
  const uv = face.uv
  drawImageTriangle(
    context,
    face.image,
    [uv.x, uv.y, uv.x + uv.w, uv.y, uv.x + uv.w, uv.y + uv.h],
    [a.x, a.y, b.x, b.y, c.x, c.y]
  )
  drawImageTriangle(
    context,
    face.image,
    [uv.x, uv.y, uv.x + uv.w, uv.y + uv.h, uv.x, uv.y + uv.h],
    [a.x, a.y, c.x, c.y, d.x, d.y]
  )
  if (face.shade > 0) {
    context.save()
    context.globalCompositeOperation = 'source-over'
    context.fillStyle = `rgba(2, 4, 9, ${face.shade})`
    context.beginPath()
    context.moveTo(a.x, a.y)
    context.lineTo(b.x, b.y)
    context.lineTo(c.x, c.y)
    context.lineTo(d.x, d.y)
    context.closePath()
    context.fill()
    context.restore()
  }
}

function addCuboid(
  output: RenderFace[],
  image: HTMLImageElement,
  center: Vec3,
  size: Vec3,
  textures: TextureFaces,
  yaw: number,
  pitch: number,
  width: number,
  height: number,
  zoom: number,
  expanded = 0,
  localTransform?: LocalTransform
): void {
  const hx = size[0] / 2 + expanded
  const hy = size[1] / 2 + expanded
  const hz = size[2] / 2 + expanded
  const base: Vec3[] = [
    [-hx, hy, hz], [hx, hy, hz], [hx, -hy, hz], [-hx, -hy, hz],
    [hx, hy, -hz], [-hx, hy, -hz], [-hx, -hy, -hz], [hx, -hy, -hz]
  ]
  const raw: Vec3[] = base.map(([x, y, z]) => [x + center[0], y + center[1], z + center[2]])
  const locallyTransformed = localTransform ? raw.map(localTransform) : raw
  const transformed = locallyTransformed.map((point) => rotatePoint(point, yaw, pitch))
  const points = transformed.map((point) => project(point, width, height, zoom))
  const faces: Array<{ name: FaceName; indices: [number, number, number, number]; shade: number }> = [
    { name: 'front', indices: [0, 1, 2, 3], shade: 0.02 },
    { name: 'right', indices: [1, 4, 7, 2], shade: 0.13 },
    { name: 'back', indices: [4, 5, 6, 7], shade: 0.22 },
    { name: 'left', indices: [5, 0, 3, 6], shade: 0.17 },
    { name: 'top', indices: [5, 4, 1, 0], shade: 0 },
    { name: 'bottom', indices: [3, 2, 7, 6], shade: 0.28 }
  ]

  for (const face of faces) {
    const uv = textures[face.name]
    if (!uv) continue
    const p = face.indices.map((index) => points[index]!)
    const cross = (p[1]!.x - p[0]!.x) * (p[2]!.y - p[0]!.y) - (p[1]!.y - p[0]!.y) * (p[2]!.x - p[0]!.x)
    if (cross <= 0) continue
    const depth = face.indices.reduce((sum, index) => sum + transformed[index]![2], 0) / 4
    output.push({ points: p, uv, image, shade: face.shade, depth })
  }
}

const head: TextureFaces = {
  front: { x: 8, y: 8, w: 8, h: 8 }, back: { x: 24, y: 8, w: 8, h: 8 },
  left: { x: 0, y: 8, w: 8, h: 8 }, right: { x: 16, y: 8, w: 8, h: 8 },
  top: { x: 8, y: 0, w: 8, h: 8 }, bottom: { x: 16, y: 0, w: 8, h: 8 }
}
const headLayer: TextureFaces = {
  front: { x: 40, y: 8, w: 8, h: 8 }, back: { x: 56, y: 8, w: 8, h: 8 },
  left: { x: 32, y: 8, w: 8, h: 8 }, right: { x: 48, y: 8, w: 8, h: 8 },
  top: { x: 40, y: 0, w: 8, h: 8 }, bottom: { x: 48, y: 0, w: 8, h: 8 }
}
const body: TextureFaces = {
  front: { x: 20, y: 20, w: 8, h: 12 }, back: { x: 32, y: 20, w: 8, h: 12 },
  left: { x: 16, y: 20, w: 4, h: 12 }, right: { x: 28, y: 20, w: 4, h: 12 },
  top: { x: 20, y: 16, w: 8, h: 4 }, bottom: { x: 28, y: 16, w: 8, h: 4 }
}
const bodyLayer: TextureFaces = {
  front: { x: 20, y: 36, w: 8, h: 12 }, back: { x: 32, y: 36, w: 8, h: 12 },
  left: { x: 16, y: 36, w: 4, h: 12 }, right: { x: 28, y: 36, w: 4, h: 12 },
  top: { x: 20, y: 32, w: 8, h: 4 }, bottom: { x: 28, y: 32, w: 8, h: 4 }
}
const rightArm: TextureFaces = {
  front: { x: 44, y: 20, w: 4, h: 12 }, back: { x: 52, y: 20, w: 4, h: 12 },
  left: { x: 40, y: 20, w: 4, h: 12 }, right: { x: 48, y: 20, w: 4, h: 12 },
  top: { x: 44, y: 16, w: 4, h: 4 }, bottom: { x: 48, y: 16, w: 4, h: 4 }
}
const leftArm: TextureFaces = {
  front: { x: 36, y: 52, w: 4, h: 12 }, back: { x: 44, y: 52, w: 4, h: 12 },
  left: { x: 32, y: 52, w: 4, h: 12 }, right: { x: 40, y: 52, w: 4, h: 12 },
  top: { x: 36, y: 48, w: 4, h: 4 }, bottom: { x: 40, y: 48, w: 4, h: 4 }
}
const rightLeg: TextureFaces = {
  front: { x: 4, y: 20, w: 4, h: 12 }, back: { x: 12, y: 20, w: 4, h: 12 },
  left: { x: 0, y: 20, w: 4, h: 12 }, right: { x: 8, y: 20, w: 4, h: 12 },
  top: { x: 4, y: 16, w: 4, h: 4 }, bottom: { x: 8, y: 16, w: 4, h: 4 }
}
const leftLeg: TextureFaces = {
  front: { x: 20, y: 52, w: 4, h: 12 }, back: { x: 28, y: 52, w: 4, h: 12 },
  left: { x: 16, y: 52, w: 4, h: 12 }, right: { x: 24, y: 52, w: 4, h: 12 },
  top: { x: 20, y: 48, w: 4, h: 4 }, bottom: { x: 24, y: 48, w: 4, h: 4 }
}
const rightArmLayer: TextureFaces = {
  front: { x: 44, y: 36, w: 4, h: 12 }, back: { x: 52, y: 36, w: 4, h: 12 },
  left: { x: 40, y: 36, w: 4, h: 12 }, right: { x: 48, y: 36, w: 4, h: 12 },
  top: { x: 44, y: 32, w: 4, h: 4 }, bottom: { x: 48, y: 32, w: 4, h: 4 }
}
const leftArmLayer: TextureFaces = {
  front: { x: 52, y: 52, w: 4, h: 12 }, back: { x: 60, y: 52, w: 4, h: 12 },
  left: { x: 48, y: 52, w: 4, h: 12 }, right: { x: 56, y: 52, w: 4, h: 12 },
  top: { x: 52, y: 48, w: 4, h: 4 }, bottom: { x: 56, y: 48, w: 4, h: 4 }
}
const rightLegLayer: TextureFaces = {
  front: { x: 4, y: 36, w: 4, h: 12 }, back: { x: 12, y: 36, w: 4, h: 12 },
  left: { x: 0, y: 36, w: 4, h: 12 }, right: { x: 8, y: 36, w: 4, h: 12 },
  top: { x: 4, y: 32, w: 4, h: 4 }, bottom: { x: 8, y: 32, w: 4, h: 4 }
}
const leftLegLayer: TextureFaces = {
  front: { x: 4, y: 52, w: 4, h: 12 }, back: { x: 12, y: 52, w: 4, h: 12 },
  left: { x: 0, y: 52, w: 4, h: 12 }, right: { x: 8, y: 52, w: 4, h: 12 },
  top: { x: 4, y: 48, w: 4, h: 4 }, bottom: { x: 8, y: 48, w: 4, h: 4 }
}
function rotateAroundX(point: Vec3, origin: Vec3, angle: number): Vec3 {
  const dy = point[1] - origin[1]
  const dz = point[2] - origin[2]
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return [point[0], origin[1] + dy * cosine - dz * sine, origin[2] + dy * sine + dz * cosine]
}

function addCape(
  output: RenderFace[],
  image: HTMLImageElement,
  yaw: number,
  pitch: number,
  width: number,
  height: number,
  zoom: number
): void {
  const segments = 4
  const segmentHeight = 4
  const hinge: Vec3 = [0, 24.5, -2.2]
  for (let index = 0; index < segments; index += 1) {
    const textureY = 1 + index * segmentHeight
    const faces: TextureFaces = {
      front: { x: 1, y: textureY, w: 10, h: segmentHeight },
      back: { x: 12, y: textureY, w: 10, h: segmentHeight },
      left: { x: 0, y: textureY, w: 1, h: segmentHeight },
      right: { x: 11, y: textureY, w: 1, h: segmentHeight },
      ...(index === 0 ? { top: { x: 1, y: 0, w: 10, h: 1 } } : {}),
      ...(index === segments - 1 ? { bottom: { x: 11, y: 0, w: 10, h: 1 } } : {})
    }
    const center: Vec3 = [0, 22.5 - index * segmentHeight, -2.65 - index * 0.16]
    const bend = (11 + index * 2.2) * DEG
    addCuboid(
      output,
      image,
      center,
      [10, segmentHeight + 0.08, 0.72],
      faces,
      yaw,
      pitch,
      width,
      height,
      zoom,
      0,
      (point) => rotateAroundX(point, hinge, bend)
    )
  }
}

function loadTexture(url?: string): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null)
  return new Promise((resolve) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = url
  })
}

export default function Skin3DPreview({ skinUrl, capeUrl, slim = false, loading = false }: Skin3DPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const skinRef = useRef<HTMLImageElement | null>(null)
  const capeRef = useRef<HTMLImageElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const dragRef = useRef<{ id: number; x: number; y: number; yaw: number; pitch: number } | null>(null)
  const [view, setView] = useState({ yaw: -18 * DEG, pitch: -5 * DEG, zoom: 8.1 })
  const [textureReady, setTextureReady] = useState(false)

  const scheduleDraw = () => {
    if (frameRef.current != null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      const canvas = canvasRef.current
      const skin = skinRef.current
      if (!canvas || !skin) return
      const rect = canvas.getBoundingClientRect()
      const width = Math.max(1, Math.round(rect.width))
      const height = Math.max(1, Math.round(rect.height))
      const pixelRatio = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
      const backingWidth = Math.round(width * pixelRatio)
      const backingHeight = Math.round(height * pixelRatio)
      if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
        canvas.width = backingWidth
        canvas.height = backingHeight
      }
      const context = canvas.getContext('2d', { alpha: true })
      if (!context) return
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.imageSmoothingEnabled = false
      const renderWidth = backingWidth
      const renderHeight = backingHeight
      const renderZoom = view.zoom * pixelRatio

      const faces: RenderFace[] = []
      const cape = capeRef.current
      if (cape) addCape(faces, cape, view.yaw, view.pitch, renderWidth, renderHeight, renderZoom)
      addCuboid(faces, skin, [0, 28, 0], [8, 8, 8], head, view.yaw, view.pitch, renderWidth, renderHeight, renderZoom)
      addCuboid(faces, skin, [0, 28, 0], [8, 8, 8], headLayer, view.yaw, view.pitch, renderWidth, renderHeight, renderZoom, 0.35)
      addCuboid(faces, skin, [0, 18, 0], [8, 12, 4], body, view.yaw, view.pitch, renderWidth, renderHeight, renderZoom)
      if (skin.height >= 64) addCuboid(faces, skin, [0, 18, 0], [8, 12, 4], bodyLayer, view.yaw, view.pitch, renderWidth, renderHeight, renderZoom, 0.23)
      const armWidth = slim ? 3 : 4
      addCuboid(faces, skin, [-(4 + armWidth / 2), 18, 0], [armWidth, 12, 4], rightArm, view.yaw, view.pitch, renderWidth, renderHeight, renderZoom)
      addCuboid(faces, skin, [4 + armWidth / 2, 18, 0], [armWidth, 12, 4], skin.height >= 64 ? leftArm : rightArm, view.yaw, view.pitch, renderWidth, renderHeight, renderZoom)
      addCuboid(faces, skin, [-2, 6, 0], [4, 12, 4], rightLeg, view.yaw, view.pitch, renderWidth, renderHeight, renderZoom)
      addCuboid(faces, skin, [2, 6, 0], [4, 12, 4], skin.height >= 64 ? leftLeg : rightLeg, view.yaw, view.pitch, renderWidth, renderHeight, renderZoom)
      if (skin.height >= 64) {
        addCuboid(faces, skin, [-(4 + armWidth / 2), 18, 0], [armWidth, 12, 4], rightArmLayer, view.yaw, view.pitch, renderWidth, renderHeight, renderZoom, 0.18)
        addCuboid(faces, skin, [4 + armWidth / 2, 18, 0], [armWidth, 12, 4], leftArmLayer, view.yaw, view.pitch, renderWidth, renderHeight, renderZoom, 0.18)
        addCuboid(faces, skin, [-2, 6, 0], [4, 12, 4], rightLegLayer, view.yaw, view.pitch, renderWidth, renderHeight, renderZoom, 0.18)
        addCuboid(faces, skin, [2, 6, 0], [4, 12, 4], leftLegLayer, view.yaw, view.pitch, renderWidth, renderHeight, renderZoom, 0.18)
      }

      faces.sort((a, b) => a.depth - b.depth)
      for (const face of faces) drawFace(context, face)
    })
  }

  useEffect(() => {
    let cancelled = false
    setTextureReady(false)
    void Promise.all([loadTexture(skinUrl), loadTexture(capeUrl)]).then(([skin, cape]) => {
      if (cancelled) return
      skinRef.current = skin
      capeRef.current = cape
      setTextureReady(Boolean(skin))
      scheduleDraw()
    })
    return () => { cancelled = true }
  }, [skinUrl, capeUrl])

  useEffect(() => { scheduleDraw() }, [view, slim, textureReady])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(scheduleDraw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  useEffect(() => () => { if (frameRef.current != null) cancelAnimationFrame(frameRef.current) }, [])

  const startDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw: view.yaw, pitch: view.pitch }
  }
  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag || drag.id !== event.pointerId) return
    setView((current) => ({
      ...current,
      yaw: drag.yaw + (event.clientX - drag.x) * 0.012,
      pitch: Math.max(-0.55, Math.min(0.42, drag.pitch + (event.clientY - drag.y) * 0.008))
    }))
  }
  const stopDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.id === event.pointerId) dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const zoom = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    setView((current) => ({ ...current, zoom: Math.max(5.8, Math.min(10.7, current.zoom - event.deltaY * 0.007)) }))
  }
  const showFront = () => setView((current) => ({ ...current, yaw: -18 * DEG, pitch: -5 * DEG }))
  const showBack = () => setView((current) => ({ ...current, yaw: 162 * DEG, pitch: -4 * DEG }))
  const reset = () => setView({ yaw: -18 * DEG, pitch: -5 * DEG, zoom: 8.1 })

  return (
    <div className="skin3d-root">
      <canvas
        ref={canvasRef}
        onPointerDown={startDrag}
        onPointerMove={move}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        onWheel={zoom}
        aria-label="Interactive 3D Minecraft character preview"
      />
      {(loading || !textureReady) && <div className="skin3d-loading"><span /><small>{loading ? 'Loading profile' : 'Loading preview'}</small></div>}
      <div className="skin3d-controls">
        <button type="button" onClick={showFront}>Front</button>
        {capeUrl && <button type="button" onClick={showBack}>Cape</button>}
        <button type="button" onClick={reset}>Reset</button>
      </div>
      <div className="skin3d-help">Drag to rotate · Scroll to zoom · Cape uses a hinged 3D preview</div>
    </div>
  )
}
