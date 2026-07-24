# RoBCode 2 format specification

Status: **Draft 1**
Format name: **RoBCode 2**
Magic bytes: `52 4f 42 32` (`ROB2`)
All multi-byte integers are unsigned and stored in network byte order (big-endian).

RoBCode 2 turns the original Rings of Bytes artwork into a self-contained,
rotationally unique barcode. It deliberately retains the original linear ring
growth, nine-cell bytes, even parity, and `0xAA` whitening. Finder, sync,
length, checksums, and error correction are added because those properties
cannot be inferred reliably from the legacy artwork.

This document is normative. The files in `Old/`, `svg_arc.html`, and the
Legacy mode of the application are historical and are not RoBCode 2.

## 1. Terminology

- **U**: the base module width used for all radial dimensions.
- **dark**: a printed/painted cell representing binary one.
- **light**: a background cell representing binary zero.
- **symbol**: one complete circular RoBCode 2 image.
- **code byte**: one byte after Reed-Solomon encoding and before whitening.
- **cell byte**: the nine visible cells produced from one code byte.
- **R**: the index of the outermost data ring.

Angles are expressed clockwise. Zero degrees is the ray from the center to the
top of the upright symbol.

## 2. Conformance profiles

Version 2 defines exactly one mandatory profile:

| Property | Required value |
|---|---|
| Ring growth | Linear |
| First data ring | 2 |
| Bytes per sector | 1 |
| Bytes in data ring `r` | `2r` |
| Bit order | MSB first |
| Direction | Clockwise |
| Visible cells per byte | 9 |
| Byte parity | Even |
| Whitening | XOR with `0xAA` |
| Error correction profile | 1 |

Configurable legacy properties such as exponential growth, arbitrary XOR,
LSB-first encoding, and selectable parity are intentionally not allowed in a
RoBCode 2 symbol. A decoder must reject a packet that declares an unknown
version, unsupported flag, or unknown error-correction profile.

## 3. Radial geometry

All radii are measured from the symbol center in units of U.

| Radial interval | Meaning |
|---|---|
| `[0.00, 0.50) U` | dark center disc |
| `[0.50, 0.70) U` | light separator |
| `[0.70, 0.90) U` | dark locator ring |
| `[0.90, 1.00) U` | light separator |
| `[1.00, 2.00) U` | synchronization ring |
| `[r, r+1) U`, `2 <= r <= R` | data ring `r` |
| `[R+1.00, R+1.15) U` | light separator |
| `[R+1.15, R+1.35) U` | dark bounding ring |
| after `R+1.35 U` | quiet zone |

The quiet zone must extend at least `1.50 U` beyond the bounding ring in every
direction. Therefore, the image or printed background must extend to a radius
of at least `R+2.85 U`.

Finder, synchronization ring, and bounding ring must use a neutral dark color.
They must not use the optional heritage color palette.

### 3.1 Perspective

The normative shape is circular. An imaged symbol may appear elliptical or as
a general projective conic. Decoders may rectify that image before sampling.
Projective distortion does not change the logical order of cells.

## 4. Synchronization and orientation

The synchronization ring contains 36 equal angular cells. Starting at zero
degrees and proceeding clockwise, its bits are:

```text
110111111010100000001111001100110010
```

The first character occupies `[0, 10)` degrees. Bit `i` occupies:

```text
[i * 10, (i + 1) * 10) degrees
```

The pattern contains 19 dark cells. Its minimum Hamming distance to any
non-zero cyclic rotation is 16. Its minimum Hamming distance to any cyclic
rotation of its mirrored representation is 14.

A decoder must compare both angular directions. A mirrored symbol may either:

1. be decoded by reversing the sampled angular direction; or
2. be rejected explicitly as mirrored.

It must never be accepted under an incorrect rotation or direction. Packet
magic, header CRC, Reed-Solomon syndromes, and payload CRC provide additional
validation after orientation.

## 5. Packet header

The unprotected packet header is exactly 16 bytes:

| Offset | Size | Field | Meaning |
|---:|---:|---|---|
| 0 | 4 | Magic | ASCII `ROB2` |
| 4 | 1 | Flags | payload interpretation |
| 5 | 1 | EC profile | must be `1` |
| 6 | 4 | Payload length | number of original payload bytes |
| 10 | 4 | Payload CRC-32 | CRC of original payload bytes |
| 14 | 2 | Header CRC-16 | CRC of header bytes 0 through 13 |

### 5.1 Flags

Only bit 0 is defined in version 2:

| Bit | Name | Meaning |
|---:|---|---|
| 0 | `TEXT_UTF8` | payload is UTF-8 text when set; otherwise arbitrary binary |
| 1–7 | reserved | must be zero |

A text decoder must validate the complete payload as UTF-8. The binary payload
is always authoritative; text conversion happens only after CRC validation.

### 5.2 CRC-32

Payload CRC uses CRC-32/ISO-HDLC:

| Parameter | Value |
|---|---|
| Width | 32 |
| Polynomial | `0x04C11DB7` |
| Reflected polynomial | `0xEDB88320` |
| Initial value | `0xFFFFFFFF` |
| Input reflected | yes |
| Output reflected | yes |
| Final XOR | `0xFFFFFFFF` |
| Check value for `123456789` | `0xCBF43926` |

The stored CRC is big-endian regardless of the reflected calculation.

### 5.3 Header CRC-16

Header CRC uses CRC-16/CCITT-FALSE:

| Parameter | Value |
|---|---|
| Width | 16 |
| Polynomial | `0x1021` |
| Initial value | `0xFFFF` |
| Input reflected | no |
| Output reflected | no |
| Final XOR | `0x0000` |
| Check value for `123456789` | `0x29B1` |

The CRC is calculated over header offsets 0 through 13 and written to offsets
14 and 15 in big-endian order.

## 6. Reed-Solomon error correction

EC profile 1 uses shortened systematic RS(255,223) over GF(256).

| Property | Value |
|---|---|
| Field | GF(2^8) |
| Primitive polynomial | `x^8+x^4+x^3+x^2+1` (`0x11D`) |
| Primitive element | `alpha = 2` |
| First consecutive root | 0 |
| Number of roots/parity symbols | 32 |
| Generator | `product(x - alpha^i), i=0..31` |
| Symbol order | data first, parity appended |

Generator polynomial coefficients, highest degree first:

```text
01 74 40 34 ae 36 7e 10 c2 a2 21 21 9d b0 c5 e1
0c 3b 37 fd e4 94 2f b3 b9 18 8a fd 14 8e 37 ac 58
```

The last line above is continuous with the first. Without spaces, the exact
33-byte coefficient sequence is:

```text
01744034ae367e10c2a221219db0c5e10c3b37fde4942fb3b9188afd148e37ac58
```

### 6.1 Shortening rule

For a data block of `k` bytes, where `1 <= k <= 223`:

1. conceptually prepend `223-k` zero bytes;
2. encode the resulting 223-byte word as RS(255,223);
3. omit the conceptual leading zero bytes;
4. transmit the original `k` data bytes followed by all 32 parity bytes.

The transmitted shortened codeword therefore contains `k+32` bytes. Leading
zero bytes used for shortening are never whitened, rendered, or transmitted.

### 6.2 Header codeword

The 16-byte header is encoded independently as a shortened `(48,16)` codeword:

```text
16 header bytes || 32 header parity bytes
```

This fixed 48-byte first codeword lets a decoder correct and validate the
header before it knows the payload length.

### 6.3 Payload codewords

The original payload is split sequentially into blocks of at most 223 bytes.
Each block is encoded independently using the shortening rule. Full blocks are
255 bytes; a final block of `k` payload bytes is `k+32` bytes. An empty payload
has no payload codeword.

Codewords are concatenated without interleaving:

```text
header codeword || payload codeword 0 || payload codeword 1 || ...
```

For a payload length `L`:

```text
full_blocks = floor(L / 223)
remainder   = L mod 223

encoded_payload_length = full_blocks * 255
                       + (remainder == 0 ? 0 : remainder + 32)

code_stream_length = 48 + encoded_payload_length
```

The implementation may use byte-parity failures and low-confidence sampled
bytes as Reed-Solomon erasures. Each codeword can correct up to 16 unknown
symbol errors, up to 32 known erasures, or a combination satisfying:

```text
2 * errors + erasures <= 32
```

## 7. Whitening and visible byte representation

Every transmitted code byte and padding byte is independently whitened:

```text
visible_byte = code_byte XOR 0xAA
```

The visible byte is emitted MSB first. For visible byte bits `b7..b0`, the
ninth bit is:

```text
p = b7 XOR b6 XOR b5 XOR b4 XOR b3 XOR b2 XOR b1 XOR b0
```

The nine visible cells are therefore:

```text
b7 b6 b5 b4 b3 b2 b1 b0 p
```

The total number of set cells is even. On decode, parity is checked before the
eight data bits are combined and XOR `0xAA` is removed.

Byte parity detects errors but does not replace Reed-Solomon or CRC.

## 8. Data-ring placement

Data rings start at ring 2. Ring `r` contains `2r` cell bytes and `18r`
visible cells.

Within a ring:

- bytes are placed clockwise;
- byte zero begins at zero degrees;
- bits within each byte are MSB-first followed by parity;
- there is no angular gap between bytes.

For byte index `j` in ring `r` and bit index `b` in `[0,8]`:

```text
cell_index = 9j + b
cell_count = 18r

start_angle = cell_index       * 360 / cell_count
end_angle   = (cell_index + 1) * 360 / cell_count
```

The byte stream is placed sequentially from ring 2 outward. The total code-byte
capacity through ring R is:

```text
capacity(R) = sum(2r, r=2..R)
            = R(R+1) - 2
```

R is the smallest integer for which:

```text
capacity(R) >= code_stream_length
```

Unused byte positions in the final ring are filled with code byte `0x00`.
Padding is whitened and receives byte parity normally. Padding is not part of
any Reed-Solomon codeword and is ignored after the payload length is known.

## 9. Color and contrast

The logical format is binary and does not assign meaning to hue.

The mandatory interoperable rendering is dark cells on a light background.
An encoder may apply the original per-bit heritage colors to data cells only,
provided every selected dark color remains distinguishable from the background
under the intended print and capture conditions. Color must never alter the bit
value, position, or decoding result.

A conforming decoder must support monochrome symbols. Support for low-contrast
decorative colors is optional. Finder, sync, and bounding ring remain neutral
dark in all profiles.

## 10. Decoder validation order

A decoder should process a candidate symbol in this order:

1. locate the center finder and bounding ring;
2. estimate U, R, and any projective transform;
3. correlate the sync pattern in both angular directions;
4. sample data cells and validate nine-cell byte parity;
5. remove `0xAA` whitening;
6. RS-decode the fixed 48-byte header codeword;
7. validate magic, reserved flags, EC profile, and header CRC-16;
8. calculate the required payload codeword lengths;
9. RS-decode all payload codewords;
10. truncate to the declared payload length;
11. validate payload CRC-32;
12. if flagged as text, validate and decode UTF-8.

A decoder must not return payload data unless all applicable checks succeed.
Correctable errors may be reported as diagnostics. An uncorrectable symbol must
produce an explicit failure rather than partial or guessed payload.

## 11. Golden vectors

Machine-readable vectors are stored in `docs/test-vectors.json`.

### 11.1 Empty binary payload

```text
payload:
flags:                00
header:               524f423200010000000000000000461f
header RS codeword:   524f423200010000000000000000461f
                      a11493a8f623e0aea01dc54844cf14db77
                      ff88e08177c7240b8b986ffef29943
code stream bytes:    48
outer data ring R:    7
final padding bytes:  6
```

### 11.2 UTF-8 text `RoBCode`

```text
payload:              526f42436f6465
flags:                01
payload CRC-32:       04d4d1fc
header:               524f423201010000000704d4d1fc35ae
header RS codeword:   524f423201010000000704d4d1fc35ae
                      a14cc81373176ac4b4f51fce5d60b546
                      75060e636851b706ca18bd3311e051c4
payload RS codeword:  526f42436f64657e0f68002df71d7d80
                      7e9771f6465184453362a35b6088634b
                      e35fe7af51d9dc
code stream bytes:    87
outer data ring R:    9
final padding bytes:  1
```

The first code byte in both examples is `0x52`. After whitening it is `0xF8`.
Its visible nine-cell sequence is `111110001`.

## 12. Versioning rules

- `ROB2` identifies this specification and no legacy format.
- Reserved flag bits must remain zero until assigned by a later specification.
- EC profile values other than 1 are unsupported in this version.
- Geometry or bit-placement changes require a new magic/version.
- Compatible additions that do not change visible encoding may use a reserved
  flag only after that flag's behavior is fully specified.

## 13. Non-goals

RoBCode 2 is not encryption, authentication, or a digital signature. CRC and
Reed-Solomon protect against capture and media errors, not intentional changes.
Applications requiring authenticity must sign or authenticate the payload.
