import { createHash, randomUUID } from "node:crypto";

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
