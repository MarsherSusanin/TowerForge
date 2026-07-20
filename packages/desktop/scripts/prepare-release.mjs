import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const INSTALLER_EXTENSIONS = new Set([".dmg", ".exe", ".msi", ".AppImage", ".deb", ".rpm"]);
const TAG_RE = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;
const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMMIT_RE = /^[0-9a-f]{7,40}$/i;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readCargoVersion(filePath) {
  const match = fs.readFileSync(filePath, "utf8").match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error(`Could not read Cargo package version from ${filePath}.`);
  return match[1];
}

export function assertReleaseVersions(repoRoot, expectedVersion) {
  const versions = new Map([
    ["package.json", readJson(path.join(repoRoot, "package.json")).version],
    ["packages/desktop/package.json", readJson(path.join(repoRoot, "packages/desktop/package.json")).version],
    ["packages/desktop/src-tauri/tauri.conf.json", readJson(path.join(repoRoot, "packages/desktop/src-tauri/tauri.conf.json")).version],
    ["packages/desktop/src-tauri/Cargo.toml", readCargoVersion(path.join(repoRoot, "packages/desktop/src-tauri/Cargo.toml"))]
  ]);
  const mismatches = [...versions].filter(([, version]) => version !== expectedVersion);
  if (mismatches.length) {
    throw new Error(`Release tag version ${expectedVersion} does not match: ${mismatches.map(([file, version]) => `${file}=${version}`).join(", ")}.`);
  }
  return Object.fromEntries(versions);
}

function collectInstallers(root) {
  const installers = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Release artifacts must not contain symlinks: ${entryPath}`);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile() && INSTALLER_EXTENSIONS.has(path.extname(entry.name))) installers.push(entryPath);
    }
  }
  visit(root);
  return installers.sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
}

function sha256(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function platformDescription(fileName) {
  const extension = path.extname(fileName);
  if (extension === ".dmg") return "macOS disk image";
  if (extension === ".exe") return "Windows NSIS installer";
  if (extension === ".msi") return "Windows MSI installer";
  if (extension === ".AppImage") return "Linux AppImage";
  if (extension === ".deb") return "Debian/Ubuntu package";
  if (extension === ".rpm") return "Fedora/RHEL package";
  return "desktop installer";
}

function releaseNotes({ tag, repository, commitSha, checksums }) {
  const downloads = checksums.map(({ fileName }) => `- \`${fileName}\` - ${platformDescription(fileName)}.`).join("\n");
  const checksumText = checksums.map(({ fileName, hash }) => `${hash}  ${fileName}`).join("\n");
  return `# TowerForge ${tag} - Unsigned build

> [!WARNING]
> This is an unsigned alpha build. macOS and Windows cannot verify the publisher. Download only from this release and verify the SHA-256 checksum before opening an installer.

## Downloads

${downloads}
- \`SHA256SUMS\` - checksums for every attached installer.

## SHA-256

\`\`\`text
${checksumText}
\`\`\`

## Installation Safety

- macOS: move TowerForge to Applications. If macOS blocks the first launch after checksum verification, use System Settings > Privacy & Security > Open Anyway.
- Windows: keep SmartScreen and antivirus enabled. Verify the checksum and confirm this GitHub release is the download source.
- Linux: verify the checksum before installing a package or launching the AppImage.

TowerForge does not require disabling Gatekeeper, SmartScreen, antivirus, or other operating-system security controls.

## Source

- Tag: https://github.com/${repository}/releases/tag/${tag}
- Tagged source: https://github.com/${repository}/tree/${tag}
- Commit: https://github.com/${repository}/commit/${commitSha}
`;
}

export function prepareDesktopRelease({ inputDir, outputDir, repoRoot, tag, repository, commitSha }) {
  const tagMatch = String(tag || "").match(TAG_RE);
  if (!tagMatch) throw new Error("Release tag must use vX.Y.Z syntax.");
  if (!REPOSITORY_RE.test(String(repository || ""))) throw new Error("Repository must use owner/name syntax.");
  if (!COMMIT_RE.test(String(commitSha || ""))) throw new Error("Commit SHA is invalid.");
  const resolvedInput = path.resolve(inputDir);
  const resolvedOutput = path.resolve(outputDir);
  if (!fs.existsSync(resolvedInput) || !fs.statSync(resolvedInput).isDirectory()) {
    throw new Error(`Release artifact directory does not exist: ${resolvedInput}`);
  }
  if (fs.existsSync(resolvedOutput) && fs.readdirSync(resolvedOutput).length) {
    throw new Error(`Release output directory must be empty: ${resolvedOutput}`);
  }

  const version = tagMatch[1];
  const versions = assertReleaseVersions(path.resolve(repoRoot), version);
  const installers = collectInstallers(resolvedInput);
  if (!installers.length) throw new Error("No supported desktop installers were found.");
  const duplicateNames = installers
    .map((installer) => path.basename(installer))
    .filter((fileName, index, names) => names.indexOf(fileName) !== index);
  if (duplicateNames.length) throw new Error(`Duplicate release installer basename: ${duplicateNames[0]}`);
  fs.mkdirSync(resolvedOutput, { recursive: true });

  const checksums = installers.map((sourcePath) => {
    const fileName = path.basename(sourcePath);
    const destination = path.join(resolvedOutput, fileName);
    fs.copyFileSync(sourcePath, destination, fs.constants.COPYFILE_EXCL);
    return { fileName, hash: sha256(destination) };
  });

  const checksumFile = path.join(resolvedOutput, "SHA256SUMS");
  fs.writeFileSync(checksumFile, `${checksums.map(({ fileName, hash }) => `${hash}  ${fileName}`).join("\n")}\n`, "utf8");
  const notesFile = path.join(resolvedOutput, "RELEASE_NOTES.md");
  fs.writeFileSync(notesFile, releaseNotes({ tag, repository, commitSha, checksums }), "utf8");
  return { version, versions, installers: checksums, checksumFile, notesFile };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`Invalid argument near ${key || "<end>"}.`);
    values[key.slice(2)] = value;
  }
  return values;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = prepareDesktopRelease({
      inputDir: args.input,
      outputDir: args.output,
      repoRoot: args["repo-root"] || process.cwd(),
      tag: args.tag,
      repository: args.repository,
      commitSha: args.commit
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
