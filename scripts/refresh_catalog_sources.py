"""Явное сетевое обновление источников; не меняет основной каталог или оценки качества."""

from pathlib import Path

import httpx

from adoption_compass.catalog_sources import load_registry, refresh_sources, write_bundle

if __name__ == "__main__":
    target = (
        Path(__file__).resolve().parent.parent / "src/adoption_compass/data/source-snapshots.json"
    )
    with httpx.Client(
        timeout=30, headers={"User-Agent": "AI-Adoption-Compass/1.1 source-review"}
    ) as client:
        bundle = refresh_sources(load_registry(), client)
    write_bundle(bundle, target)
    for snapshot in bundle.snapshots:
        print(f"{snapshot.source_id}: {snapshot.status}, offers={len(snapshot.offers)}")
    if any(s.status == "unavailable" for s in bundle.snapshots):
        raise SystemExit(1)
