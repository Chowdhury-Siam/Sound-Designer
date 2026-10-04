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

// SoundDesigner main.scss tokens; keep setup visually aligned with the product.
internal static class SetupTheme
{
    internal static readonly Color Background = Color.FromArgb(29, 29, 29);
    internal static readonly Color Panel = Color.FromArgb(36, 36, 36);
    internal static readonly Color Raised = Color.FromArgb(41, 41, 41);
    internal static readonly Color Border = Color.FromArgb(75, 75, 75);
    internal static readonly Color Text = Color.FromArgb(229, 229, 229);
    internal static readonly Color Secondary = Color.FromArgb(184, 184, 184);
    internal static readonly Color Accent = Color.FromArgb(10, 111, 216);
    internal static readonly Color AccentStrong = Color.FromArgb(58, 145, 229);
}

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
            using (var fill = new SolidBrush(SetupTheme.Panel))
            using (var border = new Pen(SetupTheme.Border, 8F)) {
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
        using (var rail = new SolidBrush(SetupTheme.Panel)) graphics.FillRectangle(rail, 0, 54, 230, height - 54);
        using (var divider = new Pen(Color.FromArgb(48, 48, 48))) graphics.DrawLine(divider, 230, 54, 230, height);
        using (var footer = new SolidBrush(SetupTheme.Panel)) graphics.FillRectangle(footer, 231, height - 86, width - 231, 86);
        using (var border = new Pen(Color.FromArgb(55, 59, 67))) graphics.DrawRectangle(border, 0, 0, width - 1, height - 1);
        using (var mark = new Pen(Color.FromArgb(243, 245, 247), 3F)) {
            mark.StartCap = LineCap.Round; mark.EndCap = LineCap.Round; mark.LineJoin = LineJoin.Round;
            graphics.DrawLines(mark, new[] {
                new Point(42, 125), new Point(47, 125), new Point(50, 115), new Point(55, 135),
                new Point(59, 111), new Point(64, 140), new Point(69, 117), new Point(73, 125), new Point(80, 125),
            });
        }
        // A miniature audio editor, not an animated decoration or a running preview.
        using (var clip = LogoArt.RoundedRectangle(new Rectangle(26, 290, 178, 88), 9))
        using (var fill = new SolidBrush(SetupTheme.Background))
        using (var outline = new Pen(Color.FromArgb(55, 55, 55))) {
            graphics.FillPath(fill, clip); graphics.DrawPath(outline, clip);
        }
        using (var ruler = new Pen(Color.FromArgb(64, 64, 64))) {
            graphics.DrawLine(ruler, 38, 308, 192, 308);
            for (var x = 38; x <= 192; x += 22) graphics.DrawLine(ruler, x, 302, x, 308);
        }
        var levels = new[] { 8, 14, 24, 18, 38, 58, 42, 26, 16, 30, 48, 66, 50, 32, 20, 12, 6 };
        for (var i = 0; i < levels.Length; i++) {
            using (var bar = new Pen(Color.FromArgb(100 + levels[i] * 2, SetupTheme.AccentStrong), 3F)) {
                bar.StartCap = LineCap.Round; bar.EndCap = LineCap.Round;
                graphics.DrawLine(bar, 40 + i * 9, 343 - levels[i] / 3, 40 + i * 9, 343 + levels[i] / 3);
            }
        }
        using (var playhead = new Pen(SetupTheme.Text)) graphics.DrawLine(playhead, 104, 317, 104, 369);
        using (var state = new SolidBrush(SetupTheme.AccentStrong)) graphics.FillEllipse(state, 29, height - 49, 7, 7);
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
            ? pressed ? Color.FromArgb(55, 35, 35) : hovered ? Color.FromArgb(58, 42, 42) : SetupTheme.Panel
            : !Enabled ? Color.FromArgb(28, 30, 34)
            : Primary ? pressed ? Color.FromArgb(8, 88, 174) : hovered ? Color.FromArgb(21, 122, 224) : SetupTheme.Accent
            : pressed ? SetupTheme.Background : hovered ? Color.FromArgb(55, 55, 55) : SetupTheme.Raised;
        var foreground = !Enabled ? Color.FromArgb(143, 143, 143) : Primary ? Color.White : SetupTheme.Text;
        if (CloseIcon) {
            using (var fill = new SolidBrush(background)) graphics.FillRectangle(fill, ClientRectangle);
            using (var pen = new Pen(foreground, 1.4F)) {
                graphics.DrawLine(pen, Width / 2 - 6, Height / 2 - 6, Width / 2 + 6, Height / 2 + 6);
                graphics.DrawLine(pen, Width / 2 + 6, Height / 2 - 6, Width / 2 - 6, Height / 2 + 6);
            }
            if (Focused && Enabled) ControlPaint.DrawFocusRectangle(graphics, new Rectangle(5, 5, Width - 10, Height - 10), foreground, background);
            return;
        }
        using (var shape = LogoArt.RoundedRectangle(bounds, 8))
        using (var fill = new SolidBrush(background))
        using (var border = new Pen(Primary ? background : Color.FromArgb(66, 70, 78))) {
            graphics.FillPath(fill, shape); graphics.DrawPath(border, shape);
        }
        TextRenderer.DrawText(graphics, Text, Font, ClientRectangle, foreground, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.NoPadding);
        if (Focused && ShowFocusCues && Enabled) using (var focus = new Pen(SetupTheme.AccentStrong, 1F)) using (var shape = LogoArt.RoundedRectangle(new Rectangle(3, 3, Width - 7, Height - 7), 6)) graphics.DrawPath(focus, shape);
    }
}

// Keep native CheckBox input/accessibility semantics; only its presentation changes.
internal sealed class SoftwareChoice : CheckBox
{
    internal string Description { get; set; }
    internal Image SoftwareLogo { get; set; }
    protected override void Dispose(bool disposing) { if (disposing && SoftwareLogo != null) SoftwareLogo.Dispose(); base.Dispose(disposing); }
    private bool hovered;
    internal SoftwareChoice() {
        AutoSize = false; Cursor = Cursors.Hand;
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
    }
    protected override void OnMouseEnter(EventArgs e) { hovered = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hovered = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnCheckedChanged(EventArgs e) { Invalidate(); base.OnCheckedChanged(e); }
    protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
    protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }
    protected override void OnPaint(PaintEventArgs e) {
        var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias; g.Clear(BackColor);
        var scale = DeviceDpi / 96F;
        using (var shape = LogoArt.RoundedRectangle(new Rectangle(0, 0, Width - 1, Height - 1), (int)(10 * scale)))
        using (var fill = new SolidBrush(hovered ? Color.FromArgb(46, 46, 46) : SetupTheme.Raised))
        using (var border = new Pen(Focused ? SetupTheme.AccentStrong : Checked ? Color.FromArgb(64, 92, 122) : SetupTheme.Border, Focused ? 2F : 1F)) {
            g.FillPath(fill, shape); g.DrawPath(border, shape);
        }
        var tile = new Rectangle((int)(16 * scale), (int)(17 * scale), (int)(42 * scale), (int)(42 * scale));
        using (var shape = LogoArt.RoundedRectangle(tile, (int)(8 * scale)))
        using (var fill = new SolidBrush(SetupTheme.Panel)) g.FillPath(fill, shape);
        if (SoftwareLogo != null) {
            var inset = 5 * scale;
            var fit = Math.Min((tile.Width - inset * 2) / SoftwareLogo.Width, (tile.Height - inset * 2) / SoftwareLogo.Height);
            var w = SoftwareLogo.Width * fit; var h = SoftwareLogo.Height * fit;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.DrawImage(SoftwareLogo, tile.X + (tile.Width - w) / 2, tile.Y + (tile.Height - h) / 2, w, h);
        }
        var box = new Rectangle(Width - (int)(38 * scale), (Height - (int)(20 * scale)) / 2, (int)(20 * scale), (int)(20 * scale));
        using (var shape = LogoArt.RoundedRectangle(box, (int)(5 * scale)))
        using (var fill = new SolidBrush(Checked && Enabled ? SetupTheme.Accent : SetupTheme.Panel))
        using (var outline = new Pen(Checked && Enabled ? SetupTheme.Accent : SetupTheme.Secondary)) {
            g.FillPath(fill, shape); g.DrawPath(outline, shape);
        }
        if (Checked) using (var check = new Pen(Enabled ? Color.White : SetupTheme.Secondary, 1.7F * scale)) {
            check.StartCap = LineCap.Round; check.EndCap = LineCap.Round;
            g.DrawLines(check, new[] { new PointF(box.X + 5 * scale, box.Y + 10 * scale), new PointF(box.X + 9 * scale, box.Y + 14 * scale), new PointF(box.X + 15 * scale, box.Y + 6 * scale) });
        }
        var color = Enabled ? SetupTheme.Text : SetupTheme.Secondary;
        var flags = TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix;
        TextRenderer.DrawText(g, Text, Font, new Rectangle((int)(74 * scale), (int)(14 * scale), Width - (int)(126 * scale), (int)(24 * scale)), color, flags);
        using (var caption = new Font("Segoe UI", 9F)) TextRenderer.DrawText(g, Description, caption, new Rectangle((int)(74 * scale), (int)(41 * scale), Width - (int)(126 * scale), (int)(22 * scale)), SetupTheme.Secondary, flags);
    }
}

internal sealed class InstallerForm : Form
{
    private readonly Label heading;
    private readonly TextBox detail;
    private readonly Label status;
    private readonly Panel progressTrack;
    private readonly Panel progressFill;
    private readonly Button installButton;
    private readonly Button cancelButton;
    private readonly Button closeButton;
    private bool installing;
    private readonly CheckBox adobeChoice;
    private readonly CheckBox resolveChoice;

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

    internal InstallerForm(bool installImmediately, bool adobe, bool resolve, bool explicitChoices)
    {
        Text = "SoundDesigner Setup";
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        BackColor = SetupTheme.Background;
        ForeColor = SetupTheme.Text;
        ClientSize = new Size(820, 600);
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 9F);
        AutoScaleDimensions = new SizeF(96F, 96F);
        AutoScaleMode = AutoScaleMode.Dpi;

        var surface = new InstallerSurface();
        var header = new Panel { BackColor = SetupTheme.Panel, Dock = DockStyle.Top, Height = 54, TabIndex = 5 };
        var logo = new PictureBox { Image = LoadLogo(), BackColor = header.BackColor, Location = new Point(16, 11), Size = new Size(32, 32), SizeMode = PictureBoxSizeMode.Zoom };
        var brand = new Label { AutoSize = true, Font = new Font("Segoe UI Semibold", 10.5F), Location = new Point(58, 11), Text = "SoundDesigner" };
        var product = new Label { AutoSize = true, ForeColor = Color.FromArgb(143, 149, 158), Font = new Font("Segoe UI", 7.5F), Location = new Point(59, 31), Text = "ADOBE + RESOLVE SETUP" };
        closeButton = MakeButton("", false, new Point(774, 0), new Size(46, 54));
        closeButton.AccessibleName = "Close setup";
        ((DesignerButton)closeButton).CloseIcon = true;
        closeButton.BackColor = header.BackColor;
        closeButton.Click += delegate { Close(); };
        header.MouseDown += DragWindow; brand.MouseDown += DragWindow; product.MouseDown += DragWindow;
        header.Controls.AddRange(new Control[] { logo, brand, product, closeButton });

        var railTitle = new Label { AutoSize = true, BackColor = SetupTheme.Panel, Font = new Font("Segoe UI Semibold", 16F), Location = new Point(26, 174), Text = "SoundDesigner" };
        var railDetail = new Label { AutoSize = false, BackColor = SetupTheme.Panel, ForeColor = SetupTheme.Secondary, Font = new Font("Segoe UI", 10F), Location = new Point(29, 212), Size = new Size(175, 68), Text = "Your sounds. Your workflow.\nFind, preview and create." };
        var host = new Label { AutoSize = true, BackColor = SetupTheme.Panel, ForeColor = SetupTheme.Secondary, Font = new Font("Segoe UI", 8F), Location = new Point(44, 549), Text = "Adobe · DaVinci Resolve" };
        heading = new Label { AutoSize = false, Font = new Font("Segoe UI Semibold", 23F), Location = new Point(274, 79), Size = new Size(490, 44), Text = "Choose your software" };
        var introduction = new Label { AutoSize = false, ForeColor = SetupTheme.Secondary, Location = new Point(278, 132), Size = new Size(490, 24), Text = "Bring SoundDesigner into your workspace. Select one or both." };
        adobeChoice = new SoftwareChoice { Text = "Premiere Pro / After Effects", SoftwareLogo = LoadLogo("SoundDesigner.Adobe.png"), Description = "Adobe editing workspace", Font = new Font("Segoe UI Semibold", 11F), Location = new Point(278, 170), Size = new Size(490, 76), Checked = explicitChoices ? adobe : InstallerTransaction.DetectedAdobe(), TabIndex = 0, AccessibleDescription = "Select to install for Adobe Premiere Pro and After Effects." };
        resolveChoice = new SoftwareChoice { Text = "DaVinci Resolve Studio", SoftwareLogo = LoadLogo("SoundDesigner.Resolve.png"), Description = "Workflow Integrations", Font = new Font("Segoe UI Semibold", 11F), Location = new Point(278, 258), Size = new Size(490, 76), Checked = explicitChoices ? resolve : InstallerTransaction.DetectedResolve(), TabIndex = 1, AccessibleDescription = "Select to install for DaVinci Resolve Studio." };
        var locations = new LinkLabel { AutoSize = true, Text = "View install locations", LinkBehavior = LinkBehavior.HoverUnderline, Location = new Point(278, 352), LinkColor = SetupTheme.AccentStrong, ActiveLinkColor = Color.White, VisitedLinkColor = SetupTheme.AccentStrong, TabIndex = 2 };
        detail = new TextBox { ReadOnly = true, Multiline = true, BorderStyle = BorderStyle.None, ScrollBars = ScrollBars.None, BackColor = BackColor, ForeColor = SetupTheme.Secondary, Font = new Font("Segoe UI", 9F), Location = new Point(278, 390), Size = new Size(490, 56), TabIndex = 6, AccessibleName = "Installation details" };
        EventHandler showDestinations = delegate { detail.ScrollBars = ScrollBars.None; detail.Text = adobeChoice.Checked || resolveChoice.Checked ? "Your audio libraries, memories and settings stay untouched.\r\nChoose your audio library folder inside SoundDesigner." : "Select at least one application to continue.\r\nYou can install for both Adobe and DaVinci Resolve."; };
        locations.LinkClicked += delegate { MessageBox.Show(this, (adobeChoice.Checked ? "Adobe:\r\n" + InstallerTransaction.AdobeDestination + "\r\n\r\n" : "") + (resolveChoice.Checked ? "DaVinci Resolve Studio:\r\n" + InstallerTransaction.ResolveDestination : "") + (!adobeChoice.Checked && !resolveChoice.Checked ? "Select software to view its install location." : ""), "Install locations", MessageBoxButtons.OK, MessageBoxIcon.Information); };
        adobeChoice.CheckedChanged += showDestinations; resolveChoice.CheckedChanged += showDestinations; showDestinations(null, EventArgs.Empty);
        status = new Label { AutoSize = false, ForeColor = Color.FromArgb(184, 189, 196), Font = new Font("Segoe UI Semibold", 8.5F), Location = new Point(278, 453), Size = new Size(490, 34), Text = "Ready when you are" };
        progressTrack = new Panel { Visible = false, BackColor = Color.FromArgb(48, 48, 48), Location = new Point(278, 493), Size = new Size(490, 4) };
        progressFill = new Panel { BackColor = SetupTheme.Accent, Location = new Point(0, 0), Size = new Size(0, 4) };
        progressTrack.Controls.Add(progressFill);
        var reassurance = new Label { AutoSize = false, BackColor = SetupTheme.Panel, ForeColor = SetupTheme.Secondary, Font = new Font("Segoe UI", 8F), Location = new Point(278, 530), Size = new Size(220, 38), Text = "Installs for all users.\r\nWindows will ask for permission." };
        cancelButton = MakeButton("Cancel", false, new Point(512, 530), new Size(104, 42));
        cancelButton.TabIndex = 3;
        cancelButton.Click += delegate { Close(); };
        installButton = MakeButton("Install", true, new Point(628, 530), new Size(140, 42));
        installButton.TabIndex = 4;
        installButton.Click += InstallClicked;
        surface.Controls.AddRange(new Control[] { railTitle, railDetail, host, heading, introduction, adobeChoice, resolveChoice, locations, detail, status, progressTrack, reassurance, cancelButton, installButton, header });
        Controls.Add(surface);
        AcceptButton = installButton; CancelButton = cancelButton; ActiveControl = adobeChoice;
        FormClosing += delegate(object sender, FormClosingEventArgs e) { if (installing) e.Cancel = true; };
        if (installImmediately) Shown += async delegate { await InstallAsync(); };
    }

    private static Button MakeButton(string text, bool primary, Point location, Size size)
    {
        return new DesignerButton { Text = text, Primary = primary, Location = location, Size = size, Font = new Font("Segoe UI Semibold", 10F), Cursor = Cursors.Hand, BackColor = SetupTheme.Panel };
    }

    private void DragWindow(object sender, MouseEventArgs e)
    {
        if (e.Button != MouseButtons.Left) return;
        ReleaseCapture(); SendMessage(Handle, 0x00A1, (IntPtr)2, IntPtr.Zero);
    }

    private static Image LoadLogo(string resource = "SoundDesigner.Logo.png")
    {
        using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(resource))
        using (var image = Image.FromStream(stream)) return (Image)image.Clone();
    }

    private static bool IsAdministrator()
    {
        var identity = WindowsIdentity.GetCurrent();
        return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
    }

    private async void InstallClicked(object sender, EventArgs e)
    {
        if (installing) return;
        if (!adobeChoice.Checked && !resolveChoice.Checked) { SetFailure("Select at least one application."); return; }
        if (!IsAdministrator()) {
            var choices = "--install --choices" + (adobeChoice.Checked ? " --adobe" : "") + (resolveChoice.Checked ? " --resolve" : "");
            try { Process.Start(new ProcessStartInfo(Application.ExecutablePath, choices) { Verb = "runas", UseShellExecute = true }); Close(); }
            catch { SetFailure("Administrator permission was not granted."); }
            return;
        }
        await InstallAsync();
    }

    private async Task InstallAsync()
    {
        if (installing) return;
        if (!adobeChoice.Checked && !resolveChoice.Checked) { SetFailure("Select at least one application."); return; }
        var adobe = adobeChoice.Checked; var resolve = resolveChoice.Checked;
        installing = true;
        adobeChoice.Enabled = false; resolveChoice.Enabled = false;
        progressFill.BackColor = SetupTheme.Accent;
        progressTrack.Visible = true;
        detail.ScrollBars = ScrollBars.None;
        installButton.Enabled = false; cancelButton.Enabled = false; closeButton.Enabled = false;
        heading.Text = "Installing SoundDesigner";
        detail.Text = "The signed extension is being verified and installed in the background.";
        SetProgress(8, "Checking selected applications...");
        try {
            await Task.Run(() => InstallSelected(adobe, resolve));
            SetProgress(100, "INSTALLATION COMPLETE");
            heading.Text = "You're ready to create.";
            detail.Text = "Restart your selected software. Adobe: Window > Extensions > SoundDesigner. Resolve: Workspace > Workflow Integrations > SoundDesigner.";
            installButton.Text = "Close"; installButton.Enabled = true; cancelButton.Visible = false; closeButton.Enabled = true;
            installButton.Click -= InstallClicked; installButton.Click += delegate { Close(); };
        } catch (Exception error) { SetFailure(error.Message); }
        finally { installing = false; adobeChoice.Enabled = true; resolveChoice.Enabled = true; }
    }

    private void InstallSelected(bool adobe, bool resolve)
    {
        var errors = new System.Collections.Generic.List<string>();
        foreach (var target in new[] { "adobe", "resolve" }) {
            if (target == "adobe" ? !adobe : !resolve) continue;
            try {
                if (target == "adobe" ? Process.GetProcessesByName("AfterFX").Any() || Process.GetProcessesByName("Adobe Premiere Pro").Any() : Process.GetProcessesByName("Resolve").Any()) throw new InvalidOperationException("Close " + (target == "adobe" ? "Premiere Pro and After Effects" : "DaVinci Resolve Studio") + " and try again.");
                using (var input = Assembly.GetExecutingAssembly().GetManifestResourceStream(target == "adobe" ? "SoundDesigner.Extension.zxp" : "SoundDesigner.Resolve.zip")) {
                    if (input == null) throw new InvalidDataException("The " + target + " payload is missing.");
                    InstallerTransaction.Install(input, target == "adobe" ? InstallerTransaction.AdobeDestination : InstallerTransaction.ResolveDestination, target);
                }
                UpdateProgress(target == "adobe" ? 55 : 90, target.ToUpperInvariant() + " INSTALLED");
            } catch (Exception error) { errors.Add(target + ": " + error.Message); }
        }
        if (errors.Any()) throw new InvalidOperationException(String.Join("\r\n", errors) + "\r\nSuccessful targets remain installed. Retry only failed targets.");
    }

    private void UpdateProgress(int percent, string message) { if (InvokeRequired) { BeginInvoke((Action)(() => SetProgress(percent, message))); return; } SetProgress(percent, message); }
    private void SetProgress(int percent, string message) { progressFill.Width = progressTrack.ClientSize.Width * Math.Max(0, Math.Min(100, percent)) / 100; status.Text = message; }
    private void SetFailure(string message)
    {
        heading.Text = "Installation stopped"; detail.ScrollBars = ScrollBars.Vertical; detail.Text = message;
        status.Text = "Resolve the issue and try again. Existing files were restored when needed.";
        progressFill.BackColor = Color.FromArgb(232, 91, 91);
        installButton.Text = "Try again"; installButton.Enabled = true; cancelButton.Text = "Close"; cancelButton.Enabled = true; closeButton.Enabled = true; installing = false;
    }
}

internal static class InstallerTransaction
{
    internal static string AdobeDestination { get { var common = Environment.GetFolderPath(Environment.SpecialFolder.CommonProgramFilesX86); if (String.IsNullOrWhiteSpace(common)) common = Environment.GetFolderPath(Environment.SpecialFolder.CommonProgramFiles); if (String.IsNullOrWhiteSpace(common)) throw new IOException("Common Program Files is unavailable."); return Path.Combine(common, "Adobe", "CEP", "extensions", "com.rksound.designer"); } }
    internal static string ResolveDestination { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Blackmagic Design", "DaVinci Resolve", "Support", "Workflow Integration Plugins", "com.sound.designer.resolve"); } }
    internal static bool DetectedAdobe() { var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Adobe"); return Directory.Exists(root) && Directory.GetDirectories(root).Any(p => Path.GetFileName(p).StartsWith("Adobe After Effects") || Path.GetFileName(p).StartsWith("Adobe Premiere Pro")); }
    internal static bool DetectedResolve() { return File.Exists(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Blackmagic Design", "DaVinci Resolve", "Resolve.exe")); }

    internal static void Validate(string directory, string target)
    {
        if (target != "adobe" && target != "resolve") throw new InvalidDataException("Unknown installer target.");
        var required = target == "adobe" ? new[] { "CSXS/manifest.xml", "main/index.html", "META-INF/signatures.xml" }
            : new[] { "manifest.xml", "package.json", "main.cjs", "preload.cjs", "ui/index.html", "WorkflowIntegration.node" };
        foreach (var file in required) if (!File.Exists(Path.Combine(directory, file)) || new FileInfo(Path.Combine(directory, file)).Length == 0) throw new InvalidDataException("Missing or empty payload file: " + file);
        var manifest = XDocument.Load(Path.Combine(directory, target == "adobe" ? "CSXS/manifest.xml" : "manifest.xml"));
        var id = target == "adobe" ? (string)manifest.Root.Attribute("ExtensionBundleId") : manifest.Descendants("Id").Select(e => e.Value).FirstOrDefault();
        if (id != (target == "adobe" ? "com.rksound.designer" : "com.sound.designer.resolve")) throw new InvalidDataException("Unexpected payload ID.");
        if (target == "resolve") {
            using (var reader = new BinaryReader(File.OpenRead(Path.Combine(directory, "WorkflowIntegration.node")))) {
                if (reader.BaseStream.Length < 64 || reader.ReadUInt16() != 0x5a4d) throw new InvalidDataException("Resolve requires a Windows native module.");
                reader.BaseStream.Position = 60; var offset = reader.ReadUInt32();
                if (offset + 6L > reader.BaseStream.Length) throw new InvalidDataException("Invalid native module header.");
                reader.BaseStream.Position = offset;
                if (reader.ReadUInt32() != 0x4550 || reader.ReadUInt16() != 0x8664) throw new InvalidDataException("This Windows candidate requires an x64 Resolve native module.");
            }
            if (!Environment.Is64BitOperatingSystem) throw new InvalidDataException("Resolve requires a 64-bit Windows host.");
            var package = new System.Web.Script.Serialization.JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string, object>>(File.ReadAllText(Path.Combine(directory, "package.json")));
            if (!package.ContainsKey("name") || !Object.Equals(package["name"], "com.sound.designer.resolve") || !package.ContainsKey("main") || !Object.Equals(package["main"], "main.cjs") || !package.ContainsKey("version") || !Object.Equals(package["version"], manifest.Descendants("Version").Select(e => e.Value).FirstOrDefault())) throw new InvalidDataException("Unexpected Resolve package ID, entry or version.");
        }
    }

    internal static void Install(Stream archive, string destination, string target, Action<string> verify = null)
    {
        destination = Path.GetFullPath(destination);
        var parent = Path.GetDirectoryName(destination);
        Directory.CreateDirectory(parent);
        if (Directory.Exists(destination) && (File.GetAttributes(destination) & FileAttributes.ReparsePoint) != 0) throw new IOException("Refusing a linked installation directory.");
        var backup = destination + ".previous";
        var staging = destination + ".installing-" + Guid.NewGuid().ToString("N");
        var lockPath = destination + ".install-lock";
        using (var installLock = new FileStream(lockPath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None)) {
            if (Directory.Exists(backup)) throw new IOException("Previous recovery backup retained at " + backup + ". Inspect and restore it before retrying.");
            Directory.CreateDirectory(staging);
            try {
                using (var zip = new ZipArchive(archive, ZipArchiveMode.Read, true)) {
                    foreach (var entry in zip.Entries) {
                        var output = Path.GetFullPath(Path.Combine(staging, entry.FullName));
                        if (!output.StartsWith(staging + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || (entry.ExternalAttributes >> 16 & 0xf000) == 0xa000) throw new InvalidDataException("Unsafe archive entry.");
                        if (entry.FullName.EndsWith("/")) { Directory.CreateDirectory(output); continue; }
                        Directory.CreateDirectory(Path.GetDirectoryName(output));
                        entry.ExtractToFile(output, false);
                    }
                }
                Validate(staging, target);
                if (Directory.Exists(destination)) Directory.Move(destination, backup);
                try {
                    Directory.Move(staging, destination);
                    Validate(destination, target);
                    if (verify != null) verify(destination);
                } catch {
                    if (Directory.Exists(destination)) Directory.Move(destination, destination + ".failed-" + Guid.NewGuid().ToString("N"));
                    if (Directory.Exists(backup)) Directory.Move(backup, destination);
                    throw;
                }
                try { if (Directory.Exists(backup)) Directory.Delete(backup, true); } catch { /* Keep recoverable backup on cleanup failure. */ }
            } finally { if (Directory.Exists(staging)) Directory.Delete(staging, true); }
        }
        // Keep the lock file: deleting it can race another waiting installer.
    }
}

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length == 2 && args[0] == "--generate-assets") { LogoArt.Save(args[1]); return; }
        if (args.Contains("--verify-payloads")) {
            var scratch = Path.Combine(Path.GetTempPath(), "sounddesigner-payload-audit-" + Guid.NewGuid().ToString("N"));
            try {
                foreach (var target in new[] { "adobe", "resolve" }) using (var archive = Assembly.GetExecutingAssembly().GetManifestResourceStream(target == "adobe" ? "SoundDesigner.Extension.zxp" : "SoundDesigner.Resolve.zip")) {
                    if (archive == null) throw new InvalidDataException("Missing embedded payload");
                    var destination = Path.Combine(scratch, target);
                    InstallerTransaction.Install(archive, destination, target);
                    var manifest = XDocument.Load(Path.Combine(destination, target == "adobe" ? "CSXS/manifest.xml" : "manifest.xml"));
                    var version = Assembly.GetExecutingAssembly().GetName().Version.ToString(3);
                    var payloadVersion = target == "adobe" ? (string)manifest.Root.Attribute("ExtensionBundleVersion") : manifest.Descendants("Version").Select(e => e.Value).FirstOrDefault();
                    if (payloadVersion != version) throw new InvalidDataException(target + " payload version does not match installer.");
                }
            } catch { Environment.ExitCode = 1; }
            finally { if (Directory.Exists(scratch)) Directory.Delete(scratch, true); }
            return;
        }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        if (args.Length == 2 && args[0] == "--screenshot") {
            using (var form = new InstallerForm(false, true, true, true)) {
                form.Shown += delegate {
                    form.BeginInvoke((Action)(() => {
                        using (var image = new Bitmap(form.Width, form.Height)) {
                            form.DrawToBitmap(image, new Rectangle(Point.Empty, form.Size));
                            image.Save(args[1], System.Drawing.Imaging.ImageFormat.Png);
                        }
                        form.Close();
                    }));
                };
                Application.Run(form);
            }
            return;
        }
        Application.Run(new InstallerForm(args.Contains("--install"), args.Contains("--adobe"), args.Contains("--resolve"), args.Contains("--choices")));
    }
}
