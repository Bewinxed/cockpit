<script lang="ts">
  import '../app.css';
  import { page } from '$app/stores';

  interface Props {
    children: import('svelte').Snippet;
  }

  let { children }: Props = $props();

  const navItems = [
    { href: '/', label: 'Dashboard', icon: '◈' },
    { href: '/projects', label: 'Projects', icon: '◇' },
    { href: '/instances', label: 'Instances', icon: '○' },
    { href: '/agents', label: 'Agents', icon: '●' },
  ];
</script>

<div class="app">
  <aside class="sidebar">
    <div class="logo">
      <span class="logo-icon">✧</span>
      <span class="logo-text">Cockpit</span>
    </div>

    <nav class="nav">
      {#each navItems as item}
        <a
          href={item.href}
          class="nav-item"
          class:active={$page.url.pathname === item.href ||
            (item.href !== '/' && $page.url.pathname.startsWith(item.href))}
        >
          <span class="nav-icon">{item.icon}</span>
          <span class="nav-label">{item.label}</span>
        </a>
      {/each}
    </nav>

    <div class="sidebar-footer">
      <div class="connection-status">
        <span class="status-dot active"></span>
        <span>Connected</span>
      </div>
    </div>
  </aside>

  <main class="main">
    {@render children()}
  </main>
</div>

<style>
  .app {
    display: flex;
    min-height: 100vh;
  }

  .sidebar {
    width: 240px;
    background: var(--bg-2);
    border-right: 1px solid var(--ui-1);
    display: flex;
    flex-direction: column;
    padding: var(--space-5);
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) 0;
    margin-bottom: var(--space-6);
  }

  .logo-icon {
    font-size: 1.5rem;
    color: var(--primary);
  }

  .logo-text {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--tx-1);
  }

  .nav {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    flex: 1;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    color: var(--tx-2);
    font-size: 0.9375rem;
    font-weight: 500;
    transition: all var(--transition-fast);
  }

  .nav-item:hover {
    background: var(--bg-3);
    color: var(--tx-1);
  }

  .nav-item.active {
    background: var(--primary);
    color: white;
    box-shadow: var(--shadow-sm), 0 2px 8px rgba(67, 133, 190, 0.2);
  }

  .nav-icon {
    font-size: 1rem;
    width: 20px;
    text-align: center;
  }

  .sidebar-footer {
    padding-top: var(--space-4);
    border-top: 1px solid var(--ui-1);
  }

  .connection-status {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.8125rem;
    color: var(--green);
  }

  .main {
    flex: 1;
    margin-left: 240px;
    padding: var(--space-6);
    min-height: 100vh;
  }
</style>
