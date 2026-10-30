export const maximumUploadBytes = 10 * 1024 * 1024;
export function validateUploadSelection(file: Pick<File, 'name' | 'size' | 'type'>, count = 1): string {
  if (count !== 1) return 'Choose one file at a time.';
  const extension = file.name.split('.').at(-1)?.toLowerCase();
  const expected = extension === 'pdf' ? 'application/pdf' : extension === 'png' ? 'image/png' : ['jpg', 'jpeg'].includes(extension ?? '') ? 'image/jpeg' : null;
  if (!expected || (file.type && file.type !== expected)) return 'Choose a JPG, PNG or PDF file.';
  if (!file.size || file.size > maximumUploadBytes) return 'Choose a non-empty file up to 10 MB.';
  return '';
}
export function fileTypeLabel(name: string): string { return name.split('.').at(-1)?.toUpperCase() ?? 'Document'; }
export function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
