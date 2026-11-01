# Security Policy

> PromptBr0 is built to protect valuable prompt libraries, provider
> credentials, and the decisions people make with them. We welcome careful,
> good-faith security research that helps us keep those boundaries strong.

## Supported Versions

PromptBr0 is currently pre-1.0. Security fixes are provided for the latest
`0.1.x` release published on GitHub Releases.

| Version | Supported | Security updates |
| ------- | :-------: | ---------------- |
| 0.1.x   | ✅        | Active           |
| < 0.1   | ❌        | Not supported    |

Supported builds are the official installers for the released version — macOS
DMG, Windows installer, Linux AppImage and `.deb` — plus the CLI built from
the released commit. Untagged builds, forks, modified distributions, and the
`@promptbr0/*` npm packages (not published yet) are not supported releases,
though reports are welcome when the issue also affects a supported release.

macOS release artifacts are Developer ID-signed, notarized, and stapled. An
installer that fails Gatekeeper verification, or that is not attached to the
official release page, should be reported rather than run.

## Security Model

PromptBr0 is local-first. Knowing the intended boundaries separates a
vulnerability from expected behavior:

- **No PromptBr0 service.** There is no account system, hosted backend, or
  telemetry. The app talks to the configured AI providers, `models.dev` for
  the model catalog, GitHub Releases for update checks, and paired devices on
  the local network.
- **Library data is not encrypted at rest.** Prompts, versions, branches,
  notes, ratings, and run history live in a plain SQLite database owned by the
  local user. Only provider API keys are encrypted, using Electron
  `safeStorage` (the OS keychain), and they are decrypted inside the main
  process at execution time.
- **Sync has no server.** Devices pair over the local network using
  self-signed TLS. Each side pins the other's certificate fingerprint, the
  pairing code is derived from the accepting device's certificate fingerprint,
  and records merge deterministically with a hybrid logical clock. Synced
  records never pass through a third party.
- **Agents propose; humans approve.** The CLI can read the library and write
  runs, notes, and pending suggestion rows. A suggestion must never become a
  visible version or the current version without a human approving it in the
  app.
- **The renderer is untrusted.** It runs sandboxed with context isolation and
  a Content Security Policy, has no Node.js access, and every
  renderer-to-main call is validated against Zod schemas in the main process.

The desktop app and CLI share one database file, so both entry points are part
of the same trust boundary for local library data.

## Scope and Security Priorities

This policy covers the PromptBr0 monorepo: the desktop app, core library, AI
integrations, CLI, and peer-to-peer sync.

We are especially interested in vulnerabilities that could cause:

- Unauthorized access to, modification of, or deletion of a user's prompts,
  versions, notes, evaluations, or run history.
- Exposure of provider API keys, pairing secrets, or other sensitive material
  across process, storage, logging, import/export, or sync boundaries.
- A renderer-to-main-process escape, IPC validation bypass, arbitrary code
  execution, or unintended local file or command access.
- Bypass of the "agents propose, humans approve" boundary, including pending
  suggestions leaking into listings, search results, or the current-version
  pointer.
- Peer identity, certificate-pinning, pairing, or merge-integrity failures in
  multi-device sync that expose or corrupt library data.
- A sync listener that accepts unpaired peers or is exposed beyond the local
  network without the user's action.
- Deep-link (`promptbr0://`) handling that lets untrusted input reach
  privileged code or file access.
- Supply-chain or release-packaging compromises affecting distributed
  PromptBr0 artifacts.

Severity is assessed from demonstrated exploitability, required privileges and
user interaction, affected data, deployment reachability, and impact — not from
a scanner score alone.

## Reporting a Vulnerability

**Do not open a public issue, discussion, or pull request for a suspected
vulnerability.**

Submit the report privately through
[GitHub Security Advisories](https://github.com/jackblackjack/promptbr0/security/advisories/new).

Please submit one vulnerability per report unless multiple issues must be
combined to demonstrate impact.

A useful report includes:

- The affected component and version or commit, the operating system and CPU
  architecture, and how PromptBr0 was installed.
- Whether the issue involves the desktop app, the CLI, or both.
- For sync findings: the number of devices, their operating systems, and the
  stage where the problem occurs (discovery, pairing, or an established
  session).
- A concise description of the vulnerability, a realistic attack scenario, and
  the security impact.
- Reproduction steps and a minimal proof of concept, including prerequisite
  permissions or user interaction.
- Relevant logs, screenshots, or suggested remediation.

The version is shown in Settings → About; the CLI reports it with
`promptbr0 --version`. Remove API keys, prompt contents, device certificates,
personal data, access tokens, and unrelated secrets from all submitted
evidence.

## What to Expect

| Milestone | Target |
| --------- | ------ |
| Acknowledgment | Within 3 business days |
| Initial validation and severity assessment | Within 7 business days |
| Progress updates for an accepted report | At least every 7 days |
| Coordinated disclosure | After a fix or agreed mitigation is available |

If a report is declined, duplicate, or determined not to cross a security
boundary, we will provide a brief explanation. Remediation timing depends on
severity, complexity, release coordination, and risk to users.

## Coordinated Disclosure

For an accepted vulnerability, we will work with you on validation,
remediation, and a responsible disclosure timeline. When appropriate, we will
publish a GitHub Security Advisory, request a CVE, and credit the reporter.
Tell us if you prefer to remain anonymous.

Please keep the report confidential until we publish an advisory or agree in
writing that disclosure is appropriate.

## Research Guidelines and Safe Harbor

- Test only with accounts, devices, libraries, and data you own or have
  explicit permission to use.
- For sync research, pair only devices you own or administer. Do not attempt
  discovery or pairing against other people's devices or networks.
- Use the minimum interaction necessary to demonstrate the vulnerability.
- Do not persist access, exfiltrate data, disrupt availability, exhaust
  third-party AI provider credits, perform high-volume automated testing, or
  use social engineering.
- Stop immediately if you encounter another person's data, credentials, or
  private content.
- Follow applicable law and give us reasonable time to investigate and
  remediate before disclosure.

To the extent we control the matter, research performed in good faith and in
accordance with this policy will be considered authorized, and we will not
initiate legal action against the researcher. This safe harbor cannot bind
third parties.

## Generally Out of Scope

The following are generally not eligible unless they demonstrate a concrete,
previously unknown security impact:

- Reading or altering the SQLite database, WAL/SHM files, backups, or exported
  JSON through the user's own filesystem permissions — the library is
  intentionally not encrypted at rest.
- API-key exposure that requires an already-compromised OS account or
  keychain.
- Prompt injection, jailbreaks, or model output quality, unless they cross
  another boundary such as achieving code execution or modifying library
  data.
- How a third-party AI provider stores or processes prompts; that is governed
  by the provider's own policy.
- Findings against development builds, including the local `postinstall` patch
  that renames the dev Electron bundle and intentionally breaks its signature.
- Scanner output without a reproducible exploit path or meaningful impact.
- Vulnerable dependencies without evidence that the behavior is reachable.
- Self-XSS requiring users to paste code into developer tools or a terminal.
- Social engineering, phishing, physical attacks, denial-of-service testing,
  or high-volume load testing.
- Findings requiring an already-compromised operating system or unrestricted
  administrator access without crossing an additional security boundary.
- Missing best-practice headers with no demonstrated security consequence.
- Issues limited to unsupported versions, forks, or modified builds.

These exclusions do not override a demonstrated boundary crossing, privilege
increase, sensitive-data exposure, or realistic attack chain.

## Recognition and Rewards

We appreciate responsible vulnerability research. PromptBr0 does not
currently operate a paid bug-bounty program, and this policy does not promise
financial compensation.
