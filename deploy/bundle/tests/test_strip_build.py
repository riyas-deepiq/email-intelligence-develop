from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest


MODULE_PATH = Path(__file__).parents[1] / "strip-build.py"
SPEC = importlib.util.spec_from_file_location("strip_build", MODULE_PATH)
assert SPEC and SPEC.loader
STRIP_BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(STRIP_BUILD)


class DeriveTests(unittest.TestCase):
    def test_prunes_build_dependencies_volumes_and_networks(self) -> None:
        source = {
            "name": "insight-hub",
            "services": {
                "server": {
                    "build": {"context": "."},
                    "image": "insight-hub/server:local",
                    "depends_on": {"postgres": {"condition": "service_healthy"}, "rag": {}},
                    "volumes": [{"source": "pgdata", "target": "/data"}],
                    "networks": {"backend": None, "edge": None},
                },
                "postgres": {
                    "image": "postgres:16.14-alpine3.24",
                    "networks": ["backend"],
                },
                "rag": {"image": "insight-hub/rag:local", "networks": ["backend"]},
            },
            "volumes": {"pgdata": None, "unused": None},
            "networks": {"backend": {"internal": True}, "edge": None, "unused": None},
        }

        result = STRIP_BUILD.derive(source, ["server", "postgres"], "2.0.0")

        self.assertEqual(result["services"]["server"]["image"], "insight-hub/server:2.0.0")
        self.assertNotIn("build", result["services"]["server"])
        self.assertEqual(set(result["services"]["server"]["depends_on"]), {"postgres"})
        self.assertEqual(set(result["volumes"]), {"pgdata"})
        self.assertEqual(set(result["networks"]), {"backend", "edge"})

    def test_rag_role_preserves_runtime_configuration(self) -> None:
        source = {
            "services": {
                "rag": {
                    "build": {"context": "."},
                    "image": "insight-hub/rag:${IMAGE_TAG:-local}",
                    "environment": {"POSTGRES_URL": "build-placeholder"},
                    "networks": ["backend"],
                }
            },
            "networks": {"backend": {"internal": True}, "egress": None},
        }

        result = STRIP_BUILD.derive(source, ["rag"], "2.0.0", role="rag")
        rag = result["services"]["rag"]

        self.assertEqual(rag["image"], "insight-hub/rag:2.0.0")
        self.assertIn("${RAG_POSTGRES_URL:?", rag["environment"]["POSTGRES_URL"])
        self.assertIn("${CORE_SERVER_URL:?", rag["environment"]["CORE_SERVER_URL"])
        self.assertEqual(rag["ports"], ["${RAG_BIND:-0.0.0.0}:${RAG_PORT:-8000}:8000"])
        self.assertEqual(rag["extra_hosts"], ["host.docker.internal:host-gateway"])
        self.assertEqual(set(rag["networks"]), {"backend", "egress"})
        self.assertEqual(set(result["networks"]), {"backend", "egress"})

    def test_real_role_outputs_keep_runtime_secrets(self) -> None:
        source_path = Path(__file__).parents[2] / "docker-compose.yml"
        source = STRIP_BUILD.yaml.safe_load(source_path.read_text(encoding="utf-8"))

        server = STRIP_BUILD.derive(source, ["postgres", "redis", "server"], "1.2.3", "server")
        rag = STRIP_BUILD.derive(
            source,
            ["redis", "qdrant", "ollama", "ollama-init", "rag"],
            "1.2.3",
            "rag",
        )
        rendered = STRIP_BUILD.yaml.safe_dump_all([server, rag])

        self.assertNotIn("placeholder", rendered)
        self.assertTrue(server["services"]["server"]["environment"]["JWT_SECRET"].startswith("${"))
        self.assertEqual(set(rag["services"]), {"redis", "qdrant", "ollama", "ollama-init", "rag"})
        self.assertEqual(set(rag["networks"]), {"backend", "egress"})
        self.assertTrue(
            rag["services"]["rag"]["environment"]["POSTGRES_URL"].startswith("${RAG_POSTGRES_URL:?")
        )


if __name__ == "__main__":
    unittest.main()
