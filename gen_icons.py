"""Generate minimal PNG icons for the Chrome extension."""
import struct
import zlib

def make_png(size, bg=(192, 57, 43), fg=(255, 255, 255)):
    """Write a solid-color PNG with a centred white cross (simple icon)."""
    W = H = size
    pixels = []
    cx = cy = W // 2
    for y in range(H):
        row = []
        for x in range(W):
            # White inner square (40% of size)
            inner = size * 2 // 10
            if (cx - inner <= x <= cx + inner) and (cy - inner <= y <= cy + inner):
                row.extend(fg)
            else:
                row.extend(bg)
        pixels.append(bytes(row))

    raw = b''.join(b'\x00' + row for row in pixels)
    compressed = zlib.compress(raw, 9)

    def chunk(tag, data):
        crc = zlib.crc32(tag + data) & 0xffffffff
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', crc)

    ihdr = struct.pack('>IIBBBBB', W, H, 8, 2, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', compressed)
            + chunk(b'IEND', b''))

for size, name in [(16, 'icon16'), (48, 'icon48'), (128, 'icon128')]:
    path = f'icons/{name}.png'
    with open(path, 'wb') as f:
        f.write(make_png(size))
    print(f'wrote {path}')
