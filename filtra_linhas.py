import json
import math

WORLD_FILE = "zurich_world_latlon.json"
OUTPUT_FILE = "zurich_world_latlon_clean.json"

MIN_LENGTH = 400       # meters
MAX_CURVE = 1.4
MERGE_DISTANCE = 200   # meters


# ---------------------------------------------------
# MERCATOR PROJECTION
# ---------------------------------------------------

R = 6378137

def mercator(lat, lon):

    lat_rad = math.radians(lat)
    lon_rad = math.radians(lon)

    x = R * lon_rad
    y = R * math.log(math.tan(math.pi/4 + lat_rad/2))

    return x, y


def inverse_mercator(x, y):

    lon = math.degrees(x / R)
    lat = math.degrees(2 * math.atan(math.exp(y / R)) - math.pi/2)

    return lat, lon


# ---------------------------------------------------
# LOAD WORLD
# ---------------------------------------------------

world = json.load(open(WORLD_FILE))

tram_lines_latlon = world["tram"]


# ---------------------------------------------------
# CONVERT TO MERCATOR
# ---------------------------------------------------

lines = []

for line in tram_lines_latlon:

    merc = []

    for lat,lon in line:

        x,y = mercator(lat,lon)

        merc.append((x,y))

    lines.append(merc)


# ---------------------------------------------------
# GEOMETRY HELPERS
# ---------------------------------------------------

def length(line):

    total = 0

    for i in range(len(line)-1):

        x1,y1 = line[i]
        x2,y2 = line[i+1]

        total += math.hypot(x2-x1, y2-y1)

    return total


def curvature(line):

    direct = math.hypot(
        line[-1][0]-line[0][0],
        line[-1][1]-line[0][1]
    )

    if direct == 0:
        return 999

    return length(line) / direct


def center(line):

    xs = [p[0] for p in line]
    ys = [p[1] for p in line]

    return sum(xs)/len(xs), sum(ys)/len(ys)


def dist(a,b):

    return math.hypot(a[0]-b[0], a[1]-b[1])


# ---------------------------------------------------
# FILTER
# ---------------------------------------------------

filtered = []

for line in lines:

    if length(line) < MIN_LENGTH:
        continue

    if curvature(line) > MAX_CURVE:
        continue

    filtered.append(line)


# ---------------------------------------------------
# REMOVE DUPLICATES
# ---------------------------------------------------

clean = []

for line in filtered:

    c = center(line)

    keep = True

    for other in clean:

        if dist(c, center(other)) < MERGE_DISTANCE:

            keep = False
            break

    if keep:
        clean.append(line)


print("Original tram segments:", len(lines))
print("Clean tram segments:", len(clean))


# ---------------------------------------------------
# CONVERT BACK TO LAT/LON
# ---------------------------------------------------

clean_latlon = []

for line in clean:

    latlon = []

    for x,y in line:

        lat,lon = inverse_mercator(x,y)

        latlon.append((lat,lon))

    clean_latlon.append(latlon)


# ---------------------------------------------------
# UPDATE WORLD FILE
# ---------------------------------------------------

world["tram"] = clean_latlon

json.dump(world, open(OUTPUT_FILE,"w"))

print("Saved updated world:", OUTPUT_FILE)