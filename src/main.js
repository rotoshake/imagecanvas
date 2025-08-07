// src/main.js
// ------------------------------
// ImageCanvas ES-Module bootstrap
// ------------------------------

// 1) Critical foundational scripts loaded first (order matters)
import '../js/utils/config.js';
import '../js/utils/font-config.js';
import '../js/utils/colors.js';
import '../js/utils/utils.js';
import '../js/utils/state.js';
import '../js/utils/cache.js';
import '../js/utils/file-hash.js';
import '../js/utils/undo-optimization.js';
import '../js/utils/ImageLoadManager.js';
import '../js/utils/IndexedDBThumbnailStore.js';
import '../js/utils/lod-cache.js';

// Keyboard shortcuts system
import '../js/config/keyboard-shortcuts.js';
import '../js/config/keyboard-shortcuts-integration.js';

// 2) Core systems and renderers
import '../js/renderers/Canvas2DRenderer.js';
import '../js/renderers/TextureLODManager.js';
import '../js/renderers/TextureAtlasManager.js';
// New unified texture system (experimental)
import '../js/renderers/UnifiedTextureManager.js';
import '../js/renderers/TextureProgressiveLoader.js';
import '../js/renderers/TextureSystemIntegration.js';
import '../js/renderers/WebGLRenderer.js';
import '../js/graph.js';
import '../js/canvas.js';
import '../js/dragdrop.js';

// 3) Core systems
import '../js/core/animation.js';
import '../js/core/viewport.js';
import '../js/core/selection.js';
import '../js/core/ThumbnailRequestCoordinator.js';
import '../js/core/handles.js';
import '../js/core/alignment.js';
import '../js/core/BulkOperationManager.js';
import '../js/core/GraphCircularReferenceResolver.js';
import '../js/core/ImageResourceCache.js';
import '../js/core/MemoryManager.js';
import '../js/core/OffscreenRenderCache.js';
import '../js/core/PerformanceMonitor.js';
import '../js/core/LocalFirstOperations.js';
import '../js/core/NavigationStateManager.js';
import '../js/core/OperationPersistence.js';
import '../js/core/OperationTracker.js';
import '../js/core/TransactionManager.js';
import '../js/core/PersistenceHandler.js';
import '../js/core/CleanupManager.js';
import '../js/core/OperationDependencyTracker.js';
import '../js/core/ImageUploadManager.js';
import '../js/core/ImageProcessingProgressManager.js';
import '../js/core/ImageUploadCoordinator.js';
import '../js/core/GalleryViewManager.js';
import '../js/core/BackgroundSyncManager.js';

// 4) Node classes
import '../js/nodes/base-node.js';
import '../js/nodes/image-node.js';
import '../js/nodes/video-node.js';
import '../js/nodes/text-node.js';
import '../js/nodes/group-node.js';
import '../js/nodes/pinned-note-node.js';

// 5) Node plugin system
import '../js/core/NodePluginSystem.js';

// 6) User profile system
import '../js/core/UserProfileSystem.js';

// 7) Example plugins (optional)
import '../js/plugins/ShapeNode.js';

// 8) Base Command class first
import '../js/commands/Command.js';

// 9) Commands that extend Command
import '../js/commands/BulkCommand.js';
import '../js/commands/NodeCommands.js';
import '../js/commands/NodeCommandsExtended.js';
import '../js/commands/CanvasCommands.js';
import '../js/commands/ImageUploadCompleteCommand.js';

// 10) Core systems that depend on Commands
import '../js/core/OperationPipeline.js';
import '../js/core/StateSyncManager.js';

// 11) Collaborative Architecture
import '../js/core/NetworkLayer.js';
import '../js/core/ClientUndoManager.js';
import '../js/core/CollaborativeArchitecture.js';
import '../js/core/VideoProcessingListener.js';
import '../js/core/OtherUsersSelectionManager.js';
import '../js/core/OtherUsersMouseManager.js';
import '../js/core/UserFollowManager.js';
import '../js/core/AutoInit.js';

// 12) UI Components
import '../js/ui/canvas-navigator.js';
import '../js/ui/connection-status.js';
import '../js/ui/floating-properties-inspector.js';
import '../js/ui/components/spline-curve-editor.js';
import '../js/ui/components/color-balance-wheel.js';
import '../js/ui/floating-color-correction.js';
import '../js/ui/unified-notifications.js';
import '../js/ui/node-creation-menu.js';
import '../js/ui/user-profile-panel.js';
import '../js/ui/chat-panel.js';

// 13) Finally boot the application after all globals are defined
import '../js/app.js';
