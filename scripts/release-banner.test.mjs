import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  applyReleaseBanner, releaseBannerBody, BANNER_NAME, BANNER_START, BANNER_END,
} from './release-banner.mjs';

const identity = { owner: 'iboyshanto', repo: 'SoundDesigner', sha: 'a'.repeat(40) };
const artwork = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
const digest = `sha256:${createHash('sha256').update(artwork).digest('hex')}`;

function fixture({ body = '## Changes\n\nUser-authored notes.\n', assets = [], latestBody, draft = false, immutable = false } = {}) {
  const writes = [];
  let reads = 0;
  const repos = {
    getRelease: async args => {
      assert.deepEqual(args, { owner: identity.owner, repo: identity.repo, release_id: 42 });
      reads += 1;
      return { data: { body: reads > 1 ? latestBody ?? body : body, draft, immutable } };
    },
    listReleaseAssets: () => {},
    uploadReleaseAsset: async args => { writes.push({ operation: 'upload', ...args }); },
    updateRelease: async args => { writes.push({ operation: 'update', ...args }); },
  };
  return {
    writes,
    options: {
      artwork,
      github: { rest: { repos }, paginate: async (method, args) => {
        assert.equal(method, repos.listReleaseAssets);
        assert.equal(args.release_id, 42);
        return assets;
      } },
      context: { repo: identity, sha: identity.sha, payload: { release: { id: 42 } } },
      core: { info: () => {} },
    },
  };
}

test('adds a commit-pinned header and preserves original notes byte-for-byte', () => {
  const original = '\r\n## Changes\r\n\r\nText, links and tables.  \r\n';
  const body = releaseBannerBody(original, identity);
  assert.ok(body.endsWith(`\n\n${original}`));
  assert.ok(body.includes(`/${identity.sha}/.github/assets/${BANNER_NAME}`));
  assert.equal(releaseBannerBody(body, identity), body);
  assert.equal(releaseBannerBody(null, identity), releaseBannerBody('', identity));
});

test('updates only the managed block and respects a manually embedded matching banner', () => {
  const old = releaseBannerBody('Release notes\n', { ...identity, sha: 'b'.repeat(40) });
  const decorated = `Preface\n${old}\nFooter`;
  const updated = releaseBannerBody(decorated, identity);
  assert.ok(updated.startsWith(`Preface\n${BANNER_START}`));
  assert.ok(updated.endsWith('\n\nRelease notes\n\nFooter'));
  assert.equal(updated.split(BANNER_START).length, 2);
  const manual = updated.replace(`${BANNER_START}\n`, '').replace(`\n${BANNER_END}`, '');
  assert.equal(releaseBannerBody(manual, identity), manual);
});

test('refuses malformed managed blocks and an unpinned image URL', () => {
  for (const notes of [BANNER_START, BANNER_END, `${BANNER_END}${BANNER_START}`,
    `${BANNER_START}${BANNER_START}${BANNER_END}`]) {
    assert.throws(() => releaseBannerBody(notes, identity), /malformed/);
  }
  assert.throws(() => releaseBannerBody('Notes', { ...identity, sha: 'main' }), /full release commit/);
});

test('uploads only the SVG and preserves notes edited during upload', async () => {
  const latestBody = '## Changes\n\nA newer edit made during upload.\n';
  const { options, writes } = fixture({ latestBody });
  await applyReleaseBanner(options);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].operation, 'upload');
  assert.equal(writes[0].name, BANNER_NAME);
  assert.equal(writes[0].headers['content-type'], 'image/svg+xml');
  assert.deepEqual(writes[0].data, artwork);
  assert.deepEqual(Object.keys(writes[1]).sort(), ['body', 'operation', 'owner', 'release_id', 'repo']);
  assert.ok(writes[1].body.endsWith(latestBody));
});

test('a rerun leaves existing notes and attached assets unchanged', async () => {
  const body = releaseBannerBody('Notes\n', identity);
  const { options, writes } = fixture({ body, assets: [
    { name: 'SoundDesigner-Windows-Setup.exe' }, { name: BANNER_NAME, digest },
  ] });
  await applyReleaseBanner(options);
  assert.deepEqual(writes, []);
});

test('does not overwrite a different banner asset or mutate malformed notes', async () => {
  for (const state of [
    { assets: [{ name: BANNER_NAME, digest: 'sha256:different' }] },
    { body: BANNER_START },
    { draft: true },
  ]) {
    const { options, writes } = fixture(state);
    await assert.rejects(applyReleaseBanner(options));
    assert.deepEqual(writes, []);
  }
});

test('an upload failure preserves the release description', async () => {
  const { options, writes } = fixture();
  options.github.rest.repos.uploadReleaseAsset = async () => { throw new Error('Upload failed'); };
  await assert.rejects(applyReleaseBanner(options), /Upload failed/);
  assert.deepEqual(writes, []);
});

test('an immutable release receives the header without attempting a locked asset upload', async () => {
  const { options, writes } = fixture({ immutable: true });
  await applyReleaseBanner(options);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].operation, 'update');
  assert.ok(writes[0].body.includes(BANNER_START));
});

test('the actual release asset is a self-contained SVG', async () => {
  const svg = await readFile(new URL(`../.github/assets/${BANNER_NAME}`, import.meta.url), 'utf8');
  assert.ok(/<svg\b[^>]*viewBox=['"]0 0 1800 900['"]/.test(svg), 'Release SVG dimensions');
  assert.ok(!/<(?:image|script|foreignObject)\b|\b(?:href|src)=/i.test(svg), 'Self-contained vector artwork');
});
