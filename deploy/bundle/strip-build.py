#!/usr/bin/env python3
"""
Derives the per-role compose file that ships inside a bundle.

    strip-build.py <source.yml> <output.yml> <version> --role server --services server,postgres,redis

Input is deploy/docker-compose.yml itself. Reading the source file is deliberate:
`docker compose config` resolves `${...}` expressions, which would bake build-time
placeholder secrets into a customer bundle. From the source topology this emits
the subset a single installable role needs:

  1. Keep only the named services.
  2. Drop every `build:` stanza — a customer machine has no source tree, so a
     build key is at best ignored and at worst makes `compose up` try to build.
  3. Pin application images to the release version.
  4. Prune `depends_on` entries that point at services this role does not carry,
     otherwise `compose up` fails with "depends on undefined service".
  5. Keep only the named volumes and networks the surviving services use.

Shared by build-bundle.sh (Linux) and build-bundle.ps1 (Windows), so the two
platforms cannot ship different topologies for the same role.

Requires PyYAML on the build machine (`pip install pyyaml`). Comments are not
preserved in generated role files; configuration meaning and `${...}` values are.
"""
from __future__ import annotations

import argparse
import sys
from typing import Optional

try:
    import yaml
except ImportError:  # pragma: no cover
    print("error: PyYAML is required on the build machine — pip install pyyaml",
          file=sys.stderr)
    raise SystemExit(2)

APP_IMAGE_PREFIX = "insight-hub/"

RAG_ENVIRONMENT = {
    "POSTGRES_URL": "${RAG_POSTGRES_URL:?set RAG_POSTGRES_URL in the RAG role .env}",
    "CORE_SERVER_URL": "${CORE_SERVER_URL:?set CORE_SERVER_URL in the RAG role .env}",
    "RAG_INTERNAL_SECRET": "${RAG_INTERNAL_SECRET:?set RAG_INTERNAL_SECRET in the RAG role .env}",
}


def derive(doc: dict, services: list[str], version: str, role: Optional[str] = None) -> dict:
    available = doc.get("services") or {}

    missing = [name for name in services if name not in available]
    if missing:
        raise SystemExit(
            f"error: role names services that do not exist in the source compose: "
            f"{', '.join(missing)}"
        )

    kept: dict = {}
    for name in services:
        service = dict(available[name])
        service.pop("build", None)

        image = service.get("image", "")
        if image.startswith(APP_IMAGE_PREFIX):
            # Split on the FIRST colon, not the last: an un-interpolated
            # `insight-hub/server:${IMAGE_TAG:-local}` contains a colon
            # inside the default-value syntax, and rsplit would cut there and
            # emit `...:${IMAGE_TAG:1.0.0`. Repository names cannot contain a
            # colon, so the first one always starts the tag.
            service["image"] = f"{image.split(':', 1)[0]}:{version}"

        # A dependency on a service this role does not install would abort
        # `compose up`. Dropping it is correct: cross-role dependencies are
        # satisfied over the network (SERVER_URL), not by the container runtime.
        depends = service.get("depends_on")
        if isinstance(depends, dict):
            pruned = {k: v for k, v in depends.items() if k in services}
            if pruned:
                service["depends_on"] = pruned
            else:
                service.pop("depends_on")
        elif isinstance(depends, list):
            pruned = [d for d in depends if d in services]
            if pruned:
                service["depends_on"] = pruned
            else:
                service.pop("depends_on")

        kept[name] = service

    if role == "rag":
        rag = kept.get("rag")
        if rag is None:
            raise SystemExit("error: the rag role must include the rag service")
        rag["environment"] = {**(rag.get("environment") or {}), **RAG_ENVIRONMENT}
        rag["ports"] = ["${RAG_BIND:-0.0.0.0}:${RAG_PORT:-8000}:8000"]
        extra_hosts = rag.get("extra_hosts") or []
        if "host.docker.internal:host-gateway" not in extra_hosts:
            rag["extra_hosts"] = [*extra_hosts, "host.docker.internal:host-gateway"]
        networks = rag.get("networks") or []
        if isinstance(networks, dict):
            rag["networks"] = {**networks, "egress": None}
        elif "egress" not in networks:
            rag["networks"] = [*networks, "egress"]

    out: dict = {"services": kept}
    if "name" in doc:
        out["name"] = doc["name"]

    used_volumes: set[str] = set()
    used_networks: set[str] = set()
    for service in kept.values():
        for mount in service.get("volumes") or []:
            source = mount.get("source") if isinstance(mount, dict) else str(mount).split(":")[0]
            if source:
                used_volumes.add(source)

        networks = service.get("networks") or []
        if isinstance(networks, dict):
            used_networks.update(networks)
        else:
            used_networks.update(networks)

    volumes = {
        name: config
        for name, config in (doc.get("volumes") or {}).items()
        if name in used_volumes
    }
    if volumes:
        out["volumes"] = volumes

    networks = {
        name: config
        for name, config in (doc.get("networks") or {}).items()
        if name in used_networks
    }
    if networks:
        out["networks"] = networks

    return out


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("output")
    parser.add_argument("version")
    parser.add_argument("--role", choices=("server", "collector", "rag"), required=True)
    parser.add_argument("--services", required=True,
                        help="comma-separated service names to keep")
    args = parser.parse_args(argv[1:])

    services = [s.strip() for s in args.services.split(",") if s.strip()]
    if not services:
        print("error: --services must name at least one service", file=sys.stderr)
        return 2

    with open(args.source, encoding="utf-8-sig") as handle:
        doc = yaml.safe_load(handle)

    result = derive(doc, services, args.version, args.role)

    # Refuse to ship something unusable rather than failing on the customer's machine.
    for name, service in result["services"].items():
        if not service.get("image"):
            print(f"error: service '{name}' has no image after filtering", file=sys.stderr)
            return 1

    with open(args.output, "w", encoding="utf-8", newline="\n") as handle:
        yaml.safe_dump(result, handle, sort_keys=False, default_flow_style=False, width=100)

    print(f"    wrote {args.output} ({', '.join(services)})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
