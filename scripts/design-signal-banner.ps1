param(
  [string]$FontDirectory = 'C:/Users/Zan-getsu/.agents/skills/canvas-design/canvas-fonts',
  [string]$AssetDirectory = (Join-Path $PSScriptRoot '../.github/assets')
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
[System.Drawing.Text.PrivateFontCollection]::new().Dispose()
$drawingReferences = @('System.Drawing.Common', 'System.Drawing.Primitives', 'System.Runtime', 'System.Collections')
$windowsCore = [AppDomain]::CurrentDomain.GetAssemblies() | Where-Object {$_.GetName().Name -eq 'System.Private.Windows.Core'} | Select-Object -First 1
if ($windowsCore) { $drawingReferences += $windowsCore.Location }
Add-Type -ReferencedAssemblies $drawingReferences -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Globalization;
using System.Text;
public static class CampaignGlyphs {
  static string N(float n) { return n.ToString("0.###", CultureInfo.InvariantCulture); }
  public static float Width(string text, string fontFile, float size) {
    using (var fonts = new PrivateFontCollection()) {
      fonts.AddFontFile(fontFile);
      using (var path = new GraphicsPath()) {
        path.AddString(text, fonts.Families[0], 0, size, new PointF(0,0), StringFormat.GenericTypographic);
        return path.GetBounds().Width;
      }
    }
  }
  public static string Draw(string text, string fontFile, float size, float x, float y) {
    using (var fonts = new PrivateFontCollection()) {
      fonts.AddFontFile(fontFile);
      using (var path = new GraphicsPath()) {
        path.AddString(text, fonts.Families[0], 0, size, new PointF(0,0), StringFormat.GenericTypographic);
        var bounds = path.GetBounds();
        using (var matrix = new Matrix()) {
          matrix.Translate(x - bounds.Left, y - bounds.Top);
          path.Transform(matrix);
        }
        var pts = path.PathPoints; var types = path.PathTypes;
        var d = new StringBuilder();
        for (int i=0; i<pts.Length; i++) {
          int type = types[i] & 7;
          if (type==0 || type==1) {
            d.Append(type==0 ? "M" : "L").Append(N(pts[i].X)).Append(' ').Append(N(pts[i].Y));
          } else if (type==3) {
            if (i+2 >= pts.Length) throw new Exception("Truncated glyph bezier");
            d.Append("C").Append(N(pts[i].X)).Append(' ').Append(N(pts[i].Y)).Append(' ')
             .Append(N(pts[i+1].X)).Append(' ').Append(N(pts[i+1].Y)).Append(' ')
             .Append(N(pts[i+2].X)).Append(' ').Append(N(pts[i+2].Y));
            i += 2;
          } else throw new Exception("Unknown glyph path type");
          if ((types[i] & 128) != 0) d.Append('Z');
        }
        return d.ToString();
      }
    }
  }
}
'@

$body = Join-Path $FontDirectory 'WorkSans-Regular.ttf'
$bold = Join-Path $FontDirectory 'WorkSans-Bold.ttf'
$editorial = Join-Path $FontDirectory 'InstrumentSans-Regular.ttf'
$editorialBold = Join-Path $FontDirectory 'InstrumentSans-Bold.ttf'
function N([double]$v) {$v.ToString('0.###',[Globalization.CultureInfo]::InvariantCulture)}
function Add([string]$s) {[void]$script:svg.AppendLine($s)}
function Letter([string]$label,[double]$x,[double]$y,[double]$size,[string]$color,[string]$font=$body) {
  $e=[Security.SecurityElement]::Escape($label)
  $d=[CampaignGlyphs]::Draw($label,$font,$size,$x,$y)
  Add "<g aria-label='$e' data-lettering='true'><title>$e</title><path fill='$color' d='$d'/></g>"
}
function App([string]$kind,[double]$x,[double]$y) {
  if($kind -eq 'resolve') {
    $symbol=[xml][IO.File]::ReadAllText((Join-Path $AssetDirectory 'davinci-resolve-symbol.svg'))
    $m=$symbol.DocumentElement.InnerXml
    $m=[regex]::Replace($m,'id="([^"]+)"','id="host-$1"')
    $m=[regex]::Replace($m,'url\(#([^)]+)\)','url(#host-$1)')
    Add "<g transform='translate($x $y) scale(.28125)' aria-label='DaVinci Resolve application symbol'>$m</g>"
  } else {
    Add "<rect x='$x' y='$y' width='72' height='72' rx='13' fill='#00005b' stroke='#524f9e' stroke-opacity='.5' stroke-width='1'/>"
    $letters=if($kind -eq 'premiere'){'Pr'}else{'Ae'}
    Letter $letters ($x+12) ($y+17) 44 '#9999ff' $bold
  }
}
function Compose([string]$kind,[int]$height,[int]$offset) {
  $script:svg=[Text.StringBuilder]::new()
  $wordmark=[xml][IO.File]::ReadAllText((Join-Path $AssetDirectory 'SoundDesigner-wordmark.svg'))
  $headline=$wordmark.DocumentElement.SelectSingleNode("*[local-name()='path']").GetAttribute('d')
  $headlineTransform="translate(80 176) scale($(N (1640/3392)))"
  Add "<svg xmlns='http://www.w3.org/2000/svg' width='1800' height='$height' viewBox='0 0 1800 $height' role='img' aria-labelledby='signal-title signal-description'>"
  Add '<title id="signal-title">SoundDesigner — Find it. Shape it. Drop it into the edit.</title>'
  Add '<desc id="signal-description">The supplied cream SoundDesigner wordmark: Sound in SF Pro Display and Designer in Bodoni Moda. A fine blue signal ribbon passes behind the lettering; a small waveform is integrated within Sound. Supports Adobe Premiere Pro, Adobe After Effects, and DaVinci Resolve Studio. All artwork and lettering are vector paths.</desc>'
  Add "<defs><clipPath id='type-aperture'><path d='$headline' transform='$headlineTransform' clip-rule='evenodd'/></clipPath><clipPath id='sound-only'><rect x='78' y='175' width='651' height='254'/></clipPath><clipPath id='frame'><rect width='1800' height='$height'/></clipPath>"
  Add @'
<linearGradient id='signal-color' x1='78' y1='0' x2='1725' y2='0' gradientUnits='userSpaceOnUse'><stop stop-color='#3987ef'/><stop offset='.55' stop-color='#5aa8ff'/><stop offset='1' stop-color='#92d8ff'/></linearGradient>
<linearGradient id='ribbon-color' x1='689' y1='344' x2='1835' y2='142' gradientUnits='userSpaceOnUse'><stop stop-color='#3987ef'/><stop offset='.4' stop-color='#397acf'/><stop offset='.72' stop-color='#79bff3'/><stop offset='1' stop-color='#327cca'/></linearGradient>
<linearGradient id='divider-color' x1='84' y1='0' x2='1716' y2='0' gradientUnits='userSpaceOnUse'><stop stop-color='#7a93b0' stop-opacity='.5'/><stop offset='.7' stop-color='#7a93b0' stop-opacity='.2'/><stop offset='1' stop-color='#7a93b0' stop-opacity='.05'/></linearGradient>
</defs>
'@
  Add "<rect width='1800' height='$height' fill='#10141b'/>"
  Add "<g clip-path='url(#frame)'>"
  Add "<g transform='translate(0 $offset)'>"
  # The waveform becomes a ribbon: one continuous sound motif rather than two unrelated marks.
  # The changing width creates a deliberate sweep beneath the serif descender.
  Add "<g aria-label='Continuous sound ribbon' fill='none' stroke='url(#ribbon-color)' stroke-width='.9'>"
  for($i=0;$i -lt 37;$i++) {
    $q=$i-18
    $alpha=.18+.46*[Math]::Pow(($i/36),.7)
    Add "<path d='M689 $(N (344+$q*.35))C900 $(N (344+$q*.9)) 908 $(N (478+$q*1.4)) 1110 $(N (465+$q*1.4))C1350 $(N (450+$q*1.4)) 1365 $(N (142+$q*.9)) 1527 $(N (142+$q*.9))S1713 $(N (283+$q*.5)) 1835 $(N (283+$q*.5))' opacity='$(N $alpha)'/>"
  }
  Add '</g>'
  # The name is the artwork: one dominant typographic gesture rather than a repeated masthead.
  Add "<g aria-label='SoundDesigner' data-lettering='true'><title>SoundDesigner</title><path fill='#fffee5' fill-rule='evenodd' transform='$headlineTransform' d='$headline'/></g>"
  # A shaped cut follows the amplitude envelope instead of slicing the type with a rectangular band.
  Add "<g clip-path='url(#type-aperture)'>"
  Add "<g clip-path='url(#sound-only)'>"
  $cut=[Text.StringBuilder]::new('M78 448')
  for($i=0;$i -le 240;$i++) {
    $t=$i/240;$x=78+651*$t
    $e=.12+.55*[Math]::Exp(-[Math]::Pow(($t-.27)/.11,2))+.9*[Math]::Exp(-[Math]::Pow(($t-.73)/.15,2))
    [void]$cut.Append("L$(N $x) $(N (333-26*$e))")
  }
  [void]$cut.Append('L729 448Z')
  Add "<path d='$cut' fill='#10141b'/>"
  Add "<path d='M78 344H729' stroke='#568ec8' stroke-opacity='.32' stroke-width='1'/>"
  for($i=0;$i -lt 110;$i++) {
    $t=$i/109;$x=79+649*$t
    $envelope=.14+.6*[Math]::Exp(-[Math]::Pow(($t-.27)/.11,2))+.91*[Math]::Exp(-[Math]::Pow(($t-.73)/.15,2))
    $amp=5+37*$envelope*(.50+.50*[Math]::Abs([Math]::Sin($i*1.37)))
    Add "<path d='M$(N $x) $(N (344-$amp))V$(N (344+$amp))' stroke='url(#signal-color)' stroke-width='3.15' stroke-linecap='round'/>"
  }
  # A nearly invisible contour retains the descender and counters at small display sizes.
  Add "<path d='$headline' transform='$headlineTransform' fill='none' stroke='#a2c6ef' stroke-opacity='.13' stroke-width='1.5'/>"
  Add '</g></g>'
  # A single line of editorial copy sits in the quieter zone beneath the monumental name.
  Letter 'Find it. Shape it. Drop it into the edit.' 84 475 30 '#c0cad7' $editorial
  # Signature sound mark: tiny and deliberate, preserving clear visual weight for the wordmark.
  Add "<g transform='translate(84 67)' fill='none' stroke='#75bdff' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='M0 16h7l5-12 8 25 8-29 8 33 8-22 6 5h9'/></g>"
  $caption='Sound design, in your timeline.'
  Letter $caption (1716-[CampaignGlyphs]::Width($caption,$editorial,22)) 74 22 '#a5b3c5' $editorial
  Add '</g>'
  $rail=$height-164
  Add "<path d='M84 $rail H1716' stroke='url(#divider-color)' fill='none'/>"
  $y=$rail+43
  # A single aligned compatibility rail keeps all three hosts visually equal.
  Add "<g transform='translate(84 $y) scale(.75)'>"
  App 'premiere' 0 0
  Add '</g>'
  Letter 'Adobe' 160 ($y+1) 20 '#a6b2c5' $editorial
  Letter 'Premiere Pro' 160 ($y+27) 30 '#e7edf5' $editorialBold
  Add "<g transform='translate(628 $y) scale(.75)'>"
  App 'effects' 0 0
  Add '</g>'
  Letter 'Adobe' 704 ($y+1) 20 '#a6b2c5' $editorial
  Letter 'After Effects' 704 ($y+27) 30 '#e7edf5' $editorialBold
  Add "<g transform='translate(1172 $y) scale(.75)'>"
  App 'resolve' 0 0
  Add '</g>'
  Letter 'DaVinci' 1248 ($y+1) 20 '#a6b2c5' $editorial
  Letter 'Resolve Studio' 1248 ($y+27) 30 '#e7edf5' $editorialBold
  Add '</g></svg>'
  $out=Join-Path $AssetDirectory "SoundDesigner-signal-$kind.svg"
  [IO.File]::WriteAllText($out,$script:svg.ToString(),[Text.UTF8Encoding]::new($false))
  Write-Output "Created $out"
}
Compose 'banner' 720 0
Compose 'release' 900 86
