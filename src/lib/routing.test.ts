import { afterEach, describe, expect, it, vi } from "vitest";
import { getBridgeHref, getInitialPage, isBridgeSurface } from "./routing";

function stubLocation(input: {
  hostname: string;
  pathname?: string;
  search?: string;
  port?: string;
  protocol?: string;
}) {
  const pathname = input.pathname ?? "/";
  const search = input.search ?? "";
  const port = input.port ?? "5173";
  const protocol = input.protocol ?? "http:";
  vi.stubGlobal("window", {
    location: {
      hostname: input.hostname,
      pathname,
      search,
      port,
      protocol,
      hash: "",
      href: `${protocol}//${input.hostname}${port ? `:${port}` : ""}${pathname}${search}`
    }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("routing", () => {
  it("resolves docs, pay and app surfaces", () => {
    stubLocation({ hostname: "docs.localhost" });
    expect(getInitialPage()).toBe("docs");

    stubLocation({ hostname: "pay.localhost" });
    expect(getInitialPage()).toBe("pay");

    stubLocation({ hostname: "app.localhost", pathname: "/payments" });
    expect(getInitialPage()).toBe("payments");

    stubLocation({ hostname: "app.localhost", pathname: "/statements" });
    expect(getInitialPage()).toBe("statements");

    stubLocation({ hostname: "localhost", pathname: "/statements" });
    expect(getInitialPage()).toBe("statements");

    stubLocation({ hostname: "localhost", pathname: "/dashboard" });
    expect(getInitialPage()).toBe("dashboard");

    stubLocation({ hostname: "localhost", search: "?app=1" });
    expect(getInitialPage()).toBe("dashboard");
  });

  it("falls back to the dashboard for unknown app paths", () => {
    stubLocation({ hostname: "app.disburse.online", pathname: "/unknown", port: "", protocol: "https:" });
    expect(getInitialPage()).toBe("dashboard");

    stubLocation({ hostname: "app.disburse.online", pathname: "/settings", port: "", protocol: "https:" });
    expect(getInitialPage()).toBe("dashboard");
  });

  it("lands visitors without a product subdomain on the landing page", () => {
    stubLocation({ hostname: "disburse.online", port: "", protocol: "https:" });
    expect(getInitialPage()).toBe("landing");

    stubLocation({ hostname: "localhost" });
    expect(getInitialPage()).toBe("landing");
  });

  it("keeps the bridge on its own wallet surface", () => {
    stubLocation({ hostname: "bridge.disburse.online", port: "", protocol: "https:" });
    expect(isBridgeSurface()).toBe(true);
    expect(getBridgeHref()).toBe("/");

    stubLocation({ hostname: "localhost", search: "?bridge=1" });
    expect(isBridgeSurface()).toBe(true);
    expect(getBridgeHref()).toBe("/bridge");

    stubLocation({ hostname: "localhost", pathname: "/bridge" });
    expect(isBridgeSurface()).toBe(true);
    expect(getBridgeHref()).toBe("/bridge");

    stubLocation({
      hostname: "app.disburse.online",
      pathname: "/bridge",
      port: "",
      protocol: "https:"
    });
    expect(isBridgeSurface()).toBe(true);
    expect(getBridgeHref()).toBe("/bridge");

    stubLocation({ hostname: "www.disburse.online", port: "", protocol: "https:" });
    expect(getBridgeHref()).toBe("https://app.disburse.online/bridge");
  });
});
