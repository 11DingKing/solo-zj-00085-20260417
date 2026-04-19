const express = require('express');
const router = express.Router();
const fileUpload = require('express-fileupload');
const path = require('path');
const processPath = require('../lib/path');
const moveFile = require('../lib/mv');
const chunkUpload = require('../lib/chunkUpload');
const fs = require('fs');

router.use(fileUpload());
router.use(express.json());

const CHUNK_SIZE = 2 * 1024 * 1024;
const MAX_FILE_SIZE = chunkUpload.MAX_FILE_SIZE;

router.post('/init/:path?', async (req, res) => {
  try {
    const { fileName, fileSize, fileHash } = req.body;

    if (!fileName || fileSize === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: fileName, fileSize',
      });
    }

    if (fileSize > MAX_FILE_SIZE) {
      return res.status(400).json({
        success: false,
        message: `File size exceeds maximum limit of ${MAX_FILE_SIZE / (1024 * 1024 * 1024)}GB`,
        maxFileSize: MAX_FILE_SIZE,
      });
    }

    const dirPath = processPath(req.params.path);
    const targetFilePath = path.join(dirPath.absolutePath, fileName);

    if (fs.existsSync(targetFilePath)) {
      return res.status(400).json({
        success: false,
        message: `File ${fileName} already exists`,
        path: dirPath.relativePath,
      });
    }

    if (!chunkUpload.acquireLock(fileName)) {
      return res.status(409).json({
        success: false,
        message: `File ${fileName} is currently being uploaded by another request`,
      });
    }

    const uploadId = chunkUpload.getUploadId(fileName, fileSize, fileHash || '');
    const totalChunks = chunkUpload.getChunkCount(fileSize, CHUNK_SIZE);

    const existingChunks = chunkUpload.getUploadedChunks(uploadId);

    res.json({
      success: true,
      uploadId,
      fileName,
      fileSize,
      chunkSize: CHUNK_SIZE,
      totalChunks,
      uploadedChunks: existingChunks,
      uploadedCount: existingChunks.length,
      path: dirPath.relativePath,
    });
  } catch (err) {
    console.error('Init upload error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to initialize upload',
      error: err.message,
    });
  }
});

router.post('/chunk/:path?', async (req, res) => {
  try {
    if (!req.files || !req.files.chunk) {
      return res.status(400).json({
        success: false,
        message: 'No chunk data provided',
      });
    }

    const { uploadId, chunkIndex, fileName, totalChunks } = req.body;
    const chunkData = req.files.chunk.data;

    if (!uploadId || chunkIndex === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: uploadId, chunkIndex',
      });
    }

    const chunkNum = parseInt(chunkIndex, 10);
    if (isNaN(chunkNum) || chunkNum < 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid chunkIndex',
      });
    }

    await chunkUpload.saveChunk(uploadId, chunkNum, chunkData);

    const uploadedChunks = chunkUpload.getUploadedChunks(uploadId);
    const progress = totalChunks
      ? (uploadedChunks.length / parseInt(totalChunks, 10)) * 100
      : 0;

    res.json({
      success: true,
      uploadId,
      chunkIndex: chunkNum,
      uploadedChunks,
      uploadedCount: uploadedChunks.length,
      progress,
    });
  } catch (err) {
    console.error('Chunk upload error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to upload chunk',
      error: err.message,
    });
  }
});

router.post('/complete/:path?', async (req, res) => {
  try {
    const { uploadId, fileName, fileSize, chunkSize, totalChunks } = req.body;

    if (!uploadId || !fileName || fileSize === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: uploadId, fileName, fileSize',
      });
    }

    const dirPath = processPath(req.params.path);
    const targetFilePath = path.join(dirPath.absolutePath, fileName);

    if (fs.existsSync(targetFilePath)) {
      chunkUpload.releaseLock(fileName);
      return res.status(400).json({
        success: false,
        message: `File ${fileName} already exists`,
        path: dirPath.relativePath,
      });
    }

    const actualChunkSize = chunkSize || CHUNK_SIZE;
    const actualTotalChunks =
      totalChunks || chunkUpload.getChunkCount(fileSize, actualChunkSize);

    try {
      await chunkUpload.mergeChunks(
        uploadId,
        targetFilePath,
        fileSize,
        actualChunkSize
      );
    } catch (mergeErr) {
      chunkUpload.releaseLock(fileName);
      return res.status(400).json({
        success: false,
        message: mergeErr.message,
        path: dirPath.relativePath,
      });
    }

    chunkUpload.releaseLock(fileName);

    res.json({
      success: true,
      message: 'File successfully uploaded',
      fileName,
      path: dirPath.relativePath,
    });
  } catch (err) {
    console.error('Complete upload error:', err);
    if (req.body.fileName) {
      chunkUpload.releaseLock(req.body.fileName);
    }
    res.status(500).json({
      success: false,
      message: 'Failed to complete upload',
      error: err.message,
    });
  }
});

router.get('/status/:path?', async (req, res) => {
  try {
    const { uploadId, totalChunks, fileName } = req.query;

    if (!uploadId) {
      return res.status(400).json({
        success: false,
        message: 'Missing uploadId',
      });
    }

    const total = totalChunks ? parseInt(totalChunks, 10) : 0;
    const status = chunkUpload.getUploadStatus(uploadId, total);

    res.json({
      success: true,
      ...status,
    });
  } catch (err) {
    console.error('Get status error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to get upload status',
      error: err.message,
    });
  }
});

router.post('/cancel/:path?', async (req, res) => {
  try {
    const { uploadId, fileName } = req.body;

    if (uploadId) {
      chunkUpload.cleanupUpload(uploadId);
    }

    if (fileName) {
      chunkUpload.releaseLock(fileName);
    }

    res.json({
      success: true,
      message: 'Upload cancelled',
    });
  } catch (err) {
    console.error('Cancel upload error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel upload',
      error: err.message,
    });
  }
});

router.post('/:path?', async (req, res, next) => {
  if (!req.files) {
    return res.status(400).json({
      success: false,
      message: 'No files were uploaded',
    });
  }

  const dirPath = processPath(req.params.path);
  let files = req.files.file;
  if (!Array.isArray(files)) {
    files = [files];
  }

  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      return res.status(400).json({
        success: false,
        message: `File ${file.name} exceeds maximum size of ${
          MAX_FILE_SIZE / (1024 * 1024 * 1024)
        }GB`,
        path: dirPath.relativePath,
      });
    }
  }

  try {
    for (const file of files) {
      if (!chunkUpload.acquireLock(file.name)) {
        return res.status(409).json({
          success: false,
          message: `File ${file.name} is currently being uploaded`,
          path: dirPath.relativePath,
        });
      }

      try {
        await moveFile(file, dirPath.absolutePath);
      } finally {
        chunkUpload.releaseLock(file.name);
      }
    }
  } catch (err) {
    for (const file of files) {
      chunkUpload.releaseLock(file.name);
    }

    if (err.code) {
      return next(err);
    }

    return res.status(400).json({
      success: false,
      message: err.message,
      path: dirPath.relativePath,
    });
  }

  res.json({
    success: true,
    message: 'Files successfully uploaded',
    path: dirPath.relativePath,
  });
});

module.exports = router;
