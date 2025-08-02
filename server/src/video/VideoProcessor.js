const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');
const treeKill = require('tree-kill');

class VideoProcessor extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = {
            outputFormats: ['webm'], // MP4 disabled for now: add 'mp4' back to array to re-enable
            webmOptions: {
                videoCodec: 'libvpx-vp9',
                crf: 30,
                videoBitrate: '0', // Let CRF control quality
                audioCodec: 'libopus',
                audioBitrate: '128k'
            },
            mp4Options: {
                videoCodec: 'libx264',
                preset: 'fast',
                crf: 23,
                audioCodec: 'aac',
                audioBitrate: '128k'
            },
            maxWidth: 1920,
            maxHeight: 1080,
            deleteOriginal: true,
            ...config
        };
        
        // Queue for processing videos sequentially to avoid overload
        this.processingQueue = [];
        this.isProcessing = false;
        
        // Socket.io reference for emitting progress
        this.io = null;
        
        // Track active ffmpeg processes for cancellation
        this.activeProcesses = new Map(); // filename -> { command, pid, cancelled }
    }
    
    /**
     * Set Socket.io instance for emitting progress
     */
    setSocketIO(io) {
        this.io = io;
    }

    /**
     * Process a video file, converting it to web-optimized formats
     * @param {string} inputPath - Path to input video file
     * @param {string} outputDir - Directory for output files
     * @param {string} baseFilename - Base filename without extension
     * @returns {Promise<Object>} - Paths to converted files
     */
    async processVideo(inputPath, outputDir, baseFilename, originalFilename) {
        return new Promise((resolve, reject) => {
            const job = { inputPath, outputDir, baseFilename, originalFilename, resolve, reject };
            this.processingQueue.push(job);
            
            // Emit queued event with queue position
            const queuePosition = this.processingQueue.length;
            if (this.io && queuePosition > 1) {
                this.io.emit('video_processing_queued', {
                    filename: originalFilename,
                    serverFilename: baseFilename,
                    queuePosition: queuePosition,
                    queueLength: this.processingQueue.length
                });
            }
            
            this._processNext();
        });
    }

    async _processNext() {
        if (this.isProcessing || this.processingQueue.length === 0) return;
        
        this.isProcessing = true;
        const job = this.processingQueue.shift();
        
        // Update queue positions for remaining jobs
        if (this.io && this.processingQueue.length > 0) {
            this.processingQueue.forEach((queuedJob, index) => {
                this.io.emit('video_processing_queued', {
                    filename: queuedJob.originalFilename,
                    serverFilename: queuedJob.baseFilename,
                    queuePosition: index + 1,
                    queueLength: this.processingQueue.length
                });
            });
        }
        
        try {
            const result = await this._processVideoJob(job);
            job.resolve(result);
        } catch (error) {
            job.reject(error);
        } finally {
            this.isProcessing = false;
            // Process next in queue
            setImmediate(() => this._processNext());
        }
    }

    async _processVideoJob({ inputPath, outputDir, baseFilename, originalFilename }) {
        console.log(`🎬 Starting video processing for ${baseFilename}`);
        
        // Store that we're processing this file
        this.activeProcesses.set(originalFilename, { cancelled: false });
        
        // Get video metadata first
        const metadata = await this._getVideoMetadata(inputPath);
        console.log(`📊 Video metadata:`, {
            duration: metadata.format.duration,
            size: `${metadata.video.width}x${metadata.video.height}`,
            codec: metadata.video.codec
        });

        const results = {
            metadata,
            formats: {},
            thumbnailPath: null
        };

        // Generate thumbnail first
        try {
            results.thumbnailPath = await this._generateThumbnail(inputPath, outputDir, baseFilename);
            console.log(`🖼️ Generated thumbnail for ${baseFilename}`);
        } catch (error) {
            console.error(`⚠️ Thumbnail generation failed for ${baseFilename}:`, error.message);
        }

        // Convert to each format
        for (const format of this.config.outputFormats) {
            try {
                const outputPath = path.join(outputDir, `${baseFilename}.${format}`);
                console.log(`🔄 Converting ${baseFilename} to ${format}...`);
                
                // Check if cancelled before starting conversion
                const processInfo = this.activeProcesses.get(originalFilename);
                if (processInfo && processInfo.cancelled) {
                    console.log(`⏹️ Skipping conversion for cancelled video: ${originalFilename}`);
                    break;
                }
                
                await this._convertVideo(inputPath, outputPath, format, metadata, originalFilename);
                results.formats[format] = outputPath;
                
                console.log(`✅ Successfully converted ${baseFilename} to ${format}`);
            } catch (error) {
                console.error(`❌ Failed to convert ${baseFilename} to ${format}:`, error.message);
                // Continue with other formats even if one fails
            }
        }

        // Delete original if requested and at least one conversion succeeded
        if (this.config.deleteOriginal && Object.keys(results.formats).length > 0) {
            try {
                await fs.unlink(inputPath);
                console.log(`🗑️ Deleted original file: ${baseFilename}`);
            } catch (error) {
                console.error(`⚠️ Failed to delete original file:`, error.message);
            }
        }

        // Clean up tracking
        this.activeProcesses.delete(originalFilename);

        return results;
    }

    _getVideoMetadata(inputPath) {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(inputPath, (err, metadata) => {
                if (err) reject(err);
                else {
                    // Extract relevant info
                    const videoStream = metadata.streams.find(s => s.codec_type === 'video');
                    const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
                    
                    resolve({
                        format: metadata.format,
                        video: videoStream ? {
                            width: videoStream.width,
                            height: videoStream.height,
                            codec: videoStream.codec_name,
                            fps: eval(videoStream.r_frame_rate) // Convert "30/1" to 30
                        } : null,
                        audio: audioStream ? {
                            codec: audioStream.codec_name,
                            bitrate: audioStream.bit_rate
                        } : null
                    });
                }
            });
        });
    }

    _generateThumbnail(inputPath, outputDir, baseFilename) {
        return new Promise((resolve, reject) => {
            const thumbnailPath = path.join(outputDir, `${baseFilename}_thumb.jpg`);
            
            ffmpeg(inputPath)
                .screenshots({
                    timestamps: ['10%'], // Take screenshot at 10% of video duration
                    filename: `${baseFilename}_thumb.jpg`,
                    folder: outputDir,
                    size: '320x?'  // Width 320px, maintain aspect ratio
                })
                .on('end', () => resolve(thumbnailPath))
                .on('error', reject);
        });
    }

    _convertVideo(inputPath, outputPath, format, metadata, originalFilename) {
        return new Promise((resolve, reject) => {
            console.log(`🎬 Starting conversion for ${originalFilename} to ${format}`);
            
            // Check if already cancelled
            const processInfo = this.activeProcesses.get(originalFilename);
            if (processInfo && processInfo.cancelled) {
                console.log(`⏹️ Conversion cancelled before start: ${originalFilename}`);
                reject(new Error('Processing cancelled by user'));
                return;
            }
            
            const command = ffmpeg(inputPath);
            
            // Store the command for potential cancellation
            if (originalFilename && processInfo) {
                processInfo.command = command;
                processInfo.format = format;
                console.log(`📌 Stored ffmpeg command for ${originalFilename} (${format})`);
            }
            
            // Calculate output dimensions maintaining aspect ratio
            const { width, height } = this._calculateOutputDimensions(
                metadata.video.width, 
                metadata.video.height
            );

            // Apply format-specific options
            if (format === 'webm') {
                const opts = this.config.webmOptions;
                command
                    .videoCodec(opts.videoCodec)
                    .outputOptions([
                        `-crf ${opts.crf}`,
                        `-b:v ${opts.videoBitrate}`,
                        '-row-mt 1', // Enable row-based multithreading
                        '-cpu-used 2' // Balance speed/quality (0-5, lower = better quality)
                    ])
                    .audioCodec(opts.audioCodec)
                    .audioBitrate(opts.audioBitrate);
            } else if (format === 'mp4') {
                const opts = this.config.mp4Options;
                command
                    .videoCodec(opts.videoCodec)
                    .outputOptions([
                        `-preset ${opts.preset}`,
                        `-crf ${opts.crf}`,
                        '-movflags +faststart' // Enable streaming
                    ])
                    .audioCodec(opts.audioCodec)
                    .audioBitrate(opts.audioBitrate);
            }

            // Set output size if needed
            if (width !== metadata.video.width || height !== metadata.video.height) {
                command.size(`${width}x${height}`);
            }

            // Track progress
            let duration = metadata.format.duration;
            command.on('progress', (progress) => {
                // Check if cancelled before emitting progress
                const processInfo = this.activeProcesses.get(originalFilename);
                if (processInfo && processInfo.cancelled) {
                    console.log(`⏹️ Skipping progress update for cancelled video: ${originalFilename}`);
                    return;
                }
                
                if (duration) {
                    const percent = (progress.timemark ? this._timemarkToSeconds(progress.timemark) / duration * 100 : 0);
                    const progressData = {
                        file: path.basename(inputPath),
                        format,
                        percent: Math.min(percent, 100)
                    };
                    
                    // Emit locally
                    this.emit('progress', progressData);
                    
                    // Also emit via Socket.io if available
                    if (this.io) {
                        this.io.emit('video_processing_progress', progressData);
                    }
                }
            });
            
            // Store reference to the ffmpeg process when it starts
            command.on('start', (commandLine) => {
                console.log(`🚀 FFmpeg started for ${originalFilename}: ${commandLine.substr(0, 100)}...`);
                if (originalFilename) {
                    const processInfo = this.activeProcesses.get(originalFilename);
                    if (processInfo) {
                        // Get the actual process reference
                        processInfo.ffmpegProc = command.ffmpegProc;
                        if (command.ffmpegProc && command.ffmpegProc.pid) {
                            processInfo.pid = command.ffmpegProc.pid;
                            console.log(`📌 Stored FFmpeg PID ${processInfo.pid} for ${originalFilename}`);
                        }
                    }
                }
            });

            command
                .on('end', () => {
                    console.log(`✅ Conversion complete for ${originalFilename} (${format})`);
                    resolve();
                })
                .on('error', (err) => {
                    console.log(`❌ Conversion error for ${originalFilename} (${format}):`, err.message);
                    // Check if this was due to cancellation
                    const processInfo = this.activeProcesses.get(originalFilename);
                    if (processInfo && processInfo.cancelled) {
                        console.log(`⏹️ Error was due to cancellation`);
                        // Don't reject with error for cancelled processes
                        resolve();
                    } else {
                        reject(err);
                    }
                })
                .output(outputPath)
                .run();
        });
    }

    _calculateOutputDimensions(originalWidth, originalHeight) {
        const { maxWidth, maxHeight } = this.config;
        
        // If video is smaller than max dimensions, keep original
        if (originalWidth <= maxWidth && originalHeight <= maxHeight) {
            return { width: originalWidth, height: originalHeight };
        }

        // Calculate scaling to fit within max dimensions
        const widthScale = maxWidth / originalWidth;
        const heightScale = maxHeight / originalHeight;
        const scale = Math.min(widthScale, heightScale);

        // Round to even numbers (required by many codecs)
        const width = Math.floor(originalWidth * scale / 2) * 2;
        const height = Math.floor(originalHeight * scale / 2) * 2;

        return { width, height };
    }

    _timemarkToSeconds(timemark) {
        // Convert ffmpeg timemark (HH:MM:SS.MS) to seconds
        const parts = timemark.split(':');
        return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
    }

    /**
     * Cancel video processing for a specific file
     * Returns a promise that resolves to true if cancelled, false if not found
     */
    async cancelProcessing(filename) {
        console.log(`🚫 Attempting to cancel video processing for: ${filename}`);
        
        // Check if in queue first
        const queueIndex = this.processingQueue.findIndex(job => job.originalFilename === filename);
        if (queueIndex !== -1) {
            // Remove from queue
            const removed = this.processingQueue.splice(queueIndex, 1)[0];
            console.log(`✅ Removed ${filename} from processing queue`);
            
            // Reject the promise
            removed.reject(new Error('Processing cancelled by user'));
            
            // Update queue positions
            if (this.io && this.processingQueue.length > 0) {
                this.processingQueue.forEach((queuedJob, index) => {
                    this.io.emit('video_processing_queued', {
                        filename: queuedJob.originalFilename,
                        serverFilename: queuedJob.baseFilename,
                        queuePosition: index + 1,
                        queueLength: this.processingQueue.length
                    });
                });
            }
            
            return true;
        }
        
        // Check if actively processing
        const processInfo = this.activeProcesses.get(filename);
        if (processInfo) {
            processInfo.cancelled = true;
            
            // Kill the ffmpeg process if it exists
            if (processInfo.pid) {
                console.log(`⏹️ Killing ffmpeg process tree for ${filename} (PID: ${processInfo.pid})`);
                
                return new Promise((resolve) => {
                    treeKill(processInfo.pid, 'SIGINT', (err) => {
                        if (err) {
                            console.error(`❌ Error killing process tree:`, err);
                            // Try SIGKILL as fallback
                            treeKill(processInfo.pid, 'SIGKILL', (err2) => {
                                if (err2) {
                                    console.error(`❌ SIGKILL also failed:`, err2);
                                }
                                // Clean up regardless
                                this.activeProcesses.delete(filename);
                                resolve(true);
                            });
                        } else {
                            console.log(`✅ Successfully killed process tree for ${filename}`);
                            // Clean up
                            this.activeProcesses.delete(filename);
                            resolve(true);
                        }
                    });
                });
            } else if (processInfo.command) {
                // Fallback to command.kill() if no PID
                console.log(`⏹️ Attempting to kill ffmpeg via command.kill() for ${filename}`);
                try {
                    processInfo.command.kill('SIGINT');
                } catch (killError) {
                    console.error(`❌ Error killing ffmpeg process:`, killError);
                }
                // Clean up
                this.activeProcesses.delete(filename);
                return true;
            } else {
                console.log(`⚠️ No process reference found for ${filename}`);
                // Clean up
                this.activeProcesses.delete(filename);
                return true;
            }
        }
        
        console.log(`⚠️ No active processing found for ${filename}`);
        return false;
    }

    /**
     * Check if video needs processing (is it already in optimal format?)
     */
    async needsProcessing(filePath) {
        try {
            const metadata = await this._getVideoMetadata(filePath);
            const ext = path.extname(filePath).toLowerCase();
            
            // Check if it's already in an optimal format with reasonable settings
            if (ext === '.webm' && metadata.video.codec === 'vp9') {
                return false;
            }
            if (ext === '.mp4' && metadata.video.codec === 'h264') {
                // Check if it needs resizing
                return metadata.video.width > this.config.maxWidth || 
                       metadata.video.height > this.config.maxHeight;
            }
            
            // All other formats need processing
            return true;
        } catch (error) {
            // If we can't read metadata, assume it needs processing
            return true;
        }
    }
}

module.exports = VideoProcessor;