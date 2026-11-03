import fs from 'node:fs/promises';

// Cloud-sync clients can briefly lock runtime files while Obsidian opens a
// sidebar. Retry that specific condition without hiding other read errors.
export async function readUIAsset(file, read = fs.readFile) {
  for (let attempt = 0; ; attempt++) {
    try { return await read(file, 'utf8'); }
    catch (error) {
      if (error.code !== 'EBUSY' || attempt >= 4) throw error;
      await new Promise(resolve => setTimeout(resolve, 50 * 2 ** attempt));
    }
  }
}
