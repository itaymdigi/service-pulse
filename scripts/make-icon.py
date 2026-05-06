import struct, zlib

def create_png():
    def png_chunk(chunk_type, data):
        chunk_len = struct.pack('>I', len(data))
        chunk_crc = struct.pack('>I', zlib.crc32(chunk_type + data) & 0xffffffff)
        return chunk_len + chunk_type + data + chunk_crc

    width = height = 512

    # Colors
    bg = (12, 14, 20)       # #0c0e14
    accent = (91, 138, 240) # #5b8af0
    ok = (47, 212, 160)      # #2fd4a0
    bad = (240, 91, 91)      # #f05b5b

    raw = b''
    for y in range(height):
        raw += b'\x00'
        cx = width // 2
        cy = height // 2
        # Scale
        scale = 1.0
        for x in range(width):
            # Background gradient
            fx = (x - cx) / (width/2)
            fy = (y - cy) / (height/2)
            dist = (fx**2 + fy**2) ** 0.5

            if dist < 0.05:
                # Center dot - gradient from accent
                val = max(0, 1 - dist / 0.05)
                r = int(bg[0] + (accent[0] - bg[0]) * val)
                g = int(bg[1] + (accent[1] - bg[1]) * val)
                b = int(bg[2] + (accent[2] - bg[2]) * val)
                raw += bytes([r, g, b])
            elif dist < 0.9:
                # Main body - dark with subtle gradient
                t = (dist - 0.05) / 0.85
                r = int(bg[0] * (1 - t * 0.3))
                g = int(bg[1] * (1 - t * 0.3))
                b = int(bg[2] * (1 - t * 0.3))

                # Pulse line (ECG style heartbeat)
                ny = fy
                nx = fx
                # ECG line: flat, up, down, up, flat
                pulse_y = 0.0
                px = nx * 2.5  # scale x
                if px < -0.6:
                    pulse_y = 0.0
                elif px < -0.3:
                    pulse_y = -0.2 + 0.2 * (px + 0.3) / 0.3
                elif px < 0.0:
                    pulse_y = 0.6 * (px + 0.3) / 0.3
                elif px < 0.15:
                    pulse_y = 0.6 - 1.2 * (px - 0.0) / 0.15
                elif px < 0.35:
                    pulse_y = -0.6 + 1.2 * (px - 0.15) / 0.2
                elif px < 0.5:
                    pulse_y = 0.0
                else:
                    pulse_y = 0.0

                pulse_y *= 0.18  # amplitude

                if abs(ny - pulse_y) < 0.035 and -1.0 < nx < 1.0:
                    # Pulse line - gradient based on color intensity
                    r, g, b = accent

                raw += bytes([max(0,min(255,r)), max(0,min(255,g)), max(0,min(255,b))])
            else:
                # Outer fade
                t = min(1.0, (dist - 0.9) / 0.1)
                r = int(bg[0] * (1 - t))
                g = int(bg[1] * (1 - t))
                b = int(bg[2] * (1 - t))
                raw += bytes([r, g, b])

    compressed = zlib.compress(raw, 9)
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)

    return b'\x89PNG\r\n\x1a\n' + \
           png_chunk(b'IHDR', ihdr) + \
           png_chunk(b'IDAT', compressed) + \
           png_chunk(b'IEND', b'')

with open('/root/repos/service-pulse/public/icon.png', 'wb') as f:
    f.write(create_png())
print('Done: icon.png')
