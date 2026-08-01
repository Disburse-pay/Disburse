"use strict";

function readBuffer(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw new TypeError("Expected a Buffer or Uint8Array.");
  }
  return Buffer.from(value);
}

function toBigIntLE(value) {
  const buffer = readBuffer(value);
  buffer.reverse();
  return buffer.length === 0 ? 0n : BigInt(`0x${buffer.toString("hex")}`);
}

function toBigIntBE(value) {
  const buffer = readBuffer(value);
  return buffer.length === 0 ? 0n : BigInt(`0x${buffer.toString("hex")}`);
}

function validateOutput(num, width) {
  if (typeof num !== "bigint" || num < 0n) {
    throw new RangeError("Expected a non-negative bigint.");
  }
  if (!Number.isSafeInteger(width) || width < 0) {
    throw new RangeError("Buffer width must be a non-negative safe integer.");
  }
  if (num >= (1n << BigInt(width * 8))) {
    throw new RangeError(`Bigint does not fit in ${width} bytes.`);
  }
}

function toBufferBE(num, width) {
  validateOutput(num, width);
  if (width === 0) {
    return Buffer.alloc(0);
  }
  return Buffer.from(num.toString(16).padStart(width * 2, "0"), "hex");
}

function toBufferLE(num, width) {
  return toBufferBE(num, width).reverse();
}

module.exports = { toBigIntLE, toBigIntBE, toBufferLE, toBufferBE };
