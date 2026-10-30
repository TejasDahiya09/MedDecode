import { describe, expect, it } from 'vitest';
import { fileSizeLabel, fileTypeLabel, maximumUploadBytes, validateUploadSelection } from '../../src/features/demo/upload-file';

describe('prescription metadata policy', () => {
  it.each([['pdf', 'application/pdf'], ['PNG', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['PDF', '']])('accepts supported %s metadata', (extension, type) => {
    expect(validateUploadSelection({ name: `synthetic.${extension}`, type, size: 512 })).toBe('');
  });
  it.each([['record.txt', 'text/plain'], ['record.pdf', 'image/png'], ['record', 'application/pdf'], ['record.pdf.exe', 'application/pdf']])('rejects unsupported or conflicting %s metadata', (name, type) => {
    expect(validateUploadSelection({ name, type, size: 512 })).toBe('Choose a JPG, PNG or PDF file.');
  });
  it('preserves the exact inclusive 10 MiB boundary and rejects empty/oversized files', () => {
    for (const size of [1, maximumUploadBytes]) expect(validateUploadSelection({ name: 'sample.pdf', type: 'application/pdf', size })).toBe('');
    for (const size of [0, maximumUploadBytes + 1]) expect(validateUploadSelection({ name: 'sample.pdf', type: 'application/pdf', size })).toBe('Choose a non-empty file up to 10 MB.');
  });
  it('rejects multiple files before selection', () => {
    expect(validateUploadSelection({ name: 'sample.pdf', type: '', size: 12 }, 2)).toBe('Choose one file at a time.');
  });
  it('labels sizes with accurate units and normalizes displayed type', () => {
    expect(fileSizeLabel(20)).toBe('20 B'); expect(fileSizeLabel(1536)).toBe('1.5 KiB');
    expect(fileSizeLabel(maximumUploadBytes)).toBe('10.0 MiB'); expect(fileTypeLabel('synthetic.Pdf')).toBe('PDF');
  });
});
