"""Checks the parts of flood_extent.py that run on this computer (no Earth Engine login needed).
Run:  python test_flood_extent.py"""

import json
import math
import tempfile
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import transform_bounds

import flood_extent as fe

PROPS = {"aoi_name": "Test", "sensor": "Sentinel-1 C-band VH", "acquisition_date": "2024-08-21",
         "baseline_date": "2024-08-09", "threshold": 1.25}
PIXEL_DEG = 0.0001          # about 10 m
TOP, LEFT = 23.10, 91.40    # somewhere over Feni


def write_mask(path, mask):
    with rasterio.open(path, "w", driver="GTiff", height=mask.shape[0], width=mask.shape[1], count=1,
                       dtype="uint8", crs="EPSG:4326", transform=from_origin(LEFT, TOP, PIXEL_DEG, PIXEL_DEG)) as dst:
        dst.write(mask, 1)


def test_otsu_splits_two_humps():
    # 90% unchanged land around ratio 1.0, 10% new water around 1.5
    rng = np.random.default_rng(0)
    values = np.concatenate([rng.normal(1.0, 0.05, 9000), rng.normal(1.5, 0.08, 1000)])
    counts, edges = np.histogram(values, bins=200, range=(0.5, 2.5))
    cut = fe.otsu(edges[:-1] + 0.005, counts)
    assert 1.15 < cut < 1.35, cut


def test_polygons_areas_and_contract(tmp):
    mask = np.zeros((200, 200), np.uint8)
    mask[10:20, 10:20] = 1      # 10 x 10 pixels
    mask[50:90, 50:70] = 1      # 40 x 20 pixels, the bigger patch
    write_mask(tmp / "m.tif", mask)
    polygons = fe.mask_to_polygons(tmp / "m.tif", PROPS)

    assert len(polygons) == 2
    assert list(polygons.columns) == ["aoi_name", "sensor", "acquisition_date", "baseline_date",
                                      "area_km2", "threshold", "detects", "geometry"]
    assert (polygons["detects"] == "open_water_only").all()
    assert polygons["area_km2"].iloc[0] > polygons["area_km2"].iloc[1]    # largest first

    # expected ground area of one pixel at this latitude, from sphere geometry (~0.5% from UTM)
    metres_per_degree = 111_195
    lat = math.radians(TOP - 0.005)
    pixel_km2 = (PIXEL_DEG * metres_per_degree) * (PIXEL_DEG * metres_per_degree * math.cos(lat)) / 1e6
    for got, pixels in zip(polygons["area_km2"], (800, 100)):
        assert abs(got / (pixels * pixel_km2) - 1) < 0.01, (got, pixels * pixel_km2)

    feature = json.loads(polygons.to_json(drop_id=True))["features"][0]
    assert feature["properties"]["acquisition_date"] == "2024-08-21"
    assert feature["geometry"]["type"] == "Polygon"


def test_no_flood_gives_empty_collection(tmp):
    write_mask(tmp / "empty.tif", np.zeros((50, 50), np.uint8))
    polygons = fe.mask_to_polygons(tmp / "empty.tif", PROPS)
    collection = json.loads(polygons.to_json(drop_id=True))
    assert collection["type"] == "FeatureCollection" and collection["features"] == []


def test_nisar_reads_only_the_window(tmp):
    # A small file laid out like a NISAR GCOV product: 300 x 200 pixels, 20 m apart, UTM zone 46N
    import h5py
    import nisar_flood as nf
    x = 500_010.0 + 20 * np.arange(300)          # pixel centres, west to east
    y = 2_450_010.0 - 20 * np.arange(200)        # pixel centres, north to south
    with h5py.File(tmp / "gcov.h5", "w") as f:
        grid = f.create_group(nf.GRID)
        grid["xCoordinates"], grid["yCoordinates"] = x, y
        grid.create_dataset("projection", data=32646).attrs["epsg_code"] = 32646
        grid["HHHH"] = np.full((200, 300), 0.05, "float32")   # 0.05 linear = -13 dB, a typical field
    # ask for a lon/lat box around a 2 km x 1 km patch in the middle
    bounds = transform_bounds("EPSG:32646", "EPSG:4326", 502_000, 2_447_000, 504_000, 2_448_000)
    with open(tmp / "gcov.h5", "rb") as file_obj:
        power, transform, crs = nf.read_window(file_obj, bounds)
    assert crs.to_epsg() == 32646
    assert 95 <= power.shape[1] <= 110 and 45 <= power.shape[0] <= 60, power.shape   # not all 300 x 200
    assert (transform.a, transform.e) == (20, -20)
    assert (transform.c + 10 - x[0]) % 20 == 0          # window edge sits exactly on the pixel grid
    assert np.allclose(power, 0.05)


def test_nisar_detect_keeps_flood_drops_noise_and_masked():
    import nisar_flood as nf
    rng = np.random.default_rng(1)
    before = (-12 + rng.normal(0, 0.5, (120, 120))).astype("float32")     # fields, with a little noise
    during = (-12 + rng.normal(0, 0.5, (120, 120))).astype("float32")
    during[20:60, 20:60] = -24          # a real new flood: 40 x 40 pixels turned much darker
    during[100, 40] = -24               # one lone speckle pixel
    during[20:60, 90:110] = -24         # darkening inside an excluded strip (say, a permanent river)
    usable = np.ones((120, 120), bool)
    usable[:, 85:] = False
    clean, _, _, threshold, how = nf.detect(before, during, usable)
    assert clean[25:55, 25:55].all(), how   # the flood survives
    assert clean[100, 40] == 0               # the lone pixel is gone
    assert not clean[:, 85:].any()           # excluded pixels are never flood
    assert 1.1 <= threshold <= 2.0, (threshold, how)


def test_nisar_catalogue_size_parsing():
    import nisar_flood as nf
    record = {"NISAR_L2_PR_GCOV_x.h5": {"bytes": 6_100_000_000, "format": "HDF5"},
              "NISAR_L2_PR_GCOV_x_LATLON.png": {"bytes": 1_700_000, "format": "PNG"}}
    assert nf.h5_size(record) == 6_100_000_000        # the data file, not the preview picture
    assert nf.h5_size(3_500_000_000) == 3_500_000_000  # a few records give one plain number
    assert nf.h5_size(None) == 0


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as folder:
        test_otsu_splits_two_humps()
        test_polygons_areas_and_contract(Path(folder))
        test_no_flood_gives_empty_collection(Path(folder))
        test_nisar_reads_only_the_window(Path(folder))
        test_nisar_detect_keeps_flood_drops_noise_and_masked()
        test_nisar_catalogue_size_parsing()
    print("all 6 checks passed")
