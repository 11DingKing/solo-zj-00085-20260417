const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const storage = require('../storage');

const CHUNK_DIR = path.join(storage, '.chunks');
const MAX_FILE_SIZE = 1024 * 1024 * 1024;

const uploadLocks = new Map();

const getUploadId = (fileName, fileSize, fileHash) => {
  const data = `${fileName}-${fileSize}-${fileHash}-${Date.now()}`;
  return crypto.createHash('sha256').update(data).digest('hex');
};

const getChunkDir = (uploadId) => {
  return path.join(CHUNK_DIR, uploadId);
};

const ensureChunkDir = (uploadId) => {
  const dir = getChunkDir(uploadId);
  if (!fs.existsSync(CHUNK_DIR)) {
    fs.mkdirSync(CHUNK_DIR, { recursive: true });
  }
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

const getChunkPath = (uploadId, chunkIndex) => {
  return path.join(getChunkDir(uploadId), `chunk_${chunkIndex}`);
};

const saveChunk = (uploadId, chunkIndex, chunkData) => {
  return new Promise((resolve, reject) => {
    const chunkPath = getChunkPath(uploadId, chunkIndex);
    ensureChunkDir(uploadId);
    fs.writeFile(chunkPath, chunkData, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

const getUploadedChunks = (uploadId) => {
  const dir = getChunkDir(uploadId);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const files = fs.readdirSync(dir);
  const chunks = files
    .filter((f) => f.startsWith('chunk_'))
    .map((f) => parseInt(f.split('_')[1], 10))
    .sort((a, b) => a - b);
  return chunks;
};

const getChunkCount = (fileSize, chunkSize) => {
  return Math.ceil(fileSize / chunkSize);
};

const mergeChunks = (uploadId, targetPath, fileSize, chunkSize) => {
  return new Promise((resolve, reject) => {
    const totalChunks = getChunkCount(fileSize, chunkSize);
    const uploadedChunks = getUploadedChunks(uploadId);

    if (uploadedChunks.length !== totalChunks) {
      return reject(
        new Error(
          `Missing chunks. Expected ${totalChunks}, got ${uploadedChunks.length}`
        )
      );
    }

    const writeStream = fs.createWriteStream(targetPath);
    let currentChunk = 0;

    const writeNextChunk = () => {
      if (currentChunk >= totalChunks) {
        writeStream.end();
        return;
      }

      const chunkPath = getChunkPath(uploadId, currentChunk);
      const readStream = fs.createReadStream(chunkPath);

      readStream.pipe(writeStream, { end: false });
      readStream.on('end', () => {
        currentChunk++;
        writeNextChunk();
      });
      readStream.on('error', (err) => {
        writeStream.end();
        reject(err);
      });
    };

    writeStream.on('finish', () => {
      cleanupUpload(uploadId);
      resolve();
    });

    writeStream.on('error', (err) => {
      reject(err);
    });

    writeNextChunk();
  });
};

const cleanupUpload = (uploadId) => {
  const dir = getChunkDir(uploadId);
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir);
    files.forEach((file) => {
      fs.unlinkSync(path.join(dir, file));
    });
    fs.rmdirSync(dir);
  }
};

const acquireLock = (fileName) => {
  if (uploadLocks.has(fileName)) {
    return false;
  }
  uploadLocks.set(fileName, true);
  return true;
};

const releaseLock = (fileName) => {
  uploadLocks.delete(fileName);
};

const isLocked = (fileName) => {
  return uploadLocks.has(fileName);
};

const getUploadStatus = (uploadId, totalChunks) => {
  const uploaded = getUploadedChunks(uploadId);
  const uploadedCount = uploaded.length;
  const progress = totalChunks > 0 ? (uploadedCount / totalChunks) * 100 : 0;
  return {
    uploadId,
    uploadedChunks: uploaded,
    uploadedCount,
    totalChunks,
    progress,
    isComplete: uploadedCount === totalChunks,
  };
};

module.exports = {
  CHUNK_DIR,
  MAX_FILE_SIZE,
  getUploadId,
  getChunkDir,
  ensureChunkDir,
  getChunkPath,
  saveChunk,
  getUploadedChunks,
  getChunkCount,
  mergeChunks,
  cleanupUpload,
  acquireLock,
  releaseLock,
  isLocked,
  getUploadStatus,
};
