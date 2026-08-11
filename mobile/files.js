const capFiles = require('./capacitorFiles');

const MOBILE_ASSET_PREFIX = 'mobile://';

function bufferToUint8Array(buffer) {
  if (buffer instanceof Uint8Array) return buffer;
  if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer);
  if (Array.isArray(buffer)) return new Uint8Array(buffer);
  if (buffer?.data) return new Uint8Array(buffer.data);
  return new Uint8Array(buffer);
}

function mimeForName(name) {
  const ext = (String(name).match(/\.(\w+)$/) || [])[1]?.toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === 'csv') return 'text/csv';
  if (ext === 'db') return 'application/octet-stream';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

async function saveFileWeb(defaultName, buffer) {
  const bytes = bufferToUint8Array(buffer);
  const blob = new Blob([bytes], { type: mimeForName(defaultName) });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultName || 'download';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
  return { success: true, path: defaultName };
}

async function saveFile(defaultName, _filters, buffer) {
  try {
    const bytes = bufferToUint8Array(buffer);
    if (capFiles.isNative()) {
      return capFiles.saveAndShare(defaultName, bytes);
    }
    return saveFileWeb(defaultName, bytes);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function mountFileInput(accept) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.style.cssText = 'position:fixed;top:-100px;left:0;opacity:0;width:1px;height:1px';
  document.body.appendChild(input);
  return input;
}

function downscaleDataUrl(dataUrl, maxEdge = 1280, quality = 0.82) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (!width || !height) return resolve(dataUrl);
        const scale = Math.min(1, maxEdge / Math.max(width, height));
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch (_) {
      resolve(dataUrl);
    }
  });
}

async function storeMobileImage(prefix, dataUrl, fileName) {
  let stored = dataUrl;
  if (typeof stored === 'string' && stored.length > 900000) {
    stored = await downscaleDataUrl(stored);
  }
  const key = `${prefix}-${Date.now()}.jpg`;
  const relativePath = `ShopPOS/images/${key}`;
  if (capFiles.isNative()) {
    try {
      const match = String(stored).match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        const bytes = capFiles.base64ToUint8(match[2]);
        await capFiles.writeToDocuments(relativePath, bytes);
        return { success: true, path: `mobile-doc://${relativePath}`, fileName: fileName || key };
      }
    } catch (_) { /* fall through to localStorage */ }
  }
  const path = MOBILE_ASSET_PREFIX + key;
  try {
    localStorage.setItem('mobile_asset:' + key, stored);
    return { success: true, path, fileName: fileName || key };
  } catch (e) {
    try {
      stored = await downscaleDataUrl(stored, 800, 0.7);
      localStorage.setItem('mobile_asset:' + key, stored);
      return { success: true, path, fileName: fileName || key };
    } catch (_) {
      return { success: false, error: 'Image too large for device storage — try a smaller photo' };
    }
  }
}

async function selectImage(prefix = 'img') {
  // Prefer Camera plugin when available (gallery or camera)
  try {
    if (capFiles.isNative()) {
      const { Camera, CameraResultType, CameraSource } = require('@capacitor/camera');
      const photo = await Camera.getPhoto({
        quality: 85,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Prompt,
        width: 1280,
        height: 1280
      });
      if (photo?.dataUrl) return storeMobileImage(prefix, photo.dataUrl, `${prefix}.jpg`);
    }
  } catch (err) {
    // User cancelled camera prompt or plugin unavailable — fall back to file input
    if (String(err?.message || err).toLowerCase().includes('cancel')) {
      return { success: false, cancelled: true };
    }
  }
  return new Promise((resolve) => {
    const input = mountFileInput('image/*');
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      document.body.removeChild(input);
      if (!file) return resolve({ success: false, cancelled: true });
      const reader = new FileReader();
      reader.onload = async () => {
        resolve(await storeMobileImage(prefix, reader.result, file.name));
      };
      reader.onerror = () => resolve({ success: false, error: 'Could not read image' });
      reader.readAsDataURL(file);
    });
    input.click();
  });
}

async function getImageDataUrl(filePath) {
  if (!filePath) return { success: false, error: 'No path' };
  const p = String(filePath);
  if (p.startsWith('data:')) return { success: true, dataUrl: p, data: p };
  if (p.startsWith('mobile-doc://')) {
    const r = await readMobileDocPath(p);
    if (!r) return { success: false, error: 'Image not found' };
    if (r.success && r.dataUrl) return { ...r, data: r.dataUrl };
    return r;
  }
  if (p.startsWith(MOBILE_ASSET_PREFIX)) {
    const key = p.slice(MOBILE_ASSET_PREFIX.length);
    const data = localStorage.getItem('mobile_asset:' + key);
    if (data) return { success: true, dataUrl: data, data };
    return { success: false, error: 'Image not found' };
  }
  return { success: false, error: 'File path not available on mobile' };
}

async function persistMobileDocument(mobilePath) {
  if (!mobilePath || !String(mobilePath).startsWith(MOBILE_ASSET_PREFIX)) {
    return { success: true, path: mobilePath };
  }
  const key = String(mobilePath).slice(MOBILE_ASSET_PREFIX.length);
  const data = localStorage.getItem('mobile_asset:' + key);
  if (!data) return { success: false, error: 'Document data not found — please select the file again' };
  const match = String(data).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return { success: false, error: 'Invalid document data' };
  const bytes = capFiles.isNative() ? capFiles.base64ToUint8(match[2]) : null;
  const relativePath = `ShopPOS/document-hub/${key}`;
  if (capFiles.isNative() && bytes) {
    await capFiles.writeToDocuments(relativePath, bytes);
    return {
      success: true,
      path: `mobile-doc://${relativePath}`,
      is_image: match[1].startsWith('image/')
    };
  }
  return { success: true, path: mobilePath, is_image: match[1].startsWith('image/') };
}

async function readMobileDocPath(docPath) {
  if (!String(docPath).startsWith('mobile-doc://')) return null;
  const relativePath = String(docPath).slice('mobile-doc://'.length);
  if (!capFiles.isNative()) return null;
  try {
    const { Filesystem, Directory } = require('@capacitor/filesystem');
    const file = await Filesystem.readFile({ path: relativePath, directory: Directory.Documents });
    const mime = mimeForName(relativePath);
    return { success: true, dataUrl: `data:${mime};base64,${file.data}` };
  } catch (err) {
    return { success: false, error: err.message || 'Could not read document' };
  }
}

async function selectDocument(prefix = 'doc') {
  return new Promise((resolve) => {
    const input = mountFileInput('.pdf,image/*,.png,.jpg,.jpeg,.webp');
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      document.body.removeChild(input);
      if (!file) return resolve({ success: false, cancelled: true });
      const reader = new FileReader();
      reader.onload = () => {
        const ext = file.name.match(/\.(\w+)$/)?.[1] || 'pdf';
        const key = `${prefix}-${Date.now()}.${ext}`;
        const path = MOBILE_ASSET_PREFIX + key;
        try {
          localStorage.setItem('mobile_asset:' + key, reader.result);
          resolve({
            success: true,
            path,
            fileName: file.name,
            is_image: /\.(png|jpe?g|webp|gif)$/i.test(file.name)
          });
        } catch (e) {
          resolve({ success: false, error: 'Document too large for device storage' });
        }
      };
      reader.onerror = () => resolve({ success: false, error: 'Could not read document' });
      reader.readAsDataURL(file);
    });
    input.click();
  });
}

async function openPath(filePath) {
  const r = await getImageDataUrl(filePath);
  if (r.success && r.dataUrl) {
    window.open(r.dataUrl, '_blank');
    return { success: true };
  }
  return { success: false, error: 'File path not available on mobile' };
}

async function selectAudio(prefix = 'notification') {
  return new Promise((resolve) => {
    const input = mountFileInput('audio/*,.wav,.mp3,.ogg,.m4a');
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      document.body.removeChild(input);
      if (!file) return resolve({ success: false, cancelled: true });
      const reader = new FileReader();
      reader.onload = () => {
        const ext = file.name.match(/\.(\w+)$/)?.[1] || 'wav';
        const key = `${prefix}-${Date.now()}.${ext}`;
        const path = MOBILE_ASSET_PREFIX + key;
        try {
          localStorage.setItem('mobile_asset:' + key, reader.result);
          resolve({ success: true, path, fileName: file.name });
        } catch (e) {
          resolve({ success: false, error: 'Audio file too large' });
        }
      };
      reader.onerror = () => resolve({ success: false, error: 'Could not read audio' });
      reader.readAsDataURL(file);
    });
    input.click();
  });
}

async function getAudioDataUrl(filePath) {
  return getImageDataUrl(filePath);
}

async function selectDbFile() {
  return new Promise((resolve) => {
    const input = mountFileInput('.db,application/octet-stream,application/x-sqlite3,*/*');
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      document.body.removeChild(input);
      if (!file) return resolve({ success: false, cancelled: true });
      const reader = new FileReader();
      reader.onload = () => resolve({
        success: true,
        bytes: new Uint8Array(reader.result),
        fileName: file.name
      });
      reader.onerror = () => resolve({ success: false, error: 'Could not read backup file' });
      reader.readAsArrayBuffer(file);
    });
    input.click();
  });
}

module.exports = {
  saveFile,
  selectImage,
  selectDocument,
  persistMobileDocument,
  openPath,
  getImageDataUrl,
  selectAudio,
  getAudioDataUrl,
  selectDbFile,
  MOBILE_ASSET_PREFIX
};
