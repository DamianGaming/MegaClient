import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from 'react'

type Vec3 = [number, number, number]
type Point = { x: number; y: number; z: number }
type UvRect = { x: number; y: number; w: number; h: number }
type FaceName = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'
type TextureFaces = Partial<Record<FaceName, UvRect>>
type LocalTransform = (point: Vec3) => Vec3
type PreviewMode = 'front' | 'cape' | 'free'

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
  baseWidth: number
  baseHeight: number
}

interface ViewState {
  yaw: number
  pitch: number
  zoom: number
}

const DEG = Math.PI / 180
const FRONT_VIEW: ViewState = { yaw: -18 * DEG, pitch: -5 * DEG, zoom: 8.15 }
const CAPE_VIEW: ViewState = { yaw: 180 * DEG, pitch: -3 * DEG, zoom: 8.4 }
const textureCache = new Map<string, Promise<HTMLImageElement | null>>()

function boundedCacheSet(key: string, value: Promise<HTMLImageElement | null>): void {
  textureCache.set(key, value)
  while (textureCache.size > 24) {
    const oldest = textureCache.keys().next().value as string | undefined
    if (!oldest) break
    textureCache.delete(oldest)
  }
}

function loadTexture(url?: string): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null)
  const cached = textureCache.get(url)
  if (cached) return cached

  const request = new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => {
      textureCache.delete(url)
      resolve(null)
    }
    image.src = url
  })
  boundedCacheSet(url, request)
  return request
}

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
  const scaleX = face.image.naturalWidth / face.baseWidth
  const scaleY = face.image.naturalHeight / face.baseHeight
  const uv = {
    x: face.uv.x * scaleX,
    y: face.uv.y * scaleY,
    w: face.uv.w * scaleX,
    h: face.uv.h * scaleY
  }

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

function pushQuad(
  output: RenderFace[],
  image: HTMLImageElement,
  vertices: [Vec3, Vec3, Vec3, Vec3],
  uv: UvRect,
  yaw: number,
  pitch: number,
  width: number,
  height: number,
  zoom: number,
  shade: number,
  baseWidth: number,
  baseHeight: number,
  cull = true
): void {
  const transformed = vertices.map((point) => rotatePoint(point, yaw, pitch))
  const points = transformed.map((point) => project(point, width, height, zoom))
  const cross = (points[1]!.x - points[0]!.x) * (points[2]!.y - points[0]!.y)
    - (points[1]!.y - points[0]!.y) * (points[2]!.x - points[0]!.x)
  if (cull && cross <= 0) return
  output.push({
    points,
    uv,
    image,
    shade,
    depth: transformed.reduce((sum, point) => sum + point[2], 0) / transformed.length,
    baseWidth,
    baseHeight
  })
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
  baseHeight: number,
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
  const raw = base.map(([x, y, z]): Vec3 => [x + center[0], y + center[1], z + center[2]])
  const transformed = localTransform ? raw.map(localTransform) : raw
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
    pushQuad(
      output,
      image,
      face.indices.map((index) => transformed[index]!) as [Vec3, Vec3, Vec3, Vec3],
      uv,
      yaw,
      pitch,
      width,
      height,
      zoom,
      face.shade,
      64,
      baseHeight
    )
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

function armTextures(side: 'right' | 'left', slim: boolean, layer: boolean): TextureFaces {
  const y = side === 'right' ? (layer ? 36 : 20) : 52
  const topY = side === 'right' ? (layer ? 32 : 16) : 48
  const leftX = side === 'right' ? 40 : (layer ? 48 : 32)
  const frontX = side === 'right' ? 44 : (layer ? 52 : 36)
  const faceWidth = slim ? 3 : 4
  const rightX = frontX + faceWidth
  const backX = rightX + 4
  return {
    front: { x: frontX, y, w: faceWidth, h: 12 },
    back: { x: backX, y, w: faceWidth, h: 12 },
    left: { x: leftX, y, w: 4, h: 12 },
    right: { x: rightX, y, w: 4, h: 12 },
    top: { x: frontX, y: topY, w: faceWidth, h: 4 },
    bottom: { x: rightX, y: topY, w: faceWidth, h: 4 }
  }
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
  const segments = 8
  const segmentLength = 16 / segments
  const halfWidth = 5
  const halfThickness = 0.28
  const nodes: Array<{ y: number; z: number }> = [{ y: 24.55, z: -2.3 }]

  for (let index = 0; index < segments; index += 1) {
    const t = (index + 0.5) / segments
    const angle = (6 + 9 * t + 3 * Math.sin(Math.PI * t)) * DEG
    const previous = nodes[index]!
    nodes.push({
      y: previous.y - Math.cos(angle) * segmentLength,
      z: previous.z - Math.sin(angle) * segmentLength
    })
  }

  const normals = nodes.map((node, index) => {
    const previous = nodes[Math.max(0, index - 1)]!
    const next = nodes[Math.min(nodes.length - 1, index + 1)]!
    const dy = next.y - previous.y
    const dz = next.z - previous.z
    const length = Math.max(0.0001, Math.hypot(dy, dz))
    return { y: (-dz / length) * halfThickness, z: (dy / length) * halfThickness }
  })

  for (let index = 0; index < segments; index += 1) {
    const top = nodes[index]!
    const bottom = nodes[index + 1]!
    const topNormal = normals[index]!
    const bottomNormal = normals[index + 1]!
    const textureY = 1 + index * segmentLength

    const outerTopLeft: Vec3 = [-halfWidth, top.y + topNormal.y, top.z + topNormal.z]
    const outerTopRight: Vec3 = [halfWidth, top.y + topNormal.y, top.z + topNormal.z]
    const outerBottomRight: Vec3 = [halfWidth, bottom.y + bottomNormal.y, bottom.z + bottomNormal.z]
    const outerBottomLeft: Vec3 = [-halfWidth, bottom.y + bottomNormal.y, bottom.z + bottomNormal.z]
    const innerTopLeft: Vec3 = [-halfWidth, top.y - topNormal.y, top.z - topNormal.z]
    const innerTopRight: Vec3 = [halfWidth, top.y - topNormal.y, top.z - topNormal.z]
    const innerBottomRight: Vec3 = [halfWidth, bottom.y - bottomNormal.y, bottom.z - bottomNormal.z]
    const innerBottomLeft: Vec3 = [-halfWidth, bottom.y - bottomNormal.y, bottom.z - bottomNormal.z]

    // Minecraft's visible rear cape artwork is the 10x16 strip beginning at 1,1.
    // The body-facing reverse is the strip beginning at 12,1.
    pushQuad(output, image, [outerTopRight, outerTopLeft, outerBottomLeft, outerBottomRight],
      { x: 1, y: textureY, w: 10, h: segmentLength }, yaw, pitch, width, height, zoom, 0.02, 64, 32, false)
    pushQuad(output, image, [innerTopLeft, innerTopRight, innerBottomRight, innerBottomLeft],
      { x: 12, y: textureY, w: 10, h: segmentLength }, yaw, pitch, width, height, zoom, 0.2, 64, 32, false)
    pushQuad(output, image, [outerTopLeft, innerTopLeft, innerBottomLeft, outerBottomLeft],
      { x: 0, y: textureY, w: 1, h: segmentLength }, yaw, pitch, width, height, zoom, 0.15, 64, 32, false)
    pushQuad(output, image, [innerTopRight, outerTopRight, outerBottomRight, innerBottomRight],
      { x: 11, y: textureY, w: 1, h: segmentLength }, yaw, pitch, width, height, zoom, 0.1, 64, 32, false)

    if (index === 0) {
      pushQuad(output, image, [innerTopLeft, innerTopRight, outerTopRight, outerTopLeft],
        { x: 1, y: 0, w: 10, h: 1 }, yaw, pitch, width, height, zoom, 0.05, 64, 32, false)
    }
    if (index === segments - 1) {
      pushQuad(output, image, [outerBottomLeft, outerBottomRight, innerBottomRight, innerBottomLeft],
        { x: 11, y: 0, w: 10, h: 1 }, yaw, pitch, width, height, zoom, 0.22, 64, 32, false)
    }
  }
}

function drawGroundShadow(context: CanvasRenderingContext2D, width: number, height: number): void {
  const centerX = width / 2
  const centerY = height * 0.825
  const radiusX = Math.min(width * 0.19, 105)
  const radiusY = Math.max(12, radiusX * 0.23)
  const gradient = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radiusX)
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.38)')
  gradient.addColorStop(0.65, 'rgba(0, 0, 0, 0.16)')
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
  context.save()
  context.scale(1, radiusY / radiusX)
  context.fillStyle = gradient
  context.beginPath()
  context.arc(centerX, centerY * (radiusX / radiusY), radiusX, 0, Math.PI * 2)
  context.fill()
  context.restore()
}

export default function Skin3DPreview({ skinUrl, capeUrl, slim = false, loading = false }: Skin3DPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const skinRef = useRef<HTMLImageElement | null>(null)
  const capeRef = useRef<HTMLImageElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const sizeRef = useRef({ width: 0, height: 0 })
  const visibleRef = useRef(true)
  const slimRef = useRef(slim)
  const viewRef = useRef<ViewState>(FRONT_VIEW)
  const dragRef = useRef<{ id: number; x: number; y: number; yaw: number; pitch: number } | null>(null)
  const [mode, setMode] = useState<PreviewMode>('front')
  const [textureState, setTextureState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [capeReady, setCapeReady] = useState(false)

  slimRef.current = slim

  const scheduleDraw = useCallback(() => {
    if (!visibleRef.current || document.hidden || frameRef.current != null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      const canvas = canvasRef.current
      const skin = skinRef.current
      if (!canvas || !skin || !visibleRef.current || document.hidden) return

      let { width, height } = sizeRef.current
      if (!width || !height) {
        const rect = canvas.getBoundingClientRect()
        width = Math.max(1, Math.round(rect.width))
        height = Math.max(1, Math.round(rect.height))
        sizeRef.current = { width, height }
      }

      const requestedRatio = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
      const maxRatioForArea = Math.sqrt(1_650_000 / Math.max(1, width * height))
      const pixelRatio = Math.max(1, Math.min(requestedRatio, maxRatioForArea))
      const backingWidth = Math.max(1, Math.round(width * pixelRatio))
      const backingHeight = Math.max(1, Math.round(height * pixelRatio))
      if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
        canvas.width = backingWidth
        canvas.height = backingHeight
      }

      const context = canvas.getContext('2d', { alpha: true, desynchronized: true })
      if (!context) return
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, backingWidth, backingHeight)
      context.imageSmoothingEnabled = false
      drawGroundShadow(context, backingWidth, backingHeight)

      const current = viewRef.current
      const renderZoom = current.zoom * pixelRatio
      const skinBaseHeight = skin.naturalWidth / Math.max(1, skin.naturalHeight) >= 1.9 ? 32 : 64
      const armWidth = slimRef.current ? 3 : 4
      const faces: RenderFace[] = []
      const cape = capeRef.current

      if (cape) addCape(faces, cape, current.yaw, current.pitch, backingWidth, backingHeight, renderZoom)
      addCuboid(faces, skin, [0, 28, 0], [8, 8, 8], head, current.yaw, current.pitch, backingWidth, backingHeight, renderZoom, skinBaseHeight)
      addCuboid(faces, skin, [0, 28, 0], [8, 8, 8], headLayer, current.yaw, current.pitch, backingWidth, backingHeight, renderZoom, skinBaseHeight, 0.35)
      addCuboid(faces, skin, [0, 18, 0], [8, 12, 4], body, current.yaw, current.pitch, backingWidth, backingHeight, renderZoom, skinBaseHeight)
      if (skinBaseHeight === 64) {
        addCuboid(faces, skin, [0, 18, 0], [8, 12, 4], bodyLayer, current.yaw, current.pitch, backingWidth, backingHeight, renderZoom, skinBaseHeight, 0.23)
      }

      const rightArm = armTextures('right', slimRef.current, false)
      const leftArm = armTextures('left', slimRef.current, false)
      addCuboid(faces, skin, [-(4 + armWidth / 2), 18, 0], [armWidth, 12, 4], rightArm, current.yaw, current.pitch, backingWidth, backingHeight, renderZoom, skinBaseHeight)
      addCuboid(faces, skin, [4 + armWidth / 2, 18, 0], [armWidth, 12, 4], skinBaseHeight === 64 ? leftArm : rightArm, current.yaw, current.pitch, backingWidth, backingHeight, renderZoom, skinBaseHeight)
      addCuboid(faces, skin, [-2, 6, 0], [4, 12, 4], rightLeg, current.yaw, current.pitch, backingWidth, backingHeight, renderZoom, skinBaseHeight)
      addCuboid(faces, skin, [2, 6, 0], [4, 12, 4], skinBaseHeight === 64 ? leftLeg : rightLeg, current.yaw, current.pitch, backingWidth, backingHeight, renderZoom, skinBaseHeight)

      if (skinBaseHeight === 64) {
        addCuboid(faces, skin, [-(4 + armWidth / 2), 18, 0], [armWidth, 12, 4], armTextures('right', slimRef.current, true), current.yaw, current.pitch, backingWidth, backingHeight, renderZoom, skinBaseHeight, 0.18)
        addCuboid(faces, skin, [4 + armWidth / 2, 18, 0], [armWidth, 12, 4], armTextures('left', slimRef.current, true), current.yaw, current.pitch, backingWidth, backingHeight, renderZoom, skinBaseHeight, 0.18)
        addCuboid(faces, skin, [-2, 6, 0], [4, 12, 4], rightLegLayer, current.yaw, current.pitch, backingWidth, backingHeight, renderZoom, skinBaseHeight, 0.18)
        addCuboid(faces, skin, [2, 6, 0], [4, 12, 4], leftLegLayer, current.yaw, current.pitch, backingWidth, backingHeight, renderZoom, skinBaseHeight, 0.18)
      }

      faces.sort((a, b) => a.depth - b.depth)
      for (const face of faces) drawFace(context, face)
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    setTextureState('loading')
    setCapeReady(false)
    void Promise.all([loadTexture(skinUrl), loadTexture(capeUrl)]).then(([skin, cape]) => {
      if (cancelled) return
      skinRef.current = skin
      capeRef.current = cape
      setTextureState(skin ? 'ready' : 'error')
      setCapeReady(Boolean(cape))
      scheduleDraw()
    })
    return () => { cancelled = true }
  }, [skinUrl, capeUrl, scheduleDraw])

  useEffect(() => { scheduleDraw() }, [slim, textureState, capeReady, scheduleDraw])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      sizeRef.current = {
        width: Math.max(1, Math.round(entry.contentRect.width)),
        height: Math.max(1, Math.round(entry.contentRect.height))
      }
      scheduleDraw()
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [scheduleDraw])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const observer = new IntersectionObserver((entries) => {
      visibleRef.current = Boolean(entries[0]?.isIntersecting)
      if (visibleRef.current) scheduleDraw()
    }, { rootMargin: '80px' })
    observer.observe(root)
    const onVisibility = () => { if (!document.hidden) scheduleDraw() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [scheduleDraw])

  useEffect(() => () => {
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current)
  }, [])

  const applyView = (next: ViewState, nextMode: PreviewMode) => {
    viewRef.current = next
    setMode(nextMode)
    scheduleDraw()
  }

  const startDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const current = viewRef.current
    dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw: current.yaw, pitch: current.pitch }
    setMode('free')
  }
  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag || drag.id !== event.pointerId) return
    const next = {
      ...viewRef.current,
      yaw: drag.yaw + (event.clientX - drag.x) * 0.012,
      pitch: Math.max(-0.55, Math.min(0.42, drag.pitch + (event.clientY - drag.y) * 0.008))
    }
    viewRef.current = next
    scheduleDraw()
  }
  const stopDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.id === event.pointerId) dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const zoom = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    const next = {
      ...viewRef.current,
      zoom: Math.max(5.8, Math.min(10.7, viewRef.current.zoom - event.deltaY * 0.007))
    }
    viewRef.current = next
    setMode('free')
    scheduleDraw()
  }

  return (
    <div className="skin3d-root" ref={rootRef} data-mode={mode}>
      <canvas
        ref={canvasRef}
        onPointerDown={startDrag}
        onPointerMove={move}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        onWheel={zoom}
        aria-label="Interactive 3D Minecraft skin and cape preview"
      />
      {(loading || textureState === 'loading') && (
        <div className="skin3d-loading"><span /><small>{loading ? 'Loading profile' : 'Loading preview'}</small></div>
      )}
      {!loading && textureState === 'error' && (
        <div className="skin3d-loading skin3d-error"><small>Preview could not be loaded</small></div>
      )}
      <div className="skin3d-controls" role="group" aria-label="Preview angle">
        <button type="button" className={mode === 'front' ? 'active' : ''} aria-pressed={mode === 'front'} onClick={() => applyView(FRONT_VIEW, 'front')}>Front</button>
        <button type="button" className={mode === 'cape' ? 'active' : ''} aria-pressed={mode === 'cape'} disabled={!capeUrl || !capeReady} onClick={() => applyView(CAPE_VIEW, 'cape')}>Cape</button>
        <button type="button" onClick={() => applyView(FRONT_VIEW, 'front')}>Reset</button>
      </div>
      <div className="skin3d-help">
        {capeUrl && !capeReady ? 'Cape texture unavailable · ' : ''}Drag to rotate · Scroll to zoom
      </div>
    </div>
  )
}
