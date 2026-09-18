// Manifest checks, mirroring what `omarchy plugin validate` enforces.
//
// `omarchy plugin validate` is the authority, but it needs Omarchy installed,
// so it cannot run on a stock CI runner. This re-checks the same rules — the
// ones in omarchy-plugin-validate — plus that the declared entry points exist.
//
//   node test/manifest-test.js

const fs = require("fs")
const path = require("path")

const ROOT = path.join(__dirname, "..")
const manifestPath = path.join(ROOT, "manifest.json")

let passed = 0
const failures = []

function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed++
  else failures.push(`${name}\n    expected: ${e}\n    actual:   ${a}`)
}

let m
try {
  m = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  passed++
} catch (e) {
  console.error(`manifest.json is not valid JSON: ${e.message}`)
  process.exit(1)
}

// schemaVersion must be exactly the number 1 — the QML side rejects anything else.
check("schemaVersion is the number 1", m.schemaVersion, 1)

// Required top-level fields.
for (const field of ["id", "name", "version", "kinds", "entryPoints"]) {
  check(`${field} is present`, m[field] !== undefined && m[field] !== "", true)
}

// Id rules.
check("id matches the allowed character set", /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(m.id), true)
check("id contains no path traversal", m.id.includes(".."), false)
check("id stays out of the reserved omarchy.* namespace", m.id.startsWith("omarchy."), false)

// Version should be semver-ish, and not pretending to be upstream's release.
check("version looks like semver", /^\d+\.\d+\.\d+$/.test(m.version), true)

// Kinds and their entry points.
check("kinds is a non-empty array", Array.isArray(m.kinds) && m.kinds.length > 0, true)
check("declares the bar-widget kind", m.kinds.includes("bar-widget"), true)
check("has a barWidget entry point", typeof m.entryPoints.barWidget, "string")

for (const [kind, rel] of Object.entries(m.entryPoints)) {
  check(`${kind} entry point is a relative path`, path.isAbsolute(rel) || rel.startsWith(".."), false)
  const target = path.join(ROOT, rel)
  check(`${kind} entry point exists on disk (${rel})`, fs.existsSync(target), true)
  if (fs.existsSync(target)) {
    check(`${kind} entry point is a real file, not a symlink`, fs.lstatSync(target).isSymbolicLink(), false)
  }
}

// The IPC target the README documents must match the plugin id, or the
// documented commands silently address nothing.
const panel = fs.readFileSync(path.join(ROOT, "Panel.qml"), "utf8")
const ipcMatch = panel.match(/IpcHandler\s*\{[^}]*?target:\s*"([^"]+)"/s)
check("Panel.qml registers an IpcHandler", ipcMatch !== null, true)
if (ipcMatch) check("the IPC target matches the plugin id", ipcMatch[1], m.id)

const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8")
check("the README documents the real IPC target", readme.includes(`ipc call ${m.id}`), true)

if (failures.length > 0) {
  console.error(`\n${failures.length} of ${passed + failures.length} manifest checks failed:\n`)
  failures.forEach(f => console.error(`  ✗ ${f}\n`))
  process.exit(1)
}

console.log(`manifest.json: ${passed} checks passed.`)
