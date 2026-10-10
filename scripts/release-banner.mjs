import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const BANNER_NAME = 'SoundDesigner-signal-release.svg';
export const BANNER_START = '<!-- sounddesigner-release-banner:start -->';
export const BANNER_END = '<!-- sounddesigner-release-banner:end -->';
const bannerFile = new URL(`../.github/assets/${BANNER_NAME}`, import.meta.url);

export function releaseBannerBody(body, { owner, repo, sha }) {
  if (!/^[a-f\d]{40}$/i.test(sha)) throw new Error('A full release commit SHA is required.');
  for (const name of [owner, repo]) {
    if (!/^[\w.-]+$/.test(name)) throw new Error('Invalid release repository.');
  }
  const notes = body ?? '';
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/.github/assets/${BANNER_NAME}`;
  const image = `![SoundDesigner — Adobe Premiere Pro, Adobe After Effects and DaVinci Resolve Studio](${url})`;
  const block = `${BANNER_START}\n${image}\n${BANNER_END}`;
  const starts = notes.split(BANNER_START).length - 1;
  const ends = notes.split(BANNER_END).length - 1;
  if (starts || ends) {
    if (starts !== 1 || ends !== 1 || notes.indexOf(BANNER_END) < notes.indexOf(BANNER_START)) {
      throw new Error('Release banner markers are malformed; existing notes were preserved.');
    }
    const start = notes.indexOf(BANNER_START);
    const end = notes.indexOf(BANNER_END) + BANNER_END.length;
    return notes.slice(0, start) + block + notes.slice(end);
  }
  // Respect a header already inserted manually for this exact release commit.
  if (notes.includes(`](${url})`)) return notes;
  return notes ? `${block}\n\n${notes}` : block;
}

export async function applyReleaseBanner({ github, context, core, artwork }) {
  const releaseId = context.payload.release?.id;
  if (!Number.isSafeInteger(releaseId) || releaseId <= 0) {
    throw new Error('A published release event is required.');
  }
  const { owner, repo } = context.repo;
  const target = { owner, repo, release_id: releaseId };
  const identity = { owner, repo, sha: context.sha };
  const { data: release } = await github.rest.repos.getRelease(target);
  if (release.draft) throw new Error('Draft releases are not decorated or published by this script.');
  releaseBannerBody(release.body, identity); // Validate note boundaries before any write.
  const data = artwork ?? await readFile(bannerFile);
  const digest = `sha256:${createHash('sha256').update(data).digest('hex')}`;
  const assets = await github.paginate(github.rest.repos.listReleaseAssets, target);
  const existing = assets.find(asset => asset.name === BANNER_NAME);
  if (existing?.digest && existing.digest !== digest) {
    throw new Error('A different release banner is already attached; it will not be replaced.');
  }
  if (!existing && release.immutable) {
    core.info('Release assets are locked; the SVG will be embedded in the notes only.');
  } else if (!existing) {
    await github.rest.repos.uploadReleaseAsset({
      ...target,
      name: BANNER_NAME,
      data,
      headers: { 'content-type': 'image/svg+xml', 'content-length': data.length },
    });
    core.info(`Attached ${BANNER_NAME}.`);
  }
  // Read again so notes edited during the asset upload are retained.
  const { data: current } = await github.rest.repos.getRelease(target);
  const body = releaseBannerBody(current.body, identity);
  if (body !== (current.body ?? '')) {
    await github.rest.repos.updateRelease({ ...target, body });
    core.info('Added the commit-pinned banner to the release notes.');
  } else {
    core.info('The release notes already contain this banner.');
  }
}
