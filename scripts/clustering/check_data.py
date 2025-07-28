import json

with open('embeddings-part-1.json', 'r') as f:
    data = json.load(f)

print(f"Total embeddings in file: {data['count']}")
print(f"File part: {data['part']}")
print("\nFirst 10 embeddings structure:")

for i, emb in enumerate(data['embeddings'][:10]):
    print(f"\n{i+1}. ID: {emb['id']}")
    print(f"   Values: {len(emb['values'])} dimensions")
    if 'metadata' in emb:
        print(f"   Metadata keys: {list(emb['metadata'].keys())}")
        if 'title' in emb['metadata']:
            print(f"   Title: {emb['metadata']['title'][:60]}")
    else:
        print("   NO METADATA!")