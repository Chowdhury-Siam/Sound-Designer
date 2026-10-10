import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { BANNER_NAME, releaseBannerBody } from './release-banner.mjs';

export function versionParts(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Invalid release version: ${version}`);
  }
  const parts = version.split('.').map(Number);
  if (parts.some(part => !Number.isSafeInteger(part))) throw new Error('Version component is too large.');
  return parts;
}

export function shouldRelease({ eventName, ref, version, previousVersion, publish = false }) {
  const current = versionParts(version);
  if (ref !== 'refs/heads/main') return false;
  if (eventName === 'workflow_dispatch') return publish === true;
  if (eventName !== 'push') return false;
  const previous = versionParts(previousVersion);
  const changed = current.findIndex((part, index) => part !== previous[index]);
  if (changed === -1) return false;
  if (current[changed] < previous[changed]) throw new Error('A release version must increase, not decrease.');
  return true;
}

export function parseReleaseNotes(markdown, version) {
  versionParts(version);
  const [heading, ...lines] = markdown.trim().split(/\r?\n/);
  const title = heading?.match(/^# (.+)$/)?.[1];
  if (!title?.startsWith(`SoundDesigner v${version} — `)) {
    throw new Error(`Release notes need a title beginning with "# SoundDesigner v${version} — ".`);
  }
  const body = lines.join('\n').trim();
  if (!body) throw new Error('Release description is empty.');
  return { title, body };
}

export async function releaseFiles(directory, version, bannerFile) {
  versionParts(version);
  const files = [];
  for (const suffix of ['Windows-Setup.exe', 'macOS.pkg']) {
    const name = `SoundDesigner-v${version}-${suffix}`;
    const data = await readFile(path.join(directory, name));
    if (!data.length) throw new Error(`Empty installer: ${name}`);
    const digest = createHash('sha256').update(data).digest('hex');
    const checksumName = `${name}.sha256`;
    const checksum = await readFile(path.join(directory, checksumName));
    if (checksum.toString('utf8').trim() !== `${digest}  ${name}`) {
      throw new Error(`Installer checksum mismatch: ${name}`);
    }
    files.push({ name, data }, { name: checksumName, data: checksum });
  }
  const banner = await readFile(bannerFile);
  if (!banner.length) throw new Error('Release artwork is empty.');
  files.push({ name: BANNER_NAME, data: banner });
  return files;
}

// Stage privately so a failed upload never leaves a public, half-filled release.
export async function publishRelease({ github, identity, version, notes, files }) {
  const tag = `v${version}`;
  versionParts(version);
  const body = releaseBannerBody(notes.body, identity);
  const expected = [
    `SoundDesigner-${tag}-Windows-Setup.exe`, `SoundDesigner-${tag}-Windows-Setup.exe.sha256`,
    `SoundDesigner-${tag}-macOS.pkg`, `SoundDesigner-${tag}-macOS.pkg.sha256`, BANNER_NAME,
  ];
  if (files.length !== expected.length || expected.some(name => !files.some(file => file.name === name))) {
    throw new Error('Only both installers, their checksums and the release banner may be published.');
  }
  const repo = { owner: identity.owner, repo: identity.repo };
  let release;
  try {
    release = (await github.rest.repos.getReleaseByTag({ ...repo, tag })).data;
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  if (release && (!release.draft || release.target_commitish !== identity.sha)) {
    throw new Error('An existing public release or a draft for another commit will not be replaced.');
  }
  if (!release) {
    release = (await github.rest.repos.createRelease({
      ...repo, tag_name: tag, target_commitish: identity.sha,
      name: notes.title, body, draft: true, prerelease: false,
    })).data;
  }
  const target = { ...repo, release_id: release.id };
  const assets = await github.paginate(github.rest.repos.listReleaseAssets, target);
  if (assets.some(asset => !expected.includes(asset.name))) throw new Error('Unexpected draft assets; inspect before retrying.');
  for (const file of files) {
    const existing = assets.find(asset => asset.name === file.name);
    const digest = `sha256:${createHash('sha256').update(file.data).digest('hex')}`;
    if (existing) {
      if (existing.state !== 'uploaded' || existing.digest !== digest) {
        throw new Error(`Existing draft asset differs: ${file.name}; it will not be overwritten.`);
      }
    } else {
      await github.rest.repos.uploadReleaseAsset({
        ...target, name: file.name, data: file.data,
        headers: { 'content-type': file.name === BANNER_NAME ? 'image/svg+xml' : 'application/octet-stream', 'content-length': file.data.length },
      });
    }
  }
  const uploaded = await github.paginate(github.rest.repos.listReleaseAssets, target);
  if (uploaded.length !== expected.length || uploaded.some(asset => !expected.includes(asset.name))) {
    throw new Error('Unexpected assets appeared during upload; the release remains private.');
  }
  for (const file of files) {
    const asset = uploaded.find(item => item.name === file.name);
    const digest = `sha256:${createHash('sha256').update(file.data).digest('hex')}`;
    if (asset?.state !== 'uploaded' || asset.digest !== digest || asset.size !== file.data.length) {
      throw new Error(`Uploaded release asset verification failed: ${file.name}`);
    }
  }
  return (await github.rest.repos.updateRelease({
    ...target, name: notes.title, body, draft: false, prerelease: false, make_latest: 'true',
  })).data;
}
