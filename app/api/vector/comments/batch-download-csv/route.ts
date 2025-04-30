import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(req: NextRequest) {
  try {
    const { videoIds } = await req.json();
    
    // Validate input
    if (!videoIds || !Array.isArray(videoIds) || videoIds.length === 0) {
      return NextResponse.json(
        { error: "Invalid request: videoIds array is required" },
        { status: 400 }
      );
    }
    
    // Fetch video metadata for titles
    const { data: videos, error: videosError } = await supabaseAdmin
      .from("videos")
      .select("id, title")
      .in("id", videoIds);
    
    if (videosError) {
      console.error("Error fetching videos:", videosError);
      return NextResponse.json(
        { error: "Failed to fetch video metadata" },
        { status: 500 }
      );
    }
    
    // Create a map of video IDs to titles for easy lookup
    const videoTitles: Record<string, string> = {};
    videos?.forEach((video: any) => {
      videoTitles[video.id] = video.title;
    });
    
    // Fetch all comments for the selected videos
    const { data: comments, error: commentsError } = await supabaseAdmin
      .from("comments")
      .select("*")
      .in("video_id", videoIds)
      .order("published_at", { ascending: false });
    
    if (commentsError) {
      console.error("Error fetching comments:", commentsError);
      return NextResponse.json(
        { error: "Failed to fetch comments" },
        { status: 500 }
      );
    }
    
    if (!comments || comments.length === 0) {
      return NextResponse.json(
        { error: "No comments found for the selected videos" },
        { status: 404 }
      );
    }
    
    // Count comments by video for reporting
    const commentCountsByVideo: Record<string, number> = {};
    
    // Prepare CSV data
    // Headers
    let csvContent = "Video ID,Video Title,Comment ID,Author,Published At,Updated At,Like Count,Is Reply,Parent ID,Text\n";
    
    // Data rows
    comments.forEach((comment: any) => {
      const videoId = comment.video_id;
      const videoTitle = videoTitles[videoId] || "Unknown Video";
      
      // Count comments by video
      commentCountsByVideo[videoId] = (commentCountsByVideo[videoId] || 0) + 1;
      
      // Format the CSV row, ensuring text fields are properly escaped
      const row = [
        videoId,
        escapeCsvField(videoTitle),
        comment.comment_id,
        escapeCsvField(comment.author_name),
        formatDate(comment.published_at),
        formatDate(comment.updated_at),
        comment.likes_count,
        comment.is_reply ? "Yes" : "No",
        comment.parent_comment_id || "",
        escapeCsvField(comment.content)
      ].join(",");
      
      csvContent += row + "\n";
    });
    
    // Return CSV content
    return new NextResponse(csvContent, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="batch-comments-${new Date().toISOString().split("T")[0]}.csv"`,
      },
    });
    
  } catch (error) {
    console.error("Error in batch comments download:", error);
    return NextResponse.json(
      { error: "Failed to generate CSV: " + (error instanceof Error ? error.message : "Unknown error") },
      { status: 500 }
    );
  }
}

// Helper function to format date
function formatDate(dateString: string | null): string {
  if (!dateString) return "";
  
  try {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  } catch (e) {
    return dateString;
  }
}

// Helper function to escape CSV fields
function escapeCsvField(field: string): string {
  if (field === null || field === undefined) return "";
  
  const stringField = String(field);
  
  // If the field contains quotes, commas, or newlines, wrap it in quotes and escape any quotes
  if (stringField.includes('"') || stringField.includes(',') || stringField.includes('\n')) {
    return `"${stringField.replace(/"/g, '""')}"`;
  }
  
  return stringField;
} 