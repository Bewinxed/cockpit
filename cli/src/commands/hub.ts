import { startHub } from '@cockpit/hub-server';
import { createDb } from '@cockpit/db';

interface HubOptions {
  port: string;
  db: string;
  discovery: boolean;
}

export async function hub(options: HubOptions) {
  console.log('🚀 Starting Cockpit Hub...');
  console.log(`   Port: ${options.port}`);
  console.log(`   Database: ${options.db}`);
  console.log(`   Discovery: ${options.discovery ? 'enabled' : 'disabled'}`);
  console.log('');

  try {
    const db = createDb(options.db);

    await startHub({
      port: parseInt(options.port, 10),
      db,
      enableDiscovery: options.discovery,
    });

    console.log(`✨ Hub is running at http://localhost:${options.port}`);
    console.log('   Dashboard: http://localhost:' + options.port);
    console.log('   API: http://localhost:' + options.port + '/api');
    console.log('');
    console.log('Press Ctrl+C to stop');
  } catch (error) {
    console.error('❌ Failed to start hub:', error);
    process.exit(1);
  }
}
