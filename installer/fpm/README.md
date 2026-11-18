# Insight Hub — native Linux packages (FPM)

Two packages, each built as both `.deb` and `.rpm` from one staging tree:

| Package | Installs |
|---|---|
| `insight-hub-server` | server binary, web interface, `insight-hub.service` |
| `insight-hub-collector` | collector binary, `insight-hub-collector@.service` |

Install either alone or both on one machine, **in any order** — they find each
other and join automatically.

```bash
sudo apt install ./insight-hub-server_1.0.0-1_amd64.deb
sudo dnf install ./insight-hub-server-1.0.0-1.x86_64.rpm
```

Nothing is asked. The package manager handles install, upgrade, removal,
dependency checking and integrity verification.

---

## Why native packages, and not a self-extracting installer

A makeself `.run` installer lived here briefly. It mirrored the Windows layout
under `/opt/insight-hub`, which was tidy for anyone who knew the Windows
side — and wrong for everyone else. It was removed rather than maintained
alongside this, because the two shared ~400 lines of near-identical logic and a
fix applied to one would silently miss the other.

What the package manager does that a shell installer has to reimplement:

| | shell installer | `.deb` / `.rpm` |
|---|---|---|
| Upgrade | re-run and hope | `apt upgrade` / `dnf update` |
| Removal | hand-written `uninstall.sh` | `apt purge` / `dnf remove` |
| Config preservation | "write only if absent" | dpkg conffiles / rpm `%config(noreplace)` |
| Inventory | none | `dpkg -L`, `rpm -qa` |
| Tamper check | none | `rpm -V` |
| Dependencies | a README asking nicely | declared and enforced |
| Repo hosting | no | apt/dnf repositories |

The one thing lost is distro independence: `.deb` + `.rpm` covers
Debian/Ubuntu/RHEL/Fedora/Rocky/Alma/SUSE, but not Arch, Alpine or Gentoo. If
that ever matters, the right answer is another fpm target (`-t pacman`,
`-t apk`), not a second hand-written installer.

`installer/windows/insight-hub.iss` is the true analogue of this
directory: one payload description, compiled per role, with install-time work in
maintainer scripts rather than Inno's `[Code]` section.

## Installed layout

```
/usr/bin/insight-hub-server                     root:root 0755
/usr/bin/insight-hub-collector
/usr/lib/insight-hub/server/finalize-config.sh
/usr/lib/insight-hub/collector/{finalize-config,add-collector,remove-collector}.sh
/usr/lib/systemd/system/insight-hub.service
/usr/lib/systemd/system/insight-hub-collector@.service
/etc/insight-hub/                               root:email-intel 0750
├── server/.env          package config file           0640
├── server/secrets.env   generated, NOT packaged       0640
├── client/.env          package config file           0644  ← served to browsers
├── collector1/.env      package config file           0640
└── collector1/secrets.env
/var/lib/insight-hub/{uploads,backups,temp}     email-intel 0750
/var/log/insight-hub/                           email-intel 0750
```

`email-intel` is a system account with `nologin` and no home directory, shared by
both packages. It is created by whichever installs first and removed only when
the last one is purged.

## The one design decision worth understanding

**Generated secrets do not live in `.env`.**

`JWT_SECRET`, `OIDC_ENCRYPTION_KEY` and `COLLECTOR_SECRET` are generated per
machine into `secrets.env`, which the unit loads with `EnvironmentFile=`. Values
there win over `.env`, because `dotenv` does not override variables already
present in the environment — verified, not assumed.

Two problems this avoids:

1. **Upgrade prompts.** If the post-install script wrote into `.env`, dpkg would
   compute a different checksum than the one it shipped and every future upgrade
   would stop to ask *"Configuration file '/etc/…' has been modified. Keep or
   replace?"* — about a change the installer itself made. With the split, `.env`
   stays byte-identical to the packaged file. This is verified in the build:
   the `.env` SHA-256 is unchanged after `finalize-config.sh` runs.
2. **Resurrected keys.** `secrets.env` is not a package file, so purging really
   removes it and a reinstall generates fresh values instead of reviving an old
   `OIDC_ENCRYPTION_KEY` that no longer decrypts anything.

The cost is that configuration lives in two files. The `.env` says so at the top,
and `secrets.env` explains itself in its own header.

## Upgrades

```bash
sudo apt install ./insight-hub-server_1.1.0-1_amd64.deb
```

The post-install script detects an upgrade (dpkg passes the old version; rpm
passes `2`) and uses `try-restart`, so a service that was stopped stays stopped.
For the collector it restarts **every** instance — the binary changed under all
of them, not just instance 1.

Your `.env` edits survive. Secrets survive. Data survives.

## Removal

```bash
sudo apt remove insight-hub-server    # keeps config, secrets and data
sudo apt purge  insight-hub-server    # removes config and secrets
sudo dnf remove insight-hub-server    # rpm has no remove/purge split
```

`/var/lib/insight-hub` is **never** deleted, on any path. Following
postgresql-common, removing a package does not destroy accumulated uploads and
backups — the scripts print where the data is and leave the decision to you. The
PostgreSQL database is never touched either.

The two packages are independent: removing the server leaves a collector
running, and vice versa.

## Scaling collectors

```bash
sudo /usr/lib/insight-hub/collector/add-collector.sh 2
sudo /usr/lib/insight-hub/collector/add-collector.sh 3 --concurrency 5
sudo /usr/lib/insight-hub/collector/remove-collector.sh 2
```

The unit is a systemd **template**, so instance *N* simply *is*
`insight-hub-collector@N`, reading `/etc/insight-hub/collectorN/`
and listening on port `3000 + N`. One packaged unit file serves every instance —
no new files, and the package never changes.

`SERVER_URL` and `COLLECTOR_SECRET` are copied from instance 1;
`COLLECTOR_INSTANCE_ID` deliberately is **not** — it defaults to
`<hostname>:<PORT>`, so each instance identifies itself distinctly and keeps that
identity across restarts. Copying it would give two collectors one identity and
they would overwrite each other's heartbeat.

Instances 2..N are not package files. They survive upgrades untouched, and the
pre-remove script disables every one of them so systemd is never left trying to
start a unit whose binary has just been deleted.

## Connecting a collector to a server elsewhere

`COLLECTOR_SECRET` must match the server's exactly. With no server on the machine
there is nothing to copy it from, and the installer will not invent one — a
fabricated value produces a collector that polls, is rejected 401, and looks
perfectly healthy from outside.

Put a join file in place **before** installing:

```bash
sudo mkdir -p /etc/insight-hub
sudo tee /etc/insight-hub/collector-join.env <<'EOF'
SERVER_URL=http://192.168.1.50:8080
COLLECTOR_SECRET=<paste from the server's /etc/insight-hub/server/secrets.env>
EOF
sudo apt install ./insight-hub-collector_1.0.0-1_amd64.deb
```

A collector already aimed at a **remote** server is never touched by a later
local server install — installing a server here does not make this machine its
owner. The log says so: `left as-is - it is configured against http://…`.

## Building

```bash
./scripts/build-release-fpm.sh --version 1.0.0
```

| Need | Why |
|---|---|
| Node.js 20+ | builds the three packages |
| `fpm` | `gem install fpm` (needs Ruby) |
| `dpkg-deb` | `.deb` targets — `apt install dpkg-dev` |
| `rpmbuild` | `.rpm` targets — `apt install rpm` / `dnf install rpm-build` |
| Linux host | fpm shells out to both; it does not cross-build from Windows |

The **binaries** cross-build anywhere, Windows included, since `argon2` was
replaced with `hash-wasm`. Only the packaging step is Linux-only, so a two-host
split works:

```bash
# on Windows — produces genuine ELF x86-64 executables
./scripts/build-release-fpm.sh --binaries-only

# on Linux, after copying release/linux/ across
./scripts/build-release-fpm.sh --version 1.0.0 --skip-build
```

Use `--deb-only` or `--rpm-only` when only one toolchain is available.

## Verifying a package before installing it

```bash
dpkg-deb -c insight-hub-server_1.0.0-1_amd64.deb   # file list and modes
dpkg-deb -I insight-hub-server_1.0.0-1_amd64.deb   # metadata + maintainer scripts
rpm -qlp    insight-hub-server-1.0.0-1.x86_64.rpm
rpm -qp --scripts insight-hub-server-1.0.0-1.x86_64.rpm
```

Worth doing at least once: the maintainer scripts run as root, and these commands
show exactly what will run.

## Verifying an installation

```bash
systemctl is-active insight-hub 'insight-hub-collector@1'
curl -s http://localhost:8080/api/v1/health
curl -s http://127.0.0.1:3001/health
sudo cat /var/log/insight-hub/install-config.log
rpm -V insight-hub-server        # rpm only: what has changed since install
```

`lastPollOk: true` is the one that matters — it proves the shared secret matched.
`false` with a 401 in `lastPollError` means the two have drifted apart.

If the server will not stay up, it is almost always `DATABASE_URL`: the process
exits when PostgreSQL is unreachable. The post-install script already gates on
the health endpoint and says so rather than reporting success over a dead
service. `journalctl -u insight-hub -n 50` shows the reason.

## Signing

Unsigned packages install with a warning and cannot be served from a repository
that clients verify. Before publishing:

```bash
dpkg-sig --sign builder *.deb
rpm --addsign *.rpm
```
