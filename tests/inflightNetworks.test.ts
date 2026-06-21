import { expect, test } from "bun:test";
import { matchInflightCarrier } from "../web/src/backend/inflightNetworks.ts";

test("matches a JetBlue Fly-Fi (Viasat) egress IP", () => {
  // 70.41.103.0/24 is an announced Viasat (AS7155) prefix in the seed.
  const hit = matchInflightCarrier("70.41.103.42");
  expect(hit?.carrier.id).toBe("viasat");
});

test("matches inside a larger Viasat block (99.196.0.0/15)", () => {
  const hit = matchInflightCarrier("99.197.200.1");
  expect(hit?.carrier.id).toBe("viasat");
});

test("ignores an IPv4-mapped IPv6 form of a Viasat IP", () => {
  const hit = matchInflightCarrier("::ffff:70.41.103.42");
  expect(hit?.carrier.id).toBe("viasat");
});

test("does not match a normal ground ISP / cloud IP", () => {
  expect(matchInflightCarrier("8.8.8.8")).toBeNull();      // Google DNS
  expect(matchInflightCarrier("1.1.1.1")).toBeNull();      // Cloudflare
  expect(matchInflightCarrier("140.82.112.3")).toBeNull(); // GitHub
});

test("handles missing / malformed input safely", () => {
  expect(matchInflightCarrier(null)).toBeNull();
  expect(matchInflightCarrier(undefined)).toBeNull();
  expect(matchInflightCarrier("unknown")).toBeNull();
  expect(matchInflightCarrier("999.1.1.1")).toBeNull();
});
