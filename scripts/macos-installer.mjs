import { cp, mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const destinations = {
  adobe: "/Library/Application Support/Adobe/CEP/extensions/com.rksound.designer",
  resolve: "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/com.sound.designer.resolve",
};

// Installer uses native text rendering, not a browser: RTFD keeps fonts and
// image attachments together without relying on HTML/CSS or relative URLs.
// Automatic text/background colors respect the user's light/dark appearance.
const brandedPage = (heading, content) => String.raw`{\rtf1\ansi\ansicpg1252\cocoartf2709
{\fonttbl\f0\fswiss Helvetica;}
{\colortbl;\red10\green111\blue216;}
\vieww10000\viewh8000\paperw10000\paperh8000\margl320\margr320\margt280\margb280
\pard\f0\fs36\cf0\sa160\b ${heading}\b0\par
\pard\fs22\sa160 ${content}
}`;

// AppKit puts these adjacent paragraphs in two vertically centered table
// cells during serialization. Do not rely on imported RTF cell boundaries.
const softwareRow = (logo, title, description) => String.raw`\pard\sb0\sa0\fs22 {{\NeXTGraphic ${logo} \width640 \height640}\'ac}\par
\pard\sb0\sa0\fs24\b ${title}\b0\line\fs22 ${description}\par
\pard\fs8\sb0\sa0\par`;

export const welcomeRtfd = brandedPage("Choose your software", String.raw`Select Adobe, Resolve, or both in \b Customize\b0 .\par
${softwareRow("adobe-symbol.png", "Premiere Pro / After Effects", "Inside your Adobe editing workspace.")}
${softwareRow("resolve.png", "DaVinci Resolve Studio", "Inside Workflow Integrations.")}
\pard\li0\fi0\fs22\sb360\sa80 Save your work. Quit selected applications with Command-Q.\par
\pard\fs20\sa0 Libraries, memories and settings stay untouched.\par`);

export const conclusionRtfd = brandedPage("Ready to create", String.raw`Open the applications you selected, then launch SoundDesigner:\par
${softwareRow("adobe-symbol.png", "Premiere Pro / After Effects", "Window > Extensions (or Extensions Legacy) > SoundDesigner")}
${softwareRow("resolve.png", "DaVinci Resolve Studio", "Workspace > Workflow Integrations > SoundDesigner")}
\pard\li0\fi0\fs22\sb360 Choose your audio library folder inside SoundDesigner.\par`);

// productbuild reads declared welcome/conclusion resources as files, not
// directory wrappers. Serialize the RTFD wrapper using Apple's native format.
export const flattenRtfdScript = `ObjC.import('AppKit');
function run(argv) {
  var error = Ref();
  var wrapper = $.NSFileWrapper.alloc.initWithURLOptionsError($.NSURL.fileURLWithPath(argv[0]), 0, error);
  if (!wrapper || !wrapper.isDirectory) throw new Error('Cannot read RTFD source');
  var data = wrapper.serializedRepresentation;
  var text = $.NSMutableAttributedString.alloc.initWithRTFDDocumentAttributes(data, null);
  if (!text || !text.length || !text.containsAttachments) throw new Error('Flattened RTFD lost its text or logo attachments');
  var plain = ObjC.unwrap(text.string);
  if (plain.indexOf('Premiere Pro / After Effects') < 0 || plain.indexOf('DaVinci Resolve Studio') < 0) throw new Error('Installer software names are missing');
  ['Premiere Pro / After Effects', 'DaVinci Resolve Studio'].forEach(function (title) {
    var index = text.string.rangeOfString(title).location;
    var logoIndex = plain.lastIndexOf('\uFFFC', index);
    var table = $.NSTextTable.alloc.init;
    table.numberOfColumns = 2;
    table.setContentWidthType(100, $.NSTextBlockPercentageValueType);
    [logoIndex, index].forEach(function (position, column) {
      if (position < 0) throw new Error('Installer logo is missing: ' + title);
      var attributes = text.attributesAtIndexEffectiveRange(position, null);
      var paragraph = attributes.objectForKey($.NSParagraphStyleAttributeName).mutableCopy;
      var cell = $.NSTextTableBlock.alloc.initWithTableStartingRowRowSpanStartingColumnColumnSpan(table, 0, 1, column, 1);
      cell.verticalAlignment = $.NSTextBlockMiddleAlignment;
      if (column === 0) {
        cell.setContentWidthType(32, $.NSTextBlockAbsoluteValueType);
        cell.setWidthTypeForLayerEdge(12, $.NSTextBlockAbsoluteValueType, $.NSTextBlockPadding, $.NSMaxXEdge);
      }
      paragraph.textBlocks = $([cell]);
      text.addAttributeValueRange($.NSParagraphStyleAttributeName, paragraph, text.string.paragraphRangeForRange($.NSMakeRange(position, 1)));
    });
  });
  // Let AppKit write its own RTF table dialect, then validate the actual
  // flattened resource, not just the mutable objects used to construct it.
  wrapper = text.RTFDFileWrapperFromRangeDocumentAttributes($.NSMakeRange(0, text.length), $({}));
  data = wrapper.serializedRepresentation;
  text = $.NSAttributedString.alloc.initWithRTFDDocumentAttributes(data, null);
  if (!text || !text.length || !text.containsAttachments) throw new Error('Serialized installer lost its text or logo attachments');
  plain = ObjC.unwrap(text.string);
  ['Premiere Pro / After Effects', 'DaVinci Resolve Studio'].forEach(function (title) {
    var index = text.string.rangeOfString(title).location;
    var cells = [plain.lastIndexOf('\uFFFC', index), index].map(function (position) {
      if (position < 0) throw new Error('Serialized installer logo is missing: ' + title);
      var paragraph = text.attributesAtIndexEffectiveRange(position, null).objectForKey($.NSParagraphStyleAttributeName);
      if (!paragraph || !paragraph.textBlocks.count) throw new Error('Installer software table was lost: ' + title);
      var cell = paragraph.textBlocks.objectAtIndex(0);
      if (cell.verticalAlignment !== $.NSTextBlockMiddleAlignment) throw new Error('Installer software cell is not vertically centered: ' + title);
      return cell;
    });
    if (cells[0].startingColumn !== 0 || cells[1].startingColumn !== 1 || !cells[0].table.isEqual(cells[1].table) || cells[0].startingRow !== cells[1].startingRow) throw new Error('Installer logo and text must share one table row: ' + title + ' (columns ' + cells[0].startingColumn + '/' + cells[1].startingColumn + ', rows ' + cells[0].startingRow + '/' + cells[1].startingRow + ', same table ' + cells[0].table.isEqual(cells[1].table) + ')');
  });
  ['adobe-symbol.png', 'resolve.png'].forEach(function (name) {
    var file = wrapper.fileWrappers.objectForKey(name);
    var image = $.NSImage.alloc.initWithData(file.regularFileContents);
    if (!image || Math.abs(image.size.width - 32) > 0.1 || Math.abs(image.size.height - 32) > 0.1) throw new Error('Installer logo must be 32pt at 72 DPI: ' + name);
  });
  if (!data || !data.length || !data.writeToFileAtomically(argv[1], true)) throw new Error('Cannot write flattened RTFD resource');
}`;

export const writeMacInstallerResources = async (resources, source) => {
  await mkdir(resources, { recursive: true });
  for (const [name, text] of [["welcome", welcomeRtfd], ["conclusion", conclusionRtfd]]) {
    const document = path.join(source, `${name}.rtfd`);
    await mkdir(document, { recursive: true });
    for (const asset of ["adobe-symbol.png", "resolve.png"]) {
      const copy = path.join(document, asset);
      await cp(new URL(`./installer-assets/${asset}`, import.meta.url), copy);
      // Installer can use intrinsic PNG dimensions instead of RTF width/height.
      // Normalize DPI too: the Adobe source is ~768 DPI, so a 32px copy at
      // that density is only ~3pt in AppKit. Keep shared source assets intact.
      const resized = spawnSync("/usr/bin/sips", ["--resampleHeightWidth", "32", "32", "--setProperty", "dpiWidth", "72", "--setProperty", "dpiHeight", "72", copy], { stdio: "inherit" });
      if (resized.error) throw resized.error;
      if (resized.status !== 0) throw new Error(`Resizing installer logo failed (${resized.status}).`);
    }
    await writeFile(path.join(document, "TXT.rtf"), text);
    const output = path.join(resources, `${name}.rtfd`);
    const result = spawnSync("/usr/bin/osascript", ["-l", "JavaScript", "-e", flattenRtfdScript, document, output], { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Flattening ${name} resource failed (${result.status}).`);
    const info = await stat(output);
    if (!info.isFile() || !info.size) throw new Error(`Installer resource must be a non-empty file: ${output}`);
  }
};

export const distributionXml = version => {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid installer version");
  return `<?xml version="1.0" encoding="UTF-8"?>
<installer-gui-script minSpecVersion="2">
 <title>SoundDesigner</title>
 <options customize="always" require-scripts="true" allow-external-scripts="false"/>
 <domains enable_anywhere="false" enable_currentUserHome="false" enable_localSystem="true"/>
 <welcome file="welcome.rtfd" uti="com.apple.flat-rtfd"/>
 <conclusion file="conclusion.rtfd" uti="com.apple.flat-rtfd"/>
 <volume-check script="checkChoices()"/>
 <choices-outline><line choice="adobe"/><line choice="resolve"/></choices-outline>
 <choice id="adobe" title="Adobe Premiere Pro / After Effects" description="${destinations.adobe}" selected="initialSelection('adobe')"><pkg-ref id="com.rksound.designer.pkg.adobe"/></choice>
 <choice id="resolve" title="DaVinci Resolve Studio" description="${destinations.resolve}" selected="initialSelection('resolve')"><pkg-ref id="com.sound.designer.pkg.resolve"/></choice>
 <pkg-ref id="com.rksound.designer.pkg.adobe" version="${version}" auth="Root">adobe.pkg</pkg-ref>
 <pkg-ref id="com.sound.designer.pkg.resolve" version="${version}" auth="Root">resolve.pkg</pkg-ref>
 <pkg-ref id="com.rksound.designer.pkg.adobe"><must-close><app id="com.adobe.AfterEffects"/><app id="com.adobe.PremierePro"/></must-close></pkg-ref>
 <pkg-ref id="com.sound.designer.pkg.resolve"><must-close><app id="com.blackmagic-design.DaVinciResolve"/></must-close></pkg-ref>
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
if ${hostCheck}; then echo 'Save your work and quit ${target === "adobe" ? "Adobe Premiere Pro and After Effects" : "DaVinci Resolve"} (Command-Q), including background windows, then run this installer again. No files have been changed by this component.' >&2; exit 1; fi
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
