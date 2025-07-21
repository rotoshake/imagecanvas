/**
 * ImageUploadManager - Handles HTTP uploads of images to the server
 * Allows immediate local display while uploading in the background
 */
class ImageUploadManager {
    constructor() {
        this.uploadQueue = new Map(); // hash -> upload promise
        // Use the configured server URL, not the current page host
        this.uploadUrl = CONFIG.SERVER.API_BASE + '/api/upload';
    }

    /**
     * Upload image data to server via HTTP
     * Returns a promise that resolves to the server URL
     */
    async uploadImage(imageData, filename, hash) {
        // Check if already uploading
        if (this.uploadQueue.has(hash)) {
            console.log(`⏳ Upload already in progress for ${hash}`);
            return this.uploadQueue.get(hash);
        }

        // Create upload promise
        const uploadPromise = this._performUpload(imageData, filename, hash);
        this.uploadQueue.set(hash, uploadPromise);

        try {
            const result = await uploadPromise;
            this.uploadQueue.delete(hash);
            return result;
        } catch (error) {
            this.uploadQueue.delete(hash);
            throw error;
        }
    }

    async _performUpload(imageData, filename, hash) {
        console.log(`📤 Uploading image ${filename} (${hash})`);
        
        // Show upload notification
        const notificationId = 'upload-' + hash;
        if (window.unifiedNotifications) {
            window.unifiedNotifications.show({
                id: notificationId,
                type: 'info',
                message: `Uploading ${filename}`,
                progress: { current: 0, total: 100, showBar: true },
                duration: 0, // Don't auto-dismiss
                persistent: true,
                closeable: false
            });
        }

        try {
            // Convert base64 to blob
            const blob = await this._dataURLToBlob(imageData);
            
            // Create form data
            const formData = new FormData();
            formData.append('file', blob, filename); // Server expects 'file' field
            formData.append('hash', hash);

            // Upload with progress tracking
            const response = await this._uploadWithProgress(formData, filename, hash);

            if (!response.ok) {
                throw new Error(`Upload failed: ${response.statusText}`);
            }

            const result = await response.json();
            console.log(`✅ Upload complete for ${filename}:`, result);
            
            // Show success notification
            if (window.unifiedNotifications) {
                window.unifiedNotifications.remove(notificationId);
                window.unifiedNotifications.success(`${filename} uploaded successfully`);
            }

            return {
                url: result.url,
                hash: hash,
                size: blob.size
            };
        } catch (error) {
            console.error(`❌ Upload failed for ${filename}:`, error);
            
            // Show error notification
            if (window.unifiedNotifications) {
                window.unifiedNotifications.remove(notificationId);
                window.unifiedNotifications.error(`Failed to upload ${filename}`, { detail: error.message });
            }
            
            throw error;
        }
    }

    async _uploadWithProgress(formData, filename, hash) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();

            // Track upload progress
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const percentComplete = Math.round((e.loaded / e.total) * 100);
                    this._updateProgress(filename, percentComplete, hash);
                }
            });

            xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve({
                        ok: true,
                        status: xhr.status,
                        statusText: xhr.statusText,
                        json: () => Promise.resolve(JSON.parse(xhr.responseText))
                    });
                } else {
                    reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
                }
            });

            xhr.addEventListener('error', () => {
                reject(new Error('Network error during upload'));
            });

            xhr.addEventListener('abort', () => {
                reject(new Error('Upload aborted'));
            });

            xhr.open('POST', this.uploadUrl);
            xhr.send(formData);
        });
    }

    _updateProgress(filename, percent, hash) {
        // Update progress in unified notifications if available
        if (window.unifiedNotifications) {
            const notificationId = 'upload-' + (hash || filename);
            window.unifiedNotifications.update(notificationId, {
                message: `Uploading ${filename}`,
                progress: { current: percent, total: 100, showBar: true }
            });
        }
    }

    async _dataURLToBlob(dataURL) {
        const response = await fetch(dataURL);
        return response.blob();
    }

    /**
     * Check if an image is already uploaded
     */
    isUploading(hash) {
        return this.uploadQueue.has(hash);
    }

    /**
     * Get upload promise for a hash if it exists
     */
    getUploadPromise(hash) {
        return this.uploadQueue.get(hash);
    }
}

// Create global instance
window.imageUploadManager = new ImageUploadManager();