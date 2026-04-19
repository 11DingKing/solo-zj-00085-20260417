import React, { Component } from 'react';
import Form from 'react-bootstrap/Form';
import Button from 'react-bootstrap/Button';
import ProgressBar from 'react-bootstrap/ProgressBar';
import ListGroup from 'react-bootstrap/ListGroup';
import Badge from 'react-bootstrap/Badge';
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
    this.fileInputRef = React.createRef();
  }

  onChange(e) {
    const fileList = e.target.files;
    if (fileList && fileList.length > 0) {
      const filesArray = Array.from(fileList);
      this.setState({ files: filesArray });
    } else {
      this.setState({ files: [] });
    }
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
    const files = this.state.files;
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

    if (this.fileInputRef.current) {
      this.fileInputRef.current.value = '';
    }

    if (allSuccess && !this.uploadCancelled) {
      this.props.reload();
    }
  }

  cancelUpload() {
    this.uploadCancelled = true;
  }

  removeFile(index) {
    const newFiles = [...this.state.files];
    newFiles.splice(index, 1);
    this.setState({ files: newFiles });
  }

  render() {
    const {
      uploading,
      currentFiles,
      overallProgress,
      fileProgresses,
      files,
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

    const hasFiles = files && files.length > 0;

    return (
      <>
        {this.showAlert(this.state.alert)}
        <Form className="mb-3" onSubmit={(e) => this.onSubmit(e)}>
          <Form.Label>上传文件</Form.Label>
          <Form.File
            id="file-upload"
            ref={this.fileInputRef}
            multiple
            className="mb-2"
            onChange={(e) => this.onChange(e)}
            label={`选择文件（最大支持 ${api.formatFileSize(api.getMaxFileSize())}）`}
            custom
          />
          
          {hasFiles && (
            <div className="mb-3">
              <p className="mb-2">已选择 {files.length} 个文件：</p>
              <ListGroup>
                {files.map((file, index) => (
                  <ListGroup.Item
                    key={index}
                    className="d-flex justify-content-between align-items-center"
                  >
                    <span
                      style={{
                        maxWidth: '70%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {file.name}
                    </span>
                    <div className="d-flex align-items-center">
                      <Badge variant="secondary" className="mr-2">
                        {api.formatFileSize(file.size)}
                      </Badge>
                      <Button
                        variant="outline-danger"
                        size="sm"
                        onClick={() => this.removeFile(index)}
                      >
                        ×
                      </Button>
                    </div>
                  </ListGroup.Item>
                ))}
              </ListGroup>
            </div>
          )}

          <Button variant="primary" type="submit" disabled={!hasFiles}>
            上传 {hasFiles ? `(${files.length} 个文件)` : ''}
          </Button>
        </Form>
      </>
    );
  }
}

export default FilesForm;
