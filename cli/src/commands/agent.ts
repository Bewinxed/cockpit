import { AgentDaemon } from '@cockpit/agent-service';
import { createDb } from '@cockpit/db';

interface AgentOptions {
  hub?: string;
  db: string;
  discovery: boolean;
}

export async function agent(options: AgentOptions) {
  console.log('🤖 Starting Cockpit Agent...');
  console.log(`   Database: ${options.db}`);
  console.log(`   Hub: ${options.hub || 'auto-discover'}`);
  console.log(`   Discovery: ${options.discovery ? 'enabled' : 'disabled'}`);
  console.log('');

  try {
    const db = createDb(options.db);

    const daemon = new AgentDaemon({
      db,
      hubUrl: options.hub,
      enableDiscovery: options.discovery,
    });

    await daemon.start();

    console.log('✨ Agent is running');
    console.log('   Waiting for hub connection...');
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
