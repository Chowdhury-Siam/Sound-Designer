const destinations = {
  adobe: "/Library/Application Support/Adobe/CEP/extensions/com.rksound.designer",
  resolve: "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/com.sound.designer.resolve",
};

// Static, self-contained Installer resources. No web fonts, scripts or fake controls.
const brandedPage = (heading, content) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SoundDesigner Setup</title><style>
body { margin:0; padding:20px; background:#1d1d1d; color:#e5e5e5; font:13px/1.5 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
.brand { margin:0 0 12px; font-size:14px; font-weight:600; }
.caption { color:#b8b8b8; font-size:11px; }
h1 { margin:0 0 8px; font-size:26px; line-height:1.2; font-weight:600; letter-spacing:-0.5px; }
p { margin:8px 0 12px; color:#b8b8b8; }
.card { width:100%; margin:10px 0; border:1px solid #4b4b4b; border-radius:9px; background:#292929; border-spacing:0; }
.card td { padding:12px; vertical-align:middle; }
.tile { width:42px; text-align:center; color:#b8b8b8; background:#242424; font-size:11px; font-weight:600; border-radius:6px; }
.tile img { width:32px; height:32px; }
.card strong { display:block; font-size:14px; }
.note { padding:12px; border-left:3px solid #0a6fd8; background:#242424; }
.wave { height:38px; line-height:38px; margin:12px 0 18px; border-bottom:1px solid #303030; }
.wave span { display:inline-block; width:3px; margin-right:4px; vertical-align:middle; background:#3a91e5; border-radius:2px; }
</style></head><body>
<div class="brand">SoundDesigner <span class="caption">&nbsp; ADOBE + RESOLVE SETUP</span></div>
<div class="wave" aria-hidden="true">${[8, 14, 24, 18, 38, 28, 20, 12, 26, 34, 24, 16, 8].map(height => `<span style="height:${height}px"></span>`).join("")}</div>
<h1>${heading}</h1>${content}</body></html>`;

export const welcomeHtml = brandedPage("Choose your software", `
<p>Bring SoundDesigner into your workspace. Select one or both in <strong>Customize</strong>.</p>
<table class="card" role="presentation"><tr><td class="tile"><img src="adobe-symbol.png" alt="Adobe"></td><td><strong>Premiere Pro / After Effects</strong><span class="caption">Adobe editing workspace</span></td></tr></table>
<table class="card" role="presentation"><tr><td class="tile"><img src="resolve.png" alt="DaVinci Resolve"></td><td><strong>DaVinci Resolve Studio</strong><span class="caption">Workflow Integrations</span></td></tr></table>
<p class="note">Your audio libraries, memories and settings stay untouched.</p>
<p class="caption">Close your selected applications before installing. Installs for all users; macOS will ask for permission.</p>`);

export const conclusionHtml = brandedPage("You're ready to create.", `
<p>After a successful installation, restart the applications you selected.</p>
<table class="card" role="presentation"><tr><td class="tile"><img src="adobe-symbol.png" alt="Adobe"></td><td><strong>Adobe</strong><span class="caption">Window &gt; Extensions &gt; SoundDesigner</span></td></tr></table>
<table class="card" role="presentation"><tr><td class="tile"><img src="resolve.png" alt="DaVinci Resolve"></td><td><strong>DaVinci Resolve Studio</strong><span class="caption">Workspace &gt; Workflow Integrations &gt; SoundDesigner</span></td></tr></table>
<p class="note">Choose your audio library folder inside SoundDesigner, on first launch or in Settings.</p>`);

export const distributionXml = version => {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid installer version");
  return `<?xml version="1.0" encoding="UTF-8"?>
<installer-gui-script minSpecVersion="2">
 <title>SoundDesigner</title>
 <options customize="always" require-scripts="true" allow-external-scripts="false"/>
 <domains enable_anywhere="false" enable_currentUserHome="false" enable_localSystem="true"/>
 <welcome file="welcome.html" mime-type="text/html"/>
 <conclusion file="conclusion.html" mime-type="text/html"/>
 <volume-check script="checkChoices()"/>
 <choices-outline><line choice="adobe"/><line choice="resolve"/></choices-outline>
 <choice id="adobe" title="Adobe Premiere Pro / After Effects" description="${destinations.adobe}" selected="initialSelection('adobe')"><pkg-ref id="com.rksound.designer.pkg.adobe"/></choice>
 <choice id="resolve" title="DaVinci Resolve Studio" description="${destinations.resolve}" selected="initialSelection('resolve')"><pkg-ref id="com.sound.designer.pkg.resolve"/></choice>
 <pkg-ref id="com.rksound.designer.pkg.adobe" version="${version}" auth="Root">adobe.pkg</pkg-ref>
 <pkg-ref id="com.sound.designer.pkg.resolve" version="${version}" auth="Root">resolve.pkg</pkg-ref>
 <script><![CDATA[
 var initialized = {};
 function initialSelection(id) {
   if (initialized[id]) return choices[id].selected;
   initialized[id] = true;
   try {
     var adobe = system.files.fileExistsAtPath('/Library/Application Support/Adobe/CEP');
     var resolve = system.files.fileExistsAtPath('/Applications/DaVinci Resolve/DaVinci Resolve.app');
     return id === 'adobe' ? adobe || !resolve : resolve;
   }
   catch (e) { return false; }
 }
 function checkChoices() {
   if (my.target.mountpoint !== '/') { my.result.type = 'Fatal'; my.result.message = 'Install on the running system volume.'; return false; }
   if (choices.adobe.selected || choices.resolve.selected) return true;
   my.result.type = 'Fatal'; my.result.message = 'Use Customize to select at least one application.'; return false;
 }
 ]]></script>
</installer-gui-script>
`;
};

export const componentScript = (target, phase, runtimeArch = "arm64") => {
  if (!destinations[target] || !["preinstall", "postinstall"].includes(phase) || !["x86_64", "arm64"].includes(runtimeArch)) throw new Error("Invalid package script input");
  const validate = target === "adobe" ? `
  for file in CSXS/manifest.xml main/index.html META-INF/signatures.xml; do [ -s "$tree/$file" ] || return 1; done
  [ "$(/usr/bin/xmllint --xpath 'string(/*/@ExtensionBundleId)' "$tree/CSXS/manifest.xml")" = 'com.rksound.designer' ]
` : `
  for file in manifest.xml package.json main.cjs preload.cjs ui/index.html WorkflowIntegration.node; do [ -s "$tree/$file" ] || return 1; done
  [ "$(/usr/bin/xmllint --xpath 'string(//Id)' "$tree/manifest.xml")" = 'com.sound.designer.resolve' ] || return 1
  /usr/bin/grep -Eq '"name"[[:space:]]*:[[:space:]]*"com\\.sound\\.designer\\.resolve"' "$tree/package.json" || return 1
  /usr/bin/lipo -verify_arch ${runtimeArch} "$tree/WorkflowIntegration.node"
`;
  const hostCheck = target === "adobe"
    ? `/usr/bin/pgrep -f '/Contents/MacOS/(After Effects|Adobe Premiere Pro)' >/dev/null`
    : `/usr/bin/pgrep -f '/Contents/MacOS/Resolve' >/dev/null`;
  const header = `#!/bin/bash
set -euo pipefail
umask 022
[ "\${3:-/}" = '/' ] || { echo 'Only the running system volume is supported.' >&2; exit 1; }
if ${hostCheck}; then echo 'Close selected ${target} applications before installing.' >&2; exit 1; fi
payload="$(/usr/bin/dirname "$0")/payload"
validate() {
  local tree="$1"
${validate}}
validate "$payload" || { echo 'Invalid ${target} payload.' >&2; exit 1; }
${target === "resolve" ? `/usr/bin/arch -${runtimeArch} /usr/bin/true || { echo 'Required Resolve architecture cannot run on this Mac.' >&2; exit 1; }` : ""}
`;
  if (phase === "preinstall") return header;
  return header + `destination='${destinations[target]}'
parent="$(/usr/bin/dirname "$destination")"
backup="$destination.previous"
lock="$destination.install-lock"
/bin/mkdir -p "$parent"
[ ! -L "$destination" ] && [ ! -L "$backup" ] || { echo 'Linked installation paths rejected.' >&2; exit 1; }
[ ! -e "$destination" ] || [ -d "$destination" ] || { echo 'Installation destination is not a directory.' >&2; exit 1; }
/bin/mkdir "$lock" || { echo 'Another installation or interrupted lock requires review.' >&2; exit 1; }
stage=''
moved=0
installed=0
cleanup() {
  code=$?
  trap - EXIT
  if [ "$code" -ne 0 ]; then
    if [ "$installed" -eq 1 ]; then /bin/mv "$destination" "$destination.failed.$(/usr/bin/uuidgen)"; fi
    if [ "$moved" -eq 1 ] && [ ! -e "$destination" ]; then /bin/mv "$backup" "$destination"; fi
  fi
  if [ -n "$stage" ] && [ -d "$stage" ]; then /bin/rm -rf "$stage"; fi
  /bin/rmdir "$lock"
  exit "$code"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
[ ! -e "$backup" ] || { echo "Retained recovery backup: $backup. Review it before retrying." >&2; exit 1; }
stage=$(/usr/bin/mktemp -d "$parent/.sounddesigner-${target}.XXXXXX")
/usr/bin/ditto "$payload" "$stage"
/usr/sbin/chown -R root:wheel "$stage"
/bin/chmod -R a+rX,go-w "$stage"
validate "$stage"
if [ -e "$destination" ]; then /bin/mv "$destination" "$backup"; moved=1; fi
/bin/mv "$stage" "$destination"
stage=''
installed=1
validate "$destination"
# A power interruption retains .previous; never destroy it on retry.
if [ "$moved" -eq 1 ]; then /bin/rm -rf "$backup"; fi
echo '${target} installed. Other targets and portable data are untouched.'
`;
};
