# Workers Directory

This directory should contain all worker scripts:

## Files to move here (currently in root):
- worker.ts → workers/import-worker.ts
- title-vectorization-worker.ts → workers/title-vectorization-worker.ts  
- thumbnail-vectorization-worker.ts → workers/thumbnail-vectorization-worker.ts
- format-classification-worker.ts → workers/format-classification-worker.ts
- topic-classification-worker.ts → workers/topic-classification-worker.ts
- video-classification-worker.ts → workers/video-classification-worker.ts
- queue-manager.js → workers/queue-manager.js

## Important Notes:
- These files need import updates in package.json scripts
- Test workers after moving: npm run workers:all
- Do NOT move these files without updating imports!

## To move these files safely:
1. Update package.json scripts to point to new locations
2. Move the files
3. Test each worker individually
