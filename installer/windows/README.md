# Insight Hub — Windows installers

Builds **two** self-contained setup programs from one script:

| Setup | Size | Installs |
|---|---|---|
| **InsightHub-Server-Setup.exe** | 34.1 MB | server binary, web interface, `InsightHub` service |
| **InsightHub-Collector-Setup.exe** | 30.1 MB | collector binary, `InsightHubCollector1` service |

Install either on its own, or both on one machine **in any order**. They are
separate products — separate `AppId`s, separate entries in Apps & Features,
separate services — so uninstalling one leaves the other running.

Each asks **two questions**: where to install, and (server only) whether to create
a desktop shortcut. Everything else comes from `.env` files shipped inside the
package and editable afterwards.

## How the two fit together

**One top-level folder, a directory of its own for each.** The collector installs
*inside* the server's folder, in a `Collector\` subfolder — so everything lives
under one path, but neither installer overwrites the other's files and each
uninstaller removes only its own tree.

```
C:\Program Files\InsightHub\
├── bin\      insight-hub-server.exe
├── config\   server\.env   client\.env
├── data\     uploads\ backups\ temp\
├── logs\
├── scripts\  finalize-config.ps1
├── service\  InsightHub.exe + .xml
├── unins000.exe
│
└── Collector\                              <- the collector product
    ├── bin\      insight-hub-collector.exe
    ├── config\   collector1\.env
    ├── data\     temp\
    ├── logs\
    ├── scripts\  finalize-config.ps1  add-collector.ps1  remove-collector.ps1
    ├── service\  InsightHubCollector1.exe + .xml
    └── unins000.exe
```

The collector's directory page defaults to `Collector\` beneath **wherever the
server actually is**, read from the registry — so a server installed on `D:\`
keeps its collector beside it rather than stranding it under `C:\Program Files`.
Install the collector on a machine with no server and it defaults to
`C:\Program Files\InsightHub\Collector`.

**On one machine they still connect themselves**, by finding each other's
directory in the registry rather than by living side by side:

- Install the **collector second** and it reads the server's `COLLECTOR_SECRET`
  and `PORT`, then points itself at `http://127.0.0.1:<that port>`.
- Install the **server second** and it writes its generated secret into the
  collector's config and **restarts the collector service** — a collector left
  running with a stale secret is rejected 401 on every poll, forever, and reports
  nothing wrong anywhere you would think to look.

Either order works with no editing.

A collector aimed at a server on **another machine** is left strictly alone:
installing a server locally does not make this machine its owner, so neither its
`SERVER_URL` nor its secret is touched. The install log says so explicitly —
`left as-is - it is configured against http://…`.

### Connecting a collector on a *different* machine

A collector authenticates with `COLLECTOR_SECRET`, which must match the server's
**exactly**. With no server on the machine there is nothing to copy it from, so
the installer cannot invent one — it would produce a collector that polls, gets
401, and looks perfectly healthy from the outside.

Three ways to supply it, in order of how many machines you are deploying to:

1. **One machine** — install, then edit `config\collector1\.env`: set `SERVER_URL`
   to the server's address and paste `COLLECTOR_SECRET` from the server's
   `config\server\.env`. Then `net start InsightHubCollector1`. The
   installer tells you this on the final page and writes it to
   `logs\install-config.log`.
2. **Many machines** — put a **`collector-join.env`** next to
   `InsightHub-Collector-Setup.exe`:
   ```dotenv
   SERVER_URL=http://192.168.1.50:8080
   COLLECTOR_SECRET=<paste from the server's config\server\.env>
   ```
   Every collector install picks it up automatically, with no prompts and no
   editing. Combine with `/VERYSILENT` for unattended rollout. The file is read
   from the setup program's own folder and is never copied into the installation.
3. **Per customer** — pin both values in `config\collector.env` before compiling,
   and ship a package that needs no configuration at all.

The join file is ignored on a machine that also runs the server: that machine's
own secret is authoritative, and overwriting it would break every collector
already pointing at it.

Why the installer cannot just generate one: the secret has to match the server's
byte for byte. A generated value would produce a collector that starts, polls, is
rejected with 401, and looks perfectly healthy from the outside. So a collector
that cannot find a secret is left unconfigured and says so — on the final page,
and in `logs\install-config.log`.

---

## 1. Prerequisites (build machine only)

| Need | Why | Verify |
|---|---|---|
| **Node.js 20+** | builds the three packages | `node -v` |
| **Inno Setup 6.3+** | compiles the installer | `"C:\Program Files (x86)\Inno Setup 6\ISCC.exe"` |
| **WinSW-x64.exe** | wraps a console program as a Windows service | must be at `staging\service\WinSW.exe` |
| ~2 GB free RAM | the ultra64 compression pass | — |

6.3+ matters: the script uses the `x64compatible` architecture identifier, which
older versions reject.

WinSW is not in the repository and cannot be built. Download `WinSW-x64.exe` from
[github.com/winsw/winsw/releases](https://github.com/winsw/winsw/releases) — v2.x
needs .NET Framework 4.6.1, present on every Windows 10/11 — and save it as:

```
installer\windows\staging\service\WinSW.exe
```

## 2. Edit the shipped configuration

**Do this before compiling.** These files are baked into the package:

| File | Change |
|---|---|
| `config\server.env` | `DATABASE_URL` to the customer's PostgreSQL, and `SEED_ADMIN_PASSWORD` |
| `config\client.env` | branding and support links (optional) |
| `config\collector.env` | usually nothing |

Leave `JWT_SECRET`, `OIDC_ENCRYPTION_KEY` and `COLLECTOR_SECRET` as `CHANGE_ME`:
they are generated per machine at install time, so no two installations share a
secret. Pin a real value only if several nodes must share one.

## 3. Compile

```powershell
# from the repository root — binaries and both installers in one step
.\scripts\build-release.ps1 -Version 1.0.0
```

Or by hand:

```powershell
# a. the three builds
npm --prefix client    run build
npm --prefix server    run package:win
npm --prefix collector run package:win

# b. stage (the installers compile from staging\, not release\)
copy release\win\insight-hub-server.exe    installer\windows\staging\bin\
copy release\win\insight-hub-collector.exe installer\windows\staging\bin\

# c. compile the same script twice, once per edition
$iscc = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
& $iscc installer\windows\insight-hub.iss /DAppVersion=1.0.0 /DEdition=server
& $iscc installer\windows\insight-hub.iss /DAppVersion=1.0.0 /DEdition=collector
# -> release\win\InsightHub-Server-Setup.exe
#    release\win\InsightHub-Collector-Setup.exe
```

`/DEdition` is what selects the payload. Omit it and you get the server edition.
Everything the two packages share — compression, directory layout, the service
definition writer, the configuration script — is written once in the `.iss`, so
the two cannot drift apart.

Each compile takes a couple of minutes: solid `lzma2/ultra64` over a single Node
binary. Halve `LZMADictionarySize` in the `.iss` if the build machine is small.

Splitting into two packages costs a little total size — the shared Node runtime is
now compressed twice rather than once — but each customer downloads only what they
install: 34.1 MB for a server, 30.1 MB for a collector, instead of 39.8 MB either
way.

## 4. Sign before release

Sign both binaries **before** staging, then both finished installers. Unsigned,
SmartScreen warns every customer. See [packaging-design.md §11](../../docs/packaging-design.md).

---

## Installed layout

Both trees have the same shape, so there is one layout to learn:

| Folder | Server | Collector |
|---|---|---|
| `bin\` | `insight-hub-server.exe` | `insight-hub-collector.exe` |
| `config\` | `server\.env`, `client\.env` | `collector1\.env` (+ `collector2\`…) |
| `data\` | `uploads\ backups\ temp\` | `temp\` — scratch only; a collector persists nothing |
| `logs\` | service logs + `install-config.log` | same |
| `scripts\` | `finalize-config.ps1` | `finalize-config.ps1`, `add-collector.ps1`, `remove-collector.ps1` |
| `service\` | WinSW wrapper + generated `.xml` | one wrapper + `.xml` per instance |
| `unins000.exe` | uninstaller | uninstaller |

Every `.env` sits beside a pristine `.env.default` for diffing after an upgrade.
Nothing is written outside these folders except the service registrations and —
for the server only — one firewall rule. `config\`, `data\` and `logs\` are
created with **service-modify** permissions so the services keep working if later
re-pointed at a non-SYSTEM account.

## What happens during installation

1. Files are copied and this product's service definition is generated.
2. `finalize-config.ps1` runs:
   - resolves `__INSTALLDIR__` to the chosen folder;
   - **server:** generates `JWT_SECRET`, `OIDC_ENCRYPTION_KEY` and
     `COLLECTOR_SECRET`, opens the firewall for `PORT`, then looks up a collector
     installation in the registry and joins it — writing the secret in and
     restarting its service if the value changed;
   - **collector:** looks up a server installation and adopts its secret and port;
     failing that, applies a `collector-join.env`; failing that, leaves the secret
     unset and records it.
3. The service is registered and started.
4. **Server only:** setup then waits up to 45 s for `/api/v1/health` to answer. If
   it never does, you get a message naming `DATABASE_URL` as the usual cause and
   pointing at the error log — rather than a success page over a server that is
   not running.
5. On first start the server creates its database, applies migrations, seeds the
   first administrator, and begins serving the interface.

Step 2 is what makes the two packages order-independent. No database, account or
port questions — by design.

---

## After installation

### Editing configuration

Open the file in an editor **running as administrator** (Program Files is
protected), or use the Start-Menu shortcut *Edit … configuration*, then restart
that product's service:

```powershell
# server
notepad "C:\Program Files\InsightHub\config\server\.env"
net stop InsightHub & net start InsightHub

# collector
notepad "C:\Program Files\InsightHub\Collector\config\collector1\.env"
net stop InsightHubCollector1 & net start InsightHubCollector1
```

`DATABASE_URL` is the setting that most installations need to change, and the one
that stops the server starting when it is wrong.

Edits survive upgrades and uninstalls (`onlyifdoesntexist` + `uninsneveruninstall`).
After an upgrade, diff against the freshly written `.env.default` to see what is
new.

### The client configuration is real, not decorative

The interface is a compiled single-page application, so a `.env` next to it
cannot change anything by itself — Vite inlines build-time settings into the
JavaScript. Instead the server reads `config\client\.env` at startup and hands the
values to the browser as `window.__INSIGHT_HUB_CONFIG__`, injected before the app loads.

Two consequences: **never put a secret there** (it is public to anyone who opens
the page), and a key only changes behaviour once the interface reads it — unknown
keys are inert, not broken. The API address is deliberately not configurable, as
the interface is served from the server's own origin and always calls it
relatively.

### Adding and removing collectors

Ingestion scales by running more instances. Both scripts need an **elevated**
PowerShell, because they register and deregister Windows services.

```powershell
cd "C:\Program Files\InsightHub\Collector\scripts"

.\add-collector.ps1 -Instance 2                   # add
.\add-collector.ps1 -Instance 3 -Concurrency 5    # add, smaller batch size
.\add-collector.ps1 -Instance 4 -Port 3100        # add on a specific port

.\remove-collector.ps1 -Instance 3                # remove
.\remove-collector.ps1 -Instance 2 -KeepConfig    # remove, keep its .env
```

`add-collector.ps1` creates `config\collectorN\.env` (port `3000 + N`), copies the
WinSW wrapper, registers `InsightHubCollectorN`, starts it, then checks its
health endpoint — `lastPollOk: True` is what proves it reached the server.
`SERVER_URL` and `COLLECTOR_SECRET` are copied from instance 1;
`COLLECTOR_INSTANCE_ID` is deliberately **not**, since two instances sharing an
identity would appear to the server as one collector.

`remove-collector.ps1` stops the service, deregisters it, and deletes the wrapper,
its `.xml` and the config folder. Doing it by hand tends to leave the wrapper and
config behind, which is harmless but accumulates.

No server-side change is needed either way. Instances coordinate through the
server, each claiming a distinct batch of jobs under its own instance id, so two
collectors never process the same mailbox — and jobs held by a removed instance
are swept back to pending once its heartbeat goes silent, rather than lost.

**Instance 1 is refused by `remove-collector.ps1`**: it belongs to the installer.
To remove it, uninstall the collector product from Apps & Features, which removes
every instance including ones added later.

### One collector, one entry in the collector list

Each instance identifies itself as `<hostname>:<PORT>` — stable across restarts.
That identity used to include the process id, which meant every restart arrived
as a *new* collector: the interface showed the same machine several times over,
one entry alive and the rest stuck at **offline** until they aged out an hour
later. Override it with `COLLECTOR_INSTANCE_ID` in the `.env` only if two machines
could share a hostname.

An entry that stays `offline` now means what it says: that instance really has
stopped reporting.

To run collectors on a **different machine**, use
`InsightHub-Collector-Setup.exe` there — with a `collector-join.env` beside
it, or edit `SERVER_URL` and `COLLECTOR_SECRET` afterwards. `add-collector.ps1`
then adds further instances on that machine exactly as it does beside a server.


---

## Unattended installation

Every prompt has a switch, so nothing needs a human:

```powershell
# server
InsightHub-Server-Setup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART `
  /DIR="C:\Program Files\InsightHub" /TASKS="desktopicon" `
  /LOG="%TEMP%\insight-hub-server-install.log"

# collector - put collector-join.env beside the setup program first
InsightHub-Collector-Setup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART `
  /LOG="%TEMP%\insight-hub-collector-install.log"
```

Run both, in either order, for a single-machine install. Drop `/TASKS` to skip the
desktop shortcut. Suitable for GPO, SCCM or Intune; exit code 0 means files
installed and the service registered.

`/VERYSILENT` suppresses the warning about an unconfigured collector, so for silent
collector rollouts either use a join file or check `logs\install-config.log`
afterwards — it records `COLLECTOR_SECRET is UNSET` when the collector has no way
to reach its server.

## Verifying an installation

```powershell
Get-Service InsightHub, InsightHubCollector1     # Running
Invoke-RestMethod http://localhost:8080/api/v1/health          # status = healthy
Invoke-RestMethod http://127.0.0.1:3001/health                 # lastPollOk = True
Get-Content "C:\Program Files\InsightHub\logs\install-config.log"
Get-Content "C:\Program Files\InsightHub\Collector\logs\install-config.log"
```

`lastPollOk: True` is the one that matters — it proves the shared secret matched.
`False` with a 401 in `lastPollError` means the server and collector secrets have
drifted apart. Run only the collector checks on a collector-only machine.

To prove a service really is stopped, check the port rather than the browser: an
open tab keeps rendering the interface from memory long after the server has gone,
because it is a single-page application. `Ctrl+F5` is the only reload that proves
anything.

```powershell
Stop-Service InsightHub
Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue   # expect nothing
```

Note that the service is registered with a **restart-on-failure** action, so a
crash brings it back after 5 seconds. That is deliberate for production and
occasionally confusing while testing.

If a service will not start, its log is in `…\logs\`. The overwhelmingly common
cause is `DATABASE_URL`: the server exits when PostgreSQL is unreachable.

## Uninstalling

Two entries in Apps & Features, removed independently and in any order.

- **Server** — removes the `InsightHub` service, the firewall rule and the
  server binary, then asks whether to delete `config\`, `data\` and `logs\` from
  its own directory.
- **Collector** — removes every `InsightHubCollector*` service, including
  instances added later by `add-collector.ps1`, then asks about its own `config\`.

Because the two live in separate directories, uninstalling one cannot touch the
other's files. Neither touches the PostgreSQL database. The default answer is to
keep everything.
