# Daly BMS Monitor

[Русская версия](README.md)

A web app (PWA) for phone and desktop that reads a **Daly Smart BMS** with a Bluetooth module (device name `DL-…`) over Web Bluetooth and shows charge progress, cells, balancing and health checks. **Read-only: nothing is ever written to the BMS.**

**Open:** https://dropand.github.io/daly-bms-monitor/ in Chrome on Android, or Chrome/Edge on desktop.
**No BMS at hand?** Try the simulated demo: https://dropand.github.io/daly-bms-monitor/?demo (works in any browser).

> The interface is currently in Russian. English UI is not done yet; the charts, numbers and cell view are language-independent.

<p>
  <img src="docs/screenshot-mobile.png" alt="Mobile view (demo, simulated data)" width="260">
  <img src="docs/screenshot-desktop.png" alt="Desktop view (demo, simulated data)" width="520">
</p>

*Screenshots are taken in demo mode with simulated data.*

## What it shows
- an overall verdict (OK / attention / fault) and an estimate of the time to full charge;
- a charge chart: ideal curve vs. the real one (voltage and current);
- per-cell voltages, a heat map over time, balancing activity, cell spread;
- lifetime: cycle count, Ah in and out;
- checks: charge switch, charge interruption, protections, temperature, cell spread.

## How to use
1. Turn the BMS on (its display is lit) and close the Smart BMS app on your phone, since only one client can hold the Bluetooth connection.
2. Press **Connect BMS** and pick the `DL-…` device.
3. Set chemistry and capacity under "Settings and data" (used for the forecast and the ideal curve).
4. History is stored on your device (up to 48 h); you can export it as CSV.

## Limitations
- Needs Web Bluetooth: Chrome on Android, Chrome/Edge on desktop. **Safari and iOS are not supported** (Apple does not implement Web Bluetooth); the demo mode still works there.
- The page must stay open on screen: Chrome does not keep the BMS connection in the background.
- Limits (cell voltage, 0.1–0.3C charge current, charge curve) are typical values. Check them against your battery's datasheet.
- Protocol: open Daly UART (commands `0x90`–`0x98`); the protection bit layout was checked against the [dalybms](https://github.com/dreadnought/python-daly-bms) library.

## Optional cloud upload
Off by default. If you enable it, anonymous charge data (cell voltages, current, events, chemistry, capacity, a random session id) is sent to a Google Sheet. Device name, location and contacts are never sent. Setup of your own receiver: [cloud/README.md](cloud/README.md). Security notes: [SECURITY.md](SECURITY.md).

## Contributing
Bug reports are welcome, especially from other Daly models. Please include the model, firmware, browser and the Journal contents from the app.

License: MIT.
