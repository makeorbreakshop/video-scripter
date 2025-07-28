// Script to fix Supabase database issues
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

// Get environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Create Supabase client
const supabase = createClient(supabaseUrl, supabaseKey);

// Use your actual user ID if you have it or create a new random one
// Don't use 00000000-0000-0000-0000-000000000000 as it's not in auth.users
const randomUuid = () => {
  const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
  return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
};

const projectId = randomUuid();
const documentId = randomUuid();
const scriptDataId = randomUuid();
const userId = randomUuid();

async function fixDatabase() {
  console.log('Starting database fix...');
  console.log('Using Supabase URL:', supabaseUrl);
  console.log('Generated IDs for testing:');
  console.log('- Project ID:', projectId);
  console.log('- Document ID:', documentId);
  console.log('- Script Data ID:', scriptDataId);
  console.log('- User ID:', userId);
  
  try {
    // Check if tables exist
    console.log('Checking projects table...');
    const { data: projectsExists, error: projectsError } = await supabase
      .from('projects')
      .select('count', { count: 'exact', head: true });
    
    if (projectsError) {
      console.error('Error checking projects table:', projectsError);
    } else {
      console.log('Projects table exists.');
      
      // List any existing projects
      const { data: existingProjects, error: listError } = await supabase
        .from('projects')
        .select('*')
        .limit(5);
        
      if (listError) {
        console.error('Error listing projects:', listError);
      } else if (existingProjects && existingProjects.length > 0) {
        console.log('Found existing projects:', existingProjects.length);
        console.log('First project:', existingProjects[0]);
        
        // If there are existing projects, we can use one instead of creating a new one
        if (existingProjects.length > 0) {
          console.log('Using existing project instead of creating a new one');
          return;
        }
      } else {
        console.log('No existing projects found, will create a new one');
      }
    }
    
    // Create a new project
    console.log('Creating new test project...');
    const now = new Date().toISOString();
    
    const { data: projectData, error: projectError } = await supabase
      .from('projects')
      .insert({
        id: projectId,
        name: 'Test Project',
        user_id: userId, // Use a random UUID that won't conflict with auth.users
        created_at: now,
        updated_at: now,
      })
      .select();
      
    if (projectError) {
      console.error('Error creating test project:', projectError);
      
      // Check if the error is related to the user_id foreign key
      if (projectError.code === '23503' && projectError.details?.includes('user_id')) {
        console.log('This is a foreign key constraint error. You need to:');
        console.log('1. Either insert a matching user ID in auth.users');
        console.log('2. Or run SQL to disable/drop the constraint temporarily');
        console.log('3. Or use an existing user ID from your auth.users table');
      }
    } else {
      console.log('Test project created successfully!');
      
      // Create a document
      const { data: docData, error: docError } = await supabase
        .from('documents')
        .insert({
          id: documentId,
          title: 'Test Document',
          type: 'notes',
          content: 'This is a test document.',
          project_id: projectId,
          user_id: userId,
          created_at: now,
          updated_at: now,
        })
        .select();
        
      if (docError) {
        console.error('Error creating test document:', docError);
      } else {
        console.log('Test document created successfully!');
      }
      
      // Create script data
      const { data: scriptData, error: scriptError } = await supabase
        .from('script_data')
        .insert({
          id: scriptDataId,
          project_id: projectId,
          user_id: userId,
          data: {
            research: {
              videoUrls: [],
              notes: "Test notes",
              summary: "Test summary",
              analyzedVideos: [],
              analysis: {
                contentCoverage: [],
                audienceReactions: [],
                commonQuestions: [],
                contentSuggestions: [],
                isProcessed: false,
              },
            },
            packaging: {
              titles: [],
              thumbnailConcepts: [],
              videoUrls: [],
              ideas: [],
              videoAnalysis: null,
            },
            scripting: {
              introBrick: {
                hook: "",
                problem: "",
                setup: "",
                credibility: "",
                transition: "",
              },
              middleBricks: [],
              endBrick: {
                transition: "",
                callToAction: "",
              },
            },
            refinement: {
              feedback: [],
              checklist: {
                "title-thumbnail": false,
                "language-simplicity": false,
                "sentence-length": false,
                transitions: false,
                "beginner-friendly": false,
                repetition: false,
              },
            },
            export: {
              format: "plain",
            },
          },
          created_at: now,
          updated_at: now,
        })
        .select();
        
      if (scriptError) {
        console.error('Error creating test script data:', scriptError);
      } else {
        console.log('Test script data created successfully!');
      }
    }
    
  } catch (error) {
    console.error('Unexpected error during database fix:', error);
  }
  
  console.log('Database fix completed. Check for any errors above.');
}

// Run the database fix
fixDatabase(); 