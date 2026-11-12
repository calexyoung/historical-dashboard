import { describe, expect, it } from "vitest";
import { siteAddress } from "./address";

describe("the site's own address, from the Host a reader named", () => {
  it("is https for any name but this machine's own", () => {
    expect(siteAddress("mydashboards.co", null, "/macro-atlas")).toBe("https://mydashboards.co/macro-atlas");
    expect(siteAddress("MyDashboards.co", "http", "/macro-atlas")).toBe("https://mydashboards.co/macro-atlas");
    expect(siteAddress("localhost:3000", null, "/macro-atlas")).toBe("http://localhost:3000/macro-atlas");
    expect(siteAddress("127.0.0.1:3000", "https", "/macro-atlas")).toBe("https://127.0.0.1:3000/macro-atlas");
    expect(siteAddress("[::1]:3000", null, "/macro-atlas-staging")).toBe("http://[::1]:3000/macro-atlas-staging");
  });

  it.each([null, "", 'evil.example"><script>alert(1)</script>', "a b", "evil.example/path", "evil.example\\@x", "user@evil.example", "evil.example:99999999", "x\ny", "evil.example?x=1", "`rm`", "[not-an-address]"])(
    "a Host that is not a host (%s) gives an address with no host in it",
    (host) => {
      expect(siteAddress(host, null, "/macro-atlas")).toBe("/macro-atlas");
    },
  );
});
