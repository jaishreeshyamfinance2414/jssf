// Client-side image compression for uploads. Mobile cameras produce 8–15 MB
// JPEGs; we downscale to a sane resolution and re-encode as WebP so document
// photos land at ~150–400 KB without losing readability.
const MAX_DIMENSION = 1600; // longest edge, plenty for ID documents
const QUALITY = 0.8;

function isCompressibleImage(file: File): boolean {
  return ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
}

async function compressImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file; // corrupt/unsupported — let the server validate

  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', QUALITY),
  );
  if (!blob) return file;

  // Keep the original if compression somehow made it bigger (tiny files).
  if (blob.size >= file.size) return file;

  const name = file.name.replace(/\.[^.]+$/, '') + '.webp';
  return new File([blob], name, { type: 'image/webp' });
}

/**
 * Returns a copy of the FormData with every image file compressed.
 * Non-image entries (text fields, PDFs) pass through untouched.
 */
export async function compressFormImages(form: FormData): Promise<FormData> {
  const out = new FormData();
  const tasks: Promise<void>[] = [];
  form.forEach((value, key) => {
    if (value instanceof File && value.size > 0 && isCompressibleImage(value)) {
      tasks.push(
        compressImage(value).then((f) => {
          out.append(key, f);
        }),
      );
    } else {
      out.append(key, value);
    }
  });
  await Promise.all(tasks);
  return out;
}
