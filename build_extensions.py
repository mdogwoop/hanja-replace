#!/usr/bin/env python3
"""
Packages the extension into Chrome (MV3) and Firefox (MV3) zips under dist/.

Chrome  : manifest as-is (background.service_worker, options_page).
Firefox : manifest transformed — background.scripts (event page, works on
          Firefox 115+), options_ui, and browser_specific_settings.gecko.
"""

import json
import os
import zipfile

BASE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(BASE, 'dist')
os.makedirs(DIST, exist_ok=True)

with open(os.path.join(BASE, 'manifest.json'), encoding='utf-8') as f:
    manifest = json.load(f)

VERSION = manifest['version']

# Files shared by both builds (manifest is added per-build)
ASSETS = [
    'background.js',
    'content.js',
    'dict.js',
    'popup.html', 'popup.css', 'popup.js',
    'options.html', 'options.css', 'options.js',
    'icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png',
]


def firefox_manifest(src):
    m = json.loads(json.dumps(src))  # deep copy
    # Firefox event page instead of service worker (compatible with 115+)
    m['background'] = {'scripts': ['background.js']}
    # Firefox prefers options_ui
    m.pop('options_page', None)
    m['options_ui'] = {'page': 'options.html', 'open_in_tab': True}
    # Required for AMO / signing
    m['browser_specific_settings'] = {
        'gecko': {
            'id': 'hanja-replace@mdogwoop.github',
            'strict_min_version': '115.0',
        }
    }
    return m


def build(zip_name, manifest_obj):
    path = os.path.join(DIST, zip_name)
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('manifest.json', json.dumps(manifest_obj, ensure_ascii=False, indent=2))
        for rel in ASSETS:
            z.write(os.path.join(BASE, rel), rel)
    size = os.path.getsize(path)
    print(f'  {zip_name}  ({size/1024:.1f} KiB)')
    return path


print('Building extension packages:')
chrome_zip  = build(f'hanja-replace-chrome-v{VERSION}.zip',  manifest)
firefox_zip = build(f'hanja-replace-firefox-v{VERSION}.zip', firefox_manifest(manifest))
print('Done.')
