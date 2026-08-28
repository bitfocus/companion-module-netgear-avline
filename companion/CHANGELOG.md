# Changelog

## v2.0.0

- Changed
  - Rewritten in TypeScript
  - Improved response validation, timeouts, and automatic re-login on an expired or rejected token
  - Connection failures now are reported and recover properly after the switch reboots
  - The password field moved from plaintext to a secret value
  - Set POE and Power Cycle POE now take a port specification (a port, a range, several of
    either, or `all`) instead of a single port number
  - Actions run by an account without write privilege now log a clear explanation
  - Port fields are validated against the number of ports the switch actually reports
- Added
  - Actions: Set Port Enabled, Save Configuration, Reboot Switch (now with an option to save
    configuration first)
  - Feedback: Port Enabled, Port VLAN, POE Delivering Power, POE Fault, SFP Fault
  - Variables: device name, model, serial number, firmware version, total ports, fan state, POE consumption and usage threshold, per-port description, POE
    capability, admin mode, access VLAN, link status, RX/TX bandwidth and byte counters,
    switch-wide RX/TX byte counters, per-port POE enabled state and power limit, LLDP neighbor
    info, per-sensor temperature, and per-SFP-module diagnostics
  - Presets: per-port and switch-wide status read-outs, grouped under text headers, plus
    presets for the new port-enable, VLAN, and save/reboot actions
- Fixed
  - Port Enabled and Port VLAN feedbacks now refresh when the port configuration changes on the
    switch itself, instead of only after the module writes to a port

## v1.2.3

- Fixed
  - Rework switch communication to prevent lag / crashes on control plane

## v1.2.2

- Fixed
  - Update module dependencies with security fixes

## v1.2.1

- Fixed
  - Better error logging to help with troubleshooting

## v1.2.0

- Added
  - New variable for port VLANS

## v1.1.0

- Added
  - New variables for POE status, POE power draw, and negotiated port speed

## v1.0.0

- Initial release
