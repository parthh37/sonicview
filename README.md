# SonicView

**A free, private, in-browser visualizer for SonicWall firewall settings exports (`.exp`).**

Drop in the `.exp` file you exported from a SonicWall and SonicView turns it into maps, tables and a
problem report you can actually read. The file is processed **entirely in your browser** — nothing is
uploaded anywhere.

**▶ Use it now: https://parthh37.github.io/sonicview/**

## Features

| Area | What you get |
| --- | --- |
| **Overview** | Model, firmware, and counts of everything in the file |
| **Network map** | WAN links, VPN peers, inside zones and routed networks, and which zones can reach which |
| **Port map** | Public IP → port → inside host graph for every port forward, with risky ports (RDP, SMB, SQL, Telnet…) flagged |
| **Rule problems** | Shadowed / duplicate rules, blocks that never fire, wide-open inbound rules, missing objects, forwards without an allow rule |
| **Unused objects** | Address and service objects nothing refers to |
| **IP map** | Per-subnet grid of used, DHCP, interface and free IPs |
| **Tables** | Port forwards, NAT, firewall rules, address & service objects, interfaces, routes, DHCP, VPN, users. All sortable, filterable, and exportable to CSV |
| **Search** | Find any IP, port number or name and see every rule, NAT policy and object that touches it |
| **Compare** | Diff two exports of the same firewall, or list what is missing on a replacement unit |
| **Migration guide** | Step-by-step checklist for moving to a new SonicWall, with a port-mapping plan |
| **Report** | Printable / PDF summary of risks and clean-up items |

Light and dark themes, deep links for every page, and no dependencies — it's one HTML file.

## Privacy

- Your `.exp` file is read with the browser's File API and **never leaves your computer**.
  There is no server, no analytics and no third-party script.
- Values that look like passwords, keys or secrets are hidden in the *All settings* view.
- So that links can open in new tabs, the loaded file is kept in this browser's `localStorage`.
  Use **Forget saved file** in the footer when you are done, especially on a shared computer.

> ⚠️ **Never commit or share a real `.exp` file.** It contains your network layout, rules and
> encrypted credentials. This repo's `.gitignore` blocks `*.exp` for that reason.

## How to get an `.exp` file

In the SonicWall web UI, use **Export Settings** — on SonicOS 5.x it is under **System → Settings**; on
6.x look under **Manage → Firmware & Settings**. SonicView reads the classic SonicOS `.exp` format
(tested with SonicOS 5.8 on an NSA 3500).

## Run it offline

1. Download [`sonicview-offline.zip`](https://parthh37.github.io/sonicview/sonicview-offline.zip)
   (or just save `sonicview.html`).
2. Open `sonicview.html` in any modern browser.
3. **Windows:** double-click `SonicView.bat` to open it in its own app window (Edge or Chrome).
   Run `Add Desktop Shortcut.bat` once to put a SonicView icon on your desktop.

## Development

Everything lives in [`sonicview.html`](sonicview.html): CSS, then the parser and model, then the views.

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765/sonicview.html. Every push to `main` deploys to GitHub Pages via
[`.github/workflows/pages.yml`](.github/workflows/pages.yml).

## Contributing

Issues and pull requests are welcome. Please **do not attach real `.exp` files** to issues. If a file
fails to parse, describe the SonicOS version and the error message, or share a heavily redacted
snippet.

## Disclaimer

SonicView reads a settings file only; it does not see live traffic. Check every finding before you
change a production firewall. SonicView is not affiliated with or endorsed by SonicWall Inc.
"SonicWall" and "SonicOS" are trademarks of their respective owner.

## License

[MIT](LICENSE)
