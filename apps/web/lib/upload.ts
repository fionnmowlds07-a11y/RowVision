import { Upload, type PreviousUpload } from "tus-js-client";

const CHUNK_BYTES = 6 * 1024 * 1024; // Supabase's resumable uploads need exactly this size.
const RETRY_MS = [0, 1000, 3000, 5000, 10000, 20000, 30000, 60000, 60000, 60000];

function fileKey(file: File): string {
  return `rowvision-upload:${file.name}:${file.size}:${file.lastModified}`;
}

/** Reuse the clip id of an unfinished upload, so that picking the same file again carries on. */
export function clipIdFor(file: File): string {
  try {
    const saved = localStorage.getItem(fileKey(file));
    if (saved) return saved;
    const id = crypto.randomUUID();
    localStorage.setItem(fileKey(file), id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export function forgetUpload(file: File) {
  try {
    localStorage.removeItem(fileKey(file));
  } catch {
    // Nothing to do when storage is blocked.
  }
}

type Options = {
  file: File;
  url: string;
  anonKey: string;
  token: string;
  path: string;
  onProgress: (share: number) => void;
  onDone: () => void;
  onError: () => void;
};

export function startUpload({ file, url, anonKey, token, path, onProgress, onDone, onError }: Options): Upload {
  const upload = new Upload(file, {
    endpoint: `${url}/storage/v1/upload/resumable`,
    chunkSize: CHUNK_BYTES,
    retryDelays: RETRY_MS,
    // The default gives up at once when offline, which is the moment patchy signal needs patience.
    onShouldRetry: () => true,
    removeFingerprintOnSuccess: true,
    headers: { authorization: `Bearer ${token}`, apikey: anonKey, "x-upsert": "true" },
    metadata: { bucketName: "uploads", objectName: path, contentType: file.type || "video/mp4", cacheControl: "3600" },
    onProgress: (sent, total) => onProgress(total ? sent / total : 0),
    onSuccess: onDone,
    onError,
  });
  upload.findPreviousUploads().then((previous: PreviousUpload[]) => {
    if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
    upload.start();
  });
  return upload;
}
