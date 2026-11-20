/**
 * Zulora Local — Cloudinary Multi-Image Direct Browser Upload
 * Cloud: g2udlmgl | Preset: zulora_unsigned | Folder: zulora_products
 */
import { cloudinaryConfig } from './config.js';

/**
 * Upload a single File object to Cloudinary unsigned.
 * Returns { url, publicId, isDemo }
 */
export async function uploadSingleImage(file, onProgress = null) {
  if (!file || !file.type.startsWith('image/'))
    throw new Error('Please select a valid image file (PNG, JPG, WEBP).');
  if (file.size > 10 * 1024 * 1024)
    throw new Error('Image exceeds 10 MB limit.');

  const { cloudName, uploadPreset, uploadFolder } = cloudinaryConfig;

  if (!cloudName || cloudName.includes('PASTE')) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = e => resolve({ url: e.target.result, publicId: 'demo_' + Date.now(), isDemo: true });
      reader.readAsDataURL(file);
    });
  }

  const url = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', uploadPreset);
  fd.append('folder', uploadFolder);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const r = JSON.parse(xhr.responseText);
        resolve({ url: r.secure_url || r.url, publicId: r.public_id, isDemo: false });
      } else {
        let msg = 'Cloudinary upload failed';
        try { msg += ': ' + JSON.parse(xhr.responseText).error.message; } catch (e) { msg += ` (HTTP ${xhr.status})`; }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('Network error uploading to Cloudinary.'));
    xhr.send(fd);
  });
}

/**
 * Upload multiple images simultaneously, returning array of results.
 * onProgress(fileIndex, percent) called per file.
 */
export async function uploadMultipleImages(files, onProgress = null) {
  if (!files || files.length === 0) throw new Error('No files selected.');
  const uploadPromises = Array.from(files).map((file, idx) =>
    uploadSingleImage(file, (pct) => { if (onProgress) onProgress(idx, pct); })
  );
  return Promise.all(uploadPromises);
}
