import { login as performLogin, isAuthenticated, getCredentialsPath } from '@cockpit/auth';

interface LoginOptions {
  browser: boolean;
  verbose: boolean;
}

export async function login(options: LoginOptions) {
  console.log('🔐 Claude MAX Authentication\n');

  // Check if already authenticated
  if (await isAuthenticated()) {
    console.log('✓ Already authenticated!');
    console.log(`  Credentials: ${getCredentialsPath()}`);
    console.log('\nUse "cockpit logout" to sign out.');
    return;
  }

  const result = await performLogin({
    openBrowser: options.browser,
    verbose: options.verbose,
  });

  if (result.success) {
    console.log(`\n✓ ${result.message}`);
    console.log(`  Credentials saved to: ${getCredentialsPath()}`);
  } else {
    console.error(`\n✗ ${result.message}`);
    process.exit(1);
  }
}
