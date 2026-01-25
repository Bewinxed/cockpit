import { logout as performLogout, isAuthenticated } from '@agentdeck/auth';

export async function logout() {
  console.log('🔓 Logging out...\n');

  if (!(await isAuthenticated())) {
    console.log('Not currently logged in.');
    return;
  }

  const result = await performLogout();

  if (result.success) {
    console.log(`✓ ${result.message}`);
  } else {
    console.error(`✗ ${result.message}`);
    process.exit(1);
  }
}
