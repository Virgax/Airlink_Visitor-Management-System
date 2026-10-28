# Airlink Visitas — print agent (Zebra ZP450)

Small Node script that runs on the **reception PC** (Windows) where the Zebra ZP450 is plugged in by USB.
It polls the server every 3 s for badge jobs of its gate, sends the raw ZPL to the printer and acknowledges them.
No dependencies; Node 20 or newer.

Flow: kiosk prints → `POST /api/print/enqueue` (the ZPL is stored in the private bucket under
`s/<siteId>/print/<gateId>/`) → this agent `GET /api/print/jobs?gate=<gateId>` → prints → `DELETE …&job=<id>`.
Jobs survive restarts of the PC; nothing is lost if the printer is off, the agent retries in order.

## 1. Server side
1. In `/admin/sites/<site>` set the printer of the gate to **Agente de impresión** (name: the printer share name,
   informative). Copy the gate id from the URL of the kiosk device page or ask IT (`Gate.id`).
2. `PRINT_AGENT_SECRET`: on Railway (`web` service → Variables) or the value generated on first boot
   (`SystemSecret` table). Never paste it in chat or tickets; put it only in the agent's config file.

## 2. Windows setup (ZDesigner driver, raw pass-through)
1. Install the Zebra **ZDesigner ZP450** driver, plug the printer by USB, print the Windows test page once.
2. Printer properties → **Sharing** → "Share this printer", share name `ZP450` (no spaces).
3. Printer properties → **Advanced** → "Print directly to the printer" (optional, avoids spooler delays).
4. ZDesigner printing preferences → **Advanced / Options**: make sure "Use printer settings" is **off** and the driver
   passes raw data through (the agent sends ZPL, not Windows graphics). Labels are pre-cut with gaps: run the
   auto-calibration once per roll (hold feed until the label advances twice) so `^MNY` sensing is right.
5. Copy `tools/print-agent/` to `C:\AirlinkVisitas\print-agent\` and create `print-agent.json` next to `index.mjs`:
   ```json
   {
     "url": "https://visitas.airlinkdr.com",
     "gateId": "<gate id>",
     "secret": "<PRINT_AGENT_SECRET>",
     "printer": { "share": "ZP450" },
     "intervalMs": 3000
   }
   ```
6. Test the printer without the server: `node index.mjs --test` prints a test label. Then `node index.mjs --once`
   pulls pending jobs one time.
7. Run it at logon as a scheduled task (PowerShell as administrator):
   ```powershell
   $action  = New-ScheduledTaskAction -Execute "node.exe" -Argument "C:\AirlinkVisitas\print-agent\index.mjs" -WorkingDirectory "C:\AirlinkVisitas\print-agent"
   $trigger = New-ScheduledTaskTrigger -AtLogOn
   $settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650)
   Register-ScheduledTask -TaskName "Airlink Visitas print agent" -Action $action -Trigger $trigger -Settings $settings -RunLevel Limited
   ```
   Logs go to the task's console; to keep a file add `>> C:\AirlinkVisitas\print-agent\agent.log 2>&1` in a `.cmd`
   wrapper and point the task at it.

How it prints on Windows: `copy /b <job>.zpl \\localhost\ZP450`. The spooler forwards the bytes unchanged when the
printer is shared and the driver is in pass-through mode (`Out-Printer`/`print` would re-render the text).

## 3. Other connections
- Network print server or Ethernet Zebra: `"printer": { "host": "192.168.1.50", "port": 9100 }`.
- Linux (raw USB): `"printer": { "device": "/dev/usb/lp0" }` (add the user to the `lp` group).
- Environment variables override the file: `VISITAS_URL`, `PRINT_GATE_ID`, `PRINT_AGENT_SECRET`, `PRINT_SHARE`,
  `PRINT_HOST`, `PRINT_PORT`, `PRINT_DEVICE`, `PRINT_INTERVAL_MS`.
- `--dry-run` fetches and acknowledges nothing is printed (logs the job instead); useful to check the HMAC.

## 4. Fallback without the agent: Zebra Browser Print
Install Zebra Browser Print on the kiosk PC and set the gate's printer to **Zebra Browser Print** in `/admin/sites`.
The kiosk page then sends the ZPL to `http://localhost:9100/write` itself (the sign-in with PIN sets a cookie so the
Content-Security-Policy allows that origin only for that kiosk). Add the site origin to Browser Print's accepted list
when it asks. When a gate has no printer, "Imprimir gafete" downloads the `.zpl` file so it can be dropped on the
shared printer by hand.

## 5. Troubleshooting
- `401 bad_signature`: wrong secret or the URL path differs (the signature covers `METHOD\n/path?query\ntimestamp`).
- `401 clock_skew`: the PC clock is more than 5 minutes off; sync it.
- `404 unknown_gate`: the gate id is wrong or the gate is inactive.
- `503 print_not_configured`: the server has no bucket (S3 variables) — jobs cannot be queued.
- Nothing prints but jobs disappear: the share accepted the bytes; check the driver's pass-through mode and that
  the printer is in ZPL mode (hold feed at power-on to reset; the ZP450 autodetects ZPL/EPL).
