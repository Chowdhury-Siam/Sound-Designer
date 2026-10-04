// Input is already resolved by the host. POSIX backslashes are filename characters.
export const nativePathKey = (value: string, windows: boolean): string => {
  const normalized = (value.replace(windows ? /[\\/]+$/ : /\/+$/, "") || value).normalize("NFC");
  return windows ? normalized.toLocaleLowerCase("en-US") : normalized;
};
