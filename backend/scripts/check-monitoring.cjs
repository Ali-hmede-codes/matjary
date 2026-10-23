const os = require('node:os');
const net = require('node:net');

function validateMonitoringHost(
  address,
  platform = process.platform,
  interfaces = os.networkInterfaces(),
) {
  if (platform !== 'linux')
    throw new Error('Full VPS monitoring requires a Linux host.');
  if (typeof address !== 'string' || net.isIP(address) !== 4)
    throw new Error(
      'Set MONITORING_HOST_ADDRESS to the private Docker bridge gateway.',
    );
  const parts = address.split('.').map(Number);
  const privateIp =
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
  const dockerBridge = Object.entries(interfaces).some(
    ([name, values]) =>
      /^(docker0|br-[a-f0-9]+)$/.test(name) &&
      values?.some((item) => item.address === address && !item.internal),
  );
  if (!privateIp || !dockerBridge)
    throw new Error(
      'Monitoring must bind to an existing private Docker bridge, not a public interface.',
    );
}

module.exports = { validateMonitoringHost };
if (require.main === module) {
  try {
    validateMonitoringHost(process.env.MONITORING_HOST_ADDRESS);
    console.log('Private Linux monitoring interface validated.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
