import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { shouldRelease, parseReleaseNotes, releaseFiles, publishRelease } from './release-automation.mjs';
import { BANNER_NAME, BANNER_START } from './release-banner.mjs';

const version = '1.0.5';
const identity = { owner: 'iboyshanto', repo: 'SoundDesigner', sha: 'a'.repeat(40) };
const notes = { title: 'SoundDesigner v1.0.5 — Shared sound workspace', body: '## Changes\n\nDetailed notes.' };
const names = [`SoundDesigner-v${version}-Windows-Setup.exe`, `SoundDesigner-v${version}-Windows-Setup.exe.sha256`,
  `SoundDesigner-v${version}-macOS.pkg`, `SoundDesigner-v${version}-macOS.pkg.sha256`, BANNER_NAME];
const files = names.map(name => ({ name, data: Buffer.from(name) }));
const assetFor = file => ({ name: file.name, state: 'uploaded', size: file.data.length,
  digest: `sha256:${createHash('sha256').update(file.data).digest('hex')}` });

test('only main version increases or explicit main retries release; commit wording is irrelevant', () => {
  const input = { eventName: 'push', ref: 'refs/heads/main', version, previousVersion: '1.0.4' };
  assert.equal(shouldRelease(input), true);
  for (const [previousVersion, version] of [['1.0.9', '1.0.10'], ['1.9.9', '1.10.0'], ['1.9.9', '2.0.0']]) {
    assert.equal(shouldRelease({ ...input, previousVersion, version }), true);
  }
  assert.equal(shouldRelease({ ...input, previousVersion: version }), false);
  assert.equal(shouldRelease({ ...input, eventName: 'pull_request' }), false);
  assert.equal(shouldRelease({ ...input, ref: 'refs/heads/feature' }), false);
  assert.equal(shouldRelease({ ...input, eventName: 'workflow_dispatch', publish: false }), false);
  assert.equal(shouldRelease({ ...input, eventName: 'workflow_dispatch', publish: true }), true);
  assert.throws(() => shouldRelease({ ...input, previousVersion: '1.0.6' }), /increase/);
  for (const invalid of ['1.0', '1.0.5-beta', '01.0.5', '1.0.5\nmalicious', undefined]) {
    assert.throws(() => shouldRelease({ ...input, version: invalid }), /Invalid release/);
  }
});

test('versioned markdown supplies the release title and description, not a duplicate H1', () => {
  assert.deepEqual(parseReleaseNotes(`# ${notes.title}\r\n\r\n${notes.body}`, version), notes);
  for (const markdown of ['# Wrong title\n\nText', '# SoundDesigner v1.0.4 — Old\n\nText', `# ${notes.title}`]) {
    assert.throws(() => parseReleaseNotes(markdown, version));
  }
});

test('checks both versioned installers and checksum sidecars before permitting publication', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sounddesigner-release-test-'));
  try {
    const banner = path.join(directory, BANNER_NAME);
    await writeFile(banner, '<svg/>');
    for (const name of [names[0], names[2]]) {
      const data = Buffer.from('fixture installer');
      await writeFile(path.join(directory, name), data);
      await writeFile(path.join(directory, `${name}.sha256`), `${createHash('sha256').update(data).digest('hex')}  ${name}\n`);
    }
    assert.deepEqual((await releaseFiles(directory, version, banner)).map(file => file.name), names);
    await writeFile(path.join(directory, names[1]), 'incorrect checksum');
    await assert.rejects(releaseFiles(directory, version, banner), /checksum mismatch/);
    await rm(path.join(directory, names[0]));
    await assert.rejects(releaseFiles(directory, version, banner), /ENOENT/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function fixture({ existing, assets = [], uploadFailure = false, corruptUpload = false, apiFailure = false } = {}) {
  const writes = [];
  const uploaded = [...assets];
  const repos = {
    getReleaseByTag: async () => {
      if (apiFailure) throw Object.assign(new Error('Access denied'), { status: 403 });
      if (existing) return { data: existing };
      throw Object.assign(new Error('Not found'), { status: 404 });
    },
    createRelease: async args => { writes.push({ operation: 'create', ...args }); return { data: { id: 42 } }; },
    listReleaseAssets: () => {},
    uploadReleaseAsset: async args => {
      if (uploadFailure) throw new Error('Upload failed');
      writes.push({ operation: 'upload', ...args });
      const asset = assetFor(args);
      uploaded.push(corruptUpload ? { ...asset, digest: 'sha256:wrong' } : asset);
    },
    updateRelease: async args => { writes.push({ operation: 'publish', ...args }); return { data: { ...args, html_url: 'https://example.test/release' } }; },
  };
  return { writes, options: { github: { rest: { repos }, paginate: async () => uploaded }, identity, version, notes, files } };
}

test('stages privately, verifies every asset, then publishes publicly with notes, title and banner', async () => {
  const { writes, options } = fixture();
  const release = await publishRelease(options);
  assert.equal(writes[0].draft, true);
  assert.equal(writes[0].target_commitish, identity.sha);
  assert.equal(writes[0].tag_name, 'v1.0.5');
  assert.deepEqual(writes.filter(write => write.operation === 'upload').map(write => write.name), names);
  const publication = writes.at(-1);
  assert.equal(publication.operation, 'publish');
  assert.equal(publication.name, notes.title);
  assert.ok(publication.body.includes(BANNER_START));
  assert.ok(publication.body.endsWith(notes.body));
  assert.equal(publication.draft, false);
  assert.equal(publication.prerelease, false);
  assert.equal(publication.make_latest, 'true');
  assert.equal(release.draft, false);
});

test('upload failures and corrupt remote uploads never publish a half-filled release', async () => {
  for (const input of [{ uploadFailure: true }, { corruptUpload: true }]) {
    const { writes, options } = fixture(input);
    await assert.rejects(publishRelease(options));
    assert.equal(writes[0].draft, true);
    assert.ok(!writes.some(write => write.operation === 'publish'));
  }
});

test('reruns resume only matching private assets without replacing user releases or different drafts', async () => {
  const existing = { id: 42, draft: true, target_commitish: identity.sha };
  const { writes, options } = fixture({ existing, assets: files.map(assetFor) });
  await publishRelease(options);
  assert.deepEqual(writes.map(write => write.operation), ['publish']);
  for (const input of [
    { existing: { ...existing, draft: false } },
    { existing: { ...existing, target_commitish: 'b'.repeat(40) } },
    { existing, assets: [{ ...assetFor(files[0]), digest: 'sha256:different' }] },
    { existing, assets: [{ name: 'internal.zxp' }] },
    { apiFailure: true },
  ]) {
    const { writes, options } = fixture(input);
    await assert.rejects(publishRelease(options));
    assert.deepEqual(writes, []);
  }
});

test('rejects missing installers and internal ZXP assets before creating any release', async () => {
  for (const input of [files.slice(0, -1), [...files, { name: 'internal.zxp', data: Buffer.from('private') }]]) {
    const { writes, options } = fixture();
    await assert.rejects(publishRelease({ ...options, files: input }), /Only both installers/);
    assert.deepEqual(writes, []);
  }
});

test('the current release metadata matches the package and unsigned installer policy retains build gates', async () => {
  const root = new URL('../', import.meta.url);
  const read = async file => readFile(new URL(file, root), 'utf8');
  const pkg = JSON.parse(await read('package.json'));
  const current = parseReleaseNotes(await read(`.github/releases/v${pkg.version}.md`), pkg.version);
  assert.ok(current.title.includes(`v${pkg.version}`));
  assert.match(current.body, /unsigned installers/);
  assert.match(current.body, /not notarized/);
  const workflow = await read('.github/workflows/release.yml');
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /shouldRelease\(/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /getCommit/);
  assert.match(workflow, /publish_release/);
  assert.match(workflow, /SOUNDDESIGNER_INSTALLER_CANDIDATE: '1'/);
  assert.match(workflow, /ALLOW_MISSING_NATIVE: '0'/);
  assert.match(workflow, /SOUNDDESIGNER_ZXP_CERT_BASE64/);
  assert.match(workflow, /SOUNDDESIGNER_ZXP_PASSWORD/);
  assert.match(workflow, /needs: \[release-info, build-installers\]/);
  assert.match(workflow, /bun run release:package/);
  assert.match(workflow, /bun run installer:windows/);
  assert.match(workflow, /bun run installer:macos:assemble/);
  assert.doesNotMatch(workflow, /continue-on-error|pull_request|certificate:create|notarytool|SOUNDDESIGNER_MAC_INSTALLER_IDENTITY/);
  assert.match(workflow, /pattern: release-\*/);
  assert.doesNotMatch(workflow, /release\/SoundDesigner-\*\.zxp/);
});
