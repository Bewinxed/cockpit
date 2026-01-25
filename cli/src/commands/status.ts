import { getTailscaleStatus, getTailscaleIp } from '@agentdeck/core/utils';

export async function status() {
  console.log('📊 Cockpit Status\n');

  // Check Tailscale
  try {
    const tailscaleIp = await getTailscaleIp();
    console.log('✅ Tailscale');
    console.log(`   IP: ${tailscaleIp}`);

    const status = await getTailscaleStatus();
    if (status) {
      console.log(`   Hostname: ${status.Self.HostName}`);
      console.log(`   Online: ${status.Self.Online}`);

      const onlinePeers = Object.values(status.Peer || {}).filter(p => p.Online);
      console.log(`   Peers online: ${onlinePeers.length}`);
    }
  } catch (error) {
    console.log('❌ Tailscale: not connected');
  }

  console.log('');

  // TODO: Check for running hub/agent
  console.log('💡 Run "agentdeck hub" to start a hub');
  console.log('💡 Run "agentdeck agent" to start an agent');
}
