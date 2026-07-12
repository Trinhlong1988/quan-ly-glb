import { describe, it, expect } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_CODES } from '@glb/shared';

// Chặn lớp lỗi "gán default một quyền KHÔNG tồn tại trong catalog": mọi mã trong
// DEFAULT_ROLE_PERMISSIONS (mọi role) phải ∈ PERMISSION_CODES. Nếu ai thêm quyền mặc định cho role
// nhưng quên khai báo permission trong PERMISSIONS → seedIfEmpty bỏ qua âm thầm (findUnique null) và
// role thiếu quyền → menu/tính năng bị ẩn. Test này bắt tại build, trước khi lọt tới DB dùng chung.
describe('permission catalog integrity (DEFAULT_ROLE_PERMISSIONS ⊆ PERMISSION_CODES)', () => {
  const valid = new Set(PERMISSION_CODES);

  for (const [roleCode, codes] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    it(`role ${roleCode}: mọi quyền mặc định đều tồn tại trong catalog`, () => {
      const unknown = codes.filter((c) => !valid.has(c));
      expect(unknown).toEqual([]);
    });
  }

  it('PERMISSION_CODES không trùng lặp', () => {
    expect(new Set(PERMISSION_CODES).size).toBe(PERMISSION_CODES.length);
  });
});
