using System;
using System.IO;
using System.IO.Compression;

internal static class InstallerTests
{
    private static void Assert(bool value, string message) { if (!value) throw new Exception(message); }
    private static MemoryStream Payload(bool corrupt = false, bool traversal = false)
    {
        var bytes = new MemoryStream();
        using (var zip = new ZipArchive(bytes, ZipArchiveMode.Create, true)) {
            foreach (var file in new[] { "CSXS/manifest.xml", "main/index.html", "META-INF/signatures.xml" }) {
                using (var output = new StreamWriter(zip.CreateEntry(file).Open())) output.Write(file.Contains("manifest") ? "<ExtensionManifest ExtensionBundleId=\"" + (corrupt ? "wrong" : "com.rksound.designer") + "\"/>" : "fixture");
            }
            if (traversal) using (var output = new StreamWriter(zip.CreateEntry("../escaped.txt").Open())) output.Write("unsafe");
        }
        bytes.Position = 0; return bytes;
    }
    private static void Reject(Action action) { try { action(); } catch { return; } throw new Exception("Expected rejection"); }
    private static MemoryStream ResolvePayload(bool wrongPlatform = false)
    {
        var bytes = new MemoryStream();
        using (var zip = new ZipArchive(bytes, ZipArchiveMode.Create, true)) {
            foreach (var file in new[] { "manifest.xml", "package.json", "main.cjs", "preload.cjs", "ui/index.html" }) {
                using (var output = new StreamWriter(zip.CreateEntry(file).Open())) output.Write(file == "manifest.xml" ? "<WorkflowIntegration><Id>com.sound.designer.resolve</Id><Version>1.0.0</Version></WorkflowIntegration>" : file == "package.json" ? "{\"name\":\"com.sound.designer.resolve\",\"main\":\"main.cjs\",\"version\":\"1.0.0\"}" : "fixture");
            }
            using (var output = new BinaryWriter(zip.CreateEntry("WorkflowIntegration.node").Open())) {
                var pe = new byte[128]; pe[0] = wrongPlatform ? (byte)0xcf : (byte)0x4d; pe[1] = 0x5a; pe[60] = 64; pe[64] = 0x50; pe[65] = 0x45; pe[68] = 0x64; pe[69] = 0x86; output.Write(pe);
            }
        }
        bytes.Position = 0; return bytes;
    }
    public static void Main()
    {
        var mainSource = File.ReadAllText(Path.Combine(Directory.GetCurrentDirectory(), "resolve", "src", "main", "main.ts"));
        var iconBase64 = System.Text.RegularExpressions.Regex.Match(mainSource, "const WINDOW_ICON = nativeImage.createFromDataURL\\(\"data:image/png;base64,([^\"]+)\"\\)").Groups[1].Value;
        using (var bytes = new MemoryStream(Convert.FromBase64String(iconBase64)))
        using (var icon = new System.Drawing.Bitmap(bytes))
        using (var installerIcon = LogoArt.Create()) {
            Assert(icon.Width == 256 && icon.Height == 256, "Runtime icon must retain 256px detail");
            foreach (var image in new[] { icon, installerIcon }) {
                foreach (var point in new[] { new System.Drawing.Point(0, 0), new System.Drawing.Point(255, 0), new System.Drawing.Point(0, 255), new System.Drawing.Point(255, 255), new System.Drawing.Point(20, 20) })
                    Assert(image.GetPixel(point.X, point.Y).A == 0, "Dock, taskbar and installer icons must have transparent rounded corners");
                Assert(image.GetPixel(128, 128).A == 255, "Rounding must preserve the center of the icon");
            }
        }
        var root = Path.Combine(Path.GetTempPath(), "sounddesigner-installer-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try {
            var portable = Path.Combine(root, "portable"); Directory.CreateDirectory(portable);
            File.WriteAllText(Path.Combine(portable, "sounddesigner.json"), "user settings and media stay here");
            var adobe = Path.Combine(root, "adobe"); var resolve = Path.Combine(root, "resolve");
            Directory.CreateDirectory(resolve); File.WriteAllText(Path.Combine(resolve, "untouched"), "old");
            using (var archive = Payload()) InstallerTransaction.Install(archive, adobe, "adobe");
            Assert(File.ReadAllText(Path.Combine(resolve, "untouched")) == "old", "Unselected target changed");
            File.WriteAllText(Path.Combine(adobe, "old"), "recover me");
            using (var archive = Payload(true)) Reject(() => InstallerTransaction.Install(archive, adobe, "adobe"));
            Assert(File.Exists(Path.Combine(adobe, "old")), "Corrupt payload lost old install");
            using (var archive = Payload(false, true)) Reject(() => InstallerTransaction.Install(archive, adobe, "adobe"));
            Assert(!File.Exists(Path.Combine(root, "escaped.txt")), "Archive traversal escaped");
            using (var archive = Payload()) Reject(() => InstallerTransaction.Install(archive, adobe, "adobe", p => { throw new Exception("Injected post-swap failure"); }));
            Assert(File.ReadAllText(Path.Combine(adobe, "old")) == "recover me", "Post-swap rollback failed");
            Directory.CreateDirectory(adobe + ".previous");
            using (var archive = Payload()) Reject(() => InstallerTransaction.Install(archive, adobe, "adobe"));
            Assert(Directory.Exists(adobe + ".previous"), "Stale recovery backup destroyed");
            Directory.Delete(adobe + ".previous");
            using (var archive = Payload()) InstallerTransaction.Install(archive, adobe, "adobe");
            Assert(!File.Exists(Path.Combine(adobe, "old")), "Upgrade did not replace payload");
            Assert(!Directory.Exists(adobe + ".previous"), "Successful verification did not clean backup");
            using (var archive = Payload(true)) Reject(() => InstallerTransaction.Install(archive, resolve, "adobe"));
            Assert(File.Exists(Path.Combine(adobe, "CSXS", "manifest.xml")), "Failed second target rolled back success");
            using (var archive = ResolvePayload(true)) Reject(() => InstallerTransaction.Install(archive, resolve, "resolve"));
            Assert(File.Exists(Path.Combine(resolve, "untouched")), "Wrong native OS changed old Resolve install");
            using (var archive = ResolvePayload()) InstallerTransaction.Install(archive, resolve, "resolve");
            Assert(File.Exists(Path.Combine(resolve, "ui", "index.html")), "Resolve installation failed");
            Assert(File.Exists(Path.Combine(adobe, "CSXS", "manifest.xml")), "Both targets did not remain installed");
            Assert(File.ReadAllText(Path.Combine(portable, "sounddesigner.json")) == "user settings and media stay here", "Portable data changed during install/upgrade/rollback");
            Console.WriteLine("Windows installer transaction regressions passed (scratch directories only).");
        } finally { Directory.Delete(root, true); }
    }
}
