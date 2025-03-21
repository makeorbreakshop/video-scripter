"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface ImportResultsProps {
  isOpen: boolean;
  onClose: () => void;
  results: any | null;
  onViewDatabase: () => void;
}

export default function ImportResultsDialog({ isOpen, onClose, results, onViewDatabase }: ImportResultsProps) {
  if (!results) return null;
  
  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent className="max-w-4xl w-full overflow-hidden">
        <AlertDialogHeader>
          <AlertDialogTitle>Bulk Import Results</AlertDialogTitle>
          <AlertDialogDescription>
            Summary of the bulk import process for {results?.totalVideos || 0} videos.
          </AlertDialogDescription>
        </AlertDialogHeader>
        
        <div className="mt-4 space-y-6 overflow-y-auto max-h-[70vh]">
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg">
              <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Videos</div>
              <div className="text-2xl font-semibold">{results.totalVideos}</div>
            </div>
            <div className="bg-green-100 dark:bg-green-900/20 p-4 rounded-lg">
              <div className="text-sm font-medium text-green-800 dark:text-green-300">Successful</div>
              <div className="text-2xl font-semibold text-green-800 dark:text-green-300">{results.successCount}</div>
            </div>
            <div className="bg-blue-100 dark:bg-blue-900/20 p-4 rounded-lg">
              <div className="text-sm font-medium text-blue-800 dark:text-blue-300">Already Existed</div>
              <div className="text-2xl font-semibold text-blue-800 dark:text-blue-300">{results.alreadyExistsCount}</div>
            </div>
            <div className="bg-red-100 dark:bg-red-900/20 p-4 rounded-lg">
              <div className="text-sm font-medium text-red-800 dark:text-red-300">Failed</div>
              <div className="text-2xl font-semibold text-red-800 dark:text-red-300">{results.errorCount}</div>
            </div>
          </div>
          
          {results.results && results.results.length > 0 && (
            <div className="mt-6">
              <h3 className="text-lg font-medium mb-3">Processing Details</h3>
              <div className="overflow-y-auto border rounded-md max-h-64">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Video</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Details</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-800">
                    {results.results.map((result: any) => (
                      <tr 
                        key={`${result.videoId || result.title}-${result.status}`} 
                        className={
                          result.status === 'success' ? 'bg-green-50 dark:bg-green-900/10' : 
                          result.status === 'already_exists' ? 'bg-blue-50 dark:bg-blue-900/10' : 
                          'bg-red-50 dark:bg-red-900/10'
                        }
                      >
                        <td className="px-6 py-4 text-sm font-medium whitespace-normal break-words max-w-xs">
                          {result.title || result.videoId}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            result.status === 'success' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 
                            result.status === 'already_exists' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' : 
                            'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                          }`}>
                            {result.status === 'success' ? 'Imported' : 
                             result.status === 'already_exists' ? 'Already Exists' : 
                             'Failed'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                          {result.status === 'success' && `${result.commentCount} comments, ${result.wordCount} words`}
                          {result.status === 'already_exists' && `${result.commentCount} comments`}
                          {result.status === 'error' && result.message}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          
          {results.errorCount > 0 && results.errors && (
            <div className="mt-6">
              <h3 className="text-lg font-medium mb-3 text-red-600 dark:text-red-400">Errors</h3>
              <div className="max-h-48 overflow-y-auto space-y-2">
                {results.errors.map((error: any) => (
                  <div 
                    key={`error-${error.videoId}`} 
                    className="p-3 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 rounded-md"
                  >
                    <p className="font-medium">{error.videoId}</p>
                    <p className="text-sm">{error.error}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        
        <AlertDialogFooter className="mt-6">
          <Button variant="outline" onClick={() => onClose()}>Close</Button>
          <Button onClick={onViewDatabase}>
            View Database
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Create a component to show during the import process
export function ProcessingImportDialog({ 
  isOpen, 
  onClose, 
  videoCount
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  videoCount: number;
}) {
  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Processing Import</AlertDialogTitle>
          <AlertDialogDescription>
            Processing {videoCount} video{videoCount !== 1 ? 's' : ''}. This may take a few minutes.
          </AlertDialogDescription>
        </AlertDialogHeader>
        
        <div className="my-6 space-y-4">
          <div className="h-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full bg-blue-600 rounded-full animate-pulse w-full" />
          </div>
          
          <div className="flex items-center justify-center">
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Processing videos and generating embeddings...
            </span>
          </div>
        </div>
        
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => onClose()}>Cancel</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
} 