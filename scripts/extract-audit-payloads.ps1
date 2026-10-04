param([string]$Source, [string]$Destination, [ValidateSet('zxp', 'windows-installer')][string]$Kind)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
function Expand-Safe([IO.Stream]$Stream, [string]$Folder) {
    [IO.Directory]::CreateDirectory($Folder) | Out-Null
    $prefix = [IO.Path]::GetFullPath($Folder) + [IO.Path]::DirectorySeparatorChar
    $archive = [IO.Compression.ZipArchive]::new($Stream, [IO.Compression.ZipArchiveMode]::Read, $true)
    try {
        foreach ($entry in $archive.Entries) {
            $file = [IO.Path]::GetFullPath([IO.Path]::Combine($Folder, $entry.FullName))
            if (-not $file.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or (($entry.ExternalAttributes -shr 16) -band 0xf000) -eq 0xa000) { throw 'Unsafe archive entry' }
            if ($entry.FullName.EndsWith('/')) { [IO.Directory]::CreateDirectory($file) | Out-Null; continue }
            [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file)) | Out-Null
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $file, $false)
        }
    } finally { $archive.Dispose() }
}
if ($Kind -eq 'zxp') {
    $stream = [IO.File]::OpenRead($Source)
    try { Expand-Safe $stream ([IO.Path]::Combine($Destination, 'adobe')) } finally { $stream.Dispose() }
} else {
    $assembly = [Reflection.Assembly]::LoadFile($Source)
    foreach ($name in $assembly.GetManifestResourceNames()) {
        if ($name -notin @('SoundDesigner.Extension.zxp', 'SoundDesigner.Resolve.zip', 'SoundDesigner.Logo.png', 'SoundDesigner.Adobe.png', 'SoundDesigner.Resolve.png')) { throw "Unexpected installer resource $name" }
    }
    [IO.File]::WriteAllText([IO.Path]::Combine($Destination, 'version.txt'), $assembly.GetName().Version.ToString())
    foreach ($hostName in @('adobe', 'resolve')) {
        $resource = if ($hostName -eq 'adobe') { 'SoundDesigner.Extension.zxp' } else { 'SoundDesigner.Resolve.zip' }
        $stream = $assembly.GetManifestResourceStream($resource)
        if (-not $stream) { throw "Missing installer resource $resource" }
        try { Expand-Safe $stream ([IO.Path]::Combine($Destination, $hostName)) } finally { $stream.Dispose() }
    }
}
