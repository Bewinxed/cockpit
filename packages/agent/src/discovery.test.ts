import { describe, expect, test } from "bun:test";
import { rediscoverHub } from "./discovery";

/**
 * `rediscoverHub` never touches the real network or `CONFIG_PATH` in a test:
 * every rung it calls is injected, so these prove the ladder's shape — which
 * rung wins, and that a repin only ever happens on a hit — without a socket
 * or a file.
 */
describe("rediscoverHub", () => {
  test("the URL moved: nothing cached, mDNS finds the new one, it gets repinned", async () => {
    const repinned: string[] = [];
    const winner = await rediscoverHub({
      readCachedHubUrl: async () => undefined,
      browseMdns: async () => ["http://10.0.0.9:3456"],
      tailscaleCandidates: async () => [],
      probe: async (url) => url === "http://10.0.0.9:3456",
      repin: async (url) => {
        repinned.push(url);
      },
    });

    expect(winner).toBe("http://10.0.0.9:3456");
    expect(repinned).toEqual(["http://10.0.0.9:3456"]);
  });

  test("the URL moved across machines: mDNS finds nothing, the tailscale walk does", async () => {
    const repinned: string[] = [];
    const winner = await rediscoverHub({
      readCachedHubUrl: async () => "http://old-host:3456",
      browseMdns: async () => [],
      tailscaleCandidates: async () => [
        { ip: "http://100.64.0.5:3456", host: "new-host" },
      ],
      probe: async (url) => url === "http://100.64.0.5:3456",
      repin: async (url) => {
        repinned.push(url);
      },
    });

    expect(winner).toBe("http://100.64.0.5:3456");
    expect(repinned).toEqual(["http://100.64.0.5:3456"]);
  });

  test("the cached URL still answers: it wins outright, without touching mDNS or tailscale results", async () => {
    let mdnsCalled = false;
    let tailscaleCalled = false;
    const repinned: string[] = [];
    const winner = await rediscoverHub({
      readCachedHubUrl: async () => "http://10.0.0.2:3456",
      browseMdns: async () => {
        mdnsCalled = true;
        return [];
      },
      tailscaleCandidates: async () => {
        tailscaleCalled = true;
        return [];
      },
      probe: async (url) => url === "http://10.0.0.2:3456",
      repin: async (url) => {
        repinned.push(url);
      },
    });

    expect(winner).toBe("http://10.0.0.2:3456");
    expect(repinned).toEqual(["http://10.0.0.2:3456"]);
    // The cached rung answered, so the ladder stops — mDNS and tailscale
    // never even run.
    expect(mdnsCalled).toBe(false);
    expect(tailscaleCalled).toBe(false);
  });

  test("nothing answers anywhere: no repin, and the caller is told plainly", async () => {
    const repinned: string[] = [];
    const winner = await rediscoverHub({
      readCachedHubUrl: async () => "http://old-host:3456",
      browseMdns: async () => ["http://10.0.0.9:3456"],
      tailscaleCandidates: async () => [
        { ip: "http://100.64.0.5:3456", host: "new-host" },
      ],
      probe: async () => false,
      repin: async (url) => {
        repinned.push(url);
      },
    });

    expect(winner).toBeUndefined();
    expect(repinned).toEqual([]);
  });
});
