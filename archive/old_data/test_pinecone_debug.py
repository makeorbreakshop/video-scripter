#!/usr/bin/env python3
"""
Pytest test suite to debug Pinecone vector upsert issues
"""

import pytest
import asyncio
import os
import json
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

@pytest.fixture
def test_data():
    """Test data for embeddings"""
    return {
        "video_id": "test-video-123",
        "title": "Test Video Title",
        "channel_id": "test-channel-123",
        "view_count": 1000,
        "published_at": "2023-01-01T00:00:00Z",
        "performance_ratio": 1.5,
        "embedding": [0.1] * 512  # 512-dimension vector
    }

@pytest.fixture
def pinecone_vector(test_data):
    """Create a properly formatted Pinecone vector"""
    return {
        "id": str(test_data["video_id"]),
        "values": test_data["embedding"],
        "metadata": {
            "title": str(test_data["title"]),
            "channel_id": str(test_data["channel_id"]),
            "view_count": int(test_data["view_count"]),
            "published_at": str(test_data["published_at"]),
            "performance_ratio": float(test_data["performance_ratio"]),
            "embedding_version": "v1"
        }
    }

def test_vector_structure(pinecone_vector):
    """Test that our vector has the correct structure"""
    print("\n🔍 Testing vector structure...")
    
    # Check required fields
    assert "id" in pinecone_vector, "Vector missing 'id' field"
    assert "values" in pinecone_vector, "Vector missing 'values' field"
    assert "metadata" in pinecone_vector, "Vector missing 'metadata' field"
    
    # Check field types
    assert isinstance(pinecone_vector["id"], str), "ID must be string"
    assert isinstance(pinecone_vector["values"], list), "Values must be list"
    assert isinstance(pinecone_vector["metadata"], dict), "Metadata must be dict"
    
    # Check vector dimensions
    assert len(pinecone_vector["values"]) == 512, f"Expected 512 dimensions, got {len(pinecone_vector['values'])}"
    
    print(f"✅ Vector structure is valid")
    print(f"   ID: {pinecone_vector['id']}")
    print(f"   Values length: {len(pinecone_vector['values'])}")
    print(f"   Metadata keys: {list(pinecone_vector['metadata'].keys())}")

def test_vector_serialization(pinecone_vector):
    """Test that vector can be serialized to JSON"""
    print("\n🔍 Testing vector JSON serialization...")
    
    try:
        json_str = json.dumps(pinecone_vector)
        deserialized = json.loads(json_str)
        
        # Verify structure is preserved
        assert deserialized["id"] == pinecone_vector["id"]
        assert len(deserialized["values"]) == len(pinecone_vector["values"])
        assert deserialized["metadata"] == pinecone_vector["metadata"]
        
        print("✅ Vector serializes correctly to JSON")
        
    except Exception as e:
        pytest.fail(f"Vector serialization failed: {e}")

@pytest.mark.asyncio
async def test_openai_embedding_generation():
    """Test that OpenAI embeddings work correctly"""
    print("\n🔍 Testing OpenAI embedding generation...")
    
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        pytest.skip("OPENAI_API_KEY not available")
    
    try:
        import aiohttp
        
        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://api.openai.com/v1/embeddings",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "input": "Test video title for embedding",
                    "model": "text-embedding-3-small",
                    "dimensions": 512
                }
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    embedding = data["data"][0]["embedding"]
                    
                    assert len(embedding) == 512, f"Expected 512 dimensions, got {len(embedding)}"
                    assert all(isinstance(x, (int, float)) for x in embedding), "All values must be numeric"
                    
                    print(f"✅ OpenAI embedding generated successfully")
                    print(f"   Dimensions: {len(embedding)}")
                    print(f"   First 3 values: {embedding[:3]}")
                else:
                    text = await response.text()
                    pytest.fail(f"OpenAI API failed: {response.status} - {text}")
                    
    except ImportError:
        pytest.skip("aiohttp not available for async HTTP requests")
    except Exception as e:
        pytest.fail(f"OpenAI embedding test failed: {e}")

@pytest.mark.asyncio
async def test_pinecone_connection():
    """Test basic Pinecone connection"""
    print("\n🔍 Testing Pinecone connection...")
    
    api_key = os.getenv("PINECONE_API_KEY")
    index_name = os.getenv("PINECONE_INDEX_NAME")
    
    if not api_key or not index_name:
        pytest.skip("Pinecone credentials not available")
    
    try:
        from pinecone import Pinecone
        
        pc = Pinecone(api_key=api_key)
        index = pc.Index(index_name)
        
        # Test connection with stats
        stats = index.describe_index_stats()
        
        print(f"✅ Pinecone connection successful")
        print(f"   Index: {index_name}")
        print(f"   Total vectors: {stats.get('total_vector_count', 0)}")
        print(f"   Dimension: {stats.get('dimension', 'unknown')}")
        
    except ImportError:
        pytest.skip("Pinecone package not available")
    except Exception as e:
        pytest.fail(f"Pinecone connection failed: {e}")

@pytest.mark.asyncio
async def test_pinecone_vector_upsert(pinecone_vector):
    """Test actual Pinecone vector upsert"""
    print("\n🔍 Testing Pinecone vector upsert...")
    
    api_key = os.getenv("PINECONE_API_KEY")
    index_name = os.getenv("PINECONE_INDEX_NAME")
    
    if not api_key or not index_name:
        pytest.skip("Pinecone credentials not available")
    
    try:
        from pinecone import Pinecone
        
        pc = Pinecone(api_key=api_key)
        index = pc.Index(index_name)
        
        print(f"🔍 Vector before upsert:")
        print(json.dumps(pinecone_vector, indent=2))
        
        # Try upsert with single vector
        result = index.upsert(vectors=[pinecone_vector])
        
        print(f"✅ Pinecone upsert successful")
        print(f"   Result: {result}")
        
        # Verify vector was stored
        fetch_result = index.fetch(ids=[pinecone_vector["id"]])
        if pinecone_vector["id"] in fetch_result.get("vectors", {}):
            print(f"✅ Vector successfully stored and retrievable")
        else:
            print(f"⚠️ Vector upserted but not immediately retrievable")
            
    except ImportError:
        pytest.skip("Pinecone package not available")
    except Exception as e:
        print(f"❌ Pinecone upsert failed: {e}")
        print(f"   Error type: {type(e).__name__}")
        # Don't fail the test, just log the error for debugging
        pytest.fail(f"Pinecone upsert failed: {e}")

def test_nodejs_vector_format(test_data):
    """Test that our vector matches Node.js expected format"""
    print("\n🔍 Testing Node.js vector format compatibility...")
    
    # Create vector exactly as Node.js code does
    vector = {
        "id": str(test_data["video_id"]),
        "values": test_data["embedding"],
        "metadata": {
            "title": str(test_data["title"]),
            "channel_id": str(test_data["channel_id"]),
            "view_count": int(test_data["view_count"]),
            "published_at": str(test_data["published_at"]),
            "performance_ratio": float(test_data["performance_ratio"]),
            "embedding_version": "v1"
        }
    }
    
    # Validate exactly as Pinecone expects
    assert isinstance(vector, dict), "Vector must be dict/object"
    assert "id" in vector, "Vector must have 'id' field"
    assert "values" in vector, "Vector must have 'values' field"
    assert vector["id"] is not None, "Vector ID cannot be None"
    assert vector["values"] is not None, "Vector values cannot be None"
    assert len(vector["values"]) > 0, "Vector values cannot be empty"
    
    print(f"✅ Vector matches Node.js expected format")
    print(f"   Object keys: {list(vector.keys())}")
    print(f"   ID type: {type(vector['id'])}")
    print(f"   Values type: {type(vector['values'])}")
    print(f"   Metadata type: {type(vector['metadata'])}")

if __name__ == "__main__":
    # Run tests directly if called as script
    pytest.main([__file__, "-v", "-s"])