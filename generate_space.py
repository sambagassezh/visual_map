import osmnx as ox
import geopandas as gpd
import json
import matplotlib.pyplot as plt

PLACE = "Zurich, Switzerland"

tags = {
    "highway": ["primary","secondary","tertiary","residential","living_street"],
    "railway": "tram",
    "waterway": "river",
    "natural": "water",
}

print("Downloading data from OpenStreetMap...")

gdf = ox.features_from_place(PLACE, tags)

print("features downloaded:",len(gdf))

# --------------------------------------------------
# separate layers
# --------------------------------------------------

roads = gdf[gdf["highway"].notnull()]
tram = gdf[gdf["railway"] == "tram"]
river = gdf[gdf["waterway"] == "river"]
water = gdf[gdf["natural"] == "water"]

print("roads:",len(roads))
print("tram:",len(tram))
print("river:",len(river))
print("water:",len(water))


# --------------------------------------------------
# extract coordinates
# --------------------------------------------------

def extract_lines(gdf):

    lines=[]

    for geom in gdf.geometry:

        if geom is None:
            continue

        if geom.geom_type == "LineString":

            coords=[(lat,lon) for lon,lat in geom.coords]
            lines.append(coords)

        elif geom.geom_type == "MultiLineString":

            for sub in geom.geoms:

                coords=[(lat,lon) for lon,lat in sub.coords]
                lines.append(coords)

    return lines


def extract_polygons(gdf):

    polys=[]

    for geom in gdf.geometry:

        if geom is None:
            continue

        if geom.geom_type == "Polygon":

            coords=[(lat,lon) for lon,lat in geom.exterior.coords]
            polys.append(coords)

        elif geom.geom_type == "MultiPolygon":

            for sub in geom.geoms:

                coords=[(lat,lon) for lon,lat in sub.exterior.coords]
                polys.append(coords)

    return polys


roads_lines = extract_lines(roads)
tram_lines = extract_lines(tram)
river_lines = extract_lines(river)
water_polys = extract_polygons(water)

# --------------------------------------------------
# save world data
# --------------------------------------------------

world = {
    "roads":roads_lines,
    "tram":tram_lines,
    "rivers":river_lines,
    "water":water_polys
}

with open("zurich_world_latlon.json","w") as f:
    json.dump(world,f)

print("Saved zurich_world_latlon.json")


# --------------------------------------------------
# load places
# --------------------------------------------------

with open("places_latlon.json") as f:
    places=json.load(f)


# --------------------------------------------------
# bounding box
# --------------------------------------------------

north = gdf.total_bounds[3]
south = gdf.total_bounds[1]
east = gdf.total_bounds[2]
west = gdf.total_bounds[0]

print("Bounding box:",north,south,east,west)


# --------------------------------------------------
# projection for preview
# --------------------------------------------------

def project(lat,lon):

    x=(lon-west)/(east-west)
    y=(north-lat)/(north-south)

    return x,y


# --------------------------------------------------
# test renders
# --------------------------------------------------

# centers=["ZW","GrossMunster","Zoo","Letzi","Uetli"]

# for cname in centers:

#     center=None

#     for p in places:
#         if p["name"]==cname:
#             center=p

#     cx,cy=project(center["lat"],center["lon"])

#     plt.figure(figsize=(6,6))

#     # roads
#     for line in roads_lines:

#         pts=[project(lat,lon) for lat,lon in line]

#         xs=[p[0]-cx+0.5 for p in pts]
#         ys=[p[1]-cy+0.5 for p in pts]

#         plt.plot(xs,ys,color="gray",linewidth=0.5)

#     # tram
#     for line in tram_lines:

#         pts=[project(lat,lon) for lat,lon in line]

#         xs=[p[0]-cx+0.5 for p in pts]
#         ys=[p[1]-cy+0.5 for p in pts]

#         plt.plot(xs,ys,color="red",linewidth=1)

#     # rivers
#     for line in river_lines:

#         pts=[project(lat,lon) for lat,lon in line]

#         xs=[p[0]-cx+0.5 for p in pts]
#         ys=[p[1]-cy+0.5 for p in pts]

#         plt.plot(xs,ys,color="blue",linewidth=1)

#     # places
#     for p in places:

#         x,y=project(p["lat"],p["lon"])

#         x=x-cx+0.5
#         y=y-cy+0.5

#         plt.scatter(x,y,color="black")

#         plt.text(x+0.01,y+0.01,p["name"],fontsize=8)

#     plt.xlim(0,1)
#     plt.ylim(0,1)

#     plt.gca().invert_yaxis()

#     plt.title("center = "+cname)

#     plt.savefig("preview_"+cname+".png",dpi=200)

#     plt.close()

print("Preview renders exported")