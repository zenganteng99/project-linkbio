#!/bin/bash

echo "=== Testing R2 Upload ==="

# Create a test image
echo "Creating test image..."
echo "test" > /tmp/test.txt

# Test upload with proper boundary
echo "Testing upload..."
curl -X POST https://customlink-webhook.modernshopp.workers.dev/api/upload-image \
  -H "Content-Type: multipart/form-data; boundary=----WebKitFormBoundary" \
  -F "file=@/tmp/test.txt;type=image/jpeg" \
  2>/dev/null

echo ""
echo "Test complete"
