import { startHub } from '@cockpit/hub-server';

interface HubOptions {
  port: string;
  db: string;
  discovery: boolean;
}

export async function hub(options: HubOptions) {
  console.log('🚀 Starting Cockpit Hub...');

  try {
    const hubServer = await startHub({
      port: parseInt(options.port, 10),
      dbPath: options.db,
      enableDiscovery: options.discovery,
    });

    // Handle graceful shutdown
    const shutdown = () => {
      console.log('\n🛑 Shutting down hub...');
      hubServer.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error('❌ Failed to start hub:', error);
    process.exit(1);
  }
}
