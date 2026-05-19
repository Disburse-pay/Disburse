import { afterEach, describe, expect, it, vi } from "vitest";
import { getBetHref, getInitialPage, shouldRedirectLegacyBetRoute } from "./routing";

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

describe("bet routing", () => {
  it("keeps naked localhost on the query-param bet preview", () => {
    stubLocation({ hostname: "localhost" });

    expect(getBetHref("/")).toBe("/?bet=1");
    expect(getBetHref("/markets")).toBe("/markets?bet=1");
  });

  it("crosses from local app/docs subdomains to bet.localhost", () => {
    stubLocation({ hostname: "app.localhost" });

    expect(getBetHref("/")).toBe("http://bet.localhost:5173/");
    expect(getBetHref("/markets")).toBe("http://bet.localhost:5173/markets");

    stubLocation({ hostname: "docs.localhost" });

    expect(getBetHref("/markets/history")).toBe("http://bet.localhost:5173/markets/history");
  });

  it("uses relative paths inside the bet subdomain", () => {
    stubLocation({ hostname: "bet.localhost" });

    expect(getBetHref("/markets")).toBe("/markets");
  });

  it("crosses from the production app domain to the bet subdomain", () => {
    stubLocation({ hostname: "app.disburse.online", port: "", protocol: "https:" });

    expect(getBetHref("/")).toBe("https://bet.disburse.online/");

    stubLocation({ hostname: "app.disburse.online", pathname: "/markets", port: "", protocol: "https:" });

    expect(getInitialPage()).toBe("dashboard");
    expect(shouldRedirectLegacyBetRoute()).toBe(true);
    expect(getBetHref("/markets")).toBe("https://bet.disburse.online/markets");
  });
});
