// Unit tests for Model.js — the pure parsing layer.
//
// Model.js is deliberately free of QML imports and carries a `module.exports`
// guard, so the parsing that drives the panel can be exercised in plain node
// without a running shell. Fixtures are synthetic; no real tailnet data.
//
//   node test/model-test.js

const fs = require("fs")
const path = require("path")
const M = require("../Model.js")

const FIXTURES = path.join(__dirname, "fixtures")
const statusRaw = fs.readFileSync(path.join(FIXTURES, "status.json"), "utf8")
const accountsRaw = fs.readFileSync(path.join(FIXTURES, "accounts.json"), "utf8")

let passed = 0
const failures = []

function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    passed++
  } else {
    failures.push(`${name}\n    expected: ${e}\n    actual:   ${a}`)
  }
}

function ok(name, value) {
  check(name, value === true, true)
}

// --- string helpers ---------------------------------------------------------

check("cleanDnsName strips the trailing dot", M.cleanDnsName("host.example.ts.net."), "host.example.ts.net")
check("cleanDnsName leaves a clean name alone", M.cleanDnsName("host.example.ts.net"), "host.example.ts.net")
check("cleanDnsName on empty", M.cleanDnsName(undefined), "")
check("shortDnsName takes the first label", M.shortDnsName("host.example.ts.net."), "host")
check("displayHostName prefers the host name", M.displayHostName("beacon", "beacon.example.ts.net."), "beacon")
check("displayHostName falls back past localhost", M.displayHostName("localhost", "edge-node.example.ts.net."), "edge-node")
check("displayHostName with nothing usable", M.displayHostName("", ""), "Unknown")

// --- IP filtering -----------------------------------------------------------

check("filterIPv4 keeps only the 100.x CGNAT range",
  M.filterIPv4(["100.64.0.3", "10.0.0.7", "192.168.1.50"]), ["100.64.0.3"])
check("filterIPv6 keeps only the Tailscale ULA prefix",
  M.filterIPv6(["fd7a:115c:a1e0::3", "fe80::1", "2001:db8::1"]), ["fd7a:115c:a1e0::3"])
check("filterIPv4 tolerates a missing list", M.filterIPv4(undefined), [])

// --- OS icons ---------------------------------------------------------------

check("osIcon linux", M.osIcon("linux"), "\u{f033d}")
check("osIcon macOS is case-insensitive", M.osIcon("macOS"), M.osIcon("macos"))
check("osIcon falls back for something unknown", M.osIcon("plan9"), M.osIcon(""))

// --- capabilities -----------------------------------------------------------

ok("hasFileSharing reads CapMap",
  M.hasFileSharing({ CapMap: { "https://tailscale.com/cap/file-sharing": [] } }))
ok("hasFileSharing reads the legacy Capabilities list",
  M.hasFileSharing({ Capabilities: ["https://tailscale.com/cap/file-sharing"] }))
check("hasFileSharing is false when absent", M.hasFileSharing({}), false)

ok("isTaildropTarget trusts TaildropTarget == 1", M.isTaildropTarget({ TaildropTarget: 1 }, "999"))
check("isTaildropTarget rejects a non-1 grade", M.isTaildropTarget({ TaildropTarget: 2, UserID: "1001" }, "1001"), false)
ok("isTaildropTarget falls back to same owner", M.isTaildropTarget({ UserID: "1001" }, "1001"))
check("isTaildropTarget rejects another owner", M.isTaildropTarget({ UserID: "2002" }, "1001"), false)

// --- login ------------------------------------------------------------------

check("loginPlan hands back an auth URL when one is offered",
  M.loginPlan(true, "https://login.example.com/a/abc"),
  { authUrl: "https://login.example.com/a/abc", command: [] })
check("loginPlan falls back to `tailscale up`",
  M.loginPlan(false, ""), { authUrl: "", command: ["tailscale", "up"] })
check("loginPlan ignores a non-http URL",
  M.loginPlan(true, "file:///etc/passwd"), { authUrl: "", command: ["tailscale", "up"] })

// --- parseStatus: this device ----------------------------------------------

const s = M.parseStatus(statusRaw)

ok("parseStatus succeeds", s.ok)
check("parseStatus is not unavailable", s.unavailable, false)
ok("running when BackendState is Running", s.running)
check("needsLogin is false while running", s.needsLogin, false)
check("selfName", s.selfName, "workstation")
check("selfOs is carried through for the THIS DEVICE row", s.selfOs, "linux")
check("selfIp picks the CGNAT address, not the LAN one", s.selfIp, "100.64.0.1")
check("selfDnsName is cleaned", s.selfDnsName, "workstation.tailnet-demo.ts.net")
check("selfUserId", s.selfUserId, "1001")
ok("fileSharing detected from Self.CapMap", s.fileSharing)

// --- parseStatus: machines --------------------------------------------------

const names = s.peers.map(p => p.HostName)

check("online machines come first, then offline; alphabetical within each group",
  names, ["beacon", "edge-node", "laptop", "aardvark"])
check("the offline machine is listed rather than dropped",
  s.peers.filter(p => p.Online === false).map(p => p.HostName), ["aardvark"])
check("a Mullvad node is never a machine",
  names.filter(n => n.indexOf("mullvad") !== -1 || n.indexOf("se-mma") !== -1), [])
check("a peer calling itself localhost is named from its DNS name",
  names.indexOf("edge-node") !== -1, true)

const laptop = s.peers.find(p => p.HostName === "laptop")
check("peer IPv4 is filtered to the tailnet address", laptop.TailscaleIPs, ["100.64.0.3"])
check("peer IPv6 is split out", laptop.TailscaleIPv6, ["fd7a:115c:a1e0::3"])
check("peer OS is preserved for the icon", laptop.OS, "macOS")

// --- parseStatus: exit nodes ------------------------------------------------

const exitNames = s.exitNodes.map(p => p.HostName)
check("only online machines offering exit are exit nodes", exitNames, ["beacon"])
check("an offline machine is excluded even though it offers exit",
  exitNames.indexOf("aardvark"), -1)

// --- parseStatus: degraded input -------------------------------------------

check("empty status means unavailable, not an error", M.parseStatus("").unavailable, true)
check("empty status is still ok", M.parseStatus("").ok, true)
check("unparseable status reports failure", M.parseStatus("not json").ok, false)

const loggedOut = M.parseStatus(JSON.stringify({ BackendState: "NeedsLogin", AuthURL: "https://login.example.com/a/x", Self: {}, Peer: {} }))
ok("NeedsLogin is surfaced", loggedOut.needsLogin)
check("no machines when logged out", loggedOut.peers, [])

// --- parseAccounts ----------------------------------------------------------

const a = M.parseAccounts(accountsRaw)
check("both accounts are parsed", a.accounts.length, 2)
check("the selected account id", a.selectedAccountId, "aaaa")
check("the selected account label is what the ACCOUNT row shows",
  a.selectedAccountLabel, "tailnet-demo.ts.net")
check("no accounts from empty input", M.parseAccounts("").accounts, [])
check("no accounts from garbage input", M.parseAccounts("{{{").accounts, [])

check("accountLabel prefers a nickname",
  M.accountLabel({ nickname: "Work", tailnet: "t.ts.net", account: "a@example.com" }), "Work")
check("accountLabel falls back to the tailnet",
  M.accountLabel({ tailnet: "t.ts.net", account: "a@example.com" }), "t.ts.net")
check("accountLabel with nothing", M.accountLabel(null), "Unknown account")

// --- report -----------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\n${failures.length} of ${passed + failures.length} assertions failed:\n`)
  failures.forEach(f => console.error(`  ✗ ${f}\n`))
  process.exit(1)
}

console.log(`Model.js: ${passed} assertions passed.`)
