import importlib.util
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("update_manager", Path(__file__).parents[1] / "update-manager.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FakeManager(module.Manager):
    def __init__(self, directory, data, with_web=False):
        super().__init__(directory)
        self.private.mkdir(mode=0o700)
        self.shared.mkdir()
        self.data = data
        self.with_web = with_web
        self.commands = []
        self.images = {service: "sha256:" + "a" * 64 for service in module.SERVICES}
        self.fail_health = False

    def docker(self, *arguments, timeout=120):
        self.commands.append(arguments)
        if arguments[:2] == ("image", "inspect"):
            return json.dumps([{"RepoDigests": ["ghcr.io/rexsystems/azalea-server@sha256:" + "a" * 64, "ghcr.io/rexsystems/azalea-server-web@sha256:" + "a" * 64], "Config": {"Labels": {}}}])
        return ""

    def compose(self, *arguments, managed=True, timeout=120):
        self.commands.append(arguments)
        if arguments[:1] == ("up",) and self.override.exists():
            overrides = module.read_json(self.override)["services"]
            for service, config in overrides.items():
                self.images[service] = config["image"]
        return ""

    def configuration(self):
        services = {"azalea-server": {"image": "ghcr.io/rexsystems/azalea-server:latest"}}
        if self.with_web:
            services["azalea-server-web"] = {"image": "ghcr.io/rexsystems/azalea-server-web:latest"}
        return {"services": services}

    def container(self, service):
        return {"Image": self.images[service], "State": {"Running": True}, "Mounts": [{"Destination": "/data", "Type": "volume", "Source": str(self.data)}]}

    def health(self, services, timeout=90):
        if self.fail_health:
            self.fail_health = False
            with closing(sqlite3.connect(self.data / "azalea.db")) as connection, connection:
                connection.execute("INSERT INTO records VALUES('new-version-write')")
            raise RuntimeError("Health check failed")


class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="azalea-update-test-")
        self.root = Path(self.temporary.name)
        self.install = self.root / "install"
        self.install.mkdir()
        (self.install / "docker-compose.yml").write_text("services: {}\n")
        (self.install / ".env").write_text("AZALEA_JWT_SECRET=original\n")
        self.data = self.root / "data"
        self.data.mkdir()
        with closing(sqlite3.connect(self.data / "azalea.db")) as connection, connection:
            connection.execute("CREATE TABLE records(value TEXT)")
            connection.execute("INSERT INTO records VALUES('original')")
        self.registry = patch.object(module, "registry_digest", side_effect=lambda image: (image.split(":")[0] + "@sha256:" + "b" * 64, "sha256:" + "b" * 64))
        self.registry.start()

    def tearDown(self):
        self.registry.stop()
        self.temporary.cleanup()

    def test_cli_only_update_saves_backup_and_pins_reviewed_digest(self):
        manager = FakeManager(self.install, self.data)
        manager.check()
        self.assertTrue(manager.state["available"])
        self.assertTrue(manager.execute("apply", manager.state["check_id"]))
        self.assertTrue(manager.state["rollback_available"])
        self.assertEqual(set(module.read_json(manager.override)["services"]), {"azalea-server"})
        backup = manager.private / "backups" / manager.state["backup_id"]
        self.assertEqual((backup / "config-1").read_text(), "AZALEA_JWT_SECRET=original\n")
        self.assertTrue((backup / "azalea.db").is_file())

    def test_dashboard_failure_automatically_restores_database_and_images(self):
        manager = FakeManager(self.install, self.data, with_web=True)
        manager.check()
        manager.fail_health = True
        with patch.object(module.os, "chown"):
            self.assertFalse(manager.execute("apply", manager.state["check_id"]))
        self.assertEqual(manager.state["phase"], "failed")
        self.assertIn("previous installation was restored", manager.state["message"])
        self.assertTrue(all("azalea-rollback-" in value for value in manager.images.values()))
        with closing(sqlite3.connect(self.data / "azalea.db")) as connection:
            self.assertEqual(connection.execute("SELECT value FROM records").fetchall(), [("original",)])
        replaced = list((manager.private / "backups" / manager.state["backup_id"]).glob("replaced-*/azalea.db"))
        self.assertEqual(len(replaced), 1)
        with closing(sqlite3.connect(replaced[0])) as connection:
            self.assertIn(("new-version-write",), connection.execute("SELECT value FROM records").fetchall())

    def test_release_change_requires_review_and_never_stops_running_server(self):
        manager = FakeManager(self.install, self.data)
        manager.check()
        selection = manager.state["check_id"]
        with patch.object(module, "registry_digest", return_value=("ghcr.io/rexsystems/azalea-server@sha256:" + "c" * 64, "sha256:" + "c" * 64)):
            self.assertFalse(manager.execute("apply", selection))
        self.assertNotIn(("stop", "azalea-server"), manager.commands)
        self.assertIn("release changed", manager.state["message"])

    def test_manual_rollback_restores_configuration_and_preserves_replaced_files(self):
        manager = FakeManager(self.install, self.data)
        manager.check()
        self.assertTrue(manager.execute("apply", manager.state["check_id"]))
        (self.install / ".env").write_text("AZALEA_JWT_SECRET=changed\n")
        with patch.object(module.os, "chown"):
            self.assertTrue(manager.execute("rollback", manager.state["backup_id"]))
        self.assertEqual((self.install / ".env").read_text(), "AZALEA_JWT_SECRET=original\n")
        self.assertFalse(manager.state["rollback_available"])

    def test_installer_generates_optional_dashboard_and_custom_host_ports(self):
        source = (Path(__file__).parents[1] / "install.sh").read_text()
        functions = source[source.index("write_compose() {"):source.index("fetch_build_context() {")]
        for web in (0, 1):
            with tempfile.TemporaryDirectory(prefix="azalea-compose-test-") as directory:
                script = 'set -eu\nSERVER_IMAGE=ghcr.io/rexsystems/azalea-server:latest\nWEB_IMAGE=ghcr.io/rexsystems/azalea-server-web:latest\nweb_url=https://sync.example.com\n' + functions + f'\nwrite_compose "127.0.0.1:19500:9482" {web} "127.0.0.1:19501:80" image\n'
                subprocess.run(["bash"], input=script, text=True, cwd=directory, check=True)
                compose = (Path(directory) / "docker-compose.yml").read_text()
                self.assertIn("127.0.0.1:19500:9482", compose)
                self.assertEqual("  azalea-server-web:" in compose, bool(web))
                if web:
                    self.assertIn("127.0.0.1:19501:80", compose)

    def test_installer_preserves_existing_credentials_before_prompting(self):
        fake_bin = self.root / "bin"
        fake_bin.mkdir()
        docker = fake_bin / "docker"
        docker.write_text("#!/bin/sh\nexit 0\n")
        docker.chmod(0o700)
        result = subprocess.run(["bash", str(Path(__file__).parents[1] / "install.sh")], env={**os.environ, "PATH": f"{fake_bin}:{os.environ['PATH']}", "AZALEA_INSTALL_DIR": str(self.install)}, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("already contains an installation", result.stderr)
        self.assertEqual((self.install / ".env").read_text(), "AZALEA_JWT_SECRET=original\n")

    def test_installer_never_reports_success_when_admin_creation_or_verification_fails(self):
        source = (Path(__file__).parents[1] / "install.sh").read_text()
        helper = source[source.index("bootstrap_admin() {"):source.index("write_compose() {")]
        for mode, expected in (("fail", False), ("missing", False), ("disabled", False), ("admin", True)):
            script = "set -eu\nadmin_email=Admin@example.com\nadmin_pass=\"-password with spaces\"\ninstance=Test\ndie() { echo \"$1\" >&2; exit 1; }\nok() { echo VERIFIED; }\n" + helper + '\ndocker() {\n case "$*" in *bootstrap*) ' + ("return 1" if mode == "fail" else "return 0") + '\n ;; *) printf "id admin@example.com ' + ("admin pro active" if mode == "admin" else "admin pro disabled" if mode == "disabled" else "user free active") + '\\n" ;; esac\n}\nbootstrap_admin\n'
            result = subprocess.run(["bash"], input=script, text=True, capture_output=True)
            self.assertEqual(result.returncode == 0, expected, result.stderr)
            self.assertEqual("VERIFIED" in result.stdout, expected)

    def test_cloudflare_and_proxy_examples_target_optional_dashboard_or_api(self):
        source = (Path(__file__).parents[1] / "install.sh").read_text()
        block = source[source.index('if [[ "$access_mode" != "1" ]]; then\n  proxy_host_port='):source.index('progress "Pulling Docker images"')]
        for mode in ("1", "2", "3"):
            for web_port, expected in (("", "19500"), ("19501", "19501")):
                with tempfile.TemporaryDirectory(prefix="azalea-proxy-test-") as directory:
                    script = f'set -eu\naccess_mode={mode}\nweb_host_port="{web_port}"\napi_host_port=19500\ndomain=sync.example.com\nok() {{ :; }}\n' + block
                    subprocess.run(["bash"], input=script, text=True, cwd=directory, check=True)
                    file = Path(directory) / "cloudflared.example.yml"
                    if mode == "1":
                        self.assertFalse(file.exists())
                    else:
                        self.assertIn("hostname: sync.example.com", file.read_text())
                        self.assertIn(f"service: http://127.0.0.1:{expected}", file.read_text())
                        nginx = (Path(directory) / "nginx-host.example.conf").read_text()
                        self.assertIn(f"proxy_pass http://127.0.0.1:{expected}", nginx)
                        self.assertIn("proxy_buffering off", nginx)


if __name__ == "__main__":
    unittest.main()
