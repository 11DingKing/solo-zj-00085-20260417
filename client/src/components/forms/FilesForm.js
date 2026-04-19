import React, { Component } from 'react';
import Form from 'react-bootstrap/Form';
import Button from 'react-bootstrap/Button';
import ProgressBar from 'react-bootstrap/ProgressBar';
import Loading from '../Loading';
import Alert from '../Alert';
import api from '../../api/api';

class FilesForm extends Component {
  constructor(props) {
    super(props);
    this.state = {
      files: [],
      uploading: false,
      showAlert: false,
      alert: {},
      currentFiles: [],
      overallProgress: 0,
      fileProgresses: {},
    };
    this.uploadCancelled = false;
  }

  onChange(e) {
    this.setState({ files: e.target.files });
  }

  showAlert(alert) {
    if (this.state.showAlert) {
      return (
        <Alert
          alert={alert}
          onClose={() => this.setState({ showAlert: false })}
        />
      );
    }
  }

  getFileChunk(file, index, chunkSize) {
    const start = index * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    return file.slice(start, end);
  }

  async uploadSingleFile(file, uploadTo, onProgress) {
    const maxFileSize = api.getMaxFileSize();
    const chunkSize = api.getChunkSize();

    if (file.size > maxFileSize) {
      return {
        success: false,
        message: `文件 "${file.name}" 超过最大限制 ${api.formatFileSize(maxFileSize)}`,
      };
    }

    const initResponse = await api.initUpload(
      uploadTo || '',
      file.name,
      file.size
    );

    if (!initResponse.success) {
      return initResponse;
    }

    const { uploadId, totalChunks, uploadedChunks = [] } = initResponse;
    const uploadedSet = new Set(uploadedChunks);

    let uploadedCount = uploadedChunks.length;

    for (let i = 0; i < totalChunks; i++) {
      if (this.uploadCancelled) {
        await api.cancelUpload(uploadTo || '', uploadId, file.name);
        return {
          success: false,
          message: `上传已取消`,
        };
      }

      if (uploadedSet.has(i)) {
        uploadedCount = i + 1;
        const progress = Math.round((uploadedCount / totalChunks) * 100);
        onProgress(progress, file.name);
        continue;
      }

      const chunk = this.getFileChunk(file, i, chunkSize);
      const chunkResponse = await api.uploadChunk(
        uploadTo || '',
        uploadId,
        i,
        chunk,
        file.name,
        totalChunks
      );

      if (!chunkResponse.success) {
        return chunkResponse;
      }

      uploadedCount = i + 1;
      const progress = Math.round((uploadedCount / totalChunks) * 100);
      onProgress(progress, file.name);
    }

    const completeResponse = await api.completeUpload(
      uploadTo || '',
      uploadId,
      file.name,
      file.size,
      chunkSize,
      totalChunks
    );

    return completeResponse;
  }

  async onSubmit(e) {
    e.preventDefault();

    if (!this.state.files || this.state.files.length === 0) {
      const alert = {
        success: false,
        message: '请选择要上传的文件',
      };
      this.setState({ showAlert: true, alert });
      return;
    }

    this.uploadCancelled = false;
    const files = Array.from(this.state.files);
    const maxFileSize = api.getMaxFileSize();

    const oversizedFiles = files.filter((f) => f.size > maxFileSize);
    if (oversizedFiles.length > 0) {
      const alert = {
        success: false,
        message: `以下文件超过最大限制 ${api.formatFileSize(maxFileSize)}: ${oversizedFiles
          .map((f) => f.name)
          .join(', ')}`,
      };
      this.setState({ showAlert: true, alert });
      return;
    }

    this.setState({
      uploading: true,
      currentFiles: files.map((f) => f.name),
      overallProgress: 0,
      fileProgresses: {},
    });

    const fileProgresses = {};
    files.forEach((f) => {
      fileProgresses[f.name] = 0;
    });
    this.setState({ fileProgresses });

    let allSuccess = true;
    const messages = [];

    for (const file of files) {
      if (this.uploadCancelled) break;

      const response = await this.uploadSingleFile(
        file,
        this.props.uploadTo,
        (progress, fileName) => {
          this.setState((prevState) => {
            const newFileProgresses = {
              ...prevState.fileProgresses,
              [fileName]: progress,
            };

            const totalProgress = Object.values(newFileProgresses).reduce(
              (a, b) => a + b,
              0
            );
            const overallProgress = Math.round(totalProgress / files.length);

            return {
              fileProgresses: newFileProgresses,
              overallProgress,
            };
          });
        }
      );

      if (!response.success) {
        allSuccess = false;
        messages.push(`${file.name}: ${response.message}`);
      } else {
        messages.push(`${file.name}: 上传成功`);
      }
    }

    const alert = {
      success: allSuccess && !this.uploadCancelled,
      message: this.uploadCancelled ? '上传已取消' : messages.join('\n'),
    };

    this.setState({
      uploading: false,
      showAlert: true,
      alert,
      currentFiles: [],
      overallProgress: 0,
      fileProgresses: {},
      files: [],
    });

    if (allSuccess && !this.uploadCancelled) {
      this.props.reload();
    }
  }

  cancelUpload() {
    this.uploadCancelled = true;
  }

  render() {
    const {
      uploading,
      currentFiles,
      overallProgress,
      fileProgresses,
    } = this.state;

    if (uploading) {
      return (
        <div>
          <p className="text-center mb-3">
            正在上传 {currentFiles.length} 个文件... ({overallProgress}%)
          </p>
          <ProgressBar
            animated
            now={overallProgress}
            label={`${overallProgress}%`}
            variant="info"
            className="mb-3"
          />
          {currentFiles.map((fileName) => (
            <div key={fileName} className="mb-2">
              <div className="d-flex justify-content-between">
                <span
                  style={{
                    maxWidth: '70%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {fileName}
                </span>
                <span>{fileProgresses[fileName] || 0}%</span>
              </div>
              <ProgressBar
                now={fileProgresses[fileName] || 0}
                variant="success"
                style={{ height: '8px' }}
              />
            </div>
          ))}
          <button
            className="btn btn-outline-danger btn-sm mt-2"
            onClick={() => this.cancelUpload()}
          >
            取消上传
          </button>
        </div>
      );
    }

    return (
      <>
        {this.showAlert(this.state.alert)}
        <Form className="mb-3" onSubmit={(e) => this.onSubmit(e)}>
          <Form.Label>上传文件</Form.Label>
          <Form.File
            multiple
            className="mb-2"
            onChange={(e) => this.onChange(e)}
            label={`最大支持 ${api.formatFileSize(api.getMaxFileSize())}`}
            custom
          />
          <Button variant="primary" type="submit" disabled={!this.state.files.length}>
            上传
          </Button>
        </Form>
      </>
    );
  }
}

export default FilesForm;
