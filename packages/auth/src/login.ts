/**
 * OAuth login flow orchestration
 * Uses manual code paste flow (standard for 3rd party OAuth)
 */

import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import {
  deleteCredentials,
  isAuthenticated,
  saveCredentials,
} from "./credentials";
import {
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  generateCodeChallenge,
  generateCodeVerifier,
} from "./oauth";

/**
 * Login options
 */
export interface LoginOptions {
  /** Open browser automatically (default: true) */
  openBrowser?: boolean;
  /** Show verbose output */
  verbose?: boolean;
}

/**
 * Login result
 */
export interface LoginResult {
  message: string;
  success: boolean;
}

/**
 * Prompt user to paste authorization code
 */
function promptForCode(): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question("Paste the authorization code here: ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Perform the OAuth login flow
 */
export async function login(options: LoginOptions = {}): Promise<LoginResult> {
  const { openBrowser = true, verbose = false } = options;

  // Check if already authenticated
  if (await isAuthenticated()) {
    return {
      success: true,
      message: "Already authenticated. Call logout() to sign out first.",
    };
  }

  // Generate PKCE parameters
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = randomBytes(32).toString("base64url");

  if (verbose) {
    console.log("Generated PKCE verifier and challenge");
  }

  // Build authorization URL
  const authUrl = buildAuthorizationUrl(codeChallenge, state);

  console.log("\n1. Open this URL in your browser:\n");
  console.log(`   ${authUrl}\n`);
  console.log("2. Sign in and authorize the application");
  console.log("3. Copy the code shown on the page\n");

  // Open browser if requested
  if (openBrowser) {
    try {
      await openUrl(authUrl);
      console.log("   (Browser opened automatically)\n");
    } catch {
      // Silently fail - user can open manually
    }
  }

  try {
    const code = await promptForCode();

    if (!code) {
      return {
        success: false,
        message: "No authorization code provided.",
      };
    }

    // Exchange code for tokens
    console.log("\nExchanging code for tokens...");
    const tokens = await exchangeCodeForTokens(code, codeVerifier);

    // Save credentials
    await saveCredentials(tokens);

    return {
      success: true,
      message: "Successfully authenticated with Claude!",
    };
  } catch (error) {
    return {
      success: false,
      message: `Authentication failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Logout and clear credentials
 */
export async function logout(): Promise<LoginResult> {
  if (!(await isAuthenticated())) {
    return {
      success: true,
      message: "Not currently authenticated.",
    };
  }

  await deleteCredentials();

  return {
    success: true,
    message: "Successfully logged out.",
  };
}

/**
 * Open URL in default browser
 */
async function openUrl(url: string): Promise<void> {
  const { platform } = process;

  let command: string;
  let args: string[];

  switch (platform) {
    case "darwin":
      command = "open";
      args = [url];
      break;
    case "win32":
      command = "cmd";
      args = ["/c", "start", "", url];
      break;
    default:
      // Linux and others
      command = "xdg-open";
      args = [url];
  }

  const proc = Bun.spawn([command, ...args], {
    stdout: "ignore",
    stderr: "ignore",
  });

  await proc.exited;
}
