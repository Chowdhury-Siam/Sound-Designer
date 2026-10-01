using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Xml.Linq;

internal static class LogoArt
{
    internal static GraphicsPath RoundedRectangle(Rectangle bounds, int radius)
    {
        var path = new GraphicsPath();
        var diameter = radius * 2;
        path.AddArc(bounds.Left, bounds.Top, diameter, diameter, 180, 90);
        path.AddArc(bounds.Right - diameter, bounds.Top, diameter, diameter, 270, 90);
        path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(bounds.Left, bounds.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
    }

    internal static Bitmap Create()
    {
        var bitmap = new Bitmap(256, 256);
        using (var graphics = Graphics.FromImage(bitmap)) {
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            graphics.Clear(Color.Transparent);
            using (var shape = RoundedRectangle(new Rectangle(8, 8, 240, 240), 56))
            using (var fill = new SolidBrush(Color.FromArgb(26, 29, 34)))
            using (var border = new Pen(Color.FromArgb(53, 58, 66), 8F)) {
                graphics.FillPath(fill, shape);
                graphics.DrawPath(border, shape);
            }
            using (var waveform = new Pen(Color.FromArgb(243, 245, 247), 12F)) {
                waveform.StartCap = LineCap.Round;
                waveform.EndCap = LineCap.Round;
                waveform.LineJoin = LineJoin.Round;
                graphics.DrawLines(waveform, new[] {
                    new Point(56, 128), new Point(72, 128), new Point(84, 88), new Point(104, 168),
                    new Point(120, 72), new Point(140, 184), new Point(160, 96), new Point(176, 128), new Point(200, 128),
                });
            }
        }
        return bitmap;
    }

    internal static void Save(string directory)
    {
        Directory.CreateDirectory(directory);
        using (var bitmap = Create())
        using (var png = new MemoryStream()) {
            bitmap.Save(png, System.Drawing.Imaging.ImageFormat.Png);
            var bytes = png.ToArray();
            File.WriteAllBytes(Path.Combine(directory, "logo.png"), bytes);
            using (var output = File.Create(Path.Combine(directory, "logo.ico")))
            using (var icon = new BinaryWriter(output)) {
                icon.Write((ushort)0); icon.Write((ushort)1); icon.Write((ushort)1);
                icon.Write((byte)0); icon.Write((byte)0); icon.Write((byte)0); icon.Write((byte)0);
                icon.Write((ushort)1); icon.Write((ushort)32); icon.Write(bytes.Length); icon.Write(22); icon.Write(bytes);
            }
        }
    }
}

internal sealed class InstallerSurface : Panel
{
    internal InstallerSurface() { Dock = DockStyle.Fill; DoubleBuffered = true; }

    protected override void OnPaint(PaintEventArgs eventArgs)
    {
        base.OnPaint(eventArgs);
        var graphics = eventArgs.Graphics;
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
        graphics.CompositingQuality = CompositingQuality.HighQuality;
        var scale = DeviceDpi / 96F;
        var width = Width / scale;
        var height = Height / scale;
        graphics.ScaleTransform(scale, scale);
        using (var rail = new SolidBrush(Color.FromArgb(21, 23, 27))) graphics.FillRectangle(rail, 0, 54, 230, height - 54);
        using (var divider = new Pen(Color.FromArgb(40, 43, 49))) graphics.DrawLine(divider, 230, 54, 230, height);
        using (var border = new Pen(Color.FromArgb(55, 59, 67))) graphics.DrawRectangle(border, 0, 0, width - 1, height - 1);
        using (var mark = new Pen(Color.FromArgb(243, 245, 247), 3F)) {
            mark.StartCap = LineCap.Round; mark.EndCap = LineCap.Round; mark.LineJoin = LineJoin.Round;
            graphics.DrawLines(mark, new[] {
                new Point(42, 125), new Point(47, 125), new Point(50, 115), new Point(55, 135),
                new Point(59, 111), new Point(64, 140), new Point(69, 117), new Point(73, 125), new Point(80, 125),
            });
        }
        using (var waveform = new Pen(Color.FromArgb(70, 239, 241, 244), 1.5F)) {
            waveform.StartCap = LineCap.Round; waveform.EndCap = LineCap.Round;
            graphics.DrawLines(waveform, new[] {
                new Point(28, 314), new Point(45, 314), new Point(54, 296), new Point(66, 335),
                new Point(79, 278), new Point(92, 346), new Point(108, 300), new Point(121, 324),
                new Point(139, 287), new Point(153, 338), new Point(170, 305), new Point(187, 314), new Point(202, 314),
            });
        }
        using (var baseline = new Pen(Color.FromArgb(35, 239, 241, 244))) graphics.DrawLine(baseline, 28, 314, 202, 314);
        using (var state = new SolidBrush(Color.FromArgb(59, 214, 127))) graphics.FillEllipse(state, 29, 404, 7, 7);
    }
}

internal sealed class DesignerButton : Button
{
    internal bool Primary { get; set; }
    internal bool CloseIcon { get; set; }
    private bool hovered;
    private bool pressed;

    internal DesignerButton() { SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true); }
    protected override void OnMouseEnter(EventArgs e) { hovered = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hovered = false; pressed = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnMouseDown(MouseEventArgs e) { pressed = true; Invalidate(); base.OnMouseDown(e); }
    protected override void OnMouseUp(MouseEventArgs e) { pressed = false; Invalidate(); base.OnMouseUp(e); }
    protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
    protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }

    protected override void OnPaint(PaintEventArgs eventArgs)
    {
        var graphics = eventArgs.Graphics;
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        graphics.Clear(BackColor);
        var bounds = new Rectangle(0, 0, Width - 1, Height - 1);
        var background = CloseIcon
            ? pressed ? Color.FromArgb(45, 31, 34) : hovered ? Color.FromArgb(48, 38, 42) : Color.FromArgb(24, 26, 30)
            : !Enabled ? Color.FromArgb(28, 30, 34)
            : Primary ? pressed ? Color.FromArgb(211, 216, 221) : hovered ? Color.White : Color.FromArgb(239, 241, 244)
            : pressed ? Color.FromArgb(31, 34, 39) : hovered ? Color.FromArgb(48, 51, 57) : Color.FromArgb(38, 40, 45);
        var foreground = !Enabled ? Color.FromArgb(92, 97, 105) : Primary ? Color.FromArgb(17, 18, 20) : Color.FromArgb(239, 241, 244);
        if (CloseIcon) {
            using (var fill = new SolidBrush(background)) graphics.FillRectangle(fill, ClientRectangle);
            using (var pen = new Pen(foreground, 1.4F)) {
                graphics.DrawLine(pen, Width / 2 - 6, Height / 2 - 6, Width / 2 + 6, Height / 2 + 6);
                graphics.DrawLine(pen, Width / 2 + 6, Height / 2 - 6, Width / 2 - 6, Height / 2 + 6);
            }
            return;
        }
        using (var shape = LogoArt.RoundedRectangle(bounds, 8))
        using (var fill = new SolidBrush(background))
        using (var border = new Pen(Primary ? background : Color.FromArgb(66, 70, 78))) {
            graphics.FillPath(fill, shape); graphics.DrawPath(border, shape);
        }
        TextRenderer.DrawText(graphics, Text, Font, ClientRectangle, foreground, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.NoPadding);
        if (Focused && Enabled) using (var focus = new Pen(Color.FromArgb(59, 214, 127), 1F)) using (var shape = LogoArt.RoundedRectangle(new Rectangle(3, 3, Width - 7, Height - 7), 6)) graphics.DrawPath(focus, shape);
    }
}

internal sealed class InstallerForm : Form
{
    private readonly Label heading;
    private readonly Label detail;
    private readonly Label status;
    private readonly Panel progressTrack;
    private readonly Panel progressFill;
    private readonly Button installButton;
    private readonly Button cancelButton;
    private readonly Button closeButton;
    private bool installing;

    [DllImport("user32.dll")] private static extern bool ReleaseCapture();
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr handle, int message, IntPtr word, IntPtr data);
    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr handle, int attribute, ref int value, int size);

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        var enabled = 1; var rounded = 2;
        DwmSetWindowAttribute(Handle, 20, ref enabled, sizeof(int));
        DwmSetWindowAttribute(Handle, 33, ref rounded, sizeof(int));
    }

    internal InstallerForm(bool installImmediately)
    {
        Text = "SoundDesigner Setup";
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        BackColor = Color.FromArgb(15, 16, 18);
        ForeColor = Color.FromArgb(239, 241, 244);
        ClientSize = new Size(760, 470);
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 9F);
        AutoScaleDimensions = new SizeF(96F, 96F);
        AutoScaleMode = AutoScaleMode.Dpi;

        var surface = new InstallerSurface();
        var header = new Panel { BackColor = Color.FromArgb(24, 26, 30), Dock = DockStyle.Top, Height = 54 };
        var logo = new PictureBox { Image = LoadLogo(), BackColor = header.BackColor, Location = new Point(16, 11), Size = new Size(32, 32), SizeMode = PictureBoxSizeMode.Zoom };
        var brand = new Label { AutoSize = true, Font = new Font("Segoe UI Semibold", 10.5F), Location = new Point(58, 11), Text = "SoundDesigner" };
        var product = new Label { AutoSize = true, ForeColor = Color.FromArgb(143, 149, 158), Font = new Font("Segoe UI", 7.5F), Location = new Point(59, 31), Text = "ADOBE EXTENSION SETUP" };
        closeButton = MakeButton("", false, new Point(714, 0), new Size(46, 54));
        ((DesignerButton)closeButton).CloseIcon = true;
        closeButton.BackColor = header.BackColor;
        closeButton.Click += delegate { Close(); };
        header.MouseDown += DragWindow; brand.MouseDown += DragWindow; product.MouseDown += DragWindow;
        header.Controls.AddRange(new Control[] { logo, brand, product, closeButton });

        var railTitle = new Label { AutoSize = true, BackColor = Color.FromArgb(21, 23, 27), Font = new Font("Segoe UI Semibold", 16F), Location = new Point(26, 174), Text = "SoundDesigner" };
        var railDetail = new Label { AutoSize = false, BackColor = Color.FromArgb(21, 23, 27), ForeColor = Color.FromArgb(145, 151, 160), Font = new Font("Segoe UI", 9F), Location = new Point(29, 208), Size = new Size(175, 44), Text = "Find, preview and shape sound\nwithout leaving Adobe." };
        var host = new Label { AutoSize = true, BackColor = Color.FromArgb(21, 23, 27), ForeColor = Color.FromArgb(164, 169, 177), Font = new Font("Segoe UI", 8F), Location = new Point(44, 399), Text = "After Effects · Premiere Pro" };
        heading = new Label { AutoSize = false, Font = new Font("Segoe UI Semibold", 27F), Location = new Point(274, 94), Size = new Size(440, 106), Text = "Bring your sound library\ninto Adobe." };
        detail = new Label { AutoSize = false, ForeColor = Color.FromArgb(164, 169, 177), Font = new Font("Segoe UI", 9.5F), Location = new Point(278, 210), Size = new Size(430, 55), Text = "Install SoundDesigner for After Effects and Premiere Pro.\nYour existing projects and media remain untouched." };
        status = new Label { AutoSize = false, ForeColor = Color.FromArgb(184, 189, 196), Font = new Font("Segoe UI Semibold", 8.5F), Location = new Point(278, 303), Size = new Size(430, 22), Text = "READY TO INSTALL" };
        progressTrack = new Panel { BackColor = Color.FromArgb(45, 48, 54), Location = new Point(278, 334), Size = new Size(430, 4) };
        progressFill = new Panel { BackColor = Color.FromArgb(59, 214, 127), Location = new Point(0, 0), Size = new Size(0, 4) };
        progressTrack.Controls.Add(progressFill);
        var reassurance = new Label { AutoSize = true, ForeColor = Color.FromArgb(118, 124, 133), Font = new Font("Segoe UI", 8F), Location = new Point(278, 356), Text = "Signed extension · safe replacement · easy updates" };
        cancelButton = MakeButton("Cancel", false, new Point(486, 397), new Size(104, 42));
        cancelButton.Click += delegate { Close(); };
        installButton = MakeButton("Install", true, new Point(600, 397), new Size(108, 42));
        installButton.Click += InstallClicked;
        surface.Controls.AddRange(new Control[] { railTitle, railDetail, host, heading, detail, status, progressTrack, reassurance, cancelButton, installButton, header });
        Controls.Add(surface);
        AcceptButton = installButton; CancelButton = cancelButton; ActiveControl = installButton;
        FormClosing += delegate(object sender, FormClosingEventArgs e) { if (installing) e.Cancel = true; };
        if (installImmediately) Shown += async delegate { await InstallAsync(); };
    }

    private static Button MakeButton(string text, bool primary, Point location, Size size)
    {
        return new DesignerButton { Text = text, Primary = primary, Location = location, Size = size, Font = new Font("Segoe UI Semibold", 9F), Cursor = Cursors.Hand, BackColor = Color.FromArgb(15, 16, 18) };
    }

    private void DragWindow(object sender, MouseEventArgs e)
    {
        if (e.Button != MouseButtons.Left) return;
        ReleaseCapture(); SendMessage(Handle, 0x00A1, (IntPtr)2, IntPtr.Zero);
    }

    private static Image LoadLogo()
    {
        using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("SoundDesigner.Logo.png")) return Image.FromStream(stream).Clone() as Image;
    }

    private static bool IsAdministrator()
    {
        var identity = WindowsIdentity.GetCurrent();
        return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
    }

    private async void InstallClicked(object sender, EventArgs e)
    {
        if (installing) return;
        if (!IsAdministrator()) {
            try { Process.Start(new ProcessStartInfo(Application.ExecutablePath, "--install") { Verb = "runas", UseShellExecute = true }); Close(); }
            catch { SetFailure("Administrator permission was not granted."); }
            return;
        }
        await InstallAsync();
    }

    private async Task InstallAsync()
    {
        if (installing) return;
        installing = true;
        progressFill.BackColor = Color.FromArgb(59, 214, 127);
        installButton.Enabled = false; cancelButton.Enabled = false; closeButton.Enabled = false;
        heading.Text = "Connecting SoundDesigner\nto Adobe.";
        detail.Text = "The signed extension is being verified and installed in the background.";
        SetProgress(8, "CHECKING ADOBE APPLICATIONS...");
        try {
            await Task.Run((Action)InstallExtension);
            SetProgress(100, "INSTALLATION COMPLETE");
            heading.Text = "SoundDesigner\nis ready.";
            detail.Text = "Restart After Effects or Premiere Pro, then open\r\nWindow > Extensions > SoundDesigner.";
            installButton.Text = "Close"; installButton.Enabled = true; cancelButton.Visible = false; closeButton.Enabled = true;
            installButton.Click -= InstallClicked; installButton.Click += delegate { Close(); };
        } catch (Exception error) { SetFailure(error.Message); }
        finally { installing = false; }
    }

    private void InstallExtension()
    {
        if (Process.GetProcessesByName("AfterFX").Any() || Process.GetProcessesByName("Adobe Premiere Pro").Any()) throw new InvalidOperationException("Close After Effects and Premiere Pro, then try again.");
        UpdateProgress(22, "PREPARING THE SIGNED EXTENSION...");
        var common = Environment.GetFolderPath(Environment.SpecialFolder.CommonProgramFilesX86);
        if (String.IsNullOrWhiteSpace(common)) common = Environment.GetFolderPath(Environment.SpecialFolder.CommonProgramFiles);
        var extensionsRoot = Path.Combine(common, "Adobe", "CEP", "extensions");
        var staging = Path.Combine(extensionsRoot, ".sounddesigner-installing");
        var destination = Path.Combine(extensionsRoot, "com.rksound.designer");
        var backup = destination + ".previous";
        Directory.CreateDirectory(extensionsRoot);
        if (Directory.Exists(staging)) Directory.Delete(staging, true);
        var archive = Path.GetTempFileName();
        try {
            using (var input = Assembly.GetExecutingAssembly().GetManifestResourceStream("SoundDesigner.Extension.zxp"))
            using (var output = File.Create(archive)) input.CopyTo(output);
            ZipFile.ExtractToDirectory(archive, staging);
            UpdateProgress(58, "VERIFYING SOUNDDESIGNER...");
            var required = new[] { Path.Combine("CSXS", "manifest.xml"), Path.Combine("main", "index.html"), Path.Combine("META-INF", "signatures.xml") };
            foreach (var file in required) if (!File.Exists(Path.Combine(staging, file))) throw new InvalidDataException("The signed installer payload is incomplete: " + file + " is missing.");
            var manifest = XDocument.Load(Path.Combine(staging, "CSXS", "manifest.xml"));
            var extensionId = manifest.Root == null ? "" : (string)manifest.Root.Attribute("ExtensionBundleId");
            if (!String.Equals(extensionId, "com.rksound.designer", StringComparison.Ordinal)) throw new InvalidDataException("The installer payload has an unexpected extension ID.");
            if (Directory.Exists(backup)) Directory.Delete(backup, true);
            if (Directory.Exists(destination)) Directory.Move(destination, backup);
            UpdateProgress(78, "INSTALLING THE ADOBE EXTENSION...");
            try { Directory.Move(staging, destination); }
            catch { if (Directory.Exists(backup) && !Directory.Exists(destination)) Directory.Move(backup, destination); throw; }
            try { if (Directory.Exists(backup)) Directory.Delete(backup, true); } catch { }
        } finally {
            try { if (File.Exists(archive)) File.Delete(archive); } catch { }
            try { if (Directory.Exists(staging)) Directory.Delete(staging, true); } catch { }
        }
    }

    private void UpdateProgress(int percent, string message) { if (InvokeRequired) { BeginInvoke((Action)(() => SetProgress(percent, message))); return; } SetProgress(percent, message); }
    private void SetProgress(int percent, string message) { progressFill.Width = progressTrack.ClientSize.Width * Math.Max(0, Math.Min(100, percent)) / 100; status.Text = message; }
    private void SetFailure(string message)
    {
        heading.Text = "Installation stopped"; detail.Text = message;
        status.Text = "Resolve the issue and try again. Existing files were restored when needed.";
        progressFill.BackColor = Color.FromArgb(232, 91, 91);
        installButton.Text = "Try again"; installButton.Enabled = true; cancelButton.Text = "Close"; cancelButton.Enabled = true; closeButton.Enabled = true; installing = false;
    }
}

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length == 2 && args[0] == "--generate-assets") { LogoArt.Save(args[1]); return; }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new InstallerForm(args.Contains("--install")));
    }
}
