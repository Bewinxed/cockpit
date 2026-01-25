import { AgentDaemon } from '@agentdeck/agent';

interface AgentOptions {
  hub?: string;
  db: string;
  discovery: boolean;
}

export async function agent(options: AgentOptions) {
  // Environment variable fallback (CLI flag takes precedence)
  const hubUrl = options.hub || process.env.COCKPIT_HUB_URL;

  // Auto-disable discovery when explicit URL is provided
  const useDiscovery = hubUrl ? false : options.discovery;

  console.log('🤖 Starting Cockpit Agent...');
  console.log(`   Hub: ${hubUrl || 'auto-discover (mDNS)'}`);
  console.log(`   Discovery: ${useDiscovery ? 'enabled' : 'disabled'}`);
  console.log('');

  try {
    const daemon = new AgentDaemon({
      hubUrl,
      useDiscovery,
    });

    await daemon.start();

    console.log('✨ Agent is running');
    console.log('');
    console.log('Press Ctrl+C to stop');

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down agent...');
      await daemon.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await daemon.stop();
      process.exit(0);
    });
  } catch (error) {
    console.error('❌ Failed to start agent:', error);
    process.exit(1);
  }
}
