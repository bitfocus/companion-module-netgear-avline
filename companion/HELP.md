## Netgear AVLine

Control Netgear AVLine AV-over-IP network switches (M4250, M4300, M4350, M4500).

## Configuration

- Enter the switch's management IP and username in the module settings
- The password is stored as a secret and entered separately from the rest of the config
- The connection to the switch's REST API expects the switch's `admin` account. Other
  account may be able to log in, but will not be able to run any of the actions.

## Actions

- Set POE — enable, disable, or toggle POE on one or more ports. Ports are given as a port
  (`7`), a range (`2-7`), several of either (`12-27, 31-33`), or `all`
- Power Cycle POE — as above, for power-cycling POE on a set of ports
- Set Port Enabled — enable, disable, or toggle a physical port
- Set Port VLAN — put a port on a VLAN: untagged (and set as the port's own VLAN), tagged,
  the port's own VLAN only, or remove it from the VLAN
- Save Configuration — copy the running configuration to the startup configuration, so that
  changes made by this module (and elsewhere) survive a reboot
- Reboot Switch — restart the switch, optionally saving the configuration first

## Feedback

- POE Enabled
- Port Enabled
- Port VLAN
- Link Status

## Variables

- active_ports, total_ports
- cpu_usage, memory_usage
- uptime, last_reboot
- device_name, model, serial_number, firmware_version
- fan_state
- poe_budget, poe_total_consumption, poe_main_status, poe_power_management_mode, poe_ports

_Per Port Variables_

- description, is_poe, admin_mode, access_vlan
- speed, vlans
- rx_mbps, tx_mbps, rx_bytes, tx_bytes
- poe_status, poe_current_power
- lldp_system_name, lldp_port_id, lldp_port_description, lldp_chassis_id

_Per Sensor Variables_

- temperature_\<n\>, temperature_\<n\>_state

_Per SFP Module Variables_

- sfp_\<port\>_temperature, sfp_\<port\>_voltage, sfp_\<port\>_current
- sfp_\<port\>_input_power, sfp_\<port\>_output_power
- sfp_\<port\>_loss_of_signal, sfp_\<port\>_tx_fault, sfp_\<port\>_fault_status
- sfp_\<port\>_vendor, sfp_\<port\>_part_number, sfp_\<port\>_serial_number

## Presets

- POE and Link Status buttons, one per port
- Port Status: a text header per port, followed by read-outs (speed, bandwidth, VLAN,
  LLDP neighbour, POE draw) and an Enable/Disable button
- Switch Status: a text header, followed by read-outs (model, uptime, CPU, memory, active
  ports, POE consumption, temperature) and a Save Configuration button
- SFP Modules: a text header per transceiver, followed by temperature, power, and signal
  read-outs

See the [Changelog](./CHANGELOG.md) for what changed in each release.
