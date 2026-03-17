// declare global {
//     interface Window {
//         supabase: any
//     }
// }

const WIDTH = 1600
const HEIGHT = 900

const canvas = document.getElementById("canvas") as HTMLCanvasElement
canvas.width = WIDTH
canvas.height = HEIGHT

// ---------------- PHOTO SYSTEM ----------------

type LoadedPhoto = {
    img: HTMLImageElement
    uploadedAt: number
}

type ActivePhoto = {
    img: HTMLImageElement
    startTime: number
    slot: Slot
}

type Slot = {
    x: number
    y: number
    w: number
    h: number
}

let photoPool: LoadedPhoto[] = []
let activePhotos: ActivePhoto[] = []

const PHOTO_DURATION = 5
const PHOTO_ALPHA = 0.8
const MAX_ACTIVE = 4

const MARGIN_RATIO = 0.2

let slots: Slot[] = []

const ctx = canvas.getContext("2d")
if (!ctx) {
    throw new Error("Could not get 2D canvas context")
}

// ---------------- CONFIG ----------------

const BG_COLOR = "rgb(245,236,220)"
const ROAD_COLOR = "rgb(120,120,120)"
const WATER_COLOR = "rgb(120,180,255)"

const TRAM_COLORS = [
    "rgb(252,15,35)",
    "rgb(34,34,215)",
    "rgb(252,222,70)"
]

const BASE_SCALE = 0.00012
const MAGNIFICATION = 700

const CENTER_POINT = "ZW"

const ROTATION_DEG = 35
const ROTATION_RAD = ROTATION_DEG * Math.PI / 180

const ROAD_WIDTH = 1
const RIVER_WIDTH = 3
const TRAM_WIDTH = 4

const ICON_BASE_SIZE = 250
const ICON_PULSE_BOOST = 0.25

const PULSE_SPEED = 1000
const PULSE_AMPLITUDE = 25
const PULSE_DECAY = 1.2
const PULSE_FREQ = 0.25
const PULSE_LIFETIME = 3.0

// ---------------- MICROPHONE ----------------

let audioContext: AudioContext
let analyser: AnalyserNode
let micData: Uint8Array

let micEnabled = false

const MIC_THRESHOLD = 0.15
const MIC_COOLDOWN = 0.15

let lastMicPulse = 0

// ---------------- TYPES ----------------

type Point = [number, number]

type PlaceWorld = {
    name: string
    type: string
    x: number
    y: number
}

type PlaceScreen = {
    name: string
    type: string
    x: number
    y: number
}

type IconEntry = {
    name: string
    type: string
    x: number
    y: number
    img: HTMLImageElement
    loaded: boolean
    failed: boolean
}


const ROAD_STYLE: Record<string, { color: string, width: number }> = {

    primary:      { color: "rgb(70,70,70)",  width: 2.5 },
    secondary:    { color: "rgb(95,95,95)", width: 2 },
    tertiary:     { color: "rgb(120,120,120)", width: 1.8 },
    residential:  { color: "rgb(150,150,150)", width: 1.2 },
    living_street:{ color: "rgb(175,175,175)", width: 1 },

    default:      { color: "rgb(180,180,180)", width: 1 }

}
// ---------------- HELPERS ----------------

function mercator(lat: number, lon: number): Point {
    const R = 6378137
    const latRad = lat * Math.PI / 180
    const lonRad = lon * Math.PI / 180

    const x = R * lonRad
    const y = R * Math.log(Math.tan(Math.PI / 4 + latRad / 2))

    return [x, y]
}



function computeNormal(line: Point[], i: number): Point {
    let x1: number
    let y1: number
    let x2: number
    let y2: number

    if (i === 0) {
        x1 = line[i][0]
        y1 = line[i][1]
        x2 = line[i + 1][0]
        y2 = line[i + 1][1]
    } else if (i === line.length - 1) {
        x1 = line[i - 1][0]
        y1 = line[i - 1][1]
        x2 = line[i][0]
        y2 = line[i][1]
    } else {
        x1 = line[i - 1][0]
        y1 = line[i - 1][1]
        x2 = line[i + 1][0]
        y2 = line[i + 1][1]
    }

    const dx = x2 - x1
    const dy = y2 - y1
    const L = Math.hypot(dx, dy)

    if (L === 0) return [0, 0]

    return [-dy / L, dx / L]
}

function clamp(x: number, a = 0, b = 1): number {
    return Math.max(a, Math.min(b, x))
}



async function initMicrophone() {

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

    audioContext = new AudioContext()

    const source = audioContext.createMediaStreamSource(stream)

    analyser = audioContext.createAnalyser()
    analyser.fftSize = 256

    source.connect(analyser)

    micData = new Uint8Array(analyser.frequencyBinCount)

    micEnabled = true

    console.log("Microphone enabled")
}

// (keep everything exactly as you had until generateSlots)

function generateSlots() {

    slots = [] // 🔥 IMPORTANT reset

    const marginX = WIDTH * MARGIN_RATIO
    const marginY = HEIGHT * MARGIN_RATIO

    const cell = marginY

    // TOP
    for (let x = marginX; x < WIDTH - marginX; x += cell) {
        slots.push({ x, y: 0, w: cell, h: marginY })
    }

    // BOTTOM
    for (let x = marginX; x < WIDTH - marginX; x += cell) {
        slots.push({ x, y: HEIGHT - marginY, w: cell, h: marginY })
    }

    // LEFT
    for (let y = marginY; y < HEIGHT - marginY; y += cell) {
        slots.push({ x: 0, y, w: marginX, h: cell })
    }

    // RIGHT
    for (let y = marginY; y < HEIGHT - marginY; y += cell) {
        slots.push({ x: WIDTH - marginX, y, w: marginX, h: cell })
    }

    console.log("Slots generated:", slots.length)
}

async function loadPhotos(): Promise<void> {

    const now = performance.now() / 1000

    // -------- LOCAL --------
    const localPhotos = [
        "fotos/foto1.jpg",
        "fotos/foto2.jpg",
        "fotos/foto3.jpg",
        "fotos/foto4.jpg",
        "fotos/foto5.jpg",
        "fotos/foto6.jpg",
        "fotos/foto7.jpg",
        "fotos/foto8.jpg",
        "fotos/foto9.jpg",
        "fotos/foto10.jpg",
        "fotos/foto11.jpg"
    ]

    // local = "old" so they don't dominate
    const localEntries = localPhotos.map(src => ({
        url: src,
        uploadedAt: now - 999999
    }))

    // -------- SUPABASE --------
    let supabaseEntries: { url: string, uploadedAt: number }[] = []

    try {
        const supabaseLib = (window as any).supabase

        if (supabaseLib) {

            const SUPABASE_URL = "https://fixpfxxlnuhwzvbgcykm.supabase.co"
            const SUPABASE_KEY = "sb_publishable_9SUF0gKkr4337Ai9i4kCrg_pSaW2sSI"

            const supabase = supabaseLib.createClient(SUPABASE_URL, SUPABASE_KEY)

            const { data, error } = await supabase
                .storage
                .from("photos")
                .list("", { limit: 100 })

            if (!error && data) {

                supabaseEntries = data.map((f: any) => ({
                    url: `${SUPABASE_URL}/storage/v1/object/public/photos/${f.name}`,
                    uploadedAt: f.created_at
                        ? new Date(f.created_at).getTime() / 1000
                        : now - 1000 // fallback
                }))

            } else {
                console.warn("Supabase list failed:", error?.message)
            }
        }

    } catch (err) {
        console.warn("Supabase failed, using local only")
    }

    // -------- MERGE --------
    const all = [...localEntries, ...supabaseEntries]

    // -------- PRELOAD --------
    const promises = all.map(entry =>
        new Promise<LoadedPhoto | null>((resolve) => {

            const img = new Image()

            img.onload = () => resolve({
                img,
                uploadedAt: entry.uploadedAt
            })

            img.onerror = () => {
                console.warn("Failed:", entry.url)
                resolve(null)
            }

            img.src = entry.url
        })
    )

    const results = await Promise.all(promises)

    // -------- STORE --------
    photoPool = results.filter((p): p is LoadedPhoto => p !== null)

    console.log("Photos ready:", photoPool.length)
}
// function spawnRandomPhoto() {

//     if (photoPool.length === 0) return

//     const src = photoPool[Math.floor(Math.random() * photoPool.length)]

//     const img = new Image()

//     img.onload = () => {
//         activePhoto = {
//             img,
//             startTime: performance.now() / 1000
//         }
//     }

//     img.src = src
// }

function spawnPhoto(now: number) {

    if (photoPool.length === 0) return
    if (activePhotos.length >= MAX_ACTIVE) return

    const used = activePhotos.map(p => p.slot)
    const free = slots.filter(s => used.indexOf(s) === -1)

    if (free.length === 0) return

    // -------- 🔥 WEIGHTED SELECTION --------
    const weights = photoPool.map(p => {

        const age = now - p.uploadedAt

        if (age < 300) return 5      // < 5 min → VERY likely
        if (age < 1800) return 2     // < 30 min → medium
        return 1                     // old → normal
    })

    const total = weights.reduce((a, b) => a + b, 0)
    let r = Math.random() * total

    let selectedIndex = 0
    for (let i = 0; i < photoPool.length; i++) {
        r -= weights[i]
        if (r <= 0) {
            selectedIndex = i
            break
        }
    }

    const photo = photoPool[selectedIndex]

    // -------- SLOT --------
    const slot = free[Math.floor(Math.random() * free.length)]

    activePhotos.push({
        img: photo.img,
        startTime: now,
        slot
    })
}
function debugShowAllPhotos() {

    if (photoPool.length === 0) {
        console.log("No photos loaded")
        return
    }

    console.log("DEBUG: showing all photos")

    activePhotos = [] // clear current

    for (let i = 0; i < Math.min(photoPool.length, slots.length); i++) {

        activePhotos.push({
            img: photoPool[i].img,
            startTime: performance.now() / 1000,
            slot: slots[i]
        })
    }
}

function getMicLevel(): number {

    if (!micEnabled) return 0

    analyser.getByteFrequencyData(micData)

    let sum = 0
    for (let i = 0; i < micData.length; i++) {
        sum += micData[i]
    }

    return sum / micData.length / 255
}
// ---------------- PULSE ----------------

class Pulse {
    x: number
    y: number
    t: number

    constructor(x: number, y: number) {
        this.x = x
        this.y = y
        this.t = 0
    }

    update(dt: number): void {
        this.t += dt
    }

    shockValue(x: number, y: number): number {
        const dist = Math.hypot(x - this.x, y - this.y)

        const front = PULSE_SPEED * this.t
        const spread = 80

        const envelope = Math.exp(-((dist - front) ** 2) / (2 * spread ** 2))
        const wave = Math.sin((dist - front) * PULSE_FREQ)
        const decay = Math.exp(-PULSE_DECAY * this.t)

        return PULSE_AMPLITUDE * envelope * wave * decay
    }
}

// ---------------- DATA ----------------

type RoadLine = {
    type: string
    points: Point[]
}

let roadLines: RoadLine[] = []
let tramLines: Point[][] = []
let riverLines: Point[][] = []
let lakePolys: Point[][] = []

let placePointsScreen: PlaceScreen[] = []
let icons: IconEntry[] = []

let pulses: Pulse[] = []

let ZW: Point = [0, 0]
const scale = BASE_SCALE * MAGNIFICATION

// ---------------- WORLD → SCREEN ----------------

function worldToScreen(x: number, y: number): Point {
    const cx = ZW[0]
    const cy = ZW[1]

    const dx = (x - cx) * scale
    const dy = (y - cy) * scale

    const rx = dx * Math.cos(ROTATION_RAD) - dy * Math.sin(ROTATION_RAD)
    const ry = dx * Math.sin(ROTATION_RAD) + dy * Math.cos(ROTATION_RAD)

    const sx = WIDTH / 2 + rx
    const sy = HEIGHT / 2 - ry

    return [sx, sy]
}

// ---------------- ICON LOADING ----------------

function createIcon(name: string, type: string, x: number, y: number): IconEntry {

    const img = new Image()

    const entry: IconEntry = {
        name,
        type,
        x,
        y,
        img,
        loaded: false,
        failed: false
    }

    img.onload = () => {
        entry.loaded = true
    }

    img.onerror = () => {
        entry.failed = true
        console.warn(`Missing icon: icons/${type}.png`)
    }

    img.src = `icons/${type}.png`

    return entry
}

// ---------------- LOAD DATA ----------------

async function loadData(): Promise<void> {
    const world = await fetch("zurich_world_latlon_clean.json").then(r => r.json())
    const places = await fetch("places_latlon.json").then(r => r.json())

    function project(line: any[]): Point[] {
        return line.map((p: any) => mercator(p[0], p[1]))
    }

    const roadsWorld: RoadLine[] = (world.roads ?? []).map((r: any) => {

        if (Array.isArray(r)) {
            // old format: just coordinates
            return {
                type: "residential",
                points: project(r)
            }
        }

        // new format
        return {
            type: r.type || "residential",
            points: project(r.coords)
        }

    })
    const tramsWorld: Point[][] = (world.tram ?? []).map(project)
    const riversWorld: Point[][] = (world.rivers ?? []).map(project)
    const lakesWorld: Point[][] = (world.water ?? []).map(project)

    const placePointsWorld: PlaceWorld[] = []

    for (const p of places) {
        const [x, y] = mercator(p.lat, p.lon)
        placePointsWorld.push({
            name: p.name,
            type: p.type || p.name,
            x,
            y
        })
    }

    const center = placePointsWorld.find(p => p.name === CENTER_POINT)
    if (!center) {
        throw new Error(`Center point "${CENTER_POINT}" not found in places_latlon.json`)
    }

    ZW = [center.x, center.y]

    // Precompute screen geometry once
    roadLines = roadsWorld.map(r => ({
        type: r.type,
        points: r.points.map(([x, y]) => worldToScreen(x, y))
    }))
    tramLines = tramsWorld.map(line => line.map(([x, y]) => worldToScreen(x, y)))
    riverLines = riversWorld.map(line => line.map(([x, y]) => worldToScreen(x, y)))
    lakePolys = lakesWorld.map(poly => poly.map(([x, y]) => worldToScreen(x, y)))

    placePointsScreen = placePointsWorld.map(p => {
        const [sx, sy] = worldToScreen(p.x, p.y)
        return {
            name: p.name,
            type: p.type,
            x: sx,
            y: sy
        }
    })

    icons = placePointsScreen.map(p => createIcon(p.name, p.type, p.x, p.y))

    console.log("Loaded places:", placePointsScreen.length)
    console.log("Loaded tram lines:", tramLines.length)
}

// ---------------- DRAW HELPERS ----------------
function drawPhotos() {

    const now = performance.now() / 1000

    activePhotos = activePhotos.filter(p => now - p.startTime < PHOTO_DURATION)

    for (const p of activePhotos) {

        const { img, slot } = p

        ctx.save()
        ctx.globalAlpha = PHOTO_ALPHA

        const scale = Math.min(slot.w / img.width, slot.h / img.height)

        const w = img.width * scale
        const h = img.height * scale

        const x = slot.x + (slot.w - w) / 2
        const y = slot.y + (slot.h - h) / 2

        ctx.drawImage(img, x, y, w, h)

        ctx.restore()
    }
}


function drawPolyline(line: Point[]): void {
    if (line.length < 2) return

    ctx.beginPath()
    for (let i = 0; i < line.length; i++) {
        const [x, y] = line[i]
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
    }
    ctx.stroke()
}

function drawPolygon(poly: Point[]): void {
    if (poly.length < 3) return

    ctx.beginPath()
    for (let i = 0; i < poly.length; i++) {
        const [x, y] = poly[i]
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fill()
}

// ---------------- DRAW ----------------

function draw(): void {

    // Background
    ctx.fillStyle = BG_COLOR
    ctx.fillRect(0, 0, WIDTH, HEIGHT)

    // Lakes
    ctx.fillStyle = WATER_COLOR
    for (const poly of lakePolys) {
        drawPolygon(poly)
    }

    // Rivers
    ctx.strokeStyle = WATER_COLOR
    ctx.lineWidth = RIVER_WIDTH
    for (const line of riverLines) {
        drawPolyline(line)
    }

    // Roads
    for (const road of roadLines) {
        const style = ROAD_STYLE[road.type] ?? ROAD_STYLE.default
        ctx.strokeStyle = style.color
        ctx.lineWidth = style.width
        drawPolyline(road.points)
    }

    // Tram lines with pulse deformation
    for (let li = 0; li < tramLines.length; li++) {
        const line = tramLines[li]
        if (line.length < 2) continue

        ctx.strokeStyle = TRAM_COLORS[li % TRAM_COLORS.length]
        ctx.lineWidth = TRAM_WIDTH

        ctx.beginPath()

        for (let i = 0; i < line.length; i++) {
            let x = line[i][0]
            let y = line[i][1]

            let offset = 0
            for (const pulse of pulses) {
                offset += pulse.shockValue(x, y)
            }

            const [nx, ny] = computeNormal(line, i)
            x += nx * offset
            y += ny * offset

            if (i === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
        }

        ctx.stroke()
    }

    // Pulse circles
    for (const pulse of pulses) {
        const r = PULSE_SPEED * pulse.t
        const alpha = clamp(1 - pulse.t / PULSE_LIFETIME, 0, 1)

        ctx.strokeStyle = `rgba(255,255,255,${0.7 * alpha})`
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(pulse.x, pulse.y, r, 0, Math.PI * 2)
        ctx.stroke()

        ctx.strokeStyle = `rgba(255,255,255,${0.35 * alpha})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(pulse.x, pulse.y, r + 8, 0, Math.PI * 2)
        ctx.stroke()
    }

    // 🆕 PHOTOS (in margins, multiple)
    drawPhotos()

    // Icons
    for (const icon of icons) {

        if (!icon.loaded) continue
        if (icon.failed) continue

        let iconEnergy = 0
        for (const pulse of pulses) {
            iconEnergy += Math.abs(pulse.shockValue(icon.x, icon.y))
        }

        iconEnergy = clamp(iconEnergy / PULSE_AMPLITUDE, 0, 1)

        const scaleFactor = 1 + ICON_PULSE_BOOST * iconEnergy

        const w = ICON_BASE_SIZE * scaleFactor
        const h = ICON_BASE_SIZE * scaleFactor

        ctx.drawImage(
            icon.img,
            icon.x - w / 2,
            icon.y - h / 2,
            w,
            h
        )
    }
}

// ---------------- UPDATE ----------------

async function refreshPhotos(): Promise<void> {

    console.log("🔄 Refreshing photos...")

    await loadPhotos()

}

function update(dt: number): void {

    // -------- PULSES --------
    for (const p of pulses) {
        p.update(dt)
    }

    pulses = pulses.filter(p => p.t < PULSE_LIFETIME)

    // -------- PHOTO SYSTEM --------
    const now = performance.now() / 1000

    // 🔥 ensure we always have some photos
    if (activePhotos.length < 2) {
        spawnPhoto(now)
    }

    // optional randomness on top
    if (Math.random() < 0.03) {
        spawnPhoto(now)
    }

    // -------- MIC --------
    if (!micEnabled) return

    const level = getMicLevel()
    const t = now

    if (level > MIC_THRESHOLD && t - lastMicPulse > MIC_COOLDOWN) {
        const [sx, sy] = worldToScreen(ZW[0], ZW[1])
        pulses.push(new Pulse(sx, sy))
        lastMicPulse = t
    }
}
// ---------------- LOOP ----------------

let lastTime = 0

function loop(t: number): void {
    const dt = lastTime === 0 ? 0 : (t - lastTime) / 1000
    lastTime = t

    update(dt)
    draw()

    requestAnimationFrame(loop)
}

// ---------------- INPUT ----------------

// ---------------- INPUT ----------------

// enable microphone on first click anywhere
window.addEventListener("click", () => {

    

    if (!micEnabled) {
        initMicrophone()
    }

})

canvas.addEventListener("click", (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    pulses.push(new Pulse(x, y))
})

window.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.code === "Space") {
        e.preventDefault()

        if (placePointsScreen.length === 0) return

        const p = placePointsScreen[Math.floor(Math.random() * placePointsScreen.length)]
        pulses.push(new Pulse(p.x, p.y))
    }

    if (e.code === "KeyD") {
        debugShowAllPhotos()
    }
})
// ---------------- START ----------------
Promise.all([
    loadData(),
    loadPhotos()
])
.then(() => {

    generateSlots() // 🔥 REQUIRED

    requestAnimationFrame(loop)

    // 🔄 refresh every 20 seconds
    setInterval(() => {
        refreshPhotos()
    }, 5000)
})