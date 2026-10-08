#!/usr/bin/env python3
import argparse
from contextlib import closing
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.request
import uuid

SERVICES = ("azalea-server", "azalea-server-web")
TERMINAL = ("idle", "succeeded", "failed")


def write_json(path, value, mode=0o600):
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}")
    with temporary.open("x") as file:
        os.chmod(temporary, mode)
        json.dump(value, file)
        file.flush()
        os.fsync(file.fileno())
    os.replace(temporary, path)
    descriptor = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def read_json(path, fallback=None):
    if not path.exists():
        return fallback
    if path.stat().st_size > 1024 * 1024:
        raise RuntimeError("Update state is too large.")
    return json.loads(path.read_text())


def run(arguments, directory, timeout=120):
    result = subprocess.run(arguments, cwd=directory, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f"{' '.join(arguments[:3])} failed. See the Docker/service logs on the host.")
    return result.stdout.strip()


def registry_digest(image):
    match = re.fullmatch(r"ghcr\.io/([a-z0-9._/-]+):([a-zA-Z0-9._-]+)", image)
    if not match:
        raise RuntimeError("Managed updates require tagged GHCR images. Pinned or locally built images use manual updates.")
    repository, tag = match.groups()
    token_url = f"https://ghcr.io/token?service=ghcr.io&scope=repository:{repository}:pull"
    with urllib.request.urlopen(token_url, timeout=20) as response:
        token = json.load(response)["token"]
    request = urllib.request.Request(f"https://ghcr.io/v2/{repository}/manifests/{tag}", method="HEAD", headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
    })
    with urllib.request.urlopen(request, timeout=20) as response:
        digest = response.headers.get("Docker-Content-Digest", "")
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
        raise RuntimeError("The image registry returned an invalid release digest.")
    return f"ghcr.io/{repository}@{digest}", digest


class Manager:
    def __init__(self, directory, compose_file=None, extra_files=(), project_name=None):
        self.directory = Path(directory).resolve()
        if self.directory == Path("/"):
            raise RuntimeError("Choose the specific Azalea installation directory.")
        if compose_file:
            self.base = Path(compose_file).resolve()
        else:
            self.base = next((self.directory / name for name in ("compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml") if (self.directory / name).is_file()), None)
        if not self.base or not self.base.is_file() or self.base.parent != self.directory:
            raise RuntimeError("No Compose file found in this installation directory.")
        self.files = [self.base]
        for name in ("compose.override.yaml", "compose.override.yml", "docker-compose.override.yml", "docker-compose.override.yaml"):
            candidate = self.directory / name
            if candidate.exists():
                self.files.append(candidate)
                break
        for name in extra_files:
            file = Path(name).resolve()
            if not file.is_file():
                raise RuntimeError("An extra Compose file does not exist.")
            if file not in self.files:
                self.files.append(file)
        self.project_name = project_name
        self.shared = self.directory / ".azalea-updates"
        self.private = self.directory / ".azalea-update-manager"
        if self.private.is_symlink() or self.shared.is_symlink():
            raise RuntimeError("Update state directories must not be symlinks.")
        if self.private.exists() and os.geteuid() == 0 and self.private.stat().st_uid != 0:
            raise RuntimeError("The update manager's private directory must be owned by root.")
        self.bridge = self.directory / "azalea-updater.compose.json"
        self.override = self.private / "images.compose.json"
        self.state = read_json(self.private / "state.json", {}) or {}
        self.lock = threading.RLock()

    def docker(self, *arguments, timeout=120):
        return run(["docker", *arguments], self.directory, timeout)

    def compose(self, *arguments, managed=True, timeout=120):
        files = self.files + ([self.bridge] if self.bridge.exists() else [])
        if managed and self.override.exists():
            files.append(self.override)
        flags = [argument for file in files for argument in ("-f", str(file))]
        project = ["-p", self.project_name] if self.project_name else []
        return self.docker("compose", *project, *flags, *arguments, timeout=timeout)

    def publish(self, **changes):
        with self.lock:
            self.state.update(changes)
            write_json(self.private / "state.json", self.state)
            public = {key: value for key, value in self.state.items() if key not in ("recovery", "targets")}
            public["heartbeat"] = int(time.time())
            write_json(self.shared / "status.json", public, 0o644)

    def container(self, service):
        identifier = self.compose("ps", "-a", "-q", service)
        if not identifier or "\n" in identifier:
            raise RuntimeError(f"Expected one installed {service} container.")
        return json.loads(self.docker("inspect", identifier))[0]

    def configuration(self):
        config = json.loads(self.compose("config", "--format", "json", managed=False))
        return config

    def check(self):
        self.publish(phase="checking", message="Checking published server and dashboard images…")
        config = self.configuration()
        images, targets = [], {}
        for service in SERVICES:
            if service not in config["services"]:
                continue
            try:
                container = self.container(service)
            except RuntimeError:
                if service == "azalea-server-web":
                    continue
                raise
            if service == "azalea-server-web" and not container.get("State", {}).get("Running"):
                continue
            definition = config["services"][service]
            if definition.get("build"):
                raise RuntimeError("This installation builds images locally. Update its sources and rebuild with Docker Compose.")
            configured = definition.get("image", "")
            target, digest = registry_digest(configured)
            details = json.loads(self.docker("image", "inspect", container["Image"]))[0]
            labels = details.get("Config", {}).get("Labels") or {}
            repository = target.split("@")[0]
            current_digest = next((value.split("@", 1)[1] for value in details.get("RepoDigests", []) if value.startswith(repository + "@")), "")
            available = digest != current_digest
            targets[service] = target
            images.append({"service": service, "image": configured, "current_digest": current_digest or container["Image"], "latest_digest": digest,
                           "revision": labels.get("org.opencontainers.image.revision", ""), "version": labels.get("org.opencontainers.image.version", ""), "available": available})
        check_id = hashlib.sha256(json.dumps(targets, sort_keys=True).encode()).hexdigest()
        self.publish(images=images, targets=targets, check_id=check_id, available=any(image["available"] for image in images),
                     last_checked=int(time.time()), phase="idle", message="Update available." if any(image["available"] for image in images) else "This installation is up to date.")

    def health(self, services, timeout=90):
        deadline = time.monotonic() + timeout
        local_http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        while time.monotonic() < deadline:
            healthy = True
            for service in services:
                try:
                    container = self.container(service)
                    if not container.get("State", {}).get("Running"):
                        healthy = False
                        break
                    addresses = [network[key] for network in container["NetworkSettings"]["Networks"].values() for key in ("IPAddress", "GlobalIPv6Address") if network.get(key)]
                    if not addresses and container.get("HostConfig", {}).get("NetworkMode") == "host":
                        addresses = ["127.0.0.1", "::1"]
                    port, route = (9482, "/v1/health") if service == "azalea-server" else (80, "/login")
                    reached = False
                    for address in addresses:
                        try:
                            host = f"[{address}]" if ":" in address else address
                            with local_http.open(f"http://{host}:{port}{route}", timeout=3) as response:
                                reached = response.status == 200 and (service != "azalea-server" or json.load(response).get("ok") is True)
                            if reached:
                                break
                        except (OSError, ValueError):
                            pass
                    if not reached:
                        healthy = False
                        break
                except (RuntimeError, ValueError, KeyError):
                    healthy = False
                    break
            if healthy:
                return
            time.sleep(2)
        raise RuntimeError("The updated services did not pass their health checks.")

    def backup(self, services):
        container = self.container("azalea-server")
        mount = next((mount for mount in container["Mounts"] if mount["Destination"] == "/data"), None)
        if not mount or mount["Type"] not in ("volume", "bind"):
            raise RuntimeError("The server needs a persistent /data volume for backup and rollback.")
        data = Path(mount["Source"]).resolve()
        database = data / "azalea.db"
        if data in (Path("/"), self.directory) or not database.is_file() or database.is_symlink():
            raise RuntimeError("Cannot locate the installation's SQLite database safely.")
        backup_id = uuid.uuid4().hex
        folder = self.private / "backups" / backup_id
        folder.mkdir(parents=True, mode=0o700)
        metadata = database.stat()
        images = {}
        for service in services:
            image = self.container(service)["Image"]
            tag = f"azalea-rollback-{service}:{backup_id}"
            self.docker("image", "tag", image, tag)
            images[service] = tag
        self.publish(phase="backing_up", message="Stopping the API and saving the database and configuration…",
                     recovery={"backup_id": None, "services": services})
        self.compose("stop", "azalea-server")
        with closing(sqlite3.connect(f"{database.as_uri()}?mode=ro", uri=True)) as source, closing(sqlite3.connect(folder / "azalea.db")) as destination:
            source.backup(destination)
            if destination.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise RuntimeError("The database backup failed its integrity check.")
        with (folder / "azalea.db").open("rb") as file:
            os.fsync(file.fileno())
        saved_files = []
        for index, file in enumerate([*self.files, self.directory / ".env"]):
            if file.is_file():
                saved = f"config-{index}"
                shutil.copy2(file, folder / saved)
                os.chmod(folder / saved, 0o600)
                with (folder / saved).open("rb") as copied:
                    os.fsync(copied.fileno())
                saved_files.append({"path": str(file), "saved": saved})
        manifest = {"id": backup_id, "created_at": int(time.time()), "images": images, "database": str(database),
                    "uid": metadata.st_uid, "gid": metadata.st_gid, "mode": metadata.st_mode & 0o777, "files": saved_files}
        write_json(folder / "manifest.json", manifest)
        self.publish(backup_id=backup_id, backup_created_at=manifest["created_at"], rollback_available=True,
                     recovery={"backup_id": backup_id, "services": services})
        return backup_id

    def restore(self, backup_id):
        if not re.fullmatch(r"[a-f0-9]{32}", backup_id):
            raise RuntimeError("Invalid rollback backup.")
        folder = self.private / "backups" / backup_id
        manifest = read_json(folder / "manifest.json")
        if not manifest or manifest["id"] != backup_id:
            raise RuntimeError("The rollback backup is missing.")
        services = list(manifest["images"])
        self.publish(phase="rolling_back", message="Restoring the previous images, database and configuration…", recovery={"backup_id": backup_id, "services": services})
        self.compose("stop", "azalea-server")
        failed = folder / f"replaced-{uuid.uuid4().hex}"
        failed.mkdir(mode=0o700)
        database = Path(manifest["database"])
        temporary = database.with_name(f".azalea-restore-{uuid.uuid4().hex}.db")
        shutil.copy2(folder / "azalea.db", temporary)
        os.chown(temporary, manifest["uid"], manifest["gid"])
        os.chmod(temporary, manifest["mode"])
        for file in (database, database.with_name("azalea.db-wal"), database.with_name("azalea.db-shm")):
            if file.exists():
                shutil.copy2(file, failed / file.name)
        for file in (database.with_name("azalea.db-wal"), database.with_name("azalea.db-shm")):
            if file.exists():
                file.unlink()
        os.replace(temporary, database)
        for entry in manifest["files"]:
            original = Path(entry["path"])
            if original.exists():
                shutil.copy2(original, failed / entry["saved"])
            shutil.copy2(folder / entry["saved"], original)
        write_json(self.override, {"services": {service: {"image": image, "pull_policy": "never"} for service, image in manifest["images"].items()}})
        self.compose("up", "-d", "--no-deps", *services, timeout=300)
        self.health(services)
        self.publish(recovery=None, rollback_available=False, available=False, check_id=None, last_checked=None, targets={}, images=[], phase="succeeded", message="Previous images, database and configuration restored.")

    def apply(self, selection):
        if selection != self.state.get("check_id") or not self.state.get("available"):
            raise RuntimeError("Check for updates and review the target release first.")
        self.check()
        if selection != self.state.get("check_id"):
            raise RuntimeError("The published release changed. Review it before updating.")
        targets = dict(self.state["targets"])
        self.publish(phase="pulling", message="Downloading the checked image digests…")
        for image in targets.values():
            self.docker("pull", image, timeout=600)
        self.backup(list(targets))
        self.publish(phase="restarting", message="Starting the updated services…")
        write_json(self.override, {"services": {service: {"image": image, "pull_policy": "never"} for service, image in targets.items()}})
        self.compose("up", "-d", "--no-deps", *targets, timeout=300)
        self.publish(phase="verifying", message="Waiting for server and optional dashboard health checks…")
        self.health(list(targets))
        installed = []
        for image in self.state.get("images", []):
            details = json.loads(self.docker("image", "inspect", targets[image["service"]]))[0]
            labels = details.get("Config", {}).get("Labels") or {}
            installed.append({**image, "current_digest": image["latest_digest"], "available": False,
                              "revision": labels.get("org.opencontainers.image.revision", ""), "version": labels.get("org.opencontainers.image.version", "")})
        self.publish(recovery=None, images=installed, phase="succeeded", available=False, message="Update completed. The previous installation is available for rollback.")

    def execute(self, action, selection=None, operation_id=None):
        self.publish(operation_id=operation_id or uuid.uuid4().hex)
        try:
            if action == "check":
                self.check()
            elif action == "apply":
                self.apply(selection)
            elif action == "rollback" and self.state.get("rollback_available") and selection == self.state.get("backup_id"):
                self.restore(selection)
            else:
                raise RuntimeError("This update action is unavailable. Refresh the status first.")
        except Exception as error:
            message = str(error) if isinstance(error, RuntimeError) else f"{type(error).__name__}: operation failed; inspect the host service logs."
            recovery = self.state.get("recovery")
            if recovery:
                try:
                    if recovery.get("backup_id"):
                        self.restore(recovery["backup_id"])
                    else:
                        self.compose("up", "-d", "--no-deps", *recovery["services"], timeout=300)
                        self.health(recovery["services"])
                        self.publish(recovery=None)
                    message += " The previous installation was restored."
                except Exception:
                    message += " Automatic recovery failed. Use the host CLI and preserved backup to recover."
            self.publish(phase="failed", message=message)
            print(message, file=sys.stderr, flush=True)
            return False
        return True

    def heartbeat(self, stopped):
        while not stopped.wait(5):
            self.publish()

    def serve(self):
        self.private.mkdir(mode=0o700, exist_ok=True)
        with (self.private / "manager.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            stopped = threading.Event()
            worker = threading.Thread(target=self.heartbeat, args=(stopped,), daemon=True)
            worker.start()
            try:
                recovery = self.state.get("recovery")
                if recovery:
                    if recovery.get("backup_id"):
                        self.restore(recovery["backup_id"])
                    else:
                        self.compose("up", "-d", "--no-deps", *recovery["services"], timeout=300)
                        self.health(recovery["services"])
                        self.publish(recovery=None)
                self.publish(phase="idle", message="Host update manager connected.")
                next_check = 0
                while True:
                    request_file = self.shared / "request.json"
                    if request_file.exists():
                        try:
                            request = read_json(request_file)
                        except (ValueError, OSError, RuntimeError):
                            if time.time() - request_file.stat().st_mtime > 10:
                                request_file.unlink()
                                self.publish(phase="failed", message="An incomplete update request was discarded. Try again.")
                            time.sleep(1)
                            continue
                        request_file.unlink()
                        valid = isinstance(request, dict) and re.fullmatch(r"[a-f0-9-]{32,36}", str(request.get("id", ""))) and isinstance(request.get("issued_at"), int) and 0 <= time.time() - request["issued_at"] <= 300
                        if valid:
                            self.execute(request.get("action"), request.get("selection"), request["id"])
                            next_check = time.monotonic() + 6 * 3600
                        else:
                            self.publish(phase="failed", message="An invalid or expired update request was discarded.")
                    elif time.monotonic() >= next_check:
                        self.execute("check")
                        next_check = time.monotonic() + 6 * 3600
                    time.sleep(1)
            finally:
                stopped.set()
                worker.join(timeout=6)

    def install(self):
        if os.geteuid() != 0:
            raise RuntimeError("Install the host update manager with sudo/root.")
        config = self.configuration()
        if "azalea-server" not in config["services"]:
            raise RuntimeError("This Compose installation has no azalea-server service.")
        container = self.container("azalea-server")
        configured_files = (container.get("Config", {}).get("Labels") or {}).get("com.docker.compose.project.config_files", "")
        known_files = set(self.files + [self.bridge, self.override])
        if any(Path(name).resolve() not in known_files for name in configured_files.split(",") if name):
            raise RuntimeError("This installation uses additional Compose files. Include each with --extra-compose-file when enabling the manager.")
        self.private.mkdir(mode=0o700, exist_ok=True)
        os.chown(self.private, 0, 0)
        os.chmod(self.private, 0o700)
        server_gid = int(self.compose("exec", "-T", "azalea-server", "id", "-g"))
        self.shared.mkdir(mode=0o770, exist_ok=True)
        os.chown(self.shared, 0, server_gid)
        os.chmod(self.shared, 0o770)
        write_json(self.bridge, {"services": {"azalea-server": {"environment": {"AZALEA_UPDATE_DIR": "/updates"}, "volumes": [{"type": "bind", "source": str(self.shared), "target": "/updates"}]}}}, 0o644)
        script = self.private / "update-manager.py"
        if Path(__file__).resolve() != script.resolve():
            shutil.copy2(Path(__file__).resolve(), script)
        os.chmod(script, 0o700)
        service_name = "azalea-updater-" + hashlib.sha256(str(self.directory).encode()).hexdigest()[:12]
        unit = Path("/etc/systemd/system") / f"{service_name}.service"
        quoted_directory = json.dumps(str(self.directory)).replace("%", "%%")
        quoted_script = json.dumps(str(script)).replace("%", "%%")
        quoted_compose = json.dumps(str(self.base)).replace("%", "%%")
        extra_flags = "".join(" --extra-compose-file " + json.dumps(str(file)).replace("%", "%%") for file in self.files[1:])
        project_flag = " --project-name " + json.dumps(self.project_name).replace("%", "%%") if self.project_name else ""
        unit.write_text(f"[Unit]\nDescription=Azalea host update manager\nAfter=docker.service network-online.target\nWants=network-online.target\nRequires=docker.service\n\n[Service]\nType=simple\nExecStart=/usr/bin/python3 {quoted_script} --directory {quoted_directory} --compose-file {quoted_compose}{extra_flags}{project_flag} serve\nRestart=on-failure\nRestartSec=5\nUMask=0077\n\n[Install]\nWantedBy=multi-user.target\n")
        self.compose("up", "-d", "--no-deps", "azalea-server", timeout=300)
        run(["systemctl", "daemon-reload"], self.directory)
        run(["systemctl", "enable", "--now", service_name], self.directory)
        print(f"Host update manager enabled: {service_name}\nDashboard is optional. CLI: docker compose exec azalea-server azalea-server update status")


def main():
    parser = argparse.ArgumentParser(description="Azalea host update manager (Linux Docker Compose; dashboard optional)")
    parser.add_argument("--directory", default=".", help="Azalea Compose installation directory")
    parser.add_argument("--compose-file", help="Explicit base Compose file in that directory")
    parser.add_argument("--extra-compose-file", action="append", default=[], help="Additional existing Compose override file (repeatable)")
    parser.add_argument("--project-name", help="Existing Docker Compose project name, if set explicitly")
    parser.add_argument("command", choices=("install", "serve", "status", "check", "apply", "rollback"))
    args = parser.parse_args()
    manager = Manager(args.directory, args.compose_file, args.extra_compose_file, args.project_name)
    if args.command == "install":
        manager.install()
    elif args.command == "serve":
        manager.serve()
    elif args.command == "status":
        print(json.dumps(read_json(manager.shared / "status.json", {}), indent=2))
    else:
        if not manager.shared.exists():
            raise RuntimeError("Enable the host update manager first with the install command.")
        status = read_json(manager.shared / "status.json", {})
        if time.time() - status.get("heartbeat", 0) > 45:
            raise RuntimeError("The host update manager is offline.")
        selection = status.get("check_id") if args.command == "apply" else status.get("backup_id") if args.command == "rollback" else None
        request = {"id": str(uuid.uuid4()), "issued_at": int(time.time()), "action": args.command, "selection": selection, "requested_by": "host-cli"}
        with (manager.shared / "request.json").open("x") as file:
            json.dump(request, file)
        print(f"Queued {args.command}: {request['id']}. Follow progress with the status command or dashboard.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
