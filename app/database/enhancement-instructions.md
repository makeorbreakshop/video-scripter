# How to Add the Enhanced Process Button to the Database Page

Follow these steps to add the EnhancedProcessButton to your database page:

## Step 1: Add the Import

Add this import at the top of `app/database/page.tsx`:

```typescript
import { EnhancedProcessButton } from "@/app/components/EnhancedProcessButton";
```

## Step 2: Add Success and Error Handlers

Add these functions inside your `DatabasePage` component, alongside your existing functions:

```typescript
// Handler for enhanced processing success
const handleEnhancedSuccess = (result: {
  videoId: string;
  totalChunks: number;
  transcriptChunks?: number;
  commentClusters?: number;
  descriptionChunks?: number;
}) => {
  setProcessStatus({ 
    status: 'success', 
    message: `Video processed with enhanced chunking! (${result.transcriptChunks} transcript chunks, ${result.commentClusters} comment clusters)`,
    videoId: result.videoId,
    totalChunks: result.totalChunks
  });
  
  // Refresh the video list
  fetchVideos();
  
  // Clear the input
  setUrl("");
};

// Handler for enhanced processing error
const handleEnhancedError = (error: string) => {
  setProcessStatus({ 
    status: 'error', 
    message: error
  });
};
```

## Step 3: Add the Button Component

Add this right after the existing Process Video button (after the closing `</div>` of the input and button flex container):

```jsx
<div className="flex justify-end mt-2 mb-4">
  <EnhancedProcessButton
    videoUrl={url}
    userId="00000000-0000-0000-0000-000000000000" // Default user ID, replace with actual auth
    onSuccess={handleEnhancedSuccess}
    onError={handleEnhancedError}
    className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white"
    buttonText="Process with Enhanced Chunking"
  />
</div>
```

## Complete Example

The button section of your UI should look like this after the changes:

```jsx
<div className="flex gap-2 mb-4">
  <Input
    placeholder="Enter YouTube URL (e.g., https://www.youtube.com/watch?v=...)"
    value={url}
    onChange={(e) => setUrl(e.target.value)}
    disabled={processStatus.status === 'processing'}
    className="flex-grow"
  />
  <Button 
    onClick={processVideo} 
    disabled={!url.trim() || processStatus.status === 'processing'}
  >
    {processStatus.status === 'processing' ? (
      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
    ) : (
      <Video className="mr-2 h-4 w-4" />
    )}
    Process Video
  </Button>
</div>

<div className="flex justify-end mt-2 mb-4">
  <EnhancedProcessButton
    videoUrl={url}
    userId="00000000-0000-0000-0000-000000000000" // Default user ID, replace with actual auth
    onSuccess={handleEnhancedSuccess}
    onError={handleEnhancedError}
    className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white"
    buttonText="Process with Enhanced Chunking"
  />
</div>
```

This adds a visually distinct enhanced processing button positioned below the standard process button. 