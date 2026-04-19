import axios from 'axios';

const CHUNK_SIZE = 2 * 1024 * 1024;
const MAX_FILE_SIZE = 1024 * 1024 * 1024;

class Api {
  constructor() {
    this.api = axios.create({
      baseURL: process.env.REACT_APP_API_URL,
    });
  }

  async apiCall(request) {
    try {
      return (await request()).data;
    } catch (e) {
      console.log(e);
      return e.response ? e.response.data : { success: false, message: e.message };
    }
  }

  async getContent(path) {
    return await this.apiCall(() => this.api.get(`/content/${path}`));
  }

  async uploadFiles(path, files) {
    return await this.apiCall(() => this.api.post(`/upload/${path}`, files));
  }

  async mkDir(path, name) {
    return await this.apiCall(() => this.api.post(`/dir/${path}`, { name }));
  }

  async initUpload(path, fileName, fileSize, fileHash) {
    return await this.apiCall(() =>
      this.api.post(`/upload/init/${path}`, {
        fileName,
        fileSize,
        fileHash,
      })
    );
  }

  async uploadChunk(path, uploadId, chunkIndex, chunk, fileName, totalChunks) {
    const formData = new FormData();
    formData.append('chunk', chunk);
    formData.append('uploadId', uploadId);
    formData.append('chunkIndex', chunkIndex.toString());
    if (fileName) {
      formData.append('fileName', fileName);
    }
    if (totalChunks) {
      formData.append('totalChunks', totalChunks.toString());
    }

    return await this.apiCall(() =>
      this.api.post(`/upload/chunk/${path}`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      })
    );
  }

  async completeUpload(
    path,
    uploadId,
    fileName,
    fileSize,
    chunkSize,
    totalChunks
  ) {
    return await this.apiCall(() =>
      this.api.post(`/upload/complete/${path}`, {
        uploadId,
        fileName,
        fileSize,
        chunkSize,
        totalChunks,
      })
    );
  }

  async getUploadStatus(path, uploadId, totalChunks) {
    const params = new URLSearchParams();
    params.append('uploadId', uploadId);
    if (totalChunks) {
      params.append('totalChunks', totalChunks.toString());
    }

    return await this.apiCall(() =>
      this.api.get(`/upload/status/${path}`, { params })
    );
  }

  async cancelUpload(path, uploadId, fileName) {
    return await this.apiCall(() =>
      this.api.post(`/upload/cancel/${path}`, {
        uploadId,
        fileName,
      })
    );
  }

  getChunkSize() {
    return CHUNK_SIZE;
  }

  getMaxFileSize() {
    return MAX_FILE_SIZE;
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

const api = new Api();
export default api;
