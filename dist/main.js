var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const WIDTH = 1600;
const HEIGHT = 900;
const canvas = document.getElementById("canvas");
canvas.width = WIDTH;
canvas.height = HEIGHT;
const ctx = canvas.getContext("2d");
if (!ctx) {
    throw new Error("Could not get 2D canvas context");
}
// ---------------- CONFIG ----------------
const BG_COLOR = "rgb(245,236,220)";
const ROAD_COLOR = "rgb(120,120,120)";
const WATER_COLOR = "rgb(120,180,255)";
const TRAM_COLORS = [
    "rgb(252,15,35)",
    "rgb(34,34,215)",
    "rgb(252,222,70)"
];
const BASE_SCALE = 0.00012;
const MAGNIFICATION = 550;
const CENTER_POINT = "ZW";
const ROTATION_DEG = 35;
const ROTATION_RAD = ROTATION_DEG * Math.PI / 180;
const ROAD_WIDTH = 1;
const RIVER_WIDTH = 3;
const TRAM_WIDTH = 4;
const ICON_BASE_SIZE = 120;
const ICON_PULSE_BOOST = 0.25;
const PULSE_SPEED = 1000;
const PULSE_AMPLITUDE = 25;
const PULSE_DECAY = 1.2;
const PULSE_FREQ = 0.25;
const PULSE_LIFETIME = 3.0;
// ---------------- MICROPHONE ----------------
let audioContext;
let analyser;
let micData;
let micEnabled = false;
const MIC_THRESHOLD = 0.15;
const MIC_COOLDOWN = 0.15;
let lastMicPulse = 0;
const ROAD_STYLE = {
    primary: { color: "rgb(70,70,70)", width: 2.5 },
    secondary: { color: "rgb(95,95,95)", width: 2 },
    tertiary: { color: "rgb(120,120,120)", width: 1.8 },
    residential: { color: "rgb(150,150,150)", width: 1.2 },
    living_street: { color: "rgb(175,175,175)", width: 1 },
    default: { color: "rgb(180,180,180)", width: 1 }
};
// ---------------- HELPERS ----------------
function mercator(lat, lon) {
    const R = 6378137;
    const latRad = lat * Math.PI / 180;
    const lonRad = lon * Math.PI / 180;
    const x = R * lonRad;
    const y = R * Math.log(Math.tan(Math.PI / 4 + latRad / 2));
    return [x, y];
}
function computeNormal(line, i) {
    let x1;
    let y1;
    let x2;
    let y2;
    if (i === 0) {
        x1 = line[i][0];
        y1 = line[i][1];
        x2 = line[i + 1][0];
        y2 = line[i + 1][1];
    }
    else if (i === line.length - 1) {
        x1 = line[i - 1][0];
        y1 = line[i - 1][1];
        x2 = line[i][0];
        y2 = line[i][1];
    }
    else {
        x1 = line[i - 1][0];
        y1 = line[i - 1][1];
        x2 = line[i + 1][0];
        y2 = line[i + 1][1];
    }
    const dx = x2 - x1;
    const dy = y2 - y1;
    const L = Math.hypot(dx, dy);
    if (L === 0)
        return [0, 0];
    return [-dy / L, dx / L];
}
function clamp(x, a = 0, b = 1) {
    return Math.max(a, Math.min(b, x));
}
function initMicrophone() {
    return __awaiter(this, void 0, void 0, function* () {
        const stream = yield navigator.mediaDevices.getUserMedia({ audio: true });
        audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        micData = new Uint8Array(analyser.frequencyBinCount);
        micEnabled = true;
        console.log("Microphone enabled");
    });
}
function getMicLevel() {
    if (!micEnabled)
        return 0;
    analyser.getByteFrequencyData(micData);
    let sum = 0;
    for (let i = 0; i < micData.length; i++) {
        sum += micData[i];
    }
    return sum / micData.length / 255;
}
// ---------------- PULSE ----------------
class Pulse {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.t = 0;
    }
    update(dt) {
        this.t += dt;
    }
    shockValue(x, y) {
        const dist = Math.hypot(x - this.x, y - this.y);
        const front = PULSE_SPEED * this.t;
        const spread = 80;
        const envelope = Math.exp(-(Math.pow((dist - front), 2)) / (2 * Math.pow(spread, 2)));
        const wave = Math.sin((dist - front) * PULSE_FREQ);
        const decay = Math.exp(-PULSE_DECAY * this.t);
        return PULSE_AMPLITUDE * envelope * wave * decay;
    }
}
let roadLines = [];
let tramLines = [];
let riverLines = [];
let lakePolys = [];
let placePointsScreen = [];
let icons = [];
let pulses = [];
let ZW = [0, 0];
const scale = BASE_SCALE * MAGNIFICATION;
// ---------------- WORLD → SCREEN ----------------
function worldToScreen(x, y) {
    const cx = ZW[0];
    const cy = ZW[1];
    const dx = (x - cx) * scale;
    const dy = (y - cy) * scale;
    const rx = dx * Math.cos(ROTATION_RAD) - dy * Math.sin(ROTATION_RAD);
    const ry = dx * Math.sin(ROTATION_RAD) + dy * Math.cos(ROTATION_RAD);
    const sx = WIDTH / 2 + rx;
    const sy = HEIGHT / 2 - ry;
    return [sx, sy];
}
// ---------------- ICON LOADING ----------------
function createIcon(name, type, x, y) {
    const img = new Image();
    const entry = {
        name,
        type,
        x,
        y,
        img,
        loaded: false,
        failed: false
    };
    img.onload = () => {
        entry.loaded = true;
    };
    img.onerror = () => {
        entry.failed = true;
        console.warn(`Missing icon: icons/${type}.png`);
    };
    img.src = `icons/${type}.png`;
    return entry;
}
// ---------------- LOAD DATA ----------------
function loadData() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const world = yield fetch("zurich_world_latlon_clean.json").then(r => r.json());
        const places = yield fetch("places_latlon.json").then(r => r.json());
        function project(line) {
            return line.map((p) => mercator(p[0], p[1]));
        }
        const roadsWorld = ((_a = world.roads) !== null && _a !== void 0 ? _a : []).map((r) => {
            if (Array.isArray(r)) {
                // old format: just coordinates
                return {
                    type: "residential",
                    points: project(r)
                };
            }
            // new format
            return {
                type: r.type || "residential",
                points: project(r.coords)
            };
        });
        const tramsWorld = ((_b = world.tram) !== null && _b !== void 0 ? _b : []).map(project);
        const riversWorld = ((_c = world.rivers) !== null && _c !== void 0 ? _c : []).map(project);
        const lakesWorld = ((_d = world.water) !== null && _d !== void 0 ? _d : []).map(project);
        const placePointsWorld = [];
        for (const p of places) {
            const [x, y] = mercator(p.lat, p.lon);
            placePointsWorld.push({
                name: p.name,
                type: p.type || p.name,
                x,
                y
            });
        }
        const center = placePointsWorld.find(p => p.name === CENTER_POINT);
        if (!center) {
            throw new Error(`Center point "${CENTER_POINT}" not found in places_latlon.json`);
        }
        ZW = [center.x, center.y];
        // Precompute screen geometry once
        roadLines = roadsWorld.map(r => ({
            type: r.type,
            points: r.points.map(([x, y]) => worldToScreen(x, y))
        }));
        tramLines = tramsWorld.map(line => line.map(([x, y]) => worldToScreen(x, y)));
        riverLines = riversWorld.map(line => line.map(([x, y]) => worldToScreen(x, y)));
        lakePolys = lakesWorld.map(poly => poly.map(([x, y]) => worldToScreen(x, y)));
        placePointsScreen = placePointsWorld.map(p => {
            const [sx, sy] = worldToScreen(p.x, p.y);
            return {
                name: p.name,
                type: p.type,
                x: sx,
                y: sy
            };
        });
        icons = placePointsScreen.map(p => createIcon(p.name, p.type, p.x, p.y));
        console.log("Loaded places:", placePointsScreen.length);
        console.log("Loaded tram lines:", tramLines.length);
    });
}
// ---------------- DRAW HELPERS ----------------
function drawPolyline(line) {
    if (line.length < 2)
        return;
    ctx.beginPath();
    for (let i = 0; i < line.length; i++) {
        const [x, y] = line[i];
        if (i === 0)
            ctx.moveTo(x, y);
        else
            ctx.lineTo(x, y);
    }
    ctx.stroke();
}
function drawPolygon(poly) {
    if (poly.length < 3)
        return;
    ctx.beginPath();
    for (let i = 0; i < poly.length; i++) {
        const [x, y] = poly[i];
        if (i === 0)
            ctx.moveTo(x, y);
        else
            ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
}
// ---------------- DRAW ----------------
function draw() {
    var _a;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    // Lakes
    ctx.fillStyle = WATER_COLOR;
    for (const poly of lakePolys) {
        drawPolygon(poly);
    }
    // Rivers
    ctx.strokeStyle = WATER_COLOR;
    ctx.lineWidth = RIVER_WIDTH;
    for (const line of riverLines) {
        drawPolyline(line);
    }
    // Roads
    for (const road of roadLines) {
        const style = (_a = ROAD_STYLE[road.type]) !== null && _a !== void 0 ? _a : ROAD_STYLE.default;
        ctx.strokeStyle = style.color;
        ctx.lineWidth = style.width;
        drawPolyline(road.points);
    }
    // Tram lines with pulse deformation
    for (let li = 0; li < tramLines.length; li++) {
        const line = tramLines[li];
        if (line.length < 2)
            continue;
        ctx.strokeStyle = TRAM_COLORS[li % TRAM_COLORS.length];
        ctx.lineWidth = TRAM_WIDTH;
        ctx.beginPath();
        for (let i = 0; i < line.length; i++) {
            let x = line[i][0];
            let y = line[i][1];
            let offset = 0;
            for (const pulse of pulses) {
                offset += pulse.shockValue(x, y);
            }
            const [nx, ny] = computeNormal(line, i);
            x += nx * offset;
            y += ny * offset;
            if (i === 0)
                ctx.moveTo(x, y);
            else
                ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
    // Pulse circles
    for (const pulse of pulses) {
        const r = PULSE_SPEED * pulse.t;
        const alpha = clamp(1 - pulse.t / PULSE_LIFETIME, 0, 1);
        ctx.strokeStyle = `rgba(255,255,255,${0.7 * alpha})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pulse.x, pulse.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = `rgba(255,255,255,${0.35 * alpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(pulse.x, pulse.y, r + 8, 0, Math.PI * 2);
        ctx.stroke();
    }
    // Icons
    // Icons
    for (const icon of icons) {
        if (!icon.loaded)
            continue;
        if (icon.failed)
            continue;
        const w = ICON_BASE_SIZE;
        const h = ICON_BASE_SIZE;
        ctx.drawImage(icon.img, icon.x - w / 2, icon.y - h / 2, w, h);
    }
}
// ---------------- UPDATE ----------------
function update(dt) {
    for (const p of pulses) {
        p.update(dt);
    }
    pulses = pulses.filter(p => p.t < PULSE_LIFETIME);
    if (!micEnabled)
        return;
    const level = getMicLevel();
    const now = performance.now() / 1000;
    if (level > MIC_THRESHOLD && now - lastMicPulse > MIC_COOLDOWN) {
        const [sx, sy] = worldToScreen(ZW[0], ZW[1]);
        pulses.push(new Pulse(sx, sy));
        lastMicPulse = now;
    }
}
// ---------------- LOOP ----------------
let lastTime = 0;
function loop(t) {
    const dt = lastTime === 0 ? 0 : (t - lastTime) / 1000;
    lastTime = t;
    update(dt);
    draw();
    requestAnimationFrame(loop);
}
// ---------------- INPUT ----------------
// ---------------- INPUT ----------------
// enable microphone on first click anywhere
window.addEventListener("click", () => {
    if (!micEnabled) {
        initMicrophone();
    }
});
canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    pulses.push(new Pulse(x, y));
});
window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
        e.preventDefault();
        if (placePointsScreen.length === 0)
            return;
        const p = placePointsScreen[Math.floor(Math.random() * placePointsScreen.length)];
        pulses.push(new Pulse(p.x, p.y));
    }
});
// ---------------- START ----------------
loadData()
    .then(() => {
    requestAnimationFrame(loop);
})
    .catch((err) => {
    console.error("Failed to start:", err);
});
