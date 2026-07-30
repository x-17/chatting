import type { EncryptedFileMetadata } from "../../utils/file-encryption.service";

export interface FileMessagePayload {
  version: 1;
  fileId: string | number;
  frontendFileId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  metadata: EncryptedFileMetadata;
  signature: string;
}

export interface FileMessageUiMetadata {
  fileId: string | number;
  frontendFileId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  previewUrl?: string;
  [key: string]: unknown;
}

function asRecord(value: unknown): Record<string, any> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, any>)
    : null;
}

function parseContent(content: unknown): Record<string, any> {
  if (typeof content === "string") {
    const parsed = JSON.parse(content);
    const record = asRecord(parsed);
    if (!record) throw new Error("Invalid file message payload");
    return record;
  }

  const record = asRecord(content);
  if (!record) throw new Error("Invalid file message payload");
  return record;
}

export function createFileMessagePayload(input: {
  fileId: string | number;
  frontendFileId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  metadata: EncryptedFileMetadata;
  signature: string;
}): FileMessagePayload {
  return {
    version: 1,
    fileId: input.fileId,
    frontendFileId: input.frontendFileId,
    fileName: input.fileName,
    fileSize: input.fileSize,
    mimeType: input.mimeType || "application/octet-stream",
    metadata: input.metadata,
    signature: input.signature,
  };
}

/** Parse both the versioned payload and messages produced by the legacy code. */
export function parseFileMessagePayload(
  content: unknown,
  fallbackMetadata?: Record<string, any>,
): FileMessagePayload {
  const raw = parseContent(content);
  const encryptedMetadata =
    asRecord(raw.metadata) ||
    asRecord(fallbackMetadata?.encryptedMetadata) ||
    asRecord(fallbackMetadata?.metadata);

  const fileId = raw.fileId ?? fallbackMetadata?.fileId;
  const frontendFileId = String(
    raw.frontendFileId ??
      raw.localFileId ??
      fallbackMetadata?.frontendFileId ??
      fallbackMetadata?.localFileId ??
      "",
  );
  const fileName = String(
    raw.fileName ??
      fallbackMetadata?.fileName ??
      encryptedMetadata?.originalName ??
      "unknown-file",
  );
  const fileSize = Number(
    raw.fileSize ?? fallbackMetadata?.fileSize ?? encryptedMetadata?.size ?? 0,
  );
  const mimeType = String(
    raw.mimeType ??
      fallbackMetadata?.mimeType ??
      encryptedMetadata?.mimeType ??
      "application/octet-stream",
  );
  const signature = String(raw.signature ?? fallbackMetadata?.signature ?? "");

  if (fileId === undefined || fileId === null || fileId === "") {
    throw new Error("File message is missing the server file id");
  }
  if (!frontendFileId) {
    throw new Error("File message is missing the local file id");
  }
  if (!encryptedMetadata) {
    throw new Error("File message is missing encryption metadata");
  }
  if (!signature) {
    throw new Error("File message is missing the signature");
  }

  return {
    version: 1,
    fileId,
    frontendFileId,
    fileName,
    fileSize,
    mimeType,
    metadata: encryptedMetadata as unknown as EncryptedFileMetadata,
    signature,
  };
}

export function toFileMessageUiMetadata(
  payload: FileMessagePayload,
  extra: Record<string, unknown> = {},
): FileMessageUiMetadata {
  return {
    ...extra,
    fileId: payload.fileId,
    frontendFileId: payload.frontendFileId,
    fileName: payload.fileName,
    fileSize: payload.fileSize,
    mimeType: payload.mimeType,
  };
}

export function isImageFileMessage(metadata?: {
  mimeType?: string;
} | null): boolean {
  return Boolean(metadata?.mimeType?.startsWith("image/"));
}
