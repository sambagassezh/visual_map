import json
import math
import matplotlib.pyplot as plt
from pathlib import Path

# ======================================
# 🎛️ GLOBAL SETTINGS
# ======================================

WIDTH = 1600
HEIGHT = 900

CENTER_NAME = "ZW"

WORLD_FILE = "zurich_world_latlon_clean.json"
PLACES_FILE = "places_latlon.json"
TRAM_FILE = "tram_vectorized.json"

# optional alternative roads source
USE_ALT_ROADS = False
ALT_ROADS_FILE = WORLD_FILE

OUTPUT_DIR = Path("outputs_big_roads")
OUTPUT_DIR.mkdir(exist_ok=True)

FINAL_DPI = 600

# ======================================
# 🎛️ PARAMETER SPACE
# ======================================

ZOOMS = [
    0.00012 * 400,
]

ROTATIONS = [
    -10,
]

BG_COLORS = [
    # "#ffffff",
    # "#fff9e8",
    "#f5f1e8",
    # "#ffffff00",
]

TOL = 10

SIMPLIFY_ROADS = False   # alt roads file is already simplified
SIMPLIFY_WATER = True
SIMPLIFY_TRAMS = True

# ======================================
# 🎨 STYLE
# ======================================

WATER_COLOR = "#a3ccf1"
ROAD_COLOR = "#97929255"

TRAM_COLORS = ["#ff3e3e", "#3e70ff", "#ffcc00"]
TRAM_OUTER_WIDTH = 8
TRAM_INNER_WIDTH = 4
TRAM_CENTER_WIDTH = 1.5
TRAM_OUTER_ALPHA = 0.15
TRAM_INNER_ALPHA = 1.0
TRAM_CENTER_ALPHA = 0.8
TRAM_CENTER_COLOR = "#fff9e8"

ROAD_LINEWIDTH = 1.2

# ======================================
# 🌍 MERCATOR
# ======================================

R = 6378137

def mercator(lat, lon):
    lat_rad = math.radians(lat)
    lon_rad = math.radians(lon)
    x = R * lon_rad
    y = R * math.log(math.tan(math.pi / 4 + lat_rad / 2))
    return x, y

# ======================================
# ✂️ DOUGLAS-PEUCKER SIMPLIFICATION
# ======================================

def point_line_distance(p, a, b):
    px, py = p
    ax, ay = a
    bx, by = b

    dx = bx - ax
    dy = by - ay

    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)

    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))

    proj_x = ax + t * dx
    proj_y = ay + t * dy

    return math.hypot(px - proj_x, py - proj_y)

def rdp(points, tol):
    if len(points) <= 2:
        return points

    start = points[0]
    end = points[-1]

    max_dist = -1
    idx = -1

    for i in range(1, len(points) - 1):
        d = point_line_distance(points[i], start, end)
        if d > max_dist:
            max_dist = d
            idx = i

    if max_dist > tol:
        left = rdp(points[:idx + 1], tol)
        right = rdp(points[idx:], tol)
        return left[:-1] + right
    else:
        return [start, end]

def simplify_open_line(points, tol):
    if tol <= 0 or len(points) <= 2:
        return points
    return rdp(points, tol)

def simplify_closed_ring(points, tol):
    if tol <= 0 or len(points) <= 4:
        return points

    closed = points[0] == points[-1]
    work = points[:-1] if closed else points[:]

    if len(work) < 3:
        return points

    simplified = rdp(work + [work[0]], tol)

    if len(simplified) > 1 and simplified[0] == simplified[-1]:
        simplified = simplified[:-1]

    if len(simplified) < 3:
        simplified = work[:]

    simplified = simplified + [simplified[0]]
    return simplified

# ======================================
# 📥 LOAD DATA
# ======================================

with open(WORLD_FILE, "r", encoding="utf-8") as f:
    world = json.load(f)

with open(PLACES_FILE, "r", encoding="utf-8") as f:
    places = json.load(f)

with open(TRAM_FILE, "r", encoding="utf-8") as f:
    tram_data = json.load(f)

alt_roads_data = None
if USE_ALT_ROADS:
    with open(ALT_ROADS_FILE, "r", encoding="utf-8") as f:
        alt_roads_data = json.load(f)
    print(f"Using alternative roads file: {ALT_ROADS_FILE}")

if world.get("roads"):
    print("world roads sample type:", type(world.get("roads", [])[0]))
    print("world roads sample:", world.get("roads", [])[0])

if alt_roads_data is not None:
    print("alt roads keys:", alt_roads_data.keys())
    if alt_roads_data.get("lines"):
        print("alt roads sample:", alt_roads_data["lines"][0][:3])

center = next((p for p in places if p["name"] == CENTER_NAME), places[0])
ZW = mercator(center["lat"], center["lon"])

coords = tram_data["coords"]
lines_idx = tram_data["lines"]
vector_scale = tram_data.get("scale", 1)
bounds = tram_data["bounds"]

# ======================================
# 🧠 TRANSFORM FACTORY
# ======================================

def make_transform(scale, rot_deg):
    rot = math.radians(rot_deg)

    def world_to_screen(x, y):
        dx = (x - ZW[0]) * scale
        dy = (y - ZW[1]) * scale

        sx = WIDTH / 2 + (dx * math.cos(rot) - dy * math.sin(rot))
        sy = HEIGHT / 2 - (dx * math.sin(rot) + dy * math.cos(rot))

        return sx, sy

    return world_to_screen

def denormalize(nx, ny):
    x = bounds["min_x"] + nx * (bounds["max_x"] - bounds["min_x"])
    y = bounds["min_y"] + ny * (bounds["max_y"] - bounds["min_y"])
    return x, y

# ======================================
# 🚋 REBUILD TRAM LINES
# ======================================

def build_tram_lines_screen(world_to_screen):
    tram_lines = []

    for start, end in lines_idx:
        merc_line = []

        for i in range(start, end, 2):
            nx = coords[i] / vector_scale
            ny = coords[i + 1] / vector_scale

            wx, wy = denormalize(nx, ny)
            merc_line.append((wx, wy))

        if SIMPLIFY_TRAMS:
            merc_line = simplify_open_line(merc_line, TOL)

        screen_line = [world_to_screen(x, y) for x, y in merc_line]
        tram_lines.append(screen_line)

    return tram_lines

# ======================================
# 🛣️ ROAD SOURCE SELECTOR
# ======================================

def get_roads_latlon_lines():
    roads = world.get("roads", [])
    out = []

    for road in roads:
        if isinstance(road, dict):
            coords = road.get("coords", [])
        else:
            coords = road

        if coords:
            out.append(coords)

    return out

# ======================================
# 🎨 DRAW HELPERS
# ======================================

def draw_roads(ax, world_to_screen):
    roads_latlon_lines = get_roads_latlon_lines()

    print(f"Road lines to draw: {len(roads_latlon_lines)}")

    for road_coords in roads_latlon_lines:
        merc_line = [mercator(p[0], p[1]) for p in road_coords]

        if SIMPLIFY_ROADS:
            merc_line = simplify_open_line(merc_line, TOL)

        pts = [world_to_screen(x, y) for x, y in merc_line]

        if len(pts) < 2:
            continue

        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        ax.plot(xs, ys, color=ROAD_COLOR, linewidth=ROAD_LINEWIDTH)

def draw_water(ax, world_to_screen):
    for poly in world.get("water", []):
        merc_poly = [mercator(p[0], p[1]) for p in poly]

        if SIMPLIFY_WATER:
            merc_poly = simplify_closed_ring(merc_poly, TOL)

        pts = [world_to_screen(x, y) for x, y in merc_poly]

        if len(pts) < 3:
            continue

        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        ax.fill(xs, ys, color=WATER_COLOR)

def draw_trams(ax, tram_lines):
    for idx, line in enumerate(tram_lines):
        if len(line) < 2:
            continue

        xs = [p[0] for p in line]
        ys = [p[1] for p in line]

        color = TRAM_COLORS[idx % len(TRAM_COLORS)]

        ax.plot(xs, ys, color=color, linewidth=TRAM_OUTER_WIDTH, alpha=TRAM_OUTER_ALPHA)
        ax.plot(xs, ys, color=color, linewidth=TRAM_INNER_WIDTH, alpha=TRAM_INNER_ALPHA)
        ax.plot(xs, ys, color=TRAM_CENTER_COLOR, linewidth=TRAM_CENTER_WIDTH, alpha=TRAM_CENTER_ALPHA)

# ======================================
# 🖼️ RENDER FUNCTION
# ======================================

def render(scale, rot_deg, bg_color):
    world_to_screen = make_transform(scale, rot_deg)
    # tram_lines = build_tram_lines_screen(world_to_screen)

    fig, ax = plt.subplots(figsize=(16, 9), dpi=500)

    ax.set_facecolor(bg_color)
    fig.patch.set_facecolor(bg_color)

    draw_water(ax, world_to_screen)
    draw_roads(ax, world_to_screen)
    # draw_trams(ax, tram_lines)

    ax.set_xlim(0, WIDTH)
    ax.set_ylim(HEIGHT, 0)
    ax.axis("off")

    plt.tight_layout()

    safe_bg = bg_color.replace("#", "")
    road_tag = "altroads" if USE_ALT_ROADS else "worldroads"
    filename = f"map_{road_tag}_z{int(scale * 1e6)}_r{rot_deg}_bg{safe_bg}_tol{TOL}.png"
    outpath = OUTPUT_DIR / filename

    plt.savefig(
        outpath,
        dpi=FINAL_DPI,
        facecolor=fig.get_facecolor(),
        bbox_inches=None,
        pad_inches=0,
        transparent=(bg_color.endswith("00"))
    )
    plt.close()

    print(f"✅ Saved: {outpath}")

# ======================================
# 🚀 BATCH EXPORT
# ======================================

for zoom in ZOOMS:
    for rot in ROTATIONS:
        for bg in BG_COLORS:
            render(zoom, rot, bg)

print("🎉 All exports finished.")