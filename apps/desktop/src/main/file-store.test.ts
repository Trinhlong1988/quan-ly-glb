// P2-02 (hardening 16/7): magic-bytes sniff — xác thực nội dung file, không tin đuôi. Vitest thuần.
import { describe, it, expect } from 'vitest';
import { sniffFileType } from './file-store.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7
const EXE = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // MZ (Windows PE) — .exe đổi đuôi thành .png
const TXT = Buffer.from('hello world nothing', 'utf8');

describe('sniffFileType — magic-bytes', () => {
  it('nhận đúng PNG / JPG / PDF theo chữ ký', () => {
    expect(sniffFileType(PNG)).toBe('png');
    expect(sniffFileType(JPG)).toBe('jpg');
    expect(sniffFileType(PDF)).toBe('pdf');
  });

  it('TỪ CHỐI file .exe (MZ) hay text đổi đuôi → null', () => {
    expect(sniffFileType(EXE)).toBeNull(); // đổi tên virus.exe → cccd.png sẽ bị bắt
    expect(sniffFileType(TXT)).toBeNull();
  });

  it('buffer quá ngắn → null (không crash)', () => {
    expect(sniffFileType(Buffer.from([0x89]))).toBeNull();
    expect(sniffFileType(Buffer.alloc(0))).toBeNull();
  });

  it('PDF phải có "-" sau %PDF (chống %PDF cụt)', () => {
    expect(sniffFileType(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00]))).toBeNull();
  });
});
