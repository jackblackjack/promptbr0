# Installation & Setup

PromptBr0 can be used as a full desktop application with a visual UI, or as a standalone command-line interface (CLI) for shell pipelines.

---

## Desktop Application

PromptBr0 desktop is available for macOS, Windows, and Linux. The CLI is also cross-platform.

### macOS

Download the installer that matches your Mac from
[GitHub Releases](https://github.com/jackblackjack/promptbr0/releases),
open it, and move PromptBr0 to Applications.

> [!NOTE]
> **Local Network Permission Prompt**: On macOS, the first time you enable Multi-Device Sync, macOS may display a system dialog asking for **Local Network** access. Select **Allow** so local discovery and peer-to-peer sync can reach your other devices.

### Windows

Download the installer that matches your Windows device from
[GitHub Releases](https://github.com/jackblackjack/promptbr0/releases),
then run it.

### Linux

Download the AppImage or Debian package that matches your Linux device from
[GitHub Releases](https://github.com/jackblackjack/promptbr0/releases),
then install or run it using your distribution's normal method.

---

## Build from Source

To build PromptBr0 from a checkout, install **Node.js 22** and enable
**pnpm 11.7.0** through Corepack. Then clone the repository and build every
workspace package:

```bash
git clone https://github.com/jackblackjack/promptbr0.git
cd promptbr0
corepack enable
pnpm install
pnpm build
```

`pnpm build` builds the desktop app as well as the CLI. To run
the desktop app from the checkout, use:

```bash
pnpm dev
```

To build just the CLI, run:

```bash
pnpm --filter @promptbr0/cli build
```

The resulting Node entry point is `apps/cli/dist/index.js`.

---

## Command-Line Interface (CLI)

The CLI needs **Node.js 22** or later. It is built from this repository — the
npm packages are not published yet.

```bash
pnpm install
pnpm --filter @promptbr0/cli build
node apps/cli/dist/index.js db-path
```

The bundle is written to `apps/cli/dist/index.js`. To use the shorter
`promptbr0` command, put it on your `PATH`, for example:

```bash
mkdir -p ~/.local/bin
ln -sf "$PWD/apps/cli/dist/index.js" ~/.local/bin/promptbr0
chmod +x apps/cli/dist/index.js
```

Once set up, verify the installation by printing the resolved database path:

```bash
promptbr0 db-path
```

---

## Database Location & Environment Variables

Desktop App and CLI open the exact same SQLite database file by default.

### Default Database Paths by OS

| Operating System | Default Path |
| :--- | :--- |
| **macOS** | `~/Library/Application Support/PromptBr0/library.db` |
| **Linux** | `$XDG_CONFIG_HOME/promptbr0/library.db` (or `~/.config/promptbr0/library.db`) |
| **Windows** | `%APPDATA%\PromptBr0\library.db` |

### Overriding the Database Path (`PROMPTBR0_DB`)

You can point PromptBr0 to an alternate database file (for example, a separate personal or test library) by setting the `PROMPTBR0_DB` environment variable:

```bash
export PROMPTBR0_DB="/path/to/my-custom-library.db"
promptbr0 list
```


