#!/usr/bin/env python3
import sys
sys.path.append('.')
from spider import TrueYouTubeSpider

spider = TrueYouTubeSpider()

# Test channel ID extraction
test_url = "https://www.youtube.com/@MakeorBreakShop"
print(f"Testing URL: {test_url}")

# Test the extraction step by step
handle = "MakeorBreakShop"
print(f"Handle: {handle}")

# Test the resolve function
channel_id = spider.resolve_handle_to_channel_id(handle)
print(f"Resolved channel ID: {channel_id}")