// Reports locations and rule names only. Never prints suspected credential values.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
const root = process.cwd();
const git = (...args) =>
  execFileSync("git", ["-c", `safe.directory=${root.replaceAll("\\", "/")}`, ...args], {
    cwd: root,
    maxBuffer: 256 * 1024 * 1024,
  });
const rules = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  [
    "provider-key",
    /\b(?:sk-(?:proj-|ant-|or-v1-)?[A-Za-z0-9_-]{24,}|sb_secret_[A-Za-z0-9_-]{20,})\b/g,
  ],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g],
  ["aws-access-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\b/g],
  ["credential-url", /[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]{8,}@/gi],
];
const textFile = (name) =>
  /(?:\.(?:[cm]?[jt]sx?|md|json|ya?ml|toml|sql|txt|html|css|xml|ini|conf|cfg|sh|ps1|bat|cmd|example)|(?:^|\/)\.(?:env(?:\..*)?|npmrc|netrc|pypirc|git-credentials))$/i.test(
    name,
  );
const forbidden = (name) =>
  /(?:^|\/)(?:\.env(?:\.(?!example$).*)?|\.dev\.vars(?:\..*)?|credentials\.json|id_rsa|id_ed25519|\.git-credentials)$|\.(?:pem|key|p12|pfx)$/i.test(
    name,
  );
const findings = [];
function inspect(name, bytes, source) {
  if (forbidden(name)) findings.push({ file: name, source, rule: "secret-file" });
  if (!textFile(name)) return;
  let text = bytes.toString("utf8");
  if (text.includes("\0")) text += "\n" + bytes.toString("utf16le");
  for (const [rule, pattern] of rules) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern))
      findings.push({
        file: name,
        source,
        line: text.slice(0, match.index).split("\n").length,
        rule,
      });
  }
}
const names = git("ls-files", "--cached", "--others", "--exclude-standard", "-z")
  .toString("utf8")
  .split("\0")
  .filter(Boolean);
for (const name of new Set(names)) {
  try {
    inspect(name, readFileSync(path.join(root, name)), "working-tree");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
if (process.argv.includes("--history")) {
  // Scan every text blob reachable from any local/ref history before it can be published.
  const objects = git("rev-list", "--objects", "--all").toString("utf8").trim().split("\n");
  const checked = new Set();
  for (const entry of objects) {
    const space = entry.indexOf(" ");
    if (space < 0) continue;
    const oid = entry.slice(0, space),
      name = entry.slice(space + 1);
    if (checked.has(oid) || (!textFile(name) && !forbidden(name))) continue;
    checked.add(oid);
    if (git("cat-file", "-t", oid).toString().trim() !== "blob") continue;
    inspect(name, git("cat-file", "blob", oid), `history:${oid}`);
  }
}
for (const finding of findings) process.stdout.write(JSON.stringify(finding) + "\n");
process.stdout.write(
  `Scanned ${new Set(names).size} project files${process.argv.includes("--history") ? " and reachable text history" : ""}; ${findings.length} potential secret finding(s).\n`,
);
process.exitCode = findings.length ? 1 : 0;
