// R48 — Cột tiền chuyển sang BigInt (int8) để GD không giới hạn giá trị. Nhưng `JSON.stringify(bigint)` NÉM
// "TypeError: Do not know how to serialize a BigInt" → mọi nơi ghi audit/log/serialize hàng có tiền sẽ vỡ.
// Dạy BigInt tự serialize thành SỐ (VND thực tế < 2^53 nên an toàn precision + khớp DTO number). Chỉ tác động
// tới JSON.stringify — KHÔNG ảnh hưởng Prisma (Prisma serialize riêng). Import module này ĐẦU TIÊN ở main.
if (!('toJSON' in BigInt.prototype)) {
  Object.defineProperty(BigInt.prototype, 'toJSON', {
    value: function (this: bigint): number {
      return Number(this);
    },
    configurable: true,
    writable: true
  });
}
export {};
