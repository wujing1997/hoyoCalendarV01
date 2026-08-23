"""Write the frozen OpenAPI contract for the public API and the admin API."""

import json
import os
import sys

CLOUD_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if CLOUD_DIR not in sys.path:
    sys.path.insert(0, CLOUD_DIR)

from app.main import admin_app, api_app  # noqa: E402

OUT = os.path.join(CLOUD_DIR, "openapi")


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    public = api_app.openapi()
    admin = admin_app.openapi()
    with open(os.path.join(OUT, "api.openapi.json"), "w", encoding="utf-8") as handle:
        json.dump(public, handle, ensure_ascii=False, indent=2)
    with open(os.path.join(OUT, "admin.openapi.json"), "w", encoding="utf-8") as handle:
        json.dump(admin, handle, ensure_ascii=False, indent=2)
    print(f"wrote {len(public['paths'])} public paths and {len(admin['paths'])} admin paths")


if __name__ == "__main__":
    main()
